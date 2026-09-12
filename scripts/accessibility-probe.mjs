// Read-only AX probe. Only Ember_QA/emulator-5560; no physical-device mode.
// Usage: node scripts/accessibility-probe.mjs --qa
// Three same-connection snapshots: initial, refreshed, and settled after >=10 s.
// Local compile check, without any ADB call: --build-only
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adbPath, androidSdk, javaHome } from './lib/toolchain.mjs';

const sdk = androidSdk();
const java = javaHome();
const adb = adbPath();
const serial = 'emulator-5560';
const remote = '/data/local/tmp/ember-accessibility-probe.jar';
const labels = [
  'Play music',
  'Pause music',
  'Mobile navigation',
  'Ember terrace home',
];
const run = (binary, args, options = {}) =>
  execFileSync(binary, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
    maxBuffer: 256 * 1024,
    ...options,
  });
const device = (...args) =>
  run(adb, ['-s', serial, ...args])
    .toString()
    .trim();
const guard = () => {
  if (
    device('emu', 'avd', 'name').split(/\r?\n/)[0] !== 'Ember_QA' ||
    device('shell', 'getprop', 'ro.kernel.qemu') !== '1'
  )
    throw new Error();
};
function metadata(value) {
  if (
    typeof value?.visible !== 'boolean' ||
    !Array.isArray(value.bounds) ||
    value.bounds.length !== 4 ||
    !value.bounds.every(Number.isSafeInteger)
  )
    throw new Error();
  return { visible: value.visible, bounds: value.bounds };
}
function safeReport(report) {
  if (
    report?.success !== true ||
    !Array.isArray(report.snapshots) ||
    report.snapshots.length !== 3
  )
    throw new Error();
  return {
    success: true,
    snapshots: report.snapshots.map((snapshot) => {
      if (
        typeof snapshot.refreshAttempted !== 'boolean' ||
        typeof snapshot.refreshSucceeded !== 'boolean' ||
        typeof snapshot.truncated !== 'boolean' ||
        !Array.isArray(snapshot.controls) ||
        snapshot.controls.length !== 4
      )
        throw new Error();
      return {
        refreshAttempted: snapshot.refreshAttempted,
        refreshSucceeded: snapshot.refreshSucceeded,
        truncated: snapshot.truncated,
        controls: labels.map((label, index) => {
          const control = snapshot.controls[index];
          if (
            control?.label !== label ||
            !Array.isArray(control.matches) ||
            control.matches.length > 16 ||
            control.present !== control.matches.length > 0
          )
            throw new Error();
          return {
            label,
            present: control.present,
            matches: control.matches.map((match) => {
              if (
                !Array.isArray(match.ancestors) ||
                match.ancestors.length > 64
              )
                throw new Error();
              return {
                ...metadata(match),
                ancestors: match.ancestors.map(metadata),
              };
            }),
          };
        }),
      };
    }),
  };
}

let temporary;
let pushed = false;
let stage = 'ARGUMENTS';
let report = { success: false, stage };
try {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--qa', '--build-only'].includes(args[0]))
    throw new Error();
  const buildOnly = args[0] === '--build-only';
  if (!buildOnly) {
    stage = 'TARGET_QA';
    guard();
  }
  temporary = mkdtempSync('/private/tmp/ember-accessibility-');
  const platform = join(sdk, 'platforms/android-36/android.jar');
  const source = join(
    dirname(fileURLToPath(import.meta.url)),
    'android/EmberAccessibilityProbe.java',
  );
  stage = 'BUILD_JAVA';
  run(join(java, 'bin/javac'), [
    '--release',
    '17',
    '-classpath',
    platform,
    '-d',
    temporary,
    source,
  ]);
  const classes = join(temporary, 'com/emberjournal/qa');
  const jar = join(temporary, 'accessibility-probe.jar');
  stage = 'BUILD_DEX';
  run(
    join(sdk, 'build-tools/36.0.0/d8'),
    [
      '--min-api',
      '26',
      '--lib',
      platform,
      '--output',
      jar,
      ...readdirSync(classes)
        .filter((name) => name.endsWith('.class'))
        .map((name) => join(classes, name)),
    ],
    { env: { ...process.env, JAVA_HOME: java } },
  );
  if (buildOnly) report = { success: true, compiled: true };
  else {
    stage = 'TARGET_QA';
    guard();
    stage = 'PUSH_HELPER';
    device('push', jar, remote);
    pushed = true;
    device('shell', 'chmod', '400', remote);
    stage = 'NATIVE_PROBE';
    const output = device(
      'shell',
      '-T',
      `CLASSPATH=${remote} app_process /system/bin com.emberjournal.qa.EmberAccessibilityProbe`,
    );
    stage = 'SAFE_OUTPUT';
    report = safeReport(JSON.parse(output));
  }
} catch {
  // Captured compiler/native stderr and arbitrary exceptions are never printed.
  report = { success: false, stage };
} finally {
  if (pushed) {
    try {
      device('shell', 'rm', '-f', remote);
    } catch {
      /* Contains helper code only, never journal data. */
    }
  }
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
process.stdout.write(JSON.stringify(report) + '\n', () =>
  process.exit(report.success ? 0 : 1),
);
