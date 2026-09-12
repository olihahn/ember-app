# Emulator QA

Source tests cover logic, but they cannot tell you whether a painted scene looks
right. That question is settled by building the APK, installing it on an
emulator, capturing what it actually renders, and looking at it beside the
reference poster.

```sh
node scripts/plates-pilot.mjs <name>               # build, install, capture
node scripts/plates-pilot.mjs <name> --skip-build  # reinstall the existing APK and capture
node scripts/plates-pilot.mjs <name> --music       # also exercise playback
node scripts/plates-compare.mjs <name>             # side-by-side composites
```

`<name>` is a label made of letters, digits, dashes and underscores. The
emulator must already be running; the script does not start one. See
[building for Android](BUILD-ANDROID.md) for the start command.

## The AVD guard

The pipeline installs onto exactly one target: an emulator whose AVD is named
`Ember_QA`, at serial `emulator-5560`. Before building and again before
installing, it runs `adb -s emulator-5560 emu avd name`, trims the output and
refuses unless a line reads exactly `Ember_QA`.

That is deliberate. A QA script that enumerates devices will eventually install
a debug build onto a phone holding real data. This one cannot: it never
enumerates, never uses `-d` or `-e`, only ever uses `install -r`, and never
uninstalls or clears app data. Keep it that way if you fork it.

## What lands in `outputs/qa/plates/`

| File | What it is |
| --- | --- |
| `<name>.apk` | The exact debug APK that was installed |
| `<name>-rest.png` | Full screen after cold launch, once the scene's projected buttons exist |
| `<name>-lean.png` | Two seconds after a slow horizontal drag across the middle of the screen |
| `<name>-motion.mp4` | Eight seconds of screen recording, for judging sea, boats, breeze and smoke |
| `<name>-music.mp4` | With `--music`: six seconds while a record plays, for the tone arm |
| `<name>-route-<id>.png` | Each destination opened from its prop |
| `<name>-routes.png` | The four route captures as one strip |
| `<name>-timing.json` | Cold-launch timings |
| `<name>-vs-poster.png` | The capture beside the reference poster |
| `<name>-lean-diff.png` | Rest and lean side by side |

## The route check

For each prop the script finds the projected button by its accessible name
inside the "Objects on your table" region, taps it at half its width and a third
of its height, and waits for a marker that only exists on the destination: "The
Journal.", "The Atlas.", the editor's "Add to humidor", or the record panel's
"On the turntable". It retries once slightly higher, because a tall projected
button's centre can fall under the footer gradient, which swallows the tap. Then
it presses Back and asserts the terrace is present again and the marker is gone.

Buttons are found by label, never by hard-coded coordinates. One quirk worth
knowing: the WebView exposes `aria-label` as the node's `text` rather than its
`content-desc`, so the script matches either.

## Timing

`timing.json` records five host wall-clock numbers, gathered three different
ways:

- `amStartTotalTimeMs` and `amStartWaitTimeMs` — reported by
  `adb shell am start -W`, meaning the activity is displayed. The WebView has
  not painted yet.
- `paperVisibleMs` — the first frame whose centre is the paper background, which
  is the app's own first paint. Found by screenshotting every 250 ms.
- `printPaintedMs` — the first frame after that where the plates cover the
  centre. Same 250 ms screenshot poll.
- `terraceHierarchyMs` — until a UI dump contains the projected buttons, polled
  every 500 ms.

These are polled numbers on an emulator. They are good for comparing one build
with the next through the same pipeline, and they are not a frame-accurate
benchmark. On the reference emulator the app reaches paper in about 1.3 s and a
painted print in about 2.5 s, of which the first second or so is native launch
and WebView start, before any of this code runs.

## Work-page backdrops

The journal, atlas, settings and editor sit on translucent paper over a still of
the terrace. That still is not the live stage; it is a JPEG regenerated from the
theme manifest so it always matches the current plates.

```sh
node scripts/plates/build-backdrop.mjs
```

It writes `public/images/terrace-backdrop.jpg` and the softened
`terrace-backdrop-soft.jpg` that the CSS actually uses. Run it after any change
to the plates.
