package org.opentriage.development;

import java.util.concurrent.Executor;
import java.util.function.BooleanSupplier;

/** Serializes reply delivery with destruction of the owning JavaScript realm. */
final class NativeReplyGate {
    private final Executor ui;
    private final BooleanSupplier onUi;
    private final BooleanSupplier currentRealm;
    // Read and written exclusively on UI, including the check immediately before delivery.
    private boolean closed;
    NativeReplyGate(Executor ui, BooleanSupplier onUi, BooleanSupplier currentRealm) {
        this.ui = ui; this.onUi = onUi; this.currentRealm = currentRealm;
    }
    void dispatch(Runnable delivery, Runnable discarded) {
        Runnable task = () -> {
            requireUi();
            if (closed || !currentRealm.getAsBoolean()) discarded.run();
            else delivery.run();
        };
        if (onUi.getAsBoolean()) task.run(); else ui.execute(task);
    }
    void close() { requireUi(); closed = true; }
    private void requireUi() {
        if (!onUi.getAsBoolean()) throw new IllegalStateException("Native replies require the UI thread");
    }
}
