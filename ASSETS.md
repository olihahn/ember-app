# Asset provenance

Every image in this project was generated for it with a built-in image tool,
from a written brief. No photographs were supplied to the image generator, and
nothing was copied from another product. The generated artwork is the author's
and is not covered by the MIT licence on the code; see [LICENSE](LICENSE).

Licensed third-party media is recorded separately:
[MUSIC-LICENSES.md](MUSIC-LICENSES.md) for the three bundled recordings, with
the [audio credits](public/audio/CREDITS.txt) and
[audio manifest](public/audio/manifest.json), and
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for fonts, icons, map data and
runtime libraries. Those notices do not grant any licence to Ember's own code or
artwork.

## The reference poster

`public/images/after-hours-poster.png`, 1536 × 1024. One image request,
inspected locally. This is the project's visual reference: the painted terrace
is built to read as a crop of it, and the art pipeline grades the plates against
measured patches of it. It is illustration, not a photograph and not a cigar
identification reference.

> Use case stylized-concept. Asset type illustrated hero art panel for Ember
> personal cigar field journal. Original mid-century Riviera travel-poster /
> linocut record sleeve illustration, classic and quietly witty. A sunlit
> seaside terrace with a bold vermilion/coral lounge chair and tiny round side
> table holding a cream open notebook, a plain unlit cigar on a little tray, and
> a tall glass of sparkling water with lemon; record player/one vinyl record
> subtly nearby. Mediterranean umbrella pine silhouette and a blue sea horizon
> with one small white sail in distance. Geometric color planes, carved
> imperfect ink edges and subtle screenprint paper grain, confident composition,
> stylish not cartoon. Palette warm cream #F6F1E4, ink navy #193844, vermilion
> #B83E2F, muted pool teal #A8C9C4, pine #345747, very small ochre #C79540.
> Landscape 1536x1024 requested, fills panel; no copy, text, logos, people,
> watermarks, phones, interface mockups, faux sepia or glossy 3D. This is
> whimsical original editorial artwork not a real photo or real cigar ID.

## Scene art

Five further images, generated with the poster as a style and composition
reference rather than an edit target. The painted layers the app actually
renders are cut from these by the [art pipeline](docs/ART-PIPELINE.md); the
files below are the sources, not the shipped plates. The four terrace sources
are read at build time only and are **not published** with this repository;
when present they live in `art/sources/` and stay out of
the APK; the companion ships because the app draws it directly.

| Asset | Dimensions | Role |
| --- | --- | --- |
| `art/sources/terrace-scene.png` | 1024 × 1536 | Opaque coast, terrace and empty tabletop |
| `art/sources/terrace-tree.png` | 1024 × 1536 | Transparent foreground umbrella pine |
| `art/sources/terrace-chair.png` | 1254 × 1254 | Transparent worn vermilion sling chair |
| `art/sources/terrace-objects.png` | 1254 × 1254 | Transparent journal, record player, globe and magnifier |
| `public/images/beach-companion.png` | 1254 × 1254 | Transparent four-pose pixel-art character |

The shared brief asked for a mid-century Riviera travel print with carved ink
edges and screenprint grain: golden sun, inky pine and navy shadows, sea-green
water, ochre stone, burnt-orange accents; aged and printed rather than glossy;
no interface, captions, logos, watermarks or people in the scenery.

- **Environment.** Portrait view from the terrace toward a Mediterranean sea,
  distant coastal buildings, one small sailboat, golden sky, a low stone
  parapet, and a large empty round stone table in the lower right. The upper
  left and left foreground were deliberately left empty for the separate pine
  and chair layers, and the plate contains no chair, tree or tabletop objects.
- **Tree.** An isolated umbrella pine framing the upper left, dark carved
  branches, olive and ink canopy, rough printed trunk down the left edge, with a
  genuinely transparent background.
- **Chair.** One complete weathered vermilion sling lounge chair with a narrow
  dark metal frame, in three-quarter perspective, printed linen upholstery and
  scuffed edges, entirely inside the frame.
- **Objects.** A two-by-two sheet in consistent tabletop perspective and light:
  a rust leather journal with a cream page block, a scuffed navy suitcase
  turntable with black vinyl and an ochre label, a brass globe with a sea-green
  ocean and golden land, and a brass magnifying glass with a dark handle.
  Separate silhouettes, transparent background, no words. A follow-up edit
  replaced an accidentally baked checkerboard with real alpha.
- **Beach companion.** Four poses of a fictional older gentleman in restrained
  16-bit pixel art, silver hair, white beard, sunglasses, rust Hawaiian shirt,
  reading as friendly dry amusement. He appears when a photo is not a cigar.

All five were inspected and their alpha verified. Perspective, hit targets,
labels and text are implemented as accessible DOM and CSS, never painted into
the images.

## Still life

`public/images/cigars.png`, 1536 × 1024, from one image request: an editorial still life of two unlit cigars with plain
unmarked cream bands on travertine, linen and a paper notebook, with "ember."
and "Your cigar journal" typeset into it. Inspected locally; both text strings
render correctly. Illustration, not a product photograph or an identification
reference.

## Other original artwork

The atlas work view is original SVG styling over the bundled Natural Earth
geography, drawn in orthographic projection. The record-player panel, journal
cards, print glyphs and the burning-cigar loader are original CSS, SVG and HTML.

## README media

The images under `docs/images` are captures of this app running on the author's
own phone, not mockups and not renders made for the page.

- `terrace.jpg`, `parallax.jpg`, `pages.jpg` — screenshots. `parallax.jpg` is
  two screenshots placed side by side, one at rest and one held at the lean.
- `lean.gif` — three seconds of a screen recording of the home screen being
  dragged, played forward and then backward so it loops. Cropped to remove the
  status bar, reduced to 8 frames a second and a single small palette to keep
  the file small. No frame was retouched, and nothing was sped up or slowed
  down.

They show the painted artwork, so the same reservation applies to them as to
the art itself; see [LICENSE](LICENSE).
