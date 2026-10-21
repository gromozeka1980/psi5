// Engine equivalence check: runs the verified 1:1 port (no emulator needed) through a key script and replays every call
// of the original functions the engine replaces (engine CHECKS) through the engine: state before the call is extracted
// from DS, the engine step runs on it, and its result is compared field by field with the port's state after the call.
//   node tools/equiv.mjs [steps...]   steps as in tools/diff.mjs: w:N, k:<key>, r:N:seed ; env ONLY=f_16f3,f_37be
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { gameFiles, KEYS } from './emu/run.mjs';
import * as rt from '../web/src/rt.js';
import * as SEL from '../web/src/sel.js';
import * as PSI5 from '../web/src/psi5/index.js';
import { extract, diff } from '../web/src/engine/fields.js';
import { CHECKS, COMMON_FIELDS } from '../web/src/engine/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snap = n => new Uint8Array(fs.readFileSync(path.join(ROOT, 'web/data', n)));
const only = (process.env.ONLY || '').split(',').filter(Boolean);
const stats = {};
const events = [];
// The engine state is the union of all modules' fields (so a step can run nested engine steps, e.g. the combat view
// ticks that the original runs while printing text); every check compares the whole state.
const uniq = l => [...new Map(l.map(f => [f[0], f])).values()];
const SPEC = uniq([...COMMON_FIELDS, ...CHECKS.flatMap(c => c.fields)]);
const DSPEC = uniq(CHECKS.flatMap(c => c.data || []));
const combat = CHECKS.find(c => c.fn === 'f_6e26');
const ctx = { fixes: Object.fromEntries((process.env.FIXES || '').split(',').filter(Boolean).map(f => [f, true])),
  emit: (...e) => events.push(e),
  displayTick: (S, D) => { if (!combat) throw new Error('combat view engine (f_6e26) not registered'); combat.run(S, D, ctx); } };
let depth = 0;
for (const chk of CHECKS) {
  if (only.length && !only.includes(chk.fn)) continue;
  const orig = PSI5.F[chk.fn]; if (!orig) throw new Error('no port function ' + chk.fn);
  const spec = SPEC, st = stats[chk.fn] = { calls: 0, bad: 0, fields: {}, first: null };
  const before = () => ({ S: extract(spec, rt.ds), D: extract(DSPEC, rt.ds) });
  const check = (b, args) => {
    if (depth > 1) return;           // nested call (e.g. display tick while printing): covered by the outer check
    st.calls++;
    const want = extract(spec, rt.ds), S = structuredClone(b.S);
    let err = null;
    try { chk.run(S, b.D, ctx, ...args); } catch (e) { err = e; }
    const d = err ? ['exception: ' + err.stack.split('\n').slice(0, 3).join(' | ')] : diff(spec, S, want, 40);
    if (d.length) {
      st.bad++;
      for (const x of d) { const k = x.split(':')[0].replace(/\[\d+\]/, '[]'); st.fields[k] = (st.fields[k] || 0) + 1; }
      if (!st.first) st.first = { call: st.calls, tick: rt.hw.ticks, diff: d.slice(0, 12) };
    }
  };
  if (orig.constructor.name === 'GeneratorFunction')
    PSI5.F[chk.fn] = function* (...a) { depth++; try { const b = before(); const r = yield* orig(...a); check(b, a); return r; } finally { depth--; } };
  else PSI5.F[chk.fn] = (...a) => { depth++; try { const b = before(); const r = orig(...a); check(b, a); return r; } finally { depth--; } };
}
if (!Object.keys(stats).length) { console.log('no engine checks registered yet'); process.exit(0); }

// --- run SEL then PSI5 like PSIBAS, driven by the key script ---
rt.resetMachine();
rt.hw.files = Object.fromEntries(Object.entries(gameFiles()).map(([k, v]) => [k, v.slice()]));
let prog = 'SEL.EXE', gen = rt.load(SEL, snap('sel_ds.bin')), done = false;
function step() {
  let code = null;
  try { if (gen.next().done) code = 0; } catch (e) { if (e instanceof rt.Exit) code = e.code; else throw e; }
  if (code === null) return true;
  if (prog === 'PSI5.EXE') return false;
  prog = 'PSI5.EXE'; gen = rt.load(PSI5, snap('psi5_ds.bin')); return step();
}
const wait = n => { for (let i = 0; i < n; i++) { if (!step()) return false; rt.tick(); } return true; };
const key = name => { let k = KEYS[name]; if (!k && name[0] === '^' && name.length === 2) k = [name.charCodeAt(1) & 31, 0]; if (!k) k = [name.charCodeAt(0), 0]; rt.hw.keys.push((k[1] << 8) | k[0]); };
const RANDOM_KEYS = ['Enter', 'Up', 'Down', 'Left', 'Right', 'Space', '1', '2', '3', '4', 'A', 'W', 'E', 'R', 'S', 'N', 'C', 'D', 'F', 'B', 'Y', 'Bksp'];
outer: for (const s of process.argv.slice(2)) {
  const [op, a, b] = s.split(':');
  if (op === 'w') { if (!wait(+a)) break; }
  else if (op === 'k') key(a);
  else if (op === 'r') { let x = +b || 1; for (let i = 0; i < +a; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; key(RANDOM_KEYS[(x >> 16) % RANDOM_KEYS.length]); if (!wait(30)) break outer; } }
}
let bad = 0;
for (const [fn, st] of Object.entries(stats)) {
  console.log(`${fn}: ${st.calls} calls, ${st.bad} differ` + (st.bad ? `  fields: ${JSON.stringify(st.fields)}` : ''));
  if (st.first) console.log(`   first at call ${st.first.call} (tick ${st.first.tick}):\n     ` + st.first.diff.join('\n     '));
  if (st.bad) bad++;
}
console.log(`ticks ${rt.hw.ticks}`);
process.exit(bad ? 1 : 0);
