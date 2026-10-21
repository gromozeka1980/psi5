// Damage and repair — our ship taking hits (original @4922 damageTick, slot 0 of the 1 Hz round-robin) and the Repair
// department's step (@4479 repairTick, slot 5) with its queue helpers (@42e4 dequeue, @43a2 enqueue, @4872 grabDroid,
// @48e0 releaseDroid).
//
// Damage tick, once per second:
//   shield lamps -> pending hits (shield battery may absorb, then a roll picks the system or a special: cargo loss,
//   boarders killing an officer) -> damage points into the system's repair slot (damaged, disabled at the 2nd hit,
//   destroyed above 99) -> cargo leaks -> life-support death timers -> intruder alarm -> mission-over checks ->
//   officer death and what it does to his department.
// Repair tick, once per second:
//   queued jobs in priority order get droids (requested count, or whatever is left), the team's work (256 = one damage
//   point) is added, finished systems come back, auto-queue when the officer is alive, repair overload, droid counts.
//
// Repair slots: every damaged system owns one slot (slotId[s] = s, slotSys[s] = system; -1 = free). A slot is "queued"
// (a job) while slotWanted[s] != 0; queue[] holds the queued slots in priority order.
// Droids: 7, of which droid 1/4/6 are systems 16/17/18 and can be knocked out or destroyed. Droids are anonymous:
// a job holds a count, grab/release take the first suitable droid by index.
//
// Verified with tools/equiv.mjs ONLY=f_4922,f_4479,f_42e4,f_43a2 (0 differing calls). Scenarios: SEL demo full mission
// (`w:300 k:Enter w:60 k:^D w:7000 w:200000`), manual crew on course 4 with long waits and random keys, and Repair-menu
// use (Assign / Rank / Cancel / Fix with the officer dead). See docs/modern/changes/damage.md for the fix flags.
import { i16, u16 } from './fields.js';
import { random } from './rng.js';
import { ORIGINAL_BALANCE, scaled } from './presets.js';
import { post, remove } from './messages.js';
import { printed } from './display.js';
const cov = k => { const c = globalThis.__dmgcov; if (c) c[k] = (c[k] || 0) + 1; };   // TEMPCOV

const WEAPONS = 0, SCANNING = 1, NAVIGATION = 2, ENGINEERING = 3, REPAIR = 4;
const OK = 2, DAMAGED = 1;
const SYSTEMS = 26, DROIDS = 7, SHIELD_SECTORS = 4, PENDING_HITS = 5;
const DESTROYED_ABOVE = 99;
const WORK_PER_POINT = 256;
const DROID_OF_SYSTEM = { 16: 1, 17: 4, 18: 6 };           // Robodroid 2/5/7
const PORT_RETROS = 19, STAR_RETROS = 20, CARGO_ENVIR = 21, CARGO_STAB = 22, E_LIFE_SUP = 23, N_LIFE_SUP = 24;
const CRAVENLATOR = 25, INF_SCANNER = 10;
const ALARM_ACTIVE_SYSTEMS = 10;                          // systems 0..9 powered (or moving) = ship is "active"
// hit roll results above the system range
const HIT_CARGO = 26, HIT_BOARDERS = 27, HIT_ASSASSIN = 28;
const LIFE_SUP_WARN1 = 59, LIFE_SUP_WARN2 = 30;
const OVERTIME_MINUTES = 60;
const ALARM_TUNE = 0xc;
// texts the original prints (constant strings of the base data, 0x1b5c..0x1bdc); printing advances the combat view
const bytes = s => Array.from(s, c => c.charCodeAt(0));
const TXT_ALARM = bytes('INTRUDER ALERT'), TXT_ALARM_BLANK = bytes(' '.repeat(14)), TXT_LOOTING = bytes('(Cargo looting)');
const TXT_ABORTED = bytes('Mission Aborted'), TXT_RETURN = bytes('Return to'), TXT_STARBASE = bytes('Starbase 27');
const TXT_NO_CARGO = bytes('no cargo left'), TXT_TOO_LATE = bytes('took too long');
// message window 0 (@32bf: draw script 0x18c2 = colour, position -> one display poll per command; then " STOP")
const TXT_STOP_WINDOW = bytes('  ').concat(bytes(' STOP'));
// a "headline" (@51d8) is printed only while no headline is on screen (textShown)
function headline(S, D, ctx, txt) {
  if (S.textShown) return;
  setFrameOverride(S, D, 1);
  printed(S, D, ctx, txt);
}
// combat.js reads the flag from D (its DATA); keep that copy in step until it reads S.textShown
function setFrameOverride(S, D, v) { S.textShown = v; if ('frameOverride' in D) D.frameOverride = v; }
// message ids
const MSG_CARGO_HIT = 0x210;
const MSG_QUEUE_EMPTY = 0x802, MSG_AUTO_QUEUED = 0x804;
const MSG_STAR_RETROS = 0x406, MSG_PORT_RETROS = 0x404, MSG_RETROS = 0x402;
const MSG_E_LIFE_WARN = 0x604, MSG_E_LIFE_CRIT = 0x602, MSG_N_LIFE_WARN = 0x40c, MSG_N_LIFE_CRIT = 0x40e;
const NAV_DEATH_MSGS = [0x61c, 0x61e, 0x620, 0x40c, 0x40e], ENG_DEATH_MSGS = [0x616, 0x618, 0x61a, 0x604, 0x602];
// replacement officer values after a death
const GUNNER_MISS = 0x20, GUNNER_RELOAD = 7, SCAN_T1 = 0x14, SCAN_T2 = 0x21;
const NAV_A = 0x1e, NAV_B = -0x1e, ENG_DELAY = 0x14, ENG_DELAYS = 13;   // 13 words: overwrites delayOverload[0] too

// --- repair state, shared by all checks below
const REPAIR_FIELDS = [
  ['slotId', 0x1030, 'i16', SYSTEMS],
  ['slotSys', 0x10cc, 'i16', SYSTEMS],
  ['slotWanted', 0x1098, 'i16', SYSTEMS],    // droids requested; != 0 <=> queued
  ['slotDroids', 0x1064, 'i16', SYSTEMS],
  ['slotWorking', 0x1134, 'i16', SYSTEMS],
  ['slotDamage', 0x1168, 'i16', SYSTEMS],
  ['queue', 0xffc, 'i16', SYSTEMS],
  ['queueLen', 0x11d0, 'i16'],
  ['droidRecharge', 0xfd2, 'i16', DROIDS],
  ['droidBusy', 0xfee, 'i16', DROIDS],
];
const REPAIR_DATA = [
  ['rechargeTime', 0xd89c, 'i16', 2],        // normal, repair overload
  ['demo', 0x3508, 'u16'],
];

export const DAMAGE_FIELDS = [
  ...REPAIR_FIELDS,
  ['damageTick', 0x1b5a, 'u16'],
  ['shieldShown', 0x3ce, 'i16', SHIELD_SECTORS],   // shield lamp picture last drawn (-1 = never)
  ['pendingHit', 0x1288, 'u16', PENDING_HITS],      // 0 none, else shooter bearing + 1
  ['shieldBatt', 0xf8c, 'i16'],
  ['sysState', 0xebc, 'i16', SYSTEMS],
  ['destroyed', 0xef0, 'i16', SYSTEMS],
  ['openSlots', 0x11d2, 'i16'],
  ['nextSlot', 0x12fc, 'i16'],
  ['disabledCount', 0x132a, 'i16'],
  ['destroyedCount', 0x132c, 'i16'],
  ['droidDestroyed', 0xfc4, 'i16', DROIDS],
  ['droidOut', 0xfe0, 'i16', DROIDS],
  ['cargo', 0x3b4, 'i16'],
  ['engLifeTimer', 0x12de, 'u16'],
  ['navLifeTimer', 0x12e0, 'u16'],
  ['alarmCount', 0x12fe, 'u16'],
  ['alarmOn', 0x1300, 'u16'],
  ['spawnMask', 0x12e2, 'u16'],               // scanning spawn request (forced pirate at alarm start)
  ['spawnCursor', 0x12e4, 'u16'],
  ['spawnTries', 0x12e6, 'u16'],
  ['launchBlocked', 0x50a, 'u16'],
  ['missionPhase', 0x3b2, 'u16'],
  ['textShown', 0x3b04, 'u16'],               // a headline (@51d8) is on screen; freezes the combat view
  ['msgWindow', 0x3b8, 'u16'],                // message window shown (@32bf)
  // touched only when an officer dies
  ['gunMiss', 0x8b30, 'u16', 4], ['gunReload', 0x8b40, 'u16', 4],
  ['orderCount', 0x506, 'i16'], ['orderQueue', 0x440, 'u16', 8], ['orderSerial', 0x3e0, 'i16', 8],
  ['targetOrdered', 0x912, 'u16', SYSTEMS],
  ['scanT1', 0x9e90, 'u16'], ['scanT2', 0x9e94, 'u16'],
  ['examLen', 0x9d4, 'i16'], ['examList', 0x97a, 'u16', 8], ['contactListed', 0x8de, 'u16', SYSTEMS],
  ['navA', 0xb1da, 'u16'], ['navB', 0xb1d8, 'u16'], ['manoeuvre', 0xb66, 'u16'],
  ['engDelay', 0xc554, 'u16', ENG_DELAYS],
  ['slotWork', 0x119c, 'i16', SYSTEMS],       // written only by the repairWorkCarry fix
];
export const DAMAGE_DATA = [
  ...REPAIR_DATA,
  ['powered', 0xf58, 'i16', SYSTEMS],
  ['devState', 0xd1e, 'i16', SHIELD_SECTORS],      // switch state of the hit sector's shield (picks the damage table)
  ['hitSector', 0x1292, 'i16', 5],                 // bearing + 1 -> shield sector
  ['hitRoll', 0x129c, 'i16', 29],                  // roll thresholds, entries 3..28
  ['battDrain', 0x6231, 'i16', 4],
  ['penetrateOk', 0x624e, 'i16'], ['penetrateDamaged', 0x6250, 'i16'],
  ['cargoLoss', 0x6239, 'i16', 4],
  ['killAfterPos', 0x6241, 'i16'],
  ['alarmTime', 0x6229, 'u16'],
  ['timeLimit', 0x622d, 'u16'],
  ['position', 0xb7a, 'i16'], ['speed', 0xb68, 'u16'], ['minutes', 0x3b6, 'u16'],
  ['boarderKill', 0x12d6, 'i16', SHIELD_SECTORS],  // sector -> department the boarders kill
  ['damageOn', 0xd8b4, 'u16', SYSTEMS], ['damageOff', 0xd8e8, 'u16', SYSTEMS],
  ['msgDamaged', 0x11de, 'u16', SYSTEMS], ['msgDisabled', 0x1212, 'u16', SYSTEMS], ['msgDestroyed', 0x1246, 'u16', SYSTEMS],
  ['engLifeTime', 0xc54c, 'u16'], ['navLifeTime', 0xb1d6, 'u16'],
  ['contactClass', 0x59e, 'i16', SYSTEMS],
  ['alarmOnMsgs', 0x12e8, 'u16', 5], ['alarmOffMsgs', 0x12f2, 'u16', 5],
  ['deathMsg', 0x1bde, 'u16', 9],
  ['orderTarget', 0x410, 'i16', 8],
];

export const REPAIR_TICK_FIELDS = [
  ...REPAIR_FIELDS,
  ['repStep', 0x1b56, 'u16'],
  ['slotWork', 0x119c, 'i16', SYSTEMS],
  ['slotBlink', 0x1100, 'i16', SYSTEMS],
  ['sysState', 0xebc, 'i16', SYSTEMS],
  ['openSlots', 0x11d2, 'i16'],
  ['droidOut', 0xfe0, 'i16', DROIDS],
  ['autoDelay', 0x11d4, 'u16'],
  ['overloadCount', 0x1b58, 'u16'],
  ['idleDroids', 0x11d6, 'i16'], ['rechargingDroids', 0x11d8, 'i16'], ['busyDroids', 0x11da, 'i16'], ['outDroids', 0x11dc, 'i16'],
];
export const REPAIR_TICK_DATA = [
  ...REPAIR_DATA,
  ['droidDestroyed', 0xfc4, 'i16', DROIDS],
  ['repairWork', 0xd8a4, 'i16', 8],                 // work per second for a team of n droids
  ['autoDelayTime', 0xd8a0, 'u16'],
  ['autoDroids', 0xd8a2, 'i16'],
  ['overloadSlots', 0xd898, 'i16'],
  ['repairOverloadTime', 0xd89a, 'u16'],
  ['msgDamaged', 0x11de, 'u16', SYSTEMS], ['msgDisabled', 0x1212, 'u16', SYSTEMS],
];

// ---------------------------------------------------------------- droids and the repair queue

// @4872: first droid that is not destroyed, recharging, out or busy becomes busy
function grabDroid(S, D) {
  for (let i = 0; i < DROIDS; i++)
    if (!D.droidDestroyed[i] && !S.droidRecharge[i] && !S.droidOut[i] && !S.droidBusy[i]) { S.droidBusy[i] = 1; return true; }
  return false;
}
// @48e0: first busy droid (any job) stops and recharges; the overload flag picks the recharge time
function releaseDroid(S, D) {
  const i = S.droidBusy.findIndex(b => b);
  if (i < 0) return;
  S.droidBusy[i] = 0;
  S.droidRecharge[i] = D.rechargeTime[S.deptStress[REPAIR]];
}
// @42e4: take the job of slot `id` off the queue and release its droids; the slot (and its damage) stays open.
// completed: the job finished (repair tick); fixes.cancelNoCompleteMsg posts "All assigned tasks completed" only then
export function dequeue(S, D, ctx, id, completed = false) {
  for (let i = 0; i < S.queueLen; i++) {
    const s = S.queue[i];
    if (S.slotId[s] !== id) continue;
    S.slotWanted[s] = 0;
    for (let j = 0; j < S.slotDroids[s]; j++) releaseDroid(S, D);
    S.slotDroids[s] = 0;
    S.slotWorking[s] = 0;
    S.queueLen--;
    for (let j = i; j < S.queueLen; j++) S.queue[j] = S.queue[j + 1];
    cov('dequeue'); if (!S.queueLen && !D.demo) {   // original: even after a Cancel
      remove(S, MSG_AUTO_QUEUED, ctx);
      if (completed || !ctx?.fixes?.cancelNoCompleteMsg) post(S, MSG_QUEUE_EMPTY, ctx);
    }
    return;
  }
}
// @43a2: queue slot `id` at position pos asking for n droids; an already queued job is moved and re-sized
export function enqueue(S, D, ctx, id, n, pos) {
  const s = S.slotId.indexOf(id);
  if (s < 0) return;
  if (pos > S.queueLen) pos = S.queueLen;
  let j;
  if (S.slotWanted[s]) {
    cov('requeue'); j = S.queue.indexOf(s);
    if (pos === S.queueLen) pos--;
  } else j = S.queueLen++;
  S.slotWanted[s] = n;
  for (; j < pos; j++) S.queue[j] = S.queue[j + 1];
  for (; j > pos; j--) S.queue[j] = S.queue[j - 1];
  S.queue[pos] = s;
  remove(S, MSG_QUEUE_EMPTY, ctx);
}

// ---------------------------------------------------------------- repair tick @4479

// give job s its droids; `avail` counts every droid not out of action (busy and recharging ones included)
function staffJob(S, D, s, avail, ctx) {
  if (S.slotDroids[s] > S.slotWanted[s]) cov('over'); while (S.slotDroids[s] > S.slotWanted[s]) { releaseDroid(S, D); S.slotDroids[s]--; }
  if (avail >= S.slotWanted[s]) {
    avail -= S.slotWanted[s];
    while (S.slotDroids[s] < S.slotWanted[s] && grabDroid(S, D)) S.slotDroids[s]++;
  } else if (avail > S.slotDroids[s]) {
    avail = 0;
    // original takes every ready droid, even more than requested; fixes.repairGrabCap stops at the request
    cov('grabAll'); while ((!ctx.fixes?.repairGrabCap || S.slotDroids[s] < S.slotWanted[s]) && grabDroid(S, D)) S.slotDroids[s]++;
  } else if (S.slotDroids[s]) {
    cov('shed'); const extra = S.slotDroids[s] - avail;
    S.slotDroids[s] = avail;
    for (let k = 0; k < extra; k++) releaseDroid(S, D);
    avail = 0;
  }
  return avail;
}
function teamWork(D, n, ctx) {
  if (!ctx.fixes?.repairRatePerTeam) return D.repairWork[n];   // original: more droids can be slower
  let w = 0;
  for (let k = 1; k <= n; k++) w = Math.max(w, D.repairWork[k]);
  return w;
}
// system back to OK: clear its messages, a repaired robodroid returns (after recharging)
function systemRepaired(S, D, ctx, sys) {
  S.openSlots--;
  remove(S, S.sysState[sys] === DAMAGED ? D.msgDamaged[sys] : D.msgDisabled[sys], ctx);
  S.sysState[sys] = OK;
  const droid = DROID_OF_SYSTEM[sys];
  if (droid) { S.droidOut[droid] = 0; S.droidRecharge[droid] = D.rechargeTime[S.deptStress[REPAIR]]; }
  else if (sys === PORT_RETROS || sys === STAR_RETROS) {
    remove(S, sys === STAR_RETROS ? MSG_STAR_RETROS : MSG_PORT_RETROS, ctx);
    if (S.sysState[PORT_RETROS] === OK && S.sysState[STAR_RETROS] === OK) remove(S, MSG_RETROS, ctx);
  } else if (sys === E_LIFE_SUP) remove(S, MSG_E_LIFE_WARN, ctx);
  else if (sys === N_LIFE_SUP) remove(S, MSG_N_LIFE_WARN, ctx);
}

export function repairTick(S, D, ctx) {
  S.repStep = u16(S.repStep + 1);
  let avail = S.droidOut.filter(o => !o).length;
  for (let i = 0; i < S.queueLen; i++) {
    const s = S.queue[i];
    avail = staffJob(S, D, s, avail, ctx);
    if (!S.slotDroids[s]) { S.slotWorking[s] = 0; continue; }
    S.slotWorking[s] = 1;
    S.slotWork[s] += teamWork(D, S.slotDroids[s], ctx);
    if (S.slotWork[s] < WORK_PER_POINT) continue;
    S.slotWork[s] -= WORK_PER_POINT;
    if (--S.slotDamage[s] > 0) continue;
    cov('repaired' + S.slotSys[s]); if (i + 1 < S.queueLen) cov('skipNext'); systemRepaired(S, D, ctx, S.slotSys[s]);
    S.slotSys[s] = -1;
    dequeue(S, D, ctx, s, true);
    S.slotId[s] = -1;
    if (ctx.fixes?.repairSkipAfterFinish) i--;            // original: the next job is skipped this second
  }
  if (S.deptAlive[REPAIR]) autoQueueAndOverload(S, D, ctx);
  const blink = S.repStep & 1;
  for (let k = 0; k < SYSTEMS; k++) if (!blink || S.slotWanted[k]) S.slotBlink[k] = blink;
  countDroids(S, D);
}
// the officer queues the lowest open slot autoDelay seconds after the queue ran empty; too many open slots = overload
function autoQueueAndOverload(S, D, ctx) {
  if (S.autoDelay) S.autoDelay--;
  if (S.queueLen) S.autoDelay = D.autoDelayTime;
  else if (!S.autoDelay && S.openSlots) {
    let k = 0;
    while (k < SYSTEMS && S.slotSys[k] < 0) k++;
    cov('autoQueue'); enqueue(S, D, ctx, k, D.autoDroids, 1);
    if (!D.demo) { remove(S, MSG_QUEUE_EMPTY, ctx); post(S, MSG_AUTO_QUEUED, ctx); }
  }
  if (S.overloadCount) S.overloadCount--; else S.deptStress[REPAIR] = 0;
  if (S.openSlots >= D.overloadSlots) { cov('overload'); S.deptStress[REPAIR] = 1; S.overloadCount = D.repairOverloadTime; }
}
function countDroids(S, D) {
  S.idleDroids = S.rechargingDroids = S.busyDroids = S.outDroids = 0;
  for (let k = 0; k < DROIDS; k++) {
    if (D.droidDestroyed[k]) continue;
    if (S.droidRecharge[k]) S.droidRecharge[k]--;
    if (S.droidOut[k]) S.outDroids++;
    else if (S.droidRecharge[k]) S.rechargingDroids++;
    else if (S.droidBusy[k]) S.busyDroids++;
    else S.idleDroids++;
  }
}

// ---------------------------------------------------------------- damage tick @4922

// the struck sector's shield, if powered and working, spends battery and may stop the hit; true = stopped
function shieldStops(S, D, ctx, sector) {
  if (!D.powered[sector] || !S.sysState[sector]) return false;
  cov('shieldUp'); const charge = S.shieldBatt, drain = D.battDrain[random(S) & 3];
  S.shieldBatt = charge - drain;
  if (charge <= drain) { cov('battEmpty'); S.shieldBatt = 0; return false; }      // empty battery: always through
  const through = scaled(S.sysState[sector] === OK ? D.penetrateOk : D.penetrateDamaged, (ctx.balance || ORIGINAL_BALANCE).penetrate, 0, 256);
  return random(S) >= through;
}
// what the hit strikes: the sector itself (r < 43), a system, or a special (26 cargo, 27 boarders, 28 assassin)
function rollTarget(S, D, sector) {
  const r = random(S);
  let t = 3;
  while (r >= D.hitRoll[t]) t++;
  if (t === 12) return CRAVENLATOR;                 // the battery chargers 11/12 can never be hit
  if (t === 11) return INF_SCANNER;
  if (t === 3) return sector;
  return t;
}
// a system hit: open/extend its repair slot, damaged -> disabled -> destroyed, robodroids drop out
function damageSystem(S, D, ctx, sector, d) {
  if (d >= SYSTEMS) return;     // failed special (27/28) aliases destroyed[27/28] = drawOk[1/2] = 100: no effect
  if (S.destroyed[d]) return;
  let slot;
  if (S.sysState[d] === OK) {
    while (S.slotId[S.nextSlot] >= 0) S.nextSlot = (S.nextSlot + 1) % SYSTEMS;
    slot = S.nextSlot;
    S.slotId[slot] = slot; S.slotSys[slot] = d;
    S.slotWanted[slot] = S.slotDroids[slot] = S.slotDamage[slot] = 0;
    if (ctx.fixes?.repairWorkCarry) S.slotWork[slot] = 0;     // original keeps the previous job's fraction
    S.openSlots++;
  } else slot = S.slotSys.indexOf(d);
  // B10: the table is chosen by the hit SECTOR's shield switch, whatever system is damaged
  const table = D.devState[sector] && !S.deptStress[REPAIR] ? D.damageOn : D.damageOff;
  S.slotDamage[slot] += table[d];
  if (S.slotDamage[slot] > DESTROYED_ABOVE) {
    S.destroyed[d] = 1; S.sysState[d] = 0; S.destroyedCount++; cov('destroyed');
    if (ctx.fixes?.destroyedFreesSlot) S.openSlots--;            // original keeps counting the freed slot as open
    dequeue(S, D, ctx, slot);
    S.slotSys[slot] = -1; S.slotId[slot] = -1; S.slotDamage[slot] = 0;
    remove(S, D.msgDisabled[d], ctx); post(S, D.msgDestroyed[d], ctx);
  } else if (S.sysState[d] === OK) {
    cov('damaged'); S.sysState[d] = DAMAGED; post(S, D.msgDamaged[d], ctx);
  } else {
    if (S.sysState[d] || !ctx.fixes?.disabledRecount) S.disabledCount++;   // original re-counts disabled systems
    cov(S.sysState[d] ? 'disabled' : 'redisabled'); S.sysState[d] = 0; remove(S, D.msgDamaged[d], ctx); post(S, D.msgDisabled[d], ctx);
  }
  const droid = DROID_OF_SYSTEM[d];
  if (!droid) return;
  cov('droidHit'); if (S.droidBusy[droid]) { cov('busyDroidHit');                 // a working droid was hit: the lowest-priority staffed job loses one
    for (let c = S.queueLen - 1; c >= 0; c--) { const q = S.queue[c]; if (S.slotDroids[q]) { S.slotDroids[q]--; break; } }
  }
  if (S.destroyed[d]) S.droidDestroyed[droid] = 1;
  else { S.droidOut[droid] = 1; S.droidBusy[droid] = 0; }
}
// returns the officer death the hit causes (department/action) or -1
function applyHits(S, D, ctx) { if (globalThis.process?.env?.DBG && S.pendingHit.some(x => x)) console.log('HITS', S.pendingHit.join(','), 'batt', S.shieldBatt, 'pos', D.position); // TEMPCOV
  let action = -1;
  for (let i = 0; i < PENDING_HITS; i++) {
    if (!S.pendingHit[i]) continue;
    const sector = D.hitSector[S.pendingHit[i]];
    S.pendingHit[i] = 0;
    if (shieldStops(S, D, ctx, sector)) { cov('blocked'); continue; } cov('hit'); // TEMPCOV
    const t = rollTarget(S, D, sector);
    // B5: the original reuses the loop counter for the target, so the scan resumes after it (t >= 4 ends it)
    if (!ctx.fixes?.hitLoopIndex) i = t;
    cov('t' + t); // TEMPCOV
    if (t === HIT_CARGO) { loseCargo(S, D.cargoLoss[random(S) & 3]); post(S, MSG_CARGO_HIT, ctx); continue; }
    const crewKillable = D.position > D.killAfterPos;
    if (t === HIT_BOARDERS && crewKillable) { cov('boarders'); action = D.boarderKill[sector]; continue; }
    if (t === HIT_ASSASSIN && crewKillable && random(S) < 0x80) { cov('assassin'); action = sector; continue; }
    damageSystem(S, D, ctx, sector, t);
  }
  return action;
}
function loseCargo(S, n) { S.cargo = Math.max(0, S.cargo - n); }

// a disabled life support kills its department after a timeout (counting every 2 s); returns true when it does
function lifeSupport(S, D, ctx, sys, timer, timeout, warn, crit) {
  if (S.sysState[sys]) { S[timer] = D[timeout]; return false; }
  cov('lifeTimer'+sys); if (S[timer] === LIFE_SUP_WARN2) { remove(S, warn, ctx); post(S, crit, ctx); }
  else if (S[timer] === LIFE_SUP_WARN1) post(S, warn, ctx);
  if (!S[timer]) { cov('lifeDeath'); return true; }
  if (S.damageTick & 1) S[timer]--;
  return false;
}
function alarmMessage(S, D, ctx, removeMsgs, postMsgs) {
  for (const m of removeMsgs) remove(S, m, ctx);
  let r = random(S) & 7; if (r >= 5) r -= 5;
  post(S, postMsgs[r], ctx);
}
// intruder alarm: a ship standing still with systems 0..9 unpowered gets looted
function intruderAlarm(S, D, ctx) {
  let pirate = D.contactClass.some(c => c > 0 && c < 8);
  let active = !!D.speed;
  for (let i = 0; i < ALARM_ACTIVE_SYSTEMS; i++) if (S.sysState[i] && D.powered[i]) active = true;
  if (!active) S.alarmCount = D.alarmTime;
  if (S.alarmCount) {
    S.alarmCount--;
    if (!S.alarmOn) {
      S.alarmOn = 1; cov('alarmStart');
      ctx.emit('sound', ALARM_TUNE);
      if (!pirate) {                                   // force a pirate spawn and block our launches
        cov('alarmSpawn'); S.spawnCursor = 0xffff; S.launchBlocked = 1; pirate = true; S.spawnTries = 1; S.spawnMask = 1;
      }
      alarmMessage(S, D, ctx, D.alarmOffMsgs, D.alarmOnMsgs);
      headline(S, D, ctx, TXT_ALARM);
      printed(S, D, ctx, TXT_LOOTING);
    } else {
      printed(S, D, ctx, S.damageTick & 1 ? TXT_ALARM_BLANK : TXT_ALARM);   // blinking
      if (!pirate) S.alarmCount = 0;
      // original @4922 `demo ||`: in demo mode the looting runs every second; fixes.demoLootRate: every 2 s as in play
      if ((D.demo && !ctx.fixes?.demoLootRate) || (S.damageTick & 1)) loseCargo(S, 1);
    }
  }
  if (active && !S.alarmCount && S.alarmOn) {
    cov('alarmEnd'); S.alarmOn = 0; S.alarmCount = 0; S.launchBlocked = 0;
    setFrameOverride(S, D, 0);
    alarmMessage(S, D, ctx, D.alarmOnMsgs, D.alarmOffMsgs);
  }
}
// @516d
function missionOver(S, D, ctx, reason) {
  cov('over_' + reason.length);
  setFrameOverride(S, D, 0);
  headline(S, D, ctx, TXT_ABORTED);
  ctx.emit('head', -1);
  printed(S, D, ctx, TXT_RETURN);
  printed(S, D, ctx, TXT_STARBASE);
  if (S.msgWindow !== 0) { S.msgWindow = 0; printed(S, D, ctx, TXT_STOP_WINDOW); }
  if (!D.demo) ctx.emit('sound', ALARM_TUNE);
  S.missionPhase = 1;
  printed(S, D, ctx, reason);
}

// @15b3 dropOrder(serial): remove the queued order with that serial (and fix up the target's "ordered" flag)
function dropOrder(S, D, ctx, match) {
  for (let i = 0; i < S.orderCount; i++) {
    const s = S.orderQueue[i];
    if (!match(s, i)) continue;
    S.orderSerial[s] = -1;
    const t = D.orderTarget[s];
    S.orderCount--;
    for (let j = i; j < S.orderCount; j++) S.orderQueue[j] = S.orderQueue[j + 1];
    S.targetOrdered[t] = 0;
    for (let k = 0; k < S.orderCount; k++)
      if (D.orderTarget[S.orderQueue[k]] === t) { S.targetOrdered[ctx.fixes?.dropOrderFlag ? t : S.orderQueue[k]] = 1; break; }   // (sic: slot, not target)
    return true;
  }
  return false;
}
// @23df: take target n off the examination list
function unlistTarget(S, n) {
  if (!S.contactListed[n]) return false;
  const j = S.examList.indexOf(n);
  S.contactListed[n] = 0;
  S.examLen--;
  for (let k = j; k < S.examLen; k++) S.examList[k] = S.examList[k + 1];
  return true;
}

// officer killed (boarders, assassin, life support): replacement values / emptied work lists
function officerDies(S, D, ctx, action) {
  let dept = action >= 5 ? action - 5 : action;
  if (ctx.fixes?.officerDeathOnce && !S.deptAlive[dept]) return;     // original: can die again
  cov('death' + dept + (S.deptAlive[dept] ? '' : 'again')); post(S, D.deathMsg[action], ctx);
  S.deptStress[dept] = 0; S.deptAlive[dept] = 0;
  ctx.emit('officerDied', dept);
  switch (dept) {
    case WEAPONS:
      S.gunMiss.fill(GUNNER_MISS); S.gunReload.fill(GUNNER_RELOAD);
      while (S.orderCount) {
        // B9: the original drops "the order with serial 0" until the queue is empty: freezes if none has serial 0
        const dropped = ctx.fixes?.ordersClearFreeze ? dropOrder(S, D, ctx, (s, i) => i === 0) : dropOrder(S, D, ctx, s => S.orderSerial[s] === 0);
        cov('orderDrop'); if (!dropped) { ctx.emit('freeze', 'ordersClear'); break; }
      }
      break;
    case SCANNING:
      S.scanT1 = SCAN_T1; S.scanT2 = SCAN_T2;
      while (S.examLen) if (!unlistTarget(S, S.examList[0])) { ctx.emit('freeze', 'examClear'); break; }
      break;
    case NAVIGATION:
      S.navA = NAV_A; S.navB = u16(NAV_B); S.manoeuvre = 0;
      for (const m of NAV_DEATH_MSGS) remove(S, m, ctx);
      break;
    case ENGINEERING:
      // original writes 13 words into the 12-entry normal table, overwriting the first stressed delay
      S.engDelay.fill(ENG_DELAY, 0, ctx.fixes?.engineerDeathDelays ? ENG_DELAYS - 1 : ENG_DELAYS);
      for (const m of ENG_DEATH_MSGS) remove(S, m, ctx);
      break;
    case REPAIR:
      while (S.queueLen) dequeue(S, D, ctx, S.slotId[S.queue[0]]);
      break;
  }
}

export function damageTick(S, D, ctx) {
  S.damageTick = u16(S.damageTick + 1);
  for (let i = 0; i < SHIELD_SECTORS; i++) {
    const v = S.sysState[i] && D.powered[i] ? S.sysState[i] : 0;
    if (S.shieldShown[i] !== v) { S.shieldShown[i] = v; ctx.emit('shieldLamp', i, v); }
  }
  let action = applyHits(S, D, ctx);
  // cargo leaks from a destroyed cargo system, or every 4 s from a disabled one
  const t = S.damageTick & 3;
  if (S.destroyed[CARGO_ENVIR] || S.destroyed[CARGO_STAB] || (t === 1 && !S.sysState[CARGO_ENVIR]) ||
      (t === 3 && !S.sysState[CARGO_STAB])) loseCargo(S, 1);
  if (S.deptAlive[ENGINEERING] &&
      lifeSupport(S, D, ctx, E_LIFE_SUP, 'engLifeTimer', 'engLifeTime', MSG_E_LIFE_WARN, MSG_E_LIFE_CRIT)) action = 8;
  if (S.deptAlive[NAVIGATION] &&
      lifeSupport(S, D, ctx, N_LIFE_SUP, 'navLifeTimer', 'navLifeTime', MSG_N_LIFE_WARN, MSG_N_LIFE_CRIT)) action = 7;
  intruderAlarm(S, D, ctx);
  if (!S.cargo) missionOver(S, D, ctx, TXT_NO_CARGO);
  if (i16(D.minutes - D.timeLimit) > OVERTIME_MINUTES) missionOver(S, D, ctx, TXT_TOO_LATE);
  if (action >= 0) officerDies(S, D, ctx, action);
}

export const CHECKS = [
  { fn: 'f_4922', fields: DAMAGE_FIELDS, data: DAMAGE_DATA, run: damageTick },
  { fn: 'f_4479', fields: REPAIR_TICK_FIELDS, data: REPAIR_TICK_DATA, run: repairTick },
  { fn: 'f_42e4', fields: REPAIR_FIELDS, data: REPAIR_DATA, run: (S, D, ctx, id) => dequeue(S, D, ctx, id) },
  { fn: 'f_43a2', fields: REPAIR_FIELDS, data: REPAIR_DATA, run: (S, D, ctx, id, n, pos) => enqueue(S, D, ctx, i16(id), i16(n), pos) },
];
