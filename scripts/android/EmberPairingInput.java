package com.emberjournal.qa;

import android.app.UiAutomation;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.graphics.Rect;
import android.os.Bundle;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.SystemClock;
import android.text.TextUtils;
import android.view.InputDevice;
import android.view.KeyCharacterMap;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import java.util.ArrayDeque;
import java.util.Arrays;

/** Shell-UID helper: secret bytes arrive only on stdin, never in process argv. */
public final class EmberPairingInput {
    private static final String PACKAGE = "com.emberjournal.app";

    private static boolean pairingField(AccessibilityNodeInfo node) {
        return node != null && TextUtils.equals(PACKAGE, node.getPackageName())
            && node.isEditable() && node.isPassword() && node.isEnabled()
            && pairingLabel(node);
    }

    private static boolean pairingLabel(AccessibilityNodeInfo node) {
        if (TextUtils.equals("Pairing code", node.getHintText())) return true;
        // Older WebViews expose the wrapping HTML label instead of an input hint.
        AccessibilityNodeInfo parent = node.getParent();
        if (parent == null || !TextUtils.equals(PACKAGE, parent.getPackageName())) return false;
        int editable = 0;
        boolean exactLabel = false;
        boolean exactChild = false;
        for (int i = 0; i < parent.getChildCount(); i++) {
            AccessibilityNodeInfo child = parent.getChild(i);
            if (child == null) continue;
            if (child.isEditable()) { editable++; exactChild |= child.equals(node); }
            if (TextUtils.equals("android.widget.TextView", child.getClassName())
                && TextUtils.equals("Pairing code", child.getText())) exactLabel = true;
        }
        return exactLabel && exactChild && editable == 1;
    }

    private static AccessibilityNodeInfo focusedField(UiAutomation automation) {
        AccessibilityNodeInfo node = automation.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        if (!pairingField(node) || !node.isFocused()) {
            node = null;
            // WebView virtual inputs are not always returned by findFocus.
            // Inspect nodes in memory only, retaining the same strict field guard.
            ArrayDeque<AccessibilityNodeInfo> pending = new ArrayDeque<>();
            AccessibilityNodeInfo root = automation.getRootInActiveWindow();
            if (root != null) pending.add(root);
            for (int visited = 0; visited < 1000 && !pending.isEmpty(); visited++) {
                AccessibilityNodeInfo candidate = pending.removeFirst();
                if (candidate.isFocused() && pairingField(candidate)) { node = candidate; break; }
                for (int i = 0; i < candidate.getChildCount(); i++) {
                    AccessibilityNodeInfo child = candidate.getChild(i);
                    if (child != null) pending.add(child);
                }
            }
        }
        if (!pairingField(node) || !node.isFocused())
            throw new IllegalStateException("Pairing field is not focused");
        return node;
    }

    private static AccessibilityNodeInfo namedNode(UiAutomation automation, String name) {
        ArrayDeque<AccessibilityNodeInfo> pending = new ArrayDeque<>();
        AccessibilityNodeInfo root = automation.getRootInActiveWindow();
        if (root != null && !root.refresh()) return null;
        if (root != null) pending.add(root);
        for (int visited = 0; visited < 1000 && !pending.isEmpty(); visited++) {
            AccessibilityNodeInfo node = pending.removeFirst();
            if (TextUtils.equals(PACKAGE, node.getPackageName()) && TextUtils.equals(name, node.getText())) return node;
            for (int i = 0; i < node.getChildCount(); i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) pending.add(child);
            }
        }
        return null;
    }

    private static boolean actionableButton(AccessibilityNodeInfo node) {
        return node != null && TextUtils.equals(PACKAGE, node.getPackageName()) && node.isEnabled()
            && TextUtils.equals("android.widget.Button", node.getClassName())
            && (node.isClickable() || node.getActionList().contains(AccessibilityNodeInfo.AccessibilityAction.ACTION_CLICK));
    }

    private static AccessibilityNodeInfo saveButton(UiAutomation automation) {
        ArrayDeque<AccessibilityNodeInfo> pending = new ArrayDeque<>();
        AccessibilityNodeInfo root = automation.getRootInActiveWindow();
        if (root != null && root.refresh()) pending.add(root);
        for (int visited = 0; visited < 1000 && !pending.isEmpty(); visited++) {
            AccessibilityNodeInfo node = pending.removeFirst();
            if (TextUtils.equals(PACKAGE, node.getPackageName()) &&
                (TextUtils.equals("Save connection", node.getText()) || TextUtils.equals("Save connection", node.getContentDescription()))) {
                // WebView may expose the label as a TextView beneath its Button.
                AccessibilityNodeInfo candidate = node;
                for (int depth = 0; depth < 6 && candidate != null; depth++) {
                    if (actionableButton(candidate)) return candidate;
                    candidate = candidate.getParent();
                }
            }
            for (int i = 0; i < node.getChildCount(); i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) pending.add(child);
            }
        }
        return null;
    }

    public static void main(String[] args) {
        boolean success = false;
        boolean touched = false;
        String stage = "NATIVE_START";
        byte[] bytes = new byte[66];
        char[] token = new char[64];
        HandlerThread thread = new HandlerThread("ember-pairing-input");
        UiAutomation automation = null;
        AccessibilityNodeInfo initial = null;
        try {
            boolean save = args.length == 1 && "--save".equals(args[0]);
            if (args.length != 0 && !save) throw new IllegalArgumentException();
            stage = "NATIVE_CONNECT";
            // app_process does not prepare the main Looper as an Activity would.
            // Android accessibility clients require it even with a worker Looper.
            Looper.prepareMainLooper();
            thread.start();
            Object connection = Class.forName("android.app.UiAutomationConnection")
                .getDeclaredConstructor().newInstance();
            automation = UiAutomation.class.getDeclaredConstructor(Looper.class,
                Class.forName("android.app.IUiAutomationConnection"))
                .newInstance(thread.getLooper(), connection);
            UiAutomation.class.getDeclaredMethod("connect", int.class)
                .invoke(automation, UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);
            AccessibilityServiceInfo info = automation.getServiceInfo();
            info.flags |= AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS
                | AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;
            automation.setServiceInfo(info);
            automation.waitForIdle(100, 2000);
            stage = "NATIVE_FIELD";
            initial = focusedField(automation);
            if (initial.getText() != null && initial.getText().length() != 0)
                throw new IllegalStateException("Pairing field must start empty");

            stage = "NATIVE_STDIN";
            int length = 0;
            int count;
            while (length < bytes.length && (count = System.in.read(bytes, length, bytes.length - length)) != -1)
                length += count;
            if (length == 65 && bytes[64] == '\n') length = 64;
            stage = "NATIVE_FORMAT";
            if (length != 64) throw new IllegalArgumentException();
            for (int i = 0; i < token.length; i++) {
                int value = bytes[i] & 255;
                if (!((value >= '0' && value <= '9') || (value >= 'a' && value <= 'f')))
                    throw new IllegalArgumentException();
                token[i] = (char) value;
            }
            stage = "NATIVE_RECHECK";
            AccessibilityNodeInfo current = focusedField(automation);
            if (!initial.equals(current) || (current.getText() != null && current.getText().length() != 0))
                throw new IllegalStateException("Focus changed");
            KeyCharacterMap keyboard = KeyCharacterMap.load(KeyCharacterMap.VIRTUAL_KEYBOARD);
            KeyEvent[] events = keyboard.getEvents(token);
            if (events == null) throw new IllegalStateException("Unsupported characters");
            stage = "NATIVE_TYPE";
            touched = true;
            for (KeyEvent event : events) {
                if (!initial.equals(focusedField(automation))) throw new IllegalStateException("Focus changed");
                long now = SystemClock.uptimeMillis();
                KeyEvent timed = new KeyEvent(now, now, event.getAction(), event.getKeyCode(),
                    0, event.getMetaState(), event.getDeviceId(), event.getScanCode(),
                    event.getFlags(), InputDevice.SOURCE_KEYBOARD);
                if (!automation.injectInputEvent(timed, true)) throw new IllegalStateException("Injection failed");
            }
            // Poll only the focused password node in memory; never dump the hierarchy.
            stage = "NATIVE_VERIFY_TYPED";
            for (int attempt = 0; attempt < 20; attempt++) {
                current = focusedField(automation);
                if (!initial.equals(current)) throw new IllegalStateException("Focus changed");
                if (!current.refresh() || !pairingField(current) || !current.isFocused())
                    throw new IllegalStateException("Focus changed");
                if (current.getText() != null && current.getText().length() == token.length) {
                    success = true;
                    break;
                }
                SystemClock.sleep(25);
            }
            if (success && save) {
                success = false;
                stage = "NATIVE_SAVE_BUTTON";
                AccessibilityNodeInfo button = saveButton(automation);
                if (button == null) throw new IllegalStateException("Save control unavailable");
                // Reveal this exact control when the keyboard clips the settings form.
                button.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SHOW_ON_SCREEN.getId());
                SystemClock.sleep(100);
                if (!button.refresh() || !actionableButton(button))
                    throw new IllegalStateException("Save control unavailable");
                AccessibilityNodeInfo window = automation.getRootInActiveWindow();
                if (window == null || !TextUtils.equals(PACKAGE, window.getPackageName())
                    || window.getWindowId() != button.getWindowId() || !button.isVisibleToUser())
                    throw new IllegalStateException("Save window changed");
                Rect buttonBounds = new Rect();
                Rect windowBounds = new Rect();
                button.getBoundsInScreen(buttonBounds);
                window.getBoundsInScreen(windowBounds);
                if (!buttonBounds.intersect(windowBounds) || buttonBounds.width() < 24 || buttonBounds.height() < 24)
                    throw new IllegalStateException("Save control is clipped");
                stage = "NATIVE_SAVE_CLICK";
                // WebView can acknowledge ACTION_CLICK without submitting a form.
                // Use the proven native touch path, at freshly verified visible bounds.
                long touchedAt = SystemClock.uptimeMillis();
                float x = buttonBounds.exactCenterX();
                float y = buttonBounds.exactCenterY();
                MotionEvent down = MotionEvent.obtain(touchedAt, touchedAt, MotionEvent.ACTION_DOWN, x, y, 0);
                MotionEvent up = MotionEvent.obtain(touchedAt, touchedAt + 50, MotionEvent.ACTION_UP, x, y, 0);
                down.setSource(InputDevice.SOURCE_TOUCHSCREEN);
                up.setSource(InputDevice.SOURCE_TOUCHSCREEN);
                boolean released = false;
                try {
                    boolean pressed = automation.injectInputEvent(down, true);
                    SystemClock.sleep(50);
                    boolean lifted = automation.injectInputEvent(up, true);
                    released = true;
                    if (!pressed || !lifted) throw new IllegalStateException("Save touch failed");
                } finally {
                    try { if (!released) automation.injectInputEvent(up, true); }
                    finally { down.recycle(); up.recycle(); }
                }
                stage = "NATIVE_VERIFY_SAVED";
                for (int attempt = 0; attempt < 160; attempt++) {
                    SystemClock.sleep(50);
                    if (initial.refresh() && pairingField(initial)
                        && (initial.getText() == null || initial.getText().length() == 0)
                        && namedNode(automation,
                            "Connection saved on this phone. Take a photo and tap Identify cigar to try it.") != null) {
                        success = true;
                        break;
                    }
                }
            }
        } catch (Throwable ignored) {
            // Never print exception bodies: future platform errors may contain input.
        } finally {
            if (!success && touched && initial != null) {
                try {
                    if (initial.refresh() && pairingField(initial)) {
                        Bundle empty = new Bundle();
                        empty.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, "");
                        initial.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, empty);
                    }
                } catch (Throwable ignored) { /* Caller must close Settings after failure. */ }
            }
            Arrays.fill(bytes, (byte) 0);
            Arrays.fill(token, '\0');
            if (automation != null) {
                try { UiAutomation.class.getDeclaredMethod("disconnect").invoke(automation); }
                catch (Throwable ignored) { /* Process exit releases the connection. */ }
            }
            thread.quitSafely();
        }
        System.out.println(success ? "OK" : "FAIL:" + stage);
        System.out.flush();
        System.exit(success ? 0 : 1);
    }
}
