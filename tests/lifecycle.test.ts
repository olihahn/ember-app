import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { statusOf, entryDate, withStatus } from '../lib/lifecycle.ts';
import {
  loadEntries,
  saveEntries,
  validateEntries,
  backupText,
  importJournalBackup,
} from '../lib/journal.ts';
import type { CigarEntry } from '../lib/types.ts';

const legacy: CigarEntry = {
  id: 'lifecycle-legacy',
  fullName: 'An existing cigar',
  brand: 'Test',
  country: 'Nicaragua',
  region: '',
  wrapper: '',
  strength: '',
  vitola: '',
  flavorNotes: [],
  photo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
  rating: 4,
  smokedAt: '2026-09-01',
  notes: 'Keep my note.',
  purchasePlace: 'Lisbon',
  purchaseLat: 38.72,
  purchaseLng: -9.13,
  createdAt: '2026-09-02T12:00:00.000Z',
  updatedAt: '2026-09-03T12:00:00.000Z',
  identification: {
    confidence: 'high',
    explanation: 'Saved evidence',
    sources: [{ title: 'Maker', url: 'https://example.com/cigar' }],
  },
};

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  await loadEntries();
});

void test('legacy records remain unclassified and byte-equivalent in storage and v1 backup', async () => {
  assert.equal(statusOf(legacy), 'unspecified');
  assert.equal(entryDate(legacy), '2026-09-01');
  assert.equal((await saveEntries([legacy])).ok, true);
  assert.deepEqual((await loadEntries()).entries, [legacy]);
  assert.equal(JSON.parse(backupText([legacy])).version, 1);
});

void test('new humidor record has no smoking date or invented rating and uses acquisition date', async () => {
  const stock = withStatus(
    { ...legacy, id: 'stock', rating: 0, smokedAt: '', addedAt: '2026-09-08' },
    'humidor',
    '2026-09-08',
  );
  assert.equal(stock.smokedAt, '');
  assert.equal(stock.rating, 0);
  assert.equal(entryDate(stock), '2026-09-08');
  assert.equal((await saveEntries([stock])).ok, true);
  assert.deepEqual((await loadEntries()).entries, [stock]);
});

void test('mark enjoyed and undo are explicit draft transitions preserving identity, photos and notes', () => {
  const stock = withStatus(legacy, 'humidor', '2026-09-08');
  assert.equal(legacy.smokedAt, '2026-09-01');
  const enjoyed = withStatus(stock, 'enjoyed', '2026-09-10');
  assert.equal(enjoyed.smokedAt, '2026-09-10');
  assert.equal(enjoyed.addedAt, '2026-09-02');
  const returned = withStatus(enjoyed, 'humidor', '2026-09-11');
  assert.equal(returned.smokedAt, '');
  for (const key of [
    'id',
    'photo',
    'rating',
    'notes',
    'purchasePlace',
    'purchaseLat',
    'purchaseLng',
    'createdAt',
    'identification',
  ] as const)
    assert.deepEqual(returned[key], legacy[key]);
});

void test('version 2 round trip preserves mixed legacy and stock records plus locked EST', async () => {
  const stock = withStatus(
    { ...legacy, id: 'stock', rating: 0 },
    'humidor',
    '2026-09-08',
  );
  const raw = backupText([legacy, stock], '2026-01-02');
  assert.equal(JSON.parse(raw).version, 2);
  const imported = await importJournalBackup(new File([raw], 'ember-v2.json'));
  assert.deepEqual(imported.entries, [legacy, stock]);
  assert.equal(
    (await saveEntries(imported.entries, imported.establishedOn)).ok,
    true,
  );
  const reloaded = await loadEntries();
  assert.deepEqual(reloaded.entries, [legacy, stock]);
  assert.equal(reloaded.establishedOn, '2026-01-02');
});

void test('invalid lifecycle metadata and impossible dates cannot overwrite saved records', async () => {
  await saveEntries([legacy]);
  const stock = withStatus(legacy, 'humidor', '2026-09-08');
  assert.throws(
    () => validateEntries([{ ...stock, status: 'maybe' }]),
    /status/,
  );
  assert.throws(
    () => validateEntries([{ ...stock, addedAt: '2026-02-30' }]),
    /date/,
  );
  assert.throws(
    () => validateEntries([{ ...stock, smokedAt: '2026-09-08' }]),
    /enjoyed date/,
  );
  assert.throws(
    () => validateEntries([{ ...stock, status: 'enjoyed' }]),
    /date/,
  );
  assert.throws(() => withStatus(stock, 'enjoyed', '2026-02-30'), /calendar/);
  assert.equal((await saveEntries([{ ...stock, addedAt: '' }])).ok, false);
  assert.deepEqual((await loadEntries()).entries, [legacy]);
});
