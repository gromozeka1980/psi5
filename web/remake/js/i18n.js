// t(key, params): base strings (web/src/i18n) + remake-only strings (web/remake/i18n, prefix "remake."). A key missing in
// the current language falls back to English, then to the key itself (visible, so gaps are easy to spot).
const dicts = {};
let lang = 'ru';
const listeners = [];
const fetchJson = async u => { const r = await fetch(u); if (!r.ok) throw new Error(u + ': ' + r.status); return r.json(); };

export async function loadI18n() {
  for (const l of ['en', 'ru']) {
    const [base, extra] = await Promise.all([fetchJson(`../src/i18n/${l}.json`), fetchJson(`i18n/${l}.json`)]);
    dicts[l] = { ...base, ...extra };
  }
  try { lang = localStorage.getItem('psi5r.lang') || 'ru'; } catch {}
  document.documentElement.lang = lang;
}
export const getLang = () => lang;
export const msgSlots = () => dicts.en._msgSlots;
export function setLang(l) {
  lang = l;
  try { localStorage.setItem('psi5r.lang', l); } catch {}
  document.documentElement.lang = l;
  applyStatic();
  listeners.forEach(f => f());
}
export const onLang = f => listeners.push(f);
export function t(key, params) {
  let s = dicts[lang]?.[key] ?? dicts.en?.[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => params[k] ?? m);
  return s;
}
// static markup: data-i18n="key" sets textContent, data-i18n-title sets title + aria-label
export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(e => { e.textContent = t(e.dataset.i18n); });
  root.querySelectorAll('[data-i18n-title]').forEach(e => { e.title = t(e.dataset.i18nTitle); e.setAttribute('aria-label', e.title); });
}
