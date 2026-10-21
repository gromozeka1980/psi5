// PSI5.EXE @32a3..@422f — Engineer department (menu key E: power on/off, priorities, power-plant simulation step)
// and the entry of the Repair department (menu key R: repair queue screens/commands), plus a few shared helpers.
// DS globals (as far as figured out):
//   0x2d0 display refresh fn ptr   0x2d2 current display id (4 eng status, 9 eng priorities, 5/10 repair screens)
//   0x2d4 repair "queue empty" message shown   0x2e4 engineer menu sel   0x2e6 "C" (shut down) sel
//   0x2e8/0x2ea "R" (reprioritise) device sel / new position   0x2ec "E" (energise) sel   0x2ee repair menu sel
//   0x2fa/0x32e/0x348 generic pick-list (items, prompt, index->id)   0x3b4 value decreased by f_32a3 (clamped at 0)
//   0x3b8 current message-window id   0x3ba current status picture id   0x3bc/0x3be/0x3c0/0x3c4 last drawn gauges
//   0x4cee engineer menu variant flag   0x4cf0 repair menu variant flag   0x4cf8 overload countdown
//   0xbb4[] device names   0xc32[] position names   0xce2[6] power priority order (device ids)
//   0xcee[6] power drawn per device   0xcfa[6] device power status (0 none, 1 partial, 2 full)
//   0xd06/0xd12[6] first/last component of device   0xd1e[] state (0 off, 1 powering up, 2 on, 3 powering down)
//   0xd38[] state-change timer (0 = idle)   0xd34 power-plant state   0xd4e force-complete flag
//   0xebc[] component mode   0xf24/0xf3e[] component draw (mode 2 / other)   0xf58[] component powered
//   0xb74[] multiplier for device 2's components   0xed8+0xeda power level   0xf98[] power available per level
//   0xf8c/0xf8e gauges (0..100)   0xf6e/0xf70 gauge charging flags   0xf94/0xf96 gauge step counters
//   0xf90/0xf92 state-change delay counter / limit   0xc54e..0xc552 overload limits   0xc554/0xc56c[] delays
//   0x1a28 engineer sim step counter   0x11d0 repair queue length   0xffc[] repair queue   0x1030[] queue entry -> id
//   0x1d04/0x1d0a/0x1d0c list drawing y / params
import { F } from './fn.js';
import { rw, rs, ww, i16, u16, frame, unframe } from '../rt.js';

// @32a3 decrease [0x3b4] by n, clamped at 0
function f_32a3(n) {
  const r = rs(0x3b4) - i16(n);
  ww(0x3b4, r < 0 ? 0 : r);
}
// @32bf showMessageWindow(n): opens message window n unless already shown
function f_32bf(n) {
  if (rw(0x3b8) === u16(n)) return;
  ww(0x3b8, n);
  F.f_09b7(0x18c2);
  ww(0x1d06, rw(0x190c + n * 2));
  F.f_5bf8();
}
// @32f2 showStatusPicture(n): draws picture n unless already shown
function f_32f2(n) {
  if (rw(0x3ba) === u16(n)) return;
  ww(0x3ba, n);
  F.f_70a4(rw(0x4742 + n * 2));
}
// @3318 status message sequence with a pause (0x12c ticks)
function* f_3318() {
  F.f_32f2(0);
  F.f_51d8(rw(0x192e), 7, 0x20);
  F.f_5219(rw(0x1938), 9, 0x28);
  F.f_6880(-1);
  yield* F.f_076d(0x12c);
  F.f_32bf(9);
  F.f_70a4(rw(0x3ae0));
  F.f_70a4(rw(0x817c));
  F.f_5219(rw(0x1946), 0x35, 0x20);
  F.f_5219(rw(0x4ce6), 0x37, 0x28);
}
// @3396 engineerMenu: S status, D priorities, ? redraw, C shut down, R reprioritise, E energise; ^ = back
function* f_3396() {
  F.f_342b();
  let k = 0;
  while (k !== 0x5e) {
    if (rw(0x4cee)) k = yield* F.f_0786(rw(0x148e), 0x147e, 0x2e4);
    else k = yield* F.f_0786(rw(0x19a4), 0x198e, 0x2e4);
    if (k === 0x53) yield* F.f_3462();
    else if (k === 0x44) yield* F.f_349f();
    else if (k === 0x3f) F.f_342b();
    else if (k === 0x43) yield* F.f_34dc();
    else if (k === 0x52) yield* F.f_356b();
    else if (k === 0x45) yield* F.f_3662();
  }
  F.f_022f();
  ww(0x2e4, 0);
}
// @342b drawEngineerMenu
function f_342b() {
  F.f_04c5();
  F.f_0672(rw(0x4cee) ? 0x147e : 0x198e, rw(0x2e4));
  F.f_0693();
  F.f_06bf(rw(0x19ac));
}
// @3462 engineer "S": power status display (id 4)
function* f_3462() {
  if (rw(0x2d2) === 4) return;
  F.f_06bf(rw(0x19d8));
  yield* F.f_06f4();
  F.f_0988(rw(0x2be9));
  F.f_0abc();
  F.f_36f2();
  ww(0x2d2, 4); ww(0x2d0, rw(0x1a24));
  F.f_342b();
}
// @349f engineer "D": priority display (id 9)
function* f_349f() {
  if (rw(0x2d2) === 9) return;
  F.f_06bf(rw(0x19c8));
  yield* F.f_06f4();
  F.f_0988(rw(0x2d68));
  F.f_0abc();
  F.f_3772();
  ww(0x2d2, 9); ww(0x2d0, rw(0x1a26));
  F.f_342b();
}
// @34dc engineer "C": shut down a device (on -> powering down, powering up -> off)
function* f_34dc() {
  F.f_04c5();
  F.f_0672(0x149e, rw(0x2e6));
  F.f_06bf(rw(0x19f2));
  const k = yield* F.f_0786(rw(0x14c8), 0x149e, 0x2e6);
  if (k !== 0x5e) {
    F.f_06bf(rw(0xbb4 + rw(0x2e6) * 2));
    yield* F.f_06f4();
    const si = rw(0x2e6) * 2;
    if (rs(0xd1e + si) === 2) { ww(0xd1e + si, 3); ww(0xd38 + si, 1); }
    else if (rs(0xd1e + si) === 1) { ww(0xd1e + si, 0); ww(0xd38 + si, 0); }
  }
  F.f_342b();
}
// @356b engineer "R": move a device to another position in the power priority list
function* f_356b() {
  F.f_04c5();
  F.f_0672(0x14ca, rw(0x2e8));
  F.f_06bf(rw(0x1a06));
  let k = yield* F.f_0786(rw(0x14e2), 0x14ca, 0x2e8);
  if (k !== 0x5e) {
    F.f_04c5();
    F.f_0672(0x14e4, rw(0x2ea));
    F.f_06bf(rw(0xbb4 + rw(0x2e8) * 2));
    F.f_06bf(rw(0x1a12));
    k = yield* F.f_0786(rw(0x14fc), 0x14e4, 0x2ea);
    if (k !== 0x5e) {
      F.f_06bf(rw(0xc32 + rw(0x2ea) * 2));
      yield* F.f_06f4();
      let i = 0;
      while (rw(0xce2 + i * 2) !== rw(0x2e8)) i = i16(i + 1);
      while (i < rs(0x2ea)) { ww(0xce2 + i * 2, rw(0xce4 + i * 2)); i = i16(i + 1); }
      while (i > rs(0x2ea)) { ww(0xce2 + i * 2, rw(0xce0 + i * 2)); i = i16(i - 1); }
      ww(0xce2 + rw(0x2ea) * 2, rw(0x2e8));
    }
  }
  F.f_342b();
}
// @3662 engineer "E": energise a device (off -> powering up, powering down -> on)
function* f_3662() {
  F.f_04c5();
  F.f_0672(0x149e, rw(0x2ec));
  F.f_06bf(rw(0x1a22));
  const k = yield* F.f_0786(rw(0x14c8), 0x149e, 0x2ec);
  if (k !== 0x5e) {
    F.f_06bf(rw(0xbb4 + rw(0x2ec) * 2));
    yield* F.f_06f4();
    const si = rw(0x2ec) * 2;
    if (rs(0xd1e + si) === 0) { ww(0xd1e + si, 1); ww(0xd38 + si, 1); }
    else if (rs(0xd1e + si) === 3) { ww(0xd1e + si, 2); ww(0xd38 + si, 0); }
  }
  F.f_342b();
}
// @36f2 draw the power status list (12 rows, 2 columns)
function f_36f2() {
  ww(0x1d0a, 3); ww(0x1d04, 0x88); ww(0x1d0c, 0);
  let i;
  for (i = 0; i < 8; i++) { F.f_0b7c(0x2d46, i, i, 0); ww(0x1d04, rw(0x1d04) + 8); }
  ww(0x1d04, 0x88);
  for (i = 8; i < 12; i++) { F.f_0b7c(0x2d46, i, i, 0x28); ww(0x1d04, rw(0x1d04) + 8); }
  F.f_0b7c(0x2d52, 0xc, 0, 0);
}
// @3772 draw the priority list (6 devices in priority order)
function f_3772() {
  ww(0x1d0a, 3); ww(0x1d04, 0x88); ww(0x1d0c, 0);
  for (let i = 0; i < 6; i++) { F.f_0b7c(0x2dd8, i, rw(0xce2 + i * 2), 0); ww(0x1d04, rw(0x1d04) + 8); }
}
// @37be engineerStep (6 Hz simulation): device state timers, power distribution by priority, gauges
function f_37be() {
  ww(0x1a28, rw(0x1a28) + 1);
  let maxIdx = -1, active = 0, maxT = 0, i;
  for (i = 0; i < 11; i++) {
    const a = 0xd38 + i * 2;
    if (rw(a)) {
      ww(a, rw(a) + 1); active = i16(active + 1);
      if (rs(a) > maxT) { maxT = rs(a); maxIdx = i; }
    }
  }
  const t = i16(rs(0xf90) + 1); ww(0xf90, t);
  if (t > rs(0xf92)) {
    ww(0xf90, 0); ww(0xf92, 0);
    if (rw(0xd4e)) maxIdx = 0xb;
    if (maxIdx >= 0) {
      const si = maxIdx * 2;
      ww(0xd38 + si, 0);
      ww(0xd1e + si, rs(0xd1e + si) === 1 ? 2 : 0);
      ww(0xf92, rw(0x4cf8) ? rw(0xc56c + si) : rw(0xc554 + si));
    }
  }
  let level = i16(rw(0xed8) + rw(0xeda));
  if (rs(0xd34) > 1 && rw(0xf8e)) level = i16(level + 2);
  let budget = rs(0xf98 + level * 2), total = 0;
  for (i = 0; i < 6; i++) {
    const dev = rs(0xce2 + i * 2), d2 = dev * 2;
    ww(0xcfa + d2, 0);
    let j = rs(0xd06 + d2), sum = 0;
    while (j <= rs(0xd12 + d2)) {
      const j2 = j * 2;
      let cost = 0;
      if ((rs(0xd1e + j2) > 1 && rw(0xebc + j2)) || dev === 4)
        cost = rs(0xebc + j2) === 2 ? rs(0xf24 + j2) : rs(0xf3e + j2);
      if (dev === 2) {
        if (rw(0xb74 + j2)) cost = i16(cost * rs(0xb74 + j2));
        else if (cost) cost = 0x28;
      }
      const nb = budget - cost; budget = i16(nb);
      if (nb >= 0 && cost) { ww(0xf58 + j2, 1); ww(0xcfa + d2, 2); }
      else if (cost) { ww(0xf58 + j2, 0); if (rs(0xcfa + d2) === 2) ww(0xcfa + d2, rw(0xcfa + d2) - 1); }
      else ww(0xf58 + j2, 0);
      sum = i16(sum + cost); j = i16(j + 1);
    }
    ww(0xcee + d2, sum);
    total = i16(total + sum);
  }
  if (rw(0xf6e)) {
    const c = rs(0xf94); ww(0xf94, c - 1);
    if (c <= 0) { ww(0xf94, 5); if (rs(0xf8e) < 100) ww(0xf8e, rw(0xf8e) + 1); }
  }
  if (rs(0xd34) > 1 && rw(0xf8e) && budget < rs(0xf9c)) ww(0xf8e, rw(0xf8e) - 1);
  if (rw(0xf70)) {
    const c = rs(0xf96); ww(0xf96, c - 1);
    if (c <= 0) { ww(0xf96, 2); if (rs(0xf8c) < 100) ww(0xf8c, rw(0xf8c) + 1); }
  }
  if (rw(0x4cee)) {
    if (rw(0xeea) === 1 || active > rs(0xc550) || i16(total - rw(0xf98 + level * 2)) > rs(0xc552)) ww(0x4cf8, rw(0xc54e));
    else if (rw(0x4cf8)) ww(0x4cf8, rw(0x4cf8) - 1);
  }
  if (level !== rs(0x3be)) {                      // power level gauge (6 segments)
    ww(0x48e8, 0x70); ww(0x48fc, 0x61); ww(0x3be, level);
    for (i = 0; i < level; i++) { F.f_70a4(0x48e0); ww(0x48e8, rw(0x48e8) + 4); }
    ww(0x48fa, rw(0x48e8));
    for (; i < 6; i++) { F.f_70a4(0x48f2); ww(0x48fa, rw(0x48fa) + 4); }
  }
  let bars = Math.trunc(total / 300);
  if (bars > 8) bars = 8;
  if (bars !== rs(0x3bc)) {                       // power drawn gauge (8 segments)
    ww(0x490c, 0x70); ww(0x48fc, 0x5a); ww(0x3bc, bars);
    for (i = 0; i < bars; i++) { F.f_70a4(0x4904); ww(0x490c, rw(0x490c) + 4); }
    ww(0x48fa, rw(0x490c));
    for (; i < 8; i++) { F.f_70a4(0x48f2); ww(0x48fa, rw(0x48fa) + 4); }
  }
  let s;
  if (rw(0xd34) === 0) s = 0;
  else if (rs(0xf8e) > 0x14) s = 1;
  else if (rw(0xf8e) === 0 || (rw(0x1a28) & 1)) s = 2;
  else s = 0;
  if (s !== rs(0x3c4)) { ww(0x3c4, s); F.f_70a4(rw(0x4915 + s * 2)); }
  const c = rs(0xf8c);
  s = (c > 0x14 || (c !== 0 && (rw(0x1a28) & 1))) ? 1 : 0;
  if (s !== rs(0x3c0)) { ww(0x3c0, s); F.f_70a4(rw(0x49e7 + s * 2)); }
}
// @3be5 repairMenu: S/D displays, ? redraw, C/R/A queue commands (or S, ?, F in the other variant); ^ = back
function* f_3be5() {
  F.f_3c96();
  let k;
  if (rw(0x4cf0)) {
    for (;;) {
      k = yield* F.f_0786(rw(0x1516), 0x1506, 0x2ee);
      if (k === 0x5e) break;
      if (k === 0x53) yield* F.f_3ccd();
      else if (k === 0x44) yield* F.f_3d10();
      else if (k === 0x3f) F.f_3c96();
      else if (k === 0x43) yield* F.f_3d53();
      else if (k === 0x52) yield* F.f_3dd4();
      else if (k === 0x41) yield* F.f_3f29();
    }
  } else {
    for (;;) {
      k = yield* F.f_0786(rw(0x1a4a), 0x1a3a, 0x2ee);
      if (k === 0x5e) break;
      if (k === 0x53) yield* F.f_3ccd();
      else if (k === 0x3f) F.f_3c96();
      else if (k === 0x46) yield* F.f_408f();
    }
  }
  F.f_022f();
  ww(0x2ee, 0);
}
// @3c96 drawRepairMenu
function f_3c96() {
  F.f_04c5();
  F.f_0672(rw(0x4cf0) ? 0x1506 : 0x1a3a, rw(0x2ee));
  F.f_0693();
  F.f_06bf(rw(0x1a52));
}
// @3ccd repair "S": repair queue display (id 5)
function* f_3ccd() {
  if (rw(0x2d2) === 5) return;
  F.f_06bf(rw(0x1a62));
  yield* F.f_06f4();
  F.f_0988(rw(0x2df8));
  F.f_0abc();
  ww(0x2d4, 0);
  F.f_412f();
  ww(0x2d2, 5); ww(0x2d0, rw(0x1b52));
  F.f_3c96();
}
// @3d10 repair "D": display id 10
function* f_3d10() {
  if (rw(0x2d2) === 0xa) return;
  F.f_06bf(rw(0x1a78));
  yield* F.f_06f4();
  F.f_0988(rw(0x2eda));
  F.f_0abc();
  ww(0x2d4, 0);
  F.f_4230();
  ww(0x2d2, 0xa); ww(0x2d0, rw(0x1b54));
  F.f_3c96();
}
// @3d53 repair "C": pick a queued item and cancel it (f_42e4)
function* f_3d53() {
  F.f_05f3(0xbb4, 0x1030, 0xffc, rw(0x11d0));
  const p = frame(2);
  try {
    ww(p, 0);
    F.f_04c5();
    F.f_0672(0x2fa, rw(p));
    F.f_06bf(rw(0x1a9a));
    const k = yield* F.f_0786(0x32e, 0x2fa, p);
    if (k !== 0x5e) {
      const v = rw(0x348 + rw(p) * 2);
      F.f_06bf(rw(0xbb4 + v * 2));
      yield* F.f_06f4();
      F.f_42e4(v);
    }
    F.f_3c96();
  } finally { unframe(2); }
}
// @3dd4 repair "R": move a queued item to another queue position
function* f_3dd4() {
  F.f_05f3(0xbb4, 0x1030, 0xffc, rw(0x11d0));
  const a = frame(4), b = a + 2;
  try {
    ww(a, 0);
    F.f_04c5();
    F.f_0672(0x2fa, rw(a));
    F.f_06bf(rw(0x1aa8));
    let k = yield* F.f_0786(0x32e, 0x2fa, a);
    if (k !== 0x5e) {
      let e = rw(0x348 + rw(a) * 2);
      ww(b, 0);
      F.f_058e(0xc32, rw(0x11d0));
      F.f_04c5();
      F.f_0672(0x2fa, rw(b));
      F.f_06bf(rw(0xbb4 + e * 2));
      F.f_06bf(rw(0x1ab4));
      k = yield* F.f_0786(0x32e, 0x2fa, b);
      if (k !== 0x5e) {
        F.f_06bf(rw(0xc32 + rw(b) * 2));
        yield* F.f_06f4();
        let i = 0;
        do { if (rw(0x1030 + rw(0xffc + i * 2) * 2) === e) break; i = i16(i + 1); } while (i < rs(0x11d0));
        if (i < rs(0x11d0)) {
          e = rw(0xffc + i * 2);
          while (i < rs(b)) { ww(0xffc + i * 2, rw(0xffe + i * 2)); i = i16(i + 1); }
          while (i > rs(b)) { ww(0xffc + i * 2, rw(0xffa + i * 2)); i = i16(i - 1); }
          ww(0xffc + rw(b) * 2, e);
        }
      }
    }
    F.f_3c96();
  } finally { unframe(4); }
}
// @3f29 repair "A": add a repair job (pick item, then queue position) via f_43a2; max 8 jobs
function* f_3f29() {
  const p8 = frame(4), pA = p8 + 2;
  try {
    if (rs(0x11d0) >= 8) {
      F.f_06bf(rw(0x1aea));
      yield* F.f_06f4();
    } else {
      F.f_04c5();
      F.f_0672(0x1b34, rw(0x1b18));
      F.f_06bf(rw(0x1abe));
      let k = yield* F.f_0786(rw(0x1b50), 0x1b34, 0x1b18);
      if (k !== 0x5e) {
        F.f_04eb(0xbb4, 0x1168, 0x1a);
        let i = 0;
        while (i < 0x1a && !(rs(0x37c + i * 2) >= 0 && rw(0x1098 + i * 2) === 0)) i = i16(i + 1);
        ww(p8, rw(0x37c + i * 2));
        F.f_06bf(rw(0xc32 + rw(0x1b18) * 2));
        F.f_06bf(rw(0x1ad0));
        F.f_04c5();
        F.f_0672(0x2fa, rw(p8));
        k = yield* F.f_0786(0x32e, 0x2fa, p8);
        if (k !== 0x5e) {
          const c = rw(0x348 + rw(p8) * 2);
          F.f_06bf(rw(0xbb4 + c * 2));
          F.f_058e(0xc32, i16(rw(0x11d0) + 1));
          F.f_06bf(rw(0x1ad6));
          F.f_04c5();
          ww(pA, rw(0x11d0));
          F.f_0672(0x2fa, rw(0x11d0));
          k = yield* F.f_0786(0x32e, 0x2fa, pA);
          if (k !== 0x5e) {
            F.f_06bf(rw(0xc32 + rw(pA) * 2));
            yield* F.f_06f4();
            F.f_43a2(c, i16(rw(0x1b18) + 1), rw(pA));
          }
        }
      }
    }
    F.f_3c96();
  } finally { unframe(4); }
}
// @408f repair "F": cancel all queued jobs, then queue the picked item (F.f_43a2(item, 7, 0))
function* f_408f() {
  F.f_04c5();
  F.f_06bf(rw(0x1aec));
  F.f_04eb(0xbb4, 0x1168, 0x1a);
  const p = frame(2);
  try {
    ww(p, 0);
    F.f_04c5();
    F.f_0672(0x2fa, rw(p));
    const k = yield* F.f_0786(0x32e, 0x2fa, p);
    if (k !== 0x5e) {
      const v = rw(0x348 + rw(p) * 2);
      F.f_06bf(rw(0xbb4 + v * 2));
      yield* F.f_06f4();
      while (rw(0x11d0)) F.f_42e4(rw(0x1030 + rw(0xffc) * 2));
      F.f_43a2(v, 7, 0);
    }
    F.f_3c96();
  } finally { unframe(2); }
}
// @412f draw the repair queue list (16 rows, 2 columns; empty rows via f_0b08; "queue empty" message)
function f_412f() {
  ww(0x1d0a, 3); ww(0x1d0c, 0);
  F.f_0b7c(0x2eb0, 0x10, 0, 0);
  ww(0x1d04, 0x88);
  if (rw(0x2d4) && rw(0x11d2)) { F.f_0b61(0, 0x28); ww(0x2d4, 0); }
  let i = 0, x = 0, n = 0;
  for (; i < 0x1a; i++) {
    if (rs(0x1030 + i * 2) < 0) continue;
    F.f_0b7c(0x2e7c, n, i, x);
    ww(0x1d04, rw(0x1d04) + 8);
    n = i16(n + 1);
    if (n === 8) { ww(0x1d04, 0x88); x = 0x28; }
    if (n >= 0x10) break;
  }
  while (n < 0x10) {
    F.f_0b08(n, i16(x + 2), 0x26);
    ww(0x1d04, rw(0x1d04) + 8);
    n = i16(n + 1);
    if (n === 8) { ww(0x1d04, 0x88); x = 0x28; }
  }
  if (rw(0x11d2) === 0 && rw(0x2d4) === 0) { ww(0x2d4, 1); F.f_0d6b(8, 0x88, rw(0x1afc)); }
}

Object.assign(F, { f_32a3, f_32bf, f_32f2, f_3318, f_3396, f_342b, f_3462, f_349f, f_34dc, f_356b, f_3662, f_36f2,
  f_3772, f_37be, f_3be5, f_3c96, f_3ccd, f_3d10, f_3d53, f_3dd4, f_3f29, f_408f, f_412f });
