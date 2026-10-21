# Psi 5 remake: style tests (phase 1)

Sheet: `remake_art/style_sheet.png`. Each row starts with the original 1986 picture, followed by styles a, b and c.
Images: `remake_art/out/<job>/1.png`. Prompts: `remake_art/jobs.json`. Spend: `remake_art/spend.json`.

## Model
`gpt-image-2.5-sunburst`, medium quality, with the original sprite as the image reference (`/images/edits`).
I made one low-quality Boris test on each of `gpt-image-2`, `gpt-image-2.5-flare` and `gpt-image-2.5-sunburst`
(`out/modeltest-*`). All three cost the same and all kept Boris faithful. Sunburst has the most painted
airbrush-and-grain texture. Flare is cleaner and more digital. gpt-image-2 is the flattest.

Cost: **$0.60 for 15 calls** (3 model tests and 12 style images). The API reports real token usage, which is logged.
These models have no known price, so the tool charges them at twice gpt-image-1 list prices ($10/$20/$80 per 1M
text-in, image-in and out tokens), which makes $0.60 a pessimistic estimate. At medium quality one image used about
350 output tokens (landscape) or 400 (square), about $0.04-0.05 each by that estimate.

## Slots tested (docs/remake/ART_SLOTS.json)
ART_SLOTS has no full bridge background, so the landscape test is **`bg.title`**, the 16:9 key art: the PSI-5
freighter leaves Starbase 27, with pirates in the distance. Its reference is `psi5/arrival.png`.

| row | slot | original used as ref |
|---|---|---|
| boris | `portrait.boris` (512², bust at his station) | `crew/BORIS_face.png` |
| aymu | `portrait.aymu` | `crew/AYMU_face.png` |
| pirate | `ship.class4` (512x256, transparent, front 3/4) | `psi5/ship_t4_0x6ad4.png` |
| title | `bg.title` (1920x1080) | `psi5/arrival.png` |

Ships are generated on plain black. The final `ship.*` slots need alpha. That means a cut-out step or the API's
transparent background, which I haven't tested yet.

## Styles (full text in `jobs.json` -> `styles`)
- **a, box art:** airbrushed acrylic, warm amber key light and orange rim light, deep blue space with teal shadows,
  chrome, CRT bloom, film grain.
- **b, CGA echo:** airbrush in the original cyan, magenta and silver palette, neon CRT glow, star-burst chrome,
  amber rim light only on faces.
- **c, used future:** brushwork on board, tungsten and amber light, scuffed panels, green and amber phosphor,
  heavy grain.

Prompt = subject description (species, hair, eyes, clothing colours from the sprite and resume) + slot tail +
`Style: …`. Every style says "no text".

## Results
- All three styles keep the identities: Boris has the cyan crest, staring eyes, teal jacket and magenta shirt. Aymu
  has the black mop of hair, magenta nose and dark uniform.
- **a:** the warmest and most "1984 box cover". It also matches the ART_SLOTS style line best (warm amber key light,
  deep blue space).
- **b:** the crispest and most saturated, and the closest to the original's colours. It has the most contrast at
  thumbnail size, but its teal look is a bit cold and uniform.
- **c:** the most atmospheric, but it is brown-green, muddier when small, and drifts from the Psi 5 palette.
- Aymu's magenta nose reads as a clown nose in every style. For the full run, I'd describe it as "a bulbous magenta
  alien snout" or soften it.
- The pirate prompt said "bat wings", but the t4 sprite is a disc-and-skirt shape. The model followed the sprite,
  which is right. For the full set, each ship prompt should be written from its own sprite.

## Recommendation
**Style a**, with b's colour accents: magenta and cyan for lights, screens and clothing, so the Psi 5 palette stays
recognisable. It matches the UI agent's slot style, and it stays readable on phones because the faces are well lit
against dark backgrounds. Second choice: b. Not recommended: c.
For the full set: `gpt-image-2.5-sunburst` at medium quality, about $0.05 per image (estimated).

## Full set (style a, chosen by the user)
- Every prompt comes from `remake_art/make_jobs.py`, which writes `jobs.json`: one job per ART_SLOTS slot, and the
  job id is the slot id. Each character, ship, shot and station prompt is written from its own 1986 sprite, and the
  sprite enlarged with hard pixel edges is sent as the image reference.
- Model: `gpt-image-2.5-sunburst`, medium quality. `bg.title` and `logo` use high quality.
- `portrait.<who>` (= `.calm`): generated from the selection portrait and the station picture, plus the resume.
- `.stressed`: an image edit of the picked calm portrait, which keeps the face consistent.
- `.dead`: made locally from calm (`remake_art.py dead`): greyscale, darker, static, scanlines and a memorial frame,
  with no API call.
- Transparent slots are painted on black and cut out locally (`cutout` in the tool). Ships, icons and the logo use a
  border flood fill plus a brightness halo. Shots and the explosion use brightness as alpha. The bezel also clears its
  centre window.
- `fx.explosion` is one painted burst, turned locally into 8 frames that grow and fade (like the original's 8
  frames).
- Rejected and redone after my review:
  - Tegra, Tony: the faces came out as pixel blocks.
  - `map.course.1`: a stray ship appeared in the picture.
  - `view.space.fore`: had a cockpit frame.
  - `view.space.aft`: the ship hull was visible.
  - `scene.aborted`: it wasn't the PSI-5.
  - `ui.invoice`: the paper sat on a desk instead of filling the frame.
- `pick` writes the lossless master `remake_art/picked/<id>.png` at the slot's size (opaque slots are cropped to the
  slot's aspect; transparent ones are cropped to their content and centred) and then exports it; `dead` does the same.
- `export [ids]` turns `remake_art/picked/*.png` into what the web UI loads: `web/remake/art/<id>.webp` (lossy WebP q80;
  transparent slots keep alpha, alpha q85) and, for portraits (320 px) and every slot ≥ 512 px wide (half size), a
  phone-size `<id>.s.webp`; `web/remake/art/manifest.json` = `{id: {w, h, s}}` (s = small width, 0 = none).
  `portrait.<who>.calm` is identical to `portrait.<who>` and is not exported. No PNG goes into `web/`.
  Size: 79.4 MB of PNG (162 files) -> 9.5 MB of WebP (132 full 6.9 MB + 122 small 2.5 MB).
- Contact sheets (`sheets`, read from `remake_art/picked/`): `remake_art/sheets/*.png`. Screenshots: `remake_art/screens/`.
