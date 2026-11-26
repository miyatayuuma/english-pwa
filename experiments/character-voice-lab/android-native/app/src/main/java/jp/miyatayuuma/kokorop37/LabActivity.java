package jp.miyatayuuma.kokorop37;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.view.View;
import android.view.WindowManager;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Locale;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class LabActivity extends Activity {
    private static final int MIC_PERMISSION = 40;
    private static final int EXPORT_JSON = 41;
    private static final String PROBE =
            "The lavender bicycle is still by the window. The lavender bicycle will stay here until it stops raining.";

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ArrayList<Button> testButtons = new ArrayList<>();
    private LabAssets assets;
    private AudioOutput audio;
    private LabTests tests;
    private Results results;
    private Spinner precision;
    private Spinner threads;
    private Spinner provider;
    private Spinner character;
    private Spinner qualitySample;
    private TextView status;
    private Button micButton;
    private Button stopButton;
    private LabRun active;
    private JSONObject micReport;
    private SpeechRecognizer recognizer;
    private long micStarted;
    private boolean asrFinal;
    private boolean destroyed;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(24, 33, 52));
        getWindow().setNavigationBarColor(Color.rgb(24, 33, 52));
        var scroll = new ScrollView(this);
        var body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(18), dp(34), dp(18), dp(40));
        body.setBackgroundColor(Color.rgb(245, 247, 250));
        scroll.addView(body);
        setContentView(scroll);
        label(body, "Kokoro Pixel Lab", 27);
        label(body, "P3.7 · Androidネイティブ音声合成", 15);
        status = label(body, "試験データを確認中", 16);
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        try {
            assets = new LabAssets(this);
            results = new Results(this, assets);
            audio = new AudioOutput(this);
            tests = new LabTests(this, assets, audio, text -> main.post(() -> {
                if (!destroyed && micReport == null) status.setText(text);
            }));
        } catch (Exception | LinkageError error) {
            status.setText(error.toString());
            return;
        }

        precision = spinner(body, "モデル", new String[]{"q8", "fp32"}, 0);
        threads = spinner(body, "スレッド", new Integer[]{1, 2, 4, 8}, 2);
        provider = spinner(body, "実行方式", new String[]{"CPU", "XNNPACK + CPU"}, 0);
        test(body, "モデルを準備", () -> start("prepare", tests::warmEngine));
        test(body, "短文 × 5", () -> benchmark("short"));
        test(body, "通常会話と長文", () -> benchmark("dialogue"));
        test(body, "10分連続会話", () -> benchmark("endurance"));
        test(body, "モデル・スレッド一括比較", () -> start("matrix", (config, run, report) -> tests.compareSettings(run, report)));

        character = spinner(body, "音質比較のキャラクター", assets.voices.values().toArray(new LabAssets.Voice[0]), 1);
        qualitySample = spinner(body, "音質比較の文", new String[]{"everyday", "read", "read-curated"}, 0);
        test(body, "音質比較 A → B → C", this::quality);

        label(body, "ASR切替", 19);
        label(body, "試験音声が聞こえたら「割り込んで話す」を押し、表示が「話してください」に変わった後で英語の指定文を話します。", 14);
        test(body, "ASR用の試験音声を再生", () -> start("asr-probe",
                (config, run, report) -> tests.asrLine(PROBE, config, run, report)));
        micButton = button(body, "割り込んで話す", this::requestMic);
        stopButton = button(body, "停止", () -> stop("user-stop"));
        button(body, "結果JSONを保存", this::chooseExport);
        controls();
        status.setText("モデルを準備してください");
    }

    private void benchmark(String type) {
        start(type, (config, run, report) -> tests.measure(type, config, run, report));
    }

    private void quality() {
        var voice = (LabAssets.Voice) character.getSelectedItem();
        String line = (String) qualitySample.getSelectedItem();
        if (!line.equals("everyday") && !voice.id().equals("jennifer")) {
            status.setText("read の比較は Jennifer を選択してください");
            return;
        }
        start("quality", (config, run, report) -> tests.quality(config, voice.id(), line, run, report));
    }

    @FunctionalInterface
    private interface Trial { void run(KokoroEngine.Config config, LabRun run, JSONObject report) throws Exception; }

    private void start(String kind, Trial trial) {
        if (active != null || micReport != null) return;
        var config = new KokoroEngine.Config((String) precision.getSelectedItem(), (Integer) threads.getSelectedItem(),
                provider.getSelectedItemPosition() == 1);
        var run = new LabRun();
        active = run;
        controls();
        status.setText("実行中 · " + kind);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        worker.execute(() -> {
            var report = Results.object("type", kind, "startedAt", Results.timestamp(), "config", config.json());
            String outcome;
            try {
                trial.run(config, run, report);
                outcome = run.stopped() ? "cancelled" : "completed";
            } catch (CancellationException error) {
                outcome = "cancelled";
                set(report, "error", error.getMessage());
            } catch (Exception | LinkageError error) {
                outcome = "error";
                set(report, "error", error.toString());
            }
            set(report, "status", outcome);
            set(report, "stopReason", run.reason());
            set(report, "endedAt", Results.timestamp());
            String message = outcome.equals("completed") ? "完了 · " + kind + summary(report)
                    : outcome + " · " + report.optString("error", report.optString("stopReason", kind));
            try {
                results.add(report);
            } catch (Exception error) {
                message = "結果を保存できません · " + error;
            }
            String finalMessage = message;
            main.post(() -> {
                if (destroyed) return;
                active = null;
                getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                if (micReport == null) status.setText(finalMessage);
                controls();
                replyIfReady();
            });
        });
    }

    private static String summary(JSONObject report) {
        JSONObject values = report.optJSONObject("summary");
        if (values == null) return "";
        JSONObject frames = values.optJSONObject("requestToFirstFrameMs");
        JSONObject rtf = values.optJSONObject("rtf");
        if (frames == null || rtf == null) return "";
        return String.format(Locale.ROOT, "\n再生開始中央値 %.0f ms · RTF %.2f", frames.optDouble("p50"), rtf.optDouble("p50"));
    }

    private void requestMic() {
        if (micReport != null) return;
        if (!SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) {
            saveMic(Results.object("type", "asr-switch", "status", "unavailable", "startedAt", Results.timestamp()));
            status.setText("端末内の英語音声認識を利用できません");
            return;
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MIC_PERMISSION);
            return;
        }
        beginMic();
    }

    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(request, permissions, grants);
        if (request == MIC_PERMISSION && grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED
                && hasWindowFocus()) beginMic();
    }

    private void beginMic() {
        if (micReport != null || destroyed) return;
        micStarted = System.nanoTime();
        LabRun interrupted = active;
        if (interrupted != null) {
            interrupted.stop("microphone-interruption");
            audio.halt(interrupted);
        }
        asrFinal = false;
        micReport = Results.object("type", "asr-switch", "startedAt", Results.timestamp(), "mode", "on-device",
                "interruptedRun", interrupted != null, "haltReturnMs", Results.elapsedMs(micStarted));
        JSONObject identity = micReport;
        controls();
        status.setText("再生を停止しました。マイクを準備中");
        // Give the speaker route time to drain before starting recognition.
        main.postDelayed(() -> {
            if (micReport != identity) return;
            try {
                recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(this);
                var intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US");
                intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                recognizer.setRecognitionListener(new RecognitionListener() {
                    @Override public void onReadyForSpeech(Bundle data) {
                        if (micReport != identity) return;
                        set(identity, "readyMs", Results.elapsedMs(micStarted));
                        status.setText("話してください · " + LabTests.ASR_PROMPT);
                    }
                    @Override public void onBeginningOfSpeech() {
                        if (micReport == identity) set(identity, "speechBeganMs", Results.elapsedMs(micStarted));
                    }
                    @Override public void onRmsChanged(float rms) {}
                    @Override public void onBufferReceived(byte[] bytes) {}
                    @Override public void onEndOfSpeech() {
                        if (micReport == identity) set(identity, "speechEndMs", Results.elapsedMs(micStarted));
                    }
                    @Override public void onError(int code) {
                        if (micReport == identity) finishMic("recognizer-error-" + code);
                    }
                    @Override public void onResults(Bundle data) {
                        if (micReport != identity) return;
                        inspect(data, identity, true);
                        set(identity, "finalMs", Results.elapsedMs(micStarted));
                        destroyRecognizer();
                        asrFinal = true;
                        status.setText("音声認識が確定しました");
                        replyIfReady();
                    }
                    @Override public void onPartialResults(Bundle data) {
                        if (micReport == identity) inspect(data, identity, false);
                    }
                    @Override public void onEvent(int type, Bundle data) {}
                });
                set(identity, "startListeningMs", Results.elapsedMs(micStarted));
                recognizer.startListening(intent);
                main.postDelayed(() -> {
                    if (micReport == identity && !asrFinal) finishMic("recognition-timeout");
                }, 15_000);
            } catch (RuntimeException error) {
                finishMic("recognizer-unavailable");
            }
        }, 150);
    }

    private void inspect(Bundle data, JSONObject report, boolean finalResult) {
        var alternatives = data.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (alternatives == null || alternatives.isEmpty()) return;
        for (String candidate : alternatives) {
            String value = candidate.toLowerCase(Locale.ROOT);
            if (value.contains("lavender bicycle")) set(report, "ttsMarkerRecognized", true);
        }
        if (finalResult) set(report, "expectedUserPhrase",
                alternatives.get(0).replaceAll("[^a-zA-Z ]", "").equalsIgnoreCase("please turn on the light"));
    }

    private void replyIfReady() {
        if (active != null || micReport == null || !asrFinal) return;
        JSONObject report = micReport;
        set(report, "responseRequestMs", Results.elapsedMs(micStarted));
        finishMic("final");
        start("asr-response", (config, run, row) -> tests.asrLine(LabTests.ASR_REPLY, config, run, row));
    }

    private void finishMic(String outcome) {
        var report = micReport;
        micReport = null;
        destroyRecognizer();
        asrFinal = false;
        if (report == null) return;
        set(report, "status", outcome);
        if (!report.has("ttsMarkerRecognized")) set(report, "ttsMarkerRecognized", false);
        saveMic(report);
        controls();
        if (!outcome.equals("final")) status.setText("ASR · " + outcome);
    }

    private void saveMic(JSONObject report) {
        try { results.add(report); }
        catch (Exception error) { status.setText("ASR結果を保存できません · " + error); }
    }

    private void destroyRecognizer() {
        if (recognizer == null) return;
        var current = recognizer;
        recognizer = null;
        current.destroy();
    }

    private void stop(String why) {
        if (micReport != null) finishMic(why);
        if (active == null) return;
        active.stop(why);
        audio.halt(active);
        status.setText("停止処理中");
    }

    @Override protected void onStop() {
        super.onStop();
        if (tests != null) stop("activity-background");
    }

    @Override protected void onDestroy() {
        destroyed = true;
        if (tests != null) {
            stop("activity-destroyed");
            worker.execute(() -> {
                try { tests.close(); } catch (Exception error) { android.util.Log.w("KokoroLab", "Release failed", error); }
            });
        }
        worker.shutdown();
        super.onDestroy();
    }

    private void chooseExport() {
        var intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, "kokoro-p37-pixel-results.json");
        startActivityForResult(intent, EXPORT_JSON);
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != EXPORT_JSON || result != RESULT_OK || data == null || data.getData() == null) return;
        try (var output = getContentResolver().openOutputStream(data.getData(), "wt")) {
            if (output == null) throw new IllegalStateException("保存先を開けません");
            output.write(results.export());
            status.setText("結果JSONを保存しました");
        } catch (Exception error) {
            status.setText("結果を保存できません · " + error);
        }
    }

    private void controls() {
        boolean idle = active == null && micReport == null;
        for (Button button : testButtons) button.setEnabled(idle);
        for (Spinner field : new Spinner[]{precision, threads, provider, character, qualitySample}) field.setEnabled(idle);
        micButton.setEnabled(micReport == null);
        stopButton.setEnabled(!idle);
    }

    private TextView label(LinearLayout body, String text, int size) {
        var view = new TextView(this);
        view.setText(text);
        view.setTextSize(size);
        view.setTextColor(Color.rgb(24, 33, 52));
        view.setPadding(dp(2), dp(6), dp(2), dp(5));
        body.addView(view);
        return view;
    }

    private <T> Spinner spinner(LinearLayout body, String title, T[] options, int selected) {
        label(body, title, 14);
        var view = new Spinner(this);
        view.setContentDescription(title);
        var adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, options);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        view.setAdapter(adapter);
        view.setSelection(selected);
        view.setMinimumHeight(dp(44));
        body.addView(view);
        return view;
    }

    private void test(LinearLayout body, String title, Runnable action) { testButtons.add(button(body, title, action)); }

    private Button button(LinearLayout body, String title, Runnable action) {
        var view = new Button(this);
        view.setText(title);
        view.setAllCaps(false);
        view.setOnClickListener(ignored -> action.run());
        body.addView(view);
        return view;
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private static void set(JSONObject report, String key, Object value) {
        try { report.put(key, value == null ? JSONObject.NULL : value); }
        catch (org.json.JSONException error) { throw new IllegalArgumentException(error); }
    }
}
