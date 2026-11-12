package org.opentriage.development;

import java.util.function.LongSupplier;

/** Test-only route readiness. Never sends HTTP, TLS or application credentials. */
final class TransportReadiness {
    static final long TIMEOUT_MS = 45_000;
    static final int CONNECT_TIMEOUT_MS = 250;
    static final int POLL_MS = 100;
    record Sample(Boolean browserOnline, boolean activeInternet, boolean reachable,
                  String networkState, String ioClass, String ioMessage) {}
    @FunctionalInterface interface Probe { Sample read(int connectTimeoutMs) throws Exception; }
    @FunctionalInterface interface Pause { void sleep(long milliseconds) throws InterruptedException; }

    static Sample await(boolean expected, Probe probe, LongSupplier clock, Pause pause,
                        long timeoutMs) throws Exception {
        if (timeoutMs <= 0 || timeoutMs > TIMEOUT_MS) throw new IllegalArgumentException("Invalid fixture readiness deadline");
        long started = clock.getAsLong();
        int attempts = 0;
        Sample last = null;
        String lastIoClass = "none", lastIoMessage = "none";
        while (clock.getAsLong() - started < timeoutMs) {
            long remaining = timeoutMs - (clock.getAsLong() - started);
            if (remaining <= 0) break;
            last = probe.read((int)Math.min(CONNECT_TIMEOUT_MS, remaining));
            attempts++;
            if (last.ioClass() != null) {
                lastIoClass = bounded(last.ioClass(), 100);
                lastIoMessage = bounded(last.ioMessage(), 256);
            }
            long elapsed = clock.getAsLong() - started;
            if (elapsed >= timeoutMs) break;
            boolean browserMatches = last.browserOnline() == null || last.browserOnline() == expected;
            if (browserMatches && last.reachable() == expected && (!expected || last.activeInternet())) return last;
            pause.sleep(Math.min(POLL_MS, timeoutMs - elapsed));
        }
        throw new AssertionError("Fixture transport did not become " + (expected ? "online" : "offline") +
            " within " + timeoutMs + "ms; attempts=" + attempts + "; browserOnline=" +
            (last == null ? "unobserved" : last.browserOnline()) + "; reachable=" +
            (last == null ? "unobserved" : last.reachable()) + "; network=" +
            bounded(last == null ? "unobserved" : last.networkState(), 256) +
            "; lastIO=" + lastIoClass + ": " + lastIoMessage);
    }
    private static String bounded(String value, int length) {
        if (value == null) return "none";
        String singleLine = value.replaceAll("[\r\n\t]", " ");
        return singleLine.substring(0, Math.min(length, singleLine.length()));
    }
}
