// Regenerates the work-page backdrops from the terrace theme manifest so the
// landscape behind the paper sheets always matches the current plates.
//   node scripts/plates/build-backdrop.mjs
// Writes public/images/terrace-backdrop.jpg (sharp, 720×1080) and
// public/images/terrace-backdrop-soft.jpg (lightly blurred, used by the CSS).
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const theme = resolve('public/plates/terrace');
const manifest = JSON.parse(
  readFileSync(resolve(theme, 'manifest.json'), 'utf8'),
);
const { width: W, height: H } = manifest.canvas;
const entries = [...manifest.layers, ...manifest.sprites]
  .filter((entry) => entry.file && entry.rect)
  .sort((a, b) => b.depth - a.depth);

const composites = [];
for (const entry of entries) {
  const file = resolve(theme, entry.file);
  if (!existsSync(file)) continue;
  const meta = await sharp(file).metadata();
  const { x, y } = entry.rect;
  const x0 = Math.max(0, x),
    y0 = Math.max(0, y);
  const x1 = Math.min(W, x + meta.width),
    y1 = Math.min(H, y + meta.height);
  if (x1 <= x0 || y1 <= y0) continue;
  let buffer = await sharp(file).toBuffer();
  if (x0 !== x || y0 !== y || x1 - x0 !== meta.width || y1 - y0 !== meta.height)
    buffer = await sharp(buffer)
      .extract({ left: x0 - x, top: y0 - y, width: x1 - x0, height: y1 - y0 })
      .toBuffer();
  composites.push({ input: buffer, left: x0, top: y0 });
}
const rest = await sharp({
  create: { width: W, height: H, channels: 4, background: '#f2dba2' },
})
  .composite(composites)
  .png()
  .toBuffer();

mkdirSync('public/images', { recursive: true });
const sharpOut = 'public/images/terrace-backdrop.jpg';
const softOut = 'public/images/terrace-backdrop-soft.jpg';
await sharp(rest).resize(720, 1080).jpeg({ quality: 82 }).toFile(sharpOut);
// About 4 px of blur at phone resolution: the print still reads as the print.
await sharp(rest)
  .resize(720, 1080)
  .blur(2.0)
  .modulate({ brightness: 1.03, saturation: 0.94 })
  .jpeg({ quality: 82 })
  .toFile(softOut);
console.log(
  `${sharpOut} ${statSync(sharpOut).size} bytes; ${softOut} ${statSync(softOut).size} bytes`,
);
