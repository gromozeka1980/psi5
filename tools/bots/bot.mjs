// Headless bots for the modern engine (web/src/engine/game.js): one mission at full CPU speed, no port, no drawing.
//   runMission({ mission, crew, wait, fixes, balance, policy }) -> metrics (see METRICS in docs/modern/BALANCE.md)
// Policies only read what the player can see on the dashboard and the department panels: contact table as shown by
// Scanning (class only once identified, foe/frd, lock, bearing, on screen, known damage, Sug weapon), firing orders,
// nav status (speed, course, RSK/RETA per course), engineering status (switches, batteries, power gauges), repair
// status (damaged systems, damage left, droids) and their own crew's numbers (the player learns them from the
// Weapons report / resumes). Panels are assumed visible at no cost; every command pays the original "Processing
// command" flash (the engine runs it), so bots act at most about once per 0.8 s like a fast human.
// Balance knobs (balance.*) go to the engine as is: new Game({ fixes, balance }).
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { Game } = await import(new URL('../../web/src/engine/game.js', import.meta.url));
const file = n => new Uint8Array(fs.readFileSync(path.join(ROOT, n)));
const IMAGE = file('web/data/psi5_ds.bin');
const FILES = {};
const bin = n => FILES[n] ??= file(n + '.BIN');

export const MISSIONS = ['MISNA', 'MISN1', 'MISN2', 'MISN3'];         // SEL courses 1..4
export const CREW = [                                                // 6 candidates per department (SEL order)
  ['BORIS', 'Q6D', 'YEELA', 'ALZOTT', 'SKULARD', 'GROLO'],            // weapons
  ['JARU', 'PHYZO', 'BLUSTAN', 'NARGO', 'CHURGLK', 'MIKE'],           // scanning
  ['KLG', 'TEGRA', 'NIK', 'BRONX', 'AYMU', 'YENX'],                   // navigation
  ['CRAVEN', 'WILFO', 'TONY', 'FLIGRNK', 'SHEEMA', 'VX4'],            // engineering
  ['ANXY', 'T3', 'VOFGANK', 'RYBLO', 'BRU', 'SWIGLTZ'],               // repair
];
export const SYSTEM_NAMES = ['ForeShield', 'PortShield', 'StarShield', 'AftShield', 'Missile', 'Blaster', 'Cannon',
  'Thermo', 'Engine1', 'Engine2', 'InfScanner', 'EmergBatt', 'ShieldBatt', 'TrackLock', 'Reactor1', 'Reactor2',
  'Droid2', 'Droid5', 'Droid7', 'PortRetro', 'StarRetro', 'CargoEnvir', 'CargoStab', 'ELifeSup', 'NLifeSup', 'Cravenlator'];

// ---------------------------------------------------------------- game files
// Balance knobs (balance.*) are engine parameters: new Game({ balance }), see presets.js ORIGINAL_BALANCE.
const rd = (b, o) => b[o] | b[o + 1] << 8 << 16 >> 16;
export function missionFiles({ mission, crew }) {
  return { missionFile: bin(mission).slice(), crewFiles: crew.map(n => bin(n).slice()) };
}
// crew numbers a player can learn (used by the policies)
export function crewInfo(crew) {
  const w = bin(crew[0]), n = bin(crew[2]), r = bin(crew[4]);
  return {
    miss: [0, 1, 2, 3].map(i => rd(w, 0x24 + 2 * i)), reload: [0, 1, 2, 3].map(i => rd(w, 0x34 + 2 * i)),
    evasion: rd(n, 0x5e), evasiveSpeed: [...Array(9)].map((_, s) => rd(n, 0x34 + 2 * s)),
    repairWork: [...Array(8)].map((_, k) => rd(r, 0x28 + 2 * k)),
  };
}

// ---------------------------------------------------------------- the player's view
const PIRATE = c => c >= 1 && c <= 7;
// power classes (Engineering R): 0 shields, 1 weapons, 2 engines, 3 scanner, 4 emergency charger, 5 shield charger
const SH = 0, WE = 1, EN = 2, SC = 3, EC = 4, SB = 5;
const DRAW_OK = [100, 100, 100, 100, 80, 80, 80, 80, 100, 100, 200, 170, 120];
const DRAW_DMG = [160, 150, 150, 130, 80, 50, 30, 90, 160, 160, 270, 170, 120];
const CLASS_COMPONENTS = [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9], [10], [11], [12]];
function contacts(S) {
  const out = [];
  for (let t = 0; t < 26; t++) {
    if (!S.contactClass[t]) continue;
    out.push({ t, id: S.contactIdClass[t], foe: !!S.contactHostile[t], locked: !!S.contactLocked[t],
      on: !!S.contactOnScreen[t], listed: !!S.contactListed[t], sug: S.contactWeaknessKnown[t] - 1,
      dmgKnown: S.contactDamageKnown[t], ordered: !!S.targetOrdered[t], spawn: S.contactSpawnPos[t] });
  }
  return out;
}
const supply = S => 300 * (S.sysState[14] + S.sysState[15] + (S.devState[11] > 1 && S.emergBatt ? 2 : 0));
function classCost(S, d) {      // draw of a power class with its current switches (engines separately)
  let c = 0;
  for (const i of CLASS_COMPONENTS[d]) if ((S.devState[i] > 1 && S.sysState[i]) || d === EC) c += S.sysState[i] === 2 ? DRAW_OK[i] : DRAW_DMG[i];
  return c;
}
const engineCap = s => [0, 3, 4][s];
// cost of running at speed s (engine one first if ok, as nav @322f does) and the highest speed that fits `avail`
function speedFor(S, avail) {
  const order = S.sysState[8] === 2 ? [8, 9] : [9, 8];
  let best = 0;
  for (let s = 1; s <= 8; s++) {
    let left = s, cost = 0, ok = true;
    for (const e of order) {
      if (!(S.devState[e] > 1 && S.sysState[e])) continue;
      const u = Math.min(left, engineCap(S.sysState[e])); left -= u;
      cost += u ? u * (S.sysState[e] === 2 ? 100 : 160) : 40;
    }
    if (left > 0) ok = false;
    if (ok && cost <= avail) best = s;
  }
  return best;
}

// ---------------------------------------------------------------- policies
export const PERSONAS = {
  passive: { speed: 8 },                       // sets full speed, the officers do everything else on their own
  naive: { speed: 8, fire: 'onScreenFoe', weapon: 'sug', evade: 'underFire', exam: 'fifo' },
  competent: { fire: 'foe', weapon: 'sug', evade: 'never', exam: 'threat', eng: 'balanced', repair: true, course: 1, keepWeapons: 2 },
  aggressive: { fire: 'pirates', weapon: 'sug', evade: 'never', exam: 'threat', eng: 'weapons', repair: true, course: 0, keepWeapons: 4 },
  evader: { fire: 'foe', weapon: 'sug', evade: 'underFire', exam: 'threat', eng: 'balanced', repair: true, course: 1, keepWeapons: 2 },
  cautious: { fire: 'foe', weapon: 'sug', evade: 'underFire', exam: 'threat', eng: 'shields', repair: true, course: 3, keepWeapons: 2 },
};
// repair order: what a disabled system costs (cargo leaks, officer death timers) first, then power, speed, shields
const REPAIR_IMPORTANCE = [21, 22, 23, 24, 14, 15, 8, 9, 0, 1, 2, 3, 19, 20, 4, 5, 6, 7, 10, 13, 16, 17, 18, 25];
const URGENT_WHEN_DISABLED = [21, 22, 23, 24];

function makePolicy(p, info, mission) {
  const m = { next: 0, mode: 'cruise', lastFoe: -1e9, lastSpeedCmd: -1e9, lastCourseCmd: -1e9, coursePos: -1, offDone: false,
    firstWeapons: [0, 1, 2, 3].sort((a, b) => (info.miss[a] / 256 + info.reload[a] / 10) - (info.miss[b] / 256 + info.reload[b] / 10)) };
  const keep = m.firstWeapons.slice(0, p.keepWeapons ?? 4);
  const goodWeapon = (S, w) => S.sysState[4 + w] && S.powered[4 + w];
  const pickWeapon = (S, c) => {
    if (p.weapon === 'sug' && c.sug >= 0 && goodWeapon(S, c.sug)) return c.sug;
    return m.firstWeapons.find(w => goodWeapon(S, w)) ?? m.firstWeapons[0];
  };
  // one decision; returns a command [name, ...args] or null
  return function decide(S, now) {
    const cs = contacts(S);
    const foeOn = cs.some(c => c.on && c.foe);
    if (foeOn) m.lastFoe = now;
    const combat = now - m.lastFoe < 15 * 120;
    // --- navigation: speed / evasive
    const retros = S.sysState[19] === 2 && S.sysState[20] === 2;
    const evasive = retros && (p.evade === 'always' || (p.evade === 'underFire' && combat));
    let speed = p.speed ?? 8;
    if (p.eng) {
      const order = desiredPriority(combat);
      let avail = supply(S);
      for (const d of order) { if (d === EN) break; avail -= classCost(S, d); }
      speed = Math.max(1, speedFor(S, avail));   // never stop: a dead ship gets boarded
    }
    if ((S.reqSpeed !== speed || (S.maneuver ? 1 : 0) !== (evasive ? 1 : 0)) && now - m.lastSpeedCmd > 600) {
      if (S.reqSpeed !== speed || !!S.maneuver !== evasive) { m.lastSpeedCmd = now; return ['setSpeed', speed, evasive]; }
    }
    // --- engineering
    if (p.eng) {
      if (!m.offDone) {
        const w = [4, 5, 6, 7].find(i => !keep.includes(i - 4) && S.devState[i] === 2);
        if (w !== undefined) return ['deviceOff', w];
        m.offDone = true;
      }
      const want = desiredPriority(combat);
      for (let i = 0; i < 6; i++) if (S.priority[i] !== want[i]) return ['rankDevice', want[i], i];
      const lowSupply = S.sysState[14] + S.sysState[15] < 4;
      const battOn = (combat || lowSupply) && S.emergBatt > 10;
      if (battOn && S.devState[11] === 0) return ['deviceOn', 11];
      if (!battOn && S.devState[11] === 2) return ['deviceOff', 11];
      // a weapon we rely on broke: power a spare one
      if (keep.every(w => !S.sysState[4 + w])) { const w = [4, 5, 6, 7].find(i => S.sysState[i] && S.devState[i] === 0); if (w !== undefined) return ['deviceOn', w]; }
    }
    // --- weapons
    if (p.fire) {
      const want = cs.filter(c => c.locked && (c.foe || (p.fire === 'pirates' && PIRATE(c.id))) && (p.fire !== 'onScreenFoe' || c.on));
      for (const c of want.sort((a, b) => b.on - a.on)) {
        if (c.ordered) continue;
        if (S.orderCount >= 8) break;
        return ['fire', c.t, 0, pickWeapon(S, c), c.on ? 0 : S.orderCount];
      }
      // re-weapon an order whose weapon is down, or follow a new Sug
      for (let i = 0; i < S.orderCount; i++) {
        const s = S.orderQueue[i], t = S.orderTarget[s], c = cs.find(x => x.t === t);
        if (!c) continue;
        const w = pickWeapon(S, c);
        if (w !== S.orderWeapon[s] && (S.orderStatus[s] <= 1 || (p.weapon === 'sug' && c.sug === w)) && goodWeapon(S, w)) return ['cancelOrder', S.orderSerial[s]];
      }
      // on-screen targets first
      for (let i = 1; i < S.orderCount; i++) {
        const s = S.orderQueue[i];
        if (S.contactOnScreen[S.orderTarget[s]] && !S.contactOnScreen[S.orderTarget[S.orderQueue[0]]]) return ['rankOrder', S.orderSerial[s], 0];
      }
    }
    // --- scanning
    if (p.exam) {
      const done = c => c.locked && c.id && c.sug >= 0 && c.dmgKnown;
      const threat = c => p.exam === 'fifo' ? -c.spawn : (c.on && c.foe ? 100 : 0) + (c.foe ? 50 : 0) + (c.on ? 20 : 0) + (PIRATE(c.id) ? 10 : 0) - (c.id >= 8 ? 30 : 0);
      const todo = cs.filter(c => !done(c)).sort((a, b) => threat(b) - threat(a));
      if (todo.length) {
        const top = todo[0];
        if (p.exam === 'threat' && top.listed && S.examList[0] !== top.t && threat(top) > threat(cs.find(c => c.t === S.examList[0]) || { on: 0 })) return ['examine', top.t, 0];
        const nxt = todo.find(c => !c.listed);
        if (nxt) {
          if (S.examLen < 8) return ['examine', nxt.t, p.exam === 'threat' && threat(nxt) >= 50 ? 0 : S.examLen];
          const finished = cs.find(c => c.listed && done(c));
          if (finished) return ['cancelExamine', finished.t];
        }
      }
    }
    // --- repair
    if (p.repair) {
      const open = [];
      for (let s = 0; s < 26; s++) if (S.slotId[s] >= 0 && S.slotSys[s] >= 0 && S.slotDamage[s] > 0) open.push(s);
      const rank = s => { const sys = S.slotSys[s]; const r = REPAIR_IMPORTANCE.indexOf(sys); return URGENT_WHEN_DISABLED.includes(sys) && !S.sysState[sys] ? r - 100 : r; };
      open.sort((a, b) => rank(a) - rank(b));
      const droids = 7 - [...Array(7).keys()].filter(k => S.droidOut[k] || S.droidDestroyed[k]).length;
      const best = info.repairWork.slice(1, droids + 1).reduce((bi, v, i, a) => v > a[bi] ? i : bi, 0) + 1;
      const plan = open.slice(0, 8).map((s, i) => [s, i === 0 ? Math.min(best, Math.max(1, droids - Math.min(open.length - 1, 7))) : 1]);
      for (let i = 0; i < plan.length; i++) {
        const [s, n] = plan[i];
        if (S.queue[i] !== s || S.slotWanted[s] !== n || i >= S.queueLen) return ['repairAssign', s, n, i];
      }
    }
    // --- course: lowest risk ahead that is not late, once per position
    if (p.course && S.riskValid && S.speed && S.pos !== m.coursePos && now - m.lastCourseCmd > 30 * 120) {
      const score = c => S.risk[c] * p.course + Math.max(0, S.reta[c]) * 2;
      let best = S.course;
      for (let c = 0; c < 5; c++) if (score(c) + 2 <= score(best)) best = c;
      m.coursePos = S.pos;
      if (best !== S.course && S.reqCourse === S.course) { m.lastCourseCmd = now; return ['setCourse', best]; }
    }
    return null;
  };
  function desiredPriority(combat) {
    if (!combat) return [EN, SC, SB, SH, WE, EC];
    if (p.eng === 'weapons') return [WE, SH, EN, SB, SC, EC];
    if (p.eng === 'shields') return [SH, SB, EN, WE, SC, EC];
    return [SH, WE, SB, EN, SC, EC];
  }
}

// ---------------------------------------------------------------- one mission
const MAX_TICKS = 140 * 60 * 120;
export function runMission({ mission, crew, wait = 0, fixes = {}, balance = {}, policy = 'competent', persona }) {
  const p = persona || PERSONAS[policy];
  fixes = { ...fixes };
  if (fixes.evasion || fixes.evasionInverted) fixes.evasion = fixes.evasionInverted = true;   // flag was renamed
  const M = { result: null, kills: {}, shots: 0, shotsSlot: [0, 0], hits: 0, killsN: 0, enemyShots: [0, 0], hitsTaken: [0, 0],
    sysHits: Array(26).fill(0), sysDestroyed: 0, cargoLoss: { hit: 0, loot: 0, late: 0 }, officersLost: [],
    overloadEng: 0, overloadRep: 0, repairedPoints: 0, repairedSystems: 0, evasiveSec: 0, combatSec: 0, cmds: 0, speedSum: 0, secs: 0 };
  let busy = false, game;
  const shotEva = [0, 0];
  const snap = { sys: null, dmg: null, cargo: 100, disabled: 0 };
  const emit = (type, a, b) => {
    switch (type) {
      case 'menu': busy = false; break;
      case 'shot': if (a >= 6) { M.shots++; M.shotsSlot[a - 6]++; } else { shotEva[a - 4] = game.S.navState === 1 ? 1 : 0; M.enemyShots[shotEva[a - 4]]++; } break;
      case 'hit': M.hits++; break;
      case 'explosion': if (b >= 0) M.killsN++; else M.hitsTaken[shotEva[a - 4]]++; break;   // by our manoeuvre when the shot was fired
      case 'officerDied': M.officersLost.push(a); break;
      case 'step': step(a); break;
    }
  };
  function step(slot) {
    const S = game.S;
    if (slot === 0 && snap.sys) {
      for (let d = 0; d < 26; d++) if (S.sysState[d] < snap.sys[d]) M.sysHits[d]++;
      const re = S.disabledCount - snap.disabled - snap.sys.filter((v, d) => v === 1 && S.sysState[d] === 0).length;
      if (re > 0) M.reHits = (M.reHits || 0) + re;
      M.cargoLoss[S.alarmOn ? 'loot' : 'hit'] += snap.cargo - S.cargo;
    }
    if (slot === 3) { M.cargoLoss.late += snap.cargo - S.cargo; M.secs++; if (S.objActive.some((a, k) => k < 4 && a && S.shipAggressive[k])) M.combatSec++; M.speedSum += S.speed; if (S.navState === 1) M.evasiveSec++; }
    if (slot === 4) { if (S.deptStress[3]) M.overloadEng++; snap.dmg = [...S.slotDamage]; snap.ss = [...S.slotSys]; }
    if (slot === 5) {
      if (S.deptStress[4]) M.overloadRep++;
      for (let s = 0; s < 26; s++) if (snap.ss[s] >= 0) {
        const after = S.slotSys[s] === snap.ss[s] ? S.slotDamage[s] : 0;
        if (after < snap.dmg[s]) M.repairedPoints += snap.dmg[s] - after;
        if (S.slotSys[s] !== snap.ss[s]) M.repairedSystems++;
      }
      snap.sys = [...S.sysState]; snap.disabled = S.disabledCount;
    }
    snap.cargo = S.cargo;
  }
  game = new Game({ image: IMAGE, fixes, balance, emit });
  game.newMission(missionFiles({ mission, crew }));
  for (let i = 0; i < 56 + wait; i++) game.tick();
  game.commands.begin();
  const decide = p.fire || p.eng || p.exam || p.repair || p.course || p.evade ? makePolicy(p, crewInfo(crew), mission) : null;
  let speedSet = false;
  for (let now = 0; !game.over && now < MAX_TICKS; now++) {
    if (game.started && game.S.textShown === 0 && !busy && game.queue.length === 0 && now % 20 === 0 && now > 500) {
      let cmd = null;
      if (!speedSet && !decide) { cmd = ['setSpeed', p.speed ?? 8, false]; speedSet = true; }
      else if (decide) cmd = decide(game.S, now);
      if (cmd) { busy = true; M.cmds++; game.commands[cmd[0]](...cmd.slice(1)); }
    }
    game.tick();
  }
  const S = game.S;
  M.result = game.result || 'timeout';
  M.invoice = game.invoice();
  M.total = M.invoice.total; M.minutes = S.minutes; M.late = S.minutes - S.timeLimit; M.cargo = S.cargo; M.pos = S.pos;
  for (let c = 1; c < 10; c++) if (S.killsByClass[c]) M.kills[c] = S.killsByClass[c];
  M.sysDestroyed = S.destroyedCount; M.disabledCount = S.disabledCount;
  M.avgSpeed = M.secs ? M.speedSum / M.secs : 0;
  delete M.speedSum;
  return M;
}

// node tools/bots/bot.mjs [policy] [mission] [fixesJSON]  — one quick run
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [policy = 'competent', mission = 'MISN1', fx = '{}'] = process.argv.slice(2);
  const t0 = Date.now();
  const r = runMission({ mission, crew: CREW.map(c => c[0]), wait: 100, policy, fixes: JSON.parse(fx) });
  console.log(JSON.stringify(r), Date.now() - t0, 'ms');
}
