package com.miyatayuuma.englishpwa;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import android.os.Bundle;
import android.content.Intent;

public class MainActivity extends BridgeActivity {
    private boolean nativeSpeechGameTraceLaunch;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        nativeSpeechGameTraceLaunch = BuildConfig.DEBUG
            && getIntent().getBooleanExtra("nativeSpeechGameTrace", false);
        registerPlugin(NativeSpeechPlugin.class);
        registerPlugin(NativeMediaPlugin.class);
        registerDebugGameTracePlugin();
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

    @SuppressWarnings("unchecked")
    private void registerDebugGameTracePlugin() {
        if (!BuildConfig.DEBUG) return;
        try {
            Class<?> plugin = Class.forName("com.miyatayuuma.englishpwa.NativeGameTracePlugin");
            if (Plugin.class.isAssignableFrom(plugin)) {
                registerPlugin((Class<? extends Plugin>) plugin);
            }
        } catch (ClassNotFoundException ignored) {
            // The bridge capability exists only in the debug source set.
        }
    }

    boolean isNativeSpeechGameTraceLaunchEnabled() {
        return BuildConfig.DEBUG && nativeSpeechGameTraceLaunch;
    }

    // Explicit in-app navigation for the debug acceptance APK; no ADB needed.
    // The gate can only be turned on from the debug-only validation page.
    boolean openGameTraceFromValidationPage() {
        if (!BuildConfig.DEBUG || getBridge() == null || getBridge().getWebView() == null) return false;
        String currentUrl = getBridge().getWebView().getUrl();
        if (!"https://localhost/native-gate.html".equals(currentUrl)) return false;
        nativeSpeechGameTraceLaunch = true;
        getBridge().getWebView().loadUrl("https://localhost/index.html");
        return true;
    }

    boolean openValidationPageFromGameTrace() {
        if (!BuildConfig.DEBUG || !nativeSpeechGameTraceLaunch || getBridge() == null
                || getBridge().getWebView() == null) return false;
        nativeSpeechGameTraceLaunch = false;
        getBridge().getWebView().loadUrl("https://localhost/native-gate.html");
        return true;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        setIntent(intent);
        super.onNewIntent(intent);
        nativeSpeechGameTraceLaunch = BuildConfig.DEBUG
            && intent.getBooleanExtra("nativeSpeechGameTrace", false);
        if (BuildConfig.DEBUG && intent.getBooleanExtra("nativeSpeechGate", false)) {
            getBridge().getWebView().loadUrl("https://localhost/native-gate.html");
            return;
        }
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(
                "window.dispatchEvent(new Event('native-game-trace-launch-updated'))", null));
        }
    }
}
