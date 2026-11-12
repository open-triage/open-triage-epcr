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
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** Actual visible platform surface with a held remote-authority completion. */
@RunWith(AndroidJUnit4.class)
public class NativePdfRemoteLifetimeTest {
    private void closesVisiblePreview(boolean capabilitiesChanged) throws Exception {
        var context=InstrumentationRegistry.getInstrumentation().getTargetContext();Object owner=new Object();
        var session=NativePdfFixture.create(context,owner,new AtomicBoolean(true),System.currentTimeMillis()+60_000);
        var file=session.preview();var entered=new CountDownLatch(1);var release=new CountDownLatch(1);
        var original=new NativePdfContract.Authority("user","agency","opaque-cookie",Long.MAX_VALUE,60_000,"clinical:document,review:self");
        session.refresher=()->{
            entered.countDown();assertTrue("Host-controlled authority completion must be released",release.await(10,TimeUnit.SECONDS));
            if(!capabilitiesChanged)throw new NativePdfSessions.Revoked();
            var fresh=new NativePdfContract.Authority("user","agency","opaque-cookie",Long.MAX_VALUE,60_000,"clinical:document");
            if(!NativePdfContract.sameAuthority(original,fresh))throw new NativePdfSessions.Revoked();
        };
        try(var scenario=ActivityScenario.<NativePdfActivity>launch(NativePdfFixture.intent(context,session,"en"))) {
            var device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
            assertNotNull(device.wait(Until.findObject(By.desc("Page 1 of 2")),5000));assertTrue(entered.await(5,TimeUnit.SECONDS));
            assertTrue("Static preview was visible and private before its pending refresh completed",file.isFile());
            release.countDown();
            assertTrue("A remote denial/capability change closes the actual static native page",device.wait(Until.gone(By.desc("Page 1 of 2")),5000));
            assertFalse(session.current());assertFalse(file.exists());assertNull(NativePdfSessions.get(session.id));
        } finally {release.countDown();NativePdfSessions.closeOwner(owner);}
    }
    @Test public void remoteUnauthorizedCompletionClosesTheStaticVisiblePreview() throws Exception {closesVisiblePreview(false);}
    @Test public void remoteCapabilityWithdrawalClosesTheStaticVisiblePreview() throws Exception {closesVisiblePreview(true);}
}
