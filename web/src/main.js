// Browser driver for the 1:1 port: runs PSIBAS's loop (SEL.EXE, then PSI5.EXE, ...) in real time.
// The port only advances at idle points (see rt.js); here every timer interrupt that is due by the wall clock is
// delivered (rt.tick) and the program is resumed to its next idle point. Video = CGA frame from VRAM, audio = PC speaker.
import * as rt from './rt.js';
import * as SEL from './sel.js';

const GAME = 'game/';                // original data files (copied from the game directory)
const DATA_FILES = ['SELECT.BIN', 'MISN1.BIN', 'MISN2.BIN', 'MISN3.BIN', 'MISNA.BIN', 'ALZOTT.BIN', 'ANXY.BIN', 'AYMU.BIN', 'BLUSTAN.BIN',
  'BORIS.BIN', 'BRONX.BIN', 'BRU.BIN', 'BRUN.BIN', 'CHURGLK.BIN', 'CRAVEN.BIN', 'DASH.BIN', 'FLIGRNK.BIN', 'GROLO.BIN', 'JARU.BIN', 'KLG.BIN',
  'MIKE.BIN', 'NARGO.BIN', 'NIK.BIN', 'PHYZO.BIN', 'Q6D.BIN', 'RYBLO.BIN', 'SHEEMA.BIN', 'SKULARD.BIN', 'SWIGLTZ.BIN', 'T3.BIN', 'TEGRA.BIN',
  'TONY.BIN', 'VOFGANK.BIN', 'VX4.BIN', 'WILFO.BIN', 'YEELA.BIN', 'YENX.BIN'];
const PIT_HZ = 1193182;
const canvas = document.getElementById('screen'), ctx = canvas.getContext('2d'), img = ctx.createImageData(320, 200);
const status = document.getElementById('status');
const fetchBin = async url => { const r = await fetch(url); if (!r.ok) throw new Error(url + ': ' + r.status); return new Uint8Array(await r.arrayBuffer()); };

let PSI5 = null;                    // loaded lazily (the PSI5 port may still be incomplete)
const snaps = {};
let gen = null, prog = null, vt = 0, t0 = 0, quit = false;

function saveSelect() { try { localStorage.setItem('psi5.SELECT.BIN', btoa(String.fromCharCode(...rt.hw.files['SELECT.BIN']))); } catch {} }
function start(name) {
  prog = name;
  if (name === 'SEL.EXE') gen = rt.load(SEL, snaps.sel);
  else gen = rt.load(PSI5, snaps.psi5);
  step();
}
// run the program to its next idle point; handle program exit (PSIBAS: SEL -> PSI5 -> SEL ..., until PSI5 exits with 3)
function step() {
  let code = null;
  try { if (gen.next().done) code = 0; } catch (e) { if (e instanceof rt.Exit) code = e.code; else throw e; }
  if (code === null) return;
  saveSelect();
  if (prog === 'PSI5.EXE' && code === 3) { quit = true; status.textContent = 'Program ended.'; return; }
  if (prog === 'SEL.EXE' && !PSI5) { quit = true; status.textContent = 'PSI5.EXE port not available.'; return; }
  start(prog === 'SEL.EXE' ? 'PSI5.EXE' : 'SEL.EXE');
}

// ---------- audio: PC speaker as a square wave, scheduled from the speaker log ----------
let audio = null, osc = null, gain = null, spkSeen = 0, audioOff = 0;
function initAudio() {
  if (audio) return;
  audio = new AudioContext(); osc = audio.createOscillator(); gain = audio.createGain();
  osc.type = 'square'; gain.gain.value = 0; osc.connect(gain).connect(audio.destination); osc.start();
  audioOff = audio.currentTime - performance.now() / 1000 + 0.05;
}
function flushAudio(times) {
  const log = rt.hw.spk;
  for (const [tick, f] of log) {
    if (!audio) continue;
    const at = Math.max(audio.currentTime, times.get(tick) ?? audio.currentTime);
    if (f > 20 && f < 20000) { osc.frequency.setValueAtTime(f, at); gain.gain.setValueAtTime(0.08, at); } else gain.gain.setValueAtTime(0, at);
  }
  log.length = 0;
}

// ---------- keyboard -> BIOS key words ----------
const SCAN = { Escape: 0x01, Backspace: 0x0e, Tab: 0x0f, Enter: 0x1c, Space: 0x39, ArrowUp: 0x48, ArrowDown: 0x50, ArrowLeft: 0x4b,
  ArrowRight: 0x4d, Home: 0x47, End: 0x4f, PageUp: 0x49, PageDown: 0x51, Insert: 0x52, Delete: 0x53,
  F1: 0x3b, F2: 0x3c, F3: 0x3d, F4: 0x3e, F5: 0x3f, F6: 0x40, F7: 0x41, F8: 0x42, F9: 0x43, F10: 0x44 };
const LETTER_SCAN = 'qwertyuiop'.split('').map((c, i) => [c, 0x10 + i]).concat('asdfghjkl'.split('').map((c, i) => [c, 0x1e + i]), 'zxcvbnm'.split('').map((c, i) => [c, 0x2c + i]));
const LS = Object.fromEntries(LETTER_SCAN);
addEventListener('keydown', e => {
  initAudio();
  if (e.metaKey || (e.ctrlKey && !/^Key[A-Z]$/.test(e.code))) return;
  let ascii = 0, scan = 0;
  if (e.ctrlKey && /^Key[A-Z]$/.test(e.code)) { const c = e.code[3].toLowerCase(); ascii = c.charCodeAt(0) & 31; scan = LS[c]; }
  else if (e.key === 'Enter') { ascii = 13; scan = 0x1c; }
  else if (e.key === 'Escape') { ascii = 27; scan = 1; }
  else if (e.key === 'Backspace') { ascii = 8; scan = 0x0e; }
  else if (e.key === 'Tab') { ascii = 9; scan = 0x0f; }
  else if (e.key.length === 1 && e.key.charCodeAt(0) < 128) { ascii = e.key.charCodeAt(0); scan = LS[e.key.toLowerCase()] || 0; }
  else if (SCAN[e.key]) scan = SCAN[e.key];
  else return;
  e.preventDefault();
  rt.hw.keys.push((scan << 8) | ascii);
});

// ---------- main loop ----------
function frame() {
  if (!quit) {
    const now = performance.now(), times = new Map();
    let target = (now - t0) / 1000 * PIT_HZ, n = 0;
    if (target - vt > PIT_HZ / 4) vt = target - PIT_HZ / 4;          // tab was hidden: don't fast-forward minutes
    while (!quit && vt + rt.hw.pitDiv[0] <= target && n++ < 600) {
      vt += rt.hw.pitDiv[0];
      rt.tick(); times.set(rt.hw.ticks, t0 / 1000 + vt / PIT_HZ + audioOff);
      step();
    }
    flushAudio(times);
  }
  const f = rt.frame16(), d = img.data;
  for (let i = 0; i < 64000; i++) { const p = rt.CGA_RGB[f[i]]; d[i * 4] = p[0]; d[i * 4 + 1] = p[1]; d[i * 4 + 2] = p[2]; d[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  requestAnimationFrame(frame);
}

async function boot() {
  status.textContent = 'Loading…';
  [snaps.sel, snaps.psi5] = await Promise.all([fetchBin('data/sel_ds.bin'), fetchBin('data/psi5_ds.bin')]);
  rt.resetMachine();
  const files = {};
  await Promise.all(DATA_FILES.map(async n => { files[n] = await fetchBin(GAME + n); }));
  try { const s = localStorage.getItem('psi5.SELECT.BIN'); if (s) files['SELECT.BIN'] = Uint8Array.from(atob(s), c => c.charCodeAt(0)); } catch {}
  rt.hw.files = files;
  try { PSI5 = await import('./psi5/index.js'); if (!PSI5.F.f_0082) PSI5 = null; } catch (e) { console.warn('PSI5 port not loaded', e); PSI5 = null; }
  status.textContent = 'Click or press a key for sound. Ctrl+Q / Ctrl+S: sound off / on.';
  t0 = performance.now(); vt = 0;
  start('SEL.EXE');
  requestAnimationFrame(frame);
}
canvas.addEventListener('click', initAudio);
boot().catch(e => { status.textContent = 'Error: ' + e.message; throw e; });
