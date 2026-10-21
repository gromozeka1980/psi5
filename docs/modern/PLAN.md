# Modern rewrite — plan

Goal: a clean, high-level reimplementation of Psi 5 Trading Company (game logic first, presentation later) that we
understand completely, so the remake can fix original bugs and add features deliberately.

## Steps
1. **Model** (`docs/modern/model/*.md`): the game's real rules, read out of the verified 1:1 port (`web/src/psi5/*.js`,
   `web/src/sel.js`). One document per subsystem, same template (below). Merged summary: `docs/modern/MODEL.md`.
2. **Engine** (`web/src/engine/`): plain modern JS modules — explicit state objects instead of DS offsets, one module per
   subsystem, a fixed tick (the original's 120 Hz ISR + 6 Hz department steps), commands instead of key handling,
   the original RNG kept (same call order) so behaviour can be compared.
3. **Equivalence**: `tools/equiv.mjs` drives the 1:1 port and the engine with the same input; an extractor turns the
   port's DS into the engine's state shape every tick; differences are reported per field. The engine must match
   before any change.
4. **Changes**: bug fixes and new features, each behind a named switch (`fixes.hitLoop = true` ...), listed in
   `docs/modern/CHANGES.md`, so "original" mode stays reproducible.
5. **Presentation**: modern UI/art on top of the engine (art via the image API key, later).

## Model document template
- **Purpose** — what the subsystem is in game terms (1 paragraph).
- **State** — every variable: name, meaning, type/range, DS address(es), who writes/reads it, initial value.
- **Timing** — when it runs (ISR tick, 6 Hz department slot, on command), in which order.
- **Rules** — each behaviour as precise pseudo-code/formulas with constants, including RNG calls in order.
- **Commands / UI** — player actions (menu keys) and their exact effects; screens shown (no pixel detail).
- **Interactions** — what it reads from / writes to other subsystems.
- **Quirks & bugs** — original behaviour that looks unintended (keep a list; cite function @addr).
- **Open questions** — anything not fully understood.
Cite the source function (`@xxxx`) for every rule.
