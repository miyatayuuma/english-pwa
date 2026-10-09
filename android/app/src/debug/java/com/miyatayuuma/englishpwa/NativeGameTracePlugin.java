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
    public void openGameTrace(PluginCall call) {
        MainActivity activity = getActivity() instanceof MainActivity
            ? (MainActivity) getActivity() : null;
        if (!BuildConfig.DEBUG || activity == null) {
            call.reject("Only available in an Android debug APK");
            return;
        }
        activity.runOnUiThread(() -> {
            if (!activity.openGameTraceFromValidationPage()) {
                call.reject("Open the ASR validation page first");
                return;
            }
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
        activity.runOnUiThread(() -> {
            if (!activity.openValidationPageFromGameTrace()) {
                call.reject("Game trace is not active");
                return;
            }
            call.resolve();
        });
    }

}
