// Training run ("Учебный рейс", docs/remake/UI.md §2.14): a fixed crew on course 1 under the Modern rules, coach marks
// by the ship's computer over the real bridge UI. The engine clock is frozen while a mark is shown and runs only while
// the player's order is being processed (×8) or during a "⏩" wait (fast-forward ×64, the fight ×16). A wait never
// stalls: its box says what we wait for and how far it got, has a «Дальше ⏩» button, and after a short cap (game
// ticks, normally ~2 s real, or WAIT_REAL ms of real time, whichever comes first) the tutorial nudges the engine so
// the lesson happens (tutorial only, listed in UI.md): finish the scan, spawn the pirate, turn it hostile, keep it in
// range, destroy it; plus the training fault for the Repair step. Without a nudge the run is the same every time.
import { t } from './i18n.js';
import { DEPTS, WEAPONS, SHIP_NAMES, SYSTEMS } from './data.js';

export const TUTORIAL = { course: 0, crew: ['boris', 'jaru', 'tegra', 'craven', 'anxy'], preset: 'modern' };
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const L = n => String.fromCharCode(65 + n);
const WARMUP = 240, FF = 64, FIGHT = 16, ORDER_RATE = 8;   // an order's "Processing command" (100 ticks) takes ~0.1 s
const WAIT_TICKS = 120 * 150, WAIT_REAL = 6000;          // a wait's cap: 2.5 game minutes (~2.3 s at ×64) or 6 s real
const PIRATE = 3, PIRATE_LAST = 7;                       // Kiffbok (course 1); classes 1..7 are pirates
const FAULT_SYS = SYSTEMS.indexOf('cargoEnvir');
const isPhone = () => getComputedStyle($('#tabbar')).display !== 'none';
const idx = (S, c) => Array.from(S.priority).indexOf(c);

export class Tutorial {
  constructor({ game, bridge, onEnd }) {
    Object.assign(this, { game, bridge, onEnd });
    this.i = -1; this.warm = 0; this.a = -1; this.b = -1; this.slot = -1; this.waited = 0; this.key = ''; this.killed = false; this.forced = [];
    this.root = document.createElement('div');
    this.root.id = 'coach';
    this.root.innerHTML = '<div class="coach-shade"></div><div class="coach-spot"></div><div class="coach-arrow"></div><div class="coach-box" role="dialog" aria-live="polite"></div>';
    $('#app').append(this.root);
    this.guard = e => this.block(e);
    for (const ev of ['click', 'pointerdown', 'keydown']) window.addEventListener(ev, this.guard, true);
    this.root.addEventListener('click', e => {
      const b = e.target.closest('[data-tut]');
      if (!b) return;
      const k = b.dataset.tut;
      if (k === 'next') this.go(this.i + 1);
      else if (k === 'ff') this.ff();
      else if (k === 'fix') { this.step.fix(); this.key = ''; }
      else if (k === 'skip' || k === 'continue') this.end(true);
      else if (k === 'title') this.end(true, true);
    });
    this.steps = this.script();
    this.fireAt = this.steps.findIndex(s => s.id === 'fire');
  }
  get S() { return this.game.state; }
  get step() { return this.steps[this.i]; }
  pending() { return this.game.queue.length > 0 || this.bridge.busy > 0; }

  // ---------- the script ----------
  script() {
    const S = () => this.S;
    const ship = c => t(`ship.${SHIP_NAMES[TUTORIAL.course][S().contactIdClass[c]] || 'other'}.one`);
    const weak = c => t(`weapon.${WEAPONS[Math.max(0, S().contactWeaknessKnown[c] - 1)]}`);
    const sheetHas = sel => !$('#sheet').hidden && !!$('#sheet-body ' + sel);
    const examine = (id, who) => ({ id, text: () => t(`remake.tutorial.${id}`, { letter: L(this[who]), examine: t('remake.action.examine') }),
      tab: 1, target: () => `#p-scanning [data-act="examine"][data-t="${this[who]}"]`, allow: [() => `#p-scanning [data-act="examine"][data-t="${this[who]}"]`],
      done: s => s.contactListed[this[who]], skip: s => this[who] < 0 || !s.contactClass[this[who]] || s.contactListed[this[who]] });
    return [
      { id: 'welcome', next: true, params: () => ({ destination: t('mission.0.destination') }) },
      { id: 'strip', target: '#strip', next: true },
      { id: 'view', target: '#viewscreen', next: true },
      { id: 'depts', target: () => isPhone() ? '#tabbar' : '#panels', next: true,
        text: () => t('remake.tutorial.depts') + (isPhone() ? ' ' + t('remake.tutorial.depts.phone') : '') },
      { id: 'eng', tab: 3, target: '#p-engineering [data-list="power"]', allow: ['#p-engineering [data-list="power"]'],
        params: () => ({ engines: t('power.class.C') }), done: s => s.priority[0] === 2 },
      { id: 'speed', tab: 2, target: '#p-navigation .throttle', allow: ['#p-navigation [data-act="speed"][data-v="8"]'], done: s => s.reqSpeed === 8 },
      { id: 'evasive', tab: 2, target: '#p-navigation [data-act="evasive"]', next: true },
      { id: 'runContact', run: () => this.contact(-1) >= 0, after: () => { this.a = this.contact(-1); },
        force: () => this.spawn(8), progress: s => t('remake.tutorial.prog.flight', { pos: s.pos, min: s.minutes }) },
      { id: 'contact', target: '#viewscreen', next: true, params: () => ({ letter: L(this.a) }), skip: () => this.a < 0 },
      { id: 'runMsg', run: s => s.msgCount.some(n => n > 0), progress: () => t('remake.tutorial.prog.msg') },
      { id: 'msg', target: '#console [data-act="nextMsg"]', allow: ['#console [data-act="nextMsg"]', '#console [data-act="ack"]'],
        params: () => ({ next: t('remake.msg.next') }), done: s => !this.msgBefore || s.msgCount.reduce((x, y) => x + y, 0) < this.msgBefore,
        enter: s => { this.msgBefore = s.msgCount.reduce((x, y) => x + y, 0); }, skip: s => !s.msgCount.some(n => n > 0) },
      { id: 'slow', tab: 2, target: '#p-navigation .throttle', allow: ['#p-navigation [data-act="speed"][data-v="2"]', '#p-navigation [data-act="speed"][data-v="1"]'],
        done: s => s.reqSpeed === 1 || s.reqSpeed === 2 },
      // the new speed takes a moment, then Engineering shares the power out again: check Scanners and Weapons got some
      { id: 'runPower', run: s => s.speed === s.reqSpeed && this.waited >= 360, ticks: 120 * 60, progress: s => t('remake.tutorial.prog.speed', { speed: s.speed, req: s.reqSpeed }) },
      { id: 'power', tab: 3, target: '#p-engineering [data-list="power"]', allow: ['#p-engineering [data-list="power"]'], skip: s => this.powered(s),
        params: () => ({ who: this.starved().join(', '), e: t('power.class.E'), f: t('power.class.F'), fix: t('remake.tutorial.fixIt') }),
        done: s => Math.max(idx(s, 1), idx(s, 3)) < Math.min(idx(s, 4), idx(s, 5)),
        fix: () => { const c = this.game.commands; c.rankDevice(5, 5); c.rankDevice(4, 5); } },
      examine('examA', 'a'),
      { id: 'scan', tab: 1, target: '#p-scanning [data-list="exam"]', next: true, params: () => ({ letter: L(this.a) }),
        skip: s => this.a < 0 || !s.contactListed[this.a] },
      { id: 'runExam', run: s => (s.contactLocked[this.a] && s.contactIdClass[this.a]) || !s.contactClass[this.a], params: () => ({ letter: L(this.a) }),
        skip: s => this.a < 0 || !s.contactListed[this.a], force: () => this.examined(this.a), progress: s => this.examProgress(s, this.a) },
      { id: 'aDone', tab: 1, target: () => `#p-scanning [data-list="contacts"] [data-t="${this.a}"]`, next: true,
        skip: s => this.a < 0 || !s.contactClass[this.a] || !s.contactIdClass[this.a],
        params: () => ({ letter: L(this.a), ship: ship(this.a), side: t(S().contactHostile[this.a] ? 'remake.tutorial.foe' : 'remake.tutorial.friend') }) },
      { id: 'runB', run: () => this.pirate() >= 0, after: () => { this.b = this.pirate(); }, force: () => this.spawn(PIRATE),
        progress: s => t('remake.tutorial.prog.flight', { pos: s.pos, min: s.minutes }) },
      examine('examB', 'b'),
      { id: 'runExam', run: s => this.ready(s) || !s.contactClass[this.b], params: () => ({ letter: L(this.b) }), skip: () => this.b < 0,
        force: () => { this.examined(this.b); this.hostile(this.b); }, progress: s => this.examProgress(s, this.b, true) },
      { id: 'bGone', next: true, params: () => ({ letter: L(Math.max(0, this.b)) }), skip: s => this.b >= 0 && this.ready(s) },
      { id: 'bDone', tab: 1, target: () => `#p-scanning [data-list="contacts"] [data-t="${this.b}"]`, next: true, skip: s => !this.ready(s),
        params: () => ({ letter: L(this.b), ship: ship(this.b), weapon: weak(this.b) }) },
      { id: 'fire', tab: 0, skip: s => !this.ready(s),
        sub: () => sheetHas('[data-act="fireGo"]') ? 'fireWeapon' : sheetHas('[data-act="fireAt"]') ? 'firePick' : 'fire',
        target: () => sheetHas('[data-act="fireGo"]') ? '#sheet-body .opts .sug' : sheetHas('[data-act="fireAt"]') ? `#sheet-body [data-act="fireAt"][data-t="${this.b}"]` : '#p-weapons [data-act="fireMenu"]',
        allow: ['#p-weapons [data-act="fireMenu"]', () => `#sheet-body [data-act="fireAt"][data-t="${this.b}"]`, '#sheet-body [data-act="fireGo"]', '#sheet-body [data-act="shots"]', '#sheet-body [data-act="closeSheet"]'],
        params: () => ({ fire: t('remake.action.fire'), letter: L(this.b), weapon: weak(this.b) }),
        done: s => s.targetOrdered[this.b] },
      { id: 'orders', tab: 0, target: '#p-weapons [data-list="orders"]', next: true, skip: s => !s.targetOrdered[this.b] },
      { id: 'runFire', run: s => s.contactKilledBy[this.b] || !s.contactClass[this.b], rate: FIGHT, ticks: 120 * 90, params: () => ({ letter: L(this.b) }),
        skip: s => !s.targetOrdered[this.b], force: () => this.kill(this.b), after: () => { this.killed = !!this.S.contactKilledBy[this.b]; },
        progress: s => this.fireProgress(s, this.b) },
      { id: 'killed', target: '#p-weapons', next: true, skip: () => !this.killed },
      { id: 'missed', next: true, params: () => ({ letter: L(this.b) }), skip: s => this.b < 0 || !s.targetOrdered[this.b] || this.killed },
      { id: 'shields', target: '#strip', next: true },
      { id: 'repair', tab: 4, enter: s => this.fault(s),
        sub: () => sheetHas('[data-act="repairGo"]') ? 'repairSheet' : 'repair',
        target: () => sheetHas('[data-act="repairGo"]') ? '#sheet-body' : `#p-repair [data-act="repairPick"][data-s="${this.slot}"]`,
        allow: [() => `#p-repair [data-act="repairPick"][data-s="${this.slot}"]`, '#sheet-body [data-act="droids"]', '#sheet-body [data-act="repairGo"]', '#sheet-body [data-act="closeSheet"]'],
        params: () => ({ system: t('system.' + SYSTEMS[FAULT_SYS]), assign: t('remake.action.assign') }), done: s => s.slotWanted[this.slot] > 0 },
      { id: 'repDone', tab: 4, target: '#p-repair [data-list="repair"]', next: true },
      { id: 'schedule', target: '#strip', next: true },
      { id: 'done', final: true },
    ];
  }
  // first contact other than `not`; the first pirate other than A
  contact(not) { const S = this.S; for (let c = 0; c < 26; c++) if (c !== not && S.contactClass[c]) return c; return -1; }
  pirate() { const S = this.S; for (let c = 0; c < 26; c++) if (c !== this.a && S.contactClass[c] && S.contactClass[c] <= PIRATE_LAST) return c; return -1; }
  ready(S) { const b = this.b; return b >= 0 && S.contactClass[b] && S.contactLocked[b] && S.contactWeaknessKnown[b] && S.contactHostile[b]; }
  powered(S) { return S.devPower[1] === 2 && S.devPower[3] === 2; }        // Weapons and Scanners fully powered
  starved() { const S = this.S; return [1, 3].filter(c => S.devPower[c] !== 2).map(c => t('power.class.' + 'ABCDEF'[c])); }
  examProgress(S, c, foe) {
    const mark = v => v ? '✓' : '…';
    let s = t('remake.tutorial.prog.exam', { lock: mark(S.contactLocked[c]), id: mark(S.contactIdClass[c]), dmg: mark(S.contactDamageKnown[c]), weak: mark(S.contactWeaknessKnown[c]) });
    if (foe) s += ' · ' + t('remake.tutorial.prog.hostile', { v: mark(S.contactHostile[c]) });
    if (!S.contactListed[c] && !S.contactLocked[c]) s += ' · ' + t('remake.tutorial.prog.notListed');
    if (!S.powered[10]) s += ' · ' + t('remake.tutorial.prog.noScanPower');
    return s;
  }
  fireProgress(S, c) {
    const w = Math.max(0, S.contactWeaknessKnown[c] - 1), d = S.contactDamage[c];
    return t('remake.tutorial.prog.fire', { hits: d & 8 ? 0 : [1, 2, 4].filter(b => d & b).length, shield: S.shieldBatt })
      + (S.powered[4 + w] ? '' : ' · ' + t('remake.tutorial.prog.noWeaponPower'));
  }

  // ---------- engine nudges (tutorial only, UI.md §2.14) ----------
  // a contact the way scanning.js spawn() makes one (no messages), ahead of the ship
  spawn(cls) {
    const S = this.S;
    let c = 0;
    while (c < 26 && S.contactClass[c]) c++;
    if (c >= 26) return;
    for (const f of ['contactLocked', 'contactListed', 'contactWeaknessKnown', 'contactIdClass', 'contactOnScreen', 'contactDamageProgress',
      'contactWeaknessProgress', 'contactIdProgress', 'contactLockProgress', 'contactDamageKnown', 'contactHostile', 'contactKilledBy']) S[f][c] = 0;
    S.contactClass[c] = cls; S.contactBearing[c] = 1; S.contactDamage[c] = 8; S.contactSpawnPos[c] = S.position; S.contactWeakness[c] = 2;
    S.contactsDetected++;
  }
  examined(c) {
    const S = this.S;
    if (c < 0 || !S.contactClass[c]) return;
    S.contactLocked[c] = 1; S.contactIdClass[c] = S.contactClass[c]; S.contactDamageKnown[c] = S.contactDamage[c]; S.contactWeaknessKnown[c] = S.contactWeakness[c];
  }
  hostile(c) {
    const S = this.S;
    if (c < 0 || !S.contactClass[c]) return;
    S.contactHostile[c] = 1;
    for (let k = 0; k < 4; k++) if (S.objActive[k] && S.shipTarget[k] === c * 2) S.shipAggressive[k] = 1;
  }
  kill(c) {                                    // as combat.js ourHitTest does on a kill (the explosion is skipped)
    const S = this.S;
    if (c < 0 || !S.contactClass[c] || S.contactKilledBy[c]) return;
    for (let k = 0; k < 4; k++) if (S.objActive[k] && S.shipTarget[k] === c * 2) S.objActive[k] = 0;
    S.contactOnScreen[c] = 0; S.contactKilledBy[c] = Math.max(1, S.contactWeaknessKnown[c]);
  }
  // B stays in range until the fight is over, and the gunner must not shoot it on his own before the captain's order
  keep(S) {
    const b = this.b, cls = b >= 0 ? S.contactClass[b] : 0;
    if (!cls || S.contactKilledBy[b] || this.i > this.fireAt + 2) return;   // fire, orders, runFire
    if (this.i < this.fireAt) S.autoFireIdle = Math.max(S.autoFireIdle, 2);
    const life = S.contactLifetime[cls];
    if (life > 2 && ((S.position - S.contactSpawnPos[b]) << 16 >> 16) >= life - 1) S.contactSpawnPos[b] = S.position - life + 2;
  }
  // the training fault: Cargo Envir damaged, as the damage step would open it (damage.js damageSystem, OK → damaged)
  fault(S) {
    if (S.sysState[FAULT_SYS] !== 2) { this.slot = S.slotSys.indexOf(FAULT_SYS); return; }
    while (S.slotId[S.nextSlot] >= 0) S.nextSlot = (S.nextSlot + 1) % 26;
    const s = this.slot = S.nextSlot;
    S.slotId[s] = s; S.slotSys[s] = FAULT_SYS; S.slotWanted[s] = S.slotDroids[s] = 0; S.slotDamage[s] = 40;
    if (this.game.fixes?.repairWorkCarry) S.slotWork[s] = 0;
    S.openSlots++; S.sysState[FAULT_SYS] = 1;
    this.bridge.lastUi = 0;
  }

  // ---------- clock (called by the app's tick loop) ----------
  rate() { const st = this.step; return !st ? 1 : st.run && !this.pending() ? st.rate || FF : ORDER_RATE; }
  canTick() {
    if (!this.bridge.departed || this.i < 0) return true;       // the departure sequence runs normally
    const st = this.step;
    if (!st || st.final) return !st;
    return this.pending() || !!st.run;
  }
  ticked() {
    if (!this.bridge.departed) return;
    if (this.i < 0) { if (++this.warm >= WARMUP) this.go(0); return; }   // let every department run once first
    const st = this.step, S = this.S;
    if (!st) return;
    this.keep(S);
    if (this.pending()) return;
    if (st.run) { if (st.run(S)) { st.after?.(); this.go(this.i + 1); } else if (++this.waited > (st.ticks || WAIT_TICKS)) this.ff(); }
    else if (st.done && st.done(S)) this.go(this.i + 1);
  }
  // a wait ends now: nudge the engine so the lesson happens, then go on
  ff() {
    const st = this.step;
    if (!st?.run) return;
    if (!st.run(this.S)) { st.force?.(); this.forced.push(st.id); }   // forced: for tests and debugging
    st.after?.(); this.go(this.i + 1);
  }
  go(i) {
    const S = this.S;
    while (i < this.steps.length && this.steps[i].skip?.(S)) i++;
    this.i = i; this.waited = 0; this.key = ''; this.scrolled = 0; this.t0 = performance.now();
    const st = this.step;
    if (!st) return this.end(true);
    st.enter?.(S);
    if (st.tab != null && !isPhone()) this.bridge.selectTab(st.tab, true);
    if (st.run && st.run(S)) { st.after?.(); this.go(i + 1); }
  }

  // ---------- coach mark (every frame) ----------
  frame() {
    const st = this.step;
    if (!st || this.i < 0) { this.root.hidden = true; return; }
    if (st.run && !this.pending() && performance.now() - this.t0 > WAIT_REAL) { this.ff(); return; }   // slow machine / background tab
    this.root.hidden = false;
    const needTab = st.tab != null && isPhone() && this.bridge.tab !== st.tab;
    const running = !!st.run || this.pending();
    const sub = needTab ? 'tab' : st.sub?.() || st.id;
    const key = `${this.i}|${sub}|${running}|${t('remake.tutorial.next')}`;
    const box = this.root.querySelector('.coach-box');
    if (key !== this.key) {
      this.key = key; this.scrolled = 0;
      const text = needTab ? t('remake.tutorial.tapTab', { dept: t(`dept.${DEPTS[st.tab]}.name`) })
        : st.text ? st.text() : t(`remake.tutorial.${sub}`, st.params?.());
      const n = this.steps.filter(s => !s.run).indexOf(st) + 1, m = this.steps.filter(s => !s.run).length;
      const ff = st.run ? `<span class="coach-ff">⏩ ×${st.rate || FF}</span>` : '';
      box.innerHTML = `<div class="coach-head"><span class="coach-ava" aria-hidden="true"></span><b>${esc(t('remake.tutorial.coach'))}</b>
          <span class="coach-n">${st.run ? ff : `${n}/${m}`}</span></div>
        <p>${esc(st.run ? t(`remake.tutorial.${st.id}`, st.params?.()) : text)}</p>
        ${running ? `<p class="coach-run">${esc(st.run ? '' : t('remake.tutorial.running'))}</p>` : ''}
        <div class="coach-foot">${st.final
          ? `<button class="btn ghost" data-tut="title">${esc(t('remake.tutorial.toTitle'))}</button><button class="btn primary" data-tut="continue">${esc(t('remake.tutorial.continue'))}</button>`
          : `<button class="btn ghost small" data-tut="skip" title="${esc(t('remake.tutorial.skipTitle'))}">${esc(t('remake.tutorial.skip'))}</button>
             ${st.fix && !needTab && !running ? `<button class="btn small" data-tut="fix">${esc(t('remake.tutorial.fixIt'))}</button>` : ''}
             ${st.run ? `<button class="btn primary small" data-tut="ff">${esc(t('remake.tutorial.ff'))}</button>` : ''}
             ${st.next && !needTab ? `<button class="btn primary small" data-tut="next">${esc(t('remake.tutorial.next'))}</button>` : ''}`}</div>`;
    }
    if (st.run) {                                // live progress: only the text changes, so the buttons keep working
      const p = box.querySelector('.coach-run'), s = st.progress?.(this.S) || t('remake.tutorial.running');
      if (p && p.textContent !== s) p.textContent = s;
    }
    const sel = needTab ? `#tabbar [data-d="${st.tab}"]` : running ? null : typeof st.target === 'function' ? st.target() : st.target;
    const el = sel && [...document.querySelectorAll(sel)].find(e => e.offsetParent !== null);
    if (el) {                                    // keep the target on screen (a re-render or a new message can move it)
      const r = el.getBoundingClientRect(), now = performance.now();
      if (!this.scrolled || ((r.bottom > innerHeight || r.top < 0) && now - this.scrolled > 1500)) { this.scrolled = now; el.scrollIntoView?.({ block: 'nearest' }); }
    }
    this.place(box, el, running);
  }
  place(box, el, running) {
    const spot = this.root.querySelector('.coach-spot'), shade = this.root.querySelector('.coach-shade'), arrow = this.root.querySelector('.coach-arrow');
    const W = innerWidth, H = innerHeight, bw = box.offsetWidth, bh = box.offsetHeight, m = 10;
    this.root.classList.toggle('dim', !running);
    if (!el) {                                  // centred (or out of the way while time runs)
      spot.style.cssText = `left:${W / 2}px;top:${H / 2}px;width:0;height:0`;
      shade.style.clipPath = '';
      arrow.hidden = true;
      box.style.left = Math.max(m, (W - bw) / 2) + 'px';
      box.style.top = (running ? Math.max(m, H - bh - (isPhone() ? 70 : 16)) : Math.max(m, (H - bh) / 2)) + 'px';
      return;
    }
    const r = el.getBoundingClientRect(), p = 4;
    const x1 = r.left - p, y1 = r.top - p, x2 = r.right + p, y2 = r.bottom + p;
    spot.style.cssText = `left:${x1}px;top:${y1}px;width:${x2 - x1}px;height:${y2 - y1}px`;
    shade.style.clipPath = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${x1}px ${y1}px, ${x1}px ${y2}px, ${x2}px ${y2}px, ${x2}px ${y1}px, ${x1}px ${y1}px)`;
    // a control inside a sheet: the box goes above or below the whole sheet, so it never covers the sheet's buttons
    const sheet = el.closest('#sheet-body'), a = sheet ? sheet.getBoundingClientRect() : r;
    let top, below;
    if (a.bottom + 14 + bh < H - m) { top = a.bottom + 14; below = true; }
    else if (a.top - 14 - bh > m) { top = a.top - 14 - bh; below = false; }
    else { top = (a.top + a.height / 2 > H / 2) ? m : H - bh - m; below = null; }   // big target: opposite half
    if (sheet && sheet !== el) below = null;
    const cx = Math.min(Math.max(r.left + r.width / 2, 20), W - 20);
    const left = Math.min(Math.max(m, cx - bw / 2), W - bw - m);
    box.style.left = left + 'px'; box.style.top = top + 'px';
    arrow.hidden = below == null;
    if (below != null) { arrow.className = 'coach-arrow ' + (below ? 'up' : 'down'); arrow.style.left = (cx - 9) + 'px'; arrow.style.top = (below ? top - 9 : top + bh - 1) + 'px'; }
  }

  // ---------- input: only the highlighted control (and the coach box) can be used ----------
  allowed() {
    const st = this.step;
    if (!st) return [];
    if (st.tab != null && isPhone() && this.bridge.tab !== st.tab) return [...document.querySelectorAll(`#tabbar [data-d="${st.tab}"]`)];
    if (st.run || this.pending()) return [];
    return (st.allow || []).flatMap(a => [...document.querySelectorAll(typeof a === 'function' ? a() : a)]);
  }
  block(e) {
    if (this.i < 0 || !this.step || e.target.closest?.('#coach .coach-box')) return;
    if (e.type === 'keydown') { e.stopPropagation(); if (e.key === ' ' || e.key === 'Escape') e.preventDefault(); return; }
    if (this.allowed().some(el => el.contains(e.target))) return;
    e.stopPropagation(); e.preventDefault();
  }
  end(done, toTitle) {
    for (const ev of ['click', 'pointerdown', 'keydown']) window.removeEventListener(ev, this.guard, true);
    this.root.remove(); this.i = this.steps.length;
    this.onEnd?.(done, toTitle);
  }
}
