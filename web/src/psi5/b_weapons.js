// PSI5.EXE — Weapons department (0x0b7c..0x15b2): the simulation step that round-robins the departments, the
// table-driven status-panel updater, the Weapons menu (status/defense displays, weapon queue: create/reorder/fire)
// and the weapon queue insertion. `@xxxx` = function address in the original (re/psi5.lst).
//
// DS globals:
//   0x2ba  pointer to the value cache of the panel row being drawn (0x166 + row*0x14, 10 words per row)
//   0x2d0  handler of the currently displayed panel (called by the sim step when its department is due)
//   0x2d2  id of the currently displayed panel (1 = status @f_0f17, 6 = defense queue @f_0f54)
//   0x2d4  "queue empty" message shown flag      0x2d8  menu selection of the Weapons menu
//   0x2f6  panel update suppressed (non-zero)    0x2fa/0x32e/0x348  generic pick-list menu (items / title / ids)
//   0x37c[26] weapon ids for the list builder    0x3e0[8] queue slot: serial (-1 = free)   0x3f0[8] slot param a
//   0x400[8] slot param b   0x410[8] slot weapon id   0x430[8] slot state (-1 on creation)
//   0x440[8] queue order (slot indices)   0x506 queue length   0x508 next serial (0..25)
//   0x520[] prompts per 0x16ca choice   0x59e[26] weapon available   0x912[26] weapon already queued
//   0xbb4[] weapon names   0xc32[] position names   0x1570 department round-robin index (0..5)
//   0x1392/0x13aa Weapons menu items/title   0x157e/0x1588 reduced menu (when [0x4ce8]==0)
//   0x15a4/0x15c8/0x16ca first sub-choice menu   0x15ec/0x15fe/0x16cc second sub-choice menu
//   0x16b0[] / 0x16c2 / 0x16c8 / 0x1698 / 0x169a / 0x1628.. message strings   0x16ce/0x16d0 panel handlers
//   0x1d02 x  0x1d04 y  0x1d06 text ptr  0x1d0a/0x1d0c colours (params of the text blitter f_5bf8)
//   0x3518 sim steps pending (0..10)   0x4ce8 full Weapons menu enabled
import { F, callPtr } from './fn.js';
import { rw, rs, ww, i16, u16, frame, unframe } from '../rt.js';

// @0b7c drawPanel(tbl, row, val, dx): table-driven panel row; each 10-byte entry {type, x, y, data, valPtrs}
// is redrawn only when its value differs from the cached one. Types: 1 string[val], 4 string[row], 12 fixed string
// (once), 2 string[*v], 3/5/6/7/9/11 number formats, 8/10 signed/conditional formats, other: plain text.
function f_0b7c(tbl, row, val, dx) {
  let i = 0;
  ww(0x2ba, i16(row * 0x14) + 0x166);
  for (let e = tbl; rw(e) !== 0; e = u16(e + 10), i++) {
    if (rw(e + 4)) ww(0x1d04, rw(e + 4));
    const type = rw(e);
    ww(0x1d02, rw(e + 2) + dx);
    const c = rw(0x2ba) + i * 2;
    if (type === 1 || type === 4) {
      const v = type === 1 ? val : row;
      if (rw(c) === u16(v)) continue;
      ww(c, v);
      ww(0x1d06, rw(rw(e + 6) + v * 2));
      F.f_5bf8();
      continue;
    }
    if (type === 0x0c) {
      if (rw(c) === 1) continue;
      ww(c, 1);
      ww(0x1d06, rw(rw(e + 6)));
      F.f_5bf8();
      continue;
    }
    const p = rw(e + 8) + val * 2, v = rw(p);
    if (rw(c) === v) continue;
    ww(c, v);
    switch (u16(type - 2)) {
      case 0: ww(0x1d06, rw(rw(e + 6) + v * 2)); break;
      case 1: F.f_69ee(v); break;
      case 3: F.f_6a27(v); break;
      case 4: F.f_6a51(v); break;
      case 5: F.f_6a01(v); break;
      case 6: F.f_6aa6(v, rw(e + 6)); break;
      case 7: F.f_6a75(v); break;
      case 8: F.f_6af1(v, rw(e + 6)); break;
      case 9: F.f_6a14(v); break;
    }
    F.f_5bf8();
  }
  F.f_6e26();
}

// @0d6b drawText(x, y, s)
function f_0d6b(x, y, s) { ww(0x1d06, s); ww(0x1d02, x); ww(0x1d04, y); F.f_5bf8(); }

// @0d87 nullHandler(): panel handler that does nothing
function f_0d87() { return 0; }

// @0d97 simStep(): one simulation step per pending tick: next department (round robin over 6), then redraw the
// displayed panel when it belongs to that department
function* f_0d97() {
  if (rw(0x3518)) {
    const d = i16(rw(0x1570) + 1);
    ww(0x1570, d);
    if (d >= 6) ww(0x1570, 0);
    switch (rw(0x1570)) {
      case 0: F.f_4922(); F.f_64aa(); F.f_66dc(); break;
      case 1: F.f_16f3(); break;
      case 2: F.f_243d(); break;
      case 3: yield* F.f_2cf2(); break;
      case 4: F.f_37be(); break;
      case 5: F.f_4479(); break;
    }
    const t = i16(rw(0x3518) - 1);
    ww(0x3518, t);
    if (t > 10 || t < 0) ww(0x3518, 0);
    const a = rw(0x1570), b = rw(0x2d2);
    if ((b === a || u16(a + 5) === b) && rw(0x2f6) === 0) callPtr(rw(0x2d0));
  }
  F.f_6e26();
}

// @0e37 weaponsMenu(): Weapons department command loop until '^' (back)
function* f_0e37() {
  if (rw(0x4ce8)) {
    F.f_0ed5();
    for (;;) {
      const k = yield* F.f_0786(rw(0x13aa), 0x1392, 0x2d8);
      if (k === 0x5e) break;
      if (k === 0x53) yield* F.f_0f17();          // S
      else if (k === 0x44) yield* F.f_0f54();     // D
      else if (k === 0x3f) F.f_0ed5();            // ?
      else if (k === 0x43) yield* F.f_0f97();     // C
      else if (k === 0x52) yield* F.f_101d();     // R
      else if (k === 0x46) yield* F.f_1172();     // F
    }
  } else {
    F.f_0ef6();
    for (;;) {
      const k = yield* F.f_0786(rw(0x1588), 0x157e, 0x2d8);
      if (k === 0x5e) break;
      if (k === 0x46) yield* F.f_132d();
    }
  }
  F.f_022f();
  ww(0x2d8, 0);
}

// @0ed5 showMenu(): redraw the Weapons menu
function f_0ed5() { F.f_04c5(); F.f_0672(0x1392, rw(0x2d8)); F.f_0693(); F.f_06bf(rw(0x1628)); }
// @0ef6 showMenu2(): redraw the reduced Weapons menu
function f_0ef6() { F.f_04c5(); F.f_0672(0x157e, rw(0x2d8)); F.f_0693(); F.f_06bf(rw(0x1628)); }

// @0f17 showStatusPanel(): switch the panel to display 1 (handler [0x16ce])
function* f_0f17() {
  if (rw(0x2d2) === 1) return;
  F.f_06bf(rw(0x1632));
  yield* F.f_06f4();
  F.f_0988(rw(0x277b));
  F.f_0abc();
  F.f_1402();
  ww(0x2d2, 1); ww(0x2d0, rw(0x16ce));
  F.f_0ed5();
}

// @0f54 showQueuePanel(): switch the panel to display 6 (weapon queue, handler [0x16d0])
function* f_0f54() {
  if (rw(0x2d2) === 6) return;
  F.f_06bf(rw(0x164a));
  yield* F.f_06f4();
  F.f_0988(rw(0x2847));
  F.f_0abc();
  ww(0x2d4, 0);
  F.f_1443();
  ww(0x2d2, 6); ww(0x2d0, rw(0x16d0));
  F.f_0ed5();
}

// @0f97 cancelWeapon(): pick a queued weapon and remove it (f_15b3)
function* f_0f97() {
  F.f_05f3(0xbb4, 0x3e0, 0x440, rw(0x506));
  const p = frame(2);
  try {
    ww(p, 0);
    F.f_04c5(); F.f_0672(0x2fa, rw(p)); F.f_06bf(rw(0x1660));
    const k = yield* F.f_0786(0x32e, 0x2fa, p);
    if (k !== 0x5e) {
      F.f_06bf(rw(0xbb4 + rw(0x348 + rs(p) * 2) * 2));
      yield* F.f_06f4();
      F.f_15b3(rw(0x348 + rs(p) * 2));
    }
    F.f_0ed5();
  } finally { unframe(2); }
}

// @101d reorderWeapon(): pick a queued weapon and a new position, move it there in the order list 0x440
function* f_101d() {
  F.f_05f3(0xbb4, 0x3e0, 0x440, rw(0x506));
  const a = frame(4), b = a + 2;
  try {
    ww(a, 0);
    F.f_04c5(); F.f_0672(0x2fa, rw(a)); F.f_06bf(rw(0x1674));
    if ((yield* F.f_0786(0x32e, 0x2fa, a)) === 0x5e) return F.f_0ed5();
    ww(b, 0);
    let item = rw(0x348 + rs(a) * 2);
    F.f_058e(0xc32, rw(0x506));
    F.f_04c5(); F.f_0672(0x2fa, rw(b)); F.f_06bf(rw(0xbb4 + item * 2)); F.f_06bf(rw(0x1680));
    if ((yield* F.f_0786(0x32e, 0x2fa, b)) === 0x5e) return F.f_0ed5();
    F.f_06bf(rw(0xc32 + rs(b) * 2));
    yield* F.f_06f4();
    let i = 0;
    do {
      if (rw(0x3e0 + rw(0x440 + i * 2) * 2) === item) break;
      i = i16(i + 1);
    } while (i < rs(0x506));
    if (i < rs(0x506)) {
      item = rw(0x440 + i * 2);
      while (i < rs(b)) { ww(0x440 + i * 2, rw(0x442 + i * 2)); i = i16(i + 1); }
      while (i > rs(b)) { ww(0x440 + i * 2, rw(0x43e + i * 2)); i = i16(i - 1); }
      ww(0x440 + rs(b) * 2, item);
    }
    F.f_0ed5();
  } finally { unframe(4); }
}

// @1172 addWeapon(): choose two parameters, a weapon and a queue position, then queue it (f_14f3)
function* f_1172() {
  if (rs(0x506) >= 8) { F.f_06bf(rw(0x1698)); yield* F.f_06f4(); return F.f_0ed5(); }
  const w = frame(4), pos = w + 2;
  try {
    F.f_04c5(); F.f_0672(0x15a4, rw(0x16ca)); F.f_06bf(rw(0x169a));
    if ((yield* F.f_0786(rw(0x15c8), 0x15a4, 0x16ca)) === 0x5e) return F.f_0ed5();
    F.f_04c5(); F.f_0672(0x15ec, rw(0x16cc)); F.f_06bf(rw(0x520 + rw(0x16ca) * 2));
    if ((yield* F.f_0786(rw(0x15fe), 0x15ec, 0x16cc)) === 0x5e) return F.f_0ed5();
    F.f_04eb(0xbb4, 0x59e, 0x1a);
    let j = 0;
    while (j < 0x1a && !(rs(0x37c + j * 2) >= 0 && rw(0x912 + j * 2) === 0)) j++;
    ww(w, rw(0x37c + j * 2));
    F.f_06bf(rw(0x16b0 + rw(0x16cc) * 2)); F.f_06bf(rw(0x16c2));
    F.f_04c5(); F.f_0672(0x2fa, rw(w));
    if ((yield* F.f_0786(0x32e, 0x2fa, w)) === 0x5e) return F.f_0ed5();
    const id = rw(0x348 + rs(w) * 2);
    ww(pos, rw(0x506));
    F.f_058e(0xc32, i16(rw(0x506) + 1));
    ww(w, id);
    F.f_06bf(rw(0xbb4 + id * 2)); F.f_06bf(rw(0x16c8));
    F.f_04c5(); F.f_0672(0x2fa, rw(pos));
    if ((yield* F.f_0786(0x32e, 0x2fa, pos)) === 0x5e) return F.f_0ed5();
    F.f_06bf(rw(0xc32 + rs(pos) * 2));
    yield* F.f_06f4();
    F.f_14f3(rw(w), rw(0x16ca) === 0 ? 10 : rw(0x16ca), rw(0x16cc), rw(pos));
    F.f_0ed5();
  } finally { unframe(4); }
}

// @132d fireWeapon() (reduced menu): choose a parameter and a weapon, empty the queue, queue only that weapon
function* f_132d() {
  const p = frame(2);
  try {
    F.f_04c5(); F.f_0672(0x15ec, rw(0x2d8));
    if ((yield* F.f_0786(rw(0x15fe), 0x15ec, 0x16cc)) === 0x5e) return F.f_0ef6();
    F.f_04eb(0xbb4, 0x59e, 0x1a);
    ww(p, 0);
    F.f_06bf(rw(0x16b0 + rw(0x16cc) * 2)); F.f_06bf(rw(0x16c2));
    F.f_04c5(); F.f_0672(0x2fa, rw(p));
    if ((yield* F.f_0786(0x32e, 0x2fa, p)) === 0x5e) return F.f_0ef6();
    ww(p, rw(0x348 + rs(p) * 2));
    F.f_06bf(rw(0xbb4 + rs(p) * 2));
    yield* F.f_06f4();
    while (rw(0x506) !== 0) F.f_15b3(0);
    F.f_14f3(rw(p), 10, rw(0x16cc), 0);
    F.f_0ef6();
  } finally { unframe(2); }
}

// @1402 drawStatusPanel(): the 7 rows of panel table 0x27eb
function f_1402() {
  ww(0x1d0a, 3); ww(0x1d04, 0x90); ww(0x1d0c, 0);
  for (let i = 0; i < 7; i++) { F.f_0b7c(0x27eb, i, i, 0); ww(0x1d04, rw(0x1d04) + 8); }
}

// @1443 drawQueuePanel(): one row (table 0x288e) per queued weapon, blank rows up to 8, "empty" message
function f_1443() {
  ww(0x1d0a, 3); ww(0x1d0c, 0); ww(0x1d04, 0x88);
  if (rw(0x2d4) && rw(0x506)) { F.f_0b61(0, 0x50); ww(0x2d4, 0); }
  let i = 0;
  for (; i < rs(0x506); i++) { F.f_0b7c(0x288e, i, rw(0x440 + i * 2), 0); ww(0x1d04, rw(0x1d04) + 8); }
  for (; i < 8; i++) { F.f_0b08(i, 0, 0x50); ww(0x1d04, rw(0x1d04) + 8); }
  if (rw(0x506) === 0 && rw(0x2d4) === 0) { ww(0x2d4, 1); F.f_0d6b(6, 0x88, rw(0x161e)); }
}

// @14f3 queueWeapon(weapon, a, b, pos): insert weapon at order position pos (clamped to the length) in a free slot
function f_14f3(weapon, a, b, pos) {
  pos = i16(pos);
  if (rw(0x59e + weapon * 2) === 0) return;
  let n = rs(0x506);
  if (pos > n) pos = n;
  while (n > pos) { ww(0x440 + n * 2, rw(0x43e + n * 2)); n = i16(n - 1); }
  let s = 0;
  while (s < 8 && rs(0x3e0 + s * 2) >= 0) s++;
  ww(0x440 + pos * 2, s);
  const ser = rw(0x508), nx = i16(ser + 1);
  ww(0x3e0 + s * 2, ser);
  ww(0x508, nx);
  if (nx >= 0x1a) ww(0x508, 0);
  ww(0x3f0 + s * 2, a); ww(0x400 + s * 2, b); ww(0x410 + s * 2, weapon); ww(0x430 + s * 2, 0xffff);
  ww(0x912 + weapon * 2, 1);
  ww(0x506, rw(0x506) + 1);
}

Object.assign(F, { f_0b7c, f_0d6b, f_0d87, f_0d97, f_0ed5, f_0ef6, f_0e37, f_0f17, f_0f54, f_0f97, f_101d, f_1172,
  f_132d, f_1402, f_1443, f_14f3 });
