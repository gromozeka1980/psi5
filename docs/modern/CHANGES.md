# Changes from the original — all fix flags

Every original bug the remake fixes is a flag in `ctx.fixes` (engine modules) / `new Game({ fixes })`. Presets in
`web/src/engine/presets.js`: `ORIGINAL = {}` (the 1:1 port, proven equal by `tools/equiv.mjs` / `tools/equiv_game.mjs`)
and `MODERN` (every flag except `evasiveKeepsSpeed`, a design call the balance study rejected); `FLAGS` lists [name,
subsystem, description, doc]. Balance knobs (not bug fixes) are separate: `new Game({ balance })`, `PRESETS.modern`
(GAME.md, BALANCE.md). Details with addresses per module:
[combat](changes/combat.md), [navigation](changes/nav.md), [power](changes/power.md), [scanning](changes/scanning.md),
[damage / repair / messages](changes/damage.md), [game core](changes/game.md). Tests: `node tools/fixes_test.mjs`
(one targeted assert per flag, ORIGINAL vs the flag vs MODERN, plus whole-mission smoke runs with MODERN).

**Balance note.** MODERN as a whole makes combat much more dangerous: `shotSlots` doubles the enemy shots that can hit,
`hitLoopIndex` applies all pending hits at once, and the evasion fix is the only defensive gain. In a passive run
(speed 8, no orders, BORIS/JARU/KLG/CRAVEN/ANXY) ORIGINAL arrives on MISNA and MISN1, MODERN loses all cargo on both.
`evasionInverted` and `evasiveKeepsSpeed` are design calls; their tuning (and MODERN's overall difficulty) is done by
the balance study (`docs/modern/BALANCE.md`): `PRESETS.modern` = MODERN + `balance { enemyHitChance: 0.6, evasion:
'crewScaled' }`. (The passive-run numbers above are for every flag on and no balance knobs.)

| flag | subsystem | original | fixed | gameplay effect |
|---|---|---|---|---|
| `shotSlots` | combat | B1: only shot slot 7 (ours) / 5 (enemy) is hit-tested; slot 6 / 4 shots are duds | both slots tested; a ship is killed once | ~2× our kills per launch; the second enemy shot can hit too |
| `depthCheck` | combat | B2: our hit test compares the ship's z with the wrong word (ship slot index); aft ships practically immune | the shot's own z | ships at every bearing can be hit |
| `weakness` | combat | B3: firing the target's weak weapon ×4 the **miss** threshold | ÷4 | scanner-suggested weapon helps (~96 %) instead of hurting (~45 %) |
| `evasionInverted` | combat | B4: evasive → enemy hits iff `rand >= evasion` (71–92 %) | `rand < evasion` (8–29 %) | evasion protects (balance: BALANCE.md) |
| `channelPriority` | combat | B7: fire channels scanned 4..0, lowest priority fires first | 0..4 | Weapons Rank works |
| `autoFireAllWeapons` | combat | B6: auto-fire tries one weapon type per second | all four in the same second | officer opens fire sooner when a weapon is down |
| `dropOrderFlag` | combat, damage | @15b3: "target has an order" re-set on the order's slot index | on the target | correct order markers / Fire default target |
| `spriteSpill` | combat | @631e: unclipped sprites OR into the last rear star's y (RNG side effect) | no spill | none visible; RNG sequence only |
| `courseChangeReset` | nav | lateral counter never reset: repeat change 1 s, reversal 2× | reset on completion | every course change takes the navigator's normal time |
| `riskScanInBounds` | nav | risk scan reads position 50 (next course / data after the file) | stops at 49 | no phantom "high risk" at the end |
| `navStressOwnLifeSupport` | nav | navigator stress reads the engineer's life support | his own (sys 24) | stress from the right failure |
| `stopClearsShake` | nav | stopping keeps the manoeuvre shake | cleared | starfield / status picture reset when stopped |
| `evasiveKeepsSpeed` | nav | evasive travels at the crew's evasive table (≤ speed, KLG 8 → 3) | actual speed | evasive no longer slows the trip (design call) |
| `powerSkipUnaffordable` | power | a component that does not fit still drains the budget: everything below is dark | skipped, budget kept | short supply drops only what does not fit |
| `lifeSupportOverload` | power | only a *damaged* E Life Sup overloads the engineer | damaged or disabled | consistent overload |
| `examsComplete` | scanning | "Examinations complete" once at mission start, never again | when a non-empty list is fully examined | message means what it says |
| `maskBit8` | scanning | mission mask bit 8 never spawns (counted in risk) | spawns (class 3) | spawns match the navigator's risk |
| `maskBit15` | scanning | bit 15 (class 0) spawns a phantom that never leaves | nothing | custom missions only |
| `startWindow` | scanning | a mission starting at course A pos 0 (MISN3) opens no spawn window there | opens | MISN3's first two contacts appear |
| `trackLockPower` | scanning | lock progress ignores the Track Lock's power | needs power | switching it off stops locking |
| `msgOverflow` | messages | full queue: newest-but-one lost, oldest shown twice | oldest dropped | no lost messages |
| `hitLoopIndex` | damage | B5: ≤ 1 internal hit / special per second, others delayed | all due hits applied | hits land at once |
| `disabledRecount` | damage | hits on disabled systems re-counted (repair bill) | counted once | fairer repair cost |
| `destroyedFreesSlot` | damage | a destroyed system's freed repair slot stays in `openSlots` | decremented | no false repair overload / phantom auto-queue |
| `officerDeathOnce` | damage | a dead officer can "die" again (lists wiped again) | no | — |
| `ordersClearFreeze` | damage, game | B9: clearing the orders queue drops "serial 0" only → hang (gunner death, reduced Fire) | drops every order | no freeze |
| `repairRatePerTeam` | damage | some officers repair slower with more droids | best rate up to n droids | more droids never slower |
| `repairWorkCarry` | damage | a reused repair slot keeps the old partial work | starts at 0 | consistent repair times |
| `repairSkipAfterFinish` | damage | the job after a finished one is skipped that second | processed | no lost repair second |
| `repairGrabCap` | damage | a short-staffed job takes every ready droid | at most the request | droids left for other jobs |
| `cancelNoCompleteMsg` | damage | Cancel / Fix / deaths that empty the queue post "All assigned tasks have been completed" | only after a finished job | honest message |
| `engineerDeathDelays` | damage | engineer death writes 13 delays into a 12-entry table | 12 | first stressed delay kept |
| `demoLootRate` | damage | demo intruders loot every second | every 2 s | demo only |
| `clearAllMessages` | game | Acknowledge > Clr skips queues / corrupts memory (@669b) | clears all five | Clear clears |
| `bountyReset` | game | bounty sum accumulates across Replay / re-invoice | per mission | correct pay |
| `examClearOnConfirm` | game | reduced Scanning E empties the list before the choice | on confirm (`examineOnly`) | backing out keeps the list |

## Not flagged (and why)
- **Design / intended-looking:** damage table chosen by the hit sector's shield (B10), auto-queue picks the lowest
  slot, finished targets stay on the exam list, contacts age only with position, damaged Track Lock stops locking while a
  damaged scanner works, analysis without lock, emergency charger always draws, battery request jumps the queue,
  backlog > 11 steps dropped (pause), arrival freeze 2.5 s, casualty specials impossible on MISNA (mission data).
- **No effect / unreachable:** failed specials 27/28 (B8, no effect either way), launch at a target in no ship slot
  (B11), at-will order dropped after 10 launches in 1 s, `maxActiveTimers` never reached, speed-table index for mission
  offsets > 4, hostility loop on free slots, courseOrder[0] scratch write, JARU face table, tune 0x24, ship types 10/11.
- **Not part of the standalone Game:** "Replay / Same crew" restart state (RNG, nav variables, 0x17d8) — every
  `newMission` starts from the data image; Quit never exiting; demo autopilot.
- **UI / presentation:** "Repair list full" blocking a re-assign (UI check; the engine re-sizes a queued job), bounty
  row labels (table 0x6126 vs mission names), combat-view speed tied to text output, the shared 0x3b04 latch.
