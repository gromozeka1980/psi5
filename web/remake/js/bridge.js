// The bridge: status strip, viewscreen (combat view), officer console, the five department panels and the systems map.
// Reads game.state, reacts to engine events, sends game.commands.* (docs/remake/UI.md §2.7–2.11).
import { t, msgSlots } from './i18n.js';
import * as audio from './audio.js';
import { CombatView, SLOT_X, SHOTS, artWidth } from './view.js';
import { DEPTS, SHIP_NAMES, WEAPONS, SYSTEMS, DEVICES, POWER_CLASSES, COURSE_LETTERS, NAV_STATES, ORDER_STATUS, DEV_STATES,
  DEV_POWER, ETA_STATES, TUNE, ASSETS, facePortrait, art, artImg, isArt, portraitId, preload } from './data.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const L = n => String.fromCharCode(65 + n);
const i16 = v => (v << 16) >> 16;
const money = v => t(v < 0 ? 'money.mNeg' : 'money.m', { m: (Math.abs(v) / 10).toFixed(1) });
const MAX_LIST = 8;

export function openSheet(html, wide) {
  const b = $('#sheet-body');
  b.className = 'sheet' + (wide ? ' wide' : ''); b.innerHTML = html; $('#sheet').hidden = false;
}
export function closeSheet() { $('#sheet').hidden = true; $('#sheet-body').innerHTML = ''; }
export function toast(html) {
  const d = document.createElement('div'); d.className = 'toast'; d.innerHTML = html;
  $('#toasts').append(d); setTimeout(() => d.remove(), 3500);
}

export class Bridge {
  constructor({ game, course, crew, root, onPause }) {
    Object.assign(this, { game, course, crew, root, onPause });
    this.started = false; this.departed = false; this.busy = 0; this.msg = null; this.hitUntil = 0; this.lastUi = 0;
    this.shots = 0; this.droids = 2; this.dragging = null; this.inv = null; this.log = [];
    this.tab = 0;
  }
  get S() { return this.game.state; }

  // ---------- setup ----------
  start() {
    this.started = true;
    this.main = new CombatView($('#cv-main'), 'main');
    this.inset = new CombatView($('#cv-inset'), 'inset');
    if (!Bridge.bound) {                                 // DOM listeners once per page (the bridge DOM is reused)
      Bridge.bound = true;
      for (const [id, v] of [['#cv-main', 'main'], ['#cv-inset', 'inset']]) $(id).addEventListener('click', e => Bridge.current.pick(v, e));
      $('#panels').addEventListener('pointerdown', e => Bridge.current.dragStart(e));
    }
    Bridge.current = this;
    const vs = $('#viewscreen'), bg = id => isArt(id) ? `url('${art(id, '', vs.clientWidth || 600)}')` : 'none';
    vs.style.setProperty('--fore', bg('view.space.fore')); vs.style.setProperty('--aft', bg('view.space.aft'));
    this.preloadArt();
    for (const id of ['#strip', '#console', '#tabbar', '#bearings', '#headline', ...DEPTS.map(d => '#p-' + d), '#p-systems']) { $(id).innerHTML = ''; $(id)._html = null; }
    this.selectTab(this.tab, true);
    this.renderUi();
  }
  // what the bridge needs at once (the canvas draws only decoded images): combat art, the crew's other portrait states
  preloadArt() {
    this.main.fit();
    const ids = [...Array.from({ length: 9 }, (_, i) => 'ship.class' + (i + 1)), ...SHOTS.map(w => 'shot.' + w), 'fx.explosion'];
    preload([...ids.map(id => [id, artWidth(id)]), ...this.crew.map(id => [`portrait.${id}.stressed`, 112])]);
  }
  relabel() { for (const id of ['#strip', '#console', '#tabbar', ...DEPTS.map(d => '#p-' + d), '#p-systems']) $(id)._html = null; this.renderUi(); }
  selectTab(d, silent) {
    this.tab = d;
    $('#bridge-main').dataset.tab = DEPTS[d];
    if (!silent && this.S) audio.play(this.S.deptAlive[d] ? TUNE.deptJingle(d) : TUNE.dead);
    this.renderTabs();
  }

  // ---------- engine events ----------
  event(type, ...a) {
    switch (type) {
      case 'sound': audio.play(a[0]); break;
      case 'tune': audio.force(a[0]); break;
      case 'departure': audio.force(TUNE.departure); break;
      case 'flash': this.busy++; break;
      case 'menu': this.busy = Math.max(0, this.busy - 1); this.departed = true; break;
      case 'lamp': if (a[1]) audio.play(TUNE.lamp); break;
      case 'border': if (a[0] === 0x2f) this.hitUntil = performance.now() + 350; break;
      case 'message': {
        const [d, id] = a;
        if (d >= 0 && this.msg?.d !== d) audio.play(TUNE.head);
        if (this.msg?.d >= 0) this.log.unshift(this.msg);
        this.log.length = Math.min(this.log.length, 12);
        this.msg = d < 0 ? { d: -1 } : { d, id, out: this.S.msgCount[d] === 0 };
        if (this.started) { $('#console')._html = null; }
        break;
      }
      case 'officerDied': toast(`<img ${artImg(portraitId(this.crew[a[0]], { dead: true }), facePortrait(this.crew[a[0]]), 48)} alt=""><span>${esc(t(`dept.${DEPTS[a[0]]}.name`))}: ${esc(t('msg.rip'))}</span>`); break;
    }
  }
  ended() {
    this.inv = this.game.invoice();
    closeSheet();
    this.renderUi();
  }

  // ---------- per frame ----------
  frame(now) {
    if (!this.started) return;
    const S = this.S, headline = this.headline();
    this.main.draw(S, { headline });
    this.inset.draw(S, {});
    const vs = $('#viewscreen');
    vs.classList.toggle('hit', now < this.hitUntil);
    vs.classList.toggle('aft', this.main.side === 1);
    if (now - this.lastUi > 160) { this.lastUi = now; this.renderUi(); }
  }
  headline() {
    const S = this.S, r = this.game.result;
    if (r === 'arrived') return { big: t('arrival.welcome', { destination: t(`mission.${this.course}.destination`) }), small: t('remake.end.arrived'), bg: art(`scene.arrival.${this.course}`, ASSETS + 'psi5/arrival.png', this.vw()) };
    if (r) return { big: t('end.aborted'), small: `${t(r === 'noCargo' ? 'end.noCargo' : 'end.tooLate')} · ${t('end.returnTo')} ${t('end.starbase')}`, bg: art('scene.aborted', '', this.vw()) };
    if (!this.departed) return { big: t('ui.departure'), bg: art('scene.departure', '', this.vw()) };
    if (S.alarmOn) return { big: t('alert.intruder'), small: t('alert.looting'), alarm: true };
    return null;
  }

  vw() { return $('#viewscreen').clientWidth || 600; }
  // the officer's portrait for his state (dead / stressed art, else calm; the CSS tint only without stressed art)
  face(d, cssW, cls = '') {
    const S = this.S, id = this.crew[d], dead = !S.deptAlive[d], stressed = !dead && !!S.deptStress[d];
    const pid = portraitId(id, { dead, stressed });
    const tint = (dead && pid !== `portrait.${id}.dead` ? ' grey' : '') + (stressed && pid !== `portrait.${id}.stressed` ? ' stressed' : '');
    return `<img ${artImg(pid, facePortrait(id), cssW, cls + tint)} alt="">`;
  }
  // ---------- DOM rendering (only changed parts are written) ----------
  set(sel, html) {
    const el = typeof sel === 'string' ? $(sel) : sel;
    if (el._html === html || (this.dragging && this.dragging === el)) return;
    const top = el.querySelector('.p-body')?.scrollTop;       // a re-render must not scroll a panel back to its top
    el._html = html; el.innerHTML = html;
    if (top) el.querySelector('.p-body').scrollTop = top;
  }
  renderUi() {
    if (!this.started) return;
    const S = this.S;
    this.renderStrip(S);
    this.renderView(S);
    this.renderConsole(S);
    this.renderTabs();
    this.set('#p-weapons', this.weapons(S));
    this.set('#p-scanning', this.scanning(S));
    this.set('#p-navigation', this.navigation(S));
    this.set('#p-engineering', this.engineering(S));
    this.set('#p-repair', this.repair(S));
    this.set('#p-systems', this.systems(S));
    for (let d = 0; d < 5; d++) $('#p-' + DEPTS[d]).classList.toggle('dead', !S.deptAlive[d]);
  }
  renderStrip(S) {
    const sp = S.speed, req = S.reqSpeed, cargoCls = S.cargo < 40 ? 'bad' : S.cargo < 75 ? 'warn' : '';
    const start = S.startPos, prog = Math.max(0, Math.min(1, (S.pos - start) / Math.max(1, 50 - start)));
    const gauge = (n, on, cls) => `<span class="gauge ${cls}">${Array.from({ length: n }, (_, i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('')}</span>`;
    const busy = this.busy > 0 || this.game.queue.length > 0;
    this.set('#strip', `
      <span class="cell"><span class="lbl opt">${esc(t('remake.status.speed'))}</span><span class="val">${esc(speedLabel(sp))}${req !== sp ? ` → ${esc(speedLabel(req))}` : ''}</span></span>
      <span class="cell"><span class="lbl opt">${esc(t('remake.status.pos'))}</span><span class="route"><i style="width:${(prog * 100).toFixed(1)}%"></i></span><span class="val">${S.pos}/50</span></span>
      <span class="cell"><span class="lbl">${esc(t('remake.status.time'))}</span><span class="val ${S.etaState === 2 ? 'bad' : ''}">${esc(t('remake.status.minutes', { n: S.minutes, m: S.timeLimit }))}</span></span>
      <span class="cell"><span class="lbl">${esc(t('remake.status.cargo'))}</span><span class="val ${cargoCls}">${S.cargo}%</span></span>
      <span class="cell"><span class="lbl opt">${esc(t('remake.status.power'))}</span>${gauge(6, Math.max(0, S.gaugeLevel), '')}${gauge(8, S.gaugeBars, 'drawn')}</span>
      <span class="cell"><span class="lbl">${esc(t('remake.status.shield'))}</span><span class="val ${S.shieldBatt < 20 ? 'bad' : ''}">${S.shieldBatt}%</span></span>
      ${S.alarmOn ? `<span class="alert">${esc(t('alert.intruder'))}</span>` : ''}
      ${busy ? `<span class="busy">${esc(t('ui.processing'))}</span>` : ''}
      <span class="spacer"></span><span class="tools">
      <button class="iconbtn" data-act="howto" title="${esc(t('remake.help.title'))}" aria-label="${esc(t('remake.help.title'))}">?</button>
      <button class="iconbtn" data-act="pauseBtn" title="${esc(t('remake.pause'))}" aria-label="${esc(t('remake.pause'))}">❚❚</button>
      <button class="iconbtn" data-act="settings" title="${esc(t('remake.settings'))}" aria-label="${esc(t('remake.settings'))}">⚙</button></span>`);
  }
  renderView(S) {
    const h = this.headline(), el = $('#headline');
    el.classList.toggle('on', !!h);
    if (h) {
      this.set(el, `<div>${esc(h.big)}${h.small ? `<small>${esc(h.small)}</small>` : ''}${this.game.over ? `<button class="btn primary" data-act="toInvoice">${esc(t('remake.end.toInvoice'))}</button>` : ''}</div>`);
      el.style.backgroundImage = h.bg ? `url('${h.bg}')` : '';
      el.classList.toggle('art', !!h.bg && h.bg.startsWith('art/'));
      el.style.background = h.alarm ? 'rgba(120,0,20,.35)' : h.bg ? '' : 'rgba(3,4,14,.6)';
      if (h.bg) el.style.backgroundImage = `url('${h.bg}')`;
    }
    const side = this.main.side, shipsOn = new Set();
    for (let i = 0; i < 26; i++) if (S.contactClass[i] && S.contactOnScreen[i]) shipsOn.add(S.contactBearing[i]);
    const slots = side === 0 ? [0, 1, 2] : [3];
    this.set('#bearings', slots.map(o => `<span class="${shipsOn.has(o) ? 'busy' : ''}" style="left:${(SLOT_X[o] / 128 * 100).toFixed(1)}%" title="${esc(t('remake.bearing.long.' + o))}">${esc(t('remake.bearing.' + o))}</span>`).join(''));
    $('#inset-label').textContent = t('remake.bearing.long.' + (side === 0 ? 3 : 1));
  }
  renderConsole(S) {
    const m = this.msg;
    let body;
    if (!m || m.d < 0) body = `<div class="msg"><img class="head px blank" src="${ASSETS}psi5/head_blank.png" alt=""><div><div class="cap">${esc(t('msg.captain'))}</div><div class="txt">${esc(t('msg.none'))}</div></div></div>`;
    else {
      const id = this.crew[m.d], slot = msgSlots()[DEPTS[m.d]][m.id >> 1];
      body = `<div class="msg">${this.face(m.d, 112, 'head')}
        <div><div class="cap">${esc(t('msg.captain'))}</div><div class="txt">${esc(t(`msg.${id}.${slot}`))}</div>
        <div class="sig">${esc(t(`msg.${id}.sign`))}${m.out ? ` ${esc(t('msg.out'))}` : ''}</div></div></div>`;
    }
    const text = mm => { const id = this.crew[mm.d]; return t(`msg.${id}.${msgSlots()[DEPTS[mm.d]][mm.id >> 1]}`); };
    const log = this.log.map(mm => `<li><b>${esc(t(`dept.${DEPTS[mm.d]}.letter`))}</b> ${esc(text(mm))}</li>`).join('');
    if (log) body = body.replace(/<\/div>$/, `<ul class="log">${log}</ul></div>`);
    const lamps = DEPTS.map((d, i) => `<button class="lamp ${S.msgCount[i] ? 'on' : ''}" data-act="ack" data-d="${i}" title="${esc(t('ack.nextFrom', { dept: t(`dept.${d}.abbr`) }))}">${icon(d, 34)}${S.msgCount[i] ? `<b>${S.msgCount[i]}</b>` : ''}</button>`).join('');
    const any = S.msgCount.some(n => n > 0);
    this.set('#console', `${body}<div class="cbar"><span class="lamps">${lamps}</span><span class="grow"></span>
      <button class="btn small" data-act="nextMsg" ${any ? '' : 'disabled'}>${esc(t('remake.msg.next'))}</button>
      <button class="btn small ghost" data-act="clearMsg" ${any ? '' : 'disabled'}>${esc(t('remake.msg.clear'))}</button>
      <button class="toggle ${S.autoAnswer ? 'on' : ''}" data-act="autoMsg"><i></i>${esc(t('remake.msg.auto'))}</button></div>`);
  }
  renderTabs() {
    const S = this.S; if (!S) return;
    this.set('#tabbar', DEPTS.map((d, i) => `<button data-act="tab" data-d="${i}" class="${i === this.tab ? 'cur' : ''} ${S.msgCount[i] ? 'lit' : ''} ${S.deptAlive[i] ? '' : 'dead'}">
      <span class="ic">${icon(d, 28)}</span><span class="nm">${esc(t(`dept.${d}.name`))}</span>${S.msgCount[i] ? `<b>${S.msgCount[i]}</b>` : ''}</button>`).join(''));
  }
  head(S, d) {
    const id = this.crew[d], alive = S.deptAlive[d];
    const st = art('station.' + DEPTS[d], '', 300);
    return `<header class="p-head"${st ? ` style="--station:url('${st}')"` : ''}>${this.face(d, 40)}
      <div style="min-width:0"><h3>${esc(t(`dept.${DEPTS[d]}.name`))}</h3><div class="who">${esc(t(`crew.${id}.name`))}</div></div>
      ${!alive ? `<span class="tag rip">${esc(t('msg.rip'))}</span>` : S.deptStress[d] ? `<span class="tag">${esc(t('remake.stressed'))}</span>` : ''}
      <button class="help-btn" data-act="help" data-d="${d}" title="${esc(t('remake.help.btn'))}" aria-label="${esc(t('remake.help.btn'))}">?</button></header>`;
  }
  shipName(cls, many) { return t(`ship.${SHIP_NAMES[this.course][cls] || 'other'}.${many ? 'many' : 'one'}`); }
  contacts(S) { const r = []; for (let i = 0; i < 26; i++) if (S.contactClass[i]) r.push(i); return r; }

  // ---------- Weapons ----------
  weapons(S) {
    const alive = S.deptAlive[0];
    const lamps = WEAPONS.map((w, i) => {
      let shots = 0, kills = 0;
      for (let c = 0; c < 7; c++) { shots += S.shotsByWeapon[i * 7 + c]; kills += S.killsByWeapon[i * 7 + c]; }
      const st = S.weaponLampShown[i] < 0 ? 2 : S.weaponLampShown[i];
      return `<div class="wlamp"><i class="s${st}"></i><div>${esc(t(`weapon.${w}`))}<small>${esc(t('remake.weapons.stats', { shots, kills }))}</small></div></div>`;
    }).join('');
    const rows = [];
    for (let i = 0; i < S.orderCount; i++) {
      const s = S.orderQueue[i], st = S.orderStatus[s], tg = S.orderTarget[s];
      const cls = st === 4 ? 'good' : st >= 2 ? 'warn' : 'bad';
      rows.push(`<div class="row" data-id="${S.orderSerial[s]}">
        ${alive ? `<span class="grip" title="${esc(t('remake.drag'))}">⋮⋮</span>` : ''}<span class="let">${L(S.orderSerial[s])}</span>
        <span class="main"><b>${esc(t(`weapon.${WEAPONS[S.orderWeapon[s]]}`))} → ${L(tg)}</b><small>${esc(t('col.shots'))}: ${S.orderShots[s] >= 10 ? '∞' : S.orderShots[s]} · ${esc(t('col.pri'))} ${i + 1}</small></span>
        <span class="st ${cls}">${esc(t('fire.' + ORDER_STATUS[st]))}</span>
        <button class="x" data-act="cancelOrder" data-s="${S.orderSerial[s]}" title="${esc(t('weapons.cancel'))}">✕</button></div>`);
    }
    return `${this.head(S, 0)}<div class="p-body">
      ${alive ? '' : `<p class="reduced">${esc(t('remake.reduced'))}</p>`}
      <div class="wlamps">${lamps}</div>
      <h4>${esc(t('remake.weapons.orders'))}<button class="btn small primary" data-act="fireMenu">${esc(t('remake.action.fire'))}</button></h4>
      <div class="rows" data-list="orders">${rows.join('') || `<div class="empty">${esc(t('weapons.noOrders'))}</div>`}</div></div>`;
  }
  fireSheet(tg) {
    const S = this.S, alive = S.deptAlive[0], sug = S.contactWeaknessKnown[tg] - 1;
    const full = alive && S.orderCount >= MAX_LIST;
    const cls = this.shipName(S.contactIdClass[tg]);
    const opts = WEAPONS.map((w, i) => `<button class="btn ${i === sug ? 'sug' : ''}" data-act="fireGo" data-t="${tg}" data-w="${i}">${esc(t(`weapon.${w}`))}${i === sug ? ` ★ <small>${esc(t('remake.fire.suggested'))}</small>` : ''}</button>`).join('');
    const chips = ['∞', 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n, i) => `<button class="chip ${i === this.shots ? 'on' : ''}" data-act="shots" data-n="${i}" data-t="${tg}">${n}</button>`).join('');
    openSheet(`<h2>${esc(t('remake.fire.title', { target: L(tg) }))} · ${esc(cls)}</h2>
      <div class="kv"><span>${esc(t('col.type'))}</span><span>${esc(t(S.contactHostile[tg] ? 'contact.foe' : 'contact.friend'))}</span>
        <span>${esc(t('col.lock'))}</span><span>${esc(t(S.contactLocked[tg] ? 'remake.fire.locked' : 'remake.fire.notLocked'))}</span>
        <span>${esc(t('col.bearing'))}</span><span>${esc(t('remake.bearing.long.' + S.contactBearing[tg]))}</span></div>
      ${full ? `<p class="reduced">${esc(t('weapons.listFull'))}</p>` : ''}
      ${alive ? `<h4 style="margin:12px 0 4px">${esc(t('remake.fire.shots'))}</h4><div class="chips">${chips}</div>` : `<p class="reduced">${esc(t('remake.reduced'))}</p>`}
      <div class="opts">${opts}</div>
      <div class="foot"><button class="btn ghost" data-act="closeSheet">${esc(t('remake.close'))}</button></div>`);
  }
  targetPicker() {
    const S = this.S, list = this.contacts(S);
    openSheet(`<h2>${esc(t('remake.fire.choose'))}</h2><div class="rows">${list.map(tg => this.contactRow(S, tg, 'fireAt')).join('') || `<div class="empty">${esc(t('scanning.nothing'))}</div>`}</div>
      <div class="foot"><button class="btn ghost" data-act="closeSheet">${esc(t('remake.close'))}</button></div>`);
  }
  contactRow(S, tg, act, extra = '') {
    const mk = (S.contactListed[tg] ? '◉' : '') + (S.targetOrdered[tg] ? '✛' : '');
    return `<div class="row tap ${extra ? 'wrap' : ''}" data-act="${act}" data-t="${tg}"><span class="let ${S.contactHostile[tg] ? 'foe' : 'frd'}">${L(tg)}</span>
      <span class="main"><b>${esc(this.shipName(S.contactIdClass[tg]))} <span class="mk">${mk}</span></b>
      <small>${esc(t(S.contactHostile[tg] ? 'contact.foe' : 'contact.friend'))} · ${esc(t('remake.bearing.long.' + S.contactBearing[tg]))} · ${esc(t(S.contactLocked[tg] ? 'remake.fire.locked' : 'remake.fire.notLocked'))}${S.contactOnScreen[tg] ? ' · ◎' : ''}</small></span>${extra ? `<span class="acts">${extra}</span>` : ''}</div>`;
  }

  // ---------- Scanning ----------
  scanning(S) {
    const alive = S.deptAlive[1], list = this.contacts(S);
    const rows = list.map(tg => this.contactRow(S, tg, 'contact',
      `<button class="btn small" data-act="examine" data-t="${tg}">${esc(t('remake.action.examine'))}</button><button class="btn small" data-act="fireAt" data-t="${tg}">${esc(t('remake.action.fire'))}</button>`)).join('');
    const ex = [];
    for (let i = 0; i < S.examLen; i++) {
      const tg = S.examList[i], dk = S.contactDamageKnown[tg], wk = S.contactWeaknessKnown[tg];
      const dmg = !dk ? '' : dk & 8 ? t('contact.dmg.none') : [[4, 'steering'], [2, 'weapons'], [1, 'engines']].filter(([b]) => dk & b).map(([, k]) => t('contact.dmg.' + k)).join(',');
      ex.push(`<div class="row" data-id="${tg}">${alive ? `<span class="grip" title="${esc(t('remake.drag'))}">⋮⋮</span>` : ''}<span class="let ${S.contactHostile[tg] ? 'foe' : 'frd'}">${L(tg)}</span>
        <span class="main"><b>${esc(this.shipName(S.contactIdClass[tg]))}</b><small>${esc(t('col.damage'))}: ${esc(dmg || '?')} · ${esc(t('col.suggested'))}: ${wk ? esc(t(`weapon.${WEAPONS[wk - 1]}.code`)) : '?'} · ${esc(t('col.pri'))} ${i + 1}</small></span>
        <button class="x" data-act="cancelExam" data-t="${tg}" title="${esc(t('scanning.cancel'))}">✕</button></div>`);
    }
    return `${this.head(S, 1)}<div class="p-body">
      ${alive ? '' : `<p class="reduced">${esc(t('remake.reduced'))}</p>`}
      <div class="kv"><span>${esc(t('remake.scan.scanner'))}</span><span>${esc(t(!S.sysState[10] ? 'remake.sys.disabled' : !S.powered[10] ? 'fire.noPower' : S.sysState[10] === 1 ? 'remake.sys.damaged' : 'remake.sys.ok'))}</span>
        <span>${esc(t('remake.status.cargo'))}</span><span>${S.cargo}%</span></div>
      <h4>${esc(t('remake.scan.contacts'))} (${list.length})</h4>
      <div class="rows" data-list="contacts">${rows || `<div class="empty">${esc(t('scanning.nothing'))}</div>`}</div>
      <h4>${esc(t('remake.scan.examList'))}</h4>
      <div class="rows" data-list="exam">${ex.join('') || `<div class="empty">${esc(t('scanning.noExams'))}</div>`}</div></div>`;
  }

  // ---------- Navigation ----------
  navigation(S) {
    const alive = S.deptAlive[2];
    const thr = Array.from({ length: 9 }, (_, v) => `<button data-act="speed" data-v="${v}" class="${v === S.reqSpeed ? 'req' : ''} ${v === S.speed ? 'act' : ''}" title="${esc(speedLabel(v))}">${v === 0 ? '■' : v}</button>`).join('');
    const ev = S.maneuver ? 'on' : '';
    const courses = COURSE_LETTERS.map((c, j) => {
      const moving = S.speed !== 0, reta = i16(S.reta[j]);
      const info = [`${t('col.dist')} ${S.dist[j]}`, moving ? `${t('col.eta')} ${S.eta[j]}` : '', moving ? `${t('col.reta')} ${reta > 0 ? '+' : ''}${reta}` : '', S.riskValid ? `${t('col.risk')} ${S.risk[j]}` : ''].filter(Boolean).join(' · ');
      const cur = S.course === j, req = S.reqCourse === j;
      return `<div class="row tap ${req ? 'sel' : ''}" data-act="setCourse" data-c="${j}"><span class="let ${cur ? 'frd' : ''}">${c}</span>
        <span class="main"><b>${esc(t('course.' + c))}</b><small>${esc(info)}</small></span>
        ${cur ? `<span class="st good">${esc(t('panel.navStatus.current'))}</span>` : req ? `<span class="st warn">${esc(t('panel.navStatus.requested'))}</span>` : ''}</div>`;
    }).join('');
    return `${this.head(S, 2)}<div class="p-body">
      ${alive ? '' : `<p class="reduced">${esc(t('remake.reduced'))}</p>`}
      <div class="kv">
        <span>${esc(t('remake.nav.actual'))}</span><span>${esc(speedLabel(S.speed))} · ${esc(t('nav.state.' + NAV_STATES[S.navState]))}</span>
        <span>${esc(t('remake.nav.requested'))}</span><span>${esc(speedLabel(S.reqSpeed))} · ${esc(t('nav.state.' + (S.maneuver ? 'evasive' : 'standard')))}</span>
        <span>${esc(t('col.eta'))}</span><span>${esc(t('nav.eta.' + ETA_STATES[S.etaState]))}</span></div>
      <h4>${esc(t('remake.nav.throttle'))}</h4>
      <div class="throttle">${thr}</div>
      <div class="nav-ctl"><button class="toggle ${ev}" data-act="evasive" ${alive && S.reqSpeed ? '' : 'disabled'}><i></i>${esc(t('remake.nav.evasive'))}</button></div>
      <h4>${esc(t('remake.nav.courses'))}</h4><div class="rows">${courses}</div></div>`;
  }

  // ---------- Engineering ----------
  engineering(S) {
    const devs = DEVICES.map((k, d) => {
      const st = S.devState[d], on = st === 2, rq = st === 1 || st === 3;
      return `<button class="dev ${on ? 'on' : ''} ${rq ? 'rq' : ''}" data-act="dev" data-d="${d}" title="${esc(t('dev.state.' + DEV_STATES[st]))}">
        <span class="toggle-i"></span><span class="nm">${L(d)} ${esc(t('engPanel.' + k))}</span><span class="hp h${S.sysState[d]}"></span></button>`;
    }).join('');
    const pri = [];
    for (let i = 0; i < 6; i++) {
      const c = S.priority[i], p = S.devPower[c];
      pri.push(`<div class="row" data-id="${c}"><span class="grip" title="${esc(t('remake.drag'))}">⋮⋮</span><span class="let">${i + 1}</span>
        <span class="main"><b>${esc(t('power.class.' + POWER_CLASSES[c]))}</b><small>${esc(t('col.power'))}: ${S.devDraw[c]}</small></span>
        <span class="st ${p === 2 ? 'good' : p === 1 ? 'warn' : 'bad'}">${esc(t('dev.power.' + DEV_POWER[p]))}</span></div>`);
    }
    const drawn = Array.from(S.devDraw).reduce((a, b) => a + b, 0);
    return `${this.head(S, 3)}<div class="p-body">
      ${S.deptAlive[3] ? '' : `<p class="reduced">${esc(t('remake.reduced'))}</p>`}
      <div class="kv"><span>${esc(t('remake.eng.supply'))}</span><span>${Math.max(0, S.gaugeLevel) * 300}</span>
        <span>${esc(t('remake.eng.drawn'))}</span><span>${drawn}</span>
        <span>${esc(t('remake.status.shield'))}</span><span><div class="bar"><i style="width:${S.shieldBatt}%"></i></div></span>
        <span>${esc(t('remake.eng.emergency'))}</span><span><div class="bar amber"><i style="width:${S.emergBatt}%"></i></div></span></div>
      <h4>${esc(t('remake.eng.devices'))}</h4><div class="devs">${devs}</div>
      <h4>${esc(t('remake.eng.priority'))}</h4><div class="rows" data-list="power">${pri.join('')}</div></div>`;
  }

  // ---------- Repair ----------
  repair(S) {
    const alive = S.deptAlive[4];
    const counts = [[S.idleDroids, ''], [S.rechargingDroids, 'r'], [S.busyDroids, 'b'], [S.outDroids, 'o']];
    const pips = counts.map(([n, c]) => `<i class="${c}"></i>`.repeat(Math.max(0, n))).join('');
    const dmg = [], q = [];
    for (let s = 0; s < 26; s++) {
      if (S.slotId[s] === -1 || !S.slotDamage[s]) continue;
      const sys = S.slotSys[s];
      dmg.push(`<div class="row tap" data-act="repairPick" data-s="${s}"><span class="let ${S.slotWorking[s] ? 'frd' : ''}">${L(s)}</span>
        <span class="main"><b>${esc(t('system.' + SYSTEMS[sys]))}${S.slotWanted[s] ? ' <span class="mk">◉</span>' : ''}</b>
        <div class="bar ${S.slotDamage[s] > 60 ? 'red' : 'amber'}"><i style="width:${Math.min(100, S.slotDamage[s])}%"></i></div></span>
        <span class="st">${esc(t('col.etr'))} ${S.slotDamage[s]}</span></div>`);
    }
    for (let i = 0; i < S.queueLen; i++) {
      const s = S.queue[i];
      q.push(`<div class="row" data-id="${s}">${alive ? `<span class="grip" title="${esc(t('remake.drag'))}">⋮⋮</span>` : ''}<span class="let ${S.slotWorking[s] ? 'frd' : ''}">${L(s)}</span>
        <span class="main"><b>${esc(t('system.' + SYSTEMS[S.slotSys[s]]))}</b><small>${esc(t('remake.rep.droidsN', { n: `${S.slotDroids[s]}/${S.slotWanted[s]}` }))} · ${esc(t('col.etr'))} ${S.slotDamage[s]}${S.slotWorking[s] ? ' · ★' : ''}</small></span>
        <button class="x" data-act="repairCancel" data-s="${s}" title="${esc(t('repair.cancel'))}">✕</button></div>`);
    }
    return `${this.head(S, 4)}<div class="p-body">
      ${alive ? '' : `<p class="reduced">${esc(t('remake.reduced'))}</p>`}
      <h4>${esc(t('remake.rep.droids'))}</h4><div class="droids">${pips}</div>
      <div class="legend"><span>${esc(t('remake.rep.idle'))}: ${S.idleDroids}</span><span>${esc(t('remake.rep.recharging'))}: ${S.rechargingDroids}</span><span>${esc(t('remake.rep.busy'))}: ${S.busyDroids}</span><span>${esc(t('remake.rep.out'))}: ${S.outDroids}</span></div>
      <h4>${esc(t('remake.rep.damaged'))}</h4><div class="rows">${dmg.join('') || `<div class="empty">${esc(t('repair.noneRequired'))}</div>`}</div>
      <h4>${esc(t('remake.rep.queue'))}</h4><div class="rows" data-list="repair">${q.join('') || `<div class="empty">${esc(t('repair.noRepairs'))}</div>`}</div>
      <div class="phone-only">${this.systemsGrid(S)}</div></div>`;
  }
  repairSheet(s) {
    const S = this.S, alive = S.deptAlive[4], queued = S.slotWanted[s] > 0;
    const full = alive && !queued && S.queueLen >= MAX_LIST;
    const chips = [1, 2, 3, 4, 5, 6, 7].map(n => `<button class="chip ${n === this.droids ? 'on' : ''}" data-act="droids" data-n="${n}" data-s="${s}">${n}</button>`).join('');
    openSheet(`<h2>${L(s)} · ${esc(t('system.' + SYSTEMS[S.slotSys[s]]))}</h2>
      <div class="kv"><span>${esc(t('col.etr'))}</span><span>${S.slotDamage[s]}</span></div>
      ${full ? `<p class="reduced">${esc(t('repair.listFull'))}</p>` : ''}
      ${alive ? `<h4 style="margin:12px 0 4px">${esc(t('remake.rep.droids'))}</h4><div class="chips">${chips}</div>` : `<p class="reduced">${esc(t('remake.reduced'))}</p>`}
      <div class="foot"><button class="btn ghost" data-act="closeSheet">${esc(t('remake.close'))}</button>
        <button class="btn primary" data-act="repairGo" data-s="${s}">${esc(t(alive ? 'remake.action.assign' : 'menu.repair.fix'))}</button></div>`);
  }
  systemsGrid(S) {
    return `<h4>${esc(t('remake.rep.systems'))}</h4><div class="systems">${SYSTEMS.map((k, i) => {
      const st = S.destroyed[i] ? 'dx' : 's' + S.sysState[i];
      const word = S.destroyed[i] ? 'destroyed' : ['disabled', 'damaged', 'ok'][S.sysState[i]];
      return `<div class="sys ${st}" title="${esc(t('remake.sys.' + word))}">${esc(t('system.' + k))}</div>`;
    }).join('')}</div>`;
  }
  systems(S) { return `<header class="p-head"><h3>${esc(t('remake.rep.systems'))}</h3><button class="help-btn" data-act="help" data-d="4" title="${esc(t('remake.help.btn'))}" aria-label="${esc(t('remake.help.btn'))}">?</button></header><div class="p-body">${this.systemsGrid(S).replace(/^<h4>.*?<\/h4>/, '')}</div>`; }

  // ---------- invoice ----------
  invoiceHtml() {
    const S = this.S, v = this.inv || this.game.invoice(), r = this.game.result;
    const why = r === 'arrived' ? t('arrival.welcome', { destination: t(`mission.${this.course}.destination`) }) : `${t('end.aborted')}: ${t(r === 'noCargo' ? 'end.noCargo' : 'end.tooLate')}`;
    const row = (label, val, neg) => `<tr><td>${esc(label)}</td><td class="n ${neg && val ? 'neg' : ''}">${esc(money(neg ? -val : val))}</td></tr>`;
    const bounty = v.bounty.map((b, i) => S.killsByClass[i + 1] ? `<tr><td>${esc(this.shipName(i + 1, true))} × ${S.killsByClass[i + 1]}</td><td class="n">${esc(money(b))}</td></tr>` : '').join('');
    return `<h2>${esc(t('invoice.title'))}</h2><p class="why">${esc(why)}</p>
      <h3>${esc(t('invoice.bounties'))}</h3><table>${bounty || `<tr><td>${esc(t('remake.empty'))}</td><td></td></tr>`}</table>
      <table><tr class="sep"><td>${esc(t('invoice.cargo', { pct: S.cargo }))}</td><td class="n">${esc(money(v.cargo))}</td></tr>
      ${row(t('invoice.earlyBonus'), v.early)}${row(t('invoice.bountiesRow'), v.bounties)}${row(t('invoice.cargoCost'), v.cargoCost, true)}
      ${row(t('invoice.casualties'), v.casualties, true)}${row(t('invoice.lostAllies'), v.lostAllies, true)}${row(t('invoice.repairCosts'), v.repairs, true)}
      <tr class="tot"><td>${esc(t('invoice.total'))}</td><td class="n ${v.total < 0 ? 'neg' : ''}">${esc(money(v.total))}</td></tr></table>`;
  }

  // ---------- input ----------
  pick(which, e) {
    if (!this.started || this.game.over) return;
    const v = which === 'main' ? this.main : this.inset, tg = v.pick(this.S, e.clientX, e.clientY);
    if (tg >= 0) this.fireSheet(tg);
  }
  action(el) {
    if (!this.started) return;
    const S = this.S, c = this.game.commands, n = k => +el.dataset[k];
    if (this.game.over && !['tab', 'closeSheet'].includes(el.dataset.act)) return;
    switch (el.dataset.act) {
      case 'tab': this.selectTab(n('d')); break;
      case 'pauseBtn': this.onPause(); break;
      case 'closeSheet': closeSheet(); break;
      // messages
      case 'ack': c.acknowledge(n('d')); break;
      case 'nextMsg': c.nextMessage(); break;
      case 'clearMsg': c.clearMessages(); break;
      case 'autoMsg': c.autoAnswer(!S.autoAnswer); break;
      // weapons
      case 'fireMenu': this.targetPicker(); break;
      case 'fireAt': this.fireSheet(n('t')); break;
      case 'shots': this.shots = n('n'); this.fireSheet(n('t')); break;
      case 'fireGo': {
        const tg = n('t'), w = n('w');
        closeSheet();
        if (!S.deptAlive[0]) c.fireOnly(tg, w);
        else if (S.orderCount >= MAX_LIST) { c.refuse(); toast(esc(t('weapons.listFull'))); }
        else c.fire(tg, this.shots, w, S.orderCount);
        break;
      }
      case 'cancelOrder': c.cancelOrder(n('s')); break;
      // scanning
      case 'contact': this.fireSheet(n('t')); break;
      case 'examine': {
        const tg = n('t');
        if (!S.deptAlive[1]) { if (this.game.fixes.examClearOnConfirm) c.examineOnly(tg); else { c.clearExamList(); c.examine(tg, 0); } }
        else if (S.contactListed[tg]) break;
        else if (S.examLen >= MAX_LIST) { c.refuse(); toast(esc(t('scanning.listFull'))); }
        else c.examine(tg, S.examLen);
        break;
      }
      case 'cancelExam': c.cancelExamine(n('t')); break;
      // navigation
      case 'speed': { const v = n('v'); c.setSpeed(v, !!(S.maneuver && v && S.deptAlive[2])); break; }
      case 'evasive': if (S.maneuver) c.cancelManeuver(); else if (S.reqSpeed) c.setSpeed(S.reqSpeed, true); break;
      case 'setCourse': if (S.reqCourse !== n('c') || !S.deptAlive[2]) c.setCourse(n('c')); break;
      // engineering
      case 'dev': { const d = n('d'), st = S.devState[d]; if (st === 2 || st === 1) c.deviceOff(d); else c.deviceOn(d); break; }
      // repair
      case 'repairPick': this.repairSheet(n('s')); break;
      case 'droids': this.droids = n('n'); this.repairSheet(n('s')); break;
      case 'repairGo': {
        const s = n('s');
        closeSheet();
        if (!S.deptAlive[4]) c.repairOnly(s);
        else if (!S.slotWanted[s] && S.queueLen >= MAX_LIST) { c.refuse(); toast(esc(t('repair.listFull'))); }
        else c.repairAssign(s, this.droids, S.slotWanted[s] ? Math.max(0, Array.from(S.queue).slice(0, S.queueLen).indexOf(s)) : S.queueLen);
        break;
      }
      case 'repairCancel': c.repairCancel(n('s')); break;
    }
    this.lastUi = 0;                                      // re-render on the next frame
  }
  // drag to rank: rows inside [data-list] with a .grip handle
  dragStart(e) {
    const grip = e.target.closest('.grip');
    if (!grip || !this.started || this.game.over) return;
    const row = grip.closest('.row'), list = row.parentElement, panel = list.closest('.dept-panel');
    const rows = [...list.querySelectorAll(':scope > .row')], from = rows.indexOf(row), y0 = e.clientY;
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    this.dragging = panel; row.classList.add('dragging');
    const move = ev => { row.style.transform = `translateY(${ev.clientY - y0}px)`; };
    const end = ev => {
      grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', end); grip.removeEventListener('pointercancel', end);
      let to = 0;
      for (const r of rows) if (r !== row) { const b = r.getBoundingClientRect(); if (ev.clientY > b.top + b.height / 2) to++; }
      row.classList.remove('dragging'); row.style.transform = '';
      this.dragging = null; panel._html = null;
      if (ev.type === 'pointerup' && to !== from) this.rank(list.dataset.list, +row.dataset.id, to);
      this.lastUi = 0;
    };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
  }
  rank(list, id, to) {
    const c = this.game.commands;
    if (list === 'orders') c.rankOrder(id, to);
    else if (list === 'exam') c.examine(id, to);
    else if (list === 'power') c.rankDevice(id, to);
    else if (list === 'repair') c.repairRank(id, to);
  }
}
// department emblem (dept.icon.<d>) or its letter
function icon(d, cssW) { return isArt('dept.icon.' + d) ? `<img class="art" src="${art('dept.icon.' + d, '', cssW)}" alt="${esc(t(`dept.${d}.letter`))}">` : esc(t(`dept.${d}.letter`)); }
function speedLabel(v) { return v === 0 ? t('speed.stop') : v >= 8 ? t('speed.full') : t('speed.n', { n: v }); }
