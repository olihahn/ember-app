package com.emberjournal.app;

import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private View webViewContainer;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(EmberNativePlugin.class);
        super.onCreate(savedInstanceState);

        if (bridge == null || bridge.getWebView() == null) return;

        // Own insets natively on every WebView version. SystemBars.insetsHandling
        // is disabled in capacitor.config.ts so it cannot also pad this view.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        webViewContainer = (View) bridge.getWebView().getParent();
        webViewContainer.setBackgroundColor(Color.rgb(246, 241, 228));
        ViewCompat.setOnApplyWindowInsetsListener(webViewContainer, new EmberWindowInsets());
        ViewCompat.requestApplyInsets(webViewContainer);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (webViewContainer != null) ViewCompat.requestApplyInsets(webViewContainer);
    }
}
