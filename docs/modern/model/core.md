# Core: game loop, timing, UI framework, mission start/end, crew data

Sources: `web/src/psi5/a_ui.js`, `g_core.js`, `b_weapons.js` (@0d97), `h2_lowlevel.js` (@6ca9, @6e26, file loaders,
message queues), `web/src/sel.js` (SEL.EXE), data from `web/data/psi5_ds.bin`, `web/data/sel_ds.bin`, `*.BIN`.
Other documents own the department rules: navigation (`nav.md`), scanning (`scan.md`), weapons/combat (`weapons.md`),
engineering/repair (`eng.md`, `repair.md`), low-level/data formats (`lowlevel.md`). They are referenced, not repeated.

## Purpose
The core is the frame of the game: the program flow PSIBAS → SEL (choose course + 5 officers, writes `SELECT.BIN`) →
PSI5 (load mission + crew files, briefing, departure, the voyage, invoice, replay). During the voyage it owns the
clock (120 Hz timer interrupt, a 6 Hz simulation step that round-robins over 6 "slots" so every department simulates
at 1 Hz, a ~40 Hz display/animation update), the menu framework (one generic menu-input routine that also drives the
simulation while waiting for keys), the officers' message queues, the pause, the demo autopilot, the mission end
conditions and the invoice (score). The crew `.BIN` files are pure data: a per-officer parameter block (skill numbers,
normal and "stressed" variants), message texts and face animations — the resume traits are expressed only through them.

## State

### Program / phase
| DS | name | meaning | init / writers |
|----|------|---------|----------------|
| 0x3b2 | phase | 1 = intro (before init) **and** "mission just ended"; 0 = playing; 2 = invoice shown. (a_ui header calls it "demo mode": wrong.) | main=1 @0082; 0 @5247; 1 on arrival @2cf2 / abort @516d; +1 @55f9 |
| 0x3508 | demo | demo mode (word, from SELECT.BIN) | @6b7c |
| 0x350a | sound | byte, 1 = sound on (SELECT.BIN; ^Q/^S) | @6b7c, @5a79 |
| 0x350b | joystick | byte, 1 = joystick on (SELECT.BIN; ^J/^K) | @6b7c, @5a79 |
| 0x34a8..0x350b | SELECT.BIN image | 6×16-byte file names (mission, weapons, scan, nav, eng, repair crew) + demo/sound/joystick; 100 bytes | @6b7c read, @6bc7 write back |
| 0x3b04 | overlay | big status text on the viewscreen shown (forces screen frame 2, stops the starfield); also "first call" latch of @51d8 | @51d8=1, @5247/@516d/main=0 |
| 0x1cf6..0x1cfc | jmp bufs | restart addr (0x00a7), setjmp addr/SP/BP (0x0179, 0xffc8 or 0 after restart) | @5b50, @5b86 |
| 0x0002/0x0004 | main locals after restart | main runs with BP=0 after "same crew" so its two locals live at DS:2/4 | @0082 |

### Timing (written by the ISR @6ca9 unless noted)
| DS | meaning |
|----|---------|
| 0x3516 | /20 divider (init 4 @6c10, reload 0x13): first step after 5 ticks, then every 20 ticks |
| 0x3518 | pending simulation steps (+1 per 20 ticks, consumed by @0d97, clamped there) |
| 0x1570 | slot index 0..5 of the round robin (@0d97) |
| 0x351a | ticks since the last display update (reset by @6e26) |
| 0x351c | delay counter for @0748/@076d (reset to 0 at wait start) |
| 0x3510 | demo key pacing counter (reset by @5a79 every 60 ticks) |
| 0x351e, 0x3520, 0x3512 | free tick count, changed-bits of 0x351c, constant 2: written, never read |
| 0x352d | ISR "pause" byte: read by @6ca9, never written (dead code) |
| 0x3524/0x352a/0x352b/0x352e/0x352f | tune player (pointer, note countdown, release, tempo) — see lowlevel.md |

### UI framework
| DS | meaning |
|----|---------|
| 0x2d0 | redraw handler of the panel shown in the view area (init 0x0d87 = no-op @0d87) |
| 0x2d2 | id of that panel: dept+1 (status panel, 1..5) or dept+6 (list panel, 6..10); 0 = none |
| 0x2f6 | view area is occupied (message / pause) → panel must be redrawn; panel refresh suppressed while set |
| 0x2f8 | messages "Auto Answer" enabled (Acknowledge→Auto). Also: menu cursor moves skip the pending redraw |
| 0x000e | help context for '?' (0 = department/main, 1 = Acknowledge menu) |
| 0x0164 | x of the next message-line text (@06bf) |
| 0x0166[17]×0x14, 0x2ba | value cache of table-driven panel rows (0x8000 = empty, @0abc) — see @0b7c |
| 0x02d6, 0x0122, 0x02f0, 0x02f2, 0x1ca4, 0x1ca6, 0x1ca8, dept 0x2d8..0x2e6 | per-menu cursor (selected item) |
| 0x02fa/0x032e/0x0348/0x037c | dynamic menu builder (@04eb/@058e/@05f3): item texts, hot keys, item→source, source→item |
| 0x345a/0x345c | requested / shown talking head (dept*2, -1 = blank) |
| 0x3208[5]/0x3212[5] | message queue buffer pointer / count per department (max 8, ids are words) |
| 0x3288[5] | indicator-light widget per department (state word at +2: 2 on, 0 off) |
| 0x3286 | auto-answer delay (slot-0 steps) |
| 0x3284, 0x3280/0x3282 | message dept to show (-1 = fullest), saved bx/ax |

### Mission / crew (core-owned parts)
| DS | meaning | init (@5247) |
|----|---------|------|
| 0x3b4 | cargo condition % (0..100) | 100 |
| 0x3b6 | elapsed mission minutes (+1 every 60 navigator steps @2cf2) | 0 |
| 0xb7a | position along the course, arrival at 50 | mission `0x622b` |
| 0x4ce8[5] | officer alive per dept (weapons, scan, nav, eng, repair; `0x4cf0` = repair alive, repair.md calls it "auto-queue enabled") | 1 |
| 0x4cf2[5] | officer stressed per dept (0/1; engineer 0x4cf8 is a countdown, used as boolean) | 0 |
| 0x4f2[10] | kills per contact type (Scanning @16f3) | 0 |
| 0x132a/0x132c | systems disabled / destroyed count (repair @4922) | 0 |
| 0x1300..0x1322 | invoice: 0x1302..0x130e bounty per type 1..7, 0x1310 cargo, 0x1312 early bonus, 0x1314 bounties, 0x1316 cargo cost, 0x1318 casualties, 0x131a lost allies, 0x131c repair costs, 0x131e bounty sum (**never reset**), 0x1320 total (abs), 0x1322 total negative | — (@5840) |
| 0x616e..0x64a3 | mission file (MISNx.BIN, 0x336 bytes) | @6b7c |
| 0x8b0c / 0x9e5a / 0xb1aa / 0xc524 / 0xd87c | crew file of weapons / scan / nav / eng / repair (up to 0x1324 bytes each); 0x326c[5] holds these bases | @6b7c |

Every other variable cleared/set by @5247 belongs to a department; @5247 is the initial state of the whole game:
cargo 100, position = mission start, all 26 systems `0xebc=2` (OK) and `0xf58=1` (powered), repair slots
`0x1030/0x10cc=-1`, weapon queue slots `0x3e0/0x430=-1`, `0x450[5]=-1`, `0x9ca..0x9d0=-1`, `0x9da=0x19`,
`0xd1e[12]=2`, `0xd36=2`, `0xce2[6]=0..5` (power priority order), `0xf8c=50` (shield energy), `0xf8e=30`,
officers alive, queues empty, screen frame wanted/current `0x3b00=0x3afe=1`, "last shown" caches
(`0x3b8..0x3c4, 0x3de, 0x3c6/0x3ce/0x3d6[5], 0x345a/c`) = -1, everything else listed there = 0 (@5247).

## Timing

**Reference time model**: time passes only at idle points (keyboard poll with empty buffer, BIOS tick read, the two
delay loops); each idle point = one 120 Hz tick (`rt.js tick()`). PIT divisor 0x26d4 = 9940 → 120.04 Hz (@6c10).

ISR @6ca9, every tick, in this order:
```
0x351e++ ; 0x351a++
if [0x352d] (never)  : 0x3520 = 0xffff, speaker off
else:
  0x3516--; if 0x3516 < 0: 0x3518++ ; 0x3516 = 19        // 6 Hz step generator (20 ticks)
  0x351c++ ; 0x3510++ ; 0x3520 |= changed bits of 0x351c
  tune player step (lowlevel.md)
```

Simulation step @0d97 (called once per menu poll while playing, and once per tick inside @0748 while playing):
```
if pending (0x3518) != 0:
  slot = (slot + 1) mod 6                     // 0x1570
  slot 0: damageTick @4922 (repair.md); shipTimers @64aa (weapons.md); autoAnswer @66dc (below)
  slot 1: @16f3 scanning step (also weapons officer's auto-fire/stress, uses weapons crew data)
  slot 2: @243d contacts step (scan officer's detection stages, uses scan crew data)
  slot 3: @2cf2 navigator step (generator: may run the arrival sequence)
  slot 4: @37be engineer step
  slot 5: @4479 repair crew step
  t = pending - 1;  pending = (t > 10 || t < 0) ? 0 : t          // catch-up at most 11 steps, else drop all
  if (panelId == slot || panelId == slot + 5) and !viewOccupied(0x2f6): call panel handler [0x2d0]
displayUpdate @6e26()
```
- Each slot runs at 1 Hz; a department's panel (ids dept+1 / dept+6) is refreshed right after that department's slot
  (slot dept+1), i.e. once per second. Slot 0 also "refreshes" panel 0 = the no-op handler (@0d97).
- Catch-up rule: one step per call; a backlog of ≤ 11 steps is worked off on following polls, a larger backlog
  (e.g. after the 400-tick departure animation, an ESC pause, the 300-tick arrival pause) is discarded after one step
  (@0d97).
- 1 game minute = 60 navigator steps = 60 s real time (@2cf2, `0x18b2`).

Display update @6e26: runs only if `0x351a >= 3`, then resets it to 0 (no catch-up) → at most 40 Hz. It is called
from @0d97, after every drawing-script op (@09b7), at every space/CR drawn by the text blitter (@5bf8) and at the end
of every panel row table (@0b7c). Content: star step counter, border-flash countdown (`0x3b02`), screen frame
(`0x3b00` wanted, forced 2 while overlay `0x3b04`; frame change blanks stars 4 updates), starfield motion (period
`0x3ae6[speed]`, forward/rear), then **combat objects at display rate**: @5d20 fire, @5e08 spawn ship, @5eba ship AI,
@6006 steer shots, @60b4 move, @6242 shot hits, @671c intruder chance, draw + blit unless overlay, @67aa head
animation (every 4th update). So combat and intruder rolls are tied to the 40 Hz display clock, not to the 1 Hz slots
(weapons.md).

Delays (@0748 / @076d): `0x351c = 0`, then loop {idle; if `0x351c >= n` break; @0748 only: if phase==0 run @0d97}.
@076d is a pure wait: no simulation, no display update (frozen screen). Used: departure pictures 5×80 ticks, arrival
300 ticks (@3318), flash prompt @06f4 = 4×25 ticks (running), demo invoice wait 1000 ticks (@55f9 via @0748, but phase
is 1 then, so nothing runs). Before the timer is hooked, @5baa waits 54 BIOS ticks (≈3 s at 18.2 Hz).

## Rules

### Program flow (PSIBAS / SEL / PSI5)
- PSIBAS loops SEL.EXE → PSI5.EXE until PSI5 exits with code 3, which never happens (README). PSI5 exits only with
  code 0 (@5b6f): demo end, key in demo, "New crew & course". So the game never ends by itself.
- SEL (`sel.js main`): title picture, load SELECT.BIN (keeps sound/joystick flags), wait 54 BIOS ticks, hook 120 Hz,
  title until a key or 85 steps (step = 39 ticks, counter `0x24` 0x113→0xbe), then selection (see Commands). Saves
  SELECT.BIN: `MISN?.BIN` of the course, the 5 officers' files, demo flag (`sel.js saveSelect` @1204).
- Course index → mission file: 0→MISNA, 1→MISN1, 2→MISN2, 3→MISN3 (SEL DS `0xe79a`).

### PSI5 main @0082
```
setMode4; phase=1; 20× joystick poll (calibration @7160); restart point + demo script ptr = 0x898a (@5b50)
body (@00a7, also the "same crew" restart target):
  clear screen; copy-protection stub @72da (always 0)
  load DASH.BIN (0x2086 bytes at 0x8b0c) and draw the dashboard (@6b4c); draw picture 0x4740
  clear menu + message lines; welcome letter in the view (@0988 script 0x23c9); window 9 "ORBIT"; status picture 0
  draw picture 0x49e9; load SELECT.BIN, mission file and the 5 crew files (@6b7c, crew overwrite DASH buffer)
  wait 54 BIOS ticks (@5baa)
  if !demo: flush keys; "Press BUTTON or RETURN to begin"; wait for any key (@5af1 — calls RNG @7086 once per poll)
  initGame @5247; hook ISR @6c10; tune 0x0a (forced); overlay "Prepare for departure" (@51d8 → 0x3b04=1);
  window 10 " DOCK"; 5 departure pictures 0x118[0..4], 80 ticks each (pure wait); overlay off (0x3b04=0)
  setjmp (@5b86) → loop
loop (@0179, also the longjmp target):
  if phase != 0: missionReport @55f9; return (→ never: report loop does not end)
  main menu bar (@022f); forever: k = menuInput("AWSNERQ") → dispatch (Commands)
```
- RNG seeding: there is none; the 256-byte state continues from the EXE image; in non-demo play the number of polls
  while the briefing waits for RETURN advances it (@5af1) — the only source of variation. Demo skips this → the demo
  is fully deterministic. "Same crew" restart keeps the RNG state (DS is not reloaded).

### Menu input @0786 (the UI kernel)
```
menuInput(hotkeys, items, selPtr):
  n = strlen(hotkeys) - 1
  repeat:
    loop: key = getKey(); if key: break
          if phase==0: simStep @0d97   elif phase==1: longjmp main (@5b97)   // phase 2: just poll
    Enter      → key = hotkeys[sel]
    Right/Left → sel = sel±1 with wraparound 0..n; redraw bar; if !autoAnswer: redrawDept(); key = 0
    Home       → longjmp main (@5b97: back to the main menu / invoice screen)
    else       → if key in hotkeys: sel = index else key = 0
    if key == '?': message "Acknowledge"/"…next pending message" (by 0x000e); flash @06f4; show the fullest
                   queue's next message @6579; viewOccupied = 1      // '?' is still returned to the caller
    elif !autoAnswer: redrawDept() @08e6
  until key != 0;  return key
getKey @0946: pollKey @5a79; a..z → A..Z; '/' → '?'; Backspace → '^' (= back item)
```
- A menu never returns 0, so `if k==0 return` in main (@0179) and @55f9 are dead.
- The mission ends by being noticed here: the first poll with no key after phase became 1 longjmps to main → @55f9.
- redrawDept @08e6: only if `0x2f6`: show requested head; if a panel is selected (0x2d2) draw its title script
  `0x2765[id]`, clear the row cache @0abc, call its handler; else clear the view area; `0x2f6 = 0`.

### Keyboard @5a79
```
if key waiting: w = getkey; al = w & 0xff
  if demo: ^Q → sound off, return 0; ^S → sound on, return 0; any other key → quit to DOS (@5b6f, exit 0)
  ^Q sound off, ^S sound on, ^J joystick on, ^K joystick off   (flags set; the key is still returned)
  al == 0 → return w (extended: Left 0x4b00, Right 0x4d00, Home 0x4700)
  ESC and phase==0 → PAUSE: draw "Game FROZEN by User PAUSE" in the view (@0988 0x253e), block on getkey
                     (the key is swallowed), viewOccupied=1, redrawDept, return 0
  return al
if joystick on: a joystick direction/button edge as a key (@7160); in demo → quit
if !demo or 0x3510 < 60: return 0
0x3510 = 0; if demoDelay(0x1d00): demoDelay--, return 0
b = *demoPtr++ : 0 → Home; 1 → demoPtr = 0x8a56, return 0; 2 n → demoDelay = n, return 0; else → b
```
- Pause: the ISR keeps running, so pending steps pile up and are dropped (catch-up rule); delay counters keep counting.
- ESC during the briefing/invoice (phase ≠ 0) is an ordinary key.

### Demo mode
- Entered in SEL by ^D at any key prompt or after 190 idle steps (≈62 s, counter `0x24` from 0xbe); SEL then presses
  Enter every 15 steps (≈4.9 s) → course 1 (MISNA) and the first candidate of each department: Boris, Jaru, KLG-7A,
  Craven, Anxy; a real key (except ^Q/^S) aborts back to a normal selection (`sel.js getKey` @03b5).
- PSI5 demo: no briefing key wait, the script at 0x898a feeds one key per ≥60 ticks of polling (@5a79): e.g.
  `N A 4 S, wait 20, S, wait 20, Home, E D …`; byte 1 loops to 0x8a56; `2 20` waits 20×60 ticks (10 s). Any real
  key/joystick → exit 0 (PSIBAS restarts SEL).
- Demo differences elsewhere: many message-queue calls and some sounds are skipped when `0x3508` (scan.md, nav.md,
  repair.md); intruder cargo looting happens every damage tick instead of every other (@4922); at mission end the
  invoice is skipped: wait 1000 ticks, exit 0 (@55f9).

### Message queues (officer → captain), @64be/@6526/@657f/@66dc
- Message id = `(dept*2) << 8 | offset` where offset indexes the officer's text table (even, 2..); bit 15 set = none.
- queue (@64be): dropped if the officer is dead (`0x4ce8[dept]==0`); if the queue was empty, light on + beep (tune
  0x16); no duplicates; max 8 (overflow path buggy, see Quirks); append.
- unqueue (@6526): remove; light off when empty.
- show (@657f): clear view; pick dept (given, or the fullest queue, ties → lowest dept); none → "No messages
  pending" + blank head; else talking head (talk countdown 50, tune 0x10 if head changes), "Captain" (y 0x88),
  pop the first id, text `base + word[base+offset]` (y 0x90), signature `base + word[base+0]` (next line, x 0x14);
  if queue now empty: "...OUT", light off.
- auto-answer (@66dc, slot 0, 1 Hz): only if 0x2f8: delay countdown; else if any queue non-empty → delay 5, show
  fullest, viewOccupied=1; else if viewOccupied → redrawDept.
- clear all (@669b, Acknowledge→Clr): zero counts + lights (buggy loop, see Quirks).

### Mission end
Three triggers; all set phase = 1, after which the simulation stops at once (@0786/@0748 check phase):
1. **Arrival** (navigator step @2cf2): position `0xb7a` reaches 50 → phase=1; @3318: status picture 0, overlay
   "Prepare for / Arrival", blank head, **pure wait 300 ticks**, window 9 "ORBIT", frame/planet pictures,
   "Welcome to <destination>" (`0x4ce6` → mission file +0xd7); tune 0x0e (forced).
2. **No cargo left** (@4922, slot 0): `0x3b4 == 0` → @516d + "no cargo left".
3. **Too late** (@4922): `elapsed - schedule > 60` minutes → @516d + "took too long".
   @516d: overlay "Mission Aborted", blank head, "Return to / Starbase 27", window 0 " STOP", tune 0x0c (not in demo).
- There is no "ship destroyed" or "all crew dead" end: dead officers only cost money and capability.
- Cargo erosion that leads to (2): -1 % per minute after the schedule (@2cf2, message 0x218 every 8 such minutes),
  -1 % per damage tick while certain systems are out (@4922), cargo-hit specials -`0x6239[rnd&3]` (@4922),
  intruder looting -1 % per (every other) damage tick (@4922) — details in repair.md.

### Invoice @5840 (computed once, when phase goes 1→2 in @55f9); money in 0.1 M$ units
```
for t in 1..7: bounty[t] = (mission.bounty[t] (0x6294) * kills[t] (0x4f2) + 5) / 10 ; sum(0x131e) += bounty[t]
clear 0x1310..0x131c
if position >= 50 (arrived):
   cargo  = (mission.reward (0x62ae) * cargo% + 5) / 10
   if schedule (0x622d) >= elapsed: earlyBonus = mission.bonusBase (0x62a8) + (schedule-elapsed) * 0x62aa (=1)
bounties    = sum(0x131e)                       // NOT reset between missions → accumulates on Replay
cargoCost   = mission 0x62ac
casualties  = 0x62a4 (=10) * number of dead officers
lostAllies  = 0x62a6 (=10) * (kills[8] + kills[9])      // own scouts/shuttles destroyed
repairCosts = destroyed(0x132c) + disabled(0x132a)/4
total = cargo + earlyBonus + bounties - cargoCost - casualties - lostAllies - repairCosts   (16-bit signed)
0x1320 = |total|, 0x1322 = total < 0
```
Display @57e2: "Mission Invoice" script 0x257d, rows from table 0x2711 (left: cargo %, amounts; right: bounty rows
`name 0x6126[i]`, kills `0x4f4[i]`, amount `0x1302[i]`), then total with sign. Number format "nn.n" (f_6a27/@6a51)
→ values ≥ 1000 (100 M$) would print garbage.

### Courses (SEL text + mission files)
| course | file | destination | SEL distance / reward | start pos → 50 | schedule min (0x622d) | cargo M$ (0x62ae) | early base (0x62a8) | cargo cost (0x62ac) | bounty/kill t1..7 (0x6294, 0.01 M$) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | MISNA | Renlozen (Frybluts) | 60 pc / $7M | 40 (10 units) | 13 | 7 | 2.5 | 1.9 | 13 6 14 17 18 20 25 |
| 2 | MISN1 | Kozzar-7 (Nucliarc) | 120 pc / $12M | 30 (20) | 27 | 12 | 5.3 | 3.5 | 10 13 14 17 18 20 30 |
| 3 | MISN2 | Zipo-Aga (Grananas) | 208 pc / $30M | 15 (35) | 44 | 30 | 12.5 | 4.8 | 10 13 15 17 18 20 25 |
| 4 | MISN3 | Splyteux (Prebliks) | 300 pc / $50M | 0 (50) | 67 | 50 | 20.7 | 7.3 | 12 16 15 17 19 20 35 |
One position unit ≈ 6 parsecs. Danger parameters per course (meaning owned by other docs):
| field | A | 1 | 2 | 3 | used by |
|---|---|---|---|---|---|
| 0x6229 alarm duration | 4 | 4 | 10 | 10 | @4922 |
| 0x622f intruder threshold (rnd < x, per display update) | 40 | 40 | 72 | 128 | @671c |
| 0x6231[4] shield drain per hit | 5 3 10 8 | 12 10 11 14 | 15 10 13 17 | 18 12 16 21 | @4922 |
| 0x6239[4] cargo loss per cargo hit | 1 2 1 1 | 1 2 3 4 | 3 2 4 1 | 1 4 3 2 | @4922 |
| 0x6241 casualty hits only beyond position | 50 (never) | 45 | 42 | 20 | @4922 |
| 0x624e/0x6250 hit-through chance /256 (system ok / damaged) | 25/30 | 40/60 | 50/75 | 100/125 | @4922 |
| route base 0x6288[5], contact lifetime 0x6292 | 4 2 3 1 0 / 4 | 4 2 3 0 1 / 3 | 4 3 2 1 0 / 2 | 4 3 2 0 1 / 1 | nav.md |
Mission file also holds enemy type names (+0), contact tables 0x6252/0x6266, and 5 route threat bitmaps
(0x62b0 + 0x64·route, 50 words, one per position) — nav.md / scan.md.

### Crew data (.BIN) and how traits enter the game
Layout of each crew file (base B = 0x326c[dept]): word table at B+0: `word[0]` = signature line, `word[2k]` = text of
message k (offsets relative to B); the parameter block follows the message table; then face RLE pointer
(`0x32e8[dept]` → B+0x50/+0x50/+0xa2/+0x60/+0xa0) and mouth/animation tracks (`0x32f2[dept]`, next word); then the
texts and pictures (@657f, @6896). Message counts: weapons 17, scan 26, nav 21, eng 19, repair 13.
"Stressed" = `0x4cf2[dept]`; a stressed officer uses the second value of each normal/stressed pair and the face shows
the stressed animation tracks (@67aa: `dl ^= 3` when the dept's stress word ≠ 0). Stress is set when a load
threshold is exceeded and lasts a duration taken from the file (all per-department code cited):

| dept | offset (DS) | meaning (user) | dead-officer value |
|---|---|---|---|
| weapons | +0x24 [4] (0x8b30) / +0x2c [4] stressed | per weapon (MIS BLA CAN THR order of the reports): hit-roll threshold, shot misses this frame if value ≥ rnd (×4 vs. special targets) (@6242) | 0x20 |
| | +0x34 [4] (0x8b40) / +0x3c [4] | per weapon: re-fire timer `0x4d14` after a launch (@5d20) | 7 |
| | +0x44 stress duration, +0x46 contacts-spawned limit, +0x48 queue-length limit (@16f3) | | |
| | +0x4a/+0x4c auto-fire delay normal/stressed, +0x4e auto-fire argument (@16f3 → @14f3) | | |
| scan | +0x36.. pairs (normal, stressed) for 4 detection stages: thresholds of counters 0x66e/0x5d2/0x772/0x80e (@243d) | | stage1=20, stage2=33 |
| | +0x46 stress duration, +0x48 contacts-spawned limit, +0x4a active-list limit, +0x4c/+0x4e auto delay (@243d) | | |
| nav | +0x2c survival time when system 0xeec is out (@4922 `0x12e0`) | | |
| | +0x2e/+0x30 route-change progress limits (-x/+x) (@2cf2) | | -30/+30 |
| | +0x32 stress duration; +0x34 [9] / +0x46 [9] evasive speed by speed (normal/stressed); +0x58 threat scan look-ahead; +0x5a [2] scan period; +0x5e intruder threshold while evading (@671c); +0x60 [32] evasive maneuver pattern; +0xa0 threat warning limit (@2cf2) | | maneuver off |
| eng | +0x28 survival time when system 0xeea is out (@4922 `0x12de`); +0x2a stress duration; +0x2c active-device limit; +0x2e power-overdraw limit; +0x30 [12] / +0x48 [12] device timers normal/stressed (@37be) | | 13×20 (see Quirks) |
| repair | +0x1c open-slot limit (stress), +0x1e stress duration, +0x20 [2] droid recharge, +0x24 auto-queue delay, +0x26 auto-queue droids, +0x28 [8] work per tick by droids assigned, +0x38 [26] / +0x6c [26] damage added per hit per system (normal / stressed-or-unpowered) (@4479, @4922) | | queue emptied |

Example values (normal/stressed), showing the resume traits:
- Weapons A (+0x24 | +0x2c): Boris 35 13 40 35 | 40 13 50 40 ("fearless": changes under stress), Yeela
  50 35 26 50 | 26 20 16 35 ("can't handle stress"), Q6-D 23 40 23 23 | 20 40 20 20.
- Scan stages: Jaru 7/12 16/20 22/26 36/44, Mike 3/3 18/16 24/22 40/36, Phyzo 14/14 12/12 18/18 28/28.
- Nav (survival, ±route limit, stress dur): KLG 250 ±30 5, Nik 80 ±10 5, Bronxaag 60 ±30 7 ("frail" = low survival).
- Eng (survival, stress dur, limits): Craven 120 60 30 30, VX-4 250 12 100 100 ("rugged, top stress handling"),
  Wilfo 60 24 60 60 ("frail").
- Repair work per droid count (+0x28): Anxy 0 32 36 40 48 42 36 24, Bru 0 40 50 54 64 68 72 82.
The rest of the resume (age, history) is flavour only; personality shows through message texts.

## Commands / UI
Screen: dashboard picture; viewscreen (starfield/combat, frame pictures); talking head window; view area y 0x78..0xc7
(panels, messages, pause); message line y 0x68; menu bar y 0x70 (`Left/Right` move, `Enter` or hot key picks,
`Backspace`/`^` back, `Home` = main menu from anywhere, `?`/`/` = read next pending message where offered).

| screen | keys → effect | source |
|---|---|---|
| SEL course | Up/Down, 1–4, Enter | sel.js @00e6 |
| SEL candidate (×5 depts) | arrows (3×2 grid, wrap), initial letter or Enter → resume; then W(elcome)/E(xit) | sel.js |
| SEL final | A(ccept) / R(eselect: course again) | sel.js |
| any SEL prompt | ^D demo; 190 idle steps → demo | sel.js getKey |
| PSI5 briefing | any key (non-demo) | @00a7 |
| Main | A Acknowledge menu, W/S/N/E/R department (head + jingle dept*2, 0x0c if dead), Q quit | @0179 |
| Department menus | weapons @0e37, scan @1cfa, nav @295d, eng @3396, repair @3be5 (reduced menus when the officer is dead, `0x4ce8`) | other docs |
| Acknowledge | ? next pending; W/S/N/E/R next message from that dept (@033e, also selects its head); C clear all (@669b); A Auto Answer → E(nable)/D(isable) 0x2f8 (@0384); ^ back | @0256 |
| Quit | O(ops-continue)/^ back; R(eplay) → S same crew & course (clear screen, restore timer, restart main body @00a7) / N new crew & course (write SELECT.BIN incl. current sound/joystick/demo flags, exit 0 → SEL) / ^ | @03fb, @0463 |
| Invoice (phase 2) | S Status → W/S/N/E/R: dept status panel (handlers 0x615a); D Display → W/S/N/E/R: list panel (0x6164); I re-show invoice; Q quit menu | @55f9, @569b, @5733, @57cb |
| everywhere | ^Q/^S sound, ^J/^K joystick, ESC pause (phase 0 only) | @5a79 |
| unreferenced | debug menu N/C/S/T/Q: head animation override Normal/Calm/Stress/Talk/Quiet (`0x1caa..0x1cae`) | @594e |

## Interactions
- Calls every department's 1 Hz step (@0d97) and its panel handler; all combat runs from @6e26.
- Reads from departments: phase changes (nav arrival @2cf2, repair aborts @516d via @4922), kills `0x4f2`,
  system counters `0x132a/0x132c`, alive flags `0x4ce8`, cargo `0x3b4`, time `0x3b6`, position `0xb7a`.
- Provides: menu kernel @0786, message queues (@64be/@6526/@657f), drawing primitives (@09b7 scripts, @0b7c panel rows,
  @5bf8 text, @5b0a rect, @70a4 pictures — lowlevel.md), tunes, RNG @7086 (lowlevel.md), crew/mission data blocks.
- SEL ↔ PSI5 only through SELECT.BIN (names + demo/sound/joystick).

## Quirks & bugs
1. Bounty sum `0x131e` is never reset (@5840 clears 0x1310..0x131c only, @5247 not at all): after "Replay / same
   crew" the Bounties line includes all previous missions' bounties.
2. Quit can never end the program; @03fb always returns 0, menus never return 0; PSIBAS waits for exit code 3 (README).
3. "Same crew" restart resumes main with SP=BP=0; main's locals then live at DS:2/4 (@0082/@5b5f); DS is not reloaded
   (RNG, `0x131e` persist) but SELECT.BIN is re-read, so ^Q/^J toggles made during play are lost (@6b7c).
4. Simulation backlog > 11 steps is thrown away (@0d97) — pauses/long waits silently skip game time; the departure
   animation's ~20 steps are lost at start.
5. Display update has no catch-up and is driven by drawing calls (@5bf8 spaces, @09b7, @0b7c): combat speed depends on
   how often the program reaches idle points (in the reference model: exactly every 3 ticks while polling).
6. ISR pause byte `0x352d` is never written (@6ca9 dead branch); 0x351e/0x3520/0x3512 written, never read.
7. `0x3b04` is shared: overlay-forces-frame-2 (@6e26) and "draw once" latch (@51d8); @516d can run twice in one tick
   (both abort conditions) and draws both reasons at the same position.
8. Message queue overflow (@64be): the shift loop never advances, only the first entry is overwritten; clear-all
   (@669b) loop counter clobbered by the text drawer, covers 3 slots or runs past the 5 counts (README).
9. Engineer death writes 13 words of 20 into the 12-entry table at 0xc554, overwriting the first stressed value (@4922).
10. Casualty specials need `position > 0x6241`; MISNA has 50, so on course 1 officers can never be killed by those hits.
11. Demo intruders loot cargo every damage tick instead of every other (@4922 `0x3508 ||`).
12. Bounty row names come from the fixed table 0x6126 (Xantogs, Zeltoads, …) while the mission file names type 1
    "Zeltoad", type 2 "Frisina" … — labels may not match the paid type (@57e2 table 0x2711).
13. a_ui's header names 0x3b2 "demo mode" and 0x2f8 "cursor moves do not redraw"; real meanings: phase and Auto Answer.

## Open questions
- Exact meaning/direction of the weapons A/B values (resume "expert" does not consistently map to lower or higher
  values) — weapons.md should settle it from @5d20/@6242.
- The invoice's bounty-row label vs. contact-type mapping (quirk 12) — scan.md owns the type list.
- Real-hardware timing of the display update vs. the reference model (each idle point = one tick) — irrelevant for
  equivalence, relevant for "feel" in the remake.
