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
    private void verifyWithNewUserGrant(UiDevice device,android.net.Uri original,String name,byte[] expected) throws Exception {
        var instrumentation=InstrumentationRegistry.getInstrumentation();var target=instrumentation.getTargetContext();
        String token=java.util.UUID.randomUUID().toString();var done=new java.util.concurrent.CountDownLatch(1);
        var result=new java.util.concurrent.atomic.AtomicReference<android.os.Bundle>();var code=new AtomicInteger();
        var accepting=new java.util.concurrent.atomic.AtomicBoolean(true);
        var receiver=new android.os.ResultReceiver(new android.os.Handler(android.os.Looper.getMainLooper())) {
            @Override protected void onReceiveResult(int value,android.os.Bundle data){if(accepting.get()&&data!=null&&token.equals(data.getString("token"))){code.set(value);result.set(data);done.countDown();}}
        };
        var component=new android.content.ComponentName(instrumentation.getContext().getPackageName(),NativePdfSafDocumentActivity.class.getName());
        boolean completed=false;Throwable primary=null;
        try {
            target.startActivity(new android.content.Intent().setComponent(component).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra("result",receiver).putExtra("token",token).putExtra("document",original).putExtra("name",name).putExtra("length",expected.length));
            var file=device.wait(Until.findObject(By.text(name)),10000);
            assertNotNull("The genuine Open Document picker exposes only this exact synthetic export for user selection",file);file.click();
            assertTrue("The separately granted document consumer must finish",done.await(15,java.util.concurrent.TimeUnit.SECONDS));
            var proof=result.get();assertNotNull(proof);
            assertEquals("The ResultReceiver belongs to the exact separate test component",component.flattenToShortString(),proof.getString("component"));
            assertEquals(instrumentation.getContext().getApplicationInfo().uid,proof.getInt("consumerUid"));
            var evidence=new android.os.Bundle();for(String key:new String[]{"primaryFailure","cleanupFailure","sha256"})evidence.putString("opentriage_pdf_user_grant_"+key,proof.getString(key,"missing"));
            evidence.putInt("opentriage_pdf_user_grant_bytes",proof.getInt("length"));evidence.putBoolean("opentriage_pdf_user_grant_deleted",proof.getBoolean("deleted"));instrumentation.sendStatus(0,evidence);
            assertEquals("Primary document verification failure (cleanup is reported independently): "+proof.getString("cleanupFailure"),"",proof.getString("primaryFailure","missing"));
            assertTrue("Only the exact saved URI/document metadata can be read or deleted",proof.getBoolean("identityMatched"));
            var hash=new StringBuilder();for(byte value:java.security.MessageDigest.getInstance("SHA-256").digest(expected))hash.append(String.format(java.util.Locale.ROOT,"%02x",value&255));
            assertEquals("The explicit download survives viewer cleanup with the exact freshly authorized bytes",hash.toString(),proof.getString("sha256"));
            assertEquals(expected.length,proof.getInt("length"));
            assertEquals("Cleanup failure is not allowed to mask the primary verification","",proof.getString("cleanupFailure","missing"));
            assertTrue("Delete only the explicitly selected, validated test export while its new write grant is live",proof.getBoolean("deleted"));
            assertEquals(android.app.Activity.RESULT_OK,code.get());completed=true;
        } catch(Exception|AssertionError failure){primary=failure;throw failure;
        } finally {
            accepting.set(false);
            if(!completed)try {target.startActivity(new android.content.Intent().setComponent(component).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("cancelToken",token));}
            catch(Exception cleanup){if(primary!=null)primary.addSuppressed(cleanup);else throw cleanup;}
        }
    }
    @Test public void actualPickerExportsOnlyFreshlyAuthorizedBytesAndPreservesTheExplicitDownload() throws Exception {
        var instrumentation=InstrumentationRegistry.getInstrumentation();var context=instrumentation.getTargetContext();
        Object owner=new Object();String id=java.util.UUID.randomUUID().toString();
        byte[] fresh=NativePdfFixture.bytes("SYNTHETIC FRESH AUTHORIZED EXPORT");var loads=new AtomicInteger();
        NativePdfSessions.begin(owner,id);
        var session=NativePdfSessions.create(context,owner,id,System.currentTimeMillis()+60_000,()->true,()->{loads.incrementAndGet();return fresh.clone();});
        java.io.File privateFile=session.cache(NativePdfFixture.bytes("SYNTHETIC OLD PREVIEW"));
        String nameValue="opentriage-synthetic-"+id+".pdf";
        try {
          android.net.Uri destination;
          try(var scenario=ActivityScenario.<NativePdfActivity>launchActivityForResult(NativePdfFixture.intent(context,session,"en").putExtra("save",true))) {
            UiDevice device=UiDevice.getInstance(instrumentation);
            var name=device.wait(Until.findObject(By.clazz("android.widget.EditText")),5000);
            assertNotNull("The real ACTION_CREATE_DOCUMENT picker opens",name);
            String pickerPackage=name.getApplicationPackage();
            assertNotEquals("The actual picker belongs to another application",context.getPackageName(),pickerPackage);
            assertEquals("The picker does not authorize a download before the user chooses",0,loads.get());
            name.setText(nameValue);
            systemSave(device,pickerPackage).click();
            var result=scenario.getResult();assertEquals(android.app.Activity.RESULT_OK,result.getResultCode());
            destination=result.getResultData().getData();assertNotNull(destination);assertEquals("content",destination.getScheme());
            assertEquals("Authorization/refetch happens after the real picker returns",1,loads.get());
            assertFalse("The completed viewer has revoked its authority",session.current());
            assertFalse("A completed export leaves no private preview",privateFile.exists());
          }
          verifyWithNewUserGrant(UiDevice.getInstance(instrumentation),destination,nameValue,fresh);
        } finally {
            NativePdfSessions.closeOwner(owner);
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
