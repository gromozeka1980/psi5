// SEL.EXE — course and crew selection. 1:1 port; `@xxxx` = function address in the original (re/sel.lst).
// DS globals (offsets into the original data segment):
//   0x10 course (0..3)   0x12 blink counter   0x14 candidate (0..5)   0x16[5] chosen candidate per department (dept*6+i)
//   0x20 "Welcome"(0)/"Exit"(1)   0x22 "Accept"(0)/"Reselect"(1)   0x24 idle countdown   0x26 demo mode
//   0x28[6]/0x34[6] candidate box x (bytes) / y   0x14e[30] candidate names   0x18a[30] candidate hot keys
//   0x1aa[19]/0x1d2[19] resume line x/y   0x2d98[30*19] resume lines   0x28e[5] department names
//   0x33ea x  0x33ec y  0x33ee text ptr  0x33f2/0x33f4 fg/bg colour index  0x3406/0x3408 rect w (bytes)/h   (draw params)
//   0x320c ticks/13   0x3210 tune ptr   0xe7c9.. SELECT.BIN image (mission + 5 crew file names, flags at 0xe829..)
//   0xe82b sound on   0xe82c joystick on
import { ds, vram, hw, CS, i16, rb, rw, rs, wb, ww, lw, lww, low, inp, outp, int10, kbhit16, getkey16, ticks1a, setTicks1a,
  dosOpen, dosRead, dosWrite, dosClose } from './rt.js';

const LONGJMP = { longjmp: 'sel' };
const rowAddr = y => rw(0x344a + y * 2);          // CGA row start table (DS 0x344a, one word per scan line)
const vput = (a, v) => { a &= 0xffff; if (a < 0x4000) vram[a] = v; };

// @0082
export function* main() {
  setupScreen();
  if (copyCheck()) return;
  putSprite(rw(0x35da), 0, 0);                    // title picture
  loadSelect();
  yield* waitBiosTicks(0x36);
  timerInit();
  for (let i = 0; i < 20; i++) yield* pollKey();
  playTune(0);
  ww(0x24, 0x113);
  while (!(yield* getKey()) && rs(0x24) > 0xbe);  // title: until a key, or the countdown reaches 0xbe
  ww(0x340e, 0x00e6); ww(0x3410, 0xffbe); ww(0x3412, 0xffbe);   // setjmp @0ff3 saves return address, SP, BP
  for (;;) {                                      // a key pressed in demo mode longjmps back here
    try { yield* selectAll(); break; } catch (e) { if (e !== LONGJMP) throw e; }
  }
  ww(0x3406, 0x50); ww(0x33f4, 0); ww(0x33ea, 0); ww(0x3408, 8); ww(0x33ec, 8);
  fillRect();
  timerRestore();
  saveSelect();
}

function* selectAll() {                           // main @00e6..038e
  let done = 0;
  ww(0x26, 0);
  while (!done) {
    clearScreen();
    drawScript(rw(0x3622));
    ww(0x10, 0);
    drawCourses();
    playTune(2);
    for (;;) {                                    // course
      const k = yield* getKey();
      if (k === 0x0d) break;
      if (k === 0x4800) { if (rs(0x10) > 0) ww(0x10, rw(0x10) - 1); }
      else if (k === 0x5000) { if (rs(0x10) < 3) ww(0x10, rw(0x10) + 1); }
      else if (k >= 0x31 && k <= 0x34) { ww(0x10, k - 0x31); break; }
      drawCourses();
    }
    drawCourses();
    for (let dept = 0; dept < 5; dept++) {
      let again = 1;
      ww(0x14, 0);
      while (again) {
        clearScreen();
        drawScript(rw(0x39d9));
        drawDepartment(dept);
        playTune(2);
        for (;;) {                                // candidate
          const k = yield* getKey();
          if (k === 0x0d) break;
          if (k === 0x4800) { if (rs(0x14) > 2) ww(0x14, rw(0x14) - 3); }
          else if (k === 0x5000) { if (rs(0x14) < 3) ww(0x14, rw(0x14) + 3); }
          else if (k === 0x4b00) ww(0x14, rw(0x14) - 1);
          else if (k === 0x4d00) ww(0x14, rw(0x14) + 1);
          else {
            let found = 0;
            for (let i = 0; i < 6; i++) if (rb(0x18a + i16(dept * 6) + i) === k) { found = 1; ww(0x14, i); }
            if (found) break;
          }
          if (rs(0x14) < 0) ww(0x14, 5);
          if (rs(0x14) > 5) ww(0x14, 0);
          drawCandidateFrames(dept);
        }
        drawCandidateFrames(dept);
        showResume(dept, rs(0x14));
        ww(0x20, 0);
        drawWelcome(dept, rs(0x14));
        playTune(2);
        for (;;) {                                // "Welcome to the crew" / "Exit"
          const k = yield* getKey();
          if (k === 0x0d) break;
          if (k === 0x4b00 || k === 0x4d00) ww(0x20, rw(0x20) ^ 1);
          else if (k === 0x57) { ww(0x20, 0); break; }
          else if (k === 0x45) { ww(0x20, 1); break; }
          drawWelcome(dept, rs(0x14));
        }
        drawWelcome(dept, rs(0x14));
        if (!rw(0x20)) again = 0;
      }
      ww(0x16 + dept * 2, i16(dept * 6) + rw(0x14));
    }
    clearScreen();
    showCrew();
    ww(0x22, 0);
    drawAccept();
    for (;;) {                                    // "Accept final crew" / "Reselect crew"
      const k = yield* getKey();
      if (k === 0x0d) break;
      if (k === 0x4b00 || k === 0x4d00) ww(0x22, rw(0x22) ^ 1);
      else if (k === 0x41) { ww(0x22, 0); break; }
      else if (k === 0x52) { ww(0x22, 1); break; }
      drawAccept();
    }
    drawAccept();
    if (!rw(0x22)) done = 1;
  }
}

// @03b5: wait for a key (upper-cased) or the next 39-tick step; counts down the idle timer, enters demo mode.
function* getKey() {
  let k;
  do k = yield* pollKey(); while (!k && rs(0x320c) <= 2);
  if (k) {
    if (k === 4) { ww(0x26, 1); k = 0x0d; ww(0x24, 0x0f); }          // ^D: demo
    else {
      if (k >= 0x61 && k <= 0x7a) k = i16(k - 0x20);
      ww(0x24, 0xbe);
      if (rw(0x26) && k !== 0x11 && k !== 0x13) throw LONGJMP;          // longjmp @1004
    }
  }
  if (rs(0x320c) > 2) {
    const t = i16(rs(0x24) - 1);
    ww(0x12, rw(0x12) + 1); ww(0x320c, 0); ww(0x24, t);
    if (t === 0) { ww(0x26, 1); k = 0x0d; ww(0x24, 0x0f); }
  }
  return k;
}

// @044d
function drawCourses() {
  for (let i = 0; i < 4; i++) {
    if (rw(0x10) === i && (rw(0x12) & 1)) { ww(0x33f2, 0); ww(0x33f4, 1); } else { ww(0x33f2, 1); ww(0x33f4, 0); }
    drawScript(rw(0x384d + i * 2));
  }
}
// @04a4
function drawDepartment(dept) {
  ww(0x33f4, 1); ww(0x3406, 0x50); ww(0x3408, 0x10); ww(0x33ec, 0); ww(0x33ea, 0); ww(0x33f2, 0);
  fillRect();
  ww(0x33f4, 1); ww(0x33ea, 0); ww(0x33ec, 0x12); ww(0x3406, 0x50); ww(0x3408, 0xa4);
  fillRect();
  drawScript(rw(0x3a32 + dept * 2));
  drawScript(rw(0x3a84));
  drawScript(rw(0x39d9));
  for (let i = 0; i < 6; i++) {
    const c = i16(dept * 6) + i;
    drawCandidateFrame(i, c);
    drawCandidatePortrait(i, c);
    drawCandidateShadow(i);
  }
}
// @054e
function drawCandidateFrames(dept) { for (let i = 0; i < 6; i++) drawCandidateFrame(i, i16(dept * 6) + i); }
// @0582: frame + name of candidate box i (highlighted and blinking when selected)
function drawCandidateFrame(i, c) {
  if (rw(0x14) === i && (rw(0x12) & 1)) { ww(0x33f2, 0); ww(0x33f4, 2); } else { ww(0x33f2, 0); ww(0x33f4, 3); }
  const bx = rw(0x28 + i * 2), by = rw(0x34 + i * 2);
  ww(0x3406, 0x14); ww(0x3408, 8); ww(0x33ec, by - 8); ww(0x33ea, bx - 2);
  fillRect();
  ww(0x3406, 2); ww(0x3408, 0x38); ww(0x33ec, by); ww(0x33ea, bx - 2);
  fillRect();
  ww(0x33ea, bx + 0x10);
  fillRect();
  ww(0x33ec, by + 0x30); ww(0x33ee, rw(0x14e + c * 2)); ww(0x33ea, bx);
  drawText();
}
// @0647
function drawCandidatePortrait(i, c) { putSprite(rw(0x35dc + c * 2), (rw(0x28 + i * 2) << 2) & 0xffff, rw(0x34 + i * 2)); }
// @0676
function drawCandidateShadow(i) {
  ww(0x33f4, 0);
  const bx = rw(0x28 + i * 2), by = rw(0x34 + i * 2);
  ww(0x3406, 2); ww(0x3408, 0x40); ww(0x33ec, by - 2); ww(0x33ea, bx - 4);
  fillRect();
  ww(0x3406, 0x12); ww(0x3408, 6); ww(0x33ec, by + 0x38); ww(0x33ea, bx - 2);
  fillRect();
}
// @06db: full-screen resume of a candidate
function showResume(dept, cand) {
  clearScreen();
  rect(3, 0x12, 0x10, 0x3e, 0xb0);
  rect(3, 0x3c, 3, 0x0e, 0x0e);
  rect(1, 0, 3, 0x0e, 0xbe);
  rect(1, 0x0e, 3, 8, 5);
  const c = i16(dept * 6) + cand;
  putSprite(rw(0x35dc + c * 2), 0x18, 0x10);
  rect(3, 4, 8, 0x14, 8);
  rect(3, 4, 0x10, 2, 0x38);
  ww(0x33ea, 0x16); fillRect();
  rect(0, 2, 0x0e, 2, 0x3a);
  rect(0, 2, 0x48, 0x14, 6);
  ww(0x33f4, 3); ww(0x33f2, 0); ww(0x33ea, 6); ww(0x33ec, 0x40); ww(0x33ee, rw(0x14e + c * 2));
  drawText();
  for (let i = 0; i < 5; i++) putSpriteAt(rw(0x3618 + i * 2));
  ww(0x33f2, 0); ww(0x33f4, 3);
  drawScript(rw(0x3a9f));
  const cc = i16(c * 0x13);
  for (let i = 0; i < 0x13; i++) textAt(rw(0x1aa + i * 2), rw(0x1d2 + i * 2), rw(0x2d98 + ((cc + i) & 0xffff) * 2));
}
function rect(bg, x, y, w, h) { ww(0x33f4, bg); ww(0x33ea, x); ww(0x33ec, y); ww(0x3406, w); ww(0x3408, h); fillRect(); }
// @0895
function drawWelcome(dept, cand) {
  const c = i16(dept * 6) + cand;
  if (rw(0x20) === 0 && (rw(0x12) & 1)) { ww(0x33f2, 1); ww(0x33f4, 0); } else { ww(0x33f2, 0); ww(0x33f4, 1); }
  textAt(0, 0xc0, rw(0x206));
  textAt(0x14, 0xc0, rw(0x14e + c * 2));
  textAt(0x24, 0xc0, rw(0x218));
  if (rw(0x20) !== 0 && (rw(0x12) & 1)) { ww(0x33f2, 1); ww(0x33f4, 0); } else { ww(0x33f2, 0); ww(0x33f4, 1); }
  textAt(0x40, 0xc0, rw(0x224));
}
// @094a
function showCrew() {
  ww(0x33f4, 1); ww(0x33ea, 0); ww(0x33ec, 0x12); ww(0x3406, 0x50); ww(0x3408, 0xa4);
  fillRect();
  for (let i = 0; i < 5; i++) drawCrewMember(i);
  ww(0x33f4, 3); ww(0x33ea, 0x36); ww(0x33ec, 0x68); ww(0x3406, 0x14); ww(0x3408, 0x40);
  fillRect();
  drawScript(rw(0x390d + rw(0x10) * 2));
  drawCandidateShadow(5);
}
// @09c8
function drawAccept() {
  if (rw(0x22) === 0 && (rw(0x12) & 1)) { ww(0x33f2, 1); ww(0x33f4, 0); } else { ww(0x33f2, 0); ww(0x33f4, 1); }
  textAt(0, 8, rw(0x23e));
  if (rw(0x22) !== 0 && (rw(0x12) & 1)) { ww(0x33f2, 1); ww(0x33f4, 0); } else { ww(0x33f2, 0); ww(0x33f4, 1); }
  textAt(0x2c, 8, rw(0x254));
}
// @0a46
function drawCrewMember(i) {
  drawCandidatePortrait(i, rw(0x16 + i * 2));
  drawCandidateShadow(i);
  ww(0x33f2, 0); ww(0x33f4, 3);
  const bx = rw(0x28 + i * 2), by = rw(0x34 + i * 2);
  ww(0x33ee, rw(0x28e + i * 2)); ww(0x33ec, by - 8); ww(0x33ea, bx - 2);
  drawText();
  ww(0x3406, 2); ww(0x3408, 0x38); ww(0x33ec, by); ww(0x33ea, bx - 2);
  fillRect();
  ww(0x33ea, bx + 0x10);
  fillRect();
  ww(0x33ee, rw(0x14e + rw(0x16 + i * 2) * 2)); ww(0x33ec, by + 0x30); ww(0x33ea, bx);
  drawText();
}

// @0b05: drawing script: 0 end, 1 <text\0>, 2 x y, 3 x, 4 fg bg, 5 x y w h (filled rect), 6 newline
function drawScript(p) {
  for (;;) {
    const c = rb(p); p = (p + 1) & 0xffff;
    if (c === 0) return;
    if (c === 1) { ww(0x33ee, p); drawText(); p = (rw(0x33ee) + 1) & 0xffff; ww(0x33ee, p); }
    else if (c === 6) { ww(0x33ea, 0); ww(0x33ec, rw(0x33ec) + 8); }
    else if (c === 2) { ww(0x33ea, rb(p)); ww(0x33ec, rb(p + 1)); p = (p + 2) & 0xffff; }
    else if (c === 3) { ww(0x33ea, rb(p)); p = (p + 1) & 0xffff; }
    else if (c === 4) { ww(0x33f2, rb(p)); ww(0x33f4, rb(p + 1)); p = (p + 2) & 0xffff; }
    else if (c === 5) { ww(0x33ea, rb(p)); ww(0x33ec, rb(p + 1)); ww(0x3406, rb(p + 2)); ww(0x3408, rb(p + 3)); p = (p + 4) & 0xffff; fillRect(); }
  }
}
// @0c09
function textAt(x, y, s) { ww(0x33ee, s); ww(0x33ea, x); ww(0x33ec, y); drawText(); }

// @0c26: hook IRQ0 (120 Hz) for the tune player
function timerInit() {
  outp(0x61, inp(0x61) & 0xfc);
  outp(0x43, 0xb6);
  outp(0x21, inp(0x21) | 3);
  ww(0x3210, 0x3212); ww(0x3214, 0x3212);
  ww(0x321c, lw(0x20)); ww(0x321e, lw(0x22));
  lww(0x20, 0x0ca9); lww(0x22, CS);
  outp(0x21, inp(0x21) & 0xfc);
  outp(0x40, 0xd4); outp(0x40, 0x26);
}
// @0c78
function timerRestore() {
  outp(0x21, inp(0x21) | 3);
  lww(0x20, rw(0x321c)); lww(0x22, rw(0x321e));
  outp(0x21, inp(0x21) & 0xfc);
  outp(0x40, 0); outp(0x40, 0);
  outp(0x61, inp(0x61) & 0xfc);
}
// @0ca9: INT 8 handler (120 Hz): tick counter, tune player (bytes: duration, note; tempo byte first)
function isr() {
  ww(0x320e, rw(0x320e) + 1);
  if (rw(0x320e) >= 0x0d) { ww(0x320e, 0); ww(0x320c, rw(0x320c) + 1); }
  if (rb(0x321b)) wb(0x321b, rb(0x321b) - 1);
  else {
    wb(0x321b, rb(0x321a));
    if (rb(0x3216)) { wb(0x3216, rb(0x3216) - 1); if (rb(0x3216) === rb(0x3217)) speakerOff(); }
    else {
      const si = rw(0x3210), dur = rb(si);
      if (dur === 0 || rb(0xe82b) !== 1) { ww(0x3210, 0x3212); speakerOff(); }
      else {
        wb(0x3216, dur - 1); wb(0x3217, (dur - 1) >> 3);
        const note = rb(si + 1); ww(0x3210, rw(0x3210) + 2);
        if (note === 0) speakerOff();
        else { const d = rw(0x3220 + note * 2); outp(0x42, d & 255); outp(0x42, d >> 8); outp(0x61, inp(0x61) | 3); }
      }
    }
  }
  outp(0x20, 0x20);
}
function speakerOff() { outp(0x61, inp(0x61) & 0xfc); }
export const isrs = { 0x0ca9: isr };
// @0d50: start tune n (n = byte offset into the tune table at 0xa3a6) unless one is playing
function playTune(n) {
  if (!rb(0xe82b)) return;
  if (rb(rw(0x3210)) !== 0) return;
  let p = rw((n - 0x5c5a) & 0xffff);
  wb(0x321a, rb(p)); p++;
  ww(0x3210, p); wb(0x3216, 0);
}
// @0dba
function clearScreen() { vram.fill(0, 0, 8000); vram.fill(0, 0x2000, 0x2000 + 8000); }
// @0dd7
function setupScreen() {
  clearScreen();
  lww(0x410, (lw(0x410) & 0xffcf) | 0x10);
  int10(0x0004, 0);
  int10(0x0b00, 0x0101);
  int10(0x0b00, 0x0020);
}
// @0e31: draw string [0x33ee] at x [0x33ea] (bytes), y [0x33ec] with colours [0x33f2]/[0x33f4]; 8x8 font at 0x3cfc
function drawText() {
  ww(0x33f6, rw(0x33fa + rw(0x33f2) * 2));
  ww(0x33f8, rw(0x33fa + rw(0x33f4) * 2));
  for (;;) {
    let ch = rb(rw(0x33ee));
    if (ch === 0) return;
    let g = (ch - 0x20) & 255;
    if (g === 0 || g >= 0x80) {                   // space -> glyph 0; control/high chars: only CR does something
      if (g !== 0) {
        ww(0x33ee, rw(0x33ee) + 1);
        if (ch === 0x0d) { ww(0x33ea, 0); ww(0x33ec, rw(0x33ec) + 8); }
        continue;
      }
    }
    let si = (0x3cfc + g * 8) & 0xffff;
    ww(0x33f0, 8);
    let di = (rw(0x33ec) * 2) & 0xffff;
    do {
      const pat = rw(0x3afc + rb(si) * 2);
      const v = ((~pat & 0xffff) & rw(0x33f8)) | (pat & rw(0x33f6));
      const a = (rw(0x344a + di) + rw(0x33ea)) & 0xffff;
      vput(a, v >> 8); vput(a + 1, v & 255);
      di = (di + 2) & 0xffff; si = (si + 1) & 0xffff;
      ww(0x33f0, rw(0x33f0) - 1);
    } while (rs(0x33f0) > 0);
    ww(0x33ee, rw(0x33ee) + 1);
    ww(0x33ea, rw(0x33ea) + 2);
  }
}
// @0efe: draw sprite p at pixel x (byte aligned), y; remembers the position in the sprite header
function putSprite(p, x, y) { ww(p + 8, x); ww(p + 10, y); blit(p, rw(p + 8) >> 2, rw(p + 10)); }
// @0f48: draw sprite at its stored position (header x is in bytes here)
function putSpriteAt(p) { blit(p, rw(p + 8), rw(p + 10)); }
// @0f1f: sprite header: +0 width (bytes), +2 height, +8 x, +10 y; data from +12
function blit(p, xb, y) {
  ww(0x3402, xb);
  let row = (y * 2) & 0xffff, si = p;
  ww(0x3404, rw(si)); let h = rw(si + 2); si = (si + 12) & 0xffff;
  do {
    const di = (rw(0x344a + row) + rw(0x3402)) & 0xffff;
    for (let n = rw(0x3404), k = 0; n; n--, k++) { vput(di + k, rb(si)); si = (si + 1) & 0xffff; }
    row = (row + 2) & 0xffff; h = i16(h - 1);
  } while (h > 0);
}
// @0f98: key (ascii, or scan<<8 for extended keys), joystick if enabled, else 0. ^Q/^S sound off/on, ^J/^K joystick.
function* pollKey() {
  if (yield* kbhit16()) {
    const w = yield* getkey16(), al = w & 255;
    if (al === 0x11) wb(0xe82b, 0);
    if (al === 0x13) wb(0xe82b, 1);
    if (al === 0x0a) wb(0xe82c, 1);
    if (al === 0x0b) wb(0xe82c, 0);
    return al !== 0 ? al : w;
  }
  return rb(0xe82c) === 1 ? joystick() : 0;
}
// @0fad: fill rect x [0x33ea] (bytes), y [0x33ec], w [0x3406], h [0x3408] with colour byte [0x340a + bg]
function fillRect() {
  let h = rw(0x3408), row = (rw(0x33ec) * 2) & 0xffff;
  const v = rb(0x340a + rw(0x33f4));
  do {
    const di = (rw(0x344a + row) + rw(0x33ea)) & 0xffff;
    for (let n = rw(0x3406), k = 0; n; n--, k++) vput(di + k, v);
    row = (row + 2) & 0xffff; h = (h - 1) & 0xffff;
  } while (h !== 0);
}
// @1011: wait until the BIOS tick count reaches n
function* waitBiosTicks(n) {
  setTicks1a(0, 0);
  while ((yield* ticks1a()) < n);
}
// @1080: read the joystick as a key (no joystick here: port 0x201 never changes)
function joystick() {
  wb(0x3422, 0);
  let al = inp(0x201); wb(0x3420, al);
  let bl = 3; ww(0x341c, 0x50); ww(0x341e, 0x50);
  let cx = 0;
  outp(0x201, al);
  for (;;) {                                      // time both axes (one-shot bits)
    al = (inp(0x201) & bl) ^ bl;
    if (al === 0) { cx++; if (cx < 0x12c) continue; break; }
    if (al & 1) { ww(0x341c, cx); bl &= 2; if (bl) { if (!(al & 2)) continue; } else break; }
    else if (!(al & 2)) continue;
    ww(0x341e, cx); bl &= 1; if (bl) continue; break;
  }
  // x axis: auto-calibrating thresholds
  let ax = rs(0x341c);
  const calX = () => {
    let a = (rw(0x3425) - rw(0x3423)) & 0xffff; a >>= 1; const b = a >> 1;
    a = (a + rw(0x3423) + b) & 0xffff; ww(0x342d, a); a = (a - b - b) & 0xffff; ww(0x342b, a);
  };
  if (ax < rs(0x3423)) { ww(0x3423, ax); calX(); ax = rs(0x341c); ww(0x3429, 8); ww(0x3427, 0x4e20); }
  else if (ax <= rs(0x3425)) { ww(0x3429, 8); ww(0x3427, 0x4e20); }
  else {
    ww(0x3429, rw(0x3429) - 1);
    if (rw(0x3429) === 0) { ww(0x3425, rw(0x3427)); calX(); ax = rs(0x341c); ww(0x3429, 8); ww(0x3427, 0x4e20); }
    else if (ax < rs(0x3427)) ww(0x3427, ax);
  }
  if (ax < rs(0x342b)) wb(0x3422, rb(0x3422) | 8);
  else if (ax >= rs(0x342d)) wb(0x3422, rb(0x3422) | 4);
  // y axis (unsigned compares at the low threshold)
  let ay = rw(0x341e);
  const calY = () => {
    let a = (rw(0x3431) - rw(0x342f)) & 0xffff; a >>= 1; const b = a >> 1;
    a = (a + rw(0x342f) + b) & 0xffff; ww(0x3439, a); a = (a - b - b) & 0xffff; ww(0x3437, a);
  };
  if (ay < rw(0x342f)) { ww(0x342f, ay); calY(); ay = rw(0x341e); ww(0x3435, 8); ww(0x3433, 0x4e20); }
  else if (i16(ay) <= rs(0x3431)) { ww(0x3435, 8); ww(0x3433, 0x4e20); }
  else {
    ww(0x3435, rw(0x3435) - 1);
    if (rw(0x3435) === 0) { ww(0x3431, rw(0x3433)); calY(); ay = rw(0x341e); ww(0x3435, 8); ww(0x3433, 0x4e20); }
    else if (i16(ay) < rs(0x3433)) ww(0x3433, ay);
  }
  if (ay < rw(0x3437)) wb(0x3422, rb(0x3422) | 1);
  else if (ay >= rw(0x3439)) wb(0x3422, rb(0x3422) | 2);
  wb(0x3422, rb(0x3422) | (((inp(0x201) & rb(0x3420)) & 0x30) ^ 0x30));
  const ah = rb(0x3421);
  if (ah === rb(0x3422)) return 0;
  // report one newly pressed direction/button (edge detection against 0x3421)
  let dl = 1, dh = 0xfe; al = rb(0x3422);
  for (let n = 6; n; n--) {
    if (dl & al) { if (!(dl & ah)) { wb(0x3421, rb(0x3421) | dl); return rw(0x343b + n * 2); } }
    else wb(0x3421, rb(0x3421) & dh);
    dl = (dl << 1) & 255; dh = ((dh << 1) | (dh >> 7)) & 255;
  }
  return 0;
}
// @11fc: copy-protection stub (always passes)
function copyCheck() { return 0; }
// @1204: write SELECT.BIN: mission file, 5 crew files, demo/sound/joystick flags (100 bytes from 0xe7c9)
function saveSelect() {
  ww(0xe829, rw(0x26));
  let di = 0xe7c9;
  di = strcpy(di, rw(0xe79a + rw(0x10) * 2));
  strcpy(di, 0xe7ba);                              // ".BIN"
  for (let bx = 0; bx < 10; bx += 2) {
    di = strcpy(rw(0xe7bf + bx), rw(0xe6ae + rw(0x16 + bx) * 2));
    strcpy(di, 0xe7ba);
  }
  const h = dosOpen(0xe82d); dosWrite(h, 0xe7c9, 0x64); dosClose(h);
}
// @125e
function loadSelect() { const h = dosOpen(0xe82d); dosRead(h, 0xe7c9, 0x64); dosClose(h); }
// @127a: copies the string including its NUL; returns the address of the copied NUL (asm: di is left there)
function strcpy(di, si) { for (;;) { const c = rb(si); wb(di, c); if (!c) return di; si = (si + 1) & 0xffff; di = (di + 1) & 0xffff; } }
