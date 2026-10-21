// Static game data the UI needs to name things (all text goes through i18n keys) and asset locations.
export const ROOT = '../game/';                       // original data files (MISN*.BIN, crew *.BIN)
export const ASSETS = '../orig/';                       // original sprites/portraits/tunes (from tools/extract_assets.mjs)
export const DEPTS = ['weapons', 'scanning', 'navigation', 'engineering', 'repair'];

// candidates per department in the SEL order (crew file = id.toUpperCase() + '.BIN', i18n crew.<id> / resume.<id> / msg.<id>)
export const CANDIDATES = [
  ['boris', 'q6d', 'yeela', 'alzott', 'skulard', 'grolo'],
  ['jaru', 'phyzo', 'blustan', 'nargo', 'churglk', 'mike'],
  ['klg', 'tegra', 'nik', 'bronx', 'aymu', 'yenx'],
  ['craven', 'wilfo', 'tony', 'fligrnk', 'sheema', 'vx4'],
  ['anxy', 't3', 'vofgank', 'ryblo', 'bru', 'swigltz'],
];
const SEL_NAMES = ['Boris', 'Q6D', 'Yeela', 'Al', 'Skulard', 'Grolo', 'Jaru', 'Phyzo', 'Blustan', 'Nargo', 'Churglik', 'Mike', 'KLG7A',
  'Tegra', 'Nik', 'Bronxaag', 'Aymu', 'Yenx', 'Craven', 'Wilfo', 'Anthony', 'Fligronk', 'Sheema', 'VX4', 'Anxy', 'T3XR9', 'Volfgank',
  'Ryblo', 'Bru', 'Swiglitz'];
export const crewFile = id => id.toUpperCase() + '.BIN';
export function selPortrait(id) {
  const n = CANDIDATES.flat().indexOf(id);
  return `${ASSETS}sel/portrait_${String(n).padStart(2, '0')}_${SEL_NAMES[n]}.png`;
}
export const facePortrait = id => `${ASSETS}crew/${id.toUpperCase()}_face.png`;

// courses: SEL order (course 1..4), mission file, SEL distance (parsecs) / reward (M$), danger 1..4 (for the pips)
export const COURSES = [
  { file: 'MISNA.BIN', dist: 60, reward: 7, danger: 1 },
  { file: 'MISN1.BIN', dist: 120, reward: 12, danger: 2 },
  { file: 'MISN2.BIN', dist: 208, reward: 30, danger: 3 },
  { file: 'MISN3.BIN', dist: 300, reward: 50, danger: 4 },
];
// contact class names per course (mission file type table), as i18n ship.<name>.one/many
export const SHIP_NAMES = [
  ['unknown', 'zeltoad', 'frisina', 'kiffbok', 'narvik', 'skront', 'flarkin', 'snograt', 'scout', 'shuttle', 'other'],
  ['unknown', 'xantog', 'zeltoad', 'kiffbok', 'narvik', 'skront', 'flarkin', 'lepsor', 'scout', 'prato', 'other'],
  ['unknown', 'crogon', 'zeltoad', 'waskul', 'narvik', 'skront', 'flarkan', 'snograt', 'shuttle', 'rybil', 'other'],
  ['unknown', 'chianx', 'trantot', 'waskul', 'narvik', 'wosk', 'flarkan', 'muurdan', 'shuttle', 'sooly', 'other'],
];
export const WEAPONS = ['missiles', 'blasters', 'cannons', 'thermos'];
// the 26 ship systems (sysState index) and the 12 engineering devices (A..L = systems 0..11)
export const SYSTEMS = ['foreShield', 'portShield', 'starShield', 'aftShield', 'missileSys', 'blasterSys', 'cannonSys', 'thermoSys',
  'engine1', 'engine2', 'infScanner', 'emergBatt', 'shieldBatt', 'trackLock', 'reactor1', 'reactor2', 'robodroid2', 'robodroid5',
  'robodroid7', 'portRetros', 'starRetros', 'cargoEnvir', 'cargoStab', 'engLifeSup', 'navLifeSup', 'cravenlator'];
export const DEVICES = ['foreShield', 'portShield', 'starShield', 'aftShield', 'missiles', 'blaster', 'cannons', 'thermos', 'engine1',
  'engine2', 'infScanner', 'emergBatt'];
export const POWER_CLASSES = ['A', 'B', 'C', 'D', 'E', 'F'];
export const COURSE_LETTERS = ['A', 'B', 'C', 'D', 'E'];
export const NAV_STATES = ['standard', 'evasive', 'stopped', 'changing'];
export const ORDER_STATUS = ['broken', 'noPower', 'needLock', 'outRange', 'inRange'];
export const DEV_STATES = ['off', 'powerUp', 'on', 'powerDown'];
export const DEV_POWER = ['none', 'partial', 'full'];
export const ETA_STATES = ['unknown', 'early', 'late'];

// tunes (docs/modern/assets/tunes.json ids)
export const TUNE = { deptJingle: d => d * 2, dead: 0x0c, departure: 0x0a, head: 0x10, lamp: 0x16 };

// art slots (docs/remake/ART_SLOTS.json): web/remake/art/manifest.json = { id: { w, h, s } } (tools/remake_art.py export).
// Every slot has art/<id>.webp; s > 0: also art/<id>.s.webp, s px wide, for small boxes (phones, console heads).
// One lookup for every screen: the original sprite/placeholder is used only when the id is not in the manifest.
let manifest = {};
export async function loadArtManifest() {
  try { const r = await fetch('art/manifest.json'); if (r.ok) { const m = await r.json(); if (!Array.isArray(m)) manifest = m; } } catch {}
}
export const isArt = id => Object.hasOwn(manifest, id);
// URL for slot `id` drawn in a box about `cssW` CSS px wide (0 = full size): the small file when it is sharp enough at
// the device pixel ratio (capped at 2, phones at 3x do not need more), else the full one; `fallback` without art.
export function art(id, fallback = '', cssW = 0) {
  const m = manifest[id];
  if (!m) return fallback;
  return m.s && cssW && cssW * Math.min(2, devicePixelRatio || 1) <= m.s * 1.25 ? `art/${id}.s.webp` : `art/${id}.webp`;
}
// <img> attributes for a slot: class "art" (smooth, cover) or "px" (pixelated original)
export const artImg = (id, fallback, cssW, cls = '') => `class="${cls} ${isArt(id) ? 'art' : 'px'}" src="${art(id, fallback, cssW)}"`;
// portrait by officer state: dead / stressed variant when it exists, else the calm portrait (base id)
export function portraitId(id, { dead, stressed } = {}) {
  const v = dead ? '.dead' : stressed ? '.stressed' : '';
  return v && isArt(`portrait.${id}${v}`) ? `portrait.${id}${v}` : `portrait.${id}`;
}
// decoded images for the canvas and for warming the cache: loaded once per URL, on first use
const images = new Map();
export function artImage(id, cssW = 0) {
  if (!isArt(id)) return null;
  const url = art(id, '', cssW);
  let im = images.get(url);
  if (!im) { im = new Image(); im.decoding = 'async'; im.src = url; images.set(url, im); }
  return im;
}
export const preload = list => list.forEach(([id, w]) => artImage(id, w));
