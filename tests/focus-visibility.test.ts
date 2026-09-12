import test from 'node:test';
import assert from 'node:assert/strict';
import { focusedFieldScrollDelta } from '../lib/focus-visibility.ts';

void test('captured Android search is scrolled above app navigation, not merely inside the WebView', () => {
  const search = { top: 1346, bottom: 1459 };
  const webView = { top: 136, bottom: 1517 };
  const nav = { top: 1335, bottom: 1520 };
  assert.equal(focusedFieldScrollDelta(search, webView), 0);
  const delta = focusedFieldScrollDelta(search, {
    top: webView.top,
    bottom: nav.top,
  });
  assert.equal(delta, 136);
  assert.equal(search.bottom - delta, nav.top - 12);
});

void test('visible fields, including ones near an edge, do not jump', () => {
  assert.equal(
    focusedFieldScrollDelta(
      { top: 300, bottom: 344 },
      { top: 100, bottom: 600 },
    ),
    0,
  );
  assert.equal(
    focusedFieldScrollDelta(
      { top: 556, bottom: 600 },
      { top: 100, bottom: 600 },
    ),
    0,
  );
});

void test('a modal field is minimally revealed above its footer or below its header', () => {
  assert.equal(
    focusedFieldScrollDelta(
      { top: 440, bottom: 484 },
      { top: 100, bottom: 460 },
    ),
    36,
  );
  assert.equal(
    focusedFieldScrollDelta(
      { top: 90, bottom: 134 },
      { top: 100, bottom: 460 },
    ),
    -22,
  );
});

void test('keyboard dismissal does not move the still-focused, now-visible search', () => {
  assert.equal(
    focusedFieldScrollDelta(
      { top: 1210, bottom: 1323 },
      { top: 136, bottom: 2154 },
    ),
    0,
  );
});

void test('an oversized textarea remains stable once its top is visible', () => {
  const visible = { top: 100, bottom: 280 };
  const offscreen = { top: 300, bottom: 600 };
  const delta = focusedFieldScrollDelta(offscreen, visible);
  assert.equal(delta, 188);
  assert.equal(
    focusedFieldScrollDelta(
      { top: offscreen.top - delta, bottom: offscreen.bottom - delta },
      visible,
    ),
    0,
  );
});

void test('hidden or unmeasurable bounds cannot initiate a scroll', () => {
  assert.equal(
    focusedFieldScrollDelta({ top: 0, bottom: 0 }, { top: 0, bottom: 400 }),
    0,
  );
  assert.equal(
    focusedFieldScrollDelta(
      { top: 90, bottom: 134 },
      { top: 100, bottom: 100 },
    ),
    0,
  );
  assert.equal(
    focusedFieldScrollDelta(
      { top: Number.NaN, bottom: 134 },
      { top: 100, bottom: 400 },
    ),
    0,
  );
});
