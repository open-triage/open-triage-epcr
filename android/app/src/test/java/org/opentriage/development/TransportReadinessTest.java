package org.opentriage.development;

import static org.junit.Assert.*;
import org.junit.Test;

public class TransportReadinessTest {
    private static final class Time {
        long now;
        long read() { return now; }
        void sleep(long milliseconds) { assertTrue(milliseconds > 0 && milliseconds <= 100); now += milliseconds; }
    }
    private TransportReadiness.Sample sample(Boolean online, boolean internet, boolean reachable) {
        return new TransportReadiness.Sample(online, internet, reachable, "active=fixture,wifi=true", reachable ? null : "ConnectException", reachable ? null : "Connection refused");
    }
    @Test public void browserOnlineDoesNotSkipTransientActualRouteFailure() throws Exception {
        var time = new Time(); var calls = new int[1];
        var result = TransportReadiness.await(true, timeout -> {
            assertTrue(timeout > 0 && timeout <= 250);
            return sample(true, true, ++calls[0] >= 4);
        }, time::read, time::sleep, 45_000);
        assertTrue(result.reachable()); assertEquals(4, calls[0]); assertEquals(300, time.now);
    }
    @Test public void browserOfflineDoesNotSkipAnActualRouteStillBeingRemoved() throws Exception {
        var time = new Time(); var calls = new int[1];
        var result = TransportReadiness.await(false, timeout -> sample(false, true, ++calls[0] < 3), time::read, time::sleep, 45_000);
        assertFalse(result.reachable()); assertEquals(3, calls[0]); assertEquals(200, time.now);
    }
    @Test public void waitsForBrowserAndNativeNetworkAsWellAsSocket() throws Exception {
        var time = new Time(); var calls = new int[1];
        TransportReadiness.await(true, timeout -> {
            int call = ++calls[0]; return sample(call > 1, call > 2, true);
        }, time::read, time::sleep, 45_000);
        assertEquals(3, calls[0]);
    }
    @Test public void noActivityTlsProofCanWaitWithoutBrowserOrSendingHttp() throws Exception {
        var time = new Time(); var calls = new int[1];
        TransportReadiness.await(true, timeout -> sample(null, true, ++calls[0] > 1), time::read, time::sleep, 45_000);
        assertEquals(2, calls[0]);
    }
    @Test public void persistentFailureEndsAtMonotonicDeadlineWithBoundedActualDiagnostics() {
        var time = new Time(); var calls = new int[1];
        var failure = assertThrows(AssertionError.class, () -> TransportReadiness.await(true, timeout -> {
            calls[0]++; time.now += timeout;
            return new TransportReadiness.Sample(true, false, false, "active=null," + "n".repeat(1000), "SocketTimeoutException", "timed out\n" + "x".repeat(1000));
        }, time::read, time::sleep, 45_000));
        assertEquals(45_000, time.now); assertTrue(calls[0] > 1);
        assertTrue(failure.getMessage().contains("browserOnline=true"));
        assertTrue(failure.getMessage().contains("reachable=false"));
        assertTrue(failure.getMessage().contains("active=null"));
        assertTrue(failure.getMessage().contains("SocketTimeoutException"));
        assertFalse(failure.getMessage().contains("\n")); assertTrue(failure.getMessage().length() < 900);
    }
    @Test public void aProbeCompletingAfterDeadlineCannotPass() {
        var time = new Time();
        assertThrows(AssertionError.class, () -> TransportReadiness.await(true, timeout -> {
            time.now = 45_001; return sample(true, true, true);
        }, time::read, time::sleep, 45_000));
    }
    @Test public void invalidProbeAndInterruptionAreNotClassifiedAsOfflineSuccess() {
        var time = new Time();
        assertThrows(IllegalStateException.class, () -> TransportReadiness.await(false, timeout -> { throw new IllegalStateException("WebView missing"); }, time::read, time::sleep, 45_000));
        assertThrows(InterruptedException.class, () -> TransportReadiness.await(true, timeout -> sample(true, false, false), time::read, millis -> { throw new InterruptedException("cancelled"); }, 45_000));
    }
    @Test public void rejectsUnboundedOrNonpositiveDeadline() {
        var time = new Time();
        for (long timeout : new long[]{0, -1, 45_001}) assertThrows(IllegalArgumentException.class, () -> TransportReadiness.await(true, limit -> sample(true, true, true), time::read, time::sleep, timeout));
    }
}
