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
    private androidx.test.uiautomator.UiObject2 systemSave(UiDevice device,String pickerPackage) throws Exception {
        // AOSP DocumentsUI fragment_save uses the framework ID, also on
        // vendor-packaged DocumentsUI. Scope it to the picker, not any dialog.
        var save=device.wait(Until.findObject(By.pkg(pickerPackage).res("android:id/button1")),5000);
        String resourceIds="";
        if(save==null) {
            try(var output=new java.io.ByteArrayOutputStream()) {
                device.dumpWindowHierarchy(output);
                var matcher=java.util.regex.Pattern.compile("resource-id=\"([a-zA-Z0-9_.:/]+)\"").matcher(new String(output.toByteArray(),java.nio.charset.StandardCharsets.UTF_8));
                var ids=new java.util.TreeSet<String>();while(matcher.find()&&ids.size()<32)ids.add(matcher.group(1));resourceIds=ids.toString();
            } catch(Exception unavailable) {resourceIds="diagnostic unavailable";}
        }
        assertNotNull("The actual system Save control is available; resource IDs="+resourceIds,save);assertTrue("The chosen filename/destination enables the actual system Save action",save.isEnabled());return save;
    }
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
            String pickerPackage=name.getApplicationPackage();
            assertNotEquals("The actual picker belongs to another application",context.getPackageName(),pickerPackage);
            assertEquals("The picker does not authorize a download before the user chooses",0,loads.get());
            name.setText("opentriage-synthetic-"+id+".pdf");
            systemSave(device,pickerPackage).click();
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
            var name=device.wait(Until.findObject(By.clazz("android.widget.EditText")),5000);assertNotNull(name);
            String pickerPackage=name.getApplicationPackage();
            device.pressBack(); // Dismiss the keyboard, if the picker showed it.
            if(device.hasObject(By.pkg(pickerPackage).res("android:id/button1")))device.pressBack();
            assertEquals(android.app.Activity.RESULT_CANCELED,scenario.getResult().getResultCode());
            assertEquals(0,loads.get());assertFalse(session.current());assertFalse(privateFile.exists());
        } finally {NativePdfSessions.closeOwner(owner);}
    }
}
