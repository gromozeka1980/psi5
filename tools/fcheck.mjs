// Per-function differential check: replays recorded calls (tools/record.mjs) of original functions through the port.
// For every recorded call: the original runs from the recorded state to its return (tools/emu); the port function runs
// from the same state (callees not ported yet run as original code, see hybrid.mjs); then DS (below the stack), VRAM,
// low memory, hardware state and the return value are compared.
//   node tools/fcheck.mjs [EXE] [f_xxxx ...]     (default PSI5.EXE, all ported non-generator functions with recordings)
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib'; import { fileURLToPath } from 'node:url';
import { gameFiles } from './emu/run.mjs';
import { Hybrid, REGARGS, ISRS } from './hybrid.mjs';
import * as rt from '../web/src/rt.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let args = process.argv.slice(2); const exe = /\.EXE$/i.test(args[0] || '') ? args.shift().toUpperCase() : 'PSI5.EXE';
const files = gameFiles();
const { F, isrs } = await import('../web/src/' + (exe === 'SEL.EXE' ? 'sel.js' : 'psi5/index.js'));
const hy = new Hybrid(exe, files);
for (const n of (process.env.DROP || '').split(',').filter(Boolean)) delete F[n];   // DROP=f_x,f_y: run these as original code
const ported = Object.keys(F).filter(n => /^f_[0-9a-f]{4}$/.test(n));
hy.install(F, isrs);
const pc = hy.pc, c = pc.cpu;
const d = files[exe], h = i => d[i] | (d[i + 1] << 8);
const LIMIT = (h(4) - 1) * 512 + (h(2) || 512) - h(8) * 16 - pc.dseg * 16 + pc.base * 16;   // end of data image in DS
const names = args.length ? args : ported.filter(n => !hy.cg[n]?.gen);
const hex = (n, w = 4) => (n & 0xffff).toString(16).padStart(w, '0');

function restore(rec) {
  const blob = zlib.inflateRawSync(Buffer.from(rec.mem, 'base64'));
  rt.ds.set(blob.subarray(0, 0x10000)); rt.vram.set(blob.subarray(0x10000, 0x14000)); rt.low.set(blob.subarray(0x14000, 0x14500));
  Object.assign(rt.hw, { cgaSel: rec.hw.cgaSel, cgaMode: rec.hw.cgaMode, picMask: rec.hw.picMask, port61: rec.hw.port61,
    pitDiv: rec.hw.pitDiv.slice(), pitLatch: rec.hw.pitLatch.slice(), ticks: rec.hw.ticks, keys: rec.hw.keys.slice(), pendingIrq: false, spk: [] });
  rt.hw.files = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.slice()]));
  rt.hw.isrs = isrs;
}
function snapshot() { return { ds: rt.ds.slice(), vram: rt.vram.slice(), low: rt.low.slice(), hw: JSON.stringify([rt.hw.cgaSel, rt.hw.picMask, rt.hw.port61, rt.hw.pitDiv]) }; }
// run the original function from the recorded entry state to its return
function original(rec) {
  restore(rec); hy.toEmu();
  c.r.set(rec.r); c.s.set(rec.s); c.flags = rec.flags; c.ip = parseInt(rec.name.slice(2), 16);
  const ret = c.rw(c.lin(2, c.r[4])), sp = (c.r[4] + (ISRS[exe].includes(rec.name) ? 6 : 2)) & 0xffff;   // iret pops ip, cs, flags
  for (let n = 0; !(c.ip === ret && c.r[4] === sp && c.s[1] === pc.base); n++) {
    if (n > 30_000_000) throw new Error('original did not return');
    c.step();
    if (pc.exitCode !== null) break;
  }
  hy.fromEmu();
  return { ax: rt.i16(c.r[0]), exit: pc.exitCode, ...snapshot() };
}
function port(rec) {
  restore(rec);
  rt.hw.sp = rec.r[4];            // port frames go below the caller's (recorded) stack
  const fn = F[rec.name], regs = REGARGS[exe][rec.name];
  const R = { al: rec.r[0] & 255, ax: rec.r[0], bx: rec.r[3], cx: rec.r[1], dx: rec.r[2], si: rec.r[6], di: rec.r[7] };
  const sp = rec.r[4], word = i => rt.i16(rt.rw(sp + 2 + 2 * i));
  const a = regs ? regs.map(r => R[r]) : Array.from({ length: fn.length }, (_, i) => word(i));
  let ax, exit = null;
  try { ax = fn(...a); } catch (e) { if (e instanceof rt.Exit) exit = e.code; else throw e; }
  return { ax, exit, ...snapshot() };
}
function diff(o, p) {
  const bad = [];
  for (let i = 0; i < LIMIT && bad.length < 8; i++) if (o.ds[i] !== p.ds[i]) bad.push(`ds:${hex(i)} orig ${hex(o.ds[i], 2)} port ${hex(p.ds[i], 2)}`);
  for (let i = 0; i < 0x4000 && bad.length < 8; i++) if (o.vram[i] !== p.vram[i]) bad.push(`vram:${hex(i)} orig ${hex(o.vram[i], 2)} port ${hex(p.vram[i], 2)}`);
  for (let i = 0; i < 0x500 && bad.length < 8; i++) if (o.low[i] !== p.low[i]) bad.push(`low:${hex(i)} orig ${hex(o.low[i], 2)} port ${hex(p.low[i], 2)}`);
  if (o.hw !== p.hw) bad.push(`hw orig ${o.hw} port ${p.hw}`);
  if (o.exit !== p.exit) bad.push(`exit orig ${o.exit} port ${p.exit}`);
  if (p.ax !== undefined && o.ax !== rt.i16(p.ax)) bad.push(`return orig ${o.ax} (${hex(o.ax)}) port ${p.ax}`);
  return bad;
}
let ok = 0, fail = 0, none = [];
for (const name of names) {
  if (!F[name] || F[name].fallback) { console.log(`${name}: not ported`); continue; }
  if (hy.cg[name]?.gen) { console.log(`${name}: generator (checked by tools/diff.mjs only)`); continue; }
  const file = path.join(ROOT, 'tools/calls', exe, name + '.json.gz');
  if (!fs.existsSync(file)) { none.push(name); continue; }
  const recs = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
  let bad = 0;
  for (const rec of recs) {
    rec.name = name;
    let o, p, msg;
    try { o = original(rec); p = port(rec); msg = diff(o, p); } catch (e) { msg = ['exception: ' + (e.stack || e).toString().split('\n').slice(0, 4).join(' | ')]; }
    if (msg.length) { if (!bad) console.log(`${name}: call #${rec.n} (${rec.scenario}) differs:\n    ` + msg.join('\n    ')); bad++; }
  }
  if (bad) { fail++; console.log(`${name}: ${bad}/${recs.length} calls differ`); } else { ok++; if (!process.env.QUIET) console.log(`${name}: ${recs.length} calls OK`); }
}
if (none.length) console.log('no recordings:', none.join(' '));
console.log(`fcheck ${exe}: ${ok} OK, ${fail} failing`);
process.exit(fail ? 1 : 0);
