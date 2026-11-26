package jp.miyatayuuma.kokorop37;

import java.util.concurrent.CancellationException;
import java.util.concurrent.atomic.AtomicReference;

final class LabRun {
    private final AtomicReference<String> stopped = new AtomicReference<>();

    boolean stop(String why) { return stopped.compareAndSet(null, why); }
    String reason() { return stopped.get(); }
    boolean stopped() { return reason() != null; }
    void check() {
        if (stopped() || Thread.currentThread().isInterrupted()) throw new CancellationException(reason());
    }
}
