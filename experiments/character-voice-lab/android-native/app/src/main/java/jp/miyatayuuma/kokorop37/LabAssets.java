package jp.miyatayuuma.kokorop37;

import android.content.Context;
import android.content.res.AssetManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

import javax.net.ssl.HttpsURLConnection;

final class LabAssets {
    record Voice(String id, String name, String voiceId, String accent, float speed) {
        JSONObject json() {
            return Results.object("characterId", id, "voiceId", voiceId, "accent", accent, "speed", speed);
        }
        @Override public String toString() { return name + " · " + voiceId; }
    }

    final Map<String, Voice> voices = new LinkedHashMap<>();
    final Map<String, JSONObject> corpus = new LinkedHashMap<>();
    final JSONObject runtime;
    final JSONObject references;
    final JSONObject scenarios;
    final String profileVersion;
    private final AssetManager assets;
    private final Path directory;
    private final Set<String> verified = new HashSet<>();

    LabAssets(Context context) throws Exception {
        assets = context.getAssets();
        directory = context.getNoBackupFilesDir().toPath().resolve("kokoro-p37");
        runtime = json("runtime.json");
        JSONObject profiles = json("profiles.json");
        profileVersion = profiles.getString("version");
        JSONArray entries = profiles.getJSONArray("voices");
        for (int index = 0; index < entries.length(); index++) {
            JSONObject voice = entries.getJSONObject(index);
            String id = voice.getString("id");
            voices.put(id, new Voice(id, voice.optString("name", id), voice.getString("voice"),
                    voice.getString("accent"), (float) voice.getDouble("speed")));
        }
        if (voices.size() != 20 || !profileVersion.equals(runtime.getString("profileVersion"))) {
            throw new IllegalStateException("Voice profile mismatch");
        }
        entries = json("corpus.json").getJSONArray("utterances");
        for (int index = 0; index < entries.length(); index++) {
            JSONObject entry = entries.getJSONObject(index);
            corpus.put(entry.getString("id"), entry);
        }
        references = json("references.json");
        scenarios = json("scenarios.json");
    }

    private JSONObject json(String name) throws Exception {
        try (InputStream input = assets.open(name)) {
            return new JSONObject(new String(input.readAllBytes(), StandardCharsets.UTF_8));
        }
    }

    String revision() { return runtime.optString("revision"); }

    Path prepareData(LabRun run) throws Exception {
        JSONObject metadata = runtime.getJSONObject("phonemizer");
        Path parent = directory.resolve(metadata.getString("revision"));
        JSONObject files = metadata.getJSONObject("files");
        for (var iterator = files.keys(); iterator.hasNext();) {
            String name = iterator.next();
            ensure(parent.resolve(name), files.getString(name), run, () -> assets.open(name), progress -> {});
        }
        return parent;
    }

    void prepareModel(String precision, LabRun run, Consumer<String> progress) throws Exception {
        model(precision, run, progress);
        fetch("tokenizer.json", run, progress);
        for (Voice voice : voices.values()) fetch("voices/" + voice.voiceId + ".bin", run, progress);
    }

    Path model(String precision, LabRun run, Consumer<String> progress) throws Exception {
        return fetch("onnx/" + runtime.getJSONObject("weights").getString(precision), run, progress);
    }

    Path fetch(String name, LabRun run, Consumer<String> progress) throws Exception {
        String model = runtime.getString("model");
        String sha = runtime.getJSONObject("downloads").getString(name);
        String source = "https://huggingface.co/" + model + "/resolve/" + revision() + "/" + name + "?download=true";
        return ensure(directory.resolve(revision()).resolve(name), sha, run, () -> {
            HttpsURLConnection connection = (HttpsURLConnection) new URL(source).openConnection();
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(15_000);
            connection.setInstanceFollowRedirects(true);
            try {
                InputStream stream = connection.getInputStream();
                return new java.io.FilterInputStream(stream) {
                    @Override public void close() throws java.io.IOException {
                        try { super.close(); } finally { connection.disconnect(); }
                    }
                };
            } catch (Exception error) {
                connection.disconnect();
                throw error;
            }
        }, progress);
    }

    private interface Open { InputStream open() throws Exception; }

    private Path ensure(Path path, String expected, LabRun run, Open open, Consumer<String> progress) throws Exception {
        run.check();
        String key = path.toString();
        if (verified.contains(key) && Files.isRegularFile(path)) return path;
        if (Files.isRegularFile(path)) {
            try (InputStream input = Files.newInputStream(path)) {
                if (expected.equals(transfer(input, OutputStream.nullOutputStream(), run, key, progress))) {
                    verified.add(key);
                    return path;
                }
            }
        }
        Files.createDirectories(path.getParent());
        Path partial = Files.createTempFile(path.getParent(), ".download-", ".partial");
        try {
            progress.accept(path.getFileName() + " を準備中");
            try (InputStream input = open.open(); OutputStream output = Files.newOutputStream(partial)) {
                if (!expected.equals(transfer(input, output, run, path.getFileName().toString(), progress))) {
                    throw new IllegalStateException("SHA-256 mismatch: " + path.getFileName());
                }
            }
            run.check();
            Files.move(partial, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            verified.add(key);
            return path;
        } finally {
            Files.deleteIfExists(partial);
        }
    }

    private static String transfer(InputStream input, OutputStream output, LabRun run, String name,
                                   Consumer<String> progress) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[64 * 1024];
        long count = 0;
        for (int size; (size = input.read(buffer)) >= 0;) {
            run.check();
            output.write(buffer, 0, size);
            digest.update(buffer, 0, size);
            long next = count + size;
            if (count / 8_388_608 != next / 8_388_608) progress.accept(name + " · " + (next / 1_048_576) + " MiB");
            count = next;
        }
        StringBuilder hex = new StringBuilder();
        for (byte value : digest.digest()) {
            hex.append(Character.forDigit((value >> 4) & 15, 16)).append(Character.forDigit(value & 15, 16));
        }
        return hex.toString();
    }
}
