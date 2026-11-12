package org.opentriage.development;

import static org.junit.Assert.*;
import android.content.ComponentName;
import android.content.pm.PackageManager;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class NativeStartupTest {
    private String evaluate(ActivityScenario<MainActivity> activity,String script) throws Exception {
        var value=new java.util.concurrent.atomic.AtomicReference<String>();var done=new java.util.concurrent.CountDownLatch(1);
        activity.onActivity(screen->screen.getBridge().getWebView().evaluateJavascript(script,result->{value.set(result);done.countDown();}));
        assertTrue(done.await(10,java.util.concurrent.TimeUnit.SECONDS));return value.get();
    }
    private void approvedApkTapLeavesOnlyThroughSystemIntent(ActivityScenario<MainActivity> activity) throws Exception {
        var instrumentation=InstrumentationRegistry.getInstrumentation();
        String url=InstrumentationRegistry.getArguments().getString("officialApkUrl");
        assertNotNull("Startup receives an exact verified catalog APK URL",url);
        var opened=new java.util.concurrent.atomic.AtomicReference<android.content.Intent>();
        var unavailable=new java.util.concurrent.atomic.AtomicBoolean(false);
        var monitor=new android.app.Instrumentation.ActivityMonitor(){
            @Override public android.app.Instrumentation.ActivityResult onStartActivity(android.content.Intent intent){
                if(android.content.Intent.ACTION_VIEW.equals(intent.getAction())){if(unavailable.get())throw new android.content.ActivityNotFoundException("Controlled no browser handler");opened.set(intent);return new android.app.Instrumentation.ActivityResult(android.app.Activity.RESULT_CANCELED,null);}
                return null;
            }
        };
        instrumentation.addMonitor(monitor);
        try {
            String target=InstrumentationRegistry.getArguments().getString("apkLinkTarget","");
            // A script-driven navigation has no user gesture and must stay inside the local document.
            evaluate(activity,"location.href="+org.json.JSONObject.quote(url));Thread.sleep(300);
            assertNull("An approved URL without a user gesture cannot open an external activity",opened.get());
            assertEquals("\"https://localhost\"",evaluate(activity,"location.origin"));
            evaluate(activity,"(()=>{const link=document.createElement('a');link.id='native-apk-probe';link.href="+org.json.JSONObject.quote(url)+";link.target="+org.json.JSONObject.quote(target)+";link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';link.textContent='Native APK download probe';link.style='position:fixed;top:0;left:0;z-index:2147483647;background:white;color:black;padding:20px';document.body.appendChild(link)})()");
            var link=androidx.test.uiautomator.UiDevice.getInstance(instrumentation).wait(androidx.test.uiautomator.Until.findObject(androidx.test.uiautomator.By.text("Native APK download probe")),5000);
            assertNotNull("The actual APK anchor must be reachable to a real user tap",link);link.click();
            long deadline=android.os.SystemClock.elapsedRealtime()+3000;
            while(opened.get()==null&&android.os.SystemClock.elapsedRealtime()<deadline)Thread.sleep(50);
            assertNotNull("A verified APK user tap must open a system browser intent",opened.get());
            assertEquals(url,opened.get().getDataString());
            assertEquals("The remote APK must never replace the bridged document","\"https://localhost\"",evaluate(activity,"location.origin"));
            assertNull("No credentials, headers or clinical referrer are attached",opened.get().getExtras());
            assertNull(opened.get().getClipData());
            opened.set(null);
            evaluate(activity,"document.getElementById('native-apk-probe').href='https://attacker.invalid/private.apk'");
            link.click();Thread.sleep(300);
            assertNull("A foreign user-tapped link stays blocked",opened.get());
            assertEquals("\"https://localhost\"",evaluate(activity,"location.origin"));
            unavailable.set(true);
            evaluate(activity,"window.__apkFailure=null;window.addEventListener('open-triage.apk-download-failed',e=>window.__apkFailure=e.detail.url,{once:true});document.getElementById('native-apk-probe').href="+org.json.JSONObject.quote(url));
            link.click();
            deadline=android.os.SystemClock.elapsedRealtime()+3000;String failure="null";
            while("null".equals(failure)&&android.os.SystemClock.elapsedRealtime()<deadline){failure=evaluate(activity,"window.__apkFailure");Thread.sleep(50);}
            assertEquals("No browser handler produces the exact actionable UI URL",url,new org.json.JSONTokener(failure).nextValue());
            assertEquals("\"https://localhost\"",evaluate(activity,"location.origin"));
        } finally {instrumentation.removeMonitor(monitor);evaluate(activity,"document.getElementById('native-apk-probe')?.remove()");}
    }
    @Test public void startupExcludesAppEmojiInitializerAndChecksFixtureFontProfile() throws Exception {
        var context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        try {
            var provider=context.getPackageManager().getProviderInfo(new ComponentName(context,"androidx.startup.InitializationProvider"),PackageManager.GET_META_DATA);
            assertTrue("Other local Startup initializers remain available",provider.metaData!=null);
            assertFalse("The installed APK excludes automatic remote font initialization",provider.metaData.containsKey("androidx.emoji2.text.EmojiCompatInitializer"));
        } catch(PackageManager.NameNotFoundException noStartupProvider) { /* No initializer can run if the provider is absent. */ }
        try(var activity=ActivityScenario.launch(MainActivity.class)) {
            long deadline=System.currentTimeMillis()+45000;boolean rendered=false;
            while(!rendered&&System.currentTimeMillis()<deadline) {
                var response=new java.util.concurrent.atomic.AtomicReference<String>();
                var ready=new java.util.concurrent.CountDownLatch(1);
                activity.onActivity(screen->screen.getBridge().getWebView().evaluateJavascript("document.readyState==='complete' && location.origin==='https://localhost' && document.body.children.length>0",value->{response.set(value);ready.countDown();}));
                assertTrue("Bundled WebView must answer",ready.await(10,java.util.concurrent.TimeUnit.SECONDS));
                rendered="true".equals(response.get());if(!rendered)Thread.sleep(100);
            }
            assertTrue("The real bundled WebView must render before inspecting dependencies",rendered);
            approvedApkTapLeavesOnlyThroughSystemIntent(activity);
            // Emoji is a transitive runtime-only library, not a test compile dependency.
            try {
                var emoji=Class.forName("androidx.emoji2.text.EmojiCompat",false,context.getClassLoader());
                assertEquals("Native startup does not bind the remote emoji font provider",Boolean.FALSE,emoji.getMethod("isConfigured").invoke(null));
            } catch(ClassNotFoundException noEmojiLibrary) { /* A removed library cannot initialize a provider. */ }
            var evidence=new android.os.Bundle();evidence.putString("opentriage_startup_pid",String.valueOf(android.os.Process.myPid()));
            if("1".equals(InstrumentationRegistry.getArguments().getString("fixtureFontProfile"))) {
                String providers;
                try(var output=new android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand("dumpsys -t 5 activity providers"))) {
                    providers=new String(output.readNBytes(262144),java.nio.charset.StandardCharsets.UTF_8);
                }
                assertTrue("Provider evidence must be bounded and complete",providers.length()<262144);
                assertTrue("The provider probe must return an actual ActivityManager dump",providers.contains("ACTIVITY MANAGER CONTENT PROVIDERS"));
                var dependency=FontProviderConnections.inspect(providers,android.os.Process.myPid(),context.getPackageName());
                evidence.putString("opentriage_gms_font_provider_bound",String.valueOf(dependency.bound()));
                evidence.putString("opentriage_gms_font_provider_records",dependency.records());
                InstrumentationRegistry.getInstrumentation().sendStatus(0,evidence);
                assertFalse("The scoped Chromium109 fixture must not retain the dying GMS font provider",dependency.bound());
            }
            InstrumentationRegistry.getInstrumentation().sendStatus(0,evidence);
        }
    }
}
