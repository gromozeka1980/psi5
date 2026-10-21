// PSI5.EXE asm helpers @5ca3..@64aa: text-label drawing glue and the combat-view "3D" object system (enemy ships,
// enemy shots, our weapon shots) that f_6e26 (per-tick display update) steps and composites into the off-screen
// buffer at DS 0x3b90. 1:1 port; `@xxxx` = function address in re/psi5.lst. None of these are generators.
//
// Object table: 8 word slots, index si = 0,2,..,0xe (slot = si/2). Slots 0..3 = ships (from the spawn queue 0x9ca),
// slots 4..5 = enemy shots (f_5f8a), slots 6..7 = our weapon shots (f_5d20). Per-slot word arrays (base + si):
//   0x4cfc move delay (ticks until next step)    0x4d0c AI timer (slots 0..5; slots 0..3 for ships)
//   0x4d18 active          0x4d28 kind/frame (ships: 2*type; shots: animation step, >=4 = exploding/hit)
//   0x4d38 view side (0 front, 1 rear; compared with 0x3afe)   0x4d48 x  0x4d58 y  0x4d68 z (8.8 fixed, hi byte used)
//   0x4d78 vx  0x4d88 vy  0x4d98 vz   0x4da8 z after hit (shots)   0x4db8 object index*2 (ships) / target obj (shots)
//   0x4dc8 aggressive (ships; fires shots)   0x4dd0 ?   0x4dd8 ship facing frame (0..3)
//   0x4de0.. shots: 0x4de0 kind, 0x4de4 target x hi, 0x4de8 target y hi, 0x4dec facing; 0x4df0 target object,
//   0x4df4 target ship slot (si of the ship, 0xfffe = none)
// Other DS globals:
//   0x50a weapons disabled   0x450[5] weapon assignment (object index or <0)   0x45a[5] weapon type   0x46e[5] ammo
//   0x478[5] shots fired   0x4cf2 difficulty/alt table select   0x3afe view currently shown   0x3b00 view to show
//   0x59e[] obj type  0x63a[] obj hostile  0x6d6[] obj facing  0x70a[] obj on screen  0x73e[] obj damage bits
//   0x7da[] obj weak weapon+1   0x946[] obj destroyed (weapon+1)   0x9ca[4] spawn queue (object index, -1 = empty)
//   0x2f70[] weapon sound   0x8b40/0x8b48[] weapon time (normal/alt)   0x8b30/0x8b38[] weapon hit chance
//   0x2f78/0x2f80 spawn x / side per slot  0x2f88/0x2f98/0x2fa8[8] random vx/vy/vz   0x2fb8.. 0x3018 y/x clamps by z
//   0x3038/0x3040/0x3050 sprite tables (shots / explosions / ships)   0x455e[] off-screen buffer row offsets
//   0x3204 rows left (byte)   0x3206 sprite width (bytes)
//   0x1d02 x  0x1d04 y  0x1d06 text ptr  0x1d0a/0x1d0c fg/bg colour  0x1d1a menu string list  0x1d1c selected item
import { F } from './fn.js';
import { rb, rsb, rw, rs, wb, ww, i16, i8, u16 } from '../rt.js';

const inc = a => ww(a, rw(a) + 1), dec = a => ww(a, rw(a) - 1), neg = a => ww(a, -rw(a));

// @5ca3 drawLabel(): text record at [0x1d06] = x, y, fg, bg bytes followed by the string; draws it (f_5bf8).
function f_5ca3() {
  const si = rw(0x1d06);
  ww(0x1d02, rb(si)); ww(0x1d04, rb(si + 1)); ww(0x1d0a, rb(si + 2)); ww(0x1d0c, rb(si + 3));
  ww(0x1d06, si + 4);
  F.f_5bf8();
}

// @5ccb drawMenuList(): draws the 0-terminated string pointer list [0x1d1a]; item [0x1d1c] highlighted (marker
// string 0x1d1e in colours 1/0, others marker 0x1d20 in 0/1), each string after its marker.
function f_5ccb() {
  let cx = 0, si = rw(0x1d1a);
  for (;;) {
    const ax = rw(si);
    if (ax === 0) return;
    if (cx === rw(0x1d1c)) { ww(0x1d0a, 1); ww(0x1d0c, 0); ww(0x1d06, 0x1d1e); }
    else { ww(0x1d0a, 0); ww(0x1d0c, 1); ww(0x1d06, 0x1d20); }
    F.f_5bf8();
    ww(0x1d06, ax);
    F.f_5bf8();
    si = u16(si + 2); cx = u16(cx + 1);
  }
}

// @5d20 fireWeapons(): for each weapon (4..0) assigned to an on-screen object, launch a shot into a free shot slot
// (6 or 7) aimed at the ship slot showing that object.
function f_5d20() {
  if (rw(0x50a) !== 0) return;
  for (let si = 8; si >= 0; si -= 2) {
    if (rs(si + 0x450) < 0) continue;
    let bx = u16(rw(si + 0x450) << 1);
    if (rw(bx + 0x70a) === 0) continue;
    let di = 0;
    if (rw(0x4d24) | rw(0x4d14)) { di = 2; if (rw(di + 0x4d24) | rw(di + 0x4d14)) return; }
    if (rw(si + 0x46e) === 0) continue;
    ww(di + 0x4d34, rw(si + 0x45a));
    ww(di + 0x4df0, bx);
    inc(si + 0x478); dec(si + 0x46e);
    bx = u16(rw(di + 0x4d34) << 1);
    F.f_6e13(rw(bx + 0x2f70));
    ww(di + 0x4d14, rw(0x4cf2) !== 0 ? rw(bx + 0x8b48) : rw(bx + 0x8b40));
    di ^= 2;
    if (!(rw(di + 0x4d24) | rw(di + 0x4d14))) ww(di + 0x4d14, 1);
    di ^= 2;
    inc(di + 0x4d24);
    const ax = rw(di + 0x4df0);
    for (bx = 6; bx >= 0; bx -= 2) if (rw(bx + 0x4d18) !== 0 && ax === rw(bx + 0x4db8)) break;
    ww(di + 0x4df4, bx);
    if (rw(bx + 0x4dc8) === 0) { inc(bx + 0x4dc8); ww(bx + 0x4dd0, 5); }
    const v = rw(bx + 0x4d38);
    ww(0x3b00, v); ww(di + 0x4d44, v);
    ww(di + 0x4d54, 0x2000); ww(di + 0x4d64, 0x3e00); ww(di + 0x4d74, 0x400); ww(di + 0x4da4, 0x300);
  }
}

// @5e08 spawnShip(): moves the first queued object (0x9ca) into a free ship slot (3..0) with random position/velocity.
function f_5e08() {
  for (let si = 6; si >= 0; si -= 2) {
    if (rw(si + 0x4d18) !== 0) continue;
    let bx = rs(si + 0x9ca);
    if (bx < 0) continue;
    ww(si + 0x9ca, 0xffff);
    bx = u16(bx << 1);
    if (rw(bx + 0x946) !== 0) continue;
    ww(si + 0x4db8, bx); ww(si + 0x4dc0, bx); ww(si + 0x4d18, 1);
    ww(si + 0x4d28, rw(bx + 0x59e) << 1);
    ww(bx + 0x70a, 1);
    ww(si + 0x4d58, (F.f_7086() & 0x3f) * 0x101);
    ww(si + 0x4d68, 0x7800);
    ww(si + 0x4dc8, 0);
    if (rw(bx + 0x63a) !== 0) ww(si + 0x4dc8, 1);
    ww(si + 0x4d48, (F.f_7086() & 0xf) * 0x101 + rw(si + 0x2f78));
    const ax = rw(si + 0x2f80);
    ww(0x3b00, ax); ww(si + 0x4d38, ax);
    ww(si + 0x4d98, 0xfff0);
    ww(si + 0x4d78, rw((F.f_7086() & 0xe) + 0x2f88));
    ww(si + 0x4d88, rw((F.f_7086() & 0xe) + 0x2f98));
    ww(si + 0x4d0c, 0xf);
    return;
  }
}

// @5eba shipAI(): for each ship whose AI timer ran out: maybe turn aggressive and fire (f_5f8a), pick a new random
// velocity unless disabled (damage bits 2/4 of 0x73e).
function f_5eba() {
  for (let si = 6; si >= 0; si -= 2) {
    if (rw(si + 0x4d18) === 0 || rw(si + 0x4d0c) !== 0) continue;
    const kind = rs(si + 0x4d28), di = rw(si + 0x4db8);
    if (rw(si + 0x4dc8) !== 0) ww(si + 0x4d0c, (F.f_7086() & 3) | 1);
    else ww(si + 0x4d0c, (F.f_7086() & 0xf) | 4);
    let attack = true;
    if (rw(si + 0x4dc8) === 0) {
      if (kind >= 0x10) attack = false;
      else if (kind < 0xc && (F.f_7086() & 1) === 0) attack = false;
    }
    if (attack && !(rw(di + 0x73e) & 2)) { ww(si + 0x4dc8, 1); f_5f8a(si, di); }
    if (rw(di + 0x73e) & 4) continue;
    ww(si + 0x4d98, rw((F.f_7086() & 0xe) + 0x2fa8));
    if (si === 6 ? rw(si + 0x4d38) === 0 : rw(si + 0x4d38) !== 0) neg(si + 0x4d98);
    if (rsb(si + 0x4d69) > 0x10 || rsb(si + 0x4d99) >= 0) {
      ww(si + 0x4d78, rw((F.f_7086() & 0xe) + 0x2f88));
      ww(si + 0x4d88, rw((F.f_7086() & 0xe) + 0x2f98));
    }
  }
}

// @5f8a shipFire(si = ship slot, di = its object index*2): register args, only called by f_5eba. Launches an enemy
// shot from the ship into a free shot slot (5 or 4) towards a random screen point.
function f_5f8a(si, di) {
  for (let bx = 2; bx >= 0; bx -= 2) {
    if (rw(bx + 0x4d20) !== 0) continue;
    ww(bx + 0x4d20, 1);
    ww(bx + 0x4d30, F.f_7086() & 3);
    ww(bx + 0x4d50, rw(si + 0x4d48)); ww(bx + 0x4d60, rw(si + 0x4d58)); ww(bx + 0x4d70, rw(si + 0x4d68));
    ww(bx + 0x4da0, 0xfe00);
    ww(bx + 0x4de8, (F.f_7086() & 0x3f) * 0x101);
    ww(bx + 0x4de4, ((F.f_7086() & 0x1f) + 0x20) * 0x101);
    const ax = rw(si + 0x4d38);
    ww(bx + 0x4d40, ax); ww(0x3b00, ax);
    ww(bx + 0x4dec, rw(si + 0x4dd8));
    ww(di + 0x63a, 1);
    ww(bx + 0x4de0, rw(si + 0x4d28));
    return;
  }
}

// @6006 steerShots(): enemy shots drift towards their target point (x/y hi bytes, +-0x80), our shots home in on
// their target ship (+-0x100 in x, +-0x200 in y).
function f_6006() {
  const toward = (a, b, d) => { const p = rsb(a), q = rsb(b); return p === q ? 0 : p < q ? d : -d; };
  for (let si = 2; si >= 0; si -= 2) {
    if (rs(si + 0x4d30) >= 4) continue;
    ww(si + 0x4d80, toward(si + 0x4d51, si + 0x4de5, 0x80));
    ww(si + 0x4d90, toward(si + 0x4d61, si + 0x4de9, 0x80));
  }
  for (let si = 2; si >= 0; si -= 2) {
    if (rs(si + 0x4d34) >= 4) continue;
    const di = rw(si + 0x4df4);
    let ah = i8((rw(si + 0x4d54) - rw(di + 0x4d48)) >> 8);
    ww(si + 0x4d84, ah >= 1 ? 0xff00 : ah <= -1 ? 0x100 : 0);
    ah = i8((rw(si + 0x4d64) - rw(di + 0x4d58)) >> 8);
    ww(si + 0x4d94, ah >= 2 ? 0xfe00 : ah <= -2 ? 0x200 : 0);
  }
}

// @60b4 moveObjects(): steps every active object by its velocity (delay = z hi >> 6), mirrors objects passing behind
// the viewer to the other view, retires objects that flew away (z >= 0x7d), keeps ships on screen and sets their facing.
function f_60b4() {
  for (let si = 0xe; si >= 0; si -= 2) {
    if (rw(si + 0x4d18) === 0) continue;
    if (rw(si + 0x4cfc) !== 0) { dec(si + 0x4cfc); continue; }
    let ax;
    if (si >= 8 && rs(si + 0x4d28) >= 4) { ax = rw(si + 0x4da8); inc(si + 0x4d28); }
    else ax = rw(si + 0x4d68);
    ww(si + 0x4cfc, (ax >> 8) >> 6);
    ww(si + 0x4d48, rw(si + 0x4d48) + rw(si + 0x4d78));
    ww(si + 0x4d58, rw(si + 0x4d58) + rw(si + 0x4d88));
    ww(si + 0x4d68, rw(si + 0x4d68) + rw(si + 0x4d98));
    if (rsb(si + 0x4d69) < 0) {
      neg(si + 0x4d98); neg(si + 0x4d78);
      ww(si + 0x4d48, -(rw(si + 0x4d48) - 0x40));
      ww(si + 0x4d38, rw(si + 0x4d38) ^ 1);
      ww(si + 0x4d68, 0);
    }
    if (rsb(si + 0x4d69) >= 0x7d) {
      ww(si + 0x4d18, 0);
      if (si < 8) { ww(rw(si + 0x4db8) + 0x70a, 0); ww(si + 0x4db8, 0xffff); continue; }
    }
    if (si < 8) {
      if (rsb(si + 0x4d49) <= -0x1a) { ww(si + 0x4d48, 0xe700); neg(si + 0x4d78); }
      if (rsb(si + 0x4d49) > 0x4e) { ww(si + 0x4d48, 0x4d00); neg(si + 0x4d78); }
      if (rsb(si + 0x4d59) <= -0x1a) { ww(si + 0x4d58, 0xe700); neg(si + 0x4d88); }
      if (rsb(si + 0x4d59) > 0x4e) { ww(si + 0x4d58, 0x4d00); neg(si + 0x4d88); }
      let dx = 3;
      if (rw(si + 0x4d38) === 0) {
        const ah = rsb(si + 0x4d49);
        dx = ah < 0x10 ? 0 : ah < 0x30 ? 1 : 2;
      }
      ww(rw(si + 0x4db8) + 0x6d6, dx); ww(si + 0x4dd8, dx);
    }
    if (si < 0xc && rb(si + 0x4d69) < 0x10) {   // near objects: clamp to the visible area for this depth
      const bx = (rb(si + 0x4d69) << 1) & 0xff;
      let ax;
      if (rsb(si + 0x4d59) < 0x10) { ax = rs(bx + 0x2fb8); if (rs(si + 0x4d58) >= ax) ww(si + 0x4d58, ax); }
      else if (rsb(si + 0x4d59) > 0x30) { ax = rs(bx + 0x2fd8); if (rs(si + 0x4d58) <= ax) ww(si + 0x4d58, ax); }
      else if (rsb(si + 0x4d49) < 0x20) { ax = rs(bx + 0x3018); if (rs(si + 0x4d48) > ax) ww(si + 0x4d48, ax); }
      else { ax = rs(bx + 0x2ff8); if (rs(si + 0x4d48) <= ax) ww(si + 0x4d48, ax); }
    }
  }
}

// @6242 shotHits(): our weapon shot reaching its target's depth rolls to hit; a hit either damages the ship
// (random bits into 0x73e) or, if it was already damaged (bit 0), destroys it (shot turns into an explosion).
// Original bug kept: the loop ends with `jne` instead of `jns`, so only shot slot 7 (si = 2) is ever checked.
function f_6242() {
  const si = 2;
  if (rw(si + 0x4d24) === 0 || rs(si + 0x4d34) >= 4) return;
  let di = rw(si + 0x4df4);
  const bx = rw(si + 0x4df0);
  if (bx !== rw(di + 0x4db8)) return;
  if (((rw(di + 0x4d68) - rw(di + 0x4d74)) >> 8 & 0xff) > 4) return;
  const dx = u16(rw(bx + 0x7da) - 1) === rw(si + 0x4d34) ? 2 : 0;
  const w = u16(rw(si + 0x4d34) << 1);
  let cx = rw(0x4cf2) !== 0 ? rw(w + 0x8b38) : rw(w + 0x8b30);
  if (dx) cx = cx << 2;
  if (i16(cx) >= F.f_7086()) return;
  if (!(rw(bx + 0x73e) & 1)) {
    const r = F.f_7086() & 7;
    if (r) ww(bx + 0x73e, (rw(bx + 0x73e) & 7) | r);
    return;
  }
  F.f_6e13(0x22);
  ww(bx + 0x70a, 0);
  di = rw(si + 0x4df4);
  ww(di + 0x4d18, 0);
  ww(bx + 0x946, rw(si + 0x4d34) + 1);
  ww(si + 0x4d54, rw(di + 0x4d48)); ww(si + 0x4d64, rw(di + 0x4d58));
  ww(si + 0x4d84, rw(di + 0x4d78)); ww(si + 0x4d94, rw(di + 0x4d88));
  ww(si + 0x4da4, 0x300); ww(si + 0x4db4, rw(si + 0x4d74)); ww(si + 0x4d34, 4);
}

// @631e drawObjects(): composites every active object of the shown view into the off-screen buffer (far to near
// slot order 7..0), picking the sprite by kind and depth and projecting x/y.
function f_631e() {
  for (let si = 0xe; si >= 0; si -= 2) {
    if (rw(si + 0x4d18) === 0 || rw(si + 0x4d38) !== rw(0x3afe)) continue;
    let di = rw(si + 0x4d28), bx, scaled = true;
    if (si >= 8) {
      di = u16(di << 1);
      bx = rw(di + 0x3038);
      if (i16(di) >= 8) {                         // shot exploding: frame by animation step
        di = ((u16(di - 8) >>> 3) << 1) & 0xffff;
        if (i16(di) >= 0x10) continue;
        bx = rw(di + 0x3040); scaled = false;
      }
    } else bx = rw(di + 0x3050);
    if (scaled) {                                 // sprite size by depth
      const z = rsb(si + 0x4d69);
      if (z < 0) continue;
      bx = rw(bx + ((z >> 3) << 1));
    }
    let ax = i16((rsb(si + 0x4d49) << 1) | (rb(si + 0x4d48) >> 7));
    ax = i16(ax - rw(bx + 4));
    if (ax <= -16) continue;
    ww(bx + 8, ax);
    if (i16((ax >> 2) + rw(bx)) >= 0x26) continue;
    ax = i16(rsb(si + 0x4d59) - rw(bx + 6));
    if (ax <= -16) continue;
    ww(bx + 0xa, ax);
    if (i16(ax + rw(bx + 2)) >= 0x50) continue;
    f_63c5(bx);
  }
}

// @63c5 blitSprite(si = sprite): ORs a 2bpp sprite {w bytes, h rows, ox, oy, x px, y, data...} into the
// off-screen buffer 0x3b90 (rows via 0x455e) at pixel x, shifting by x&3. `loop` with width 0 runs 65536 times.
function f_63c5(si) {
  let bx = u16(rw(si + 0xa) << 1);
  wb(0x3204, rw(si + 2));
  const x = rw(si + 8);
  ww(0x3206, rw(si));
  si = u16(si + 0xc);
  const bp = u16((i16(x) >> 2) + 0x3b90), sh = x & 3;
  let more;
  do {
    let di = u16(rw(bx + 0x455e) + bp), cx = rw(0x3206);
    if (sh === 0) {
      do { wb(di, rb(di) | rb(si)); si = u16(si + 1); di = u16(di + 1); cx = u16(cx - 1); } while (cx);
    } else {
      const s = sh * 2, keep = 0xff >> s;
      let dh = sh === 1 ? 0 : rb(di) & ~keep & 0xff;
      do {
        const b = rb(si); si = u16(si + 1);
        wb(di, rb(di) | (b >> s) | dh);
        dh = (b << (8 - s)) & 0xff;
        di = u16(di + 1); cx = u16(cx - 1);
      } while (cx);
      wb(di, rb(di) | (rb(di) & keep) | dh);
    }
    bx = u16(bx + 2);
    const n = rsb(0x3204) - 1;
    wb(0x3204, n & 0xff);
    more = n > 0;
  } while (more);
}

// @64aa tickShipTimers(): counts down the AI timers 0x4d0c of slots 5..0.
function f_64aa() {
  for (let si = 0xa; si >= 0; si -= 2) if (rw(si + 0x4d0c) !== 0) dec(si + 0x4d0c);
}

Object.assign(F, { f_5ca3, f_5ccb, f_5d20, f_5e08, f_5eba, f_5f8a, f_6006, f_60b4, f_6242, f_631e, f_63c5, f_64aa });
