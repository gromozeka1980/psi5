// Game: the standalone game core. Builds the mission state like the original's load (@6b7c) + init (@5247), runs the
// original main loop one 120 Hz timer tick at a time (ISR @6ca9 counters, the 6 Hz department dispatch @0d97, the
// combat-view updates where the original polls @6e26, the delays @0748/@076d, the "Processing command" flash @06f4)
// and takes the player's actions as semantic commands. API, loop and command list: docs/modern/GAME.md.
// Proven equal to the 1:1 port tick by tick (whole engine state) by tools/equiv_game.mjs.
//
// State storage: one 64 KB little-endian buffer laid out like the original data segment, seeded from the program's
// data image (web/data/psi5_ds.bin: constant tables, sprites, strings). Every field of every engine module (FIELDS and
// DATA specs) is a typed-array view on it under its readable name, so names that alias the same original variable
// (pos/position, targetOrdered/contactWeaponQueued, textShown/frameOverride, ...) share storage and 16-bit fields wrap
// like the original. Scalars are accessor properties. The engine steps get this one object as both S and D.
import { CHECKS, COMMON_FIELDS } from './index.js';
import { random } from './rng.js';
import { i16, u16 } from './fields.js';
import { queueOrder, dropOrder } from './combat.js';
import { ORIGINAL_BALANCE, checkBalance } from './presets.js';

const RUN = Object.fromEntries(CHECKS.map(c => [c.fn, c.run]));
const NAV = 2;
const AT_WILL = 10;
const STEP_TICKS = 20, SIM_SLOTS = 6, MAX_BACKLOG = 10;
const FLASH_HALF = 25;                 // @06f4: text 25 ticks, blank 25 ticks, twice
const DEPARTURE_PICTURES = 5, DEPARTURE_TICKS = 80, ARRIVAL_PAUSE = 300;
const BOOT_POLLS = 55;                 // @5baa: 54 BIOS ticks before the timer is hooked (55 idle points)
const AUTO_ANSWER_DELAY = 5;
const WINDOW_ORBIT = 9, WINDOW_DOCK = 10;
const LAMPS = ['msgLamp', 'msgLamp1', 'msgLamp2', 'msgLamp3', 'msgLamp4'];

// state owned by the game loop / UI framework that the simulation depends on
export const GAME_FIELDS = [
  ['isrDivider', 0x3516, 'i16'],       // ISR: one simulation step every 20 ticks (first after 5)
  ['stepsPending', 0x3518, 'i16'],     // simulation steps due (catch-up <= 11, more are dropped)
  ['delayCounter', 0x351c, 'i16'],     // ISR tick count of the running delay
  ['slot', 0x1570, 'i16'],             // round-robin slot 0..5 of the last step
  ['panel', 0x2d2, 'i16'],             // panel in the view area: dept+1 status, dept+6 list, 0 none
  ['autoAnswer', 0x2f8, 'u16'],        // Acknowledge > Auto Answer enabled
  ['autoAnswerDelay', 0x3286, 'u16'],  // slot-0 steps until the next automatic message
  ['courseOrder', 0xaf0, 'i16', 5],    // Navigation > Rank: course list, last chosen first
];
const GAME_DATA = [
  ['startPos', 0x622b, 'i16'],                                    // mission file: start position
  ['lampWidget', 0x3288, 'u16', 5],                               // indicator-light widget per department
  ['fileSize', 0x347a, 'u16', 6], ['fileAddr', 0x3486, 'u16', 6], // load table of @6b7c (mission, 5 crew files)
  ['dashImage', 0x8b0c, 'u8', 0x2086],                            // DASH.BIN, loaded first (crew files overwrite it)
  ['soundOn', 0x350a, 'u8'], ['joystickOn', 0x350b, 'u8'],        // SELECT.BIN flags
  // invoice @5840 (money in 0.1 M$): mission file inputs and the computed rows
  ['bountyPerKill', 0x6294, 'i16', 8], ['casualtyCost', 0x62a4, 'i16'], ['lostAllyCost', 0x62a6, 'i16'],
  ['earlyBase', 0x62a8, 'i16'], ['earlyPerMinute', 0x62aa, 'i16'], ['cargoCostTotal', 0x62ac, 'i16'],
  ['cargoReward', 0x62ae, 'i16'],
  ['invBounty', 0x1302, 'i16', 7], ['invCargo', 0x1310, 'i16'], ['invEarly', 0x1312, 'i16'],
  ['invBounties', 0x1314, 'i16'], ['invCargoCost', 0x1316, 'i16'], ['invCasualties', 0x1318, 'i16'],
  ['invLostAllies', 0x131a, 'i16'], ['invRepairs', 0x131c, 'i16'], ['bountySum', 0x131e, 'i16'],
  ['invTotal', 0x1320, 'i16'], ['invNegative', 0x1322, 'i16'],
];

// union of all specs, one entry per name (largest count; a FIELDS type wins over a DATA type)
const SIZE = { i16: 2, u16: 2, i8: 1, u8: 1 };
function union(fields, data) {
  const m = new Map();
  for (const [list, prio] of [[fields, 1], [data, 0]])
    for (const [name, addr, type, count = 1] of list) {
      const o = m.get(name);
      if (!o) m.set(name, { name, addr, type, count, prio });
      else { o.count = Math.max(o.count, count); if (prio > o.prio) { o.type = type; o.prio = prio; } }
    }
  return [...m.values()].map(o => [o.name, o.addr, o.type, o.count]);
}
export const ENGINE_FIELDS = union([...COMMON_FIELDS, ...CHECKS.flatMap(c => c.fields)], []);
export const STATE_SPEC = union([...COMMON_FIELDS, ...CHECKS.flatMap(c => c.fields), ...GAME_FIELDS],
  [...CHECKS.flatMap(c => c.data || []), ...GAME_DATA]);
const addrOf = name => STATE_SPEC.find(f => f[0] === name)[1];

const VIEW = { i16: Int16Array, u16: Uint16Array, i8: Int8Array, u8: Uint8Array };
// a few mission-file words sit at odd offsets: array-like proxy over a DataView (array methods work generically)
function unaligned(buffer, addr, type, count) {
  const dv = new DataView(buffer), get = type === 'i16' ? i => dv.getInt16(addr + 2 * i, true) : i => dv.getUint16(addr + 2 * i, true);
  const isIndex = p => typeof p === 'string' && /^\d+$/.test(p) && +p < count;
  return new Proxy(Object.assign(Object.create(Array.prototype), { length: count }), {
    get: (t, p) => isIndex(p) ? get(+p) : Reflect.get(t, p),
    set: (t, p, v) => { if (isIndex(p)) dv.setUint16(addr + 2 * p, v & 0xffff, true); else t[p] = v; return true; },
    has: (t, p) => isIndex(p) || p in t,
  });
}
function buildState(buffer) {
  const S = {};
  for (const [name, addr, type, count] of STATE_SPEC) {
    const v = addr % SIZE[type] ? unaligned(buffer, addr, type, count) : new VIEW[type](buffer, addr, count);
    if (count === 1) Object.defineProperty(S, name, { get: () => v[0], set: x => { v[0] = x; }, enumerable: true });
    else S[name] = v;
  }
  return S;
}

// @5247 initGame, in field names (everything else keeps the data image / loaded files)
const INIT = {
  missionPhase: 0, cargo: 100, minutes: 0, textShown: 0, borderFlash: 0, view: 1, wantedView: 1,
  msgWindow: -1, gaugeBars: -1, gaugeLevel: -1, shieldLight: -1, scannerLamp: -1, emergLight: -1,
  weaponLampShown: -1, shieldShown: -1,
  orderSerial: -1, orderShots: 0, orderWeapon: 0, orderTarget: 0, orderStatus: 0, orderChannel: -1, orderQueue: 0,
  orderCount: 0, nextSerial: 0, launchBlocked: 0,
  chTarget: -1, chWeapon: 0, chOrder: 0, chShots: 0, chLaunched: 0,
  killsByWeapon: 0, shotsByWeapon: 0, killsByClass: 0, autoFireIdle: 0, stressHold: 0,
  contactClass: 0, contactIdProgress: 0, contactIdClass: 0, contactHostile: 0, contactLockProgress: 0, contactLocked: 0,
  contactBearing: 0, contactOnScreen: 0, contactDamage: 0, contactDamageProgress: 0, contactDamageKnown: 0,
  contactWeakness: 0, contactWeaknessProgress: 0, contactSpawnPos: 0, contactMarker: 0, contactListed: 0,
  targetOrdered: 0, contactKilledBy: 0,
  screenQueue: -1, contactsDetected: 0, examLen: 0, spawnLastPos: 0, spawnLastRoute: 0, spawnSlotSearch: 25,
  examsCompleteGiven: 0, autoExamineTimer: 0, scanAlertTimer: 0,
  route: 0, reqCourse: 0, navState: 0, manoeuvre: 0, speed: 0, reqSpeed: 0, etaState: 0, shake: 0, enginePower: 0,
  navStressHold: 0,
  sysState: 2, destroyed: 0, powered: 1, shieldBatt: 50, emergBatt: 30,
  changeCnt: 0, changeDelay: 0, emergChargeCnt: 0, shieldChargeCnt: 0,
  droidDestroyed: 0, droidRecharge: 0, droidOut: 0, droidBusy: 0,
  queue: 0, slotId: -1, slotDroids: 0, slotWanted: 0, slotSys: -1, slotBlink: 0, slotWorking: 0, slotDamage: 0,
  slotWork: 0, queueLen: 0, openSlots: 0, autoDelay: 0, overloadCount: 0,
  pendingHit: 0, engLifeTimer: 0, navLifeTimer: 0, spawnMask: 0, spawnCursor: 0, spawnTries: 0, nextSlot: 0,
  alarmCount: 0, alarmOn: 0, disabledCount: 0, destroyedCount: 0,
  msgCount: 0, deptAlive: 1, deptStress: 0, shipTimer: 0, objActive: 0, objKind: 0,
  panel: 0, autoAnswer: 0,
};
function initMission(S) {
  for (const [name, v] of Object.entries(INIT)) { if (typeof S[name] === 'object') S[name].fill(v); else S[name] = v; }
  S.examList.fill(0, 0, 8);                                   // the 9th word belongs to the spawn table
  S.priority.forEach((_, i) => { S.priority[i] = i; });
  S.devState.fill(2, 0, 13); S.devState[11] = 0;              // all components on, emergency battery off
  S.devState.fill(0, 13, 25); S.devTimer.fill(0);             // (devState[13..24] = devTimer[0..11])
  S.pos = S.startPos;
}

// commands: generator methods run on the game (this) at the poll point of the tick they were issued for
const COMMANDS = {
  // ---- Weapons (menu W)
  *fire(target, shots, weapon, position) {                      // F <shots A/1..9> <M/B/C/T> <target> <position>
    yield* this.flash();
    queueOrder(this.S, target, shots || AT_WILL, weapon, i16(position));
    this.redraw();
  },
  *fireOnly(target, weapon) {                                   // officer dead: F <weapon> <target>
    yield* this.flash();
    const S = this.S;
    while (S.orderCount) {                                      // original: drops "serial 0" until empty (B9)
      const n = S.orderCount;
      dropOrder(S, this.fixes.ordersClearFreeze ? S.orderSerial[S.orderQueue[0]] : 0, this.ctx);   // fix: the first order
      if (S.orderCount === n) { this.emit('freeze', 'ordersClear'); break; }
    }
    queueOrder(S, target, AT_WILL, weapon, 0);
    this.redraw();
  },
  *cancelOrder(serial) { yield* this.flash(); dropOrder(this.S, serial, this.ctx); this.redraw(); },   // C <order>
  *rankOrder(serial, position) {                                // R <order> <position>
    yield* this.flash();
    const S = this.S;
    moveInList(S.orderQueue, S.orderCount, i => u16(S.orderSerial[S.orderQueue[i]]) === u16(serial), position);
    this.redraw();
  },
  // ---- Scanning (menu S)
  *examine(target, position) { yield* this.flash(); RUN.f_232b(this.S, this.S, this.ctx, target, position); this.redraw(); },
  *cancelExamine(target) { yield* this.flash(); RUN.f_23df(this.S, this.S, this.ctx, target); this.redraw(); },
  *clearExamList() {                                            // officer dead: pressing E empties the list first
    const S = this.S;
    if (this.fixes.examClearOnConfirm) return;                  // fix: emptied by examineOnly() on confirm instead
    while (S.examLen) {
      const n = S.examLen;
      RUN.f_23df(S, S, this.ctx, S.examList[0]);
      if (S.examLen === n) { this.emit('freeze', 'examClear'); break; }
    }
  },
  *examineOnly(target) {                                        // officer dead, confirm of E (fixes.examClearOnConfirm)
    yield* this.flash();
    const S = this.S;
    while (S.examLen) {
      const n = S.examLen;
      RUN.f_23df(S, S, this.ctx, S.examList[0]);
      if (S.examLen === n) break;
    }
    RUN.f_232b(S, S, this.ctx, target, 0);
    this.redraw();
  },
  // ---- Navigation (menu N)
  *setCourse(course) {                                          // R <A..E>
    yield* this.flash();
    const S = this.S;
    let j = 4;
    while (j > 0 && S.courseOrder[j] !== course) j--;
    for (; j > 0; j--) S.courseOrder[j] = S.courseOrder[j - 1];
    S.courseOrder[0] = course;
    S.changePending = 1; S.reqCourse = course;
    this.redraw();
  },
  *setSpeed(speed, evasive) {                                   // A <S/1..8> [<S standard / E evasive>]
    const S = this.S, maneuverMenu = speed !== 0 && S.deptAlive[NAV];
    if (maneuverMenu && evasive) S.evasivePending = 1;          // set before the flash
    yield* this.flash();
    S.reqSpeed = speed; S.maneuver = maneuverMenu && evasive ? 1 : 0;
    this.redraw();
  },
  *cancelManeuver() { yield* this.flash(); this.S.maneuver = 0; this.redraw(); },                    // C
  // ---- Engineering (menu E)
  *deviceOff(device) {                                          // C <A..L>
    yield* this.flash();
    const S = this.S;
    if (S.devState[device] === 2) { S.devState[device] = 3; S.devTimer[device] = 1; }
    else if (S.devState[device] === 1) { S.devState[device] = 0; S.devTimer[device] = 0; }
    this.redraw();
  },
  *deviceOn(device) {                                           // E <A..L>
    yield* this.flash();
    const S = this.S;
    if (S.devState[device] === 0) { S.devState[device] = 1; S.devTimer[device] = 1; }
    else if (S.devState[device] === 3) { S.devState[device] = 2; S.devTimer[device] = 0; }
    this.redraw();
  },
  *rankDevice(group, position) {                                // R <A..F> <1..6>
    yield* this.flash();
    moveInList(this.S.priority, 6, i => this.S.priority[i] === group, position);
    this.redraw();
  },
  // ---- Repair (menu R)
  *repairAssign(slot, droids, position) {                       // A <1..7 droids> <slot> <position>
    yield* this.flash(); RUN.f_43a2(this.S, this.S, this.ctx, slot, droids, position); this.redraw();
  },
  *repairCancel(slot) { yield* this.flash(); RUN.f_42e4(this.S, this.S, this.ctx, slot); this.redraw(); },   // C <slot>
  *repairRank(slot, position) {                                 // R <slot> <position>
    yield* this.flash();
    const S = this.S;
    moveInList(S.queue, S.queueLen, i => u16(S.slotId[S.queue[i]]) === u16(slot), position);
    this.redraw();
  },
  *repairOnly(slot) {                                           // officer dead: F <slot>
    yield* this.flash();
    const S = this.S;
    while (S.queueLen) {
      const n = S.queueLen;
      RUN.f_42e4(S, S, this.ctx, S.slotId[S.queue[0]]);
      if (S.queueLen === n) { this.emit('freeze', 'repairClear'); break; }
    }
    RUN.f_43a2(S, S, this.ctx, slot, 7, 0);
    this.redraw();
  },
  // ---- panels and messages
  *view(dept, list) {                                           // S status / D list panel of a department
    const id = dept + (list ? 6 : 1);
    if (this.S.panel === id) return;
    yield* this.flash();
    this.display();                                             // panel title script
    this.S.panel = id; this.emit('panel', id);
    this.redraw();
  },
  *nextMessage() { yield* this.flash(); this.showMessage(-1); this.redraw(); },        // '?' in a menu
  *acknowledge(dept) { yield* this.flash(); this.showMessage(dept); this.redraw(); },  // A <W/S/N/E/R>
  *clearMessages() { yield* this.flash(); this.clearAllMessages(); this.redraw(); },   // A C
  *autoAnswer(on) { yield* this.flash(); this.S.autoAnswer = on ? 1 : 0; this.redraw(); },   // A A <E/D>
  *refuse() { yield* this.flash(); this.redraw(); },            // "queue/list full" message instead of a dialog
};
// @101d/@356b/@3dd4: move the entry matching `match` to position pos (original loop shape kept)
function moveInList(list, len, match, pos) {
  let i = 0;
  do { if (match(i)) break; i++; } while (i < len);
  if (i >= len) return;
  const e = list[i];
  for (; i < pos; i++) list[i] = list[i + 1];
  for (; i > pos; i--) list[i] = list[i - 1];
  list[pos] = e;
}

export class Game {
  // image: the program's data image (web/data/psi5_ds.bin); fixes: engine fix flags; balance: balance knobs (partial,
  // missing ones = original, presets.js ORIGINAL_BALANCE); emit(type, ...args): events
  constructor({ image, fixes = {}, balance = {}, emit = () => {} } = {}) {
    this.image = image; this.fixes = fixes; this.emit = emit;
    this.balance = Object.freeze(checkBalance({ ...ORIGINAL_BALANCE, ...balance }));
    this.ctx = { fixes, balance: this.balance, emit: (...e) => this.emit(...e), displayTick: (S, D) => RUN.f_6e26(S, D, this.ctx) };
    this.commands = {};
    for (const name of Object.keys(COMMANDS)) this.commands[name] = (...args) => { this.queue.push([name, args]); };
    Object.assign(this.commands, {
      begin: () => { this.queue.push(['begin', []]); },          // the briefing's "Press RETURN" (not in demo)
      pause: () => { this.queue.push(['pause', []]); },          // ESC
      resume: () => { this.queue.push(['resume', []]); },        // any key while paused
      // original-timing hook: a key handled at the very start of this tick (the demo autopilot does this) replaces
      // the tick's simulation step; redraw = handling it drew text (advances the combat view)
      uiKey: (redraw) => { this.uiKey = !!redraw; },
    });
  }

  // missionFile, crewFiles[5] (weapons, scanning, navigation, engineering, repair), dashFile (optional, DASH.BIN):
  // Uint8Arrays; flags.demo / sound / joystick as in SELECT.BIN
  newMission({ missionFile, crewFiles, dashFile, flags = {} }) {
    this.mem = new Uint8Array(0x10000);
    this.mem.set(this.image.subarray(0, 0x10000));
    const S = this.S = buildState(this.mem.buffer);
    if (dashFile) S.dashImage.set(dashFile.subarray(0, S.dashImage.length));
    S.demo = flags.demo ? 1 : 0; S.soundOn = flags.sound ?? 1; S.joystickOn = flags.joystick ? 1 : 0;
    [missionFile, ...crewFiles].forEach((f, i) => this.mem.set(f.subarray(0, S.fileSize[i]), S.fileAddr[i]));
    S.missionPhase = 1;               // the intro runs in "phase 1" until the mission starts
    S.msgWindow = WINDOW_ORBIT;       // intro draws message window 9
    this.queue = []; this.uiKey = null;
    this.hooked = false; this.skipDisplayTick = false; this.started = false;
    this.result = null; this.ticks = 0;
    this.prog = this.program(); this.done = false;
    return S;
  }
  get state() { return this.S; }
  get over() { return this.result !== null; }

  // one 120 Hz tick: the main-loop work up to the next idle point, then the timer interrupt
  tick() {
    if (!this.done && this.prog.next().done) this.done = true;
    this.isr();
    this.ticks++;
    if (this.started && !this.result && this.S.missionPhase !== 0)
      this.result = this.S.pos >= 50 ? 'arrived' : this.S.cargo === 0 ? 'noCargo' : 'tooLate';
  }

  // @6ca9 (counters only; the tune player is presentation)
  isr() {
    if (!this.hooked) return;
    const S = this.S;
    if (!this.skipDisplayTick) S.displayTicks++;
    if (--S.isrDivider < 0) { S.stepsPending++; S.isrDivider = STEP_TICKS - 1; }
    S.delayCounter++;
  }

  display() { RUN.f_6e26(this.S, this.S, this.ctx); }     // a poll of @6e26 (runs only every 3rd tick)
  redraw() { this.emit('menu'); this.display(); }          // menu bar redrawn: always prints, so it polls @6e26

  // PSI5 main @0082 from program start
  *program() {
    const S = this.S;
    for (let i = 0; i < BOOT_POLLS; i++) yield;
    if (!S.demo) {
      this.queue.length = 0; yield;                         // @5aff flush keys
      for (;;) {                                            // @5af1: one random number per poll while waiting
        random(S);
        if (this.take('begin')) break;
        yield;
      }
    }
    initMission(S);
    S.stepsPending = 0; S.displayTicks = 0; S.isrDivider = 4; this.hooked = true;   // @6c10
    this.started = true; this.emit('departure');
    S.textShown = 1;                                        // "Prepare for departure" headline
    S.msgWindow = WINDOW_DOCK;
    for (let i = 0; i < DEPARTURE_PICTURES; i++) yield* this.waitPure(DEPARTURE_TICKS);
    S.textShown = 0;
    this.redraw();                                          // main menu bar
    yield* this.mainLoop();
  }
  take(name) {
    const i = this.queue.findIndex(c => c[0] === name);
    if (i < 0) return false;
    this.queue.splice(i, 1); return true;
  }

  // @0786 polling, as the main menu and every department menu do it
  *mainLoop() {
    const S = this.S;
    for (;;) {
      const cmd = this.queue.shift();
      if (cmd) {
        if (cmd[0] === 'pause') { yield* this.paused(); if (!(yield* this.idle())) return; }
        else if (COMMANDS[cmd[0]]) yield* COMMANDS[cmd[0]].apply(this, cmd[1]);
        continue;
      }
      yield;
      if (this.uiKey !== null) { if (this.uiKey) this.display(); this.uiKey = null; continue; }
      if (!(yield* this.idle())) return;
    }
  }
  // no key this poll: one simulation step, or leave once the mission is over
  *idle() {
    if (this.S.missionPhase !== 0) return false;
    yield* this.simStep();
    return true;
  }
  // ESC @5a79: frozen until any key; then the view is redrawn (a panel's title script polls @6e26)
  *paused() {
    this.emit('pause', true);
    while (!this.take('resume')) yield;                   // the key may already be waiting
    this.emit('pause', false);
    if (this.S.panel) this.display();
  }

  // @0d97: one department step per call while steps are pending, then a combat-view poll
  *simStep() {
    const S = this.S, ctx = this.ctx;
    if (S.stepsPending) {
      const next = S.slot + 1;
      S.slot = next >= SIM_SLOTS ? 0 : next;
      switch (S.slot) {
        case 0: RUN.f_4922(S, S, ctx); RUN.f_64aa(S, S, ctx); this.autoAnswerTick(); break;
        case 1: RUN.f_16f3(S, S, ctx); break;
        case 2: RUN.f_243d(S, S, ctx); break;
        case 3: {
          const before = S.missionPhase;
          RUN.f_2cf2(S, S, ctx);
          if (!before && S.missionPhase && S.pos >= 50) yield* this.arrivalPause();
          break;
        }
        case 4: RUN.f_37be(S, S, ctx); break;
        case 5: RUN.f_4479(S, S, ctx); break;
      }
      const t = i16(S.stepsPending - 1);
      S.stepsPending = t > MAX_BACKLOG || t < 0 ? 0 : t;
      this.emit('step', S.slot);
    }
    this.display();
  }
  // @3318's frozen 2.5 s inside the navigation step: the engine step already resolved it (and advanced the display
  // timer by the pause), so these ticks only run the step timer
  *arrivalPause() {
    this.skipDisplayTick = true;
    yield* this.waitPure(ARRIVAL_PAUSE);
    this.skipDisplayTick = false;
  }
  // @0748: wait n ticks, simulating meanwhile
  *waitRun(n) {
    const S = this.S;
    S.delayCounter = 0;
    for (;;) {
      yield;
      if (S.delayCounter >= n) return;
      if (S.missionPhase === 0) yield* this.simStep();
    }
  }
  // @076d: wait n ticks, nothing runs
  *waitPure(n) {
    const S = this.S;
    S.delayCounter = 0;
    do yield; while (S.delayCounter < n);
  }
  // @06f4 "Processing command": every confirmed menu action waits through it
  *flash() {
    this.emit('flash');
    for (let i = 0; i < 2; i++) { this.display(); yield* this.waitRun(FLASH_HALF); yield* this.waitRun(FLASH_HALF); }
  }

  // @66dc (slot 0): with Auto Answer on, show the fullest queue's next message every 6 s while there are any
  autoAnswerTick() {
    const S = this.S;
    if (!S.autoAnswer) return;
    if (S.autoAnswerDelay) { S.autoAnswerDelay--; return; }
    for (let d = 0; d < 5; d++) if (S.msgCount[d]) { S.autoAnswerDelay = AUTO_ANSWER_DELAY; this.showMessage(-1); return; }
  }
  // @657f: show and remove the next message of dept (-1: the fullest queue, ties to the lowest dept)
  showMessage(dept) {
    const S = this.S;
    let d = dept, empty;
    if (d >= 0) empty = S.msgCount[d] === 0;
    else {
      let most = 0;
      for (let i = 0; i < 5; i++) if (S.msgCount[i] > most) { d = i; most = S.msgCount[i]; }
      empty = d < 0;
    }
    if (empty) { this.emit('message', -1, -1); this.display(); return; }
    const q = d * 8, id = S.msgQueue[q], n = --S.msgCount[d];
    for (let i = 0; i < n; i++) S.msgQueue[q + i] = S.msgQueue[q + i + 1];
    this.emit('message', d, id);
    this.display();                                          // the message text is printed
    if (S.msgCount[d] === 0) { S[LAMPS[d]] = 0; this.emit('lamp', d, false); }
  }
  // @669b Acknowledge > Clr. Original quirk kept: the loop counter is clobbered by the lamp-label drawer, so the scan
  // runs on 2 slots past the last cleared queue, past the 5 counts into the queues and through widget pointers there.
  clearAllMessages() {
    if (this.fixes.clearAllMessages) {                          // fix: every queue and lamp, nothing else
      for (let d = 0; d < 5; d++) if (this.S.msgCount[d]) { this.S.msgCount[d] = 0; this.S[LAMPS[d]] = 0; this.emit('lamp', d, false); }
      return;
    }
    const m = this.mem, rw = a => m[a & 0xffff] | m[(a + 1) & 0xffff] << 8;
    const ww = (a, v) => { m[a & 0xffff] = v & 0xff; m[(a + 1) & 0xffff] = (v >> 8) & 0xff; };
    const counts = addrOf('msgCount'), widgets = addrOf('lampWidget');
    let cx = 5, bx = 0;
    do {
      if (rw(counts + bx)) {
        ww(counts + bx, 0);
        const di = rw(widgets + bx);
        ww(di + 2, 0);
        if (bx < 10) this.emit('lamp', bx >> 1, false);
        for (let p = di + 4, c; (c = m[p & 0xffff]); p++) if (((c - 0x20) << 24 >> 24) >= 0) cx = (cx & 0xff00) | 3;
      }
      bx += 2;
    } while ((cx = (cx - 1) & 0xffff));
  }

  // @5840 the invoice (computed once when the report is shown); money in 0.1 M$. Returns the rows.
  invoice() {
    const S = this.S;
    if (this.fixes.bountyReset) S.bountySum = 0;                 // original never resets it (Replay / Same crew, re-invoice)
    for (let i = 1; i < 8; i++) {
      const q = Math.trunc(i16(i16(S.bountyPerKill[i] * S.killsByClass[i]) + 5) / 10);
      S.invBounty[i - 1] = q; S.bountySum += q;
    }
    S.invCargo = S.invEarly = S.invBounties = S.invCargoCost = S.invCasualties = S.invLostAllies = S.invRepairs = 0;
    if (S.pos >= 50) {
      S.invCargo = Math.trunc(i16(i16(S.cargoReward * S.cargo) + 5) / 10);
      const late = i16(S.minutes), limit = i16(S.timeLimit);
      if (limit >= late) S.invEarly = S.earlyBase + i16(i16(limit - late) * S.earlyPerMinute);
    }
    S.invBounties = S.bountySum; S.invCargoCost = S.cargoCostTotal;
    for (let d = 0; d < 5; d++) if (!S.deptAlive[d]) S.invCasualties += S.casualtyCost;
    S.invLostAllies = i16(S.lostAllyCost * i16(S.killsByClass[8] + S.killsByClass[9]));
    const repairs = i16(S.destroyedCount + Math.trunc(S.disabledCount / 4));
    const gross = i16(S.invCargo + S.invEarly + S.invBounties - S.invCargoCost - S.invCasualties - S.invLostAllies);
    S.invNegative = 0; S.invTotal = gross - repairs; S.invRepairs = repairs;
    if (gross < repairs) { S.invNegative = 1; S.invTotal = -S.invTotal; }
    return { bounty: [...S.invBounty], cargo: S.invCargo, early: S.invEarly, bounties: S.invBounties,
      cargoCost: S.invCargoCost, casualties: S.invCasualties, lostAllies: S.invLostAllies, repairs: S.invRepairs,
      total: S.invNegative ? -S.invTotal : S.invTotal };
  }
}
