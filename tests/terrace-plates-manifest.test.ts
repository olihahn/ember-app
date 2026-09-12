import test from 'node:test';
import assert from 'node:assert/strict';
import { manifestFiles, parseManifest } from '../lib/terrace/plates/manifest.ts';

function base() {
  return {
    version: 1,
    canvas: { width: 1024, height: 1536 },
    layers: [
      { id: 'far', file: 'far.png', rect: { x: 0, y: 0, w: 1024, h: 1536 }, depth: 40, kind: 'static' },
      { id: 'swaying', file: 'swaying.png', rect: { x: 0, y: 100, w: 600, h: 1200 }, depth: 1.5, kind: 'breeze', anchor: { x: 80, y: 1290 } },
    ],
    sprites: [
      { id: 'vessel', file: 'vessel.png', rect: { x: 800, y: 450, w: 80, h: 90 }, depth: 18, kind: 'boat', route: { amplitude: 120, period: 80 } },
      { id: 'bird', file: 'bird-a.png', files: ['bird-b.png'], rect: { x: 500, y: 200, w: 48, h: 24 }, depth: 20, kind: 'gull' },
      { id: 'book', file: 'book.png', rect: { x: 400, y: 980, w: 170, h: 130 }, depth: 4, kind: 'prop', destination: 'journal' },
      { id: 'dish', file: 'dish.png', rect: { x: 600, y: 1010, w: 150, h: 90 }, depth: 4.1, kind: 'static', ember: { x: 690, y: 1030 } },
    ],
  };
}

void test('a complete manifest parses into normalised entries and lists every distinct file once', () => {
  const manifest = parseManifest(base());
  assert.equal(manifest.layers.length, 2);
  assert.equal(manifest.sprites.length, 4);
  assert.deepEqual(manifest.layers[1].anchor, { x: 80, y: 1290 });
  assert.deepEqual(manifest.sprites[0].route, { amplitude: 120, period: 80 });
  assert.deepEqual(manifest.sprites[3].ember, { x: 690, y: 1030 });
  assert.equal(manifest.sprites[2].destination, 'journal');
  assert.deepEqual(manifestFiles(manifest), ['far.png', 'swaying.png', 'vessel.png', 'bird-a.png', 'bird-b.png', 'book.png', 'dish.png']);
});

void test('layers may overscan the canvas for parallax margins, sprites may not, and a theme may set its lean', () => {
  const raw = base();
  raw.layers[1].rect = { x: -110, y: -40, w: 1012, h: 1400 };
  (raw as { lean?: unknown }).lean = { x: 0.2, y: 0.1 };
  const manifest = parseManifest(raw);
  assert.deepEqual(manifest.layers[1].rect, { x: -110, y: -40, w: 1012, h: 1400 });
  assert.deepEqual(manifest.lean, { x: 0.2, y: 0.1 });
  assert.equal(parseManifest(base()).lean, undefined);
  const detached = base();
  detached.layers[0].rect = { x: 1024, y: 0, w: 50, h: 50 };
  assert.throws(() => parseManifest(detached), /does not touch the canvas/);
  const badLean = base();
  (badLean as { lean?: unknown }).lean = { x: -1, y: 0.1 };
  assert.throws(() => parseManifest(badLean), /lean needs/);
});

void test('every structural defect is rejected with a message naming the entry', () => {
  const cases: [string, (raw: ReturnType<typeof base>) => unknown, RegExp][] = [
    ['unknown kind', (raw) => { raw.layers[0].kind = 'lit'; return raw; }, /unknown kind/],
    ['missing file', (raw) => { delete (raw.layers[0] as { file?: string }).file; return raw; }, /file must be/],
    ['absolute file', (raw) => { raw.layers[0].file = '/etc/far.png'; return raw; }, /file must be/],
    ['missing rect', (raw) => { delete (raw.layers[0] as { rect?: unknown }).rect; return raw; }, /rect needs/],
    ['missing depth', (raw) => { delete (raw.layers[0] as { depth?: number }).depth; return raw; }, /depth must be/],
    ['zero depth', (raw) => { raw.layers[0].depth = 0; return raw; }, /depth must be/],
    ['negative depth', (raw) => { raw.sprites[0].depth = -3; return raw; }, /depth must be/],
    ['sprite rect outside canvas', (raw) => { raw.sprites[0].rect = { x: 1000, y: 450, w: 80, h: 90 }; return raw; }, /outside the canvas/],
    ['prop rect outside canvas', (raw) => { raw.sprites[2].rect = { x: -10, y: 980, w: 170, h: 130 }; return raw; }, /outside the canvas/],
    ['empty rect', (raw) => { raw.sprites[0].rect = { x: 10, y: 10, w: 0, h: 9 }; return raw; }, /positive size/],
    ['prop without destination', (raw) => { delete (raw.sprites[2] as { destination?: string }).destination; return raw; }, /valid destination/],
    ['prop with unknown destination', (raw) => { raw.sprites[2].destination = 'settings'; return raw; }, /valid destination/],
    ['duplicate destinations', (raw) => { raw.sprites.push({ ...raw.sprites[2], id: 'book2', file: 'book2.png' }); return raw; }, /already taken/],
    ['destination on a non-prop', (raw) => { (raw.sprites[3] as { destination?: string }).destination = 'atlas'; return raw; }, /only props/],
    ['duplicate id', (raw) => { raw.sprites[1].id = 'vessel'; return raw; }, /duplicate id/],
    ['breeze without anchor', (raw) => { delete (raw.layers[1] as { anchor?: unknown }).anchor; return raw; }, /breeze needs an anchor/],
    ['ember outside canvas', (raw) => { raw.sprites[3].ember = { x: 2000, y: 10 }; return raw; }, /ember lies outside/],
    ['opacity out of range', (raw) => { (raw.layers[0] as { opacity?: number }).opacity = 1.4; return raw; }, /opacity/],
    ['sprite kind in layers', (raw) => { raw.layers.push({ id: 'stray', file: 'stray.png', rect: { x: 0, y: 0, w: 10, h: 10 }, depth: 4, kind: 'prop', destination: 'atlas' } as never); return raw; }, /belongs in sprites/],
    ['no layers', (raw) => { raw.layers = []; return raw; }, /at least one layer/],
    ['wrong version', (raw) => { (raw as { version: number }).version = 2; return raw; }, /unsupported version/],
    ['bad canvas', (raw) => { raw.canvas = { width: 0, height: 10 }; return raw; }, /canvas needs/],
    ['not an object', () => 'manifest', /not an object/],
    ['files not relative', (raw) => { raw.sprites[1].files = ['../bird.png']; return raw; }, /files must be/],
  ];
  for (const [name, mutate, message] of cases)
    assert.throws(() => parseManifest(mutate(base())), message, name);
});

void test('breeze tuning sets the hold band on breeze layers only', () => {
  const raw = base();
  (raw.layers[1] as { breeze?: unknown }).breeze = { hold: 780 };
  assert.deepEqual(parseManifest(raw).layers[1].breeze, { hold: 780 });
  const wrong = base();
  (wrong.layers[0] as { breeze?: unknown }).breeze = { hold: 10 };
  assert.throws(() => parseManifest(wrong), /belongs on a breeze layer/);
  const negative = base();
  (negative.layers[1] as { breeze?: unknown }).breeze = { hold: -1 };
  assert.throws(() => parseManifest(negative), /hold must be/);
});

void test('safeEdges name painted boundaries on layers only', () => {
  const raw = base();
  (raw.layers[1] as { safeEdges?: string[] }).safeEdges = ['right', 'top', 'right'];
  assert.deepEqual(parseManifest(raw).layers[1].safeEdges, ['right', 'top']);
  const bad = base();
  (bad.layers[1] as { safeEdges?: string[] }).safeEdges = ['north'];
  assert.throws(() => parseManifest(bad), /safeEdges must list/);
  const sprite = base();
  (sprite.sprites[0] as { safeEdges?: string[] }).safeEdges = ['left'];
  assert.throws(() => parseManifest(sprite), /only layers have safeEdges/);
});

void test('captions, established plaque, paper and player parts parse; malformed ones are rejected', () => {
  const raw = base();
  (raw.sprites[2] as { caption?: unknown }).caption = { dx: 0, dy: -80 };
  (raw as { paper?: string }).paper = '#f2dba2';
  (raw as { established?: unknown }).established = { rect: { x: 300, y: 1400, w: 200, h: 40 }, depth: 4.2 };
  raw.sprites.push({
    id: 'deck', file: 'deck-body.png', rect: { x: 600, y: 1050, w: 200, h: 130 }, depth: 4, kind: 'player',
    parts: {
      body: { file: 'deck-body.png', rect: { x: 600, y: 1050, w: 200, h: 130 } },
      disc: { file: 'deck-disc.png', centre: { x: 690, y: 1110 }, radius: 40, tilt: 55, yaw: -12 },
      arm: { file: 'deck-arm.png', rect: { x: 740, y: 1060, w: 40, h: 70 }, pivot: { x: 770, y: 1070 }, restAngle: 0, playAngle: -22 },
    },
  } as never);
  raw.sprites[1].files = ['bird-up.png', 'bird-level.png', 'bird-down.png'];
  const manifest = parseManifest(raw);
  assert.deepEqual(manifest.sprites[2].caption, { dx: 0, dy: -80 });
  assert.equal(manifest.paper, '#f2dba2');
  assert.deepEqual(manifest.established, { rect: { x: 300, y: 1400, w: 200, h: 40 }, depth: 4.2 });
  const deck = manifest.sprites.at(-1)!;
  assert.equal(deck.destination, 'records', 'a player always opens records');
  assert.equal(deck.parts?.disc?.radius, 40);
  assert.deepEqual(manifestFiles(manifest).slice(-3), ['deck-body.png', 'deck-disc.png', 'deck-arm.png']);
  assert.ok(manifestFiles(manifest).includes('bird-down.png'));
  const armOnly = base();
  armOnly.sprites.push({
    id: 'deck', file: 'deck-body.png', rect: { x: 600, y: 1050, w: 200, h: 130 }, depth: 4, kind: 'player',
    parts: {
      body: { file: 'deck-body.png', rect: { x: 600, y: 1050, w: 200, h: 130 } },
      arm: { file: 'deck-arm.png', rect: { x: 740, y: 1060, w: 40, h: 70 }, pivot: { x: 770, y: 1070 }, restAngle: 0, playAngle: -22 },
    },
  } as never);
  const parsedArmOnly = parseManifest(armOnly);
  assert.equal(parsedArmOnly.sprites.at(-1)!.parts?.disc, undefined, 'the disc is optional');
  assert.deepEqual(manifestFiles(parsedArmOnly).slice(-2), ['deck-body.png', 'deck-arm.png']);
  const cases: [string, (raw: ReturnType<typeof base>) => unknown, RegExp][] = [
    ['caption on a layer', (r) => { (r.layers[0] as { caption?: unknown }).caption = { dx: 1, dy: 1 }; return r; }, /only props carry a caption/],
    ['caption without dy', (r) => { (r.sprites[2] as { caption?: unknown }).caption = { dx: 1 }; return r; }, /caption needs/],
    ['bad paper', (r) => { (r as { paper?: string }).paper = 'cream'; return r; }, /paper must be/],
    ['established outside', (r) => { (r as { established?: unknown }).established = { rect: { x: 1000, y: 0, w: 100, h: 10 } }; return r; }, /outside the canvas/],
    ['player without parts', (r) => { r.sprites.push({ id: 'p', file: 'p.png', rect: { x: 0, y: 0, w: 10, h: 10 }, depth: 4, kind: 'player' } as never); return r; }, /player needs parts/],
    ['player taking records twice', (r) => { r.sprites[2].destination = 'records'; r.sprites.push({ id: 'p', file: 'p.png', rect: { x: 0, y: 0, w: 10, h: 10 }, depth: 4, kind: 'player', parts: { body: { file: 'b.png', rect: { x: 0, y: 0, w: 10, h: 10 } }, disc: { file: 'd.png', centre: { x: 5, y: 5 }, radius: 2, tilt: 50, yaw: 0 }, arm: { file: 'a.png', rect: { x: 0, y: 0, w: 5, h: 5 }, pivot: { x: 1, y: 1 }, restAngle: 0, playAngle: -20 } } } as never); return r; }, /already taken/],
    ['parts on a prop', (r) => { (r.sprites[2] as { parts?: unknown }).parts = {}; return r; }, /only a player has parts/],
  ];
  for (const [name, mutate, message] of cases) assert.throws(() => parseManifest(mutate(base())), message, name);
});
