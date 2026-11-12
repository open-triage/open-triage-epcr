package org.opentriage.development;

import static org.junit.Assert.*;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

public class NativeReplyGateTest {
    private static final class Realm {
        final ArrayDeque<Runnable> queue = new ArrayDeque<>();
        final List<String> delivered = new ArrayList<>();
        boolean ui; boolean current = true; int dropped;
        final NativeReplyGate gate = new NativeReplyGate(queue::add, () -> ui, () -> {
            assertTrue("Realm identity is inspected only on UI", ui); return current;
        });
        void send(String value) { gate.dispatch(() -> { assertTrue(ui); delivered.add(value); }, () -> dropped++); }
        void onUi(Runnable work) { ui=true; try { work.run(); } finally { ui=false; } }
        void drain() { onUi(() -> { while(!queue.isEmpty()) queue.remove().run(); }); }
    }
    @Test public void workerSuccessErrorAndEventsRunOnlyOnUiInOrder() {
        Realm r=new Realm();r.send("success");r.send("error");r.send("event");assertTrue(r.delivered.isEmpty());
        r.drain();assertEquals(List.of("success","error","event"),r.delivered);assertEquals(0,r.dropped);
    }
    @Test public void queuedResponsesAreDiscardedWhenDestroyedBeforeDrain() {
        Realm r=new Realm();r.send("success");r.send("error");r.send("event");r.onUi(r.gate::close);r.drain();
        assertTrue(r.delivered.isEmpty());assertEquals(3,r.dropped);
    }
    @Test public void cancellationFailureAfterCloseNeverCallsOldRealm() {
        Realm r=new Realm();r.onUi(r.gate::close);r.send("interrupted-operation-rejection");r.drain();
        assertTrue(r.delivered.isEmpty());assertEquals(1,r.dropped);
    }
    @Test public void currentRealmIsRecheckedAtExecutionInsteadOfEnqueue() {
        Realm r=new Realm();r.send("old");r.current=false;r.drain();assertEquals(1,r.dropped);assertTrue(r.delivered.isEmpty());
    }
    @Test public void liveUiDeliveryIsInlineWithoutDestructionGap() {
        Realm r=new Realm();r.onUi(() -> { r.send("live");assertEquals(List.of("live"),r.delivered);r.gate.close(); });
        assertTrue(r.queue.isEmpty());
    }
    @Test public void pauseDoesNotCloseGateAndNewInstanceDoesNotReceiveOldReplies() {
        Realm old=new Realm();old.send("pending-before-pause");old.drain();assertEquals(List.of("pending-before-pause"),old.delivered);
        old.onUi(old.gate::close);old.send("old-after-close");Realm fresh=new Realm();fresh.send("new");old.drain();fresh.drain();
        assertEquals(1,old.dropped);assertEquals(List.of("new"),fresh.delivered);
    }
    @Test public void queuedOperationCannotSubmitToShutdownExecutorAfterDestroy() {
        Realm r=new Realm();int[] submissions={0};
        r.gate.dispatch(() -> submissions[0]++, () -> r.dropped++);
        r.onUi(r.gate::close);r.drain();assertEquals(0,submissions[0]);assertEquals(1,r.dropped);
    }
    @Test public void closeIsIdempotentAndRequiresUiThread() {
        Realm r=new Realm();assertThrows(IllegalStateException.class,r.gate::close);
        r.onUi(() -> {r.gate.close();r.gate.close();});r.send("late");r.drain();assertEquals(1,r.dropped);
    }
}
