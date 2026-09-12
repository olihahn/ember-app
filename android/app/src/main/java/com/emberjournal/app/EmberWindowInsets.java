package com.emberjournal.app;

import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.OnApplyWindowInsetsListener;
import androidx.core.view.WindowInsetsCompat;

/** Keeps the complete WebView outside system UI; CSS must not add these insets again. */
final class EmberWindowInsets implements OnApplyWindowInsetsListener {
    @Override
    @SuppressWarnings("deprecation")
    public WindowInsetsCompat onApplyWindowInsets(View view, WindowInsetsCompat insets) {
        int bars = WindowInsetsCompat.Type.systemBars();
        int cutout = WindowInsetsCompat.Type.displayCutout();
        int ime = WindowInsetsCompat.Type.ime();
        Insets padding = padding(insets.getInsets(bars), insets.getInsets(cutout), insets.getInsets(ime));
        // Replace rather than accumulate: rotation, keyboard hiding and navigation
        // mode changes must remove obsolete padding as well as add new padding.
        view.setPadding(padding.left, padding.top, padding.right, padding.bottom);

        // Send explicit zero values to WebView so env(safe-area-inset-*) resets
        // after changes. CONSUMED prevents that update on affected WebViews.
        // The cutout is already outside the view; consume just it for API 28,
        // where Builder.setDisplayCutout(null) is not implemented.
        return new WindowInsetsCompat.Builder(insets)
            .setInsets(bars | cutout | ime, Insets.NONE)
            .setInsetsIgnoringVisibility(bars | cutout, Insets.NONE)
            .build()
            .consumeDisplayCutout();
    }

    static Insets padding(Insets bars, Insets cutout, Insets ime) {
        // IME and navigation occupy the same bottom region, so take the union,
        // not their sum. Cutouts may move to either side in landscape.
        return Insets.max(Insets.max(bars, cutout), ime);
    }
}
