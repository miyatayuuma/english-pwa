package com.miyatayuuma.englishpwa;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.JSObject;
import android.os.Bundle;
import android.os.SystemClock;
import android.content.Intent;
import android.util.Log;
import android.net.Uri;
import org.json.JSONArray;
import org.json.JSONException;

public class MainActivity extends BridgeActivity {
    private boolean nativeSpeechGameTraceLaunch;
    private final JSONArray nativeGameTraceGateEvents = new JSONArray();
    private int nativeGameTraceGateSequence;
    private String activityLifecycle = "created";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        nativeSpeechGameTraceLaunch = BuildConfig.DEBUG
            && getIntent().getBooleanExtra("nativeSpeechGameTrace", false);
        registerPlugin(NativeSpeechPlugin.class);
        registerPlugin(NativeMediaPlugin.class);
        registerDebugGameTracePlugin();
        super.onCreate(savedInstanceState);
        recordNativeGameTraceGateEvent("activity-onCreate-complete", null, null);
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
            recordNativeGameTraceGateEvent("debug-validation-launch", "intent", "native-gate");
            getBridge().getWebView().loadUrl("https://localhost/native-gate.html");
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        activityLifecycle = "started";
        recordNativeGameTraceGateEvent("activity-onStart", null, null);
    }

    @Override
    public void onResume() {
        super.onResume();
        activityLifecycle = "resumed";
        recordNativeGameTraceGateEvent("activity-onResume", null, null);
    }

    @Override
    public void onPause() {
        activityLifecycle = "paused";
        recordNativeGameTraceGateEvent("activity-onPause", null, null);
        super.onPause();
    }

    @Override
    public void onStop() {
        activityLifecycle = "stopped";
        recordNativeGameTraceGateEvent("activity-onStop", null, null);
        super.onStop();
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

    synchronized void recordNativeGameTraceGateEvent(String stage, String source, String target) {
        recordNativeGameTraceGateEvent(stage, source, target, null);
    }

    synchronized void recordNativeGameTraceGateEvent(String stage, String source, String target, String reason) {
        if (!BuildConfig.DEBUG) return;
        JSObject event = new JSObject();
        event.put("sequence", ++nativeGameTraceGateSequence);
        event.put("clock", "SystemClock.elapsedRealtimeNanos");
        event.put("atNanos", SystemClock.elapsedRealtimeNanos());
        event.put("stage", stage);
        if (source != null) event.put("sourcePage", source);
        if (target != null) event.put("targetPage", target);
        if (reason != null) event.put("reason", reason);
        nativeGameTraceGateEvents.put(event);
        if (nativeGameTraceGateEvents.length() > 60) nativeGameTraceGateEvents.remove(0);
        Log.i("NativeGameTraceGate", stage + " source=" + source + " target=" + target
            + " launchEnabled=" + nativeSpeechGameTraceLaunch);
    }

    synchronized void recordNativeGameTraceCapabilityEvent(String stage, Boolean available, Boolean enabled) {
        recordNativeGameTraceCapabilityEvent(stage, available, enabled, null, null, null, null,
            Thread.currentThread().getName());
    }

    synchronized void recordNativeGameTraceCapabilityEvent(String stage, Boolean available, Boolean enabled,
            String requestId, String requestType, String callbackId, String resolutionStatus, String threadName) {
        if (!BuildConfig.DEBUG) return;
        JSObject event = new JSObject();
        event.put("sequence", ++nativeGameTraceGateSequence);
        event.put("clock", "SystemClock.elapsedRealtimeNanos");
        event.put("atNanos", SystemClock.elapsedRealtimeNanos());
        event.put("stage", stage);
        if (available != null) event.put("available", available);
        if (enabled != null) event.put("enabled", enabled);
        event.put("launchEnabled", nativeSpeechGameTraceLaunch);
        if (isBoundedDiagnosticId(requestId)) event.put("requestId", requestId);
        if (isCapabilityRequestType(requestType)) event.put("requestType", requestType);
        if (isBoundedCallbackId(callbackId)) event.put("callbackId", callbackId);
        if (isCapabilityResolutionStatus(resolutionStatus)) event.put("resolutionStatus", resolutionStatus);
        if (isBoundedThreadName(threadName)) event.put("threadName", threadName);
        nativeGameTraceGateEvents.put(event);
        if (nativeGameTraceGateEvents.length() > 60) nativeGameTraceGateEvents.remove(0);
        Log.i("NativeGameTraceGate", stage
            + " available=" + available + " enabled=" + enabled
            + " launchEnabled=" + nativeSpeechGameTraceLaunch
            + " requestId=" + (isBoundedDiagnosticId(requestId) ? requestId : "none")
            + " requestType=" + (isCapabilityRequestType(requestType) ? requestType : "none")
            + " callbackId=" + (isBoundedCallbackId(callbackId) ? callbackId : "none")
            + " resolutionStatus=" + (isCapabilityResolutionStatus(resolutionStatus) ? resolutionStatus : "none")
            + " threadName=" + (isBoundedThreadName(threadName) ? threadName : "unknown"));
    }

    private static boolean isBoundedDiagnosticId(String value) {
        return value != null && value.length() <= 64 && value.matches("[A-Za-z0-9_-]{1,64}");
    }

    private static boolean isCapabilityRequestType(String value) {
        return "initializer".equals(value) || "launch-update".equals(value)
            || "gate-snapshot".equals(value) || "gate-return".equals(value);
    }

    private static boolean isBoundedCallbackId(String value) {
        return value != null && value.length() <= 20 && value.matches("[0-9]{1,20}");
    }

    private static boolean isCapabilityResolutionStatus(String value) {
        return "requested".equals(value) || "constructed".equals(value)
            || "invoked".equals(value) || "returned".equals(value);
    }

    private static boolean isBoundedThreadName(String value) {
        return value != null && value.length() <= 40 && value.matches("[A-Za-z0-9._-]{1,40}");
    }

    synchronized JSObject getNativeGameTraceReadinessDiagnostics() {
        JSObject result = new JSObject();
        try {
            String currentUrl = getBridge() != null && getBridge().getWebView() != null
                ? getBridge().getWebView().getUrl() : null;
            result.put("debugOnly", BuildConfig.DEBUG);
            result.put("currentUrl", sanitizedWebViewUrl(currentUrl));
            result.put("currentPage", pageId(currentUrl));
            result.put("documentProgress", getBridge() != null && getBridge().getWebView() != null
                ? getBridge().getWebView().getProgress() : -1);
            result.put("activityLifecycle", activityLifecycle);
            result.put("launchEnabled", isNativeSpeechGameTraceLaunchEnabled());
            result.put("clock", "SystemClock.elapsedRealtimeNanos since boot");
            boolean legacyBridgeEnabled = getBridge() != null && getBridge().getConfig().isUsingLegacyBridge();
            result.put("legacyBridgeEnabled", legacyBridgeEnabled);
            result.put("callbackTransport", legacyBridgeEnabled
                ? "legacy-javascript-interface" : "web-message-listener-when-available");
            result.put("events", new JSONArray(nativeGameTraceGateEvents.toString()));
        } catch (JSONException ignored) {
            // The diagnostic is best-effort and contains metadata only.
        }
        return result;
    }

    private static String pageId(String url) {
        if (url == null) return "none";
        if (url.contains("/native-gate.html")) return "native-gate";
        if (url.contains("/index.html") || url.endsWith("/")) return "app";
        return "other";
    }

    private static String sanitizedWebViewUrl(String url) {
        if (url == null) return "";
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if ("localhost".equalsIgnoreCase(host)) {
            String path = uri.getPath() == null ? "" : uri.getPath();
            return (scheme == null ? "" : scheme + "://") + host + path;
        }
        return (scheme == null ? "unknown" : scheme) + "://" + (host == null ? "unknown" : host);
    }

    // Explicit in-app navigation for the debug acceptance APK; no ADB needed.
    // The gate can only be turned on from the debug-only validation page.
    boolean openGameTraceFromValidationPage() {
        if (!BuildConfig.DEBUG) {
            recordNativeGameTraceGateEvent("navigation-denied", "unknown", "app", "release-build");
            return false;
        }
        if (getBridge() == null || getBridge().getWebView() == null) {
            recordNativeGameTraceGateEvent("navigation-denied", "unknown", "app", "webview-unavailable");
            return false;
        }
        String currentUrl = getBridge().getWebView().getUrl();
        if (!"https://localhost/native-gate.html".equals(currentUrl)) {
            recordNativeGameTraceGateEvent("navigation-denied", pageId(currentUrl), "app", "source-page-mismatch");
            return false;
        }
        nativeSpeechGameTraceLaunch = true;
        recordNativeGameTraceGateEvent("navigation-authorized", "native-gate", "app");
        getBridge().getWebView().loadUrl("https://localhost/index.html");
        recordNativeGameTraceGateEvent("webview-load-requested", "native-gate", "app");
        return true;
    }

    boolean openValidationPageFromGameTrace() {
        if (!BuildConfig.DEBUG || !nativeSpeechGameTraceLaunch || getBridge() == null
                || getBridge().getWebView() == null) {
            recordNativeGameTraceGateEvent("return-navigation-denied", pageId(
                getBridge() != null && getBridge().getWebView() != null
                    ? getBridge().getWebView().getUrl() : null), "native-gate",
                !BuildConfig.DEBUG ? "release-build" : !nativeSpeechGameTraceLaunch
                    ? "trace-launch-not-enabled" : "webview-unavailable");
            return false;
        }
        nativeSpeechGameTraceLaunch = false;
        recordNativeGameTraceGateEvent("return-navigation-authorized", "app", "native-gate");
        getBridge().getWebView().loadUrl("https://localhost/native-gate.html");
        recordNativeGameTraceGateEvent("webview-load-requested", "app", "native-gate");
        return true;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        setIntent(intent);
        super.onNewIntent(intent);
        nativeSpeechGameTraceLaunch = BuildConfig.DEBUG
            && intent.getBooleanExtra("nativeSpeechGameTrace", false);
        recordNativeGameTraceGateEvent("activity-onNewIntent",
            intent.getBooleanExtra("nativeSpeechGate", false) ? "intent-debug-gate" : "intent-normal",
            nativeSpeechGameTraceLaunch ? "app-trace-enabled" : "app-trace-disabled");
        if (BuildConfig.DEBUG && intent.getBooleanExtra("nativeSpeechGate", false)) {
            recordNativeGameTraceGateEvent("debug-validation-launch", "intent", "native-gate");
            getBridge().getWebView().loadUrl("https://localhost/native-gate.html");
            return;
        }
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(
                "window.dispatchEvent(new Event('native-game-trace-launch-updated'))", null));
        }
    }
}
