// PSI5.EXE — repair department and ship damage simulation (0x4230..0x51d7).
// The repair officer keeps a queue of damaged systems (up to 8 shown); each queue slot gets a number of repair droids
// assigned; droids work off the slot's damage counter. f_4922 (6 Hz) applies incoming hits, handles the alarm,
// game-over checks and the pirate "special" hit effects; f_4479 runs the repair crew.
// DS globals:
//   0x0ebc[] system state (2 ok, 1 damaged, 0 disabled)   0x0ef0[] system destroyed   0x0f58[] system hit-able/active
//   0x0f8c shield energy (absorbs hits)   0x0d1e[] system flag (selects damage table 0xd8b4 vs 0xd8e8)
//   0x0fc4[7] droid destroyed   0x0fd2[7] droid recharge countdown   0x0fe0[7] droid out of action   0x0fee[7] droid busy
//   0x0ffc[] repair queue (slot numbers)   0x11d0 queue length   0x11d2 number of open repair slots
//   0x1030[26] slot id (= slot, -1 free)   0x1064[26] droids assigned   0x1098[26] droids requested
//   0x10cc[26] system in slot (-1 free)   0x1100[26] blink flag   0x1134[26] being worked on
//   0x1168[26] damage left   0x119c[26] work accumulator (256 = 1 damage point)   0x11d4 auto-queue delay
//   0x11d6/0x11d8/0x11da/0x11dc droids idle / recharging / busy / out of action (display counts)
//   0x11de[]/0x1212[]/0x1246[] per-system status message ids (damaged / disabled / destroyed)
//   0x1288[5] pending hits (index into 0x1292 = target system)   0x129c[] hit kind thresholds (random 0..)
//   0x12d6[] per-system special action   0x12de/0x12e0 countdowns (dept 8/7 failure)   0x12fc next free slot search
//   0x12fe alarm countdown   0x1300 alarm showing   0x132a/0x132c systems disabled/destroyed counters
//   0x1b56 repair tick   0x1b58 overload countdown   0x1b5a damage tick   0x2d4 "queue empty" picture shown
//   0x3b2 game over   0x3ce[4] shown state of systems 0..3   0x4cfa droid overload flag (index into 0xd89c)
//   0x4cf0 repair auto-queue enabled   0x3508 demo mode (no sound)   0xd89c[] droid recharge times
//   0xd8a4[] work per tick by droid count   0xd898 slot count for overload   0xd89a overload time
//   0xd8a0 auto-queue delay   0xd8a2 auto-queue droid count
import { F } from './fn.js';
import { rw, rs, ww, i16, u16 } from '../rt.js';

const inc = a => ww(a, rw(a) + 1), dec = a => ww(a, rw(a) - 1);

// @4230 drawRepairQueue(): draw the queue lines (and blank the rest of the 8 lines); "empty" picture if none
function f_4230() {
  ww(0x1d0a, 3); ww(0x1d0c, 0); ww(0x1d04, 0x88);
  if (rw(0x2d4) && rw(0x11d0)) { F.f_0b61(0, 0x50); ww(0x2d4, 0); }
  let i = 0;
  for (; i < rs(0x11d0); i++) { F.f_0b7c(0x2f1c, i, rs(0xffc + i * 2), 0); ww(0x1d04, rw(0x1d04) + 8); }
  for (; i < 8; i++) { F.f_0b08(i, 0, 0x50); ww(0x1d04, rw(0x1d04) + 8); }
  if (!rw(0x11d0) && !rw(0x2d4)) { ww(0x2d4, 1); F.f_0d6b(6, 0x88, rs(0x1b16)); }
}

// @42e4 dequeue(id): remove the slot with id from the repair queue, releasing its droids
function f_42e4(id) {
  for (let i = 0; i < rs(0x11d0); i++) {
    const s = rs(0xffc + i * 2);
    if (rs(0x1030 + s * 2) !== id) continue;
    ww(0x1098 + s * 2, 0);
    for (let j = 0; j < rs(0x1064 + s * 2); j++) F.f_48e0();
    ww(0x1064 + s * 2, 0); ww(0x1134 + s * 2, 0);
    dec(0x11d0);
    for (let j = i; j < rs(0x11d0); j++) ww(0xffc + j * 2, rw(0xffe + j * 2));
    if (!rw(0x11d0) && !rw(0x3508)) { F.f_6526(0x804); F.f_64be(0x802); }
    return;
  }
}

// @43a2 enqueue(id, droids, pos): put slot id at queue position pos (moving it if queued) with a droid request
function f_43a2(id, n, pos) {
  let s = 0;
  while (s < 0x1a && rs(0x1030 + s * 2) !== id) s++;
  if (s >= 0x1a) return;
  if (pos > rs(0x11d0)) pos = rs(0x11d0);
  let j;
  if (rw(0x1098 + s * 2)) {
    j = 0; while (rs(0xffc + j * 2) !== s) j = i16(j + 1);
    if (pos === rs(0x11d0)) pos = i16(pos - 1);
  } else { j = rs(0x11d0); inc(0x11d0); }
  ww(0x1098 + s * 2, n);
  for (; j < pos; j = i16(j + 1)) ww(0xffc + j * 2, rw(0xffe + j * 2));
  for (; j > pos; j = i16(j - 1)) ww(0xffc + j * 2, rw(0xffa + j * 2));
  ww(0xffc + pos * 2, s);
  F.f_6526(0x802);
}

// @4479 repairTick(): assign droids to queued slots in order, work off damage, finish repairs, auto-queue, counts
function f_4479() {
  inc(0x1b56);
  let avail = 0;
  for (let i = 0; i < 7; i++) if (!rw(0xfe0 + i * 2)) avail++;
  for (let i = 0; i < rs(0x11d0); i++) {
    const s = rs(0xffc + i * 2), S = s * 2;
    while (rs(0x1064 + S) > rs(0x1098 + S)) { F.f_48e0(); dec(0x1064 + S); }
    if (avail >= rs(0x1098 + S)) {
      avail = i16(avail - rs(0x1098 + S));
      while (rs(0x1064 + S) < rs(0x1098 + S) && F.f_4872()) inc(0x1064 + S);
    } else if (avail > rs(0x1064 + S)) {
      avail = 0;
      while (F.f_4872()) inc(0x1064 + S);
    } else if (rw(0x1064 + S)) {
      const extra = i16(rs(0x1064 + S) - avail);
      ww(0x1064 + S, avail);
      for (let k = 0; k < extra; k++) F.f_48e0();
      avail = 0;
    }
    if (!rw(0x1064 + S)) { ww(0x1134 + S, 0); continue; }
    ww(0x1134 + S, 1);
    ww(0x119c + S, rw(0x119c + S) + rw(0xd8a4 + rw(0x1064 + S) * 2));
    if (rs(0x119c + S) <= 0xff) continue;
    ww(0x119c + S, rw(0x119c + S) - 0x100);
    dec(0x1168 + S);
    if (rs(0x1168 + S) > 0) continue;
    // repair finished
    dec(0x11d2);
    const sys = rs(0x10cc + S);
    F.f_6526(rs((rw(0xebc + sys * 2) === 1 ? 0x11de : 0x1212) + sys * 2));
    let droid = 0;
    ww(0xebc + sys * 2, 2);
    switch (sys) {
      case 0x10: droid = 1; break;
      case 0x11: droid = 4; break;
      case 0x12: droid = 6; break;
      case 0x13: case 0x14:
        F.f_6526(sys === 0x14 ? 0x406 : 0x404);
        if (rw(0xee2) === 2 && rw(0xee4) === 2) F.f_6526(0x402);
        break;
      case 0x17: F.f_6526(0x604); break;
      case 0x18: F.f_6526(0x40c); break;
    }
    if (droid) { ww(0xfe0 + droid * 2, 0); ww(0xfd2 + droid * 2, rw(0xd89c + rw(0x4cfa) * 2)); }
    ww(0x10cc + S, 0xffff);
    f_42e4(s);
    ww(0x1030 + S, 0xffff);
  }
  if (rw(0x4cf0)) {
    if (rw(0x11d4)) dec(0x11d4);
    if (rw(0x11d0)) ww(0x11d4, rw(0xd8a0));
    else if (!rw(0x11d4) && rw(0x11d2)) {
      let k = 0;
      while (k < 0x1a && rs(0x10cc + k * 2) < 0) k++;
      f_43a2(k, rs(0xd8a2), 1);
      if (!rw(0x3508)) { F.f_6526(0x802); F.f_64be(0x804); }
    }
    if (rw(0x1b58)) dec(0x1b58); else ww(0x4cfa, 0);
    if (rs(0x11d2) >= rs(0xd898)) { ww(0x4cfa, 1); ww(0x1b58, rw(0xd89a)); }
  }
  if (rw(0x1b56) & 1) { for (let k = 0; k < 0x1a; k++) if (rw(0x1098 + k * 2)) ww(0x1100 + k * 2, 1); }
  else for (let k = 0; k < 0x1a; k++) ww(0x1100 + k * 2, 0);
  ww(0x11d6, 0); ww(0x11d8, 0); ww(0x11da, 0); ww(0x11dc, 0);
  for (let k = 0; k < 7; k++) {
    const K = k * 2;
    if (rw(0xfc4 + K)) continue;
    if (rw(0xfd2 + K)) dec(0xfd2 + K);
    if (rw(0xfe0 + K)) inc(0x11dc);
    else if (rw(0xfd2 + K)) inc(0x11d8);
    else if (rw(0xfee + K)) inc(0x11da);
    else inc(0x11d6);
  }
}

// @4872 grabDroid(): mark the first ready droid busy; 1 if one was found
function f_4872() {
  let i = 0;
  for (; i < 7; i++) if (!rw(0xfc4 + i * 2) && !rw(0xfd2 + i * 2) && !rw(0xfe0 + i * 2) && !rw(0xfee + i * 2)) break;
  if (i < 7) { ww(0xfee + i * 2, 1); return 1; }
  return 0;
}

// @48e0 releaseDroid(): free the first busy droid; it needs to recharge
function f_48e0() {
  for (let i = 0; i < 7; i++) {
    if (rw(0xfee + i * 2)) { ww(0xfee + i * 2, 0); ww(0xfd2 + i * 2, rw(0xd89c + rw(0x4cfa) * 2)); return; }
  }
}

// @4922 damageTick(): system state pictures, incoming hits, failures, alarm, game-over checks, special hit effects
function f_4922() {
  inc(0x1b5a);
  let action = -1;
  for (let i = 0; i < 4; i++) {
    const v = rw(0xebc + i * 2) && rw(0xf58 + i * 2) ? rs(0xebc + i * 2) : 0;
    if (rs(0x3ce + i * 2) !== v) { ww(0x3ce + i * 2, v); F.f_70a4(rs(0x4bed + (i * 4 + v) * 2)); }
  }
  // pending hits; note: the loop counter is reused as the hit system index (original bug)
  for (let i = 0; i < 5; i = i16(i + 1)) {
    if (!rw(0x1288 + i * 2)) continue;
    const sys = rs(0x1292 + rw(0x1288 + i * 2) * 2);
    ww(0x1288 + i * 2, 0);
    let hit = 1;
    if (rw(0xf58 + sys * 2) && rw(0xebc + sys * 2)) {
      const a = rs(0xf8c), b = rs(0x6231 + (F.f_7086() & 3) * 2);
      ww(0xf8c, a - b);
      if (a > b) {
        const th = rw(0xebc + sys * 2) === 2 ? rs(0x624e) : rs(0x6250);
        if (i16(F.f_7086()) >= th) hit = 0;
      } else ww(0xf8c, 0);
    }
    if (!hit) continue;
    const r = i16(F.f_7086());
    i = 3;
    while (r >= rs(0x129c + i * 2)) i = i16(i + 1);
    if (i === 0xc) i = 0x19; else if (i === 0xb) i = 0xa; else if (i === 3) i = sys;
    if (i === 0x1a) { F.f_32a3(rs(0x6239 + (F.f_7086() & 3) * 2)); F.f_64be(0x210); continue; }
    if (i === 0x1b && rs(0xb7a) > rs(0x6241)) { action = rs(0x12d6 + sys * 2); continue; }
    if (i === 0x1c && rs(0xb7a) > rs(0x6241) && i16(F.f_7086()) < 0x80) { action = sys; continue; }
    const d = i;
    if (rw(0xef0 + d * 2)) continue;
    let slot;
    if (rw(0xebc + d * 2) === 2) {               // new damage: open a repair slot
      for (;;) {
        if (rs(0x1030 + rs(0x12fc) * 2) < 0) break;
        const n = i16(rs(0x12fc) + 1); ww(0x12fc, n);
        if (n >= 0x1a) ww(0x12fc, 0);
      }
      slot = rs(0x12fc);
      ww(0x1030 + slot * 2, slot); ww(0x10cc + slot * 2, d);
      ww(0x1098 + slot * 2, 0); ww(0x1064 + slot * 2, 0); ww(0x1168 + slot * 2, 0);
      inc(0x11d2);
    } else {
      slot = 0;
      while (slot < 0x1a && rs(0x10cc + slot * 2) !== d) slot++;
    }
    const tab = rw(0xd1e + sys * 2) && !rw(0x4cfa) ? 0xd8b4 : 0xd8e8;
    ww(0x1168 + slot * 2, rw(0x1168 + slot * 2) + rw(tab + d * 2));
    if (rs(0x1168 + slot * 2) > 0x63) {          // destroyed
      ww(0xef0 + d * 2, 1); ww(0xebc + d * 2, 0); inc(0x132c);
      f_42e4(slot);
      ww(0x10cc + slot * 2, 0xffff); ww(0x1030 + slot * 2, 0xffff); ww(0x1168 + slot * 2, 0);
      F.f_6526(rs(0x1212 + d * 2)); F.f_64be(rs(0x1246 + d * 2));
    } else if (rw(0xebc + d * 2) === 2) {
      ww(0xebc + d * 2, 1); F.f_64be(rs(0x11de + d * 2));
    } else {
      ww(0xebc + d * 2, 0); F.f_6526(rs(0x11de + d * 2)); F.f_64be(rs(0x1212 + d * 2)); inc(0x132a);
    }
    const droid = d === 0x10 ? 1 : d === 0x11 ? 4 : d === 0x12 ? 6 : 0;
    if (!droid) continue;
    if (rw(0xfee + droid * 2)) {                // droid was working: take it off the last staffed slot
      for (let c = i16(rs(0x11d0) - 1); c >= 0; c--) {
        const q = rs(0xffc + c * 2);
        if (rw(0x1064 + q * 2)) { dec(0x1064 + q * 2); break; }
      }
    }
    if (rw(0xef0 + d * 2)) ww(0xfc4 + droid * 2, 1);
    else { ww(0xfe0 + droid * 2, 1); ww(0xfee + droid * 2, 0); }
  }
  const t = rw(0x1b5a) & 3;
  if (rw(0xf1a) || rw(0xf1c) || (t === 1 && !rw(0xee6)) || (t === 3 && !rw(0xee8))) F.f_32a3(1);
  if (rw(0x4cee)) {
    if (rw(0xeea)) ww(0x12de, rw(0xc54c));
    else {
      if (rw(0x12de) === 0x1e) { F.f_6526(0x604); F.f_64be(0x602); }
      else if (rw(0x12de) === 0x3b) F.f_64be(0x604);
      if (!rw(0x12de)) action = 8;
      else if (rw(0x1b5a) & 1) dec(0x12de);
    }
  }
  if (rw(0x4cec)) {
    if (rw(0xeec)) ww(0x12e0, rw(0xb1d6));
    else {
      if (rw(0x12e0) === 0x1e) { F.f_6526(0x40c); F.f_64be(0x40e); }
      else if (rw(0x12e0) === 0x3b) F.f_64be(0x40c);
      if (!rw(0x12e0)) action = 7;
      else if (rw(0x1b5a) & 1) dec(0x12e0);
    }
  }
  let lvl = -1;
  for (let i = 0; i < 0x1a; i++) { const v = rs(0x59e + i * 2); if (v > 0 && v < 8) { lvl = v; break; } }
  let damaged = 0;
  for (let i = 0; i <= 9; i++) if (rw(0xebc + i * 2) && rw(0xf58 + i * 2)) { damaged = 1; break; }
  if (rw(0xb68)) damaged = 1;
  if (!damaged) ww(0x12fe, rw(0x6229));
  if (rw(0x12fe)) {
    dec(0x12fe);
    if (!rw(0x1300)) {
      ww(0x1300, 1); F.f_6d79(0xc);
      if (lvl < 0) { ww(0x12e4, 0xffff); ww(0x50a, 1); lvl = 1; ww(0x12e6, 1); ww(0x12e2, 1); }
      for (let k = 0; k < 5; k++) F.f_6526(rs(0x12f2 + k * 2));
      let r = F.f_7086() & 7; if (r >= 5) r -= 5;
      F.f_64be(rs(0x12e8 + r * 2));
      F.f_51d8(rs(0x1b6c), 4, 0x20);
      F.f_5219(rs(0x1b90), 4, 0x28);
    } else {
      F.f_5219(rs(rw(0x1b5a) & 1 ? 0x1b7e : 0x1b6c), 4, 0x20);
      if (lvl < 0) ww(0x12fe, 0);
      if (rw(0x3508) || (rw(0x1b5a) & 1)) F.f_32a3(1);
    }
  }
  if (damaged && !rw(0x12fe) && rw(0x1300)) {
    ww(0x1300, 0); ww(0x12fe, 0); ww(0x3b04, 0); ww(0x50a, 0);
    for (let k = 0; k < 5; k++) F.f_6526(rs(0x12e8 + k * 2));
    let r = F.f_7086() & 7; if (r >= 5) r -= 5;
    F.f_64be(rs(0x12f2 + r * 2));
  }
  if (!rw(0x3b4)) { f_516d(); F.f_5219(rs(0x1bb2), 6, 0x28); }
  if (i16(rw(0x3b6) - rw(0x622d)) > 0x3c) { f_516d(); F.f_5219(rs(0x1bdc), 4, 0x28); }
  if (action < 0) return;
  F.f_64be(rs(0x1bde + action * 2));
  if (action >= 5) action -= 5;
  ww(0x4cf2 + action * 2, 0); ww(0x4ce8 + action * 2, 0);
  switch (u16(action)) {
    case 0:
      for (let k = 0; k < 4; k++) { ww(0x8b30 + k * 2, 0x20); ww(0x8b40 + k * 2, 7); }
      while (rw(0x506)) F.f_15b3(0);
      break;
    case 1:
      ww(0x9e90, 0x14); ww(0x9e94, 0x21);
      while (rw(0x9d4)) F.f_23df(rs(0x97a));
      break;
    case 2:
      ww(0xb1da, 0x1e); ww(0xb1d8, 0xffe2); ww(0xb66, 0);
      for (const m of [0x61c, 0x61e, 0x620, 0x40c, 0x40e]) F.f_6526(m);
      break;
    case 3:
      for (let k = 0; k < 0xd; k++) ww(0xc554 + k * 2, 0x14);
      for (const m of [0x616, 0x618, 0x61a, 0x604, 0x602]) F.f_6526(m);
      break;
    case 4:
      while (rw(0x11d0)) f_42e4(rs(0x1030 + rs(0xffc) * 2));
      break;
  }
}

// @516d gameOver(): game-over message and sound, sets the game-over flag
function f_516d() {
  ww(0x3b04, 0);
  F.f_51d8(rs(0x1ba2), 4, 0x20);
  F.f_6880(-1);
  F.f_5219(rs(0x1bbe), 0x35, 0x20);
  F.f_5219(rs(0x1bcc), 0x33, 0x28);
  F.f_32bf(0);
  if (!rw(0x3508)) F.f_6db1(0xc);
  ww(0x3b2, 1);
}

Object.assign(F, { f_4230, f_42e4, f_43a2, f_4479, f_4872, f_48e0, f_4922, f_516d });
