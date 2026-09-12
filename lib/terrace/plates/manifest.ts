/**
 * Theme manifest for the painted-plates stage. See docs/ARCHITECTURE.md.
 * A theme is pure data: layers and sprites placed on a fixed canvas. Nothing in
 * this module knows any particular theme's ids, files, depths or colours.
 */
export type PlateKind =
  | 'static'
  | 'drift'
  | 'sea'
  | 'flecks'
  | 'breeze'
  | 'boat'
  | 'gull'
  | 'prop'
  | 'player';
export type PlateDestination = 'journal' | 'atlas' | 'identify' | 'records';
export type PlateRect = { x: number; y: number; w: number; h: number };
export type PlateEdge = 'left' | 'right' | 'top' | 'bottom';
export type PlatePoint = { x: number; y: number };
/** A turntable built from parts; angles in degrees, positions in canvas px. */
export type PlayerParts = {
  /** The plinth and case, drawn as a static plane. */
  body: { file: string; rect: PlateRect };
  /** A top-down disc image mapped onto a circle tilted to the body's ellipse; optional. */
  disc?: { file: string; centre: PlatePoint; radius: number; tilt: number; yaw: number };
  /** The tone arm, pivoting at `pivot` between its rest and playing angles. */
  arm: { file: string; rect: PlateRect; pivot: PlatePoint; restAngle: number; playAngle: number };
};
export type PlateEntry = {
  id: string;
  /** File relative to the theme folder (a trimmed RGBA image). */
  file: string;
  /**
   * Optional animation frames. For gulls, `[up, level, down]` wing poses;
   * a single extra file alternates with `file`.
   */
  files?: string[];
  /**
   * Layer edges that are real painted boundaries (a canopy ending in open
   * air) rather than cuts; the lean clamp lets these enter the view.
   */
  safeEdges?: PlateEdge[];
  /** Prop caption centre, offset from the prop rect centre in canvas px. */
  caption?: { dx: number; dy: number };
  /** Player kind only: the turntable's parts. */
  parts?: PlayerParts;
  /** Placement on the canvas at the rest camera, in canvas pixels. */
  rect: PlateRect;
  /** Distance from the rest camera along the view axis, world units. */
  depth: number;
  kind: PlateKind;
  opacity?: number;
  /** Breeze pivot in canvas pixels; displacement grows away from it. */
  anchor?: PlatePoint;
  /** Breeze tuning: nothing moves within `hold` canvas px above the anchor row. */
  breeze?: { hold?: number };
  /** A smouldering point in canvas pixels: wisps and a glow are placed here. */
  ember?: PlatePoint;
  /** Prop planes open an app destination. */
  destination?: PlateDestination;
  /** Boat/drift tuning: canvas px of x travel, or canvas widths per second. */
  route?: { amplitude?: number; period?: number };
  drift?: { x?: number; y?: number };
};
export type PlateLayer = PlateEntry;
export type PlateSprite = PlateEntry;
export type PlatesManifest = {
  version: 1;
  canvas: { width: number; height: number };
  /** Seated lean limits in world units; overrides the stage default. */
  lean?: { x: number; y: number };
  /** Paper colour shown wherever no plate covers the view. */
  paper?: string;
  /** Where the "EST." plaque is lettered; depth defaults to the layer under it. */
  established?: { rect: PlateRect; depth?: number };
  layers: PlateLayer[];
  sprites: PlateSprite[];
};

const kinds: readonly PlateKind[] = [
  'static',
  'drift',
  'sea',
  'flecks',
  'breeze',
  'boat',
  'gull',
  'prop',
  'player',
];
const destinations: readonly PlateDestination[] = [
  'journal',
  'atlas',
  'identify',
  'records',
];

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function point(value: unknown, where: string): PlatePoint {
  if (
    !value ||
    typeof value !== 'object' ||
    !finite((value as PlatePoint).x) ||
    !finite((value as PlatePoint).y)
  )
    throw new Error(`${where}: point needs finite x and y`);
  return { x: (value as PlatePoint).x, y: (value as PlatePoint).y };
}
function rect(value: unknown, where: string): PlateRect {
  const candidate = value as PlateRect | undefined;
  if (!candidate || typeof candidate !== 'object' || !finite(candidate.x) || !finite(candidate.y) || !finite(candidate.w) || !finite(candidate.h))
    throw new Error(`${where}: rect needs finite x, y, w, h`);
  if (candidate.w <= 0 || candidate.h <= 0) throw new Error(`${where}: rect must have positive size`);
  return { x: candidate.x, y: candidate.y, w: candidate.w, h: candidate.h };
}
function file(value: unknown, where: string): string {
  if (typeof value !== 'string' || !value || value.includes('..') || value.startsWith('/'))
    throw new Error(`${where}: file must be a relative theme path`);
  return value;
}
function parts(value: unknown, canvas: PlatesManifest['canvas'], where: string): PlayerParts {
  if (!value || typeof value !== 'object') throw new Error(`${where}: player needs parts`);
  const raw = value as Record<string, Record<string, unknown> | undefined>;
  const inside = (r: PlateRect, label: string) => {
    if (r.x < 0 || r.y < 0 || r.x + r.w > canvas.width || r.y + r.h > canvas.height)
      throw new Error(`${label}: rect lies outside the canvas`);
    return r;
  };
  if (!raw.body || !raw.arm) throw new Error(`${where}: parts need body and arm`);
  const body = { file: file(raw.body.file, `${where} body`), rect: inside(rect(raw.body.rect, `${where} body`), `${where} body`) };
  let disc: PlayerParts['disc'];
  if (raw.disc !== undefined) {
    if (!raw.disc || typeof raw.disc !== 'object') throw new Error(`${where} disc: must be an object`);
    const centre = point(raw.disc.centre, `${where} disc centre`);
    if (!finite(raw.disc.radius) || (raw.disc.radius as number) <= 0) throw new Error(`${where} disc: radius must be positive`);
    if (!finite(raw.disc.tilt) || !finite(raw.disc.yaw)) throw new Error(`${where} disc: tilt and yaw must be degrees`);
    disc = { file: file(raw.disc.file, `${where} disc`), centre, radius: raw.disc.radius as number, tilt: raw.disc.tilt as number, yaw: raw.disc.yaw as number };
  }
  if (!finite(raw.arm.restAngle) || !finite(raw.arm.playAngle)) throw new Error(`${where} arm: restAngle and playAngle must be degrees`);
  const arm = {
    file: file(raw.arm.file, `${where} arm`),
    rect: inside(rect(raw.arm.rect, `${where} arm`), `${where} arm`),
    pivot: point(raw.arm.pivot, `${where} arm pivot`),
    restAngle: raw.arm.restAngle as number,
    playAngle: raw.arm.playAngle as number,
  };
  return disc ? { body, disc, arm } : { body, arm };
}
function entry(
  raw: unknown,
  canvas: PlatesManifest['canvas'],
  where: string,
  ids: Set<string>,
  used: Set<PlateDestination>,
  overscan: boolean,
): PlateEntry {
  if (!raw || typeof raw !== 'object') throw new Error(`${where}: not an object`);
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== 'string' || !value.id) throw new Error(`${where}: missing id`);
  const label = `${where} "${value.id}"`;
  if (ids.has(value.id)) throw new Error(`${label}: duplicate id`);
  ids.add(value.id);
  if (typeof value.file !== 'string' || !value.file || value.file.includes('..') || value.file.startsWith('/'))
    throw new Error(`${label}: file must be a relative theme path`);
  if (!kinds.includes(value.kind as PlateKind)) throw new Error(`${label}: unknown kind ${String(value.kind)}`);
  if (!finite(value.depth) || value.depth <= 0) throw new Error(`${label}: depth must be a positive number`);
  const rect = value.rect as PlateRect | undefined;
  if (!rect || typeof rect !== 'object' || !finite(rect.x) || !finite(rect.y) || !finite(rect.w) || !finite(rect.h))
    throw new Error(`${label}: rect needs finite x, y, w, h`);
  if (rect.w <= 0 || rect.h <= 0) throw new Error(`${label}: rect must have positive size`);
  // Layers may overscan the canvas (trimmed art with margins for parallax);
  // sprites and props must remain fully inside it.
  if (overscan) {
    if (rect.x + rect.w <= 0 || rect.y + rect.h <= 0 || rect.x >= canvas.width || rect.y >= canvas.height)
      throw new Error(`${label}: rect does not touch the canvas`);
  } else if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > canvas.width || rect.y + rect.h > canvas.height)
    throw new Error(`${label}: rect lies outside the canvas`);
  const result: PlateEntry = {
    id: value.id,
    file: value.file,
    rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
    depth: value.depth,
    kind: value.kind as PlateKind,
  };
  if (value.files !== undefined) {
    if (!Array.isArray(value.files) || !value.files.every((file) => typeof file === 'string' && file && !file.includes('..') && !file.startsWith('/')))
      throw new Error(`${label}: files must be relative theme paths`);
    result.files = [...(value.files as string[])];
  }
  if (value.opacity !== undefined) {
    if (!finite(value.opacity) || value.opacity < 0 || value.opacity > 1)
      throw new Error(`${label}: opacity must be between 0 and 1`);
    result.opacity = value.opacity;
  }
  if (value.anchor !== undefined) result.anchor = point(value.anchor, `${label} anchor`);
  if (value.kind === 'breeze' && !result.anchor) throw new Error(`${label}: breeze needs an anchor`);
  if (value.breeze !== undefined) {
    const breeze = value.breeze as { hold?: unknown };
    if (!breeze || typeof breeze !== 'object' || value.kind !== 'breeze') throw new Error(`${label}: breeze tuning belongs on a breeze layer`);
    result.breeze = {};
    if (breeze.hold !== undefined) {
      if (!finite(breeze.hold) || breeze.hold < 0) throw new Error(`${label}: breeze hold must be a non-negative number`);
      result.breeze.hold = breeze.hold;
    }
  }
  if (value.ember !== undefined) {
    const ember = point(value.ember, `${label} ember`);
    if (ember.x < 0 || ember.y < 0 || ember.x > canvas.width || ember.y > canvas.height)
      throw new Error(`${label}: ember lies outside the canvas`);
    result.ember = ember;
  }
  if (value.safeEdges !== undefined) {
    const edges: PlateEdge[] = ['left', 'right', 'top', 'bottom'];
    if (!Array.isArray(value.safeEdges) || !value.safeEdges.every((edge) => edges.includes(edge as PlateEdge)))
      throw new Error(`${label}: safeEdges must list left, right, top or bottom`);
    if (!overscan) throw new Error(`${label}: only layers have safeEdges`);
    result.safeEdges = [...new Set(value.safeEdges as PlateEdge[])];
  }
  if (value.caption !== undefined) {
    const caption = value.caption as { dx?: unknown; dy?: unknown };
    if (!caption || typeof caption !== 'object' || !finite(caption.dx) || !finite(caption.dy))
      throw new Error(`${label}: caption needs finite dx and dy`);
    if (value.kind !== 'prop' && value.kind !== 'player') throw new Error(`${label}: only props carry a caption`);
    result.caption = { dx: caption.dx, dy: caption.dy };
  }
  if (value.kind === 'player') {
    result.parts = parts(value.parts, canvas, `${label} parts`);
    if (value.destination !== undefined && value.destination !== 'records')
      throw new Error(`${label}: a player always opens records`);
    if (used.has('records')) throw new Error(`${label}: destination records is already taken`);
    used.add('records');
    result.destination = 'records';
  } else if (value.parts !== undefined) throw new Error(`${label}: only a player has parts`);
  if (value.kind === 'prop') {
    if (!destinations.includes(value.destination as PlateDestination))
      throw new Error(`${label}: prop needs a valid destination`);
    if (used.has(value.destination as PlateDestination))
      throw new Error(`${label}: destination ${String(value.destination)} is already taken`);
    used.add(value.destination as PlateDestination);
    result.destination = value.destination as PlateDestination;
  } else if (value.destination !== undefined && value.kind !== 'player')
    throw new Error(`${label}: only props carry a destination`);
  if (value.route !== undefined) {
    const route = value.route as Record<string, unknown>;
    if (!route || typeof route !== 'object') throw new Error(`${label}: route must be an object`);
    result.route = {};
    if (route.amplitude !== undefined) {
      if (!finite(route.amplitude) || route.amplitude < 0) throw new Error(`${label}: route amplitude`);
      result.route.amplitude = route.amplitude;
    }
    if (route.period !== undefined) {
      if (!finite(route.period) || route.period <= 0) throw new Error(`${label}: route period`);
      result.route.period = route.period;
    }
  }
  if (value.drift !== undefined) {
    const drift = value.drift as Record<string, unknown>;
    if (!drift || typeof drift !== 'object') throw new Error(`${label}: drift must be an object`);
    result.drift = {};
    if (drift.x !== undefined) {
      if (!finite(drift.x)) throw new Error(`${label}: drift x`);
      result.drift.x = drift.x;
    }
    if (drift.y !== undefined) {
      if (!finite(drift.y)) throw new Error(`${label}: drift y`);
      result.drift.y = drift.y;
    }
  }
  return result;
}

/** Strict validation: anything unexpected throws, so a broken theme is terminal. */
export function parseManifest(raw: unknown): PlatesManifest {
  if (!raw || typeof raw !== 'object') throw new Error('manifest: not an object');
  const value = raw as Record<string, unknown>;
  if (value.version !== 1) throw new Error('manifest: unsupported version');
  const canvas = value.canvas as PlatesManifest['canvas'] | undefined;
  if (!canvas || typeof canvas !== 'object' || !finite(canvas.width) || !finite(canvas.height) || canvas.width <= 0 || canvas.height <= 0)
    throw new Error('manifest: canvas needs positive width and height');
  if (!Array.isArray(value.layers) || !Array.isArray(value.sprites))
    throw new Error('manifest: layers and sprites must be arrays');
  if (value.layers.length === 0) throw new Error('manifest: at least one layer is required');
  const ids = new Set<string>();
  const used = new Set<PlateDestination>();
  const size = { width: canvas.width, height: canvas.height };
  const layers = value.layers.map((layer, index) => entry(layer, size, `layers[${index}]`, ids, used, true));
  const sprites = value.sprites.map((sprite, index) => entry(sprite, size, `sprites[${index}]`, ids, used, false));
  for (const layer of layers)
    if (layer.kind === 'prop' || layer.kind === 'boat' || layer.kind === 'gull' || layer.kind === 'player')
      throw new Error(`layers "${layer.id}": ${layer.kind} belongs in sprites`);
  const result: PlatesManifest = { version: 1, canvas: size, layers, sprites };
  if (value.paper !== undefined) {
    if (typeof value.paper !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.paper))
      throw new Error('manifest: paper must be a #rrggbb colour');
    result.paper = value.paper;
  }
  if (value.established !== undefined) {
    const established = value.established as { rect?: unknown; depth?: unknown };
    if (!established || typeof established !== 'object') throw new Error('manifest: established must be an object');
    const plaque = rect(established.rect, 'manifest established');
    if (plaque.x < 0 || plaque.y < 0 || plaque.x + plaque.w > size.width || plaque.y + plaque.h > size.height)
      throw new Error('manifest established: rect lies outside the canvas');
    result.established = { rect: plaque };
    if (established.depth !== undefined) {
      if (!finite(established.depth) || established.depth <= 0) throw new Error('manifest established: depth must be positive');
      result.established.depth = established.depth;
    }
  }
  if (value.lean !== undefined) {
    const lean = value.lean as { x?: unknown; y?: unknown };
    if (!lean || typeof lean !== 'object' || !finite(lean.x) || !finite(lean.y) || lean.x < 0 || lean.y < 0)
      throw new Error('manifest: lean needs non-negative finite x and y');
    result.lean = { x: lean.x, y: lean.y };
  }
  return result;
}

/** Every distinct image file a theme needs, in manifest order. */
export function manifestFiles(manifest: PlatesManifest): string[] {
  const files: string[] = [];
  for (const item of [...manifest.layers, ...manifest.sprites]) {
    const own = [item.file, ...(item.files ?? [])];
    if (item.parts) own.push(item.parts.body.file, ...(item.parts.disc ? [item.parts.disc.file] : []), item.parts.arm.file);
    for (const file of own) if (!files.includes(file)) files.push(file);
  }
  return files;
}
