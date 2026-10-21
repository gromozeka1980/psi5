// Balance study driver: runs bot missions in parallel worker threads and writes tools/bots/out/<exp>.json + .md.
//   node tools/bots/study.mjs <exp> [n]      exp: policies | flags | evasion | knobs | crew | all
// n = missions per (config, mission file). Runs are paired: run i of every config uses the same RNG wait and crew,
// so differences between configs are not seed noise. Results feed docs/modern/BALANCE.md.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { runMission, MISSIONS, CREW, PERSONAS } from './bot.mjs';
import { FLAGS, MODERN, PRESETS } from '../../web/src/engine/presets.js';
// every fix flag on: what the study called MODERN before the preset dropped evasiveKeepsSpeed (keeps old runs reproducible)
const ALL_FIXES = Object.fromEntries(FLAGS.map(([f]) => [f, true]));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');


// ---------------------------------------------------------------- run i -> wait + crew (paired across configs)
function rng(seed) { return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function seedOf(i, forced = {}) {
  const r = rng(i * 7919 + 13);
  const crew = CREW.map((c, d) => forced[d] ?? c[Math.floor(r() * 6)]);
  return { wait: Math.floor(r() * 4096), crew };
}
const without = (o, k) => { const c = { ...o }; delete c[k]; if (k === 'evasionInverted') delete c.evasion; return c; };

// ---------------------------------------------------------------- experiments
const EXPS = {
  // every policy under the original and the fully fixed game
  policies: n => cross({ preset: { ORIGINAL: {}, MODERN: ALL_FIXES }, policy: Object.keys(PERSONAS) }, n,
    c => ({ fixes: c.preset, policy: c.policy })),
  // each fix alone on top of ORIGINAL, and MODERN minus each fix (competent + evader)
  flags: n => cross({ flag: ['(none)', ...FLAGS.map(f => f[0])], base: ['ORIGINAL+flag', 'MODERN-flag'], policy: ['competent', 'evader'] }, n,
    c => ({ fixes: c.base === 'ORIGINAL+flag' ? (c.flag === '(none)' ? {} : { [c.flag]: true }) : (c.flag === '(none)' ? ALL_FIXES : without(ALL_FIXES, c.flag)), policy: c.policy })),
  // the same per flag for the passive player (speed 8, officers on their own)
  flagsPassive: n => cross({ flag: ['(none)', ...FLAGS.map(f => f[0])], base: ['ORIGINAL+flag', 'MODERN-flag'] }, n,
    c => ({ fixes: c.base === 'ORIGINAL+flag' ? (c.flag === '(none)' ? {} : { [c.flag]: true }) : (c.flag === '(none)' ? ALL_FIXES : without(ALL_FIXES, c.flag)), policy: 'passive' })),
  // difficulty restore for the recommended modern preset (MODERN, crew evasive speed tables): enemy hit chance /
  // shield penetration scaled, per policy
  difficulty: n => cross({ knob: ['base', 'enemy0.75', 'enemy0.6', 'enemy0.5', 'penetrate0.6', 'enemy0.6+pen0.75'], policy: ['passive', 'naive', 'competent', 'evader'] }, n,
    c => ({ fixes: MODERN, policy: c.policy, balance: c.knob.split('+').reduce((b, k) => ({ ...b, ...knob(k.replace(/^pen(?!etrate)/, 'penetrate')) }), {}) })),
  // the recommended modern preset (BALANCE.md) for every policy
  recommended: n => cross({ policy: Object.keys(PERSONAS) }, n,
    c => ({ fixes: PRESETS.modern.fixes, policy: c.policy, balance: RECOMMENDED })),
  // evasion: hit roll original/fixed x evasive speed table/kept x when to evade, per navigator, on MODERN otherwise
  evasion: n => cross({ roll: ['inverted', 'fixed'], speed: ['crewTable', 'keepSpeed'], evade: ['never', 'underFire', 'always'], nav: CREW[2] }, n,
    c => ({ fixes: { ...without(MODERN, 'evasionInverted'), ...(c.roll === 'fixed' ? { evasionInverted: true } : {}), ...(c.speed === 'keepSpeed' ? { evasiveKeepsSpeed: true } : {}) },
      policy: 'evader', persona: { evade: c.evade }, forced: { 2: c.nav } })),
  // proposed evasion knobs (MODERN + fixed roll, crew evasive speed tables unless set)
  knobs: n => cross({ evasion: ['original', 'crewScaled', 0.33, 0.5, 0.67], evasiveSpeed: ['original', 0.75], evade: ['never', 'underFire'], nav: CREW[2] }, n,
    c => ({ fixes: MODERN, balance: { evasion: c.evasion, evasiveSpeed: c.evasiveSpeed }, policy: 'evader', persona: { evade: c.evade }, forced: { 2: c.nav } })),
  // combat / economy knobs under MODERN (competent): our miss thresholds, enemy hit chance, penetration
  combat: n => cross({ knob: ['base', 'ourMiss1.5', 'ourMiss2', 'ourReload1.5', 'enemy1.25', 'enemy0.75', 'penetrate0.75'], policy: ['competent', 'aggressive'] }, n,
    c => ({ fixes: ALL_FIXES, policy: c.policy, balance: knob(c.knob) })),
  // crew candidates (random crews, many runs): marginal value of each candidate
  crew: n => cross({ preset: { ORIGINAL: {}, MODERN: ALL_FIXES }, policy: ['competent'] }, n, c => ({ fixes: c.preset, policy: c.policy })),
};
export const RECOMMENDED = PRESETS.modern.balance;   // { enemyHitChance: 0.6, evasion: 'crewScaled' } + defaults
function knob(k) {
  const m = /^(\w+?)([\d.]+)$/.exec(k);
  if (!m) return {};
  return { ourMiss: { ourMiss: +m[2] }, ourReload: { ourReload: +m[2] }, enemy: { enemyHitChance: +m[2] }, penetrate: { penetrate: +m[2] } }[m[1]];
}
// cartesian product of the dimensions x missions x n runs
function cross(dims, n, make) {
  const keys = Object.keys(dims), jobs = [];
  const vals = keys.map(k => Array.isArray(dims[k]) ? dims[k].map(v => [String(v), v]) : Object.entries(dims[k]));
  const rec = (i, cfg, label) => {
    if (i === keys.length) {
      const base = make(cfg);
      for (const mission of MISSIONS) for (let r = 0; r < n; r++) {
        const { wait, crew } = seedOf(r + 1000 * MISSIONS.indexOf(mission), base.forced);
        jobs.push({ ...label, mission, run: r, wait, crew, fixes: base.fixes, balance: base.balance || {}, policy: base.policy, persona: base.persona });
      }
      return;
    }
    for (const [name, v] of vals[i]) rec(i + 1, { ...cfg, [keys[i]]: v }, { ...label, [keys[i]]: name });
  };
  rec(0, {}, {});
  return { jobs, keys };
}

// ---------------------------------------------------------------- parallel run
async function runAll(jobs) {
  const W = Math.max(1, os.cpus().length - 2), CHUNK = 2, out = [];
  let next = 0, done = 0, t0 = Date.now(), lastLog = 0;
  await Promise.all([...Array(W)].map(() => new Promise((resolve, reject) => {
    const w = new Worker(fileURLToPath(import.meta.url));
    const feed = () => { if (next >= jobs.length) { w.terminate(); resolve(); return; } const b = jobs.slice(next, next += CHUNK); w.postMessage(b); };
    w.on('message', r => {
      out.push(...r); done += r.length;
      if (Date.now() - lastLog > 15000) { lastLog = Date.now(); console.log(`  ${done}/${jobs.length} missions, ${((Date.now() - t0) / 1000).toFixed(0)} s`); }
      feed();
    });
    w.on('error', reject);
    feed();
  })));
  return out;
}

// ---------------------------------------------------------------- aggregation
const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN;
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };
export function aggregate(rows) {
  const n = rows.length, sum = f => rows.reduce((s, r) => s + f(r), 0);
  const pay = rows.map(r => r.total / 10), mins = sum(r => r.secs) / 60;
  const es = [0, 1].map(i => sum(r => r.enemyShots[i])), ht = [0, 1].map(i => sum(r => r.hitsTaken[i]));
  const arrived = rows.filter(r => r.result === 'arrived');
  return {
    n, arrived: sum(r => r.result === 'arrived') / n, noCargo: sum(r => r.result === 'noCargo') / n, tooLate: sum(r => r.result === 'tooLate') / n,
    pay: mean(pay), paySe: sd(pay) / Math.sqrt(n), cargo: mean(rows.map(r => r.cargo)), cargoArrived: mean(arrived.map(r => r.cargo)),
    late: mean(arrived.map(r => r.late)), minutes: mean(rows.map(r => r.minutes)),
    kills: sum(r => r.killsN) / n, shots: sum(r => r.shots) / n, killsPerShot: sum(r => r.killsN) / Math.max(1, sum(r => r.shots)),
    allyKills: sum(r => (r.kills[8] || 0) + (r.kills[9] || 0)) / n,
    hitsTaken: (ht[0] + ht[1]) / n, hitsPerMin: (ht[0] + ht[1]) / Math.max(1, mins), combatShare: sum(r => r.combatSec) / Math.max(1, sum(r => r.secs)),
    hitRateStd: ht[0] / Math.max(1, es[0]), hitRateEva: es[1] ? ht[1] / es[1] : NaN, evasiveShare: sum(r => r.evasiveSec) / Math.max(1, sum(r => r.secs)),
    sysHits: sum(r => r.sysHits.reduce((a, b) => a + b, 0)) / n, destroyed: sum(r => r.sysDestroyed) / n,
    officersLost: sum(r => r.officersLost.length) / n, overloadEng: sum(r => r.overloadEng) / Math.max(1, sum(r => r.secs)),
    repairedPoints: sum(r => r.repairedPoints) / n, cargoLossHit: sum(r => r.cargoLoss.hit) / n, cargoLossLoot: sum(r => r.cargoLoss.loot) / n,
    cargoLossLate: sum(r => r.cargoLoss.late) / n, avgSpeed: mean(rows.map(r => r.avgSpeed)), cmds: sum(r => r.cmds) / n,
  };
}
export function groupBy(rows, keys) {
  const g = new Map();
  for (const r of rows) { const k = keys.map(x => r[x]).join(' | '); if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
  return [...g].map(([k, rs]) => ({ key: k, ...aggregate(rs) }));
}
const pct = v => isNaN(v) ? '–' : (100 * v).toFixed(0) + '%';
const f1 = v => isNaN(v) ? '–' : v.toFixed(1), f2 = v => isNaN(v) ? '–' : v.toFixed(2);
export function table(groups, keyName) {
  const head = `| ${keyName} | n | arrived | noCargo | late | pay M$ (±se) | cargo% | min vs sched | kills | kill/shot | hits taken | hit/min | P(hit) std | P(hit) eva | evasive | sys hits | officers lost | eng overload |`;
  const lines = groups.map(g => `| ${g.key} | ${g.n} | ${pct(g.arrived)} | ${pct(g.noCargo)} | ${pct(g.tooLate)} | ${f1(g.pay)} ±${f1(g.paySe)} | ${f1(g.cargo)} | ${f1(g.late)} | ${f1(g.kills)} | ${f2(g.killsPerShot)} | ${f1(g.hitsTaken)} | ${f2(g.hitsPerMin)} | ${pct(g.hitRateStd)} | ${pct(g.hitRateEva)} | ${pct(g.evasiveShare)} | ${f1(g.sysHits)} | ${f2(g.officersLost)} | ${pct(g.overloadEng)} |`);
  return [head, head.replace(/[^|]+/g, '---'), ...lines].join('\n');
}

async function main() {
  const [exp = 'policies', nArg] = process.argv.slice(2);
  const names = exp === 'all' ? Object.keys(EXPS) : [exp];
  fs.mkdirSync(OUT, { recursive: true });
  for (const name of names) {
    const n = +(nArg || 20);
    const { jobs, keys } = EXPS[name](n);
    console.log(`${name}: ${jobs.length} missions`);
    const t0 = Date.now();
    const rows = await runAll(jobs);
    const secs = (Date.now() - t0) / 1000;
    const slim = rows.map(r => { const { fixes, balance, ...rest } = r; return rest; });
    fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ exp: name, n, keys, seconds: secs, rows: slim }));
    let md = `# ${name} (${rows.length} missions, ${secs.toFixed(0)} s)\n\n## by config\n\n${table(groupBy(rows, keys), keys.join(' / '))}\n\n`;
    md += `## by config and mission\n\n${table(groupBy(rows, [...keys, 'mission']), [...keys, 'mission'].join(' / '))}\n`;
    fs.writeFileSync(path.join(OUT, `${name}.md`), md);
    console.log(`${name}: done in ${secs.toFixed(0)} s -> tools/bots/out/${name}.md`);
  }
}

if (!isMainThread) {
  parentPort.on('message', jobs => {
    const res = jobs.map(j => {
      const p = j.persona ? { ...PERSONAS[j.policy], ...j.persona } : undefined;
      const m = runMission({ ...j, persona: p });
      delete m.invoice.bounty;
      return { ...j, persona: undefined, crewNames: undefined, ...m };
    });
    parentPort.postMessage(res);
  });
} else if (process.argv[1] === fileURLToPath(import.meta.url)) main();
