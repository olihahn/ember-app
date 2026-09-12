import type { CigarDraft, CigarEntry } from './types';

export type CigarStatus = 'humidor' | 'enjoyed';

/** Legacy records are intentionally unclassified, even if they have stars. */
export function statusOf(entry: Pick<CigarEntry, 'status'>) {
  return entry.status ?? 'unspecified';
}

/** The visible/sortable date is acquisition for stock and smoking for enjoyed. */
export function entryDate(entry: CigarEntry): string {
  return entry.status === 'humidor'
    ? entry.addedAt || entry.createdAt.slice(0, 10)
    : entry.smokedAt;
}

function validDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const value = new Date(`${day}T12:00:00Z`);
  return (
    Number.isFinite(value.valueOf()) && value.toISOString().slice(0, 10) === day
  );
}

/** Pure draft transition: callers must explicitly save before it is persisted. */
export function withStatus<T extends CigarDraft>(
  entry: T,
  status: CigarStatus,
  day: string,
): T {
  if (!validDay(day)) throw new Error('Choose a valid calendar date.');
  if (status !== 'humidor' && status !== 'enjoyed')
    throw new Error('Choose Humidor or Enjoyed.');
  const originalDay =
    'createdAt' in entry && typeof entry.createdAt === 'string'
      ? entry.createdAt.slice(0, 10)
      : day;
  return {
    ...entry,
    status,
    addedAt: entry.addedAt || (validDay(originalDay) ? originalDay : day),
    smokedAt: status === 'humidor' ? '' : entry.smokedAt || day,
  };
}
