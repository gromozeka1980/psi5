// PSI5.EXE core: game state init, end-of-mission / crew report screens, and the asm helpers at 0x5a01..0x5ca2
// (keyboard with demo key script, VRAM fill / text, setjmp/longjmp, exit, BIOS tick wait, CGA background).
// DS globals:
//   0x2d0 indirect call target   0x2f6 "paused/escaped" flag   0x3b2 mission phase (1 = just ended)   0x3b4 / 0x3b6 / 0xb7a
//   0x3508 demo mode   0x350a sound on   0x350b joystick on   0x3510 ISR tick counter (demo key pacing, 60 ticks)
//   0x1ca4 main report menu sel   0x1ca6 sub menu sel   0x1ca8 debug menu sel   0x1caa/0x1cac/0x1cae debug menu flags
//   0x1cf2/0x1cf4 restart SP/BP   0x1cf6 restart return addr   0x1cf8/0x1cfa/0x1cfc setjmp addr/SP/BP
//   0x1cfe demo key script ptr (0x898a, loops to 0x8a56)   0x1d00 demo key delay count
//   draw params: 0x1d02 x (bytes)  0x1d04 y  0x1d06 text ptr  0x1d08 row count  0x1d0a fg idx  0x1d0c bg idx
//   0x1d0e/0x1d10 fg/bg pattern word  0x1d12[] colour pattern words  0x1d22[] CGA row start table
//   0x1ce8 fill width (bytes)  0x1cea fill height  0x1cec[] fill colour bytes  0x1eb2 8x8 font  0x219a 2bpp expand table
//   0x1300.. / 0x1310..0x1322 mission pay report (0x1320 total, 0x1322 = 1 if negative)   0x3b04 report-shown flag
import { F, callPtr } from './fn.js';
import { i16, u16, rb, rw, rs, wb, ww, vput, vram, int10, kbhit16, getkey16, ticks1a, setTicks1a, exit } from '../rt.js';

// @51d8 drawTextOnce(s, x, y): first call only: f_6ee0, f_705e, then text s at x,y in colour 1 on 0
function f_51d8(s, x, y) {
  if (rw(0x3b04) !== 0) return;
  ww(0x3b04, 1);
  F.f_6ee0(); F.f_705e();
  ww(0x1d0c, 0); ww(0x1d0a, 1); ww(0x1d02, x); ww(0x1d06, s); ww(0x1d04, y);
  f_5bf8();
}
// @5219 drawText1(s, x, y): text s at x,y in colour 1 on 0
function f_5219(s, x, y) {
  ww(0x1d0c, 0); ww(0x1d0a, 1); ww(0x1d02, x); ww(0x1d06, s); ww(0x1d04, y);
  f_5bf8();
}
// @5247 initGame: reset all mission state
function f_5247() {
  const dx = 0xffff;
  ww(0x3b4, 0x64); ww(0xb7a, rw(0x622b)); ww(0x2d0, 0x0d87);
  for (const a of [0x3b8, 0x3ba, 0x3bc, 0x3be, 0x3c0, 0x3c2, 0x3c4, 0x3de, 0x345a, 0x345c]) ww(a, dx);
  for (const a of [0x3b2, 0x3b6, 0x2d2, 0x1b18, 0x16cc, 0x16ca, 0x2e8, 0x2ea, 0x2ec, 0x2ee, 0x2f0, 0x2f2, 0x3b04, 0x2f6, 0x2f8,
    0x2d6, 0x2d8, 0x2da, 0x2dc, 0x2de, 0x2e0, 0x2e2, 0x2e4, 0x2e6]) ww(a, 0);
  for (let i = 0; i < 5; i++) { const si = i * 2; ww(si + 0x3d6, dx); ww(si + 0x3ce, dx); ww(si + 0x3c6, dx); }
  for (let i = 0; i < 8; i++) {
    const si = i * 2; ww(si + 0x430, dx); ww(si + 0x3e0, dx);
    for (const a of [0x97a, 0x440, 0x420, 0x410, 0x400, 0x3f0]) ww(si + a, 0);
  }
  for (let i = 0; i < 5; i++) {
    const si = i * 2;
    for (const a of [0x1288, 0x478, 0x46e, 0x464, 0x45a]) ww(si + a, 0);
    ww(si + 0x450, dx);
  }
  for (let i = 0; i < 7; i++) { const si = i * 2; for (const a of [0x4ac, 0x49e, 0x490, 0x482, 0x4e4, 0x4d6, 0x4c8, 0x4ba]) ww(si + a, 0); }
  for (let i = 0; i < 10; i++) ww(i * 2 + 0x4f2, 0);
  for (const a of [0x4cf2, 0x506, 0x508, 0x50a, 0x16d4, 0x16d2]) ww(a, 0);
  for (let i = 0; i < 0x1a; i++) {
    const si = i * 2;
    for (const a of [0x6d6, 0x6a2, 0x66e, 0x63a, 0x606, 0x5d2, 0x59e, 0x80e, 0x7da, 0x7a6, 0x772, 0x73e, 0x70a, 0x946, 0x912,
      0x8de, 0x8aa, 0x876]) ww(si + a, 0);
    ww(si + 0xebc, 2); ww(si + 0xf58, 1);
    for (const a of [0xef0, 0x119c, 0x1168, 0x1134, 0x1100, 0x1098, 0x1064, 0xffc]) ww(si + a, 0);
    ww(si + 0x10cc, dx); ww(si + 0x1030, dx);
  }
  ww(0x9da, 0x19);
  for (const a of [0x9ca, 0x9cc, 0x9ce, 0x9d0]) ww(a, dx);
  for (const a of [0x18aa, 0xb84, 0xb86, 0xb60, 0xb62, 0xb64, 0xb66, 0xb68, 0xb6a, 0xb6c, 0xb6e, 0x4cf6, 0x9d2, 0x9d4, 0x4cf4,
    0x9dc, 0x9de, 0x9d6, 0x9d8, 0x17da]) ww(a, 0);
  for (let i = 0; i < 0xc; i++) { ww(i * 2 + 0xd1e, 2); ww(i * 2 + 0xd38, 0); }
  ww(0xd36, 2); ww(0xd34, 0);
  for (let i = 0; i < 6; i++) ww(i * 2 + 0xce2, i);
  ww(0xf8c, 0x32); ww(0xf8e, 0x1e);
  for (const a of [0xf90, 0xf92, 0x4cf8, 0xf94, 0xf96]) ww(a, 0);
  for (let i = 0; i < 7; i++) { const si = i * 2; for (const a of [0xfee, 0xfe0, 0xfd2, 0xfc4]) ww(si + a, 0); }
  for (const a of [0x12fc, 0x12fe, 0x1300, 0x12de, 0x12e0, 0x12e2, 0x12e4, 0x12e6, 0x132a, 0x132c, 0x11d0, 0x11d2, 0x4cfa,
    0x11d4, 0x1b58]) ww(a, 0);
  for (let i = 0; i < 8; i++) { const si = i * 2; ww(si + 0x4d28, 0); ww(si + 0x4d18, 0); ww(si + 0x4d0c, 0); }
  for (let i = 0; i < 5; i++) { ww(i * 2 + 0x4ce8, 1); ww(i * 2 + 0x3212, 0); }
  ww(0x3b02, 0); ww(0x3b04, 0); ww(0x3b00, 1); ww(0x3afe, 1);
}
// @55f9 missionReport: end-of-mission screen (demo: wait, exit); menu S/D/I/Q
function* f_55f9() {
  if (rw(0x3508) !== 0) { yield* F.f_0748(0x3e8); f_5b6f(); }
  ww(0x2f6, 0);
  if (rw(0x3b2) === 1) {
    f_5840(); f_57e2();
    ww(0x3b2, rw(0x3b2) + 1);
    ww(0x1ca4, 0); ww(0xb82, 0);
    yield* f_5aff();
  }
  f_5683();
  for (;;) {
    const k = yield* F.f_0786(rs(0x1c1e), 0x1c0e, 0x1ca4);
    if (k === 0) break;
    if (k === 0x53) yield* f_569b();
    else if (k === 0x44) yield* f_5733();
    else if (k === 0x49) yield* f_57cb();
    else if (k === 0x51) { if (yield* F.f_03fb()) break; }
  }
}
// @5683 drawReportMenu
function f_5683() { F.f_04c5(); F.f_0693(); F.f_0672(0x1c0e, rs(0x1ca4)); }
// sub menu shared by @569b / @5733 (help table, function table, redraw)
function* subMenu(help, fns, redraw) {
  ww(0x1ca6, 0);
  redraw();
  for (;;) {
    const k = yield* F.f_0786(rs(0x1c52), 0x1c3c, 0x1ca6);
    if (k === 0x5e) break;
    F.f_06bf(rs(0x1c7a));
    F.f_06bf(rs(0x1c98 + rw(0x1ca6) * 2));
    yield* F.f_06f4();
    F.f_0988(rs(help + rw(0x1ca6) * 2));
    F.f_0abc();
    ww(0x2d0, rw(fns + rw(0x1ca6) * 2));
    callPtr(rw(0x2d0));
    redraw();
  }
  f_5683();
}
// @569b statusMenu
function* f_569b() { yield* subMenu(0x2767, 0x615a, f_5712); }
// @5712 drawStatusMenu
function f_5712() { F.f_04c5(); F.f_0693(); F.f_06bf(rs(0x1c62)); F.f_0672(0x1c3c, rs(0x1ca6)); }
// @5733 debriefMenu
function* f_5733() { yield* subMenu(0x2771, 0x6164, f_57aa); }
// @57aa drawDebriefMenu
function f_57aa() { F.f_04c5(); F.f_0693(); F.f_06bf(rs(0x1c72)); F.f_0672(0x1c3c, rs(0x1ca6)); }
// @57cb incomeReport: shows the pay report again
function* f_57cb() { F.f_06bf(rs(0x1ca2)); yield* F.f_06f4(); f_57e2(); f_5683(); }
// @57e2 drawPayReport
function f_57e2() {
  F.f_0988(rs(0x257d)); F.f_0abc();
  ww(0x1d0a, 3); ww(0x1d04, 0x80); ww(0x1d0c, 0);
  for (let i = 0; i < 7; i++) { F.f_0b7c(0x2711, i, i, 0); ww(0x1d04, rw(0x1d04) + 8); }
  F.f_0b7c(0x273b, 7, 0, 0);
}
// @5840 computePay: mission pay report numbers
function f_5840() {
  for (let i = 1; i < 8; i++) {
    const si = i * 2, ax = i16(i16(rs(0x6294 + si) * rs(0x4f2 + si)) + 5), q = Math.trunc(ax / 10);
    ww(0x1300 + si, q); ww(0x131e, rw(0x131e) + q); ww(0x130e + si, 0);
  }
  if (rs(0xb7a) >= 0x32) {
    ww(0x1310, Math.trunc(i16(i16(rs(0x62ae) * rs(0x3b4)) + 5) / 10));
    const bx = rs(0x3b6), cx = rs(0x622d);
    if (cx >= bx) ww(0x1312, rs(0x62a8) + i16(i16(cx - bx) * rs(0x62aa)));
  }
  ww(0x1314, rw(0x131e)); ww(0x1316, rw(0x62ac));
  for (let i = 0; i < 5; i++) if (rw(0x4ce8 + i * 2) === 0) ww(0x1318, rw(0x1318) + rw(0x62a4));
  ww(0x131a, i16(rs(0x62a6) * i16(rw(0x502) + rw(0x504))));
  const bx = i16(rs(0x132c) + Math.trunc(rs(0x132a) / 4));
  const c0 = i16(rw(0x1310) + rw(0x1312) + rw(0x1314) - rw(0x1316) - rw(0x1318) - rw(0x131a));
  ww(0x1322, 0); ww(0x1320, c0 - bx); ww(0x131c, bx);
  if (c0 < bx) { ww(0x1322, 1); ww(0x1320, -rw(0x1320)); }   // jge after sub = signed compare
}
// @594e debugMenu (never called): N/C/S/T/Q set flags
function* f_594e() {
  ww(0x1ca8, 0);
  f_59e8();
  for (;;) {
    const k = yield* F.f_0786(rs(0x1ce6), 0x1cd0, 0x1ca8);
    if (k === 0x5e) break;
    if (k === 0x4e) ww(0x1caa, 0);
    else if (k === 0x43) { ww(0x1cac, 1); ww(0x1caa, 1); }
    else if (k === 0x53) { ww(0x1caa, 1); ww(0x1cac, 2); }
    else if (k === 0x54) { ww(0x1caa, 1); ww(0x1cae, 4); }
    else if (k === 0x51) { ww(0x1caa, 1); ww(0x1cae, 0); }
    else continue;
    f_59e8();
  }
  F.f_04c5();
}
// @59e8 drawDebugMenu
function f_59e8() { F.f_04c5(); F.f_0672(0x1cd0, rs(0x1ca8)); F.f_0693(); }
// @5a79 pollKey: key (ascii, or scan<<8 for extended keys) or 0. Key-read tail @5a01: ^Q/^S sound, ^J/^K joystick,
// ESC (when [0x3b2]==0) = pause screen until a key; in demo mode any other key exits, and every 60 ticks a key comes
// from the demo script ([0x1cfe]: 0 = Home, 1 = restart script, 2 n = wait n steps, else the key).
function* f_5a79() {
  if (yield* kbhit16()) {
    const w = yield* getkey16(), al = w & 255;
    if (rw(0x3508) !== 0) {
      if (al === 0x11) { wb(0x350a, 0); return 0; }
      if (al === 0x13) { wb(0x350a, 1); return 0; }
      f_5b6f();
    }
    if (al === 0x11) wb(0x350a, 0);
    if (al === 0x13) wb(0x350a, 1);
    if (al === 0x0a) wb(0x350b, 1);
    if (al === 0x0b) wb(0x350b, 0);
    if (al === 0) return i16(w);
    if (al === 0x1b && rw(0x3b2) === 0) {
      F.f_0988(0x253e);
      yield* getkey16();
      ww(0x2f6, 1);
      F.f_08e6();
      return 0;
    }
    return al;
  }
  if (rb(0x350b) !== 0) {
    const ax = F.f_7160();
    if (ax !== 0) { if (rw(0x3508) !== 0) f_5b6f(); return ax; }
  }
  if (rw(0x3508) === 0 || rw(0x3510) < 0x3c) return 0;
  ww(0x3510, 0);
  if (rw(0x1d00) !== 0) { ww(0x1d00, rw(0x1d00) - 1); return 0; }
  const si = rw(0x1cfe);
  ww(0x1cfe, si + 1);
  const al = rb(si);
  if (al === 0) return 0x4700;
  if (al === 1) { ww(0x1cfe, 0x8a56); return 0; }
  if (al === 2) { ww(0x1cfe, rw(0x1cfe) + 1); ww(0x1d00, rb(si + 1)); return 0; }
  return al;
}
// @5af1 waitKey: until a key, calling f_7086 while waiting
function* f_5af1() { do F.f_7086(); while ((yield* f_5a79()) === 0); }
// @5aff flushKeys
function* f_5aff() { while ((yield* f_5a79()) !== 0); }
// @5b0a fillRect: x [0x1d02] (bytes), y [0x1d04], w [0x1ce8], h [0x1cea], colour byte [0x1cec + [0x1d0c]]
function f_5b0a() {
  let dx = rw(0x1cea), si = (rw(0x1d04) * 2) & 0xffff;
  const al = rb(0x1cec + rw(0x1d0c));
  do {
    const di = rw(0x1d22 + si) + rw(0x1d02);
    for (let n = rw(0x1ce8), k = 0; n; n--, k++) vput(di + k, al);
    si = (si + 2) & 0xffff; dx = (dx - 1) & 0xffff;
  } while (dx !== 0);
}
// @5b3a popcount(x)
function f_5b3a(x) { let n = 0; for (let b = u16(x); b; b >>= 1) n += b & 1; return n; }
// @5b50 (main 0x00a4): restart point + demo script start
function f_5b50() { ww(0x1cf6, 0x00a7); ww(0x1cfe, 0x898a); }
// @5b5f restart (same crew): back to main 0x00a7
function f_5b5f() { F.f_6c78(); restarted = true; throw F.RESTART; }
// @5b6f quit: restore timer, clear screen, exit to DOS
function f_5b6f() { F.f_6c78(); f_5bc4(); exit(0); }
// @5b86 setjmp (main 0x0176): saves SP = BP = main's bp, 0xffc8; after a restart main runs with SP = BP = 0 ([0x1cf2/4])
let restarted = false;
function f_5b86() { const sp = restarted ? 0 : 0xffc8; ww(0x1cf8, 0x0179); ww(0x1cfa, sp); ww(0x1cfc, sp); }
// @5b97 longjmp to main 0x0179
function f_5b97() { f_5bed(0x20); throw F.LJ_MAIN; }
// @5baa waitBiosTicks(n)
function* f_5baa(n) { setTicks1a(0, 0); while ((yield* ticks1a()) < u16(n)); }
// @5bc4 clearScreen
function f_5bc4() { vram.fill(0); }
// @5be1 setMode4: CGA 320x200, background 0x20
function f_5be1() { int10(0x0004, 0); f_5bed(0x20); }
// @5bed setBackground(al): INT 10h AH=0Bh BH=0
function f_5bed(al) { int10(0x0b00 | (al & 255), al & 255); }
// @5bf8 drawText: string [0x1d06] at x [0x1d02] (bytes), y [0x1d04], colours [0x1d0a]/[0x1d0c]; CR = newline;
// spaces and newlines call f_6e26 (background tick work)
function f_5bf8() {
  ww(0x1d0e, rw(0x1d12 + rw(0x1d0a) * 2));
  ww(0x1d10, rw(0x1d12 + rw(0x1d0c) * 2));
  for (;;) {
    const ch = rb(rw(0x1d06));
    if (ch === 0) return;
    let g = ch - 0x20;
    if (((ch << 24) >> 24) <= 0x20) {                // sub al,20h; jg: signed byte compare
      if (g !== 0) {
        ww(0x1d06, rw(0x1d06) + 1);
        if (ch === 0x0d) { ww(0x1d02, 0); ww(0x1d04, rw(0x1d04) + 8); F.f_6e26(); }
        continue;
      }
      F.f_6e26(); g = 0;
    }
    let si = (0x1eb2 + g * 8) & 0xffff, di = (rw(0x1d04) * 2) & 0xffff;
    ww(0x1d08, 8);
    do {
      const pat = rw(0x219a + rb(si) * 2);
      const v = ((~pat & 0xffff) & rw(0x1d10)) | (pat & rw(0x1d0e));
      const a = rw(0x1d22 + di) + rw(0x1d02);
      vput(a, v >> 8); vput(a + 1, v & 255);
      di = (di + 2) & 0xffff; si = (si + 1) & 0xffff;
      ww(0x1d08, rw(0x1d08) - 1);
    } while (rs(0x1d08) > 0);
    ww(0x1d06, rw(0x1d06) + 1);
    ww(0x1d02, rw(0x1d02) + 2);
  }
}

Object.assign(F, { f_51d8, f_5219, f_5247, f_55f9, f_5683, f_569b, f_5712, f_5733, f_57aa, f_57cb, f_57e2, f_5840, f_594e,
  f_59e8, f_5a79, f_5af1, f_5aff, f_5b0a, f_5b3a, f_5b50, f_5b5f, f_5b6f, f_5b86, f_5b97, f_5baa, f_5bc4, f_5be1, f_5bed,
  f_5bf8 });
