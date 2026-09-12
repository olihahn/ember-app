import { spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { androidSdk, javaHome } from './lib/toolchain.mjs';

const sdk = androidSdk();
const java = javaHome();
const result = spawnSync('./gradlew', ['assembleDebug', '--console=plain'], {
  cwd: 'android',
  stdio: 'inherit',
  env: { ...process.env, ANDROID_HOME: sdk, JAVA_HOME: java },
});
if (result.status !== 0) process.exit(result.status ?? 1);
mkdirSync('outputs', { recursive: true });
copyFileSync(
  'android/app/build/outputs/apk/debug/app-debug.apk',
  path.join('outputs', 'Ember-android.apk'),
);
console.log('Installable personal-test APK: outputs/Ember-android.apk');
