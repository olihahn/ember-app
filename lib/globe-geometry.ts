import { geoRotation } from 'd3-geo';

export type GlobeRotation = [number, number, number];
export type GlobePoint = [number, number];
export type GlobeGesture = 'pending' | 'rotate' | 'scroll';

export const INITIAL_GLOBE_ROTATION: GlobeRotation = [85, -20, 0];
export const GLOBE_TILT_LIMIT = 85;

export function wrapGlobeLongitude(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

export function clampGlobeRotation(rotation: GlobeRotation): GlobeRotation {
  return [
    wrapGlobeLongitude(rotation[0]),
    Math.max(-GLOBE_TILT_LIMIT, Math.min(GLOBE_TILT_LIMIT, rotation[1])),
    0,
  ];
}

export function rotationForGlobePoint(point: GlobePoint): GlobeRotation {
  return clampGlobeRotation([-point[0], -point[1], 0]);
}

/** Orthographic projection alone still returns coordinates for the back side. */
export function globePointDepth(
  point: GlobePoint,
  rotation: GlobeRotation,
): number {
  const [longitude, latitude] = geoRotation(rotation)(point);
  const radians = Math.PI / 180;
  return Math.cos(longitude * radians) * Math.cos(latitude * radians);
}

export function isGlobePointVisible(
  point: GlobePoint,
  rotation: GlobeRotation,
): boolean {
  return globePointDepth(point, rotation) > 0.001;
}

/** A vertical-first touch belongs to the page, not the globe. */
export function classifyGlobeGesture(
  dx: number,
  dy: number,
  touch: boolean,
): GlobeGesture {
  if (Math.hypot(dx, dy) < (touch ? 8 : 3)) return 'pending';
  if (!touch) return 'rotate';
  return Math.abs(dx) > Math.abs(dy) * 1.15 ? 'rotate' : 'scroll';
}

export function dragGlobeRotation(
  start: GlobeRotation,
  dx: number,
  dy: number,
  radius: number,
): GlobeRotation {
  const degreesPerPixel = 70 / Math.max(1, radius);
  return clampGlobeRotation([
    start[0] + dx * degreesPerPixel,
    start[1] - dy * degreesPerPixel,
    0,
  ]);
}

export function interpolateGlobeRotation(
  start: GlobeRotation,
  end: GlobeRotation,
  progress: number,
): GlobeRotation {
  const amount = Math.max(0, Math.min(1, progress));
  return clampGlobeRotation([
    start[0] + wrapGlobeLongitude(end[0] - start[0]) * amount,
    start[1] + (end[1] - start[1]) * amount,
    0,
  ]);
}

export function keyboardGlobeRotation(
  rotation: GlobeRotation,
  key: string,
): GlobeRotation | null {
  if (key === 'Home') return [...INITIAL_GLOBE_ROTATION];
  const deltas: Record<string, GlobePoint> = {
    ArrowLeft: [-12, 0],
    ArrowRight: [12, 0],
    ArrowUp: [0, 12],
    ArrowDown: [0, -12],
  };
  const delta = deltas[key];
  return delta
    ? clampGlobeRotation([rotation[0] + delta[0], rotation[1] + delta[1], 0])
    : null;
}
