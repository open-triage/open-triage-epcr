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
    @Test public void startupUsesPlatformFontsWithoutAutomaticRemoteProvider() throws Exception {
        var context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        try {
            var provider=context.getPackageManager().getProviderInfo(new ComponentName(context,"androidx.startup.InitializationProvider"),PackageManager.GET_META_DATA);
            assertTrue("Other local Startup initializers remain available",provider.metaData!=null);
            assertFalse("The installed APK excludes automatic remote font initialization",provider.metaData.containsKey("androidx.emoji2.text.EmojiCompatInitializer"));
        } catch(PackageManager.NameNotFoundException noStartupProvider) { /* No initializer can run if the provider is absent. */ }
        try(var activity=ActivityScenario.launch(MainActivity.class)) {
            // Emoji is a transitive runtime-only library, not a test compile dependency.
            try {
                var emoji=Class.forName("androidx.emoji2.text.EmojiCompat",false,context.getClassLoader());
                assertEquals("Native startup does not bind the remote emoji font provider",Boolean.FALSE,emoji.getMethod("isConfigured").invoke(null));
            } catch(ClassNotFoundException noEmojiLibrary) { /* A removed library cannot initialize a provider. */ }
        }
    }
}
