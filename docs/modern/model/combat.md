# Combat model: weapons, combat view, damage

Sources: `web/src/psi5/b_weapons.js` (Weapons menu, firing-order queue), `c_scan.js` @15b3/@167c/@16f3 (Weapons step),
`h1_anim.js` @5d20..@64aa (combat-view objects), `h2_lowlevel.js` @671c (enemy shot hits us), @6e26 (display update),
`f_repair.js` @4922/@516d (damage tick, game over). Listing `re/psi5.lst`. Values in this document come from the mission
file (loaded at DS 0x616e, 0x336 bytes) and the five crew files (0x1324 bytes each). Crew file *d* loads at
0x8b0c (Weapons), 0x9e5a (Scanning), 0xb1aa (Navigation), 0xc524 (Engineering), 0xd87c (Repair) (@6b7c). The DS
snapshot `web/data/psi5_ds.bin` was taken before these files load, so it holds **no** values in those areas.

> **Several module headers use wrong names; this document corrects them.**
> - `b_weapons.js` calls the queue a "weapon queue" with params a/b. In fact 0x3e0.. are **firing orders**:
>   serial, shots, weapon type, target.
> - `c_scan.js` calls the same tables "contacts/channels" and calls @16f3 the scanner. @16f3 is the **Weapons step**
>   (round-robin slot 1). The real scanning step is @243d (see `scanning.md`).
> - `h1_anim.js` calls 0x8b30/0x8b38 "hit chance". They are **miss thresholds**: a hit needs rand > value.
>   It calls 0x46e "ammo"; it is the shots left in the order on that channel.
> - `h2_lowlevel.js` calls @671c "random intruder appearance". It is the **enemy-shot-hits-us test**.
> - `scanning.md` says weakness gives "hit chance ×4". That is wrong: the code multiplies the **miss threshold** by 4
>   (see R7 and Q2).

## Purpose
This subsystem covers fighting. The player, or the weapons officer on their own initiative, puts **firing orders**
in a queue of up to 8. Each order is: shoot N shots (or "at will") with weapon type W (Missiles, Blasters, Cannons,
Thermos) at detected target T, at a given priority. Once per second the Weapons step (@16f3) checks each order. It
tests whether the weapon system works and is powered, whether the target is locked by Scanning, and whether the
target is on the visual screen ("in range"). Up to 5 ready orders then become **fire channels**.

The combat view runs about 40 times a second. It holds up to 4 enemy ships (one per bearing: port, fore, starboard,
aft), 2 enemy shots and 2 of our shots. Channels launch homing shots at their target's ship. A shot that reaches the
ship's depth rolls to hit. A hit sets random damage bits; a hit on a ship whose bit 0 is already set destroys it.

Hostile ships fire back. An enemy shot that reaches us adds a pending hit on the shield sector for the attacker's
bearing. Once per second the damage tick (@4922) applies pending hits. The shield battery can absorb a hit. Hits that
get through damage a ship system (repair, see `engineering.md`), cut the cargo, or (late in the route) kill a crew
member. A dead crew member leaves their department with a reduced menu.

**Our ship is never destroyed.** The losses checked here are cargo reaching 0 and time running out.

## State

### Firing orders (Weapons queue), 8 slots *s*
| DS | name | meaning / range | written | read |
|---|---|---|---|---|
| 0x3e0[s] | serial | order id 0..25 (shown as letter A..Z); −1 = free slot | @14f3, @15b3, @167c | menus, @16f3 |
| 0x3f0[s] | shots | 1..9, or 10 = "at will" (shown "*") | @14f3, @16f3 copy-back | @16f3 |
| 0x400[s] | weapon | 0 Missiles, 1 Blasters, 2 Cannons, 3 Thermos | @14f3 | @16f3 |
| 0x410[s] | target | target index 0..25 (letter) | @14f3 | @16f3, @15b3 |
| 0x420[s] | status | 0 "broken", 1 "no power", 2 "need lock", 3 "out-range", 4 "in-range" | @16f3 | panel 0x288e |
| 0x430[s] | channel | channel 0..4 this second, −1 none (−1 at creation) | @14f3, @16f3 | @16f3 |
| 0x440[i] | order | queue order: slot index at priority position *i* | @14f3, @101d, @15b3 | everywhere |
| 0x506 | count | queue length 0..8 | | |
| 0x508 | nextSerial | 0..25, wraps | @14f3 | |
| 0x912[t] | wQueued | target *t* has at least one order | @14f3, @15b3, @167c | @1172 default pick, scanning |

Init (g_core @5247 initGame): serial = −1, channel = −1, other fields 0, count = nextSerial = 0.

### Fire channels, 5 entries *c* (rebuilt every Weapons step)
| DS | meaning |
|---|---|
| 0x450[c] | target index, −1 = channel idle |
| 0x45a[c] | weapon type |
| 0x464[c] | order slot that owns the channel |
| 0x46e[c] | shots left (copy of order.shots; at will = 10). Decremented per launch |
| 0x478[c] | shots launched this second (statistics) |

### Weapons department state
| DS | meaning |
|---|---|
| 0x4ce8 | Weapons department alive (crew member alive). 1 at start. Cleared by @4922 action 0 |
| 0x4cf2 | weapons officer **stressed** (alert) flag. Picks the alternate crew tables. Also drives the head animation (0x3458) |
| 0x16d4 | stress hold countdown (s) |
| 0x16d2 | auto-fire idle countdown (s) |
| 0x16d6 | auto-fire weapon round-robin index 0..3 |
| 0x16d8[4] | weapon lamp "firing" flag per type (lamp sprites 0x4a2d, shown state 0x3c6[4]) |
| 0x50a | all launching blocked (set by intruder alert, @4922) |
| 0x482/0x490/0x49e/0x4ac[col] | kills per weapon type × race column (cap 99) |
| 0x4ba/0x4c8/0x4d6/0x4e4[col] | shots launched per weapon type × race column (cap 999) |
| 0x4f2[cls] | kills per true class (pay, see `core.md`) |
| 0x2d2/0x2d0 | displayed panel id (1 = Weapons Report @1402, 6 = firing order list @1443) and its redraw handler |
| 0x2d8, 0x16ca, 0x16cc | menu selection; last "shots" choice (0 = at will); last weapon-type choice |

Weapons crew file (base 0x8b0c), [normal, stressed] pairs:
| DS | meaning | BORIS | ALZOTT | GROLO | Q6D | SKULARD | YEELA |
|---|---|---|---|---|---|---|---|
| 0x8b30[4] / 0x8b38[4] | **miss threshold** per weapon (normal / stressed) | 35,13,40,35 / 40,13,50,40 | 20,40,50,40 / 20,40,40,40 | 40,26,26,20 / 35,23,23,13 | 23,40,23,23 / 20,40,20,20 | 50,26,50,26 / 26,16,26,16 | 50,35,26,50 / 26,20,16,35 |
| 0x8b40[4] / 0x8b48[4] | reload time per weapon, seconds (normal / stressed) | 5,11,4,5 / 4,11,2,4 | 9,4,2,4 / 9,4,3,4 | 4,7,7,9 / 5,8,8,11 | 8,4,8,8 / 9,4,9,9 | 2,7,2,7 / 7,10,7,10 | 2,5,7,2 / 7,9,10,7 |
| 0x8b50 | stress hold (s) | 25 | 30 | 30 | 30 | 60 | 60 |
| 0x8b52 / 0x8b54 | stress triggers: detected targets > / orders > | 9 / 5 | 10 / 6 | 10 / 6 | 10 / 6 | 5 / 3 | 5 / 3 |
| 0x8b56[2] | auto-fire idle delay (s) [normal, stressed] | 40,60 | 25,25 | 60,120 | 15,15 | 30,30 | 60,120 |
| 0x8b5a | shots per auto-fire order | 8 | 3 | 6 | 4 | 4 | 2 |

The pattern is "fast reload ⇔ high miss threshold". That pattern backs reading these values as miss thresholds.

### Combat-view object table (8 slots; *si* = 2·slot)
Slots 0..3 hold ships. Slot k is bearing k: 0 port (left), 1 fore (centre), 2 starboard (right), 3 aft (rear view).
Slots 4..5 hold enemy shots; slots 6..7 hold our shots.

| DS (+si) | meaning |
|---|---|
| 0x4cfc | move delay countdown (display updates) |
| 0x4d0c | ship AI timer, slots 0..3 (seconds). 0x4d14/0x4d16 (same array, "slots 4/5") are the **reload timers of our shot slots 6/7**. f_64aa counts all six down at 1 Hz |
| 0x4d18 | active |
| 0x4d28 | ships: 2·class. Shots: sprite kind (ours = weapon type; enemy = rand&3). ≥4 = exploding, incremented every move step |
| 0x4d38 | view side: 0 front, 1 rear |
| 0x4d48/0x4d58/0x4d68 | x / y / z, 8.8 fixed point (hi byte = pixels/depth) |
| 0x4d78/0x4d88/0x4d98 | vx / vy / vz |
| 0x4da8 | z at hit (explosion: used for the move delay) |
| 0x4db8 | ships: target index·2 shown in this slot (−1 when retired) |
| 0x4dc0 | ships: copy of 0x4db8 (write-only) |
| 0x4dc8 | ships: aggressive |
| 0x4dd0 | ships: set to 5 when provoked (write-only) |
| 0x4dd8 | ships: facing/bearing 0..3 |
| 0x4de0/0x4de4/0x4de8/0x4dec [2] | enemy shot: shooter kind (write-only), target point x, target point y, **shooter bearing** |
| 0x4df0/0x4df4 [2] | our shot: target index·2, target ship slot si (0xfffe = none) |

Per-target arrays used here (26 entries, owned by `scanning.md`): 0x59e class, 0x63a hostile, 0x6a2 locked,
0x6d6 bearing, 0x70a on screen ("in range"), 0x73e damage bits (8 at spawn), 0x7da true weak weapon+1,
0x946 killed by weapon+1, 0x9ca[4] spawn request per bearing.

Static tables:
- spawn x per slot 0x2f78 = 0x0800, 0x2000, 0x3800, 0x2000; view per slot 0x2f80 = 0, 0, 0, 1.
- vx table 0x2f88 = ±8, ±96, ±160, ±256; vy table 0x2f98 = ±16, ±64, ±192, ±256.
- vz table 0x2fa8 = 16, 16, 16, 16, −16, −192, −320, −512.
- launch tunes 0x2f70 = 26, 28, 30, 32; near-depth clamp tables 0x2fb8/0x2fd8/0x2ff8/0x3018.

### Our ship damage state (used by @4922)
| DS | meaning |
|---|---|
| 0x1288[5] | pending hits: 0 = none, else bearing+1 of the shooter |
| 0x1292[1..4] | bearing+1 → shield sector: 1→1 Port, 2→0 Fore, 3→2 Star, 4→3 Aft |
| 0x129c[] | system-roll thresholds: 43, 53, 64, 75, 85, 96, 107, 118, 119, 128, 139, 150, 160, 171, 182, 192, 203, 214, 224, 235, 246, 251, 253, 254, 255, 256 (entries 3..28) |
| 0xebc[26] | system state 2 ok / 1 damaged / 0 disabled |
| 0xef0[26] | system destroyed |
| 0xf58[26] | system powered (engineering) |
| 0xd1e[26] | system switch state (engineering: 0 off, 1 powering up, 2 on, 3 powering down) |
| 0xf8c | **shield battery** 0..100 (start 50; recharged by engineering) |
| 0x3b4 | **cargo** 0..100 (start 100). 0 = game over |
| 0x12d6[0..3] | boarding special: sector → department killed: 1, 0, 3, 4 |
| 0x1300, 0x12fe | intruder alarm showing; intruder alarm countdown |
| 0x132a / 0x132c | count of systems disabled / destroyed |
| 0x1b5a | damage-tick counter |
| 0x3b2 | game over / mission ended |

Systems (names 0xe88): 0 Fore Shield, 1 Port Shield, 2 Star Shield, 3 Aft Shield, 4 Missile Sys, 5 Blaster Sys,
6 Cannon Sys, 7 Thermo Sys, 8/9 Engine One/Two, 10 Inf Scanner, 11 Emerg Batt, 12 Shield Batt, 13 Track Lock,
14/15 Reactor One/Two, 16/17/18 Robodroid 2/5/7, 19/20 Port/Star Retros, 21 Cargo Envir, 22 Cargo Stab,
23 E Life Sup, 24 N Life Sup, 25 Cravenlator. Weapon type *w* uses system 4+*w*.

Mission constants:
| DS | meaning | MISN1 | MISN2 | MISN3 | MISNA |
|---|---|---|---|---|---|
| 0x622f | enemy hit chance per roll (rand < value) | 40 | 72 | 128 | 40 |
| 0x6231[4] | shield battery drain per hit | 12,10,11,14 | 15,10,13,17 | 18,12,16,21 | 5,3,10,8 |
| 0x624e / 0x6250 | penetration threshold, shield sector ok / damaged (rand < value gets through) | 40/60 | 50/75 | 100/125 | 25/30 |
| 0x6239[4] | cargo lost on a "cargo" hit | 1,2,3,4 | 3,2,4,1 | 1,4,3,2 | 1,2,1,1 |
| 0x6241 | crew-kill specials only when route position 0xb7a > value | 45 | 42 | 20 | 50 (never) |
| 0x6229 | intruder alarm countdown | 4 | 10 | 10 | 4 |
| 0x622d | time limit (min); abort at +60 | 27 | 44 | 67 | 13 |

Repair crew damage tables, damage points per hit by system (example BRU):
- 0xd8b4 (sector switched on): 10,10,10,10,11,11,11,11,20,20,8,0,8,7,7,5,5,5,10,10,10,10,9,9,10,10
- 0xd8e8 (sector off or repair overload): 13,13,13,13,14,14,14,14,23,23,10,0,10,9,9,7,7,7,12,12,12,12,10,10,10,10

Nav crew 0xb208 (evasion value): AYMU 40, BRONX 50, KLG 20, NIK 75, TEGRA 58, YENX 50.

## Timing
- **ISR 120 Hz.** Every 20 ticks it adds 1 to 0x3518 (6 Hz).
- **Simulation step** @0d97 (called from the menu and wait loops while 0x3b2 == 0). It handles one pending step per
  call and advances the round robin 0x1570 = 0..5:
  0 → @4922 damage tick, @64aa object timers, @66dc messages; **1 → @16f3 Weapons step**; 2 → @243d Scanning;
  3 → @2cf2 Navigation; 4 → @37be Engineering; 5 → @4479 Repair.
  Each slot therefore runs at **1 Hz**. 0x3518 is reset to 0 if it goes above 10. After the step, the displayed
  panel is redrawn if its id is the department's slot or slot+5 (Weapons panels 1 and 6 redraw after @16f3).
- **Display update** @6e26 runs at most every 3 ticks (0x351a ≥ 3), so about **40 Hz**. Callers: end of @0d97,
  @0b7c, the UI. The order is:
  1. star step (RNG)
  2. **@5d20 our launches**
  3. **@5e08 spawn one ship**
  4. **@5eba ship AI**
  5. **@6006 steer shots**
  6. **@60b4 move**
  7. **@6242 our hit test**
  8. **@671c enemy hit test**
  9. @631e draw, @67aa head animation

  This is the RNG order within one update.
- Unit summary: reload timers, ship AI timers, countdowns in @16f3/@4922 are **seconds**. Object motion and hit
  tests run per display update.

## Rules

### R1 Firing-order insertion (@14f3 queueWeapon(target, shots, weapon, pos))
```
if class[target] == 0: return                         # target gone
pos = min(pos, count)
shift order[pos..count-1] up by one
s = first slot with serial < 0                        # no bound check; callers ensure count < 8 (see Q4)
order[pos] = s
serial[s] = nextSerial; nextSerial = (nextSerial+1) % 26   (wrap when ≥ 26)
shots[s] = shots; weapon[s] = weapon; target[s] = target; channel[s] = -1
wQueued[target] = 1; count++
```
**@15b3 dropOrder(serial)** removes the first order with that serial, shifts the list down, then recomputes
wQueued[target]. Bug: it sets 0x912 for the *slot index* of another order on the same target, not for the target
(see `scanning.md`). **@167c dropOrdersOfTarget(t)** removes all orders on t and clears wQueued[t].

### R2 Weapons step (@16f3, 1 Hz, slot 1)
```
cand = -1; lamp[0..3] = 0
for t in 0..25:
  if killed[t] (= w+1):                               # destroyed by our weapon w
     col = 0x6266[idCls[t]]; if kills[w][col] < 99: kills[w][col]++     # tables 0x482/0x490/0x49e/0x4ac
     0x4f2[class[t]]++; removeFromExamList(t) (@23df); dropOrdersOfTarget(t); class[t] = 0; 0x9d2--
     msg unqueue 6, queue 2 (Weapons "kill" report); killed[t] = 0
  if class[t] == 0: continue
  if (0xb7a - spawnPos[t]) >= 0x6252[class[t]] and t not in 0x9ca[0..3] and !onScreen[t]:
     age-out: @23df(t); dropOrdersOfTarget(t); class[t] = 0; 0x9d2--
  elif cand < 0 and onScreen[t] and locked[t] and hostile[t]: cand = t
for c in 0..4 with chTarget[c] >= 0:                  # close last second's channels
  col = 0x6266[idCls[chTarget[c]]]
  if launched[c]: lamp[chWeapon[c]] = 1
  if chWeapon[c] < 4: shotsStat[chWeapon][col] = min(999, + launched[c])
  if chShots[c] == 0:
     dropOrder(serial[chSlot[c]])
     if count == 0 and !demo: msg unqueue 6, queue 4
  chTarget[c] = -1
for each order s in queue order:
  if channel[s] >= 0:
     if shots[s] != 10: shots[s] = chShots[channel[s]]      # at will is never used up
     channel[s] = -1
  q = 4 + weapon[s]
  status[s] = state[q]==0 ? 0 : !powered[q] ? 1 : !locked[target] ? 2 : !onScreen[target] ? 3 : 4
c = 0
for each order s in queue order with status 4, while c < 5:
  chTarget[c]=target[s]; channel[s]=c; chSlot[c]=s; chWeapon[c]=weapon[s]; chShots[c]=shots[s]; launched[c]=0; c++
if weaponsAlive (0x4ce8):
  if 0x16d2: 0x16d2--
  if count: 0x16d2 = 0x8b56[stressed]
  elif 0x16d2 == 0 and cand >= 0:                     # auto-fire: ONE try per second (see B6)
     l = 0x16d6 = (0x16d6+1) % 4
     if powered[4+l] and state[4+l]:
        queueWeapon(cand, 0x8b5a, l, 1); msgs unqueue 4, unqueue 2, queue 6 (not in demo)
  if 0x16d4: 0x16d4-- else stressed = 0
  if 0x9d2 > 0x8b52 or count > 0x8b54: stressed = 1; 0x16d4 = 0x8b50
lamps: for l in 0..3: st = (state[4+l]==0 or !powered[4+l]) ? 0 : state[4+l]==1 ? 1 : lamp[l] ? 3 : 2
       if changed: draw 0x4a2d[l*4+st]
```
Auto-fire only starts after the queue has been empty for 0x8b56[stressed] seconds (15..120 s, depending on the
officer).

### R3 Our launches (@5d20, each display update)
```
if 0x50a: return
for c = 4 down to 0:                                  # highest channel index first (see B7)
  if chTarget[c] < 0 or !onScreen[chTarget[c]]: continue
  d = 0                                               # shot slot 6
  if active[6] or reload[6]: d = 1; if active[7] or reload[7]: return
  if chShots[c] == 0: continue
  kind[6+d] = chWeapon[c]; shotTarget[d] = chTarget[c]*2
  launched[c]++; chShots[c]--
  playTune(0x2f70[kind])
  reload[d] = stressed ? 0x8b48[kind] : 0x8b40[kind]                    # seconds
  if !active[other] and !reload[other]: reload[other] = 1               # other slot waits up to 1 s
  active[6+d] = 1
  ship = first ship slot k (3..0) with active and 0x4db8[k] == target*2, else 0xfffe
  shotShip[d] = ship
  if !aggressive[ship]: aggressive[ship] = 1; 0x4dd0[ship] = 5          # provoked (with 0xfffe this writes 0x4dc6/0x4dce)
  view[6+d] = view[ship]; 0x3b00 = view[ship]                           # display flips to the target's side
  x = 0x2000, y = 0x3e00, z = 0x0400, vz = 0x0300
```
No RNG is used.

### R4 Ship spawn (@5e08, each update, at most one ship)
```
for k = 3 down to 0:
  if active[k] or 0x9ca[k] < 0: continue
  t = 0x9ca[k]; 0x9ca[k] = -1
  if killed[t]: continue
  0x4db8=0x4dc0=t*2; active=1; kind=2*class[t]; onScreen[t]=1
  y = (rand&0x3f)*0x101        # RNG 1
  z = 0x7800; aggressive = hostile[t]
  x = (rand&0xf)*0x101 + 0x2f78[k]                    # RNG 2
  view = 0x2f80[k]; 0x3b00 = view
  vz = -16; vx = 0x2f88[rand&0xe]; vy = 0x2f98[rand&0xe]    # RNG 3, 4
  AI timer = 15; return
```
Which ship goes to 0x9ca[k] is decided by Scanning @243d (bearing 0x6d6[t]).

### R5 Ship AI (@5eba, each update, for ship slots 3..0 that are active with AI timer 0)
```
timer = aggressive ? (rand&3)|1 : (rand&0xf)|4                        # RNG: 1|3 s, or 4..15 s
attack = aggressive or (kind < 0x10 and (kind >= 0xc or rand&1))      # class 6,7 always; 1..5 50 %; 8,9 never
if attack and !(dmg[t] & 2): aggressive = 1; shipFire()               # bit 1 = weapons out
if dmg[t] & 4: continue                                               # bit 2 = steering out
vz = 0x2fa8[rand&0xe]; if (k==3) == (view==0): vz = -vz               # sign flips outside the home view
if z_hi > 0x10 (signed) or vz >= 0: vx = 0x2f88[rand&0xe]; vy = 0x2f98[rand&0xe]
```
**shipFire @5f8a:** take the first free enemy shot slot, **5 then 4**. If neither is free, nothing happens (no RNG).
```
active=1; kind=rand&3; pos = ship pos; vz = -0x200
targetY=(rand&0x3f)*0x101; targetX=((rand&0x1f)+0x20)*0x101
view = ship view; 0x3b00 = view; bearing = ship facing 0x4dd8; hostile[t]=1
```

### R6 Steering and movement (@6006, @60b4)
- **Enemy shots** (kind < 4): vx and vy = ±0x80 toward the target point (hi bytes compared), 0 if equal.
- **Our shots** (kind < 4), steering toward ship slot shotShip:
  - vx = −0x100 if (shot.x − ship.x)_hi ≥ 1, +0x100 if ≤ −1, else 0.
  - vy = −0x200 / +0x200 for a difference of ≥ 2 / ≤ −2, else 0.
- **Move**, for each active slot 7..0:
  ```
  if moveDelay: moveDelay--; continue
  zsrc = (shot slot and kind >= 4) ? zHit : z; if exploding: kind++
  moveDelay = (zsrc>>8)>>6                     # 0 when depth < 64, 1 when 64..127
  pos += vel
  if z < 0:                                    # passed the viewer: mirror into the other view
     vz = -vz; vx = -vx; x = 0x40 - x; view ^= 1; z = 0
  if z_hi >= 0x7d:                             # flew away: retire
     active = 0
     if ship: onScreen[t] = 0; 0x4db8 = -1; continue
  ```
- **Ships only:**
  - Clamp x_hi and y_hi to −0x1a..0x4e: set the coordinate to 0xe700 or 0x4d00 and negate the velocity.
  - Facing = 3 in the rear view. In the front view: 0 if x_hi < 0x10, 1 if < 0x30, else 2. It is written to
    0x6d6[t] and 0x4dd8. So the bearing (and the shield sector it hits) follows the ship's screen position.
- **Slots 0..5 with depth z_hi < 0x10:** clamp to the visible area for that depth (tables 0x2fb8..0x3018).
- **Lifetimes:**
  - Our shot: z 4 → 0x7d at +3 per step, which is about 62 updates, **≈1.5 s**. The slot stays busy all that time.
  - Enemy shot: about 2 s.
  - Explosion: kind 4..35 is drawn (8 frames × 4 steps), then the explosion is invisible until it flies off.

### R7 Our hit test (@6242, each update), intended for both our shot slots, **actually only slot 7** (B1)
```
d = 1 (slot 7)
if !active[7] or kind[7] >= 4: return
ship = shotShip[1]; t2 = shotTarget[1]
if t2 != 0x4db8[ship]: return                         # target left that ship slot
if ((z[ship] - WORD[0x4d74 + ship]) >> 8) & 0xff > 4: return     # depth window; B2: indexes by ship, not shot
th = stressed ? 0x8b38[kind] : 0x8b30[kind]
if weak[t] - 1 == kind: th <<= 2                      # true weakness ×4 on the MISS threshold (B3)
if th >= rand: return                                 # RNG: miss (the shot flies on and may roll again)
if !(dmg[t] & 1):                                     # first stage: damage bits
   r = rand & 7                                       # RNG
   if r: dmg[t] = (dmg[t] & 7) | r                    # clears bit 3 ("8" at spawn); bit0 E, bit1 W, bit2 S
   return                                             # shot keeps flying, may roll again next update
playTune(0x22); onScreen[t]=0; active[ship]=0; killed[t] = kind+1     # destroyed
shot becomes an explosion at the ship's x/y with the ship's vx/vy, vz=0x300, zHit = shot z, kind = 4
```
- **Intended depth window:** shot.z ∈ [ship.z − 4.99, ship.z]. A shot moving 3 per step gets 1–2 rolls per pass.
- **Per-roll hit chance:** (255 − th)/256. Example, BORIS missiles (th 35): 86 %; with the target's weakness weapon
  (th 140): 45 %.
- **Kill:** needs a damaging hit with an odd r (P = 1/2) and then any later hit.
- **Damage bits** (scanning shows "E", "W", "S"):
  - bit 0 E (engines): the next hit destroys; the ship can't follow us at speed > 6 (@243d).
  - bit 1 W: the ship can't fire.
  - bit 2 S: the ship can't change course.
  - Bits are never cleared.

### R8 Enemy hit test (@671c, each update), intended for both enemy shot slots, **actually only slot 5** (B1)
```
if !active[5] or kind[5] >= 4 or z_hi[5] >= 2 (unsigned): return
a = rand                                              # RNG, always
if navState (0xb64) == 1 (evasive manoeuvre):  hit iff a >= 0xb208          # B4
else:  hit iff rand < 0x622f                          # second RNG
if !hit: return                                       # rolls again next update while z_hi < 2
k = first free of 0x1288[0..3], else 4 (slot 4 overwritten)
playTune(0x18); 0x1288[k] = bearing[5] + 1; border flash (f_5bed(0x2f), 0x3b02 = 5 updates)
kind[5] = 4; z_hi = 5; zHit = z; vx = vy = 0; vz = 0x300           # explosion
```
- A shot gets exactly 2 rolls: at z ∈ [0, 2), then mirrored to z = 0. After that z = 2 and the shot flies off.
- MISN1: P(hit per shot) = 1 − (1 − 40/256)² ≈ 29 %. MISN3: 75 %.
- While evading: (1 − b208/256) per roll, e.g. KLG 92 %.
- **The hit sector depends on the attacker's bearing at launch**, not on where the shot is.

### R9 Damage tick (@4922, 1 Hz, slot 0)
```
0x1b5a++; action = -1
for i in 0..3: v = (state[i] && powered[i]) ? state[i] : 0; redraw shield lamp 0x4bed[i*4+v] if changed
for i = 0; i < 5; i++:                                # B5: i is reused below
  if !0x1288[i]: continue
  sys = 0x1292[0x1288[i]]; 0x1288[i] = 0              # shield sector 0..3
  hit = 1
  if powered[sys] and state[sys]:                     # sector shield up
     a = battery; b = 0x6231[rand&3]                  # RNG
     battery = a - b
     if a > b:  th = state[sys]==2 ? 0x624e : 0x6250; if rand >= th: hit = 0    # RNG: blocked
     else battery = 0                                 # empty battery: always through
  if !hit: continue
  r = rand                                            # RNG: what is hit
  i = 3; while r >= 0x129c[i]: i++
  i = (i==12) ? 25 : (i==11) ? 10 : (i==3) ? sys : i  # r<43 → the sector itself (≈17 %)
  if i == 26 (r==253): cargo -= 0x6239[rand&3] (clamp 0), queue msg 0x210; continue   # RNG
  if i == 27 (r==254) and 0xb7a > 0x6241: action = 0x12d6[sys]; continue              # boarders kill a crew member
  if i == 28 (r==255) and 0xb7a > 0x6241 and rand < 0x80: action = sys; continue      # RNG
  d = i                                               # 27/28 when the condition fails: alias, no effect (B8)
  if destroyed[d]: continue
  slot = (state[d]==2) ? open new repair slot (cyclic search from 0x12fc), 0x11d2++
                       : repair slot whose system == d
  damage[slot] += ((0xd1e[sys] != 0) and !repairOverload ? 0xd8b4 : 0xd8e8)[d]     # 0xd1e indexed by SECTOR
  if damage[slot] > 99: destroyed[d]=1; state[d]=0; 0x132c++; free slot; msgs (destroyed)
  elif state[d]==2: state[d]=1; msg (damaged)
  else: state[d]=0; 0x132a++; msgs (disabled)         # a 2nd hit disables; repeat hits count again
  robodroid d=16/17/18 → droid 1/4/6: knocked out (or destroyed), unassigned (see engineering.md)
```
After the hit loop:
- **Cargo leaks:** cargo −1 if Cargo Envir or Cargo Stab is destroyed, or (tick&3 == 1 and Cargo Envir disabled)
  or (tick&3 == 3 and Cargo Stab disabled).
- **Life support:** E Life Sup (sys 23) down for 0xc54c s kills Engineering (action 8 → dept 3). N Life Sup (24) down
  for 0xb1d6 s kills Navigation (action 7 → dept 2). Each check runs only while that department is alive; warnings
  at 0x3b and 0x1e; counts down every 2 s.
- **Intruder alarm.** "Active" means any of systems 0..9 has state ≠ 0 and is powered, or the speed is non-zero.
  - While not active, 0x12fe is held at 0x6229.
  - Alarm start (first tick with 0x12fe > 0): tune 0xc, "INTRUDER ALERT (Cargo looting)". If no pirate (class 1..7)
    is present, it forces a spawn (0x12e4 = −1, 0x12e2 = 0x12e6 = 1) and sets **0x50a = 1** (our launches blocked).
  - While the alarm shows: cargo −1 every 2 s (every second in demo); blinking text.
  - It ends once the ship is active again and 0x12fe has run out. Then 0x50a = 0.
  - RNG: one rand&7 at alarm start and one at alarm end, for the message choice.
- **Game over** @516d (sets 0x3b2 = 1; tune 0xc; "Mission Aborted / Return to Starbase 27"):
  - cargo == 0 → "no cargo left"
  - elapsed minutes 0x3b6 − 0x622d > 60 → "took too long"
- **Crew death** (action ≥ 0): queue message 0x1bde[action]; if action ≥ 5, a −= 5. Then 0x4cf2[a] = 0 and
  **0x4ce8[a] = 0**, and:

  | a | department | effect |
  |---|---|---|
  | 0 | Weapons | all miss thresholds 0x8b30 = 32, reloads 0x8b40 = 7 s (replacement gunner); `while count: dropOrder(0)` (**B9 hang**) |
  | 1 | Scanning | thresholds 0x9e90 = 20, 0x9e94 = 33; empty the exam list |
  | 2 | Navigation | 0xb1da = 30, 0xb1d8 = −30, manoeuvre 0xb66 = 0 |
  | 3 | Engineering | delays 0xc554[13] = 20 |
  | 4 | Repair | empty the repair queue |

  The table has no check that the department is still alive, so the same department can "die" again.

### R10 What a dead department changes (0x4ce8+2·d == 0)
- Reduced menu. Weapons: only `F` and `^`.
- Messages from that department are dropped (@64be).
- The head shows "R.I.P." (@6896); the death jingle 0xc plays when its head is shown (@6868).
- Pay penalty 0x62a4 per dead department (g_core; see `core.md`).
- For Weapons: no auto-fire and no stress. Channels and launching keep working.

## Commands / UI (Weapons department, @0e37)
Full menu "Status Display ? Cancel Rank Fire ^" (`SD?CRF^`), title "WEAP.-".
- **S** @0f17: Weapons Report panel (id 1, @1402). Rows are the 7 race columns (Unknowns, Xantogs, Zeltoads, Kiffboks,
  Narviks, Skronts, Flarkins). Columns are shots launched (0x4ba..) and kills (0x482..) per weapon type.
- **D** @0f54: "Display firing order" (id 6, @1443). Header "ID Shots Weapon Target Pri Status", one row per order;
  if the queue is empty: "no outstanding firing orders".
- **?** redraws the menu.
- **C** @0f97 "Cancel firing order": pick an order by serial letter → @15b3.
- **R** @101d "Rank firing order": pick an order, then a new position 1..n. It moves the order in 0x440.
- **F** @1172 "Fire". If 8 orders: "Fire order list full". Otherwise:
  1. Shots: "At will, 1..9" (`A123456789^`, 0x16ca).
  2. Weapon: "Missiles Blasters Cannons Thermos" (`MBCT^`, 0x16cc).
  3. Target: letters of detected targets (class ≠ 0); the default is the first target without an order. Prompt
     "MIS. at target".
  4. Priority 1..n+1 (default = last).
  5. `queueWeapon(target, atWill ? 10 : n, weapon, pos)`.

  `^` at any step aborts.
- **Reduced menu** (Weapons dead, @0ef6) "Fire ^". **F** @132d asks for a weapon, then a target (default the first
  in the list). Then `while count: dropOrder(0)` (B9), then `queueWeapon(target, 10, weapon, 0)`. The initial
  highlight uses 0x2d8, but the choice is stored to 0x16cc (cosmetic).

## Interactions
- **Scanning** (`scanning.md`):
  - It creates targets (class, bearing, weak, dmg = 8), sets **locked** 0x6a2 (needs Track Lock), and fills 0x9ca
    spawn requests.
  - The Weapons step ages targets out and frees killed ones (the scanning appendix duplicates this).
  - "Sug" = known weakness.
- **Navigation:** route position 0xb7a (target age, crew-kill specials gate). Speed 0xb68 (intruder "active"; damaged
  ships can't follow at > 6). Evasive state 0xb64 == 1 (enemy hit test). @2cf2 returns the view 0x3b00 to front
  after a timer.
- **Engineering:**
  - Weapon systems 4..7 must have state ≠ 0 and be powered 0xf58 (order status 0/1, auto-fire, lamps).
  - Shield sectors 0..3 must be powered and not disabled for the battery to absorb.
  - The shield battery 0xf8c drains per hit and engineering recharges it.
  - 0xd1e switch state of the sector picks the damage table.
- **Repair:** pending-hit damage opens/extends repair slots. Repair restores system states (weapons and shields come
  back). Repair overload 0x4cfa selects the heavier damage table.
- **Core / pay:** kills 0x4f2, shots and kills tables, dead departments, cargo 0x3b4, game over 0x3b2.

## Quirks & bugs
- **B1 Shot-slot loops (@6242, @671c):** both loops start at si = 2 and end with `sub si,2; jne`, so si = 0 is never
  tested.
  - **Ours (@6242):** @5d20 fills slot 6 first, so about **half of our shots can never hit**. They are duds that
    still use ammo, reload and the slot for ≈1.5 s.
  - **Enemies (@671c):** @5f8a fills slot 5 first, so the first enemy shot always counts and only the second shot in
    flight is a dud.
  - **Measured** (original in emulator, demo, 80 virtual min): our launches 179 slot 6 / 179 slot 7, kills 0 / 31.
    Enemy launches 240 slot 4 / 342 slot 5, hits on us 0 / 110.
- **B2 Depth window @6242** reads `[di+0x4d74]` (di = target ship slot) instead of `[si+0x4d74]` (our shot's z).
  Effective comparison partner:
  - ship slot 0 (port): z of our **slot-6** shot. Hits land when the previous (dud) shot passes the ship while a
    slot-7 shot is in flight at it.
  - ship slot 1 (fore): correct.
  - ship slots 2/3 (starboard/aft): vx of ship slot 0/1. Only "hits" when that ship is at depth ≲ 4. There it rolls
    every update.
  - Measured kills per launch: port 11/82, fore 15/22, starboard 5/30, **aft 0/45**.
- **B3 Weakness ×4 on the miss threshold** (`shl cx,1` twice at 629e). Firing the target's true weak weapon (shown as
  "Sug" by Scanning) makes hits **much less** likely. It is probably meant to be a ×4 hit chance (or a ÷4
  threshold). This applies regardless of what scanning knows.
- **B4 Evasion inverted (@671c):** during an evasive manoeuvre a hit needs `rand >= 0xb208` (20..75). So evading
  raises the enemy's hit chance from 0x622f/256 (16–50 %) to 71–92 %. It was probably meant as `rand < b208`.
- **B5 Hit loop @4922 reuses i as the system index.**
  - After a hit reaches system d (or a special), the loop continues at i = d+1. d ≥ 4 ends the loop.
  - Remaining pending hits stay in 0x1288 and are applied 1 s later, so they are **delayed, not lost**.
  - A hit on shield sector d < 4 jumps to entry d+1 (it may skip entries this tick or revisit cleared ones).
  - Net effect: at most one internal-system hit or special per second.
  - Pending entries are lost only when @671c overwrites slot 4 while slots 0..3 are full. B1 makes this rare (measured
    max 1 pending).
- **B6 Auto-fire tries one weapon type per second** (@16f3: a loop body that always leaves). If that type is down, it
  waits a second for the next type.
- **B7 Channel priority reversed in @5d20:** channels are scanned 4..0, so the lowest-priority ready order fires
  first. After one launch, the other slot gets reload 1, so only one launch per update.
- **B8 Specials 27/28 that fail their condition** index system 27/28: state → 0xef2/0xef4, destroyed → 0xf26/0xf28
  (= 0xf24[1..2] = 100, never written). So "already destroyed" → no effect.
- **B9 Hang: `while (count) dropOrder(0)`** (@132d reduced-menu Fire at 13d4; @4922 Weapons death at 5080).
  @15b3 removes only the order whose *serial* is 0. If any queued order has a serial ≠ 0, the loop never ends and the
  game freezes. The first order ever gets serial 0, and the officer's auto-fire keeps the queue busy, so a freeze is
  likely once the weapons officer is killed with orders pending. Probably meant to drop the first queued order.
  Static finding; not exercised by any run (README).
- **B10** 0xd1e (switch state) and 0x1292 are indexed by the **sector** of the incoming hit, also when the damaged
  system d is internal. So a system's damage table depends on whether the hit sector's shield is switched on.
- **B11** If the target object is not in any ship slot, @5d20 uses ship = 0xfffe. It then writes
  0x4dc6/0x4dce/0x3b00 garbage, and @6242/@6006 read 0x4db6..
  Normally unreachable: onScreen implies a slot.
- @16f3 drops an order when its channel's shots reach 0, even an at-will one (needs 10 launches in 1 s: impossible
  with reloads ≥ 2 s).
- Write-only fields: 0x4dc0, 0x4dd0, 0x4de0.
- A shot that has hit stays "busy" until its explosion flies off (z ≥ 0x7d).
- Repeated hits on a disabled system increment 0x132a again.

## Open questions
- Q1: units/meaning of the race column 0x6266[idCls] in the report (`scanning.md`) and how kills/shots feed the pay
  (`core.md`).
- Q2: designer intent of B3 and B4. The crew tables trade reload against threshold, which supports reading the
  values as miss thresholds. So B3 is a bug, not "resistance".
- Q3: f_7086 is a rotate-based byte RNG; its distribution is not uniform. The percentages above assume uniform bytes.
- Q4: @14f3 has no free-slot bound. The auto-fire path only runs with count == 0, so it is safe; a remake should
  still guard it.
- Q5: the intruder "active" test (systems 0..9 powered, or moving) is shared with engineering. Check the starting
  power state against `engineering.md` to see whether the alarm can trigger at mission start.
