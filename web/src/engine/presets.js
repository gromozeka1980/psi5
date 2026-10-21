// Fix-flag presets for `new Game({ fixes })` / `ctx.fixes`. ORIGINAL reproduces the 1:1 port (every bug kept);
// MODERN switches every fix on. FLAGS lists them all: [name, subsystem, description, source doc]; the consolidated
// table with original/fixed behaviour and gameplay effect is docs/modern/CHANGES.md.
export const FLAGS = [
  // combat.js (docs/modern/changes/combat.md, model/combat.md B1..B7)
  ['shotSlots', 'combat', 'B1: both shot slots are hit-tested (ours and the enemy\'s), not only the second', 'changes/combat.md'],
  ['depthCheck', 'combat', 'B2: our hit test compares the ship depth with the shot\'s own depth', 'changes/combat.md'],
  ['weakness', 'combat', 'B3: the target\'s weak weapon divides the miss threshold by 4 instead of multiplying it', 'changes/combat.md'],
  ['evasionInverted', 'combat', 'B4: evasive manoeuvre lowers the enemy hit chance (rand < 0xb208) instead of raising it', 'changes/combat.md'],
  ['channelPriority', 'combat', 'B7: fire channels are scanned in priority order 0..4', 'changes/combat.md'],
  ['autoFireAllWeapons', 'combat', 'B6: auto-fire tries every weapon type in the same second', 'changes/combat.md'],
  ['dropOrderFlag', 'combat', 'dropping an order re-flags the target, not the order slot index (@15b3)', 'changes/combat.md'],
  ['spriteSpill', 'combat', 'no unclipped-sprite spill into the rear starfield (RNG side effect)', 'changes/combat.md'],
  // nav.js
  ['courseChangeReset', 'nav', 'course-change counter reset when a change completes', 'changes/nav.md'],
  ['riskScanInBounds', 'nav', 'risk scan stops at position 49', 'changes/nav.md'],
  ['navStressOwnLifeSupport', 'nav', 'navigator stress reads his own life support', 'changes/nav.md'],
  ['stopClearsShake', 'nav', 'stopping clears the manoeuvre shake', 'changes/nav.md'],
  ['evasiveKeepsSpeed', 'nav', 'evasive travels at the actual speed', 'changes/nav.md'],
  // power.js
  ['powerSkipUnaffordable', 'power', 'a component that does not fit is skipped, the budget is not driven negative', 'changes/power.md'],
  ['lifeSupportOverload', 'power', 'a disabled E Life Sup also overloads the engineer', 'changes/power.md'],
  // scanning.js
  ['examsComplete', 'scanning', '"Examinations complete" when a batch is finished, not once at mission start', 'changes/scanning.md'],
  ['maskBit8', 'scanning', 'mission mask bit 8 spawns a contact', 'changes/scanning.md'],
  ['maskBit15', 'scanning', 'mask bit 15 (class 0) spawns no phantom contact', 'changes/scanning.md'],
  ['startWindow', 'scanning', 'a mission starting at course A position 0 (MISN3) spawns its contacts there', 'changes/scanning.md'],
  ['trackLockPower', 'scanning', 'lock progress needs the Track Lock powered', 'changes/scanning.md'],
  // messages.js
  ['msgOverflow', 'messages', 'a full queue drops its oldest message (not the newest-but-one, no duplicate)', 'changes/damage.md'],
  // damage.js
  ['hitLoopIndex', 'damage', 'B5: every pending hit is applied in the same second', 'changes/damage.md'],
  ['disabledRecount', 'damage', 'hits on an already disabled system do not count again for the repair bill', 'changes/damage.md'],
  ['officerDeathOnce', 'damage', 'a dead officer cannot die again', 'changes/damage.md'],
  ['ordersClearFreeze', 'damage', 'B9: clearing the orders queue drops every order (gunner death, reduced Fire) instead of freezing', 'changes/damage.md'],
  ['repairRatePerTeam', 'damage', 'more droids are never slower than fewer', 'changes/damage.md'],
  ['repairWorkCarry', 'damage', 'a reused repair slot starts with no partial work', 'changes/damage.md'],
  ['repairSkipAfterFinish', 'damage', 'the next job still works in the second another one finishes', 'changes/damage.md'],
  ['repairGrabCap', 'damage', 'a short-staffed job takes no more droids than it asked for', 'changes/damage.md'],
  ['cancelNoCompleteMsg', 'damage', '"All assigned tasks have been completed" only when a job really finished', 'changes/damage.md'],
  ['engineerDeathDelays', 'damage', 'engineer death replaces 12 delays, not 13 (first stressed delay kept)', 'changes/damage.md'],
  ['destroyedFreesSlot', 'damage', 'a destroyed system\'s repair slot no longer counts as open (repair overload, auto-queue)', 'changes/damage.md'],
  ['demoLootRate', 'damage', 'demo-mode intruders loot every 2 s as in play', 'changes/damage.md'],
  // game.js
  ['clearAllMessages', 'game', 'Acknowledge > Clear empties all five queues and lamps, no memory corruption', 'changes/game.md'],
  ['bountyReset', 'game', 'the invoice\'s bounty sum covers this mission only', 'changes/game.md'],
  ['examClearOnConfirm', 'game', 'reduced Scanning E empties the list only on confirm (examineOnly)', 'changes/game.md'],
];

export const ORIGINAL = Object.freeze({});
// every fix except evasiveKeepsSpeed: with it "always evasive" is free and dominant (docs/modern/BALANCE.md §3)
export const MODERN = Object.freeze(Object.fromEntries(FLAGS.filter(([name]) => name !== 'evasiveKeepsSpeed').map(([name]) => [name, true])));

// Balance knobs for `new Game({ balance })` / `ctx.balance`. The defaults are the original values; a knob only
// changes the game when it differs from its default. Study and numbers: docs/modern/BALANCE.md; semantics: GAME.md.
export const ORIGINAL_BALANCE = Object.freeze({
  enemyHitChance: 1,      // x the mission's standard per-roll enemy hit chance (DS 0x622f), capped at 255
  evasion: 'original',    // enemy roll while evasive: 'original' = navigator 0xb208 as shipped; 'crewScaled' =
                          // standard chance (after enemyHitChance) x 0xb208 / evasionScaleBase; a number k = standard x k
  evasionScaleBase: 128,
  evasiveSpeed: 'original', // evasive effective speed: 'original' = navigator tables 0xb1de/0xb1f0; k = round(speed x k)
  penetrate: 1,           // x the mission's shield penetration thresholds (0x624e ok / 0x6250 damaged), capped at 256
  ourMiss: 1,             // x our gunner's miss thresholds (normal, stressed, dead-gunner), capped at 255
  ourReload: 1,           // x our reload times (s), at least 1
});
export const MODERN_BALANCE = Object.freeze({ enemyHitChance: 0.6, evasion: 'crewScaled' });
export const PRESETS = Object.freeze({
  original: Object.freeze({ fixes: ORIGINAL, balance: ORIGINAL_BALANCE }),
  modern: Object.freeze({ fixes: MODERN, balance: Object.freeze({ ...ORIGINAL_BALANCE, ...MODERN_BALANCE }) }),
});
// knob value v scaled by k, rounded and clamped; k = 1 returns v untouched (bit-exact original)
export const scaled = (v, k, lo, hi) => k === 1 ? v : Math.min(hi, Math.max(lo, Math.round(v * k)));
// the evasive per-roll enemy hit threshold for the standard threshold std (already scaled) and navigator value crew
export function evasionThreshold(B, std, crew) {
  if (B.evasion === 'crewScaled') return Math.round(std * crew / B.evasionScaleBase);
  if (typeof B.evasion === 'number') return Math.round(std * B.evasion);
  return crew;
}
export function checkBalance(b) {
  for (const k of Object.keys(b)) if (!(k in ORIGINAL_BALANCE)) throw new Error(`unknown balance knob ${k}`);
  for (const k of ['enemyHitChance', 'evasionScaleBase', 'penetrate', 'ourMiss', 'ourReload'])
    if (!(b[k] > 0)) throw new Error(`balance.${k} must be a positive number`);
  if (!['original', 'crewScaled'].includes(b.evasion) && !(b.evasion >= 0)) throw new Error(`balance.evasion: 'original' | 'crewScaled' | number`);
  if (b.evasiveSpeed !== 'original' && !(b.evasiveSpeed > 0)) throw new Error(`balance.evasiveSpeed: 'original' | number`);
  return b;
}
