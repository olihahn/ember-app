import test from 'node:test';
import assert from 'node:assert/strict';
import {
  constrainPhotoView,
  FIT_PHOTO_VIEW,
  fitPhotoSize,
  zoomPhotoView,
} from '../lib/photo-view.ts';

const tallPhoto = { width: 4000, height: 6000 };
const phonePreview = { width: 360, height: 225 };

void test('a tall photo fits completely in a wide phone viewport', () => {
  assert.deepEqual(fitPhotoSize(tallPhoto, phonePreview), {
    width: 150,
    height: 225,
  });
  assert.deepEqual(
    constrainPhotoView(FIT_PHOTO_VIEW, tallPhoto, phonePreview),
    FIT_PHOTO_VIEW,
  );
});

void test('a landscape photo fits without clipping its sides', () => {
  assert.deepEqual(fitPhotoSize({ width: 6000, height: 2000 }, phonePreview), {
    width: 360,
    height: 120,
  });
});

void test('zoomed portrait panning reaches both ends without losing the image', () => {
  assert.deepEqual(
    constrainPhotoView({ zoom: 2, x: 900, y: 900 }, tallPhoto, phonePreview),
    { zoom: 2, x: 0, y: 112.5 },
  );
  assert.deepEqual(
    constrainPhotoView({ zoom: 2, x: -900, y: -900 }, tallPhoto, phonePreview),
    { zoom: 2, x: 0, y: -112.5 },
  );
});

void test('zooming keeps the chosen image point at the center and fit resets pan', () => {
  const zoomed = zoomPhotoView(
    { zoom: 2, x: 0, y: 50 },
    3,
    tallPhoto,
    phonePreview,
  );
  assert.deepEqual(zoomed, { zoom: 3, x: 0, y: 75 });
  assert.deepEqual(
    zoomPhotoView(zoomed, 1, tallPhoto, phonePreview),
    FIT_PHOTO_VIEW,
  );
});

void test('viewport resizing preserves valid pan and zoom stays within the controls', () => {
  const resized = constrainPhotoView({ zoom: 3, x: 100, y: 100 }, tallPhoto, {
    width: 800,
    height: 300,
  });
  assert.deepEqual(resized, { zoom: 3, x: 0, y: 100 });
  assert.equal(
    zoomPhotoView(FIT_PHOTO_VIEW, 20, tallPhoto, phonePreview).zoom,
    5,
  );
  assert.deepEqual(
    zoomPhotoView(resized, 0, tallPhoto, phonePreview),
    FIT_PHOTO_VIEW,
  );
});
