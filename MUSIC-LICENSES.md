# Bundled music licenses

Ember includes three recordings composed and recorded by **Kevin MacLeod (Incompetech)**, licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). They are no-charge licensed music, not public-domain or copyright-free recordings.

| Recording                                                                                                         | ISRC         | Measured bundled duration | Bundled file                              |
| ----------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------- | ----------------------------------------- |
| [Cool Vibes](https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=USUAN1100863)               | USUAN1100863 | 218.382993 seconds        | `public/audio/cool-vibes.m4a`             |
| [Night on the Docks - Sax](https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=USUAN1100137) | USUAN1100137 | 174.053991 seconds        | `public/audio/night-on-the-docks-sax.m4a` |
| [Jazz Brunch](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1700074)                            | USUAN1700074 | 323.108005 seconds        | `public/audio/jazz-brunch.m4a`            |

Copyright Kevin MacLeod. The artist's [catalog documentation](https://incompetech.com/agent-section/) identifies the composer/copyright holder and CC BY 4.0 grant; his [music FAQ](https://incompetech.com/music/royalty-free/faq.html) explains recording copyright and use of credits in software. Sources and license terms were checked on **2026-09-08**. The exact original MP3s were downloaded from the creator's catalog URLs; none came from a streaming-service rip or an unverified reupload.

## Modification notice

**Full recordings re-encoded to AAC for offline playback. No musical edits.**

FFmpeg converted the complete MP3 audio streams to stereo 44.1 kHz AAC in M4A containers with a 96 kbps target bitrate and fast-start metadata. No trimming, loop/remix editing, loudness normalization, or other volume adjustment was applied. Title, artist, composer and license identification were written into the files. Minor source/output duration differences of less than 27 milliseconds reflect codec/container padding, not a shortened musical selection.

The bundled audio is **8,757,574 bytes** in total (approximately 8.76 MB), compared with 24,998,691 bytes of source MP3s. Durations above come from `ffprobe`, not rounded catalog listings. Original and output SHA-256 checksums, exact sizes, source/download URLs, ISRCs, dates, and encoding details are recorded in [public/audio/manifest.json](public/audio/manifest.json). Original downloads are retained locally under ignored `outputs/qa/music-originals/` and are not required at runtime.

## Redistribution and credits

CC BY 4.0 permits copying and adaptation in any format, including commercial distribution. The [legal code](https://creativecommons.org/licenses/by/4.0/legalcode.en) supplies the worldwide grant for the licensor's controlled rights and sets the attribution, modification-notice and no-additional-restriction conditions. The recordings are supplied without warranties under its section 5. The license does not imply artist endorsement or guarantee the absence of third-party/platform claims.

- Keep an easy-to-find **Music credits** view in Ember with each title, artist, original track-page link, license link and the modification notice. A repository document alone is not the in-app credit.
- Ship [public/audio/CREDITS.txt](public/audio/CREDITS.txt) and the manifest with the AAC files. Keep the copyright and license notices when redistributing.
- Do not add restrictions or effective DRM that prevents recipients from exercising their licensed rights in the music. The recordings remain CC BY 4.0; this does not relicense unrelated app code.
- Do not label these recordings public domain, “no copyright,” or exclusive to Ember. If audio changes again, update the modification notice and checksums.

No recording of **All of Me** or **Tuxedo Junction** is bundled. They remain stylistic references only: a composition and a specific recording carry separate rights, and neither was cleared or used.
