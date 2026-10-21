// Extra tables for docs/modern/BALANCE.md from tools/bots/out/*.json (written by study.mjs) and the game data.
//   node tools/bots/analyze.mjs > tools/bots/out/analysis.md
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { CREW, MISSIONS, crewInfo, missionFiles } from './bot.mjs';
import { groupBy, table } from './study.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
const load = n => { const f = path.join(OUT, n + '.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
const pct = v => (100 * v).toFixed(0) + '%';
const out = [];
const say = s => out.push(s);

// ---- static: enemy hit chance per shot (2 rolls) standard / evasive original / evasive fixed, evasive speed tables
const std = MISSIONS.map(m => missionFiles({ mission: m, crew: CREW.map(c => c[0]) }).missionFile);
const chance = MISSIONS.map((m, i) => std[i][0xc1] | std[i][0xc2] << 8);
const shot = p => 1 - (1 - p) ** 2;
say('## Enemy hit chance per enemy shot (2 rolls), standard vs evasive\n');
say(`| navigator | 0xb208 | evasive speed @8 (normal/stressed) | ${MISSIONS.map(m => `${m} std`).join(' | ')} | evasive original | evasive fixed |`);
say('|---|---|---|' + MISSIONS.map(() => '---|').join('') + '---|---|');
for (const nav of CREW[2]) {
  const info = crewInfo(['BORIS', 'JARU', nav, 'CRAVEN', 'ANXY']);
  const b = info.evasion;
  const n = missionFiles({ mission: 'MISN1', crew: ['BORIS', 'JARU', nav, 'CRAVEN', 'ANXY'] }).crewFiles[2];
  const stressed = n[0x46 + 16] | n[0x47 + 16] << 8;
  say(`| ${nav} | ${b} | ${info.evasiveSpeed[8]}/${stressed} | ${chance.map(c => pct(shot(c / 256))).join(' | ')} | ${pct(shot(1 - b / 256))} | ${pct(shot(b / 256))} |`);
}
say('');

// ---- crew candidates: pay and arrival relative to the mission mean (random crews)
const crew = load('crew');
if (crew) {
  for (const preset of [...new Set(crew.rows.map(r => r.preset))]) {
    const rows = crew.rows.filter(r => r.preset === preset);
    const mMean = Object.fromEntries(MISSIONS.map(m => { const rs = rows.filter(r => r.mission === m); return [m, [rs.reduce((s, r) => s + r.total, 0) / rs.length / 10, rs.filter(r => r.result === 'arrived').length / rs.length]]; }));
    say(`## Crew candidates, ${preset}, competent bot (${rows.length} missions, random other crew)\n`);
    say('Pay and arrival rate relative to the mission average with random crews (M$, percentage points).\n');
    say('| dept | ' + [0, 1, 2, 3, 4, 5].map(i => `#${i + 1}`).join(' | ') + ' |');
    say('|---|---|---|---|---|---|---|');
    ['Weapons', 'Scanning', 'Navigation', 'Engineering', 'Repair'].forEach((dn, d) => {
      const cells = CREW[d].map(name => {
        const rs = rows.filter(r => r.crew[d] === name);
        const dp = rs.reduce((s, r) => s + r.total / 10 - mMean[r.mission][0], 0) / rs.length;
        const da = rs.reduce((s, r) => s + (r.result === 'arrived') - mMean[r.mission][1], 0) / rs.length;
        const se = Math.sqrt(rs.reduce((s, r) => s + (r.total / 10 - mMean[r.mission][0] - dp) ** 2, 0) / rs.length / rs.length);
        return `${name} ${dp >= 0 ? '+' : ''}${dp.toFixed(1)}±${se.toFixed(1)} (${da >= 0 ? '+' : ''}${(100 * da).toFixed(0)})`;
      });
      say(`| ${dn} | ${cells.join(' | ')} |`);
    });
    say('');
  }
}

// ---- evasion: per navigator, hit chance per shot and outcomes
for (const [name, keys] of [['evasion', ['roll', 'speed', 'evade']], ['knobs', ['evasion', 'evasiveSpeed', 'evade']]]) {
  const e = load(name);
  if (!e) continue;
  say(`## ${name}: by ${keys.join(' / ')} (all navigators, all missions)\n`);
  say(table(groupBy(e.rows, keys), keys.join(' / ')) + '\n');
  say(`## ${name}: by ${keys.join(' / ')} / mission\n`);
  say(table(groupBy(e.rows, [...keys, 'mission']), [...keys, 'mission'].join(' / ')) + '\n');
  say(`## ${name}: by ${keys.join(' / ')} / navigator\n`);
  say(table(groupBy(e.rows, [...keys, 'nav']), [...keys, 'nav'].join(' / ')) + '\n');
}
// ---- per-flag deltas (paired runs: same seeds/crews) against the base of each column
for (const name of ['flags', 'flagsPassive']) {
  const e = load(name);
  if (!e) continue;
  const col = r => `${r.base}${r.policy && name === 'flags' ? ' / ' + r.policy : ''}`;
  const rows = e.rows.map(r => ({ ...r, c: col(r) }));
  const cols = [...new Set(rows.map(r => r.c))];
  const g = groupBy(rows, ['flag', 'c']);
  const get = (f, c) => g.find(x => x.key === `${f} | ${c}`);
  say(`## ${name}: effect of each flag (Δ pay M$ / Δ arrival pts / Δ enemy hits per min)\n`);
  say('ORIGINAL+flag: Δ = (ORIGINAL with only this fix) − ORIGINAL. MODERN-flag: Δ = (MODERN without this fix) − MODERN, so a negative Δ pay means the fix helps the player.\n');
  say(`| flag | ${cols.join(' | ')} |`);
  say('|---|' + cols.map(() => '---|').join(''));
  for (const f of [...new Set(rows.map(r => r.flag))].filter(f => f !== '(none)'))
    say(`| ${f} | ${cols.map(c => { const a = get(f, c), b = get('(none)', c); return `${(a.pay - b.pay).toFixed(1)} / ${(100 * (a.arrived - b.arrived)).toFixed(0)} / ${(a.hitsPerMin - b.hitsPerMin).toFixed(2)}`; }).join(' | ')} |`);
  say(`| **base** | ${cols.map(c => { const b = get('(none)', c); return `${b.pay.toFixed(1)} M$ / ${(100 * b.arrived).toFixed(0)}% / ${b.hitsPerMin.toFixed(2)}`; }).join(' | ')} |`);
  say('');
}
for (const name of ['difficulty', 'combat', 'policies']) {
  const e = load(name);
  if (!e) continue;
  say(`## ${name}\n`);
  say(table(groupBy(e.rows, e.keys), e.keys.join(' / ')) + '\n');
  say(table(groupBy(e.rows, [...e.keys, 'mission']), [...e.keys, 'mission'].join(' / ')) + '\n');
}
console.log(out.join('\n'));
