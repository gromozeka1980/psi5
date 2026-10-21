// Minimal deterministic PC for running SEL.EXE / PSI5.EXE: 8086 + CGA mode 4 + PIT/PIC (IRQ0 only) + speaker +
// HLE BIOS (INT 10/16/1A, default INT 8) + HLE DOS (files from an in-memory FS, EXEC done by the host loop).
// Time is virtual: `ips` instructions per emulated second; IRQ0 fires every PIT period of virtual time.
import { CPU, HLE_SEG } from './cpu.js';

const LOAD_SEG = 0x0200;
export const IDLE_AT = { 'PSI5.EXE': new Set([0x0754, 0x0779]) };   // f_0748 / f_076d delay loops              // PSP segment; program image right after (+0x10)
export const CGA_RGB = [[0,0,0],[0,0,170],[0,170,0],[0,170,170],[170,0,0],[170,0,170],[170,85,0],[170,170,170],
  [85,85,85],[85,85,255],[85,255,85],[85,255,255],[255,85,85],[255,85,255],[255,255,85],[255,255,255]];

export class PC {
  constructor({ files = {}, log = () => {} } = {}) {
    this.cpu = new CPU(this); this.files = files; this.log = log;
    this.keys = [];                   // pending BIOS key words (scan<<8 | ascii)
    this.pitDiv = [65536, 65536, 65536]; this.pitLatch = [null, null, null]; this.pitMode = [0, 0, 0];
    this.picMask = 0xb8; this.port61 = 0; this.cgaSel = 0; this.cgaMode = 0;
    this.ticks = 0;                   // IRQ0 count
    this.vt = 0;                      // virtual time in PIT clocks (1193182 Hz)
    this.handles = new Map(); this.nextHandle = 5;
    this.exitCode = null; this.spk = [];
    const c = this.cpu;
    for (let i = 0; i < 256; i++) { c.ww(i * 4, i); c.ww(i * 4 + 2, HLE_SEG); }
    c.ww(0x410, 0x0021);             // equipment: 80x25 colour, no floppies... (CGA)
    c.wb(0x449, 3);
  }
  // ---------- program loading ----------
  load(name, args = '') {
    const d = this.file(name); if (!d) throw new Error('no file ' + name);
    const c = this.cpu, h = i => d[i] | (d[i + 1] << 8);
    const hdrPara = h(8), size = (h(4) - 1) * 512 + (h(2) || 512), img = d.subarray(hdrPara * 16, size);
    const psp = LOAD_SEG, base = psp + 0x10;
    c.mem.fill(0, psp * 16, 0xa0000);
    c.mem.set(img, base * 16);
    for (let i = 0; i < h(6); i++) { const o = h(h(0x18) + i * 4), s = h(h(0x18) + i * 4 + 2); const a = (base + s) * 16 + o; c.ww(a, c.rw(a) + base); }
    // PSP
    c.wb(psp * 16, 0xcd); c.wb(psp * 16 + 1, 0x20); c.ww(psp * 16 + 2, 0x9fff);
    c.wb(psp * 16 + 0x80, args.length); for (let i = 0; i < args.length; i++) c.wb(psp * 16 + 0x81 + i, args.charCodeAt(i)); c.wb(psp * 16 + 0x81 + args.length, 13);
    c.ww(psp * 16 + 0x2c, 0x0100);  // environment segment (empty env at 0x1000)
    c.s[0] = c.s[3] = psp; c.s[2] = base + h(0x0e); c.r[4] = h(0x10); c.s[1] = base + h(0x16); c.ip = h(0x14);
    c.flags = 0xf202; this.psp = psp; this.exitCode = null; this.prog = name.toUpperCase();
    this.base = base; this.dseg = c.rw(base * 16 + 0x10);   // MS-C: mov ax,DGROUP at 000f (already relocated)
  }
  file(name) { const k = Object.keys(this.files).find(k => k.toUpperCase() === name.toUpperCase()); return k ? this.files[k] : null; }
  // ---------- running ----------
  // Idle-point semantics (the reference for the port): the CPU is infinitely fast, time only passes at idle points
  // (keyboard poll/wait with an empty buffer, BIOS tick read). At each idle point virtual time jumps to the next IRQ0.
  // stepIdle() runs to the next idle point (or exit); tick() then fires IRQ0. run(ms) = repeat both for ms of time.
  // Besides the HLE idle points, `idleAt[exe]` lists code addresses of spin loops on ISR counters: execution stops
  // *before* such an instruction (the port does `yield` right before the matching statement).
  stepIdle(maxIns = 200_000_000) {
    const c = this.cpu; this.idleNow = false;
    const ia = IDLE_AT[this.prog];
    for (let n = 0; n < maxIns; n++) {
      if (this.exitCode !== null) return 'exit';
      if (ia && c.s[1] === this.base && ia.has(c.ip)) {
        if (this.skipIdleIp !== c.ip) { this.skipIdleIp = c.ip; return 'idle'; }   // resumed here: run it once
        this.skipIdleIp = -1;
      }
      if (this.breakAt !== undefined && c.s[1] === this.base + (this.breakAt >> 16) && c.ip === (this.breakAt & 0xffff)) return 'break';
      c.step();
      if (this.idleNow) return 'idle';
    }
    throw new Error(`no idle point within ${maxIns} instructions at ${c.s[1].toString(16)}:${c.ip.toString(16)}`);
  }
  tick() {
    const d = this.pitDiv[0];
    this.vt = (Math.floor(this.vt / d) + 1) * d;
    this.irq0();
  }
  run(ms) {
    const end = this.vt + ms * 1193.182;
    while (this.vt < end) { const r = this.stepIdle(); if (r === 'exit') return 'exit'; this.tick(); }
    return 'time';
  }
  irq0() {
    this.ticks++;
    const c = this.cpu;
    if (!(this.picMask & 1) && c.IF) c.interrupt(8);
    else this.pendingIrq = true;
  }
  // ---------- ports ----------
  in(port, w) {
    switch (port) {
      case 0x21: return this.picMask;
      case 0x61: return this.port61;
      case 0x3da: { this.retr = (this.retr + 1) & 15; return this.retr < 2 ? 9 : 0; }
      case 0x201: return 0xff;          // no joystick: axis bits never drop
      case 0x40: case 0x41: case 0x42: return 0;
    }
    this.log(`in ${port.toString(16)}`); return 0xff;
  }
  out(port, v, w) {
    switch (port) {
      case 0x20: return;
      case 0x21: this.picMask = v; if (!(v & 1) && this.pendingIrq && this.cpu.IF) { this.pendingIrq = false; this.cpu.interrupt(8); } return;
      case 0x43: { const ch = v >> 6; if (ch < 3) { this.pitMode[ch] = v; this.pitLatch[ch] = null; } return; }
      case 0x40: case 0x41: case 0x42: {
        const ch = port - 0x40;
        if (this.pitLatch[ch] === null) { this.pitLatch[ch] = v; return; }
        let d = this.pitLatch[ch] | (v << 8); this.pitLatch[ch] = null; if (!d) d = 65536;
        this.pitDiv[ch] = d; if (ch === 2) this.speaker(); return;
      }
      case 0x61: this.port61 = v; this.speaker(); return;
      case 0x3d8: this.cgaMode = v; return;
      case 0x3d9: this.cgaSel = v; return;
    }
    this.log(`out ${port.toString(16)},${v.toString(16)}`);
  }
  speaker() { const on = (this.port61 & 3) === 3; this.spk.push([this.vt, on ? 1193182 / this.pitDiv[2] : 0]); if (this.spk.length > 4096) this.spk.shift(); }
  // ---------- HLE interrupts ----------
  hle(n) {
    const c = this.cpu, r = c.r, ah = r[0] >> 8, al = r[0] & 255;
    const iret = () => {};          // HLE handlers return directly (no frame was pushed)
    switch (n) {
      case 0x08: c.ww(0x46c, c.rw(0x46c) + 1); if (!c.rw(0x46c)) c.ww(0x46e, c.rw(0x46e) + 1); return iret();
      case 0x10:
        if (ah === 0) { this.cgaMode = al; c.mem.fill(0, 0xb8000, 0xbc000); this.cgaSel = al === 4 ? 0x30 : 0; c.wb(0x449, al); return; }
        if (ah === 0x0b) { const bl = r[3] & 255, bh = r[3] >> 8;
          if (bh === 0) this.cgaSel = (this.cgaSel & 0xe0) | (bl & 0x1f); else this.cgaSel = (this.cgaSel & ~0x20) | ((bl & 1) << 5); return; }
        if (ah === 0x0f) { r[0] = (40 << 8) | c.rb(0x449); r[3] &= 255; return; }
        this.log(`int10 ${ah.toString(16)}`); return;
      case 0x16:
        if (ah === 0 || ah === 0x10) { if (!this.keys.length) { this.idleNow = true; c.ip = (c.ip - 2) & 0xffff; return; } r[0] = this.keys.shift(); return; }
        if (ah === 1 || ah === 0x11) { if (this.keys.length) { r[0] = this.keys[0]; c.flags &= ~0x40; } else { c.flags |= 0x40; this.idleNow = true; } return; }
        if (ah === 2) { c.set8(0, 0); return; }
        this.log(`int16 ${ah.toString(16)}`); return;
      case 0x1a:
        if (ah === 0) { r[2] = c.rw(0x46c); r[1] = c.rw(0x46e); c.set8(0, 0); this.idleNow = true; return; }
        if (ah === 1) { c.ww(0x46c, r[2]); c.ww(0x46e, r[1]); return; }
        return;
      case 0x21: return this.dos(ah, al);
      case 0x20: this.exitCode = 0; return;
    }
    this.log(`int ${n.toString(16)} ax=${r[0].toString(16)}`);
  }
  str(seg, off) { const c = this.cpu; let s = '', a = (c.s[seg] << 4) + off; for (;;) { const b = c.rb(a++); if (!b) return s; s += String.fromCharCode(b); } }
  dos(ah, al) {
    const c = this.cpu, r = c.r, ok = v => { c.flags &= ~1; if (v !== undefined) r[0] = v; }, err = e => { c.flags |= 1; r[0] = e; };
    switch (ah) {
      case 0x02: this.log('putc ' + String.fromCharCode(r[2] & 255)); return;
      case 0x06: if ((r[2] & 255) === 0xff) { if (this.keys.length) { c.set8(0, this.keys.shift() & 255); c.flags &= ~0x40; } else { c.set8(0, 0); c.flags |= 0x40; } } return;
      case 0x07: case 0x08: case 0x01: if (!this.keys.length) { this.idleNow = true; c.ip = (c.ip - 2) & 0xffff; return; } c.set8(0, this.keys.shift() & 255); return;
      case 0x09: return;
      case 0x0b: c.set8(0, this.keys.length ? 0xff : 0); return;
      case 0x19: c.set8(0, 2); return;
      case 0x1a: this.dta = [c.s[3], r[2]]; return;
      case 0x25: c.ww(al * 4, r[2]); c.ww(al * 4 + 2, c.s[3]); return;
      case 0x35: r[3] = c.rw(al * 4); c.s[0] = c.rw(al * 4 + 2); return;
      case 0x2a: r[1] = 1986; r[2] = 0x0101; c.set8(0, 3); return;
      case 0x2c: { const t = Math.floor(this.vt / 11931.82); r[1] = 0; r[2] = t % 100 | ((Math.floor(t / 100) % 60) << 8); return; }
      case 0x30: r[0] = 0x0003; r[3] = 0; r[1] = 0; return;
      case 0x33: c.set8(2, 0); return;
      case 0x3c: case 0x3d: {
        const name = this.str(3, r[2]).trim().replace(/^.*[\\:]/, '').toUpperCase();
        let d = this.file(name);
        if (ah === 0x3c) { d = new Uint8Array(0); this.files[name] = d; }
        if (!d) return err(2);
        const h = this.nextHandle++; this.handles.set(h, { name, pos: 0 }); this.log(`open ${name} -> ${h}`); return ok(h);
      }
      case 0x3e: this.handles.delete(r[3]); return ok();
      case 0x3f: {
        const f = this.handles.get(r[3]);
        if (!f) { if (r[3] === 0) { if (!this.keys.length) { this.idleNow = true; c.ip = (c.ip - 2) & 0xffff; return; } c.wb(c.lin(3, r[2]), this.keys.shift() & 255); return ok(1); } return err(6); }
        const d = this.file(f.name), n = Math.max(0, Math.min(r[1], d.length - f.pos));
        for (let i = 0; i < n; i++) c.wb(c.lin(3, r[2] + i), d[f.pos + i]);
        f.pos += n; return ok(n);
      }
      case 0x40: {
        if (r[3] <= 4) { let s = ''; for (let i = 0; i < r[1]; i++) s += String.fromCharCode(c.rb(c.lin(3, r[2] + i))); this.log('stdout ' + JSON.stringify(s)); return ok(r[1]); }
        const f = this.handles.get(r[3]); if (!f) return err(6);
        let d = this.file(f.name); const end = f.pos + r[1];
        if (end > d.length) { const nd = new Uint8Array(end); nd.set(d); d = nd; this.files[f.name] = d; }
        for (let i = 0; i < r[1]; i++) d[f.pos + i] = c.rb(c.lin(3, r[2] + i));
        f.pos = end; return ok(r[1]);
      }
      case 0x42: {
        const f = this.handles.get(r[3]); if (!f) return err(6);
        const off = (r[1] << 16 | r[2]) >> 0, len = this.file(f.name).length;
        f.pos = (al === 0 ? 0 : al === 1 ? f.pos : len) + off; r[2] = f.pos >> 16; return ok(f.pos & 0xffff);
      }
      case 0x44: if (al === 0) { r[2] = r[3] <= 2 ? 0x80 | (r[3] === 0 ? 1 : 2) : 0; return ok(); } return ok();
      case 0x4a: return ok();
      case 0x48: return err(8);
      case 0x4c: this.exitCode = al; return;
      case 0x0e: c.set8(0, 3); return;
    }
    this.log(`int21 ${ah.toString(16)} unimplemented`); err(1);
  }
  // ---------- keyboard ----------
  key(ascii, scan = 0) { this.keys.push((scan << 8) | ascii); }
  // ---------- video ----------
  // CGA mode 4 frame as palette indices (0..15 per pixel, 320x200)
  frame() {
    const m = this.cpu.mem, out = new Uint8Array(64000), sel = this.cgaSel;
    const bg = sel & 15, pal = (sel & 0x20) ? [3, 5, 7] : [2, 4, 6], hi = (sel & 0x10) ? 8 : 0;
    const map = [bg, pal[0] + hi, pal[1] + hi, pal[2] + hi];
    for (let y = 0; y < 200; y++) {
      const row = 0xb8000 + (y & 1) * 0x2000 + (y >> 1) * 80;
      for (let x = 0; x < 80; x++) { const b = m[row + x]; for (let k = 0; k < 4; k++) out[y * 320 + x * 4 + k] = map[(b >> (6 - 2 * k)) & 3]; }
    }
    return out;
  }
  rgba(frame = this.frame()) { const o = new Uint8ClampedArray(64000 * 4); for (let i = 0; i < 64000; i++) { const p = CGA_RGB[frame[i]]; o[i * 4] = p[0]; o[i * 4 + 1] = p[1]; o[i * 4 + 2] = p[2]; o[i * 4 + 3] = 255; } return o; }
}
