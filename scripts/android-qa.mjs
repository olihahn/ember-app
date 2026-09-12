// Native accessibility and touch testing. It acts only on an AVD named
// Ember_QA, so a personal emulator or a phone can never be touched by it.
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { adbPath } from './lib/toolchain.mjs';

const adb = adbPath();
const serial = 'emulator-5560';
const evidenceDir = resolve('outputs/qa');
const run = (...args) =>
  execFileSync(adb, ['-s', serial, ...args], { maxBuffer: 12 * 1024 * 1024 });
if (!run('emu', 'avd', 'name').toString().split(/\r?\n/).includes('Ember_QA'))
  throw new Error('Refusing to act on anything but Ember_QA');
await mkdir(evidenceDir, { recursive: true });
const decode = (text) =>
  text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
function dump() {
  try {
    run('shell', 'uiautomator', 'dump', '/sdcard/ember-qa-window.xml');
  } catch (error) {
    // Some emulator images kill the UiAutomation helper during shutdown AFTER
    // it has confirmed writing the fresh hierarchy. Accept only that exact
    // completion receipt; all failures before writing still propagate.
    if (
      error.status !== 137 ||
      !error.stdout?.toString().includes(
        'UI hierarchy dumped to: /sdcard/ember-qa-window.xml',
      )
    ) throw error;
  }
  const xml = run('exec-out', 'cat', '/sdcard/ember-qa-window.xml').toString();
  const nodes = [...xml.matchAll(/<node\b([^>]*)/g)].map((match) =>
    Object.fromEntries(
      [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [
        a[1],
        decode(a[2]),
      ]),
    ),
  );
  return { xml, nodes };
}
function visible(node) {
  const b = node.bounds.match(/\d+/g)?.map(Number);
  return b && b[2] > b[0] && b[3] > b[1];
}
function summary(nodes) {
  return nodes
    .filter(visible)
    .filter(
      (n) =>
        n.text || n['content-desc'] || n.hint || n.class.endsWith('EditText'),
    )
    .map((n) => ({
      text: n.text,
      hint: n.hint || undefined,
      desc: n['content-desc'] || undefined,
      id: n['resource-id'] || undefined,
      role: n.class.split('.').pop(),
      bounds: n.bounds,
      focused: n.focused === 'true' || undefined,
    }));
}
const argv = process.argv.slice(2);
const commands = argv[0] === 'batch' ? JSON.parse(argv[1]) : [argv];
for (const [action = 'dump', value, ...extra] of commands) {
  if (action === 'tap') {
    const { nodes } = dump();
    const found = nodes
      .filter(visible)
      .filter((n) =>
        [n.text, n['content-desc'], n.hint, n['resource-id']].includes(value),
      );
    const chosen = found.find((n) => n.clickable === 'true') || found[0];
    if (!chosen) throw new Error(`Visible control not found: ${value}`);
    const [x1, y1, x2, y2] = chosen.bounds.match(/\d+/g).map(Number);
    run(
      'shell',
      'input',
      'tap',
      String(Math.round((x1 + x2) / 2)),
      String(Math.round((y1 + y2) / 2)),
    );
  } else if (action === 'type') {
    if (!/^[A-Za-z0-9 .,!?_:%/@+-]*$/.test(value))
      throw new Error(
        'QA input only supports simple ASCII; use native key events for other characters',
      );
    // ADB's input service treats %s as a space. Quote its single shell argument.
    run('shell', 'input', 'text', `'${value.replace(/ /g, '%s')}'`);
  } else if (action === 'key') {
    if (!/^KEYCODE_[A-Z0-9_]+$/.test(value))
      throw new Error('Invalid Android key');
    run('shell', 'input', 'keyevent', value);
  } else if (action === 'select-all') {
    run('shell', 'input', 'keycombination', '113', '29');
  } else if (action === 'swipe') {
    const coordinates = [value, ...extra];
    if (
      coordinates.length !== 5 ||
      coordinates.some((v) => !/^\d{1,4}$/.test(v))
    )
      throw new Error('Supply x1 y1 x2 y2 milliseconds');
    run('shell', 'input', 'swipe', ...coordinates);
  } else if (action === 'assert') {
    const { nodes } = dump();
    if (
      !nodes
        .filter(visible)
        .some((n) => [n.text, n['content-desc'], n.hint].includes(value))
    )
      throw new Error(`Native UI assertion failed: ${value}`);
    console.log(`PASS native UI: ${value}`);
  } else if (action === 'assert-absent') {
    const { nodes } = dump();
    if (
      nodes
        .filter(visible)
        .some((n) => [n.text, n['content-desc'], n.hint].includes(value))
    )
      throw new Error(`Unexpected native UI text: ${value}`);
    console.log(`PASS native UI absent: ${value}`);
  } else if (action === 'dump') {
    dump();
  } else if (action === 'cold-launch') {
    run('shell', 'am', 'force-stop', 'com.emberjournal.app');
    console.log(
      run(
        'shell',
        'am',
        'start',
        '-W',
        '-n',
        'com.emberjournal.app/.MainActivity',
      ).toString(),
    );
  } else if (action === 'record') {
    const seconds = String(extra[0] || '32');
    if (!/^[a-zA-Z0-9_-]+$/.test(value || '') || !/^\d{1,2}$/.test(seconds)
      || Number(seconds) < 1 || Number(seconds) > 45)
      throw new Error('Record requires a safe evidence label and 1–45 seconds');
    const deviceFile = `/sdcard/ember-qa-${value}.mp4`;
    run('shell', 'screenrecord', '--size', '720x1600', '--bit-rate', '2800000',
      '--time-limit', seconds, deviceFile);
    run('pull', deviceFile, resolve(evidenceDir, `${value}.mp4`));
    console.log(`Saved actual Ember_QA motion: ${value}.mp4`);
  } else if (action !== 'dump' && action !== 'capture') {
    throw new Error('Unsupported action');
  }
  if (action === 'capture') {
    const state = dump();
    const label = (value || 'screen').replace(/[^a-zA-Z0-9_-]/g, '_');
    await writeFile(resolve(evidenceDir, `${label}.xml`), state.xml);
    await writeFile(
      resolve(evidenceDir, `${label}.png`),
      run('exec-out', 'screencap', '-p'),
    );
  }
  // Wait for the native window to settle after navigation before a following
  // swipe/key action; otherwise a closing modal can consume that next gesture.
  if (['tap', 'key', 'cold-launch'].includes(action)) dump();
}
const state = dump();
console.log(JSON.stringify(summary(state.nodes), null, 2));
