// node tools/emu/run.mjs <outprefix> step...   steps: w:ms (virtual), k:<char|Enter|Esc|Up..>, s (screenshot)
// Runs PSIBAS's loop: SEL.EXE, then PSI5.EXE, repeat until exit code 3.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { PC } from './pc.js';
import { PNG } from '../../_dosref/png.mjs';
const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export function gameFiles() { const f = {}; for (const n of fs.readdirSync(GAME)) if (/\.(BIN|EXE)$/i.test(n) && !/^unins/i.test(n)) f[n.toUpperCase()] = new Uint8Array(fs.readFileSync(path.join(GAME, n))); return f; }
export const KEYS = { Enter: [13, 0x1c], Esc: [27, 1], Space: [32, 0x39], Up: [0, 0x48], Down: [0, 0x50], Left: [0, 0x4b], Right: [0, 0x4d], Bksp: [8, 0x0e], Home: [0, 0x47], End: [0, 0x4f] };
export function savePng(file, pc) { fs.writeFileSync(file, PNG.encode(320, 200, pc.rgba())); }
export function boot(opts = {}) {
  const pc = new PC({ files: gameFiles(), log: opts.log || (() => {}) });
  pc.load('SEL.EXE');
  // PSIBAS: SEL, PSI5, repeat until PSI5 exits with code 3
  pc.next = () => { const code = pc.exitCode; (opts.log || (() => {}))(`${pc.prog} exit ${code}`); if (pc.prog === 'PSI5.EXE' && code === 3) return false; pc.load(pc.prog === 'SEL.EXE' ? 'PSI5.EXE' : 'SEL.EXE'); return true; };
  const run = ms => { const end = pc.vt + ms * 1193.182; while (pc.vt < end) { if (pc.run((end - pc.vt) / 1193.182) === 'exit' && !pc.next()) return 'quit'; } return 'time'; };
  return { pc, run };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [out, ...steps] = process.argv.slice(2);
  const { pc, run } = boot({ log: m => console.log('  ', m) });
  let n = 0; const shot = () => savePng(`${out}_${String(n++).padStart(2, '0')}.png`, pc);
  for (const s of steps) {
    const op = s[0], arg = s.slice(2);
    if (op === 'w') console.log(s, run(+arg), 'ticks', pc.ticks, 'cs:ip', pc.cpu.s[1].toString(16), pc.cpu.ip.toString(16));
    else if (op === 's') shot();
    else if (op === 'k') { const k = KEYS[arg] || [arg.charCodeAt(0), 0]; pc.key(k[0], k[1]); }
  }
  shot();
}
