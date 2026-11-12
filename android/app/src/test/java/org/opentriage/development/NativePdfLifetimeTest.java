package org.opentriage.development;

import static org.junit.Assert.*;
import org.junit.Test;
import java.util.concurrent.atomic.AtomicLong;

public class NativePdfLifetimeTest {
    @Test public void frozenWallClockAndDeepSleepCannotExtendOriginalAuthority() {
        var wall=new AtomicLong(1000);var elapsed=new AtomicLong(10);
        var lease=new NativePdfLifetime(1000,10,100,wall::get,elapsed::get);
        assertTrue(lease.current());elapsed.set(109);assertTrue(lease.current());
        elapsed.set(110);assertFalse(lease.current());elapsed.set(10);assertFalse(lease.current());
    }
    @Test public void rollbackAndForwardExpiryAreTerminalEvenIfTheClockIsCorrected() {
        for(boolean rollback:new boolean[]{false,true}) {
            var wall=new AtomicLong(1000);var elapsed=new AtomicLong(10);
            var lease=new NativePdfLifetime(1000,10,100,wall::get,elapsed::get);
            assertTrue(lease.current());wall.set(rollback?999:1100);assertFalse(lease.current());
            wall.set(1000);assertFalse(lease.current());
        }
    }
    @Test public void requestLatencyAndRefreshCanOnlyShortenTheLease() {
        var wall=new AtomicLong(1050);var elapsed=new AtomicLong(60);
        var lease=new NativePdfLifetime(1000,10,100,wall::get,elapsed::get);
        assertTrue(lease.current());lease.shorten(60,1000);elapsed.set(109);assertTrue(lease.current());
        lease.shorten(60,40);assertFalse(lease.current());
    }
    @Test public void previewCeilingIsIndependentOfServerSessionLength() {
        var wall=new AtomicLong(1000);var elapsed=new AtomicLong(10);
        var lease=new NativePdfLifetime(1000,10,Long.MAX_VALUE,wall::get,elapsed::get);
        assertTrue(lease.current());elapsed.set(600_010);assertFalse(lease.current());
    }
}
