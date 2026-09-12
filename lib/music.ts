export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  src: string;
  durationSeconds: number;
  sourceUrl: string;
  licenseUrl: string;
  isrc: string;
  mood: string;
}

export const musicModificationNote =
  'Full recordings re-encoded to AAC for offline playback. No musical edits.';

/** The record on the turntable when the app opens (Oliver's choice). */
export const defaultTrackId = 'jazz-brunch';

export const musicTracks: readonly MusicTrack[] = [
  {
    id: 'cool-vibes',
    title: 'Cool Vibes',
    artist: 'Kevin MacLeod',
    src: '/audio/cool-vibes.m4a',
    durationSeconds: 218.382993,
    sourceUrl:
      'https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=USUAN1100863',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    isrc: 'USUAN1100863',
    mood: 'A quiet vibraphone trio.',
  },
  {
    id: 'night-on-the-docks-sax',
    title: 'Night on the Docks - Sax',
    artist: 'Kevin MacLeod',
    src: '/audio/night-on-the-docks-sax.m4a',
    durationSeconds: 174.053991,
    sourceUrl:
      'https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=USUAN1100137',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    isrc: 'USUAN1100137',
    mood: 'Tenor sax, after hours.',
  },
  {
    id: 'jazz-brunch',
    title: 'Jazz Brunch',
    artist: 'Kevin MacLeod',
    src: '/audio/jazz-brunch.m4a',
    durationSeconds: 323.108005,
    sourceUrl:
      'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1700074',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    isrc: 'USUAN1700074',
    mood: 'A brighter café groove.',
  },
];

export const defaultTrackIndex = Math.max(
  0,
  musicTracks.findIndex((track) => track.id === defaultTrackId),
);
