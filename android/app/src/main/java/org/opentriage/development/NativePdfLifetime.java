package org.opentriage.development;

import java.util.function.LongSupplier;

/** A non-renewable lease; elapsed time includes sleep on the Android caller. */
final class NativePdfLifetime {
    private static final long MAX_MILLIS = 10 * 60_000;
    private final LongSupplier wall, elapsed;
    private long lastWall, lastElapsed, deadline;
    private final long wallDeadline;
    private boolean ended;
    NativePdfLifetime(long requestWall, long requestElapsed, long remaining, LongSupplier wall, LongSupplier elapsed) {
        this.wall = wall; this.elapsed = elapsed; lastWall = requestWall; lastElapsed = requestElapsed;
        long bounded = Math.max(0, Math.min(MAX_MILLIS, remaining));
        deadline = requestElapsed + bounded; wallDeadline = requestWall + bounded;
    }
    synchronized boolean current() {
        long nowWall = wall.getAsLong(), nowElapsed = elapsed.getAsLong();
        // Rollback/reboot and forward clock jumps can only shorten authority.
        if (nowWall < lastWall || nowElapsed < lastElapsed || nowElapsed >= deadline || nowWall >= wallDeadline) ended = true;
        lastWall = nowWall; lastElapsed = nowElapsed;
        return !ended;
    }
    synchronized void shorten(long requestElapsed, long remaining) {
        deadline = Math.min(deadline, requestElapsed + Math.max(0, Math.min(MAX_MILLIS, remaining)));
    }
}
