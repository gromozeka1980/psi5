// Machine model for the 1:1 port of SEL.EXE / PSI5.EXE (Psi 5 Trading Company, Accolade 1985/86).
//
// The port keeps the original memory layout: `ds` is the program's 64 KB data segment (DGROUP), initialised from a
// snapshot taken at entry to main() (web/data/*_ds.bin). Globals are addressed by their original DS offsets, so the
// port can be diffed byte-for-byte against the original running in tools/emu (see tools/diff.mjs).
//
// Time model ("idle points"): the CPU is infinitely fast; time only passes where the original polls the keyboard with
// an empty buffer or reads the BIOS tick count. Those calls are generators here and `yield` once; the driver fires the
// timer interrupt (IRQ0) between the yield and the resume. Every function that can reach an idle point is a generator
// and is called with `yield*`.
export const ds = new Uint8Array(0x10000);   // DGROUP
export const low = new Uint8Array(0x500);    // 0000:0000-04FF: IVT + BIOS data area
export const vram = new Uint8Array(0x4000);  // B800:0000 (CGA)
export const CS = 0x0210;                    // code segment the original runs at (PSP 0x200 + 0x10); stored in the IVT

export const hw = {
  keys: [],                  // BIOS key words (scan << 8 | ascii)
  cgaSel: 0, cgaMode: 0,     // CGA colour select (3D9) / mode
  picMask: 0xb8, pendingIrq: false, port61: 0,
  pitDiv: [65536, 65536, 65536], pitLatch: [null, null, null],
  spk: [],                   // speaker log: [tick, freq Hz or 0]
  ticks: 0,                  // IRQ0 count
  files: {},                 // name -> Uint8Array
  handles: new Map(), nextHandle: 5,
  isrs: {},                  // ISR offset -> JS function (the program's own INT 8 handler)
  sp: 0xffd0,                // port stack for locals whose address is taken (see frame())
};

// ---------- integer helpers (C int is 16 bit) ----------
export const i16 = v => (v << 16) >> 16;
export const u16 = v => v & 0xffff;
export const i8 = v => (v << 24) >> 24;

// ---------- DS memory ----------
export const rb = a => ds[a & 0xffff];
export const rsb = a => (ds[a & 0xffff] << 24) >> 24;
export const rw = a => ds[a & 0xffff] | (ds[(a + 1) & 0xffff] << 8);
export const rs = a => (rw(a) << 16) >> 16;
export function wb(a, v) { ds[a & 0xffff] = v; }
export function ww(a, v) { ds[a & 0xffff] = v; ds[(a + 1) & 0xffff] = v >> 8; }
export function cstr(a) { let s = ''; for (let c; (c = ds[a & 0xffff]); a++) s += String.fromCharCode(c); return s; }
// VRAM (B800:offset); offsets wrap at 64 KB, only the first 16 KB exist (writes beyond are dropped, reads give 0)
export function vput(a, v) { a &= 0xffff; if (a < 0x4000) vram[a] = v; }
export const vget = a => { a &= 0xffff; return a < 0x4000 ? vram[a] : 0; };
// low memory (segment 0 / 0x40 accesses)
export const lw = a => low[a] | (low[a + 1] << 8);
export function lww(a, v) { low[a] = v; low[a + 1] = v >> 8; }

// Locals whose address is taken live in a downward-growing stack at the top of DS (like the original's stack, which
// shares DS). frame(n) reserves n bytes and returns their DS address; unframe(n) releases them.
export function frame(n) { hw.sp -= n; return hw.sp; }
export function unframe(n) { hw.sp += n; }

// ---------- I/O ports ----------
export function inp(port) {
  switch (port) {
    case 0x21: return hw.picMask;
    case 0x61: return hw.port61;
    case 0x201: return 0xff;        // no joystick
    case 0x40: case 0x41: case 0x42: return 0;
  }
  return 0xff;
}
export function outp(port, v) {
  v &= 255;
  switch (port) {
    case 0x20: return;
    case 0x21: hw.picMask = v; if (!(v & 1) && hw.pendingIrq) { hw.pendingIrq = false; irq0(); } return;
    case 0x43: { const ch = v >> 6; if (ch < 3) hw.pitLatch[ch] = null; return; }
    case 0x40: case 0x41: case 0x42: {
      const ch = port - 0x40;
      if (hw.pitLatch[ch] === null) { hw.pitLatch[ch] = v; return; }
      let d = hw.pitLatch[ch] | (v << 8); hw.pitLatch[ch] = null; if (!d) d = 65536;
      hw.pitDiv[ch] = d; if (ch === 2) speaker(); return;
    }
    case 0x61: hw.port61 = v; speaker(); return;
    case 0x3d8: hw.cgaMode = v; return;
    case 0x3d9: hw.cgaSel = v; return;
  }
}
function speaker() { hw.spk.push([hw.ticks, (hw.port61 & 3) === 3 ? 1193182 / hw.pitDiv[2] : 0]); if (hw.spk.length > 4096) hw.spk.shift(); }

// ---------- interrupts ----------
// IRQ0: dispatch through the IVT like the hardware would.
export function irq0() {
  if (hw.picMask & 1) { hw.pendingIrq = true; return; }
  const off = lw(0x20), seg = lw(0x22);
  if (seg === 0xf000) { lww(0x46c, lw(0x46c) + 1); if (!lw(0x46c)) lww(0x46e, lw(0x46e) + 1); return; }  // BIOS INT 8
  const isr = hw.isrs[off]; if (!isr) throw new Error('no ISR at ' + off.toString(16)); isr();
}
// Advance to the next timer interrupt (called by the driver after each yield).
export function tick() { hw.ticks++; irq0(); }

// INT 10h (only what the game uses)
export function int10(ax, bx) {
  const ah = ax >> 8, al = ax & 255;
  if (ah === 0) { hw.cgaMode = al; vram.fill(0); hw.cgaSel = al === 4 ? 0x30 : 0; low[0x449] = al; return; }
  if (ah === 0x0b) { const bl = bx & 255, bh = bx >> 8;
    if (bh === 0) hw.cgaSel = (hw.cgaSel & 0xe0) | (bl & 0x1f); else hw.cgaSel = (hw.cgaSel & ~0x20) | ((bl & 1) << 5); }
}
// INT 16h AH=1: key word if one is waiting, else 0 (= ZF set) after an idle point.
export function* kbhit16() { if (hw.keys.length) return hw.keys[0]; yield; return 0; }
// INT 16h AH=0: wait for a key.
export function* getkey16() { while (!hw.keys.length) yield; return hw.keys.shift(); }
// INT 1Ah AH=0 / AH=1: BIOS tick count (low word; the game never looks at CX).
export function* ticks1a() { const t = lw(0x46c); yield; return t; }
export function setTicks1a(cx, dx) { lww(0x46c, dx); lww(0x46e, cx); }

// ---------- DOS ----------
export class Exit { constructor(code) { this.code = code; } }
export function exit(code) { throw new Exit(code); }
function fileKey(name) { return Object.keys(hw.files).find(k => k.toUpperCase() === name.toUpperCase()); }
// INT 21h AH=3Dh: returns a handle, or -1 (the game never checks)
export function dosOpen(nameAddr) {
  const name = cstr(nameAddr).trim().replace(/^.*[\\:]/, '').toUpperCase(), k = fileKey(name);
  if (!k) return -1;
  const h = hw.nextHandle++; hw.handles.set(h, { name: k, pos: 0 }); return h;
}
export function dosRead(h, addr, n) {
  const f = hw.handles.get(h); if (!f) return -1;
  const d = hw.files[f.name], k = Math.max(0, Math.min(n, d.length - f.pos));
  for (let i = 0; i < k; i++) ds[(addr + i) & 0xffff] = d[f.pos + i];
  f.pos += k; return k;
}
export function dosWrite(h, addr, n) {
  const f = hw.handles.get(h); if (!f) return -1;
  let d = hw.files[f.name]; const end = f.pos + n;
  if (end > d.length) { const nd = new Uint8Array(end); nd.set(d); d = nd; hw.files[f.name] = d; }
  for (let i = 0; i < n; i++) d[f.pos + i] = ds[(addr + i) & 0xffff];
  f.pos = end; return n;
}
export function dosClose(h) { hw.handles.delete(h); }

// ---------- program start ----------
// Resets per-program state like a fresh EXEC (memory image from the snapshot) and returns main()'s generator.
export function load(prog, snapshot) {
  ds.set(snapshot); hw.sp = 0xffd0; hw.isrs = prog.isrs || {}; hw.handles.clear(); hw.nextHandle = 5;
  return prog.main();
}
export function resetMachine() {
  low.fill(0); for (let i = 0; i < 256; i++) { lww(i * 4, i); lww(i * 4 + 2, 0xf000); }
  lww(0x410, 0x0021); low[0x449] = 3; vram.fill(0);
  Object.assign(hw, { keys: [], cgaSel: 0, cgaMode: 0, picMask: 0xb8, pendingIrq: false, port61: 0,
    pitDiv: [65536, 65536, 65536], pitLatch: [null, null, null], spk: [], ticks: 0 });
}
resetMachine();

// ---------- video ----------
export const CGA_RGB = [[0,0,0],[0,0,170],[0,170,0],[0,170,170],[170,0,0],[170,0,170],[170,85,0],[170,170,170],
  [85,85,85],[85,85,255],[85,255,85],[85,255,255],[255,85,85],[255,85,255],[255,255,85],[255,255,255]];
// CGA mode 4 frame as 16-colour indices, 320x200
export function frame16(out = new Uint8Array(64000)) {
  const sel = hw.cgaSel, bg = sel & 15, pal = (sel & 0x20) ? [3, 5, 7] : [2, 4, 6], hi = (sel & 0x10) ? 8 : 0;
  const map = [bg, pal[0] + hi, pal[1] + hi, pal[2] + hi];
  for (let y = 0; y < 200; y++) {
    const row = (y & 1) * 0x2000 + (y >> 1) * 80;
    for (let x = 0; x < 80; x++) { const b = vram[row + x]; for (let k = 0; k < 4; k++) out[y * 320 + x * 4 + k] = map[(b >> (6 - 2 * k)) & 3]; }
  }
  return out;
}
