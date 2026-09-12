package com.emberjournal.qa;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.UiAutomation;
import android.graphics.Rect;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.SystemClock;
import android.text.TextUtils;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import java.util.ArrayDeque;
import org.json.JSONArray;
import org.json.JSONObject;

/** Read-only shell-UID probe. No input, actions, passwords, or general hierarchy output. */
public final class EmberAccessibilityProbe {
    private static final String PACKAGE = "com.emberjournal.app";
    private static final String[] LABELS = {
        "Play music", "Pause music", "Mobile navigation", "Ember terrace home"
    };
    private static final int MAX_NODES = 4096;
    private static final int MAX_DEPTH = 64;

    private static final class Pending {
        final AccessibilityNodeInfo node;
        final JSONArray ancestors;
        Pending(AccessibilityNodeInfo node, JSONArray ancestors) {
            this.node = node;
            this.ancestors = ancestors;
        }
    }

    private static JSONObject geometry(AccessibilityNodeInfo node) throws Exception {
        Rect bounds = new Rect();
        node.getBoundsInScreen(bounds);
        return new JSONObject()
            .put("visible", node.isVisibleToUser())
            .put("bounds", new JSONArray(new int[] {
                bounds.left, bounds.top, bounds.right, bounds.bottom
            }));
    }

    private static JSONArray append(JSONArray ancestors, JSONObject parent) throws Exception {
        JSONArray next = new JSONArray();
        for (int i = 0; i < ancestors.length(); i++) next.put(ancestors.get(i));
        return next.put(parent);
    }

    @SuppressWarnings("deprecation")
    private static JSONObject snapshot(UiAutomation automation, boolean refresh) throws Exception {
        JSONArray[] matches = new JSONArray[LABELS.length];
        for (int i = 0; i < matches.length; i++) matches[i] = new JSONArray();
        AccessibilityNodeInfo root = automation.getRootInActiveWindow();
        if (root == null || !TextUtils.equals(PACKAGE, root.getPackageName())) {
            if (root != null) root.recycle();
            throw new IllegalStateException();
        }
        boolean refreshed = refresh && root.refresh();
        // A fresh WebView node may be valid even when refresh() returns false.
        // Never use refresh or isVisibleToUser as a subtree exclusion predicate.
        ArrayDeque<Pending> pending = new ArrayDeque<>();
        pending.add(new Pending(root, new JSONArray()));
        int visited = 0;
        boolean truncated = false;
        long deadline = SystemClock.uptimeMillis() + 6000;
        try {
            while (!pending.isEmpty()) {
                if (visited >= MAX_NODES || SystemClock.uptimeMillis() >= deadline) {
                    truncated = true;
                    break;
                }
                Pending item = pending.removeFirst();
                AccessibilityNodeInfo node = item.node;
                try {
                    visited++;
                    if (!TextUtils.equals(PACKAGE, node.getPackageName())) continue;
                    JSONObject metadata = geometry(node);
                    // Do not request text, hints, descriptions, or children of inputs.
                    // Ordinary control/container labels are compared in memory only.
                    if (node.isPassword() || node.isEditable()
                        || TextUtils.equals("android.widget.EditText", node.getClassName())) continue;
                    for (int i = 0; i < LABELS.length; i++) {
                        if (TextUtils.equals(LABELS[i], node.getText())
                            || TextUtils.equals(LABELS[i], node.getContentDescription())) {
                            if (matches[i].length() < 16) {
                                matches[i].put(new JSONObject()
                                    .put("visible", metadata.getBoolean("visible"))
                                    .put("bounds", metadata.getJSONArray("bounds"))
                                    .put("ancestors", item.ancestors));
                            } else truncated = true;
                        }
                    }
                    int children = node.getChildCount();
                    if (item.ancestors.length() >= MAX_DEPTH) {
                        if (children != 0) truncated = true;
                        continue;
                    }
                    JSONArray ancestors = append(item.ancestors, metadata);
                    for (int i = 0; i < children; i++) {
                        if (visited + pending.size() >= MAX_NODES) {
                            truncated = true;
                            break;
                        }
                        AccessibilityNodeInfo child = node.getChild(i);
                        if (child != null) pending.add(new Pending(child, ancestors));
                    }
                } finally {
                    node.recycle();
                }
            }
        } finally {
            while (!pending.isEmpty()) pending.removeFirst().node.recycle();
        }
        JSONArray controls = new JSONArray();
        for (int i = 0; i < LABELS.length; i++) {
            controls.put(new JSONObject().put("label", LABELS[i])
                .put("present", matches[i].length() > 0).put("matches", matches[i]));
        }
        return new JSONObject().put("refreshAttempted", refresh)
            .put("refreshSucceeded", refreshed).put("truncated", truncated)
            .put("controls", controls);
    }

    @SuppressWarnings("deprecation")
    public static void main(String[] args) {
        String stage = "ARGUMENTS";
        JSONObject report = new JSONObject();
        boolean success = false;
        HandlerThread thread = new HandlerThread("ember-accessibility-probe");
        UiAutomation automation = null;
        try {
            if (args.length != 0) throw new IllegalArgumentException();
            stage = "CONNECT";
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
                | AccessibilityServiceInfo.FLAG_REQUEST_ENHANCED_WEB_ACCESSIBILITY;
            info.eventTypes = AccessibilityEvent.TYPES_ALL_MASK;
            info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC;
            automation.setServiceInfo(info);
            long settledSnapshotAt = SystemClock.uptimeMillis() + 10000;
            try { automation.waitForIdle(100, 1500); }
            catch (java.util.concurrent.TimeoutException ignored) { /* Snapshot remains bounded. */ }
            stage = "SNAPSHOT_ONE";
            JSONArray snapshots = new JSONArray().put(snapshot(automation, false));
            // Keep this same service connection alive; do not toggle accessibility
            // between requests as separate `uiautomator dump` processes would.
            SystemClock.sleep(1500);
            stage = "SNAPSHOT_TWO";
            snapshots.put(snapshot(automation, true));
            // Chromium 133 AccessibilityState can defer service-list notification
            // by 250 + 500 + 1000 + 2000 + 4000 ms. One same-connection snapshot
            // beyond that window distinguishes settling from a persistent omission;
            // it does not claim that UiAutomation is equivalent to TalkBack.
            long remaining = settledSnapshotAt - SystemClock.uptimeMillis();
            if (remaining > 0) SystemClock.sleep(remaining);
            stage = "SNAPSHOT_SETTLED";
            snapshots.put(snapshot(automation, true));
            report.put("success", true).put("snapshots", snapshots);
            success = true;
        } catch (Throwable ignored) {
            // No exception, node.toString(), hierarchy, or arbitrary text can escape.
            try { report = new JSONObject().put("success", false).put("stage", stage); }
            catch (Exception impossible) { /* Fixed JSON fallback below. */ }
        } finally {
            if (automation != null) {
                try { UiAutomation.class.getDeclaredMethod("disconnect").invoke(automation); }
                catch (Throwable ignored) { /* Process exit also releases the connection. */ }
            }
            thread.quitSafely();
        }
        System.out.println(report.toString());
        System.out.flush();
        System.exit(success ? 0 : 1);
    }
}
