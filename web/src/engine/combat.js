// Combat: the Weapons department step (original @16f3, 1 Hz round-robin slot 1), the combat-view simulation
// (original @6e26 minus drawing, ~40 Hz) and the 1 Hz ship/reload timers (@64aa, slot 0).
// Rules: docs/modern/model/combat.md (R1..R8). Fixes: docs/modern/changes/combat.md.
//
// Weapons step: firing orders (queue of 8, priority list) become up to 5 fire channels each second when their
// weapon system works and is powered and the target is locked and on screen; closed channels feed the shot
// statistics; killed / aged-out targets are freed; the officer auto-fires when idle and gets stressed when busy.
// Combat view: 8 object slots — 0..3 enemy ships (one per bearing: port, fore, starboard, aft), 4..5 enemy shots,
// 6..7 our shots. Each update: starfield step (RNG only), our launches, ship spawn, ship AI / enemy fire, shot
// steering, movement, our hit test, enemy hit test. Drawing is the UI's job: we emit 'sound', 'border', 'view',
// 'shot', 'hit', 'explosion', 'weaponLamp' events.
//
// Field conventions kept from the original (they are compared against it): ship slot's target and our shot's
// target are stored as target*2, our shot's ship slot as slot*2 (0xfffe = none); coordinates are 8.8 fixed point
// u16 with 16-bit wrap-around (screen position = signed hi byte).
//
// Verified 0-diff (tools/equiv.mjs, ONLY=f_16f3,f_6e26,f_64aa) over: the SEL demo mission
// (w:300 k:Enter w:60 k:^D w:7000 w:200000), and manual crews with Weapons firing orders (F with all weapon types,
// at-will and counted shots, Cancel/Rank) plus random keys — see the module report.
import { random } from './rng.js';
import { ORIGINAL_BALANCE, scaled, evasionThreshold } from './presets.js';
import { post, remove } from './messages.js';
import { i16, u16 } from './fields.js';

const TARGETS = 26;
const AT_WILL = 10;                 // order shots value meaning "at will" (never used up)
const WEAPON_SYS = 4;               // weapon type w uses ship system 4+w
const WEAPONS_DEPT = 0;
const MSG = { KILL: 2, QUEUE_EMPTY: 4, AUTO_FIRE: 6 };   // Weapons officer messages (dept 0)
const SHIP_SLOTS = 4, ENEMY_SHOT = 4, OUR_SHOT = 6;      // first object slot of each group
const SND = { HIT_US: 0x18, KILL: 0x22 };
const BORDER = { FLASH: 0x2f, NORMAL: 0x20 };

const hi = v => (v << 16) >> 24;    // signed hi byte (screen units) of an 8.8 u16
const hiU = v => (v >> 8) & 0xff;   // unsigned hi byte

// ---------------------------------------------------------------- Weapons step (@16f3)

// Names follow the module that owns a shared address (scanning: contact*, damage: gunMiss/pendingHit, nav: pos,
// view, wantedView, starX/starY = star centre), because the engine state is one object shared by all modules.
const ORDER_FIELDS = [
  ['orderSerial', 0x3e0, 'i16', 8],     // order id 0..25, -1 = free slot
  ['orderShots', 0x3f0, 'i16', 8],      // 1..9 or AT_WILL
  ['orderWeapon', 0x400, 'i16', 8],     // 0 missiles, 1 blasters, 2 cannons, 3 thermos
  ['orderTarget', 0x410, 'i16', 8],
  ['orderStatus', 0x420, 'i16', 8],     // 0 broken, 1 no power, 2 need lock, 3 out of range, 4 in range
  ['orderChannel', 0x430, 'i16', 8],    // channel this second, -1 none
  ['orderQueue', 0x440, 'u16', 8],      // priority list of order slots
  ['orderCount', 0x506, 'i16'],
  ['nextSerial', 0x508, 'i16'],
  ['targetOrdered', 0x912, 'u16', TARGETS],
];
const CHANNEL_FIELDS = [
  ['chTarget', 0x450, 'i16', 5],        // -1 = idle
  ['chWeapon', 0x45a, 'i16', 5],
  ['chOrder', 0x464, 'i16', 5],         // order slot owning the channel
  ['chShots', 0x46e, 'i16', 5],         // shots left (decremented per launch)
  ['chLaunched', 0x478, 'i16', 5],      // shots launched this second
];
// per-contact state (owned by scanning) and other modules' state that combat reads or writes
const SHARED_FIELDS = [
  ['contactClass', 0x59e, 'i16', TARGETS], ['contactIdClass', 0x606, 'i16', TARGETS],
  ['contactHostile', 0x63a, 'u16', TARGETS], ['contactLocked', 0x6a2, 'u16', TARGETS],
  ['contactBearing', 0x6d6, 'u16', TARGETS], ['contactOnScreen', 0x70a, 'u16', TARGETS],
  ['contactDamage', 0x73e, 'u16', TARGETS], ['contactWeakness', 0x7da, 'u16', TARGETS],
  ['contactSpawnPos', 0x876, 'u16', TARGETS], ['contactListed', 0x8de, 'u16', TARGETS],
  ['contactKilledBy', 0x946, 'u16', TARGETS],   // weapon+1
  ['examList', 0x97a, 'i16', 9],        // 8 entries (+1: removal shifts in the following word)
  ['screenQueue', 0x9ca, 'i16', 4],     // ship spawn request per bearing
  ['contactsDetected', 0x9d2, 'i16'], ['examLen', 0x9d4, 'i16'],
  ['launchBlocked', 0x50a, 'u16'], ['pendingHit', 0x1288, 'u16', 5],
  ['sysState', 0xebc, 'i16', 26], ['powered', 0xf58, 'i16', 26],
  ['navState', 0xb64, 'i16'], ['speed', 0xb68, 'i16'], ['pos', 0xb7a, 'i16'],
  ['gunMiss', 0x8b30, 'u16', 4], ['gunReload', 0x8b40, 'u16', 4],   // replaced when the gunner dies
  ['view', 0x3afe, 'i16'], ['wantedView', 0x3b00, 'i16'],
  ['starX', 0x4606, 'i16'], ['starY', 0x4608, 'i16'],               // star centre (moved by nav)
];
const WEAPONS_FIELDS = [
  ...ORDER_FIELDS, ...CHANNEL_FIELDS, ...SHARED_FIELDS,
  ['killsByWeapon', 0x482, 'i16', 28],  // [weapon*7 + report column], cap 99
  ['shotsByWeapon', 0x4ba, 'i16', 28],  // cap 999
  ['killsByClass', 0x4f2, 'i16', 10],
  ['autoFireIdle', 0x16d2, 'u16'],      // seconds the queue must stay empty before auto-fire
  ['stressHold', 0x16d4, 'u16'],
  ['autoFireWeapon', 0x16d6, 'i16'],    // round-robin weapon type 0..3
  ['weaponFiring', 0x16d8, 'i16', 4],   // fired this second (lamp)
  ['weaponLampShown', 0x3c6, 'i16', 4],
];
const WEAPONS_DATA = [
  ['reportColumn', 0x6266, 'i16', 17], ['contactLifetime', 0x6252, 'i16', 11], ['demo', 0x3508, 'u16'],
  // weapons crew file
  ['autoFireDelay', 0x8b56, 'u16', 2], ['autoFireShots', 0x8b5a, 'u16'], ['stressHoldTime', 0x8b50, 'u16'],
  ['stressTargets', 0x8b52, 'i16'], ['stressOrders', 0x8b54, 'i16'],
];

// @23df: take target t off the scanning examination list
function removeFromExamList(S, t) {
  if (!S.contactListed[t]) return;
  let j = 0;
  while (S.examList[j] !== t) j++;
  S.contactListed[t] = 0;
  S.examLen--;
  for (; j < S.examLen; j++) S.examList[j] = S.examList[j + 1];
}

function removeFromList(S, i) {
  S.orderCount--;
  for (let j = i; j < S.orderCount; j++) S.orderQueue[j] = S.orderQueue[j + 1];
}

// @15b3: drop the first order with this serial
export function dropOrder(S, serial, ctx) {
  for (let i = 0; i < S.orderCount; i++) {
    const s = S.orderQueue[i];
    if (S.orderSerial[s] !== serial) continue;
    S.orderSerial[s] = -1;
    const t = S.orderTarget[s];
    removeFromList(S, i);
    S.targetOrdered[t] = 0;
    for (let k = 0; k < S.orderCount; k++) {
      const other = S.orderQueue[k];
      // original marks the other order's *slot index* instead of the target
      if (S.orderTarget[other] === t) { S.targetOrdered[ctx.fixes.dropOrderFlag ? t : other] = 1; break; }
    }
    return;
  }
}

// @167c: drop every order on target t
function dropOrdersOfTarget(S, t) {
  for (let i = 0; i < S.orderCount;) {
    const s = S.orderQueue[i];
    if (S.orderTarget[s] === t) { S.orderSerial[s] = -1; removeFromList(S, i); } else i++;
  }
  S.targetOrdered[t] = 0;
}

// @14f3: insert an order at priority position pos
export function queueOrder(S, target, shots, weapon, pos) {
  if (S.contactClass[target] === 0) return;
  let n = S.orderCount;
  if (pos > n) pos = n;
  for (; n > pos; n--) S.orderQueue[n] = S.orderQueue[n - 1];
  let s = 0;
  while (s < 8 && S.orderSerial[s] >= 0) s++;   // ponytail: no full-queue guard, callers only queue with count < 8
  S.orderQueue[pos] = s;
  S.orderSerial[s] = S.nextSerial;
  S.nextSerial = S.nextSerial + 1 >= 26 ? 0 : S.nextSerial + 1;
  S.orderShots[s] = shots; S.orderWeapon[s] = weapon; S.orderTarget[s] = target; S.orderChannel[s] = -1;
  S.targetOrdered[target] = 1;
  S.orderCount++;
}

function freeTarget(S, t) {
  removeFromExamList(S, t);
  dropOrdersOfTarget(S, t);
  S.contactClass[t] = 0;
  S.contactsDetected--;
}

// killed targets are booked and freed; old targets out of sight age out; returns the first auto-fire candidate
function reviewTargets(S, D, ctx) {
  let candidate = -1;
  for (let t = 0; t < TARGETS; t++) {
    const killedBy = S.contactKilledBy[t];
    if (killedBy) {
      const k = (killedBy - 1) * 7 + D.reportColumn[S.contactIdClass[t]];
      if (S.killsByWeapon[k] < 99) S.killsByWeapon[k]++;
      S.killsByClass[S.contactClass[t]]++;
      freeTarget(S, t);
      remove(S, MSG.AUTO_FIRE, ctx);
      post(S, MSG.KILL, ctx);
      S.contactKilledBy[t] = 0;
    }
    const cls = S.contactClass[t];
    if (cls === 0) continue;
    const aged = i16(S.pos - S.contactSpawnPos[t]) >= D.contactLifetime[cls];
    if (aged && !S.screenQueue.includes(t) && !S.contactOnScreen[t]) freeTarget(S, t);
    else if (candidate < 0 && S.contactOnScreen[t] && S.contactLocked[t] && S.contactHostile[t]) candidate = t;
  }
  return candidate;
}

// last second's channels: lamps, statistics, finished orders
function closeChannels(S, D, ctx) {
  for (let c = 0; c < 5; c++) {
    if (S.chTarget[c] < 0) continue;
    const col = D.reportColumn[S.contactIdClass[S.chTarget[c]]], w = S.chWeapon[c];
    if (S.chLaunched[c]) S.weaponFiring[w] = 1;
    if (w < 4) { const k = w * 7 + col; S.shotsByWeapon[k] = Math.min(999, S.shotsByWeapon[k] + S.chLaunched[c]); }
    if (S.chShots[c] === 0) {
      dropOrder(S, S.orderSerial[S.chOrder[c]], ctx);
      if (S.orderCount === 0 && !D.demo) { remove(S, MSG.AUTO_FIRE, ctx); post(S, MSG.QUEUE_EMPTY, ctx); }
    }
    S.chTarget[c] = -1;
  }
}

function orderStatus(S, D, s) {
  const sys = WEAPON_SYS + S.orderWeapon[s], t = S.orderTarget[s];
  return !S.sysState[sys] ? 0 : !S.powered[sys] ? 1 : !S.contactLocked[t] ? 2 : !S.contactOnScreen[t] ? 3 : 4;
}

function openChannels(S, D) {
  for (let i = 0; i < S.orderCount; i++) {
    const s = S.orderQueue[i];
    if (S.orderChannel[s] >= 0) {
      if (S.orderShots[s] !== AT_WILL) S.orderShots[s] = S.chShots[S.orderChannel[s]];
      S.orderChannel[s] = -1;
    }
    S.orderStatus[s] = orderStatus(S, D, s);
  }
  for (let i = 0, c = 0; i < S.orderCount && c < 5; i++) {
    const s = S.orderQueue[i];
    if (S.orderStatus[s] !== 4) continue;
    S.chTarget[c] = S.orderTarget[s]; S.orderChannel[s] = c; S.chOrder[c] = s;
    S.chWeapon[c] = S.orderWeapon[s]; S.chShots[c] = S.orderShots[s]; S.chLaunched[c] = 0;
    c++;
  }
}

const weaponReady = (S, w) => S.powered[WEAPON_SYS + w] && S.sysState[WEAPON_SYS + w];

// the officer's own initiative: auto-fire when idle, stress when busy
function officer(S, D, ctx, candidate) {
  if (S.autoFireIdle) S.autoFireIdle--;
  if (S.orderCount) S.autoFireIdle = D.autoFireDelay[S.deptStress[WEAPONS_DEPT]];
  else if (S.autoFireIdle === 0 && candidate >= 0) {
    // original tries one weapon type per second (a loop whose body always leaves)
    for (let tries = ctx.fixes.autoFireAllWeapons ? 4 : 1; tries > 0; tries--) {
      S.autoFireWeapon = S.autoFireWeapon + 1 >= 4 ? 0 : S.autoFireWeapon + 1;
      if (!weaponReady(S, S.autoFireWeapon)) continue;
      queueOrder(S, candidate, D.autoFireShots, S.autoFireWeapon, 1);
      remove(S, MSG.QUEUE_EMPTY, ctx); remove(S, MSG.KILL, ctx);
      if (!D.demo) post(S, MSG.AUTO_FIRE, ctx);
      break;
    }
  }
  if (S.stressHold) S.stressHold--;
  else S.deptStress[WEAPONS_DEPT] = 0;
  if (S.contactsDetected > D.stressTargets || S.orderCount > D.stressOrders) {
    S.deptStress[WEAPONS_DEPT] = 1;
    S.stressHold = D.stressHoldTime;
  }
}

function weaponLamps(S, D, ctx) {
  for (let w = 0; w < 4; w++) {
    const sys = WEAPON_SYS + w;
    const st = !S.sysState[sys] || !S.powered[sys] ? 0 : S.sysState[sys] === 1 ? 1 : S.weaponFiring[w] ? 3 : 2;
    if (S.weaponLampShown[w] !== st) { ctx.emit('weaponLamp', w, st); S.weaponLampShown[w] = st; }
  }
}

export function weaponsStep(S, D, ctx) {
  S.weaponFiring.fill(0);
  const candidate = reviewTargets(S, D, ctx);
  closeChannels(S, D, ctx);
  openChannels(S, D);
  if (S.deptAlive[WEAPONS_DEPT]) officer(S, D, ctx, candidate);
  weaponLamps(S, D, ctx);
}

// ---------------------------------------------------------------- combat view (@6e26)

const VIEW_FIELDS = [
  ['displayTicks', 0x351a, 'u16'],      // ISR ticks since the last update (update at >= 3)
  ['starStep', 0x3ae4, 'u16'], ['borderFlash', 0x3b02, 'u16'], ['viewBlank', 0x3b06, 'u16'],
  // stars: 0..11 forward view, 12..23 rear view. Not drawing state: how many RNG calls a star step makes depends on them
  ['starsX', 0x3b08, 'i16', 24], ['starsY', 0x3b38, 'i16', 24],
];
const OBJECT_FIELDS = [
  ['objMoveDelay', 0x4cfc, 'u16', 8],
  ['shipTimer', 0x4d0c, 'u16', 6],      // 0..3 ship AI timers, 4..5 reload timers of our shot slots 6..7 (seconds)
  ['objActive', 0x4d18, 'u16', 8],
  ['objKind', 0x4d28, 'i16', 8],        // ships 2*class; shots weapon / sprite, >= 4 exploding
  ['objView', 0x4d38, 'u16', 8],        // 0 front, 1 rear
  ['objX', 0x4d48, 'u16', 8], ['objY', 0x4d58, 'u16', 8], ['objZ', 0x4d68, 'u16', 8],
  ['objVx', 0x4d78, 'u16', 8], ['objVy', 0x4d88, 'u16', 8], ['objVz', 0x4d98, 'u16', 8],
  ['objZHit', 0x4da8, 'u16', 8],
  ['shipTarget', 0x4db8, 'i16', 4],     // target*2, -1 retired
  ['shipTargetCopy', 0x4dc0, 'i16', 4],
  ['shipAggressive', 0x4dc8, 'u16', 4],
  ['shipProvoked', 0x4dd0, 'u16', 4],
  ['shipFacing', 0x4dd8, 'u16', 4],     // bearing 0 port, 1 fore, 2 starboard, 3 aft
  ['enemyShooter', 0x4de0, 'u16', 2], ['enemyAimX', 0x4de4, 'u16', 2], ['enemyAimY', 0x4de8, 'u16', 2],
  ['enemyBearing', 0x4dec, 'u16', 2],
  ['shotTarget', 0x4df0, 'u16', 2],     // target*2
  ['shotShip', 0x4df4, 'u16', 2],       // ship slot*2, 0xfffe none
];
const COMBAT_FIELDS = [...VIEW_FIELDS, ...OBJECT_FIELDS, ...CHANNEL_FIELDS, ...SHARED_FIELDS];
const COMBAT_DATA = [
  ['frameOverride', 0x3b04, 'u16'], ['starPeriod', 0x3ae6, 'u16', 9],
  ['starRespawnX', 0x460a, 'i16', 4], ['starRespawnY', 0x4612, 'i16', 4],
  ['evasion', 0xb208, 'i16'], ['enemyHitChance', 0x622f, 'i16'],
  // weapons crew file: stressed miss threshold and reload (s) per weapon (normal ones: gunMiss / gunReload)
  ['missStressed', 0x8b38, 'u16', 4], ['reloadStressed', 0x8b48, 'u16', 4],
  ['launchTune', 0x2f70, 'u16', 4], ['spawnX', 0x2f78, 'u16', 4], ['spawnView', 0x2f80, 'u16', 4],
  ['vxTable', 0x2f88, 'u16', 8], ['vyTable', 0x2f98, 'u16', 8], ['vzTable', 0x2fa8, 'u16', 8],
  // visible area near the viewer, by depth 0..15
  ['nearYTop', 0x2fb8, 'i16', 16], ['nearYBottom', 0x2fd8, 'i16', 16],
  ['nearXRight', 0x2ff8, 'i16', 16], ['nearXLeft', 0x3018, 'i16', 16],
  // sprite tables and sprites, only for the drawing spill (spriteSpill)
  ['rowOffsets', 0x4540, 'u16', 0x5f], ['spriteTables', 0x3038, 'u16', 0xe6],
  ['spritesFar', 0x4df8, 'u8', 0x6e], ['sprites', 0x64a4, 'u8', 0x190c],
];
const randomEntry = (S, table) => table[(random(S) & 0xe) >> 1];

// forward view: stars fly outwards from the centre and respawn near it
function starsForward(S, D) {
  const step = (a, i, c) => { let d = i16(a[i] - c) >> 3; if (d === 0) d = 1; a[i] = i16(a[i] + d); };
  const respawn = (a, i, c) => { const r = random(S); let d = (r & 0xf) + 1; if (r & 0x20) d = -d; a[i] = i16(d + c); };
  for (let i = 0; i < 12; i++) {
    step(S.starsX, i, S.starX); step(S.starsY, i, S.starY);
    const x = S.starsX[i], y = S.starsY[i];
    if (x <= -0x40 || x >= 0x40 || y <= -0x20 || y >= 0x20) {
      respawn(S.starsX, i, S.starX); respawn(S.starsY, i, S.starY);
    }
  }
}

// rear view: stars converge on the centre and respawn at the edge
function starsRear(S, D) {
  for (let i = 12; i < 24; i++) {
    const dx = S.starsX[i] >> 3;
    if (dx) {
      S.starsX[i] = i16(S.starsX[i] - dx);
      const dy = S.starsY[i] >> 3;
      if (dy) { S.starsY[i] = i16(S.starsY[i] - dy); continue; }
    }
    const j = (random(S) & 6) >> 1;
    S.starsX[i] = D.starRespawnX[j] || (random(S) & 0x7f) - 0x40;
    S.starsY[i] = D.starRespawnY[j] || (random(S) & 0x3f) - 0x20;
  }
}

const slotBusy = (S, d) => S.objActive[OUR_SHOT + d] | S.shipTimer[SHIP_SLOTS + d];

// @5d20: ready channels launch homing shots at their target's ship (one free shot slot per launch)
export function launchOurShots(S, D, ctx) {
  if (S.launchBlocked) return;
  const channels = ctx.fixes.channelPriority ? [0, 1, 2, 3, 4] : [4, 3, 2, 1, 0];
  for (const c of channels) {
    const t = S.chTarget[c];
    if (t < 0 || !S.contactOnScreen[t]) continue;
    let d = 0;
    if (slotBusy(S, 0)) { d = 1; if (slotBusy(S, 1)) return; }
    if (S.chShots[c] === 0) continue;
    const o = OUR_SHOT + d, w = S.chWeapon[c];
    S.objKind[o] = w;
    S.shotTarget[d] = t * 2;
    S.chLaunched[c]++; S.chShots[c]--;
    ctx.emit('sound', D.launchTune[w]);
    S.shipTimer[SHIP_SLOTS + d] = scaled(S.deptStress[WEAPONS_DEPT] ? D.reloadStressed[w] : S.gunReload[w], (ctx.balance || ORIGINAL_BALANCE).ourReload, 1, 0xffff);
    if (!slotBusy(S, 1 - d)) S.shipTimer[SHIP_SLOTS + 1 - d] = 1;   // the other slot waits a second
    S.objActive[o]++;
    let k = 3;
    while (k >= 0 && !(S.objActive[k] && S.shotTarget[d] === S.shipTarget[k])) k--;
    S.shotShip[d] = u16(k * 2);
    // ponytail: k < 0 (target on screen but in no ship slot) writes garbage in the original (B11); unreachable
    if (!S.shipAggressive[k]) { S.shipAggressive[k] = 1; S.shipProvoked[k] = 5; }   // provoked
    S.wantedView = S.objView[o] = S.objView[k];                                            // display flips to it
    S.objX[o] = 0x2000; S.objY[o] = 0x3e00; S.objZ[o] = 0x400; S.objVz[o] = 0x300;
    ctx.emit('shot', o, w, t);
  }
}

// @5e08: at most one requested ship (Scanning's spawn request per bearing) enters its free slot
function spawnShip(S, D, ctx) {
  for (let k = 3; k >= 0; k--) {
    if (S.objActive[k]) continue;
    const t = S.screenQueue[k];
    if (t < 0) continue;
    S.screenQueue[k] = -1;
    if (S.contactKilledBy[t]) continue;
    S.shipTarget[k] = S.shipTargetCopy[k] = t * 2;
    S.objActive[k] = 1;
    S.objKind[k] = S.contactClass[t] * 2;
    S.contactOnScreen[t] = 1;
    S.objY[k] = (random(S) & 0x3f) * 0x101;
    S.objZ[k] = 0x7800;
    S.shipAggressive[k] = S.contactHostile[t] ? 1 : 0;
    S.objX[k] = u16((random(S) & 0xf) * 0x101 + D.spawnX[k]);
    S.wantedView = S.objView[k] = D.spawnView[k];
    S.objVz[k] = u16(-16);
    S.objVx[k] = randomEntry(S, D.vxTable);
    S.objVy[k] = randomEntry(S, D.vyTable);
    S.shipTimer[k] = 15;
    ctx.emit('spawn', k, t);
    return;
  }
}

// @5f8a: ship k fires into the first free enemy shot slot, 5 then 4, toward a random screen point
function shipFire(S, k, t, ctx) {
  for (let e = 1; e >= 0; e--) {
    const o = ENEMY_SHOT + e;
    if (S.objActive[o]) continue;
    S.objActive[o] = 1;
    S.objKind[o] = random(S) & 3;
    S.objX[o] = S.objX[k]; S.objY[o] = S.objY[k]; S.objZ[o] = S.objZ[k];
    S.objVz[o] = 0xfe00;
    S.enemyAimY[e] = (random(S) & 0x3f) * 0x101;
    S.enemyAimX[e] = ((random(S) & 0x1f) + 0x20) * 0x101;
    S.wantedView = S.objView[o] = S.objView[k];
    S.enemyBearing[e] = S.shipFacing[k];
    S.contactHostile[t] = 1;
    S.enemyShooter[e] = u16(S.objKind[k]);
    ctx.emit('shot', o, S.objKind[o], t);
    return;
  }
}

// @5eba: ships whose AI timer ran out may attack, then pick a new course unless steering is out
function shipAI(S, D, ctx) {
  for (let k = 3; k >= 0; k--) {
    if (!S.objActive[k] || S.shipTimer[k]) continue;
    const kind = S.objKind[k], t = S.shipTarget[k] >> 1;
    S.shipTimer[k] = S.shipAggressive[k] ? (random(S) & 3) | 1 : (random(S) & 0xf) | 4;
    // class 6,7 always attack, 1..5 half the time, 8,9 never (unless already aggressive)
    let attack = true;
    if (!S.shipAggressive[k]) {
      if (kind >= 0x10) attack = false;
      else if (kind < 0xc && !(random(S) & 1)) attack = false;
    }
    if (attack && !(S.contactDamage[t] & 2)) { S.shipAggressive[k] = 1; shipFire(S, k, t, ctx); }   // bit 1: weapons out
    if (S.contactDamage[t] & 4) continue;                                                        // bit 2: steering out
    S.objVz[k] = randomEntry(S, D.vzTable);
    if ((k === 3) === (S.objView[k] === 0)) S.objVz[k] = u16(-S.objVz[k]);   // sign flips outside the home view
    if (hi(S.objZ[k]) > 0x10 || hi(S.objVz[k]) >= 0) {
      S.objVx[k] = randomEntry(S, D.vxTable);
      S.objVy[k] = randomEntry(S, D.vyTable);
    }
  }
}

// @6006: enemy shots drift toward their aim point, ours home in on their ship. Runs for idle slots too.
function steerShots(S) {
  const toward = (p, q, d) => p === q ? 0 : u16(p < q ? d : -d);
  for (let e = 1; e >= 0; e--) {
    const o = ENEMY_SHOT + e;
    if (S.objKind[o] >= 4) continue;
    S.objVx[o] = toward(hi(S.objX[o]), hi(S.enemyAimX[e]), 0x80);
    S.objVy[o] = toward(hi(S.objY[o]), hi(S.enemyAimY[e]), 0x80);
  }
  for (let d = 1; d >= 0; d--) {
    const o = OUR_SHOT + d;
    if (S.objKind[o] >= 4) continue;
    const k = S.shotShip[d] >> 1;
    const dx = hi(u16(S.objX[o] - S.objX[k])), dy = hi(u16(S.objY[o] - S.objY[k]));
    S.objVx[o] = dx >= 1 ? 0xff00 : dx <= -1 ? 0x100 : 0;
    S.objVy[o] = dy >= 2 ? 0xfe00 : dy <= -2 ? 0x200 : 0;
  }
}

// ship stays on screen; its bearing (shield sector it hits) follows its screen position
function shipBounds(S, k) {
  for (const [p, v] of [['objX', 'objVx'], ['objY', 'objVy']]) {
    if (hi(S[p][k]) <= -0x1a) { S[p][k] = 0xe700; S[v][k] = u16(-S[v][k]); }
    if (hi(S[p][k]) > 0x4e) { S[p][k] = 0x4d00; S[v][k] = u16(-S[v][k]); }
  }
  let facing = 3;
  if (S.objView[k] === 0) { const sx = hi(S.objX[k]); facing = sx < 0x10 ? 0 : sx < 0x30 ? 1 : 2; }
  S.contactBearing[S.shipTarget[k] >> 1] = facing;
  S.shipFacing[k] = facing;
}

// objects close to the viewer are kept inside the visible area for their depth
function nearClamp(S, D, o) {
  const b = hiU(S.objZ[o]);
  if (hi(S.objY[o]) < 0x10) { if (i16(S.objY[o]) >= D.nearYTop[b]) S.objY[o] = u16(D.nearYTop[b]); }
  else if (hi(S.objY[o]) > 0x30) { if (i16(S.objY[o]) <= D.nearYBottom[b]) S.objY[o] = u16(D.nearYBottom[b]); }
  else if (hi(S.objX[o]) < 0x20) { if (i16(S.objX[o]) > D.nearXLeft[b]) S.objX[o] = u16(D.nearXLeft[b]); }
  else if (i16(S.objX[o]) <= D.nearXRight[b]) S.objX[o] = u16(D.nearXRight[b]);
}

// @60b4: step every active object (slower when far away), mirror objects passing the viewer, retire far ones
function moveObjects(S, D) {
  for (let o = 7; o >= 0; o--) {
    if (!S.objActive[o]) continue;
    if (S.objMoveDelay[o]) { S.objMoveDelay[o]--; continue; }
    let depth = S.objZ[o];
    if (o >= ENEMY_SHOT && S.objKind[o] >= 4) { depth = S.objZHit[o]; S.objKind[o]++; }   // explosion animates
    S.objMoveDelay[o] = depth >> 14;                                               // depth >= 64: every 2nd update
    S.objX[o] = u16(S.objX[o] + S.objVx[o]); S.objY[o] = u16(S.objY[o] + S.objVy[o]); S.objZ[o] = u16(S.objZ[o] + S.objVz[o]);
    if (hi(S.objZ[o]) < 0) {           // passed the viewer: continue in the other view
      S.objVz[o] = u16(-S.objVz[o]); S.objVx[o] = u16(-S.objVx[o]);
      S.objX[o] = u16(0x40 - S.objX[o]);
      S.objView[o] ^= 1;
      S.objZ[o] = 0;
    }
    if (hi(S.objZ[o]) >= 0x7d) {       // flew away
      S.objActive[o] = 0;
      if (o < SHIP_SLOTS) { S.contactOnScreen[S.shipTarget[o] >> 1] = 0; S.shipTarget[o] = -1; continue; }
    }
    if (o < SHIP_SLOTS) shipBounds(S, o);
    if (o < OUR_SHOT && hiU(S.objZ[o]) < 0x10) nearClamp(S, D, o);
  }
}

// z partner of the depth test: the original reads word 0x4d74+2*ship (B2), i.e. z of slot 6+ship, past the end of
// the z array into vx of ships 0/1 for ship slots 2/3
const bugDepthPartner = (S, k) => k < 2 ? S.objZ[OUR_SHOT + k] : S.objVx[k - 2];

// @6242: our shot at its ship's depth rolls to hit; first hit sets damage bits, a hit on a ship with bit 0 kills it
export function ourHitTest(S, D, ctx) {
  for (const d of ctx.fixes.shotSlots ? [1, 0] : [1]) {   // original only tests slot 7 (B1)
    const o = OUR_SHOT + d;
    if (!S.objActive[o] || S.objKind[o] >= 4) continue;
    const k = S.shotShip[d] >> 1;
    if (S.shotTarget[d] !== S.shipTarget[k]) continue;    // target left that ship slot
    // with both slots live, the other shot may already have killed this ship: it must not die twice
    if (ctx.fixes.shotSlots && !S.objActive[k]) continue;
    const partner = ctx.fixes.depthCheck ? S.objZ[o] : bugDepthPartner(S, k);
    if (hiU(u16(S.objZ[k] - partner)) > 4) continue;
    const t = S.shotTarget[d] >> 1, w = S.objKind[o];
    let miss = scaled(S.deptStress[WEAPONS_DEPT] ? D.missStressed[w] : S.gunMiss[w], (ctx.balance || ORIGINAL_BALANCE).ourMiss, 0, 255);
    if (u16(S.contactWeakness[t] - 1) === w) miss = ctx.fixes.weakness ? miss >> 2 : miss << 2;   // B3: x4 on the MISS
    if (i16(miss) >= random(S)) continue;                // missed; may roll again next update
    if (!(S.contactDamage[t] & 1)) {
      const bits = random(S) & 7;
      if (bits) S.contactDamage[t] = (S.contactDamage[t] & 7) | bits;   // bit0 engines, bit1 weapons, bit2 steering
      ctx.emit('hit', t, S.contactDamage[t]);
      continue;
    }
    ctx.emit('sound', SND.KILL);
    S.contactOnScreen[t] = 0;
    S.objActive[k] = 0;
    S.contactKilledBy[t] = w + 1;
    // the shot becomes the ship's explosion
    S.objX[o] = S.objX[k]; S.objY[o] = S.objY[k]; S.objVx[o] = S.objVx[k]; S.objVy[o] = S.objVy[k];
    S.objVz[o] = 0x300; S.objZHit[o] = S.objZ[o]; S.objKind[o] = 4;
    ctx.emit('explosion', o, t);
  }
}

// @671c: an enemy shot reaching us rolls to hit; a hit queues a pending hit on the shooter's bearing
export function enemyHitTest(S, D, ctx) {
  const B = ctx.balance || ORIGINAL_BALANCE;
  const std = scaled(D.enemyHitChance, B.enemyHitChance, 0, 255);           // balance: standard per-roll chance
  for (const e of ctx.fixes.shotSlots ? [1, 0] : [1]) {   // original only tests slot 5 (B1)
    const o = ENEMY_SHOT + e;
    if (!S.objActive[o] || S.objKind[o] >= 4 || hiU(S.objZ[o]) >= 2) continue;
    const a = random(S);
    let hit;
    if (S.navState === 1) {
      const ev = evasionThreshold(B, std, D.evasion);                          // balance.evasion
      hit = ctx.fixes.evasionInverted ? a < ev : a >= ev;                   // B4: evading helps them
    } else hit = random(S) < std;
    if (!hit) continue;
    let k = 0;
    while (k < 4 && S.pendingHit[k]) k++;                // full: slot 4 is overwritten
    ctx.emit('sound', SND.HIT_US);
    S.pendingHit[k] = S.enemyBearing[e] + 1;
    ctx.emit('border', BORDER.FLASH);
    S.borderFlash = 5;
    S.objKind[o] = 4;
    S.objZ[o] = (S.objZ[o] & 0xff) | 0x500;
    S.objZHit[o] = S.objZ[o];
    S.objVx[o] = 0; S.objVy[o] = 0; S.objVz[o] = 0x300;
    ctx.emit('explosion', o, -1);
  }
}

// Drawing spill (original only; fixes.spriteSpill drops it): @631e/@63c5 draw sprites into the 38x64-byte
// off-screen buffer at 0x3b90 with only loose clipping (x > -16, y in -15..79). Rows outside 0..63 take their row
// offset from the words around the row table 0x455e: -0x26 for rows -15..-2 and 64..79, so a sprite more than 8 px
// left of the screen ORs those rows into the bytes just before the buffer — the y of the last rear-view star
// (0x3b66). That star decides how many RNG calls the next rear star step makes, so the engine reproduces exactly
// these writes (the rest of the drawing is the UI's job).
const BUFFER = 0x3b90, STARS_Y = 0x3b38, STARS_END = 0x3b68;
const gfxByte = (D, a) => a < 0x64a4 ? D.spritesFar[a - 0x4df8] : D.sprites[a - 0x64a4];
const gfxWord = (D, a) => a < 0x3204 ? D.spriteTables[(a - 0x3038) >> 1] : gfxByte(D, a) | gfxByte(D, a + 1) << 8;
const rowOffset = (D, row) => i16(D.rowOffsets[row + 0x0f]);   // rowOffsets starts at row -15

function spriteOf(S, D, o) {
  if (o >= ENEMY_SHOT) {
    const k2 = u16(S.objKind[o] * 2);
    if (k2 < 8) return gfxWord(D, gfxWord(D, 0x3038 + k2) + ((hi(S.objZ[o]) >> 3) << 1));
    const frame = ((k2 - 8) >>> 3) << 1;                      // explosion: not scaled by depth
    return frame < 0x10 ? gfxWord(D, 0x3040 + frame) : -1;
  }
  return gfxWord(D, gfxWord(D, 0x3050 + S.objKind[o]) + ((hi(S.objZ[o]) >> 3) << 1));
}

// OR value v into byte a of the star y array (only addresses 0x3b38..0x3b67 can be reached)
function orStarByte(S, a, v) {
  if (a < STARS_Y || a >= STARS_END || !v) return;
  const i = (a - STARS_Y) >> 1, sh = (a & 1) * 8;
  S.starsY[i] = i16(S.starsY[i] | v << sh);
}

function spriteSpill(S, D) {
  if (D.frameOverride || S.viewBlank) return;
  for (let o = 7; o >= 0; o--) {
    if (!S.objActive[o] || S.objView[o] !== S.view) continue;
    if ((o < ENEMY_SHOT || S.objKind[o] < 4) && hi(S.objZ[o]) < 0) continue;
    const spr = spriteOf(S, D, o);
    if (spr < 0) continue;
    const w = gfxWord(D, spr), h = gfxWord(D, spr + 2);
    const x = i16(i16((hi(S.objX[o]) << 1) | ((S.objX[o] & 0xff) >> 7)) - gfxWord(D, spr + 4));
    if (x <= -16 || i16((x >> 2) + w) >= 0x26) continue;
    const y = i16(hi(S.objY[o]) - gfxWord(D, spr + 6));
    if (y <= -16 || i16(y + h) >= 0x50) continue;
    const s = (x & 3) * 2, rows = Math.max(1, (h << 24) >> 24);
    for (let r = 0; r < rows; r++) {
      const base = BUFFER + rowOffset(D, y + r) + (x >> 2);
      if (base >= STARS_END) continue;
      const src = spr + 12 + r * w;
      let carry = 0;
      for (let j = 0; j < w; j++) {
        const b = gfxByte(D, src + j);
        orStarByte(S, base + j, (b >> s) | carry);
        carry = s ? (b << (8 - s)) & 0xff : 0;
      }
      if (s) orStarByte(S, base + w, carry);
    }
  }
}

export function combatViewUpdate(S, D, ctx) {
  if (S.displayTicks < 3) return;
  S.displayTicks = 0;
  S.starStep = u16(S.starStep + 1);
  if (S.borderFlash && --S.borderFlash === 0) ctx.emit('border', BORDER.NORMAL);
  const view = D.frameOverride ? 2 : S.wantedView;
  if (view !== S.view) { S.view = view; ctx.emit('view', view); S.viewBlank = 4; }
  if (S.viewBlank) S.viewBlank--;
  const period = D.starPeriod[S.speed];
  if (period && S.starStep >= period) { S.starStep = 0; if (S.view === 0) starsForward(S, D); else starsRear(S, D); }
  launchOurShots(S, D, ctx);
  spawnShip(S, D, ctx);
  shipAI(S, D, ctx);
  steerShots(S);
  moveObjects(S, D);
  ourHitTest(S, D, ctx);
  enemyHitTest(S, D, ctx);
  if (!ctx.fixes.spriteSpill) spriteSpill(S, D);
  ctx.emit('frame');
}

// @64aa: 1 Hz countdown of ship AI timers and our shot reload timers
export function tickShipTimers(S) {
  for (let i = 5; i >= 0; i--) if (S.shipTimer[i]) S.shipTimer[i]--;
}

export const CHECKS = [
  { fn: 'f_16f3', fields: WEAPONS_FIELDS, data: WEAPONS_DATA, run: weaponsStep },
  { fn: 'f_6e26', fields: COMBAT_FIELDS, data: COMBAT_DATA, run: combatViewUpdate },
  { fn: 'f_64aa', fields: [['shipTimer', 0x4d0c, 'u16', 6]], run: tickShipTimers },
];
