// Remake UI: boot, screen flow (title → course → crew → summary → briefing → bridge → invoice), the 120 Hz game loop,
// settings. Game rules live in the engine (web/src/engine, docs/modern/GAME.md); this file only drives it.
import { Game } from '../../src/engine/game.js';
import * as presets from '../../src/engine/presets.js';
import { loadI18n, t, setLang, getLang, applyStatic, onLang } from './i18n.js';
import * as audio from './audio.js';
import { loadSprites } from './view.js';
import { ROOT, ASSETS, DEPTS, CANDIDATES, COURSES, crewFile, selPortrait, art, artImg, isArt, loadArtManifest, TUNE } from './data.js';
import { Bridge, openSheet, closeSheet } from './bridge.js';
import { Tutorial, TUTORIAL } from './tutorial.js';
import { Tips, openHelp, progress, saveProgress } from './help.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fetchBin = async n => { const r = await fetch(n); if (!r.ok) throw new Error(n + ': ' + r.status); return new Uint8Array(await r.arrayBuffer()); };

// ---------- settings ----------
const settings = { preset: 'modern', sound: true, volume: 0.5 };
try { Object.assign(settings, JSON.parse(localStorage.getItem('psi5r.settings') || '{}')); } catch {}
if (new URLSearchParams(location.search).has('mute')) settings.sound = false;   // ?mute=1: tests run silent (not saved unless changed)
const saveSettings = () => { try { localStorage.setItem('psi5r.settings', JSON.stringify(settings)); } catch {} };
// engine options for a preset: PRESETS (with balance) when the engine provides it, else the fix flags
export function gameOptions(name) {
  const p = presets.PRESETS?.[name];
  if (p) return p;
  return { fixes: name === 'original' ? presets.ORIGINAL : presets.MODERN };
}

// ---------- app state ----------
const app = { screen: 'loading', course: 0, crew: [null, null, null, null, null], deptStep: 0, image: null, files: {},
  game: null, bridge: null, running: false, endAt: 0, paused: false, tutorial: null, tips: new Tips(), tipAt: 0 };
window.psi5 = app;                                   // debugging handle (inspect state from the console)

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'scr-' + id));
  app.screen = id;
  $('#app').classList.toggle('in-bridge', id === 'bridge');
  render();
}
function render() {
  if (app.screen === 'course') renderCourses();
  if (app.screen === 'crew') renderCrew();
  if (app.screen === 'summary') renderSummary();
  if (app.screen === 'briefing') renderBriefing();
  if (app.screen === 'invoice') renderInvoice();
  if (app.screen === 'bridge') app.bridge?.relabel();
  renderSettings();
}

// ---------- course ----------
function renderCourses() {
  $('#course-list').innerHTML = COURSES.map((c, i) => `
    <button class="card course-card" data-act="course" data-i="${i}">
      <div class="planet" style="background-image:${isArt('map.course.' + i) ? `url('${art('map.course.' + i, '', 300)}'),` : ''} radial-gradient(circle at 35% 35%, hsl(${30 + i * 70} 70% 60%), hsl(${30 + i * 70} 60% 18%) 60%, #050818 62%)"></div>
      <div>
        <h3>${esc(t(`mission.${i}.destination`))}</h3>
        <dl>
          <dt>${esc(t('sel.col.cargo'))}</dt><dd>${esc(t(`mission.${i}.cargo`))}</dd>
          <dt>${esc(t('sel.col.distance'))}</dt><dd>${esc(t('sel.distance', { n: c.dist }))}</dd>
          <dt>${esc(t('sel.col.reward'))}</dt><dd>${esc(t('sel.reward', { m: c.reward }))}</dd>
          <dt>${esc(t('remake.course.danger'))}</dt><dd><span class="pips">${[1, 2, 3, 4].map(k => `<i class="${k <= c.danger ? 'on' : ''}"></i>`).join('')}</span></dd>
        </dl>
      </div>
    </button>`).join('');
}

// ---------- crew ----------
function renderCrew() {
  const d = app.deptStep;
  $('#crew-steps').innerHTML = DEPTS.map((n, i) => `<span class="step ${i === d ? 'cur' : ''}">${app.crew[i]
    ? `<img ${artImg('portrait.' + app.crew[i], selPortrait(app.crew[i]), 24)} alt="">` : '<span class="dot"></span>'}${esc(t(`dept.${n}.name`))}</span>`).join('');
  $('#crew-title').textContent = t('remake.crew.title', { dept: t(`dept.${DEPTS[d]}.name`) });
  $('#crew-grid').innerHTML = CANDIDATES[d].map(id => `
    <button class="card cand" data-act="cand" data-id="${id}">
      <img ${artImg('portrait.' + id, selPortrait(id), 170, 'face')} alt="">
      <div><h3>${esc(t(`crew.${id}.name`))}</h3><p>${esc(t(`resume.${id}.species`))}, ${esc(t(`resume.${id}.age`))}</p></div>
    </button>`).join('');
}
function openResume(id) {
  const f = k => esc(t(`resume.${id}.${k}`));
  openSheet(`<div class="resume">
      <img ${artImg('portrait.' + id, selPortrait(id), 0, 'face-sel')} alt="">
      <div><h3>${f('name')}</h3>
        <dl><dt>${esc(t('sel.resume.age'))}</dt><dd>${f('age')}, ${f('species')}</dd>
        <dt>${esc(t('sel.resume.qualifications'))}</dt><dd>${f('qualifications')}</dd>
        <dt>${esc(t('sel.resume.education'))}</dt><dd>${f('education')}</dd>
        <dt>${esc(t('sel.resume.experience'))}</dt><dd>${f('experience')}</dd>
        <dt>${esc(t('sel.resume.strengths'))}</dt><dd>${f('strengths')}</dd>
        <dt>${esc(t('sel.resume.weakness'))}</dt><dd>${f('weakness')}</dd></dl>
      </div></div>
    <div class="foot"><button class="btn ghost" data-act="closeSheet">${esc(t('sel.exit'))}</button>
      <button class="btn primary" data-act="hire" data-id="${id}">${esc(t('sel.welcome'))}</button></div>`, true);
}
function renderSummary() {
  $('#summary-course').textContent = t('remake.briefing.course', { destination: t(`mission.${app.course}.destination`), cargo: t(`mission.${app.course}.cargo`) });
  $('#summary-grid').innerHTML = DEPTS.map((n, i) => { const id = app.crew[i]; return `
    <div class="card"><img ${artImg('portrait.' + id, selPortrait(id), 200, 'face-sel')} alt="">
      <h3>${esc(t(`crew.${id}.name`))}</h3><p>${esc(t(`dept.${n}.name`))}</p></div>`; }).join('');
}

// ---------- briefing / game start ----------
function renderBriefing() {
  const ba = art('briefing.admiral', '', 360);
  $('#briefing-art').style.backgroundImage = ba ? `url('${ba}')` : '';
  $('#briefing-course').textContent = t('remake.briefing.course', { destination: t(`mission.${app.course}.destination`), cargo: t(`mission.${app.course}.cargo`) });
}
async function startMission(tutorial = false) {
  endTutorial();
  const need = [COURSES[app.course].file, ...app.crew.map(crewFile)];
  await Promise.all(need.filter(n => !app.files[n]).map(async n => { app.files[n] = await fetchBin(ROOT + n); }));
  const game = new Game({ image: app.image, ...gameOptions(tutorial ? TUTORIAL.preset : settings.preset),
    emit: (type, ...a) => { app.bridge?.event(type, ...a); app.tips.event(type, ...a); } });
  game.newMission({ missionFile: app.files[COURSES[app.course].file], crewFiles: app.crew.map(id => app.files[crewFile(id)]),
    flags: { demo: false, sound: 1, joystick: 0 } });
  app.game = game; app.endAt = 0; app.paused = false;
  app.bridge = new Bridge({ game, course: app.course, crew: app.crew, root: $('#scr-bridge'), onPause: pause });
  app.running = true; app.tips.reset();
  if (!tutorial) { show('briefing'); return; }
  // training run: no briefing wait (it would draw random numbers), a fixed start so the run is the same every time
  for (let i = 0; i < 60; i++) game.tick();
  app.tutorial = new Tutorial({ game, bridge: app.bridge, onEnd: (done, toTitle) => {
    app.tutorial = null;
    if (done) {                                   // the run already taught these: no tip for them later
      progress.tutorial = 'done';
      for (const id of ['contact', 'hostile', 'power']) if (!progress.seen.includes(id)) progress.seen.push(id);
      saveProgress();
    }
    if (toTitle) ACTIONS.abandon();
  } });
  begin();
}
function startTutorial() {
  $('#ov-offer').hidden = true; $('#ov-settings').hidden = true; $('#ov-pause').hidden = true; closeSheet();
  app.paused = false; app.course = TUTORIAL.course; app.crew = [...TUTORIAL.crew];
  startMission(true).catch(err);
}
function endTutorial() { const tu = app.tutorial; app.tutorial = null; tu?.end(false); }
function begin() {
  app.game.commands.begin();
  show('bridge');
  app.bridge.start();
}

// ---------- pause / settings ----------
function pause() {
  if (!app.game || app.paused || app.game.over) return;
  app.paused = true; app.game.commands.pause(); $('#ov-pause').hidden = false;
}
function resume() {
  if (!app.paused) return;
  app.paused = false; app.game.commands.resume(); $('#ov-pause').hidden = true;
}
function renderSettings() {
  document.querySelectorAll('[data-tips]').forEach(b => b.classList.toggle('on', (b.dataset.tips === '1') === !progress.tipsOff));
  $('#set-tutorial').hidden = !!(app.game && !app.game.over && app.screen === 'bridge');
  document.querySelectorAll('[data-lang]').forEach(b => b.classList.toggle('on', b.dataset.lang === getLang()));
  document.querySelectorAll('[data-preset]').forEach(b => b.classList.toggle('on', b.dataset.preset === settings.preset));
  document.querySelectorAll('[data-sound]').forEach(b => b.classList.toggle('on', (b.dataset.sound === '1') === settings.sound));
  $('#volume').value = settings.volume;
}

// ---------- invoice ----------
function renderInvoice() {
  const b = app.bridge;
  if (b) $('#invoice').innerHTML = b.invoiceHtml();
}

// ---------- the loop: every 120 Hz tick due by the wall clock, at most 0.25 s of catch-up ----------
let last = performance.now(), acc = 0;
const SPEED = Math.min(32, Math.max(1, +new URLSearchParams(location.search).get('speed') || 1));   // debug: ?speed=N runs N× real time
function frame(now) {
  const g = app.game;
  if (g && app.running) {
    const tu = app.tutorial, rate = SPEED * (tu ? tu.rate() : 1);
    acc += (now - last) * 0.12 * rate;
    if (acc > 30 * rate) acc = 30 * rate;
    while (acc >= 1) {
      if (tu && !tu.canTick()) { acc = 0; break; }
      g.tick(); acc -= 1; tu?.ticked();
    }
    if (g.over && !app.endAt) { app.endAt = now; app.bridge.ended(); }
  }
  last = now;
  if (app.screen === 'bridge' || app.screen === 'briefing') app.bridge?.frame(now);
  if (app.screen === 'bridge') app.tutorial?.frame();
  // first-time tips: normal play only, every 0.5 s
  if (g && app.screen === 'bridge' && !app.tutorial && !app.paused && $('#sheet').hidden && !g.over && app.bridge?.departed && now - app.tipAt > 500) { app.tipAt = now; app.tips.check(g.state); }
  requestAnimationFrame(frame);
}

// ---------- input ----------
const ACTIONS = {
  new: () => { app.crew = [null, null, null, null, null]; show('course'); },
  settings: () => { if (app.screen === 'bridge') pause(); $('#ov-settings').hidden = false; renderSettings(); },
  closeSettings: () => { $('#ov-settings').hidden = true; },
  toTitle: () => show('title'),
  course: e => { app.course = +e.dataset.i; app.deptStep = 0; show('crew'); },
  cand: e => openResume(e.dataset.id),
  closeSheet,
  hire: e => {
    closeSheet(); app.crew[app.deptStep] = e.dataset.id;
    audio.play(TUNE.deptJingle(app.deptStep));
    if (app.deptStep < 4) { app.deptStep++; renderCrew(); } else show('summary');
  },
  crewBack: () => { if (app.deptStep > 0) { app.deptStep--; renderCrew(); } else show('course'); },
  reselect: () => { app.crew = [null, null, null, null, null]; show('course'); },
  accept: () => startMission().catch(err),
  begin,
  toInvoice: () => { endTutorial(); app.tips.reset(); app.running = false; show('invoice'); },
  tutorial: startTutorial,
  offerLater: () => { $('#ov-offer').hidden = true; progress.tutorial = 'declined'; saveProgress(); },
  howto: () => { if (app.screen === 'bridge') pause(); openHelp(-1); },
  help: e => { if (app.screen === 'bridge') pause(); openHelp(+e.dataset.d); },
  resume,
  abandon: () => { endTutorial(); app.tips.reset(); $('#ov-pause').hidden = true; app.paused = false; app.running = false; app.game = null; app.bridge = null; show('title'); },
  sameCrew: () => startMission().catch(err),
  newCrew: () => { app.crew = [null, null, null, null, null]; show('course'); },
};
document.addEventListener('click', e => {
  audio.unlock();
  const lang = e.target.closest('[data-lang]');
  if (lang) { setLang(lang.dataset.lang); return; }
  const pr = e.target.closest('[data-preset]');
  if (pr) { settings.preset = pr.dataset.preset; saveSettings(); renderSettings(); return; }
  const tp = e.target.closest('[data-tips]');
  if (tp) { progress.tipsOff = tp.dataset.tips !== '1'; if (progress.tipsOff) app.tips.hide(); saveProgress(); renderSettings(); return; }
  const snd = e.target.closest('[data-sound]');
  if (snd) { settings.sound = snd.dataset.sound === '1'; audio.setSound(settings.sound, settings.volume); saveSettings(); renderSettings(); return; }
  if (e.target.id === 'sheet') { closeSheet(); return; }
  const a = e.target.closest('[data-act]');
  if (a && ACTIONS[a.dataset.act]) { ACTIONS[a.dataset.act](a, e); return; }
  if (a && app.bridge) app.bridge.action(a, e);
});
$('#volume').addEventListener('input', e => { settings.volume = +e.target.value; audio.setSound(settings.sound, settings.volume); saveSettings(); });
document.addEventListener('keydown', e => {
  audio.unlock();
  if (app.screen === 'briefing' && e.key === 'Enter') { begin(); return; }
  if (app.screen !== 'bridge') { if (e.key === 'Escape') { closeSheet(); $('#ov-settings').hidden = true; } return; }
  if (e.key === 'Escape' || e.key === ' ') { e.preventDefault(); if (!$('#sheet').hidden) closeSheet(); else if (app.paused) resume(); else pause(); }
  else if (/^[1-5]$/.test(e.key)) app.bridge?.selectTab(+e.key - 1);
});
document.addEventListener('visibilitychange', () => { if (document.hidden && app.screen === 'bridge' && !app.tutorial) pause(); });
onLang(() => render());

function err(e) { console.error(e); const d = document.createElement('div'); d.className = 'toast'; d.textContent = String(e.message || e); $('#toasts').append(d); }

// ---------- boot ----------
async function boot() {
  await loadI18n();
  applyStatic();
  audio.setSound(settings.sound, settings.volume);
  await Promise.all([
    fetchBin('../data/psi5_ds.bin').then(b => { app.image = b; }),
    audio.loadTunes(ASSETS + 'tunes.json'),
    loadSprites(ASSETS),
    loadArtManifest(),
  ]);
  // screen backgrounds: CSS variables, so each image is fetched only when its screen is shown
  const box = Math.max(innerWidth, innerHeight * 16 / 9);          // a 16:9 picture covering the viewport
  $('#scr-title').style.setProperty('--art', `url('${art('bg.title', ASSETS + 'sel/title.png', box)}')`);
  $('#scr-title').classList.toggle('has-art', isArt('bg.title'));
  for (const [id, w] of [['bg.select', box], ['ui.invoice', 720], ['ui.bezel', 0]]) if (isArt(id)) {
    $('#app').classList.add('art-' + id.split('.')[1]); $('#app').style.setProperty('--' + id.replace('.', '-'), `url('${art(id, '', w)}')`);
  }
  if (isArt('logo')) $('#scr-title .logo').innerHTML = `<img class="art" src="${art('logo', '', Math.min(innerWidth * 0.9, 800))}" alt="PSI 5 Trading Company">`;
  show('title');
  if (!progress.tutorial) $('#ov-offer').hidden = false;          // first launch: offer the training run
  requestAnimationFrame(frame);
}
boot().catch(err);
