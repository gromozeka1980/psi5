# Damage, repair and messages — fix flags (`web/src/engine/damage.js`, `messages.js`)

Default ("original") mode reproduces the 1:1 port (equivalence-checked against @4922, @4479, @42e4, @43a2, @64be).
Each flag switches one original bug to fixed behaviour (`ctx.fixes.<flag> = true`). Fixed paths are not
equivalence-checked; `tools/fixes_test.mjs` asserts each one. Quirk numbers: `model/engineering.md` (E), `model/combat.md` (B),
`model/core.md` (C).

| flag | original behaviour | fixed behaviour | gameplay effect |
|---|---|---|---|
| `hitLoopIndex` (B5) | @4922 reuses the pending-hit loop counter as the struck system: after a hit on system t the scan continues at t+1, so at most one internal hit or special lands per second; the rest wait | every pending hit is applied in the second it is due | enemy hits land at once instead of trickling in (harder with `shotSlots`) |
| `disabledRecount` (E11) | @4922 `inc 0x132a` on every hit to an already disabled system | counted once, when the system becomes disabled | the invoice's repair cost (`disabled / 4`) no longer grows with hits on dead systems |
| `destroyedFreesSlot` | @4922 a destroyed system frees its repair slot (slotSys/slotId = −1) but never decrements `openSlots` 0x11d2 | `openSlots` decremented | destroyed systems no longer push the repair officer into overload (`openSlots >= limit`) or make him "auto-queue" a non-existent job (0x804 "auto assigned" with nothing queued) |
| `officerDeathOnce` | @4922 boarders/assassin on a department whose officer is already dead "kill" him again: replacement values re-applied, his work lists emptied again | a dead officer cannot die again | no second wipe of the reduced department's orders/exam list/repair queue |
| `ordersClearFreeze` (B9) | @4922 gunner death and the reduced-menu Fire @132d run `while (count) dropOrder(serial 0)`: with no order of serial 0 the loop never ends — the game hangs (the engine emits `freeze` and breaks) | drops the first queued order until the queue is empty (`damage.js` and `game.js fireOnly`) | killing the gunner with orders pending, or the reduced Fire, no longer freezes the game |
| `repairRatePerTeam` (E10) | @4479 work per second = crew table `repairWork[n]` for a team of n droids; for some officers it falls with n (ANXY: 7 droids 24, 4 droids 48) | a team works at the best rate of any size up to n (`max repairWork[1..n]`) | sending more droids is never slower |
| `repairWorkCarry` (E6) | @4922 reuses a repair slot without clearing `slotWork` 0x119c: the previous job's partial point (< 256) carries over | a new slot starts at 0 | repair times no longer depend on what was repaired in that slot before |
| `repairSkipAfterFinish` (E3) | @4479 dequeuing a finished job shifts the queue while the loop index advances: the next job is skipped that second (no droids, no work) | the next job is processed in the same second | one second of work no longer lost per finished job |
| `repairGrabCap` (E4) | @4479 a short-staffed job (`avail < wanted`) takes every ready droid, possibly more than it asked for (released again next second) | stops at the requested count | droids stay available for lower jobs |
| `cancelNoCompleteMsg` (E8) | @42e4 emptying the queue by Cancel / Fix / officer death / a destroyed system posts 0x802 "All assigned tasks have been completed" | posted only when the last job finished its repair | the message means what it says |
| `engineerDeathDelays` (C9) | @4922 engineer death writes 13 words of 0x14 from 0xc554 into the 12-entry delay table, overwriting the first stressed delay | 12 words | the replacement engineer's overload delay for the Fore Shield keeps the crew value |
| `demoLootRate` (C11) | @4922 `demo ||`: in demo mode intruders loot 1 % every second instead of every 2 s | every 2 s, as in play | demo only |
| `msgOverflow` (E1, @64be, `messages.js`) | a full queue (8) shifts with a loop that never advances: result `[m1, m1, m2..m6, new]` — m7 lost, m1 twice | oldest dropped, the rest shift | no lost / duplicated officer messages |
| `dropOrderFlag` (also here) | the gunner-death order clear re-flags 0x912 by order slot (same bug as combat @15b3) | by target | see combat |

Kept (design or no effect): B8 failed specials 27/28 alias `destroyed[27/28]` = 100 → no effect (the engine returns
early, same result); B10 the damage table is picked by the hit sector's shield switch (reads as "shield up = less
damage"); E5 anonymous droids; E7 "list full" blocks re-assigning a queued job (a UI check: the engine's
`repairAssign` re-sizes a queued job regardless, the UI should allow it); E9 auto-queue picks the lowest slot; C10
MISNA (course 1) has no casualty specials (mission data).
