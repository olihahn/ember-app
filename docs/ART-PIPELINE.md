# The art pipeline

Every painted layer in `public/plates/terrace/` is generated, not hand-saved.
One script slices, keys, grades and recomposes five source images into the
twenty-four files the stage loads, and writes the manifest that places them.

```sh
node scripts/plates/build-plates.mjs     # ~5 s, deterministic, sharp + Node only
node scripts/plates/build-backdrop.mjs   # work-page backdrops, run after any change
node --import tsx --test tests/plates-manifest.test.ts
```

The build is reproducible: run it twice and the files are byte-identical. No
image service is involved, and no new art is generated. If you want to change
how the terrace looks, you change a mask, a threshold or a placement in
`scripts/plates/regions.mjs` and rebuild. The scene format itself is described
in [ARCHITECTURE.md](ARCHITECTURE.md).

## The palette

The whole look is five printed inks. They are the reference for every grade and
posterise pass, and the hexes below are the constants in
`scripts/plates/regions.mjs`. The stage's own background is a slightly
different cream, `#f2dba2`, set as `paper` in the manifest.

| Ink | Hex |
| --- | --- |
| Cream paper | `#f2dcaa` |
| Turquoise sea | `#3f8f97` |
| Ink | `#173e42` |
| Rust | `#b8492b` |
| Ochre | `#c99a4a` |

## Sources

> The source paintings themselves are **not published**. The artwork is
> reserved (see LICENSE), so this repository ships the derived plates in
> `public/plates/terrace/` that the app actually loads, not the originals.
> Everything below describes how those plates were produced; running
> `build-plates.mjs` needs the four files placed in `art/sources/`.

| Source | Used for |
| --- | --- |
| `art/sources/terrace-scene.png` (1024 × 1536, opaque) | sky, clouds, far-coast, sea, sea-flecks, near-coast, parapet, paving, boat |
| `art/sources/terrace-tree.png` (1024 × 1536, RGBA) | tree |
| `art/sources/terrace-chair.png` (1254 × 1254, RGBA) | chair, scaled, with a baked contact shadow |
| `art/sources/terrace-objects.png` (1254 × 1254, RGBA) | journal, record player, globe, magnifier (quadrants, rotated, trimmed) |
| `public/images/after-hours-poster.png` (1536 × 1024) | the reference print, and the ashtray with its cigar |
| SVG inside the script | the three gull frames |

## Method

1. **Regions.** Masks are polygons, ellipses and lines in
   `scripts/plates/regions.mjs`, authored against gridded overlays that the
   build can emit as debugging aids. They are rasterised from SVG and feathered
   with a 0.75 px blur, giving roughly a 1.5 px soft edge.
2. **Ownership.** Scene layers are ordered far to near. Each layer owns its
   region minus every nearer region, and minus holes such as the boat cut out of
   the sea and sky.
3. **Fills.** Each layer is then extended 64 px *under* the layers in front of
   it, by mirror-copying paint along the nearest boundary with a small
   deterministic jitter so the fill is not a flat smear. This is what lets the
   camera lean without revealing a gap. `reveal-check.png` proves it by shifting
   every layer by `120 / depth` pixels and looking for slivers.
4. **Sky.** The paper gradient is synthesised per row from the real sky pixels,
   with grain, and the real sky laid over it. Cloud streaks and the boat's mast
   are painted out of the sky so a drifting cloud layer never doubles them.
5. **Clouds.** Keyed by the red-minus-blue difference, because cream paper has a
   large gap there and the streaks do not, then un-blended against the
   synthesised paper so the drifting edges carry no halo. Both ends of the file
   fade to nothing and the build asserts they are transparent, or the layer
   would wrap its own right edge into the left of the screen.
6. **Sea flecks.** Bright sea pixels above a luminance threshold, sparse, with
   alpha by brightness. They duplicate strokes that remain in the sea layer, so
   the stage draws them as a shimmer rather than as the only strokes.
7. **Boat.** The sprite is keyed against the per-row sea colour so no water
   margin travels with it. A separate, generous, binarised hole paints the boat
   out of the sea below the horizon and the sky above it.
8. **Print passes.** Stone is flattened toward cream, mid-tones shaded toward
   the blue-ink shadow, painted shadows hardened and speckle thinned. The
   parapet reads its mottle through a horizontal window so blotches become short
   horizontal flecks. Props are posterised to the five inks with paper grain and
   slightly ragged edges.
9. **Colour grade.** The build measures flat patches of the reference poster and
   of the plates, then applies per-layer linear maps so sky, sea and stone land
   on the poster's measured means. Paving uses a two-point map with the shadow
   tone pinned, so lifting the lit stone does not wash out the shadows.
10. **Shadows.** Object shadows are baked as blue-ink ellipses, one family with
    a consistent light direction, either into a sprite's own file or as their own
    layers for the chair and the record player.

## What the build produces

Twenty-four files, about 10 MB. Layers may extend past the canvas so the lean
has paint to reveal; sprites must sit inside it.

| id | file | rect (x, y, w, h) | depth | kind |
| --- | --- | --- | --- | --- |
| sky | sky.png | −120, −60, 1264, 1656 | 40 | static |
| clouds | clouds.png | 93, 25, 931, 427 | 36 | drift |
| far-coast | far-coast.png | −120, 404, 761, 116 | 26 | static |
| sea | sea.png | 29, 398, 995, 460 | 18 | sea |
| sea-flecks | sea-flecks.png | 153, 462, 871, 330 | 17.6 | flecks |
| near-coast | near-coast.png | 0, 335, 507, 509 | 11 | static |
| parapet | parapet.png | 0, 745, 1024, 314 | 6.5 | static |
| paving | paving.png | −143, 882, 1184, 714 | 4.2 | static |
| chair-shadow | chair-shadow.png | 275, 1227, 411, 127 | 4.2 | static |
| records-shadow | records-shadow.png | 590, 1278, 362, 106 | 4.2 | static |
| chair | chair.png | 20, 1075, 529, 493 | 2.7 | static |
| tree | tree.png | −53, 184, 1081, 1412 | 1.55 | breeze |
| boat | boat.png | 690, 470, 68, 97 | 18 | boat |
| boat-2 | boat-2.png | 800, 470, 58, 90 | 18.5 | boat |
| gull | gull-up/level/down.png | 700, 250, 76, 36 | 20 | gull |
| ashtray | ashtray.png | 514, 1000, 194, 130 | 4.1 | static |
| journal | journal.png | 294, 950, 172, 166 | 4.0 | prop → journal |
| globe | globe.png | 512, 759, 138, 206 | 4.0 | prop → atlas |
| magnifier | magnifier.png | 684, 903, 172, 95 | 4.0 | prop → identify |
| recordPlayer | player-body.png + player-arm.png | 569, 1180, 290, 201 | 3.0 | player → records |

The clouds carry `opacity` 0.75. The record player is a `player`: the body is
the painted turntable with its vinyl, the tone arm is lifted out into its own
file with the trace behind it filled from the same grooves, and it swings from
a rest angle to −22° while music plays.

A portrait phone shows canvas x 165 to 859 at rest, and the footer covers
roughly y > 1340, so props are placed inside that band and kept at least 44 px
across so they stay tappable.

## Safe edges

A plate's real painted boundary may enter the view; a cut edge may not. Each
layer declares which of its edges are real, and the stage clamps the lean away
from the rest:

| Layer | Safe edges |
| --- | --- |
| tree | top, right |
| far-coast | right, top, bottom |
| near-coast | right, top |
| chair | top, right, left |
| sea | top (the horizon) |
| clouds, sea-flecks, chair-shadow, records-shadow | all four (sparse overlays) |
| sky, parapet, paving | none |

## Checking your work

The build writes QA images to `outputs/qa/plates/`, which is gitignored, not
beside the plates themselves:

- `composite-rest.png` — every layer and sprite at its rect, which is what the
  scene should look like before any motion.
- `_print-check.png` — the visible portrait band beside the reference poster at
  equal height.
- `reveal-check.png`, `reveal-check-vertical.png` — every layer shifted to prove
  the fills exist.
- `contact-sheet.png` — each file over a checkerboard with its size and depth.

## Known limits

- The tree file is cut at its own left border. At rest that sits outside the
  portrait view, and a lean brings it in as a soft fade rather than a hard line.
  Only new source art removes it.
- The far-coast fill is a mirrored reflection of the hills; only a few pixels of
  it can ever show. The paving extension has a seam off the visible band.
- The fleck layer duplicates strokes already present in the sea.
- Props are stored at canvas resolution and drawn larger on a phone, so their
  posterised edges soften under the tap zoom. Fixing that means running the
  sprite passes at double resolution, not upscaling the finished files.
