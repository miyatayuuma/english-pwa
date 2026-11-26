package jp.miyatayuuma.kokorop37;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtProvider;
import ai.onnxruntime.OrtSession;
import ai.onnxruntime.TensorInfo;

import org.json.JSONObject;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.nio.LongBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

final class KokoroEngine implements AutoCloseable {
    static final int RATE = 24_000;
    static final int STYLE_COLUMNS = 256;
    static final int STYLE_ROWS = 510;

    record Config(String precision, int threads, boolean xnnpack) {
        JSONObject json() {
            return Results.object("precision", precision, "threads", threads, "interOpThreads", 1,
                    "backendRequested", xnnpack ? "XNNPACK+CPU" : "CPU", "graphOptimization", "ALL_OPT");
        }
    }

    record Output(short[] pcm, String phonemes, String modelPhonemes, int tokenCount,
                  double phonemeMs, double inferenceMs, double pcmMs,
                  double rawSeconds, double seconds, int leadingQuietFrames, int clipped) {
        double rtf() { return (phonemeMs + inferenceMs + pcmMs) / 1000 / seconds; }
    }

    private final OrtEnvironment env = OrtEnvironment.getEnvironment();
    private final OrtSession.SessionOptions options;
    private final OrtSession session;
    private final String tokenInput;
    private final Phonemizer phonemizer;
    private final Map<Integer, Integer> vocab = new HashMap<>();
    private final Map<String, float[]> styles = new HashMap<>();
    final Config config;
    final double modelLoadMs;

    KokoroEngine(Config config, Path model, Path tokenizer, Path data) throws Exception {
        this.config = config;
        phonemizer = new Phonemizer(data);
        JSONObject symbols = new JSONObject(Files.readString(tokenizer, StandardCharsets.UTF_8))
                .getJSONObject("model").getJSONObject("vocab");
        for (var keys = symbols.keys(); keys.hasNext();) {
            String symbol = keys.next();
            if (symbol.codePointCount(0, symbol.length()) == 1) vocab.put(symbol.codePointAt(0), symbols.getInt(symbol));
        }
        if (vocab.getOrDefault((int) '$', -1) != 0 || !vocab.containsKey((int) ' ')) {
            throw new IllegalStateException("Unexpected Kokoro vocabulary");
        }
        if (config.xnnpack && !OrtEnvironment.getAvailableProviders().contains(OrtProvider.XNNPACK)) {
            throw new UnsupportedOperationException("XNNPACK is unavailable in this ONNX Runtime build");
        }
        options = new OrtSession.SessionOptions();
        OrtSession loaded = null;
        try {
            env.setTelemetry(false);
            options.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
            options.setInterOpNumThreads(1);
            options.setIntraOpNumThreads(config.xnnpack ? 1 : config.threads);
            if (config.xnnpack) {
                options.addConfigEntry("session.intra_op.allow_spinning", "0");
                options.addXnnpack(Map.of("intra_op_num_threads", Integer.toString(config.threads)));
            }
            long start = System.nanoTime();
            loaded = env.createSession(model.toString(), options);
            modelLoadMs = Results.elapsedMs(start);
            tokenInput = loaded.getInputNames().contains("input_ids") ? "input_ids" : "tokens";
            verifyContract(loaded);
            session = loaded;
        } catch (Exception | LinkageError error) {
            if (loaded != null) loaded.close();
            options.close();
            throw error;
        }
    }

    private void verifyContract(OrtSession graph) throws Exception {
        var input = graph.getInputInfo();
        TensorInfo ids = (TensorInfo) input.get(tokenInput).getInfo();
        TensorInfo style = (TensorInfo) input.get("style").getInfo();
        TensorInfo speed = (TensorInfo) input.get("speed").getInfo();
        if (!ids.type.name().equals("INT64") || !style.type.name().equals("FLOAT")
                || !speed.type.name().equals("FLOAT") || !graph.getOutputNames().contains("waveform")) {
            throw new IllegalStateException("Unexpected Kokoro graph interface: " + input);
        }
    }

    void preload(LabAssets assets, LabRun run) throws Exception {
        for (LabAssets.Voice voice : assets.voices.values()) {
            if (styles.containsKey(voice.voiceId())) continue;
            byte[] bytes = Files.readAllBytes(assets.fetch("voices/" + voice.voiceId() + ".bin", run, ignored -> {}));
            if (bytes.length != STYLE_ROWS * STYLE_COLUMNS * Float.BYTES) throw new IllegalStateException("Bad voice shape");
            float[] style = new float[STYLE_ROWS * STYLE_COLUMNS];
            ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().get(style);
            styles.put(voice.voiceId(), style);
        }
    }

    Output synthesize(String text, String override, LabAssets.Voice voice, LabRun run) throws Exception {
        run.check();
        long start = System.nanoTime();
        String phonemes = override != null ? override : phonemizer.convert(text, voice.accent());
        var symbols = phonemes.codePoints().filter(cp -> cp != '$' && vocab.containsKey(cp)).toArray();
        if (symbols.length < 1 || symbols.length > STYLE_ROWS) {
            throw new IllegalArgumentException("Kokoro accepts 1–510 phonemes per request");
        }
        String modelPhonemes = new String(symbols, 0, symbols.length);
        long[] ids = new long[symbols.length + 2]; // BOS and EOS both use id 0.
        for (int i = 0; i < symbols.length; i++) ids[i + 1] = vocab.get(symbols[i]);
        double phonemeMs = Results.elapsedMs(start);
        int styleOffset = (symbols.length - 1) * STYLE_COLUMNS;
        FloatBuffer style = FloatBuffer.wrap(styles.get(voice.voiceId()), styleOffset, STYLE_COLUMNS);
        start = System.nanoTime();
        FloatBuffer samples;
        double inferenceMs;
        try (OnnxTensor tokens = OnnxTensor.createTensor(env, LongBuffer.wrap(ids), new long[]{1, ids.length});
             OnnxTensor speaker = OnnxTensor.createTensor(env, style, new long[]{1, STYLE_COLUMNS});
             OnnxTensor speed = OnnxTensor.createTensor(env, FloatBuffer.wrap(new float[]{voice.speed()}), new long[]{1});
             OrtSession.Result output = session.run(Map.of(tokenInput, tokens, "style", speaker, "speed", speed))) {
            inferenceMs = Results.elapsedMs(start);
            start = System.nanoTime();
            samples = ((OnnxTensor) output.get("waveform").orElseThrow()).getFloatBuffer();
        }
        run.check();
        Pcm.Audio audio = Pcm.process(samples);
        return new Output(audio.samples(), phonemes, modelPhonemes, symbols.length, phonemeMs, inferenceMs,
                Results.elapsedMs(start), audio.rawSeconds(), audio.samples().length / (double) RATE,
                audio.leadingQuietFrames(), audio.clipped());
    }

    @Override public void close() throws Exception {
        try { session.close(); } finally { options.close(); }
    }
}
