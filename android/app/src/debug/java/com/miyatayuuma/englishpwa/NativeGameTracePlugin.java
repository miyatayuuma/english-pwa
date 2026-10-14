package com.miyatayuuma.englishpwa;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.os.Handler;
import android.os.Looper;

@CapacitorPlugin(name = "NativeGameTrace")
public class NativeGameTracePlugin extends Plugin {
    @PluginMethod
    public void getCapability(PluginCall call) {
        MainActivity activity = getActivity() instanceof MainActivity
            ? (MainActivity) getActivity() : null;
        String requestId = call.getData().optString("diagnosticRequestId", null);
        String requestType = call.getData().optString("diagnosticRequestType", null);
        String callbackId = call.getCallbackId();
        if (activity != null) {
            activity.recordNativeGameTraceCapabilityEvent("plugin-capability-requested", null, null,
                requestId, requestType, callbackId, "requested", Thread.currentThread().getName());
        }
        // Capacitor 8.5.2 handles plugin methods on its task thread. On Android's
        // WebMessageListener path, MessageHandler assigns the new document's
        // JavaScriptReplyProxy after queuing the plugin invocation. Resolve on a
        // later main-thread turn so that assignment has completed and the
        // documented UI-thread reply-proxy contract is respected.
        new Handler(Looper.getMainLooper()).post(() -> {
            boolean enabled = BuildConfig.DEBUG
                && activity != null
                && activity.isNativeSpeechGameTraceLaunchEnabled();
            boolean available = BuildConfig.DEBUG;
            JSObject result = new JSObject();
            result.put("available", available);
            result.put("enabled", enabled);
            result.put("source", enabled ? "debug-launch-intent" : "disabled");
            if (activity != null) {
                activity.recordNativeGameTraceCapabilityEvent("plugin-capability-result-constructed", available, enabled,
                    requestId, requestType, callbackId, "constructed", Thread.currentThread().getName());
                activity.recordNativeGameTraceCapabilityEvent("plugin-call-resolve-invoked", available, enabled,
                    requestId, requestType, callbackId, "invoked", Thread.currentThread().getName());
            }
            call.resolve(result);
            if (activity != null) {
                activity.recordNativeGameTraceCapabilityEvent("plugin-call-resolve-returned", available, enabled,
                    requestId, requestType, callbackId, "returned", Thread.currentThread().getName());
            }
        });
    }

    @PluginMethod
    public void getReadinessDiagnostics(PluginCall call) {
        MainActivity activity = getActivity() instanceof MainActivity
            ? (MainActivity) getActivity() : null;
        if (!BuildConfig.DEBUG || activity == null) {
            call.reject("Debug readiness diagnostics are unavailable");
            return;
        }
        activity.runOnUiThread(() -> call.resolve(activity.getNativeGameTraceReadinessDiagnostics()));
    }

    @PluginMethod
    public void openGameTrace(PluginCall call) {
        MainActivity activity = getActivity() instanceof MainActivity
            ? (MainActivity) getActivity() : null;
        if (!BuildConfig.DEBUG || activity == null) {
            call.reject("Only available in an Android debug APK");
            return;
        }
        activity.recordNativeGameTraceGateEvent("plugin-open-requested", "native-gate", "app");
        activity.runOnUiThread(() -> {
            if (!activity.openGameTraceFromValidationPage()) {
                activity.recordNativeGameTraceGateEvent("plugin-open-rejected", "native-gate", "app", "native-navigation-denied");
                call.reject("Open the ASR validation page first");
                return;
            }
            activity.recordNativeGameTraceGateEvent("plugin-open-resolved", "native-gate", "app");
            call.resolve();
        });
    }

    @PluginMethod
    public void openAcceptanceCases(PluginCall call) {
        MainActivity activity = getActivity() instanceof MainActivity
            ? (MainActivity) getActivity() : null;
        if (!BuildConfig.DEBUG || activity == null) {
            call.reject("Only available in an Android debug APK");
            return;
        }
        activity.recordNativeGameTraceGateEvent("plugin-return-requested", "app", "native-gate");
        activity.runOnUiThread(() -> {
            if (!activity.openValidationPageFromGameTrace()) {
                activity.recordNativeGameTraceGateEvent("plugin-return-rejected", "app", "native-gate", "native-return-denied");
                call.reject("Game trace is not active");
                return;
            }
            activity.recordNativeGameTraceGateEvent("plugin-return-resolved", "app", "native-gate");
            call.resolve();
        });
    }

}
