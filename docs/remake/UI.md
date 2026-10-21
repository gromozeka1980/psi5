# Psi 5 Trading Company — remake UI

The remake UI lives in `web/remake/` (plain ES modules + CSS, no build step). It is a new front end on top of the
standalone engine (`web/src/engine/`, API in `docs/modern/GAME.md`): the UI never computes game rules, it only
**reads `game.state`**, **listens to `emit` events** and **sends `game.commands.*`**. Every visible string comes from
`t(key, params)` (`web/src/i18n/*.json` + remake-only keys in `web/remake/i18n/*.json`, prefix `remake.`).

Look: 1980s retro-futurism — sci-fi paperback / box-art: airbrushed gradients, warm amber key light against deep
space blue, chunky CRT bridge consoles with bezels, scanlines and phosphor glow. Every slot of `ART_SLOTS.json` has
painted art in `web/remake/art/` (§6); a slot whose id is missing from the manifest falls back to the upscaled original
CGA sprite/portrait (pixelated) or a CSS shape.

Input: mouse **or** touch, every action is a tap/click or a drag; no keyboard needed (keyboard: `Esc`/`Space` = pause,
`1..5` = department tab, shortcuts only). Playable on phones in portrait and landscape.

## 1. Flow

```
Title ──► Course ──► Crew (5 departments × 6 candidates, resume) ──► Crew summary ──► Briefing ──► Departure
  ▲                                                                                                │
  │                                                                                                ▼
  └──── Invoice ◄── Mission end (arrival / no cargo / too late) ◄──────────────────────────── Bridge (voyage)
           │                                                                     ▲      │
           └─► "Same crew & course" ──► Briefing                                 └Pause◄┘ (overlay, also Settings)
```
Settings (language, preset, sound, tips) open from the title, from the pause overlay and from the bridge top bar.
**Training run** (§2.14): offered on first launch, started from the title or Settings; it jumps straight to the bridge
with a fixed crew and course and ends in normal play (or back at the title). **How to play** (§2.15) opens from the
title and from «?» on the bridge.

## 2. Screens

### 2.1 Title
Key art (`bg.title`), logo (`logo`), buttons: **New voyage**, **Training run**, **How to play**, **Settings**. Language toggle RU/EN always visible
top right (default RU).

### 2.2 Course selection (SEL "course")
Admiral's orders text (`sel.orders`), then 4 course cards (`map.course.<n>` thumbnail): destination, cargo, distance,
reward, a danger meter (1–4 pips). Tap a card = select + continue. Desktop: 4 cards in a row; phone portrait: a
vertical list; phone landscape: 2×2.

### 2.3 Crew selection (SEL "department", 5 steps)
Stepper header with the 5 departments (done ones show the chosen portrait). Grid of 6 candidate cards (portrait +
name + species/age). Tap a card → **resume sheet** (portrait large, name, age, species, qualifications, education,
experience, strengths, weakness) with **Welcome to the crew** / **Back**. Desktop: grid 3×2 + resume as side sheet;
phone: grid 2×3 (portrait) / 3×2 (landscape), resume as full-screen sheet.

### 2.4 Crew summary
5 portraits with department names, course line; **Accept final crew** / **Reselect crew**.

### 2.5 Briefing
Admiral Lorenzen's letter (`ui.briefing.*`, art `briefing.admiral`), the chosen course, button **Begin** (= the
original "Press RETURN": `game.commands.begin()`; the engine draws one random number per tick while waiting, so the
moment the player taps is the seed, as in the original).

### 2.6 Departure
The bridge is shown, the viewscreen shows `scene.departure` with the headline "Prepare for departure" for the 400
ticks of the original departure sequence; controls are disabled.

### 2.7 Bridge (the voyage)

Regions (all always present on desktop; on phones they collapse as described below):

| region | content | source |
|---|---|---|
| **Status strip** | speed (`speed.*`), position `pos/50` with a route bar, minutes elapsed vs schedule (ETA state colour), cargo %, power (supply level 0–6 + drawn 0–8), shield battery %, alerts (intruder, hit flash, officer dead), "processing command" spinner, «?» (How to play), pause & settings buttons | `speed`, `pos`, `minutes`, `timeLimit`, `etaState`, `cargo`, `gaugeLevel`, `gaugeBars`, `shieldBatt`, `alarmOn`, `borderFlash`, `deptAlive`; events `flash`/`menu` |
| **Viewscreen** | combat view, see 2.8 | `obj*`, `ship*`, `stars*`, `view` |
| **Officer console** | last officer message: portrait (stressed tint), "Captain", text, signature, "…OUT"; 5 message lamps W S N E R (lit + count while a queue is non-empty) — tap lamp = acknowledge that department; **Next** (fullest queue), **Clear**, **Auto answer** toggle | events `message`, `lamp`; `msgCount`, `autoAnswer` |
| **Department panels ×5** | each: header (portrait, name, stressed / R.I.P. state, «?» = that department's help), state readout, direct-manipulation controls (2.9) | state per department |

Layouts:
- **Desktop / wide (≥ 1100 × 640)**: status strip on top; left column = viewscreen (2:1) + officer console; right =
  2 × 3 grid with the five department panels + ship systems map (26 systems, colour by `sysState`), each panel
  scrolls on its own. All five departments are visible at once.
- **Phone portrait** (and tablets in portrait): status strip (2 rows max) → viewscreen (full width, 2:1) → officer
  console collapsed to one line (portrait + first words; tap expands) → the active department panel (scrolls) →
  **bottom tab bar** with the five departments (icon, short name, message lamp badge with the count, red dot when the
  officer is dead).
- **Phone landscape** (height < 500): status strip one row; left half = viewscreen + console line; right half = the
  active department panel; bottom tab bar (compact, 44 px).

### 2.8 Combat view
- Logical canvas 128 × 64 (the original view buffer); the canvas backing store has device resolution (an integer
  number of device px per logical px), over the `view.space.fore/aft` backdrop (the inset shows the other one).
- The main view shows the side the engine selects (`view`: fore with port/fore/starboard ship slots 0..2, or aft with
  slot 3), with the engine's stars; a small **inset** shows the other side's ships and shots so all 4 bearings are
  visible at once. Bearing labels P / F / S / A sit at the slot positions; a bearing with a ship gets a lit bracket.
- Ships: art `ship.class<objKind/2>`, shots: `shot.<weapon>` (`objKind` 0–3), explosions: frame `(objKind·2−8)>>3` of
  `fx.explosion`. The engine still picks the 1986 sprite (class/kind and depth `objZ>>11`, sprite tables at @631e);
  the art is fitted into that sprite's box (×1.25, centred), so positions and depth scaling are the engine's. The
  explosion uses a fixed 40 × 36 box (the original frames do not scale with depth either; the art frames grow and
  fade). Glow: drop shadow cyan (friend) / red (foe) for ships, amber / pink for our / enemy shots. Until an image is
  decoded, or without art, the sprite itself is drawn (pixelated). Target letter tag under each ship, colour by
  friend/foe (`contactHostile`). Hits on us flash the frame (`border` event).
- **Tap a ship → fire popover** (target letter, class, lock, suggested weapon ★ from `contactWeaknessKnown`): four
  weapon buttons + shots chip (At will / 1–9). Tap a weapon = `fire(target, shots, weapon, orderCount)` (appended
  at the end of the order list). If 8 orders exist: `refuse()` + "list full" toast.
- With the weapons officer dead the popover calls `fireOnly(target, weapon)` (the reduced menu).

### 2.9 Department panels (controls → commands)

**Weapons** (`dept.weapons`)
- Weapon lamps ×4: off / damaged / ready / firing (`weaponLampShown`), shots & kills per weapon (`shotsByWeapon`,
  `killsByWeapon` sums).
- **Firing orders list** (priority order): letter, shots (`*` = at will), weapon, target, status (`fire.*`).
  Drag handle = rank (`rankOrder(serial, pos)`); × = `cancelOrder(serial)`.
- **Fire** button opens the target picker (detected targets) → weapon/shots popover (same as 2.8).

**Scanning** (`dept.scanning`)
- Scanner lamp, cargo %, contacts count.
- **Contacts list** (detected targets): letter, class (identified or "Unknown"), frd/foe, lock, bearing, on screen,
  markers (on exam list / weapon queued). Tap a row → actions: **Examine** (`examine(t, examLen)`), **Fire**
  (popover). Reduced menu (scanner dead): **Examine** = `examineOnly(t)` (modern) / `clearExamList()` +
  `examine(t, 0)` (original).
- **Examination list** (priority order): letter, class, lock, damage (`contactDamageKnown` → E/W/S), suggested weapon
  (`contactWeaknessKnown`). Drag = `examine(t, pos)` (re-rank), × = `cancelExamine(t)`. Full (8) → `refuse()`.

**Navigation** (`dept.navigation`)
- Course state (requested / current, `nav.state.*`), ETA state, speed requested / actual.
- **Speed throttle**: 9 detents STOP, 1–8 (tap or drag) + **Evasive** toggle → `setSpeed(speed, evasive)`;
  turning evasive off → `cancelManeuver()`. Navigator dead: no evasive toggle.
- **Course table** A–E (`course.*`): RETA, risk, distance, ETA; tap a row = `setCourse(c)`; the current and
  requested course are marked.

**Engineering** (`dept.engineering`)
- Supply/drawn gauges, shield battery %, emergency battery charge.
- **Devices A–L** as toggle switches (state `devState`: off / powering up / on / powering down, health colour from
  `sysState`) → `deviceOn(d)` / `deviceOff(d)`.
- **Power priority** list of the 6 classes (`power.class.*`) with demand (`devDraw`) and supply state (`devPower`):
  drag to rank → `rankDevice(group, pos)`.

**Repair** (`dept.repair`)
- Robodroids: idle / recharging / busy / out (7 droid pips).
- **Damaged systems** (open slots): system name, damage left (ETR bar), being worked ★. Tap → droid stepper 1–7 →
  **Assign** (`repairAssign(slot, droids, queueLen)`), or **Fix** with the officer dead (`repairOnly(slot)`).
- **Repair queue** (priority): drag = `repairRank(slot, pos)`, × = `repairCancel(slot)`. Full (8) → `refuse()`.
- **Ship systems map**: 26 systems as small labelled cells (ok / damaged / disabled / destroyed).

Every command runs the engine's "Processing command" flash (0.8 s of game time); further taps are queued in order
and the strip shows the spinner while the queue is busy.

### 2.10 Officer messages
Event `message(dept, id)` → console shows the officer (crew face of that department, `portrait.<crew>`), "Captain",
`msg.<crew>.<slot>` (slot = `_msgSlots.<dept>[id/2]`), signature `msg.<crew>.sign`, "…OUT" when the queue emptied.
`message(-1)` → "No messages pending". Lamps follow `lamp(dept, on)`; a lamp turning on beeps (tune 0x16). On
phones the tab badge shows the count. Desktop keeps a log of the last 12 messages under the current one.

### 2.11 Pause
`Esc`/`Space`, the pause button, opening Settings, or the page becoming hidden → `pause()`; the overlay ("Game
«FROZEN»", Continue, Settings, Quit to title). Continue → `resume()`. The tick loop keeps running while paused
(the engine counts timer ticks and drops the backlog as the original does).

### 2.12 Mission end and invoice
On `game.over` the viewscreen shows the end scene (`scene.arrival.<course>` with "Welcome to …" or
`scene.aborted` with the reason) with an **Invoice** button, which opens the **invoice** sheet: hostile bounties per class (kills × bounty),
cargo %, early bonus, bounties, cargo cost, casualties, lost allies, repair costs, total (`money.*`, 0.1 M$ units).
Buttons: **Same crew & course** (new mission with the same files), **New crew & course** (→ course selection).
Department final reports are the five panels, read-only, behind the invoice (desktop) / in tabs (phone).

### 2.13 Settings
Language RU / EN (default RU, saved in `localStorage`), preset **Original** / **Modern** (engine fixes; default Modern,
applies to the next mission), Sound on/off + volume, Tips on/off, **Training run** button (hidden during a voyage).
Saved per browser.

### 2.14 Training run («Учебный рейс», `js/tutorial.js`)
Fixed setup: course 1 (Renlozen), crew Boris / Jaru / Tegra / Craven / Anxy, Modern rules (whatever the setting),
no briefing wait (60 boot ticks, then `begin()`), so the run is identical every time. The coach is the **ship's
computer** (`remake.tutorial.*`): a box with a CRT avatar, the text, **Skip** and (for explanations) **Next**; the
target control gets an amber spotlight (the rest of the screen dimmed by a clip-path shade) and an arrow.

Clock: the departure runs normally, then 240 ticks so every department has run once; from then on the engine is
**frozen** while a mark is shown. It ticks only (a) while the player's order is in the queue / "Processing command"
(×8, about 0.1 s) and (b) in **⏩ waits** (fast-forward ×64, the fight ×16). Conditions are checked after every tick
(`Tutorial.ticked`, called from the app loop), so the run stops on the same tick every time. Input: a capture-phase
guard lets through only the highlighted control(s) and the coach box; keys are swallowed; the visibility pause is off.
On phones a step whose department is not on screen first asks to tap that tab (the tab gets the spotlight); on
desktop the tab is just selected. The spotlit control is kept on screen (re-scrolled if a re-render or a new message
moves it; panel re-renders keep their scroll position, `Bridge.set`).

**Waits never stall silently.** A ⏩ wait moves the box to the bottom and shows: «⏩ ×64», what we are waiting for, a
live progress line (`remake.tutorial.prog.*`: route position and minutes; speed → requested speed; for a scan
«захват ✓ · класс … · повреждения … · слабость …», «враг ✓/…», plus «не в списке изучения» / «сканеру не хватает
энергии» when that is why nothing happens; in the fight hits and the shield battery, «оружию не хватает энергии»),
**Skip** and **«Дальше ⏩»**. A wait ends when its condition holds, on «Дальше ⏩», or at its cap: `WAIT_TICKS` game
ticks (2.5 game minutes ≈ 2.3 s real at ×64; the fight 90 s ≈ 5.6 s at ×16) or `WAIT_REAL` = 6 s real time (slow
machine), whichever comes first. If the condition does not hold then, the tutorial **nudges the engine** so the
lesson still happens (tutorial only; `psi5.tutorial.forced` lists the forced waits):

| wait | condition | nudge on cap / «Дальше ⏩» |
|---|---|---|
| runContact | any contact (A) | spawn a contact as `scanning.js spawn()` does (scout, fore, no messages) |
| runMsg | an officer message | none (the message step is skipped) |
| runPower | actual speed = requested, +3 s | none; then **power** is shown if Weapons or Scanners lack power |
| runExam A | A locked + identified (or gone) | A locked, class/damage/weakness known |
| runB | a pirate (class 1–7) other than A | spawn a Kiffbok (fore, weakness Blasters) |
| runExam B | B locked, identified, weakness known, hostile | same as A + hostile (its on-screen ship turns aggressive) |
| runFire | B destroyed (or gone) | B destroyed as `ourHitTest` does (no explosion) |

Two more pokes keep the fight lesson: from the B wait until the fight is over B does not age out of range
(`contactSpawnPos` moved up), and until the captain's fire order the gunner's auto-fire is held (`autoFireIdle` ≥ 2)
so he does not shoot B first. Without a nudge the run is the same every time.

| # | step | the player does | continues when |
|---|---|---|---|
| 1–4 | welcome, status strip, viewscreen, departments | Next | — |
| 5 | Engineering: the starvation trap (default priorities feed Shields 400 + Weapons 320 first) | drags «Двигатели» to the top | `priority[0] = C` |
| 6–7 | Navigation: full speed; evasive basics | taps 8; Next | `reqSpeed = 8` |
| — | ⏩ | | first contact (A, a scout) |
| 8–9 | contact on the viewscreen; officer message | Next; «Следующее» or a lamp | a message read |
| 10 | power trade-off: at speed 8 engines take all, Scanners/Weapons get nothing | taps 2 (or 1) | `reqSpeed` 1–2 |
| — | ⏩ the ship slows down | | |
| 11 | *only if Weapons or Scanners still lack power* (e.g. the player dragged them down in step 5): the battery chargers are ahead of them | drags the rows, or «Сделать за меня» (ranks E and F last) | Weapons and Scanners above both chargers |
| 12 | *only if A is not on the examination list*: examine A | «Изучить» on A | A listed |
| 13 | Scanners: lock / class / damage / weakness ★ | Next | — |
| — | ⏩ scan of A | | A locked + identified: «свой» → 14: never fire at friends |
| — | ⏩ | | a pirate B (a Kiffbok) |
| 15 | examine B | «Изучить» on B | B listed |
| — | ⏩ scan of B | | B locked, identified, weakness known and hostile → 16: what ★ means |
| 17 | Weapons: «Огонь» → target B → the ★ weapon (∞ shots) | three taps | order on B |
| 18 | the fire list: top to bottom, ⋮⋮ reorders, ✕ cancels, status | Next | — |
| — | ⏩ ×16 the fight | | B destroyed → 19 (else "got away") |
| 20 | shields: hits drain the shield battery, then damage systems; evasive | Next | — |
| 21 | Repair: a training fault (Cargo Envir damaged, slot opened as `damageSystem` does) | taps it, droids, «Назначить» | job queued |
| 22–23 | the repair queue (⋮⋮ / ✕), cargo systems first; schedule, cargo and how the voyage ends | Next | — |
| 24 | done: **Fly on** (normal play continues, tips on) / **To the title** | | |

Skip = end the training and keep flying. Done or skipped → `psi5r.help.tutorial = 'done'` (the first-launch offer
does not come back; «Не сейчас» stores `'declined'`), and the tips the run already taught (contact, hostile, power) are
marked seen. Screenshots `docs/remake/screenshots/tutorial/` (`<device>_<lang>_<nn>_<step>.png`, the ⏩ wait states
`wait_*.png`).

Tested headless (`?mute=1`, `--mute-audio`): the scripted perfect-timing player on desktop 1440×900 / phone 375×812,
ru / en, and a human-like player (random 0.5–20 s reading delays, stray clicks, imperfect drags — Scanners or Weapons
dragged to the bottom, Engines dropped one row short —, speed 1 or 2, a message read via a lamp, the fire sheet closed
and reopened, other shot counts or weapons, other droid counts, «Дальше ⏩» pressed at once) on 1920×1080, 1366×768,
1440×900, 375×812, 390×844 and 844×390, ru and en: no wait longer than a few seconds, always with the ⏩ box.

### 2.15 Help and first-time tips (`js/help.js`)
- **How to play** (`remake.help.*`): one sheet — goal, the bridge, officer messages, then per department *what it
  does / controls / tips*. «?» in a panel header opens only that department. Opening help on the bridge pauses.
- **Tips** (`remake.tips.*`), normal play only (not in the training run, not while paused or a sheet is open), checked
  every 0.5 s, one card at a time (bottom left; above the tab bar on phones), each shown once: first contact, first
  hostile, first hit (`border 0x2f`), power overload (`gaugeBars > gaugeLevel`), a system destroyed, an officer
  stressed, an officer dead, running late (`etaState = 2`), cargo below 100 %. «Понятно» closes, «Без подсказок»
  turns them off (also in Settings).
- Progress: `localStorage['psi5r.help'] = { tutorial: '' | 'done' | 'declined', seen: [tip ids], tipsOff }`, every
  access in try/catch.

## 3. Timing and rendering
- One `requestAnimationFrame` loop; it delivers every 120 Hz tick due by the wall clock (`game.tick()`), at most
  0.25 s of catch-up (tab switches do not fast-forward). Pause = `pause()` command, ticks continue.
- The canvas redraws every frame from state. DOM panels re-render on a 6 Hz clock and only when their content
  changed (a string key per panel); a panel being dragged is not re-rendered.
- Sounds: engine `sound(id)` (only when nothing plays) and `tune(id)` (interrupts) + UI-side tunes (department
  jingle 0x00–0x08 / 0x0c dead on tab change, 0x0a departure, 0x10 head switch, 0x16 lamp) are played from
  `docs/modern/assets/tunes.json` as a square wave (PC-speaker), tick = 1/120 s.

## 4. Files
| file | role |
|---|---|
| `web/remake/index.html` | shell, screen containers |
| `web/remake/style.css` | theme tokens, layouts (desktop / portrait / landscape) |
| `web/remake/js/app.js` | boot, data loading, screen flow, game loop, settings |
| `web/remake/js/bridge.js` | bridge panels, officer console, status strip, commands |
| `web/remake/js/view.js` | combat view canvas |
| `web/remake/js/audio.js` | PC-speaker tunes |
| `web/remake/js/tutorial.js` | training run: script, coach marks, clock gate, input guard |
| `web/remake/js/help.js` | How to play / department help, first-time tips, saved progress |
| `web/remake/js/i18n.js` | `t(key, params)`, language switch |
| `web/remake/i18n/{en,ru}.json` | remake-only strings (`remake.*`) |
| `web/remake/js/data.js` | static data, the art lookup (`art`, `artImg`, `artImage`, `portraitId`, `preload`) |
| `web/remake/art/` | the art: `<id>.webp`, `<id>.s.webp`, `manifest.json` (written by `tools/remake_art.py export`) |
| `docs/remake/ART_SLOTS.json` | every art slot for the art agent |

## 5. Running and testing
`python -m http.server 8772` in the project root → http://localhost:8772/web/remake/index.html.
Debug URL parameters: `?mute=1` forces sound off (always use it for automated/browser tests), `?speed=N` runs the game
N× real time (1–32). `window.psi5` exposes the app state (game, bridge) in the console.
Art: `python tools/remake_art.py pick <id> <file>` / `export` (see §6); never put files into `web/remake/art/` by hand.

## 6. Art

**Files.** `web/remake/art/manifest.json` = `{ "<id>": { "w", "h", "s" } }`. Every id has `art/<id>.webp` (w × h, lossy
WebP q80, alpha q85 for transparent slots); `s > 0` means a phone-size `art/<id>.s.webp` too, `s` px wide (portraits
320, every slot ≥ 512 px wide at half size; icons, shots and the bezel have one size). The lossless masters are
`remake_art/picked/<id>.png` (not served). `portrait.<who>.calm` = `portrait.<who>` and is not exported.

**One lookup** (`js/data.js`): `art(id, fallback, cssW)` returns the URL of the slot for a box about `cssW` CSS px wide:
the small file when `cssW × min(devicePixelRatio, 2) ≤ 1.25 × s`, the full one otherwise (`cssW = 0`: full), and
`fallback` (the original sprite / portrait / `''` = CSS look) only when the id is not in the manifest. `artImg()` gives
`<img>` attributes (class `art` = smooth, `object-fit: cover`; class `px` = pixelated original), `portraitId(who,
{dead, stressed})` picks the state variant (calm without it; the CSS grey / red tint is used only when the variant has no
art), `artImage()` returns a cached decoded `Image` for the canvas.

| where | slots (box width passed to `art`) |
|---|---|
| title | `bg.title` (16:9 cover of the viewport), `logo` |
| course / crew / summary / invoice backdrop | `bg.select` (cover, darkened), `map.course.<n>` (300), `portrait.<who>` (cards 170, steps 24, summary 200, resume full) |
| briefing | `briefing.admiral` (360; hidden on phones, not fetched) |
| bridge | `view.space.fore/aft` (viewscreen + inset), `ship.class1..9`, `shot.*`, `fx.explosion` (canvas), `ui.bezel` (9-slice `border-image`, 6 px, on department panels and the console), `station.<dept>` (panel header backdrop, 300), `dept.icon.<dept>` (message lamps 34, tab bar 28), `portrait.<who>[.stressed/.dead]` (console 112, panel header 34, death toast 48), `scene.departure`, `scene.arrival.<n>`, `scene.aborted` (headline backdrop, viewscreen width) |
| invoice | `ui.invoice` (paper behind the invoice, stretched) |

**Loading.** Nothing is preloaded at boot except the manifest. `<img>`s and CSS backgrounds load when their screen is
shown (screen backdrops are CSS variables on `#app`/`#scr-title`, fetched only for displayed elements; the crew screen
renders only the current department's six candidates). On the bridge start `Bridge.preloadArt()` decodes what the
canvas needs at once — ships, shots, explosion (the variant for the main view's scale, never per depth) — and the
crew's `.stressed` portraits; `.dead` portraits load when an officer dies.

Art downloaded per screen on a first visit (headless Chrome, `?mute=1`, ru, browser cache on; desktop 1440 × 900 @1x,
phone 375 × 812 @3x; reports `docs/remake/screenshots/art/report_*.json`):

| screen | desktop | phone | files |
|---|---|---|---|
| boot + title | 278 KB | 278 KB | manifest, `bg.title`, `logo` (+ ~1.1 MB engine data, fonts, original sprites) |
| course | 339 KB | 563 KB | `bg.select` (small on desktop, full on the phone's 16:9 cover), 4 × `map.course` small |
| crew (5 steps + one resume each) | 754 KB | 754 KB | 30 × portrait small, 5 × portrait full (resume) |
| summary / briefing | 43 KB | 0 KB | `briefing.admiral` small (hidden on phones) |
| bridge (whole voyage) | 609 KB | 802 KB | bezel, `view.space.*`, 9 ships + 4 shots (one size) + explosion, 5 icons, 5 stations small, 5 × stressed small, scenes, one `.dead` |
| invoice | 39 KB | 39 KB | `ui.invoice` |
| **total** | **≈ 2.1 MB** | **≈ 2.4 MB** | of 9.5 MB on the server (was 79.4 MB of PNG) |

Screenshots of this check: `docs/remake/screenshots/art/` (`<device>_ru_<nn>_<what>.webp`, `tutorial_<device>_ru_*`).
