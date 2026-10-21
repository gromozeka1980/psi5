# Scanning — model

Sources: `web/src/psi5/c_scan.js` (menu UI @1cfa..@232b, list helpers @15b3/@167c, and @16f3), `web/src/psi5/d_nav.js`
(@23df, @243d), readers in `h1_anim.js`, `f_repair.js`, `g_core.js`, `b_weapons.js`, panel tables in the DS snapshot,
crew files `*.BIN`, mission files `MISN*.BIN`. Checked by running the emulator (manual game and demo) and logging
the target table every 2 s.

> **The c_scan.js header gets some names wrong.** `f_16f3` is **not** the scanner step. It is the **Weapons**
> department step (round-robin slot 1). It reads the weapons crew block (0x8b50..0x8b5a), queues dept-0 messages, and
> its "contacts/channels/lights" are the weapon queue, the 5 fire channels and the 4 weapon-system lamps. The real
> **Scanning step is `f_243d`** (slot 2, in `d_nav.js`, whose header calls it "pirate/contact spawning"). Proof:
> `f_0d97` redraws display ids `slot` and `slot+5` after a slot runs. Scanning displays are 2/7 and Weapons are 1/6.
> `f_243d` reads the scanning crew block 0x9e90..0x9ea6 and queues dept-1 messages (hi byte 2). This doc covers the
> scanning step and the target table that scanning owns. It also has an appendix on the parts of `f_16f3` that touch
> that table, plus a short summary of the rest of `f_16f3`, in case the weapons doc only covers `b_weapons.js`.

## Purpose
Scanning keeps the ship's **target table**: up to 26 "targets" (alien craft) in slots A..Z. Targets come and go with
the ship's position on the route. The scanning officer works an **examination list** of up to 8 targets in priority
order. While a target is on the list, the officer progresses four kinds of knowledge:
- **Lock**: tracking lock. Weapons can only fire at a locked target.
- **Class**: identification.
- **Damage**: the target's damage state.
- **Weakness**: the weapon it is weak to, shown as the suggested weapon.

The scanning step also:
- detects new targets along the route,
- decides when a pirate turns hostile,
- feeds detected targets into the 4 visual-screen slots (one per bearing),
- runs the scanning alert ("stress") state, which slows the officer,
- drives the scanner lamp.

How fast each kind of knowledge comes in is set by the scanning crew member's file (see Crew).

## State

### Target table (26 slots, index t = 0..25, letter 'A'+t; word arrays, all cleared by initGame @5247)
| DS | name | meaning / range | written by | read by |
|---|---|---|---|---|
| 0x59e[t] | cls | true class 1..9 (0 = free slot). Names (0x613a): 0 Unknown, 1 Xantog, 2 Zeltoad, 3 Kiffbok, 4 Narvik, 5 Skront, 6 Flarkin, 7 Lepsor, 8 Scout, 9 Prato, 10 Other. Classes 1..7 are pirates | spawn @243d; freed @16f3 | everyone |
| 0x5d2[t] | idCnt | identification progress (steps) | @243d | @243d |
| 0x606[t] | idCls | identified class (0 = "Unknown" until idCnt ≥ threshold, then = cls) | @243d | panels; @16f3 stats column |
| 0x63a[t] | hostile | 0 "frd" / 1 "foe" | @243d (age rule); h1_anim @5f8a shipFire | panels; @16f3 auto-target; h1_anim |
| 0x66e[t] | lockCnt | lock progress (steps) | @243d | @243d |
| 0x6a2[t] | locked | 0/1 ("L"/"Lock" column) | @243d | @16f3 (fire status, auto-target); @1fbe default pick; panels |
| 0x6d6[t] | bearing | 0..3 = P(ort)/F(ore)/S(tarboard)/A(ft), random at spawn | spawn; h1_anim | 0x9ca queue; panels |
| 0x70a[t] | onScreen | 0 "o" / 1 "i": currently a ship on the visual screen | h1_anim @5e08/@6242 | @243d, @16f3, panels |
| 0x73e[t] | dmgBits | true damage bits. Starts at 8 ("none"). On a hit, h1_anim @6242 sets it to (bits&7)\|rand(1..7) | spawn; h1_anim | @243d (bit 0); h1_anim |
| 0x772[t] | dmgCnt | damage-analysis progress | @243d | @243d |
| 0x7a6[t] | dmgKnown | known damage bits (0 = not yet known). Kept equal to dmgBits once known | @243d | exam panel "Damage" |
| 0x7da[t] | weak | true weak weapon + 1 (1..4 = Missiles/Blaster/Cannons/Thermos), random | spawn | h1_anim @6242 (hit chance ×4) |
| 0x80e[t] | weakCnt | weakness-analysis progress | @243d | @243d |
| 0x842[t] | weakKnown | known weak weapon + 1 (0 = unknown), shown as "Sug" MI/BL/CA/TH | @243d | exam panel |
| 0x876[t] | spawnPos | route position (0xb7a) at detection. Age = 0xb7a − spawnPos | spawn | @243d, @16f3 |
| 0x8aa[t] | marker | status-report icon: 1 = glyph '[' (on exam list), 2 = glyph '\' (weapon queued), 0 none | @243d | status panel |
| 0x8de[t] | listed | on the examination list | @232b, @23df | pickers, @23df |
| 0x912[t] | wQueued | has a weapon-queue entry | b_weapons @14f3, @15b3/@167c | marker; weapons picker |
| 0x946[t] | killed | destroyed by weapon w → w+1 (processed and cleared by @16f3) | h1_anim @6242 | @243d, @16f3, h1_anim |

### Lists and counters
| DS | meaning | init | notes |
|---|---|---|---|
| 0x97a[8] | examination list (targets, priority order, index 0 = priority "1") | 0 | @232b/@23df |
| 0x9d4 | list length 0..8 | 0 | |
| 0x9d2 | number of detected targets 0..16 | 0 | ++ spawn, −− @16f3 |
| 0x9da | last slot used by the round-robin slot search | 0x19 | spawn |
| 0x9d6/0x9d8 | position/route seen last step | 0 | change ⇒ new spawn window |
| 0x12e2 | spawn mask of the current position (16 bits) | 0 | f_repair also writes it (alarm) |
| 0x12e4 | spawn cursor 0..15 | 0 | |
| 0x12e6 | spawn tries left (16 per window) | 0 | |
| 0x17d8 | scanning step counter (parity used) | — | ++ at start of each @243d (not reset by @5247) |
| 0x9dc | "examinations complete" message already given | 0 | once per mission |
| 0x9de | auto-examine countdown | 0 | |
| 0x4cf4 | scanning alert level 0/1 (= 0x4cf2 + dept 1·2) | 0 | also makes the head animate "agitated" (h2 @68xx: `[0x3458]` → dl^=3) |
| 0x17da | alert hold timer | 0 | |
| 0x4cea | scanning officer alive (full menu) | 1 | cleared by f_repair @4922 on death |
| 0x9ca[4] | visual-screen queue, one per bearing (target or −1) | −1 | written here, consumed by h1_anim @5e08 |
| 0xb80 | navigation threat-report pending | — | set to 1 on every position/route change (read by nav @2cf2) |
| 0x3c2 | scanner lamp state shown (0/1) | −1 | |
| 0x2da | scanning menu selection | 0 | |
| 0x2d2/0x2d0 | current display id (2 status, 7 exam list) / its redraw fn (0x17d4=@217d, 0x17d6=@2277) | | shared UI |
| 0x2d4 | "nothing detected"/"no examinations" text shown flag | | |

### Static data
- **Exe DS**:
  - 0x98a[16] bit per spawn cursor: 1,2,4,…,0x80, **0x200**,…,0x8000, 0. Bit 0x100 has no entry.
  - 0x9aa[16] class per spawn cursor: 2 9 3 6 1 8 5 4 3 5 7 2 1 4 0 0.
  - 0x6150[5] route mask tables (0x62b0 + r·0x64).
  - 0x613a class names; 0xbb4 letters "A".."Z"; 0xc32 "1".."9".
  - Components (0xebc state 2 ok / 1 damaged / 0 disabled; 0xf58 powered): 10 = **Inf Scanner** (0xed0/0xf6c),
    13 = **Track Lock** (0xed6/0xf72).
- **Mission file** (loaded at 0x616e):
  - 0x62b0.. route masks, 5 routes × 50 words (one mask per route position).
  - 0x6252[10] detection timeout per class, in route positions. MISN1: 0 8 9 7 10 12 12 15 3 4.
  - 0x6292 hostility delay (MISN1 3, MISN2 2, MISN3 1, MISNA 4).
  - 0x6266[10] class → debrief column.
  - 0x6294[8] pay per kill by class.
  - 0x62a6 penalty per Scout/Prato killed.

### Crew (scanning officer file, loaded at 0x9e5a, 0x1324 bytes, f_6b7c)
Layout:

| offset | content |
|---|---|
| +0x00 | offset of the signature line, e.g. "Jaru, Scanning" |
| +0x02..+0x34 | offsets of messages 2..0x34. Text = base + word[msg/2] |
| +0x36 | **lock threshold** [normal, alert] (0x9e90) |
| +0x3a | **identify threshold** [n, a] (0x9e94) |
| +0x3e | **damage threshold** [n, a] (0x9e98) |
| +0x42 | **weakness threshold** [n, a] (0x9e9c) |
| +0x46 | alert hold time (0x9ea0) |
| +0x48 | alert trigger: detected ≥ (0x9ea2) |
| +0x4a | alert trigger: list length ≥ (0x9ea4) |
| +0x4c | **auto-examine delay** [n, a] (0x9ea6) |
| +0x50 | face RLE offset |
| +0x52 | mouth tracks offset |
| +0x54 | name |

All times are scanning steps, about 1 s each. The [n, a] pair is indexed by 0x4cf4.

| file | lock n/a | ident n/a | damage n/a | weak n/a | alert hold | det trig | list trig | auto delay n/a |
|---|---|---|---|---|---|---|---|---|
| BLUSTAN | 10/14 | 6/16 | 12/22 | 16/36 | 38 | 8 | 4 | 60/60 |
| CHURGLK | 8/12 | 12/18 | 18/24 | 28/40 | 38 | 8 | 4 | 18/30 |
| JARU | 7/12 | 16/20 | 22/26 | 36/44 | 38 | 8 | 4 | 22/30 |
| MIKE | 3/3 | 18/16 | 24/22 | 40/36 | 10 | 15 | 8 | 30/30 |
| NARGO | 8/8 | 16/16 | 22/22 | 36/36 | 22 | 12 | 7 | 30/30 |
| PHYZO | 14/14 | 12/12 | 18/18 | 28/28 | 22 | 12 | 7 | 30/30 |

When the scanning officer dies, f_repair @4922 action 1 writes 0x9e90 := 20 and 0x9e94 := 33 over the normal entries
(see Rules R9). The file is reloaded on every restart because main @00a7 calls f_6b7c.

Scanning dept messages (dept 1, id = 0x200 | msg). The step uses 0x16 "Unidentified spacecraft rapidly approaching",
0x1a "Examinations complete…" and 0x1c "I've initiated alien ship examination". Ids 0x1e..0x34 are
Inf Scanner / Track Lock / Cargo Envir / Cargo Stab damaged/disabled/destroyed reports. Repair queues them through the
tables 0x11de/0x1212/0x1246 for components 10/13/21/22. 2..0x14 are general crew chatter (deaths, looting, …).

## Timing
- 120 Hz ISR @6ca9: 0x3518 += 1 every 20 ticks (6 Hz).
- `f_0d97` runs while menus wait (@0786) and during timed waits (@0748). It runs one department per pending tick,
  round robin over 0x1570 = 0..5:
  - 0 = hits/damage @4922 + @64aa + @66dc
  - **1 = Weapons @16f3**
  - **2 = Scanning @243d**
  - 3 = Navigation @2cf2
  - 4 = Engineering @37be
  - 5 = Repair @4479
- So each department step runs at **1 Hz**. In the emulator 0x17d8 advanced by 1 per virtual second.
- After slot 2 runs, if the current display is 2 (status) or 7 (exam list) and no redraw is suppressed (0x2f6 = 0),
  that display is redrawn (`callPtr([0x2d0])`, @0d97).
- Within @243d, in this order: R1 spawn → R2 screen queue → R3 examination work → R4 "complete" message →
  R5 auto-examine → R6 markers → R7 alert → R8 lamp → no-contacts message → R10 hostility.
- The RNG (@7086 byte RNG) is called only in R1: once per new spawn window, then twice per spawned target (bearing,
  then weakness). Nothing else in scanning (UI included) uses the RNG.

## Rules (scanning step @243d unless noted)

**R0 step counter**: `step = ++[0x17d8]`; `odd = step & 1`.

**R1 detection (spawn)** @243d
```
if pos(0xb7a) != lastPos(0x9d6) or route(0xb60) != lastRoute(0x9d8):
    navThreatPending(0xb80) = 1; lastRoute = route; lastPos = pos
    mask = routeMasks[route][pos]                      # word at [0x6150+route*2] + pos*2
    cursor = rand()                                    # RNG #1 (0..255; only the low 4 bits matter)
    tries = 16
if detected < 16 and odd and tries != 0:
    cursor = (cursor + 1) & 15
    if BIT[cursor] & mask:                             # BIT = 0x98a table
        if detected == 0: unqueue(0x21a); queue(0x216) # "Unidentified spacecraft approaching"
        detected++
        do slotSearch = (slotSearch+1) mod 26 while cls[slotSearch] != 0
        t = slotSearch
        cls[t] = CLASS[cursor]                         # 0x9aa table
        bearing[t] = rand() & 3                        # RNG #2
        locked, listed, weakKnown, idCls, onScreen, dmgCnt, weakCnt, idCnt, lockCnt, dmgKnown, hostile = 0
        dmgBits[t] = 8; spawnPos[t] = pos
        weak[t] = (rand() & 3) + 1                     # RNG #3
    tries--
```
- Each route position therefore gives a 32-step window (16 odd steps). Each mask bit is tested once, starting from a
  random cursor, and each set bit adds one target of the matching class.
- Detection does **not** depend on the scanner, the officer or any component.
- Spawning stops while 16 targets are detected, and no tries are used up during that time.
- `wQueued`, `killed` and `marker` are not cleared at spawn. They are already 0 when a slot is freed by @16f3.

**R2 visual-screen queue** @243d
```
for t in 0..25 with cls[t] != 0:
    skip if age(t) = pos - spawnPos[t] >= timeout[cls[t]]  # 0x6252
    skip if (dmgBits[t] & 1) and speed(0xb68) > 6          # E-damaged ships can't keep up
    skip if killed[t] or onScreen[t]
    if screenQueue[bearing[t]] < 0: screenQueue[bearing[t]] = t
```
h1_anim @5e08 later moves the queued target onto the visual screen (ship slot = bearing) and sets onScreen.

**R3 examination work** @243d. Walk the list in priority order. `lvl = alert(0x4cf4)`; `cnt = 0`; one "first" flag per
category (f20/f22/f24).
```
for t in list[0..len-1]:
    if not locked[t]:
        cnt++
        if TrackLock.state(0xed6) == 2:                # fully intact; Track Lock power is NOT checked
            if ++lockCnt[t] >= LOCK[lvl]: locked[t] = 1          # every listed target in parallel
    if officerAlive(0x4cea) and InfScanner.state(0xed0) != 0 and InfScanner.powered(0xf6c):
        if idCls[t] == 0:
            cnt++
            if first unidentified this step: if ++idCnt[t] >= IDENT[lvl]: idCls[t] = cls[t]
        if dmgKnown[t] == 0:
            cnt++
            if first this step: if ++dmgCnt[t] >= DAMAGE[lvl]: dmgKnown[t] = dmgBits[t]
        else: dmgKnown[t] = dmgBits[t]                 # live update once known
        if weakKnown[t] == 0:
            cnt++
            if first this step: if ++weakCnt[t] >= WEAK[lvl]: weakKnown[t] = weak[t]
    else: cnt++
```
- Lock progresses for **all** listed targets at once.
- Class, damage and weakness each work on **one target at a time**: the highest-priority listed target that still
  lacks that piece. The three categories can be on different targets.
- None of them needs Lock first.
- Progress counters are never reset. A target that is cancelled and added again resumes where it stopped.
- Finished targets stay on the list.
- Cross-check in the demo with JARU: lock after 7 steps, then class (16), damage (22) and weakness (36) appeared in
  parallel while the Inf Scanner was powered. This matches the crew table.

**R4 "examinations complete"** @243d: `if [0x9dc]==0 and cnt==0 and !demo(0x3508): unqueue(0x21c); queue(0x21a); [0x9dc]++`.
This fires at most once per mission (see Quirks).

**R5 auto-examine** (only if officerAlive) @243d
```
if autoCnt(0x9de): autoCnt--
if len > 0: autoCnt = AUTO[lvl]
if autoCnt == 0 and detected > 0:
    t = first slot 0..25 with cls[t] and not locked[t]
    if found: setExamPriority(t, 1)   # @232b, clamps to the list end; the list is empty here, so position 0
              if !demo: unqueue(0x216); queue(0x21c)     # "I've initiated alien ship examination"
```
- Effectively, once the list has been empty for AUTO[lvl] steps, the officer lists the lowest-letter target that is
  not yet locked. With autoCnt at 0 (game start) this happens on the first step that has a candidate.
- It never adds a second target. Locked-but-unexamined targets are never picked automatically.

**R6 markers** @243d: `if detected: for each present t: marker[t] = odd ? (listed[t] ? 1 : 0) : (wQueued[t] ? 2 : 0)`.
The status-report icon therefore alternates between the exam glyph '[' and the weapon glyph '\' every step.

**R7 alert** (only if officerAlive) @243d
```
if alertTimer(0x17da): alertTimer-- else alert = 0
if detected >= DET_TRIG or len >= LIST_TRIG: alert = 1; alertTimer = HOLD
```
The alert stays on for HOLD more steps after the trigger condition last held, and clears on the step after that.

**R8 scanner lamp** @243d: `v = InfScanner.state==2 ? 1 : (state==1 ? odd : 0); if !powered: v = 0`. If v differs from
[0x3c2], draw sprite [0x4a0b + v·2] and store v. The lamp is steady when the scanner is OK, blinks when it is damaged,
and is off when it is disabled or unpowered.

Then `if detected == 0: unqueue(0x216)`.

**R9 officer death** (f_repair @4922 action 1):
- 0x4cf4 = 0 and 0x4cea = 0.
- LOCK[0] := 20 and IDENT[0] := 33.
- The exam list is emptied (@23df on each entry).
- Afterwards only Lock progresses (R3 first branch), always with threshold 20. Identification, damage, weakness,
  auto-examine and alert are all gated off. The IDENT overwrite therefore has no effect.

**R10 hostility** @243d: `for t in 0..25: if cls[t] < 8 and !hostile[t] and spawnPos[t] + HOSTILE_DELAY(0x6292) < pos:
hostile[t] = 1`.
- Pirates turn "foe" once more than HOSTILE_DELAY route positions have passed since detection.
- Scouts and Pratos (8/9) never turn foe this way. Any ship also becomes foe when it fires at us (h1_anim, `0x63a := 1`).

**R11 removal** (done by the Weapons step @16f3, see Appendix):
- Killed targets are booked and freed.
- A target is dropped when `age >= timeout[cls]`, unless it is queued in 0x9ca, on screen, or (implicitly) still alive
  in a ship slot.
- Removal takes the target off the exam list (@23df) and drops its weapon-queue entries (@167c).

**@232b setExamPriority(t, pos)**
```
if cls[t] == 0: return
if listed[t]: i = index of t in list; pos = min(pos, len-1)
else:         listed[t] = 1; pos = min(pos, len); i = len; len++
shift entries between i and pos by one toward i; list[pos] = t
```
**@23df removeFromList(t)**: if listed, clear `listed[t]`, `len--` and close the gap.

## Commands / UI
Main menu 'S' → `f_6868(2)` (scanning head + jingle, or jingle 0x0c if dead) → @1cfa. Prompt "SCAN.-". On '^': main menu bar, `0x2da = 0`.

The choice between the full and the reduced menu is made **once on entry** from 0x4cea.

**Full menu** "Status Display ? Cancel Rank Examine ^" (keys S D ? C R E ^, @1cfa):

| key | fn | effect |
|---|---|---|
| S | @1de2 | Status report (display id 2, redraw @217d). Header "SCANNING STATUS REPORT  Cargo nn%" (0x3b4). Up to 16 detected targets in slot order, in two columns of 8. Each row shows: marker, ID, Class (idCls), Typ frd/foe, L n/y (locked), Po bearing+o/i (onScreen). If none are detected: "nothing detected". Does nothing if already shown |
| D | @1e25 | "Display tracking list" (display id 7, redraw @2277). Header "SCANNING DETAILED EXAMINATION LIST". One row per list entry with ID, Class, Typ, Lock no/yes, Damage, Pri 1..8, Po (bearing), R (o/i), Sug. Damage shows dmgKnown: blank / E / W / W,E / S / S,E / S,W / S,W,E / none. Sug shows weakKnown as MI/BL/CA/TH. If the list is empty: "no examinations underway" |
| ? | @0786 | shows the next message of the **fullest** department queue (f_6579), then redraws the menu |
| C | @1e68 | "Cancel examination of target": picker over **listed** targets (slot order) → @23df |
| R | @1ee5 | "Rank target … to level": picker over listed targets, then a level 1..len (default 1) → @232b |
| E | @1fbe | "Examine target … priority": refused with "Examine list full" if len ≥ 8. Picker over **all detected** targets. The default cursor is the first target that is not listed and not locked, or "^" if there is none. Then a priority 1..len+1 (default len+1, i.e. the end) → @232b. Picking an already-listed target moves it (pos clamped to len−1) |

**Reduced menu** (officer dead) "Status ? Examine ^":
- S and ? work as above.
- E @20eb **first empties the list**, then picks among detected targets and puts the chosen one at priority 1. The list
  stays emptied even if the player answers '^'.

All pickers use the generic menu (@04eb/@058e, items 0x2fa, hot keys = first letter, '^' = back). The game keeps running
while menus wait.

## Interactions
- **Weapons** (@16f3, b_weapons):
  - A weapon-queue entry only fires (status 4) when its target is **locked** (0x6a2) and on screen. The status codes
    are 0 weapon destroyed, 1 unpowered, 2 **not locked**, 3 not on screen.
  - Weapons auto-targeting picks the first target that is on screen, locked and foe.
  - The weapons picker offers every detected target (0x59e), locked or not.
  - The true weakness (0x7da) quadruples hit chance (h1_anim @6242) whether or not it was scanned. Scanning only
    reveals it as "Sug".
  - Kill statistics columns use the **identified** class (0x6266[idCls]). Unidentified kills go to column
    0x6266[0] = 6.
  - Pay (@5840) uses the **true** class: `pay += 0x6294[cls] * kills`. There is also a penalty of
    `0x62a6 * (kills of class 8 + 9)` (0x502/0x504 = 0x4f2[8], [9]). Identifying a target before shooting avoids
    killing Scouts and Pratos, which costs money.
- **Visual screen / combat** (h1_anim): the scanning step fills the 4-slot screen queue 0x9ca (R2). h1_anim sets
  onScreen, hostile and killed, and alters the true damage bits.
- **Navigation** (@2cf2):
  - Scanning sets `0xb80 = 1` on every position/route change. Nav uses it for its one-shot threat message 0x408.
  - Nav's route threat scan reads the same route masks (popcount of masks ahead). It needs the **Inf Scanner**
    (0xed0 ≠ 0 and 0xf6c) as well as nav's own conditions.
- **Engineering**: supplies power. 0xf6c (Inf Scanner powered) gates identification work.
- **Repair** (@4922):
  - component state 0xed0/0xed6 (Inf Scanner, Track Lock) gates scanning work;
  - damage messages 0x21e..0x234 go to the scanning queue;
  - officer death applies R9;
  - "pirates present" = any target of class 1..7 in the table (@4922 alarm logic).
- **Messages** (h2 @64be/@6526): dept-1 queue. f_64be ignores messages while 0x4cea = 0.
- **Head**: alert 0x4cf4 makes the scanning head animate differently (`[0x3458]` = 0x4cf4).

## Quirks & bugs
1. **"Examinations complete" fires at mission start** (@243d R4). cnt is 0 on the first step (empty list), so 0x1a is
   queued immediately and 0x9dc blocks it for the rest of the mission. Seen in the emulator: queue = [0x1a] right after
   the start. If unread, the first detection unqueues it. The real "examinations complete" moment never produces the
   message. In demo mode (0x3508) it never fires at all.
2. Track Lock progress checks only the component state (== 2), never its power (0xf72). A damaged (state 1) Track
   Lock stops lock progress completely (@243d).
3. Identification only needs the Inf Scanner state ≠ 0, so a damaged scanner works at full speed (@243d). The lamp
   just blinks.
4. Finished targets are never removed from the list. They block auto-examine, which only acts on an empty list, and
   use up the 8 slots (@243d R5, @1fbe).
5. Class, damage and weakness analysis do not require Lock. Lock does not require the officer, so with the officer
   dead the reduced-menu list still gains locks, using the overwritten threshold 20 (R9).
6. R9 writes IDENT[0] = 33, but identification is gated off once the officer is dead, so it has no effect
   (f_repair @4922).
7. R10 also runs on free slots (cls 0 < 8). Harmless, because spawn clears `hostile`.
8. Spawn tables: bit 0x100 has no cursor (0x98a skips it), so a route mask with 0x100 set never spawns that target.
   Cursor 14 = bit 0x8000 has class 0. A mask with bit 15 would increment `detected` without filling a slot (phantom
   count). No shipped mission uses bit 15. Bit 0x100 does occur, e.g. MISN1 route 0 pos 32 (@243d).
9. Contacts only age with route position. With the ship stopped, targets never time out (R11) and never turn hostile
   (R10).
10. @20eb (reduced 'E') empties the list before the player has chosen anything.
11. The full/reduced menu choice is latched on entry to @1cfa.
12. @1fbe default pick: if no target qualifies, the loop runs to i = 26 and reads 0x37c[26]. f_04eb stores the item
    count there, which puts the cursor on "^". Intended by accident.
13. 0x17d8 is not reset by initGame, so marker/spawn parity carries over between missions.
14. Weapons-side bugs that affect the scanning display: @15b3 re-flags 0x912 by queue slot instead of target, so the
    weapon marker can be wrong. @16f3 tries only one weapon lamp per step (loop body always exits).

## Open questions
- What exactly do damage letters E/W/S stand for? By effect: bit 1 E = slow (can't follow above speed 6, next hit
  destroys); bit 2 W = cannot attack; bit 4 S = does not move (h1_anim). Probably Engines/Weapons/Steering or
  Shields.
- Is the 0x100 hole in 0x98a deliberate (16-bit masks only cover 15 cursors)? Do mission masks with 0x100 encode
  something else?
- Head animation semantics of 0x4cf4 (which face frames) belong to the low-level/UI doc.

## Appendix: Weapons step @16f3 (owned by Weapons; summary of target-table effects)
Runs in slot 1, just before scanning.
1. Clear the 4 weapon-busy flags 0x16d8.
2. For each t with killed[t] = w+1:
   - `0x482/0x490/0x49e/0x4ac[w][col] += 1` (cap 99), where col = 0x6266[idCls[t]];
   - `0x4f2[cls[t]]++`;
   - @23df(t) and @167c(t);
   - cls[t] = 0 and detected−−;
   - unqueue(6), queue(2) (dept-0 messages);
   - killed[t] = 0.
3. For each present t:
   - if `age ≥ 0x6252[cls]` and t is not in 0x9ca[0..3] and not onScreen: remove it as in step 2, without stats or
     messages;
   - otherwise remember the first t that is onScreen, locked and foe as the auto-target candidate.
4. The 5 fire channels 0x450.. are booked:
   - shots go to totals 0x4ba..[weapon][col] (cap 999);
   - a channel with ammo 0 drops its queue entry @15b3;
   - all channels are then freed.
5. Each queue entry (0x440 order) gets a status (see Interactions). Up to 5 ready entries are assigned to channels 0..4.
6. If the weapons officer is alive (0x4ce8), the sweep timer 0x16d2 runs:
   - a non-empty queue reloads it with 0x8b56[alert];
   - at 0 with a candidate and an empty queue, the next round-robin weapon (one try per step) that is intact and
     powered is auto-queued: `@14f3(cand, 0x8b5a, weapon, 1)`.
7. Weapons alert 0x4cf2:
   - hold 0x8b50;
   - triggers when `detected > 0x8b52` or `queue length > 0x8b54`. These are strict ">", unlike scanning's "≥".
8. The 4 weapon lamps show 0 off, 1 damaged, 2 ready, 3 firing.
