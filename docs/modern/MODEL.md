# Psi 5 Trading Company — game model (summary)

Detailed, cited rules: `model/core.md`, `model/navigation.md`, `model/scanning.md`, `model/combat.md`,
`model/engineering.md`, `model/data.md`. Assets/text/tunes extracted to `assets/` by `tools/extract_assets.mjs`.
This page is the map; when it disagrees with a subsystem doc, the code (`web/src/psi5`) wins.

## The game in one paragraph
You captain a cargo ship over a 50-position route (4 courses: 10–50 positions, $7M–$50M). You never fly or shoot
yourself: five officers (Weapons, Scanning, Navigation, Engineering, Repair) work on their own, and you set their
orders and priorities through menus. The mission ends on arrival, when the cargo reaches 0 %, or 60 min past the
schedule; the ship itself cannot be destroyed. Pay = cargo × condition + early bonus + bounties − costs − dead
officers − repairs. Officers' quality is a table of numbers in their crew file (speeds, thresholds, stress limits).

## Clocks
| clock | rate | what runs |
|---|---|---|
| ISR | 120 Hz | counters, tune player |
| sim steps | 6 Hz (one per menu poll, backlog ≤ 11 kept, larger dropped after one step) | round-robin of 6 slots → each slot **1 Hz** |
| slot 0 | 1 Hz | damage application @4922, ship timers @64aa, auto-answer |
| slot 1 | 1 Hz | **Weapons** step @16f3 (orders, fire channels, auto-fire, target ageing) |
| slot 2 | 1 Hz | **Scanning** step @243d (contact spawning, lock/identify, alert) |
| slot 3 | 1 Hz | **Navigation** step @2cf2 (speed, travel, course change, ETA, arrival/end) |
| slot 4 | 1 Hz | **Engineering** step @37be (device timers, power by priority) |
| slot 5 | 1 Hz | **Repair** step @4479 (droids, work, auto-queue) |
| display | ≤ 40 Hz, only when polled | **combat view** @6e26: enemy AI/shots, our shots, hit rolls, starfield, faces |
1 game minute = 60 navigation steps = 60 s. The engine must give the combat view its own explicit tick (in the
original its rate depends on how often the code polls it — including while printing text).

## Subsystems (state lives in DS; engine names in `web/src/engine/`)
- **Route/navigation** — position 0..50 (65536 sub-units each), course A–E (lateral −2..+2), speed 0..8 limited by
  engine capacity (4 OK / 3 damaged / 0 broken, +1/−1 per s), modes standard/evasive/stopped, course-change counter.
- **Contacts** — up to 16 (26 slots × 18 fields): type (11 classes from the mission file), bearing/screen, weakness,
  damage bits, lock/class/damage/weakness-known progress, age; spawned deterministically from per-position masks.
- **Weapons** — orders queue (8), 5 fire channels, 4 weapon types (missiles/blasters/cannons/thermos), reload/miss
  thresholds from the crew file; shots resolved in the combat view.
- **Combat view** — 4 ship slots (port/fore/starboard/aft), enemy and our shot slots, depth, hit rolls.
- **Power** — 26 systems; supply = reactors × 300 (+600 emergency battery); strict priority allocation; on/off requests
  queued with crew-file delays; overload; batteries.
- **Damage/repair** — pending hits (≤ 1 applied per s), damage 0..99+, destroyed > 99, droids (7), repair slots, work
  256 = 1 point, crew-file rates, auto-queue, repair overload.
- **Crew** — per department: alive flag 0x4ce8+2d (dead → reduced menu), stressed flag 0x4cf2+2d (stress → second value
  of each normal/stressed pair, stressed face), messages queue per department.
- **Economy/end** — cargo %, time vs schedule, bounties, invoice @5840.
- **RNG** — one generator @7086 (256-byte Johnson counter, period 4096 calls), never seeded; variation only from
  how long the player waits on "Press RETURN".

## Original bugs and quirks
Each one is fixed behind a flag (or listed as design / not applicable) in `CHANGES.md`.
Gameplay-relevant:
1. **Our shots: only one of two shot slots is hit-tested** (@6242 loop) — half our shots are duds.
2. **Depth check uses the ship slot instead of the shot** (@6242) — only the fore ship is hit correctly; aft ≈ never.
3. **Weakness multiplies the *miss* threshold by 4** (@6242) — the scanner-suggested weapon hits ~45 % instead of ~86 %.
4. **Evasive manoeuvre raises the enemy hit chance** (@671c) — 71–92 % per roll instead of 16–50 %.
5. **Enemy shots: one of two slots is never tested** (@671c) — harmless direction (enemy fire still works).
6. **Possible freeze**: clearing the orders queue removes only serial 0 (@132d, @4922 officer death) — unconfirmed by a run.
7. **Repair rate per team, not per droid** — for some officers more droids repair slower (7 slower than 1).
8. **Course-change counter never resets** — repeat change instant, reversal twice as long.
9. **Bounties accumulate across "Replay / Same crew"**; many nav variables and the RNG also carry over.
10. **Clear-all-messages** (@669b) skips departments and writes zeros through garbage pointers.
11. **Message queue overflow** (@64be) loses the newest message and duplicates the oldest.
12. Smaller ones: "Examinations complete" only at mission start; reduced-menu Scanning 'E' empties the list first;
    navigator stress reads the engineer's life support; mask bit 8 never spawns (bit 15 would spawn a ghost);
    MISN3 start position never spawns; risk scan reads past the course end; disabled-systems counter re-counts
    hits on already disabled systems; officer death can be triggered repeatedly; partial repair work not cleared;
    next repair job skipped a second after one finishes.
    A destroyed system's freed repair slot stays counted in openSlots 0x11d2 (false repair overload / auto-queue).
Program-level: Quit never exits (only Replay → New crew); "Replay / Same crew" restarts on SP=BP=0.

## Open questions (collected)
- Evasive speed tables are ≤ normal for every navigator — intended?
- Meaning of a few mission-file ranges (0x6243–0x624d, 0x627c–0x6287) and engineer per-device values (0xc554).
- Bounty row labels (fixed table 0x6126) vs mission-file type names.
- What "expert" in the resumes maps to in the weapon parameter tables.
