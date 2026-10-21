// 8086 interpreter (real mode, no 186+ opcodes). Used as the deterministic reference for the 1:1 port:
// it runs the original SEL.EXE / PSI5.EXE with virtual time (see pc.js), so runs are reproducible.
// Flags are computed eagerly. Interrupts: INT n goes through the IVT; vectors pointing into segment HLE_SEG are
// handled by `pc.hle(n)` in JS (BIOS/DOS), anything else (e.g. the game's own INT 8 handler) runs as x86 code.
export const HLE_SEG = 0xf000;
const CF = 1, PF = 4, AF = 0x10, ZF = 0x40, SF = 0x80, TF = 0x100, IF = 0x200, DF = 0x400, OF = 0x800;
const PAR = new Uint8Array(256);
for (let i = 0; i < 256; i++) { let b = i, p = 1; while (b) { p ^= b & 1; b >>= 1; } PAR[i] = p ? PF : 0; }

export class CPU {
  constructor(pc) {
    this.pc = pc;
    this.mem = new Uint8Array(0x110000);
    this.r = new Uint16Array(8);      // AX CX DX BX SP BP SI DI
    this.s = new Uint16Array(4);      // ES CS SS DS
    this.ip = 0; this.flags = 0xf002;
    this.halted = false; this.icount = 0;
  }
  // --- memory ---
  rb(a) { return this.mem[a & 0xfffff]; }
  wb(a, v) { a &= 0xfffff; if (a >= 0xa0000 && a < 0xc0000 && this.pc.vwrite) this.pc.vwrite(a, v & 255); this.mem[a] = v; }
  rw(a) { return this.rb(a) | (this.rb(a + 1) << 8); }
  ww(a, v) { this.wb(a, v & 255); this.wb(a + 1, (v >> 8) & 255); }
  lin(seg, off) { return ((this.s[seg] << 4) + (off & 0xffff)) & 0xfffff; }
  // --- registers ---
  get8(i) { return i < 4 ? this.r[i] & 255 : this.r[i - 4] >> 8; }
  set8(i, v) { if (i < 4) this.r[i] = (this.r[i] & 0xff00) | (v & 255); else this.r[i - 4] = (this.r[i - 4] & 255) | ((v & 255) << 8); }
  push(v) { this.r[4] -= 2; this.ww(this.lin(2, this.r[4]), v); }
  pop() { const v = this.rw(this.lin(2, this.r[4])); this.r[4] += 2; return v; }
  fetch() { const v = this.rb(this.lin(1, this.ip)); this.ip = (this.ip + 1) & 0xffff; return v; }
  fetchw() { const v = this.fetch(); return v | (this.fetch() << 8); }
  // --- flags helpers ---
  setf(f, on) { if (on) this.flags |= f; else this.flags &= ~f; }
  szp(v, w) { const m = w ? 0xffff : 0xff; v &= m; this.flags &= ~(SF | ZF | PF); if (!v) this.flags |= ZF; if (v & (w ? 0x8000 : 0x80)) this.flags |= SF; this.flags |= PAR[v & 255]; }
  alu(op, a, b, w) {   // 0 add 1 or 2 adc 3 sbb 4 and 5 sub 6 xor 7 cmp
    const m = w ? 0xffff : 0xff, sb = w ? 0x8000 : 0x80; let r, c;
    switch (op) {
      case 0: case 2: c = op === 2 ? this.flags & CF : 0; r = a + b + c;
        this.setf(CF, r > m); this.setf(OF, ((a ^ r) & (b ^ r) & sb) !== 0); this.setf(AF, ((a ^ b ^ r) & 0x10) !== 0); break;
      case 5: case 7: case 3: c = op === 3 ? this.flags & CF : 0; r = a - b - c;
        this.setf(CF, r < 0); this.setf(OF, ((a ^ b) & (a ^ r) & sb) !== 0); this.setf(AF, ((a ^ b ^ r) & 0x10) !== 0); break;
      case 1: r = a | b; this.flags &= ~(CF | OF | AF); break;
      case 4: r = a & b; this.flags &= ~(CF | OF | AF); break;
      case 6: r = a ^ b; this.flags &= ~(CF | OF | AF); break;
    }
    r &= m; this.szp(r, w); return r;
  }
  incdec(v, dec, w) {
    const m = w ? 0xffff : 0xff, sb = w ? 0x8000 : 0x80; const r = (dec ? v - 1 : v + 1) & m;
    this.setf(OF, dec ? v === sb : r === sb); this.setf(AF, dec ? (v & 15) === 0 : (r & 15) === 0); this.szp(r, w); return r;
  }
  cond(c) {
    const f = this.flags, z = f & ZF, cy = f & CF, s = !!(f & SF), o = !!(f & OF);
    switch (c >> 1) {
      case 0: return (c & 1) ? !o : o;
      case 1: return (c & 1) ? !cy : !!cy;
      case 2: return (c & 1) ? !z : !!z;
      case 3: return (c & 1) ? !(cy || z) : !!(cy || z);
      case 4: return (c & 1) ? !s : s;
      case 5: return (c & 1) ? !(f & PF) : !!(f & PF);
      case 6: return (c & 1) ? s === o : s !== o;
      case 7: return (c & 1) ? !(z || s !== o) : !!(z || s !== o);
    }
  }
  // --- modrm ---
  modrm() {
    const b = this.fetch(); const mod = b >> 6, reg = (b >> 3) & 7, rm = b & 7;
    if (mod === 3) return { mod, reg, rm, ea: -1 };
    let off, seg = 3;
    switch (rm) {
      case 0: off = this.r[3] + this.r[6]; break; case 1: off = this.r[3] + this.r[7]; break;
      case 2: off = this.r[5] + this.r[6]; seg = 2; break; case 3: off = this.r[5] + this.r[7]; seg = 2; break;
      case 4: off = this.r[6]; break; case 5: off = this.r[7]; break;
      case 6: if (mod === 0) { off = this.fetchw(); } else { off = this.r[5]; seg = 2; } break;
      case 7: off = this.r[3]; break;
    }
    if (mod === 1) { const d = this.fetch(); off += d < 128 ? d : d - 256; } else if (mod === 2) off += this.fetchw();
    off &= 0xffff;
    if (this.segov >= 0) seg = this.segov;
    return { mod, reg, rm, off, seg, ea: this.lin(seg, off) };
  }
  getrm(m, w) { return m.ea < 0 ? (w ? this.r[m.rm] : this.get8(m.rm)) : (w ? this.rw(m.ea) : this.rb(m.ea)); }
  setrm(m, w, v) { if (m.ea < 0) { if (w) this.r[m.rm] = v; else this.set8(m.rm, v); } else if (w) this.ww(m.ea, v); else this.wb(m.ea, v); }
  // --- interrupts ---
  interrupt(n) {
    const off = this.rw(n * 4), seg = this.rw(n * 4 + 2);
    if (seg === HLE_SEG) { this.pc.hle(n); return; }
    this.push(this.flags); this.push(this.s[1]); this.push(this.ip);
    this.flags &= ~(IF | TF); this.s[1] = seg; this.ip = off;
  }
  get IF() { return (this.flags & IF) !== 0; }

  step() {
    this.icount++;
    if (this.trap !== undefined && this.s[1] === this.trapCS && this.trap[this.ip]) this.onTrap(this.ip);
    this.segov = -1; let rep = 0;
    for (;;) {   // prefixes
      const p = this.rb(this.lin(1, this.ip));
      if (p === 0x26 || p === 0x2e || p === 0x36 || p === 0x3e) { this.segov = (p >> 3) & 3; this.ip++; }
      else if (p === 0xf2 || p === 0xf3) { rep = p; this.ip++; }
      else if (p === 0xf0) this.ip++;
      else break;
    }
    const op = this.fetch();
    if (op < 0x40 && (op & 7) < 6) {    // ALU r/m forms
      const alu = op >> 3, w = op & 1;
      switch (op & 7) {
        case 0: case 1: { const m = this.modrm(); const r = this.alu(alu, this.getrm(m, w), w ? this.r[m.reg] : this.get8(m.reg), w); if (alu !== 7) this.setrm(m, w, r); return; }
        case 2: case 3: { const m = this.modrm(); const a = w ? this.r[m.reg] : this.get8(m.reg); const r = this.alu(alu, a, this.getrm(m, w), w); if (alu !== 7) { if (w) this.r[m.reg] = r; else this.set8(m.reg, r); } return; }
        case 4: { const r = this.alu(alu, this.r[0] & 255, this.fetch(), 0); if (alu !== 7) this.set8(0, r); return; }
        case 5: { const r = this.alu(alu, this.r[0], this.fetchw(), 1); if (alu !== 7) this.r[0] = r; return; }
      }
    }
    switch (op) {
      case 0x06: case 0x0e: case 0x16: case 0x1e: this.push(this.s[op >> 3]); return;
      case 0x07: case 0x17: case 0x1f: this.s[op >> 3] = this.pop(); return;
      case 0x0f: this.s[1] = this.pop(); return;
      case 0x27: case 0x2f: {   // DAA / DAS
        let al = this.r[0] & 255; const oc = this.flags & CF; let c = 0;
        if ((al & 15) > 9 || (this.flags & AF)) { al = op === 0x27 ? al + 6 : al - 6; c = al > 255 || al < 0; this.flags |= AF; } else this.flags &= ~AF;
        if ((this.r[0] & 255) > 0x99 || oc) { al = op === 0x27 ? al + 0x60 : al - 0x60; c = 1; }
        this.set8(0, al & 255); this.szp(al, 0); this.setf(CF, c); return;
      }
      case 0x37: case 0x3f: {   // AAA / AAS
        if ((this.r[0] & 15) > 9 || (this.flags & AF)) {
          if (op === 0x37) { this.r[0] += 0x106; } else { this.set8(0, (this.r[0] - 6) & 255); this.set8(4, ((this.r[0] >> 8) - 1) & 255); }
          this.flags |= AF | CF;
        } else this.flags &= ~(AF | CF);
        this.r[0] &= 0xff0f; return;
      }
    }
    if (op >= 0x40 && op < 0x50) { const i = op & 7; this.r[i] = this.incdec(this.r[i], op >= 0x48, 1); return; }
    if (op >= 0x50 && op < 0x58) { const i = op & 7; if (i === 4) { this.r[4] -= 2; this.ww(this.lin(2, this.r[4]), this.r[4]); } else this.push(this.r[i]); return; }
    if (op >= 0x58 && op < 0x60) { this.r[op & 7] = this.pop(); return; }
    if (op >= 0x70 && op < 0x80) { const d = this.fetch(); if (this.cond(op & 15)) this.ip = (this.ip + (d < 128 ? d : d - 256)) & 0xffff; return; }
    if (op >= 0x60 && op < 0x70) { const d = this.fetch(); if (this.cond(op & 15)) this.ip = (this.ip + (d < 128 ? d : d - 256)) & 0xffff; return; } // 8086 aliases
    if (op >= 0x91 && op < 0x98) { const i = op & 7, t = this.r[0]; this.r[0] = this.r[i]; this.r[i] = t; return; }
    if (op >= 0xb0 && op < 0xb8) { this.set8(op & 7, this.fetch()); return; }
    if (op >= 0xb8 && op < 0xc0) { this.r[op & 7] = this.fetchw(); return; }
    switch (op) {
      case 0x80: case 0x81: case 0x82: case 0x83: {
        const w = op & 1, m = this.modrm(); const a = this.getrm(m, w);
        let b = op === 0x81 ? this.fetchw() : this.fetch(); if (op === 0x83 && b >= 128) b = (b - 256) & 0xffff;
        const r = this.alu(m.reg, a, b, w); if (m.reg !== 7) this.setrm(m, w, r); return;
      }
      case 0x84: case 0x85: { const w = op & 1, m = this.modrm(); this.alu(4, this.getrm(m, w), w ? this.r[m.reg] : this.get8(m.reg), w); return; }
      case 0x86: case 0x87: { const w = op & 1, m = this.modrm(); const a = this.getrm(m, w), b = w ? this.r[m.reg] : this.get8(m.reg); this.setrm(m, w, b); if (w) this.r[m.reg] = a; else this.set8(m.reg, a); return; }
      case 0x88: case 0x89: { const w = op & 1, m = this.modrm(); this.setrm(m, w, w ? this.r[m.reg] : this.get8(m.reg)); return; }
      case 0x8a: case 0x8b: { const w = op & 1, m = this.modrm(); const v = this.getrm(m, w); if (w) this.r[m.reg] = v; else this.set8(m.reg, v); return; }
      case 0x8c: { const m = this.modrm(); this.setrm(m, 1, this.s[m.reg & 3]); return; }
      case 0x8d: { const m = this.modrm(); this.r[m.reg] = m.off; return; }
      case 0x8e: { const m = this.modrm(); this.s[m.reg & 3] = this.getrm(m, 1); return; }
      case 0x8f: { const m = this.modrm(); const v = this.pop(); this.setrm(m, 1, v); return; }
      case 0x90: return;
      case 0x98: this.r[0] = (this.r[0] & 0x80) ? this.r[0] | 0xff00 : this.r[0] & 255; return;
      case 0x99: this.r[2] = (this.r[0] & 0x8000) ? 0xffff : 0; return;
      case 0x9a: { const o = this.fetchw(), s = this.fetchw(); this.push(this.s[1]); this.push(this.ip); this.s[1] = s; this.ip = o; return; }
      case 0x9b: return;
      case 0x9c: this.push(this.flags); return;
      case 0x9d: this.flags = (this.pop() & 0x0fd5) | 0xf002; return;
      case 0x9e: this.flags = (this.flags & 0xff00) | ((this.r[0] >> 8) & 0xd5) | 2; return;
      case 0x9f: this.set8(4, this.flags & 255); return;
      case 0xa0: this.set8(0, this.rb(this.lin(this.segov >= 0 ? this.segov : 3, this.fetchw()))); return;
      case 0xa1: this.r[0] = this.rw(this.lin(this.segov >= 0 ? this.segov : 3, this.fetchw())); return;
      case 0xa2: this.wb(this.lin(this.segov >= 0 ? this.segov : 3, this.fetchw()), this.r[0] & 255); return;
      case 0xa3: this.ww(this.lin(this.segov >= 0 ? this.segov : 3, this.fetchw()), this.r[0]); return;
      case 0xa4: case 0xa5: case 0xa6: case 0xa7: case 0xaa: case 0xab: case 0xac: case 0xad: case 0xae: case 0xaf:
        this.string(op, rep); return;
      case 0xa8: this.alu(4, this.r[0] & 255, this.fetch(), 0); return;
      case 0xa9: this.alu(4, this.r[0], this.fetchw(), 1); return;
      case 0xc2: { const n = this.fetchw(); this.ip = this.pop(); this.r[4] += n; return; }
      case 0xc3: this.ip = this.pop(); return;
      case 0xc4: case 0xc5: { const m = this.modrm(); this.r[m.reg] = this.rw(m.ea); this.s[op === 0xc4 ? 0 : 3] = this.rw((m.ea + 2) & 0xfffff); return; }
      case 0xc6: { const m = this.modrm(); this.setrm(m, 0, this.fetch()); return; }
      case 0xc7: { const m = this.modrm(); this.setrm(m, 1, this.fetchw()); return; }
      case 0xca: { const n = this.fetchw(); this.ip = this.pop(); this.s[1] = this.pop(); this.r[4] += n; return; }
      case 0xcb: this.ip = this.pop(); this.s[1] = this.pop(); return;
      case 0xcc: this.interrupt(3); return;
      case 0xcd: this.interrupt(this.fetch()); return;
      case 0xce: if (this.flags & OF) this.interrupt(4); return;
      case 0xcf: this.ip = this.pop(); this.s[1] = this.pop(); this.flags = (this.pop() & 0x0fd5) | 0xf002; return;
      case 0xd0: case 0xd1: case 0xd2: case 0xd3: this.shift(op); return;
      case 0xd4: { const b = this.fetch(); const al = this.r[0] & 255; this.set8(4, Math.floor(al / b)); this.set8(0, al % b); this.szp(this.r[0] & 255, 0); return; }
      case 0xd5: { const b = this.fetch(); const v = ((this.r[0] & 255) + (this.r[0] >> 8) * b) & 255; this.r[0] = v; this.szp(v, 0); return; }
      case 0xd7: this.set8(0, this.rb(this.lin(this.segov >= 0 ? this.segov : 3, this.r[3] + (this.r[0] & 255)))); return;
      case 0xd8: case 0xd9: case 0xda: case 0xdb: case 0xdc: case 0xdd: case 0xde: case 0xdf: this.modrm(); return; // no FPU
      case 0xe0: case 0xe1: case 0xe2: case 0xe3: {
        const d = this.fetch(); let j;
        if (op === 0xe3) j = this.r[1] === 0;
        else { this.r[1]--; j = this.r[1] !== 0 && (op === 0xe2 || (op === 0xe1 ? (this.flags & ZF) : !(this.flags & ZF))); }
        if (j) this.ip = (this.ip + (d < 128 ? d : d - 256)) & 0xffff; return;
      }
      case 0xe4: this.set8(0, this.pc.in(this.fetch(), 0)); return;
      case 0xe5: this.r[0] = this.pc.in(this.fetch(), 1); return;
      case 0xe6: this.pc.out(this.fetch(), this.r[0] & 255, 0); return;
      case 0xe7: this.pc.out(this.fetch(), this.r[0], 1); return;
      case 0xe8: { const d = this.fetchw(); this.push(this.ip); this.ip = (this.ip + d) & 0xffff; return; }
      case 0xe9: { const d = this.fetchw(); this.ip = (this.ip + d) & 0xffff; return; }
      case 0xea: { const o = this.fetchw(), s = this.fetchw(); this.ip = o; this.s[1] = s; return; }
      case 0xeb: { const d = this.fetch(); this.ip = (this.ip + (d < 128 ? d : d - 256)) & 0xffff; return; }
      case 0xec: this.set8(0, this.pc.in(this.r[2], 0)); return;
      case 0xed: this.r[0] = this.pc.in(this.r[2], 1); return;
      case 0xee: this.pc.out(this.r[2], this.r[0] & 255, 0); return;
      case 0xef: this.pc.out(this.r[2], this.r[0], 1); return;
      case 0xf4: this.halted = true; return;
      case 0xf5: this.flags ^= CF; return;
      case 0xf6: case 0xf7: this.grp3(op & 1); return;
      case 0xf8: this.flags &= ~CF; return; case 0xf9: this.flags |= CF; return;
      case 0xfa: this.flags &= ~IF; return; case 0xfb: this.flags |= IF; return;
      case 0xfc: this.flags &= ~DF; return; case 0xfd: this.flags |= DF; return;
      case 0xfe: case 0xff: {
        const w = op & 1, m = this.modrm();
        switch (m.reg) {
          case 0: this.setrm(m, w, this.incdec(this.getrm(m, w), 0, w)); return;
          case 1: this.setrm(m, w, this.incdec(this.getrm(m, w), 1, w)); return;
          case 2: { const t = this.getrm(m, 1); this.push(this.ip); this.ip = t; return; }
          case 3: { const o = this.rw(m.ea), s = this.rw(m.ea + 2); this.push(this.s[1]); this.push(this.ip); this.ip = o; this.s[1] = s; return; }
          case 4: this.ip = this.getrm(m, 1); return;
          case 5: this.ip = this.rw(m.ea); this.s[1] = this.rw(m.ea + 2); return;
          case 6: this.push(this.getrm(m, 1)); return;
        }
      }
    }
    throw new Error(`bad opcode ${op.toString(16)} at ${this.s[1].toString(16)}:${((this.ip - 1) & 0xffff).toString(16)}`);
  }
  string(op, rep) {
    const w = op & 1, d = (this.flags & DF) ? (w ? -2 : -1) : (w ? 2 : 1), src = this.segov >= 0 ? this.segov : 3;
    const one = () => {
      switch (op & ~1) {
        case 0xa4: { const v = w ? this.rw(this.lin(src, this.r[6])) : this.rb(this.lin(src, this.r[6])); if (w) this.ww(this.lin(0, this.r[7]), v); else this.wb(this.lin(0, this.r[7]), v); this.r[6] += d; this.r[7] += d; return; }
        case 0xa6: { const a = w ? this.rw(this.lin(src, this.r[6])) : this.rb(this.lin(src, this.r[6])), b = w ? this.rw(this.lin(0, this.r[7])) : this.rb(this.lin(0, this.r[7])); this.alu(7, a, b, w); this.r[6] += d; this.r[7] += d; return; }
        case 0xaa: if (w) this.ww(this.lin(0, this.r[7]), this.r[0]); else this.wb(this.lin(0, this.r[7]), this.r[0] & 255); this.r[7] += d; return;
        case 0xac: if (w) this.r[0] = this.rw(this.lin(src, this.r[6])); else this.set8(0, this.rb(this.lin(src, this.r[6]))); this.r[6] += d; return;
        case 0xae: { const b = w ? this.rw(this.lin(0, this.r[7])) : this.rb(this.lin(0, this.r[7])); this.alu(7, w ? this.r[0] : this.r[0] & 255, b, w); this.r[7] += d; return; }
      }
    };
    if (!rep) { one(); return; }
    const cmp = (op & ~1) === 0xa6 || (op & ~1) === 0xae;
    while (this.r[1]) {
      one(); this.r[1]--;
      if (cmp && (rep === 0xf3 ? !(this.flags & ZF) : (this.flags & ZF))) break;
    }
  }
  shift(op) {
    const w = op & 1, m = this.modrm(); let n = op >= 0xd2 ? this.r[1] & 255 : 1;
    let v = this.getrm(m, w); if (!n) return;
    const bits = w ? 16 : 8, mask = w ? 0xffff : 0xff, sb = w ? 0x8000 : 0x80;
    let c = this.flags & CF ? 1 : 0;
    for (let i = 0; i < n; i++) {
      switch (m.reg) {
        case 0: c = (v & sb) ? 1 : 0; v = ((v << 1) | c) & mask; break;
        case 1: c = v & 1; v = (v >> 1) | (c ? sb : 0); break;
        case 2: { const nc = (v & sb) ? 1 : 0; v = ((v << 1) | c) & mask; c = nc; break; }
        case 3: { const nc = v & 1; v = (v >> 1) | (c ? sb : 0); c = nc; break; }
        case 4: case 6: c = (v & sb) ? 1 : 0; v = (v << 1) & mask; break;
        case 5: c = v & 1; v = v >> 1; break;
        case 7: c = v & 1; v = (v >> 1) | (v & sb); break;
      }
    }
    this.setf(CF, c);
    if (m.reg >= 4) this.szp(v, w);
    // OF defined for 1-bit shifts; use the 1-bit rule for all counts (matches common emulators)
    switch (m.reg) {
      case 0: case 2: case 4: case 6: this.setf(OF, (((v & sb) ? 1 : 0) ^ c) === 1); break;
      case 1: case 3: this.setf(OF, ((v ^ (v << 1)) & sb) !== 0); break;
      case 5: this.setf(OF, n === 1 ? ((this.getrm(m, w) & sb) !== 0) : false); break;
      case 7: this.flags &= ~OF; break;
    }
    void bits;
    this.setrm(m, w, v);
  }
  grp3(w) {
    const m = this.modrm(), v = this.getrm(m, w);
    switch (m.reg) {
      case 0: case 1: this.alu(4, v, w ? this.fetchw() : this.fetch(), w); return;
      case 2: this.setrm(m, w, ~v & (w ? 0xffff : 0xff)); return;
      case 3: { const r = this.alu(5, 0, v, w); this.setf(CF, v !== 0); this.setrm(m, w, r); return; }
      case 4: case 5: {
        if (w) {
          let r; if (m.reg === 4) r = this.r[0] * v; else r = ((this.r[0] << 16) >> 16) * ((v << 16) >> 16);
          this.r[0] = r & 0xffff; this.r[2] = (r >> 16) & 0xffff;
          const hi = m.reg === 4 ? this.r[2] !== 0 : r !== ((r << 16) >> 16); this.setf(CF, hi); this.setf(OF, hi);
        } else {
          let r; if (m.reg === 4) r = (this.r[0] & 255) * v; else r = ((this.r[0] << 24) >> 24) * ((v << 24) >> 24);
          this.r[0] = r & 0xffff;
          const hi = m.reg === 4 ? (r >> 8) !== 0 : r !== ((r << 24) >> 24); this.setf(CF, hi); this.setf(OF, hi);
        }
        return;
      }
      case 6: case 7: {
        if (w) {
          let n, d = v;
          if (m.reg === 6) { n = this.r[2] * 65536 + this.r[0]; if (!d) return this.interrupt(0); const q = Math.floor(n / d); if (q > 0xffff) return this.interrupt(0); this.r[0] = q; this.r[2] = n % d; }
          else { n = ((this.r[2] << 16) | this.r[0]); d = (d << 16) >> 16; if (!d) return this.interrupt(0); const q = Math.trunc(n / d); if (q > 32767 || q < -32768) return this.interrupt(0); this.r[0] = q & 0xffff; this.r[2] = (n % d) & 0xffff; }
        } else {
          let n = this.r[0], d = v;
          if (m.reg === 6) { if (!d) return this.interrupt(0); const q = Math.floor(n / d); if (q > 255) return this.interrupt(0); this.r[0] = ((n % d) << 8) | q; }
          else { n = (n << 16) >> 16; d = (d << 24) >> 24; if (!d) return this.interrupt(0); const q = Math.trunc(n / d); if (q > 127 || q < -128) return this.interrupt(0); this.r[0] = (((n % d) & 255) << 8) | (q & 255); }
        }
        return;
      }
    }
  }
}
export const FLAGS = { CF, PF, AF, ZF, SF, TF, IF, DF, OF };
