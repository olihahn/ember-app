# Third-party notices

These notices were checked against the installed packages' license files on
September 9, 2026. Versions are recorded in [package-lock.json](package-lock.json).
They cover the bundled fonts, icons, geography, music, and selected runtime
components; this is **not an exhaustive audit of the APK, transitive dependencies,
Android toolchain, or build tools**. Keep upstream notices with redistributed
components and review the actual release contents before broader distribution.

Ember's own source code is MIT licensed; see [LICENSE](LICENSE). The image
assets are reserved and are not covered by that grant, also set out in
[LICENSE](LICENSE). The notices below apply to third-party components only, not
to the application as a whole. Provenance for the generated artwork is in
[ASSETS.md](ASSETS.md).

## Music

“Cool Vibes,” “Night on the Docks - Sax,” and “Jazz Brunch” are composed and
recorded by Kevin MacLeod (Incompetech). Copyright Kevin MacLeod. The recordings
are licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
Full recordings were re-encoded to AAC for offline playback; no musical edits.
Keep the track-specific attribution, original links, and modification notice in
[MUSIC-LICENSES.md](MUSIC-LICENSES.md),
[public/audio/CREDITS.txt](public/audio/CREDITS.txt), and the in-app music credits.
The recordings are not public domain.

## Fonts — SIL Open Font License 1.1

Two font families are bundled offline, from `@fontsource-variable/fraunces`
5.3.0 (display, headings, captions) and `@fontsource-variable/instrument-sans`
5.3.0 (body and form text). The copyright lines below are reproduced from those
packages' installed `LICENSE` files, and the full OFL 1.1 text that follows
applies to both families.

Fraunces:

```text
Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces) Fraunces-Italic[SOFT,WONK,opsz,wght].ttf: Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces)
```

Instrument Sans:

```text
Copyright 2022 The Instrument Sans Project Authors (https://github.com/Instrument/instrument-sans) InstrumentSans-Italic[wdth,wght].ttf: Copyright 2022 The Instrument Sans Project Authors (https://github.com/Instrument/instrument-sans)
```

```text
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

## Maps and icons — ISC

The following copyright notices and shared ISC permission/disclaimer text come
from the installed packages' `LICENSE` files:

| Component | Version | Copyright notice |
| --- | --- | --- |
| `world-atlas` | 2.0.2 | Copyright 2013-2019 Michael Bostock |
| `topojson-client` | 3.1.0 | Copyright 2012-2019 Michael Bostock |
| `d3-geo` | 3.1.1 | Copyright 2010-2024 Mike Bostock |
| `d3-array` | 3.2.4 | Copyright 2010-2023 Mike Bostock |
| `internmap` | 2.0.3 | Copyright 2021 Mike Bostock |
| `lucide-react` | 1.31.0 | Copyright (c) 2026 Lucide Icons and Contributors |

```text
Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```

`world-atlas` packages Natural Earth geography. Ember uses the bundled 110m
countries in the Atlas view. Natural Earth's source geographic data is public
domain; the package's ISC notice above is retained separately.

### Lucide's additional Feather notice

The installed Lucide license also includes the following list and MIT notice;
Lucide is not described here as ISC-only:

```text
The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis
```

The full MIT permission/disclaimer below applies to that notice. `d3-geo` also
carries an MIT notice for GeographicLib versions 1.12 and later, Copyright
2008-2012 Charles Karney; its permission/disclaimer is the same text below.

## Three.js and selected runtime components — MIT

Copyright notices are reproduced from the installed `LICENSE` files (or
`license` for `clsx`, `LICENSE.md` for `tailwind-merge`). The shared MIT text
below applies separately to each listed component, and to the Feather and
GeographicLib notices above.

| Component | Version | Copyright notice |
| --- | --- | --- |
| `three` | 0.186.0 | Copyright © 2010-2026 three.js authors |
| `react`, `react-dom` | 19.2.8 | Copyright (c) Meta Platforms, Inc. and affiliates. |
| `@capacitor/core`, `@capacitor/android` | 8.5.1 | Copyright (c) 2017-present Drifty Co. |
| `@capacitor/app` | 8.1.1 | Copyright 2020-present Ionic; https://ionic.io |
| `@capacitor/camera` | 8.2.4 | Copyright 2020-present Ionic; https://ionic.io |
| `@capacitor/geolocation` | 8.2.2 | Copyright (c) 2025 Ionic |
| `@base-ui/react` | 1.7.0 | Copyright (c) 2019 Material-UI SAS |
| `clsx` | 2.1.1 | Copyright (c) Luke Edwards &lt;luke.edwards05@gmail.com&gt; (lukeed.com) |
| `tailwind-merge` | 3.6.0 | Copyright (c) 2021 Dany Castillo |

```text
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Class Variance Authority — Apache 2.0

`class-variance-authority` 0.7.1 carries the following notice in its installed
`LICENSE`. That file includes the full Apache 2.0 terms, also available at the
license URL below.

```text
Copyright 2022 Joe Bell

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

