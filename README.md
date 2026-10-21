# Psi 5 Trading Company (Accolade, 1985/86) — web remake

GOG DOS version as the reference (originals in this folder are untouched).

## Plan
1. **Exact port** — full reverse engineering, JS recreation identical to the original byte for byte (memory) and pixel for pixel.
2. **Modern remake** on top of the verified port (new art via an image API; key goes to `.env`, never committed).

## What the original is
- `PSIBAS.EXE` loops: `SEL.EXE` (course + crew selection) → `PSI5.EXE` (the voyage) → … until PSI5 exits with code 3.
- Both are Microsoft C 1.04 (small model, unoptimized) + hand-written asm (CGA mode 4 graphics, PC speaker tune player
  on a 120 Hz timer interrupt, joystick, RNG). Game code never calls the C library (only startup).
- `SELECT.BIN` passes the selection (mission file, 5 crew files, demo/sound/joystick flags) from SEL to PSI5.

## Layout
- `re/` — `lister.py` (recursive-descent listing with switch tables; `seeds.json` = pointer-only entry points),
  `psi5.lst`/`sel.lst`, `callgraph.py` → `*_cg.json` (who must be a generator), `psi5_batches.json`.
- `tools/emu/` — deterministic 8086 PC (CPU, CGA, PIT/PIC, speaker, HLE BIOS/DOS) running the original; the reference.
  `snapshot.mjs` dumps DS at `main()` → `web/data/*_ds.bin` (the port's initial memory).
- `tools/diff.mjs` — lockstep original vs port, compares DS/VRAM/BIOS area/hardware after every idle point.
- `tools/record.mjs` + `tools/fcheck.mjs` — record real calls of every function, replay them through the port.
- `tools/hybrid.mjs` — unported functions run as original code inside the port (so any part can be tested alone).
- `_dosref/` — the original in js-dos (DOSBox) + `cmp.mjs` (DOSBox vs emulator screen compare).
- `web/` — the port: `src/rt.js` (machine model), `src/sel.js` (SEL.EXE), `src/psi5/` (PSI5.EXE, rules in `PORTING.md`),
  `src/main.js` (browser driver), `index.html`.

## Time model
The original is driven by a 120 Hz timer interrupt. Reference semantics = an infinitely fast CPU: time passes only at
idle points (keyboard poll with empty buffer, BIOS tick read, two delay loops on the ISR counter). Both the emulator
and the port follow it, so runs are reproducible and comparable byte for byte; the browser delivers ticks in real time.

## Run
`python -m http.server 8772` in this folder → http://localhost:8772/web/index.html (original: `/_dosref/index.html`).
Checks: `node tools/diff.mjs w:300 k:Enter w:60 k:^D w:7000 w:30000`, `node tools/fcheck.mjs PSI5.EXE`.

## Status
- Emulator vs DOSBox: identical on static screens (title, briefing, PSI5 bridge); only animated spots differ in timing.
- SEL.EXE: ported, lockstep identical through full selection, demo mode, timeout, joystick, sound toggles, SELECT.BIN.
- PSI5.EXE: all 187 functions ported (9 modules in `web/src/psi5/`). fcheck: 124 functions identical on every recorded
  real call (3 more are longjmp/restart helpers fcheck cannot replay; 4 have no recordings: f_0ef6 f_516d f_59e8 f_6d79).
  Full-game lockstep identical: demo 207k idle points, 3 random-key bots x 95k, plus per-department manual sessions
  (menus, quit/replay/restart, mission end, ESC pause, joystick, sound toggles).
- Plays in the browser (`web/index.html`) end to end.
- Not yet exercised by any run: reduced department menus (shown when a department is knocked out, flag
  `0x4ce8+dept*2`, cleared in f_4922) and the unreferenced debug menu f_594e.

## Original bugs kept in the 1:1 port (candidates for fixing in the remake)
- f_4922: hit loop reuses its counter as the system index, so usually only the first hit of a volley is applied.
- f_6242: loop ends on `jne` instead of `jns`, only shot slot 7 is tested for hits.
- f_64be: full-queue shift never advances, only the first entry is overwritten.
- f_669b: text routine clobbers the loop counter (CX), indicator loop covers 3 slots or runs past the 5 counters.
- f_15b3 re-flag indexes 0x912 by contact slot instead of target; f_16f3 free-light loop runs once.
- Quit never ends the program (PSIBAS waits for exit code 3 that is never produced).
- "Replay / Same crew" restarts main with SP=BP=0 (locals at DS:2/4); returning from main after that would crash.

## Modern engine (phase 2, in progress)
- Model of the game's rules: `docs/modern/MODEL.md` + `docs/modern/model/*.md`; assets/text/tunes: `docs/modern/assets/`.
- Clean engine `web/src/engine/` (conventions `docs/modern/ENGINE.md`, game API `docs/modern/GAME.md`): standalone
  `Game` (missions, 120 Hz tick, department steps, combat view, commands, invoice). Original bugs are reproduced by
  default and fixed behind `fixes.*` flags (`docs/modern/changes/*.md`).
- Proof of equality with the 1:1 port: `tools/equiv.mjs` (per step), `tools/equiv_game.mjs` (whole missions, engine
  without the port, same commands): 0 differences on the demo mission (95 880 ticks, same invoice) and long sessions.
