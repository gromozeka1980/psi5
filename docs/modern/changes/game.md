# Game core — fix flags (`web/src/engine/game.js`)

Flags of the standalone game's own code (menu actions, message handling, invoice). Default ("original") mode is proven
equal to the 1:1 port by `tools/equiv_game.mjs`; the fixed paths are asserted by `tools/fixes_test.mjs`.

| flag | original behaviour | fixed behaviour | gameplay effect |
|---|---|---|---|
| `clearAllMessages` (@669b) | Acknowledge > Clr: the lamp-label drawer clobbers the loop counter (CL = 3), so the scan stops 2 queues after the last cleared one (W cleared → E/R survive) or runs past the 5 counts into queue buffer 0 and writes 0 through garbage widget pointers (memory corruption) | all five queues and lamps are cleared, nothing else is touched | Clear really clears every officer's messages |
| `bountyReset` (core quirk 1) | @5840 adds this mission's bounties to `bountySum` 0x131e, which nothing resets: after "Replay / Same crew" (and on a second `invoice()` call) the Bounties line includes earlier missions | `bountySum` starts from 0 on every invoice | pay shows this mission's bounties only |
| `examClearOnConfirm` (scanning quirk 10, @20eb) | scanner dead, reduced menu: pressing E empties the exam list at once, before a target is chosen (backing out leaves it empty) | `clearExamList()` does nothing; the new command `examineOnly(target)` (flash, empty the list, list the target) does it on confirm | backing out of the reduced Examine keeps the list |
| `ordersClearFreeze` (B9, `fireOnly`) | reduced-menu Fire @132d: `while (count) dropOrder(serial 0)` hangs if no queued order has serial 0 (the engine emits `freeze` and breaks) | drops the first queued order until empty | no freeze (flag shared with `damage.js`) |

Not applicable to the standalone `Game` (it builds every mission from the data image): "Replay / Same crew" carrying the
RNG, nav variables (`model/navigation.md` quirk 8), 0x17d8 marker parity; Quit never exiting; demo autopilot. Presentation
quirks (combat-view speed driven by text output, the shared 0x3b04 latch, bounty row labels from table 0x6126) belong
to the UI.
