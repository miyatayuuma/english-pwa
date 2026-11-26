package jp.miyatayuuma.kokorop37;

import java.nio.FloatBuffer;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CancellationException;
import java.util.regex.Pattern;

public class HostChecks {
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        var buffer = new StreamBuffer();
        var chunks = new ArrayList<String>();
        var words = Pattern.compile("\\S+\\s*")
                .matcher("Let's ask Dr. Moss. She was here at 3.15, just before the rain started.");
        while (words.find()) chunks.addAll(buffer.push(words.group(), false));
        chunks.addAll(buffer.push("", true));
        check(chunks.equals(List.of("Let's ask Dr. Moss.", "She was here at 3.15, just before the rain started.")), "stream boundary");
        String longText = ("Little boats passed the gate, and the clouds came along ").repeat(8).strip();
        chunks.clear();
        chunks.addAll(buffer.push(longText, true));
        check(chunks.stream().allMatch(chunk -> chunk.length() <= 155), "phrase limit");
        check(String.join(" ", chunks).equals(longText), "phrase preservation");

        float[] waveform = new float[24_000];
        java.util.Arrays.fill(waveform, 2_400, 4_800, .25f);
        waveform[2_400] = 1.1f;
        var audio = Pcm.process(FloatBuffer.wrap(waveform));
        check(audio.leadingQuietFrames() == 1_680 && audio.clipped() == 1, "PCM silence and clipping");
        check(audio.samples().length == 6_720 && audio.rawSeconds() == 1, "PCM duration");
        try {
            Pcm.process(FloatBuffer.wrap(new float[240]));
            throw new AssertionError("silent PCM accepted");
        } catch (IllegalStateException expected) {}
        var run = new LabRun();
        check(run.stop("mic") && !run.stop("late"), "first cancellation reason");
        try {
            run.check();
            throw new AssertionError("cancelled generation allowed");
        } catch (CancellationException error) {
            check(error.getMessage().equals("mic"), "cancelled generation reason");
        }
        System.out.println("P3.7 host checks passed");
    }
}
