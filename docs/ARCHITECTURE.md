# How the terrace works

The home screen is a multiplane stage: painted layers hung at real distances
from a camera, drawn unlit, with motion only where motion means something. It
looks like a printed poster and behaves like a room. This document explains the
pieces, the file format, and what is still rough.

## Why not 3D

The target is a 1960s Riviera travel print: five inks, flat fills, dark ink
foliage, paper grain, blue-ink shadows. An earlier version of this app modelled
the terrace as lit geometry and it always read as a diorama, because physically
based shading is the opposite of a printed ink. Painted plates keep the print
and buy depth from parallax instead of from lighting.

## Coordinates

The stage canvas is 1024 × 1536 pixels, origin top-left, matching the source
art. Every layer and sprite is placed by a rectangle in canvas pixels, meaning
where it appears when the camera is at rest.

The canvas is mapped onto the viewport in cover mode: canvas height fills a
portrait viewport with the sides cropped, canvas width fills a landscape one,
with an overscan factor of 1.08. With a reference field of view of 40°, one
canvas pixel at depth `d` is `2·d·tan(20°) / 1536` world units, so a plane at
any depth can be sized to subtend exactly its share of the canvas at rest.

The camera sits at the origin looking at `(0, 0, -6)`. Dragging translates it
rather than rotating it, which is what makes the parallax read as a seated lean
rather than an orbit.

## The manifest

`public/plates/terrace/manifest.json` is the whole scene. The renderer holds no
knowledge of terraces; it reads this file.

```json
{
  "version": 1,
  "canvas": { "width": 1024, "height": 1536 },
  "layers": [
    { "id": "sky",  "file": "sky.png",  "rect": {...}, "depth": 40, "kind": "static" },
    { "id": "sea",  "file": "sea.png",  "rect": {...}, "depth": 18, "kind": "sea",
      "safeEdges": ["top"] },
    { "id": "tree", "file": "tree.png", "rect": {...}, "depth": 1.55, "kind": "breeze",
      "anchor": { "x": 178, "y": 1530 }, "breeze": { "hold": 780 } }
  ],
  "sprites": [
    { "id": "boat", "file": "boat.png", "rect": {...}, "depth": 18, "kind": "boat",
      "route": { "amplitude": 50, "period": 45 } },
    { "id": "journal", "file": "journal.png", "rect": {...}, "depth": 4, "kind": "prop",
      "destination": "journal", "caption": { "dx": 0, "dy": -95 } }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `rect` | Where the trimmed file sits on the canvas, at rest. Layers may extend past the canvas; sprites may not. |
| `depth` | Distance from the camera. Larger is farther. The terrace runs from 1.55 (pine) to 40 (sky). |
| `kind` | What the piece does. See below. |
| `safeEdges` | Edges that are real painted boundaries rather than cuts, so the lean clamp may let them enter the frame. |
| `anchor`, `breeze.hold` | For `breeze`: where the sway is pinned, and how far above it stays completely still. |
| `route` | For `boat`: how far it travels and how long a crossing takes. |
| `destination`, `caption` | For `prop` and `player`: which page it opens, and where its label sits. |
| `parts` | For `player`: body, optional disc, and an arm with a pivot and rest/play angles. |
| `ember` | A smouldering point in canvas pixels. Adds drifting smoke wisps and a glowing tip. |
| `opacity` | Draws a plate below full strength; the cloud streaks use it. |
| `drift` | For `drift`: how far the plate scrolls per second, in canvas widths. |
| `files` | Extra frames for an animated sprite, such as a gull's wingbeats. |
| `lean`, `paper` | Scene-wide, at the top level of the manifest: the drag ceiling, and the colour showing wherever no plate covers the view. A theme should set its own `paper`; the stage falls back to a neutral grey. |

`kind` is the main behavioural switch, though not the only one: an `ember` field
adds smoke and a glow wherever it appears, and a prop's `destination` brings its
own idle — the globe rocks, the lens catches a glint, the record takes a sheen.

The kinds themselves:

- **static** — hangs there.
- **drift** — scrolls horizontally with repeat wrapping, for cloud streaks. The
  build asserts that such a file is transparent at both ends, or its own right
  edge would wrap into the left of the screen.
- **sea** — two slow sine offsets so the painted strokes breathe.
- **flecks** — the pale stroke highlights, drifting and fading on their own period.
- **breeze** — a subdivided plane whose vertices bend with distance from the
  anchor, still at the trunk, moving at the crown.
- **boat** — crosses its band, waits off-screen, comes back mirrored. It never
  turns in view. Any number of boats may exist; each gets its own phase.
- **gull** — side-view silhouettes that enter from the left, cross, exit right,
  wait, and return. Wings beat in bursts, then glide.
- **prop** — tappable. Registered under its `destination` so the projected DOM
  button and the entrance animation find it.
- **player** — the turntable: a body, and an arm that swings onto the record
  while music plays.

Every rhythm has an unrelated period and a phase drawn once per scene, so
nothing pulses in unison and no two launches look identical. With motion off,
everything evaluates at time zero and the frame is a still print.

## The lean clamp

The most annoying failure of a multiplane scene is showing the edge of a plate.
So the stage computes the limit rather than leaving it to taste: for every layer
edge not declared `safeEdges`, it measures how much real paint lies beyond the
frame, divides by that layer's parallax rate, and takes the minimum across the
whole scene. The camera then cannot travel far enough to expose an edge, at any
viewport size.

It starts from a conservative hardcoded ceiling that the manifest can only
tighten, never loosen. On a portrait phone the terrace manifest does tighten
both axes; in landscape nothing constrains the vertical, so there the default
ceiling is what you get.

## Rendering

Unlit `MeshBasicMaterial` planes, transparent, alpha test 0.02, depth writing
off, drawn far to near by depth. No lights, no shadow maps, no tone mapping.
Shadows are painted into the art. The one exception is the smouldering tip an
`ember` declares: its wisps are shader materials and its glow is a pair of
additively blended sprites, because smoke and embers are the two things a flat
plate cannot fake. Pixel ratio is capped at 1.6 and the loop
runs at about 30 fps, only while something needs it: it stops when the scene is
at rest, hidden, inactive, or the system asks for reduced motion.

Loading compiles the shaders once with `compileAsync`, then uploads each texture
with a yield between uploads so the interface stays responsive, and only then
paints the first frame. Until then the screen is paper, not a spinner. Any
failure, including WebGL context loss, is terminal: the stage disposes itself
and the app falls back to its ordinary navigation, so the journal is never
trapped behind a broken canvas.

## Interaction

Props are tapped through DOM buttons positioned over their projected bounding
boxes, so they carry real accessible names and focus behaviour rather than being
canvas hit tests. A horizontal flick across the record player starts or stops
playback without opening anything; a tap opens the panel.

## Adding another room

A theme is a folder under `public/plates/<name>/` with a manifest. The renderer
in `lib/terrace/plates/` names no plate file, no scene id and no room: the theme
path is a required option, the paper colour comes from the manifest, and a test
scans the source for scene nouns and image filenames and fails if one appears.

The component that hosts the stage, `components/LivingTerrace.tsx`, takes the
path as a `theme` prop and defaults it to this room. A second room means
shipping its folder and passing its path; the same four destinations then wire
themselves to whatever props that manifest declares.

## Known rough edges

- **Sprite resolution.** Props are stored at canvas resolution and drawn at
  about 1.7× on a 1080-wide phone, so their posterised edges soften under the
  tap-zoom. The fix is to run each sprite's extract, posterise and shadow pass
  at 2×, not to upscale the finished file.
- **Cold start.** About 2.5 s from launch to painted print on the test
  emulator, reaching paper at about 1.3 s. Roughly the first second of that is
  native launch and WebView start, before any of this code runs.
- **Art.** The parapet is still slightly blotchier than the reference print, and
  the hanging fronds are more of a flat mass than separated sprays.
- **Returning from a page** briefly shows the paper loading state again while
  the stage remounts.
- **One theme.** The generic-player design is unproven until a second room
  exists.
