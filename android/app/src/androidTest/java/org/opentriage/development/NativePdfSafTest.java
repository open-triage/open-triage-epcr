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

/** Exercises the real system document picker and provider, without intent stubs. */
@RunWith(AndroidJUnit4.class)
public class NativePdfSafTest {
    @Test public void actualPickerExportsOnlyFreshlyAuthorizedBytesAndPreservesTheExplicitDownload() throws Exception {
        var instrumentation=InstrumentationRegistry.getInstrumentation();var context=instrumentation.getTargetContext();
        Object owner=new Object();String id=java.util.UUID.randomUUID().toString();
        byte[] fresh=NativePdfFixture.bytes("SYNTHETIC FRESH AUTHORIZED EXPORT");var loads=new AtomicInteger();
        NativePdfSessions.begin(owner,id);
        var session=NativePdfSessions.create(context,owner,id,System.currentTimeMillis()+60_000,()->true,()->{loads.incrementAndGet();return fresh.clone();});
        java.io.File privateFile=session.cache(NativePdfFixture.bytes("SYNTHETIC OLD PREVIEW"));
        android.net.Uri destination=null;
        try(var scenario=ActivityScenario.<NativePdfActivity>launchActivityForResult(NativePdfFixture.intent(context,session,"en").putExtra("save",true))) {
            UiDevice device=UiDevice.getInstance(instrumentation);
            var name=device.wait(Until.findObject(By.clazz("android.widget.EditText")),5000);
            assertNotNull("The real ACTION_CREATE_DOCUMENT picker opens",name);
            assertEquals("The picker does not authorize a download before the user chooses",0,loads.get());
            name.setText("opentriage-synthetic-"+id+".pdf");
            var save=device.wait(Until.findObject(By.res(java.util.regex.Pattern.compile(".*:id/button_save"))),5000);
            assertNotNull("The system Save control is available",save);save.click();
            var result=scenario.getResult();assertEquals(android.app.Activity.RESULT_OK,result.getResultCode());
            destination=result.getResultData().getData();assertNotNull(destination);assertEquals("content",destination.getScheme());
            assertEquals("Authorization/refetch happens after the real picker returns",1,loads.get());
            assertFalse("The completed viewer has revoked its authority",session.current());
            assertFalse("A completed export leaves no private preview",privateFile.exists());
            try(var input=context.getContentResolver().openInputStream(destination)) {
                assertNotNull(input);assertArrayEquals("The explicit user download survives preview cleanup and contains the fresh authorized document",fresh,input.readAllBytes());
            }
        } finally {
            NativePdfSessions.closeOwner(owner);
            if(destination!=null)assertTrue("Delete only this test's explicit synthetic export",android.provider.DocumentsContract.deleteDocument(context.getContentResolver(),destination));
            java.util.Arrays.fill(fresh,(byte)0);
        }
    }
    @Test public void cancellingTheRealPickerDoesNotFetchOrExportAReport() throws Exception {
        var instrumentation=InstrumentationRegistry.getInstrumentation();var context=instrumentation.getTargetContext();Object owner=new Object();
        String id=java.util.UUID.randomUUID().toString();var loads=new AtomicInteger();NativePdfSessions.begin(owner,id);
        var session=NativePdfSessions.create(context,owner,id,System.currentTimeMillis()+60_000,()->true,()->{loads.incrementAndGet();return NativePdfFixture.bytes();});
        var privateFile=session.cache(NativePdfFixture.bytes());
        try(var scenario=ActivityScenario.<NativePdfActivity>launchActivityForResult(NativePdfFixture.intent(context,session,"en").putExtra("save",true))) {
            UiDevice device=UiDevice.getInstance(instrumentation);
            assertNotNull(device.wait(Until.findObject(By.clazz("android.widget.EditText")),5000));
            device.pressBack(); // Dismiss the keyboard, if the picker showed it.
            if(device.hasObject(By.res(java.util.regex.Pattern.compile(".*:id/button_save"))))device.pressBack();
            assertEquals(android.app.Activity.RESULT_CANCELED,scenario.getResult().getResultCode());
            assertEquals(0,loads.get());assertFalse(session.current());assertFalse(privateFile.exists());
        } finally {NativePdfSessions.closeOwner(owner);}
    }
}
