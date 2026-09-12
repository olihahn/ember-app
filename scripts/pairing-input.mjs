// Secret-free transport. Supply one 64-character lowercase-hex code via stdin.
// Default/--qa is locked to Ember_QA. Physical mode needs the same USB serial
// twice and --expect-manufacturer <name>.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adbPath, androidSdk, javaHome } from './lib/toolchain.mjs';

const sdk = androidSdk();
const java = javaHome();
const adb = adbPath();
const source = join(
  dirname(fileURLToPath(import.meta.url)),
  'android/EmberPairingInput.java',
);
const remote = '/data/local/tmp/ember-pairing-input.jar';
let temporary;
let token;
let serial;
let pushed = false;
let success = false;
let save = false;
let stage = 'TARGET_ARGUMENTS';
const nativeStages = new Set([
  'NATIVE_START',
  'NATIVE_CONNECT',
  'NATIVE_FIELD',
  'NATIVE_STDIN',
  'NATIVE_FORMAT',
  'NATIVE_RECHECK',
  'NATIVE_TYPE',
  'NATIVE_VERIFY_TYPED',
  'NATIVE_SAVE_BUTTON',
  'NATIVE_SAVE_CLICK',
  'NATIVE_VERIFY_SAVED',
]);

const run = (binary, args, options = {}) =>
  execFileSync(binary, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
    ...options,
  });
const device = (...args) =>
  run(adb, ['-s', serial, ...args])
    .toString()
    .trim();

try {
  const args = process.argv.slice(2);
  const saveAt = args.indexOf('--save');
  if (saveAt >= 0) {
    save = true;
    args.splice(saveAt, 1);
  }
  // Physical mode refuses any handset whose manufacturer is not the one the
  // caller named, so a stray device on the bus can never be typed into.
  let expectManufacturer;
  const expectAt = args.indexOf('--expect-manufacturer');
  if (expectAt >= 0) {
    expectManufacturer = args[expectAt + 1]?.toLowerCase();
    if (!expectManufacturer) throw new Error('--expect-manufacturer needs a value');
    args.splice(expectAt, 2);
  }
  if (args.length === 0 || (args.length === 1 && args[0] === '--qa')) {
    stage = 'TARGET_QA';
    serial = 'emulator-5560';
    const avd = device('emu', 'avd', 'name').split(/\r?\n/);
    if (avd[0] !== 'Ember_QA') throw new Error('Wrong QA AVD');
  } else if (
    args.length === 4 &&
    args[0] === '--phone' &&
    args[2] === '--confirm-phone' &&
    args[1] === args[3]
  ) {
    stage = 'TARGET_PHONE';
    serial = args[1];
    if (
      !/^[A-Za-z0-9_-]{4,100}$/.test(serial) ||
      serial.startsWith('emulator-')
    )
      throw new Error('Not a USB serial');
    if (
      device('get-serialno') !== serial ||
      device('get-state') !== 'device' ||
      device('shell', 'getprop', 'ro.kernel.qemu') === '1' ||
      (expectManufacturer !== undefined &&
        device('shell', 'getprop', 'ro.product.manufacturer').toLowerCase() !==
          expectManufacturer)
    )
      throw new Error('Wrong phone');
    if (expectManufacturer === undefined)
      throw new Error(
        'Physical mode needs --expect-manufacturer <name> so the wrong handset cannot be typed into',
      );
  } else throw new Error('Explicit target required');

  stage = 'BUILD_JAVA';
  temporary = mkdtempSync(join(tmpdir(), 'ember-pairing-'));
  const platform = join(sdk, 'platforms/android-36/android.jar');
  run(join(java, 'bin/javac'), [
    '--release',
    '17',
    '-classpath',
    platform,
    '-d',
    temporary,
    source,
  ]);
  const jar = join(temporary, 'pairing-input.jar');
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
      join(temporary, 'com/emberjournal/qa/EmberPairingInput.class'),
    ],
    {
      env: { ...process.env, JAVA_HOME: java },
    },
  );
  stage = 'PUSH_HELPER';
  device('push', jar, remote);
  pushed = true;
  device('shell', 'chmod', '400', remote);

  // Bound secret input before allocating or passing it anywhere. Never use argv/env.
  stage = 'STDIN';
  token = Buffer.alloc(66);
  let length = 0;
  for await (const chunk of process.stdin) {
    if (length + chunk.length > token.length)
      throw new Error('Invalid input length');
    chunk.copy(token, length);
    length += chunk.length;
    chunk.fill(0);
  }
  if (length === 65 && token[64] === 10) length = 64;
  if (
    length !== 64 ||
    !token
      .subarray(0, length)
      .every(
        (value) =>
          (value >= 48 && value <= 57) || (value >= 97 && value <= 102),
      )
  )
    throw new Error('Invalid input');
  stage = 'NATIVE_TRANSPORT';
  let output;
  try {
    output = run(
      adb,
      [
        '-s',
        serial,
        'shell',
        '-T',
        `CLASSPATH=${remote} app_process /system/bin com.emberjournal.qa.EmberPairingInput${save ? ' --save' : ''}`,
      ],
      {
        input: token.subarray(0, length),
      },
    );
  } catch (failure) {
    // Only an exact allowlisted code may escape captured native stdout.
    const safeOutput = Buffer.isBuffer(failure?.stdout)
      ? failure.stdout.toString().trim()
      : '';
    if (safeOutput.startsWith('FAIL:') && nativeStages.has(safeOutput.slice(5)))
      stage = safeOutput.slice(5);
    throw new Error('Native input failed');
  }
  success = output.toString().trim() === 'OK';
} catch {
  // Do not print captured stdout/stderr, input, arguments, or exception objects.
} finally {
  if (token) token.fill(0);
  process.stdin.pause();
  if (pushed) {
    try {
      device('shell', 'rm', '-f', remote);
    } catch {
      /* Contains helper code only. */
    }
  }
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
process.stdout.write(
  JSON.stringify(success ? { success } : { success, stage }) + '\n',
  () => process.exit(success ? 0 : 1),
);
