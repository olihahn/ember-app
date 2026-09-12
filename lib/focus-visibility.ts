export type VerticalBounds = { top: number; bottom: number };

/** Only reveal clipped fields; a visible field never moves merely to add space. */
export function focusedFieldScrollDelta(
  field: VerticalBounds,
  visible: VerticalBounds,
  margin = 12,
): number {
  if (
    ![field.top, field.bottom, visible.top, visible.bottom, margin].every(
      Number.isFinite,
    ) ||
    field.bottom <= field.top ||
    visible.bottom <= visible.top
  )
    return 0;
  if (field.top >= visible.top && field.bottom <= visible.bottom) return 0;
  const gap = Math.max(0, Math.min(margin, (visible.bottom - visible.top) / 4));
  // A tall textarea cannot fit in full. Keep its top visible without oscillating.
  if (field.bottom - field.top > visible.bottom - visible.top - gap * 2) {
    return field.top >= visible.top && field.top < visible.bottom
      ? 0
      : field.top - visible.top - gap;
  }
  return field.bottom > visible.bottom
    ? field.bottom - visible.bottom + gap
    : field.top - visible.top - gap;
}
