# Typing a pairing code over ADB

Entering a 64-character pairing token into a phone by hand is tedious and easy
to get wrong. This helper types it for you without the token ever appearing in
a command line, an environment variable, a log or a file.

It does not read your Keychain, generate credentials, contact any service,
change the journal, or save the connection unless you explicitly ask it to. It
types into Ember's existing, empty, focused **Pairing code** field and nothing
else.

## How the secret is kept out of sight

`input text` would put the token in a child process's arguments, where any
other process on the device could read it. Instead a small secret-free Java
helper runs on the device, reads the token from stdin, and injects native key
events.

Output is either `{"success":true}` or a failure carrying one fixed stage code,
for example `{"success":false,"stage":"NATIVE_FIELD"}`. Exceptions, field
values and any other native output are never forwarded, so nothing can leak
through an error message.

Send exactly 64 lowercase hexadecimal characters, with an optional trailing
newline, then close stdin. Keep the token in your program's memory: spawn the
command with piped stdin and call `child.stdin.end(tokenBuffer)`. Never place a
real token in a shell command, an environment variable, source, terminal
history, the clipboard or a temporary file. Never send an OpenAI API key to the
phone; the pairing token is a different secret and the only one the phone
should ever hold.

## Targets

Emulator mode is locked to an AVD named `Ember_QA`:

```sh
node scripts/pairing-input.mjs --qa
```

Physical mode needs the serial given twice and the expected manufacturer named,
so a misremembered serial cannot type your token into the wrong handset. It
verifies that exact device is connected and refuses emulators:

```sh
node scripts/pairing-input.mjs --phone SERIAL --confirm-phone SERIAL \
  --expect-manufacturer <name>
```

Add `--save` to either command to also press **Save connection**. The helper
finds that exact button through native accessibility, in memory, resolving
either its own label or its labelled child, and scrolls it into view if the
keyboard covers the form. It then sends a native touch at the centre of the
freshly measured visible bounds, inside Ember's own window. Success additionally
requires the saved-confirmation message and an emptied password field. Without
`--save` the helper never clicks anything.

## Sequence

1. Check you are pointing at the device you mean, and that no unsaved journal
   editor is open.
2. Open **Settings**, wait for the connection panel to finish loading, and fill
   **Service address** with your HTTPS origin.
3. Focus the empty **Pairing code** field. Locate everything you need before
   supplying a real token. The helper independently requires Ember's focused,
   editable password node: the exact **Pairing code** hint, or a wrapper with
   that exact label holding a single editable child on WebViews that omit
   hints. It will not type into a generic password field elsewhere.
4. Send the token through the helper's stdin. While the field holds a real
   value, do not dump accessibility trees, take screenshots or log UI values.
   In particular do not use `android-qa.mjs tap`, which dumps the hierarchy
   before clicking.
5. Without `--save`, success means the typing completed. It does not mean the
   connection was saved or tested. For a dummy run, close Settings rather than
   saving.
6. Reopen Settings to confirm the saved address and status. The app never
   displays a stored token. Verifying the service is a separate step.

## When something fails

On failure the helper clears the password field only if it had begun typing and
the field started empty. Close Settings afterwards to discard anything left
behind. Closing after **Save connection** does not cancel a native save that is
already running. Do not reach for **Disconnect**, force-stop, clearing app data
or reinstalling as a way to cancel: none of that is necessary and it can
disturb unrelated state.

If `--save` reports failure, a save may still be pending or already complete.
Check Settings before retrying. A failure means the helper could not confirm the
whole sequence, not that a submitted save was rolled back.

Failure stages are fixed constants: target validation, Java or DEX build,
helper transfer, stdin, native connection or focused-field validation, typing,
typed-length verification, Save-button lookup or click, and saved-confirmation
verification. `NATIVE_SAVE_CLICK` and `NATIVE_VERIFY_SAVED` mean you should
check the saved state before retrying; earlier stages have not attempted a save.
Unrecognised native output is reported as `NATIVE_TRANSPORT` and never echoed.

## What it touches

It uses the JDK and Android SDK resolved by `scripts/lib/toolchain.mjs`. It
places only executable helper code at `/data/local/tmp/ember-pairing-input.jar`,
removes it afterwards, and removes its own temporary build directory. It adds no
plugin to the APK and never enables WebView debugging.

Check compatibility with a dummy token on the emulator before using a real one.
A successful emulator run is not evidence that a particular handset will behave
the same way.
