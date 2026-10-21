// debug: node tools/emu/peek.mjs <ms> [keys...] -> screenshot + CS:IP + PSI5 state
import { boot, KEYS, savePng } from './run.mjs';
const [ms, ...ks] = process.argv.slice(2);
const { pc, run } = boot();
run(4000); pc.key(13, 0x1c); run(500); pc.key(4, 0x20);
run(+ms);
console.log(pc.prog, 'ticks', pc.ticks, 'cs:ip', pc.cpu.s[1].toString(16) + ':' + pc.cpu.ip.toString(16));
savePng('re/shots/peek.png', pc);
