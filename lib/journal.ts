import type { CigarEntry, IdentificationEvidence } from './types';
import { Capacitor } from '@capacitor/core';
import { EmberNative } from './native-bridge';

const DATABASE = 'ember-journal';
const STORE = 'snapshots';
const MAX_PHOTO_LENGTH = 4_000_000;
const MAX_ENTRIES = 10_000;
let revision: number | null = null;
let writable = false;
let establishedOn: string | null = null;

export function getJournalEstablishedOn(): string | null {
  return establishedOn;
}

function localCalendarDay(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Old backups have no journal metadata; their earliest recorded save is the best available origin. */
function readEstablishedOn(
  value: unknown,
  entries: CigarEntry[],
): string | null {
  if (value !== undefined && value !== null)
    return date(value, 'journal establishment date', true);
  return entries.reduce<string | null>((earliest, entry) => {
    const day = entry.createdAt.slice(0, 10);
    return earliest === null || day < earliest ? day : earliest;
  }, null);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(
      'This backup has an invalid entry. Your journal has not been changed.',
    );
  return value as Record<string, unknown>;
}
function string(
  value: unknown,
  label: string,
  max = 300,
  required = false,
): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new Error(
      `Please check ${label}. Your journal has not been changed.`,
    );
  return value;
}
function stringList(value: unknown, label: string, maxCount = 20): string[] {
  if (!Array.isArray(value) || value.length > maxCount)
    throw new Error(`Please check ${label}.`);
  return value.map((v) => string(v, label, 300));
}
function coordinate(value: unknown, limit: number): number | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    Math.abs(value) > limit
  )
    throw new Error(
      'A map coordinate is invalid. Your journal has not been changed.',
    );
  return value;
}
function date(value: unknown, label: string, dayOnly = false): string {
  const text = string(value, label, 40, true);
  const parsed = new Date(text);
  if (
    !Number.isFinite(parsed.valueOf()) ||
    (dayOnly &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(text) ||
        parsed.toISOString().slice(0, 10) !== text))
  )
    throw new Error(`Please check ${label}.`);
  return dayOnly ? text : parsed.toISOString();
}
function evidence(value: unknown): IdentificationEvidence | undefined {
  if (value === undefined) return undefined;
  const item = object(value);
  if (!['high', 'medium', 'low'].includes(String(item.confidence)))
    throw new Error('This backup has invalid identification information.');
  if (!Array.isArray(item.sources) || item.sources.length > 20)
    throw new Error('This backup has invalid sources.');
  const sources = item.sources.map((source) => {
    const s = object(source);
    const url = string(s.url, 'source URL', 2048, true);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('This backup has an invalid source link.');
    }
    if (
      !['https:', 'http:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      throw new Error('This backup has an unsafe source link.');
    return { title: string(s.title, 'source title', 500), url };
  });
  return {
    confidence: item.confidence as IdentificationEvidence['confidence'],
    explanation: string(item.explanation, 'identification explanation', 4000),
    sources,
    ...(item.alternatives
      ? { alternatives: stringList(item.alternatives, 'alternatives', 10) }
      : {}),
  };
}

export function validateEntries(value: unknown): CigarEntry[] {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES)
    throw new Error(
      'Choose an Ember journal backup with at most 10,000 entries.',
    );
  const ids = new Set<string>();
  return value.map((raw) => {
    const e = object(raw);
    const id = string(e.id, 'entry ID', 100, true);
    if (ids.has(id))
      throw new Error(
        'This backup has duplicate entries. Your journal has not been changed.',
      );
    ids.add(id);
    const photo = string(e.photo, 'photo', MAX_PHOTO_LENGTH);
    if (
      photo &&
      !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(photo)
    )
      throw new Error(
        'A photo in this backup is not a supported embedded image.',
      );
    if (
      typeof e.rating !== 'number' ||
      !Number.isInteger(e.rating) ||
      e.rating < 0 ||
      e.rating > 5
    )
      throw new Error('Ratings must be between 1 and 5 stars, or unrated.');
    const purchaseLat = coordinate(e.purchaseLat, 90);
    const purchaseLng = coordinate(e.purchaseLng, 180);
    if ((purchaseLat === null) !== (purchaseLng === null))
      throw new Error('A map pin needs both latitude and longitude.');
    if (
      e.status !== undefined &&
      e.status !== 'humidor' &&
      e.status !== 'enjoyed'
    )
      throw new Error('An entry has an invalid Humidor / Enjoyed status.');
    const lifecycle: Pick<CigarEntry, 'status' | 'addedAt'> =
      e.status === undefined
        ? {}
        : {
            status: e.status,
            addedAt: date(e.addedAt, 'date added', true),
          };
    if (e.status === 'humidor' && e.smokedAt !== '')
      throw new Error(
        'A cigar in the humidor cannot also have an enjoyed date.',
      );
    return {
      id,
      fullName: string(e.fullName, 'cigar name', 300, true),
      brand: string(e.brand, 'brand'),
      country: string(e.country, 'country'),
      region: string(e.region, 'region'),
      wrapper: string(e.wrapper, 'wrapper'),
      strength: string(e.strength, 'strength'),
      vitola: string(e.vitola, 'size'),
      flavorNotes: stringList(e.flavorNotes, 'flavor notes'),
      photo,
      rating: e.rating,
      smokedAt:
        e.status === 'humidor' ? '' : date(e.smokedAt, 'smoked date', true),
      notes: string(e.notes, 'notes', 20_000),
      purchasePlace: string(e.purchasePlace, 'purchase place', 500),
      purchaseLat,
      purchaseLng,
      createdAt: date(e.createdAt, 'creation date'),
      updatedAt: date(e.updatedAt, 'update date'),
      ...(e.identification
        ? { identification: evidence(e.identification) }
        : {}),
      ...lifecycle,
    };
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(
        new Error(
          'This browser cannot open device storage. Try Chrome in a regular browser window.',
        ),
      );
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(
        new Error('Close other Ember tabs, then reload to open your journal.'),
      );
  });
}

export async function loadEntries(): Promise<{
  entries: CigarEntry[];
  establishedOn?: string | null;
  error?: string;
}> {
  try {
    const db = await openDatabase();
    const result = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get('journal');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    });
    if (result === undefined) {
      revision = 0;
      writable = true;
      establishedOn = null;
      return { entries: [], establishedOn };
    }
    const snapshot = object(result);
    if (
      (snapshot.version !== 1 && snapshot.version !== 2) ||
      typeof snapshot.revision !== 'number'
    )
      throw new Error(
        'This journal uses an unsupported storage version. Keep this browser data and restore a compatible backup.',
      );
    const entries = validateEntries(snapshot.entries);
    establishedOn = readEstablishedOn(snapshot.establishedOn, entries);
    revision = snapshot.revision;
    writable = true;
    return { entries, establishedOn };
  } catch (error) {
    writable = false;
    establishedOn = null;
    return {
      entries: [],
      error:
        error instanceof Error
          ? error.message
          : 'Your journal could not be opened. Please reload; existing data has been preserved.',
    };
  }
}

export async function saveEntries(
  entries: CigarEntry[],
  importedEstablishedOn?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!writable || revision === null)
      throw new Error(
        'Reload your journal before saving. Existing data has been preserved.',
      );
    const checked = validateEntries(entries);
    const importedDay =
      importedEstablishedOn == null
        ? null
        : date(importedEstablishedOn, 'journal establishment date', true);
    const nextEstablishedOn =
      establishedOn ??
      importedDay ??
      (checked.length ? localCalendarDay() : null);
    const db = await openDatabase();
    const expectedRevision = revision;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const get = store.get('journal');
      let conflict = false;
      get.onsuccess = () => {
        const actual = get.result?.revision ?? 0;
        if (actual !== expectedRevision) {
          conflict = true;
          tx.abort();
          return;
        }
        store.put(
          {
            version: checked.some((entry) => entry.status !== undefined)
              ? 2
              : 1,
            revision: actual + 1,
            entries: checked,
            ...(nextEstablishedOn ? { establishedOn: nextEstablishedOn } : {}),
          },
          'journal',
        );
      };
      tx.oncomplete = () => {
        revision = expectedRevision + 1;
        establishedOn = nextEstablishedOn;
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        reject(
          conflict
            ? new Error(
                'Your journal changed in another tab. Use Download this entry to keep your draft, then reload before saving.',
              )
            : tx.error,
        );
      };
      tx.onerror = () => {
        /* onabort is the single error completion path */
      };
    });
    if (typeof navigator !== 'undefined')
      void navigator.storage?.persist?.().catch(() => undefined);
    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'QuotaExceededError'
        ? 'Device storage is full. Export a backup and free some space, then try saving again. Your previous journal is safe.'
        : error instanceof Error
          ? error.message
          : 'The entry could not be saved. Your previous journal is safe.';
    return { ok: false, error: message };
  }
}

export function backupText(
  entries: CigarEntry[],
  journalEstablishedOn?: string | null,
): string {
  const checked = validateEntries(entries);
  return JSON.stringify(
    {
      app: 'ember',
      version: checked.some((entry) => entry.status !== undefined) ? 2 : 1,
      exportedAt: new Date().toISOString(),
      entries: checked,
      ...(journalEstablishedOn
        ? {
            establishedOn: date(
              journalEstablishedOn,
              'journal establishment date',
              true,
            ),
          }
        : {}),
    },
    null,
    2,
  );
}

export async function exportJournal(
  entries: CigarEntry[],
  journalEstablishedOn?: string | null,
): Promise<boolean> {
  const contents = backupText(entries, journalEstablishedOn);
  const filename = `ember-journal-${new Date().toISOString().slice(0, 10)}.json`;
  if (Capacitor.isNativePlatform()) {
    return (await EmberNative.saveBackup({ filename, contents })).saved;
  }
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

export async function importJournal(file: File): Promise<CigarEntry[]> {
  return (await importJournalBackup(file)).entries;
}

export async function importJournalBackup(
  file: File,
): Promise<{ entries: CigarEntry[]; establishedOn: string | null }> {
  if (file.size > 100 * 1024 * 1024)
    throw new Error(
      'This backup exceeds 100 MB. Import a smaller Ember backup.',
    );
  let value: Record<string, unknown>;
  try {
    value = object(JSON.parse(await file.text()));
  } catch {
    throw new Error(
      'That file is not a valid Ember backup. Your journal has not been changed.',
    );
  }
  if (value.app !== 'ember' || (value.version !== 1 && value.version !== 2))
    throw new Error(
      'Choose a version 1 or 2 Ember journal backup. Your journal has not been changed.',
    );
  const entries = validateEntries(value.entries);
  return {
    entries,
    establishedOn: readEstablishedOn(value.establishedOn, entries),
  };
}
