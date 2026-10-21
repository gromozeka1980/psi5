// Fix-flag tests for the engine (web/src/engine/presets.js). For every flag: a targeted situation (state pokes) run once
// with ORIGINAL and once with only that flag on; asserts the original keeps the old behaviour and the flag gives the
// fixed one. Then a smoke run of whole missions with MODERN and random commands (no exceptions, sane invariants).
//   node tools/fixes_test.mjs            all
//   node tools/fixes_test.mjs flags      only the per-flag tests
//   SMOKE_TICKS=400000 node tools/fixes_test.mjs smoke
import fs from 'fs';
import path from 'path';
import assert from 'assert/strict';
import { fileURLToPath } from 'url';
import { Game } from '../web/src/engine/game.js';
import { CHECKS } from '../web/src/engine/index.js';
import { ORIGINAL, MODERN, FLAGS, PRESETS, ORIGINAL_BALANCE } from '../web/src/engine/presets.js';
const ALL_FIXES = Object.fromEntries(FLAGS.map(([f]) => [f, true]));
import { queueOrder, dropOrder, launchOurShots, ourHitTest, enemyHitTest } from '../web/src/engine/combat.js';
import { post } from '../web/src/engine/messages.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = n => new Uint8Array(fs.readFileSync(path.join(ROOT, n)));
const IMAGE = new Uint8Array(fs.readFileSync(path.join(ROOT, 'web/data/psi5_ds.bin')));
const RUN = Object.fromEntries(CHECKS.map(c => [c.fn, c.run]));
const CREW = ['BORIS', 'JARU', 'KLG', 'CRAVEN', 'ANXY'];

// a game right after the mission start (initGame done, nothing simulated yet)
function start(fixes, { mission = 'MISN1.BIN', crew = CREW, demo = false, balance } = {}) {
  const events = [];
  const g = new Game({ image: IMAGE, fixes, balance, emit: (...e) => events.push(e) });
  g.newMission({ missionFile: bin(mission), crewFiles: crew.map(c => bin(c + '.BIN')), dashFile: bin('DASH.BIN'), flags: { demo } });
  for (let i = 0; i < 100000 && !g.started; i++) { g.tick(); if (!demo && i === 60) g.commands.begin(); }   // after the key flush
  if (!g.started) throw new Error('mission did not start');
  g.events = events;
  return g;
}
const run = (g, fn, ...a) => RUN[fn](g.S, g.S, g.ctx, ...a);
const ticks = (g, n) => { for (let i = 0; i < n; i++) g.tick(); };
const queueOf = (S, d) => [...S.msgQueue.slice(d * 8, d * 8 + S.msgCount[d])];

// [flag, scenario(g) -> value, check(original, fixed)]
const TESTS = {};
const T = (flag, scenario, check, opts) => { TESTS[flag] = { scenario, check, opts }; };

// ---------------------------------------------------------------- combat
function shotAt(S, d, k, t, w = 0) {   // our shot slot 6+d flying at ship slot k (target t), same depth
  S.objActive[k] = 1; S.shipTarget[k] = t * 2; S.objZ[k] = 0x2000; S.contactClass[t] = 1;
  S.objActive[6 + d] = 1; S.objKind[6 + d] = w; S.objZ[6 + d] = 0x2000;
  S.shotTarget[d] = t * 2; S.shotShip[d] = k * 2;
  S.contactDamage[t] = 1;              // engines already hit: the next hit kills
  S.gunMiss.fill(0); S.deptStress[0] = 0;
}
T('shotSlots', g => { const S = g.S; shotAt(S, 0, 1, 3); S.objZ[7] = 0x2000; ourHitTest(S, S, g.ctx); return S.contactKilledBy[3]; },
  (o, f) => { assert.equal(o, 0, 'slot 6 never tested'); assert.equal(f, 1, 'slot 6 kills'); });
T('shotSlots/oneKill', g => {   // both shots at one ship: the second must not kill it again
  const S = g.S; shotAt(S, 0, 1, 3); shotAt(S, 1, 1, 3); ourHitTest(S, S, g.ctx);
  return g.events.filter(e => e[0] === 'explosion').length;
}, (o, f) => { assert.equal(o, 1); assert.equal(f, 1); });
TESTS['shotSlots/oneKill'].flag = 'shotSlots';
T('depthCheck', g => { const S = g.S; shotAt(S, 1, 3, 4); S.objVx[1] = 0x7000; ourHitTest(S, S, g.ctx); return S.contactKilledBy[4]; },
  (o, f) => { assert.equal(o, 0, 'aft ship compared with vx of ship 1'); assert.equal(f, 1); });
T('weakness', g => { const S = g.S; shotAt(S, 1, 1, 5, 2); S.gunMiss[2] = 0x40; S.contactWeakness[5] = 3; ourHitTest(S, S, g.ctx); return S.contactKilledBy[5]; },
  (o, f) => { assert.equal(o, 0, 'miss threshold x4 = 256: never hits'); assert.equal(f, 3, 'cannon kill'); });
T('evasionInverted', g => {
  const S = g.S; S.objActive[5] = 1; S.objKind[5] = 0; S.objZ[5] = 0x100; S.navState = 1; S.evasion = 0;
  enemyHitTest(S, S, g.ctx); return S.pendingHit.filter(Boolean).length;
}, (o, f) => { assert.equal(o, 1, 'rand >= 0: always hit'); assert.equal(f, 0, 'rand < 0: never'); });
T('channelPriority', g => {
  const S = g.S;
  for (const [c, t] of [[0, 2], [4, 5]]) { S.chTarget[c] = t; S.chShots[c] = 1; S.chWeapon[c] = 0; S.contactOnScreen[t] = 1; S.contactClass[t] = 1; }
  S.launchBlocked = 0; launchOurShots(S, S, g.ctx); return S.shotTarget[0] >> 1;
}, (o, f) => { assert.equal(o, 5, 'channel 4 first'); assert.equal(f, 2, 'channel 0 first'); });
T('autoFireAllWeapons', g => {
  const S = g.S, t = 7;
  S.contactClass[t] = 1; S.contactOnScreen[t] = 1; S.contactLocked[t] = 1; S.contactHostile[t] = 1; S.contactSpawnPos[t] = S.pos;
  S.contactsDetected = 1; S.autoFireIdle = 0; S.autoFireWeapon = 3; S.sysState[4] = 0;   // missiles out
  run(g, 'f_16f3'); return S.orderCount;
}, (o, f) => { assert.equal(o, 0, 'tried missiles only'); assert.equal(f, 1, 'blasters queued'); });
T('dropOrderFlag', g => {
  const S = g.S; S.contactClass[5] = 1;
  queueOrder(S, 5, 3, 0, 0); queueOrder(S, 5, 3, 1, 1);
  dropOrder(S, S.orderSerial[S.orderQueue[0]], g.ctx); return [S.targetOrdered[5], S.targetOrdered[1]];
}, (o, f) => { assert.deepEqual(o, [0, 1], 'flag on slot 1'); assert.deepEqual(f, [1, 0]); });
T('spriteSpill', g => {
  // a ship close by, left of and above the screen: the original ORs its top rows into the last rear star's y
  const S = g.S;
  S.view = S.wantedView = 0; S.viewBlank = 0; S.textShown = 0; S.displayTicks = 3; S.launchBlocked = 1; S.speed = 0;
  S.objActive[0] = 1; S.objView[0] = 0; S.objKind[0] = 2; S.objZ[0] = 0x800; S.objMoveDelay[0] = 99;
  S.shipTimer[0] = 99; S.shipTarget[0] = 2; S.contactClass[1] = 1;
  S.objX[0] = 0xfe00; S.objY[0] = 0xf800; S.starsY[23] = 0;
  run(g, 'f_6e26'); return S.starsY[23];
}, (o, f) => { assert.notEqual(o, 0, 'spilled'); assert.equal(f, 0); });

// ---------------------------------------------------------------- navigation
function navReady(S) { S.speed = 5; S.reqSpeed = 5; S.enginePower[0] = S.enginePower[1] = 0; S.scanTimer = 0; }
T('courseChangeReset', g => {
  const S = g.S; navReady(S);
  S.course = 0; S.reqCourse = 1;
  const toPort = S.courseLateral[1] < S.courseLateral[0];
  S.lateral = toPort ? S.portThreshold + 1 : S.starThreshold - 1;
  run(g, 'f_2cf2'); return [S.course, S.lateral];
}, (o, f) => { assert.equal(o[0], 1); assert.notEqual(o[1], 0, 'counter stays at threshold'); assert.deepEqual(f, [1, 0]); });
T('riskScanInBounds', g => {
  const S = g.S; navReady(S); S.pos = 49; S.scanTimer = 1000; S.scanCourse = 2;
  S.courseMasks[3 * 50 + 49] = 0; S.courseMasks[4 * 50] = 0xff;
  run(g, 'f_2cf2'); return S.risk[3];
}, (o, f) => { assert.equal(o, 8, 'reads course 4 position 0'); assert.equal(f, 0); });
T('navStressOwnLifeSupport', g => {
  const S = g.S; S.speed = 0; S.reqSpeed = 0; S.sysState[23] = 0; S.sysState[24] = 2;
  run(g, 'f_2cf2'); return S.deptStress[2];
}, (o, f) => { assert.equal(o, 1, 'engineer life support'); assert.equal(f, 0); });
T('stopClearsShake', g => { const S = g.S; S.speed = 0; S.reqSpeed = 0; S.shake = 1; run(g, 'f_2cf2'); return S.shake; },
  (o, f) => { assert.equal(o, 1); assert.equal(f, 0); });
T('evasiveKeepsSpeed', g => {
  const S = g.S; navReady(S); S.speed = 8; S.reqSpeed = 8; S.maneuver = 1; S.course = S.reqCourse = 0;
  run(g, 'f_2cf2'); return [S.work, S.evasiveSpeed[7]];
}, (o, f) => { assert.equal(o[0], o[1], 'evasive table'); assert.equal(f[0], 7, 'actual speed'); assert.ok(o[0] < 7); });

// ---------------------------------------------------------------- power
T('powerSkipUnaffordable', g => {
  // 600 units: shields 400, missiles 80, damaged blasters 50 + cannons 30, thermos 80 do not fit; an idle engine (40) does
  const S = g.S; S.sysState[14] = S.sysState[15] = 1; S.sysState[5] = S.sysState[6] = 1;
  S.devState.fill(2, 0, 13); S.devState[11] = 0; S.engineUse[0] = S.engineUse[1] = 0;
  run(g, 'f_37be'); return [...S.powered.slice(0, 13)];
}, (o, f) => {
  const n = a => a.reduce((x, y) => x + y, 0);
  assert.ok(n(f) > n(o), `fixed powers more (${n(o)} -> ${n(f)})`);
  o.forEach((p, i) => p && assert.equal(f[i], 1, 'everything powered originally stays powered'));
});
T('lifeSupportOverload', g => { const S = g.S; S.devState.fill(0, 0, 13); S.sysState[23] = 0; S.deptStress[3] = 0; run(g, 'f_37be'); return [S.deptStress[3], S.overloadTime]; },
  (o, f) => { assert.equal(o[0], 0); assert.equal(f[0], f[1]); });

// ---------------------------------------------------------------- scanning
T('examsComplete', g => {
  const S = g.S, first = (run(g, 'f_243d'), queueOf(S, 1).includes(0x1a));
  // then a fully examined contact on the list
  const t = 9; S.contactClass[t] = 1; S.contactsDetected = 1;
  for (const f of ['contactLocked', 'contactIdClass', 'contactDamageKnown', 'contactWeaknessKnown']) S[f][t] = 1;
  S.msgCount[1] = 0; run(g, 'f_232b', t, 0); S.scanStepCount = 1;
  run(g, 'f_243d'); return [first, queueOf(S, 1).includes(0x1a)];
}, (o, f) => { assert.deepEqual(o, [true, false], 'at start only'); assert.deepEqual(f, [false, true], 'after the batch'); });
function spawnAt(S, mask, cursor) { S.spawnMask = mask; S.spawnTries = 16; S.spawnCursor = cursor; S.scanStepCount = 0; S.spawnLastPos = S.position; S.spawnLastRoute = S.route; S.contactsDetected = 0; }
T('maskBit8', g => { const S = g.S; spawnAt(S, 0x100, 14); run(g, 'f_243d'); return S.contactsDetected; },
  (o, f) => { assert.equal(o, 0); assert.equal(f, 1); });
T('maskBit15', g => { const S = g.S; spawnAt(S, 0x8000, 13); run(g, 'f_243d'); return S.contactsDetected; },
  (o, f) => { assert.equal(o, 1, 'phantom'); assert.equal(f, 0); });
T('startWindow', g => { const S = g.S; const before = [S.pos, S.route]; run(g, 'f_243d'); return [before, S.spawnMask, S.navThreatPending]; },
  (o, f) => { assert.deepEqual(o[0], [0, 0], 'MISN3 starts at A 0'); assert.equal(o[1], 0); assert.notEqual(f[1], 0); assert.equal(f[2], 1); },
  { mission: 'MISN3.BIN' });
T('trackLockPower', g => {
  const S = g.S, t = 4; S.contactClass[t] = 1; S.contactsDetected = 1; run(g, 'f_232b', t, 0);
  S.powered[13] = 0; run(g, 'f_243d'); return S.contactLockProgress[t];
}, (o, f) => { assert.equal(o, 1); assert.equal(f, 0); });

// ---------------------------------------------------------------- messages
T('msgOverflow', g => { const S = g.S; for (let m = 1; m <= 9; m++) post(S, m * 2, g.ctx); return queueOf(S, 0); },
  (o, f) => { assert.deepEqual(o, [4, 4, 6, 8, 10, 12, 14, 18], 'm8 lost, m2 twice'); assert.deepEqual(f, [4, 6, 8, 10, 12, 14, 16, 18]); });

// ---------------------------------------------------------------- damage / repair
// force every hit roll to land on t (hitRoll thresholds), shields unpowered
function forceHit(S, t, hits = [1]) {
  S.hitRoll.fill(0, 3); for (let i = t; i < 29; i++) S.hitRoll[i] = 0x100;
  S.powered.fill(0, 0, 4); hits.forEach((h, i) => { S.pendingHit[i] = h; });
}
function openSlot(S, k, sys, damage, state = 1) {
  S.slotId[k] = k; S.slotSys[k] = sys; S.slotDamage[k] = damage; S.sysState[sys] = state; S.openSlots++;
}
T('hitLoopIndex', g => { const S = g.S; forceHit(S, 26, [1, 1]); run(g, 'f_4922'); return [S.pendingHit.filter(Boolean).length, S.cargo]; },
  (o, f) => { assert.equal(o[0], 1, 'second hit waits'); assert.equal(f[0], 0); assert.ok(f[1] < o[1]); });
T('disabledRecount', g => { const S = g.S; openSlot(S, 0, 5, 10, 0); forceHit(S, 5); run(g, 'f_4922'); return S.disabledCount; },
  (o, f) => { assert.equal(o, 1); assert.equal(f, 0); });
T('officerDeathOnce', g => {
  const S = g.S; S.pos = 49; S.boarderKill.fill(2); S.deptAlive[2] = 0; forceHit(S, 27); run(g, 'f_4922');
  return g.events.filter(e => e[0] === 'officerDied').length;
}, (o, f) => { assert.equal(o, 1, 'dies again'); assert.equal(f, 0); });
T('ordersClearFreeze', g => {
  const S = g.S; S.nextSerial = 5; S.contactClass[3] = 1; queueOrder(S, 3, 2, 0, 0); queueOrder(S, 3, 2, 1, 0);
  S.pos = 49; S.boarderKill.fill(0); forceHit(S, 27); run(g, 'f_4922');
  return [S.orderCount, g.events.some(e => e[0] === 'freeze')];
}, (o, f) => { assert.deepEqual(o, [2, true], 'would hang'); assert.deepEqual(f, [0, false]); });
T('ordersClearFreeze/fireOnly', g => {
  const S = g.S; S.nextSerial = 5; contacts(S, 3, 6); queueOrder(S, 3, 2, 0, 0); queueOrder(S, 3, 2, 1, 0);
  S.deptAlive[0] = 0; g.commands.fireOnly(6, 2); ticks(g, 700);
  return [S.orderCount, S.orderTarget[S.orderQueue[0]], g.events.some(e => e[0] === 'freeze')];
}, (o, f) => { assert.equal(o[2], true, 'would hang'); assert.deepEqual(f, [1, 6, false]); });
TESTS['ordersClearFreeze/fireOnly'].flag = 'ordersClearFreeze';
function job(g, k, sys, damage, droids, pos = 0) { openSlot(g.S, k, sys, damage); run(g, 'f_43a2', k, droids, pos); }
T('repairRatePerTeam', g => { job(g, 0, 5, 10, 7); run(g, 'f_4479'); return [g.S.slotWork[0], Math.max(...g.S.repairWork.slice(1, 8)), g.S.repairWork[7]]; },
  (o, f) => { assert.equal(o[0], o[2]); assert.equal(f[0], f[1]); assert.ok(o[2] < f[1], 'ANXY: 7 droids slower than fewer'); });
T('repairWorkCarry', g => { const S = g.S; S.slotWork[0] = 200; forceHit(S, 5); run(g, 'f_4922'); return [S.slotSys[0], S.slotWork[0]]; },
  (o, f) => { assert.deepEqual(o, [5, 200]); assert.deepEqual(f, [5, 0]); });
T('repairSkipAfterFinish', g => {
  const S = g.S; job(g, 0, 5, 1, 1, 0); job(g, 1, 6, 5, 1, 1); S.slotWork[0] = 255;
  run(g, 'f_4479'); return S.slotWork[1];
}, (o, f) => { assert.equal(o, 0, 'skipped'); assert.ok(f > 0); });
T('repairGrabCap', g => {
  const S = g.S; job(g, 0, 5, 10, 6, 0); job(g, 1, 6, 10, 2, 1);
  S.slotDroids[0] = 6;                                       // counted but not actually busy (anonymous droids)
  run(g, 'f_4479'); return S.slotDroids[1];
}, (o, f) => { assert.equal(o, 7, 'took every ready droid'); assert.equal(f, 2); });
T('cancelNoCompleteMsg', g => { job(g, 0, 5, 10, 2); run(g, 'f_42e4', 0); return queueOf(g.S, 4).includes(0x02); },
  (o, f) => { assert.equal(o, true); assert.equal(f, false); });
T('cancelNoCompleteMsg/finish', g => { job(g, 0, 5, 1, 1); g.S.slotWork[0] = 255; run(g, 'f_4479'); return queueOf(g.S, 4).includes(0x02); },
  (o, f) => { assert.equal(o, true); assert.equal(f, true, 'still reported when a job finishes'); });
TESTS['cancelNoCompleteMsg/finish'].flag = 'cancelNoCompleteMsg';
T('engineerDeathDelays', g => { const S = g.S; S.delayOverload[0] = 77; S.sysState[23] = 0; S.engLifeTimer = 0; run(g, 'f_4922'); return [S.deptAlive[3], S.delayOverload[0]]; },
  (o, f) => { assert.deepEqual(o, [0, 0x14]); assert.deepEqual(f, [0, 77]); });
T('destroyedFreesSlot', g => { const S = g.S; openSlot(S, 0, 5, 99, 0); forceHit(S, 5); run(g, 'f_4922'); return [S.destroyed[5], S.openSlots]; },
  (o, f) => { assert.deepEqual(o, [1, 1], 'freed slot still counted'); assert.deepEqual(f, [1, 0]); });
T('demoLootRate', g => {
  const S = g.S; S.powered.fill(0, 0, 10); S.speed = 0; S.contactClass[0] = 1; S.alarmOn = 1; S.damageTick = 1; S.cargo = 100;
  run(g, 'f_4922'); return S.cargo;
}, (o, f) => { assert.equal(o, 99); assert.equal(f, 100); }, { demo: true });

// ---------------------------------------------------------------- game commands
function contacts(S, ...ts) { for (const t of ts) { S.contactClass[t] = 1; S.contactSpawnPos[t] = S.pos; S.contactsDetected++; } }
T('clearAllMessages', g => {
  const S = g.S; ticks(g, 450);
  S.msgCount.fill(0); for (const id of [0x02, 0x04, 0x602, 0x802]) post(S, id, g.ctx);   // W, E, R
  g.clearAllMessages(); return [...S.msgCount.slice(0, 5)];
}, (o, f) => { assert.notDeepEqual(o, [0, 0, 0, 0, 0], 'E/R survive'); assert.deepEqual(f, [0, 0, 0, 0, 0]); });
T('bountyReset', g => { const S = g.S; S.killsByClass[1] = 2; S.bountyPerKill[1] = 50; const a = g.invoice().bounties; return [a, g.invoice().bounties]; },
  (o, f) => { assert.equal(o[1], 2 * o[0], 'adds up'); assert.equal(f[1], f[0]); });
T('examClearOnConfirm', g => {
  const S = g.S; ticks(g, 450);
  contacts(S, 2, 3); for (const t of [2, 3]) run(g, 'f_232b', t, 0);
  S.deptAlive[1] = 0; g.commands.clearExamList(); ticks(g, 5);
  const afterE = S.examLen;
  g.commands.examineOnly(3); ticks(g, 150);
  return [afterE, S.examLen, S.examList[0]];
}, (o, f) => { assert.equal(o[0], 0, 'emptied on E'); assert.deepEqual(f, [2, 1, 3], 'kept until confirm'); });

// ---------------------------------------------------------------- balance knobs (each vs its original default)
function enemyHits(balance, { evasive = false, fixes = {} } = {}) {   // enemy shots at us: how many of 400 hit
  const g = start(fixes, { balance }), S = g.S; let hits = 0;
  for (let i = 0; i < 400; i++) {
    S.pendingHit.fill(0); S.navState = evasive ? 1 : 0;
    S.objActive[5] = 1; S.objKind[5] = 0; S.objZ[5] = 0x100;
    enemyHitTest(S, S, g.ctx); hits += S.pendingHit.some(Boolean);
  }
  return hits;
}
function ourKills(balance) {                                       // our shots with miss threshold 200: kills of 100
  const g = start({}, { balance }), S = g.S; let kills = 0;
  for (let i = 0; i < 100; i++) { S.contactKilledBy[3] = 0; shotAt(S, 1, 1, 3); S.gunMiss[0] = 200; ourHitTest(S, S, g.ctx); kills += S.contactKilledBy[3] > 0; }
  return kills;
}
function balanceTests() {
  let fail = 0;
  const B = (name, fn) => { try { fn(); console.log(`ok   balance ${name}`); } catch (e) { fail++; console.log(`FAIL balance ${name}: ${e.message}`); } };
  B('defaults', () => {
    assert.deepEqual({ ...new Game({ image: IMAGE }).balance }, { ...ORIGINAL_BALANCE });
    assert.deepEqual({ ...PRESETS.modern.balance }, { ...ORIGINAL_BALANCE, enemyHitChance: 0.6, evasion: 'crewScaled' });
    assert.equal(PRESETS.modern.fixes, MODERN);
    assert.throws(() => new Game({ image: IMAGE, balance: { enemyHitChanse: 1 } }));
    assert.throws(() => new Game({ image: IMAGE, balance: { evasion: 'crew' } }));
  });
  B('enemyHitChance', () => {
    const o = enemyHits({}), h = enemyHits({ enemyHitChance: 0.5 }), z = enemyHits({ enemyHitChance: 0.001 });
    assert.ok(o > 0 && z === 0 && Math.abs(h / o - 0.5) < 0.15, `${o} ${h} ${z}`);
  });
  B('evasion', () => {
    const fx = { evasive: true, fixes: { evasionInverted: true } };
    const o = enemyHits({}, fx), s = enemyHits({ evasion: 'crewScaled' }, fx), z = enemyHits({ evasion: 'crewScaled', enemyHitChance: 0.001 }, fx);
    const k = enemyHits({ evasion: 0 }, fx);
    // KLG 0xb208 = 20, MISN1 standard 40: crewScaled = round(40 * 20 / 128) = 6 instead of 20
    assert.ok(o > 0 && s > 0 && s < o && z === 0 && k === 0, `${o} ${s} ${z} ${k}`);
  });
  B('evasiveSpeed', () => {
    const go = balance => { const g = start({}, { balance }), S = g.S; navReady(S); S.speed = 8; S.reqSpeed = 8; S.maneuver = 1; S.course = S.reqCourse = 0; run(g, 'f_2cf2'); return [S.work, S.speed]; };
    const [o] = go({}), [w, sp] = go({ evasiveSpeed: 0.5 });
    assert.equal(w, Math.round(sp * 0.5)); assert.notEqual(w, o);
  });
  B('ourMiss', () => { const o = ourKills({}), m = ourKills({ ourMiss: 2 }); assert.ok(o > 0 && m === 0, `${o} ${m}`); });
  console.log(`balance tests: ${fail ? fail + ' failed' : 'all passed'}`);
  return fail;
}

// ---------------------------------------------------------------- run
function flagTests() {
  let pass = 0, fail = 0;
  for (const name of Object.keys(TESTS)) {
    const { scenario, check, opts, flag = name } = TESTS[name];
    try {
      const o = scenario(start(ORIGINAL, opts)), f = scenario(start({ [flag]: true }, opts));
      check(o, f);
      // all fixes together give the fixed behaviour too
      const m = scenario(start(ALL_FIXES, opts));
      check(o, m);
      pass++; console.log(`ok   ${name}  original=${JSON.stringify(o)} fixed=${JSON.stringify(f)}`);
    } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`); }
  }
  const tested = new Set(Object.keys(TESTS).map(n => TESTS[n].flag || n));
  const missing = FLAGS.map(f => f[0]).filter(f => !tested.has(f));
  if (missing.length) { fail++; console.log('FAIL untested flags:', missing.join(' ')); }
  assert.deepEqual(Object.keys(MODERN), FLAGS.map(f => f[0]).filter(f => f !== 'evasiveKeepsSpeed'));
  console.log(`flag tests: ${pass} passed, ${fail} failed (${FLAGS.length} flags)`);
  return fail;
}

// smoke: whole missions with the modern preset (fixes + balance) and random commands
function rng(seed) { let s = seed >>> 0 || 1; return n => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s % n; }; }
const ROSTER = {
  0: ['BORIS', 'ALZOTT', 'GROLO', 'Q6D', 'SKULARD', 'YEELA'],
  1: ['JARU', 'BLUSTAN', 'CHURGLK', 'MIKE', 'NARGO', 'PHYZO'],
  2: ['KLG', 'AYMU', 'BRONX', 'NIK', 'TEGRA', 'YENX'],
  3: ['CRAVEN', 'FLIGRNK', 'SHEEMA', 'TONY', 'VX4', 'WILFO'],
  4: ['ANXY', 'BRU', 'RYBLO', 'SWIGLTZ', 'T3', 'VOFGANK'],
};
function invariants(S) {
  const bad = [];
  const inRange = (name, v, lo, hi) => { if (!(v >= lo && v <= hi)) bad.push(`${name}=${v}`); };
  inRange('cargo', S.cargo, 0, 100); inRange('pos', S.pos, 0, 50);
  for (let d = 0; d < 5; d++) inRange(`msgCount[${d}]`, S.msgCount[d], 0, 8);
  inRange('orderCount', S.orderCount, 0, 8); inRange('examLen', S.examLen, 0, 8); inRange('queueLen', S.queueLen, 0, 26);
  inRange('contactsDetected', S.contactsDetected, 0, 16); inRange('openSlots', S.openSlots, 0, 26);
  const live = [...S.contactClass].filter(c => c > 0).length;
  if (live !== S.contactsDetected) bad.push(`contactsDetected ${S.contactsDetected} != live ${live}`);
  const busy = [...S.droidBusy].filter(Boolean).length, staffed = [...S.queue.slice(0, S.queueLen)].reduce((a, s) => a + S.slotDroids[s], 0);
  inRange('busy droids', busy, 0, 7); inRange('staffed droids', staffed, 0, 7);
  for (let i = 0; i < S.queueLen; i++) if (S.slotSys[S.queue[i]] < 0) bad.push('queued free slot');
  const open = [...S.slotSys].filter(s => s >= 0).length;
  if (open !== S.openSlots) bad.push(`openSlots ${S.openSlots} != ${open}`);
  return bad;
}
const EVERY = +(process.env.SMOKE_EVERY || 1200);
function smokeMission(mission, seed, maxTicks, gap) {
  const r = rng(seed), crew = [0, 1, 2, 3, 4].map(d => ROSTER[d][r(6)]);
  const P = PRESETS[process.env.SMOKE_ORIGINAL ? 'original' : 'modern'];
  const g = start(P.fixes, { mission, crew, balance: P.balance });
  const freezes = [];
  const recent = [];
  g.emit = (...e) => { if (e[0] === 'freeze') freezes.push(e); if (process.env.SMOKE_DEBUG && !['frame', 'step', 'sound', 'flash', 'menu'].includes(e[0])) recent.push(JSON.stringify(e)); };
  const S = g.S, letter = () => r(26);
  const cmds = [
    () => g.commands.setSpeed(1 + r(8), r(3) === 0), () => g.commands.setCourse(r(5)),
    () => g.commands.fire(letter(), r(10), r(4), r(4)), () => g.commands.cancelOrder(r(26)), () => g.commands.rankOrder(r(26), r(4)),
    () => g.commands.examine(letter(), r(4)), () => g.commands.cancelExamine(letter()),
    () => g.commands.deviceOff(r(13)), () => g.commands.deviceOn(r(13)), () => g.commands.rankDevice(r(6), r(6)),
    () => g.commands.repairAssign(r(26), 1 + r(7), r(4)), () => g.commands.repairCancel(r(26)), () => g.commands.repairRank(r(26), r(4)),
    () => g.commands.nextMessage(), () => g.commands.acknowledge(r(5)), () => g.commands.clearMessages(), () => g.commands.autoAnswer(r(2)),
    () => g.commands.view(r(5), r(2)), () => g.commands.cancelManeuver(),
    () => g.commands.fireOnly(letter(), r(4)), () => g.commands.repairOnly(r(26)), () => { g.commands.clearExamList(); g.commands.examineOnly(letter()); },
  ];
  const killAt = Math.floor(maxTicks / 3), victim = r(5);
  let t = 0, nextCmd = 600, problems = [];
  g.commands.setSpeed(8, false);
  for (; t < maxTicks && !g.over; t++) {
    if (t === nextCmd) {
      const n = r(cmds.length);
      if (n < 19 || !S.deptAlive[[0, 4, 1][n - 19]]) cmds[n]();       // reduced-menu commands only with the officer dead
      if (n < 19 && n !== 0 && r(4) === 0) g.commands.setSpeed(6 + r(3), r(4) === 0);
      nextCmd += gap / 10 + r(gap);
    }
    if (t === killAt && !g.over) S.deptAlive[victim] = 0;           // a dead officer for the reduced menus
    g.tick();
    if (t % EVERY === 0) { const b = invariants(S); if (b.length) { problems = b; if (process.env.SMOKE_DEBUG) console.log(t, recent.slice(-40)); break; } }
  }
  const b = invariants(S); if (b.length && !problems.length) problems = b;
  const inv = g.over ? g.invoice() : null;
  return { mission, crew: crew.join('/'), ticks: t, result: g.result, pos: S.pos, cargo: S.cargo, minutes: S.minutes,
    kills: [...S.killsByClass].reduce((a, v) => a + v, 0), dead: 5 - [...S.deptAlive].reduce((a, v) => a + v, 0),
    total: inv && inv.total, freezes: freezes.length, problems };
}
function smoke() {
  const maxTicks = +(process.env.SMOKE_TICKS || 800000);
  let fail = 0;
  // gap: mean ticks between random commands (1500: busy, many device switches; 12000: calm, reaches the end)
  for (const [mission, seed, gap] of [['MISNA.BIN', 1, 1500], ['MISN1.BIN', 2, 1500], ['MISN2.BIN', 3, 1500], ['MISN3.BIN', 4, 1500],
    ['MISNA.BIN', 6, 12000], ['MISN1.BIN', 7, 12000], ['MISN2.BIN', 8, 12000], ['MISN3.BIN', 9, 12000]]) {
    let res;
    try { res = smokeMission(mission, seed, maxTicks, gap); }
    catch (e) { fail++; console.log(`FAIL smoke ${mission} seed ${seed}: ${e.stack}`); continue; }
    const ok = !res.problems.length && !res.freezes;
    if (!ok) fail++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} smoke ${JSON.stringify(res)}`);
  }
  console.log(`smoke: ${fail ? fail + ' failed' : 'all passed'}`);
  return fail;
}

const what = process.argv[2] || 'all';
let failures = 0;
if (what === 'all' || what === 'flags') failures += flagTests();
if (what === 'all' || what === 'balance') failures += balanceTests();
if (what === 'all' || what === 'smoke') failures += smoke();
process.exit(failures ? 1 : 0);
