// Combat view: draws the engine's 3D objects (8 slots: ships 0..3, enemy shots 4..5, our shots 6..7) and stars from
// game.state every frame. Sprite choice and placement are the original's (@631e): the sprite address is looked up in
// the engine's own sprite tables and mapped to the extracted PNG with that address (docs/modern/assets/index.json).
// New art (ship.class<n>, shot.<weapon>, fx.explosion) replaces the sprite when the slot has art: it is fitted into the
// box of the sprite the engine picked, so positions and depth scaling stay the engine's; the sprite is the fallback.
// Logical buffer 128x64 (the original view); the canvas has device resolution (s px per logical px).
import { artImage } from './data.js';
const W = 128, H = 64;
export const SHOTS = ['missile', 'blaster', 'cannon', 'thermo'];
const ART_GROW = 1.25;                                     // art is drawn a bit larger than the 1986 sprite box (it has soft edges)
const BOOM = { w: 40, h: 36 };                             // explosion box = the largest original frame (frames do not scale by depth)
const DPR = () => Math.min(3, devicePixelRatio || 1);
let mainScale = 4;                                         // device px per logical px of the main view
// CSS width to pick the art variant with (art()): sized for the main view, so the inset never loads a second file
export const artWidth = id => (id === 'fx.explosion' ? BOOM.w * 8 : 26) * ART_GROW * mainScale / DPR();
const ENEMY_SHOT = 4;
const hiS = v => (v << 16) >> 24;                          // signed high byte of a 16-bit word
const i16 = v => (v << 16) >> 16;
export const SLOT_X = [16, 64, 112, 64];                   // spawn x per ship slot (0x2f78 >> 7): port, fore, starboard, aft

let sprites = new Map();                                    // DS address -> { img } (the 1986 sprite: box size + fallback)

export async function loadSprites(base) {
  const idx = await (await fetch(base + 'index.json')).json();
  await Promise.all(idx.pictures.filter(p => p.source === 'PSI5 DS' && /^psi5\/(ship|shot|explosion)/.test(p.file)).map(p => new Promise(res => {
    const img = new Image();
    img.onload = () => { sprites.set(parseInt(p.addr, 16), { img }); res(); };
    img.onerror = res;
    img.src = base + p.file;
  })));
}

function gfxByte(S, a) { return a < 0x64a4 ? S.spritesFar[a - 0x4df8] : S.sprites[a - 0x64a4]; }
function gfxWord(S, a) { return a < 0x3204 ? S.spriteTables[(a - 0x3038) >> 1] : gfxByte(S, a) | gfxByte(S, a + 1) << 8; }
function spriteAddr(S, o) {
  if (o >= ENEMY_SHOT) {
    const k2 = (S.objKind[o] * 2) & 0xffff;
    if (k2 < 8) return gfxWord(S, gfxWord(S, 0x3038 + k2) + ((hiS(S.objZ[o]) >> 3) << 1));
    const frame = ((k2 - 8) >>> 3) << 1;
    return frame < 0x10 ? gfxWord(S, 0x3040 + frame) : -1;
  }
  return gfxWord(S, gfxWord(S, 0x3050 + S.objKind[o]) + ((hiS(S.objZ[o]) >> 3) << 1));
}

// objects visible on side `side` (0 fore, 1 aft), far to near
function objectsOn(S, side) {
  const list = [];
  for (let o = 0; o < 8; o++) {
    if (!S.objActive[o] || S.objView[o] !== side) continue;
    if ((o < ENEMY_SHOT || S.objKind[o] < 4) && hiS(S.objZ[o]) < 0) continue;
    list.push(o);
  }
  return list.sort((a, b) => S.objZ[b] - S.objZ[a]);
}
// art slot + explosion frame of object o (ships: objKind = contact class * 2; shots: objKind = weapon; explosions: 4.. + 4/frame)
function artOf(S, o) {
  if (o < ENEMY_SHOT) return { id: 'ship.class' + (S.objKind[o] >> 1) };
  const k2 = (S.objKind[o] * 2) & 0xffff;
  return k2 < 8 ? { id: 'shot.' + SHOTS[S.objKind[o]] } : { id: 'fx.explosion', frame: (k2 - 8) >>> 3 };
}
// visible-pixel box of an art image (or of one explosion frame), measured once
const trims = new WeakMap();
function trimOf(im, frame) {
  let t = trims.get(im);
  if (!t) {
    const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data, fw = im.naturalWidth / im.naturalHeight >= 7 ? c.height : c.width;
    t = [];
    for (let f = 0; f * fw < c.width; f++) {               // one box per frame (8 for the explosion sheet, else 1)
      let x0 = fw, y0 = c.height, x1 = -1, y1 = -1;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < fw; x++) if (d[(y * c.width + f * fw + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      t.push(x1 < 0 ? [f * fw, 0, fw, c.height] : [f * fw + x0, y0, x1 - x0 + 1, y1 - y0 + 1]);
    }
    trims.set(im, t);
  }
  return t[Math.min(frame || 0, t.length - 1)];
}
const posX = (S, o) => (S.objX[o] >> 7);
const posY = (S, o) => hiS(S.objY[o]);

export class CombatView {
  // canvas: <canvas>; side: 'main' follows state.view, 'inset' shows the other side
  constructor(canvas, kind) {
    this.c = canvas; this.kind = kind; this.s = 0;
    this.g = canvas.getContext('2d');
    this.side = 0; this.flash = 0;
  }
  sideOf(S) { const v = S.view === 2 ? (S.wantedView ?? 0) : S.view; return this.kind === 'main' ? v : 1 - v; }
  // canvas backing store = displayed size x device pixel ratio (integer px per logical px)
  fit() {
    const s = Math.max(2, Math.ceil((this.c.clientWidth || W * 4) * DPR() / W));
    if (s !== this.s) { this.s = s; this.c.width = W * s; this.c.height = H * s; }
    if (this.kind === 'main') mainScale = s;
    return s;
  }

  draw(S, info) {
    const g = this.g, s = this.fit();
    g.clearRect(0, 0, W * s, H * s);
    if (!S) return;
    const side = this.side = this.sideOf(S);
    const blank = S.view === 2 && this.kind === 'main' && info.headline;
    // stars (main view only, the engine moves them for the side it shows)
    if (this.kind === 'main' && !blank && !S.viewBlank) {
      g.fillStyle = '#e8f4ff';
      const from = S.view === 1 ? 12 : 0;
      for (let i = from; i < from + 12; i++) {
        const x = i16(S.starsX[i]) + 64, y = i16(S.starsY[i]) + 32;
        if (x >= 0 && x < W && y >= 0 && y < H) g.fillRect(x * s, y * s, s * 0.75, s * 0.75);
      }
    }
    if (blank) return;
    // objects, far to near: the sprite's box (engine position + depth size), the new art fitted into it
    for (const o of objectsOn(S, side)) {
      const a = spriteAddr(S, o), sp = a >= 0 && sprites.get(a);
      if (!sp) continue;
      const x = posX(S, o) - gfxWord(S, a + 4), y = posY(S, o) - gfxWord(S, a + 6);
      let glow;
      if (o < ENEMY_SHOT) { const t = S.shipTarget[o] >> 1; glow = [3, t >= 0 && S.contactHostile[t] ? '#ff4d6d' : '#4dffd2']; }
      else glow = [2, o >= 6 ? '#ffd36b' : '#ff6b9e'];
      const { id, frame } = artOf(S, o), boom = frame !== undefined;
      let bw = sp.img.width, bh = sp.img.height;
      const cx = (x + bw / 2) * s, cy = (y + bh / 2) * s;
      if (boom) { bw = BOOM.w; bh = BOOM.h; }
      const im = artImage(id, artWidth(id));                // one variant per slot (not per depth or view)
      g.save();
      if (im?.complete && im.naturalWidth) {
        const [sx, sy, sw, sh] = trimOf(im, frame);
        const k = Math.min(bw / sw, bh / sh) * ART_GROW * s, dw = sw * k, dh = sh * k;
        g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
        if (!boom) g.filter = `drop-shadow(0 0 ${glow[0] * s / 4}px ${glow[1]})`;
        g.drawImage(im, sx, sy, sw, sh, cx - dw / 2, cy - dh / 2, dw, dh);
      } else {
        g.imageSmoothingEnabled = false;
        g.filter = `drop-shadow(0 0 ${glow[0] * s / 4}px ${glow[1]})`;
        g.drawImage(sp.img, x * s, y * s, sp.img.width * s, sp.img.height * s);
      }
      g.restore();
    }
    // target letters under ships
    g.font = `bold ${(this.kind === 'main' ? 5.5 : 6.5) * s}px "PT Mono", monospace`; g.textAlign = 'center';
    for (const o of this.ships(S)) {
      const t = S.shipTarget[o] >> 1;
      if (t < 0) continue;
      const x = posX(S, o) * s, y = (posY(S, o) + 7) * s;
      g.fillStyle = S.contactHostile[t] ? '#ff6b86' : '#5effd6';
      g.fillText(String.fromCharCode(65 + t), x, Math.min(y + 2.5 * s, H * s - s));
    }
  }
  ships(S) { return objectsOn(S, this.side).filter(o => o < ENEMY_SHOT && S.objKind[o] < 20); }
  // client point -> target index of the nearest ship (generous touch radius), or -1
  pick(S, clientX, clientY) {
    const r = this.c.getBoundingClientRect();
    const x = (clientX - r.left) / r.width * W, y = (clientY - r.top) / r.height * H;
    let best = -1, bd = 18 * 18;
    for (const o of this.ships(S)) {
      const t = S.shipTarget[o] >> 1;
      if (t < 0 || !S.contactClass[t]) continue;
      const dx = posX(S, o) - x, dy = posY(S, o) - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
}
