# Combat — fix flags (`web/src/engine/combat.js`)

Default ("original") mode reproduces the 1:1 port. Each flag below switches one original bug to fixed behaviour
(`ctx.fixes.<flag> = true`). Fixed paths are not equivalence-checked. Bug numbers refer to `model/combat.md`.

| flag | original behaviour | fixed behaviour | gameplay effect |
|---|---|---|---|
| `shotSlots` (B1) | @6242 and @671c loop `si = 2 .. ; sub si,2; jne`, so only shot slot 7 (ours) and slot 5 (enemy) are ever hit-tested; shots in slots 6 / 4 are duds | both slots are tested (7 then 6, 5 then 4); a shot whose ship was already killed by the other shot this update does not hit it again | about twice as many of our kills per launch; the second enemy shot in flight can hit too |
| `depthCheck` (B2) | @6242 compares the ship's z with word `[di+0x4d74]` (di = ship slot): z of shot slot 6+ship, for ship slots 2/3 the vx of ship 0/1 | compares with the testing shot's own z | ships at every bearing can be hit; aft (slot 3) is practically immune in the original |
| `weakness` (B3) | @629e `shl cx,1` twice: firing the target's true weak weapon multiplies the **miss** threshold by 4 | the miss threshold is divided by 4 | the scanner-suggested weapon helps (≈96 % per roll) instead of hurting (≈45 %) |
| `evasionInverted` (B4) | @671c during an evasive manoeuvre (0xb64 = 1) an enemy shot hits iff `rand >= 0xb208` | hits iff `rand < 0xb208` | evading lowers the enemy hit chance (8–29 % per roll) instead of raising it to 71–92 % |
| `channelPriority` (B7) | @5d20 scans fire channels 4..0, so the lowest-priority ready order fires first | channels scanned 0..4 (order priority) | Rank in the Weapons menu works as the player expects |
| `autoFireAllWeapons` (B6) | @16f3 auto-fire: a loop over the 4 weapon types whose body always leaves, so one type is tried per second | tries up to 4 types in round-robin order in the same second | the officer opens fire up to 3 s sooner when some weapons are down |
| `dropOrderFlag` | @15b3 drop order: after removing an order it sets 0x912 (target has an order) for the *slot index* of another order on the same target instead of for the target | sets it for the target | Scanning / the Fire menu's "first target without an order" default see the right flags |
| `spriteSpill` | @631e/@63c5 blit sprites without clipping; a sprite with x ≤ −9 px and rows at y ≤ −2 reads row offset −0x26 (words before the row table 0x455e) and ORs its top rows into 0x3b66 = y of the last rear-view star, which changes how many RNG calls the next rear star step makes | the engine does not draw, so nothing is spilled | none visible; only the random sequence differs afterwards |

B9 (orders-queue clear `while (count) dropOrder(0)` freeze, @132d reduced Fire and @4922 gunner death): flag
`ordersClearFreeze`, see `changes/damage.md` / `changes/game.md`. B11 (launch at a target that is in no ship slot writes
through slot −1) is unreachable (on screen implies a ship slot); the engine does not model it.
