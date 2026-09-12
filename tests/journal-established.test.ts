import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import {
  backupText,
  getJournalEstablishedOn,
  importJournal,
  importJournalBackup,
  loadEntries,
  saveEntries,
} from '../lib/journal.ts';
import type { CigarEntry } from '../lib/types.ts';

const entry: CigarEntry = {
  id: 'est-test',
  fullName: 'A saved cigar',
  brand: '',
  country: 'Honduras',
  region: '',
  wrapper: '',
  strength: '',
  vitola: '',
  flavorNotes: [],
  photo: '',
  rating: 4,
  smokedAt: '2020-01-02',
  notes: 'Keep this note.',
  purchasePlace: '',
  purchaseLat: null,
  purchaseLng: null,
  createdAt: '2020-01-03T12:00:00.000Z',
  updatedAt: '2020-01-03T12:00:00.000Z',
};

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  await loadEntries();
});

async function setSnapshot(snapshot: unknown) {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('ember-journal', 1);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('snapshots', 'readwrite');
      tx.objectStore('snapshots').put(snapshot, 'journal');
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    };
    request.onerror = () => reject(request.error);
  });
}

void test('EST stays unset until the first successful real save and records its local calendar day', async (context) => {
  context.mock.timers.enable({
    apis: ['Date'],
    now: new Date('2026-09-08T12:00:00Z'),
  });
  assert.equal((await loadEntries()).establishedOn, null);
  await saveEntries([]);
  assert.equal(getJournalEstablishedOn(), null);
  assert.equal((await saveEntries([{ ...entry, rating: 9 }])).ok, false);
  assert.equal(getJournalEstablishedOn(), null);
  assert.equal((await saveEntries([entry])).ok, true);
  const now = new Date();
  const localDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  assert.equal((await loadEntries()).establishedOn, localDay);
  assert.notEqual(localDay, entry.createdAt.slice(0, 10));
});

void test('editing, deleting every entry, reloading, and a later new save never reset EST', async (context) => {
  context.mock.timers.enable({
    apis: ['Date'],
    now: new Date('2026-09-08T12:00:00Z'),
  });
  await saveEntries([entry]);
  const locked = getJournalEstablishedOn();
  context.mock.timers.setTime(new Date('2026-10-15T12:00:00Z').getTime());
  await saveEntries([
    { ...entry, notes: 'Edited later.', createdAt: '2026-10-15T12:00:00.000Z' },
  ]);
  assert.equal((await loadEntries()).establishedOn, locked);
  await saveEntries([]);
  assert.deepEqual((await loadEntries()).entries, []);
  assert.equal(getJournalEstablishedOn(), locked);
  await saveEntries([{ ...entry, id: 'new-cigar' }]);
  assert.equal((await loadEntries()).establishedOn, locked);
});

void test('legacy journal uses earliest creation day, then retains it when that entry is removed', async () => {
  const later = {
    ...entry,
    id: 'later',
    createdAt: '2024-01-01T12:00:00.000Z',
  };
  await setSnapshot({ version: 1, revision: 3, entries: [later, entry] });
  assert.equal((await loadEntries()).establishedOn, '2020-01-03');
  await saveEntries([later]);
  assert.equal((await loadEntries()).establishedOn, '2020-01-03');
  assert.deepEqual((await loadEntries()).entries, [later]);
});

void test('an older import cannot replace the date of an established destination', async () => {
  await saveEntries([entry], '2024-05-06');
  await saveEntries([entry, { ...entry, id: 'imported' }], '2001-02-03');
  assert.equal((await loadEntries()).establishedOn, '2024-05-06');
});

void test('version 1 backups carry a locked EST even after all entries were deleted', async () => {
  const backup = await importJournalBackup(
    new File([backupText([], '2017-06-09')], 'empty-journal.json'),
  );
  assert.deepEqual(backup, { entries: [], establishedOn: '2017-06-09' });
  assert.equal(
    (await saveEntries(backup.entries, backup.establishedOn)).ok,
    true,
  );
  assert.equal((await loadEntries()).establishedOn, '2017-06-09');
  await saveEntries([entry]);
  assert.equal((await loadEntries()).establishedOn, '2017-06-09');
});

void test('old backups and the existing entries-only import API remain compatible', async () => {
  const file = new File([backupText([entry])], 'old-backup.json');
  assert.deepEqual(await importJournal(file), [entry]);
  const backup = await importJournalBackup(file);
  assert.equal(backup.establishedOn, '2020-01-03');
  await saveEntries(backup.entries, backup.establishedOn);
  assert.deepEqual((await loadEntries()).entries, [entry]);
  assert.equal(getJournalEstablishedOn(), '2020-01-03');
});

void test('invalid metadata and failed conflicting writes cannot establish a date', async () => {
  const invalid = new File(
    [
      JSON.stringify({
        app: 'ember',
        version: 1,
        establishedOn: '2026-02-30',
        entries: [entry],
      }),
    ],
    'bad-date.json',
  );
  await assert.rejects(importJournalBackup(invalid), /date/);
  assert.equal(getJournalEstablishedOn(), null);
  await setSnapshot({
    version: 1,
    revision: 2,
    establishedOn: '2021-05-06',
    entries: [entry],
  });
  assert.equal((await saveEntries([entry])).ok, false);
  assert.equal(getJournalEstablishedOn(), null);
  assert.equal((await loadEntries()).establishedOn, '2021-05-06');
});
