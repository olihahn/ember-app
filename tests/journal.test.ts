import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import {
  backupText,
  importJournal,
  loadEntries,
  saveEntries,
  validateEntries,
} from '../lib/journal.ts';
import type { CigarEntry } from '../lib/types.ts';

const entry: CigarEntry = {
  id: 'test-entry',
  fullName: 'Test cigar',
  brand: 'Test',
  country: 'Nicaragua',
  region: '',
  wrapper: '',
  strength: 'Medium',
  vitola: '',
  flavorNotes: ['cedar'],
  photo: '',
  rating: 4,
  smokedAt: '2026-09-07',
  notes: 'A test note.',
  purchasePlace: 'Test location',
  purchaseLat: 12.9,
  purchaseLng: -85.1,
  createdAt: '2026-09-07T12:00:00.000Z',
  updatedAt: '2026-09-07T12:00:00.000Z',
  identification: {
    confidence: 'medium',
    explanation: 'Test evidence.',
    sources: [{ title: 'Test source', url: 'https://example.com/cigar' }],
  },
};
beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  await loadEntries();
});

async function changeSnapshot(value: unknown) {
  await new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('ember-journal', 1);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('snapshots', 'readwrite');
      tx.objectStore('snapshots').put(value, 'journal');
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => reject(tx.error);
    };
  });
}

void test('entries, photo bytes, rating, location and sources survive a storage round trip', async () => {
  const withPhoto = {
    ...entry,
    photo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
  };
  assert.deepEqual(await saveEntries([withPhoto]), { ok: true });
  assert.deepEqual((await loadEntries()).entries, [withPhoto]);
});
void test('editing replaces an entry and delete/restore preserves identity', async () => {
  await saveEntries([entry]);
  const edited = { ...entry, notes: 'Changed.', rating: 5 };
  assert.equal((await saveEntries([edited])).ok, true);
  assert.equal((await loadEntries()).entries[0].rating, 5);
  assert.equal((await saveEntries([])).ok, true);
  assert.equal((await loadEntries()).entries.length, 0);
  await saveEntries([edited]);
  assert.deepEqual((await loadEntries()).entries, [edited]);
});
void test('invalid incoming entry does not overwrite a valid stored journal', async () => {
  await saveEntries([entry]);
  const failed = await saveEntries([{ ...entry, rating: 8 }]);
  assert.equal(failed.ok, false);
  assert.deepEqual((await loadEntries()).entries, [entry]);
});
void test('corrupt stored journal is preserved and further writes are blocked', async () => {
  await changeSnapshot({
    version: 1,
    revision: 4,
    entries: [{ broken: true }],
  });
  assert.ok((await loadEntries()).error);
  assert.equal((await saveEntries([entry])).ok, false);
  assert.ok((await loadEntries()).error);
});
void test('stale tab cannot overwrite newer data; reload recovers safely', async () => {
  await saveEntries([entry]);
  const otherEntry = { ...entry, notes: 'Saved in another tab.' };
  await changeSnapshot({ version: 1, revision: 2, entries: [otherEntry] });
  const stale = await saveEntries([{ ...entry, notes: 'Stale edit.' }]);
  assert.equal(stale.ok, false);
  assert.match(stale.error ?? '', /another tab/);
  assert.deepEqual((await loadEntries()).entries, [otherEntry]);
  assert.equal((await saveEntries([otherEntry])).ok, true);
});
void test('backup export/import round-trip includes original photo and identification evidence', async () => {
  const file = new File([backupText([entry])], 'ember.json', {
    type: 'application/json',
  });
  assert.deepEqual(await importJournal(file), [entry]);
});
void test('invalid backup, duplicate IDs, unsafe links and bad dates are rejected', async () => {
  await assert.rejects(
    importJournal(
      new File(['{"app":"another","version":1,"entries":[]}'], 'bad.json'),
    ),
  );
  await assert.rejects(importJournal(new File(['invalid'], 'bad.json')));
  assert.throws(() => validateEntries([entry, entry]), /duplicate/);
  assert.throws(
    () => validateEntries([{ ...entry, smokedAt: '2026-02-30' }]),
    /date/,
  );
  assert.throws(
    () => validateEntries([{ ...entry, purchaseLat: null }]),
    /both/,
  );
  assert.throws(
    () =>
      validateEntries([
        { ...entry, photo: 'https://tracker.example/photo.png' },
      ]),
    /embedded image/,
  );
  assert.throws(
    () =>
      validateEntries([
        {
          ...entry,
          identification: {
            ...entry.identification,
            sources: [{ title: 'bad', url: 'javascript:alert(1)' }],
          },
        },
      ]),
    /unsafe/,
  );
});
