package jp.miyatayuuma.kokorop37;

import java.nio.FloatBuffer;

final class Pcm {
    record Audio(short[] samples, double rawSeconds, int leadingQuietFrames, int clipped) {}

    static Audio process(FloatBuffer waveform) {
        int length = waveform.remaining();
        if (length == 0) throw new IllegalStateException("Empty waveform");
        int window = 240; // 10 ms at 24 kHz.
        int first = -1;
        int last = -1;
        for (int offset = 0; offset < length; offset += window) {
            double energy = 0;
            int end = Math.min(length, offset + window);
            for (int frame = offset; frame < end; frame++) {
                float value = waveform.get(frame);
                if (!Float.isFinite(value)) throw new IllegalStateException("Nonfinite waveform");
                energy += value * value;
            }
            if (energy / window > .00001) {
                if (first == -1) first = offset;
                last = end;
            }
        }
        if (first < 0) throw new IllegalStateException("Silent waveform");
        int from = Math.max(0, first - 7 * window);
        int to = Math.min(length, last + 11 * window);
        short[] pcm = new short[to - from];
        int clipped = 0;
        for (int frame = from; frame < to; frame++) {
            float value = waveform.get(frame);
            if (Math.abs(value) >= 1) clipped++;
            pcm[frame - from] = (short) Math.round(Math.max(-1, Math.min(1, value)) * 32767);
        }
        return new Audio(pcm, length / 24000.0, first - from, clipped);
    }
}
