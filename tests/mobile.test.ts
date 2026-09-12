import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import {
  saveCameraRecovery,
  readCameraRecovery,
  clearCameraRecovery,
  photoFileFromResult,
} from '../lib/mobile.ts';
import type { CigarDraft } from '../lib/types.ts';

const draft: CigarDraft = {
  fullName: 'Camera recovery test',
  brand: 'Test',
  country: 'Nicaragua',
  region: '',
  wrapper: '',
  strength: '',
  vitola: '',
  flavorNotes: [],
  photo: '',
  rating: 4,
  smokedAt: '2026-09-07',
  notes: 'Keep my notes.',
  purchasePlace: '',
  purchaseLat: null,
  purchaseLng: null,
};
const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { href: 'https://localhost/', origin: 'https://localhost' },
    },
  });
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow)
    Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

void test('camera recovery preserves the complete draft and edit identity', async () => {
  assert.equal(await readCameraRecovery(), undefined);
  await saveCameraRecovery(draft, 'existing-entry');
  const saved = await readCameraRecovery();
  assert.deepEqual(saved?.draft, draft);
  assert.equal(saved?.editingId, 'existing-entry');
  assert.ok(saved && Math.abs(Date.now() - saved.savedAt) < 1000);
});

void test('camera recovery replaces only its own pending draft and clears on return', async () => {
  await saveCameraRecovery(draft, 'old');
  const next = { ...draft, notes: 'New camera draft.' };
  await saveCameraRecovery(next, null);
  assert.deepEqual((await readCameraRecovery())?.draft, next);
  assert.equal((await readCameraRecovery())?.editingId, null);
  await clearCameraRecovery();
  assert.equal(await readCameraRecovery(), undefined);
});

void test('camera recovery does not reopen a draft older than a day', async (context) => {
  const now = Date.now();
  context.mock.method(Date, 'now', () => now - 25 * 60 * 60 * 1000);
  await saveCameraRecovery(draft, null);
  context.mock.restoreAll();
  assert.equal(await readCameraRecovery(), undefined);
});

void test('native photo requires a readable local result', async () => {
  await assert.rejects(photoFileFromResult(null), /No photo/);
  await assert.rejects(photoFileFromResult({}), /readable photo/);
});

void test('external photo URLs are rejected before any network access', async () => {
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    throw new Error('Unexpected network');
  };
  await assert.rejects(
    photoFileFromResult({ webPath: 'https://example.com/private.jpg' }),
    /this device/,
  );
  assert.equal(requests, 0);
});

void test('native camera result becomes a locally readable image file', async () => {
  globalThis.fetch = async (input) => {
    assert.ok(input instanceof URL);
    assert.equal(input.href, 'https://localhost/_capacitor_file_/cigar.jpg');
    return new Response(new Uint8Array([255, 216, 255, 217]), {
      headers: { 'Content-Type': 'image/jpeg' },
    });
  };
  const photo = await photoFileFromResult({
    webPath: '/_capacitor_file_/cigar.jpg',
  });
  assert.equal(photo.type, 'image/jpeg');
  assert.equal(photo.size, 4);
  assert.equal(photo.name, 'cigar-photo.jpg');
});

void test('unreadable native photo reports failure instead of an empty attachment', async () => {
  globalThis.fetch = async () => new Response('', { status: 404 });
  await assert.rejects(
    photoFileFromResult({ webPath: '/missing.jpg' }),
    /could not be opened/,
  );
});
