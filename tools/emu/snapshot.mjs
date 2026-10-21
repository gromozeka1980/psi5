// Dumps DGROUP (64 KB) of SEL.EXE / PSI5.EXE at entry to main() (CS:0082) -> web/data/<exe>_ds.bin.
// This is the port's initial memory: original initialized data + whatever the MS-C startup set up.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { PC } from './pc.js'; import { gameFiles } from './run.mjs';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/data');
export function atMain(exe) {
  const pc = new PC({ files: gameFiles() }); pc.load(exe); pc.breakAt = 0x0082;
  if (pc.stepIdle() !== 'break') throw new Error('main not reached');
  return pc;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) for (const exe of ['SEL.EXE', 'PSI5.EXE']) {
  const pc = atMain(exe), ds = pc.dseg * 16;
  fs.writeFileSync(path.join(OUT, exe.split('.')[0].toLowerCase() + '_ds.bin'), pc.cpu.mem.subarray(ds, ds + 0x10000));
  console.log(exe, 'DS', pc.dseg.toString(16), 'SP', pc.cpu.r[4].toString(16), 'icount', pc.cpu.icount);
}
