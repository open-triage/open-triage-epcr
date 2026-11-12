package org.opentriage.development;

import static org.junit.Assert.*;

import android.app.admin.DevicePolicyManager;
import android.content.RestrictionsManager;
import android.os.Bundle;
import android.util.Base64;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Objects;
import java.util.Set;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Read-only observation of restrictions delivered by the actual enrolled MDM agent. */
@RunWith(AndroidJUnit4.class)
public class ManagedPolicyObservationTest {
    @Test public void actualAgentDeliveredExactStandardRestrictions() throws Exception {
        var context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        var arguments = InstrumentationRegistry.getArguments();
        String owner = arguments.getString("expectedOwnerPackage", "");
        assertFalse("Supply the actual enrolled management agent package", owner.isEmpty());
        var manager = context.getSystemService(DevicePolicyManager.class);
        assertFalse("Clinical APK must remain an ordinary managed app", manager.isDeviceOwnerApp(context.getPackageName()));
        assertTrue("Expected actual management agent must own this disposable test device", manager.isDeviceOwnerApp(owner));

        String encoded = arguments.getString("expectedConfigurationBase64", "");
        assertFalse("Supply the exact expected Android Bundle as JSON, including {} for empty", encoded.isEmpty());
        var expected = new JSONObject(new String(Base64.decode(encoded, Base64.NO_WRAP), StandardCharsets.UTF_8));
        Bundle actual = context.getSystemService(RestrictionsManager.class).getApplicationRestrictions();
        assertNotNull("RestrictionsManager must return the actual app's Bundle", actual);
        Set<String> keys = new HashSet<>();
        var iterator = expected.keys();
        while (iterator.hasNext()) keys.add(iterator.next());
        assertEquals("Delivered Android restriction keys must match exactly", keys, actual.keySet());
        for (String key : keys) {
            Object wanted = expected.get(key);
            Object observed = actual.get(key);
            assertNotNull("Delivered key must have a value: " + key, observed);
            assertEquals("Android restriction type differs for " + key, wanted.getClass(), observed.getClass());
            // Do not dump configuration values into acceptance logs on failure.
            assertTrue("Android restriction value differs for " + key, Objects.equals(wanted, observed));
        }
    }
}
