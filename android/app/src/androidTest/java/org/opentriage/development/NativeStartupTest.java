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
