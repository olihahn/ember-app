export function deckIndex(ids: string[], selected: string | null): number {
  return Math.max(0, selected === null ? 0 : ids.indexOf(selected));
}

export function deckPage(
  index: number,
  direction: number,
  count: number,
): number {
  return Math.max(0, Math.min(Math.max(0, count - 1), index + direction));
}

export function deckSwipeDirection(
  x: number,
  y: number,
  width: number,
): -1 | 0 | 1 {
  if (![x, y, width].every(Number.isFinite) || width <= 0) return 0;
  const threshold = Math.max(36, Math.min(80, width * 0.18));
  if (Math.abs(x) < threshold || Math.abs(x) < Math.abs(y) * 1.2) return 0;
  return x < 0 ? 1 : -1;
}
