// Painted-plates pilot pipeline: build the APK, install it ONLY on the isolated
// Ember_QA emulator, cold-launch, and capture rest / lean / motion / route
// evidence. Usage: node scripts/plates-pilot.mjs <name> [--skip-build] [--music]
// See docs/QA.md.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { adbPath, androidSdk, javaHome } from './lib/toolchain.mjs';

const name = process.argv[2];
const skipBuild = process.argv.includes('--skip-build');
const withMusic = process.argv.includes('--music');
if (!name || !/^[a-zA-Z0-9_-]+$/.test(name))
  throw new Error('Usage: node scripts/plates-pilot.mjs <safe-name> [--skip-build]');

const adb = adbPath();
const serial = 'emulator-5560';
const app = 'com.emberjournal.app';
const activity = `${app}/.MainActivity`;
const sdk = androidSdk();
const java = javaHome();
const evidenceDir = resolve('outputs/qa/plates');
mkdirSync(evidenceDir, { recursive: true });
const evidence = (suffix) => resolve(evidenceDir, `${name}-${suffix}`);
const PAPER = { r: 0xf2, g: 0xdb, b: 0xa2 }; // .living-terrace background and the stage's paper
const OBJECTS_REGION = 'Objects on your table';
const RESET_CONTROL = 'Reset terrace view';
// `markers`: labels that only exist once the destination page/panel is open.
const ROUTES = [
  { id: 'journal', label: 'Journal', markers: ['The Journal.'] },
  { id: 'atlas', label: 'Atlas', markers: ['The Atlas.'] },
  { id: 'identify', label: 'Add a cigar', markers: ['Cigar name', 'Add to humidor', 'Cancel'] },
  { id: 'records', label: /^Records\b/, name: 'Records', markers: ['On the turntable', 'Done'] },
];

const run = (...args) =>
  execFileSync(adb, ['-s', serial, ...args], { maxBuffer: 64 * 1024 * 1024 });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const step = (cmd, args, extra = {}) => {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...extra });
  if (result.status !== 0) throw new Error(`${cmd} ${args[0]} failed (${result.status})`);
};

// Identical guard to scripts/android-qa.mjs: act only on the Ember_QA AVD.
// `adb emu` output can carry a trailing CR; compare trimmed lines.
function guard() {
  const lines = run('emu', 'avd', 'name').toString().split(/\r?\n/).map((l) => l.trim());
  if (!lines.includes('Ember_QA')) throw new Error('Refusing to act on anything but Ember_QA');
}

function build() {
  const env = { ...process.env, ANDROID_HOME: sdk, JAVA_HOME: java };
  if (!existsSync(sdk) || !existsSync(java))
    throw new Error('Set ANDROID_HOME and JAVA_HOME (see docs/BUILD-ANDROID.md).');
  // A manifest the stage rejects only shows the fallback screen on device;
  // fail here instead, with the parser's own message.
  step('node', ['--import', 'tsx', '-e',
    "import { readFileSync } from 'node:fs'; import { parseManifest } from './lib/terrace/plates/manifest.ts';"
    + " parseManifest(JSON.parse(readFileSync('public/plates/terrace/manifest.json', 'utf8')));"
    + " console.log('manifest ok');"], { env });
  step('npm', ['run', 'build:mobile'], { env });
  step('npx', ['cap', 'sync', 'android'], { env });
  step('./gradlew', ['assembleDebug', '--console=plain'], { cwd: 'android', env });
  const built = 'android/app/build/outputs/apk/debug/app-debug.apk';
  mkdirSync('outputs', { recursive: true });
  copyFileSync(built, resolve('outputs/Ember-android.apk'));
  copyFileSync(built, resolve(evidenceDir, `${name}.apk`));
}

function screenshot() {
  return run('exec-out', 'screencap', '-p');
}
function screenSize() {
  return run('shell', 'wm', 'size').toString().match(/(\d+)x(\d+)/).slice(1).map(Number);
}
// Fraction of the centre region that is plain paper (cream, allowing for the
// grain overlay and the launch splash's near-cream). Paper alone is the wait;
// once plates cover the centre this drops sharply.
async function centrePaperFraction(png) {
  const meta = await sharp(png).metadata();
  const size = 200;
  const left = Math.round(meta.width / 2 - size / 2);
  const top = Math.round(meta.height / 2 - size / 2);
  const { data, info } = await sharp(png)
    .extract({ left, top, width: size, height: size })
    .raw().toBuffer({ resolveWithObject: true });
  let paper = 0;
  const pixels = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) {
    if (Math.abs(data[i] - PAPER.r) < 40 && Math.abs(data[i + 1] - PAPER.g) < 40
      && Math.abs(data[i + 2] - PAPER.b) < 48) paper++;
  }
  return paper / pixels;
}

// The WebView exposes aria-labels as `text` on the QA image (content-desc is
// empty), so match either attribute.
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function dumpOnce() {
  try {
    run('shell', 'uiautomator', 'dump', '/sdcard/ember-plates-window.xml');
  } catch (error) {
    if (error.status !== 137 || !error.stdout?.toString().includes('UI hierarchy dumped'))
      return null;
  }
  const xml = run('exec-out', 'cat', '/sdcard/ember-plates-window.xml').toString();
  const nodes = [...xml.matchAll(/<node\b([^>]*)/g)].map((match) =>
    Object.fromEntries(
      [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]),
    ));
  return nodes.length ? nodes : null;
}
// UiAutomation sometimes answers "null root node" right after a transition;
// a short retry here covers every lookup in the pipeline.
function dumpNodes() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const nodes = dumpOnce();
    if (nodes) return nodes;
    pause(700);
  }
  return null;
}
const bounds = (node) => node.bounds.match(/\d+/g).map(Number);
// A label may be a string or a RegExp: the records object is named
// "Records, playing <title>" while a record plays.
const labelled = (node, label) =>
  label instanceof RegExp
    ? label.test(node.text ?? '') || label.test(node['content-desc'] ?? '')
    : node.text === label || node['content-desc'] === label;
function findNode(nodes, label, within) {
  return nodes.find((n) => {
    if (!labelled(n, label) || !n.bounds) return false;
    const [x1, y1, x2, y2] = bounds(n);
    if (x2 <= x1 || y2 <= y1) return false;
    if (!within) return true;
    return x1 >= within[0] - 1 && y1 >= within[1] - 1 && x2 <= within[2] + 1 && y2 <= within[3] + 1;
  });
}
function terraceNodes() {
  const nodes = dumpNodes();
  const region = nodes && findNode(nodes, OBJECTS_REGION);
  return region ? { nodes, region: bounds(region) } : null;
}
function tapNodeAt(node, fx, fy) {
  const [x1, y1, x2, y2] = bounds(node);
  run('shell', 'input', 'tap',
    String(Math.round(x1 + (x2 - x1) * fx)), String(Math.round(y1 + (y2 - y1) * fy)));
}
const tapNode = (node) => tapNodeAt(node, 0.5, 0.5);
function routeOpen(route) {
  const nodes = dumpNodes();
  if (!nodes) return false;
  return nodes.some((n) => route.markers.some((m) => labelled(n, m)) && n.bounds
    && bounds(n)[2] > bounds(n)[0]);
}

async function coldLaunch() {
  run('shell', 'am', 'force-stop', app);
  await sleep(600);
  const started = Date.now();
  const out = run('shell', 'am', 'start', '-W', '-n', activity).toString();
  const totalTime = Number(out.match(/TotalTime:\s*(\d+)/)?.[1] ?? NaN);
  const waitTime = Number(out.match(/WaitTime:\s*(\d+)/)?.[1] ?? NaN);
  let paperAt = null;
  let printAt = null;
  const deadline = started + 30_000;
  while (Date.now() < deadline) {
    const png = screenshot();
    const fraction = await centrePaperFraction(png);
    const now = Date.now() - started;
    if (paperAt === null && fraction > 0.85) paperAt = now;
    // The print has arrived once the centre is mostly not plain paper.
    else if (paperAt !== null && fraction < 0.6) {
      printAt = now;
      break;
    }
    await sleep(250);
  }
  let hierarchyAt = null;
  const hierarchyDeadline = started + 20_000;
  while (Date.now() < hierarchyDeadline) {
    if (terraceNodes()) { hierarchyAt = Date.now() - started; break; }
    await sleep(500);
  }
  if (hierarchyAt === null) await sleep(6000);
  const timing = {
    name,
    capturedAt: new Date().toISOString(),
    amStartTotalTimeMs: totalTime,
    amStartWaitTimeMs: waitTime,
    paperVisibleMs: paperAt,
    printPaintedMs: printAt,
    terraceHierarchyMs: hierarchyAt,
    note: 'Wall-clock from `am start` on the host, polled every 250 ms; not a frame-accurate benchmark. Paper = centre >85% cream; print = centre <60% cream afterwards.',
  };
  writeFileSync(evidence('timing.json'), JSON.stringify(timing, null, 2));
  console.log(JSON.stringify(timing, null, 2));
  return timing;
}

async function captureLean() {
  // Root-verified gesture: a plain horizontal swipe at mid-height, then a 2 s
  // settle, gives a correct lean (tree slides left, far coast right).
  const [w, h] = screenSize();
  const y = Math.round(h * 0.5);
  const x0 = Math.round(w * 300 / 1080);
  const x1 = Math.round(w * 800 / 1080);
  run('shell', 'input', 'swipe', String(x0), String(y), String(x1), String(y), '1200');
  await sleep(2000);
  writeFileSync(evidence('lean.png'), screenshot());
}

async function resetView() {
  // Older builds had a reset control; current ones lean back with the
  // inverse of the capture swipe.
  const nodes = dumpNodes();
  const reset = nodes && findNode(nodes, RESET_CONTROL);
  if (reset) tapNode(reset);
  else {
    const [w, h] = screenSize();
    const y = Math.round(h * 0.5);
    run('shell', 'input', 'swipe', String(Math.round(w * 800 / 1080)), String(y),
      String(Math.round(w * 300 / 1080)), String(y), '1200');
  }
  await sleep(2000);
}

function record(seconds = 8, suffix = 'motion.mp4') {
  const deviceFile = `/sdcard/ember-plates-${name}.mp4`;
  run('shell', 'screenrecord', '--size', '720x1600', '--bit-rate', '2800000',
    '--time-limit', String(seconds), deviceFile);
  run('pull', deviceFile, evidence(suffix));
  run('shell', 'rm', deviceFile);
}

// Optional: start the first record from the library, close it, film the
// turntable for 6 s, then reopen and pause the same record.
async function music() {
  const records = ROUTES.find((r) => r.id === 'records');
  // UiAutomation occasionally returns a null root right after a transition;
  // give the hierarchy a few chances before deciding the terrace is gone.
  const terraceSoon = async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const terrace = terraceNodes();
      if (terrace) return terrace;
      await sleep(1000);
    }
    return null;
  };
  const openLibrary = async () => {
    const terrace = await terraceSoon();
    if (!terrace) throw new Error('Terrace not present before the music step');
    const button = findNode(terrace.nodes, records.label, terrace.region);
    if (!button) throw new Error('Projected Records object not found');
    tapNodeAt(button, 0.5, 0.3);
    await sleep(1500);
    if (!routeOpen(records)) throw new Error('Record library did not open');
  };
  // Track buttons are exposed by their text ("Play Cool Vibes") and exist only
  // once the panel has slid in, so re-dump a few times before giving up.
  const isTrack = (n) => {
    const label = n.text || n['content-desc'] || '';
    return /^Play .+/.test(label) && !/^Play (music|record)$/.test(label) && n.bounds && bounds(n)[2] > bounds(n)[0];
  };
  const tapFirstTrack = async () => {
    let track = null;
    for (let attempt = 0; attempt < 3 && !track; attempt++) {
      await sleep(1500);
      const nodes = dumpNodes();
      track = nodes && nodes.find(isTrack);
    }
    if (!track) throw new Error('First track button not found in the library');
    tapNode(track);
    await sleep(1200);
    return track.text || track['content-desc'];
  };
  await openLibrary();
  const title = await tapFirstTrack();
  run('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await sleep(1200);
  if (!(await terraceSoon())) throw new Error('Terrace did not return after closing the library');
  record(6, 'music.mp4');
  await openLibrary();
  const again = await tapFirstTrack();
  if (again !== title) console.log(`Note: paused "${again}" after starting "${title}"`);
  run('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await sleep(1200);
  if (!(await terraceSoon())) throw new Error('Terrace did not return after pausing');
  console.log(`Music: started and paused "${title}", clip ${name}-music.mp4`);
}

async function routes() {
  const results = [];
  for (const route of ROUTES) {
    const terrace = terraceNodes();
    if (!terrace) throw new Error(`Terrace not present before route ${route.id}`);
    const button = findNode(terrace.nodes, route.label, terrace.region);
    if (!button) throw new Error(`Projected object button not found: ${route.name ?? route.label}`);
    // Projected buttons can be tall enough that their centre lies under the
    // footer gradient, which swallows the tap. Hit the upper part of the
    // object instead, and retry once slightly higher.
    let opened = false;
    for (const fraction of [0.3, 0.2]) {
      tapNodeAt(button, 0.5, fraction);
      await sleep(1500);
      if (routeOpen(route)) { opened = true; break; }
      console.log(`Route ${route.id}: no page/panel after tap at 50%/${fraction * 100}%; retrying`);
    }
    if (!opened) throw new Error(`Route ${route.id} did not open from "${route.name ?? route.label}"`);
    const file = evidence(`route-${route.id}.png`);
    writeFileSync(file, screenshot());
    run('shell', 'input', 'keyevent', 'KEYCODE_BACK');
    await sleep(1500);
    // A still-open panel (Records) or page needs one more Back before the
    // terrace can be asserted.
    if (!terraceNodes() || routeOpen(route)) {
      run('shell', 'input', 'keyevent', 'KEYCODE_BACK');
      await sleep(1500);
    }
    const back = terraceNodes();
    if (!back || routeOpen(route)) throw new Error(`Terrace did not return after Back from ${route.id}`);
    console.log(`Route ${route.id}: opened from "${route.name ?? route.label}", Back returned to the terrace`);
    results.push({ ...route, file });
  }
  // Four-panel strip.
  const HEIGHT = 1000;
  const GAP = 16;
  const LABEL = 40;
  const panels = [];
  for (const r of results) {
    const meta = await sharp(r.file).metadata();
    const top = Math.round(meta.height * 0.05);
    const image = await sharp(r.file)
      .extract({ left: 0, top, width: meta.width, height: meta.height - top })
      .resize({ height: HEIGHT }).png().toBuffer();
    const { width } = await sharp(image).metadata();
    const caption = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${LABEL}">
      <rect width="100%" height="100%" fill="#173e42"/>
      <text x="12" y="27" font-family="Helvetica, Arial, sans-serif" font-size="19" fill="#f2dba2">${name} — ${r.name ?? r.label} (${r.id})</text></svg>`);
    panels.push({ width, buffer: await sharp({
      create: { width, height: HEIGHT + LABEL, channels: 3, background: '#f2dba2' },
    }).composite([{ input: caption, top: 0, left: 0 }, { input: image, top: LABEL, left: 0 }]).png().toBuffer() });
  }
  const width = panels.reduce((s, p) => s + p.width, 0) + GAP * (panels.length + 1);
  let left = GAP;
  const composite = panels.map((p) => { const item = { input: p.buffer, top: GAP, left }; left += p.width + GAP; return item; });
  await sharp({ create: { width, height: HEIGHT + LABEL + GAP * 2, channels: 3, background: '#f2dba2' } })
    .composite(composite).png().toFile(evidence('routes.png'));
}

guard();
if (!skipBuild) build();
else console.log('Skipping build; installing outputs/Ember-android.apk');
guard();
run('install', '-r', resolve('outputs/Ember-android.apk'));
console.log('Installed on Ember_QA (emulator-5560)');
const timing = await coldLaunch();
writeFileSync(evidence('rest.png'), screenshot());
await captureLean();
await resetView();
record();
await routes();
if (withMusic) await music();
console.log(`\nEvidence in ${evidenceDir}:`);
for (const suffix of ['rest.png', 'lean.png', 'motion.mp4', 'timing.json', 'routes.png',
  ...ROUTES.map((r) => `route-${r.id}.png`), ...(withMusic ? ['music.mp4'] : [])])
  console.log(`  ${name}-${suffix}`);
console.log(`Cold launch: am start ${timing.amStartTotalTimeMs} ms, paper visible ${timing.paperVisibleMs} ms, print painted ${timing.printPaintedMs} ms, terrace hierarchy ${timing.terraceHierarchyMs} ms`);
