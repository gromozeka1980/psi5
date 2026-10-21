# Navigation — fixes (`web/src/engine/nav.js`)

All flags are off by default (original behaviour, equivalence-checked against @2cf2). Turn on with `ctx.fixes.<flag>`.

| flag | original (cite) | fixed | gameplay effect |
|---|---|---|---|
| `courseChangeReset` | @2cf2: the lateral course-change counter 0x18ba is never reset (nor by initGame @5247), it just stops at the crew threshold (±10..±38). A repeat change in the same direction completes in 1 s, a reversal needs twice the normal time (observed KLG: A→D 30 s, D→A 60 s). | Counter reset to 0 when a change completes (`course = reqCourse`). | Every course change costs the navigator's normal time, regardless of history. |
| `riskScanInBounds` | @2cf2 risk scan sums mask words pos..pos+scanLen **inclusive** with scanLen ≤ 50−pos, so near the end it reads mask[50] = the next course's position 0 (course E: the word after the mission file, 0x64a4 = 6 → risk 2 with an empty mask). | Sum stops at position 49. | No phantom risk / false "high risk quadrant" (0x408) in the last positions. |
| `navStressOwnLifeSupport` | @2cf2 stress test reads sysState[23] (0xeea, the **engineer's** life support); @4922 uses sysState[24] (0xeec) for the navigator. Probably a typo. | Reads sysState[24], the navigator's life support. | Navigator gets stressed when his own life support fails, not the engineer's. |
| `stopClearsShake` | @2cf2: with speed 0 the step skips `shake = 0`, so an evasive/course-change shake index (star-centre offset, status picture) stays frozen while stopped. | Shake cleared when stopped. | Starfield re-centred and status picture reset when the ship stops. |
| `evasiveKeepsSpeed` | @2cf2 evasive replaces the effective speed by the crew-file table 0xb1de / 0xb1f0 (stressed); for every shipped navigator it is ≤ speed (KLG at 8 → 3), and combined with the inverted evasive hit roll (@671c, combat module) evasive is strictly worse. Design question rather than a clear bug. | Evasive travels at the actual speed (tables ignored for travel/ETA; shake pattern kept). | Evasive no longer slows the trip. Pair with the combat hit-roll fix to make evasive useful. |

Not fixed here (other scope): mask bit 8 never spawns but counts in risk (spawn table, scanning module); speed-table index
unchecked for mission offsets > 4 (no shipped mission); nav variables not reset by initGame @5247 (core).
