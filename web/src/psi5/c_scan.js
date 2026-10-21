// PSI5.EXE — Scanning department: the 6 Hz scanner simulation (@16f3) and the Scanning menu UI (@1cfa..@232b).
// Targets (26 slots, index t) are detected by the scanner; detected ones can be put on the examination list, which
// is worked by up to 5 examination channels; the 8 "contact" slots (0x3e0.. tables) hold weapons-locked targets.
// DS globals:
//   0x2d0 redraw fn ptr of current display   0x2d2 current display id (2 status, 7 examination list)
//   0x2d4 "nothing ..." message shown flag    0x2da selected scanning menu item
//   0x13b4/0x16f4 menu item tables (full "SD?CRE^" / reduced "S?E^", strings at [0x13cc]/[0x1704])
//   0x4cea scanning menu full (else reduced)
//   0x2fa/0x32e target picker items/letters (built by f_04eb from names 0xbb4)  0x348[] picker pos -> target
//   0x37c[] examine picker order (target or <0)
//   0x3c6[4] shown state of the 4 scanner indicator lights (sprites 0x4a2d[light*4+state])
//   0x3e0[8] contact: id   0x3f0[8] contact: field (copied from channel 0x46e)   0x400[8] contact: class
//   0x410[8] contact: target   0x420[8] contact: status 0..4 (4 = ready for a channel)   0x430[8] contact: channel or -1
//   0x440[] contact slot list, 0x506 its length
//   0x450[5] channel: target or -1   0x45a[5] channel: class   0x464[5] channel: contact slot
//   0x46e[5] channel: result   0x478[5] channel: progress amount
//   0x482/0x490/0x49e/0x4ac[7] per-type counters (capped at 99)   0x4ba/0x4c8/0x4d6/0x4e4[7] per-type totals (cap 999)
//   0x4f2[] count per detected class   0x59e[26] target detected (class, 0 = none)   0x606[26] target type
//   0x63a/0x6a2/0x70a[26] target flags   0x876[26] target time stamp   0x8de[26] target on examination list
//   0x912[26] target has a contact   0x946[26] target pending capture (1..4 = type)
//   0x97a[] examination list (targets, priority order), 0x9d4 its length   0x9d2 number of detected targets
//   0x9ca..0x9d0 targets held elsewhere (not dropped)   0xb7a current time   0x6252[class] detection timeout
//   0x6266[type] type -> counter column   0xebc/0xf58[] scanner part state   0xec4/0xf60[4] light power/enabled
//   0x16d2 scan sweep countdown   0x16d4 alert countdown   0x16d6 round-robin light index   0x16d8[4] light busy
//   0x4ce8 scanner active   0x4cf2 alert level   0x8b50 alert duration   0x8b52/0x8b54 alert thresholds
//   0x8b56[] sweep period per alert level   0x8b5a new contact arg   0x3508 sound muted
//   0x1d04/0x1d0a/0x1d0c text cursor y / x / attribute (for f_0b7c/f_0b08)
import { F } from './fn.js';
import { i16, rw, rs, ww, frame, unframe } from '../rt.js';

const inc = a => ww(a, rw(a) + 1);
const dec = a => ww(a, rw(a) - 1);

// @15b3 dropContactById(id): remove the first contact with id `id` from the list; recompute 0x912 of its target
function f_15b3(id) {
  id = i16(id);
  let t = -1;
  for (let i = 0; rs(0x506) > i; i++) {
    const s = rw(0x440 + i * 2);
    if (rs(0x3e0 + s * 2) === id) {
      ww(0x3e0 + s * 2, 0xffff);
      t = rs(0x410 + s * 2);
      dec(0x506);
      for (let j = i; j < rs(0x506); j++) ww(0x440 + j * 2, rw(0x442 + j * 2));
      ww(0x912 + t * 2, 0);
      for (let k = 0; k < rs(0x506); k++) {
        if (rs(0x410 + rw(0x440 + k * 2) * 2) === t) { ww(0x912 + rw(0x440 + k * 2) * 2, 1); break; }
      }
      return;
    }
  }
}

// @167c dropContactsOfTarget(t): remove every contact on target t, clear its 0x912 flag
function f_167c(t) {
  t = i16(t);
  let i = 0;
  while (rs(0x506) > i) {
    const s = rw(0x440 + i * 2);
    if (rs(0x410 + s * 2) === t) {
      ww(0x3e0 + s * 2, 0xffff);
      dec(0x506);
      for (let j = i; j < rs(0x506); j++) ww(0x440 + j * 2, rw(0x442 + j * 2));
    } else i++;
  }
  ww(0x912 + t * 2, 0);
}

// @16f3 scanStep(): scanner simulation (6 Hz): captures, detection timeouts, examination channels, contact status,
// sweep/alert timers, indicator lights
function f_16f3() {
  let cand = -1;
  ww(0x16d8, 0); ww(0x16da, 0); ww(0x16dc, 0); ww(0x16de, 0);
  for (let t = 0; t < 0x1a; t++) {
    const p = rs(0x946 + t * 2);
    if (p !== 0) {
      const col = rs(0x6266 + rs(0x606 + t * 2) * 2);
      const base = [0x482, 0x490, 0x49e, 0x4ac][p - 1];
      if (base !== undefined && rs(base + col * 2) < 0x63) inc(base + col * 2);
      inc(0x4f2 + rs(0x59e + t * 2) * 2);
      F.f_23df(t);
      f_167c(t);
      ww(0x59e + t * 2, 0);
      dec(0x9d2);
      F.f_6526(6);
      F.f_64be(2);
      ww(0x946 + t * 2, 0);
    }
    if (rs(0x59e + t * 2) === 0) continue;
    if (i16(rw(0xb7a) - rw(0x876 + t * 2)) >= rs(0x6252 + rs(0x59e + t * 2) * 2) &&
        rs(0x9ca) !== t && rs(0x9cc) !== t && rs(0x9ce) !== t && rs(0x9d0) !== t && rs(0x70a + t * 2) === 0) {
      F.f_23df(t);
      f_167c(t);
      ww(0x59e + t * 2, 0);
      dec(0x9d2);
    } else if (cand < 0 && rs(0x70a + t * 2) !== 0 && rs(0x6a2 + t * 2) !== 0 && rs(0x63a + t * 2) !== 0) cand = t;
  }
  for (let c = 0; c < 5; c++) {
    if (rs(0x450 + c * 2) < 0) continue;
    const col = rs(0x6266 + rs(0x606 + rs(0x450 + c * 2) * 2) * 2);
    if (rs(0x478 + c * 2) !== 0) ww(0x16d8 + rs(0x45a + c * 2) * 2, 1);
    const k = rw(0x45a + c * 2);
    if (k < 4) {
      const a = [0x4ba, 0x4c8, 0x4d6, 0x4e4][k] + col * 2;
      ww(a, rw(a) + rw(0x478 + c * 2));
      if (rs(a) > 0x3e7) ww(a, 0x3e7);
    }
    if (rs(0x46e + c * 2) === 0) {
      f_15b3(rs(0x3e0 + rs(0x464 + c * 2) * 2));
      if (rs(0x506) === 0 && rs(0x3508) === 0) { F.f_6526(6); F.f_64be(4); }
    }
    ww(0x450 + c * 2, 0xffff);
  }
  for (let i = 0; i < rs(0x506); i++) {
    const s = rs(0x440 + i * 2);
    if (rs(0x430 + s * 2) >= 0) {
      if (rs(0x3f0 + s * 2) !== 0xa) ww(0x3f0 + s * 2, rw(0x46e + rs(0x430 + s * 2) * 2));
      ww(0x430 + s * 2, 0xffff);
    }
    const q = i16(rs(0x400 + s * 2) + 4);
    let st;
    if (rs(0xebc + q * 2) === 0) st = 0;
    else if (rs(0xf58 + q * 2) === 0) st = 1;
    else if (rs(0x6a2 + rs(0x410 + s * 2) * 2) === 0) st = 2;
    else if (rs(0x70a + rs(0x410 + s * 2) * 2) === 0) st = 3;
    else st = 4;
    ww(0x420 + s * 2, st);
  }
  for (let i = 0, c = 0; i < rs(0x506); i++) {
    const s = rs(0x440 + i * 2);
    if (rs(0x420 + s * 2) === 4) {
      ww(0x450 + c * 2, rw(0x410 + s * 2));
      ww(0x430 + s * 2, c);
      ww(0x464 + c * 2, s);
      ww(0x45a + c * 2, rw(0x400 + s * 2));
      ww(0x46e + c * 2, rw(0x3f0 + s * 2));
      ww(0x478 + c * 2, 0);
      if (++c >= 5) break;
    }
  }
  if (rs(0x4ce8) !== 0) {
    if (rw(0x16d2)) dec(0x16d2);
    if (rs(0x506) !== 0) ww(0x16d2, rw(0x8b56 + rs(0x4cf2) * 2));
    else if (rs(0x16d2) === 0 && cand >= 0) {
      let light = -1;
      {                                           // a for (i = 0; i < 4; ...) whose body always leaves: one try
        let n = i16(rw(0x16d6) + 1);
        ww(0x16d6, n);
        if (n >= 4) ww(0x16d6, 0);
        const l = rs(0x16d6);
        if (rs(0xf60 + l * 2) !== 0 && rs(0xec4 + l * 2) !== 0) light = l;
      }
      if (light >= 0) {
        F.f_14f3(cand, rw(0x8b5a), light, 1);
        F.f_6526(4);
        F.f_6526(2);
        if (rs(0x3508) === 0) F.f_64be(6);
      }
    }
    if (rw(0x16d4)) dec(0x16d4);
    else ww(0x4cf2, 0);
    if (rs(0x9d2) > rs(0x8b52) || rs(0x506) > rs(0x8b54)) { ww(0x4cf2, 1); ww(0x16d4, rw(0x8b50)); }
  }
  for (let l = 0; l < 4; l++) {
    let st;
    if (rs(0xec4 + l * 2) === 0 || rs(0xf60 + l * 2) === 0) st = 0;
    else if (rs(0xec4 + l * 2) === 1) st = 1;
    else if (rs(0x16d8 + l * 2) !== 0) st = 3;
    else st = 2;
    if (rs(0x3c6 + l * 2) !== st) { F.f_70a4(rw(0x4a2d + i16(l * 4 + st) * 2)); ww(0x3c6 + l * 2, st); }
  }
}

// @1cfa scanningDept(): Scanning department menu loop until '^'
function* f_1cfa() {
  f_1dab();
  if (rs(0x4cea) !== 0) {
    for (;;) {
      const k = yield* F.f_0786(rw(0x13cc), 0x13b4, 0x2da);
      if (k === 0x5e) break;
      if (k === 0x53) yield* F.f_1de2();
      else if (k === 0x44) yield* F.f_1e25();
      else if (k === 0x3f) f_1dab();
      else if (k === 0x43) yield* F.f_1e68();
      else if (k === 0x52) yield* F.f_1ee5();
      else if (k === 0x45) yield* F.f_1fbe();
    }
  } else {
    for (;;) {
      const k = yield* F.f_0786(rw(0x1704), 0x16f4, 0x2da);
      if (k === 0x5e) break;
      if (k === 0x53) yield* F.f_1de2();
      else if (k === 0x3f) f_1dab();
      else if (k === 0x45) yield* F.f_20eb();
    }
  }
  F.f_022f();
  ww(0x2da, 0);
}

// @1dab showScanMenu(): redraw the menu bar and the "SCAN." prompt
function f_1dab() {
  F.f_04c5();
  F.f_0672(rs(0x4cea) !== 0 ? 0x13b4 : 0x16f4, rw(0x2da));
  F.f_0693();
  F.f_06bf(rw(0x170e));
}

// @1de2 cmdStatus(): 'S' status report display
function* f_1de2() {
  if (rs(0x2d2) === 2) return;
  F.f_06bf(rw(0x171e));
  yield* F.f_06f4();
  F.f_0988(rw(0x28cc));
  F.f_0abc();
  ww(0x2d4, 0);
  f_217d();
  ww(0x2d2, 2); ww(0x2d0, rw(0x17d4));
  f_1dab();
}

// @1e25 cmdDisplayList(): 'D' examination list display
function* f_1e25() {
  if (rs(0x2d2) === 7) return;
  F.f_06bf(rw(0x1736));
  yield* F.f_06f4();
  F.f_0988(rw(0x29a5));
  F.f_0abc();
  ww(0x2d4, 0);
  f_2277();
  ww(0x2d2, 7); ww(0x2d0, rw(0x17d6));
  f_1dab();
}

// pick a target (items built from flag table `flags`), prompt `prompt`; returns key, *p = picker position
function* pickTarget(flags, p, prompt) {
  F.f_04eb(0xbb4, flags, 0x1a);
  ww(p, 0);
  F.f_04c5();
  F.f_0672(0x2fa, rw(p));
  F.f_06bf(rw(prompt));
  return yield* F.f_0786(0x32e, 0x2fa, p);
}

// @1e68 cmdCancel(): 'C' cancel examination of a target
function* f_1e68() {
  const p = frame(2);
  try {
    if ((yield* pickTarget(0x8de, p, 0x1756)) !== 0x5e) {
      const t = rw(0x348 + rs(p) * 2);
      ww(p, t);
      F.f_06bf(rw(0xbb4 + i16(t * 2)));
      yield* F.f_06f4();
      F.f_23df(rs(p));
    }
    f_1dab();
  } finally { unframe(2); }
}

// pick a list position (0..n-1) after target t was chosen; returns key, *q = position
function* pickPriority(n, q, p, prompt) {
  F.f_058e(0xc32, n);
  F.f_04c5();
  F.f_0672(0x2fa, rw(q));
  const t = rw(0x348 + rs(p) * 2);
  ww(p, t);
  F.f_06bf(rw(0xbb4 + i16(t * 2)));
  F.f_06bf(rw(prompt));
  return yield* F.f_0786(0x32e, 0x2fa, q);
}

// @1ee5 cmdRank(): 'R' move a listed target to another priority level
function* f_1ee5() {
  const p = frame(4), q = p + 2;               // [bp+6] target, [bp+8] level
  try {
    if ((yield* pickTarget(0x8de, p, 0x1764)) !== 0x5e) {
      ww(q, 0);
      if ((yield* pickPriority(rw(0x9d4), q, p, 0x1770)) !== 0x5e) {
        F.f_06bf(rw(0xc32 + rs(q) * 2));
        yield* F.f_06f4();
        f_232b(rs(p), rs(q));
      }
    }
    f_1dab();
  } finally { unframe(4); }
}

// @1fbe cmdExamine(): 'E' add a detected target to the examination list at a chosen priority
function* f_1fbe() {
  const p = frame(4), q = p + 2;               // [bp+8] target, [bp+0xa] priority
  try {
    if (rs(0x9d4) < 8) {
      F.f_04eb(0xbb4, 0x59e, 0x1a);
      let i = 0;
      for (; i < 0x1a; i++)
        if (rs(0x37c + i * 2) >= 0 && rs(0x8de + i * 2) === 0 && rs(0x6a2 + i * 2) === 0) break;
      ww(p, rw(0x37c + i * 2));
      F.f_04c5();
      F.f_0672(0x2fa, rw(p));
      F.f_06bf(rw(0x1782));
      if ((yield* F.f_0786(0x32e, 0x2fa, p)) !== 0x5e) {
        const n = rw(0x9d4);
        ww(q, n);
        if ((yield* pickPriority(i16(n + 1), q, p, 0x178e)) !== 0x5e) {
          F.f_06bf(rw(0xc32 + rs(q) * 2));
          yield* F.f_06f4();
          f_232b(rs(p), rs(q));
        }
      }
    } else {
      F.f_06bf(rw(0x17a2));
      yield* F.f_06f4();
    }
    f_1dab();
  } finally { unframe(4); }
}

// @20eb cmdExamineOnly(): reduced-menu 'E': clear the examination list, then examine one target
function* f_20eb() {
  const p = frame(2);
  try {
    while (rs(0x9d4) !== 0) F.f_23df(rs(0x97a));
    if ((yield* pickTarget(0x59e, p, 0x1782)) !== 0x5e) {
      const t = rw(0x348 + rs(p) * 2);
      ww(p, t);
      F.f_06bf(rw(0xbb4 + i16(t * 2)));
      yield* F.f_06f4();
      f_232b(rs(p), 0);
    }
    f_1dab();
  } finally { unframe(2); }
}

// @217d drawStatusReport(): status display body (detected targets in two columns of 8, or "nothing detected")
function f_217d() {
  ww(0x1d0a, 3); ww(0x1d0c, 0);
  F.f_0b7c(0x2999, 0x10, 0, 0);
  ww(0x1d04, 0x88);
  if (rs(0x2d4) !== 0 && rs(0x9d2) !== 0) { F.f_0b61(0, 0x28); ww(0x2d4, 0); }
  let row = 0, col = 0;
  for (let t = 0; t < 0x1a; t++) {
    if (rs(0x59e + t * 2) === 0) continue;
    F.f_0b7c(0x2951, row, t, col);
    ww(0x1d04, rw(0x1d04) + 8);
    if (++row === 8) { ww(0x1d04, 0x88); col = 0x28; }
  }
  while (row < 0x10) {
    F.f_0b08(row, i16(col + 2), 0x26);
    ww(0x1d04, rw(0x1d04) + 8);
    if (++row === 8) { ww(0x1d04, 0x88); col = 0x28; }
  }
  if (rs(0x9d2) === 0 && rs(0x2d4) === 0) { ww(0x2d4, 1); F.f_0d6b(8, 0x88, rw(0x17b6)); }
}

// @2277 drawExamList(): examination list display body (8 rows, or "no examinations underway")
function f_2277() {
  ww(0x1d0a, 3); ww(0x1d0c, 0); ww(0x1d04, 0x88);
  if (rs(0x2d4) !== 0 && rs(0x9d4) !== 0) { F.f_0b61(0, 0x50); ww(0x2d4, 0); }
  let i = 0;
  for (; i < rs(0x9d4); i++) { F.f_0b7c(0x29f6, i, rw(0x97a + i * 2), 0); ww(0x1d04, rw(0x1d04) + 8); }
  for (; i < 8; i++) { F.f_0b08(i, 0, 0x50); ww(0x1d04, rw(0x1d04) + 8); }
  if (rs(0x9d4) === 0 && rs(0x2d4) === 0) { ww(0x2d4, 1); F.f_0d6b(6, 0x88, rw(0x17d2)); }
}

// @232b setExamPriority(t, pos): put detected target t on the examination list at position pos (moving it if listed)
function f_232b(t, pos) {
  t = i16(t); pos = i16(pos);
  if (rs(0x59e + t * 2) === 0) return;
  let i;
  if (rs(0x8de + t * 2) !== 0) {
    for (i = 0; rs(0x97a + i * 2) !== t; i++);
    if (pos >= rs(0x9d4)) pos = i16(rw(0x9d4) - 1);
  } else {
    ww(0x8de + t * 2, 1);
    if (pos > rs(0x9d4)) pos = rs(0x9d4);
    i = rs(0x9d4);
    inc(0x9d4);
  }
  for (; i < pos; i++) ww(0x97a + i * 2, rw(0x97c + i * 2));
  for (; i > pos; i--) ww(0x97a + i * 2, rw(0x978 + i * 2));
  ww(0x97a + pos * 2, t);
}

Object.assign(F, { f_15b3, f_167c, f_16f3, f_1cfa, f_1dab, f_1de2, f_1e25, f_1e68, f_1ee5, f_1fbe, f_20eb, f_217d,
  f_2277, f_232b });
