// Differential test: the original (tools/emu, idle-point time) vs the port (web/src), in lockstep.
// After every idle point both sides must have identical DS (below the stack), VRAM, IVT/BIOS data area and
// CGA/PIT/PIC/speaker state. Stops at the first difference and writes PNGs of both screens.
//   node tools/diff.mjs [steps...]      steps: w:N (N idle points), k:<key> (Enter Esc Up Down Left Right Space Bksp ^X or a char),
//                                              s (screenshot both), r:N:seed (N random keys, w:30 between)
// Env: QUIET=1 (no progress), MAXIDLE (stop after this many idle points total)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { PC } from './emu/pc.js'; import { gameFiles, KEYS } from './emu/run.mjs';
import { PNG } from '../_dosref/png.mjs';
import * as rt from '../web/src/rt.js';
import * as SEL from '../web/src/sel.js';
import * as PSI5 from '../web/src/psi5/index.js';
import { Hybrid } from './hybrid.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.DIFFOUT || 'tools/diffout'); fs.mkdirSync(OUT, { recursive: true });
const PROGS = { 'SEL.EXE': SEL, 'PSI5.EXE': PSI5 };
const portedPsi5 = Object.keys(PSI5.F).filter(n => /^f_/.test(n));
const ran = {};                                                    // calls that actually went through ported code
for (const n of portedPsi5) { const f = PSI5.F[n]; if (typeof f !== 'function') continue;
  const isGen = f.constructor.name === 'GeneratorFunction';
  PSI5.F[n] = isGen ? function* (...a) { ran[n] = (ran[n] || 0) + 1; return yield* f(...a); } : (...a) => { ran[n] = (ran[n] || 0) + 1; return f(...a); };
  Object.defineProperty(PSI5.F[n], 'length', { value: f.length }); }
for (const n of (process.env.DROP || '').split(',').filter(Boolean)) delete PSI5.F[n];
new Hybrid('PSI5.EXE', gameFiles()).install(PSI5.F, PSI5.isrs);   // unported functions run as original code
console.log(`PSI5 port: ${portedPsi5.length} functions ported, the rest run as original code`);
const files = gameFiles();
const snap = exe => new Uint8Array(fs.readFileSync(path.join(ROOT, 'web/data', exe.split('.')[0].toLowerCase() + '_ds.bin')));
// end of the data image in DS: everything above is stack (contents differ between original and port)
function dataEnd(exe) {
  const d = files[exe], h = i => d[i] | (d[i + 1] << 8);
  const img = (h(4) - 1) * 512 + (h(2) || 512) - h(8) * 16, dsOff = (d[h(8) * 16 + 0x10] | (d[h(8) * 16 + 0x11] << 8)) * 16;
  return img - dsOff;
}

const pc = new PC({ files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.slice()])) });
rt.hw.files = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.slice()]));
let exe, gen, limit, idle = 0, done = false;
function start(name) {
  exe = name; limit = dataEnd(name);
  pc.load(name); pc.breakAt = 0x0082;
  if (pc.stepIdle() !== 'break') throw new Error('main not reached'); pc.breakAt = undefined;
  gen = rt.load(PROGS[name], snap(name));
  console.log(`== ${name} (DS compared up to ${limit.toString(16)})`);
}
function savePng(file, f16) { const o = new Uint8Array(64000 * 4); for (let i = 0; i < 64000; i++) o.set([...rt.CGA_RGB[f16[i]], 255], i * 4); fs.writeFileSync(file, PNG.encode(320, 200, o)); }
function shots(tag) { savePng(path.join(OUT, tag + '_orig.png'), pc.frame()); savePng(path.join(OUT, tag + '_port.png'), rt.frame16()); }
function hex(n, w = 4) { return n.toString(16).padStart(w, '0'); }
function compare() {
  const m = pc.cpu.mem, d = pc.dseg * 16, bad = [];
  for (let i = 0; i < limit && bad.length < 12; i++) if (m[d + i] !== rt.ds[i]) bad.push(`ds:${hex(i)} orig ${hex(m[d + i], 2)} port ${hex(rt.ds[i], 2)}`);
  for (let i = 0; i < 0x4000 && bad.length < 12; i++) if (m[0xb8000 + i] !== rt.vram[i]) bad.push(`vram:${hex(i)} orig ${hex(m[0xb8000 + i], 2)} port ${hex(rt.vram[i], 2)}`);
  for (let i = 0; i < 0x500 && bad.length < 12; i++) if (m[i] !== rt.low[i]) bad.push(`low:${hex(i)} orig ${hex(m[i], 2)} port ${hex(rt.low[i], 2)}`);
  for (const k of ['cgaSel', 'picMask', 'port61']) if (pc[k] !== rt.hw[k]) bad.push(`${k} orig ${pc[k]} port ${rt.hw[k]}`);
  if (pc.pitDiv.join() !== rt.hw.pitDiv.join()) bad.push(`pit orig ${pc.pitDiv} port ${rt.hw.pitDiv}`);
  return bad;
}
// one idle point on both sides; returns false when both programs ended
function step() {
  const r = pc.stepIdle();
  let pr; try { pr = gen.next(); } catch (e) { if (!(e instanceof rt.Exit)) throw e; pr = { done: true, exit: e.code }; }
  const origExit = r === 'exit', portExit = pr.done;
  if (origExit !== portExit) { shots('end'); throw new Error(`${exe}: original ${origExit ? 'exited (' + pc.exitCode + ')' : 'idle'}, port ${portExit ? 'exited' : 'idle'} at idle #${idle}`); }
  if (origExit) {
    const code = pc.exitCode, pcode = pr.exit ?? 0;
    if (code !== pcode) throw new Error(`exit code orig ${code} port ${pcode}`);
    console.log(`${exe} exited ${code} at idle #${idle}`);
    for (const f of new Set([...Object.keys(pc.files), ...Object.keys(rt.hw.files)]))
      if (String(pc.files[f]) !== String(rt.hw.files[f])) throw new Error(`file ${f} differs after ${exe}`);
    if (exe === 'PSI5.EXE' && code === 3) return false;
    const next = exe === 'SEL.EXE' ? 'PSI5.EXE' : 'SEL.EXE';
    if (!PROGS[next]) { console.log(`(${next} not ported yet)`); return false; }
    start(next); return true;
  }
  idle++;
  const bad = compare();
  if (bad.length) { shots('diff'); console.log(`DIFF at idle #${idle} (${exe}, ticks ${pc.ticks}):\n  ` + bad.join('\n  ')); process.exit(1); }
  return true;
}
function tick() { pc.tick(); rt.tick(); }
function key(name) {
  let k = KEYS[name]; if (!k && name[0] === '^' && name.length === 2) k = [name.charCodeAt(1) & 31, 0];
  if (!k) k = [name.charCodeAt(0), 0];
  pc.key(k[0], k[1]); rt.hw.keys.push((k[1] << 8) | k[0]);
}
function wait(n) { for (let i = 0; i < n; i++) { if (!step()) return false; tick(); } return true; }

rt.resetMachine();
rt.hw.files = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.slice()]));
start('SEL.EXE');
let shotN = 0;
const RANDOM_KEYS = ['Enter', 'Up', 'Down', 'Left', 'Right', 'Esc', 'Space', '1', '2', '3', '4', 'A', 'W', 'E', 'R', 'S', 'N', 'Q', 'B', 'Y'];
outer: for (const s of process.argv.slice(2)) {
  const [op, a, b] = s.split(':');
  if (op === 'w') { if (!wait(+a)) break; }
  else if (op === 'k') key(a);
  else if (op === 's') shots('s' + String(shotN++).padStart(2, '0'));
  else if (op === 'r') {
    let x = +b || 1;
    for (let i = 0; i < +a; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; key(RANDOM_KEYS[(x >> 16) % RANDOM_KEYS.length]); if (!wait(30)) break outer; }
  }
}
shots('final');
console.log(`OK: ${idle} idle points identical (${exe}, ticks ${pc.ticks})`);
const notRun = portedPsi5.filter(n => /^f_/.test(n) && !ran[n]);
console.log(`ported PSI5 functions exercised: ${portedPsi5.length - notRun.length}/${portedPsi5.length}` + (notRun.length ? `; not run: ${notRun.join(' ')}` : ''));
