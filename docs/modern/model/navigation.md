# Navigation — model

Sources: `web/src/psi5/d_nav.js` (@295d..@2ca6 Navigator UI, **@2cf2 navStep**, @322f enginePower; @243d is the
scanning step, see below), spawn/lifetime/engagement code in @243d, @16f3 (`c_scan.js`), @5e08 (`h1_anim.js`),
hit roll @671c (`h2_lowlevel.js`), damage/death/game-over in @4922 (`f_repair.js`), init @5247 and arrival
report @5840 (`g_core.js`), arrival sequence @3318 (`e_eng.js`), file loading @6b7c (`h2_lowlevel.js`).
Data: DS snapshot `web/data/psi5_ds.bin`, `MISN1/2/3/A.BIN`, navigator crew files (`KLG TEGRA NIK BRONX AYMU YENX .BIN`).
Observed in the emulator (`tools/emu/run.mjs`, course "A" = MISNA, crew KLG/JARU) where marked *(observed)*.

Related docs: `scanning.md` (owns @243d: examination counters, alert, markers — referenced here as R1..R10),
`engineering.md` (power, system/device index, life support, repair), combat/weapons doc (visual screen, shots, hits
@4922/@671c), core-loop doc (round robin @0d97, menus @0786, report @55f9), low-level doc (file formats, RNG @7086).

## Purpose
The ship flies a fixed **mission** from a start position to position **50** (arrival at Kozzar-7) along one of **5
courses** (A "Shortest Path", B "Medium Port", C "Medium Starboard", D "Full Port", E "Full Starboard"). All courses
have the same 50 positions; they differ only in **speed factor** (shorter course = more progress per second) and in
the **contacts** (alien ships) that appear at each position. The player (Navigator department) chooses the course,
the requested speed 0..8 and standard/evasive maneuvering. Real speed follows the power the two engines get from
engineering. Changing course takes time and needs the retro (side) thrusters. A time limit applies: late arrival
loses cargo every minute; 60 minutes late aborts the mission. The navigator also scans the courses ahead for risk.

## State

### Navigation (all words; "nr" = not reset by initGame @5247, kept from the snapshot (0) or from the previous
mission after a "same crew" restart)
| name | DS | type / range | meaning | written by | read by | init |
|---|---|---|---|---|---|---|
| pos | 0xb7a | 0..50 | position along the course; 50 = arrived | @5247 (= start), @2cf2 | everyone (spawn, scan, pay, special hits @4922) | mission 0x622b |
| subPos | 0xb78 | 0..255 | fraction of the current position (hi part) | @2cf2 | @2cf2 (threat report needs > 0x80) | nr |
| subFrac | 0xb76 | 0..255 | fraction of subPos | @2cf2 | @2cf2 | nr |
| course | 0xb60 | 0..4 | current course | @2cf2 | @2cf2, @243d (mask), panel | 0 (A) |
| reqCourse | 0xb62 | 0..4 | requested course | @2ae7 | @2cf2, panel | 0 |
| navState | 0xb64 | 0..3 | 0 standard, 1 evasive, 2 stopped, 3 changing course (strings 0xc0c) | @2cf2 | panel, @671c (hit roll) | 0 |
| maneuver | 0xb66 | 0/1 | requested maneuver: 0 standard, 1 evasive | @2b90, @2acd, @4922 (nav death) | @2cf2, panel | 0 |
| speed | 0xb68 | 0..8 | actual speed | @2cf2 | @2cf2, @243d (escape >6), @4922 ("dead in space"), starfield @6e26 (0x3ae6), panel | 0 |
| reqSpeed | 0xb6a | 0..8 | requested speed (0 = STOP) | @2b90 | @2cf2, panel | 0 |
| etaState | 0xb6c | 0..2 | 0 unknown (stopped), 1 early/on time, 2 late (strings 0xc2c) | @2cf2 | @2cf2 (stress), panel | 0 |
| shake | 0xb6e | 0..8 | maneuver animation index: 0 none, 1 port, 2 starboard, 3..8 evasive pattern | @2cf2 | @2cf2 (star centre, status picture) | 0 |
| power | 0xb84[2] | 0..4 | speed units delivered by engine 1 / 2 this step | @322f | @2cf2 (next step), @37be (engine power draw) | 0 |
| courseOrder | 0xaf0[5] | 0..4 | course ranking list (display only, "Pri") | @2ae7 | @2ca6 | snapshot 0,1,2,3,4; nr |
| risk | 0xb04[5] | int | risk sum per course ("RSK") | @2cf2 | panel | nr |
| reta | 0xafa[5] | int (min) | projected arrival minus time limit per course ("RETA", + = late) | @2cf2 | @2cf2, panel | nr |
| eta | 0xb18[5] | int (min) | minutes to go per course at the current speed ("ETA") | @2cf2 | panel | nr |
| dist | 0xb0e[5] | int | remaining distance per course ("DIS") | @2cf2 | panel | nr |
| changePending | 0xb7c | 0/1 | course change just requested (only gates the "retro broken" message) | @2ae7, @2cf2 | @2cf2 | nr |
| evasivePending | 0xb7e | 0/1 | evasive just requested (gates messages 0x40a/0x402) | @2b90, @2cf2 | @2cf2 | nr |
| threatPending | 0xb80 | 0/1 | position/course changed since the last risk report | @243d R1, @2cf2 | @2cf2 | nr |
| riskValid | 0xb82 | 0/1 | risk column valid (shown only if 1) | @2cf2, @55f9 (=0) | panel | nr |
| lateral | 0x18ba | int | course-change "lateral drift" counter (see R4) | @2cf2 | @2cf2 | nr |
| navStepCnt | 0x18b0 | counter | nav step count (parity, shake pattern) | @2cf2 | @2cf2 | nr |
| secCnt | 0x18b2 | 0..59 | seconds within the minute | @2cf2 | @2cf2 | nr |
| minutes | 0x3b6 | int | elapsed mission time in minutes (= 60 nav steps) | @5247 (0), @2cf2 | @2cf2, @4922 (abort), @5840 (bonus) | 0 |
| lateMsgCnt | 0x18b4 | 0..7 | late minutes since the last "cargo rotting" message | @2cf2 | @2cf2 | nr |
| lastSpeedSnd | 0x18ac | 0..8 | speed at the last speed-change sound | @2cf2 | @2cf2 | nr |
| work | 0x18ae | int | scratch: engine power sum → demand → effective speed | @2cf2, @322f | @2cf2, @322f | nr |
| scanCourse | 0x18b6 | 0..4 | course scanned by the last risk scan | @2cf2 | @2cf2 | nr |
| scanTimer | 0x18b8 | int | steps since the last risk scan | @2cf2 | @2cf2 | nr |
| scanLen | 0x18bc | int | positions ahead covered by the risk scan | @2cf2 | @2cf2 | nr |
| progressTime | 0x18be | int (min) | minute of the last position step (or now while stopped) | @2cf2 | @2cf2 (RETA) | nr |
| rearTimer | 0x18c0 | 0..30 | steps until the rear view switches back to front | @2cf2 | @2cf2 | nr |
| navStress | 0x4cf6 (deptStress[2]) | 0/1 | navigator stressed (slower evasive table, other scan period) | @2cf2, @4922 (=0 on death) | @2cf2 | 0 |
| navStressHold | 0x18aa | int | steps until navStress clears | @2cf2 | @2cf2 | 0 |
| navAlive | 0x4cec (deptAlive[2]) | 0/1 | navigator alive (full menu, risk scan, stress) | @4922 | UI, @2cf2, @4922 | 1 |
| missionPhase | 0x3b2 | 0..2 | 0 flying, 1 just ended (arrival or game over), 2 report shown | @2cf2 (arrival), @516d, @55f9 | everyone | 0 |
| cargo | 0x3b4 | 0..100 | cargo left (%) | @32a3 (decrease), @5247 | @4922 (0 = abort), @5840 (pay) | 100 |
| scanLamp | 0x3c2 | 0/1 | info-scanner lamp picture shown | @243d R8 | @243d | -1 |

Panel/menu state: 0x2d2 panel id (3 = course status, 8 = course list), 0x2d0 its redraw handler (0x18a6 → @2c51,
0x18a8 → @2ca6), 0x2dc nav menu sel, 0x2de course menu sel, 0x2e0 speed menu sel, 0x2e2 maneuver menu sel (all 0 at init).

### Contacts (26 slots; full table in `scanning.md` "Target table") — fields used for travel
| name | DS | meaning |
|---|---|---|
| cls | 0x59e[t] | type 1..10 (0 = free). 1 Xantog, 2 Zeltoad, 3 Kiffbok, 4 Narvik, 5 Skront, 6 Flarkin, 7 Lepsor (1..7 = pirates), 8 Scout, 9 Prato, 10 Other |
| spawnPos | 0x876[t] | pos when it appeared; age = pos − spawnPos |
| bearing | 0x6d6[t] | 0..3: visual-screen ship slot it approaches from |
| hostile | 0x63a[t] | 1 = attacks when it comes on screen |
| dmgBits | 0x73e[t] | damage bits (8 = none); bit 0 = cannot keep up with speed > 6 |
| onScreen / killed | 0x70a[t] / 0x946[t] | on the visual screen / destroyed (combat) |
| detected | 0x9d2 | number of live contacts (max 16 for spawning) |
| slotSearch | 0x9da | last slot used by the spawn search (init 0x19, so the first contact is slot 0) |
| screenQueue | 0x9ca[4] | contact waiting for visual-screen ship slot b (−1 = empty) |
| lastPos / lastRoute | 0x9d6 / 0x9d8 | pos/course at the last spawn-window start (init 0/0) |
| spawnMask / spawnCursor / spawnTries | 0x12e2 / 0x12e4 / 0x12e6 | current position's mask, table cursor (0..15), tries left (0..16) |

### Static data (PSI5.EXE DS)
| DS | content |
|---|---|
| 0x6150[5] | course mask table pointers = 0x62b0 + course·100 (into the mission file) |
| 0x98a[16] | spawn bit per cursor: 1,2,4,8,16,32,64,128,**512**,1024,2048,4096,8192,16384,32768,**0** (bit 8 is missing) |
| 0x9aa[16] | type per cursor: 2,9,3,6,1,8,5,4,3,5,7,2,1,4,**0**,0 |
| 0xb22[5] | course lateral offset: A 0, B −1, C +1, D −2, E +2 (port < 0 < starboard) |
| 0xb46[13] | progress per step at speed index d: 0,552,588,629,675,729,793,868,959,1072,1215,1401,1655 (65536 = 1 position) |
| 0xb2c[13] | ETA factor at d: 0,32,60,83,104,120,132,141,146,147,144,137,127 (≈ 16·d·minutes per position) |
| 0xb70[3] | engine capacity by system state: 0 (broken), 3 (damaged), 4 (ok) |
| 0x1948[9] / 0x195a[9] | star-centre x / y offset per shake index: x 0,−32,32,0,0,−32,−32,32,32; y 0,0,0,−16,16,−16,16,−16,16 |
| 0x4742[9] | status picture per shake index; 0x190c[] message window texts ("STOP", "Spd=1".."Spd=7", "FULL", "ORBIT", "DOCK") |
| 0x3ae6[9] | starfield step period per speed: 0 (frozen), 9,8,7,6,5,4,3,2,1 display ticks (@6e26) |
| 0xae6[5] | course names; 0xc0c state names; 0xc2c ETA names "unknown/early/late" |
| 0x6124[11] / 0x613a[11] | pointers to the plural / singular type names in the mission file |

### Mission file (MISN1/2/3/A.BIN, 0x336 bytes, loaded to DS 0x616e by @6b7c; DS = 0x616e + file offset)
| DS | off | field | MISN1 | MISN2 | MISN3 | MISNA | used by |
|---|---|---|---|---|---|---|---|
| 0x616e | 0x000 | 11 plural type names, 9 bytes each ("Unknowns","Xantogs ",…) | | | | | panels |
| 0x61d1 | 0x063 | 11 singular type names, 8 bytes each | | | | | panels |
| 0x6229 | 0x0bb | distress alarm duration | 4 | 10 | 10 | 4 | @4922 |
| 0x622b | 0x0bd | **start position** | 30 | 15 | 0 | 40 | @5247 |
| 0x622d | 0x0bf | **time limit (minutes)** | 27 | 44 | 67 | 13 | @2cf2, @4922, @5840 |
| 0x622f | 0x0c1 | enemy-shot hit threshold (standard flight, /256) | 40 | 72 | 128 | 40 | @671c |
| 0x6231 | 0x0c3 | shield drain per hit [4] | 12,10,11,14 | … | … | … | @4922 |
| 0x6239 | 0x0cb | cargo loss per cargo hit [4] | 1,2,3,4 | | | | @4922 |
| 0x6241 | 0x0d3 | pos after which crew-kill specials can happen | 45 | 42 | 20 | 50 | @4922 |
| 0x6243 | 0x0d5 | 11 bytes, not referenced (looks like leftover text) | | | | | — |
| 0x624e/0x6250 | 0x0e0 | shield absorb thresholds (ok / damaged system) | 40/60 | 50/75 | 100/125 | 25/30 | @4922 |
| 0x6252 | 0x0e4 | **contact lifetime in positions per type [11]** | 0,8,9,7,10,12,12,15,3,4,6 | same | 0,8,10,7,10,12,12,15,2,3,6 | same as 1 | @243d, @16f3 |
| 0x6266 | 0x0f8 | type → statistics column [11] | | | | | @16f3 |
| 0x627c | 0x10e | 12 bytes, not referenced | | | | | — |
| 0x6288 | 0x11a | **course speed offset [5]** (A..E) | 4,2,3,0,1 | 4,3,2,1,0 | 4,3,2,0,1 | 4,2,3,1,0 | @2cf2 |
| 0x6292 | 0x124 | pirate hostility delay (positions) | 3 | 2 | 1 | 4 | @243d R10 |
| 0x6294 | 0x126 | pay per contact type [8] | | | | | @5840 |
| 0x62a4..0x62ae | 0x136 | pay: dead officer, per-?, on-time bonus, bonus/min early, cost, cargo factor | | | | | @5840 |
| 0x62b0 | 0x142 | **course masks [5][50]** (word per position, bit set = contact of that table type) | | | | | @243d, @2cf2 |

Masks are 0 before the start position (MISN1: positions 30..48 used, 49 = 0). MISN3 uses all positions 0..48.

### Navigator crew file (loaded to 0xb1aa by @6b7c; messages = dept 2 codes 0x4xx, text offsets at file start)
| DS | field | KLG | TEGRA | NIK | BRONX | AYMU | YENX |
|---|---|---|---|---|---|---|---|
| 0xb1d6 | life-support timeout (@4922, see engineering.md) | 250 | 140 | 80 | 60 | 160 | 160 |
| 0xb1d8 | port change threshold (lateral ≤) | −30 | −18 | −10 | −30 | −38 | −22 |
| 0xb1da | starboard change threshold (lateral ≥) | 30 | 18 | 10 | 30 | 38 | 22 |
| 0xb1dc | stress hold (steps) | 5 | 4 | 5 | 7 | 5 | 4 |
| 0xb1de[9] | evasive effective speed per speed 0..8 | 0,1,1,2,2,2,3,3,3 | 0,1,2,3,3,4,5,6,7 | 0,1,2,3,3,4,5,6,7 | 0,1,1,2,3,3,4,4,5 | 0,1,1,2,2,3,3,4,4 | 0,1,2,2,3,3,4,4,5 |
| 0xb1f0[9] | same while stressed | 0,1,1,1,2,2,2,3,3 | = normal | 0,1,1,1,2,2,3,4,5 | 0,1,1,1,2,2,2,3,3 | 0,1,1,1,2,2,2,3,3 | = normal |
| 0xb202 | risk scan look-ahead (positions) | 5 | 3 | 3 | 6 | 4 | 3 |
| 0xb204[2] | risk scan period (steps) normal / stressed | 1/3 | 2/2 | 1/5 | 2/5 | 5/5 | 3/3 |
| 0xb208 | evasive hit-roll threshold (@671c) | 20 | 58 | 75 | 50 | 40 | 50 |
| 0xb20a[32] | evasive shake pattern (index 0..8 per step&31) | 0,3,0,4,0,1,0,2,… | 1,5,3,7,… | 1,2,5,8,… | as KLG | as KLG | as KLG |
| 0xb24a | "high risk" warning threshold | 10 | 7 | 6 | 9 | 8 | 9 |

When the navigator dies (@4922 action 2) the thresholds become ±30 (0xb1d8 = −30, 0xb1da = 30) and maneuver = 0.

## Timing
- Round robin @0d97 (see core-loop doc): one department per 6 Hz pending tick; **slot 2 = @243d** (scanning step,
  which also does contact spawning/lifetime), **slot 3 = @2cf2** (navStep). Each runs once per 120 ISR ticks = **1 s**.
  @243d of a cycle sees pos/course written by @2cf2 of the previous cycle.
- After slot 3, if the shown panel is 3 or 8 (= 3 + 5) and no redraw is suppressed, its handler (@2c51 / @2ca6) redraws
  (@0d97). So the course panels update once per second.
- Game clock: `minutes` += 1 every 60 nav steps (@2cf2). There is no other mission clock.
- @2cf2 is a generator only because of the arrival sequence (@3318 waits 0x12c ticks = 2.5 s without simulating).
- No RNG in @2cf2 or @322f. RNG (@7086) for navigation-related things: spawn (in @243d R1: 1 call per spawn window
  start, then 2 per spawned contact: bearing, then weakness), and the hit roll @671c (1 call in evasive, 2 in standard).

## Rules

### R1 navStep @2cf2 — order of operations (once per second)
```
navStepCnt++
// 1. speed from last step's engine power
p = (powered[8]  (0xf68) ? power[0] : 0) + (powered[9] (0xf6a) ? power[1] : 0)
speed = (speed > p) ? speed - 1 : p                              // up: jumps to p (≤ speed+1); down: −1 per step
if speed - lastSpeedSnd > 2:  lastSpeedSnd = speed; playTuneIfIdle(0x12)   // @6de0
elif speed - lastSpeedSnd < -2: lastSpeedSnd = speed; playTuneIfIdle(0x14)
// 2. demand for this step: one unit towards reqSpeed
demand = speed + 1 if speed < reqSpeed else (speed - 1 if speed > reqSpeed else speed)
if sysState[8] (0xecc) == 2: enginePower(0); enginePower(1) else: enginePower(1); enginePower(0)   // @322f
// 3. clock
if ++secCnt >= 60:
    secCnt = 0; minutes++
    if minutes > timeLimit (0x622d):
        cargo = max(0, cargo - 1)                                  // @32a3
        if ++lateMsgCnt >= 8: queue(0x218 "cargo is rotting", scanning dept); lateMsgCnt = 0
// 4. course change / maneuver  (see R3, R4)
// 5. travel                     (see R2)
// 6. risk scan                  (see R6)
// 7. ETA for all 5 courses      (see R5)
// 8. view: if rear view shown (0x3afe != 0): if rearTimer: rearTimer-- else wantedView (0x3b00) = 0 (front)
//          else rearTimer = 30
// 9. etaState = 0 if eff == 0 else (reta[course] > 0 ? 2 : 1)
// 10. stress (R7);  11. starCentre (0x4606, 0x4608) = (0x1948[shake], 0x195a[shake])
// 12. if missionPhase == 0: showMessageWindow(speed) ("STOP"/"Spd=n"/"FULL", @32bf); showStatusPicture(shake) (@32f2)
```
`enginePower(n)` @322f: if devState[8+n] (0xd2e+2n) != 0 (on, powering up or down) and powered[8+n] (0xf68+2n):
`power[n] = min(demand, cap[sysState[8+n]])` with cap = 0xb70 = {0,3,4}; `demand -= power[n]`; else `power[n] = 0`.
Consequences: max speed 8 needs both engines ok and powered (4+4); one ok engine → 4, damaged engine → 3. Speed
rises by at most 1 per second and falls by 1 per second when power is lost. Power is booked one step ahead: the
engine whose `power[n]` was allocated this step but whose `powered` flag drops before the next step does not count.
Engine power draw (engineering @37be) uses `power[n]`. *(observed: with only engine 1 powered, speed stays at 4;
power-plant shortage makes speed oscillate 0..3.)*

### R2 travel @2cf2
```
eff = speed                                                   // effective speed index
(state/maneuver rules R3/R4 may set navState = 3 or replace eff by the evasive table)
if navState != 3 and eff != 0:
    d = speedOffset[course] (0x6288) + eff                    // 1..12 with shipped missions
    subFrac += 0xb46[d]
    if subFrac >= 256: subPos += subFrac >> 8; subFrac &= 255
        if subPos >= 256: subPos -= 256; pos++; progressTime = minutes
            if pos >= 50: missionPhase = 1; arrivalSequence() (@3318); playTune(0xe) (@6db1, interrupting)
```
Seconds per position = 65536 / 0xb46[d]: d=1 118.7, 2 111.5, 3 104.2, 4 97.1, 5 89.9, 6 82.6, 7 75.5, 8 68.3, 9 61.1,
10 53.9, 11 46.8, 12 39.6 *(observed: d = 8, one position per 68 s)*. Higher course offset = shorter course. Example
MISN1, course A (offset 4), full speed: 20 positions × 39.6 s ≈ 13.2 min against a 27 min limit; course D (offset 0)
at full speed: 20 × 68.3 s ≈ 22.8 min.
Arrival sequence @3318: status picture 0, text "Prepare for / Arrival", head animation, 2.5 s pause (no simulation),
message window 9 "ORBIT", arrival pictures (0x3ae0, 0x817c), "Welcome to / Kozzar-7". missionPhase = 1 makes the
next menu poll longjmp to main (@0786 → @5b97), which shows the mission report @55f9 (pay @5840: cargo bonus only if
pos ≥ 50, time bonus 0x62a8 + (limit − minutes)·0x62aa if minutes ≤ limit).

### R3 stopped / maneuver @2cf2
```
if speed == 0: navState = 2; progressTime = minutes          // shake keeps its last value
else:
    shake = 0; navState = 0
    if reqCourse != course: courseChange()                    // R4
    elif maneuver == 1:
        if sysState[19] (0xee2, port retro) == 2 and sysState[20] (0xee4, star retro) == 2:
            if evasivePending: queue(0x40a "I'm using evasive maneuvers")
            navState = 1
            shake = 0xb20a[navStepCnt & 31]
            eff = (navStress ? 0xb1f0 : 0xb1de)[speed]
        elif evasivePending: queue(0x402 "Low power thrust in retros, unable to employ evasive")
        evasivePending = 0
```
- Evasive needs both retros fully working. If they fail, maneuver stays 1 and evasive resumes by itself after repair.
- Evasive slows travel (KLG at speed 8 → effective 3) and shakes the starfield (star centre offsets, status picture).
- The only other effect of navState = 1 is the enemy-shot hit roll @671c (combat doc): evasive → hit unless
  `rand < 0xb208` (1 RNG call); otherwise → hit if a second `rand < 0x622f` (2 RNG calls). See Quirks.

### R4 course change @2cf2 (speed > 0 and reqCourse != course)
```
if lateral[reqCourse] (0xb22) < lateral[course]:              // move to port
    e = sysState[20] (star retro)
    if e != 0:
        if e == 2 or navStepCnt odd: lateral18ba--            // damaged retro: every 2nd step
        if lateral18ba <= portThr (0xb1d8): course = reqCourse
        else: navState = 3; shake = 2
    elif changePending: queue(0x404 "Starboard retro broken! Course changes to port impossible")
else:                                                         // move to starboard
    e = sysState[19] (port retro); same with lateral18ba++, ">= starThr (0xb1da)", shake = 1,
    message 0x406 "Port retro broken! ... starboard impossible"
changePending = 0
```
- While changing (navState 3) the ship makes **no progress**; the change completes in the step the counter crosses the
  threshold (travel already runs on the new course in that step).
- A change of any size (A→D, two lanes) costs the same as one lane.
- `lateral18ba` is never reset (not even at mission start or after a change). *(observed, KLG: A→D took 30 s
  (0 → −30); D→A then took 60 s (−30 → +30).)* See Quirks.
- Stopped (speed 0): no change progress. Broken retro: the request stays pending, the ship keeps flying the old course
  (navState 0), and the message is queued only once (changePending).

### R5 ETA / distance for all courses @2cf2 (every step, d per course j)
```
left = 50 - pos
d1 = speedOffset[j] + 1
dist[j] = (trunc(i16(0xb2c[d1] * left) / d1) + 3) >> 2              // "DIS", independent of speed
if eff != 0:
    d = speedOffset[j] + eff
    eta[j]  = (trunc(left * 0xb2c[d] / d) + 15) >> 4                // minutes to go at the current effective speed
    reta[j] = progressTime + eta[j] - timeLimit                      // "RETA": >0 = late
else: eta[j] = 0; reta[j] = 0
```
0xb2c[d]/(16·d) matches 65536/(60·0xb46[d]) (minutes per position) to within 1 %. ETA uses the evasive effective
speed when evasive. The status line "ETA=" shows etaState (unknown/early/late) of the current course.

### R6 risk scan @2cf2
```
if ++scanTimer >= 0xb204[navStress]:
    scanTimer = 0
    if navAlive and powered[10] (0xf6c) and devState[10] (0xd32) and sysState[10] (0xed0):   // info scanner
        riskValid = 1
        scanCourse = (scanCourse + 1) mod 5                         // one course per scan, round robin
        scanLen = min(0xb202, 50 - pos)
        sum = Σ popcount(mask[scanCourse][pos + k]) for k = 0..scanLen   (inclusive: scanLen+1 words, @5b3a)
        if scanCourse == course and threatPending and subPos > 0x80:  // more than half through the position
            threatPending = 0
            if sum > 0xb24a: queue(0x408 "We're entering a high risk quadrant!") else unqueue(0x408)
        risk[scanCourse] = sum
    else: risk[0..4] = 0; riskValid = 0
```
Risk = number of contacts that will appear on that course from here to `look-ahead` positions ahead (counting bit 8,
which never spawns). threatPending is set by @243d R1 whenever pos or course changes, so the warning is given at most
once per position.

### R7 navigator stress @2cf2 (only while navAlive)
```
if navStressHold: navStressHold-- else navStress = 0
if sysState[23] (0xeea, engineer's life support) == 0 or etaState == 2 (late):
    navStress = 1; navStressHold = 0xb1dc
```
Stress selects the stressed evasive table 0xb1f0 and scan period 0xb204[1]. See Quirks (0xeea vs 0xeec).

### R8 contact spawning (@243d R1; exact pseudo-code in `scanning.md` R1)
- A **spawn window** opens when pos or course differs from (lastPos, lastRoute): `mask = courseMasks[course][pos]`,
  `cursor = rand()`, `tries = 16`, threatPending = 1.
- On every **odd** scanning step (every 2 s) while `detected < 16` and tries > 0: `cursor = (cursor+1) & 15`; if
  `0x98a[cursor] & mask`, a contact of type `0x9aa[cursor]` is created in the next free slot after slotSearch (cyclic);
  `bearing = rand() & 3`, `weak = (rand() & 3) + 1`, `dmgBits = 8`, `spawnPos = pos`, other fields 0; `detected++`;
  first contact (detected was 0) → unqueue 0x21a, queue 0x216 "Unidentified spacecraft rapidly approaching". `tries--`.
  While 16 contacts are live, the window is frozen (no tries used).
- So every set mask bit gives **exactly one** contact per window (not a probability); only the order and the 0..30 s
  delay are random. A window lasts 32 s, shorter than the fastest position (39.6 s), so it always completes unless a
  course change (new window, rest dropped) happens first.
- Bit → type: b0 Zeltoad, b1 Prato, b2 Kiffbok, b3 Flarkin, b4 Xantog, b5 Scout, b6 Skront, b7 Narvik, b9 Kiffbok,
  b10 Skront, b11 Lepsor, b12 Zeltoad, b13 Xantog, b14 Narvik, b15 → type 0 (bug), **b8 never spawns**.
- Switching course re-reads the mask of the same position on the new course: the new course's contacts there spawn
  too (contacts already spawned stay).
- Distress (@4922, all systems 0..9 down and speed 0, no pirate (type 1..7) present when the alarm starts): sets
  `mask = 1, cursor = −1, tries = 1` → the next odd step spawns one Zeltoad (pirate). Weapons are disabled (0x50a = 1).
  See combat/engineering docs.
- Spawning does not depend on scanner, officer or power.

### R9 contact lifetime and engagement
- **Screen queue** (@243d R2, every step, t = 0..25 in order): a contact is offered to `screenQueue[bearing]` (if that
  entry is empty) when `age < lifetime[cls]` (0x6252), not `(dmgBits & 1 and speed > 6)`, not killed and not on screen.
  @5e08 (combat, every display tick) moves it to visual ship slot `bearing`, sets onScreen, switches the view to its
  side (0x3b00) and makes it aggressive if `hostile`.
- **Escape by speed**: a contact with damage bit 0 cannot engage while speed is 7 or 8.
- **Hostility** (@243d R10, every step): for every slot with `cls < 8` (signed, so free slots too) and not hostile:
  if `spawnPos + 0x6292 < pos` → hostile = 1. So pirates turn hostile once the ship is more than 0x6292 positions past
  where they appeared. Firing at the ship (@5f8a) also sets hostile.
- **Removal** (@16f3, scanning/weapons doc): when `age >= lifetime[cls]`, not in screenQueue, not on screen → slot freed,
  `detected--`. Or when killed. So a contact lives for lifetime[cls] positions of travel (e.g. MISN1: Scout 3,
  Kiffbok 7, Lepsor 15) and only while the ship moves; stopping keeps every contact alive.
- **Rear view**: @2cf2 R1.8 returns the view to front 30 s after a contact switched it to the rear.

### R10 time limit and end conditions
| condition | where | effect |
|---|---|---|
| pos reaches 50 | @2cf2 | missionPhase = 1, arrival sequence, report (success) |
| minutes > timeLimit (each new minute) | @2cf2 | cargo −1 per minute; message 0x218 every 8th late minute |
| minutes − timeLimit > 60 | @4922 | gameOver @516d "Mission Aborted … took too long" |
| cargo == 0 | @4922 | gameOver "no cargo left" |
| navigator life support (sys 24) down for 0xb1d6·2 s | @4922 | navigator dies (engineering doc) → reduced menu, thresholds ±30 |

## Commands / UI
Main menu `N` → @295d (`F.f_6868(4)` head first). Prompt "NAV.-". Every menu has `^` = back (no effect).
- Full menu (navAlive) `S D ? C R A ^` = Status, Display, ?, Cancel, Rank, Accel.; reduced (navigator dead) `S ? R A ^`.
- **S** @2a53: panel 3 "NAVIGATION STATUS REPORT" (@2c51): ETA=etaState; Requested Course=reqCourse / state=maneuver
  (0xb66 shown with state strings), Current Course=course / state=navState; Speed=reqSpeed / Speed=speed; one row per
  course A..E: name, RETA (blank if speed 0), RSK (blank unless riskValid), DIS, ETA (blank if speed 0). Message
  "Status report", prompt flash. Refreshed after every nav step.
- **D** @2a90: panel 8 "NAVIGATION - POSSIBLE COURSES" (@2ca6): courses in courseOrder with "Pri" 1..5.
- **?** redraws the menu (@2a1c).
- **C** @2acd: "Cancel evasive manuevering", maneuver = 0 (works even if not evasive).
- **R** @2ae7: course menu `A B C D E ^` ("Rank (select) course"); on pick: message "<X> to pri 1", flash; the course
  moves to the front of courseOrder (others shift down), reqCourse = it, changePending = 1.
- **A** @2b90: speed menu `S 1..8 ^` ("Accelerate to speed"; S = STOP = 0). If STOP or navigator dead: maneuver = 0,
  reqSpeed = choice (message "<n>"). Else maneuver menu `S E ^` (Standard / Evasive-manuvering); E adds message
  "w/ Evasive" and evasivePending = 1; then reqSpeed = speed choice, maneuver = choice. `^` in the maneuver menu
  cancels both.
- Persistent displays: message window "STOP"/"Spd=n"/"FULL" (speed, @32bf), status picture per shake (@32f2),
  starfield speed (0x3ae6[speed]) and centre offset (shake), info-scanner lamp (@243d R8).

## Interactions
- **Engineering**: reads devState[8], [9], [10], powered[8..10], sysState[8], [9], [10], [19], [20], [23] (@2cf2, @322f);
  writes power[0..1] (0xb84) used for engine power draw (@37be).
- **Repair/damage @4922**: sets sysState (engines, retros, scanner); navigator death (action 2) → navAlive = 0,
  navStress = 0, thresholds ±30, maneuver = 0, unqueue nav messages; "dead in space" test uses speed; distress forces a
  pirate spawn; abort when > 60 min late; special crew-kill hits only when pos > 0x6241.
- **Combat**: speed > 6 blocks contacts with dmgBits bit 0; navState 1 changes the enemy-shot hit roll (@671c);
  @5e08 switches the view, @2cf2 switches it back.
- **Scanning (@243d)**: spawns contacts at pos/course; threatPending set on every pos/course change.
- **Cargo/pay**: late minutes cost cargo; pay @5840 uses pos ≥ 50, minutes, cargo.
- **Messages**: dept 2 (nav): 0x402, 0x404, 0x406, 0x408, 0x40a; dept 1: 0x216, 0x218, 0x21a, 0x21c.

## Quirks & bugs
1. **Evasive raises the hit chance** (@671c): evasive hits unless `rand < 0xb208` (KLG 20 → 92 % hit per roll, NIK 75
   → 71 %), standard hits only if `rand < 0x622f` (16..50 %). Evasive also slows travel. Most likely the comparison
   is inverted (`jl` where `jge` was meant). Needs a decision in the remake.
2. **lateral18ba is never reset** (@2cf2, @5247): after a port change the counter stays at the threshold, so further
   port changes finish in 1 s and a starboard change needs twice the time. Also kept across "same crew" restarts.
3. **Stress uses the engineer's life support** (@2cf2 R7 reads 0xeea = sys 23), not the navigator's (0xeec = sys 24,
   which @4922 uses for the navigator). Probably a typo.
4. **Spawn table**: bit 8 of a mask never spawns (0x98a has no 0x100) but counts in risk (@2cf2, @5b3a); bit 15 would
   spawn type 0, which increments detected without using a slot and is never removed (detected stays too high forever,
   spawning capacity shrinks). No shipped mission sets bit 15; bit 8 is used (e.g. MISN1 course A pos 33).
5. **No spawn window at pos 0 on course A** (@243d): lastPos/lastRoute start at 0/0, so a mission starting at position 0
   (MISN3) does not read the mask there (MISN3 A pos 0 = Xantog + Scout are lost) and no threat report is pending,
   unless the course is changed at position 0. (By code reading; not run.)
6. **Risk scan reads one word past the course** (@2cf2): the sum covers positions pos..pos+scanLen inclusive; near the
   end this reads mask[50] = the next course's position 0 (course E: the word after the mission file, 0x64a4 = 6 → risk 2)
   *(observed: course E risk 2 at pos 49 with an empty mask)*.
7. **"Examinations complete" at mission start** (@243d R4): its one-shot flag 0x9dc is 0 at start and the exam list is
   empty, so the message is queued at the very first scanning step and never again *(observed: dept 1 queue = 0x21a
   at 1 s)*. Scanning doc covers it as well.
8. **Many nav variables are not reset by initGame** (@5247): subPos/subFrac, secCnt, lateMsgCnt, lateral18ba, scan
   timers, courseOrder, risk/ETA arrays, flags 0xb7c/0xb7e/0xb80. Only matters after "Replay / Same crew" (@5b5f); a fresh
   PSI5 start has them 0 from the image. The first minute after a restart can be short; a leftover subPos moves the
   ship early.
9. **Shake not cleared when stopping** (@2cf2 R3): speed 0 skips `shake = 0`, so the star centre stays offset.
10. **Hostility loop touches free slots** (@243d R10, signed `cls < 8` includes 0); harmless, reset at spawn.
11. **Course menu shift writes 0xaee into courseOrder[0]** before overwriting it (@2ae7); harmless.
12. **Speed table bounds**: d = offset + speed is not checked; a mission offset > 4 would read past 0xb46/0xb2c.
13. **Arrival freezes the simulation 2.5 s** (@3318 uses @076d, not @0748).

## Open questions
- Is quirk 1 (evasive hit roll) really inverted, or did the designers intend evasive mainly for the visual effect?
  The combat doc should check whether evasive changes anything else in shot flight (nothing found: navState is only
  read by @671c).
- Meaning of 0x62a6 and the other pay fields (owned by the core/report doc).
- 0x6243..0x624d and 0x627c..0x6287 in the mission file are never referenced by code (checked `re/psi5.lst`); they
  might be read through a panel table (not found in DS tables either).
- Whether the shipped crews' 0xb1de/0xb1f0 tables were meant to make evasive slower than standard for every crew
  (all are ≤ speed).
