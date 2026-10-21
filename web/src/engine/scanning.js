// Scanning department step (original @243d, slot 2 of the 1 Hz round-robin) and the examination-list helpers
// @232b setExamPriority / @23df removeFromList. Rules: docs/modern/model/scanning.md (R0..R10).
//
// CONTACT TABLE — 26 slots (letters A..Z), one word array per field, index t. A slot is free while contactClass[t] = 0.
//   contactClass            true class 1..10 (1..7 pirates, 8 Scout, 9 Prato, 10 Other); 0 = free slot
//   contactIdProgress       identification steps done          contactIdClass        identified class (0 = "Unknown")
//   contactHostile          0 friend / 1 foe
//   contactLockProgress     track-lock steps done               contactLocked         1 = locked (weapons may fire)
//   contactBearing          0..3 port/fore/starboard/aft = visual-screen ship slot it comes in on
//   contactOnScreen         1 = currently a ship on the visual screen (set by the combat view)
//   contactDamage           true damage bits (8 = none; bit 0 = can't follow above speed 6), changed by hits
//   contactDamageProgress   damage-analysis steps done          contactDamageKnown    known damage bits (0 = unknown)
//   contactWeakness         true weak weapon + 1 (1..4)
//   contactWeaknessProgress weakness-analysis steps done        contactWeaknessKnown  known weak weapon + 1 (0 = unknown)
//   contactSpawnPos         route position at detection (age = position − spawnPos, in route positions)
//   contactMarker           status-report icon: 1 on exam list, 2 weapon queued, 0 none (alternates every step)
//   contactListed           1 = on the examination list
//   contactWeaponQueued     1 = has a weapon-queue entry (weapons)
//   contactKilledBy         weapon + 1 that destroyed it, 0 = alive (combat view sets, weapons step clears)
// Lists: examList[0..examLen-1] targets in priority order; contactsDetected = live contacts (spawning stops at 16);
// screenQueue[bearing] = contact waiting for that visual-screen slot (−1 none, consumed by the combat view).
//
// Verified with tools/equiv.mjs (ONLY=f_243d,f_232b,f_23df), 0 differing calls: SEL demo full mission; manual crews
// with each scanning officer (Right/Down in SEL), Scanning menu Examine/Rank/Cancel, long courses (MISN3), random keys.
import { random } from './rng.js';
import { post, remove } from './messages.js';
import { i16, u16 } from './fields.js';

const SLOTS = 26, LIST_MAX = 8, MAX_DETECTED = 16, SPAWN_TRIES = 16, ROUTE_LEN = 50;
const SCANNING = 1, PIRATE_LAST = 7, NO_DAMAGE = 8, DAMAGE_SLOW = 1, SLOW_SPEED_LIMIT = 6, OK = 2, DAMAGED = 1;
const MSG_APPROACHING = 0x216, MSG_EXAMS_COMPLETE = 0x21a, MSG_EXAM_STARTED = 0x21c;  // dept 1 (scanning) messages
const BIT8_CLASS = 3;   // fixes.maskBit8: class for mask bit 0x100 (unknown intent; 0x9aa[8] if the table were unshifted)

const arr = (name, addr, type = 'u16') => [name, addr, type, SLOTS];
export const CONTACT_FIELDS = [
  arr('contactClass', 0x59e, 'i16'), arr('contactIdProgress', 0x5d2, 'i16'), arr('contactIdClass', 0x606, 'i16'),
  arr('contactHostile', 0x63a), arr('contactLockProgress', 0x66e, 'i16'), arr('contactLocked', 0x6a2),
  arr('contactBearing', 0x6d6), arr('contactOnScreen', 0x70a), arr('contactDamage', 0x73e),
  arr('contactDamageProgress', 0x772, 'i16'), arr('contactDamageKnown', 0x7a6), arr('contactWeakness', 0x7da),
  arr('contactWeaknessProgress', 0x80e, 'i16'), arr('contactWeaknessKnown', 0x842), arr('contactSpawnPos', 0x876),
  arr('contactMarker', 0x8aa), arr('contactListed', 0x8de), arr('contactWeaponQueued', 0x912),
  arr('contactKilledBy', 0x946),
];
const contact = n => CONTACT_FIELDS.find(f => f[0] === n);
const LIST_FIELDS = [contact('contactListed'), ['examList', 0x97a, 'i16', LIST_MAX], ['examLen', 0x9d4, 'i16']];

// state written by the scanning step (contactWeaponQueued / contactKilledBy are only read → DATA)
export const FIELDS = [
  ...CONTACT_FIELDS.filter(f => f[0] !== 'contactWeaponQueued' && f[0] !== 'contactKilledBy'),
  ['examList', 0x97a, 'i16', LIST_MAX], ['examLen', 0x9d4, 'i16'],
  ['contactsDetected', 0x9d2, 'i16'], ['spawnSlotSearch', 0x9da, 'i16'], ['screenQueue', 0x9ca, 'i16', 4],
  ['spawnLastPos', 0x9d6, 'u16'], ['spawnLastRoute', 0x9d8, 'u16'],
  ['spawnMask', 0x12e2, 'u16'], ['spawnCursor', 0x12e4, 'u16'], ['spawnTries', 0x12e6, 'u16'],
  ['scanStepCount', 0x17d8, 'u16'], ['examsCompleteGiven', 0x9dc, 'u16'], ['autoExamineTimer', 0x9de, 'u16'],
  ['scanAlertTimer', 0x17da, 'u16'], ['scannerLamp', 0x3c2, 'u16'], ['navThreatPending', 0xb80, 'u16'],
];
export const DATA = [
  contact('contactWeaponQueued'), contact('contactKilledBy'),
  ['spawnBit', 0x98a, 'u16', 16], ['spawnClass', 0x9aa, 'i16', 16],     // per spawn cursor (exe constants)
  ['routeMasks', 0x62b0, 'u16', 5 * ROUTE_LEN + 1],  // [route*50+pos]; pos 50 of course E reads the word after the file
  ['contactLifetime', 0x6252, 'i16', 11], ['hostilityDelay', 0x6292, 'u16'],                         // mission file
  ['scanLockThreshold', 0x9e90, 'i16', 2], ['scanIdThreshold', 0x9e94, 'i16', 2],                    // crew file
  ['scanDamageThreshold', 0x9e98, 'i16', 2], ['scanWeaknessThreshold', 0x9e9c, 'i16', 2],           // [normal, alert]
  ['scanAlertHold', 0x9ea0, 'u16'], ['scanAlertDetected', 0x9ea2, 'i16'], ['scanAlertListLen', 0x9ea4, 'i16'],
  ['scanAutoExamineDelay', 0x9ea6, 'u16', 2],
  ['route', 0xb60, 'u16'], ['position', 0xb7a, 'u16'], ['speed', 0xb68, 'i16'], ['demoMode', 0x3508, 'u16'],
  ['infScannerState', 0xed0, 'u16'], ['trackLockState', 0xed6, 'u16'],       // component state 2 ok/1 damaged/0 off
  ['infScannerPowered', 0xf6c, 'u16'], ['trackLockPowered', 0xf72, 'u16'],
];

// @232b: put contact t on the exam list at priority index pos (moves it if already listed; clamps to the list end)
export function setExamPriority(S, t, pos) {
  if (!S.contactClass[t]) return;
  let i;
  if (S.contactListed[t]) {
    i = S.examList.indexOf(t);
    if (pos >= S.examLen) pos = S.examLen - 1;
  } else {
    S.contactListed[t] = 1;
    if (pos > S.examLen) pos = S.examLen;
    i = S.examLen++;
  }
  for (; i < pos; i++) S.examList[i] = S.examList[i + 1];
  for (; i > pos; i--) S.examList[i] = S.examList[i - 1];
  S.examList[pos] = t;
}

// @23df: take contact t off the exam list
export function removeFromList(S, t) {
  if (!S.contactListed[t]) return;
  const i = S.examList.indexOf(t);
  S.contactListed[t] = 0;
  S.examLen--;
  S.examList.copyWithin(i, i + 1, S.examLen + 1);
}

const age = (S, t) => i16(S.position - S.contactSpawnPos[t]);

// R1: a new route position (or course) opens a 32-step window that tests each mask bit once from a random cursor
function spawnContacts(S, ctx) {
  const mask = S.routeMasks[S.route * ROUTE_LEN + S.position];
  const moved = S.position !== S.spawnLastPos || S.route !== S.spawnLastRoute;
  // fixes.startWindow: lastPos/lastRoute start at 0/0, so a mission starting at course A pos 0 (MISN3) opened no window
  const unseenStart = ctx.fixes.startWindow && S.position === 0 && S.spawnLastPos === 0 && S.route === 0
    && S.spawnLastRoute === 0 && S.spawnMask === 0 && S.spawnTries === 0 && mask !== 0;
  if (moved || unseenStart) {
    S.navThreatPending = 1;
    S.spawnLastRoute = S.route;
    S.spawnLastPos = S.position;
    S.spawnMask = mask;
    S.spawnCursor = random(S);
    S.spawnTries = SPAWN_TRIES;
  }
  if (S.contactsDetected >= MAX_DETECTED || !(S.scanStepCount & 1) || !S.spawnTries) return;
  const c = S.spawnCursor = (S.spawnCursor + 1) & 15;
  let bit = S.spawnBit[c], cls = S.spawnClass[c];
  if (ctx.fixes.maskBit8 && c === 15) { bit = 0x100; cls = BIT8_CLASS; }  // the table has no cursor for bit 0x100
  // fixes.maskBit15: bit 0x8000 has class 0 → counts a phantom contact that never leaves (detected stays too high)
  if ((bit & S.spawnMask) && !(ctx.fixes.maskBit15 && !cls)) spawn(S, cls, ctx);
  S.spawnTries--;
}

function spawn(S, cls, ctx) {
  if (S.contactsDetected === 0) { remove(S, MSG_EXAMS_COMPLETE, ctx); post(S, MSG_APPROACHING, ctx); }
  S.contactsDetected++;
  do S.spawnSlotSearch = S.spawnSlotSearch + 1 < SLOTS ? S.spawnSlotSearch + 1 : 0;
  while (S.contactClass[S.spawnSlotSearch]);
  const t = S.spawnSlotSearch;
  S.contactClass[t] = cls;
  S.contactBearing[t] = random(S) & 3;
  for (const f of ['contactLocked', 'contactListed', 'contactWeaknessKnown', 'contactIdClass', 'contactOnScreen',
    'contactDamageProgress', 'contactWeaknessProgress', 'contactIdProgress', 'contactLockProgress',
    'contactDamageKnown', 'contactHostile']) S[f][t] = 0;
  S.contactDamage[t] = NO_DAMAGE;
  S.contactSpawnPos[t] = S.position;
  S.contactWeakness[t] = (random(S) & 3) + 1;
}

// R2: offer each eligible contact to the visual-screen slot of its bearing (first come keeps the slot)
function queueForScreen(S) {
  for (let t = 0; t < SLOTS; t++) {
    const cls = S.contactClass[t];
    if (!cls || age(S, t) >= S.contactLifetime[cls]) continue;
    if ((S.contactDamage[t] & DAMAGE_SLOW) && S.speed > SLOW_SPEED_LIMIT) continue;   // can't keep up
    if (S.contactKilledBy[t] || S.contactOnScreen[t]) continue;
    if (S.screenQueue[S.contactBearing[t]] < 0) S.screenQueue[S.contactBearing[t]] = t;
  }
}

// one analysis step on t: returns true when it completes (progress counters are i16 in the original)
function progress(S, counter, t, threshold) {
  return (S[counter][t] = i16(S[counter][t] + 1)) >= threshold;
}

// R3: lock works on every listed contact at once; class, damage and weakness each on the first listed contact still
// lacking it. Returns the number of outstanding pieces of work.
function examine(S, ctx) {
  const lvl = S.deptStress[SCANNING];
  const lockReady = S.trackLockState === OK && (!ctx.fixes.trackLockPower || S.trackLockPowered);
  const analysing = S.deptAlive[SCANNING] && S.infScannerState && S.infScannerPowered;
  let open = 0, idDone = false, dmgDone = false, weakDone = false;
  for (let i = 0; i < S.examLen; i++) {
    const t = S.examList[i];
    if (!S.contactLocked[t]) {
      open++;
      if (lockReady && progress(S, 'contactLockProgress', t, S.scanLockThreshold[lvl])) S.contactLocked[t] = 1;
    }
    if (!analysing) { open++; continue; }
    if (!S.contactIdClass[t]) {
      open++;
      if (!idDone) {
        idDone = true;
        if (progress(S, 'contactIdProgress', t, S.scanIdThreshold[lvl])) S.contactIdClass[t] = S.contactClass[t];
      }
    }
    if (!S.contactDamageKnown[t]) {
      open++;
      if (!dmgDone) {
        dmgDone = true;
        if (progress(S, 'contactDamageProgress', t, S.scanDamageThreshold[lvl])) S.contactDamageKnown[t] = S.contactDamage[t];
      }
    } else S.contactDamageKnown[t] = S.contactDamage[t];   // live once known
    if (!S.contactWeaknessKnown[t]) {
      open++;
      if (!weakDone) {
        weakDone = true;
        if (progress(S, 'contactWeaknessProgress', t, S.scanWeaknessThreshold[lvl])) S.contactWeaknessKnown[t] = S.contactWeakness[t];
      }
    }
  }
  return open;
}

// R4: original: one-shot flag never re-armed and the list is empty at start, so it fires on the first step only.
// fixes.examsComplete: fires when a non-empty list has just been fully examined; re-arms while work is outstanding.
function examsComplete(S, open, ctx) {
  if (ctx.fixes.examsComplete) {
    if (open) { S.examsCompleteGiven = 0; return; }
    if (!S.examLen) return;
  }
  if (S.examsCompleteGiven || open || S.demoMode) return;
  remove(S, MSG_EXAM_STARTED, ctx); post(S, MSG_EXAMS_COMPLETE, ctx);
  S.examsCompleteGiven = u16(S.examsCompleteGiven + 1);
}

// R5: once the list has been empty for the auto-examine delay, list the lowest-letter contact not yet locked
function autoExamine(S, ctx) {
  if (S.autoExamineTimer) S.autoExamineTimer--;
  if (S.examLen) S.autoExamineTimer = S.scanAutoExamineDelay[S.deptStress[SCANNING]];
  if (S.autoExamineTimer || !S.contactsDetected) return;
  for (let t = 0; t < SLOTS; t++) {
    if (!S.contactClass[t] || S.contactLocked[t]) continue;
    setExamPriority(S, t, 1);
    if (!S.demoMode) { remove(S, MSG_APPROACHING, ctx); post(S, MSG_EXAM_STARTED, ctx); }
    return;
  }
}

// R7: alert (stress) holds for scanAlertHold steps after too many contacts or a long list
function updateAlert(S) {
  if (S.scanAlertTimer) S.scanAlertTimer--; else S.deptStress[SCANNING] = 0;
  if (S.contactsDetected >= S.scanAlertDetected || S.examLen >= S.scanAlertListLen) {
    S.deptStress[SCANNING] = 1;
    S.scanAlertTimer = S.scanAlertHold;
  }
}

export function scanningStep(S, ctx) {
  S.scanStepCount = u16(S.scanStepCount + 1);
  const odd = S.scanStepCount & 1;
  spawnContacts(S, ctx);
  queueForScreen(S);
  examsComplete(S, examine(S, ctx), ctx);
  const alive = S.deptAlive[SCANNING];
  if (alive) autoExamine(S, ctx);
  if (S.contactsDetected)                                                  // R6 status icons
    for (let t = 0; t < SLOTS; t++) if (S.contactClass[t])
      S.contactMarker[t] = odd ? (S.contactListed[t] ? 1 : 0) : (S.contactWeaponQueued[t] ? 2 : 0);
  if (alive) updateAlert(S);
  // R8 scanner lamp: steady when OK, blinking when damaged, off when disabled or unpowered
  const lamp = S.infScannerPowered && (S.infScannerState === OK || (S.infScannerState === DAMAGED && odd)) ? 1 : 0;
  if (S.scannerLamp !== lamp) { S.scannerLamp = lamp; ctx.emit('scannerLamp', lamp); }
  if (!S.contactsDetected) remove(S, MSG_APPROACHING, ctx);
  // R10: pirates turn foe once more than hostilityDelay positions old (loop also touches free slots, harmless)
  for (let t = 0; t < SLOTS; t++)
    if (S.contactClass[t] <= PIRATE_LAST && !S.contactHostile[t]
      && i16(S.contactSpawnPos[t] + S.hostilityDelay) < i16(S.position)) S.contactHostile[t] = 1;
}

// the steps read their DATA from the same state object; never overwrite state another module owns under that name
const withData = (S, D, spec) => { for (const [n] of spec) if (!(n in S)) S[n] = D[n]; return S; };

export const CHECKS = [
  { fn: 'f_243d', fields: FIELDS, data: DATA, run: (S, D, ctx) => scanningStep(withData(S, D, DATA), ctx) },
  { fn: 'f_232b', fields: LIST_FIELDS, data: [contact('contactClass')],
    run: (S, D, ctx, t, pos) => setExamPriority(withData(S, D, [contact('contactClass')]), i16(t), i16(pos)) },
  { fn: 'f_23df', fields: LIST_FIELDS, run: (S, D, ctx, t) => removeFromList(S, i16(t)) },
];
