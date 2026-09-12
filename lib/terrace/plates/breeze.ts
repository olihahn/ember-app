/** Vertices at or below the anchor row, or within this many canvas px above it, never move. */
export const BREEZE_HOLD_PX = 60;
/** Above the hold band the weight ramps in over this fraction of the plate height. */
export const BREEZE_RAMP = 0.25;

/**
 * Reference for the breeze vertex shader: displacement weight for a vertex
 * `rise` units above the anchor row and `distance` units from the anchor,
 * with `reach` the farthest corner, `hold` the still band above the anchor
 * and `ramp` the distance over which movement fades in beyond it.
 */
export function breezeWeight(rise: number, distance: number, reach: number, hold: number, ramp = 0) {
  if (rise <= hold) return 0;
  const t = Math.min(1, Math.max(0, distance / reach));
  const weight = t * t * (3 - 2 * t);
  const r = ramp > 0 ? Math.min(1, Math.max(0, (rise - hold) / ramp)) : 1;
  const fade = r * r * (3 - 2 * r);
  return weight * Math.sqrt(weight) * fade;
}
