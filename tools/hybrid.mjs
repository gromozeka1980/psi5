// Hybrid execution: a port function that is not written yet runs as original x86 code in tools/emu, on the port's
// memory (DS/VRAM/low memory/hardware state are copied in before and back out after). This lets every ported function be
// tested on its own (tools/fcheck.mjs) and the whole game run at any stage of porting (tools/diff.mjs).
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { PC, IDLE_AT } from './emu/pc.js';
import * as rt from '../web/src/rt.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RET = 0x0005;                 // fake return address (inside the 'MS-C' signature at CS:0000)
// asm helpers that take register arguments: port signature f(...regs) in this order
export const REGARGS = { 'PSI5.EXE': { f_5bed: ['al'], f_63c5: ['si'], f_66c0: ['ax', 'bx', 'di'], f_6b0c: ['ax'], f_6dac: ['ax'], f_6e13: ['ax'], f_5f8a: ['si', 'di'] }, 'SEL.EXE': {} };

export const ISRS = { 'PSI5.EXE': ['f_6ca9'], 'SEL.EXE': ['f_0ca9'] };

export function callgraph(exe) {
  const f = path.join(ROOT, 're', exe.split('.')[0].toLowerCase() + '_cg.json');
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

export class Hybrid {
  constructor(exe, files) {
    this.exe = exe; this.pc = new PC({ files }); this.pc.load(exe);   // sets base/dseg/prog
    this.cg = callgraph(exe); this.calls = {};
  }
  toEmu() {
    const pc = this.pc, m = pc.cpu.mem;
    m.set(rt.ds, pc.dseg * 16); m.set(rt.vram, 0xb8000); m.set(rt.low, 0);
    for (const k of ['cgaSel', 'cgaMode', 'picMask', 'port61', 'pendingIrq', 'ticks']) pc[k] = rt.hw[k];
    pc.pitDiv = rt.hw.pitDiv.slice(); pc.pitLatch = rt.hw.pitLatch.slice(); pc.keys = rt.hw.keys; pc.files = rt.hw.files;
    pc.exitCode = null;
  }
  fromEmu() {
    const pc = this.pc, m = pc.cpu.mem;
    rt.ds.set(m.subarray(pc.dseg * 16, pc.dseg * 16 + 0x10000)); rt.vram.set(m.subarray(0xb8000, 0xbc000)); rt.low.set(m.subarray(0, 0x500));
    for (const k of ['cgaSel', 'cgaMode', 'picMask', 'port61', 'pendingIrq']) rt.hw[k] = pc[k];
    rt.hw.pitDiv = pc.pitDiv.slice(); rt.hw.pitLatch = pc.pitLatch.slice();
    if (pc.spk.length) { for (const [, f] of pc.spk) rt.hw.spk.push([rt.hw.ticks, f]); pc.spk.length = 0; }
  }
  // Set up a near call of the original function `name` with C args (and register args) on a stack below the port's.
  setup(name, args) {
    const c = this.pc.cpu, addr = parseInt(name.slice(2), 16), regs = REGARGS[this.exe][name];
    c.s[1] = this.pc.base; c.s[0] = c.s[2] = c.s[3] = this.pc.dseg;
    c.r[4] = name === 'f_0082' ? 0xffd2 : (rt.hw.sp - 0x20) & 0xfffe;   // main: same SP as the real one (setjmp stores it)
    if (regs) regs.forEach((r, i) => { const v = args[i] & 0xffff; if (r === 'al') c.set8(0, v); else c.r[{ ax: 0, cx: 1, dx: 2, bx: 3, si: 6, di: 7 }[r]] = v; });
    else for (let i = args.length - 1; i >= 0; i--) c.push(args[i] & 0xffff);
    c.push(RET); c.ip = addr; c.flags = 0xf202;
    return c.r[4] + 2;              // SP after the return
  }
  done(sp) { const c = this.pc.cpu; return c.ip === RET && c.s[1] === this.pc.base && c.r[4] === sp; }
  // non-generator call
  call(name, args) {
    this.calls[name] = (this.calls[name] || 0) + 1;
    this.toEmu(); this.pc.idleNow = false; const sp = this.setup(name, args), c = this.pc.cpu, ia = IDLE_AT[this.exe];
    for (let n = 0; ; n++) {
      if (this.done(sp)) break;
      if (n > 50_000_000) throw new Error(`${name}: original did not return (at ${c.ip.toString(16)}, idle ${pc.idleNow})`);
      c.step();
      if (this.pc.idleNow || (ia && ia.has(c.ip) && c.s[1] === this.pc.base && c.ip !== this.pc.skipIdleIp)) throw new Error(`${name}: original reached an idle point but is not a generator`);
      if (this.pc.exitCode !== null) { this.fromEmu(); rt.exit(this.pc.exitCode); }
    }
    this.fromEmu();
    return rt.i16(c.r[0]);
  }
  // generator call: idle points inside the original become yields of the port
  *callGen(name, args) {
    this.calls[name] = (this.calls[name] || 0) + 1;
    this.toEmu(); const sp = this.setup(name, args), c = this.pc.cpu, pc = this.pc;
    for (;;) {
      pc.idleNow = false;
      let r;
      for (let n = 0; ; n++) {
        if (this.done(sp)) { r = 'ret'; break; }
        if (n > 50_000_000) throw new Error(`${name}: original did not return (at ${c.ip.toString(16)}, idle ${pc.idleNow})`);
        const ia = IDLE_AT[this.exe];
        if (ia && c.s[1] === pc.base && ia.has(c.ip)) {
          if (pc.skipIdleIp !== c.ip) { pc.skipIdleIp = c.ip; r = 'idle'; break; }
          pc.skipIdleIp = -1;
        }
        c.step();
        if (pc.idleNow) { r = 'idle'; break; }
        if (pc.exitCode !== null) { this.fromEmu(); rt.exit(pc.exitCode); }
      }
      if (r === 'ret') break;
      const saved = Uint8Array.from(c.mem.subarray(0, 0x110000).subarray(pc.dseg * 16 + 0xf000, pc.dseg * 16 + 0x10000));
      this.fromEmu();
      const regs = [c.r.slice(), c.s.slice(), c.ip, c.flags, pc.skipIdleIp];
      yield;                         // the driver fires IRQ0 on the port side (port ISR, or the original via isr())
      this.toEmu();
      c.r.set(regs[0]); c.s.set(regs[1]); c.ip = regs[2]; c.flags = regs[3]; pc.skipIdleIp = regs[4];
      c.mem.set(saved, pc.dseg * 16 + 0xf000);   // keep the original's stack (the port's view of it may be stale)
    }
    this.fromEmu();
    return rt.i16(c.r[0]);
  }
  // run the original interrupt handler at CS:off (when the port has none)
  isr(off) {
    this.toEmu(); const c = this.pc.cpu;
    c.s[1] = this.pc.base; c.s[0] = c.s[2] = c.s[3] = this.pc.dseg; c.r[4] = (rt.hw.sp - 0x20) & 0xfffe;
    c.push(0xf202); c.push(this.pc.base); c.push(RET); c.ip = off; const sp = c.r[4] + 6;
    while (!(c.ip === RET && c.r[4] === sp)) c.step();
    this.fromEmu();
  }
  // Fill the program's function namespace F with fallbacks for every function the port does not define.
  install(F, isrs) {
    const self = this;
    for (const [name, info] of Object.entries(this.cg)) {
      if (F[name]) continue;
      if (ISRS[this.exe].includes(name)) { F[name] = () => self.isr(parseInt(name.slice(2), 16)); F[name].fallback = true; continue; }
      F[name] = info.gen ? function* (...a) { return yield* self.callGen(name, a); } : (...a) => self.call(name, a);
      F[name].fallback = true;
    }
    return new Proxy(isrs, { get: (t, k) => t[k] || (typeof k === 'string' && /^\d+$/.test(k) ? () => self.isr(+k) : undefined) });
  }
}
