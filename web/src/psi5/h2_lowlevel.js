// PSI5.EXE @64be..@7306 — low-level asm helpers: department message queues + indicator lights, the talking-head
// animation player, 3-digit number formatting, file I/O (DASH.BIN, SELECT.BIN, mission/crew .BIN), the 120 Hz timer
// ISR with its tune player, the per-tick display update (starfield in an off-screen buffer, screen blits, RLE
// pictures), the byte RNG, joystick, strlen.
// DS globals:
//   0x1caa/0x1cac/0x1cae  anim override flag / mask dl / mask dh     0x1d02 x 0x1d04 y 0x1d06 text ptr (text drawer)
//   0x1d0a/0x1d0c fg/bg   0x1ce8/0x1cea rect w/h (f_5b0a)            0x1d22[] CGA row start table (word per line)
//   0x2f6 message waiting flag   0x2f8 message auto-display on       0x3208[5] queue buffer ptrs (0x321c + 16*i)
//   0x3212[5] queue counts (max 8)   0x326c[5] dept message table base   0x3280/0x3282 saved bx/ax (f_66c0)
//   0x3284 message dept to show (-1 = fullest)   0x3286 auto-display delay   0x3288[5] indicator widget ptrs
//   0x32d4[] head picture per dept   0x32de/0x32e8/0x32f2[] anim tracks / face RLE / mouth tracks per dept
//   0x33b2/0x33d2/0x33f2/0x3412/0x3432 [16] anim track: start, cursor, countdown, sprite base, mask
//   0x3452 anim frozen   0x3454 talking countdown   0x3456 anim divider (4)   0x3458 ptr to dept alive word
//   0x345a/0x345c requested/current head   0x345e anim masks dl/dh   0x3460 "R.I.P."
//   0x3468 sign char   0x3469.. number string (0x346a..0x346c = 3 digits from f_6b0c)
//   0x346e[6]/0x347a[6]/0x3486[6] data file name ptr / size / load address   0x3492 "DASH.BIN"  0x349c "SELECT.BIN"
//   0x34a8[100] SELECT.BIN image   0x350a sound on   0x3510 tick counter   0x3512 (=2)   0x3516 /20 divider
//   0x3518 ticks/20   0x351a ticks since display update   0x351c ISR counter (delay loops)   0x351e tick counter
//   0x3520 changed-bits of 0x351c (0xffff while paused)   0x3524 tune ptr (0x3526 = silence)   0x352a note countdown
//   0x352b note release point   0x352d pause   0x352e tempo   0x352f tempo countdown   0x3530/0x3532 old INT 8 vector
//   0x3534[] PIT divisors per note   0x35dc[] tune table   0x3ade[] screen frame pictures   0x3ae4 star step counter
//   0x3ae6[] star step period per speed   0x3afa[4] star pixel masks   0x3afe current frame   0x3b00 wanted frame
//   0x3b02 border flash countdown   0x3b04 frame override (frame 2)   0x3b06 starfield blank countdown
//   0x3b08/0x3b38[24] star x/y   0x3b90[64*38] off-screen starfield buffer   0x455e[64] buffer row offsets
//   0x4606/0x4608 star centre x/y   0x460a/0x4612[4] star respawn x/y   0x461a/0x461c[256] RNG index / state
//   0x473c/0x473e blit x byte / width   0x60f6.. joystick (as SEL 0x341c..)   0xb68 speed index
import { F } from './fn.js';
import { CS, i16, i8, u16, rb, rw, rs, wb, ww, lw, lww, vput, inp, outp, dosOpen, dosRead, dosWrite, dosClose } from '../rt.js';

const DSEG = (CS + 0x89e) & 0xffff;     // DS segment value (f_5bf8 leaves it in AX: `mov ax, ds`)
const row = bx => rw(0x1d22 + bx);

// AX/CX as left by the text drawer f_5ca3/f_5bf8 (only f_669b depends on CX): CL = 3 once any char >= 0x20 is drawn.
// ponytail: a CR as the last drawable char leaves CX as f_6e26 left it; not modelled (no such indicator text).
function cxAfterText(cx, p) {
  for (let c; (c = rb(p)); p = (p + 1) & 0xffff) if (i8(c - 0x20) >= 0) cx = (cx & 0xff00) | 3;
  return cx;
}

// @64be queueMessage(deptmsg): hi byte = dept*2, lo = message; adds it to the dept queue (no duplicates, max 8)
function f_64be(a) {
  let ax = a & 0xffff;
  if (ax & 0x8000) return;
  let bx = ax >> 8; ax &= 0xff;
  if (rw(bx + 0x4ce8) === 0) return;
  let si = rw(bx + 0x3208), cx = rw(bx + 0x3212);
  if (cx === 0) {
    const di = rw(bx + 0x3288); ww(di + 2, 2);
    f_66c0(ax, bx, di); bx = rw(0x3280); ax = rw(0x3282);
  } else {
    do { if (ax === rw(si)) return; si = (si + 2) & 0xffff; } while ((cx = (cx - 1) & 0xffff));
    if (rs(bx + 0x3212) >= 8) {
      si = rw(bx + 0x3208);
      for (cx = 7; cx; cx--) ww(si, rw(si + 2));   // (si never advances: only the first entry is replaced)
      ww(bx + 0x3212, rw(bx + 0x3212) - 1);
    }
  }
  ww(rw(bx + 0x3208) + rw(bx + 0x3212) * 2, ax);
  ww(bx + 0x3212, rw(bx + 0x3212) + 1);
}
// @6526 unqueueMessage(deptmsg): removes it; light off when the queue becomes empty
function f_6526(a) {
  let ax = a & 0xffff;
  if (ax & 0x8000) return;
  const bx = ax >> 8; ax &= 0xff;
  let si = rw(bx + 0x3208), cx = rw(bx + 0x3212);
  if (cx === 0) return;
  for (;;) {
    if (ax === rw(si)) break;
    si = (si + 2) & 0xffff;
    if (!(cx = (cx - 1) & 0xffff)) return;
  }
  do { ax = rw(si + 2); ww(si, ax); si = (si + 2) & 0xffff; } while ((cx = (cx - 1) & 0xffff));
  ww(bx + 0x3212, rw(bx + 0x3212) - 1);
  if (rw(bx + 0x3212) === 0) { const di = rw(bx + 0x3288); ww(di + 2, 0); f_66c0(ax, bx, di); }
}
// @656b showMessage(dept*2)
function f_656b(a) { ww(0x3284, a); f_657f(); }
// @6579 showMessage of the fullest queue (falls into f_657f)
function f_6579() { ww(0x3284, 0xffff); f_657f(); }
// @657f show and pop the next message of dept [0x3284] (head talks, "Captain", text lines)
function f_657f() {
  ww(0x1d02, 0); ww(0x1d04, 0x78); ww(0x1ce8, 0x50); ww(0x1cea, 0x50); ww(0x1d0c, 0); ww(0x1d0a, 3);
  F.f_5b0a();
  let bx = rs(0x3284), empty;
  if (bx >= 0) empty = rw(bx + 0x3212) === 0;
  else {
    bx = -1; let dx = 0;
    for (let di = 0; di < 10; di += 2) { const ax = rs(di + 0x3212); if (ax > dx) { bx = di; dx = ax; } }
    empty = bx < 0;
  }
  if (empty) {
    ww(0x1d02, 0x14); ww(0x1d04, 0x90); ww(0x1d06, 0x32b0);    // "No messages pending"
    F.f_5bf8();
    f_693a(-1);
    return;
  }
  ww(0x3280, bx);
  f_693a(bx);
  ww(0x1d02, 2); ww(0x1d04, 0x88); ww(0x1d06, 0x32c4);         // "Captain"
  F.f_5bf8();
  bx = rw(0x3280);
  const si = rw(bx + 0x3208), msg = rw(si);
  ww(bx + 0x3212, rw(bx + 0x3212) - 1);
  for (let cx = rw(bx + 0x3212), di = si; cx; cx = (cx - 1) & 0xffff, di = (di + 2) & 0xffff) ww(di, rw(di + 2));
  ww(0x1d06, rw(msg + rw(bx + 0x326c)) + rw(bx + 0x326c));
  ww(0x1d02, 2); ww(0x1d04, 0x90);
  F.f_5bf8();
  bx = rw(0x3280);
  ww(0x1d06, rw(rw(bx + 0x326c)) + rw(bx + 0x326c));
  ww(0x1d04, rw(0x1d04) + 8); ww(0x1d02, 0x14);
  F.f_5bf8();
  bx = rw(0x3280);
  if (rw(bx + 0x3212) === 0) {
    ww(0x1d06, 0x32cc);                                          // "...OUT"
    F.f_5bf8();
    bx = rw(0x3280);
    const di = rw(bx + 0x3288); ww(di + 2, 0);
    f_66c0(DSEG, bx, di);
  }
}
// @669b clear all queues and lights. AX on entry is f_0748's result = [0x351c]; CX is clobbered by the text drawer,
// so the loop really runs over 3 slots, or further (past the 5 counts) when lights are switched off.
function f_669b() {
  const ax = rw(0x351c);
  let cx = 5, bx = 0;
  do {
    if (rw(bx + 0x3212) !== 0) {
      ww(bx + 0x3212, 0);
      const di = rw(bx + 0x3288); ww(di + 2, 0);
      f_66c0(ax, bx, di); cx = cxAfterText(cx, di + 4); bx = rw(0x3280);
    }
    bx = (bx + 2) & 0xffff;
  } while ((cx = (cx - 1) & 0xffff));
}
// @66c0 drawWidget(ax, bx, di): draws widget di (x, y, fg, bg, text) and beeps; keeps ax/bx in 0x3282/0x3280
function f_66c0(ax, bx, di) {
  ww(0x3280, bx); ww(0x3282, ax); ww(0x1d06, di);
  F.f_5ca3();
  f_6e13(0x16);
}
// @66dc message auto-display tick
function f_66dc() {
  if (rw(0x2f8) === 0) return;
  if (rw(0x3286) !== 0) { ww(0x3286, rw(0x3286) - 1); return; }
  for (let bx = 0; bx < 10; bx += 2) if (rw(bx + 0x3212) !== 0) { ww(0x3286, 5); ww(0x2f6, 1); f_6579(); return; }
  if (rw(0x2f6) !== 0) F.f_08e6();
}
// @671c random intruder appearance (only slot si=2 is ever checked)
function f_671c() {
  const si = 2;
  if (rw(si + 0x4d20) === 0 || rs(si + 0x4d30) >= 4) return;
  if (rb(si + 0x4d71) >= 2) return;
  let ax = f_7086();
  if (rw(0xb64) === 1) { if (ax < rs(0xb208)) return; }
  else { ax = f_7086(); if (ax >= rs(0x622f)) return; }
  let bx = 0;
  while (rw(bx + 0x1288) !== 0) { bx += 2; if (bx >= 8) break; }
  f_6e13(0x18);
  ww(bx + 0x1288, rw(si + 0x4dec) + 1);
  F.f_5bed(0x2f);
  ww(0x3b02, 5);
  ww(si + 0x4d30, 4); wb(si + 0x4d71, 5);
  ww(si + 0x4db0, rw(si + 0x4d70));
  ww(si + 0x4d80, 0); ww(si + 0x4d90, 0); ww(si + 0x4da0, 0x300);
}
// @67aa animate the talking head (tracks of [sprite, frames] pairs)
function f_67aa() {
  ww(0x3456, rw(0x3456) - 1);
  if (rs(0x3456) > 0) return;
  ww(0x3456, 4);
  if (rw(0x3452) !== 0) return;
  let dl, dh;
  if (rw(0x1caa) !== 0) { dh = rb(0x1cae); dl = rb(0x1cac); }
  else {
    dl = 1; dh = 0;
    if (rw(0x3454) !== 0) dh = 4;
    if (rw(rw(0x3458)) !== 0) dl ^= 3;
  }
  ww(0x345e, dh << 8 | dl);
  for (let si = 0; rw(si + 0x33b2) !== 0; si += 2) {
    const al = rb(si + 0x3432);
    let restart = !(al & dl) || ((al & 4) && !(al & dh));
    if (restart) {
      const ax = (rw(si + 0x33b2) + 4) & 0xffff;
      if (ax === rw(si + 0x33d2)) { dl = rb(0x345e); dh = rb(0x345f); continue; }
      ww(si + 0x33d2, ax - 4);
    }
    let bx = rw(si + 0x33d2);
    ww(si + 0x33f2, rw(si + 0x33f2) - 1);
    if (rw(si + 0x33f2) === 0) {
      let ax;
      do {
        f_7145(rw(bx) + rw(si + 0x3412));
        bx = rw(si + 0x33d2);
        ax = rw(bx + 2); ww(si + 0x33f2, ax);
        bx = (bx + 4) & 0xffff;
        if (rw(bx) === 0) bx = rw(si + 0x33b2);
        ww(si + 0x33d2, bx);
      } while (ax === 0);
    }
    dl = rb(0x345e); dh = rb(0x345f);
  }
  if (rw(0x3454) !== 0) ww(0x3454, rw(0x3454) - 1);
}
// @6868 showHead(dept*2) with its jingle (0x0c when the dept is dead)
function f_6868(a) {
  f_6dac(rw(a + 0x4ce8) === 0 ? 0xc : a & 0xffff);
  head6883(a);
}
// @6880 showHead(dept*2), -1 = blank
function f_6880(a) { head6883(a); }
function head6883(a) {
  ww(0x345a, a); ww(0x3454, 0);
  if (u16(a) === rw(0x345c)) return;
  head6896(a);
}
function head6896(a) {
  const si = i16(a);
  ww(0x345c, si);
  if (si < 0) {
    f_70a4(0x7fcc);
    ww(0x1d02, 0x2e); ww(0x1d04, 8); ww(0x1d0c, 0); ww(0x1ce8, 0x20); ww(0x1cea, 0x40);
    F.f_5b0a();
    ww(0x33b2, 0); ww(0x33d2, 0);
    return;
  }
  f_70a4(rw(si + 0x32d4));
  if (rw(si + 0x4ce8) === 0) {
    ww(0x1d02, 0x2e); ww(0x1d04, 8); ww(0x1d0c, 0); ww(0x1ce8, 0x20); ww(0x1cea, 0x40);
    F.f_5b0a();
    ww(0x1d0a, 3); ww(0x1d02, 0x38); ww(0x1d04, 0x28); ww(0x1d06, 0x3460);   // "R.I.P."
    F.f_5bf8();
    ww(0x33b2, 0); ww(0x33d2, 0);
    return;
  }
  f_70e2(rw(rw(si + 0x32e8)) + rw(si + 0x326c));
  let bx = rw(si + 0x32de), di = 0;
  for (let p; (p = rw(bx)) !== 0; di += 2, bx = (bx + 2) & 0xffff) {
    ww(di + 0x33b2, p); ww(di + 0x33f2, rw(p + 2)); ww(di + 0x3412, 0); ww(di + 0x3432, 3); ww(di + 0x33d2, p + 4);
  }
  ww(0x3458, si + 0x4cf2);
  const dx = rw(si + 0x326c);
  bx = (rw(rw(si + 0x32f2)) + dx) & 0xffff;
  for (let ax; (ax = rw(bx)) !== 0; di += 2, bx = (bx + 4) & 0xffff) {
    ww(di + 0x3432, ax);
    const p = (rw(bx + 2) + dx) & 0xffff;
    ww(di + 0x33b2, p); ww(di + 0x33f2, rw(p + 2)); ww(di + 0x3412, dx); ww(di + 0x33d2, p + 4);
  }
  ww(di + 0x33b2, 0);
}
// @693a showHeadTalking(dept*2): head + talk countdown 50, jingle 0x10 when it changes
function f_693a(a) {
  ww(0x3454, 0x32);
  if (u16(a) === rw(0x345c)) return;
  f_6dac(0x10);
  head6896(a);
}
// @69ee..@6af1 number to text (via f_6b0c), text ptr -> [0x1d06]
function f_69ee(n) { f_6b0c(n); ww(0x1d06, 0x346a); }         // "nnn"
function f_6a01(n) { f_6b0c(n); ww(0x1d06, 0x346b); }         // "nn"
function f_6a14(n) { f_6b0c(n); ww(0x1d06, 0x346c); }         // "n"
function f_6a27(n) {                                            // "n0.n" (tenths)
  f_6b0c(n);
  wb(0x3469, rb(0x346a));
  const al = rb(0x346b); wb(0x346a, al === 0x20 ? 0x30 : al); wb(0x346b, 0x2e);
  ww(0x1d06, 0x3469);
}
function f_6a51(n) {                                            // "n.n"
  f_6b0c(n);
  const al = rb(0x346b); wb(0x346a, al === 0x20 ? 0x30 : al); wb(0x346b, 0x2e);
  ww(0x1d06, 0x346a);
}
function f_6a75(n) {                                            // "nnn", 0 -> "  -"
  if (n !== 0) f_6b0c(n);
  else { wb(0x346a, 0x20); wb(0x346b, 0x20); wb(0x346c, 0x2d); }
  ww(0x1d06, 0x346a);
}
function blank6ad8() { wb(0x346a, 0x20); wb(0x346b, 0x20); wb(0x346c, 0x20); ww(0x1d06, 0x346a); }
function f_6aa6(n, p) {                                         // "+nn"/"-nn", blank if *p == 0
  if (rw(p) === 0) return blank6ad8();
  let ax = i16(n); wb(0x3468, 0x2b);
  if (ax < 0) { ax = -ax; wb(0x3468, 0x2d); }
  f_6b0c(ax);
  wb(0x346a, rb(0x3468)); ww(0x1d06, 0x346a);
}
function f_6af1(n, p) {                                         // "nn", blank if *p == 0
  if (rw(p) === 0) return blank6ad8();
  f_6b0c(n); ww(0x1d06, 0x346b);
}
// @6b0c formatNumber(ax unsigned) -> 3 chars at 0x346a, leading zeros as spaces
function f_6b0c(ax) {
  ax &= 0xffff;
  const q = Math.floor(ax / 100), r = ax % 100;
  wb(0x346a, q === 0 ? 0x20 : (q + 0x30) & 0xff);
  const t = Math.floor(r / 10);
  wb(0x346b, t === 0 && q === 0 ? 0x20 : t + 0x30);
  wb(0x346c, r % 10 + 0x30);
}
// DOS error path (@6b76) unwinds into the caller's caller; the game ships with its files, so treat it as fatal
function open(name, mode) { const h = dosOpen(name); if (h < 0) throw new Error('PSI5: cannot open ' + name.toString(16)); return h; }
// @6b4c load DASH.BIN (dashboard picture) to 0x8b0c and draw it
function f_6b4c() { const h = open(0x3492); dosRead(h, 0x8b0c, 0x2086); dosClose(h); f_70a4(0x8b0c); }
// @6b7c load SELECT.BIN to 0x34a8, then the mission + 5 crew files named in it
function f_6b7c() {
  let h = open(0x349c); dosRead(h, 0x34a8, 0x64); dosClose(h);
  for (let si = 0; si < 0xc; si += 2) { h = open(rw(si + 0x346e)); dosRead(h, rw(si + 0x3486), rw(si + 0x347a)); dosClose(h); }
}
// @6bc7 write SELECT.BIN back
function f_6bc7() { const h = open(0x349c, 2); dosWrite(h, 0x34a8, 0x64); dosClose(h); }
// @6c10 hook IRQ0 at 120 Hz (ISR @6ca9)
function f_6c10() {
  outp(0x61, inp(0x61) & 0xfc);
  outp(0x43, 0xb6);
  outp(0x21, inp(0x21) | 3);
  ww(0x3524, 0x3526); ww(0x3528, 0x3526);
  ww(0x3518, 0); ww(0x351a, 0); ww(0x3516, 4); ww(0x3512, 2);
  ww(0x3530, lw(0x20)); ww(0x3532, lw(0x22));
  lww(0x20, 0x6ca9); lww(0x22, CS);
  outp(0x21, inp(0x21) & 0xfc);
  outp(0x40, 0xd4); outp(0x40, 0x26);
}
// @6c78 restore INT 8 and the PIT, speaker off
function f_6c78() {
  outp(0x21, inp(0x21) | 3);
  lww(0x20, rw(0x3530)); lww(0x22, rw(0x3532));
  outp(0x21, inp(0x21) & 0xfc);
  outp(0x40, 0); outp(0x40, 0);
  outp(0x61, inp(0x61) & 0xfc);
}
const spkOff = () => outp(0x61, inp(0x61) & 0xfc);
// @6ca9 INT 8 handler (120 Hz): counters, tune player (tempo byte, then [duration, note] pairs). Invoked via isrs.
function f_6ca9() {
  ww(0x351e, rw(0x351e) + 1);
  ww(0x351a, rw(0x351a) + 1);
  if (rb(0x352d) !== 0) { ww(0x3520, 0xffff); spkOff(); }
  else {
    ww(0x3516, rw(0x3516) - 1);
    if (rw(0x3516) & 0x8000) { ww(0x3518, rw(0x3518) + 1); ww(0x3516, 0x13); }
    const old = rw(0x351c); ww(0x351c, old + 1); ww(0x3510, rw(0x3510) + 1);
    ww(0x3520, rw(0x3520) | (old ^ rw(0x351c)));
    if (rb(0x352f) !== 0) wb(0x352f, rb(0x352f) - 1);
    else {
      wb(0x352f, rb(0x352e));
      if (rb(0x352a) !== 0) { wb(0x352a, rb(0x352a) - 1); if (rb(0x352a) === rb(0x352b)) spkOff(); }
      else {
        const si = rw(0x3524), dur = rb(si);
        if (dur === 0 || rb(0x350a) !== 1) { ww(0x3524, 0x3526); spkOff(); }
        else {
          wb(0x352a, dur - 1); wb(0x352b, (dur - 1) >> 3);
          const note = rb(si + 1); ww(0x3524, rw(0x3524) + 2);
          if (note === 0) spkOff();
          else { const d = rw(0x3534 + note * 2); outp(0x42, d & 255); outp(0x42, d >> 8); outp(0x61, inp(0x61) | 3); }
        }
      }
    }
  }
  outp(0x20, 0x20);
}
// start tune n (byte offset into 0x35dc) now
function startTune(n) {
  let si = rw((n + 0x35dc) & 0xffff);
  wb(0x352e, rb(si)); ww(0x3524, si + 1); wb(0x352a, 0);
}
// start tune n unless sound is off or a tune is playing (@6d7f / @6de6)
function tuneIfIdle(n) { if (rb(0x350a) !== 0 && rb(rw(0x3524)) === 0) startTune(n); }
// @6d79 playTune(n)   @6dac (ax)   @6de0 (n)   @6e13 (ax): same body
function f_6d79(n) { tuneIfIdle(n); }
function f_6dac(ax) { tuneIfIdle(ax); }
function f_6de0(n) { tuneIfIdle(n); }
function f_6e13(ax) { tuneIfIdle(ax); }
// @6db1 playTune(n), interrupting the current one
function f_6db1(n) { if (rb(0x350a) !== 0) startTune(n); }
// @6e26 display update, every 3rd tick: starfield, screen frame, gauges, head animation
function f_6e26() {
  if (rw(0x351a) < 3) return;
  ww(0x351a, 0);
  ww(0x3ae4, rw(0x3ae4) + 1);
  if (rw(0x3b02) !== 0) { ww(0x3b02, rw(0x3b02) - 1); if (rw(0x3b02) === 0) F.f_5bed(0x20); }
  f_6ee0();
  let bx = rw(0x3b00);
  if (rw(0x3b04) !== 0) bx = 2;
  if (bx !== rw(0x3afe)) { ww(0x3afe, bx); f_70a4(rw(bx * 2 + 0x3ade)); ww(0x3b06, 4); }
  if (rw(0x3b06) !== 0) ww(0x3b06, rw(0x3b06) - 1);
  const ax = rw(rw(0xb68) * 2 + 0x3ae6);
  if (ax !== 0 && rw(0x3ae4) >= ax) { ww(0x3ae4, 0); if (rw(0x3afe) === 0) f_6f2f(); else f_6fb3(); }
  F.f_5d20(); F.f_5e08(); F.f_5eba(); F.f_6006(); F.f_60b4(); F.f_6242();
  f_671c();
  if (rw(0x3b04) === 0) {
    if (rw(0x3b06) === 0) { f_7016(); F.f_631e(); }
    f_705e();
  }
  f_67aa();
}
// @6ee0 clear the starfield buffer (all 1-bits while the view is blanked)
function f_6ee0() {
  const v = rw(0x3b04) === 0 && rw(0x3b06) !== 0 ? 0xffff : 0;
  for (let i = 0; i < 0x4c0; i++) ww(0x3b90 + i * 2, v);
}
// @6f2f stars fly outwards from the centre (forward view)
function f_6f2f() {
  const step = (a, c) => { let ax = i16(rw(a) - rw(c)) >> 3; if (ax === 0) ax = 1; ww(a, rw(a) + ax); };
  const spawn = (a, c) => { const r = f_7086(); let ax = (r & 0xf) + 1; if (r & 0x20) ax = -ax; ww(a, ax + rw(c)); };
  for (let bx = 0; bx < 0x18; bx += 2) {
    step(bx + 0x3b08, 0x4606); step(bx + 0x3b38, 0x4608);
    const x = rs(bx + 0x3b08), y = rs(bx + 0x3b38);
    if (x <= -0x40 || x >= 0x40 || y <= -0x20 || y >= 0x20) { spawn(bx + 0x3b08, 0x4606); spawn(bx + 0x3b38, 0x4608); }
  }
}
// @6fb3 stars converge (rear view)
function f_6fb3() {
  for (let bx = 0; bx < 0x18; bx += 2) {
    let ax = rs(bx + 0x3b20) >> 3;
    if (ax !== 0) {
      ww(bx + 0x3b20, rw(bx + 0x3b20) - ax);
      ax = rs(bx + 0x3b50) >> 3;
      if (ax !== 0) { ww(bx + 0x3b50, rw(bx + 0x3b50) - ax); continue; }
    }
    const si = f_7086() & 6;
    ax = rw(si + 0x460a); if (ax === 0) ax = (f_7086() & 0x7f) - 0x40;
    ww(bx + 0x3b20, ax);
    ax = rw(si + 0x4612); if (ax === 0) ax = (f_7086() & 0x3f) - 0x20;
    ww(bx + 0x3b50, ax);
  }
}
// @7016 plot 12 stars into the buffer
function f_7016() {
  for (let cx = 0xc, bx = rw(0x3afe) !== 0 ? 0x18 : 0; cx; cx--, bx += 2) {
    let si = (rw(bx + 0x3b38) + 0x20) & 0xffff;
    if (si >= 0x40) continue;
    si = rw(si * 2 + 0x455e);
    const ax = (rw(bx + 0x3b08) + 0x40) & 0xffff;
    if (ax >= 0x80) continue;
    wb(si + (ax >> 2) + 0x3b90, rb((ax & 3) + 0x3afa));
  }
}
// @705e copy the buffer to the screen (64 lines x 32 bytes at x byte 2, from line 8)
function f_705e() {
  let si = 0x3b90;
  for (let bx = 0x10; bx < 0x90; bx += 2) {
    const di = row(bx) + 2;
    for (let k = 0; k < 0x20; k++) vput(di + k, rb(si + k));
    si += 0x26;
  }
}
// @7086 random byte: rotates a byte of the 256-byte state left, feeding its inverted top bit (AH = 0)
function f_7086() {
  ww(0x461a, rw(0x461a) - 1);
  const si = (rw(0x461a) & 0xff) + 0x461c, al = rb(si);
  const v = ((al << 1) | (al < 0x80 ? 1 : 0)) & 0xff;
  wb(si, v);
  return v;
}
// @70a4 draw picture p (header: +0 width bytes, +2 height, +8 x pixels, +10 y; data from +12)
function f_70a4(p) { blit70b9(p, rw(p + 0xa) * 2, rw(p + 8) >> 2); }
// @7145 draw picture p at header position relative to the head window (x bytes + 0x18, y - 0x43)
function f_7145(p) { blit70b9(p, (rw(p + 0xa) - 0x43) * 2, rw(p + 8) + 0x18); }
function blit70b9(si, bx, x) {
  ww(0x473c, x);
  const w = rw(si); ww(0x473e, w);
  let dx = rw(si + 2); si = (si + 0xc) & 0xffff;
  do {
    const di = row(bx) + rw(0x473c);
    for (let k = 0; k < w; k++) { vput(di + k, rb(si)); si = (si + 1) & 0xffff; }
    bx = (bx + 2) & 0xffff; dx = i16(dx - 1);
  } while (dx > 0);
}
// @70e2 draw RLE face picture p (32 bytes x 64 lines at x byte 0x2e, line 8): escape byte [p+6], then value, count
function f_70e2(p) {
  let si = (p + 0x14) & 0xffff, bx = 0x10, dh = 0x40, cx = 0x20;
  const dl = rb(p + 6);
  ww(0x473c, 0x2e); ww(0x473e, 0x20);
  let di = row(bx) + rw(0x473c);
  const next = () => { bx += 2; if (!(dh = (dh - 1) & 0xff)) return false; di = row(bx) + rw(0x473c); cx = rw(0x473e); return true; };
  outer: for (;;) {
    let al = rb(si); si = (si + 1) & 0xffff;
    if (al !== dl) { vput(di++, al); if (!--cx && !next()) return; continue; }
    al = rb(si); let ah = rb(si + 1); si = (si + 2) & 0xffff;   // value, then count (lodsb/mov/lodsb/xchg)
    for (;;) {
      vput(di++, al);
      ah = (ah - 1) & 0xff;
      if (!--cx && !next()) return;
      if (ah === 0) continue outer;
    }
  }
}
// @7160 joystick as a key (same as SEL @1080, data at 0x60f6..)
function f_7160() {
  wb(0x60fc, 0);
  let al = inp(0x201); wb(0x60fa, al);
  let bl = 3; ww(0x60f6, 0x50); ww(0x60f8, 0x50);
  let cx = 0;
  outp(0x201, al);
  for (;;) {
    al = (inp(0x201) & bl) ^ bl;
    if (al === 0) { cx++; if (cx < 0x12c) continue; break; }
    if (al & 1) { ww(0x60f6, cx); bl &= 2; if (bl) { if (!(al & 2)) continue; } else break; }
    else if (!(al & 2)) continue;
    ww(0x60f8, cx); bl &= 1; if (bl) continue; break;
  }
  let ax = rs(0x60f6);
  const calX = () => {
    let a = (rw(0x60ff) - rw(0x60fd)) & 0xffff; a >>= 1; const b = a >> 1;
    a = (a + rw(0x60fd) + b) & 0xffff; ww(0x6107, a); a = (a - b - b) & 0xffff; ww(0x6105, a);
  };
  if (ax < rs(0x60fd)) { ww(0x60fd, ax); calX(); ax = rs(0x60f6); ww(0x6103, 8); ww(0x6101, 0x4e20); }
  else if (ax <= rs(0x60ff)) { ww(0x6103, 8); ww(0x6101, 0x4e20); }
  else {
    ww(0x6103, rw(0x6103) - 1);
    if (rw(0x6103) === 0) { ww(0x60ff, rw(0x6101)); calX(); ax = rs(0x60f6); ww(0x6103, 8); ww(0x6101, 0x4e20); }
    else if (ax < rs(0x6101)) ww(0x6101, ax);
  }
  if (ax < rs(0x6105)) wb(0x60fc, rb(0x60fc) | 8);
  else if (ax >= rs(0x6107)) wb(0x60fc, rb(0x60fc) | 4);
  let ay = rw(0x60f8);
  const calY = () => {
    let a = (rw(0x610b) - rw(0x6109)) & 0xffff; a >>= 1; const b = a >> 1;
    a = (a + rw(0x6109) + b) & 0xffff; ww(0x6113, a); a = (a - b - b) & 0xffff; ww(0x6111, a);
  };
  if (ay < rw(0x6109)) { ww(0x6109, ay); calY(); ay = rw(0x60f8); ww(0x610f, 8); ww(0x610d, 0x4e20); }
  else if (i16(ay) <= rs(0x610b)) { ww(0x610f, 8); ww(0x610d, 0x4e20); }
  else {
    ww(0x610f, rw(0x610f) - 1);
    if (rw(0x610f) === 0) { ww(0x610b, rw(0x610d)); calY(); ay = rw(0x60f8); ww(0x610f, 8); ww(0x610d, 0x4e20); }
    else if (i16(ay) < rs(0x610d)) ww(0x610d, ay);
  }
  if (ay < rw(0x6111)) wb(0x60fc, rb(0x60fc) | 1);
  else if (ay >= rw(0x6113)) wb(0x60fc, rb(0x60fc) | 2);
  wb(0x60fc, rb(0x60fc) | (inp(0x201) & rb(0x60fa) & 0x30));
  const ah = rb(0x60fb);
  if (ah === rb(0x60fc)) return 0;
  let dl = 1, dh = 0xfe; al = rb(0x60fc);
  for (let n = 6; n; n--) {
    if (dl & al) { if (!(dl & ah)) { wb(0x60fb, rb(0x60fb) | dl); return rs(0x6115 + n * 2); } }
    else wb(0x60fb, rb(0x60fb) & dh);
    dl = (dl << 1) & 255; dh = ((dh << 1) | (dh >> 7)) & 255;
  }
  return 0;
}
// @72da stub (copy protection check): 0
function f_72da() { return 0; }
// @72e1 strlen(s)
function f_72e1(s) { let n = 0; while (rb(s + n)) n++; return i16(n); }

Object.assign(F, { f_64be, f_6526, f_656b, f_6579, f_657f, f_669b, f_66c0, f_66dc, f_671c, f_67aa, f_6868, f_6880,
  f_693a, f_69ee, f_6a01, f_6a14, f_6a27, f_6a51, f_6a75, f_6aa6, f_6af1, f_6b0c, f_6b4c, f_6b7c, f_6bc7, f_6c10,
  f_6c78, f_6ca9, f_6d79, f_6dac, f_6db1, f_6de0, f_6e13, f_6e26, f_6ee0, f_6f2f, f_6fb3, f_7016, f_705e, f_7086,
  f_70a4, f_70e2, f_7145, f_7160, f_72da, f_72e1 });
