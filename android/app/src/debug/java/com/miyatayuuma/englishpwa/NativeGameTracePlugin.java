package com.miyatayuuma.englishpwa;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeGameTrace")
public class NativeGameTracePlugin extends Plugin {
    @PluginMethod
    public void getCapability(PluginCall call) {
        JSObject result = new JSObject();
        MainActivity activity = getActivity() instanceof MainActivity
            ? (MainActivity) getActivity() : null;
        boolean enabled = BuildConfig.DEBUG
            && activity != null
            && activity.isNativeSpeechGameTraceLaunchEnabled();
        result.put("available", BuildConfig.DEBUG);
        result.put("enabled", enabled);
        result.put("source", enabled ? "debug-launch-intent" : "disabled");
        call.resolve(result);
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
