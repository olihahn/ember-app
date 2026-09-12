#!/usr/bin/env node
// Builds the terrace theme's painted plates from the existing generated art.
// Sources: art/sources/{terrace-scene,terrace-tree,terrace-chair,terrace-objects}.png
// and public/images/after-hours-poster.png. Output: public/plates/terrace/.
// Only sharp and Node built-ins; deterministic; no network.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  CANVAS,
  parapetTop,
  parapetBottom,
  horizon,
  table,
  hills,
  promontory,
  boat,
  posterAshtray,
  objectQuadrants,
  placements,
  depths,
  FILL_REACH,
  pavingOffsetX,
  treeTone,
  PAVING_EXTEND,
  gradePatches,
  parapetOverlap,
  parapetPrint,
  shadowFamily,
  plinth,
  NEAR_COAST_REACH,
  propShadow,
  TREE_EXTEND,
  TREE_MIRROR_RUN,
  bandMargins,
  safeEdges,
  treePrint,
  stonePrint,
  propPrint,
  cloudPrint,
  inks,
} from './regions.mjs';
import { hash2 } from './print.mjs';
import {
  printCanopy,
  lobedTrim,
  printStone,
  posteriseProp,
  flattenLens,
  ellipseShadow,
  printShares,
  padMirror,
  extendTreeLeft,
  bakeShadowUnder,
} from './print.mjs';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
// Runtime art lives in public/images; the large source paintings the plates are
// cut from live in art/sources so they are not bundled into the app.
const src = (name) => path.join(root, 'public/images', name);
// The source paintings are not published: the artwork is reserved, so this
// repository ships the derived plates in public/plates/ rather than the
// originals. See docs/ART-PIPELINE.md. Drop the four terrace-*.png files into
// art/sources/ to run this build.
const artSource = (name) => path.join(root, 'art/sources', name);
const outDir = path.join(root, 'public/plates/terrace');
const qaDir = path.join(root, 'outputs/qa/plates');
mkdirSync(outDir, { recursive: true });
mkdirSync(qaDir, { recursive: true });
const { width: W, height: H } = CANVAS;
const N = W * H;

// ---------- deterministic noise ----------
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(1960);
const jitter = (amplitude) => Math.round((rand() - 0.5) * 2 * amplitude);
const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

// ---------- mask helpers (Uint8Array, 0..255, W×H) ----------
function svgPolygon(points) {
  return `<polygon points="${points.map(([x, y]) => `${x},${y}`).join(' ')}" fill="#fff"/>`;
}
function svgEllipse({ cx, cy, rx, ry }) {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#fff"/>`;
}
async function rasterMask(shapesSvg, feather = 0.75, width = W, height = H) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${shapesSvg}</svg>`;
  let image = sharp(Buffer.from(svg)).ensureAlpha().extractChannel(3);
  if (feather > 0) image = image.blur(feather);
  const { data } = await image.raw().toBuffer({ resolveWithObject: true });
  return new Uint8Array(data.buffer, data.byteOffset, width * height);
}
function halfPlaneMask(predicate) {
  const m = new Uint8Array(N);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (predicate(x, y)) m[y * W + x] = 255;
  return m;
}
const mul = (a, b) => {
  const o = new Uint8Array(N);
  for (let i = 0; i < N; i++) o[i] = (a[i] * b[i] + 127) / 255;
  return o;
};
const inv = (a) => {
  const o = new Uint8Array(N);
  for (let i = 0; i < N; i++) o[i] = 255 - a[i];
  return o;
};
const max = (a, b) => {
  const o = new Uint8Array(N);
  for (let i = 0; i < N; i++) o[i] = a[i] > b[i] ? a[i] : b[i];
  return o;
};

// ---------- source pixels ----------
async function loadRaw(file, channels = 4) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (channels !== 4) throw new Error('RGBA expected');
  return { data, width: info.width, height: info.height };
}

/** Mirror-copy fill along one axis from the nearest owned boundary. */
function fillAxis(rgba, owned, coverable, horizontal, reach) {
  const filled = new Uint8Array(owned); // becomes owned after the pass
  const outer = horizontal ? H : W;
  const inner = horizontal ? W : H;
  const idx = horizontal ? (o, i) => o * W + i : (o, i) => i * W + o;
  for (let o = 0; o < outer; o++) {
    for (let i = 0; i < inner; i++) {
      const p = idx(o, i);
      if (owned[p] > 200 || coverable[p] < 40) continue;
      let best = -1,
        bestDist = reach + 1,
        dir = 0;
      for (let d = 1; d <= reach; d++) {
        const a = i - d,
          b = i + d;
        if (a >= 0 && owned[idx(o, a)] > 200) {
          best = a;
          bestDist = d;
          dir = -1;
          break;
        }
        if (b < inner && owned[idx(o, b)] > 200) {
          best = b;
          bestDist = d;
          dir = 1;
          break;
        }
      }
      if (best < 0) continue;
      let s = best + dir * bestDist; // mirrored source
      if (s < 0 || s >= inner || owned[idx(o, s)] <= 200) s = best;
      const q = idx(o, s);
      const weight = owned[p] / 255; // keep feathered edge pixels' own paint
      for (let c = 0; c < 3; c++)
        rgba[p * 4 + c] = clamp8(
          Math.round(
            rgba[p * 4 + c] * weight +
              (rgba[q * 4 + c] + jitter(4)) * (1 - weight),
          ),
        );
      rgba[p * 4 + 3] = 255;
      filled[p] = 255;
    }
  }
  return filled;
}

function trim(rgba, width, height, threshold = 1) {
  let x0 = width,
    y0 = height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] >= threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  if (x1 < 0) throw new Error('empty layer');
  const w = x1 - x0 + 1,
    h = y1 - y0 + 1;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    out.set(
      rgba.subarray(
        ((y + y0) * width + x0) * 4,
        ((y + y0) * width + x0 + w) * 4,
      ),
      y * w * 4,
    );
  return { data: out, rect: { x: x0, y: y0, w, h } };
}

/** Extend a trimmed layer's right edge so a left-shifted layer still spans
 *  the canvas. Off-screen on a portrait phone; only a few px can ever show. */
function extendRight(layer, by) {
  const { w, h } = layer.rect;
  const out = Buffer.alloc((w + by) * h * 4);
  for (let y = 0; y < h; y++) {
    out.set(layer.data.subarray(y * w * 4, (y + 1) * w * 4), y * (w + by) * 4);
    for (let x = 0; x < by; x++) {
      // The right edge holds the painted table; borrow table-free paving from
      // the left edge instead (mirrored so the seam meets itself).
      const sx = by - 1 - x;
      const si = (y * w + Math.max(0, sx)) * 4,
        di = (y * (w + by) + w + x) * 4;
      for (let c = 0; c < 3; c++)
        out[di + c] = clamp8(layer.data[si + c] + jitter(3));
      out[di + 3] = layer.data[si + 3];
    }
  }
  return { data: out, rect: { ...layer.rect, w: w + by } };
}

async function writePng(name, data, width, height, channels = 4) {
  const file = path.join(outDir, name);
  await sharp(data, { raw: { width, height, channels } })
    .png({ compressionLevel: 9, palette: false })
    .toFile(file);
  return file;
}

// ---------- colour grading (measured against the poster) ----------
const lum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;
function meanOf(rgba, width, patches, filter) {
  const s = [0, 0, 0];
  let n = 0;
  for (const { x, y, w, h } of patches)
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) {
        const i = (yy * width + xx) * 4;
        if (rgba[i + 3] < 200) continue;
        if (filter && !filter(rgba[i], rgba[i + 1], rgba[i + 2])) continue;
        s[0] += rgba[i];
        s[1] += rgba[i + 1];
        s[2] += rgba[i + 2];
        n++;
      }
  return s.map((v) => v / Math.max(1, n));
}
/** Per-channel x' = a·x + b, applied in place; `where` may limit pixels. */
function grade(rgba, map, where) {
  const count = rgba.length / 4;
  for (let p = 0; p < count; p++) {
    if (rgba[p * 4 + 3] === 0) continue;
    if (where && !where(rgba[p * 4 + 3])) continue;
    for (let c = 0; c < 3; c++)
      rgba[p * 4 + c] = clamp8(
        Math.round(map.a[c] * rgba[p * 4 + c] + map.b[c]),
      );
  }
}
const fmt = (m) => m.map((v) => v.toFixed(1)).join(', ');
/** Gain that moves `from` onto `to`. */
const gainMap = (from, to) => ({
  a: to.map((t, c) => t / from[c]),
  b: [0, 0, 0],
});
/** Two-point map: `lit` → `target`, `dark` stays fixed. */
const twoPointMap = (lit, dark, target) => {
  const a = target.map((t, c) => (t - dark[c]) / (lit[c] - dark[c]));
  return { a, b: dark.map((d, c) => d - a[c] * d) };
};
function applyMapToMean(mean, map) {
  return mean.map((v, c) => clamp8(map.a[c] * v + map.b[c]));
}

// ---------- scene slicing ----------
async function buildScene(scene) {
  const above = (line) => halfPlaneMask((x, y) => y < line(x));
  const below = (line) => halfPlaneMask((x, y) => y >= line(x));
  const aboveHorizon = above(horizon);
  const belowHorizon = inv(aboveHorizon);
  // The parapet owns `parapetOverlap` px above its painted top edge (hard
  // alpha edge there); the sea's under-extension then never peeks out.
  const parapetEdge = (x) => parapetTop(x) - parapetOverlap;
  const aboveParapet = above(parapetEdge);
  const parapetBand = mul(below(parapetEdge), above(parapetBottom));
  const tableMask = await rasterMask(
    svgEllipse(table.top) + svgEllipse(table.rim),
  );
  const pavingMask = max(below(parapetBottom), tableMask);
  const hillsMask = mul(await rasterMask(svgPolygon(hills)), aboveHorizon);
  const promontoryMask = mul(
    await rasterMask(svgPolygon(promontory)),
    above(parapetTop),
  );
  const seaMask = mul(belowHorizon, aboveParapet);
  // Hole: binarised so no feathered boundary pixel keeps a trace of sail.
  const boatHole = await rasterMask(boat.hole.map(svgPolygon).join(''), 1.5);
  for (let p = 0; p < N; p++) boatHole[p] = boatHole[p] > 0 ? 255 : 0;
  const seaHole = mul(boatHole, belowHorizon);
  // Sprite: tight outline, feathered, then keyed against the surrounding sea
  // so no sea margin travels with the boat.
  const boatMask = await rasterMask(boat.sprite.map(svgPolygon).join(''), 1.0);
  {
    const rowSea = [];
    for (let y = 0; y < H; y++) {
      let r = 0,
        g = 0,
        b = 0,
        n = 0;
      for (let x = 760; x < 1000; x++) {
        const p = y * W + x;
        // Reference is the open water (or the sky above the horizon) on this
        // row, so the sail tip's cream sky is keyed out as well.
        if (
          (seaMask[p] > 200 || aboveHorizon[p] > 200) &&
          boatHole[p] === 0 &&
          promontoryMask[p] < 40
        ) {
          r += scene[p * 4];
          g += scene[p * 4 + 1];
          b += scene[p * 4 + 2];
          n++;
        }
      }
      rowSea.push(n ? [r / n, g / n, b / n] : null);
    }
    for (let p = 0; p < N; p++) {
      if (!boatMask[p]) continue;
      const ref = rowSea[Math.floor(p / W)];
      if (!ref) continue;
      const dist = Math.max(
        Math.abs(scene[p * 4] - ref[0]),
        Math.abs(scene[p * 4 + 1] - ref[1]),
        Math.abs(scene[p * 4 + 2] - ref[2]),
      );
      const keep = Math.min(1, Math.max(0, (dist - 18) / 22));
      boatMask[p] = Math.round(boatMask[p] * keep);
    }
  }

  // Cloud streaks: blue-grey on cream, above the horizon, not on land or the
  // sail. Keyed first so the sky can be synthesised underneath them.
  const cloudKey = new Uint8Array(N);
  {
    const land = max(max(hillsMask, promontoryMask), boatHole);
    for (let p = 0; p < N; p++) {
      const y = Math.floor(p / W);
      if (y >= 452 || land[p] > 4) continue;
      const r = scene[p * 4],
        b = scene[p * 4 + 2];
      cloudKey[p] = Math.round(
        Math.min(1, Math.max(0, (78 - (r - b)) / 46)) * 255,
      );
    }
  }
  // Ordered far → near. `poly` is what the layer visually spans; `owned` is
  // computed by subtracting every nearer layer; `holes` are painted out.
  const layers = [
    // The mast tip rises above the horizon; paint it out of the sky as well.
    {
      id: 'sky',
      poly: halfPlaneMask(() => true),
      holes: [cloudKey, boatHole],
      fillFirst: 'vertical',
      opaqueBase: true,
    },
    { id: 'far-coast', poly: hillsMask, fillFirst: 'vertical' },
    { id: 'sea', poly: seaMask, holes: [seaHole], fillFirst: 'horizontal' },
    { id: 'near-coast', poly: promontoryMask, fillFirst: 'vertical' },
    { id: 'parapet', poly: parapetBand, fillFirst: 'vertical' },
    { id: 'paving', poly: pavingMask, fillFirst: 'vertical' },
  ];
  // clouds and flecks are keyed, not polygonal; sky owns their pixels too.
  for (let i = 0; i < layers.length; i++) {
    let owned = layers[i].poly;
    let coverable = new Uint8Array(N);
    for (let j = i + 1; j < layers.length; j++) {
      owned = mul(owned, inv(layers[j].poly));
      coverable = max(coverable, layers[j].poly);
    }
    for (const hole of layers[i].holes ?? []) {
      owned = mul(owned, inv(hole));
      coverable = max(coverable, hole);
    }
    layers[i].owned = owned;
    layers[i].coverable = coverable;
  }

  const results = {};
  for (const layer of layers) {
    const rgba = Buffer.alloc(N * 4);
    const { owned, coverable } = layer;
    for (let p = 0; p < N; p++) {
      rgba[p * 4] = scene[p * 4];
      rgba[p * 4 + 1] = scene[p * 4 + 1];
      rgba[p * 4 + 2] = scene[p * 4 + 2];
      rgba[p * 4 + 3] = owned[p];
    }
    if (layer.opaqueBase) {
      // Sky: synthesise the paper/sky gradient everywhere, then lay the real
      // sky pixels over it. Rows without sky reuse the nearest sky row.
      const rowColour = [];
      let last = null;
      for (let y = 0; y < H; y++) {
        let r = 0,
          g = 0,
          b = 0,
          n = 0;
        for (let x = 0; x < W; x++) {
          const p = y * W + x;
          if (owned[p] > 240) {
            r += scene[p * 4];
            g += scene[p * 4 + 1];
            b += scene[p * 4 + 2];
            n++;
          }
        }
        if (n > 40) last = [r / n, g / n, b / n];
        rowColour.push(last);
      }
      for (let y = 0; y < H; y++) {
        const colour = rowColour[y] ?? rowColour.find(Boolean);
        for (let x = 0; x < W; x++) {
          const p = y * W + x;
          const a = owned[p] / 255;
          for (let c = 0; c < 3; c++)
            rgba[p * 4 + c] = clamp8(
              Math.round(
                scene[p * 4 + c] * a + (colour[c] + jitter(5)) * (1 - a),
              ),
            );
          rgba[p * 4 + 3] = 255;
        }
      }
      results[layer.id] = {
        data: rgba,
        rect: { x: 0, y: 0, w: W, h: H },
        opaque: true,
      };
      continue;
    }
    const first = layer.fillFirst === 'horizontal';
    const reach = layer.id === 'near-coast' ? NEAR_COAST_REACH : FILL_REACH;
    let filled = fillAxis(rgba, owned, coverable, first, reach);
    filled = fillAxis(rgba, filled, coverable, !first, reach);
    results[layer.id] = trim(rgba, W, H);
    if (layer.id === 'paving')
      results.paving = extendRight(results.paving, PAVING_EXTEND);
  }

  // Cloud layer: un-blend the keyed streaks against the synthesised paper.
  {
    const rgba = Buffer.alloc(N * 4);
    const sky = results.sky.data;
    for (let p = 0; p < N; p++) {
      const cloud = cloudKey[p] / 255;
      if (cloud <= 0.02) continue;
      const r = scene[p * 4],
        g = scene[p * 4 + 1],
        b = scene[p * 4 + 2];
      // Un-blend against the synthesised paper so drifting edges carry no cream halo.
      const paper = [sky[p * 4], sky[p * 4 + 1], sky[p * 4 + 2]];
      const source = [r, g, b];
      for (let c = 0; c < 3; c++)
        rgba[p * 4 + c] = clamp8(
          Math.round((source[c] - (1 - cloud) * paper[c]) / cloud),
        );
      rgba[p * 4 + 3] = Math.round(cloud * 255);
    }
    results.clouds = trim(rgba, W, H);
  }
  // Sea flecks: the brightest painted strokes on the sea, sparse shimmer.
  {
    const rgba = Buffer.alloc(N * 4);
    const owned = layers.find((l) => l.id === 'sea').owned;
    for (let p = 0; p < N; p++) {
      // The pale horizon glow line is part of the sea, not a drifting fleck.
      if (owned[p] < 200 || Math.floor(p / W) < 462) continue;
      const r = scene[p * 4],
        g = scene[p * 4 + 1],
        b = scene[p * 4 + 2];
      const lum = 0.3 * r + 0.59 * g + 0.11 * b;
      const fleck = Math.min(1, Math.max(0, (lum - 168) / 50));
      if (fleck <= 0.05) continue;
      rgba[p * 4] = clamp8(r + 10);
      rgba[p * 4 + 1] = clamp8(g + 6);
      rgba[p * 4 + 2] = clamp8(b - 4);
      rgba[p * 4 + 3] = Math.round(fleck * 255);
    }
    results['sea-flecks'] = trim(rgba, W, H);
  }
  // Boat sprite from the scene, before it was painted out of the sea.
  {
    const rgba = Buffer.alloc(N * 4);
    for (let p = 0; p < N; p++) {
      rgba[p * 4] = scene[p * 4];
      rgba[p * 4 + 1] = scene[p * 4 + 1];
      rgba[p * 4 + 2] = scene[p * 4 + 2];
      rgba[p * 4 + 3] = boatMask[p];
    }
    results.boat = trim(rgba, W, H, 8);
  }
  return results;
}

// ---------- sprites from other plates ----------
async function trimmedSprite(image, width, height) {
  const { data } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return trim(data, width, height, 8);
}

async function scaledSprite(buffer, rectW) {
  // buffer: trimmed RGBA {data, rect}; returns resized RGBA to width rectW.
  const scale = rectW / buffer.rect.w;
  const h = Math.max(1, Math.round(buffer.rect.h * scale));
  const { data } = await sharp(buffer.data, {
    raw: { width: buffer.rect.w, height: buffer.rect.h, channels: 4 },
  })
    .resize(rectW, h, { kernel: 'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, w: rectW, h };
}

async function buildProps() {
  const objects = sharp(artSource('terrace-objects.png'));
  const meta = await objects.metadata();
  const out = {};
  for (const [id, quad] of Object.entries(objectQuadrants)) {
    const placement = placements[id];
    let image = sharp(artSource('terrace-objects.png')).extract({
      left: quad.x,
      top: quad.y,
      width: quad.w,
      height: quad.h,
    });
    if (placement.rotate)
      image = image.rotate(placement.rotate, {
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      });
    const rotated = await image
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const trimmed = trim(
      rotated.data,
      rotated.info.width,
      rotated.info.height,
      8,
    );
    const sprite = await scaledSprite(trimmed, placement.rect.w);
    if (propPrint[id]) {
      await posteriseProp(
        sprite.data,
        sprite.w,
        sprite.h,
        propPrint[id],
        propPrint.options,
      );
      if (id === 'magnifier')
        await flattenLens(sprite.data, sprite.w, sprite.h, propPrint.lens);
    }
    out[id] = {
      ...sprite,
      rect: {
        x: placement.rect.x,
        y: placement.rect.y,
        w: sprite.w,
        h: sprite.h,
      },
    };
  }
  void meta;
  return out;
}

async function buildChair() {
  const meta = await sharp(artSource('terrace-chair.png')).metadata();
  const trimmed = await trimmedSprite(
    sharp(artSource('terrace-chair.png')),
    meta.width,
    meta.height,
  );
  const { rect } = placements.chair;
  const sprite = await scaledSprite(trimmed, rect.w);
  return {
    ...sprite,
    rect: { x: rect.x, y: rect.y, w: sprite.w, h: sprite.h },
  };
}

function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max / 255];
}
function hsvToRgb(h, s, v) {
  const c = v * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = v - c;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

async function buildTree() {
  // Untrimmed: the placement rect positions the whole file. Greens are toned
  // toward the poster's ink foliage; ochre bark and dark ink are left alone.
  const { data, info } = await sharp(artSource('terrace-tree.png'))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgba = Buffer.from(data);
  const t = treeTone;
  for (let p = 0; p < info.width * info.height; p++) {
    if (rgba[p * 4 + 3] < 8) continue;
    const [h, s, v] = rgbToHsv(rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2]);
    if (h < t.hueMin || h > t.hueMax || s < t.minSaturation) continue;
    const [r, g, b] = hsvToRgb(
      Math.min(359.9, h + t.hueShift),
      Math.min(1, s * t.saturation),
      v * t.brightness,
    );
    rgba[p * 4] = clamp8(Math.round(r));
    rgba[p * 4 + 1] = clamp8(Math.round(g));
    rgba[p * 4 + 2] = clamp8(Math.round(b));
  }
  const { rect, scale, cutX, anchor } = placements.tree;
  const sw = Math.round(info.width * scale),
    sh = Math.round(info.height * scale);
  const scaled = await sharp(rgba, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .resize(sw, sh, { kernel: 'lanczos3' })
    .raw()
    .toBuffer();
  // Trim the far-right lobe along an inward diagonal sweep and the file's
  // flat top along a lobed contour. Profiles are hand-drawn: big lobes of
  // varied radius, small scallops riding on them, a slow base wobble.
  const { cutSlope, cutSlopeFrom } = placements.tree;
  const cutBase = cutX - rect.x - 22;
  const topBase = 12 + 30;
  const lobes = (length, seed) => {
    const bump = new Float32Array(length);
    for (let c = -40, k = 0; c < length + 40; k++) {
      const r = 8 + hash2(k, seed + 1) * 30;
      const cc = c + (hash2(k, seed + 2) - 0.5) * 14;
      for (
        let i = Math.max(0, Math.floor(cc - r));
        i < Math.min(length, Math.ceil(cc + r));
        i++
      ) {
        const d = i - cc;
        const h = Math.sqrt(Math.max(0, r * r - d * d));
        if (h > bump[i]) bump[i] = h;
      }
      c += r * (0.9 + hash2(k, seed) * 0.9);
    }
    const ridden = Float32Array.from(bump);
    for (let c = 0, k = 0; c < length; k++) {
      const r = 4 + hash2(k, seed + 3) * 10;
      const base =
        bump[Math.min(length - 1, Math.max(0, Math.round(c)))] - r * 0.45;
      for (
        let i = Math.max(0, Math.floor(c - r));
        i < Math.min(length, Math.ceil(c + r));
        i++
      ) {
        const d = i - c;
        const h = base + Math.sqrt(Math.max(0, r * r - d * d));
        if (h > ridden[i]) ridden[i] = h;
      }
      c += r * (1.2 + hash2(k, seed + 4) * 1.0);
    }
    const phase = hash2(1, seed + 5) * 6.28;
    for (let i = 0; i < length; i++)
      ridden[i] +=
        7 * Math.sin(i / 140 + phase) + 3 * Math.sin(i / 53 + phase * 2);
    return ridden;
  };
  const bumpRight = lobes(sh, 31);
  const bumpTop = lobes(sw, 47);
  const rightEdge = new Float32Array(sh);
  for (let y = 0; y < sh; y++)
    rightEdge[y] =
      cutBase - cutSlope * Math.max(0, y - cutSlopeFrom) + bumpRight[y];
  const topEdge = new Float32Array(sw);
  for (let x = 0; x < sw; x++) topEdge[x] = topBase - bumpTop[x];
  lobedTrim(
    scaled,
    sw,
    sh,
    (x, y) => x < rightEdge[y] && y >= topEdge[x],
    (x, y) => Math.min(rightEdge[y] - x, y - topEdge[x]),
    { thinRadius: 4, tipMin: 12, tipMax: 42, bandOuter: 40 },
  );
  const holes = printCanopy(scaled, sw, sh, treePrint);
  console.log(
    `tree print: isolated pinholes filled ${holes.filled}, despeckled ${holes.despeckled}`,
  );
  // Extend the plate to the left so no cut edge can show on a left lean.
  const frondBlock = {
    x: Math.round(60 * scale),
    y: Math.round(170 * scale),
    w: Math.round(168 * scale),
    h: Math.round(378 * scale),
  };
  const wide = extendTreeLeft(scaled, sw, sh, TREE_EXTEND, frondBlock, {
    sprayInset: 30,
    maxRun: TREE_MIRROR_RUN,
  });
  // Trunk continues 60 px below the canvas (mirrored bark rows) so an upward
  // lean never shows the file's bottom cut.
  const extended = padMirror(wide.data, wide.w, wide.h, {
    bottom: bandMargins.bottom,
  });
  void anchor;
  return {
    data: extended.data,
    w: extended.w,
    h: extended.h,
    rect: { x: rect.x - TREE_EXTEND, y: rect.y, w: extended.w, h: extended.h },
  };
}

async function buildAshtray() {
  const meta = await sharp(src('after-hours-poster.png')).metadata();
  const mask = await rasterMask(
    posterAshtray.polygons.map(svgPolygon).join(''),
    0.9,
    meta.width,
    meta.height,
  );
  const { data } = await sharp(src('after-hours-poster.png'))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgba = Buffer.from(data);
  for (let p = 0; p < meta.width * meta.height; p++) rgba[p * 4 + 3] = mask[p];
  const trimmed = trim(rgba, meta.width, meta.height, 8);
  const { rect, depth } = placements.ashtray;
  const sprite = await scaledSprite(trimmed, rect.w);
  const scale = sprite.w / trimmed.rect.w;
  const ember = {
    x: Math.round(rect.x + (posterAshtray.ember.x - trimmed.rect.x) * scale),
    y: Math.round(rect.y + (posterAshtray.ember.y - trimmed.rect.y) * scale),
  };
  return {
    ...sprite,
    rect: { x: rect.x, y: rect.y, w: sprite.w, h: sprite.h },
    ember,
    depth,
  };
}

async function buildGulls() {
  // Side-view ink silhouettes of a gull flying right, 76 × 36: slim body,
  // long gently curved wings, three poses. Soft edges.
  const ink = '#173e42';
  const body = `<path d="M10 20 L16 18 Q32 15 48 17 Q58 17 66 15 L72 14 L67 18 Q60 20 48 21 Q32 22 18 22 L10 24 Z" fill="${ink}"/>`;
  const frames = {
    'gull-up': `${body}<path d="M30 18 Q34 8 46 3 Q56 0 64 4 Q52 5 44 12 Q38 17 36 19 Z" fill="${ink}"/><path d="M40 19 Q48 12 60 9 Q66 8 68 11 Q56 13 46 20 Z" fill="${ink}"/>`,
    'gull-level': `${body}<path d="M28 19 Q40 13 56 12 Q68 12 75 14 Q60 16 46 19 Q36 20 30 21 Z" fill="${ink}"/><path d="M40 20 Q52 18 66 19 Q58 21 46 22 Z" fill="${ink}"/>`,
    'gull-down': `${body}<path d="M30 20 Q34 29 46 34 Q56 36 64 33 Q52 31 44 25 Q38 21 36 20 Z" fill="${ink}"/><path d="M40 20 Q48 27 60 30 Q66 30 68 27 Q56 25 46 20 Z" fill="${ink}"/>`,
  };
  const out = {};
  for (const [id, shapes] of Object.entries(frames)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="76" height="36">${shapes}</svg>`;
    const { data, info } = await sharp(Buffer.from(svg))
      .blur(0.6)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    out[id] = { data, w: info.width, h: info.height };
  }
  return out;
}

// ---------- QA renders ----------
async function composite(entries, shiftPerDepth = 0, file, vertical = false) {
  const inputs = [];
  for (const entry of entries) {
    const shift = shiftPerDepth ? Math.round(shiftPerDepth / entry.depth) : 0;
    const left = entry.rect.x + (vertical ? 0 : shift),
      top = entry.rect.y + (vertical ? shift : 0);
    // Clip anything that overscans the canvas (layers may; sprites do not).
    const cx = Math.max(0, -left),
      cy = Math.max(0, -top);
    const cw = Math.min(entry.w - cx, W - Math.max(0, left)),
      ch = Math.min(entry.h - cy, H - Math.max(0, top));
    if (cw <= 0 || ch <= 0) continue;
    const image = sharp(entry.data, {
      raw: { width: entry.w, height: entry.h, channels: entry.channels ?? 4 },
    }).extract({ left: cx, top: cy, width: cw, height: ch });
    inputs.push({
      input: await image.png().toBuffer(),
      left: Math.max(0, left),
      top: Math.max(0, top),
    });
  }
  await sharp({
    create: { width: W, height: H, channels: 4, background: '#ff00ff' },
  })
    .composite(inputs)
    .png()
    .toFile(file);
}

async function contactSheet(entries, file) {
  const cell = 256,
    cellH = 384,
    cols = 5;
  const rows = Math.ceil(entries.length / cols);
  const checker = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cell}" height="${rows * cellH}"><defs><pattern id="c" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#bbb"/><rect x="12" y="12" width="12" height="12" fill="#bbb"/><rect x="12" width="12" height="12" fill="#eee"/><rect y="12" width="12" height="12" fill="#eee"/></pattern></defs><rect width="100%" height="100%" fill="url(#c)"/>${entries.map((e, i) => `<text x="${(i % cols) * cell + 6}" y="${Math.floor(i / cols) * cellH + 16}" font-size="14" font-family="Arial" fill="#c00">${e.id} ${e.rect.w}×${e.rect.h} d${e.depth}</text>`).join('')}</svg>`;
  const inputs = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const scale = Math.min((cell - 12) / e.w, (cellH - 30) / e.h, 1);
    const w = Math.max(1, Math.round(e.w * scale)),
      h = Math.max(1, Math.round(e.h * scale));
    inputs.push({
      input: await sharp(e.data, {
        raw: { width: e.w, height: e.h, channels: e.channels ?? 4 },
      })
        .resize(w, h)
        .png()
        .toBuffer(),
      left: (i % cols) * cell + 6,
      top: Math.floor(i / cols) * cellH + 22,
    });
  }
  await sharp(Buffer.from(checker)).composite(inputs).png().toFile(file);
}

// ---------- main ----------
const started = Date.now();
const scene = await loadRaw(artSource('terrace-scene.png'));
if (scene.width !== W || scene.height !== H)
  throw new Error('scene plate size changed');
const sliced = await buildScene(scene.data);
{
  // Margins: paint beyond the visible band on every side the stage may lean
  // into. Sky ±120/±60, sea 60 more to the left, far coast out to x = -120,
  // paving 60 below. Layers whose edges are real painted edges are untouched.
  const pad = (id, pads) => {
    const layer = sliced[id];
    const padded = padMirror(layer.data, layer.rect.w, layer.rect.h, pads);
    layer.data = padded.data;
    layer.rect = {
      x: layer.rect.x - (pads.left || 0),
      y: layer.rect.y - (pads.top || 0),
      w: padded.w,
      h: padded.h,
    };
  };
  pad('sky', {
    left: bandMargins.left,
    right: bandMargins.right,
    top: bandMargins.top,
    bottom: bandMargins.bottom,
  });
  pad('sea', { left: 60 });
  pad('far-coast', { left: sliced['far-coast'].rect.x + 120 });
  pad('paving', { bottom: bandMargins.bottom });
}

// Colour grade, measured not guessed: poster patch means become the targets.
const poster = await loadRaw(src('after-hours-poster.png'));
const gp = gradePatches;
const target = {
  sky: meanOf(poster.data, poster.width, gp.poster.sky),
  sea: meanOf(poster.data, poster.width, gp.poster.sea),
  paving: meanOf(poster.data, poster.width, gp.poster.pavingLit),
};
const litOnly = (r, g, b) => lum(r, g, b) >= gp.plate.litMin;
const darkOnly = (r, g, b) => lum(r, g, b) <= gp.plate.darkMax;
const before = {
  sky: meanOf(scene.data, W, gp.plate.sky),
  sea: meanOf(scene.data, W, gp.plate.sea),
  paving: meanOf(scene.data, W, gp.plate.pavingLit, litOnly),
  pavingDark: meanOf(scene.data, W, gp.plate.pavingDark, darkOnly),
};
const maps = {
  sky: gainMap(before.sky, target.sky),
  sea: gainMap(before.sea, target.sea),
  paving: twoPointMap(before.paving, before.pavingDark, target.paving),
};
for (const id of ['sky', 'clouds']) grade(sliced[id].data, maps.sky);
for (const id of ['sea', 'sea-flecks']) grade(sliced[id].data, maps.sea);
grade(sliced.boat.data, maps.sea, (alpha) => alpha < 250); // water margin only
for (const id of ['parapet', 'paving']) {
  grade(sliced[id].data, maps.paving);
  // Print pass: calm cream paper, sparse stipple, hardened ink shadows.
  const options =
    id === 'parapet' ? { ...stonePrint, ...parapetPrint } : stonePrint;
  await printStone(
    sliced[id].data,
    sliced[id].rect.w,
    sliced[id].rect.h,
    options,
  );
}
{
  // The print pass greys the lit stone; re-measure on the printed paving and
  // re-grade both stone layers to the poster's warm cream (shadows pinned).
  const layer = sliced.paving;
  const local = (patches) =>
    patches.map((r) => ({
      ...r,
      x: r.x - layer.rect.x,
      y: r.y - layer.rect.y,
    }));
  const printedLit = meanOf(
    layer.data,
    layer.rect.w,
    local(gp.plate.pavingLit),
    litOnly,
  );
  const printedDark = meanOf(
    layer.data,
    layer.rect.w,
    local(gp.plate.pavingDark),
    darkOnly,
  );
  const remap = twoPointMap(printedLit, printedDark, target.paving);
  for (const id of ['parapet', 'paving']) grade(sliced[id].data, remap);
  console.log(
    `grade paving after print: lit ${fmt(printedLit)} → ${fmt(applyMapToMean(printedLit, remap))} (target ${fmt(target.paving)}); shadow ${fmt(printedDark)} → ${fmt(applyMapToMean(printedDark, remap))}`,
  );
}
{
  // Parapet face: lift the stone base to the poster's cream-grey wall tone
  // (lit pixels of the front face), shadows pinned.
  const layer = sliced.parapet;
  const w = layer.rect.w,
    h = layer.rect.h;
  const faceLit = (r, g, b) => lum(r, g, b) >= 80;
  const faceDark = (r, g, b) => lum(r, g, b) < 80;
  const rows = {
    x: 0,
    y: parapetPrint.faceRows.fromTop,
    w,
    h: h - parapetPrint.faceRows.fromTop - parapetPrint.faceRows.toBottom,
  };
  const before = meanOf(layer.data, w, [rows], faceLit);
  const dark = meanOf(layer.data, w, [rows], faceDark);
  // Gain on the whole wall so the face mean (blotches included) meets the
  // poster's cream-grey; the cap's ink band lightens with it but stays ink.
  const overall = meanOf(layer.data, w, [rows]);
  const remap = gainMap(overall, parapetPrint.faceTarget);
  void dark;
  grade(layer.data, remap);
  // Cap: a clean lighter strip from the layer's top edge down to `capDepth`
  // px below the painted top edge, flattened toward the cap's own mean.
  {
    const capMeanRows = { x: 0, y: 0, w, h: parapetOverlap + 6 };
    const capTone = meanOf(layer.data, w, [capMeanRows]).map((v) =>
      clamp8(v * 1.04),
    );
    for (let x = 0; x < w; x++) {
      const capBottom =
        Math.round(parapetTop(x + layer.rect.x) + parapetPrint.capDepth) -
        layer.rect.y;
      for (let y = 0; y < Math.min(h, capBottom); y++) {
        const p = (y * w + x) * 4;
        if (layer.data[p + 3] < 8) continue;
        const g = (hash2(x, y, 91) - 0.5) * 6;
        for (let c = 0; c < 3; c++)
          layer.data[p + c] = clamp8(
            Math.round(
              layer.data[p + c] * (1 - parapetPrint.capFlatten) +
                (capTone[c] + g) * parapetPrint.capFlatten,
            ),
          );
      }
    }
  }
  const after = meanOf(layer.data, w, [rows], faceLit);
  const all = meanOf(layer.data, w, [rows]);
  console.log(
    `grade parapet face: lit ${fmt(before)} → ${fmt(after)} (target ${fmt(parapetPrint.faceTarget)}); face mean incl. shadows ${fmt(all)}`,
  );
}
{
  // Table pedestal: soften the rectangular plinth into a blue-ink ellipse
  // (scene-plate coordinates inside the paving layer).
  const layer = sliced.paving;
  const w = layer.rect.w;
  const box = plinth.box,
    e = plinth.ellipse;
  for (let y = box.y; y < box.y + box.h; y++)
    for (let x = box.x; x < box.x + box.w; x++) {
      const lx = x - layer.rect.x,
        ly = y - layer.rect.y;
      const srcRow = box.y + box.h + (box.y + box.h - y) - layer.rect.y; // mirrored row below
      const src = srcRow * w + lx;
      const d = ((x - e.cx) / e.rx) ** 2 + ((y - e.cy) / e.ry) ** 2;
      const p = ly * w + lx;
      if (d <= 1) {
        const k = Math.min(1, (1 - d) * 3) * shadowFamily.opacity;
        for (let c = 0; c < 3; c++)
          layer.data[p * 4 + c] = clamp8(
            Math.round(layer.data[src * 4 + c] * (1 - k) + inks.ink[c] * k),
          );
      } else
        for (let c = 0; c < 3; c++)
          layer.data[p * 4 + c] = clamp8(layer.data[src * 4 + c] + jitter(3));
    }
}
const after = {
  sky: applyMapToMean(before.sky, maps.sky),
  sea: applyMapToMean(before.sea, maps.sea),
  paving: applyMapToMean(before.paving, maps.paving),
  pavingDark: applyMapToMean(before.pavingDark, maps.paving),
};
for (const region of ['sky', 'sea', 'paving'])
  console.log(
    `grade ${region}: poster ${fmt(target[region])} | plate before ${fmt(before[region])} → after ${fmt(after[region])}`,
  );
console.log(
  `grade paving shadow anchor: ${fmt(before.pavingDark)} → ${fmt(after.pavingDark)}`,
);
const props = await buildProps();
const chair = await buildChair();
const tree = await buildTree();
const ashtray = await buildAshtray();
const gulls = await buildGulls();

const layerOrder = [
  'sky',
  'clouds',
  'far-coast',
  'sea',
  'sea-flecks',
  'near-coast',
  'parapet',
  'paving',
];
const manifest = {
  version: 1,
  canvas: { ...CANVAS },
  // The cream this print is on: shows wherever no plate covers the view.
  paper: '#f2dba2',
  layers: [],
  sprites: [],
};
const qaEntries = [];

for (const id of layerOrder) {
  const layer = sliced[id];
  const opaque = layer.opaque === true;
  let data = layer.data;
  let channels = 4;
  if (opaque) {
    channels = 3;
    data = Buffer.alloc(layer.rect.w * layer.rect.h * 3);
    for (let p = 0; p < layer.rect.w * layer.rect.h; p++) {
      data[p * 3] = layer.data[p * 4];
      data[p * 3 + 1] = layer.data[p * 4 + 1];
      data[p * 3 + 2] = layer.data[p * 4 + 2];
    }
  }
  // A drifting layer is sampled with horizontal repeat, so its own right edge
  // wraps into the left of the screen. Fade both ends to nothing and tint the
  // streaks toward the poster's sage grey, then prove the ends are empty.
  if (id === 'clouds') {
    const { w, h } = layer.rect;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (!data[i + 3]) continue;
        for (let c = 0; c < 3; c++)
          data[i + c] = Math.round(
            data[i + c] * (1 - cloudPrint.tintMix) +
              cloudPrint.tint[c] * cloudPrint.tintMix,
          );
        const edge = Math.min(x, w - 1 - x);
        if (edge < cloudPrint.edgeFade)
          data[i + 3] = Math.round(data[i + 3] * (edge / cloudPrint.edgeFade));
      }
    for (let y = 0; y < h; y++)
      for (const x of [0, w - 1])
        if (data[(y * w + x) * 4 + 3] !== 0)
          throw new Error('drift layer must be empty at both ends to tile');
  }
  await writePng(`${id}.png`, data, layer.rect.w, layer.rect.h, channels);
  const kind =
    id === 'clouds'
      ? 'drift'
      : id === 'sea'
        ? 'sea'
        : id === 'sea-flecks'
          ? 'flecks'
          : 'static';
  // The paving/table layer is shifted so the table centres on a phone; the
  // file is unchanged and the layer may overscan the canvas edge.
  const rect =
    id === 'paving'
      ? { ...layer.rect, x: layer.rect.x + pavingOffsetX }
      : layer.rect;
  manifest.layers.push({
    id,
    file: `${id}.png`,
    rect,
    depth: depths[id],
    kind,
    ...(id === 'clouds' ? { opacity: cloudPrint.opacity } : {}),
  });
  qaEntries.push({
    id,
    data: layer.data,
    w: layer.rect.w,
    h: layer.rect.h,
    rect,
    depth: depths[id],
  });
}
const shadowSpecs = {
  'chair-shadow': placements.chair.shadow,
  'records-shadow': placements.recordPlayer.shadow,
};
for (const [id, spec] of Object.entries(shadowSpecs)) {
  const canvas = ellipseShadow({ ...spec, ...shadowFamily, ink: inks.ink });
  const trimmed = trim(canvas.data, canvas.w, canvas.h, 2);
  const layer = {
    data: trimmed.data,
    w: trimmed.rect.w,
    h: trimmed.rect.h,
    rect: {
      x: Math.round(spec.cx - canvas.cx) + trimmed.rect.x,
      y: Math.round(spec.cy - canvas.cy) + trimmed.rect.y,
      w: trimmed.rect.w,
      h: trimmed.rect.h,
    },
  };
  await writePng(`${id}.png`, layer.data, layer.w, layer.h);
  manifest.layers.push({
    id,
    file: `${id}.png`,
    rect: layer.rect,
    depth: depths.paving,
    kind: 'static',
  });
  qaEntries.push({
    id,
    data: layer.data,
    w: layer.w,
    h: layer.h,
    rect: layer.rect,
    depth: depths.paving,
  });
}
await writePng('chair.png', chair.data, chair.w, chair.h);
manifest.layers.push({
  id: 'chair',
  file: 'chair.png',
  rect: chair.rect,
  depth: placements.chair.depth,
  kind: 'static',
});
qaEntries.push({
  id: 'chair',
  data: chair.data,
  w: chair.w,
  h: chair.h,
  rect: chair.rect,
  depth: placements.chair.depth,
});
await writePng('tree.png', tree.data, tree.w, tree.h);
manifest.layers.push({
  id: 'tree',
  file: 'tree.png',
  rect: tree.rect,
  depth: placements.tree.depth,
  kind: 'breeze',
  anchor: placements.tree.anchor,
  breeze: placements.tree.breeze,
});

const boatSprite = sliced.boat;
await writePng(
  'boat.png',
  boatSprite.data,
  boatSprite.rect.w,
  boatSprite.rect.h,
);
const boatRect = {
  x: placements.boat.rect.x,
  y: placements.boat.rect.y,
  w: boatSprite.rect.w,
  h: boatSprite.rect.h,
};
manifest.sprites.push({
  id: 'boat',
  file: 'boat.png',
  rect: boatRect,
  depth: placements.boat.depth,
  kind: 'boat',
  route: placements.boat.route,
});
{
  // Second boat: the first boat's hull (darkened) under an SVG gaff sail in
  // rust with an ink mast, a cream jib and ink outlines, 64 × 96.
  const hullSrc = boatSprite;
  const hullTop = Math.round(hullSrc.rect.h * 0.72);
  const hullH = hullSrc.rect.h - hullTop;
  const hull = Buffer.alloc(hullSrc.rect.w * hullH * 4);
  for (let y = 0; y < hullH; y++)
    for (let x = 0; x < hullSrc.rect.w; x++) {
      const q = ((y + hullTop) * hullSrc.rect.w + x) * 4,
        d = (y * hullSrc.rect.w + x) * 4;
      hull[d] = clamp8(hullSrc.data[q] * 0.7);
      hull[d + 1] = clamp8(hullSrc.data[q + 1] * 0.7);
      hull[d + 2] = clamp8(hullSrc.data[q + 2] * 0.75);
      hull[d + 3] = hullSrc.data[q + 3];
    }
  const hullPng = await sharp(hull, {
    raw: { width: hullSrc.rect.w, height: hullH, channels: 4 },
  })
    .resize(58, Math.round((hullH * 58) / hullSrc.rect.w))
    .png()
    .toBuffer();
  const hullMeta = await sharp(hullPng).metadata();
  const deck = 96 - hullMeta.height;
  const sailSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="96"><path d="M24 6 L24 ${deck - 2}" stroke="#173e42" stroke-width="2"/><path d="M25 12 L50 20 L52 ${deck - 6} L25 ${deck - 4} Z" fill="rgb(${inks.rust.join(',')})" stroke="#173e42" stroke-width="1"/><path d="M23 18 L8 ${deck - 8} L23 ${deck - 4} Z" fill="rgb(${inks.cream.join(',')})" stroke="#173e42" stroke-width="1"/></svg>`;
  const boat2Png = await sharp(Buffer.from(sailSvg))
    .composite([{ input: hullPng, left: 3, top: deck }])
    .png()
    .toBuffer();
  const boat2 = await sharp(boat2Png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const t2 = trim(boat2.data, boat2.info.width, boat2.info.height, 8);
  await writePng('boat-2.png', t2.data, t2.rect.w, t2.rect.h);
  props['boat-2'] = { data: t2.data, w: t2.rect.w, h: t2.rect.h };
  manifest.sprites.push({
    id: 'boat-2',
    file: 'boat-2.png',
    rect: {
      x: placements.boat2.rect.x,
      y: placements.boat2.rect.y,
      w: t2.rect.w,
      h: t2.rect.h,
    },
    depth: placements.boat2.depth,
    kind: 'boat',
    route: placements.boat2.route,
  });
}

for (const [id, frame] of Object.entries(gulls))
  await writePng(`${id}.png`, frame.data, frame.w, frame.h);
{
  const g = placements.gull.rect;
  const first = gulls['gull-up'];
  manifest.sprites.push({
    id: 'gull',
    file: 'gull-up.png',
    files: ['gull-up.png', 'gull-level.png', 'gull-down.png'],
    rect: { x: g.x, y: g.y, w: first.w, h: first.h },
    depth: placements.gull.depth,
    kind: 'gull',
  });
}
{
  const baked = bakeShadowUnder(ashtray, propShadow, inks.ink);
  ashtray.rect = {
    x: ashtray.rect.x - baked.padSide,
    y: ashtray.rect.y,
    w: baked.w,
    h: baked.h,
  };
  ashtray.data = baked.data;
  ashtray.w = baked.w;
  ashtray.h = baked.h;
}
await writePng('ashtray.png', ashtray.data, ashtray.w, ashtray.h);
manifest.sprites.push({
  id: 'ashtray',
  file: 'ashtray.png',
  rect: ashtray.rect,
  depth: ashtray.depth,
  kind: 'static',
  ember: ashtray.ember,
});
for (const id of ['journal', 'globe', 'magnifier']) {
  const prop = props[id];
  const baked = bakeShadowUnder(prop, propShadow, inks.ink);
  const rect = {
    x: prop.rect.x - baked.padSide,
    y: prop.rect.y,
    w: baked.w,
    h: baked.h,
  };
  props[id] = { data: baked.data, w: baked.w, h: baked.h, rect };
  await writePng(`${id}.png`, baked.data, baked.w, baked.h);
  manifest.sprites.push({
    id,
    file: `${id}.png`,
    rect,
    depth: placements[id].depth,
    kind: 'prop',
    destination: placements[id].destination,
    caption: placements[id].caption,
  });
}
{
  // Turntable as a `player`: body (case with a dark platter where the record
  // sits, arm removed), a top-down vinyl disc, and the tone arm parked.
  const rp = placements.recordPlayer;
  const prop = props.recordPlayer;
  const w = prop.w,
    h = prop.h;
  const body = Buffer.from(prop.data);
  const cos = Math.cos((rp.disc.yaw * Math.PI) / 180),
    sin = Math.sin((rp.disc.yaw * Math.PI) / 180);
  const inDisc = (x, y) => {
    const dx = x - rp.disc.cx,
      dy = y - rp.disc.cy;
    const u = (dx * cos + dy * sin) / rp.disc.rx,
      v = (-dx * sin + dy * cos) / rp.disc.ry;
    return u * u + v * v <= 1;
  };
  const armMaskSvg = `${svgPolygon(rp.armPolygon)}<circle cx="${rp.pivot.x}" cy="${rp.pivot.y}" r="15" fill="#fff"/>`;
  const armMask = await rasterMask(armMaskSvg, 0.6, w, h);
  /** The same groove at another angle of the record: index, or null. */
  const discDonor = (x, y) => {
    const dx = x - rp.disc.cx,
      dy = y - rp.disc.cy;
    const u = (dx * cos + dy * sin) / rp.disc.rx,
      v = (-dx * sin + dy * cos) / rp.disc.ry;
    for (const turn of [Math.PI, Math.PI * 0.6, Math.PI * 1.4, Math.PI * 0.3]) {
      const ct = Math.cos(turn),
        st = Math.sin(turn);
      const su = (u * ct - v * st) * rp.disc.rx,
        sv = (u * st + v * ct) * rp.disc.ry;
      const sx = Math.round(rp.disc.cx + su * cos - sv * sin),
        sy = Math.round(rp.disc.cy + su * sin + sv * cos);
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const q = sy * w + sx;
      if (armMask[q] > 8 || prop.data[q * 4 + 3] < 8) continue;
      return q;
    }
    return null;
  };
  const armOnly = Buffer.alloc(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const x = p % w,
      y = (p / w) | 0;
    if (armMask[p] > 8 && prop.data[p * 4 + 3] > 8) {
      armOnly.set(prop.data.subarray(p * 4, p * 4 + 4), p * 4);
      armOnly[p * 4 + 3] = Math.round(
        (prop.data[p * 4 + 3] * armMask[p]) / 255,
      );
    }
    if (body[p * 4 + 3] < 8) continue;
    // The painted vinyl stays in the body; only the arm is lifted out and
    // its trace filled: record dark inside the disc, case ink outside.
    if (armMask[p] > 8 && Math.hypot(x - rp.pivot.x, y - rp.pivot.y) > 15) {
      const j = Math.round((hash2(x, y, 71) - 0.5) * 8);
      // A record is rotationally symmetric, so the vinyl the arm hid is
      // borrowed from another angle of the same grooves; a flat tone there
      // read as a hole once the arm swung away. Only the case falls back
      // to ink.
      const donor = inDisc(x, y) ? discDonor(x, y) : null;
      const tone = donor
        ? [
            prop.data[donor * 4],
            prop.data[donor * 4 + 1],
            prop.data[donor * 4 + 2],
          ]
        : inks.ink;
      body[p * 4] = clamp8(tone[0] + j);
      body[p * 4 + 1] = clamp8(tone[1] + j);
      body[p * 4 + 2] = clamp8(tone[2] + j);
    }
  }
  await writePng('player-body.png', body, w, h);
  // No separate disc part: the painted vinyl stays in the body.
  // Tone arm parked: the drawn (playing) arm rotated counter-clockwise on
  // screen by |playAngle| about the pivot (sharp rotates clockwise for
  // positive angles, about the canvas centre; the pivot is re-derived).
  const rot = -rp.playAngle;
  const rotated = await sharp(armOnly, {
    raw: { width: w, height: h, channels: 4 },
  })
    .rotate(-rot, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rw = rotated.info.width,
    rh = rotated.info.height;
  // Find the rotated pivot empirically: rotate a one-pixel marker the same way.
  const marker = Buffer.alloc(w * h * 4);
  marker.set([255, 255, 255, 255], (rp.pivot.y * w + rp.pivot.x) * 4);
  const markerRot = await sharp(marker, {
    raw: { width: w, height: h, channels: 4 },
  })
    .rotate(-rot, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let mx = 0,
    my = 0,
    mn = 0;
  for (let p = 0; p < markerRot.info.width * markerRot.info.height; p++) {
    const a = markerRot.data[p * 4 + 3];
    if (!a) continue;
    mx += (p % markerRot.info.width) * a;
    my += ((p / markerRot.info.width) | 0) * a;
    mn += a;
  }
  const pivotRot = { x: mx / mn, y: my / mn };
  const armTrim = trim(rotated.data, rw, rh, 8);
  await writePng(
    'player-arm.png',
    armTrim.data,
    armTrim.rect.w,
    armTrim.rect.h,
  );
  const pivotCanvas = {
    x: prop.rect.x + rp.pivot.x,
    y: prop.rect.y + rp.pivot.y,
  };
  const armRect = {
    x: Math.round(pivotCanvas.x - (pivotRot.x - armTrim.rect.x)),
    y: Math.round(pivotCanvas.y - (pivotRot.y - armTrim.rect.y)),
    w: armTrim.rect.w,
    h: armTrim.rect.h,
  };
  const tilt = Math.round((Math.acos(rp.disc.ry / rp.disc.rx) * 180) / Math.PI);
  props.recordPlayer = { data: body, w, h, rect: prop.rect };
  const player = {
    id: 'recordPlayer',
    file: 'player-body.png',
    rect: prop.rect,
    depth: rp.depth,
    kind: 'player',
    destination: rp.destination,
    caption: rp.caption,
    parts: {
      body: { file: 'player-body.png', rect: prop.rect },
      arm: {
        file: 'player-arm.png',
        rect: armRect,
        pivot: pivotCanvas,
        // The arm is drawn in its play pose; at rest it swings back onto its
        // cradle right of the platter so no wedge lies over the vinyl.
        restAngle: rp.restAngle ?? 0,
        playAngle: rp.playAngle,
      },
    },
  };
  manifest.sprites.push(player);
  void tilt;
  console.log(
    `player: arm rect ${JSON.stringify(armRect)} pivot ${JSON.stringify(pivotCanvas)}`,
  );
}
for (const entry of [...manifest.layers, ...manifest.sprites])
  if (safeEdges[entry.id]) entry.safeEdges = [...safeEdges[entry.id]];
writeFileSync(
  path.join(outDir, 'manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);

// QA composites: rest, reveal (per-depth horizontal shift), contact sheet.
const spriteEntries = manifest.sprites
  .filter((s) => s.kind !== 'gull')
  .map((s) => ({
    id: s.id,
    depth: s.depth,
    rect: s.rect,
    data:
      s.id === 'boat'
        ? boatSprite.data
        : s.id === 'ashtray'
          ? ashtray.data
          : props[s.id].data,
    w: s.rect.w,
    h: s.rect.h,
  }));
const treeEntry = {
  id: 'tree',
  data: tree.data,
  w: tree.w,
  h: tree.h,
  rect: tree.rect,
  depth: placements.tree.depth,
};
const all = [
  ...qaEntries.filter((e) => e.id !== 'chair'),
  ...spriteEntries,
  qaEntries.find((e) => e.id === 'chair'),
  treeEntry,
];
// sky entry is RGBA in memory (alpha 255) so composite() works uniformly
await composite(all, 0, path.join(qaDir, 'composite-rest.png'));
await composite(all, 120, path.join(qaDir, 'reveal-check.png'));
await composite(all, 120, path.join(qaDir, 'reveal-check-vertical.png'), true);
{
  // Near-coast must be opaque across the parapet's overlap band, and the
  // parapet's top alpha must be hard along its whole width.
  const nc = sliced['near-coast'],
    pa = sliced.parapet;
  let ncMin = 255,
    paMin = 255;
  for (let x = 0; x < 385; x++)
    for (
      let y = Math.floor(parapetTop(x)) - parapetOverlap;
      y < Math.floor(parapetTop(x)) + 40;
      y++
    ) {
      const lx = x - nc.rect.x,
        ly = y - nc.rect.y;
      if (lx < 0 || ly < 0 || lx >= nc.rect.w || ly >= nc.rect.h) {
        ncMin = 0;
        continue;
      }
      ncMin = Math.min(ncMin, nc.data[(ly * nc.rect.w + lx) * 4 + 3]);
    }
  for (let x = 0; x < W; x++) {
    const y = Math.ceil(parapetTop(x)) - parapetOverlap + 1;
    const lx = x - pa.rect.x,
      ly = y - pa.rect.y;
    paMin = Math.min(paMin, pa.data[(ly * pa.rect.w + lx) * 4 + 3]);
  }
  console.log(
    `seam check: near-coast min alpha in parapet band ${ncMin}; parapet top-row min alpha ${paMin}`,
  );
}
const gullEntries = Object.entries(gulls).map(([id, g]) => ({
  id,
  data: g.data,
  w: g.w,
  h: g.h,
  rect: { x: 0, y: 0, w: g.w, h: g.h },
  depth: placements.gull.depth,
}));
{
  // Per-layer paint margins beyond the visible band (x 165..859, y 0..1536).
  const band = { x0: 165, x1: 859, y0: 0, y1: H };
  const rows = manifest.layers.map(
    (l) =>
      `${l.id} L${band.x0 - l.rect.x} R${l.rect.x + l.rect.w - band.x1} T${band.y0 - l.rect.y} B${l.rect.y + l.rect.h - band.y1}`,
  );
  console.log('margins (px of paint beyond the band): ' + rows.join(' | '));
}
await contactSheet(
  [...qaEntries, treeEntry, ...spriteEntries, ...gullEntries],
  path.join(qaDir, 'contact-sheet.png'),
);

// Print check: the visible portrait band beside the poster at equal height.
{
  const band = { x: 165, y: 0, w: 694, h: H };
  const posterPng = await sharp(src('after-hours-poster.png'))
    .resize({ height: 1024 })
    .png()
    .toBuffer();
  const appPng = await sharp(path.join(qaDir, 'composite-rest.png'))
    .extract({ left: band.x, top: band.y, width: band.w, height: band.h })
    .resize({ height: 1024 })
    .png()
    .toBuffer();
  const pm = await sharp(posterPng).metadata(),
    am = await sharp(appPng).metadata();
  await sharp({
    create: {
      width: pm.width + am.width + 16,
      height: 1024,
      channels: 3,
      background: '#000',
    },
  })
    .composite([
      { input: posterPng, left: 0, top: 0 },
      { input: appPng, left: pm.width + 16, top: 0 },
    ])
    .png()
    .toFile(path.join(qaDir, '_print-check.png'));
  // Paper / ink / ochre shares: poster top third and lower half; app band
  // top third and lower half above the footer (y < 1340).
  const pct = (v) =>
    `${(v.paper * 100).toFixed(0)}% paper / ${(v.ink * 100).toFixed(0)}% ink / ${(v.ochre * 100).toFixed(0)}% ochre`;
  const shares = (data, width, rects) =>
    rects
      .map(([label, r]) => `${label}: ${pct(printShares(data, width, r))}`)
      .join('; ');
  console.log(
    'shares poster —',
    shares(poster.data, poster.width, [
      ['top third', { x: 0, y: 0, w: poster.width, h: 341 }],
      ['lower half', { x: 0, y: 512, w: poster.width, h: 512 }],
    ]),
  );
  const appRects = [
    ['top third', { x: 165, y: 0, w: 694, h: 512 }],
    ['lower half', { x: 165, y: 768, w: 694, h: 572 }],
  ];
  const beforeFile = path.join(qaDir, '_composite-round4.png');
  if (existsSync(beforeFile)) {
    const b = await sharp(beforeFile)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    console.log('shares app before —', shares(b.data, b.info.width, appRects));
  }
  const a = await sharp(path.join(qaDir, 'composite-rest.png'))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  console.log('shares app after  —', shares(a.data, a.info.width, appRects));
}

const manifestFiles = [...manifest.layers, ...manifest.sprites].map(
  (e) => e.file,
);
for (const file of manifestFiles)
  if (!existsSync(path.join(outDir, file))) throw new Error(`missing ${file}`);
const total = manifestFiles.reduce(
  (n, f) => n + readFileSync(path.join(outDir, f)).length,
  0,
);
console.log(
  `plates built: ${manifestFiles.length} files, ${(total / 1048576).toFixed(1)} MB on disk, ${((Date.now() - started) / 1000).toFixed(1)} s`,
);
