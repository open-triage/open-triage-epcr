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
public class NativePdfColdProcessTest {
    @Test public void abruptDeathCannotRestorePlaintextOrAnOldDocumentHandle() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation(); var context = instrumentation.getTargetContext();
        var preferences = context.getSharedPreferences("native-pdf-acceptance", android.content.Context.MODE_PRIVATE);
        String phase = InstrumentationRegistry.getArguments().getString("phase");
        if ("prepare".equals(phase)) {
            var session = NativePdfFixture.create(context, this, new AtomicBoolean(true), System.currentTimeMillis() + 60_000);
            java.io.File directory = NativePdfSessions.directory(context);
            java.nio.file.Files.write(new java.io.File(directory,"unrelated-fixture.txt").toPath(),"KEEP".getBytes(java.nio.charset.StandardCharsets.UTF_8));
            assertTrue(preferences.edit().putString("operation",session.id).putInt("pid",android.os.Process.myPid()).commit());
            try (var scenario = ActivityScenario.<NativePdfActivity>launch(NativePdfFixture.intent(context, session,"en"))) {
                assertNotNull(UiDevice.getInstance(instrumentation).wait(Until.findObject(By.desc("Page 1 of 2")),5000));
                assertTrue("A real private PDF must exist when the host kills this live process", session.preview().isFile());
                var evidence=new android.os.Bundle(); evidence.putString("opentriage_pdf_phase","ready-for-process-kill"); instrumentation.sendStatus(0,evidence);
                new java.util.concurrent.CountDownLatch(1).await(60,java.util.concurrent.TimeUnit.SECONDS);
                fail("The host must force-stop the genuinely live native viewer process");
            }
        } else if ("verify".equals(phase)) {
            String id=preferences.getString("operation",""); assertTrue(id.matches("[a-f0-9-]{36}"));
            assertNotEquals("Acceptance requires a genuinely new Android process", preferences.getInt("pid",-1),android.os.Process.myPid());
            assertNull("No old memory authority survives process death",NativePdfSessions.get(id));
            try (var main=ActivityScenario.launch(MainActivity.class)) {
                main.onActivity(activity->{
                    assertFalse("Cold MainActivity startup removes owned stale preview bytes before mounting the UI",new java.io.File(NativePdfSessions.directory(context),id+".pdf").exists());
                    assertTrue("Unrelated files are not removed by preview cleanup",new java.io.File(NativePdfSessions.directory(context),"unrelated-fixture.txt").isFile());
                });
            }
            var rejected=new java.util.concurrent.CountDownLatch(1);
            var application=(android.app.Application)context.getApplicationContext();
            var observer=new android.app.Application.ActivityLifecycleCallbacks() {
                @Override public void onActivityCreated(android.app.Activity a,android.os.Bundle state) {}
                @Override public void onActivityStarted(android.app.Activity a) {}
                @Override public void onActivityResumed(android.app.Activity a) {}
                @Override public void onActivityPaused(android.app.Activity a) {}
                @Override public void onActivityStopped(android.app.Activity a) {}
                @Override public void onActivitySaveInstanceState(android.app.Activity a,android.os.Bundle state) {}
                @Override public void onActivityDestroyed(android.app.Activity a) { if(a instanceof NativePdfActivity && id.equals(a.getIntent().getStringExtra("document")))rejected.countDown(); }
            };
            application.registerActivityLifecycleCallbacks(observer);
            try {
                context.startActivity(new android.content.Intent(context,NativePdfActivity.class).putExtra("document",id).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
                assertTrue("Replaying an old document handle actually launches and closes without retrieving old bytes",rejected.await(5,java.util.concurrent.TimeUnit.SECONDS));
            } finally {application.unregisterActivityLifecycleCallbacks(observer);}
            new java.io.File(NativePdfSessions.directory(context),"unrelated-fixture.txt").delete();
            assertTrue(preferences.edit().clear().commit());
            var evidence=new android.os.Bundle(); evidence.putString("opentriage_pdf_cold_cleanup","true"); instrumentation.sendStatus(0,evidence);
        } else fail("Choose the explicit preparation or cold verification phase");
    }
}
