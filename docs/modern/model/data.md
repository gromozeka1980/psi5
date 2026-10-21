# Data, assets and presentation layer

Covers the game's files, the data tables inside PSI5.EXE/SEL.EXE, the graphics/text/sound routines, the screen
layout and the RNG. Game rules that *use* the numbers are documented by the department documents. Here a field is
named by what the code does with it.

The extracted assets are in `docs/modern/assets/`. Regenerate them with `node tools/extract_assets.mjs`:
- `psi5/*.png`, `sel/*.png`, `crew/*.png`: every picture, sprite, face, animation frame and the font. Palette indices
  map to CGA colours. 3D-view sprites are saved with colour 0 transparent, because the game ORs them into the view.
- `index.json`: one entry per PNG (source file or DS, address, header w/h/ox/oy/x/y, what it is, aliases when the
  same sprite is listed twice), plus the station-animation tracks and the face-animation tracks of each crew file.
- `text.json`: all text. That is the PSI5/SEL string scan with code refs, the decoded drawing scripts, the 30 SEL
  candidates with their resumes, each mission's names and numbers, and each crew file's messages with the code that
  queues them.
- `tunes.json`: every tune decoded to notes with Hz, MIDI note and ticks, plus where the game plays it.

Addresses: `0x....` = PSI5 DS offset unless noted. `SEL:0x....` = SEL DS offset. "file+0x.." = byte offset in a file.
Function `@xxxx` = `f_xxxx` in `web/src/psi5/*.js`. SEL functions are listed by their `@xxxx` in `web/src/sel.js`.

---

## 1. Files

| file | size | read by | to | what |
|---|---|---|---|---|
| `SELECT.BIN` | 100 (file has 104) | SEL @125e, PSI5 @6b7c | SEL:0xe7c9, 0x34a8 | hand-off SEL → PSI5 |
| `MISNA/1/2/3.BIN` | 0x336 | @6b7c | 0x616e | course data (course 0..3 = A,1,2,3) |
| crew `*.BIN` (31) | 3352..4885, read 0x1324 | @6b7c | 0x8b0c / 0x9e5a / 0xb1aa / 0xc524 / 0xd87c | one crew member per department |
| `DASH.BIN` | 0x2086 | @6b4c | 0x8b0c | dashboard picture, drawn once and then overwritten by the crew files |

The load order is in main @0082: `f_6b4c` (DASH load+draw) → … → `f_6b7c` (SELECT.BIN, then the 6 files it names).
The tables at 0x346e/0x347a/0x3486 hold 6 file-name pointers into the SELECT image, the read sizes (0x336, 5×0x1324)
and the load addresses. A DOS error makes the game unwind (@6b76). The port treats that as fatal.

### SELECT.BIN (100 bytes)
| off | size | meaning |
|---|---|---|
| 0x00 | 16 | mission file name, NUL-terminated (`MISN2.BIN`) |
| 0x10, 0x20, 0x30, 0x40, 0x50 | 16 each | crew file of dept 0..4 (Weapons, Scanning, Navigator, Engineer, Repair) |
| 0x60 | word | demo mode (SEL ^D or idle timeout). PSI5 0x3508 skips the briefing and plays the demo key script |
| 0x62 | byte | sound on (^Q off / ^S on, in both programs). PSI5 0x350a |
| 0x63 | byte | joystick on (^J on / ^K off). PSI5 0x350b |

- SEL builds the names in @1204 with strcpy: name table SEL:0xe79a[course] / SEL:0xe6ae[candidate], plus `.BIN`
  from SEL:0xe7ba. Bytes after each NUL keep whatever was there before, which is why the shipped file contains
  `BORIS.BIN\0N\0`.
- PSI5 writes the 100 bytes back (@6bc7) only on Quit → Restart → **N**ew crew. That keeps the sound and joystick
  toggles for the next SEL run.
- File names are only 16 bytes. The snapshot holds the default `MISN1/BORIS/JARU/KLG/CRAVEN/ANXY`.

### Mission file (0x336 bytes → 0x616e). Values per course: `text.json` → `missions`
| file off | DS | type | meaning / user |
|---|---|---|---|
| 0x000..0x0ba | 0x616e.. | 22 strings | 11 ship-class names plural + 11 singular (index = contact type 0..10). Read through the fixed pointer table **0x6124[22]**, so every mission file must keep the same string offsets (names are space-padded to fixed widths). Type 0 = "Unknown", 10 = "Other". The names change per course: MISN1 has Xantogs/Zeltoads/Kiffboks…, MISNA has Frisinas/Snograts/Shuttles, MISN3 has Chianx/Trantot… |
| 0x0bb | 0x6229 | word | alarm duration: 0x12fe reload while nothing is damaged (@4922) |
| 0x0bd | 0x622b | word | start position on the route (0xb7a, 50 = arrived) (@5247). The courses start at 40/30/15/0 → 10/20/35/50 steps |
| 0x0bf | 0x622d | word | scheduled travel time: early bonus (@5840), ETA (@2cf2). Arriving more than 60 late = "took too long" game over (@4922) |
| 0x0c1 | 0x622f | word | intruder chance threshold, random byte < value (@671c, when nav state 0xb64 ≠ 1) |
| 0x0c3 | 0x6231 | word[4] | hit strength, picked randomly against shield energy (@4922) |
| 0x0cb | 0x6239 | word[4] | cargo loss per hit, random pick → f_32a3 (@4922) |
| 0x0d3 | 0x6241 | word | position after which special hits / crew losses can happen (@4922) |
| 0x0d5 | – | word | 0x00d7 = offset of the destination name. Unused (the code uses the fixed pointer 0x4ce6) |
| 0x0d7 | 0x6245 | string[9] | destination name (`Kozzar-7`). Shown on arrival (@3318 via 0x4ce6) |
| 0x0e0 / 0x0e2 | 0x624e / 0x6250 | word | hit thresholds when the system is ok / already damaged (@4922) |
| 0x0e4 | 0x6252 | word[10] | per contact type: how many route steps a contact stays relevant (@243d, @16f3) |
| 0x0f8 | 0x6266 | word[17] | identified type → report column (@16f3) |
| 0x11a | 0x6288 | word[5] | per route: extra length / ETA base (@2cf2) |
| 0x124 | 0x6292 | word | steps after spawn before a type-1..7 contact turns hostile (@243d) |
| 0x126 | 0x6294 | word[8] | bounty per type (indices 1..7 used) (@5840) |
| 0x136..0x140 | 0x62a4..0x62ae | 6 words | pay: casualty cost per dead crew member, lost-ally cost factor, early-bonus base, early bonus per minute, cargo cost, cargo value per % (@5840) |
| 0x142 | 0x62b0 | 5 × word[50] | **route spawn masks**: route r, position p → 16-bit mask (pointers 0x6150[5]). @243d tests slot a = 0..15 in turn: `mask & 0x98a[a]`. If set, it spawns contact type `0x9aa[a]`. @2cf2 counts the set bits ahead (`f_5b3a`) as the route threat estimate |

Spawn slot tables (PSI5 DS, not mission data): `0x98a = 1,2,4,…,0x80, 0x200,…,0x8000, 0` (bit 8, 0x100, is
skipped and slot 15 never fires) and `0x9aa` types `2 9 3 6 1 8 5 4 3 5 7 2 1 4 0 0`. Bit 15 (slot 14) spawns type
0, which is an empty slot (see Quirks).

### Crew files (one layout per department; 0x1324 bytes read)
Header size = file+0 (the first string offset): Weapons and Scanning 0x54, Navigator 0xa6, Engineer 0x64,
Repair 0xa4. All offsets are relative to the file start, which is the load base `0x326c[dept]`.

| file off | content |
|---|---|
| 0x00 .. 2n-2 | word[n]: string offsets, n = 18 (W), 27 (S), 22 (N), 20 (E), 14 (R). String 0 = signature line (`"          Boris, Weapons"`). Strings 1..n-1 = messages. CR (0x0d) = new line at x 0, so continuation lines start with a space |
| 2n .. hdr-5 | **personality parameters** (words; table below) |
| hdr-4 | word: offset of the face picture (RLE, f_70e2). Pointer slots 0x32e8[dept] |
| hdr-2 | word: offset of the face-animation table (pointer slots 0x32f2[dept]) |
| hdr .. | strings, then the face-animation table, its tracks, the animation sprites and the RLE face |

Face-animation table: `{mask, trackOffset}` pairs ending in mask 0. Track: `{spriteOffset, frames}` pairs ending in
sprite 0. Mask bits: 1 = calm, 2 = stressed (dept stress flag 0x4cf2[dept] ≠ 0), 4 = only while talking (0x3454
countdown). Usually several tracks: idle-calm, idle-stressed, mouth (mask 7 or 5/6).

The personality parameters are the crew-dependent part of the simulation. One pattern repeats in every department:
stress triggers (thresholds) plus a stress duration set the stress flag `0x4cf2+dept*2`. Value pairs or tables then
come in a normal and a stressed variant. When a crew member dies (@4922 crew-loss actions) some of these are
overwritten with poor defaults (Weapons: hit 0x20 / time 7. Scanning 0x14/0x21. Navigator 0x1e/-0x1e. Engineer: 13
words = 0x14).

| dept (base) | file off | DS | meaning (user) |
|---|---|---|---|
| W 0x8b0c | 0x24 / 0x2c | 0x8b30 / 0x8b38 | word[4] per weapon: hit-roll threshold, normal / stressed (@6242; ×4 against the target's weak weapon; hit if random > value) |
| | 0x34 / 0x3c | 0x8b40 / 0x8b48 | word[4] per weapon: shot time, normal / stressed (@5d20) |
| | 0x44, 0x46, 0x48 | 0x8b50.. | stress duration; stress if contacts spawned 0x9d2 > value, or firing queue 0x506 > value (@16f3) |
| | 0x4a, 0x4e | 0x8b56[2], 0x8b5a | auto-fire delay normal/stressed; auto-fire parameter passed to f_14f3 (@16f3) |
| S 0x9e5a | 0x36/0x3a/0x3e/0x42 | 0x9e90.. | word[2] each (normal/stressed): thresholds for detect / identify type / identify damage / identify weak weapon (@243d) |
| | 0x46, 0x48, 0x4a, 0x4c | 0x9ea0.. | stress duration; stress if spawned ≥ / list length ≥; word[2] → 0x9de (@243d) |
| N 0xb1aa | 0x2c | 0xb1d6 | life-support countdown (crew survives this long with 0xeec off) (@4922) |
| | 0x2e, 0x30, 0x32 | 0xb1d8.. | route-change progress limits (signed); stress duration (@2cf2) |
| | 0x34 / 0x46 | 0xb1de / 0xb1f0 | word[9] per speed: engine power, normal / stressed (@2cf2) |
| | 0x58, 0x5a | 0xb202, 0xb204[2] | threat-scan look-ahead; scan period normal/stressed (@2cf2) |
| | 0x5e | 0xb208 | intruder threshold while nav state = 1 (@671c) |
| | 0x60 | 0xb20a | word[32] heading-icon sequence during evasive manoeuvres (index into 0x4742) (@2cf2) |
| | 0xa0 | 0xb24a | threat threshold for the "dangerous route" message (@2cf2) |
| E 0xc524 | 0x28 | 0xc54c | life-support countdown (0xeea) (@4922) |
| | 0x2a, 0x2c, 0x2e | 0xc54e.. | stress duration; stress if active devices > / power over budget > (@37be) |
| | 0x30 / 0x48 | 0xc554 / 0xc56c | word[12] per device, normal / stressed → 0xf92 (@37be) |
| R 0xd87c | 0x1c, 0x1e | 0xd898, 0xd89a | overload: open repair slots ≥ value → stressed for duration (@4479) |
| | 0x20 | 0xd89c[2] | droid recharge time normal/stressed (@4479, @48e0) |
| | 0x24, 0x26 | 0xd8a0, 0xd8a2 | auto-queue delay; droids to assign (@4479) |
| | 0x28 | 0xd8a4[8] | work per tick by number of droids (@4479) |
| | 0x38 / 0x6c | 0xd8b4 / 0xd8e8 | word[26] damage per hit per system (first table if 0xd1e[sys] set and not stressed) (@4922) |

SEL candidate ↔ file (SEL:0x14e names, SEL:0xe6ae files, SEL:0x18a hot keys, SEL:0x35dc portraits): candidates
0-5 Weapons (Boris, Q6-D, Yeela, Al, Skulard, Grolo), 6-11 Scanning (Jaru, Phyzo, Blustan, Nargo, Churglik, Mike),
12-17 Navigator (KLG-7A, Tegra, Nik, Bronxaag, Aymu, Yenx), 18-23 Engineer (Craven, Wilfo, Anthony, Fligronk, Sheema,
VX-4), 24-29 Repair (Anxy, T3XR9, Volfgank, Ryblo, Bru, Swiglitz). `BRUN.BIN` is an unused variant of `BRU.BIN`
(same text, different numbers).

### DASH.BIN
One picture in the f_70a4 format: 80 bytes × 104 lines at (0,0), so the top 104 lines of the screen
(`psi5/dashboard.png`).

### PSI5 DS memory map (snapshot `web/data/psi5_ds.bin`)
| range | content |
|---|---|
| 0x0000..0x1cff | game state mixed with menu/message strings and pointer tables (menus: item-pointer lists such as 0x38, 0x1354; hot-key strings such as `AWSNERQ`) |
| 0x1cec / 0x1d12 | fill bytes `00 55 aa ff` / text colour words `0000 5555 aaaa ffff` (colour 0..3) |
| 0x1d22..0x1eb1 | CGA row-start table, 200 words (`(y&1)*0x2000 + (y>>1)*80`) |
| 0x1eb2..0x2199 | 8×8 font, 93 glyphs (chars 0x20..0x7c) |
| 0x219a..0x2399 | 1bpp→2bpp expansion table (256 words, each bit → `11`) |
| 0x239a..0x2fff | drawing scripts (briefing, pause, invoice, 10 panel headers, 0x2765[] table) and f_0b7c panel row tables (0x2711, 0x273b, 0x27eb …) |
| 0x2f70..0x3203 | weapon sound ids, 3D spawn/velocity/clamp tables, sprite lists 0x3038/0x3040/0x3050 (+ depth lists 0x3064..0x3203) |
| 0x3208..0x3467 | message queues, indicator records, head/animation tables, `R.I.P.` |
| 0x346e..0x350b | file tables, `DASH.BIN`, `SELECT.BIN`, SELECT image 0x34a8 (flags 0x3508/0x350a/0x350b) |
| 0x350c..0x3533 | ISR/tune player state |
| 0x3534..0x35db | note → PIT divisor table (84 words) |
| 0x35dc..0x3add | tune table (18 used + 1 bogus entry) and tune data |
| 0x3ade..0x471f | view-label table, starfield state, star buffer 0x3b90 (64×38 bytes), buffer row table 0x455e, RNG index 0x461a + state 0x461c[256] |
| 0x4740..0x4ce7 | dashboard lamp/gauge/heading pictures and their tables (0x4742, 0x4915, 0x49e7, 0x4a0b, 0x4a2d, 0x4bed) |
| 0x4ce8..0x4df7 | dept alive 0x4ce8[5], stress 0x4cf2[5], 3D object slots |
| 0x4df8..0x616d | sprites (far depths, station animations), joystick state 0x60f6.., mission pointer tables 0x6124/0x6150, report function tables 0x615a/0x6164 |
| 0x616e..0x64a3 | mission file |
| 0x64a4..0x8989 | ship/shot/explosion sprites, head labels 0x7db0..0x7fcc, view labels 0x8038/0x80a4/0x8110, arrival picture 0x817e |
| 0x898a..0x8b0b | demo key script (0 = Home, 1 = restart at 0x8a56, 2 n = wait n, else the key; one entry per 60 ticks) |
| 0x8b0c..0xeb9f | 5 crew files (0x134e apart; DASH.BIN briefly at 0x8b0c) |
| top | stack (main BP 0xffc8) |

---

## 2. Graphics

### Screen and palette
- CGA mode 4, 320×200, 2 bits per pixel, 4 px per byte, msb first. Even lines at B800:0000, odd lines at B800:2000,
  80 bytes per line. Every routine finds lines through the row table (0x1d22 PSI5, SEL:0x344a). x is usually in
  **bytes** (4 px).
- Palette 1, low intensity: **0 black, 1 cyan, 2 magenta, 3 light grey**. Both programs end up with INT 10h AH=0Bh
  BL=0x20 (@5bed / SEL @0dd7), which sets the background to black and clears the intensity bit. This matches the
  DOSBox screenshots.
- Background flash: `f_5bed(0x2f)` sets a white background on an intruder (@671c). It lasts 5 display updates
  (0x3b02, @6e26 restores 0x20). `f_5b97` (longjmp) also restores 0x20.

### Picture format (all sprites and pictures, PSI5 and SEL)
`word w (bytes), word h (lines), word ox, word oy, word x, word y, then w*h bytes of packed 2bpp`. Four routines blit it.
- **f_70a4** (PSI5) and **SEL @0efe/@0f1f**: opaque copy at x = `hdr.x >> 2` bytes and line `hdr.y`, so header x is in
  pixels. SEL @0efe first stores the given position into the header. SEL @0f48 draws at the stored position with x
  already in bytes (resume decorations).
- **f_7145** (face/station animation frames): opaque copy at byte `hdr.x + 0x18`, line `hdr.y - 0x43`. The header
  coordinates are in a different (original-platform?) frame. Face window = byte 0x2e, line 8.
- **f_63c5** (3D view): ORs the sprite into the off-screen star buffer at pixel x (`hdr.x`, shifted by x&3) and
  line `hdr.y`. f_631e first writes the projected position into the header (+8/+10), so sprite headers are scratch
  at run time. `ox/oy` = sprite centre, subtracted from the projected point. Width 0 would loop 65536 times.
- **f_70e2** (crew face, RLE): fixed 32 bytes × 64 lines at byte 0x2e, line 8. Escape byte = `p[6]`, data from
  `p+0x14`. Any other byte is literal. `esc, value, count` = run of count bytes (count 0 = 256). Runs continue across
  lines. Other header words seen: `ff 49 06 esc 20 40 0 0 0b 4b` (w=0x20, h=0x40 not used by the decoder).

Fill: **f_5b0a** / SEL @0fad fills rect x (bytes), y, w (bytes), h with the fill byte of colour k (0x1cec[k]).

### Text
- Font: 8×8, 1bpp, glyph 0 = char 0x20. PSI5 has 93 glyphs at 0x1eb2. SEL has the same glyph data at SEL:0x3cfc.
  Custom glyphs: `` ` `` = centred vertical bar (column separator), `{` = solid block (menu selection marker),
  `|` = left bar, and `[ \ ] ^ _ @` are icons (see `psi5/font.png`).
- **f_5bf8** (SEL @0e31) draws the NUL-terminated string [0x1d06] at x [0x1d02] (bytes) and y [0x1d04]. Each glyph
  row is expanded through 0x219a and drawn as `(~mask & bgWord) | (mask & fgWord)` (colour words 0x1d12[fg/bg]),
  2 bytes = 8 px per char, so 40 columns. CR sets x = 0, y += 8. Other control chars are skipped. In PSI5 every space
  and CR also calls **f_6e26**, the display update, so long texts keep the starfield running. The text position stays
  in the globals, so consecutive calls continue the line.
- **f_5ca3**: text record `x, y, fg, bg (bytes), string` (indicator letters).
- **f_5ccb**: menu bar from a pointer list [0x1d1a]. Each item is preceded by a marker: selected item = marker
  0x1d1e (`{`) in colours 1/0, others = marker 0x1d20 (space) in 0/1. The bar is drawn inverted, with the selection
  as a highlight.
- **Drawing scripts** (f_09b7, SEL @0b05): byte opcodes `0` end, `1 text\0`, `2 x y`, `3 x`, `4 fg bg`,
  `5 x y w h` (fill with bg), `6` newline. f_0988 first clears the department area (y 0x78, 80×80 bytes) and starts
  at y 0x78 in colours 3/0. Decoded scripts: `text.json` → `psi5.scripts` / `sel.scripts`.
- **Panel rows** (f_0b7c, reports): table of 10-byte entries `{type, x, y (0 = keep), data, values}` ending in
  type 0. Each entry caches its last value in row record `0x166 + row*0x14` (17 rows × 10 words, 0x8000 = empty) and
  is redrawn only when the value changes. Types: 1 `data[val]`, 4 `data[row]`, 12 `data[0]` once, 2 `data[values[val]]`,
  3 `nnn`, 5 `n0.n`, 6 `n.n`, 7 `nn`, 8 `±nn` (blank if `*data==0`), 9 `nnn` (0 → `  -`), 10 `nn` (blank if `*data==0`),
  11 `n`. Number text comes from **f_6b0c** (3 digits at 0x346a, leading zeros as spaces) and @69ee..@6af1.

### Screen layout (PSI5; x in px unless noted)
| area | position | content / routine |
|---|---|---|
| dashboard | lines 0..103 | DASH.BIN, drawn once (@6b4c) |
| view window | x 8..135, y 8..71 (bytes 2..33) | starfield and combat view from the off-screen buffer 0x3b90 (64 lines × 38 bytes, 32 shown), copied every display update (@705e). Centre texts at (7,0x20)/(9,0x28) bytes (f_51d8/f_5219: "Prepare for departure", alarms, game over). Arrival picture 128×64 (@3318) |
| view label | (40,73) 64×6 | 0x3ade[0x3afe]: fore / aft / blank (report screens), @6e26 |
| head window | x 184..311, y 8..71 (bytes 0x2e..0x4d) | crew face (RLE) + station animation + face animation. `R.I.P.` at (0x38,0x28) bytes when the dept is dead. Blank when no dept |
| head label | (216,73) 64×6 | 0x32d4[dept] or 0x7fcc (none) |
| scanner lamps | (16/24/32/40, 91) 8×7 each | 0x4a2d[lamp*4+state] (@16f3) |
| shield lamps | around (72..87, 86..103) | 0x4bed[shield*4+state] (@4922) |
| shield-battery lamp | (76,91) | 0x49e7[s] (@37be) |
| gauges | x 112.., y 97 (level, 6 segments) / y 90 (power drawn, 8 segments) | 0x48e0/0x4904 lit, 0x48f2 unlit; each segment moves x by 4 (@37be) |
| emergency battery | (136,97) 32×7 | 0x4915[s] (@37be) |
| nav alarm lamp | (156,92) | 0x4a0b[on] (@243d) |
| heading icon | (176,89) 16×8 | 0x4742[n] (@32f2): 0 level, 1 left, 2 right, 3 up, 4 down, 5-8 diagonals |
| speed label | bytes (0x36, 0x5b) colour 2 | 0x190c[speed]: ` STOP`,`Spd=1..7`,` FULL`,`ORBIT`,` DOCK` (@32bf, script 0x18c2) |
| message lamps | bytes 0x43,0x45,0x47,0x49,0x4b at y 0x5b | letters W S N E R (records 0x3292.., f_5ca3). Colour 2 while that dept has queued messages, 0 (invisible) when empty. Beep tune 0x16 on change (@66c0) |
| message line | y 0x68 (104) | prompts / echo (f_0693 clears, f_06bf appends at x [0x164]) |
| menu bar | y 0x70 (112) | f_0672 / f_5ccb |
| department area | y 0x78..0xc7 (120..199), full width | report panels (scripts + f_0b7c rows), messages, pause screen, invoice |

Message display (@657f) in the department area: clear, `Captain` at (2,0x88) bytes, the message at (2,0x90), then
the sender's signature (string 0) one line below the message at x 0x14. If that queue is now empty, `...OUT` follows
and the lamp goes off. If nothing is queued: `No messages pending` at (0x14,0x90) and the head goes blank.

SEL screens: title picture 320×198 (SEL:0x35da). Course screen = script SEL:0x3622 + 4 course lines (SEL:0x384d[]),
with the selected course blinking (colours swap on odd blink counter SEL:0x12). Department screen: 6 candidate boxes
at byte x 8/32/56, y 32/112, each holding a 64×48 portrait, name below, frame colour 3 (selected and blinking: 2).
Resume: portrait at (0x18,0x10), 19 text lines at SEL:0x1aa/0x1d2 positions, 5 frame decorations. Crew summary:
5 portraits + course text SEL:0x390d[course].

### Starfield and combat view (presentation side)
- The buffer is cleared each display update (all 1-bits for 4 updates after a view switch, which blanks it). 12
  stars, each drawn as one pixel of colour 3 (masks 0x3afa). Star step period per speed 0x3ae6 =
  `0,9,8,7,6,5,4,3,2,1` display updates. Fore view: stars fly outward from the centre (@6f2f: `x += (x-cx)>>3`, at
  least 1, respawn ±1..16 around the centre). Aft view: stars converge (@6fb3, respawn at the 4 edges 0x460a/0x4612
  or random).
- 3D objects (8 slots: ships 0..3, enemy shots 4..5, our shots 6..7) are drawn far to near by @631e.
  - Ships: sprite list `0x3050[type]`, then `[z>>3]` (16 depth sizes, the far ones shared).
  - Shots: `0x3038[kind]`, then `[z>>3]` (kinds 0..3 = missile, blaster, cannon, thermo). Enemy shots get a random
    kind.
  - Kind ≥ 4 = explosion, frame `0x3040[(kind-4)>>2]` (8 frames, not scaled).
  - Screen position: `x = (x.hi*2 | x.lo>>7) - ox`, `y = y.hi - oy`. Culled when off the 128×64 buffer.

### Head (crew face) animation (@6896 setup, @67aa step)
- Selecting a department (f_6868 → @6896) draws the head label, then the RLE face, then sets up up to 16 tracks: the
  department's station-animation tracks from 0x32de[dept] (PSI5 sprites, mask 3), followed by the crew file's
  face-animation tracks (crew sprites, base = file).
- @67aa runs every 4th display update (divider 0x3456, so about 10 Hz). Mood: dl = 1 calm or 2 stressed, dh = 4
  while talking (0x3454 = 50 after a message is shown, counted down here). A track whose mask doesn't match is reset
  to its start. When its countdown next expires it draws its **first frame once** (the rest pose), then stays parked.
  A matching track plays `{sprite, frames}` steps in a loop. A 0-frame step chains straight to the next sprite in the
  same update.
- 0x1caa/0x1cac/0x1cae (debug menu, never reached) can override the mood.

---

## 3. Sound

- PIT channel 0 is reprogrammed to divisor 0x26d4 → **120.0 Hz** ISR (@6c10. SEL @0c26 does the same). The ISR (@6ca9,
  SEL @0ca9) drives counters and the one-voice PC-speaker tune player. The display update runs from the main loop
  when ≥ 3 ticks have passed (≤ 40 Hz).
- Tune = `tempo` byte, then `{duration, note}` byte pairs, ending at duration 0. One step = tempo+1 ticks. A note lasts
  `duration` steps. The speaker is switched off once `(duration-1)>>3` steps remain (articulation gap). Note 0 =
  rest. Otherwise the speaker plays 1193182 / `0x3534[note]` Hz (84-entry table, identical in SEL at 0x3220). Note
  n ≈ MIDI n+14 (n=1 ≈ 19.5 Hz).
- Start: `f_6db1(id)` starts immediately and interrupts (voyage start, arrival, game over). `f_6d79/f_6dac/f_6de0/f_6e13`
  start only if sound is on and nothing is playing (same body). id = byte offset into the tune table 0x35dc
  (SEL:0xa3a6). Sound off (0x350a = 0) silences at the next step.
- PSI5 tunes (`tunes.json`): 0x00/02/04/06/08 department jingle on selecting W/S/N/E/R (0x0c if that crew member is
  dead) · 0x0a voyage start (19.6 s) · 0x0c alarm / game over · 0x0e arrival · 0x10 head switches to a new talker ·
  0x12 / 0x14 speed rising / falling (chromatic runs) · 0x16 message-lamp beep · 0x18 intruder · 0x1a/1c/1e/20
  missile/blaster/cannon/thermo fired (0x2f70[weapon]) · 0x22 enemy destroyed (same notes as 0x18). Entry 0x24 is not
  a tune: it points at 0x3add, the bytes just before the view-label table.
- SEL tunes: 0 title music (27 s), 2 selection screens (the table entry 4 is the same tune).

---

## 4. Text: where it comes from (all in `text.json`)
| source | content | drawn by |
|---|---|---|
| crew files | all crew dialogue: 96 messages + 5 signature lines per crew (one member per department) | message queue (§5) → @657f |
| mission files | ship-class names (scanner/weapons reports), destination name (arrival) | f_0b7c tables via 0x6124 / 0x613a, @3318 |
| PSI5 DS 0x0010..0x1cde | menu items + hot-key strings, prompts (`Rank firing order`, `to level` …), report words (`missiles`, `need lock`, `in-range` …), system names (`Fore Shield` … `Cravenlator`, 26 systems at 0xd50), course descriptions (`A Shortest Path` …), status texts (`INTRUDER ALERT`, `Mission Aborted`, `took too long` …), crew-report menu (`Normal/Calm/Stress/Talk/Quiet`, debug menu) | menus f_0672, f_06bf, f_51d8/f_5219, f_0b7c |
| PSI5 DS 0x239a..0x2f00 | drawing scripts: press-button prompt, Admiral Lorenzen briefing, pause screen, Mission Invoice, 10 panel headers (`WEAPONS FIRING SUMMARY REPORT` …) | f_0988 / f_09b7 |
| PSI5 DS 0x32b0.. | `No messages pending`, `Captain`, `...OUT`, `R.I.P.` | @657f, @6896 |
| SEL DS | course briefing, 4 course lines, department titles, candidate names, 30 × 19 resume lines, `Welcome to the crew` / `Exit`, `Accept final crew` / `Reselect crew` | SEL scripts @0b05, @0e31 |

`text.json` → `psi5.strings[]` lists each NUL-terminated string in the text regions with `codeRefs` (functions in
`re/psi5.lst` that use the address as an operand), `ptrSlots` (DS words holding the address) and `ptrUsers`
(functions referencing the start of the pointer table that holds such a word). These references are found
heuristically. Strings below 0x100 get no direct code refs, because small constants are everywhere in the code.

## 5. Message ids and queues (presentation part)
- id = `dept*2 << 8 | msgIndex*2`: hi byte = byte offset into the per-department arrays, lo byte = byte offset into
  the crew file's string table. Bit 15 set = ignored (system tables use 0xffff for "no message").
- `f_64be(id)` queues: 5 queues of 8 at 0x321c+16*d, no duplicates. On the first entry the lamp goes on with a beep.
  `f_6526(id)` removes the id, and the lamp goes off when the queue empties. @657f shows and pops the oldest entry: of one department
  (Ack. menu W/S/N/E/R → f_656b, @033e) or of the fullest queue (`?` in any menu → f_6579, @0786). @66dc (run in
  sim-step slot 0, i.e. every 6th step) auto-shows the fullest queue when "Auto Answer" (0x2f8) is on, then waits 5
  more calls.
- Who queues which id: `text.json` → `crew.<NAME>.messages[].usedBy`. Literal ids come from the code. The
  table-driven ones are 0x11de/0x1212/0x1246[26] (system damaged/disabled/destroyed → message of the responsible
  department), 0x12e8/0x12f2[5] (alarm start/end) and 0x1bde[10] (special hits / crew losses).

## 6. RNG (@7086)
- State: 256 bytes at 0x461c (initial values from the EXE) and a word index 0x461a (starts at 0).
- Each call: `idx--`, `b = state[idx & 0xff]`, `b = (b << 1 | (b < 0x80 ? 1 : 0)) & 0xff`, store, return b (0..255,
  AH = 0).
- Each byte is a Johnson (twisted-ring) counter: 8 steps complement it and 16 steps restore it. The whole output
  sequence therefore repeats exactly every **4096 calls**, and each 256-call block is the previous block with every
  byte stepped once. Run-to-run variation only comes from how many calls happen. `f_5af1` (wait for key) calls the
  RNG while waiting, so key-press timing acts as the seed.
- The engine must keep this generator and its call order (PLAN step 2). Callers mask with `&3`, `&7`, `&0xf`, `&0x3f`
  etc. or compare signed against thresholds.

## 7. Timing (presentation)
- 120 Hz ISR: 0x351e/0x351a tick counters, 0x351c (delay loops), 0x3510 (demo key pacing, 60 ticks), 0x3518 (sim
  steps, every 20 ticks = 6 Hz), tune player. Paused (0x352d) = counters frozen, speaker off.
- Display update **f_6e26**: when ≥ 3 ticks have passed since the last one, called from the sim step (f_0d97 → f_0b7c
  end), from every drawing-script opcode and from spaces/CRs in text. Order:
  1. border-flash countdown
  2. clear the buffer
  3. view-label switch
  4. star step
  5. 3D object logic (f_5d20 fire, f_5e08 spawn, f_5eba AI, f_6006 steer, f_60b4 move, f_6242 hits)
  6. f_671c intruder
  7. plot stars and objects
  8. copy to screen
  9. f_67aa head animation

## Interactions
- **The combat simulation runs inside the display update** (step 5 above), not in the 6 Hz department steps. So its
  speed is tied to how often f_6e26 gets polled, at most 40 Hz. The engine has to make this an explicit fixed tick.
  The RNG calls made there (spawn positions, AI, hit rolls, stars) are interleaved with the department steps' RNG
  calls.
- Crew files are both data (personality) and assets (text, face). Mission files are both data and text (names).
- The stress flags 0x4cf2[5] (set by the departments) select both the parameter variant and the face mood.

## Quirks & bugs
1. Ship types 10/11 in 0x3050 point at sprites (0x7264, 0x72b8, the missile shot) instead of depth lists. Their
   bytes would be read as sprite pointers. They never spawn (0x9aa only holds types 0..9).
2. Spawn table 0x98a skips bit 8 (0x100), so mission mask bit 8 never spawns anything, and slot 15 is never tested.
   Slot 14 (bit 15) spawns type 0, which counts as a spawn but leaves an empty slot (@243d).
3. JARU.BIN's face-animation table is not 0-terminated. It runs into its first track, giving 2 extra tracks (mask
   0x0c90, tracks into the string table). They are inert, because the mask never matches and their cursor starts
   parked.
4. Tune id 0x24 (19th table entry) points at non-tune bytes (notes 128/129 index past the 84-entry divisor table). It
   is never played.
5. Engineer death writes 13 words of 0x14 from 0xc554 (@4922), one past the 12-word normal table, into stressed[0].
6. SELECT.BIN keeps stale bytes after each name's NUL (strcpy into an uncleared buffer). Harmless.
7. Mission+0x0d5 holds the destination-name offset, but the code uses the hard-wired pointer 0x4ce6. Mission strings
   must stay at fixed offsets.
8. `f_669b` clear-all-lamps loop: the text drawer clobbers CX, so it covers 3 slots or runs past 5 (README).
9. Display and combat speed depend on how often the game polls f_6e26. Long text output keeps the view animating,
   while a stall freezes it.
10. Sprite headers double as scratch space for the projected position (f_631e) and SEL portrait position (@0efe).

## Open questions
- f_7145 frame offsets (`x+0x18` bytes, `y-0x43` lines): leftover coordinates from the original (Apple II/C64?)
  layout? Harmless, but the remake should store frames head-relative.
- Exact meaning of the RLE face header words other than the escape byte (`ff, 49, 06, …, 0b, 4b`). They are unused.
- Some personality and mission parameters are named only by their use site here (e.g. Engineer 0xc554 per-device
  values, mission 0x6266 type columns, 0x6288 route values). The department documents should give their game
  meaning.
- `text.json` reference fields are heuristic (table walk-back, ≥ 0x100 for direct refs). A few strings show no user:
  `broken/no power/need lock/out-range/in-range` (0x562..), course descriptions (0xa86..), `standard/evasive/…`
  (0xbe8..), engineering classes (0xc58..). They are reached through f_0b7c `data` tables whose bases are not code
  operands.
- BRUN.BIN: unused alternate Bru, or a leftover from a different version?
