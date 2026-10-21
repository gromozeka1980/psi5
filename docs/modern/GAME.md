# Game core (`web/src/engine/game.js`)

`Game` is the standalone game: it builds a mission from the game files, runs the original main loop one 120 Hz timer
tick at a time and takes the player's actions as semantic commands. It needs no port code at runtime, only the
program's data image (`web/data/psi5_ds.bin`: constant tables, sprites, strings) and the `.BIN` files.
`tools/equiv_game.mjs` proves it equal to the 1:1 port, whole state, after every tick (see Verification).

## API
```js
import { Game } from './engine/game.js';
const game = new Game({ image, fixes: {}, balance: {}, emit: (type, ...args) => {} });   // image = psi5_ds.bin bytes
// or: const { fixes, balance } = PRESETS.modern; new Game({ image, fixes, balance, emit })
game.newMission({ missionFile, crewFiles: [weapons, scanning, navigation, engineering, repair], dashFile,
                  flags: { demo: false, sound: 1, joystick: 0 } });          // Uint8Arrays; dashFile optional
game.commands.begin();            // the briefing's "Press RETURN" (not in demo mode)
for (;;) { /* game.commands.xxx(...) */ game.tick(); if (game.over) break; }  // 120 ticks = 1 s
game.result;                      // 'arrived' | 'noCargo' | 'tooLate'
game.invoice();                   // pay rows (@5840), 0.1 M$ units
game.state                        // all state by name (S), e.g. state.cargo, state.contactClass[t]
```
- **State**: one 64 KB buffer laid out like the original data segment; every field of every engine module (`FIELDS`
  and `DATA` specs) plus the loop's own fields (`GAME_FIELDS`) is a typed-array view under its name (scalars are
  accessors). Names that alias one original variable share storage (`pos`/`position`, `textShown`/`frameOverride`,
  `targetOrdered`/`contactWeaponQueued`, `devTimer` = `devState[13..24]` ...), 16-bit fields wrap like the original.
  The steps get this object as both `S` and `D`. Exported specs: `STATE_SPEC`, `ENGINE_FIELDS`, `GAME_FIELDS`.
- **Events** (`emit`): everything the engine modules emit (sounds, lamps, view, shots, hits, text, ...) plus
  `departure`, `step(slot)`, `flash`, `menu`, `panel(id)`, `message(dept, id)` (−1: "No messages pending"),
  `lamp(dept, on)`, `pause(on)`, `freeze(what)` (where the original would hang).
- `fixes`: engine fix flags (`docs/modern/CHANGES.md`); presets `ORIGINAL` / `MODERN` in `presets.js`
  (`new Game({ image, fixes: MODERN })`). With fixes on, the game is no longer equal to the original.
  `MODERN` = every flag except `evasiveKeepsSpeed` (BALANCE.md §3).
- `balance`: balance knobs (below), partial; missing knobs take the original value. `game.balance` is the merged,
  frozen set (also `ctx.balance`). Unknown knobs or bad values throw. With every knob at its default the game is the
  original (nothing is rescaled, the RNG call order never changes).
- Presets: `PRESETS.original = { fixes: ORIGINAL, balance: ORIGINAL_BALANCE }`, `PRESETS.modern = { fixes: MODERN,
  balance: { ...ORIGINAL_BALANCE, ...MODERN_BALANCE } }` with `MODERN_BALANCE = { enemyHitChance: 0.6, evasion:
  'crewScaled' }` (the bot study's recommendation, BALANCE.md §6).

## Balance knobs (`balance.*`, `presets.js ORIGINAL_BALANCE`)
Each knob rescales a value from the mission / crew files where the engine uses it (the loaded data stays as shipped).
Rounding: `Math.round`, then clamped; a multiplier of exactly 1 leaves the value untouched.

| knob | default | where | effect |
|---|---|---|---|
| `enemyHitChance` | 1 | combat @671c | × the mission's standard per-roll enemy hit chance (DS 0x622f), ≤ 255. An enemy shot hits iff `rand < chance` (2 rolls per shot with `shotSlots`) |
| `evasion` | `'original'` | combat @671c, evasive | the evasive per-roll threshold: `'original'` = navigator 0xb208 as shipped (compared per `fixes.evasionInverted`); `'crewScaled'` = round(standard chance (after `enemyHitChance`) × 0xb208 / `evasionScaleBase`); a number k = round(standard × k), crew-independent |
| `evasionScaleBase` | 128 | | divisor for `'crewScaled'` (128 = MISN3's standard chance, so MISN3 keeps the shipped values) |
| `evasiveSpeed` | `'original'` | nav @2cf2 evade | `'original'` = the navigator's evasive speed tables (0xb1de, stressed 0xb1f0); k = max(1, round(speed × k)), stressed or not. No effect with `fixes.evasiveKeepsSpeed` |
| `penetrate` | 1 | damage @4922 shields | × the mission's shield penetration thresholds (0x624e working, 0x6250 damaged shield), ≤ 256; lower = shields stop more |
| `ourMiss` | 1 | combat our hit test | × our gunner's miss threshold (normal, stressed, or the dead-gunner value), ≤ 255, before the weakness ×4/÷4 |
| `ourReload` | 1 | combat launch | × our reload time (s), ≥ 1 |

`'crewScaled'` with `fixes.evasionInverted` is the intended design: evading lowers the enemy chance by the
navigator's factor (KLG ×20/128 … NIK ×75/128) in every mission, so it scales with the danger and with
`enemyHitChance`. Without `evasionInverted` the threshold is compared the original (inverted) way.
`fixes_test.mjs balance` checks the defaults, the presets, validation and each knob except `penetrate`/`ourReload`
(one-line multipliers).

## Loop (what one `tick()` does)
`tick()` = the main-loop work up to the original's next idle point, then the timer interrupt (@6ca9 counters:
`displayTicks`++, divider → `stepsPending`++ every 20 ticks, `delayCounter`++). The program it runs (@0082):
1. **Boot**: 55 idle ticks (@5baa waits 54 BIOS ticks; the timer is not hooked yet, nothing counts).
2. **Briefing** (not in demo): one flush tick, then each tick draws one random number (@5af1) until `begin()`.
   This is the only variation of a game: the RNG is never seeded.
3. **Start**: @5247 init (table `INIT`), timer hooked (`stepsPending = displayTicks = 0`, divider 4), headline
   "Prepare for departure" (`textShown`), message window 10, five departure pictures = 400 ticks of pure wait,
   headline off, main menu bar (one combat-view poll).
4. **Polling** (@0786, every menu): each tick, unless a command is running: one simulation step (@0d97), then the
   queued commands of this tick, in order.
   - **Simulation step @0d97**: if steps are pending: `slot = (slot + 1) mod 6` and run slot 0 damage @4922 + ship
     timers @64aa + auto answer @66dc / 1 weapons @16f3 / 2 scanning @243d / 3 navigation @2cf2 / 4 engineering
     @37be / 5 repair @4479; `pending − 1`, a backlog over 10 is dropped. Then always one combat-view poll @6e26
     (runs only when `displayTicks ≥ 3`, i.e. at most every 3rd tick; no catch-up).
   - **Combat-view polls** happen exactly where the original draws text with a space/CR, a drawing script or a panel
     row: inside steps (via `display.js printed()`), at the end of every step, when a menu bar is redrawn after a
     command, on the flash text, on a panel title, after ESC-pause when a panel is shown. Only the first poll of a
     tick can run (it resets `displayTicks`), so the game polls wherever the original does at least once per tick.
5. **Commands** run like the menu code after the player's confirming key: the "Processing command" flash @06f4
   (25 ticks text / 25 blank, twice; the simulation keeps running, except on the tick each half ends; one poll when
   the text reappears), then the state change, then the menu redraw (a poll). Delays: @0748 (simulating) and @076d
   (frozen) count `delayCounter`.
6. **End**: a step sets `missionPhase` (arrival in navigation; no cargo / 60 min late in damage) → `game.over`.
   Arrival: the original freezes 300 ticks *inside* the navigation step (@3318); the engine step resolves the pause at
   its start (display timer advanced by 300), the game then runs the 300 frozen ticks without counting them again.
   Report screens are not part of the game; `invoice()` computes the pay (@5840) from the end state.

## Commands (`game.commands.*`) and the original keys
Arguments are what the menus pick: targets/orders/slots are letters A..Z = 0..25, positions are 0-based,
departments 0 Weapons, 1 Scanning, 2 Navigation, 3 Engineering, 4 Repair. All except the instant ones run the flash.

| command | keys | effect (original) |
|---|---|---|
| `fire(target, shots, weapon, position)` | W F `A`/`1..9` `M/B/C/T` target position | queue an order (@14f3); shots 0 = at will |
| `fireOnly(target, weapon)` | W F weapon target (gunner dead) | drop all orders (serial-0 loop, B9), queue at will at 0 |
| `cancelOrder(serial)` | W C order | drop the order (@15b3) |
| `rankOrder(serial, position)` | W R order position | move it in the priority list |
| `examine(target, position)` | S E target position; S R target position | put on / move in the exam list (@232b) |
| `cancelExamine(target)` | S C target | take off the exam list (@23df) |
| `clearExamList()` *instant* | S E (scanner dead: pressing E) | empty the exam list; confirm = `examine(t, 0)` (with `fixes.examClearOnConfirm`: does nothing) |
| `examineOnly(target)` | S E target (scanner dead), `fixes.examClearOnConfirm` | empty the exam list and list the target, on confirm |
| `setCourse(course)` | N R `A..E` | request course, rotate the course list (`courseOrder`) |
| `setSpeed(speed, evasive)` | N A `S/1..8` [`S`/`E`] | request speed; maneuver evasive (sets `evasivePending` before the flash) |
| `cancelManeuver()` | N C | maneuver standard |
| `deviceOff(device)` / `deviceOn(device)` | E C / E E `A..L` | on → powering down / powering up → off; off → up / down → on |
| `rankDevice(group, position)` | E R `A..F` `1..6` | move a power group in the priority list |
| `repairAssign(slot, droids, position)` | R A `1..7` slot position | queue a repair job (@43a2) |
| `repairCancel(slot)` | R C slot | dequeue (@42e4) |
| `repairRank(slot, position)` | R R slot position | move it in the repair queue |
| `repairOnly(slot)` | R F slot (repair officer dead) | dequeue all, queue slot with 7 droids |
| `view(dept, list)` | `S` (status) / `D` (list) in a department | panel switch (no flash if already shown) |
| `nextMessage()` | `?` in a department or the Acknowledge menu | show and remove the fullest queue's next message |
| `acknowledge(dept)` | A `W/S/N/E/R` | the same for one department |
| `clearMessages()` | A C | clear all queues (original loop quirk kept, @669b; `fixes.clearAllMessages` clears all five) |
| `autoAnswer(on)` | A A `E/D` | messages shown automatically every 6 s (slot 0) |
| `refuse()` | W F / S E / R A with a full list | the "list full" message: flash only |
| `pause()` / `resume()` | ESC / any key | frozen (timer counts, backlog dropped later) |
| `begin()` | RETURN on the briefing | start the mission |
| `uiKey(redraw)` | — | timing hook (below) |

Menu navigation (entering menus, cursor moves, back, Home) changes no game state and costs no time in the original
(it is handled after the tick's simulation step), so it has no command. The checks the original makes when a
dialog opens (queue/list full) belong to the UI: it calls `refuse()` instead of opening the dialog.

`uiKey(redraw)`: the original's demo autopilot feeds its keys at the *start* of a tick, before the simulation step,
so that tick has no step, and a combat-view poll only if handling the key drew something. A UI that wants this exact
timing (replaying the demo) issues `uiKey` for such ticks; normal play never needs it.

## Verification
`node tools/equiv_game.mjs <steps>` runs SEL + PSI5 (port) with a key script, records the commands at the moment the
port commits them (menu actions wrapped where the flash starts; ESC/resume; briefing key; demo keys → `uiKey`),
starts a `Game` from the same files when PSI5 starts and feeds it the same commands at the same ticks. After every
tick it compares all state fields byte for byte (constant tables > 64 entries at the end), on arrival once after the
pause, then the invoice. Steps: `w:N`, `k:key`, `r:N:seed` (random keys), `q:N:seed` (random menu keys incl. ESC,
random gaps), `m:N:seed` (random complete menu commands of every department, keys 0..40 ticks apart, so keys also
arrive during flashes), `p:field:index:value` (test poke into both sides, used to kill officers for the reduced menus).

Result (0 differences in every run): the SEL demo full mission (95 880 ticks to arrival, + pause, invoice; 330 demo
`uiKey`s); 5 long random sessions on all 4 courses with different crews (`m`/`q`, 82 k–435 k ticks each, to mission
end); 6 + 8 + 3 more seeded sessions with a fast start (`m`, three arrivals incl. a key typed during the arrival
pause, a natural officer death); an idle course-1 run to the "too late" end (533 766 ticks); dead-officer sessions
(`p:deptAlive`) covering `fireOnly`, `clearExamList`, `repairOnly` and the reduced Navigation/Engineering menus;
`refuse` (full lists). Every command type, pause/resume, the three mission endings and the invoice are exercised.
Crew selection: `w:300 k:Enter w:40 k:<course 1-4> w:40`, per department `[k:Right w:20]×pick k:Enter w:40 k:Enter
w:40`, then `w:1500 k:Enter w:600 k:Space`. Demo: `w:300 k:Enter w:60 k:^D w:7000 w:200000`.

Port change for the recorder: menu actions (and a_ui's own `f_0786`/`f_06f4` calls) that a_ui/c_scan/d_nav called
directly now go through `F` (no behaviour change: `tools/diff.mjs` demo lockstep identical; `tools/fcheck.mjs`
unchanged — its 3 failures are the setjmp/longjmp/restart helpers f_5b5f/f_5b86/f_5b97, which throw by design).
Engine modules: `combat.js` exports `queueOrder`/`dropOrder` (no logic change); `damage.js`'s debug line read
`process.env` unguarded, which throws outside Node (browser) — now `globalThis.process?.env`.
A test poke of the gunner's death while orders are queued hangs the port itself (the reduced Fire's serial-0 loop,
B9); the game emits `freeze` and continues instead.

## Not covered
- Report screens after the mission (phase 2 menus), "Replay / same crew" restart, Quit; joystick; ^Q/^S/^J/^K flags.
- The demo autopilot itself (its key script is not interpreted by the game; replay = recorded commands + `uiKey`).
- Presentation writes into data: @631e stores each sprite's draw position into its header (never read by the engine).
- Commands take the values the player confirmed; checks the original did when the dialog opened (a list full, the
  navigator alive for the maneuver menu) are evaluated at confirm time / left to the UI.
