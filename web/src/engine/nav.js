// Navigation department step (original @2cf2 navStep, once per second in round-robin slot 3) and the engine power
// split (@322f). Rules: docs/modern/model/navigation.md R1..R7, R10. No RNG here.
// Engine version is a plain function: the original's arrival sequence (@3318, a 2.5 s frozen text screen) is printed
// text + events, and the pause only advances the display timer; the check compares state after the whole call.
// Text printed inside the step (message window, arrival) runs combat-view ticks through display.js printed().
// Verified with tools/equiv.mjs (ONLY=f_2cf2,f_322f), 0 differing calls: SEL demo full mission (arrival), manual crew
// with Navigator orders (course changes port/starboard, speeds, evasive, stop; engines + retros energised in
// Engineer), each of the 4 courses through SEL's course screen (k:1..k:4) incl. a late mission (cargo loss, 0x218).
// Fix flags: docs/modern/changes/nav.md.
import { post, remove } from './messages.js';
import { printed } from './display.js';
import { ORIGINAL_BALANCE } from './presets.js';

// system indices (engineering system table: sysState 0 broken / 1 damaged / 2 ok, powered, devState)
const ENGINE = [8, 9], INFO_SCANNER = 10, PORT_RETRO = 19, STAR_RETRO = 20, ENGINEER_LIFE = 23, NAV_LIFE = 24;
const OK = 2;
const NAV = 2;                           // department index (deptAlive / deptStress)
const LAST_POS = 50;                     // arrival at Kozzar-7
const COURSE_LEN = 50;                   // words per course in the mask table
const STEPS_PER_MINUTE = 60;
const REAR_VIEW_HOLD = 30;               // steps before the view returns to front
const LATE_MSG_EVERY = 8;                // late minutes between "cargo is rotting" messages
const NAV_STATE = { standard: 0, evasive: 1, stopped: 2, changing: 3 };
const SHAKE = { none: 0, port: 1, starboard: 2 };
const ETA_STATE = { unknown: 0, onTime: 1, late: 2 };
const MSG = {
  evasiveNoPower: 0x402, starRetroBroken: 0x404, portRetroBroken: 0x406, highRisk: 0x408, evasive: 0x40a,
  cargoRotting: 0x218,
};
const SND = { speedUp: 0x12, speedDown: 0x14, arrival: 0xe };
const ARRIVAL_PAUSE = 0x12c;             // ISR ticks (2.5 s) the arrival screen waits without simulating

// texts the original prints; printing advances the combat view (display.js)
const bytes = s => Array.from(s, c => c.charCodeAt(0));
const WINDOW_TEXT = [' STOP', 'Spd=1', 'Spd=2', 'Spd=3', 'Spd=4', 'Spd=5', 'Spd=6', 'Spd=7', ' FULL', 'ORBIT'].map(bytes);
const WINDOW_ORBIT = 9;
const WINDOW_FRAME = bytes('  ');        // draw script 0x18c2: colour + position command, one display poll each
const TXT_PREPARE = bytes('Prepare for'), TXT_ARRIVAL = bytes('Arrival'), TXT_WELCOME = bytes('Welcome to');

const ENGINE_FIELDS = [
  ['work', 0x18ae, 'i16'],               // scratch: power sum -> demand -> effective speed
  ['enginePower', 0xb84, 'i16', 2],      // speed units delivered per engine this step
];
const ENGINE_DATA = [
  ['sysState', 0xebc, 'i16', 26], ['powered', 0xf58, 'i16', 26], ['devState', 0xd1e, 'i16', 26],
  ['engineCap', 0xb70, 'i16', 3],        // capacity by sysState: 0 / 3 / 4
];
const FIELDS = [...ENGINE_FIELDS,
  ['navStepCnt', 0x18b0, 'u16'], ['speed', 0xb68, 'i16'], ['lastSpeedSnd', 0x18ac, 'i16'],
  ['secCnt', 0x18b2, 'i16'], ['minutes', 0x3b6, 'i16'], ['cargo', 0x3b4, 'i16'], ['lateMsgCnt', 0x18b4, 'i16'],
  ['navState', 0xb64, 'i16'], ['progressTime', 0x18be, 'i16'], ['shake', 0xb6e, 'i16'], ['lateral', 0x18ba, 'i16'],
  ['course', 0xb60, 'i16'], ['changePending', 0xb7c, 'i16'], ['evasivePending', 0xb7e, 'i16'],
  ['subFrac', 0xb76, 'i16'], ['subPos', 0xb78, 'i16'], ['pos', 0xb7a, 'i16'], ['missionPhase', 0x3b2, 'i16'],
  ['scanTimer', 0x18b8, 'i16'], ['riskValid', 0xb82, 'i16'], ['scanCourse', 0x18b6, 'i16'], ['scanLen', 0x18bc, 'i16'],
  ['navThreatPending', 0xb80, 'i16'], ['risk', 0xb04, 'i16', 5], ['dist', 0xb0e, 'i16', 5], ['eta', 0xb18, 'i16', 5],
  ['reta', 0xafa, 'i16', 5], ['rearTimer', 0x18c0, 'i16'], ['wantedView', 0x3b00, 'i16'], ['etaState', 0xb6c, 'i16'],
  ['navStressHold', 0x18aa, 'i16'], ['starX', 0x4606, 'i16'], ['starY', 0x4608, 'i16'],   // star centre (starfield offset per shake)
  // printing state: what is printed (and so how many combat-view ticks run) depends on these
  ['msgWindow', 0x3b8, 'u16'],          // message window shown (@32bf), 0xffff none
  ['textShown', 0x3b04, 'u16'],         // a headline (@51d8) is on screen (freezes the combat view)
  ['displayTicks', 0x351a, 'u16'],      // ISR ticks since the last combat-view update (advanced by the arrival pause)
];
const DATA = [...ENGINE_DATA,
  ['reqCourse', 0xb62, 'i16'], ['maneuver', 0xb66, 'i16'], ['reqSpeed', 0xb6a, 'i16'], ['view', 0x3afe, 'i16'],
  // mission file
  ['timeLimit', 0x622d, 'i16'], ['speedOffset', 0x6288, 'i16', 5],
  ['courseMasks', 0x62b0, 'u16', 5 * COURSE_LEN + 1],   // [course][pos]; +1: the word after course E (quirk 6)
  // constant tables
  ['progressTable', 0xb46, 'i16', 13], ['etaFactor', 0xb2c, 'i16', 13], ['courseLateral', 0xb22, 'i16', 5],
  ['shakeStarX', 0x1948, 'i16', 9], ['shakeStarY', 0x195a, 'i16', 9],
  ['destinationName', 0x6245, 'u8', 9],  // mission file, NUL-terminated ("Kozzar-7")
  // navigator crew file
  ['portThreshold', 0xb1d8, 'i16'], ['starThreshold', 0xb1da, 'i16'], ['navStressTime', 0xb1dc, 'i16'],
  ['evasiveSpeed', 0xb1de, 'i16', 9], ['evasiveSpeedStressed', 0xb1f0, 'i16', 9], ['scanAhead', 0xb202, 'i16'],
  ['scanPeriod', 0xb204, 'i16', 2], ['shakePattern', 0xb20a, 'i16', 32], ['highRiskThreshold', 0xb24a, 'i16'],
];

// @32bf message window n (speed "STOP"/"Spd=n"/"FULL", "ORBIT"), drawn only when it changes
function messageWindow(S, D, ctx, n) {
  if (S.msgWindow === n) return;
  S.msgWindow = n;
  ctx.emit('messageWindow', n);
  printed(S, D, ctx, WINDOW_FRAME.concat(WINDOW_TEXT[n]));
}
// @51d8 headline: printed only while no headline is on screen
function headline(S, D, ctx, txt) {
  if (S.textShown) return;
  S.textShown = 1;
  if ('frameOverride' in D) D.frameOverride = 1;   // combat.js still reads this flag from its DATA (same as damage.js)
  printed(S, D, ctx, txt);
}
// @3318 arrival screen ("Prepare for / Arrival", 2.5 s pause, "ORBIT", "Welcome to / <destination>")
function arrival(S, D, ctx) {
  ctx.emit('statusPicture', 0);
  headline(S, D, ctx, TXT_PREPARE);
  printed(S, D, ctx, TXT_ARRIVAL);
  ctx.emit('head', -1);
  ctx.emit('pause', ARRIVAL_PAUSE);
  S.displayTicks = (S.displayTicks + ARRIVAL_PAUSE) & 0xffff;   // the timer keeps counting during the pause
  messageWindow(S, D, ctx, WINDOW_ORBIT);
  ctx.emit('arrival');
  printed(S, D, ctx, TXT_WELCOME);
  const end = D.destinationName.indexOf(0);
  printed(S, D, ctx, D.destinationName.slice(0, end < 0 ? undefined : end));
  ctx.emit('tune', SND.arrival);
}

const popcount = w => { let n = 0; for (; w; w >>>= 1) n += w & 1; return n; };

// @322f: engine n takes as much of the remaining demand as its state allows (only while switched on and powered)
function enginePower(S, D, n) {
  const sys = ENGINE[n];
  if (D.devState[sys] && D.powered[sys]) {
    S.enginePower[n] = Math.min(S.work, D.engineCap[D.sysState[sys]]);
    S.work -= S.enginePower[n];
  } else S.enginePower[n] = 0;
}

// speed follows last step's delivered power (up at once, down 1 per s); book one unit towards reqSpeed for next step
function updateSpeed(S, D, ctx) {
  let delivered = 0;
  for (const n of [0, 1]) if (D.powered[ENGINE[n]]) delivered += S.enginePower[n];
  S.speed = S.speed > delivered ? S.speed - 1 : delivered;
  const change = S.speed - S.lastSpeedSnd;
  if (change > 2 || change < -2) { S.lastSpeedSnd = S.speed; ctx.emit('sound', change > 2 ? SND.speedUp : SND.speedDown); }
  S.work = S.speed + Math.sign(D.reqSpeed - S.speed);
  const order = D.sysState[ENGINE[0]] === OK ? [0, 1] : [1, 0];
  for (const n of order) enginePower(S, D, n);
}

// game clock; every minute past the limit rots 1 % cargo
function advanceClock(S, D, ctx) {
  if (++S.secCnt < STEPS_PER_MINUTE) return;
  S.secCnt = 0;
  if (++S.minutes <= D.timeLimit) return;
  S.cargo = Math.max(0, S.cargo - 1);
  if (++S.lateMsgCnt >= LATE_MSG_EVERY) { post(S, MSG.cargoRotting, ctx); S.lateMsgCnt = 0; }
}

// retro thrusters push the lateral counter towards the side of the requested course; damaged retro: every 2nd step
function changeCourse(S, D, ctx) {
  const toPort = D.courseLateral[D.reqCourse] < D.courseLateral[S.course];
  const retro = D.sysState[toPort ? STAR_RETRO : PORT_RETRO];
  if (retro) {
    if (retro === OK || (S.navStepCnt & 1)) S.lateral += toPort ? -1 : 1;
    if (toPort ? S.lateral <= D.portThreshold : S.lateral >= D.starThreshold) {
      S.course = D.reqCourse;
      if (ctx.fixes.courseChangeReset) S.lateral = 0;
    } else { S.navState = NAV_STATE.changing; S.shake = toPort ? SHAKE.starboard : SHAKE.port; }
  } else if (S.changePending) post(S, toPort ? MSG.starRetroBroken : MSG.portRetroBroken, ctx);
  S.changePending = 0;
}

// evasive needs both retros ok; replaces the effective speed by the navigator's evasive table
function evade(S, D, ctx) {
  if (D.sysState[PORT_RETRO] === OK && D.sysState[STAR_RETRO] === OK) {
    if (S.evasivePending) post(S, MSG.evasive, ctx);
    S.navState = NAV_STATE.evasive;
    S.shake = D.shakePattern[S.navStepCnt & 31];
    const k = (ctx.balance || ORIGINAL_BALANCE).evasiveSpeed;              // balance: 'original' tables or x speed
    if (!ctx.fixes.evasiveKeepsSpeed)
      S.work = k === 'original' ? (S.deptStress[NAV] ? D.evasiveSpeedStressed : D.evasiveSpeed)[S.speed]
        : Math.max(S.speed ? 1 : 0, Math.round(S.speed * k));
  } else if (S.evasivePending) post(S, MSG.evasiveNoPower, ctx);
  S.evasivePending = 0;
}

function maneuver(S, D, ctx) {
  S.work = S.speed;
  if (S.speed === 0) {
    S.navState = NAV_STATE.stopped; S.progressTime = S.minutes;
    if (ctx.fixes.stopClearsShake) S.shake = SHAKE.none;
    return;
  }
  S.shake = SHAKE.none; S.navState = NAV_STATE.standard;
  if (D.reqCourse !== S.course) changeCourse(S, D, ctx);
  else if (D.maneuver === 1) evade(S, D, ctx);
}

// progress along the course: subFrac/subPos are a 16-bit fraction of a position
function travel(S, D, ctx) {
  if (S.navState === NAV_STATE.changing || S.work === 0) return;
  S.subFrac += D.progressTable[D.speedOffset[S.course] + S.work];
  if (S.subFrac < 0x100) return;
  S.subPos += S.subFrac >> 8; S.subFrac &= 0xff;
  if (S.subPos < 0x100) return;
  S.subPos -= 0x100;
  S.pos++; S.progressTime = S.minutes;
  if (S.pos >= LAST_POS) { S.missionPhase = 1; arrival(S, D, ctx); }
}

// one course per scan (round robin): count contacts due on it from here to scanAhead positions ahead
function riskScan(S, D, ctx) {
  if (++S.scanTimer < D.scanPeriod[S.deptStress[NAV]]) return;
  S.scanTimer = 0;
  if (!(S.deptAlive[NAV] && D.powered[INFO_SCANNER] && D.devState[INFO_SCANNER] && D.sysState[INFO_SCANNER])) {
    S.risk.fill(0); S.riskValid = 0;
    return;
  }
  S.riskValid = 1;
  if (++S.scanCourse >= 5) S.scanCourse = 0;
  S.scanLen = Math.min(D.scanAhead, LAST_POS - S.pos);
  // original sums positions pos..pos+scanLen inclusive, so at the end it reads one word past the course (quirk 6)
  const last = ctx.fixes.riskScanInBounds ? Math.min(S.pos + S.scanLen, LAST_POS - 1) : S.pos + S.scanLen;
  let sum = 0;
  for (let p = S.pos; p <= last; p++) sum += popcount(D.courseMasks[S.scanCourse * COURSE_LEN + p]);
  if (S.scanCourse === S.course && S.navThreatPending && S.subPos > 0x80) {
    S.navThreatPending = 0;
    if (sum > D.highRiskThreshold) post(S, MSG.highRisk, ctx); else remove(S, MSG.highRisk, ctx);
  }
  S.risk[S.scanCourse] = sum;
}

// DIS (speed independent), ETA (minutes to go at the effective speed) and RETA (arrival minus limit) per course
function estimates(S, D) {
  const left = LAST_POS - S.pos;
  for (let j = 0; j < 5; j++) {
    const d1 = D.speedOffset[j] + 1;
    S.dist[j] = (Math.trunc(D.etaFactor[d1] * left / d1) + 3) >> 2;
    if (S.work) {
      const d = D.speedOffset[j] + S.work;
      S.eta[j] = (Math.trunc(left * D.etaFactor[d] / d) + 15) >> 4;
      S.reta[j] = S.progressTime + S.eta[j] - D.timeLimit;
    } else S.eta[j] = S.reta[j] = 0;
  }
}

// navigator stress: original tests the engineer's life support (sys 23) instead of the navigator's (sys 24)
function updateStress(S, D, ctx) {
  if (!S.deptAlive[NAV]) return;
  if (S.navStressHold) S.navStressHold--; else S.deptStress[NAV] = 0;
  const lifeSupport = D.sysState[ctx.fixes.navStressOwnLifeSupport ? NAV_LIFE : ENGINEER_LIFE];
  if (!lifeSupport || S.etaState === ETA_STATE.late) { S.deptStress[NAV] = 1; S.navStressHold = D.navStressTime; }
}

// @2cf2
function navStep(S, D, ctx) {
  S.navStepCnt = (S.navStepCnt + 1) & 0xffff;
  updateSpeed(S, D, ctx);
  advanceClock(S, D, ctx);
  maneuver(S, D, ctx);
  travel(S, D, ctx);
  riskScan(S, D, ctx);
  estimates(S, D);
  // a contact switched the view to the rear: back to front after 30 s
  if (D.view) { if (S.rearTimer) S.rearTimer--; else S.wantedView = 0; }
  else S.rearTimer = REAR_VIEW_HOLD;
  S.etaState = S.work === 0 ? ETA_STATE.unknown : S.reta[S.course] > 0 ? ETA_STATE.late : ETA_STATE.onTime;
  updateStress(S, D, ctx);
  S.starX = D.shakeStarX[S.shake]; S.starY = D.shakeStarY[S.shake];
  if (!S.missionPhase) messageWindow(S, D, ctx, S.speed);
  ctx.emit('statusPicture', S.shake);
}

export const CHECKS = [
  { fn: 'f_2cf2', fields: FIELDS, data: DATA, run: navStep },
  { fn: 'f_322f', fields: ENGINE_FIELDS, data: ENGINE_DATA, run: (S, D, ctx, n) => enginePower(S, D, n) },
];
