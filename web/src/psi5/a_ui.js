// PSI5.EXE — main() and the menu/UI core: main menu loop (department selection), options menu, quit/restart menus,
// the generic menu input routine (f_0786), message-line/menu-bar drawing wrappers, drawing-script interpreter, timed
// waits on the ISR counter, menu table builders. `@xxxx` = function address in the original (re/psi5.lst).
// DS globals:
//   0x0002/0x0004 main()'s locals [bp+2]/[bp+4] after a "same crew" restart (f_5b5f resumes main with BP=0)
//   0x000e help context for '?' (0 main menu, 1 options menu)   0x0122 options-menu selection
//   0x0126 ptr to the "^" (exit) item text   0x0164 next message-line x (f_06bf)
//   0x0166[17] records of 0x14 bytes (10 words, 0x8000 = empty)   0x02ba ptr to the last record touched
//   0x02d0 redraw function of the current department   0x02d2 current department (0 none)   0x02d4 cleared before redraw
//   0x02d6 main-menu selection   0x02f0 quit-menu selection   0x02f2 restart-menu selection
//   0x02f6 department view needs redraw   0x02f8 cursor moves do not redraw (options 'E' = 1, 'D' = 0)
//   0x02fa[] menu item text ptrs  0x032e[] menu hot keys  0x0348[] menu item -> source index  0x037c[] source -> slot
//   0x03b2 demo mode (1 = demo; key-less menu input in demo longjmps back into main)   0x3508 skip intro text
//   0x1ce8/0x1cea rect w (bytes)/h   0x1d02 x (bytes)   0x1d04 y   0x1d06 text ptr   0x1d0a/0x1d0c fg/bg colour
//   0x1d1a menu item list (f_5ccb)   0x1d1c highlighted item   0x1cf6 restart address (0x00a7)
//   0x1cf8/0x1cfa/0x1cfc setjmp return address/SP/BP   0x1cfe demo key script ptr   0x351c ISR tick counter
//   0x2765[] department title scripts   0x3b04 cleared before the main loop
import { F, callPtr } from './fn.js';
import { rb, rw, rs, wb, ww, i16, frame, unframe } from '../rt.js';

// longjmp tokens: LJ_MAIN thrown by f_5b97 (back to main @0179), RESTART thrown by f_5b5f (main @00a7 with BP=0)
export const LJ_MAIN = { longjmp: 'psi5 main' };
export const RESTART = { longjmp: 'psi5 restart' };

// @0082 main
function* f_0082() {
  let mem = false, l2 = 0, l4 = 0;                // locals live at DS 2/4 once restarted (BP=0)
  const set2 = v => { if (mem) ww(2, v); else l2 = i16(v); };
  const get4 = () => mem ? rs(4) : l4;
  const set4 = v => { if (mem) ww(4, v); else l4 = i16(v); };
  F.f_5be1();
  ww(0x3b2, 1);
  for (set4(0); get4() < 0x14; set4(get4() + 1)) F.f_7160();
  ww(0x1cf6, 0x00a7); ww(0x1cfe, 0x898a);         // f_5b50
  for (;;) {
    try { yield* body(); break; } catch (e) { if (e !== F.RESTART) throw e; mem = true; }
  }
  if (mem) throw new Error('main returned after restart (original returns through a garbage frame)');
  F.f_6c78();

  function* body() {                              // @00a7
    F.f_5bc4();
    if (F.f_72da()) F.f_5b6f();
    F.f_6b4c();
    F.f_70a4(rs(0x4740));
    f_04c5();
    f_0693();
    f_0988(rs(0x23c9));
    F.f_32bf(9);
    F.f_32f2(0);
    F.f_70a4(rs(0x49e9));
    F.f_6b7c();
    yield* F.f_5baa(0x36);
    if (rw(0x3508) === 0) { yield* F.f_5aff(); f_09b7(rs(0x239a)); yield* F.f_5af1(); }
    F.f_5247();
    F.f_6c10();
    F.f_6db1(0xa);
    f_04c5();
    F.f_51d8(rs(0x10a), 7, 0x20);
    F.f_5219(rs(0x116), 9, 0x28);
    F.f_32bf(0xa);
    for (set4(0); get4() < 5; set4(get4() + 1)) { F.f_32f2(rs(0x118 + get4() * 2)); yield* f_076d(0x50); }
    ww(0x3b04, 0);
    ww(0x1cf8, 0x0179); ww(0x1cfa, mem ? 0 : 0xffc8); ww(0x1cfc, mem ? 0 : 0xffc8);   // f_5b86 setjmp
    for (;;) {
      try { yield* loop(); return; } catch (e) { if (e !== F.LJ_MAIN) throw e; }
    }
  }
  function* loop() {                              // @0179
    if (rw(0x3b2) !== 0) { yield* F.f_55f9(); return; }
    f_022f();
    for (;;) {
      const k = yield* F.f_0786(rs(0x136c), 0x1354, 0x2d6);
      set2(k);
      if (k === 0) return;
      if (k === 0x41) yield* F.f_0256();
      else if (k === 0x57) { F.f_6868(0); yield* F.f_0e37(); }
      else if (k === 0x53) { F.f_6868(2); yield* F.f_1cfa(); }
      else if (k === 0x4e) { F.f_6868(4); yield* F.f_295d(); }
      else if (k === 0x45) { F.f_6868(6); yield* F.f_3396(); }
      else if (k === 0x52) { F.f_6868(8); yield* F.f_3be5(); }
      else if (k === 0x51) { if (yield* f_03fb()) return; }
    }
  }
}

// @022f mainMenuBar: clear lines, draw the main menu bar
function f_022f() {
  f_04c5();
  f_0693();
  ww(0xe, 0);
  f_0672(0x1354, rs(0x2d6));
  F.f_6880(-1);
}

// @0256 optionsMenu: W/S/N/E/R info, C, A (auto redraw), '?' redraw, '^' back
function* f_0256() {
  ww(0x122, 0);
  f_0317();
  for (;;) {
    const k = yield* F.f_0786(rs(0x56), 0x38, 0x122);
    if (k === 0x5e) break;
    if (k === 0x3f) f_0317();
    else if (k === 0x57) yield* F.f_033e(0);
    else if (k === 0x53) yield* F.f_033e(1);
    else if (k === 0x4e) yield* F.f_033e(2);
    else if (k === 0x45) yield* F.f_033e(3);
    else if (k === 0x52) yield* F.f_033e(4);
    else if (k === 0x43) { f_06bf(rs(0xb6)); yield* F.f_06f4(); F.f_669b(); f_0317(); }
    else if (k === 0x41) yield* F.f_0384();
  }
  f_022f();
  ww(0x122, 0);
}

// @0317 optionsMenuBar
function f_0317() {
  f_04c5();
  ww(0xe, 1);
  f_0672(0x38, rs(0x122));
  f_0693();
  f_06bf(rs(0x64));
}

// @033e optionsDept(n): message, flash, then department n info
function* f_033e(n) {
  f_06bf(rs(0x78));
  f_06bf(rs(0x96 + n * 2));
  yield* F.f_06f4();
  F.f_6880(i16(n * 2));
  F.f_656b(i16(n * 2));
  ww(0x2f6, 1);
  f_0317();
}

// @0384 autoRedrawMenu: E(nable)/D(isable) -> [0x2f8]
function* f_0384() {
  const p = frame(2);
  try {
    ww(p, 0);
    f_04c5();
    f_0672(0xca, rs(p));
    f_06bf(rs(0xf0));
    const k = yield* F.f_0786(rs(0xd6), 0xca, p);
    if (k !== 0x5e) {
      if (k === 0x45) { f_06bf(rs(0xf6)); yield* F.f_06f4(); ww(0x2f8, 1); }
      else if (k === 0x44) { f_06bf(rs(0xfc)); yield* F.f_06f4(); ww(0x2f8, 0); }
    }
    f_0317();
  } finally { unframe(2); }
}

// @03fb quitMenu: O/'^' back, R restart menu. Returns AX of the last f_0672 (always 0)
function* f_03fb() {
  f_04c5();
  f_0672(0x152e, rs(0x2f0));
  for (;;) {
    const k = yield* F.f_0786(rs(0x153a), 0x152e, 0x2f0);
    if (k === 0x4f || k === 0x5e) break;
    if (k === 0x52) yield* f_0463();
  }
  f_04c5();
  let r;
  if (rw(0x3b2) !== 0) r = F.f_5683(); else r = f_0672(0x1354, rs(0x2d6));
  ww(0x2f0, 0);
  return i16(r);
}

// @0463 restartMenu: S same crew (restart main), N new crew (exit to SEL), '^' back
function* f_0463() {
  f_04c5();
  f_0672(0x1562, rs(0x2f2));
  for (;;) {
    const k = yield* F.f_0786(rs(0x156e), 0x1562, 0x2f2);
    if (k === 0x5e) break;
    if (k === 0x53) { F.f_5bc4(); F.f_5b5f(); }
    else if (k === 0x4e) { F.f_5bc4(); F.f_6bc7(); F.f_5b6f(); }
  }
  f_04c5();
  f_0672(0x152e, rs(0x2f0));
}

// @04c5 clearMenuLine: clear the menu bar area (y 0x70)
function f_04c5() {
  ww(0x1d02, 0); ww(0x1ce8, 0x50); ww(0x1d04, 0x70); ww(0x1cea, 8); ww(0x1d0c, 1);
  F.f_5b0a();
}

// tail shared by the menu table builders: "^" item and terminator after j items
function menuTail(j) {
  ww(0x2fa + j * 2, rw(0x126));
  wb(0x32e + j, 0x5e);
  j = i16(j + 1);
  ww(0x2fa + j * 2, 0);
  wb(0x32e + j, 0);
}

// @04eb buildMenuFiltered(names, enabled, n): items i with enabled[i] != 0
function f_04eb(names, enabled, n) {
  let i = 0, j = 0;
  while (i < n) {
    const si = enabled; enabled = (enabled + 2) & 0xffff;
    if (rw(si) !== 0) {
      const cx = rw(names + i * 2);
      ww(0x2fa + j * 2, cx);
      wb(0x32e + j, rb(cx));
      ww(0x348 + j * 2, i);
      ww(0x37c + i * 2, j);
      j = i16(j + 1);
    } else ww(0x37c + i * 2, 0xffff);
    i = i16(i + 1);
  }
  ww(0x37c + n * 2, j);
  menuTail(j);
}

// @058e buildMenu(names, n)
function f_058e(names, n) {
  let i = 0;
  while (i < n) {
    const p = rw(names + i * 2);
    ww(0x2fa + i * 2, p);
    wb(0x32e + i, rb(p));
    i = i16(i + 1);
  }
  menuTail(i);
}

// @05f3 buildMenuIndirect(names, map, idx, n): item i = names[map[idx[i]]]
function f_05f3(names, map, idx, n) {
  let i = 0;
  while (i < n) {
    const t = rw(map + rw(idx + i * 2) * 2);
    const p = rw(names + t * 2);
    ww(0x2fa + i * 2, p);
    wb(0x32e + i, rb(p));
    ww(0x348 + i * 2, t);
    i = i16(i + 1);
  }
  menuTail(i);
}

// @0672 drawMenu(list, sel): menu bar at y 0x70 with item sel highlighted. AX = 0 (f_5ccb ends on the 0 terminator)
function f_0672(list, sel) {
  ww(0x1d02, 0); ww(0x1d04, 0x70);
  ww(0x1d1a, list); ww(0x1d1c, sel);
  F.f_5ccb();
  return 0;
}

// @0693 clearMessageLine (y 0x68), message x := 2
function f_0693() {
  ww(0x1d02, 0); ww(0x1ce8, 0x50); ww(0x1d04, 0x68); ww(0x1cea, 8); ww(0x1d0c, 1);
  F.f_5b0a();
  ww(0x164, 2);
}

// @06bf message(s): append text to the message line
function f_06bf(s) {
  const ax = rw(0x164);
  ww(0x1d04, 0x68); ww(0x1d0c, 1); ww(0x1d0a, 0);
  ww(0x1d02, ax); ww(0x1d06, s);
  F.f_5bf8();
  ww(0x164, rw(0x1d02) + 2);
}

// @06f4 flashPrompt: blink text [0x13c] on the menu line twice
function* f_06f4() {
  f_04c5();
  for (let i = 0; i < 2; i++) {
    ww(0x1d02, 0x16); ww(0x1d04, 0x70);
    const ax = rw(0x13c);
    ww(0x1d0c, 1); ww(0x1d0a, 0); ww(0x1d06, ax);
    F.f_5bf8();
    yield* f_0748(0x19);
    f_04c5();
    yield* f_0748(0x19);
  }
}

// @0748 waitTicksRun(n): wait n ISR ticks, running the game (f_0d97) meanwhile unless in demo mode
function* f_0748(n) {
  ww(0x351c, 0);
  for (;;) {
    yield;
    if (rs(0x351c) >= n) break;
    if (rw(0x3b2) === 0) yield* F.f_0d97();
  }
}

// @076d waitTicks(n)
function* f_076d(n) {
  ww(0x351c, 0);
  do { yield; } while (rs(0x351c) < n);
}

// @0786 menuInput(str, items, selPtr): hot keys str, menu list items, selection word at selPtr. Runs the game while
// waiting; Left/Right move, Enter picks, hot key picks, '?' help, Home longjmps to main. Returns the key.
function* f_0786(str, items, selPtr) {
  const n = i16(F.f_72e1(str) - 1);
  let key = 0;
  while (key === 0) {
    for (;;) {
      key = yield* f_0946();
      if (key !== 0) break;
      if (rw(0x3b2) === 0) yield* F.f_0d97();
      else if (rw(0x3b2) === 1) F.f_5b97();
    }
    if (key === 0x0d) key = rb(str + rw(selPtr));
    else if (key === 0x4d00) {
      if (rs(selPtr) < n) ww(selPtr, rw(selPtr) + 1); else ww(selPtr, 0);
      f_0672(items, rs(selPtr));
      if (rw(0x2f8) === 0) f_08e6();
      key = 0;
    } else if (key === 0x4b00) {
      if (rs(selPtr) > 0) ww(selPtr, rw(selPtr) - 1); else ww(selPtr, n);
      f_0672(items, rs(selPtr));
      if (rw(0x2f8) === 0) f_08e6();
      key = 0;
    } else if (key === 0x4700) F.f_5b97();
    else {
      let found = -1;
      for (let i = 0; ; i = i16(i + 1)) {
        const c = rb(str + i);
        if (c === 0) break;
        if (c === key) { ww(selPtr, i); found = i; break; }
      }
      if (found < 0) key = 0;
    }
    if (key === 0x3f) {
      f_06bf(rw(0xe) !== 0 ? rs(0x162) : rs(0x14a));
      yield* F.f_06f4();
      F.f_6579();
      ww(0x2f6, 1);
    } else if (rw(0x2f8) === 0) f_08e6();
  }
  return i16(key);
}

// @08e6 redrawDept: if pending, redraw the current department view (or clear the view area)
function f_08e6() {
  if (rw(0x2f6) === 0) return;
  F.f_6880(rs(0x345a));
  const ax = rw(0x2d2);
  if (ax !== 0) {
    ww(0x2d4, 0);
    f_0988(rs(0x2765 + ax * 2));
    f_0abc();
    callPtr(rw(0x2d0));
  } else {
    ww(0x1d04, 0x78); ww(0x1d0c, 0); ww(0x1d02, 0); ww(0x1cea, 0x50); ww(0x1ce8, 0x50);
    F.f_5b0a();
  }
  ww(0x2f6, 0);
}

// @0946 getKey: key (upper-cased; '/' -> '?', Backspace -> '^') or 0
function* f_0946() {
  const k = i16(yield* F.f_5a79());
  if (k >= 0x61 && k <= 0x7a) return k - 0x20;
  if (k === 0x2f) return 0x3f;
  if (k === 8) return 0x5e;
  return k;
}

// @0988 drawViewScript(p): clear the view area (y 0x78, 80x80 bytes) and run drawing script p
function f_0988(p) {
  ww(0x1d04, 0x78); ww(0x1d0a, 3); ww(0x1d0c, 0); ww(0x1d02, 0); ww(0x1cea, 0x50); ww(0x1ce8, 0x50);
  F.f_5b0a();
  f_09b7(p);
}

// @09b7 drawScript(p): 0 end, 1 <text\0>, 2 x y, 3 x, 4 fg bg, 5 x y w h (filled rect), 6 newline; f_6e26 after each
function f_09b7(p) {
  p &= 0xffff;
  for (;;) {
    const c = rb(p); p = (p + 1) & 0xffff;
    if (c === 0) return;
    if (c === 1) { ww(0x1d06, p); F.f_5bf8(); p = (rw(0x1d06) + 1) & 0xffff; ww(0x1d06, p); }
    else if (c === 6) { ww(0x1d02, 0); ww(0x1d04, rw(0x1d04) + 8); }
    else if (c === 2) { const x = rb(p), y = rb(p + 1); p = (p + 2) & 0xffff; ww(0x1d04, y); ww(0x1d02, x); }
    else if (c === 3) { ww(0x1d02, rb(p)); p = (p + 1) & 0xffff; }
    else if (c === 4) { const fg = rb(p), bg = rb(p + 1); p = (p + 2) & 0xffff; ww(0x1d0c, bg); ww(0x1d0a, fg); }
    else if (c === 5) {
      const x = rb(p), y = rb(p + 1), w = rb(p + 2), h = rb(p + 3); p = (p + 4) & 0xffff;
      ww(0x1cea, h); ww(0x1d04, y); ww(0x1ce8, w); ww(0x1d02, x);
      F.f_5b0a();
    }
    F.f_6e26();
  }
}

function clearRecord(bx) { for (let k = 0; k < 20; k += 2) ww(bx + k, 0x8000); }

// @0abc clearRecords: all 17 records := 0x8000
function f_0abc() {
  for (let i = 0; i < 0x11; i++) { const bx = (i * 0x14 + 0x166) & 0xffff; clearRecord(bx); ww(0x2ba, bx); }
}

// @0b08 eraseRecord(n, x, w): if record n is in use, clear it and erase its 8-line box at x, width w
function f_0b08(n, x, w) {
  const bx = (i16(n * 0x14) + 0x166) & 0xffff;
  ww(0x2ba, bx);
  if (rw(bx) === 0x8000) return;
  clearRecord(bx);
  ww(0x1cea, 8); ww(0x1d02, x); ww(0x1ce8, w);
  F.f_5b0a();
}

// @0b61 fillBox(x, w): fill rect x, width w, height 8 at the current y/colour
function f_0b61(x, w) {
  ww(0x1cea, 8); ww(0x1d02, x); ww(0x1ce8, w);
  F.f_5b0a();
}

Object.assign(F, {
  LJ_MAIN, RESTART,
  f_0082, f_022f, f_0256, f_0317, f_033e, f_0384, f_03fb, f_0463, f_04c5, f_04eb, f_058e, f_05f3, f_0672, f_0693,
  f_06bf, f_06f4, f_0748, f_076d, f_0786, f_08e6, f_0946, f_0988, f_09b7, f_0abc, f_0b08, f_0b61,
});
