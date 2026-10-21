// Records real calls of the original's functions for tools/fcheck.mjs: runs the original (tools/emu, PSIBAS loop) through
// a scenario and, on entry to game functions, saves the whole machine state (DS, VRAM, low memory, CPU, hardware).
//   node tools/record.mjs <scenario> [maxPerFunction]       scenarios: demo, play1, play2, ...  (see SCENARIOS)
// Output: tools/calls/<EXE>/<f_xxxx>.json.gz (appends to existing recordings, max per function).
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib'; import { fileURLToPath } from 'node:url';
import { boot, KEYS } from './emu/run.mjs';
import { callgraph } from './hybrid.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [scenario = 'demo', maxArg = '12'] = process.argv.slice(2); const MAX = +maxArg;
const { pc, run } = boot();
const key = name => { let k = KEYS[name]; if (!k && name[0] === '^') k = [name.charCodeAt(1) & 31, 0]; if (!k) k = [name.charCodeAt(0), 0]; pc.key(k[0], k[1]); };
let rnd = 12345; const rand = n => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return (rnd >> 16) % n; };

// Each scenario: list of [ms, action]
const selectCrew = () => { run(4000); key('Enter'); run(400); for (let i = 0; i < 12; i++) { key('Enter'); run(400); } };
const SCENARIOS = {
  demo() { run(4000); key('Enter'); run(500); key('^D'); run(60000 + 400000); },
  play(seed, minutes) {
    rnd = seed; selectCrew(); run(5000); key('Enter'); run(2000);
    const K = ['A', 'W', 'S', 'N', 'E', 'R', 'Enter', 'Enter', 'Up', 'Down', 'Left', 'Right', 'Bksp', 'Esc', '1', '2', '3', '4', '5', '6',
      'B', 'C', 'D', 'F', 'G', 'H', 'I', 'L', 'M', 'O', 'P', 'T', 'U', 'V', 'X', 'Y', 'Z', '?', 'Space'];
    const end = pc.vt + minutes * 60 * 1193182;
    while (pc.vt < end) { const k = K[rand(K.length)]; if (k === 'Esc') { key('Esc'); run(300); key('Space'); } else key(k); run(150 + rand(1500)); }
  },
};
SCENARIOS.quit = () => {             // quit menu paths: Oops, Replay -> Same crew (restart), Replay -> New crew, Quit
  selectCrew(); run(5000); key('Enter'); run(3000);
  key('Q'); run(1500); key('O'); run(1500); key('W'); run(2000); key('Bksp'); run(1000);
  key('Q'); run(1500); key('R'); run(1500); key('S'); run(15000); key('Enter'); run(3000);
  key('N'); run(2000); key('Bksp'); run(1000); key('Q'); run(1500); key('R'); run(1500); key('N'); run(20000);
  selectCrew(); run(5000); key('Enter'); run(3000); key('Q'); run(1500); key('Q'); run(1500); key('Enter'); run(10000);
};
SCENARIOS.long = () => { SCENARIOS.play(7, 240); };   // long voyage with random commands: reaches mission end
SCENARIOS.play1 = () => SCENARIOS.play(1, 30);
SCENARIOS.play2 = () => SCENARIOS.play(2, 30);
SCENARIOS.play3 = () => SCENARIOS.play(3, 60);

const recs = {}, counts = {};
const OUT = exe => path.join(ROOT, 'tools/calls', exe);
function load(exe, name) { const f = path.join(OUT(exe), name + '.json.gz'); return fs.existsSync(f) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(f))) : []; }
const want = n => n <= 3 || (n & (n - 1)) === 0 || n % 997 === 0;     // first calls, powers of two, and a sprinkle
let armedFor = null;
function arm() {
  if (armedFor === pc.prog + pc.base) return; armedFor = pc.prog + pc.base;
  const exe = pc.prog, cg = callgraph(exe), c = pc.cpu;
  c.trap = new Uint8Array(0x10000); c.trapCS = pc.base;
  for (const n of Object.keys(cg)) c.trap[parseInt(n.slice(2), 16)] = 1;
  c.onTrap = ip => {
    const name = 'f_' + ip.toString(16).padStart(4, '0'), k = exe + '/' + name;
    counts[k] = (counts[k] || 0) + 1;
    if (!want(counts[k])) return;
    if (!recs[k]) recs[k] = load(exe, name);
    if (recs[k].length >= MAX) { recs[k].splice(rand(recs[k].length), 1); }   // keep a varied sample
    const m = c.mem, d = pc.dseg * 16;
    const blob = Buffer.concat([m.subarray(d, d + 0x10000), m.subarray(0xb8000, 0xbc000), m.subarray(0, 0x500)]);
    recs[k].push({ scenario, n: counts[k], r: Array.from(c.r), s: Array.from(c.s), flags: c.flags,
      hw: { cgaSel: pc.cgaSel, cgaMode: pc.cgaMode, picMask: pc.picMask, port61: pc.port61, pitDiv: pc.pitDiv, pitLatch: pc.pitLatch, ticks: pc.ticks, keys: pc.keys.slice() },
      mem: zlib.deflateRawSync(blob).toString('base64') });
  };
}
// re-arm on every program start
const origLoad = pc.load.bind(pc); pc.load = (...a) => { origLoad(...a); armedFor = null; arm(); };
arm();
SCENARIOS[scenario]();
for (const [k, v] of Object.entries(recs)) {
  const [exe, name] = k.split('/'); fs.mkdirSync(OUT(exe), { recursive: true });
  const f = path.join(OUT(exe), name + '.json.gz'); fs.writeFileSync(f + '.tmp', zlib.gzipSync(JSON.stringify(v))); fs.renameSync(f + '.tmp', f);
}
const cg = callgraph('PSI5.EXE'), seen = Object.keys(cg).filter(n => counts['PSI5.EXE/' + n]);
console.log(`${scenario}: PSI5 functions called ${seen.length}/${Object.keys(cg).length}; ticks ${pc.ticks}`);
console.log('never called:', Object.keys(cg).filter(n => !counts['PSI5.EXE/' + n]).join(' '));
