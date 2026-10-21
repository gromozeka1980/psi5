// Checks a translation of the modern remake's strings against the English source.
//   node tools/i18n_check.mjs [lang=ru] [--verbose]
// Errors: key parity, empty strings, placeholders ({x}) not preserved, leftover Latin text (only the designations
// listed in docs/i18n/GLOSSARY.md §7 are allowed). Warnings: glossary terms (GLOSSARY.md §8 "Checked terms"),
// typography (straight quotes, hyphen as dash, double spaces). Info: length report against the original widths.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), lang = args.find(a => !a.startsWith('-')) || 'ru', verbose = args.includes('--verbose');
const load = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const en = load('web/src/i18n/en.json'), tr = load(`web/src/i18n/${lang}.json`);
const glossary = fs.readFileSync(path.join(ROOT, 'docs/i18n/GLOSSARY.md'), 'utf8');
const limits = en._limits || {};
const strings = o => Object.keys(o).filter(k => !k.startsWith('_'));

const errors = [], warns = [];
const err = (k, m) => errors.push(`${k}: ${m}`), warn = (k, m) => warns.push(`${k}: ${m}`);

// glossary: allowed Latin (§7) and checked terms (§8)
const section = n => (glossary.split(/^## /m).find(s => s.startsWith(n)) || '');
const allowed = (section('7.').split('\n').find(l => /^Model/.test(l) || /:\s/.test(l)) || '')
  .split(':').slice(1).join(':').split(/,\s*/).map(s => s.trim().replace(/\.$/, '')).filter(Boolean)
  .sort((a, b) => b.length - a.length);
const terms = section('8.').split('\n').filter(l => /^\|/.test(l) && !/^\|\s*(en regex|---)/.test(l))
  .map(l => l.split(/(?<!\\)\|/).map(c => c.trim()).filter((c, i, a) => i > 0 && i < a.length - 1))
  .filter(c => c.length === 2).map(([re, stems]) => [new RegExp(re.replace(/\\\|/g, '|'), 'i'), stems.split('/').map(s => s.toLowerCase())]);

const enKeys = strings(en), trKeys = new Set(strings(tr));
for (const k of enKeys) if (!trKeys.has(k)) err(k, 'missing');
for (const k of trKeys) if (!(k in en)) err(k, 'not in en.json');

const ph = s => (s.match(/\{[^{}]*\}/g) || []).sort().join(' ');
const stripLatinOk = s => allowed.reduce((t, a) => t.split(a).join(' '), s);
const len = [];
for (const k of enKeys) {
  const e = en[k], r = tr[k];
  if (typeof r !== 'string') continue;
  if (!r.trim()) { err(k, 'empty'); continue; }
  if (ph(e) !== ph(r)) err(k, `placeholders "${ph(e)}" -> "${ph(r)}"`);
  const latin = stripLatinOk(r.replace(/\{[^{}]*\}/g, '')).match(/[A-Za-z]+/g);
  if (latin) err(k, `Latin text left: ${[...new Set(latin)].join(', ')}  «${r}»`);
  if (/"/.test(r)) warn(k, 'straight double quote (use «»)');
  if (/ - /.test(r)) warn(k, 'hyphen used as a dash (use « — »)');
  if (/ {2,}/.test(r) || /\n/.test(r)) warn(k, 'double space or line break');
  if (/…/.test(r)) warn(k, 'use "..." instead of "…"');
  for (const [re, stems] of terms) if (re.test(e) && !stems.some(s => r.toLowerCase().includes(s)))
    warn(k, `glossary: "${re.source}" expects ${stems.join('/')}  «${r}»`);
  len.push([k, e.length, r.length, limits[k] || 0]);
}

// length report
const over = len.filter(([, , r, lim]) => lim && r > lim);
const msgs = len.filter(([k]) => /^(msg|resume)\./.test(k));
const ratio = msgs.reduce((a, [, e, r]) => a + r, 0) / Math.max(1, msgs.reduce((a, [, e]) => a + e, 0));
const longest = msgs.filter(([, e, r]) => e >= 20).map(x => [...x, x[2] / x[1]]).sort((a, b) => b[4] - a[4]).slice(0, 10);

console.log(`${lang}: ${enKeys.length} keys, ${trKeys.size} translated`);
console.log(`length: messages+resumes ru/en = ${ratio.toFixed(2)}; ${over.length} strings longer than the original fixed width (fine for the modern UI, keep menus short)`);
if (verbose) for (const [k, e, r, lim] of over) console.log(`  over ${k}: ${r} > ${lim}  «${tr[k]}»`);
console.log('longest relative to English:'); for (const [k, e, r, , q] of longest) console.log(`  ${q.toFixed(2)} ${k} (${e} -> ${r})`);
for (const w of warns) console.log('WARN ' + w);
for (const e of errors) console.log('ERROR ' + e);
console.log(errors.length ? `${errors.length} errors, ${warns.length} warnings` : `OK (${warns.length} warnings)`);
process.exit(errors.length ? 1 : 0);
