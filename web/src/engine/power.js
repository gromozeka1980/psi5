// Power — the Engineering department's 1 Hz step (original @37be engineerStep, slot 4 of the round-robin).
//
// Systems (index i, shared by every department; sysState[i] 2 ok / 1 damaged / 0 disabled):
//    0 Fore Shield   1 Port Shield   2 Star Shield   3 Aft Shield        -> power class 0 Shields
//    4 Missile Sys   5 Blaster Sys   6 Cannon Sys    7 Thermo Sys        -> class 1 Weapons
//    8 Engine One    9 Engine Two                                        -> class 2 Engines
//   10 Inf Scanner                                                       -> class 3 Scanners
//   11 Emerg Batt   (charger; its on/off state is the battery switch)    -> class 4 Charge Emerg. Batt
//   12 Shield Batt  (charger; never switched)                            -> class 5 Charge Shield Batt
//   13 Track Lock  14 Reactor One  15 Reactor Two  16/17/18 Robodroid 2/5/7  19 Port Retros  20 Star Retros
//   21 Cargo Envir  22 Cargo Stab  23 E Life Sup (engineer's)  24 N Life Sup  25 Cravenlator
// Only 0..12 are power components. Per component c ("device record"):
//   devState[c]  0 off, 1 powering up (draws nothing yet), 2 on, 3 powering down (still on and drawing)
//   devTimer[c]  0 = no request pending, else age of the request in steps (c 0..10).
//                devTimer[11] is the Emerg Batt "force" flag: never aged, jumps the request queue.
//   powered[c]   1 if the component got power this step — the only thing other departments look at.
// Per class d: devDraw[d] demand (powered or not), devPower[d] 0 none / 1 partial / 2 full.
//
// Verified with tools/equiv.mjs ONLY=f_37be, 0 differing calls in: SEL demo full mission (overload, damaged engines,
// shields, weapons, reactor); crew + Navigator speed 8 + Engineer Enable/Cancel (incl. cancelling pending requests both
// ways), Rank, emergency battery on until empty and off again, everything enabled (overload, delayOverload table),
// later speed 3 evasive; crew + Engineer menu + random keys (seeds 1-8, engineer killed by E Life Sup in seed 6);
// crew + random keys over all departments (seeds 11-14, shield battery low/blinking). Fix flags: changes/power.md.
import { i16 } from './fields.js';

const ENGINEER = 3;                         // department index (deptAlive / deptStress)
const ENGINES = 2, EMERG_CHARGER = 4;
const EMERG_BATT = 11, SHIELD_BATT = 12;    // component indices of the two chargers
const REACTOR_ONE = 14, REACTOR_TWO = 15, E_LIFE_SUP = 23;
const OK = 2, DAMAGED = 1;
const ON = 2, POWERING_UP = 1;
const QUEUED_COMPONENTS = 11;               // requests of components 0..10 are aged and queued
const CLASS_FIRST = [0, 4, 8, 10, 11, 12], CLASS_LAST = [3, 7, 9, 10, 11, 12];
const IDLE_ENGINE_COST = 40;                // an engine that is on but given no speed units
const BATTERY_ON_LEVELS = 2;                // a charged, switched-on emergency battery adds 2 supply levels (600)
const BATT_MAX = 100, BATT_LOW = 20;        // battery lights blink at 1..20
const EMERG_CHARGE_PERIOD = 5, SHIELD_CHARGE_PERIOD = 2;   // +1 every period+1 steps while the charger is powered
const UNITS_PER_BAR = 300, DRAWN_BARS = 8;

export const FIELDS = [
  ['engStep', 0x1a28, 'i16'],               // step counter, parity blinks the battery lights
  ['devState', 0xd1e, 'i16', 13],
  ['devTimer', 0xd38, 'i16', 12],
  ['changeCnt', 0xf90, 'i16'],              // steps since the last completed state change
  ['changeDelay', 0xf92, 'i16'],            // steps that must pass before the next one
  ['powered', 0xf58, 'i16', 13],
  ['devDraw', 0xcee, 'i16', 6],
  ['devPower', 0xcfa, 'i16', 6],
  ['shieldBatt', 0xf8c, 'i16'],
  ['emergBatt', 0xf8e, 'i16'],
  ['emergChargeCnt', 0xf94, 'i16'],
  ['shieldChargeCnt', 0xf96, 'i16'],
  ['gaugeBars', 0x3bc, 'i16'],              // last drawn dashboard values (-1 = never drawn)
  ['gaugeLevel', 0x3be, 'i16'],
  ['shieldLight', 0x3c0, 'i16'],
  ['emergLight', 0x3c4, 'i16'],
];
// overload countdown = deptStress[ENGINEER] (common field)

export const DATA = [
  ['sysState', 0xebc, 'i16', 26],
  ['priority', 0xce2, 'i16', 6],            // power classes, highest priority first (player's Rank command)
  ['engineUse', 0xb84, 'i16', 2],           // speed units nav gives Engine One/Two
  ['drawOk', 0xf24, 'i16', 13],             // component cost when undamaged
  ['drawDamaged', 0xf3e, 'i16', 13],
  ['supply', 0xf98, 'i16', 7],              // budget per supply level (300 per level)
  // engineer crew file
  ['overloadTime', 0xc54e, 'i16'],
  ['maxActiveTimers', 0xc550, 'i16'],
  ['overdrawTolerance', 0xc552, 'i16'],
  ['delay', 0xc554, 'i16', 12],             // steps after a change of component c before the next one
  ['delayOverload', 0xc56c, 'i16', 12],
];

// 1. age the pending on/off requests; 2. complete the oldest one if the previous change's delay has passed
function processRequests(S, D) {
  let oldest = -1, maxAge = 0, active = 0;
  for (let c = 0; c < QUEUED_COMPONENTS; c++) {
    if (!S.devTimer[c]) continue;
    S.devTimer[c] = i16(S.devTimer[c] + 1);
    active++;
    if (S.devTimer[c] > maxAge) { maxAge = S.devTimer[c]; oldest = c; }
  }
  S.changeCnt = i16(S.changeCnt + 1);
  if (S.changeCnt > S.changeDelay) {
    S.changeCnt = 0; S.changeDelay = 0;
    if (S.devTimer[EMERG_BATT]) oldest = EMERG_BATT;
    if (oldest >= 0) {
      S.devTimer[oldest] = 0;
      S.devState[oldest] = S.devState[oldest] === POWERING_UP ? ON : 0;
      S.changeDelay = (S.deptStress[ENGINEER] ? D.delayOverload : D.delay)[oldest];
    }
  }
  return active;
}

function supplyLevel(S, D) {
  let level = D.sysState[REACTOR_ONE] + D.sysState[REACTOR_TWO];
  if (emergBattSupplying(S)) level += BATTERY_ON_LEVELS;
  return level;
}
const emergBattSupplying = S => S.devState[EMERG_BATT] > POWERING_UP && S.emergBatt !== 0;

function componentCost(S, D, d, c) {
  const sys = D.sysState[c];
  // the emergency charger draws whatever its on/off state (that state is the battery switch)
  let cost = (S.devState[c] > POWERING_UP && sys) || d === EMERG_CHARGER ? (sys === OK ? D.drawOk[c] : D.drawDamaged[c]) : 0;
  if (d === ENGINES) {
    const use = D.engineUse[c - CLASS_FIRST[ENGINES]];
    if (use) cost = i16(cost * use);
    else if (cost) cost = IDLE_ENGINE_COST;
  }
  return cost;
}

// 4. hand the budget down the priority list; returns { budget left, total demand }
function distribute(S, D, budget, fixes) {
  let total = 0;
  for (const d of D.priority) {
    let sum = 0, anyPowered = false, anyUnpowered = false;
    S.devPower[d] = 0;
    for (let c = CLASS_FIRST[d]; c <= CLASS_LAST[d]; c++) {
      const cost = componentCost(S, D, d, c);
      if (fixes.powerSkipUnaffordable) {
        // fixed: a component that does not fit is skipped and its demand is not charged to the budget
        S.powered[c] = cost && budget - cost >= 0 ? 1 : 0;
        if (S.powered[c]) { budget -= cost; anyPowered = true; } else if (cost) anyUnpowered = true;
      } else {
        // original: the demand is subtracted even when it does not fit, so the budget stays negative for
        // everything below; "partial" only if an earlier component of the class got power
        const left = budget - cost;
        budget = i16(left);
        if (left >= 0 && cost) { S.powered[c] = 1; S.devPower[d] = 2; }
        else { S.powered[c] = 0; if (cost && S.devPower[d] === 2) S.devPower[d] = 1; }
      }
      sum = i16(sum + cost);
    }
    if (fixes.powerSkipUnaffordable) S.devPower[d] = anyPowered ? (anyUnpowered ? 1 : 2) : 0;
    S.devDraw[d] = sum;
    total = i16(total + sum);
  }
  return { budget, total };
}

// 5. chargers (only while powered) and emergency battery drain (only while its 600 is actually needed)
function updateBatteries(S, D, budget) {
  if (S.powered[EMERG_BATT]) {
    const c = S.emergChargeCnt; S.emergChargeCnt = i16(c - 1);
    if (c <= 0) { S.emergChargeCnt = EMERG_CHARGE_PERIOD; if (S.emergBatt < BATT_MAX) S.emergBatt++; }
  }
  if (emergBattSupplying(S) && budget < D.supply[BATTERY_ON_LEVELS]) S.emergBatt--;
  if (S.powered[SHIELD_BATT]) {
    const c = S.shieldChargeCnt; S.shieldChargeCnt = i16(c - 1);
    if (c <= 0) { S.shieldChargeCnt = SHIELD_CHARGE_PERIOD; if (S.shieldBatt < BATT_MAX) S.shieldBatt++; }
  }
}

// 6. overload (engineer alive only): only effect is the slow delay table
function updateOverload(S, D, active, total, level, fixes) {
  if (!S.deptAlive[ENGINEER]) return;
  const lifeSup = D.sysState[E_LIFE_SUP];
  const lifeSupTrouble = fixes.lifeSupportOverload ? lifeSup !== OK : lifeSup === DAMAGED;
  // active <= 11 while every crew limit is >= 30: this condition never fires (kept as in the original)
  if (lifeSupTrouble || active > D.maxActiveTimers || i16(total - D.supply[level]) > D.overdrawTolerance)
    S.deptStress[ENGINEER] = D.overloadTime;
  else if (S.deptStress[ENGINEER]) S.deptStress[ENGINEER]--;
}

// 7. dashboard: redrawn only on change
function updateGauges(S, level, total, ctx) {
  const blink = S.engStep & 1;
  if (level !== S.gaugeLevel) { S.gaugeLevel = level; ctx.emit('gauge', 'powerLevel', level); }
  const bars = Math.min(DRAWN_BARS, Math.trunc(total / UNITS_PER_BAR));
  if (bars !== S.gaugeBars) { S.gaugeBars = bars; ctx.emit('gauge', 'powerDrawn', bars); }
  // emergency light: 0 dark, 1 steady, 2 lit phase of the blink (switched on, charge 1..20) or empty
  const e = !S.devState[EMERG_BATT] ? 0 : S.emergBatt > BATT_LOW ? 1 : (!S.emergBatt || blink) ? 2 : 0;
  if (e !== S.emergLight) { S.emergLight = e; ctx.emit('gauge', 'emergLight', e); }
  const s = S.shieldBatt > BATT_LOW || (S.shieldBatt && blink) ? 1 : 0;
  if (s !== S.shieldLight) { S.shieldLight = s; ctx.emit('gauge', 'shieldLight', s); }
}

export function engineerStep(S, D, ctx) {
  const fixes = ctx.fixes || {};
  S.engStep = i16(S.engStep + 1);
  const active = processRequests(S, D);
  const level = supplyLevel(S, D);
  const { budget, total } = distribute(S, D, D.supply[level], fixes);
  updateBatteries(S, D, budget);
  updateOverload(S, D, active, total, level, fixes);
  updateGauges(S, level, total, ctx);
}

export const CHECKS = [{ fn: 'f_37be', fields: FIELDS, data: DATA, run: engineerStep }];
