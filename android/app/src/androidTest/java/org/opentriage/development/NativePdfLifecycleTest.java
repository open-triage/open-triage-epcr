package org.opentriage.development;

import static org.junit.Assert.*;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.Until;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.atomic.AtomicBoolean;

@RunWith(AndroidJUnit4.class)
public class NativePdfLifecycleTest {
    private void absent(java.io.File file) throws Exception {
        long deadline = android.os.SystemClock.elapsedRealtime() + 6000;
        while (file.exists() && android.os.SystemClock.elapsedRealtime() < deadline) Thread.sleep(25);
        assertFalse("Closed/background/expired native preview leaves no private PDF bytes", file.exists());
    }
    @Test public void platformRendererUsesPrivateSecurePagesAndClearsOnRealBackground() throws Exception {
        var context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Object owner = new Object(); var session = NativePdfFixture.create(context, owner, new AtomicBoolean(true), System.currentTimeMillis() + 60_000);
        java.io.File file = session.preview();
        assertThrows("No other-app URI can address the no-backup PDF directory", IllegalArgumentException.class,
            () -> androidx.core.content.FileProvider.getUriForFile(context, context.getPackageName()+".fileprovider", file));
        try (var scenario = ActivityScenario.<NativePdfActivity>launch(NativePdfFixture.intent(context, session, "en"))) {
            UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
            assertNotNull("The actual Android PDF renderer displays page one", device.wait(Until.findObject(By.desc("Page 1 of 2")), 5000));
            scenario.onActivity(activity -> assertTrue((activity.getWindow().getAttributes().flags & android.view.WindowManager.LayoutParams.FLAG_SECURE) != 0));
            device.findObject(By.desc("Next page")).click(); assertNotNull(device.wait(Until.findObject(By.desc("Page 2 of 2")), 5000));
            device.pressHome(); absent(file); assertFalse(session.current());
        } finally { NativePdfSessions.closeOwner(owner); }
    }
    @Test public void livePrincipalOrPolicyLossClosesTheVisibleLocalizedPreview() throws Exception {
        var context = InstrumentationRegistry.getInstrumentation().getTargetContext(); var authorized = new AtomicBoolean(true); Object owner = new Object();
        var session = NativePdfFixture.create(context, owner, authorized, System.currentTimeMillis() + 60_000); var file = session.preview();
        try (var scenario = ActivityScenario.<NativePdfActivity>launch(NativePdfFixture.intent(context, session, "sv"))) {
            UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
            assertNotNull("Selected app language reaches native controls", device.wait(Until.findObject(By.desc("Sida 1 av 2")), 5000));
            authorized.set(false); absent(file); assertNull(NativePdfSessions.get(session.id));
        } finally { NativePdfSessions.closeOwner(owner); }
    }
    @Test public void actualSessionExpiryClosesTheNativePreviewWithoutAWebViewTimer() throws Exception {
        var context = InstrumentationRegistry.getInstrumentation().getTargetContext(); Object owner = new Object();
        var session = NativePdfFixture.create(context, owner, new AtomicBoolean(true), System.currentTimeMillis() + 2000); var file = session.preview();
        // Expiry may legitimately finish during launch on a slow device; use the
        // ordinary activity start and assert the security result independently.
        context.startActivity(NativePdfFixture.intent(context, session, "en").addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
        absent(file); assertFalse(session.current()); assertNull(NativePdfSessions.get(session.id));
    }
}
