package jp.miyatayuuma.kokorop37;

import android.content.Context;
import android.os.PowerManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.regex.Pattern;

final class LabTests implements AutoCloseable {
    static final String ASR_PROMPT = "Please turn on the light.";
    static final String ASR_REPLY = "All right. I heard you.";
    private static final Pattern WORD = Pattern.compile("\\S+\\s*");
    private static final long TEN_MINUTES = TimeUnit.MINUTES.toNanos(10);
    private static final int[] THREADS = {1, 2, 4, 8};

    private record Utterance(String speaker, String text, String phonemes, long requested, boolean warmup) {}
    private record Pending(Future<AudioOutput.Playback> playback, Utterance line, KokoroEngine.Output pcm,
                           long synthesisStarted, long enqueued) {}
    private static final Utterance END = new Utterance("", "", null, 0, false);

    private final Context context;
    private final LabAssets assets;
    private final AudioOutput audio;
    private final Consumer<String> progress;
    private final ExecutorService playback = Executors.newSingleThreadExecutor();
    private final ExecutorService stream = Executors.newSingleThreadExecutor();
    private KokoroEngine engine;

    LabTests(Context context, LabAssets assets, AudioOutput audio, Consumer<String> progress) {
        this.context = context;
        this.assets = assets;
        this.audio = audio;
        this.progress = progress;
    }

    void warmEngine(KokoroEngine.Config config, LabRun run, JSONObject report) throws Exception {
        if (engine != null && engine.config.equals(config)) {
            report.put("sessionReused", true);
            report.put("modelLoadMs", JSONObject.NULL);
            return;
        }
        releaseEngine();
        long started = System.nanoTime();
        assets.prepareModel(config.precision(), run, progress);
        var data = assets.prepareData(run);
        var model = assets.model(config.precision(), run, progress);
        var tokenizer = assets.fetch("tokenizer.json", run, progress);
        report.put("assetPreparationMs", Results.elapsedMs(started));
        run.check();
        started = System.nanoTime();
        var loaded = new KokoroEngine(config, model, tokenizer, data);
        try {
            report.put("modelLoadMs", loaded.modelLoadMs);
            report.put("sessionReused", false);
            report.put("tokenizerPhonemizerAndSessionMs", Results.elapsedMs(started));
            started = System.nanoTime();
            loaded.preload(assets, run);
            report.put("voiceLoadMs", Results.elapsedMs(started));
            engine = loaded;
        } finally {
            if (engine != loaded) loaded.close();
        }
    }

    void measure(String type, KokoroEngine.Config config, LabRun run, JSONObject report) throws Exception {
        var rows = new JSONArray();
        var samples = new JSONArray();
        report.put("measurements", rows);
        report.put("resources", samples);
        long start = System.nanoTime();
        samples.put(Results.deviceSample(context, start));
        try {
            warmEngine(config, run, report);
            JSONObject shortLine = assets.scenarios.getJSONArray("short").getJSONObject(0);
            String speaker = shortLine.getString("speaker");
            String text = shortLine.getString("text");
            measureOne(new Utterance(speaker, text, null, System.nanoTime(), true), rows, run);
            samples.put(Results.deviceSample(context, start));
            switch (type) {
                case "short" -> {
                    for (int index = 0; index < 5; index++) {
                        progress.accept("短文 " + (index + 1) + " / 5");
                        measureOne(new Utterance(speaker, text, null, System.nanoTime(), false), rows, run);
                    }
                }
                case "dialogue" -> {
                    dialogue(rows, samples, run, start, false, report);
                    measureOne(new Utterance("jennifer", assets.corpus.get("long").getString("text"),
                            null, System.nanoTime(), false), rows, run);
                }
                case "endurance" -> dialogue(rows, samples, run, start, true, report);
                default -> throw new IllegalArgumentException("Unknown test type " + type);
            }
        } finally {
            samples.put(Results.deviceSample(context, start));
            report.put("summary", Results.summarize(rows));
            report.put("wallMs", Results.elapsedMs(start));
        }
    }

    void compareSettings(LabRun run, JSONObject report) throws Exception {
        var matrix = new JSONArray();
        report.put("configurations", matrix);
        var settings = new ArrayList<KokoroEngine.Config>();
        for (String precision : List.of("q8", "fp32")) {
            for (int threads : THREADS) settings.add(new KokoroEngine.Config(precision, threads, false));
        }
        settings.add(new KokoroEngine.Config("fp32", 4, true));
        for (KokoroEngine.Config config : settings) {
            run.check();
            var row = Results.object("config", config.json());
            matrix.put(row);
            try {
                measure("short", config, run, row);
                row.put("status", "completed");
            } catch (UnsupportedOperationException error) {
                row.put("status", "unsupported");
                row.put("error", error.getMessage());
            } catch (CancellationException error) {
                row.put("status", "cancelled");
                throw error;
            } catch (Exception | LinkageError error) {
                row.put("status", "error");
                row.put("error", error.toString());
            }
        }
    }

    void quality(KokoroEngine.Config config, String speaker, String line, LabRun run, JSONObject report) throws Exception {
        var clip = assets.references.getJSONObject(speaker + "/" + line);
        report.put("reference", clip);
        var rows = new JSONArray();
        report.put("measurements", rows);
        warmEngine(config, run, report);
        progress.accept("A · P3.5の事前生成");
        waitFor(playback.submit(() -> { audio.reference(clip.getString("asset"), run); return null; }));
        progress.accept("B · Pixel上で端末内生成");
        String specified = assets.corpus.get(line).optString("kokoroPhonemes", null);
        measureOne(new Utterance(speaker, clip.getString("text"), specified, System.nanoTime(), false), rows, run);
        var automatic = rows.getJSONObject(0);
        String reference = clip.getString("phonemes");
        report.put("automaticOrCuratedMatchesReferencePhonemes", reference.equals(automatic.getString("modelPhonemes")));
        progress.accept("C · 事前生成と同じ音素列で端末内生成");
        measureOne(new Utterance(speaker, clip.getString("text"), reference, System.nanoTime(), false), rows, run);
    }

    void asrLine(String text, KokoroEngine.Config config, LabRun run, JSONObject report) throws Exception {
        var rows = new JSONArray();
        report.put("measurements", rows);
        warmEngine(config, run, report);
        measureOne(new Utterance("jennifer", text, null, System.nanoTime(), false), rows, run);
    }

    private void dialogue(JSONArray rows, JSONArray samples, LabRun run, long start, boolean endurance,
                          JSONObject report) throws Exception {
        JSONArray turns = assets.scenarios.getJSONArray("dialogue");
        var queue = new ArrayBlockingQueue<Utterance>(3);
        long begun = System.nanoTime();
        long deadline = begun + TEN_MINUTES;
        var producer = stream.submit(() -> {
            while (true) {
                for (int turn = 0; turn < turns.length(); turn++) {
                    run.check();
                    if (endurance && System.nanoTime() >= deadline) {
                        queue.put(END);
                        return null;
                    }
                    JSONObject line = turns.getJSONObject(turn);
                    String speaker = line.getString("speaker");
                    var buffer = new StreamBuffer();
                    var words = WORD.matcher(line.getString("text"));
                    while (words.find()) {
                        Thread.sleep(45);
                        run.check();
                        for (String chunk : buffer.push(words.group(), false)) {
                            queue.put(new Utterance(speaker, chunk, null, System.nanoTime(), false));
                        }
                    }
                    for (String chunk : buffer.push("", true)) {
                        queue.put(new Utterance(speaker, chunk, null, System.nanoTime(), false));
                    }
                }
                if (!endurance) {
                    queue.put(END);
                    return null;
                }
            }
        });

        Pending pending = null;
        AudioOutput.Playback previous = null;
        long sampledAt = start;
        int before = rows.length();
        try {
            while (true) {
                run.check();
                if (System.nanoTime() - sampledAt > TimeUnit.SECONDS.toNanos(10)) {
                    sampledAt = System.nanoTime();
                    var sample = Results.deviceSample(context, start);
                    samples.put(sample);
                    if (sample.getInt("thermalStatus") >= PowerManager.THERMAL_STATUS_SEVERE) {
                        run.stop("thermal-severe");
                        audio.halt(run);
                        run.check();
                    }
                }
                Utterance line = queue.poll(50, TimeUnit.MILLISECONDS);
                if (line == null) {
                    if (producer.isDone()) waitFor(producer);
                    continue;
                }
                if (line == END) break;
                long synthStart = System.nanoTime();
                var pcm = engine.synthesize(line.text, line.phonemes, assets.voices.get(line.speaker), run);
                if (pending != null) previous = finish(pending, previous, rows);
                pending = enqueue(line, pcm, synthStart, run);
                progress.accept("会話 · " + (rows.length() - before + 1) + "発話 · "
                        + Math.round(Results.elapsedMs(begun) / 1000) + " 秒");
            }
            if (pending != null) finish(pending, previous, rows);
            waitFor(producer);
        } finally {
            producer.cancel(true);
            report.put("conversationWallMs", Results.elapsedMs(begun));
            report.put("conversationCompletedUtterances", rows.length() - before);
        }
    }

    private void measureOne(Utterance line, JSONArray rows, LabRun run) throws Exception {
        long start = System.nanoTime();
        var pcm = engine.synthesize(line.text, line.phonemes, assets.voices.get(line.speaker), run);
        finish(enqueue(line, pcm, start, run), null, rows);
    }

    private Pending enqueue(Utterance line, KokoroEngine.Output pcm, long start, LabRun run) {
        long enqueued = System.nanoTime();
        var playing = playback.submit(() -> audio.play(pcm.pcm(), pcm.leadingQuietFrames(), run));
        return new Pending(playing, line, pcm, start, enqueued);
    }

    private AudioOutput.Playback finish(Pending pending, AudioOutput.Playback previous, JSONArray rows) throws Exception {
        AudioOutput.Playback played;
        try {
            played = waitFor(pending.playback);
        } catch (CancellationException error) {
            rows.put(measurement(pending, null, previous));
            throw error;
        }
        rows.put(measurement(pending, played, previous));
        return played;
    }

    private JSONObject measurement(Pending pending, AudioOutput.Playback played, AudioOutput.Playback previous) {
        var line = pending.line;
        var pcm = pending.pcm;
        long requested = line.requested;
        return Results.object("sample", line.text, "warmup", line.warmup,
                "character", assets.voices.get(line.speaker).json(),
                "phonemeSource", line.phonemes == null ? "espeak-ng" : "specified",
                "phonemes", pcm.phonemes(), "modelPhonemes", pcm.modelPhonemes(), "tokenCount", pcm.tokenCount(),
                "phonemeMs", pcm.phonemeMs(), "ortInputAndRunMs", pcm.inferenceMs(), "pcmMs", pcm.pcmMs(),
                "rawSeconds", pcm.rawSeconds(), "audioSeconds", pcm.seconds(),
                "leadingQuietMs", pcm.leadingQuietFrames() * 1000.0 / KokoroEngine.RATE, "rtf", pcm.rtf(),
                "clippedSamples", pcm.clipped(), "synthesisQueueMs", difference(pending.synthesisStarted, requested),
                "requestToEnqueueMs", difference(pending.enqueued, requested),
                "requestToPlayCallMs", played == null ? null : difference(played.playCall(), requested),
                "requestToFirstFrameMs", played == null ? null : difference(played.firstFrameObserved(), requested),
                "requestToFirstAudibleWindowMs", played == null ? null : difference(played.firstAudibleObserved(), requested),
                "requestToTimestampStartEstimateMs", played == null || played.timestampStartEstimate() == null
                        ? null : difference(played.timestampStartEstimate(), requested),
                "previousAudioGapMs", played == null || previous == null ? null
                        : difference(played.firstFrameObserved(), previous.endObserved()),
                "synthesisStartedBeforePreviousAudioEnd", previous == null ? null : pending.synthesisStarted < previous.endObserved(),
                "audioTrackUnderruns", played == null ? null : played.underruns(),
                "routeType", played == null ? null : played.routeType(),
                "playback", played == null ? "cancelled" : "completed");
    }

    private static Double difference(long end, long start) {
        return end == 0 ? null : Results.milliseconds(end - start);
    }

    private static <T> T waitFor(Future<T> future) throws Exception {
        try { return future.get(); }
        catch (java.util.concurrent.ExecutionException error) {
            if (error.getCause() instanceof Exception cause) throw cause;
            if (error.getCause() instanceof Error cause) throw cause;
            throw error;
        }
    }

    private void releaseEngine() throws Exception {
        var loaded = engine;
        engine = null;
        if (loaded != null) loaded.close();
    }

    @Override public void close() throws Exception {
        stream.shutdownNow();
        playback.shutdown();
        releaseEngine();
    }
}
