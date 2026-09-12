// Where the Android toolchain lives on this machine. Every script asks here so
// no personal path is baked into the repository. Override any of these with
// ANDROID_HOME (or ANDROID_SDK_ROOT), ADB and JAVA_HOME.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const mac = platform() === 'darwin';

/** The Android SDK root. Throws with a useful message if it cannot be found. */
export function androidSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    mac ? join(homedir(), 'Library/Android/sdk') : join(homedir(), 'Android/Sdk'),
  ].filter(Boolean);
  const found = candidates.find((path) => existsSync(path));
  if (!found)
    throw new Error(
      'Android SDK not found. Install platform 36 and set ANDROID_HOME. See docs/BUILD-ANDROID.md.',
    );
  return found;
}

/** The adb binary. */
export function adbPath() {
  if (process.env.ADB) return process.env.ADB;
  const adb = join(androidSdk(), 'platform-tools/adb');
  if (!existsSync(adb))
    throw new Error(`adb not found at ${adb}. Install platform-tools or set ADB.`);
  return adb;
}

/** A JDK 21 home. Asks macOS for one if JAVA_HOME is not set. */
export function javaHome() {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME;
  if (mac) {
    try {
      const home = execFileSync('/usr/libexec/java_home', ['-v', '21'], {
        encoding: 'utf8',
      }).trim();
      if (home && existsSync(home)) return home;
    } catch {
      // Fall through to the error below.
    }
  }
  throw new Error(
    'JDK 21 not found. Install it and set JAVA_HOME. See docs/BUILD-ANDROID.md.',
  );
}
