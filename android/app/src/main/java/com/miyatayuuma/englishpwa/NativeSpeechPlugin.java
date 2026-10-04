package com.miyatayuuma.englishpwa;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.LinkedHashSet;

@CapacitorPlugin(name = "NativeSpeech", permissions = {
    @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
})
public class NativeSpeechPlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private Session active;

    private static final class Session {
        final String id;
        final SpeechRecognizer recognizer;
        boolean stopping;
        boolean finished;
        Session(String id, SpeechRecognizer recognizer) {
            this.id = id;
            this.recognizer = recognizer;
        }
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        main.post(() -> {
            JSObject result = new JSObject();
            result.put("available", SpeechRecognizer.isRecognitionAvailable(getContext()));
            result.put("apiLevel", Build.VERSION.SDK_INT);
            result.put("provider", Settings.Secure.getString(getContext().getContentResolver(), "voice_recognition_service"));
            // Intent support is a platform capability, not proof the provider
            // honors bias. OFF/ON device measurements remain necessary.
            result.put("biasSupported", Build.VERSION.SDK_INT >= 33);
            result.put("microphone", getPermissionState("microphone").toString());
            call.resolve(result);
        });
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            permissionResult(call);
        } else {
            requestPermissionForAlias("microphone", call, "permissionResult");
        }
    }

    @PermissionCallback
    private void permissionResult(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", getPermissionState("microphone") == PermissionState.GRANTED);
        result.put("microphone", getPermissionState("microphone").toString());
        call.resolve(result);
    }

    @PluginMethod
    public void start(PluginCall call) {
        final String id = call.getString("sessionId");
        if (id == null || id.isEmpty()) {
            call.reject("sessionId is required", "INVALID_SESSION");
            return;
        }
        final ArrayList<String> bias = new ArrayList<>();
        JSArray supplied = call.getArray("biasStrings", new JSArray());
        LinkedHashSet<String> unique = new LinkedHashSet<>();
        for (int i = 0; i < supplied.length(); i++) {
            Object value = supplied.opt(i);
            if (!(value instanceof String) || ((String) value).trim().isEmpty()) {
                call.reject("biasStrings must contain nonempty strings", "INVALID_BIAS");
                return;
            }
            // Validation only: preserve bytes, punctuation, case and order.
            unique.add((String) value);
        }
        bias.addAll(unique);
        main.post(() -> {
            if (active != null) {
                call.reject("Recognition is already active or awaiting a final callback", "BUSY");
                return;
            }
            if (getPermissionState("microphone") != PermissionState.GRANTED) {
                call.reject("Microphone permission was not granted", "PERMISSION_DENIED");
                return;
            }
            if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
                call.reject("No system speech recognizer is available", "UNAVAILABLE");
                return;
            }
            Session session = null;
            try {
                SpeechRecognizer recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
                session = new Session(id, recognizer);
                active = session;
                recognizer.setRecognitionListener(new Listener(session));
                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US");
                intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 20);
                if (Build.VERSION.SDK_INT >= 33) {
                    intent.putStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS, bias);
                }
                debug("start " + id + " API=" + Build.VERSION.SDK_INT + " bias=" + bias);
                recognizer.startListening(intent);
                emit(session, "started", new JSObject());
                call.resolve();
            } catch (RuntimeException error) {
                if (session != null) finish(session, "error", errorPayload("START_FAILED", error.getMessage()));
                call.reject("Native speech startup failed", "START_FAILED", error);
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> {
            Session session = matching(call);
            if (session == null) return;
            if (!session.stopping) {
                session.stopping = true;
                debug("stop " + session.id);
                try {
                    session.recognizer.stopListening();
                } catch (RuntimeException error) {
                    finish(session, "error", errorPayload("STOP_FAILED", error.getMessage()));
                }
            }
            // Keep active until onResults/onError. No restart after stop alone.
            call.resolve();
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        main.post(() -> {
            Session session = matching(call);
            if (session == null) return;
            abort(session, "CANCELLED");
            call.resolve();
        });
    }

    private Session matching(PluginCall call) {
        String id = call.getString("sessionId");
        if (active == null || !active.id.equals(id)) {
            call.reject("Session is no longer active", "STALE_SESSION");
            return null;
        }
        return active;
    }

    private boolean current(Session session) {
        return active == session && !session.finished;
    }

    private void emit(Session session, String type, JSObject payload) {
        if (!current(session)) return;
        payload.put("sessionId", session.id);
        payload.put("type", type);
        debug(type + " " + session.id + " " + payload);
        notifyListeners("recognition", payload);
    }

    private JSObject errorPayload(String code, String message) {
        JSObject payload = new JSObject();
        payload.put("code", code);
        payload.put("message", message == null ? code : message);
        return payload;
    }

    private void finish(Session session, String type, JSObject payload) {
        if (!current(session)) return;
        emit(session, type, payload);
        emit(session, "end", new JSObject());
        session.finished = true;
        active = null;
        destroy(session);
        debug("destroy " + session.id);
    }

    private void abort(Session session, String code) {
        if (!current(session)) return;
        // Invalidate before cancel: a provider may synchronously call onError.
        session.finished = true;
        active = null;
        try {
            session.recognizer.cancel();
        } catch (RuntimeException error) {
            debug("cancel failure " + error);
        } finally {
            destroy(session);
        }
        JSObject payload = errorPayload(code, code);
        payload.put("sessionId", session.id);
        payload.put("type", "error");
        notifyListeners("recognition", payload);
        JSObject end = new JSObject();
        end.put("sessionId", session.id);
        end.put("type", "end");
        notifyListeners("recognition", end);
        debug("cancel/destroy " + session.id);
    }

    private void destroy(Session session) {
        try { session.recognizer.destroy(); }
        catch (RuntimeException error) { debug("destroy failure " + error); }
    }

    private JSObject results(Bundle bundle) {
        ArrayList<String> transcripts = bundle == null ? null : bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        float[] confidence = bundle == null ? null : bundle.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES);
        JSArray alternatives = new JSArray();
        if (transcripts != null) {
            for (int i = 0; i < Math.min(20, transcripts.size()); i++) {
                JSObject candidate = new JSObject();
                candidate.put("transcript", transcripts.get(i));
                candidate.put("asrRank", i);
                candidate.put("confidence", confidence != null && i < confidence.length && confidence[i] >= 0 && Float.isFinite(confidence[i])
                    ? confidence[i] : org.json.JSONObject.NULL);
                alternatives.put(candidate);
            }
        }
        JSObject payload = new JSObject();
        payload.put("alternatives", alternatives);
        payload.put("requestedMaxResults", 20);
        payload.put("providerReturnedCount", transcripts == null ? 0 : transcripts.size());
        payload.put("retainedCandidateCount", alternatives.length());
        return payload;
    }

    private final class Listener implements RecognitionListener {
        private final Session session;
        Listener(Session session) { this.session = session; }
        public void onReadyForSpeech(Bundle params) { emit(session, "ready", new JSObject()); }
        public void onBeginningOfSpeech() { }
        public void onRmsChanged(float rmsdB) { }
        public void onBufferReceived(byte[] buffer) { } // Never store audio.
        public void onEndOfSpeech() { } // Not terminal: final/error still follows.
        public void onError(int error) { finish(session, "error", errorPayload("ANDROID_" + error, "SpeechRecognizer error " + error)); }
        public void onResults(Bundle bundle) { finish(session, "final", results(bundle)); }
        public void onPartialResults(Bundle bundle) { emit(session, "partial", results(bundle)); }
        public void onEvent(int eventType, Bundle params) { }
    }

    private void debug(String value) {
        if (BuildConfig.DEBUG) Log.d("NativeSpeech", value);
    }

    @Override
    protected void handleOnPause() {
        main.post(() -> { if (active != null) abort(active, "BACKGROUND_CANCELLED"); });
    }

    @Override
    protected void handleOnDestroy() {
        main.post(() -> { if (active != null) abort(active, "DESTROYED"); });
    }
}
