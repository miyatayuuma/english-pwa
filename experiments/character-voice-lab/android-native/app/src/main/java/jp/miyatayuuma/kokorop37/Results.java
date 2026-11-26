package jp.miyatayuuma.kokorop37;

import android.content.Context;
import android.os.Build;
import android.os.Debug;
import android.os.PowerManager;
import android.util.AtomicFile;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;

final class Results {
    private final JSONObject data;
    private final AtomicFile file;
    private final JSONArray runs;

    Results(Context context, LabAssets assets) throws Exception {
        file = new AtomicFile(context.getNoBackupFilesDir().toPath().resolve("kokoro-p37-results.json").toFile());
        // Preserve earlier runs when the Activity or app is restarted.
        JSONArray saved = new JSONArray();
        if (file.getBaseFile().exists()) {
            JSONObject previous = new JSONObject(new String(file.readFully(), StandardCharsets.UTF_8));
            if (previous.optInt("schema") == 1 && assets.revision().equals(previous.optString("modelRevision"))) {
                saved = previous.getJSONArray("runs");
            }
        }
        runs = saved;
        data = object("schema", 1, "experiment", "English PWA P3.7",
                "device", object("manufacturer", Build.MANUFACTURER, "model", Build.MODEL, "sdk", Build.VERSION.SDK_INT,
                        "release", Build.VERSION.RELEASE, "abis", new JSONArray(Build.SUPPORTED_ABIS)),
                "modelRevision", assets.revision(), "profileVersion", assets.profileVersion,
                "provenance", assets.runtime, "runs", runs);
    }

    synchronized void add(JSONObject run) throws Exception {
        runs.put(run);
        FileOutputStream stream = null;
        try {
            stream = file.startWrite();
            stream.write(data.toString(2).getBytes(StandardCharsets.UTF_8));
            file.finishWrite(stream);
        } catch (Exception error) {
            if (stream != null) file.failWrite(stream);
            runs.remove(runs.length() - 1);
            throw error;
        }
    }

    synchronized byte[] export() throws Exception {
        return data.toString(2).getBytes(StandardCharsets.UTF_8);
    }

    static JSONObject object(Object... pairs) {
        try {
            JSONObject result = new JSONObject();
            for (int i = 0; i < pairs.length; i += 2) result.put((String) pairs[i],
                    pairs[i + 1] == null ? JSONObject.NULL : pairs[i + 1]);
            return result;
        } catch (JSONException error) {
            throw new IllegalArgumentException(error);
        }
    }

    static JSONObject deviceSample(Context context, long start) {
        var memory = new Debug.MemoryInfo();
        Debug.getMemoryInfo(memory);
        PowerManager power = context.getSystemService(PowerManager.class);
        return object("elapsedMs", elapsedMs(start), "pssKiB", memory.getTotalPss(),
                "nativePssKiB", memory.nativePss, "thermalStatus", power.getCurrentThermalStatus());
    }

    static JSONObject summarize(JSONArray rows) {
        return object("requestToFirstFrameMs", distribution(rows, "requestToFirstFrameMs"),
                "requestToFirstAudibleWindowMs", distribution(rows, "requestToFirstAudibleWindowMs"),
                "rtf", distribution(rows, "rtf"), "gapMs", distribution(rows, "previousAudioGapMs"));
    }

    private static Object distribution(JSONArray rows, String key) {
        ArrayList<Double> values = new ArrayList<>();
        for (int index = 0; index < rows.length(); index++) {
            JSONObject row = rows.optJSONObject(index);
            if (row != null && !row.optBoolean("warmup") && !row.isNull(key)) values.add(row.optDouble(key));
        }
        if (values.isEmpty()) return null;
        Collections.sort(values);
        return object("count", values.size(), "p50", values.get((values.size() - 1) / 2),
                "p95", values.get((int) Math.ceil(values.size() * .95) - 1), "max", values.get(values.size() - 1));
    }

    static String timestamp() { return Instant.now().toString(); }
    static double elapsedMs(long start) { return milliseconds(System.nanoTime() - start); }
    static double milliseconds(long nanos) { return nanos / 1_000_000.0; }
}
