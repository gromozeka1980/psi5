# Engine — conventions

`web/src/engine/` is the clean reimplementation of the game logic. It must reproduce the 1:1 port exactly (default
"original" mode); every original bug is also implemented in fixed form behind a flag.

## Shape
- One module per subsystem: `combat.js`, `damage.js` (+ repair), `scanning.js`, `nav.js`, `power.js`, shared
  `rng.js`, `messages.js`, `fields.js`. Registered by `index.js`.
- State is a plain object `S` with readable names. A module declares the state it owns as `FIELDS`
  (`[name, dsAddr, type, count]`, see fields.js) and the read-only tables it needs as `DATA` (crew parameters,
  mission data, constant tables — readable names too). DS addresses appear **only** in these specs, never in logic.
- `export const CHECKS = [{ fn: 'f_xxxx', fields: FIELDS_IT_WRITES, data: DATA, run(S, D, ctx, ...args) }]` — `run`
  is the engine's version of that original function. Shared state: `COMMON_FIELDS` in index.js (rng, message queues,
  deptAlive, deptStress) is always present in `S`.
- `ctx.fixes.<name>` switches a fix on; `ctx.emit(type, ...)` reports presentation events (sound id, message posted,
  lamp, view change, text screens) — the engine never draws.
- Code style: idiomatic modern JS, small named functions, named constants, comments in game terms. Keep 16-bit
  wrap-around (`i16/u16` from fields.js) only where the original's behaviour depends on it, and say so.
- Randomness only via `random(S)` from rng.js, in exactly the original order (it is part of the state).
- Messages via `post(S, id, ctx)` / `remove(S, id, ctx)` from messages.js.

## Verification (mandatory)
`node tools/equiv.mjs <steps>` runs the 1:1 port with a key script and replays every call of each registered `fn`
through the engine, comparing the declared fields after each call (`ONLY=f_xxxx` to restrict). Requirement:
0 differing calls over long, varied scenarios that exercise all branches (combat, damage, dead officers, overload,
arrival...). Useful steps: crew selection = `w:300` + 12× `k:Enter w:40` + `w:1500 k:Enter w:600 k:Space`; then
department keys, `w:N` waits, `r:N:seed` random keys; SEL demo (`w:300 k:Enter w:60 k:^D w:7000 w:200000`) plays
a whole mission. Write a short note of the scenarios you used in your module header.

## Fixes
For every bug you implement as a flag, add it to `web/src/engine/presets.js` (FLAGS), `docs/modern/CHANGES.md` (all flags) and
`tools/fixes_test.mjs` (a targeted assert), and an entry to `docs/modern/changes/<module>.md`: flag name, original
behaviour (cite @addr), fixed behaviour, gameplay effect. Fixed paths are not equivalence-checked; keep them small
and obviously correct.
