// Dumps the game's graphics to PNG and all of its text to JSON (docs/modern/assets/), for the modern rewrite.
// Sources: web/data/psi5_ds.bin / sel_ds.bin (DS snapshots at main()), the game's .BIN files, re/psi5.lst (code refs).
// Formats are documented in docs/modern/model/data.md.   Run: node tools/extract_assets.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from '../_dosref/png.mjs';
import { CGA_RGB } from '../web/src/rt.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs/modern/assets');
const read = f => new Uint8Array(fs.readFileSync(path.join(ROOT, f)));
const PSI = read('web/data/psi5_ds.bin'), SEL = read('web/data/sel_ds.bin');
const hex = (v, n = 4) => '0x' + v.toString(16).padStart(n, '0');
const w16 = (b, a) => b[a] | (b[a + 1] << 8);
const s16 = (b, a) => (w16(b, a) << 16) >> 16;
const cstr = (b, a) => { let s = ''; for (; a < b.length && b[a]; a++) s += b[a] === 13 ? '\n' : String.fromCharCode(b[a]); return s; };

// CGA mode 4, palette 1 (BH=1 BL=1 in SEL; mode 4 default in PSI5), low intensity: INT 10h AH=0Bh BL=0x20 clears the
// intensity bit and sets a black background -> black, cyan, magenta, light grey (matches the DOSBox screenshots)
const PAL = [0, 3, 5, 7].map(i => CGA_RGB[i]);
fs.mkdirSync(OUT, { recursive: true });
for (const d of ['psi5', 'sel', 'crew']) fs.mkdirSync(path.join(OUT, d), { recursive: true });

// px: Uint8Array of colour indices 0..3, w x h pixels
function savePng(rel, w, h, px, transparent0 = false) {
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const [r, g, b] = PAL[px[i]];
    rgba.set([r, g, b, transparent0 && px[i] === 0 ? 0 : 255], i * 4);
  }
  fs.writeFileSync(path.join(OUT, rel), PNG.encode(w, h, rgba));
}
// 2bpp packed bytes (4 px per byte, msb first) -> indices
function unpack(bytes, wBytes, h) {
  const px = new Uint8Array(wBytes * 4 * h);
  for (let i = 0; i < wBytes * h; i++) for (let k = 0; k < 4; k++) px[i * 4 + k] = (bytes[i] >> (6 - 2 * k)) & 3;
  return px;
}

// Picture/sprite: header words +0 width (bytes), +2 height (lines), +4/+6 origin x/y (3D sprites), +8 x, +10 y; data
function picture(buf, off) {
  const w = w16(buf, off), h = w16(buf, off + 2);
  if (!w || w > 80 || !h || h > 200 || off + 12 + w * h > buf.length) return null;
  return { w, h, ox: s16(buf, off + 4), oy: s16(buf, off + 6), x: s16(buf, off + 8), y: s16(buf, off + 10),
    px: unpack(buf.subarray(off + 12, off + 12 + w * h), w, h) };
}
// RLE face (f_70e2): escape byte at +6, data from +0x14, always 32 bytes x 64 lines; esc, value, count (0 = 256)
function face(buf, off) {
  const esc = buf[off + 6], out = new Uint8Array(32 * 64);
  let si = off + 0x14, n = 0;
  while (n < out.length) {
    const al = buf[si++];
    if (al !== esc) { out[n++] = al; continue; }
    const v = buf[si], c = buf[si + 1] || 256; si += 2;
    for (let k = 0; k < c && n < out.length; k++) out[n++] = v;
  }
  return { w: 32, h: 64, px: unpack(out, 32, 64), end: si - off };
}

const index = [];   // every PNG: file, source, address, header, what it is
const seen = new Map();
function dumpPic(dir, srcName, buf, off, name, what, transparent0 = false) {
  const key = srcName + ':' + off;
  if (seen.has(key)) { seen.get(key).aliases.push(name); return seen.get(key); }
  const p = picture(buf, off);
  if (!p) { console.warn('not a picture:', srcName, hex(off), name); return null; }
  const file = `${dir}/${name}.png`;
  savePng(file, p.w * 4, p.h, p.px, transparent0);
  const e = { file, source: srcName, addr: hex(off), wBytes: p.w, h: p.h, ox: p.ox, oy: p.oy, x: p.x, y: p.y, what, aliases: [] };
  index.push(e); seen.set(key, e); return e;
}
const tbl = (buf, a, n) => Array.from({ length: n }, (_, i) => w16(buf, a + i * 2));

// ---------------- PSI5 pictures (f_70a4: x in pixels, y in lines; f_7145 / f_63c5 see data.md) ----------------
const DASH = read('DASH.BIN');
dumpPic('psi5', 'DASH.BIN', DASH, 0, 'dashboard', 'full-screen dashboard (f_6b4c, drawn once at start)');
const P = (name, a, what, tr) => dumpPic('psi5', 'PSI5 DS', PSI, a, name, what, tr);
tbl(PSI, 0x3ade, 3).forEach((a, i) => P(`view_label_${i}`, a, `0x3ade[${i}] view label (0 fore, 1 aft, 2 = report/blank), f_6e26`));
tbl(PSI, 0x4742, 9).forEach((a, i) => P(`heading_${i}`, a, `0x4742[${i}] ship heading/maneuver icon (0 level, 1 left, 2 right, 3 up, 4 down, 5-8 diagonals), f_32f2`));
P('arrival', w16(PSI, 0x817c), '[0x817c] arrival picture, f_3318');
P('head_blank', 0x7fcc, 'head window label when no department (f_6880(-1))');
tbl(PSI, 0x32d4, 5).forEach((a, i) => P(`head_label_dept${i}`, a, `0x32d4[${i}] head window label of department ${i}`));
tbl(PSI, 0x4915, 3).forEach((a, i) => P(`eng_emerg_batt_${i}`, a, `0x4915[${i}] engineering emergency-battery lamp state ${i}, f_37be`));
tbl(PSI, 0x49e7, 2).forEach((a, i) => P(`eng_shield_batt_${i}`, a, `0x49e7[${i}] shield-battery lamp state ${i}, f_37be`));
tbl(PSI, 0x4a0b, 2).forEach((a, i) => P(`nav_alarm_${i}`, a, `0x4a0b[${i}] navigation alarm lamp ${i ? 'on' : 'off'}, f_243d`));
tbl(PSI, 0x4a2d, 16).forEach((a, i) => P(`scan_lamp${i >> 2}_state${i & 3}`, a, `0x4a2d[${i}] scanner lamp ${i >> 2} state ${i & 3}, f_16f3`));
tbl(PSI, 0x4bed, 16).forEach((a, i) => P(`shield_lamp${i >> 2}_state${i & 3}`, a, `0x4bed[${i}] shield ${i >> 2} state ${i & 3} (0 off,1 damaged,2 ok), f_4922`));
P('gauge_seg_level', 0x48e0, 'power-level gauge segment (lit), f_37be');
P('gauge_seg_off', 0x48f2, 'gauge segment (unlit), f_37be');
P('gauge_seg_drawn', 0x4904, 'power-drawn gauge segment (lit), f_37be');
// station background animations behind the crew face (f_67aa / f_7145): 0x32de[dept] -> 0-terminated list of tracks; track = {sprite, frames}*
const tracks = [];
for (let d = 0; d < 5; d++) {
  for (let l = w16(PSI, 0x32de + d * 2), t = 0; w16(PSI, l); l += 2, t++) {
    const steps = [];
    for (let q = w16(PSI, l); w16(PSI, q); q += 4) {
      const e = P(`station_anim_d${d}_${hex(w16(PSI, q))}`, w16(PSI, q), `department ${d} station background animation sprite in the head window (f_7145)`);
      steps.push({ sprite: e && e.file, frames: w16(PSI, q + 2) });
    }
    tracks.push({ dept: d, track: t, addr: hex(w16(PSI, l)), steps });
  }
}
// combat view objects (f_631e / f_63c5, ORed into the star buffer: colour 0 = transparent)
const W = ['missile', 'blaster', 'cannon', 'thermo'];
tbl(PSI, 0x3038, 4).forEach((l, k) => tbl(PSI, l, 16).forEach((a, z) =>
  P(`shot_${W[k]}_${hex(a)}`, a, `our ${W[k]} shot, depth z>>3 = ${z} (0x3038[${k}])`, true)));
tbl(PSI, 0x3040, 8).forEach((a, i) => P(`explosion_${i}`, a, `explosion frame ${i} (0x3040[${i}])`, true));
const typeNames = [];
{ const m = read('MISN1.BIN'); for (let i = 0; i < 11; i++) typeNames.push(cstr(m, w16(PSI, 0x613a + i * 2) - 0x616e).trim()); }
tbl(PSI, 0x3050, 10).forEach((l, t) => { if (t === 0) return;
  tbl(PSI, l, 16).forEach((a, z) => P(`ship_t${t}_${hex(a)}`, a, `ship type ${t} (${typeNames[t]}), depth z>>3 = ${z}`, true)); });
// enemy shots (slots 4/5) are drawn from 0x3038 by their kind too (kind = firing ship's 0x4d28; see data.md)

// ---------------- SEL pictures ----------------
const S = (name, a, what) => dumpPic('sel', 'SEL DS', SEL, a, name, what);
S('title', w16(SEL, 0x35da), 'title screen (SEL main)');
const selNames = tbl(SEL, 0x14e, 30).map(a => cstr(SEL, a).trim());
tbl(SEL, 0x35dc, 30).forEach((a, i) => S(`portrait_${String(i).padStart(2, '0')}_${selNames[i].replace(/\W/g, '')}`, a,
  `candidate ${i} portrait (dept ${Math.floor(i / 6)}), SEL 0x35dc[${i}]`));
tbl(SEL, 0x3618, 5).forEach((a, i) => S(`resume_deco_${i}`, a, `resume screen decoration ${i} (drawn at its stored byte x/y)`));

// ---------------- fonts: 8x8, 1 bit per pixel, glyph 0 = char 0x20 ----------------
function font(buf, a, n, file) {
  const cols = 16, rows = Math.ceil(n / cols), px = new Uint8Array(cols * 8 * rows * 8);
  for (let g = 0; g < n; g++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++)
    if (buf[a + g * 8 + y] & (0x80 >> x)) px[((g / cols | 0) * 8 + y) * cols * 8 + (g % cols) * 8 + x] = 3;
  savePng(file, cols * 8, rows * 8, px);
  index.push({ file, source: file.startsWith('psi5') ? 'PSI5 DS' : 'SEL DS', addr: hex(a), what: `8x8 font, chars 0x20..${hex(0x1f + n, 2)}` });
}
font(PSI, 0x1eb2, (0x219a - 0x1eb2) / 8, 'psi5/font.png');
font(SEL, 0x3cfc, 96, 'sel/font.png');

// ---------------- crew files ----------------
const DEPTS = ['Weapons', 'Scanning', 'Navigator', 'Engineer', 'Repair'];
const selFiles = tbl(SEL, 0xe6ae, 30).map(a => cstr(SEL, a));
// message ids queued by the code (f_64be add / f_6526 remove): hi byte = dept*2, lo byte = 2*message index
const msgUsers = {};
const addUser = (id, who) => { if (id & 0x8000) return; (msgUsers[id] ??= new Set()).add(who); };
for (const f of fs.readdirSync(path.join(ROOT, 'web/src/psi5')).filter(f => f.endsWith('.js'))) {
  let fn = '?';
  for (const line of fs.readFileSync(path.join(ROOT, 'web/src/psi5', f), 'utf8').split(/\r?\n/)) {
    const m = line.match(/function\*? (f_[0-9a-f]{4})/); if (m) fn = m[1];
    for (const c of line.matchAll(/f_(64be|6526)\((0x[0-9a-f]+|\d+)\)/g)) addUser(Number(c[2]), `${fn} ${c[1] === '64be' ? 'queue' : 'unqueue'}`);
    const arr = line.match(/for \(const m of \[([^\]]+)\]\) F\.f_6526/);
    if (arr) for (const v of arr[1].split(',')) addUser(Number(v.trim()), `${fn} unqueue on crew death`);
  }
}
for (const [a, n, who] of [[0x11de, 26, 'system damaged (0x11de[sys]) f_4479/f_4922'], [0x1212, 26, 'system disabled (0x1212[sys]) f_4479/f_4922'],
  [0x1246, 26, 'system destroyed (0x1246[sys]) f_4922'], [0x12e8, 5, 'alarm start, random one (0x12e8[]) f_4922'],
  [0x12f2, 5, 'alarm end (0x12f2[]) f_4922'], [0x1bde, 10, 'special hit / crew loss action (0x1bde[action]) f_4922']])
  tbl(PSI, a, n).forEach((id, i) => addUser(id, `${who} #${i}`));

const crewText = {}, crewIndex = [];
for (const file of fs.readdirSync(ROOT).filter(f => /\.BIN$/.test(f) && !/^(MISN|SELECT|DASH)/.test(f)).sort()) {
  const b = read(file), hdr = w16(b, 0), base = file.replace('.BIN', '');
  const dept = { 0x54: null, 0xa6: 2, 0x64: 3, 0xa4: 4 }[hdr];
  const cand = selFiles.indexOf(base);
  const dp = cand >= 0 ? Math.floor(cand / 6) : dept ?? 0;
  // string offset table runs from 0 up to the first word that is not a valid ascending string offset
  const offs = [];
  for (let a = 0; a < hdr - 4; a += 2) { const o = w16(b, a); if (o < hdr || o >= b.length || (offs.length && o <= offs.at(-1))) break; offs.push(o); }
  const params = [];
  for (let a = offs.length * 2; a < hdr - 4; a += 2) params.push(s16(b, a));
  const faceOff = w16(b, hdr - 4), mouthOff = w16(b, hdr - 2);
  const messages = offs.map((o, i) => {
    const id = (dp * 2) << 8 | (i * 2);
    return { index: i, id: hex(id), offset: hex(o), text: cstr(b, o), usedBy: i === 0 ? ['f_657f: title line under every message'] : [...(msgUsers[id] ?? [])] };
  });
  crewText[base] = { file, candidate: cand, dept: dp, deptName: DEPTS[dp], selName: cand >= 0 ? selNames[cand] : null,
    loadedAt: hex([0x8b0c, 0x9e5a, 0xb1aa, 0xc524, 0xd87c][dp]), headerSize: hex(hdr),
    params: { offset: hex(offs.length * 2), words: params }, faceOffset: hex(faceOff), mouthTableOffset: hex(mouthOff), messages };
  // face + mouth animation sprites (offsets relative to the file start)
  const f = face(b, faceOff), ff = `crew/${base}_face.png`;
  savePng(ff, 128, 64, f.px);
  index.push({ file: ff, source: file, addr: hex(faceOff), what: `${base} face (RLE, f_70e2), 128x64 px at screen x 184, y 8` });
  const mouth = [];
  for (let m = mouthOff; w16(b, m); m += 4) {
    const steps = [];
    for (let q = w16(b, m + 2); w16(b, q); q += 4) {
      // JARU.BIN: the table is not 0-terminated and runs into track data; those entries are inert in the game
      if (!picture(b, w16(b, q))) { steps.push({ bogus: hex(w16(b, q)) }); break; }
      const e = dumpPic('crew', file, b, w16(b, q), `${base}_anim_${hex(w16(b, q))}`, `${base} face animation sprite (f_7145, x/y relative, see data.md)`);
      steps.push({ sprite: e && e.file, frames: w16(b, q + 2) });
    }
    mouth.push({ mask: w16(b, m), steps });
  }
  crewIndex.push({ crew: base, face: ff, faceRleBytes: f.end, tracks: mouth });
}

// ---------------- missions ----------------
const missions = {};
for (const file of ['MISNA.BIN', 'MISN1.BIN', 'MISN2.BIN', 'MISN3.BIN']) {
  const b = read(file), W1 = a => s16(b, a), arr = (a, n) => Array.from({ length: n }, (_, i) => s16(b, a + i * 2));
  missions[file] = {
    course: ['MISNA', 'MISN1', 'MISN2', 'MISN3'].indexOf(file.replace('.BIN', '')),
    typeNamesPlural: tbl(PSI, 0x6124, 11).map(a => ({ offset: hex(a - 0x616e), text: cstr(b, a - 0x616e) })),
    typeNamesSingular: tbl(PSI, 0x613a, 11).map(a => ({ offset: hex(a - 0x616e), text: cstr(b, a - 0x616e) })),
    destination: { offset: '0x00d7', text: cstr(b, 0xd7), usedBy: 'pointer 0x4ce6 -> f_3318 arrival screen' },
    numbers: {
      '0x0bb alarmDuration (0x6229)': W1(0xbb), '0x0bd startPosition (0x622b)': W1(0xbd), '0x0bf scheduledTime (0x622d)': W1(0xbf),
      '0x0c1 intruderChance (0x622f)': W1(0xc1), '0x0c3 hitStrength[4] (0x6231)': arr(0xc3, 4), '0x0cb hitDamage[4] (0x6239)': arr(0xcb, 4),
      '0x0d3 specialHitPosition (0x6241)': W1(0xd3), '0x0d5 destNameOffset? (unused)': W1(0xd5),
      '0x0e0 hitThresholdOk (0x624e)': W1(0xe0), '0x0e2 hitThresholdDamaged (0x6250)': W1(0xe2),
      '0x0e4 contactLifetime[type 0..9] (0x6252)': arr(0xe4, 10), '0x0f8 typeColumn[17] (0x6266)': arr(0xf8, 17),
      '0x11a routeLength[5] (0x6288)': arr(0x11a, 5), '0x124 hostileDelay (0x6292)': W1(0x124),
      '0x126 bounty[type 0..7] (0x6294)': arr(0x126, 8), '0x136 casualtyCost (0x62a4)': W1(0x136), '0x138 lostAllyCost (0x62a6)': W1(0x138),
      '0x13a earlyBonusBase (0x62a8)': W1(0x13a), '0x13c earlyBonusPerMinute (0x62aa)': W1(0x13c), '0x13e cargoCost (0x62ac)': W1(0x13e),
      '0x140 cargoValuePerPercent (0x62ae)': W1(0x140),
    },
    routeSpawnMasks: Array.from({ length: 5 }, (_, r) => arr(0x142 + r * 100, 50).map(v => hex(v & 0xffff))),
  };
}

// ---------------- generic string scan of the DS images, with references ----------------
// code refs from the listing: immediate or memory operand equal to the address, per function
const codeRefs = new Map();
{
  let fn = 'start';
  for (const line of fs.readFileSync(path.join(ROOT, 're/psi5.lst'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^;==== (\S+) ====/); if (m) { fn = m[1]; continue; }
    const ins = line.match(/^  [0-9a-f]{4}  (.*?)(?: ;.*)?$/); if (!ins) continue;
    for (const c of ins[1].matchAll(/0x([0-9a-f]+)/g)) { const v = parseInt(c[1], 16); (codeRefs.get(v) ?? codeRefs.set(v, new Set()).get(v)).add(fn); }
  }
}
// SEL: constants in web/src/sel.js, per function (comment "// @xxxx" or function name)
const selRefs = new Map();
{
  let fn = '?';
  for (const line of fs.readFileSync(path.join(ROOT, 'web/src/sel.js'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\/\/ (@[0-9a-f]{4})/) || line.match(/^(?:export )?function\*? (\w+)/); if (m) fn = m[1];
    for (const c of line.matchAll(/0x([0-9a-f]+)/g)) { const v = parseInt(c[1], 16); (selRefs.get(v) ?? selRefs.set(v, new Set()).get(v)).add(fn); }
  }
}
// ptrRanges: where pointer tables live (elsewhere a matching word is most likely picture data); refs below minRef
// are not trusted (small numbers are everywhere in the code)
function scan(buf, ranges, refs, ptrRanges, minRef) {
  const out = [], starts = new Set();
  const printable = c => (c >= 0x20 && c < 0x7f) || c === 13;
  const runs = [];
  for (const [lo, hi] of ranges) {
    for (let a = lo; a < hi; a++) {
      if (!printable(buf[a]) || (a > lo && printable(buf[a - 1]))) continue;
      let e = a; while (e < hi && printable(buf[e])) e++;
      if (buf[e] === 0) runs.push([a, e]);
      a = e;
    }
  }
  runs.forEach(([a]) => starts.add(a));
  const inRun = p => runs.some(([x, y]) => p + 1 >= x && p < y);
  const ptrs = new Map();
  for (const [lo, hi] of ptrRanges) for (let p = lo; p < hi; p++) {
    const v = w16(buf, p); if (starts.has(v) && !inRun(p)) (ptrs.get(v) ?? ptrs.set(v, []).get(v)).push(p);
  }
  const ref = (a, min = 0x30) => a >= min ? refs.get(a) : undefined;   // table bases can be small
  // users of a pointer slot: walk back over the contiguous run of string pointers to the table start
  const users = p => {
    let t = p; while (starts.has(w16(buf, t - 2)) && !ref(t)) t -= 2;
    if (!ref(t)) for (let k = p; k >= p - 32; k -= 2) if (ref(k)) { t = k; break; }
    return ref(t) ? [...ref(t)].map(f => `${f} via table ${hex(t)}[${(p - t) / 2}]`) : [];
  };
  for (const [a] of runs) {
    const text = cstr(buf, a), letters = (text.match(/[A-Za-z]/g) || []).length;
    const code = [...(ref(a, minRef) ?? [])], pt = ptrs.get(a) ?? [];
    if (!(letters >= 2 || code.length || pt.length)) continue;
    out.push({ addr: hex(a), text, ...(buf[a - 1] === 1 && { inDrawingScript: true }), codeRefs: code, ptrSlots: pt.map(p => hex(p)),
      ptrUsers: [...new Set(pt.flatMap(users))] });
  }
  return out;
}
// drawing scripts (f_09b7 / SEL @0b05): 1 text, 2 x y, 3 x, 4 fg bg, 5 x y w h, 6 newline, 0 end
function script(buf, a, st = {}) {
  const items = []; let { x = 0, y = 0, fg = 0, bg = 0 } = st;
  for (;;) {
    const c = buf[a++];
    if (c === 0) return items;
    if (c === 1) { const t = cstr(buf, a); items.push({ x, y, fg, bg, text: t }); a += t.length + 1; x += 2 * t.length; for (const ch of t) if (ch === '\n') { x = 0; y += 8; } }
    else if (c === 2) { x = buf[a]; y = buf[a + 1]; a += 2; }
    else if (c === 3) { x = buf[a++]; }
    else if (c === 4) { fg = buf[a]; bg = buf[a + 1]; a += 2; }
    else if (c === 5) { items.push({ rect: [buf[a], buf[a + 1], buf[a + 2], buf[a + 3]], colour: bg }); a += 4; }
    else if (c === 6) { x = 0; y += 8; }
    else return items.concat({ error: `bad opcode ${c} at ${hex(a - 1)}` });
  }
}
const psiScripts = {};
for (const [name, a] of [['press-button prompt (0x239a, f_09b7)', w16(PSI, 0x239a)], ['briefing (0x23c9)', w16(PSI, 0x23c9)], ['pause (0x253e)', 0x253e],
  ['speed label position (0x18c2, f_32bf; label = 0x190c[speed])', 0x18c2], ['invoice (0x257d)', w16(PSI, 0x257d)],
  ...tbl(PSI, 0x2767, 10).map((p, i) => [`panel ${i + 1} (0x2765[${i + 1}])`, p])])
  psiScripts[name] = { addr: hex(a), items: script(PSI, a, name.includes('f_09b7') || name.includes('0x18c2') ? {} : { y: 0x78, fg: 3 }) };   // f_0988 clears the view area and starts at y 0x78
const selScripts = {};
for (const [name, a] of [['course screen (0x3622)', w16(SEL, 0x3622)], ['candidates footer (0x39d9)', w16(SEL, 0x39d9)],
  ...tbl(SEL, 0x384d, 4).map((p, i) => [`course ${i} (0x384d[${i}])`, p]), ...tbl(SEL, 0x390d, 4).map((p, i) => [`crew summary course ${i} (0x390d[${i}])`, p]),
  ...tbl(SEL, 0x3a32, 5).map((p, i) => [`department ${i} title (0x3a32[${i}])`, p]), ['candidates header (0x3a84)', w16(SEL, 0x3a84)],
  ['resume labels (0x3a9f)', w16(SEL, 0x3a9f)]])
  selScripts[name] = { addr: hex(a), items: script(SEL, a) };

const text = {
  _about: 'All game text. Addresses: PSI5/SEL = DS offset in the snapshot; files = byte offset. "\\n" = CR (0x0d, line break). ' +
    'codeRefs = functions using the address as operand (PSI5: re/psi5.lst; SEL: web/src/sel.js), ptrSlots = DS words pointing at it, ' +
    'ptrUsers = functions referencing a table that contains such a word. See docs/modern/model/data.md.',
  psi5: { strings: scan(PSI, [[0x0000, 0x1eb2], [0x239a, 0x3000], [0x32b0, 0x3500]], codeRefs, [[0, 0x3000], [0x3288, 0x3300], [0x6124, 0x6160]], 0x100), scripts: psiScripts,
    indicatorLetters: tbl(PSI, 0x3288, 5).map(p => ({ record: hex(p), x: PSI[p], y: PSI[p + 1], text: cstr(PSI, p + 4) })) },
  sel: {
    strings: scan(SEL, [[0x0000, 0x2d98], [0x3622, 0x3afc], [0xe600, 0xe830]], selRefs, [[0, 0x3622], [0x3800, 0x3afc], [0xe600, 0xe830]], 0x100), scripts: selScripts,
    departments: tbl(SEL, 0x28e, 5).map(a => cstr(SEL, a)),
    candidates: selNames.map((n, i) => ({ index: i, dept: Math.floor(i / 6), name: n, file: selFiles[i] + '.BIN', hotKey: String.fromCharCode(SEL[0x18a + i]),
      resume: Array.from({ length: 19 }, (_, k) => { const p = w16(SEL, 0x2d98 + (i * 19 + k) * 2); return { x: w16(SEL, 0x1aa + k * 2), y: w16(SEL, 0x1d2 + k * 2), addr: hex(p), text: cstr(SEL, p) }; }) })),
    courseFiles: tbl(SEL, 0xe79a, 4).map(a => cstr(SEL, a) + '.BIN'),
  },
  missions,
  crew: crewText,
};
// ---------------- tunes (ISR f_6ca9 / SEL @0ca9): tempo byte, then {duration, note} pairs, 0 duration = end ----------------
// one step = tempo+1 ticks of 120 Hz; the speaker goes off when (dur-1)>>3 steps are left; note 0 = rest;
// pitch = 1193182 / divisor[note] (table PSI5 0x3534 = SEL 0x3220, 84 entries)
const TUNE_USE = {
  0x00: 'Weapons selected (f_6868)', 0x02: 'Scanning selected (f_6868)', 0x04: 'Navigator selected (f_6868)', 0x06: 'Engineer selected (f_6868)',
  0x08: 'Repair selected (f_6868)', 0x0a: 'voyage start (main, f_6db1 interrupts)', 0x0c: 'dead department selected (f_6868); alarm (f_4922); game over (f_516d, interrupts)',
  0x0e: 'arrival (f_2cf2, interrupts)', 0x10: 'head switches to a talking department (f_693a)', 0x12: 'speed rising (f_2cf2)', 0x14: 'speed falling (f_2cf2)',
  0x16: 'message lamp on/off beep (f_66c0)', 0x18: 'intruder alert (f_671c)', 0x1a: 'missile fired (f_5d20 via 0x2f70[0])', 0x1c: 'blaster fired (0x2f70[1])',
  0x1e: 'cannon fired (0x2f70[2])', 0x20: 'thermo fired (0x2f70[3])', 0x22: 'enemy destroyed (f_6242)',
};
function tunes(buf, tableAddr, n, divAddr, use) {
  return Array.from({ length: n }, (_, i) => {
    const p = w16(buf, tableAddr + i * 2), tempo = buf[p], notes = [];
    for (let q = p + 1; buf[q]; q += 2) {
      const dur = buf[q], note = buf[q + 1], div = note < 84 ? w16(buf, divAddr + note * 2) : 0;
      notes.push({ note, hz: note && div ? +(1193182 / div).toFixed(2) : 0, midi: note && div ? Math.round(69 + 12 * Math.log2(1193182 / div / 440)) : null,
        steps: dur, ticks: dur * (tempo + 1), soundTicks: (dur - ((dur - 1) >> 3)) * (tempo + 1) });
    }
    return { id: hex(i * 2, 2), addr: hex(p), tempo, totalTicks: notes.reduce((s, x) => s + x.ticks, 0), usedBy: use[i * 2] ?? 'unused', notes };
  });
}
fs.writeFileSync(path.join(OUT, 'tunes.json'), JSON.stringify({
  _about: 'tick = 1/120 s. id = byte offset passed to the play functions. See docs/modern/model/data.md (Sound).',
  psi5: tunes(PSI, 0x35dc, 18, 0x3534, TUNE_USE),
  sel: tunes(SEL, 0xa3a6, 3, 0x3220, { 0: 'title screen', 2: 'every selection screen (course, department, resume, crew)', 4: 'unused (same as 2)' }),
}, null, 1));

fs.writeFileSync(path.join(OUT, 'text.json'),JSON.stringify(text, null, 1));
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ palette: PAL, pictures: index, stationAnimations: tracks, crew: crewIndex }, null, 1));
console.log(`${index.length} PNGs, ${text.psi5.strings.length} PSI5 strings, ${text.sel.strings.length} SEL strings, ${Object.keys(crewText).length} crew files -> ${OUT}`);
