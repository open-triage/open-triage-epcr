package org.opentriage.development;

import static org.junit.Assert.*;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.Until;
import androidx.test.uiautomator.UiDevice;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.TimeUnit;

/** Real native-handle failure; neither the platform renderer nor Retry is stubbed. */
@RunWith(AndroidJUnit4.class)
public class NativePdfRendererRetryTest {
    @Test public void failedNativeHandleIsDiscardedAndRetryAuthorizesFreshBytesBeforeRenderingAgain() throws Exception {
        var instrumentation=InstrumentationRegistry.getInstrumentation();var context=instrumentation.getTargetContext();
        Object owner=new Object();String id=java.util.UUID.randomUUID().toString();var loads=new AtomicInteger();
        byte[] fresh=NativePdfFixture.bytes("SYNTHETIC FRESH RETRY",1);
        NativePdfSessions.begin(owner,id);
        var session=NativePdfSessions.create(context,owner,id,System.currentTimeMillis()+60_000,()->true,()->{loads.incrementAndGet();return fresh.clone();});
        var file=session.cache(NativePdfFixture.bytes("SYNTHETIC INITIAL PREVIEW",2));
        var renderer=new AtomicReference<android.graphics.pdf.PdfRenderer>();var worker=new AtomicReference<java.util.concurrent.ExecutorService>();
        try(var scenario=ActivityScenario.<NativePdfActivity>launch(NativePdfFixture.intent(context,session,"en"))) {
            var device=UiDevice.getInstance(instrumentation);
            assertNotNull(device.wait(Until.findObject(By.desc("Page 1 of 2")),5000));
            scenario.onActivity(activity->{
                try {
                    var field=NativePdfActivity.class.getDeclaredField("renderer");field.setAccessible(true);renderer.set((android.graphics.pdf.PdfRenderer)field.get(activity));
                    field=NativePdfActivity.class.getDeclaredField("worker");field.setAccessible(true);worker.set((java.util.concurrent.ExecutorService)field.get(activity));
                } catch(ReflectiveOperationException failure){throw new AssertionError(failure);}
            });
            assertNotNull(renderer.get());assertNotNull(worker.get());
            // Close the actual platform resource on its owning worker, then
            // exercise the ordinary UI failure and recovery path.
            worker.get().submit(()->renderer.get().close()).get(5,TimeUnit.SECONDS);
            device.findObject(By.desc("Next page")).click();
            var retry=device.wait(Until.findObject(By.text("Retry")),5000);assertNotNull("The real invalid handle exposes localized Retry",retry);
            assertEquals("Failure does not silently refetch or mask the invalid handle",0,loads.get());retry.click();
            assertNotNull("Retry discards the old handle, freshly authorizes and renders the new document",device.wait(Until.findObject(By.desc("Page 1 of 1")),5000));
            assertEquals("Exactly one fresh authority/document load occurs after explicit Retry",1,loads.get());
            scenario.onActivity(activity->{
                try {var field=NativePdfActivity.class.getDeclaredField("renderer");field.setAccessible(true);assertNotSame(renderer.get(),field.get(activity));}
                catch(ReflectiveOperationException failure){throw new AssertionError(failure);}
            });
            assertTrue(session.current());assertTrue(file.isFile());
        } finally {NativePdfSessions.closeOwner(owner);java.util.Arrays.fill(fresh,(byte)0);assertFalse("Retry cleanup removes its owned temporary document",file.exists());}
    }
}
