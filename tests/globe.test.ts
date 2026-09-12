import test from 'node:test';
import assert from 'node:assert/strict';
import { geoOrthographic } from 'd3-geo';
import {
  INITIAL_GLOBE_ROTATION,
  clampGlobeRotation,
  classifyGlobeGesture,
  dragGlobeRotation,
  globePointDepth,
  interpolateGlobeRotation,
  isGlobePointVisible,
  keyboardGlobeRotation,
  rotationForGlobePoint,
  wrapGlobeLongitude,
} from '../lib/globe-geometry.ts';
import { groupGlobePins } from '../lib/globe-pins.ts';
import type { CigarEntry } from '../lib/types.ts';

const entry: CigarEntry = {
  id: 'globe-test',
  fullName: 'A cigar',
  brand: '',
  country: 'Nicaragua',
  region: '',
  wrapper: '',
  strength: '',
  vitola: '',
  flavorNotes: [],
  photo: '',
  rating: 4,
  smokedAt: '2026-09-08',
  notes: '',
  purchasePlace: '',
  purchaseLat: null,
  purchaseLng: null,
  createdAt: '2026-09-08T12:00:00Z',
  updatedAt: '2026-09-08T12:00:00Z',
};

void test('orthographic pins on the rear hemisphere and exact horizon are hidden', () => {
  assert.equal(isGlobePointVisible([0, 0], [0, 0, 0]), true);
  assert.equal(isGlobePointVisible([180, 0], [0, 0, 0]), false);
  assert.equal(isGlobePointVisible([90, 0], [0, 0, 0]), false);
  assert.equal(isGlobePointVisible([-85, 13], INITIAL_GLOBE_ROTATION), true);
  assert.equal(
    isGlobePointVisible([139.7, 35.7], INITIAL_GLOBE_ROTATION),
    false,
  );
});

void test('selecting any longitude rotates that place to the front using real d3 rotation', () => {
  for (const point of [
    [-85, 13],
    [139.7, 35.7],
    [179.9, -45],
    [-179.9, 60],
  ] as [number, number][]) {
    const rotation = rotationForGlobePoint(point);
    assert.ok(globePointDepth(point, rotation) > 0.9999);
    const projected = geoOrthographic().rotate(rotation).translate([0, 0])(
      point,
    )!;
    assert.ok(Math.abs(projected[0]) < 0.0001);
    assert.ok(Math.abs(projected[1]) < 0.0001);
  }
});

void test('tilt stops before inversion while pole locations remain selectable', () => {
  assert.deepEqual(clampGlobeRotation([725, 1000, 35]), [5, 85, 0]);
  assert.deepEqual(clampGlobeRotation([-725, -1000, -35]), [-5, -85, 0]);
  assert.equal(
    isGlobePointVisible([0, 90], rotationForGlobePoint([0, 90])),
    true,
  );
  assert.equal(
    isGlobePointVisible([0, -90], rotationForGlobePoint([0, -90])),
    true,
  );
});

void test('longitude wrapping and selection animation take the short path across the date line', () => {
  assert.equal(wrapGlobeLongitude(181), -179);
  assert.equal(wrapGlobeLongitude(-181), 179);
  assert.deepEqual(
    interpolateGlobeRotation([170, 0, 0], [-170, 20, 0], 0.5),
    [-180, 10, 0],
  );
  assert.deepEqual(
    interpolateGlobeRotation([170, 0, 0], [-170, 20, 0], 2),
    [-170, 20, 0],
  );
});

void test('touch direction preserves vertical scrolling and small taps', () => {
  assert.equal(classifyGlobeGesture(3, 2, true), 'pending');
  assert.equal(classifyGlobeGesture(30, 4, true), 'rotate');
  assert.equal(classifyGlobeGesture(4, 30, true), 'scroll');
  assert.equal(classifyGlobeGesture(12, 12, true), 'scroll');
  assert.equal(classifyGlobeGesture(0, 10, false), 'rotate');
});

void test('dragging follows the hand in two axes and is proportional to visible radius', () => {
  const desktop = dragGlobeRotation([0, 0, 0], 100, 20, 200);
  const phone = dragGlobeRotation([0, 0, 0], 50, 10, 100);
  assert.deepEqual(desktop, phone);
  assert.deepEqual(desktop, [35, -7, 0]);
  assert.equal(dragGlobeRotation([0, 0, 0], 0, -1000, 100)[1], 85);
});

void test('keyboard arrows rotate, Home resets, and unrelated keys are left alone', () => {
  assert.deepEqual(keyboardGlobeRotation([0, 0, 0], 'ArrowRight'), [12, 0, 0]);
  assert.deepEqual(keyboardGlobeRotation([0, 0, 0], 'ArrowUp'), [0, 12, 0]);
  assert.deepEqual(
    keyboardGlobeRotation([-70, 40, 0], 'Home'),
    INITIAL_GLOBE_ROTATION,
  );
  assert.equal(keyboardGlobeRotation([0, 0, 0], 'Tab'), null);
});

void test('origin aliases preserve grouped counts, names, and approximate cigar-country pins', () => {
  const result = groupGlobePins(
    [
      { ...entry, country: 'Dominican Republic', fullName: 'First' },
      { ...entry, country: ' DR ', fullName: 'Second' },
      { ...entry, country: 'dominican rep.', fullName: 'Third' },
      { ...entry, country: 'nicaragua' },
      { ...entry, country: 'USA' },
      { ...entry, country: 'United States' },
      { ...entry, country: 'UK' },
      { ...entry, country: 'the bahamas' },
      { ...entry, country: 'côte d’ivoire' },
      { ...entry, country: '' },
      { ...entry, country: 'Unknown place' },
    ],
    'origin',
  );
  assert.equal(result.missing, 2);
  assert.equal(result.pins.length, 6);
  assert.equal(result.pins[0].label, 'Dominican Republic');
  assert.equal(result.pins[0].count, 3);
  assert.deepEqual(result.pins[0].names, ['First', 'Second', 'Third']);
  assert.deepEqual(result.pins[0].coordinates, [-70.2, 18.9]);
  assert.deepEqual(result.pins[1].coordinates, [-85, 13]);
  assert.equal(result.pins[2].count, 2);
});

void test('purchase places use explicit coordinates, retain three-decimal grouping, and do not infer from origin', () => {
  const result = groupGlobePins(
    [
      {
        ...entry,
        purchasePlace: 'Tokyo shop',
        purchaseLng: 139.7,
        purchaseLat: 35.7,
      },
      {
        ...entry,
        purchasePlace: 'Same location',
        purchaseLng: 139.7001,
        purchaseLat: 35.7001,
      },
      { ...entry, purchaseLng: 0, purchaseLat: 0 },
      entry,
      { ...entry, purchaseLng: Number.NaN, purchaseLat: 15 },
      { ...entry, purchaseLng: 20, purchaseLat: 91 },
    ],
    'purchase',
  );
  assert.equal(result.missing, 3);
  assert.equal(result.pins.length, 2);
  assert.equal(result.pins[0].label, 'Tokyo shop');
  assert.equal(result.pins[0].count, 2);
  assert.deepEqual(result.pins[0].coordinates, [139.7, 35.7]);
  assert.equal(result.pins[1].label, 'Saved place');
  assert.deepEqual(result.pins[1].coordinates, [0, 0]);
});
