// Whole-game equivalence: runs the 1:1 port (SEL, then PSI5) with a key script, records the semantic commands the
// player's keys produced (wrapping the port's menu actions where they commit: the "Processing command" flash @06f4,
// plus pause/resume, the briefing key, and the demo's key-before-step timing), and runs web/src/engine/game.js
// standalone from the same files with the same commands at the same ticks. After every tick the whole game state
// (every engine module's FIELDS, the game loop's own fields and the small DATA tables) is compared byte for byte.
//   node tools/equiv_game.mjs [steps...]   steps: w:N (N ticks), k:<key>, r:N:seed (N random keys, 30 ticks apart),
//     q:N:seed (N random menu keys incl. Esc/Home, 5..150 ticks apart), m:N:seed (N random complete menu commands of
//     every department), p:field:index:value (test poke into both, e.g. p:deptAlive:3:0 kills the engineer)
//   VERBOSE=1 prints every recorded command. Exit code 1 and the differing fields on the first difference.
// Crew/course: w:300 k:Enter w:40 k:<course 1-4> w:40, per department [k:Right w:20]x(pick) k:Enter w:40 k:Enter w:40,
// then w:1500 k:Enter w:600 k:Space. Demo: w:300 k:Enter w:60 k:^D w:7000 w:200000. See docs/modern/GAME.md.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { gameFiles, KEYS } from './emu/run.mjs';
import * as rt from '../web/src/rt.js';
import * as SEL from '../web/src/sel.js';
import * as PSI5 from '../web/src/psi5/index.js';
import { extract, diff } from '../web/src/engine/fields.js';
import { Game, STATE_SPEC } from '../web/src/engine/game.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snap = n => new Uint8Array(fs.readFileSync(path.join(ROOT, 'web/data', n)));
const IMAGE = snap('psi5_ds.bin');
const SIZE = { i16: 2, u16: 2, i8: 1, u8: 1 };
const { rw, rs } = rt;
const VERBOSE = !!process.env.VERBOSE;

// compared every tick: every field except the big constant tables (compared once at the end), the sprites (f_631e
// stores each sprite's draw position into its header: presentation, never read by the engine) and the sound flags
const CONST = ['routeMasks', 'courseMasks', 'rowOffsets', 'spriteTables', 'dashImage'];
const BIG = STATE_SPEC.filter(f => CONST.includes(f[0]));
const TICK_SPEC = STATE_SPEC.filter(f => !CONST.includes(f[0]) && !['sprites', 'spritesFar', 'soundOn', 'joystickOn'].includes(f[0]));
const ranges = (() => {
  const r = TICK_SPEC.map(([, a, t, n]) => [a, a + SIZE[t] * n]).sort((x, y) => x[0] - y[0]), out = [];
  for (const [a, b] of r) if (out.length && a <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], b); else out.push([a, b]);
  return out;
})();
const same = (m) => { for (const [a, b] of ranges) for (let i = a; i < b; i++) if (m[i] !== rt.ds[i]) return false; return true; };
const fieldDiff = (spec, m) => diff(spec, extract(spec, m), extract(spec, rt.ds), 24);

// ---------------------------------------------------------------- recorder (instrumented port)
const F = PSI5.F;
let seg = -1, game = null, demo = false, recording = false, ended = null;
const rec = [];                                  // [seg, name, ...args]
const stack = [];                                // active menu actions
const counts = {};
function record(name, ...args) {
  if (!recording) return;
  const r = [seg, name, ...args]; rec.push(r); counts[name] = (counts[name] || 0) + 1;
  if (VERBOSE) console.log('  rec', JSON.stringify(r));
  return r;
}
function wrapGen(name, onEnter) {
  const orig = F[name];
  F[name] = function* (...a) {
    const e = { fn: name, args: a, entry: onEnter ? onEnter(...a) : null };
    stack.push(e);
    try { return yield* orig(...a); } finally { stack.splice(stack.lastIndexOf(e), 1); }
  };
}
// action -> command at the moment its flash starts (locals: the action's frame() is at hw.sp)
const pick = sp => rs(0x348 + rs(sp) * 2);
const ACTIONS = {
  f_0f17: () => ['view', 0, false], f_0f54: () => ['view', 0, true],
  f_1de2: () => ['view', 1, false], f_1e25: () => ['view', 1, true],
  f_2a53: () => ['view', 2, false], f_2a90: () => ['view', 2, true],
  f_3462: () => ['view', 3, false], f_349f: () => ['view', 3, true],
  f_3ccd: () => ['view', 4, false], f_3d10: () => ['view', 4, true],
  f_0f97: sp => ['cancelOrder', pick(sp)],
  f_101d: sp => ['rankOrder', pick(sp), rs(sp + 2)],
  f_1172: (sp, e) => e.entry.full ? ['refuse'] : ['fire', rs(sp), rw(0x16ca), rw(0x16cc), rs(sp + 2)],
  f_132d: sp => ['fireOnly', rs(sp), rw(0x16cc)],
  f_1e68: sp => ['cancelExamine', rs(sp)],
  f_1ee5: sp => ['examine', rs(sp), rs(sp + 2)],
  f_1fbe: (sp, e) => e.entry.full ? ['refuse'] : ['examine', rs(sp), rs(sp + 2)],
  f_20eb: sp => ['examine', rs(sp), 0],
  f_2acd: () => ['cancelManeuver'],
  f_2ae7: () => ['setCourse', rw(0x2de)],
  f_2b90: () => ['setSpeed', rw(0x2e0), rw(0x2e0) !== 0 && rw(0x4cec) !== 0 && rw(0x2e2) === 1],
  f_34dc: () => ['deviceOff', rw(0x2e6)], f_3662: () => ['deviceOn', rw(0x2ec)],
  f_356b: () => ['rankDevice', rw(0x2e8), rw(0x2ea)],
  f_3d53: sp => ['repairCancel', pick(sp)],
  f_3dd4: sp => ['repairRank', pick(sp), rs(sp + 2)],
  f_3f29: (sp, e) => e.entry.full ? ['refuse'] : ['repairAssign', pick(sp), rw(0x1b18) + 1, rs(sp + 2)],
  f_408f: sp => ['repairOnly', pick(sp)],
  f_033e: (sp, e) => ['acknowledge', e.args[0]],
  f_0256: () => ['clearMessages'],
  f_0384: sp => ['autoAnswer', rw(sp) === 0],
  f_0786: () => ['nextMessage'],
};
const ENTRY = {
  f_1172: () => ({ full: rs(0x506) >= 8 }), f_1fbe: () => ({ full: rs(0x9d4) >= 8 }), f_3f29: () => ({ full: rs(0x11d0) >= 8 }),
  f_20eb: () => { record('clearExamList'); return null; },
};
for (const fn of Object.keys(ACTIONS)) wrapGen(fn, ENTRY[fn]);
{
  const flash = F.f_06f4;
  F.f_06f4 = function* () {
    const top = stack[stack.length - 1];
    if (!top) { if (recording) console.log(`WARN flash without a known action at seg ${seg}`); }
    else record(...ACTIONS[top.fn](rt.hw.sp, top));
    return yield* flash();
  };
}
{
  const init = F.f_5247; F.f_5247 = () => { if (!demo) record('begin'); return init(); };
  const draw = F.f_0988; let pausing = false;
  F.f_0988 = p => { if (p === 0x253e) { record('pause'); pausing = true; } return draw(p); };
  const redraw = F.f_08e6; F.f_08e6 = () => { if (pausing) { record('resume'); pausing = false; } return redraw(); };
  const poll = F.f_5a79; let ui = null;
  F.f_5a79 = function* () { const k = yield* poll(); if (demo && k !== 0) ui = record('uiKey', false); return k; };
  const disp = F.f_6e26; F.f_6e26 = () => { if (ui && ui[0] === seg) ui[2] = true; return disp(); };

  for (const n of ['f_5b5f', 'f_6bc7']) { const o = F[n]; F[n] = () => { ended ??= 'quit'; return o(); }; }
}
// the report (@55f9) computes the pay (@5840, called directly) and then sets phase 2
const payDone = () => rw(0x3b2) === 2;

// ---------------------------------------------------------------- the game, created when PSI5 starts
function startGame() {
  const files = rt.hw.files, sel = files['SELECT.BIN'];
  const name = i => { let s = ''; for (let k = 0; k < 16 && sel[i * 16 + k]; k++) s += String.fromCharCode(sel[i * 16 + k]); return s.trim().replace(/^.*[\\:]/, '').toUpperCase(); };
  const file = n => files[Object.keys(files).find(k => k.toUpperCase() === n)];
  demo = (sel[0x60] | sel[0x61] << 8) !== 0;
  game = new Game({ image: IMAGE });
  game.newMission({ missionFile: file(name(0)), crewFiles: [1, 2, 3, 4, 5].map(i => file(name(i))), dashFile: file('DASH.BIN'),
    flags: { demo, sound: sel[0x62], joystick: sel[0x63] } });
  console.log(`PSI5 start: ${[0, 1, 2, 3, 4, 5].map(name).join(' ')}${demo ? ' (demo)' : ''}`);
  seg = 0; recording = true;
}
let compared = 0, fed = 0, phase = 'run';
function fail(msg, d) {
  console.log(`DIFF at tick ${seg} (${msg}):\n  ` + d.join('\n  '));
  console.log('last commands:', JSON.stringify(rec.filter(r => r[0] <= seg).slice(-6)));
  process.exit(1);
}
function afterTick() {
  while (fed < rec.length && rec[fed][0] <= seg) {
    const [s, name, ...args] = rec[fed++];
    if (s < seg) console.log(`WARN late command ${name} from ${s} at ${seg}`);
    game.commands[name](...args);
  }
  game.tick();
  if (phase === 'run') {
    const arrived = game.result === 'arrived';   // the port is inside the arrival pause (mid navigation step)
    if (!arrived) { compared++; if (!same(game.mem)) fail('per tick', fieldDiff(TICK_SPEC, game.mem)); }
    if (game.over) {
      console.log(`mission over at tick ${seg}: ${game.result}`);
      recording = false;
      phase = game.result === 'arrived' ? 'arrival' : 'done';
      endTick = seg + 300;
    }
  } else if (phase === 'arrival' && seg >= endTick) {
    // a key typed during the pause is handled in its last tick: in phase 1 that can already open the report (pay, phase 2)
    const d = fieldDiff(TICK_SPEC.filter(f => !/^(inv|bountySum|missionPhase)/.test(f[0])), game.mem);
    if (d.length) fail('after the arrival pause', d);
    console.log(`state equal after the arrival pause (tick ${seg})`);
    phase = 'done';
  }
  seg++;
}
let endTick = 0;

// ---------------------------------------------------------------- runner (as tools/equiv.mjs)
rt.resetMachine();
rt.hw.files = Object.fromEntries(Object.entries(gameFiles()).map(([k, v]) => [k, v.slice()]));
let prog = 'SEL.EXE', gen = rt.load(SEL, snap('sel_ds.bin'));
function step() {
  let code = null;
  try { if (gen.next().done) code = 0; } catch (e) { if (e instanceof rt.Exit) code = e.code; else throw e; }
  if (code === null) return true;
  if (prog === 'PSI5.EXE') { ended ??= 'exit'; return false; }
  prog = 'PSI5.EXE'; gen = rt.load(PSI5, snap('psi5_ds.bin')); startGame(); return step();
}
const wait = n => {
  for (let i = 0; i < n; i++) {
    if (!step()) return false;
    rt.tick();
    if (game && !ended) afterTick();
    if (ended || (phase === 'done' && (demo || payDone()))) return false;
  }
  return true;
};
const key = name => { let k = KEYS[name]; if (!k && name[0] === '^' && name.length === 2) k = [name.charCodeAt(1) & 31, 0]; if (!k) k = [name.charCodeAt(0), 0]; rt.hw.keys.push((k[1] << 8) | k[0]); };
const RANDOM_KEYS = ['Enter', 'Up', 'Down', 'Left', 'Right', 'Space', '1', '2', '3', '4', 'A', 'W', 'E', 'R', 'S', 'N', 'C', 'D', 'F', 'B', 'Y', 'Bksp'];
const MENU_KEYS = ['Enter', 'Enter', 'Right', 'Left', 'Bksp', 'Bksp', 'Bksp', 'Home', '?', 'Esc', 'A', 'W', 'S', 'N', 'E', 'R',
  'C', 'D', 'F', 'M', 'B', 'T', 'G', 'H', 'L', '1', '2', '3', '4', '5', '6', '7', '8', 'A', 'W', 'S', 'N', 'E', 'R'];
// m:N:seed — N random complete menu commands (key sequences of every department; keys 0..40 ticks apart, so some
// arrive together or during a flash), 0..900 ticks between commands
const pickOf = (rnd, s) => s[rnd() % s.length];
const MACROS = [
  r => ['Home', 'W', 'F', pickOf(r, 'A123456789'), pickOf(r, 'MBCT'), 'Enter', 'Enter'],
  r => ['Home', 'W', 'F', pickOf(r, 'A12'), pickOf(r, 'MBCT'), pickOf(r, 'ABCDEFGH'), pickOf(r, '123')],
  r => ['Home', 'W', 'C', 'Enter'], r => ['Home', 'W', 'R', 'Enter', pickOf(r, '123')],
  r => ['Home', 'W', pickOf(r, 'SD?')],
  r => ['Home', 'S', 'E', 'Enter', 'Enter'], r => ['Home', 'S', 'E', pickOf(r, 'ABCDEFGH'), pickOf(r, '12')],
  r => ['Home', 'S', 'C', 'Enter'], r => ['Home', 'S', 'R', 'Enter', pickOf(r, '12')], r => ['Home', 'S', pickOf(r, 'SD?')],
  r => ['Home', 'N', 'R', pickOf(r, 'ABCDE')], r => ['Home', 'N', 'A', pickOf(r, 'S12345678'), pickOf(r, 'SEE')],
  r => ['Home', 'N', 'A', pickOf(r, '45678'), 'S'], r => ['Home', 'N', 'C'], r => ['Home', 'N', pickOf(r, 'SD?')],
  r => ['Home', 'E', pickOf(r, 'CE'), pickOf(r, 'ABCDEFGHIJKL')], r => ['Home', 'E', 'R', pickOf(r, 'ABCDEF'), pickOf(r, '123456')],
  r => ['Home', 'E', pickOf(r, 'SD?')],
  r => ['Home', 'R', 'A', pickOf(r, '1234567'), 'Enter', 'Enter'], r => ['Home', 'R', 'C', 'Enter'],
  r => ['Home', 'R', 'R', 'Enter', pickOf(r, '12')], r => ['Home', 'R', 'F', 'Enter'], r => ['Home', 'R', pickOf(r, 'SD?')],
  r => ['Home', 'A', pickOf(r, 'WSNER?')], r => ['Home', 'A', 'C'], r => ['Home', 'A', 'A', pickOf(r, 'EDD')],
  r => ['Esc', 'Space'], r => ['?'], r => [pickOf(r, ['Left', 'Right', 'Enter', 'Bksp'])],
];
outer: for (const s of process.argv.slice(2)) {
  const [op, a, b] = s.split(':');
  if (op === 'w') { if (!wait(+a)) break; }
  else if (op === 'k') key(a);
  else if (op === 'p') {                     // p:field:index:value — test poke into both (e.g. kill an officer)
    const [, name, idx, val] = s.split(':'), f = STATE_SPEC.find(x => x[0] === name), adr = f[1] + SIZE[f[2]] * +idx;
    for (const m of [rt.ds, game.mem]) { m[adr] = +val & 0xff; if (SIZE[f[2]] === 2) m[adr + 1] = (+val >> 8) & 0xff; }
  }
  else if (op === 'r' || op === 'q' || op === 'm') {
    let x = +b || 1;
    const rnd = () => (x = (x * 1103515245 + 12345) & 0x7fffffff) >> 16;
    for (let i = 0; i < +a; i++) {
      if (op === 'r') { key(RANDOM_KEYS[rnd() % RANDOM_KEYS.length]); if (!wait(30)) break outer; }
      else if (op === 'm') {
        for (const k of MACROS[rnd() % MACROS.length](rnd)) { key(k); if (!wait(rnd() % 41)) break outer; }
        if (!wait(rnd() % 901)) break outer;
      }
      else { key(MENU_KEYS[rnd() % MENU_KEYS.length]); if (!wait(5 + rnd() % 146)) break outer; }
    }
  }
}
// ---------------------------------------------------------------- end of mission: invoice
if (game && phase === 'done') {
  if (!payDone()) F.f_5840();
  const inv = game.invoice();
  const PAY = STATE_SPEC.filter(f => /^(inv|bountySum)/.test(f[0]));
  const d = fieldDiff(PAY, game.mem);
  if (d.length) fail('invoice', d);
  console.log(`invoice equal: total ${inv.total / 10} M$ (cargo ${inv.cargo}, early ${inv.early}, bounties ${inv.bounties}, repairs ${inv.repairs})`);
}
if (game) {
  const d = fieldDiff(BIG, game.mem);
  if (d.length) fail('constant tables', d);
}
console.log(`ticks compared: ${compared} (PSI5 ticks run ${seg}), differences: 0; commands: ${JSON.stringify(counts)}${ended ? '; session ended: ' + ended : ''}`);
