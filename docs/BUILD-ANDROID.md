# Building for Android

Ember is packaged as `com.emberjournal.app` with Capacitor 8. The interface,
fonts, painted plates, map geography, three licensed recordings and the journal
code are all bundled in the APK. A native bridge adds camera and location
integration, encrypted pairing settings, HTTPS identification requests and
document-picker exports.

Minimum Android 7.0 (API 24); compile and target SDK 36.

## Prerequisites

- Node 22.13 or newer
- JDK 21
- Android SDK with platform 36 and build-tools 36.0.0

Set `JAVA_HOME` and `ANDROID_HOME` to your own installations. The build script
reads both from the environment.

## Build

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run android:apk
```

`android:apk` builds the bundled interface, synchronises Capacitor, runs Gradle
`assembleDebug` and copies the result to `outputs/Ember-android.apk`. The
intermediate output is `android/app/build/outputs/apk/debug/app-debug.apk`.

After changing shared interface code or Capacitor configuration, run
`npm run android:sync` before building from Android Studio, and open the native
project with:

```sh
npx cap open android
```

Android Studio will ask you to trust the generated project, pick an SDK path and
possibly choose JVM 21. Its suggestions to upgrade plugins are not required.

The optional web build still works through `npm run dev` and `npm run build`.
Web storage and native storage are separate; move a journal between them with
export and import.

## Running an emulator

Create an AVD with a Google APIs system image for API 36. The QA pipeline
expects one named `Ember_QA` on port 5560 (see [QA](QA.md)). A typical start
command, using a separate AVD registry so it cannot collide with your personal
emulators:

```sh
ANDROID_AVD_HOME=/path/to/qa-avds \
"$ANDROID_HOME/emulator/emulator" -avd Ember_QA -port 5560 \
  -qt-hide-window -no-audio -no-snapshot \
  -camera-back emulated -camera-front none -gpu host
```

Use `-gpu host`. Software renderers have produced duplicated and corrupted map
tiles on an otherwise correct layout.

Install and launch:

```sh
adb -s emulator-5560 install -r outputs/Ember-android.apk
adb -s emulator-5560 shell am start -n com.emberjournal.app/.MainActivity
```

Always address a device by its exact serial. If more than one is attached, `-e`
and `-d` are ambiguous and dangerous.

## Installing on a phone

Copy the APK across and open it from Files, allowing installation from that
source if Android asks. Or over USB, with USB debugging enabled and the
authorisation prompt accepted:

```sh
adb -s <serial> install -r outputs/Ember-android.apk
```

Create a manual entry first, then use **Settings → Export backup** to save a
copy of your journal somewhere you can recover it.

## Signing, and why an update can be refused

These are debug-signed builds. Android only allows an in-place update when the
new APK carries the same signing key, and each machine generates its own debug
key by default. So an APK built on a second computer, or by CI, will be refused
as a signature mismatch against an existing install.

If that happens, keep the working installation and read the error. Do not
uninstall or clear data to force the update through: that destroys the journal.
Either build on the machine that made the original install, or copy that
machine's `~/.android/debug.keystore`. Anything beyond personal testing wants a
real release signing process. Never commit a signing key.

## Journal format and downgrades

Entries are stored on the device. Snapshots and exports are version 1 or version
2; version 2 appears once any entry carries a humidor or enjoyed status, and
older builds refuse version 2 data rather than silently dropping those fields.

An in-place APK downgrade is not a data rollback. Keep the backup you exported
before an update, and verify a backup by importing it into a separate throwaway
installation, never by deleting the only live copy.

## Native unit tests

```sh
./android/gradlew -p android :app:testDebugUnitTest --console=plain
```

Run these with the same JDK and SDK environment as the build. They cover the
native activity's inset policy: each screen edge uses the maximum required
inset rather than the sum, and child WebView insets are zeroed so padding is not
applied twice. Capacitor's automatic system-bar inset handling is disabled in
favour of that policy.

## CI

[The workflow](../.github/workflows/ci.yml) installs Node 22, Temurin JDK 21 and
the Android SDK on Ubuntu, runs the source and runtime checks and the native
JVM tests, builds the debug APK and uploads it as a build artifact. No
credentials and no backend deployment are part of CI. Remember that its debug
key differs from yours, so its artifact cannot update an install you made
locally.
