package jp.miyatayuuma.kokorop37;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTimestamp;
import android.media.AudioTrack;
import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;

import java.util.concurrent.CancellationException;
import java.util.concurrent.TimeUnit;

final class AudioOutput {
    private static final AudioAttributes SPEECH = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
    private static final int RATE = KokoroEngine.RATE;

    record Playback(long playCall, long firstFrameObserved, long firstAudibleObserved, long endObserved,
                    Long timestampStartEstimate, int underruns, int routeType) {}

    private final Context context;
    private final AudioManager manager;
    private final Object lock = new Object();
    private AudioTrack activeTrack;
    private MediaPlayer activeMedia;
    private LabRun owner;

    AudioOutput(Context context) {
        this.context = context;
        this.manager = context.getSystemService(AudioManager.class);
    }

    boolean halt(LabRun run) {
        synchronized (lock) {
            if (owner != run) return false;
            if (activeTrack != null && activeTrack.getPlayState() == AudioTrack.PLAYSTATE_PLAYING) {
                activeTrack.pause();
                activeTrack.flush();
                return true;
            }
            if (activeMedia != null && activeMedia.isPlaying()) {
                activeMedia.pause();
                return true;
            }
            return false;
        }
    }

    Playback play(short[] pcm, int audibleFrame, LabRun run) throws Exception {
        run.check();
        AudioFocusRequest focus = requestFocus(run);
        AudioTrack track = null;
        try {
            int minimum = AudioTrack.getMinBufferSize(RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
            if (minimum <= 0) throw new IllegalStateException("AudioTrack format unavailable");
            track = new AudioTrack.Builder().setAudioAttributes(SPEECH)
                    .setAudioFormat(new AudioFormat.Builder().setSampleRate(RATE)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                    .setTransferMode(AudioTrack.MODE_STREAM).setBufferSizeInBytes(minimum * 2).build();
            if (track.getState() != AudioTrack.STATE_INITIALIZED) throw new IllegalStateException("AudioTrack initialization failed");
            int written;
            long playCall;
            synchronized (lock) {
                run.check();
                owner = run;
                activeTrack = track;
                written = track.write(pcm, 0, pcm.length, AudioTrack.WRITE_NON_BLOCKING);
                if (written <= 0) throw new IllegalStateException("AudioTrack could not prime PCM: " + written);
                int threshold = Math.min(written, track.getStartThresholdInFrames());
                track.setStartThresholdInFrames(threshold);
                playCall = System.nanoTime();
                track.play();
            }
            AudioTimestamp timestamp = new AudioTimestamp();
            long first = 0;
            long audible = 0;
            Long estimate = null;
            long timeout = playCall + TimeUnit.MILLISECONDS.toNanos(5_000 + pcm.length * 1000L / RATE);
            while (System.nanoTime() < timeout) {
                long frames;
                long now;
                synchronized (lock) {
                    run.check();
                    if (written < pcm.length) {
                        int count = track.write(pcm, written, pcm.length - written, AudioTrack.WRITE_NON_BLOCKING);
                        if (count < 0) throw new IllegalStateException("AudioTrack write: " + count);
                        written += count;
                    }
                    frames = Integer.toUnsignedLong(track.getPlaybackHeadPosition());
                    now = System.nanoTime();
                    if (first == 0 && frames > 0) first = now;
                    if (audible == 0 && frames > audibleFrame) audible = now;
                    if (estimate == null && first != 0 && track.getTimestamp(timestamp) && timestamp.framePosition > 0) {
                        estimate = timestamp.nanoTime - timestamp.framePosition * 1_000_000_000L / RATE;
                    }
                    if (frames >= pcm.length) {
                        var route = track.getRoutedDevice();
                        return new Playback(playCall, first, audible, now, estimate, track.getUnderrunCount(),
                                route == null ? -1 : route.getType());
                    }
                }
                Thread.sleep(4);
            }
            throw new IllegalStateException("AudioTrack playback head timed out");
        } finally {
            synchronized (lock) {
                owner = null;
                activeTrack = null;
                if (track != null) track.release();
            }
            manager.abandonAudioFocusRequest(focus);
        }
    }

    void reference(String asset, LabRun run) throws Exception {
        AudioFocusRequest focus = requestFocus(run);
        MediaPlayer player = new MediaPlayer();
        try (AssetFileDescriptor fd = context.getAssets().openFd(asset)) {
            player.setAudioAttributes(SPEECH);
            player.setDataSource(fd.getFileDescriptor(), fd.getStartOffset(), fd.getLength());
            player.prepare();
            synchronized (lock) {
                run.check();
                owner = run;
                activeMedia = player;
                player.start();
            }
            try {
                long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(player.getDuration() + 5_000L);
                while (System.nanoTime() < deadline) {
                    synchronized (lock) {
                        run.check();
                        if (!player.isPlaying()) return;
                    }
                    Thread.sleep(20);
                }
                throw new IllegalStateException("Reference playback timed out");
            } finally {
                synchronized (lock) {
                    owner = null;
                    activeMedia = null;
                }
            }
        } finally {
            player.release();
            manager.abandonAudioFocusRequest(focus);
        }
    }

    private AudioFocusRequest requestFocus(LabRun run) {
        run.check();
        var focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(SPEECH)
                .setOnAudioFocusChangeListener(change -> {
                    if (change < 0 && run.stop("audio-focus-loss")) halt(run);
                }, new Handler(Looper.getMainLooper()))
                .build();
        if (manager.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            throw new CancellationException("audio-focus-denied");
        }
        return focus;
    }
}
