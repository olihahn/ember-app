// Compose pilot evidence beside the poster and pilot 10 for critique.
// Usage: node scripts/plates-compare.mjs <name>
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const name = process.argv[2];
if (!name || !/^[a-zA-Z0-9_-]+$/.test(name))
  throw new Error('Usage: node scripts/plates-compare.mjs <safe-name>');
const dir = resolve('outputs/qa/plates');
const rest = resolve(dir, `${name}-rest.png`);
const lean = resolve(dir, `${name}-lean.png`);
const poster = resolve('public/images/after-hours-poster.png');
const pilot10 = resolve(dir, 'reference-pilot10.png');
for (const file of [rest, poster])
  if (!existsSync(file)) throw new Error(`Missing ${file}`);
// An optional third panel: a capture of an older build to compare against.
// Drop one at outputs/qa/plates/reference-pilot10.png to include it.
const hasReference = existsSync(pilot10);

const HEIGHT = 1200;
const GAP = 24;
const LABEL = 44;
const PAPER = { r: 0xf2, g: 0xdb, b: 0xa2 };

async function panel(file, caption, { cropStatusBar = false } = {}) {
  let image = sharp(file);
  if (cropStatusBar) {
    const meta = await image.metadata();
    // Android status bar on the QA emulator is ~120 px at 1080x2400.
    const top = Math.round(meta.height * 0.05);
    image = image.extract({ left: 0, top, width: meta.width, height: meta.height - top });
  }
  const resized = await image.resize({ height: HEIGHT }).png().toBuffer();
  const { width } = await sharp(resized).metadata();
  const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${LABEL}">
    <rect width="100%" height="100%" fill="#173e42"/>
    <text x="14" y="29" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#f2dba2">${caption}</text>
  </svg>`);
  const composed = await sharp({
    create: { width, height: HEIGHT + LABEL, channels: 3, background: PAPER },
  }).composite([
    { input: label, top: 0, left: 0 },
    { input: resized, top: LABEL, left: 0 },
  ]).png().toBuffer();
  return { buffer: composed, width };
}

async function row(panels, output) {
  const width = panels.reduce((sum, p) => sum + p.width, 0) + GAP * (panels.length + 1);
  let left = GAP;
  const composite = panels.map((p) => {
    const item = { input: p.buffer, top: GAP, left };
    left += p.width + GAP;
    return item;
  });
  await sharp({
    create: { width, height: HEIGHT + LABEL + GAP * 2, channels: 3, background: PAPER },
  }).composite(composite).png().toFile(output);
  console.log(`Wrote ${output} (${width}×${HEIGHT + LABEL + GAP * 2})`);
}

const panels = [
  await panel(rest, `${name} — Ember_QA rest`, { cropStatusBar: true }),
  await panel(poster, 'Reference: after-hours-poster.png'),
];
if (hasReference)
  panels.push(
    await panel(pilot10, 'Earlier build for comparison', { cropStatusBar: true }),
  );
else console.log(`No ${pilot10}; composing without the comparison panel`);
await row(panels, resolve(dir, `${name}-vs-poster.png`));

if (existsSync(lean))
  await row([
    await panel(rest, `${name} — rest`, { cropStatusBar: true }),
    await panel(lean, `${name} — after lean (drag 30%→70%)`, { cropStatusBar: true }),
  ], resolve(dir, `${name}-lean-diff.png`));
else console.log('No lean capture; skipped lean-diff');
