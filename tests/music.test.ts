import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { musicModificationNote, musicTracks } from '../lib/music.ts';

interface AudioReceipt {
  id: string;
  title: string;
  artist: string;
  isrc: string;
  sourceUrl: string;
  downloadUrl: string;
  licenseUrl: string;
  acquiredAt: string;
  original: {
    filename: string;
    sha256: string;
    bytes: number;
    durationSeconds: number;
  };
  bundled: {
    src: string;
    sha256: string;
    bytes: number;
    durationSeconds: number;
  };
}

const manifest = JSON.parse(
  readFileSync(
    new URL('../public/audio/manifest.json', import.meta.url),
    'utf8',
  ),
) as { modificationNote: string; tracks: AudioReceipt[] };
const credits = readFileSync(
  new URL('../public/audio/CREDITS.txt', import.meta.url),
  'utf8',
);

// Read the movie-header duration without adding FFmpeg as a test/CI dependency.
function uint32(data: Uint8Array, offset: number) {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
    offset,
  );
}

function ascii(data: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...data.subarray(start, end));
}

function findAtom(
  data: Uint8Array,
  type: string,
  start = 0,
  end = data.length,
) {
  for (let offset = start; offset + 8 <= end;) {
    const size = uint32(data, offset);
    assert.ok(size >= 8 && offset + size <= end, 'valid bounded MP4 atom');
    if (ascii(data, offset + 4, offset + 8) === type) {
      return { start: offset + 8, end: offset + size };
    }
    offset += size;
  }
  assert.fail(`Missing ${type} atom`);
}

function movieDuration(data: Uint8Array) {
  const movie = findAtom(data, 'moov');
  const header = findAtom(data, 'mvhd', movie.start, movie.end);
  assert.equal(data[header.start], 0, 'generated file has a v0 movie header');
  const timescale = uint32(data, header.start + 12);
  assert.ok(timescale > 0);
  return uint32(data, header.start + 16) / timescale;
}

void test('the small offline catalog has a calm default and complete rights metadata', () => {
  assert.equal(musicTracks.length, 3);
  assert.equal(musicTracks[0].id, 'cool-vibes');
  assert.equal(new Set(musicTracks.map((track) => track.id)).size, 3);
  assert.equal(manifest.tracks.length, musicTracks.length);
  for (const track of musicTracks) {
    assert.match(track.src, /^\/audio\/[a-z-]+\.m4a$/);
    assert.equal(track.artist, 'Kevin MacLeod');
    assert.equal(
      track.licenseUrl,
      'https://creativecommons.org/licenses/by/4.0/',
    );
    assert.equal(new URL(track.sourceUrl).hostname, 'incompetech.com');
    assert.equal(new URL(track.sourceUrl).searchParams.get('isrc'), track.isrc);
    assert.ok(track.title && track.mood && track.durationSeconds > 120);
  }
});

for (const track of musicTracks) {
  void test(`${track.title} is the complete verified local audio asset`, () => {
    const receipt = manifest.tracks.find((entry) => entry.id === track.id);
    assert.ok(receipt);
    assert.equal(receipt.title, track.title);
    assert.equal(receipt.artist, track.artist);
    assert.equal(receipt.isrc, track.isrc);
    assert.equal(receipt.sourceUrl, track.sourceUrl);
    assert.equal(receipt.licenseUrl, track.licenseUrl);
    assert.equal(receipt.bundled.src, track.src);
    assert.equal(receipt.bundled.durationSeconds, track.durationSeconds);
    assert.equal(new URL(receipt.downloadUrl).hostname, 'incompetech.com');
    assert.match(receipt.original.sha256, /^[a-f0-9]{64}$/);
    assert.match(receipt.acquiredAt, /^\d{4}-\d{2}-\d{2}$/);

    const data = readFileSync(
      new URL(`../public${track.src}`, import.meta.url),
    );
    assert.equal(data.length, receipt.bundled.bytes);
    assert.equal(
      createHash('sha256').update(data).digest('hex'),
      receipt.bundled.sha256,
    );
    assert.equal(ascii(data, 4, 8), 'ftyp');
    assert.ok(
      new TextDecoder().decode(data).includes('mp4a'),
      'AAC audio sample entry is present',
    );
    assert.ok(Math.abs(movieDuration(data) - track.durationSeconds) < 0.002);
    assert.ok(
      Math.abs(receipt.original.durationSeconds - track.durationSeconds) < 0.05,
      'full recording retained, allowing codec/container padding',
    );
    assert.ok(receipt.original.bytes > receipt.bundled.bytes);
  });
}

void test('the bundle carries complete readable credits and the actual modification notice', () => {
  assert.equal(manifest.modificationNote, musicModificationNote);
  assert.ok(credits.includes(musicModificationNote));
  assert.ok(credits.includes('Copyright Kevin MacLeod'));
  assert.ok(credits.includes('without warranties'));
  for (const track of musicTracks) {
    for (const value of [
      track.title,
      track.artist,
      track.isrc,
      track.sourceUrl,
      track.licenseUrl,
    ]) {
      assert.ok(credits.includes(value), `credits retain ${value}`);
    }
  }
});

void test('all three offline recordings stay within the 10 MB audio budget', () => {
  const bytes = manifest.tracks.reduce(
    (total, track) => total + track.bundled.bytes,
    0,
  );
  assert.ok(bytes > 0 && bytes < 10_000_000);
});

void test('the turntable opens on Jazz Brunch by default', async () => {
  const { defaultTrackId, defaultTrackIndex, musicTracks } = await import('../lib/music.ts');
  assert.equal(defaultTrackId, 'jazz-brunch');
  assert.equal(musicTracks[defaultTrackIndex].title, 'Jazz Brunch');
});
