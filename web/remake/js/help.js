// Help: "How to play" sheet, per-department help ("?" in every panel), first-time tips during normal play, and the
// saved progress (tutorial done/declined, tips seen, tips off) in localStorage (docs/remake/UI.md §2.14–2.15).
import { t } from './i18n.js';
import { DEPTS } from './data.js';
import { openSheet } from './bridge.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- progress ----------
export const progress = { tutorial: '', seen: [], tipsOff: false };
try { Object.assign(progress, JSON.parse(localStorage.getItem('psi5r.help') || '{}')); } catch {}
export function saveProgress() { try { localStorage.setItem('psi5r.help', JSON.stringify(progress)); } catch {} }

// ---------- help sheets ----------
const deptHelp = d => {
  const k = DEPTS[d];
  return `<h3>${esc(t(`dept.${k}.name`))}</h3><dl class="help-dl">
    <dt>${esc(t('remake.help.what'))}</dt><dd>${esc(t(`remake.help.${k}.what`))}</dd>
    <dt>${esc(t('remake.help.controls'))}</dt><dd>${esc(t(`remake.help.${k}.controls`))}</dd>
    <dt>${esc(t('remake.help.tips'))}</dt><dd>${esc(t(`remake.help.${k}.tips`))}</dd></dl>`;
};
const close = () => `<div class="foot"><button class="btn primary" data-act="closeSheet">${esc(t('remake.close'))}</button></div>`;
export function openHelp(d) {
  if (d >= 0) { openSheet(`<div class="help">${deptHelp(d)}</div>${close()}`); return; }
  const sec = k => `<h3>${esc(t(`remake.help.${k}.title`))}</h3><p>${esc(t(`remake.help.${k}.text`))}</p>`;
  openSheet(`<h2>${esc(t('remake.help.title'))}</h2><div class="help">${sec('goal')}${sec('bridge')}${sec('msg')}${DEPTS.map((_, i) => deptHelp(i)).join('')}</div>${close()}`, true);
}

// ---------- first-time tips ----------
const anyOf = a => Array.prototype.some.call(a, Boolean);
const TIPS = [
  ['contact', S => anyOf(S.contactClass)],
  ['hostile', S => anyOf(S.contactHostile)],
  ['hit', (S, ev) => ev.hit],
  ['power', S => S.gaugeBars > Math.max(0, S.gaugeLevel)],
  ['destroyed', S => anyOf(S.destroyed)],
  ['stressed', S => anyOf(S.deptStress)],
  ['dead', S => !Array.prototype.every.call(S.deptAlive, Boolean)],
  ['late', S => S.etaState === 2],
  ['cargo', S => S.cargo < 100],
];
export class Tips {
  constructor() { this.ev = {}; this.queue = []; this.el = null; }
  event(type, a) { if (type === 'border' && a === 0x2f) this.ev.hit = true; }
  reset() { this.ev = {}; this.queue = []; this.hide(); }
  check(S) {
    if (progress.tipsOff) return;
    for (const [id, cond] of TIPS) if (!progress.seen.includes(id) && !this.queue.includes(id) && cond(S, this.ev)) this.queue.push(id);
    if (!this.el && this.queue.length) this.show(this.queue.shift());
  }
  show(id) {
    progress.seen.push(id); saveProgress();
    const d = this.el = document.createElement('div');
    d.className = 'tip'; d.setAttribute('role', 'status');
    d.innerHTML = `<div class="tip-head"><span class="coach-ava" aria-hidden="true"></span><b>${esc(t('remake.tips.title'))}</b></div>
      <p>${esc(t('remake.tips.' + id))}</p>
      <div class="tip-foot"><button class="btn ghost small" data-tip="off">${esc(t('remake.tips.off'))}</button><button class="btn primary small" data-tip="ok">${esc(t('remake.tips.ok'))}</button></div>`;
    d.addEventListener('click', e => {
      const b = e.target.closest('[data-tip]');
      if (!b) return;
      if (b.dataset.tip === 'off') { progress.tipsOff = true; saveProgress(); this.queue = []; }
      this.hide();
    });
    $('#app').append(d);
  }
  hide() { this.el?.remove(); this.el = null; }
}
