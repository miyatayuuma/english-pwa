package com.miyatayuuma.englishpwa;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeSpeechPlugin.class);
        registerPlugin(NativeMediaPlugin.class);
        super.onCreate(savedInstanceState);
        // One shell policy for every page, including fixed-position overlays.
        // Keep the WebView viewport inside bars/cutouts/IME instead of relying
        // on WebView CSS env(safe-area-inset-*) support.
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        android.view.View container = (android.view.View) getBridge().getWebView().getParent();
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(container, (view, insets) -> {
            androidx.core.graphics.Insets safe = insets.getInsets(
                androidx.core.view.WindowInsetsCompat.Type.systemBars()
                | androidx.core.view.WindowInsetsCompat.Type.displayCutout()
                | androidx.core.view.WindowInsetsCompat.Type.ime());
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            return androidx.core.view.WindowInsetsCompat.CONSUMED;
        });
        androidx.core.view.ViewCompat.requestApplyInsets(container);
        // Explicit developer entry, absent from release assets and normal UI.
        if (BuildConfig.DEBUG && getIntent().getBooleanExtra("nativeSpeechGate", false)) {
            getBridge().getWebView().loadUrl("https://localhost/native-gate.html");
        }
    }
}
