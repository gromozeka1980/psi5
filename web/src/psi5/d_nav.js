// Navigator department: course/speed menus (UI) plus two simulation steps run from the 6 Hz loop:
// f_243d (pirate/contact spawning and per-contact counters) and f_2cf2 (engine power, speed, route change, travel).
// DS globals (best guesses from the code):
//   0x2d0 redraw fn ptr of the department panel   0x2d2 panel shown (3 = route map, 8 = route order)
//   0x2dc nav menu selection   0x2de route menu sel   0x2e0 speed menu sel   0x2e2 maneuver menu sel
//   0x3b2 gameOver flag   0x3b6 elapsed time (minutes?)   0x3c2 current alarm/engine sound (0/1)
//   0x4cec player crew on navigator (else auto/limited menu)   0x4cea ? mode flag   0x4cf4/0x4cf6 "danger" flags (index 0/1)
//   0x59e[26] contact type (0 = free slot)  0x5d2/0x606/0x66e/0x6a2/0x6d6/0x70a/0x73e/0x772/0x7a6/0x7da/0x80e/0x842/
//   0x876/0x8aa/0x8de/0x912/0x946 per-contact arrays [26]   0x876 spawn position   0x8de contact in list
//   0x97a[] active contact list, 0x9d4 its length   0x9d2 contacts spawned   0x9da last used slot   0x9ca[4] slot per sector
//   0x9d6/0x9d8 last position/route seen   0x12e2 spawn mask   0x12e4 spawn counter (0..15)   0x12e6 spawn tries left
//   0x17d8 sim step counter (contacts)   0x17da danger timer
//   0xaf0[5] route order   0xb04[5] route threat estimate   0xb0e/0xb18/0xafa[5] route ETA values
//   0xb60 current route   0xb62 requested route   0xb64 nav state (0..3)   0xb66 maneuver   0xb68 speed
//   0xb6a requested speed   0xb6c ETA status   0xb6e maneuver anim index   0xb76/0xb78 sub-position fraction
//   0xb7a position along route (0..50, 50 = arrived)   0xb7c route change pending   0xb7e evasive pending
//   0xb80 threat report pending   0xb82 threat estimate valid   0xb84[2] engine power used per engine
//   0x18ac last speed reported (sound)   0x18ae scratch: power / speed / delta   0x18b0 sim step counter (nav)
//   0x18b2 tick counter (60 → 1 minute)   0x18b4 messages counter   0x18b6 route scanned   0x18b8 scan timer
//   0x18ba route change progress   0x18bc scan length   0x18be time of last progress   0x18c0 timer for 0x3b00
import { F } from './fn.js';
import { rw, rs, ww, i16 } from '../rt.js';

// @23df removeContact(n): remove contact n from the active list 0x97a (if it is in it)
function f_23df(n) {
  if (rw(0x8de + n * 2) === 0) return;
  let j = 0;
  while (rw(0x97a + j * 2) !== u(n)) j = i16(j + 1);
  ww(0x8de + n * 2, 0);
  ww(0x9d4, rw(0x9d4) - 1);
  for (; j < rs(0x9d4); j = i16(j + 1)) ww(0x97a + j * 2, rw(0x97c + j * 2));
}
const u = v => v & 0xffff;

// @243d contactsStep(): spawn contacts along the route, update per-contact counters, danger timer and alarm sound
function f_243d() {
  ww(0x17d8, rw(0x17d8) + 1);
  if (rw(0xb7a) !== rw(0x9d6) || rw(0xb60) !== rw(0x9d8)) {
    const ax = rw(0xb7a), bx = rw(0xb60);
    ww(0xb80, 1); ww(0x9d8, bx);
    const si = rw(0x6150 + bx * 2);
    ww(0x9d6, ax);
    ww(0x12e2, rw(si + ax * 2));
    const r = F.f_7086();
    ww(0x12e6, 0x10); ww(0x12e4, r);
  }
  if (rs(0x9d2) < 0x10 && (rw(0x17d8) & 1) && rw(0x12e6) !== 0) {
    const a = (rw(0x12e4) + 1) & 0xf;
    ww(0x12e4, a);
    if (rw(0x98a + a * 2) & rw(0x12e2)) {
      if (rw(0x9d2) === 0) { F.f_6526(0x21a); F.f_64be(0x216); }
      ww(0x9d2, rw(0x9d2) + 1);
      do {
        const x = i16(rw(0x9da) + 1);
        ww(0x9da, x);
        if (!(x < 0x1a)) ww(0x9da, 0);
      } while (rw(0x59e + rw(0x9da) * 2) !== 0);
      let s = rw(0x9da) * 2;
      ww(0x59e + s, rw(0x9aa + rw(0x12e4) * 2));
      ww(0x6d6 + s, F.f_7086() & 3);
      s = rw(0x9da) * 2;
      for (const b of [0x6a2, 0x8de, 0x842, 0x606, 0x70a, 0x772, 0x80e, 0x5d2, 0x66e, 0x7a6, 0x63a]) ww(b + s, 0);
      ww(0x73e + s, 8);
      ww(0x876 + s, rw(0xb7a));
      ww(0x7da + s, (F.f_7086() & 3) + 1);
    }
    ww(0x12e6, rw(0x12e6) - 1);
  }
  for (let i = 0; i < 0x1a; i++) {
    const s = i * 2, t = rw(0x59e + s);
    if (!t) continue;
    if (i16(rw(0xb7a) - rw(0x876 + s)) >= rs(0x6252 + t * 2)) continue;
    if ((rw(0x73e + s) & 1) && rs(0xb68) > 6) continue;
    if (rw(0x946 + s) || rw(0x70a + s)) continue;
    const k = rw(0x6d6 + s) * 2;
    if (rs(0x9ca + k) >= 0) continue;
    ww(0x9ca + k, i);
  }
  let cnt = 0, f20 = 0, f22 = 0, f24 = 0;
  const lvl = () => rw(0x4cf4) * 2;
  for (let i = 0; i < rs(0x9d4); i++) {
    const s = rw(0x97a + i * 2) * 2;
    if (rw(0x6a2 + s) === 0) {
      cnt++;
      if (rw(0xed6) === 2) {
        const b = i16(rw(0x66e + s) + 1); ww(0x66e + s, b);
        if (b >= rs(0x9e90 + lvl())) ww(0x6a2 + s, 1);
      }
    }
    if (rw(0x4cea) && rw(0xed0) && rw(0xf6c)) {
      if (rw(0x606 + s) === 0) {
        cnt++;
        if (f20 === 0) {
          f20++;
          const b = i16(rw(0x5d2 + s) + 1); ww(0x5d2 + s, b);
          if (b >= rs(0x9e94 + lvl())) ww(0x606 + s, rw(0x59e + s));
        }
      }
      if (rw(0x7a6 + s) === 0) {
        cnt++;
        if (f22 === 0) {
          f22++;
          const b = i16(rw(0x772 + s) + 1); ww(0x772 + s, b);
          if (b >= rs(0x9e98 + lvl())) ww(0x7a6 + s, rw(0x73e + s));
        }
      } else ww(0x7a6 + s, rw(0x73e + s));
      if (rw(0x842 + s) === 0) {
        cnt++;
        if (f24 === 0) {
          f24++;
          const b = i16(rw(0x80e + s) + 1); ww(0x80e + s, b);
          if (b >= rs(0x9e9c + lvl())) ww(0x842 + s, rw(0x7da + s));
        }
      }
    } else cnt++;
  }
  if (rw(0x9dc) === 0 && cnt === 0 && rw(0x3508) === 0) {
    F.f_6526(0x21c); F.f_64be(0x21a);
    ww(0x9dc, rw(0x9dc) + 1);
  }
  if (rw(0x4cea)) {
    if (rw(0x9de)) ww(0x9de, rw(0x9de) - 1);
    if (rw(0x9d4)) ww(0x9de, rw(0x9ea6 + lvl()));
    if (rw(0x9de) === 0 && rw(0x9d2)) {
      for (let i = 0; i < 0x1a; i++) {
        const s = i * 2;
        if (rw(0x59e + s) && !rw(0x6a2 + s)) {
          F.f_232b(i, 1);
          if (rw(0x3508) === 0) { F.f_6526(0x216); F.f_64be(0x21c); }
          break;
        }
      }
    }
  }
  if (rw(0x9d2)) {
    for (let i = 0; i < 0x1a; i++) {
      const s = i * 2;
      if (!rw(0x59e + s)) continue;
      if (rw(0x17d8) & 1) ww(0x8aa + s, rw(0x8de + s) ? 1 : 0);
      else ww(0x8aa + s, rw(0x912 + s) ? 2 : 0);
    }
  }
  if (rw(0x4cea)) {
    if (rw(0x17da)) ww(0x17da, rw(0x17da) - 1); else ww(0x4cf4, 0);
    if (rs(0x9d2) >= rs(0x9ea2) || rs(0x9d4) >= rs(0x9ea4)) { ww(0x4cf4, 1); ww(0x17da, rw(0x9ea0)); }
  }
  const e = rw(0xed0);
  let v = (e === 2 || (e === 1 && (rw(0x17d8) & 1))) ? 1 : 0;
  if (!rw(0xf6c)) v = 0;
  if (rw(0x3c2) !== v) { ww(0x3c2, v); F.f_70a4(rw(0x4a0b + v * 2)); }
  if (!rw(0x9d2)) F.f_6526(0x216);
  for (let i = 0; i < 0x1a; i++) {
    const s = i * 2;
    if (rs(0x59e + s) < 8 && !rw(0x63a + s) && i16(rw(0x876 + s) + rw(0x6292)) < rs(0xb7a)) ww(0x63a + s, 1);
  }
}

// @295d navigatorMenu(): Navigator department main loop (full menu with crew, reduced menu without)
function* f_295d() {
  f_2a1c();
  if (rw(0x4cec)) {
    for (;;) {
      const k = yield* F.f_0786(rw(0x13ee), 0x13d6, 0x2dc);
      if (k === 0x5e) break;
      if (k === 0x53) yield* F.f_2a53();
      else if (k === 0x44) yield* F.f_2a90();
      else if (k === 0x3f) f_2a1c();
      else if (k === 0x43) yield* F.f_2acd();
      else if (k === 0x52) yield* F.f_2ae7();
      else if (k === 0x41) yield* F.f_2b90();
    }
  } else {
    for (;;) {
      const k = yield* F.f_0786(rw(0x180a), 0x17f8, 0x2dc);
      if (k === 0x5e) break;
      if (k === 0x53) yield* F.f_2a53();
      else if (k === 0x3f) f_2a1c();
      else if (k === 0x52) yield* F.f_2ae7();
      else if (k === 0x41) yield* F.f_2b90();
    }
  }
  F.f_022f();
  ww(0x2dc, 0);
}

// @2a1c navRedraw(): clear the text area, draw the nav menu and its prompt
function f_2a1c() {
  F.f_04c5();
  F.f_0672(rw(0x4cec) ? 0x13d6 : 0x17f8, rw(0x2dc));
  F.f_0693();
  F.f_06bf(rw(0x1812));
}

// @2a53 showRouteMap(): switch the panel to the route map (panel 3)
function* f_2a53() {
  if (rw(0x2d2) === 3) return;
  F.f_06bf(rw(0x1822));
  yield* F.f_06f4();
  F.f_0988(rw(0x2a52));
  F.f_0abc();
  f_2c51();
  ww(0x2d2, 3); ww(0x2d0, rw(0x18a6));
  f_2a1c();
}

// @2a90 showRouteOrder(): switch the panel to the route order list (panel 8)
function* f_2a90() {
  if (rw(0x2d2) === 8) return;
  F.f_06bf(rw(0x183e));
  yield* F.f_06f4();
  F.f_0988(rw(0x2b7e));
  F.f_0abc();
  f_2ca6();
  ww(0x2d2, 8); ww(0x2d0, rw(0x18a8));
  f_2a1c();
}

// @2acd cancelManeuver()
function* f_2acd() {
  F.f_06bf(rw(0x185c));
  yield* F.f_06f4();
  ww(0xb66, 0);
  f_2a1c();
}

// @2ae7 chooseRoute(): route menu; the chosen route moves to the front of the route order and is requested
function* f_2ae7() {
  F.f_04c5();
  F.f_0672(0x13fa, rw(0x2de));
  F.f_06bf(rw(0x1874));
  const k = yield* F.f_0786(rw(0x1410), 0x13fa, 0x2de);
  if (k !== 0x5e) {
    F.f_06bf(rw(0xbb4 + rw(0x2de) * 2));
    F.f_06bf(rw(0x1880));
    yield* F.f_06f4();
    let j = 4;
    while (rw(0xaf0 + j * 2) !== rw(0x2de)) j = i16(j - 1);
    j = i16(j + 1);
    for (;;) {                                    // quirk: last step copies 0xaee into 0xaf0 (overwritten below)
      const o = j; j = i16(j - 1);
      if (o === 0) break;
      ww(0xaf0 + j * 2, rw(0xaee + j * 2));
    }
    const r = rw(0x2de);
    ww(0xb7c, 1); ww(0xb62, r); ww(0xaf0, r);
  }
  f_2a1c();
}

// @2b90 chooseSpeed(): speed menu, then (with crew, unless S) the maneuver menu
function* f_2b90() {
  F.f_04c5();
  F.f_0672(0x1428, rw(0x2e0));
  F.f_06bf(rw(0x1896));
  let k = yield* F.f_0786(rw(0x144a), 0x1428, 0x2e0);
  if (k !== 0x5e) {
    F.f_04c5();
    F.f_0672(0x1468, rw(0x2e2));
    F.f_06bf(rw(0xc46 + rw(0x2e0) * 2));
    if (k === 0x53 || !rw(0x4cec)) {
      yield* F.f_06f4();
      ww(0xb66, 0); ww(0xb6a, rw(0x2e0));
    } else {
      k = yield* F.f_0786(rw(0x1474), 0x1468, 0x2e2);
      if (k !== 0x5e) {
        if (k === 0x45) { F.f_06bf(rw(0x18a4)); ww(0xb7e, 1); }
        yield* F.f_06f4();
        ww(0xb6a, rw(0x2e0)); ww(0xb66, rw(0x2e2));
      }
    }
  }
  f_2a1c();
}

// @2c51 drawRouteMap(): route map panel (background + 5 routes)
function f_2c51() {
  ww(0x1d0a, 3); ww(0x1d0c, 0);
  F.f_0b7c(0x2b02, 5, 0, 0);
  ww(0x1d04, 0xa0);
  for (let i = 0; i < 5; i++) { F.f_0b7c(0x2b4a, i, i, 0); ww(0x1d04, rw(0x1d04) + 8); }
}

// @2ca6 drawRouteOrder(): route order panel (5 lines from 0xaf0)
function f_2ca6() {
  ww(0x1d0a, 3); ww(0x1d04, 0x88); ww(0x1d0c, 0);
  for (let i = 0; i < 5; i++) { F.f_0b7c(0x2bdd, i, rw(0xaf0 + i * 2), 0); ww(0x1d04, rw(0x1d04) + 8); }
}

// @2cf2 navStep(): engine power → speed, route change, travel along the route, threat scan, ETAs
function* f_2cf2() {
  ww(0x18b0, rw(0x18b0) + 1);
  ww(0x18ae, 0);
  if (rw(0xf68)) ww(0x18ae, rw(0x18ae) + rw(0xb84));
  if (rw(0xf6a)) ww(0x18ae, rw(0x18ae) + rw(0xb86));
  if (rs(0xb68) > rs(0x18ae)) ww(0xb68, rw(0xb68) - 1); else ww(0xb68, rw(0x18ae));
  if (i16(rw(0xb68) - rw(0x18ac)) > 2) { ww(0x18ac, rw(0xb68)); F.f_6de0(0x12); }
  else if (i16(rw(0xb68) - rw(0x18ac)) < -2) { ww(0x18ac, rw(0xb68)); F.f_6de0(0x14); }
  ww(0x18ae, rw(0xb68));
  if (rs(0xb68) < rs(0xb6a)) ww(0x18ae, rw(0x18ae) + 1);
  else if (rs(0x18ae) > rs(0xb6a)) ww(0x18ae, rw(0x18ae) - 1);
  if (rw(0xecc) === 2) { F.f_322f(0); F.f_322f(1); } else { F.f_322f(1); F.f_322f(0); }
  let a = i16(rw(0x18b2) + 1); ww(0x18b2, a);
  if (a >= 0x3c) {
    ww(0x18b2, 0);
    a = i16(rw(0x3b6) + 1); ww(0x3b6, a);
    if (a > rs(0x622d)) {
      F.f_32a3(1);
      a = i16(rw(0x18b4) + 1); ww(0x18b4, a);
      if (a >= 8) { F.f_64be(0x218); ww(0x18b4, 0); }
    }
  }
  ww(0x18ae, rw(0xb68));
  if (rw(0xb68) === 0) { ww(0xb64, 2); ww(0x18be, rw(0x3b6)); }
  else {
    ww(0xb6e, 0); ww(0xb64, 0);
    const bx = rw(0xb60), cx = rw(0xb62);
    if (cx !== bx) {
      if (rs(0xb22 + cx * 2) < rs(0xb22 + bx * 2)) {
        const e = rw(0xee4);
        if (e) {
          if (e === 2 || (rw(0x18b0) & 1)) ww(0x18ba, rw(0x18ba) - 1);
          if (rs(0x18ba) <= rs(0xb1d8)) ww(0xb60, rw(0xb62)); else { ww(0xb64, 3); ww(0xb6e, 2); }
        } else if (rw(0xb7c)) F.f_64be(0x404);
      } else {
        const e = rw(0xee2);
        if (e) {
          if (e === 2 || (rw(0x18b0) & 1)) ww(0x18ba, rw(0x18ba) + 1);
          if (rs(0x18ba) >= rs(0xb1da)) ww(0xb60, rw(0xb62)); else { ww(0xb64, 3); ww(0xb6e, 1); }
        } else if (rw(0xb7c)) F.f_64be(0x406);
      }
      ww(0xb7c, 0);
    } else if (rw(0xb66) === 1) {
      if (rw(0xee2) === 2 && rw(0xee4) === 2) {
        if (rw(0xb7e)) F.f_64be(0x40a);
        ww(0xb64, 1);
        ww(0xb6e, rw(0xb20a + (rw(0x18b0) & 0x1f) * 2));
        ww(0x18ae, rw((rw(0x4cf6) ? 0xb1f0 : 0xb1de) + rw(0xb68) * 2));
      } else if (rw(0xb7e)) F.f_64be(0x402);
      ww(0xb7e, 0);
    }
  }
  if (rw(0xb64) !== 3 && rw(0x18ae) !== 0) {
    const idx = rw(0x6288 + rw(0xb60) * 2) + rw(0x18ae);
    a = i16(rw(0xb76) + rw(0xb46 + idx * 2)); ww(0xb76, a);
    if (a >= 0x100) {
      const b = i16(rw(0xb78) + (a >> 8));
      ww(0xb76, rw(0xb76) & 0xff); ww(0xb78, b);
      if (b >= 0x100) {
        ww(0xb78, rw(0xb78) - 0x100);
        a = i16(rw(0xb7a) + 1); ww(0xb7a, a); ww(0x18be, rw(0x3b6));
        if (a >= 0x32) { ww(0x3b2, 1); yield* F.f_3318(); F.f_6db1(0xe); }
      }
    }
  }
  a = i16(rw(0x18b8) + 1); ww(0x18b8, a);
  if (a >= rs(0xb204 + rw(0x4cf6) * 2)) {
    ww(0x18b8, 0);
    if (rw(0x4cec) && rw(0xf6c) && rw(0xd32) && rw(0xed0)) {
      ww(0xb82, 1);
      a = i16(rw(0x18b6) + 1); ww(0x18b6, a);
      if (a >= 5) ww(0x18b6, 0);
      const rem = i16(0x32 - rw(0xb7a));
      ww(0x18bc, rs(0xb202) > rem ? rem : rw(0xb202));
      let p = rw(0x6150 + rw(0x18b6) * 2) + rw(0xb7a) * 2, sum = 0;
      for (let j = 0; j <= rs(0x18bc); j++) { sum = i16(sum + F.f_5b3a(rw(p))); p += 2; }
      if (rw(0x18b6) === rw(0xb60) && rw(0xb80) && rs(0xb78) > 0x80) {
        ww(0xb80, 0);
        if (sum > rs(0xb24a)) F.f_64be(0x408); else F.f_6526(0x408);
      }
      ww(0xb04 + rw(0x18b6) * 2, sum);
    } else {
      for (let j = 0; j < 5; j++) ww(0xb04 + j * 2, 0);
      ww(0xb82, 0);
    }
  }
  for (let j = 0; j < 5; j++) {
    const s = j * 2, cx = i16(0x32 - rw(0xb7a));
    let d = i16(rw(0x6288 + s) + 1);
    ww(0xb0e + s, i16(Math.trunc(i16(Math.imul(rs(0xb2c + d * 2), cx)) / d) + 3) >> 2);
    if (rw(0x18ae)) {
      d = i16(rw(0x6288 + s) + rw(0x18ae));
      ww(0xb18 + s, i16(Math.trunc(i16(Math.imul(cx, rs(0xb2c + d * 2))) / d) + 0xf) >> 4);
      ww(0xafa + s, rw(0x18be) + rw(0xb18 + s) - rw(0x622d));
    } else { ww(0xb18 + s, 0); ww(0xafa + s, 0); }
  }
  if (rw(0x3afe)) { if (rw(0x18c0)) ww(0x18c0, rw(0x18c0) - 1); else ww(0x3b00, 0); }
  else ww(0x18c0, 0x1e);
  if (rw(0x18ae) === 0) ww(0xb6c, 0);
  else ww(0xb6c, rs(0xafa + rw(0xb60) * 2) > 0 ? 2 : 1);
  if (rw(0x4cec)) {
    if (rw(0x18aa)) ww(0x18aa, rw(0x18aa) - 1); else ww(0x4cf6, 0);
    if (!rw(0xeea) || rw(0xb6c) === 2) { ww(0x4cf6, 1); ww(0x18aa, rw(0xb1dc)); }
  }
  const s = rw(0xb6e) * 2;
  ww(0x4608, rw(0x195a + s)); ww(0x4606, rw(0x1948 + s));
  if (!rw(0x3b2)) F.f_32bf(rw(0xb68));
  F.f_32f2(rw(0xb6e));
}

// @322f enginePower(n): power used by engine n = min(remaining demand 0x18ae, its capacity); subtract from 0x18ae
function f_322f(n) {
  const s = n * 2;
  if (rw(0xd2e + s) && rw(0xf68 + s)) {
    const cx = rs(0xb70 + rw(0xecc + s) * 2);
    ww(0xb84 + s, rs(0x18ae) <= cx ? rw(0x18ae) : cx);
    ww(0x18ae, rw(0x18ae) - rw(0xb84 + s));
  } else ww(0xb84 + s, 0);
}

Object.assign(F, { f_23df, f_243d, f_295d, f_2a1c, f_2a53, f_2a90, f_2acd, f_2ae7, f_2b90, f_2c51, f_2ca6, f_2cf2, f_322f });
