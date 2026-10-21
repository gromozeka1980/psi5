# Balance study (modern remake)

Bots play the standalone engine (`web/src/engine/game.js`) headless at full CPU speed, under the original rules
(`ORIGINAL`, every bug kept), the fully fixed rules (`MODERN`) and each fix flag alone. **27 112 missions** were
simulated. The 1:1 port is not touched. Every number below comes from `tools/bots/out/*.json`; the complete tables
(by config, by mission, by navigator) are in `tools/bots/out/*.md` and `tools/bots/out/analysis.md`.

## Method

### Tools (`tools/bots/`)
- `bot.mjs` — `runMission({ mission, crew, wait, fixes, balance, policy })` runs one mission and returns its metrics.
  `node tools/bots/bot.mjs competent MISN1 '{"shotSlots":true}'` runs one mission and prints the metrics.
- `study.mjs <exp> [n]` — runs an experiment on worker threads (20 workers, about 10 missions/s) and writes
  `out/<exp>.json` (one row per mission) and `out/<exp>.md` (tables by config and by config × mission).
  The experiments are `policies`, `flags`, `flagsPassive`, `evasion`, `knobs`, `combat`, `difficulty`, `crew` and
  `recommended`.
- `analyze.mjs > out/analysis.md` — builds the static hit-chance table, the crew-candidate marginals, the per-flag
  deltas and the evasion breakdowns.

### Variation
- **RNG**: the original never seeds its RNG. A game varies only through the number of ticks the player waits on
  "Press RETURN" (one random draw per tick). Run *i* waits 0..4095 ticks.
- **Crew**: each run draws one of the 6 candidates per department at random (6⁵ = 7 776 combinations).
- **Missions**: all four mission files are played: MISNA (SEL course 1), MISN1, MISN2 and MISN3 (course 4).
- **Pairing**: run *i* uses the same wait and crew in every config, so configs are compared on identical seeds.
  Caveat: any flag that changes the order of RNG calls makes the game diverge chaotically. With 48–60 missions per
  cell, pay differences of about ±3 M$ are noise. The standard error is printed with every pay value.

### What the bots see and do
Policies read only what the player can see:
- the Scanning table (class only after identification, foe/friend, lock, bearing, in/out of range, known damage,
  the "Sug" weapon);
- the firing orders and their status;
- the nav panel (speed, course, RSK/RETA per course);
- the engineering panel (switches, priorities, batteries, reactor state);
- the repair panel (damaged systems, damage left, droids);
- their own crew's numbers. A player learns these from the Weapons report and the resumes.

Panels are assumed visible for free. Every command pays the engine's "Processing command" flash (100 ticks), so a
bot acts at most about once per 0.8 s.

| policy | weapons | scanning | navigation | engineering | repair |
|---|---|---|---|---|---|
| passive | officer only (auto-fire) | officer only (auto-examine) | speed 8 | none (default priorities) | officer only (auto-queue) |
| naive | at will on locked foes in range, Sug weapon | examines contacts in arrival order | speed 8, evasive while under fire | none | officer only |
| competent | at will on every locked foe, Sug weapon else its gunner's best; re-weapons broken orders, ranks on-screen targets first | threat-ordered list (on-screen foes first), drops finished targets | speed fitted to the power left after shields+weapons in combat; lowest-risk course that is not late (≤ 1 change per position); never evasive | switches off the 2 worst weapons; priority cruise = Engines, Scanner, ShieldCharger, Shields, Weapons, EmergCharger; combat = Shields, Weapons, ShieldCharger, Engines, Scanner, EmergCharger; emergency battery on in combat | queue by importance (disabled cargo envir/stab and life support first, then reactors, engines, shields, retros, weapons…), the top job gets its officer's fastest team size and the others 1 droid each |
| evader | = competent | | + evasive while under fire (15 s hysteresis, only if both retros are OK) | | |
| aggressive | also fires at identified pirates that are not yet foes; keeps all 4 weapons | | no course changes | weapons first in combat | |
| cautious | = competent | | evasive under fire, risk weight ×3 | shields + charger first in combat | |

### Metrics per mission (`runMission` result)
- **Outcome**: result (arrived / noCargo / tooLate), invoice rows and total (0.1 M$), minutes and minutes vs
  schedule, cargo %.
- **Combat**: kills per class, our shots per slot, damaging hit rolls, kills.
- **Enemy fire**: enemy shots and hits taken, split by our manoeuvre (standard/evasive) **at the moment the enemy
  shot was fired**.
- **Damage**: system hits per system, destroyed and disabled counts, cargo lost by cause (hits/leaks, looting,
  late).
- **Crew and systems**: officers lost, engineer and repair overload seconds, repair points and systems repaired,
  seconds evasive, seconds with an aggressive ship on screen, average speed, commands issued.

## 1. Policies under ORIGINAL vs MODERN (`policies`, 2 400 missions)

| policy | ORIGINAL arrived / pay M$ / enemy hits per min | MODERN arrived / pay / hits per min |
|---|---|---|
| passive | 15% / −3.9 / 3.71 | 7% / −4.3 / 5.26 |
| naive | 25% / −1.8 / 2.34 | 63% / 12.9 / 1.32 |
| competent | 61% / 5.8 / 3.47 | 77% / 19.8 / 1.76 |
| aggressive | 57% / 5.3 / 4.13 | 74% / 19.4 / 2.29 |
| evader | 53% / 1.6 / 4.45 | 92% / 33.9 / 1.01 |
| cautious | 48% / −0.2 / 4.66 | 76% / 21.1 / 1.57 |

- **Skill matters.** Under ORIGINAL a competent bot beats passive play by about 10 M$. Under MODERN the gap is about
  24 M$ (38 M$ for the evader).
- **Power management is the core of the game.** Passive play loses because of the default power priorities:
  Shields 400 + Weapons 320 come before Engines (800) on a 1 200 budget. The ship crawls (average speed 1.4–2), so it
  is under fire for longer.
- **Our weapons barely work in the original.** Kills per shot are 0.05 under ORIGINAL and 0.45 under MODERN (×9).
  The cause is the `depthCheck` fix (§2).
- **Courses.**
  - In both presets MISNA and MISN1 are trivial for any active bot (100% arrival).
  - MISN2 is fair: competent arrives 42% (ORIGINAL) and 94% (MODERN).
  - **MISN3 is impossible in ORIGINAL (0% for every policy)** and nearly so in MODERN without evasion (10%
    competent, 70% evader).
- **Cargo leaks drive the noCargo results.** A disabled Cargo Envir or Cargo Stab leaks 1% per 4 s. A destroyed one
  leaks 1% per second. This is by far the largest cargo drain: the officers' auto-repair queues the lowest slot
  index, so systems 21/22 come last. A bot that repairs them first keeps 99–100% cargo on MISNA–MISN2.

## 2. Each fix flag (`flags` with competent/evader, `flagsPassive` with passive; 10 656 missions)

Cell format: Δpay M$ / Δarrival percentage points / Δenemy hits per minute.
- ORIGINAL+flag: Δ = (only this fix) − ORIGINAL.
- MODERN−flag: Δ = (all fixes except this one) − MODERN.

Only flags with an effect above noise in at least one column are listed. Every other flag measured 0 or noise:
riskScanInBounds, stopClearsShake, lifeSupportOverload, examsComplete, maskBit15, trackLockPower, msgOverflow,
officerDeathOnce, ordersClearFreeze, repairRatePerTeam, repairGrabCap, cancelNoCompleteMsg, engineerDeathDelays,
destroyedFreesSlot, demoLootRate, clearAllMessages, bountyReset, examClearOnConfirm, dropOrderFlag,
navStressOwnLifeSupport, disabledRecount.

| flag | ORIG+flag competent | ORIG+flag evader | ORIG+flag passive | MODERN−flag competent | MODERN−flag evader | MODERN−flag passive |
|---|---|---|---|---|---|---|
| **shotSlots** | −2.6 / −17 / +0.64 | −3.1 / −12 / +0.88 | −1.3 / −13 / **+2.30** | +4.9 / +4 / −0.01 | +5.3 / +6 / −0.22 | +1.9 / **+19** / **−2.27** |
| **depthCheck** | **+11.8** / +8 / −1.17 | **+10.2** / +17 / −1.99 | +0.7 / +4 / −0.55 | **−15.0 / −25** / +2.45 | **−25.7 / −40** / +2.63 | −0.2 / −2 / +0.21 |
| **evasionInverted** | 0 (never evades) | **+6.5 / +13 / −1.69** | 0 | 0 | **−15.7 / −19 / +1.35** | 0 |
| evasiveKeepsSpeed | 0 | −0.1 / −2 / −0.07 | 0 | 0 | −4.7 / −2 / +0.10 | 0 |
| weakness | −1.1 / −8 / +0.18 | +0.2 / −2 / −0.17 | +0.4 / +6 / −0.10 | −1.9 / −4 / +0.18 | −1.7 / −2 / +0.06 | +0.3 / +2 / +0.07 |
| courseChangeReset | −1.3 / −10 / +0.28 | −0.2 / −6 / +0.01 | 0 | +4.9 / +6 / −0.25 | +0.4 / +4 / −0.12 | 0 |
| startWindow (MISN3 only) | −0.1 / 0 / +0.20 | +0.1 / 0 / −0.03 | 0 | +6.9 / +8 / −0.30 | +4.9 / +6 / −0.25 | 0 |
| maskBit8 | −2.2 / −10 / +0.22 | −0.7 / −10 / +0.07 | −0.1 / +2 / +0.21 | +1.6 / +2 / −0.09 | +3.4 / +4 / −0.16 | +0.9 / +8 / −0.87 |
| powerSkipUnaffordable | −1.1 / −8 / +0.28 | −1.3 / −2 / +0.07 | +0.5 / +6 / +0.08 | +1.2 / +2 / −0.12 | +1.3 / +2 / +0.09 | +0.2 / +2 / −0.64 |
| hitLoopIndex | 0 | 0 | 0 | +2.6 / +4 / −0.10 | +1.7 / +2 / −0.11 | +0.1 / 0 / −0.15 |
| repairWorkCarry / repairSkipAfterFinish | −2.2 / −3.3 (noise) | | | +1.3 / +1.8 | | |
| autoFireAllWeapons | −0.4 | +0.2 | −0.1 / +2 / +0.04 | +1.3 | +4.9 | +0.5 / +4 / −0.14 |
| **base values** | 7.4 M$ / 69% / 3.21 | 1.8 / 54% / 4.59 | −4.0 / 15% / 3.61 | 20.2 / 77% / 1.73 | 32.0 / 90% / 1.03 | −4.6 / 4% / 5.76 |

What the table shows:
- **`shotSlots` is what makes MODERN harder for a passive player** (the lead's question). The enemy's second shot
  slot now hits too: +2.3 enemy hits per minute (+64%) and −13 arrival points on its own. Removing it from MODERN
  brings back +19 points.
  - **`hitLoopIndex` is not a cause.** It only changes timing (−0.15 hits/min, 0 arrival points).
  - For players who fight, the same flag also doubles our own hit tests. The two effects roughly cancel
    (ORIGINAL+flag competent −2.6 M$).
- **`depthCheck` is the decisive player-side fix**: +10–12 M$ alone, and −15 to −26 M$ when it is the only fix
  missing. Without it, ships in port/starboard/aft slots are nearly immune (model B2).
- **`evasionInverted`** only matters for a player who evades: +6.5 M$ alone, and −15.7 M$ / −19 points when it is
  missing from MODERN.
- **`weakness`** helps less than expected. MODERN without it loses 1.9 M$, and kills per shot drop from 0.45 to 0.36.
  Hits already succeed at 80–92% per roll, so ÷4 on the miss threshold adds little.
- **`courseChangeReset` makes repeated course changes cost real time.** The original instant repeat change was a
  hidden player benefit: MODERN−flag gives +4.9 M$ for the course-switching competent bot.
- **`startWindow`** gives MISN3 its first two contacts (Xantog + Scout at position 0). That costs 5–7 M$ on MISN3.

## 3. Evasion

### Static numbers (`analysis.md`)
Enemy hit chance **per enemy shot** (2 rolls), and the evasive effective speed at speed 8:

| navigator | 0xb208 | evasive speed @8 (normal/stressed) | standard MISNA/MISN1 | standard MISN2 | standard MISN3 | evasive, original roll | evasive, fixed roll |
|---|---|---|---|---|---|---|---|
| KLG | 20 | 3/3 | 29% | 48% | 75% | 99% | 15% |
| AYMU | 40 | 4/3 | 29% | 48% | 75% | 98% | 29% |
| BRONX | 50 | 5/3 | 29% | 48% | 75% | 96% | 35% |
| YENX | 50 | 5/5 | 29% | 48% | 75% | 96% | 35% |
| TEGRA | 58 | 7/7 | 29% | 48% | 75% | 95% | 40% |
| NIK | 75 | 7/5 | 29% | 48% | 75% | 91% | 50% |

- **All evasive speeds are ≤ normal speed** (KLG: 8 → 3).
- **Under the original roll the crew data make no sense.** NIK is both the fastest evader and the "best" one
  (91% instead of 99%), so he dominates. Evasion itself is strictly harmful: the measured hit rate per shot is 94%
  evasive vs 62–71% standard.
- **Under the fixed roll the data become a coherent design.** The navigator trades evasive speed against evasion:
  KLG is slow but hard to hit (15%), NIK and TEGRA are fast but easy to hit (40–50%). This strongly suggests the
  fixed comparison is what the designers meant.
- **One defect remains with the fixed roll.** The evasive chance is absolute (crew value) and ignores the mission's
  danger. On MISNA/MISN1 NIK's evasive (50%) is *worse* than standard flight (29%). On MISN3 every navigator's
  evasive is far better than standard (75%).

### Measured (`evasion`: MODERN otherwise, evader bot, every navigator, 3 456 missions)

| hit roll / evasive travel / when to evade | arrived | pay M$ | min vs schedule | enemy hits per min | P(hit per shot) evasive |
|---|---|---|---|---|---|
| any / any / never | 78% | 21.7 ±1.2 | −3.3 | 1.65 | – |
| inverted / crew table / under fire | 74% | 18.2 | −2.0 | 2.28 | 94% |
| inverted / crew table / always | 68% | 13.9 | +0.5 | 2.45 | 95% |
| fixed / crew table / under fire | **91%** | **30.7** | −2.1 | 0.96 | 35% |
| fixed / crew table / always | 92% | 29.5 | **+1.1** | 0.89 | 34% |
| fixed / keep speed / under fire | 90% | 32.3 | −3.7 | 1.05 | 35% |
| fixed / keep speed / always | 92% | **33.6** | −3.9 | 0.94 | 35% |

By mission (fixed roll, crew tables):

| mission | never | under fire | always |
|---|---|---|---|
| MISNA | 9.1 M$ | 9.1 | 8.6 (+1.7 min) |
| MISN1 | 19.1 | 18.8 | 17.0 (+4.1 min) |
| MISN2 | 46.5 | 42.4 | 40.2 (+5.5 min) |
| MISN3 | 11.9 (14% arrive) | **52.7 (67%)** | 52.1 (69%) |

- **With `evasiveKeepsSpeed`, evasion costs nothing.** "Always evasive" ties or wins on every mission, so it becomes
  a no-brainer. It also makes KLG (best evasion, longest life support) a dominant navigator.
- **With the crew tables kept, evasion is a real decision.** It costs 2–5 M$ of early bonus on the quiet routes and
  is decisive on dangerous ones. Under fire, navigators measure within noise of each other: KLG 31.9, NIK 30.6,
  YENX 33.7, TEGRA 26.0 ±3.6 M$. The speed-vs-evasion trade-off in the crew files works.

### Proposed design (`knobs`, 4 800 missions; `recommended`, 960 missions)
Two knobs are proposed: `balance.evasion` (how the evasive hit roll is computed) and `balance.evasiveSpeed`
(evasive travel speed). In the engine, the value `'crew'` below is called `'original'`.

| balance.evasion | balance.evasiveSpeed | arrived (under fire) | pay M$ | enemy hits per min | MISN3 arrived / pay |
|---|---|---|---|---|---|
| 'crew' (fixed roll as shipped) | 'crew' | 88% | 28.4 | 1.12 | 52% / 42.8 |
| **'crewScaled'** | **'crew'** | 88% | 28.9 | 1.00 | 52% / 42.8 |
| 'crewScaled' | 0.75 | 91% | 32.6 | 0.91 | 65% / 56.6 |
| 0.33 (flat) | 'crew' | 91% | 31.7 | 0.88 | 63% / 54.8 |
| 0.5 (flat) | 'crew' | 87% | 28.6 | 1.13 | 48% / 42.3 |
| 0.67 (flat) | 'crew' | 81% | 23.3 | 1.36 | 27% / 22.3 |
| (never evade) | | 77% | 20.3 | 1.68 | 12% / 8.1 |

**Recommendation:** `fixes.evasionInverted = true`, `fixes.evasiveKeepsSpeed = false`, and
`balance.evasion = 'crewScaled'` with `evasionScaleBase = 128`:

> Per roll, the evasive hit chance is the mission's standard chance × navigator 0xb208 / 128.

This lowers the enemy's hit chance by **41% (NIK) to 84% (KLG)** in every mission. The cost is travel at the crew's
evasive speed: speed 8 → 3 (KLG) … 7 (NIK, TEGRA), i.e. 12–63% slower.
- Evasion stays worth it in proportion to the danger, and the danger knob below scales it too.
- On MISN3 it is identical to the shipped values (standard chance 128 = base).
- `evasiveSpeed: 0.75` is the alternative if evasion should be stronger. It gives +3.7 M$ and +13 points of MISN3
  arrival, but it flattens the navigators' speed differences.

## 4. Fair difficulty while keeping every fix (`difficulty`, 1 440 missions; `recommended`)
MODERN as a whole is harder for passive play, because enemies use both shot slots, and much easier for active play,
because our weapons now hit. The knob `balance.enemyHitChance` scales the mission's standard per-roll hit chance
(mission 0x622f). The 'crewScaled' evasion scales with it.

Columns: arrived / pay M$ (all missions), with MISN3 arrival in brackets.

| knob (MODERN, crew evasive tables) | passive | naive | competent | evader |
|---|---|---|---|---|
| ×1.00 (shipped) | 5% / −4.4 | 67% / 13.5 | 77% / 20.0 (7%) | 85% / 25.8 (53%) |
| ×0.75 | 17% / −3.4 | 72% / 16.7 | 82% / 25.8 | 90% / 29.0 |
| **×0.60** | 20% / −2.7 | 72% / 18.2 | 87% / 29.0 (47%) | 97% / 34.2 (87%) |
| ×0.50 | 23% / −2.2 | 78% / 22.9 | 95% / 35.9 (80%) | 98% / 35.9 (93%) |
| ×0.6 + penetrate ×0.75 | 20% / −2.7 | 73% / 18.2 | 95% / 36.1 | 97% / 35.4 |
| *ORIGINAL (reference)* | *15% / −3.9* | *25% / −1.8* | *61% / 5.8 (0%)* | *53% / 1.6 (0%)* |

(The `penetrate ×0.6` row in `difficulty.md` is invalid: a typo in the knob name left it at ×1.0. It was fixed
afterwards; `penetrate ×0.75` was applied correctly.)

**Recommended preset** (`out/recommended.md`): MODERN fixes, `evasiveKeepsSpeed` off,
`balance = { enemyHitChance: 0.6, evasion: 'crewScaled' }`.

| policy | arrived | pay M$ | MISNA | MISN1 | MISN2 | MISN3 |
|---|---|---|---|---|---|---|
| passive | 21% | −2.7 | 75% | 8% | 0% | 0% |
| naive | 81% | 24.8 | 100% | 100% | 90% | 33% |
| competent | 88% | 30.0 | 100% | 100% | 100% | 53% |
| aggressive | 83% | 27.0 | 100% | 100% | 100% | 33% |
| evader | 97% | 35.1 | 100% | 100% | 100% | 88% |
| cautious | 94% | 31.7 | 100% | 100% | 100% | 75% |

- **Passive play is as hopeless as in the original.** Passive arrives 21% (ORIGINAL 15%). On MISNA it arrives 75%
  (ORIGINAL 60%).
- **Skill is rewarded more steeply.**
- **MISN3 becomes a real final course** instead of an impossible one. The best play arrives 88% of the time, a
  competent player who never evades 53%.

## 5. Other balance problems and proposed knobs

1. **MISNA and MISN1 are too easy for any active player.**
   - Every non-passive bot arrives 100% with 99–100% cargo, under ORIGINAL and MODERN alike.
   - The only spread is the early bonus (pay 9.0–9.8 / 18–20 M$).
   - Proposal: `balance.enemyHitChance` per mission, e.g. MISNA ×1.0, MISN1 ×1.0, MISN2 ×0.6, MISN3 ×0.6. The
     shotSlots fix already makes MISNA/MISN1 harder for weak play.
   - Alternative: raise these courses' route masks, which is content, not a knob.
2. **Lethality knobs barely move combat** (`combat`, 1 400 missions).
   - The tested knobs: gunner miss thresholds ×2 (kills per shot 0.44 → 0.40, pay +1.3, noise), reload ×1.5 (0),
     enemy ×1.25 (−1.1 M$), penetration ×0.75 (+1.5).
   - Once `depthCheck` works, a shot gets several rolls inside the depth window at 80–92% each, so the miss threshold
     hardly matters.
   - A real lethality knob would need the engine: e.g. `balance.ourRollsPerShot` (1 = a shot rolls once per pass).
     Kill rate is not a balance *problem*, though: pay is driven by cargo, and bounties stay below cargo + early
     bonus except on MISN3. So no engine hook was added.
3. **The engineer is in overload 82–100% of the time for every policy and preset.**
   - Overload triggers when *total demand* (powered or not) exceeds supply by more than the tolerance (30–100). With
     about 2 000 demand on a 1 200 budget, it is always true.
   - So the engineer's normal delay table is dead content, and the overload table is the only one that matters.
   - Knob: `balance.overloadCountsPoweredOnly` (compare only *powered* draw with supply), or the data-only variant
     `balance.overdrawTolerance + 900` (engineer file 0x2e). Not simulated.
4. **Dominated crew candidate: BRU (repair).**
   - BRU's numbers beat every other repair officer: work per team 40..82 vs 32..48 peak, recharge 10/12 vs 13–15/15–25,
     auto-queue after 20 s vs 80–140 s, 4 droids.
   - Measured: **+4.5 ±1.7 M$ and +5 arrival points** (MODERN, 1 000 random-crew missions; +1.4 M$ under ORIGINAL).
   - Every other candidate in every department is within about ±2.5 M$ (≈2 se) of its department mean. The marginals
     table is in `analysis.md`. Examples: NIK +2.7 ±1.4, NARGO +2.6 ±1.4, Q6D +2.4 ±1.5, CHURGLK −2.4 ±0.8,
     GROLO −1.6 ±0.6.
   - Proposal: give BRU a weakness (e.g. recharge 20/25 or work ×0.8), or improve the others' auto-queue delay.
   - Note: the competent bot uses each officer's real numbers (best weapons, best team size). A player who doesn't
     will see larger crew differences, e.g. ANXY with 7 droids repairs slower than with 1.
5. **Course switching by risk does not pay on most routes.**
   - The no-switch aggressive bot arrives 8–13 min earlier than competent on MISN1/MISN2. Competent gains only on
     MISN3 (45.5 vs 29.1 M$).
   - Each change costs the navigator's lateral time with no progress, and once `courseChangeReset` is fixed a repeat
     change costs it again.
   - Acceptable as design (risk vs time). If changes should feel better, add the knob
     `balance.courseChangeTime` (× navigator thresholds 0xb1d8/0xb1da, data-only).
6. **Cargo leak dominates noCargo.** A disabled Cargo Envir/Stab costs 15%/min, while a direct cargo hit costs
   1–4%. Officers auto-repair the lowest slot index first (quirk 9), so these systems come last for a passive player.
   Proposal: the repair officer's auto-queue should prefer disabled cargo/life-support systems (a design change, not
   a knob).

## 6. Recommended settings for the modern preset

| setting | value | why (data) |
|---|---|---|
| all fix flags | on, **except `evasiveKeepsSpeed` = off** | keepSpeed makes "always evasive" free and dominant; the crew tables give the trade-off (§3) |
| `balance.evasion` | `'crewScaled'`, `evasionScaleBase` 128 | evasive per-roll chance = mission chance × 0xb208/128: −41% (NIK) … −84% (KLG); MISN3 unchanged; scales with difficulty |
| `balance.evasiveSpeed` | `'crew'` (shipped tables) | cost of evading: 12–63% slower; under fire, navigators within noise of each other |
| `balance.enemyHitChance` | **0.6** (or per mission: MISNA/MISN1 1.0, MISN2/MISN3 0.6) | compensates `shotSlots` (+2.3 enemy hits/min for passive play); passive play stays at the ORIGINAL level (21% vs 15% arrival), MISN3 goes from impossible to 53–88% for good play |
| `balance.ourMiss`, `ourReload`, `penetrate` | 1 (original) | no measurable need |

### Implemented in the engine
The knobs are now engine parameters: `new Game({ image, fixes, balance })` (semantics and defaults:
`docs/modern/GAME.md`, `presets.js ORIGINAL_BALANCE`). The study first applied them as patches of the mission/crew
file data before `newMission`; the engine now rescales the same values where it uses them and the data stays as
shipped. Knobs: `enemyHitChance`, `evasion` (`'original'` | `'crewScaled'` | number), `evasionScaleBase`,
`evasiveSpeed` (`'original'` | number), `penetrate`, `ourMiss`, `ourReload`. The study's `'crew'` value is now
called `'original'`.
- **Presets:** `MODERN` = every fix flag except `evasiveKeepsSpeed`. `MODERN_BALANCE = { enemyHitChance: 0.6,
  evasion: 'crewScaled' }`. `PRESETS.original` / `PRESETS.modern` = `{ fixes, balance }`.
- **The bots use the engine knobs** (`tools/bots/bot.mjs`; the data patches are removed). `study.mjs` keeps its old
  experiments reproducible: the configurations labelled MODERN in §1, §2 and §5.2 use every flag (`ALL_FIXES`).
- **Verification:** `study.mjs recommended 40` re-run with the engine knobs gives the same results for all 960
  missions as the data-patch run (identical row by row, so the §4 table above is unchanged). Reduced re-runs of
  `knobs 2` (960 missions: identical) and `combat 2` (112: 111 identical) match the data-patch rows for the same
  seeds. These cover the flat `evasion` numbers, `evasiveSpeed`, `ourMiss`, `ourReload` and `penetrate`.
  - The one differing mission is expected: the gunner dies there. `ourMiss`/`ourReload` now also scale the
    dead-gunner replacement values; the data patch only touched the crew file.
- Defaults leave ORIGINAL bit-exact: `tools/equiv_game.mjs` demo run has 0 differences, and `fixes_test.mjs` passes
  (flag tests, balance tests, smoke with `PRESETS.modern`).
- Not implemented: per-mission `enemyHitChance` (§5.1). The UI can pass a different `balance` per `new Game`.
  `overloadCountsPoweredOnly` and `ourRollsPerShot` were not simulated.

## Reproduce
```
node tools/bots/study.mjs policies 50; node tools/bots/study.mjs flags 12; node tools/bots/study.mjs flagsPassive 12
node tools/bots/study.mjs evasion 12; node tools/bots/study.mjs knobs 10; node tools/bots/study.mjs combat 25
node tools/bots/study.mjs difficulty 15; node tools/bots/study.mjs crew 250; node tools/bots/study.mjs recommended 40
node tools/bots/analyze.mjs > tools/bots/out/analysis.md
```
About 30 min in total on 22 threads. Every run is deterministic: same inputs, same results.
