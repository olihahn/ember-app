// Print passes for the terrace theme: flat inks, sparse stipple, hard shadows.
// Pure functions over raw RGBA buffers plus sharp for median/blur/resize.
import sharp from 'sharp';

const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
export const lum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;

/** Deterministic 0..1 hash of a 2-D cell. */
export function hash2(x, y, seed = 7) {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function hsv(r, g, b) {
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

/** Separable max (dilate) / min (erode) filters on a Uint8 mask. */
function axisFilter(mask, W, H, r, pick) {
  const tmp = new Uint8Array(W * H);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = mask[y * W + x];
      for (let d = 1; d <= r; d++) {
        if (x - d >= 0) v = pick(v, mask[y * W + x - d]);
        if (x + d < W) v = pick(v, mask[y * W + x + d]);
      }
      tmp[y * W + x] = v;
    }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = tmp[y * W + x];
      for (let d = 1; d <= r; d++) {
        if (y - d >= 0) v = pick(v, tmp[(y - d) * W + x]);
        if (y + d < H) v = pick(v, tmp[(y + d) * W + x]);
      }
      out[y * W + x] = v;
    }
  return out;
}
export const dilate = (m, W, H, r) => axisFilter(m, W, H, r, Math.max);
export const erode = (m, W, H, r) => axisFilter(m, W, H, r, Math.min);

async function medianRgba(rgba, W, H, size) {
  const { data } = await sharp(rgba, {
    raw: { width: W, height: H, channels: 4 },
  })
    .median(size)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

/**
 * Canopy print pass (round 6): the toned canopy texture is kept; only the
 * hanging-frond mass is flattened to ink (sky gaps transparent, mid-tones
 * olive), and isolated pinholes of a few px are filled.
 */
export function printCanopy(rgba, W, H, o) {
  const N = W * H;
  // Hanging fronds: the source paints them over an opaque ochre-paper
  // block. Key the paper to transparency, then keep only leaf-shaped dark
  // paint: open (drops thin interstitial fill) and erode (separates
  // leaflets), edges left crisp.
  const leaf = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    if (rgba[p * 4 + 3] < 8) continue;
    const x = p % W,
      y = (p / W) | 0;
    if (!(o.backing ? o.backing(x, y) : o.frond(x, y))) continue;
    const r = rgba[p * 4],
      g = rgba[p * 4 + 1],
      b = rgba[p * 4 + 2];
    const [h, sat] = hsv(r, g, b);
    const paper =
      lum(r, g, b) > o.frondPaperLum && !(h >= 20 && h <= 42 && sat > 0.55);
    if (paper) rgba[p * 4 + 3] = 0;
    else if (o.frond(x, y)) leaf[p] = 255;
  }
  const opened = dilate(erode(leaf, W, H, o.frondOpen), W, H, o.frondOpen);
  const thinned = erode(opened, W, H, o.frondErode);
  for (let p = 0; p < N; p++) {
    const x = p % W,
      y = (p / W) | 0;
    if (!o.frond(x, y)) continue;
    if (!thinned[p]) rgba[p * 4 + 3] = 0;
  }
  // Isolated pinholes: gaps closed by a small radius whose neighbourhood is
  // mostly solid; filled with the mean of the surrounding opaque paint.
  const solid = new Uint8Array(N);
  for (let p = 0; p < N; p++) solid[p] = rgba[p * 4 + 3] > 128 ? 255 : 0;
  const closed = erode(dilate(solid, W, H, o.holeRadius), W, H, o.holeRadius);
  let filled = 0;
  for (let p = 0; p < N; p++) {
    if (!closed[p] || solid[p]) continue;
    const x = p % W,
      y = (p / W) | 0;
    let n = 0,
      tot = 0;
    const acc = [0, 0, 0];
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const xx = x + dx,
          yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        tot++;
        const q = yy * W + xx;
        if (!solid[q]) continue;
        n++;
        acc[0] += rgba[q * 4];
        acc[1] += rgba[q * 4 + 1];
        acc[2] += rgba[q * 4 + 2];
      }
    if (n < tot * o.holeSolidity) continue;
    for (let c = 0; c < 3; c++) rgba[p * 4 + c] = Math.round(acc[c] / n);
    rgba[p * 4 + 3] = 255;
    filled++;
  }
  // Despeckle: 1–3 px pale dots inside dark foliage take the dark mean of
  // their 5×5 neighbourhood; isolated opaque dots outside the mass vanish.
  let despeckled = 0;
  const copy = Buffer.from(rgba);
  for (let p = 0; p < N; p++) {
    if (copy[p * 4 + 3] < 128) continue;
    const x = p % W,
      y = (p / W) | 0;
    const l = lum(copy[p * 4], copy[p * 4 + 1], copy[p * 4 + 2]);
    let dark = 0,
      clear = 0,
      n = 0;
    const acc = [0, 0, 0];
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx,
          yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        n++;
        const q = yy * W + xx;
        if (copy[q * 4 + 3] < 128) {
          clear++;
          continue;
        }
        const lq = lum(copy[q * 4], copy[q * 4 + 1], copy[q * 4 + 2]);
        if (lq < 95) {
          dark++;
          acc[0] += copy[q * 4];
          acc[1] += copy[q * 4 + 1];
          acc[2] += copy[q * 4 + 2];
        }
      }
    if (l > 140 && dark >= n * 0.7) {
      for (let c = 0; c < 3; c++) rgba[p * 4 + c] = Math.round(acc[c] / dark);
      despeckled++;
    } else if (clear >= n * 0.8) {
      rgba[p * 4 + 3] = 0;
      despeckled++;
    }
  }
  return { filled, despeckled };
}

/**
 * Lobed trim: alpha is kept where `inside(x, y)`; beyond the edge only thin
 * structures of the original art (branches, tufts: what a small opening
 * removes) survive, tapering over `tipMin..tipMax` px so real branch ends
 * poke past the contour. Then a 2 px feather along the edge band.
 */
export function lobedTrim(rgba, W, H, inside, distance, o) {
  const N = W * H;
  const orig = new Uint8Array(N);
  for (let p = 0; p < N; p++) orig[p] = rgba[p * 4 + 3] > 128 ? 255 : 0;
  const opened = dilate(erode(orig, W, H, o.thinRadius), W, H, o.thinRadius);
  const alpha = new Float32Array(N);
  for (let p = 0; p < N; p++) {
    const x = p % W,
      y = (p / W) | 0;
    const a = rgba[p * 4 + 3] / 255;
    if (inside(x, y)) {
      alpha[p] = a;
      continue;
    }
    if (!orig[p] || opened[p]) {
      alpha[p] = 0;
      continue;
    }
    const reach =
      o.tipMin + hash2((x / 24) | 0, (y / 24) | 0, 61) * (o.tipMax - o.tipMin);
    alpha[p] = a * Math.min(1, Math.max(0, 1 + distance(x, y) / reach));
  }
  const tmp = new Float32Array(N);
  for (let pass = 0; pass < 2; pass++) {
    const src = pass === 0 ? alpha : tmp,
      dst = pass === 0 ? tmp : alpha;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        const d = distance(x, y);
        if (d > o.bandOuter || d < -o.tipMax - 4) {
          dst[p] = src[p];
          continue;
        }
        let sum = 0,
          n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx,
              yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            sum += src[yy * W + xx];
            n++;
          }
        dst[p] = sum / n;
      }
  }
  for (let p = 0; p < N; p++) rgba[p * 4 + 3] = Math.round(alpha[p] * 255);
}

/**
 * Stone/paving print pass: mottle flattened toward calm cream paper, specks
 * thinned to sparse stipple, painted ink shadows kept and hardened.
 */
export async function printStone(rgba, W, H, o) {
  const med = await medianRgba(rgba, W, H, o.median);
  const creamLum = lum(...o.cream);
  const N = W * H;
  for (let p = 0; p < N; p++) {
    const a = rgba[p * 4 + 3];
    if (a === 0) continue;
    const x = p % W,
      y = (p / W) | 0;
    const m = [med[p * 4], med[p * 4 + 1], med[p * 4 + 2]];
    const lm = lum(...m);
    const lp = lum(rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2]);
    let c;
    if (lm < o.shadowLum) {
      // Hard ink shadow: pull toward the flat shadow tone.
      c = m.map((v, i) => v * (1 - o.harden) + o.shadowTone[i] * o.harden);
    } else {
      const recol = o.cream.map((v) => (v * lm) / creamLum);
      c = m.map((v, i) => v * (1 - o.flatten) + recol[i] * o.flatten);
      // Mid-tone mottle shades toward blue ink, as the poster shades stone,
      // instead of darkening into ochre.
      // Optionally read the mottle through a horizontal window so blotches
      // become short horizontal flecks (stone courses), not round spots.
      let lmShade = lm;
      if (o.horizontalFlecks) {
        let sum = 0,
          n = 0;
        for (let dx = -o.horizontalFlecks; dx <= o.horizontalFlecks; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          const q = (y * W + xx) * 4;
          sum += lum(med[q], med[q + 1], med[q + 2]);
          n++;
        }
        lmShade = sum / n;
      }
      const shade =
        Math.min(
          1,
          Math.max(0, (o.midLum - lmShade) / (o.midLum - o.shadowLum)),
        ) * o.inkShade;
      c = c.map((v, i) => v * (1 - shade) + o.shadowTone[i] * shade);
      const speck = lp < lm - o.speckDepth;
      if (
        speck &&
        hash2((x / o.speckCell) | 0, (y / o.speckCell) | 0, 5) < o.speckKeep
      )
        c = c.map((v, i) => v * 0.35 + o.ink[i] * 0.65);
    }
    const j = Math.round((hash2(x, y, 9) - 0.5) * 2 * o.grain);
    rgba[p * 4] = clamp8(Math.round(c[0] + j));
    rgba[p * 4 + 1] = clamp8(Math.round(c[1] + j));
    rgba[p * 4 + 2] = clamp8(Math.round(c[2] + j));
  }
}

/** Posterise a sprite to a small ink palette with paper grain and ragged edges. */
export async function posteriseProp(rgba, W, H, palette, o) {
  const med = await medianRgba(rgba, W, H, o.median);
  const N = W * H;
  const pal = palette.map((c) => ({ c, l: lum(...c) }));
  for (let p = 0; p < N; p++) {
    let a = rgba[p * 4 + 3];
    if (a === 0) continue;
    const x = p % W,
      y = (p / W) | 0;
    if (a < 250 && a > 5) {
      a = clamp8(a + Math.round((hash2(x, y, 13) - 0.5) * 2 * o.edgeNoise));
      rgba[p * 4 + 3] = a >= 128 ? 255 : 0;
      if (a < 128) continue;
    }
    const r = med[p * 4],
      g = med[p * 4 + 1],
      b = med[p * 4 + 2];
    const l = lum(r, g, b);
    let best = pal[0],
      bestD = Infinity;
    for (const q of pal) {
      const d =
        (q.c[0] - r) ** 2 +
        (q.c[1] - g) ** 2 +
        (q.c[2] - b) ** 2 +
        o.lumWeight * (q.l - l) ** 2;
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
    const j = Math.round((hash2(x, y, 17) - 0.5) * 2 * o.grain);
    rgba[p * 4] = clamp8(best.c[0] + j);
    rgba[p * 4 + 1] = clamp8(best.c[1] + j);
    rgba[p * 4 + 2] = clamp8(best.c[2] + j);
  }
}

/**
 * Magnifier lens: flat turquoise disc with one cream highlight stroke. The
 * lens is found as the cyan-hued region; returns its circle for the record.
 */
export async function flattenLens(rgba, W, H, o) {
  const N = W * H;
  // Lens glass = pixels posterised to the turquoise ink. The handle can share
  // that ink, so the disc is fitted to the eroded mask (thin parts vanish).
  const glass = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    if (rgba[p * 4 + 3] < 128) continue;
    const dist = Math.max(
      Math.abs(rgba[p * 4] - o.turquoise[0]),
      Math.abs(rgba[p * 4 + 1] - o.turquoise[1]),
      Math.abs(rgba[p * 4 + 2] - o.turquoise[2]),
    );
    if (dist <= o.tolerance) glass[p] = 255;
  }
  const core = erode(glass, W, H, o.erode);
  let x0 = W,
    y0 = H,
    x1 = -1,
    y1 = -1;
  for (let p = 0; p < N; p++) {
    if (!core[p]) continue;
    const x = p % W,
      y = (p / W) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  const cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2,
    r = Math.max(x1 - x0, y1 - y0) / 2 + o.erode;
  // Flatten only glass pixels inside the disc; the brass ring and the handle
  // outside it keep their posterised inks.
  const rr = r * 1.1;
  // Inside the disc, posterised paper highlights are glass too; only the
  // dark inks (ring, handle) are left alone.
  const glassWide = dilate(glass, W, H, 1);
  for (let p = 0; p < N; p++) {
    if (glassWide[p] || rgba[p * 4 + 3] < 128) continue;
    const dist = Math.max(
      Math.abs(rgba[p * 4] - o.paper[0]),
      Math.abs(rgba[p * 4 + 1] - o.paper[1]),
      Math.abs(rgba[p * 4 + 2] - o.paper[2]),
    );
    const distCream = Math.max(
      Math.abs(rgba[p * 4] - o.cream[0]),
      Math.abs(rgba[p * 4 + 1] - o.cream[1]),
      Math.abs(rgba[p * 4 + 2] - o.cream[2]),
    );
    if (Math.min(dist, distCream) <= o.tolerance) glassWide[p] = 255;
  }
  for (
    let y = Math.max(0, Math.floor(cy - rr));
    y <= Math.min(H - 1, Math.ceil(cy + rr));
    y++
  )
    for (
      let x = Math.max(0, Math.floor(cx - rr));
      x <= Math.min(W - 1, Math.ceil(cx + rr));
      x++
    ) {
      if (Math.hypot(x - cx, y - cy) > rr) continue;
      const p = y * W + x;
      if (rgba[p * 4 + 3] < 128 || !glassWide[p]) continue;
      const j = Math.round((hash2(x, y, 19) - 0.5) * 6);
      rgba[p * 4] = clamp8(o.pale[0] + j);
      rgba[p * 4 + 1] = clamp8(o.pale[1] + j);
      rgba[p * 4 + 2] = clamp8(o.pale[2] + j);
    }
  // One crescent highlight, upper-left, inside the glass.
  const a0 = (195 * Math.PI) / 180,
    a1 = (260 * Math.PI) / 180,
    ra = r * 0.62;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><path d="M${cx + ra * Math.cos(a0)} ${cy + ra * Math.sin(a0)} A${ra} ${ra} 0 0 1 ${cx + ra * Math.cos(a1)} ${cy + ra * Math.sin(a1)}" stroke="rgb(${o.cream.join(',')})" stroke-width="${Math.max(3, r * 0.16)}" fill="none" stroke-linecap="round"/></svg>`;
  const { data } = await sharp(Buffer.from(svg))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let p = 0; p < N; p++) {
    const sa = data[p * 4 + 3] / 255;
    if (sa === 0 || rgba[p * 4 + 3] < 128 || !glassWide[p]) continue;
    if (Math.hypot((p % W) - cx, ((p / W) | 0) - cy) > rr) continue;
    for (let c = 0; c < 3; c++)
      rgba[p * 4 + c] = clamp8(
        Math.round(rgba[p * 4 + c] * (1 - sa) + data[p * 4 + c] * sa),
      );
  }
  return { cx, cy, r };
}

/** Blue-ink elliptical floor shadow as an RGBA canvas (a layer at paving depth). */
export function ellipseShadow(spec) {
  const pad = spec.feather * 3 + 4;
  const ext = Math.abs(Math.sin(spec.angle));
  const w = Math.ceil(spec.rx * 2 + ext * spec.ry * 2) + pad * 2,
    h = Math.ceil(spec.ry * 2 + ext * spec.rx * 2) + pad * 2;
  const cx = w / 2,
    cy = h / 2;
  const cos = Math.cos(spec.angle),
    sin = Math.sin(spec.angle);
  const data = Buffer.alloc(w * h * 4);
  const edge = spec.feather / Math.min(spec.rx, spec.ry);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = x - cx,
        dy = y - cy;
      const u = (dx * cos + dy * sin) / spec.rx,
        v = (-dx * sin + dy * cos) / spec.ry;
      const d = Math.sqrt(u * u + v * v);
      let a = Math.min(1, Math.max(0, (1 - d) / edge + 0.5));
      if (a <= 0) continue;
      const g = (hash2(x, y, 29) - 0.5) * 2 * spec.grain;
      a = Math.min(1, Math.max(0, a * (spec.opacity + g)));
      const p = (y * w + x) * 4;
      data[p] = spec.ink[0];
      data[p + 1] = spec.ink[1];
      data[p + 2] = spec.ink[2];
      data[p + 3] = Math.round(a * 255);
    }
  return { data, w, h, cx, cy };
}

/**
 * Hard-edged projected floor shadow as its own RGBA canvas: the sprite's
 * silhouette squashed and shifted right/back, feathered lightly, with a
 * solid contact strip under the feet. Returns the canvas and the sprite's
 * origin inside it (always 0,0).
 */
export async function shadowCanvas(sprite, s) {
  const sw = Math.round(sprite.w * s.sx),
    sh = Math.round(sprite.h * s.sy);
  const alpha = Buffer.alloc(sprite.w * sprite.h);
  for (let p = 0; p < sprite.w * sprite.h; p++)
    alpha[p] = sprite.data[p * 4 + 3];
  // sharp widens a blurred single-channel image to three channels; read the
  // first channel with the reported stride.
  const { data: squashedRaw, info: sqInfo } = await sharp(alpha, {
    raw: { width: sprite.w, height: sprite.h, channels: 1 },
  })
    .resize(sw, sh, { kernel: 'lanczos3' })
    .blur(s.feather)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const stride = sqInfo.channels;
  const squashed = (i) => squashedRaw[i * stride];
  const left = s.dx,
    top = sprite.h - sh + s.dy;
  const w = Math.max(sprite.w, left + sw),
    h = Math.max(sprite.h, top + sh + 6);
  const mask = new Float32Array(w * h);
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++) {
      const v = squashed(y * sw + x) / 255;
      // Push the feathered silhouette toward a hard print edge.
      mask[(y + top) * w + x + left] = Math.min(
        1,
        Math.max(0, (v - 0.32) / 0.3),
      );
    }
  if (s.contact) {
    const cx = sprite.w * s.contact.cx,
      cy = sprite.h - s.contact.lift,
      rx = sprite.w * s.contact.rx,
      ry = s.contact.ry;
    for (let y = Math.max(0, cy - ry - 1); y < Math.min(h, cy + ry + 1); y++)
      for (
        let x = Math.max(0, cx - rx - 1);
        x < Math.min(w, cx + rx + 1);
        x++
      ) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        if (d <= 1)
          mask[y * w + x] = Math.max(mask[y * w + x], Math.min(1, (1 - d) * 4));
      }
  }
  const canvas = Buffer.alloc(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    if (mask[p] <= 0) continue;
    const g = (hash2(p % w, (p / w) | 0, 23) - 0.5) * 2 * s.grain;
    const a = Math.round(clamp8(255 * Math.min(1, mask[p]) * (s.opacity + g)));
    if (!a) continue;
    canvas[p * 4] = s.ink[0];
    canvas[p * 4 + 1] = s.ink[1];
    canvas[p * 4 + 2] = s.ink[2];
    canvas[p * 4 + 3] = a;
  }
  return { data: canvas, w, h };
}

/** Paper / ink / ochre shares of an RGB(A) region, for the print critique. */
export function printShares(rgba, W, rect, channels = 4) {
  let paper = 0,
    ink = 0,
    ochre = 0,
    n = 0;
  for (let y = rect.y; y < rect.y + rect.h; y++)
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = (y * W + x) * channels;
      if (channels === 4 && rgba[i + 3] < 128) continue;
      const r = rgba[i],
        g = rgba[i + 1],
        b = rgba[i + 2];
      const l = lum(r, g, b);
      const [h, s] = hsv(r, g, b);
      n++;
      if (l > 185 && s < 0.4) paper++;
      else if (l < 95 || (l < 130 && b >= r)) ink++;
      else if (h >= 18 && h <= 55 && s >= 0.3 && l <= 200) ochre++;
    }
  return { paper: paper / n, ink: ink / n, ochre: ochre / n };
}

/** Mirror-pad a raw RGBA buffer on any side (reflected paint, no seam). */
export function padMirror(data, w, h, pads) {
  const { left = 0, right = 0, top = 0, bottom = 0 } = pads;
  const W = w + left + right,
    H = h + top + bottom;
  const out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    let sy = y - top;
    if (sy < 0) sy = Math.min(h - 1, -sy);
    else if (sy >= h) sy = Math.max(0, 2 * h - 2 - sy);
    for (let x = 0; x < W; x++) {
      let sx = x - left;
      if (sx < 0) sx = Math.min(w - 1, -sx);
      else if (sx >= w) sx = Math.max(0, 2 * w - 2 - sx);
      const q = (sy * w + sx) * 4,
        d = (y * W + x) * 4;
      const outside =
        x - left < 0 || x - left >= w || y - top < 0 || y - top >= h;
      const jitter = outside ? hash2(x, y, 37) * 6 - 3 : 0;
      out[d] = clamp8(data[q] + jitter);
      out[d + 1] = clamp8(data[q + 1] + jitter);
      out[d + 2] = clamp8(data[q + 2] + jitter);
      out[d + 3] = data[q + 3];
    }
  }
  return { data: out, w: W, h: H };
}

/**
 * Extend the tree plate to the left: every row's opaque run that touches the
 * left border (trunk, canopy mass) is mirrored outward with jitter, and the
 * hanging-frond leaf sprays are mirrored further out with a falloff so the
 * new left edge is sparse leaves over nothing.
 */
export function extendTreeLeft(rgba, W, H, by, frond, o) {
  const NW = W + by;
  const out = Buffer.alloc(NW * H * 4);
  for (let y = 0; y < H; y++)
    out.set(rgba.subarray(y * W * 4, (y + 1) * W * 4), (y * NW + by) * 4);
  for (let y = 0; y < H; y++) {
    let run = 0;
    while (run < W && rgba[(y * W + run) * 4 + 3] > 128) run++;
    if (!run) continue;
    const axis = hash2(0, (y / 3) | 0, 41) * 8;
    for (let k = 0; k < Math.min(o.maxRun, run); k++) {
      const sx = Math.min(W - 1, Math.floor(k + axis));
      const q = (y * W + sx) * 4,
        d = (y * NW + by - 1 - k) * 4;
      const j = Math.round((hash2(k, y, 43) - 0.5) * 8);
      out[d] = clamp8(rgba[q] + j);
      out[d + 1] = clamp8(rgba[q + 1] + j);
      out[d + 2] = clamp8(rgba[q + 2] + j);
      out[d + 3] = rgba[q + 3];
    }
  }
  const fr = frond;
  for (const [pass, dy, strength] of [
    [0, 0, 1],
    [1, 150, 0.7],
  ]) {
    for (let y = fr.y; y < fr.y + fr.h; y++) {
      const ty = y + dy;
      if (ty < 0 || ty >= H) continue;
      for (let x = fr.x; x < fr.x + fr.w; x++) {
        const q = (y * W + x) * 4;
        if (rgba[q + 3] < 8) continue;
        const tx = by - 1 - (x - fr.x) - o.sprayInset - pass * 12;
        if (tx < 0 || tx >= by) continue;
        const d = (ty * NW + tx) * 4;
        if (out[d + 3] > 128) continue;
        // Smooth falloff toward the far left: sparse leaves over nothing.
        const falloff = Math.min(1, Math.max(0, (tx / by - 0.08) / 0.7));
        if (falloff <= 0) continue;
        const j = Math.round((hash2(tx, ty, 53) - 0.5) * 6);
        out[d] = clamp8(rgba[q] + j);
        out[d + 1] = clamp8(rgba[q + 1] + j);
        out[d + 2] = clamp8(rgba[q + 2] + j);
        out[d + 3] = Math.round(rgba[q + 3] * strength * falloff);
      }
    }
  }
  return { data: out, w: NW, h: H };
}

/** Bake an ink ellipse under a sprite (padded canvas so nothing is cut). */
export function bakeShadowUnder(sprite, spec, ink) {
  const w = sprite.w + spec.padSide * 2,
    h = sprite.h + spec.padBottom;
  const cx = w / 2 + spec.dx,
    cy = sprite.h - spec.lift + 2;
  const rx = sprite.w * spec.rx,
    ry = Math.max(6, sprite.h * spec.ry);
  const data = Buffer.alloc(w * h * 4);
  const edge = spec.feather / Math.min(rx, ry);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const d = Math.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2);
      let a = Math.min(1, Math.max(0, (1 - d) / edge + 0.5));
      if (a <= 0) continue;
      a *= spec.opacity + (hash2(x, y, 59) - 0.5) * 0.08;
      const p = (y * w + x) * 4;
      data[p] = ink[0];
      data[p + 1] = ink[1];
      data[p + 2] = ink[2];
      data[p + 3] = Math.round(Math.min(1, Math.max(0, a)) * 255);
    }
  for (let y = 0; y < sprite.h; y++)
    for (let x = 0; x < sprite.w; x++) {
      const sp = (y * sprite.w + x) * 4,
        dp = (y * w + x + spec.padSide) * 4;
      const a = sprite.data[sp + 3] / 255;
      if (a === 0) continue;
      const da = data[dp + 3] / 255;
      const outA = a + da * (1 - a);
      for (let c = 0; c < 3; c++)
        data[dp + c] = clamp8(
          Math.round(
            (sprite.data[sp + c] * a + data[dp + c] * da * (1 - a)) / outA,
          ),
        );
      data[dp + 3] = Math.round(outA * 255);
    }
  return { data, w, h, padSide: spec.padSide };
}

