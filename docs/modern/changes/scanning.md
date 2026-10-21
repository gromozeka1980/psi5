# Scanning — fixes (`web/src/engine/scanning.js`)

All flags are off by default (original behaviour, equivalence-checked against @243d). Enable with `ctx.fixes.<flag>`.

| flag | original behaviour | fixed behaviour | gameplay effect |
|---|---|---|---|
| `examsComplete` | @243d R4: the one-shot flag 0x9dc is never re-armed and the exam list is empty on the first step, so "Examinations complete…" (0x21a) is queued at mission start and never again. | Posted when a **non-empty** list has just been fully examined (no lock/class/damage/weakness work outstanding); re-armed whenever work is outstanding again. Demo mode still never posts it. | The message now means what it says, once per finished batch of examinations. |
| `maskBit8` | @243d R1: the spawn bit table 0x98a has no entry for 0x100 (cursor 15 tests bit 0, i.e. nothing), so mask bit 8 never spawns although nav's risk scan counts it (e.g. MISN1 course A pos 33). | Cursor 15 tests bit 0x100 and spawns class 3 (Kiffbok — the class 0x9aa[8] would give if the table were not shifted; the real intent is unknown). | A few more contacts on routes that set bit 8; spawn now matches the navigator's risk estimate. |
| `maskBit15` | @243d R1: cursor 14 (bit 0x8000) has class 0: `detected` is incremented but no slot is filled, and nothing ever decrements it (permanent phantom, spawning capacity shrinks). No shipped mission sets bit 15. | A cursor whose class is 0 spawns nothing. | None with shipped missions; protects custom mission files. |
| `startWindow` | @243d R1: lastPos/lastRoute (0x9d6/0x9d8) start at 0/0, so a mission starting at course A position 0 (MISN3) never opens a spawn window there: its contacts (Xantog + Scout) are lost and no nav threat report is pending. | If the ship is at course A pos 0, nothing has been seen yet (lastPos/lastRoute 0, mask 0, no tries left) and the mask there is non-zero, the window opens as for any new position (including the threat report). | MISN3 gets its first two contacts. |
| `trackLockPower` | @243d R3: lock progress checks only the Track Lock state (0xed6 == 2), never its power (0xf72), unlike the Inf Scanner whose power gates analysis. | Lock progress also requires the Track Lock to be powered. | Switching the Track Lock off (Engineering) now stops locking, consistent with the scanner. |

Not changed (design, or outside this module): contacts age only with route position (lifetimes in the mission file are
in positions; removal is the Weapons step @16f3); finished targets stay on the list and block auto-examine; reduced-menu
'E' empties the list first (UI @20eb); damaged Track Lock stops locking entirely while a damaged scanner works at full speed.
