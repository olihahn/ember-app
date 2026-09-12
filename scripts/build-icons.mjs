// Build-time icon rasterization; this code never runs in the browser.
//
// `npm run icons` regenerates every icon from public/favicon.svg: the PWA icons
// in public/icons, and the Android launcher and splash resources under
// android/app/src/main/res. All of those are committed, so run this only when
// the source SVG changes, and commit the result.
import sharp from 'sharp';
import { mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
await mkdir('public/icons', { recursive: true });
await sharp('public/favicon.svg')
  .resize(192, 192)
  .png()
  .toFile('public/icons/icon-192.png');
await sharp('public/favicon.svg')
  .resize(512, 512)
  .png()
  .toFile('public/icons/icon-512.png');
const maskable =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#193844"/><text x="256" y="316" font-family="Georgia,serif" font-size="280" text-anchor="middle" fill="#f6f1e4">e<tspan fill="#df6550">.</tspan></text><path d="M185 372h142" stroke="#df6550" stroke-width="5"/></svg>';
await sharp(Buffer.from(maskable))
  .png()
  .toFile('public/icons/maskable-512.png');

if (existsSync('android/app/src/main/res')) {
  const resources = 'android/app/src/main/res';
  for (const [density, scale] of [
    ['mdpi', 1],
    ['hdpi', 1.5],
    ['xhdpi', 2],
    ['xxhdpi', 3],
    ['xxxhdpi', 4],
  ]) {
    const folder = `${resources}/mipmap-${density}`;
    await mkdir(folder, { recursive: true });
    for (const name of ['ic_launcher', 'ic_launcher_round']) {
      await sharp('public/favicon.svg')
        .resize(Math.round(48 * scale))
        .png()
        .toFile(`${folder}/${name}.png`);
    }
    await sharp(Buffer.from(maskable))
      .resize(Math.round(108 * scale))
      .png()
      .toFile(`${folder}/ic_launcher_foreground.png`);
  }
  const splash =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 480"><rect width="480" height="480" fill="#f6f1e4"/><text x="240" y="291" font-family="Georgia,serif" font-size="190" text-anchor="middle" fill="#193844">e<tspan fill="#b83e2f">.</tspan></text></svg>';
  for (const directory of await readdir(resources)) {
    if (
      directory.startsWith('drawable') &&
      existsSync(`${resources}/${directory}/splash.png`)
    ) {
      await sharp(Buffer.from(splash))
        .png()
        .toFile(`${resources}/${directory}/splash.png`);
    }
  }
}
