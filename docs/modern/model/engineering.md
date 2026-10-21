# Engineering (power) and Repair

Sources: `web/src/psi5/e_eng.js` (@3396..@412f UIs, @37be engineerStep), `web/src/psi5/f_repair.js`
(@4230..@48e0, @4479 repairTick; repair-side part of @4922 damageTick), `web/src/psi5/h2_lowlevel.js` (@64be/@6526/@669b
message queues + indicator lights), init in `g_core.js` @5247, scheduler @0d97 (`b_weapons.js`).
Values below were read from `web/data/psi5_ds.bin` and from a running demo (crew BORIS/JARU/KLG/**CRAVEN**/**ANXY**,
DS dumped with `tools/emu` at 60 s and 400 s).

## Purpose

The ship has 26 numbered **systems** (table below). The **Engineer** officer handles the 13 power-using
**components** (systems 0..12). They are grouped into 6 **power classes** (devices). The engineer switches components on and
off. State changes are queued and finish one at a time, with a delay set by the officer's skill. The engineer also
orders the 6 classes by priority. Once per second the reactor output (plus the emergency battery) is handed out down
the priority list. Components that get power work. Components that do not get power are dead, even if they are switched on. The **Repair** officer
owns 7 robodroids. Every damaged system gets a repair **slot**. The player (or the officer, on his own) puts slots
in a priority queue of up to 8 jobs and asks for a number of droids for each job. The droids work off the slot's
damage points, and a droid needs to recharge after each assignment. The two officers' skill tables come from their crew files.
The two departments are linked through damage: hits create repair slots, damaged parts draw more power, unpowered shields let hits
through, and the robodroids are systems that can be damaged too.

### System / component index (names at DS 0xd55.., labels "A".."Z" = 0xbb4[i])
| i | system | power class (device) | i | system | i | system |
|---|---|---|---|---|---|---|
| 0 | Fore Shield | 0 Shields | 9 | Engine Two | 18 | Robodroid 7 (droid 6) |
| 1 | Port Shield | 0 | 10 | Inf Scanner (3 Scanners) | 19 | Port Retros |
| 2 | Star Shield | 0 | 11 | Emerg Batt (4 "Charge Emerg. Batt") | 20 | Star Retros |
| 3 | Aft Shield | 0 | 12 | Shield Batt (5 "Charge Shield Batt") | 21 | Cargo Envir |
| 4 | Missile Sys | 1 Weapons | 13 | Track Lock | 22 | Cargo Stab |
| 5 | Blaster Sys | 1 | 14 | Reactor One | 23 | E Life Sup (engineer's) |
| 6 | Cannon Sys | 1 | 15 | Reactor Two | 24 | N Life Sup (navigator's) |
| 7 | Thermo Sys | 1 | 16 | Robodroid 2 (droid 1) | 25 | Cravenlator |
| 8 | Engine One | 2 Engines | 17 | Robodroid 5 (droid 4) | | |

Device → component ranges: `first[d]` 0xd06 = [0,4,8,10,11,12], `last[d]` 0xd12 = [3,7,9,10,11,12] (constant).

## State

Per-system arrays are word arrays indexed by system i (address = base + 2*i). The pick-list helpers mean
`0xbb4[i]` = label string "A".."Z" and `0xc32[i]` = "1".."9". The e_eng.js header calls these "device/position names", which is wrong.

### Engineering
| name | DS | type / range | meaning | written by | read by | init (@5247) |
|---|---|---|---|---|---|---|
| sysState[26] | 0xebc | 0/1/2 | 2 ok, 1 damaged, 0 disabled (shared with every dept) | @4922 (hit), @4479 (repaired) | @37be, everyone | 2 |
| powered[26] | 0xf58 | 0/1 | component got power this step (only 0..12 are ever recomputed) | @37be | weapons, nav, scan, @4922 | 1 |
| devState[13] | 0xd1e | 0..3 | on/off state: 0 off ("no"), 1 powering up ("rqE"), 2 on ("yes"), 3 powering down ("rqC"). [11] = 0xd34 (Emerg Batt), [12] = 0xd36 (Shield Batt, never changed) | @34dc, @3662, @37be | @37be, nav (0xd2e/0xd32), @4922 (damage table) | 2, except [11]=0 |
| devTimer[12] | 0xd38 | 0 idle, else age in steps | pending state change. [11] = **0xd4e** = "force" flag for the Emerg Batt (it is not aged) | @34dc, @3662, @37be | @37be | 0 |
| changeCnt | 0xf90 | int | steps since the last state change | @37be | @37be | 0 |
| changeDelay | 0xf92 | int | steps that must pass before the next change | @37be | @37be | 0 |
| priority[6] | 0xce2 | device ids | power priority order, position 0 first | @356b | @37be, @3772 | 0,1,2,3,4,5 |
| devDraw[6] | 0xcee | int | power demanded by the device this step (sum of component costs, powered or not) | @37be | priority display | – |
| devPower[6] | 0xcfa | 0/1/2 | " no"/"par"/"yes" (none/partial/full) | @37be | priority display | – |
| shieldBatt | 0xf8c | 0..100 | shield battery charge, absorbs hits | @37be (+), @4922 (−) | @37be, @4922, status display | 50 |
| emergBatt | 0xf8e | 0..100 | emergency battery charge | @37be | @37be, status display | 30 |
| emergChargeCnt / shieldChargeCnt | 0xf94 / 0xf96 | int | charge step dividers | @37be | @37be | 0 |
| overload | 0x4cf8 (= deptOverload[3]) | countdown | engineering overload: slow delay table in use | @37be, @4922 (cleared when engineer dies) | @37be | 0 |
| engStep | 0x1a28 | counter | engineer step count, parity used for blinking | @37be | @37be | not reset |
| gauge caches | 0x3be level, 0x3bc bars, 0x3c4 emerg light, 0x3c0 shield light | | last drawn value | @37be | @37be | −1 |
| engAlive | 0x4cee (= deptAlive[3]) | 0/1 | engineer alive: full menu, overload logic, E-life-support timer | @4922 | @3396, @37be, @4922 | 1 |
| menu selections | 0x2e4 menu, 0x2e6 C, 0x2e8/0x2ea R, 0x2ec E | | remembered cursor | UI | UI | 0 (0x2e4 also reset on menu exit) |

Constants in base DS (the same for every crew):
| name | DS | value |
|---|---|---|
| drawOk[13] | 0xf24 | 100,100,100,100, 80,80,80,80, 100,100, 200, 170, 120 |
| drawDamaged[13] | 0xf3e | 160,150,150,130, 80,50,30,90, 160,160, 270, 170, 120 |
| supply[level] | 0xf98 | 0,300,600,900,1200,1500,1800 (level 0..6) |

Engineer crew file (loaded at 0xc524, file offset = DS − 0xc524). The values are per officer: CRAVEN / FLIGRNK / SHEEMA / TONY / VX4 / WILFO.
| name | DS | CRAVEN | other engineers |
|---|---|---|---|
| lifeSupTimeout | 0xc54c | 120 | 180,150,120,250,60 |
| overloadTime | 0xc54e | 60 | 30,60,60,12,24 |
| maxActiveTimers | 0xc550 | 30 | 50,30,30,100,60 (all >11, so this check never fires) |
| overdrawTolerance | 0xc552 | 30 | 50,30,30,100,60 |
| delay[12] (normal) | 0xc554 | 8×4,18×4,15,15,18,18 | e.g. VX4 20×8,16,16,20,20 |
| delayOverload[12] | 0xc56c | 22×4,14×4,17,17,22,22 | |
The department messages (0x6xx texts) are also in this file.

### Repair
| name | DS | type | meaning | init |
|---|---|---|---|---|
| slotId[26] | 0x1030 | slot index or −1 | slot in use (id = own index) | −1 |
| slotSys[26] | 0x10cc | system or −1 | damaged system in the slot | −1 |
| slotDamage[26] | 0x1168 | int | damage points left ("ETR"); >99 at a hit → destroyed | 0 |
| slotWork[26] | 0x119c | 0..255 | work accumulator, 256 = 1 damage point | 0 |
| slotWanted[26] | 0x1098 | 0..7 | droids requested; nonzero ⇔ slot is in the queue | 0 |
| slotDroids[26] | 0x1064 | 0..7 | droids assigned | 0 |
| slotWorking[26] | 0x1134 | 0/1 | "*" column | 0 |
| slotBlink[26] | 0x1100 | 0/1 | blink marker for queued slots | 0 |
| queue[≤8] | 0xffc | slot indices | repair priority queue (26 words reserved) | 0 |
| queueLen | 0x11d0 | 0..8 | | 0 |
| openSlots | 0x11d2 | int | number of systems awaiting repair (slots in use) | 0 |
| nextSlot | 0x12fc | 0..25 | rotating free-slot search start | 0 |
| droidDestroyed[7] | 0xfc4 | 0/1 | | 0 |
| droidRecharge[7] | 0xfd2 | countdown | | 0 |
| droidOut[7] | 0xfe0 | 0/1 | out of action (its system damaged) | 0 |
| droidBusy[7] | 0xfee | 0/1 | | 0 |
| droid counts | 0x11d6 idle, 0x11d8 recharging, 0x11da busy, 0x11dc out | | status display | 0 |
| autoDelay | 0x11d4 | countdown | auto-queue delay | 0 |
| droidOverload | 0x4cfa (= deptOverload[4]) | 0/1 | repair overload (slow recharge, heavier damage) | 0 |
| droidOverloadCnt | 0x1b58 | countdown | | 0 |
| repStep | 0x1b56 | counter | parity used for blinking | not reset |
| repAlive | 0x4cf0 (= deptAlive[4]) | 0/1 | officer alive: full menu + auto behaviour | 1 |
| emptyShown | 0x2d4 | 0/1 | "none required"/"no repairs in progress" text shown | – |
| droidCountSel | 0x1b18 | 0..6 | remembered "Assign" droid-count cursor | 0 |
| repairMenuSel | 0x2ee | | | 0 |

Repair crew file (loaded at 0xd87c): ANXY / BRU / BRUN / RYBLO / SWIGLTZ / T3 / VOFGANK.
| name | DS | ANXY | others (BRU, BRUN, RYBLO, SWIGLTZ, T3, VOFGANK) |
|---|---|---|---|
| overloadSlots | 0xd898 | 4 | 6,6,6,11,6,4 |
| overloadTime | 0xd89a | 40 | 30,30,30,5,30,40 |
| rechargeTime[2] (normal, overload) | 0xd89c | 15,25 | 10/12, 10/12, 15/20, 15/15, 15/20, 13/15 |
| autoDelay | 0xd8a0 | 120 | 20,20,120,120,140,80 |
| autoDroids | 0xd8a2 | 2 | 4,4,2,3,2,4 |
| work[n droids] | 0xd8a4[0..7] | 0,32,36,40,48,42,36,24 | BRU 0,40,50,54,64,68,72,82 |
| damageA[26] | 0xd8b4 | 5,5,5,5,11,11,11,11,20,20,10,0,10,5,5,10,10,10,10,10,10,10,8,8,8,10 | |
| damageB[26] | 0xd8e8 | 8,8,8,8,17,17,17,17,26,26,14,0,14,8,8,14,14,14,14,14,14,14,14,8,7,10 | |

Fixed hit→droid mapping: system 16→droid 1, 17→droid 4, 18→droid 6 (@4479, @4922). The other 4 droids cannot be hit.

## Timing

- ISR (120 Hz, @6ca9) adds 1 to `0x3518` every 20 ticks (6 Hz). @0d97 runs **one** step per call. It is
  called only while a menu waits for a key (@0786) and the game is not over. The steps go round robin over 6 slots
  (`0x1570`): 0 damage/@4922, 1 weapons, 2 scan, 3 nav, **4 engineerStep @37be**, **5 repairTick @4479**. So each
  department steps at **1 Hz**, in this order: damage → … → nav → engineering → repair.
- After a step, if the shown panel id `0x2d2` equals the step slot or slot+5 and no message is on screen (`0x2f6==0`),
  the panel refresh pointer `0x2d0` runs: after @37be → @36f2 (status, id 4) or @3772 (priorities, id 9); after
  @4479 → @412f (repair status, id 5) or @4230 (repair list, id 10) (@0d97).
- Backlog: if more than 10 steps are pending after a step, all pending steps are dropped (`0x3518 := 0`) (@0d97). Time
  spent in delay loops (e.g. the 2×25-tick confirmation flash @06f4 after every command) builds a backlog that is then caught up.
- Commands take effect at once, inside the key handler, between steps.
- Neither @37be nor @4479 (nor any engineering or repair command) uses the RNG. Every random decision is in @4922 (combat).

## Rules

### Engineering step @37be (once per second)
```
engStep++
// 1. age pending state changes (components 0..10 only)
active = 0; oldest = -1; maxAge = 0
for i in 0..10: if devTimer[i] != 0: devTimer[i]++; active++; if devTimer[i] > maxAge: maxAge = devTimer[i]; oldest = i
// 2. complete at most one state change
changeCnt++
if changeCnt > changeDelay:
    changeCnt = 0; changeDelay = 0
    if devTimer[11] (0xd4e): oldest = 11          // Emergency battery request jumps the queue
    if oldest >= 0:
        devTimer[oldest] = 0
        devState[oldest] = (devState[oldest] == 1) ? 2 : 0
        changeDelay = overload ? delayOverload[oldest] : delay[oldest]
// 3. supply
level = sysState[14] + sysState[15]            // Reactor One + Two, each 0/1/2 -> 0..4
if devState[11] > 1 and emergBatt != 0: level += 2   // battery "on" (or powering down) and charged
budget = supply[level]                          // 300 per level
// 4. distribute in priority order (no RNG)
total = 0
for p in 0..5:
    d = priority[p]; devPower[d] = 0; sum = 0
    for c in first[d]..last[d]:
        cost = 0
        if (devState[c] > 1 and sysState[c] != 0) or d == 4:
            cost = sysState[c] == 2 ? drawOk[c] : drawDamaged[c]
        if d == 2:                                    // engines
            if engineUse[c-8] (0xb84/0xb86, set by nav @322f) != 0: cost = i16(cost * engineUse)
            else if cost != 0: cost = 40               // idle engine
        budget -= cost                                // budget keeps falling even when negative
        if budget >= 0 and cost:  powered[c] = 1; devPower[d] = 2
        elif cost:                powered[c] = 0; if devPower[d] == 2: devPower[d] = 1
        else:                     powered[c] = 0
        sum += cost
    devDraw[d] = sum; total += sum
// 5. batteries
if powered[11] (0xf6e): if emergChargeCnt-- <= 0: emergChargeCnt = 5; emergBatt = min(100, emergBatt+1)  // +1 per 6 s
if devState[11] > 1 and emergBatt != 0 and budget < supply[2] (600): emergBatt--                  // drain
if powered[12] (0xf70): if shieldChargeCnt-- <= 0: shieldChargeCnt = 2; shieldBatt = min(100, shieldBatt+1) // +1 per 3 s
// 6. overload (only while engineer alive)
if engAlive:
    if sysState[23] == 1 (E Life Sup damaged) or active > maxActiveTimers or total - supply[level] > overdrawTolerance:
        overload = overloadTime
    elif overload: overload--
// 7. dashboard gauges (always drawn, only on change)
power-level gauge: `level` lit segments out of 6 (pictures 0x48e0 lit / 0x48f2 unlit)
power-drawn gauge: min(8, trunc(total/300)) lit segments out of 8 (0x4904 / 0x48f2)
emerg light s: devState[11]==0 → 0; emergBatt>20 → 1; emergBatt==0 or engStep odd → 2; else 0   (blinks when 1..20)
shield light s: shieldBatt>20 or (shieldBatt!=0 and engStep odd) → 1 else 0                  (blinks when 1..20)
```
What this means for play:
- A component works only if `powered` is set. A component that is switched on but unpowered is dead.
  The priority list is strict: once the budget runs out, every later component is unpowered, even a cheap one.
- Turning a component on or off is a request. Requests finish one at a time, oldest first. After component c changes,
  the next change must wait `delay[c]+1` steps (CRAVEN: shields 9 s, weapons 19 s, engines 16 s, scanner/batteries
  19 s; overloaded: 23/15/18/23 s). With no change in progress, a new request finishes at the next engineering step.
- "Powering down" (state 3) still draws power and still works until it finishes. "Powering up" (state 1) draws nothing yet.
- A damaged component (sysState 1) draws `drawDamaged`, which is more for shields, engines and the scanner and less for some weapons.
  A disabled component (0) draws nothing and is never powered.
- Engines draw `base × speed units` from nav (e.g. 2 engines × 100 × 4 = 800). An engine that is on but not used draws 40.
- The emergency battery charger (class 4) draws 170 **always**, whatever its on/off state or damage state. It charges whenever it is powered,
  even while the battery is discharging. The battery adds 600 supply while it is on and charged, and loses 1 point per
  second only while less than 600 of the budget is left over. In other words, it drains only when its power is actually needed.
- The shield battery charger (class 5) cannot be switched (state stays 2). It draws 120 unless disabled.
- Overload (engineer alive only) starts when demand exceeds supply by more than `overdrawTolerance`, or when
  E Life Sup is damaged. It lasts `overloadTime` steps after the last trigger. The only effect is the slow delay table.

Observed demo state (400 s): priority [Engines, Weapons, Scanners, Shields, E, F], level 4 (1200), demand
800+240+200+300+170+120 = 1830. Engines and weapons got power. The scanner and all shields got none, and overload was 60. This matches the rules above.

### Repair slots from damage (@4922, repair side only. Hit selection and shield absorption are in the combat doc)
For a hit on system `d` (the struck shield/target is `sys`, used only to choose the damage table):
```
if destroyed[d] (0xef0): ignore
if sysState[d] == 2:                     // new damage: open a slot
    while slotId[nextSlot] >= 0: nextSlot = (nextSlot+1) mod 26
    s = nextSlot; slotId[s] = s; slotSys[s] = d; slotWanted[s] = slotDroids[s] = slotDamage[s] = 0; openSlots++
    // slotWork and slotWorking are NOT reset (leftover fraction carries over)
else: s = first slot with slotSys == d
table = (devState[sys] != 0 and not droidOverload) ? damageA : damageB     // shield not switched off -> lighter damage
slotDamage[s] += table[d]
if slotDamage[s] > 99: destroyed[d] = 1; sysState[d] = 0; destroyedCount(0x132c)++; dequeue(s); free slot; msgs
elif sysState[d] == 2: sysState[d] = 1  (damaged, queue msg 0x11de[d])
else:                  sysState[d] = 0  (disabled, swap msg to 0x1212[d]); disabledCount(0x132a)++
if d is a robodroid system (16/17/18 → droid k = 1/4/6):
    if droidBusy[k]: slotDroids[last queued slot with droids>0]--      // taken off the lowest-priority staffed job
    if destroyed[d]: droidDestroyed[k] = 1  else: droidOut[k] = 1; droidBusy[k] = 0
```
Hit selection (combat) never picks system 11 or 12. Index 11 is remapped to 10 and 12 to 25 (@4922), so the two
battery chargers can never be damaged. Systems that can be hit: 0..10, 13..25.

### repairTick @4479 (once per second)
```
repStep++
avail = count of droids with droidOut == 0              // note: includes busy and recharging droids
for qi in 0 .. queueLen-1:                              // priority order
    s = queue[qi]
    while slotDroids[s] > slotWanted[s]: releaseDroid(); slotDroids[s]--
    if avail >= slotWanted[s]:
        avail -= slotWanted[s]
        while slotDroids[s] < slotWanted[s] and grabDroid(): slotDroids[s]++
    elif avail > slotDroids[s]:
        avail = 0; while grabDroid(): slotDroids[s]++   // takes every ready droid
    elif slotDroids[s] != 0:
        extra = slotDroids[s] - avail; slotDroids[s] = avail; repeat extra: releaseDroid(); avail = 0
    if slotDroids[s] == 0: slotWorking[s] = 0; continue
    slotWorking[s] = 1
    slotWork[s] += work[slotDroids[s]]                    // total for the team, not per droid
    if slotWork[s] <= 255: continue
    slotWork[s] -= 256; slotDamage[s]--
    if slotDamage[s] > 0: continue
    // finished
    openSlots--; unqueue msg (sysState==1 ? 0x11de : 0x1212)[sys]; sysState[sys] = 2
    sys 16/17/18: droidOut[k] = 0; droidRecharge[k] = rechargeTime[droidOverload]
    sys 19/20 (retros): unqueue nav msg 0x406 / 0x404; if both retros ok: unqueue 0x402
    sys 23: unqueue 0x604; sys 24: unqueue 0x40c
    slotSys[s] = -1; dequeue(s); slotId[s] = -1
if repAlive:
    if autoDelay: autoDelay--
    if queueLen: autoDelay = autoDelayConst (0xd8a0)
    elif autoDelay == 0 and openSlots:
        k = lowest slot index with slotSys >= 0; enqueue(k, autoDroids, 1)   // pos clamps to 0
        if not demo: unqueue 0x802; queue 0x804 ("...I took the opportunity...")
    if droidOverloadCnt: droidOverloadCnt-- else droidOverload = 0
    if openSlots >= overloadSlots: droidOverload = 1; droidOverloadCnt = overloadTime
blink: repStep odd → slotBlink[k] = 1 for every k with slotWanted != 0; even → all 0
counts: for each droid not destroyed: if droidRecharge: droidRecharge--
        then out → 0x11dc, recharging → 0x11d8, busy → 0x11da, else idle 0x11d6
```
- **grabDroid @4872**: the first droid (index 0..6) that is not destroyed, recharging, out or busy is marked busy. Returns 1 if one was found, else 0.
- **releaseDroid @48e0**: the first busy droid (by index, not necessarily one from this job) stops being busy and starts
  recharging for `rechargeTime[droidOverload]` steps. Every release costs a recharge, including releases caused by changing priorities.
- Repair speed: one damage point takes 256/work[n] seconds on average. For ANXY the rate peaks at 4 droids (48/256 = 5.3 s per point).
  More droids are slower (7 droids: 24/256 = 10.7 s, worse than 1 droid at 8 s). BRU's table keeps rising.
- **dequeue(id) @42e4**: find the queued slot with slotId == id. Set slotWanted = 0, release slotDroids droids, set slotDroids = 0,
  slotWorking = 0, then remove it from the queue. If the queue becomes empty and this is not the demo, unqueue 0x804 and queue 0x802
  ("All assigned tasks have been completed"). The slot itself stays open: damage remains, and so does slotWork.
- **enqueue(id, n, pos) @43a2**: s = slot with slotId == id (if none: return). pos = min(pos, queueLen). If already
  queued (slotWanted != 0): j = its index; if pos == queueLen then pos--. Else j = queueLen++. Set slotWanted = n, shift
  entries between j and pos, put s at pos, unqueue msg 0x802.

### Message queues and indicator lights (@64be, @6526, @669b)
Code `dept*2 << 8 | msg`. Departments: 0 W, 1 S, 2 N, 3 E (0x6xx), 4 R (0x8xx). One queue per department, max 8 entries.
The text comes from the officer's crew file. Codes with bit 15 set (0xffff, e.g. shields in 0x11de) are ignored.
- queue @64be: ignored if the department is dead (`0x4ce8[dept]==0`) or the code is already queued. If the queue was empty, the
  department letter light (widget 0x3288[dept]) turns on and beeps. If the queue is full (8), the oldest entry is meant to be dropped
  (see quirk). The new code is appended.
- unqueue @6526: removes the code. When the queue becomes empty, the light turns off.
- Showing and auto-display (@657f, @66dc) are core UI.

## Commands / UI

Main menu E → @3396 (engineer), R → @3be5 (repair). Every pick list ends with "^" (back, no effect). Every confirmed
command shows the acknowledgement flash @06f4.

### Engineer (`ENG.-`)
Full menu (engAlive) `S D ? C R E ^`, reduced menu (engineer dead) `S D ? C E ^`.
- **S Status report** @3462 → panel 4 @36f2: 12 rows A..L (components 0..11) with devState as " no"/"rqE"/"yes"/"rqC",
  plus the Shield Batt and Emerg Batt charges ("nnn"). It is refreshed after each engineering step.
- **D Display power priorities** @349f → panel 9 @3772: the 6 classes in priority order with devDraw ("nnn") and
  devPower (" no"/"par"/"yes").
- **? redraw menu** @342b.
- **C Cancel power to device** @34dc: pick A..L (component 0..11). If state 2: state = 3, timer = 1 (request off). If state 1:
  state = 0, timer = 0 (an "on" request is cancelled at once). States 0 and 3 are unchanged.
- **E Enable device** @3662: pick A..L. If state 0: state = 1, timer = 1. If state 3: state = 2, timer = 0 (an "off" request is cancelled at once).
- **R Rank power class** @356b: pick class A..F, then "to level" 1..6. The class is moved to that position and the others shift.
- Choosing L (Emergency battery) writes timer 0xd4e, the force flag. That request is handled before any other pending one.

### Repair (`REP.-`)
Full menu (repAlive) `S D ? C R A ^`, reduced menu (officer dead) `S ? F ^`.
- **S Status report** @3ccd → panel 5 @412f: up to 16 open slots in slot order. Each row shows the blink marker ("]" when blinking), letter,
  system name, damage left, and "*" when being worked. Below are the counts of idle, recharging, busy and out droids. "none required" is shown when openSlots == 0.
- **D Display repair list** @3d10 → panel 10 @4230: the queue in priority order. Each row shows letter, name, droids
  assigned/requested, priority 1..8, ETR (= damage left) and "*". "no repairs in progress" is shown when the queue is empty.
- **C Cancel effort to repair device** @3d53: pick a queued job, then dequeue it.
- **R Rank device** @3dd4: pick a queued job, then "to level" 1..queueLen. The job moves to that position.
- **A Assign** @3f29: if queueLen >= 8, "repair list full". Otherwise pick a droid count 1..7 (cursor remembered in 0x1b18),
  then a system (list = slots with damage left != 0, cursor on the first one not yet queued), then a priority 1..queueLen+1
  (default: last). This calls enqueue(slot, count, pos). Picking a job that is already queued changes its droid count and moves it.
- **F Fix** @408f (reduced menu only): pick a damaged slot. All queued jobs are cancelled, then enqueue(slot, 7, 0). Without
  the officer you get one job at a time with every droid, and no auto-queueing.

## Interactions
- **Reads**: sysState (from damage @4922), engine speed use 0xb84/0xb86 (nav @322f), deptAlive 0x4cee/0x4cf0, demo flag 0x3508.
- **Writes `powered[c]`**, which gates everything else. Shields: a hit is absorbed by the shield battery only if the struck
  shield is powered and not disabled. The shield damage picture shows 0 when unpowered (@4922). Weapons 4..7: need
  powered and sysState != 0 (@16f3). Engines: nav adds speed only from powered
  engines that are on (@2cf2, @322f). Inf Scanner: nav and scan need devState[10] != 0, powered[10] and sysState[10] (@2cf2).
- The **shield battery** charge 0xf8c is spent by hits (@4922, random 5/3/10/8 per hit). Combat doc.
- **devState of the struck shield** chooses the damage table: switching a shield off makes its hits heavier (@4922).
- Reactor damage lowers supply: each reactor point (state 2→1→0) costs 300.
- E Life Sup (23): while damaged it forces engineering overload (@37be). While disabled, the engineer's life-support
  timer 0x12de runs down from `lifeSupTimeout` (−1 every 2 s, warnings 0x604 at 59 and 0x602 at 30). At 0 the engineer dies:
  deptAlive[3] = 0, overload = 0 (@4922). The "engineer killed" special also sets delay[0..12] = 20, which overwrites
  delayOverload[0] too (13 words from 0xc554) (@4922 case 3). Repair officer killed: all queued jobs are cancelled (@4922 case 4).
- Messages: engineering and repair queue/unqueue codes of other departments (nav retro and life-support messages, etc.).
- Gauges: dashboard pictures 0x48e0.. (power level / drawn), 0x4915/0x49e7 (battery lights).

## Quirks & bugs
1. **@64be full queue**: the shift loop never advances `si`, so it runs `q[0] = q[1]` seven times. Then count drops to 7
   and the new code is written to q[7]. Result `[m1, m1, m2..m6, new]`: the oldest message is dropped (as intended), but
   the **previous newest message m7 is lost and m1 is shown twice**. The duplicate check is skipped for m7 the next time it arrives.
2. **@669b clear-all CX clobber** (options menu C): every time a non-empty queue is cleared, the light-drawing text
   routine leaves CL = 3. The 5-slot loop therefore continues only 2 slots past the last non-empty queue. Example: W has messages → only W,
   S, N are cleared, and **E/R messages and lights survive** (unless S or N was also non-empty). If E or R is non-empty, the
   loop runs past the 5 counters into queue buffer 0 (0x321c..). Stale weapons message codes there count as non-empty: it zeroes them,
   writes 0 into `[ptr+2]` for garbage widget pointers (0x5b43 → DS:0x5b45, then 0 → DS:2), and draws garbage text with a beep.
   This is memory corruption, and the remake must not copy it.
3. **@4479 skip after completion**: dequeuing a finished job shifts the queue while the loop index still advances.
   The next job gets no droid bookkeeping and no work that second.
4. **avail counts busy and recharging droids** (@4479). A job's "reservation" can therefore fail while lower jobs see `avail = 0`. The
   middle branch takes all ready droids, which can be more than the job needs for a moment (fixed by release on the next step).
5. **releaseDroid frees the first busy droid by index** (@48e0), and a hit on a working robodroid removes a droid from the
   *last staffed* job (@4922). Droids are anonymous, so the counts stay consistent.
6. **slotWork is never cleared** when a slot is reused (@4922) or cancelled (@42e4). A fraction (<1 point) carries over.
7. **"Repair list full" blocks re-assigning** an already-queued job (@3f29 tests queueLen >= 8 first).
8. **Cancel reports success**: emptying the queue by Cancel/Fix queues 0x802 "All assigned tasks have been completed" (@42e4).
9. **Auto-queue picks the lowest slot index**, not the most damaged or most important system (@4479). It fires
   `autoDelay` seconds after the queue empties.
10. **More droids can be slower** (work table peaks at 4 for ANXY). This is probably design, but not obvious to the player.
11. **disabledCount 0x132a** increases on every further hit to an already disabled system (@4922).
12. **Emerg Batt charger always draws power** (the `d == 4` bypass in @37be), even when the battery is off. Its devState only gates the
    +600 supply. The force flag 0xd4e is devTimer[11]. It is never aged and not counted in `active`.
13. **maxActiveTimers can never trigger**: at most 11 timers can be active, and every engineer's limit is ≥ 30 (@37be).
14. **Budget goes negative and stays negative** (@37be): an unpowered component's demand still counts, so nothing later in
    the priority list can be powered. A device that is partly unpowered shows "par" only if an earlier component of it got power.
15. A damaged E Life Sup triggers engineering overload. A disabled one starts the engineer's death timer, but does not cause overload.
16. Engine cost `i16(cost × use)` could wrap for large `use`. In practice use ≤ capacity 0xb70[..] (small values).
17. **openSlots 0x11d2 is not decremented when a system is destroyed** (@4922 frees the slot but only `inc`s on open):
    destroyed systems keep the repair officer nearer overload and make auto-queue "assign" a non-existent slot (0x804).

## Open questions
- What the remaining entries of the engineer crew file (after 0xc584) and repair file (after 0xd91c) are used for (messages, faces?).
- The exact range of engine speed units 0xb84/0xb86 (capacity table 0xb70[sysState]). Nav doc.
- The intended meaning of the "rqE/rqC" timers' age beyond ordering. Age is only used to pick the oldest request.
- Whether the work-table peak (more droids slower) is intentional.
- Hit absorption and deflection details (0x6231, 0x624e/0x6250) and special-hit actions: see the combat doc.
