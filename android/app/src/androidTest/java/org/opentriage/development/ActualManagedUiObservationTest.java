package org.opentriage.development;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.RestrictionsManager;
import android.os.Bundle;
import android.util.Base64;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** External-MDM observations only: no policy writes, controller, login or vault mutation. */
@RunWith(AndroidJUnit4.class)
public class ActualManagedUiObservationTest {
    private ActivityScenario<MainActivity> activity;
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    private final Bundle arguments = InstrumentationRegistry.getArguments();
    private static final String PERSONAL_UI = ".session-identity, input[name=username], input[type=password], input[type=file], .call-directory, .stationary-record-workspace, .review-workspace, .encounter-summary";

    @Test public void deliveredPolicyFingerprint() throws Exception {
        Bundle actual = context.getSystemService(RestrictionsManager.class).getApplicationRestrictions();
        assertNotNull(actual);
        var rows = new org.json.JSONArray();
        for (String key : new java.util.TreeSet<>(actual.keySet())) {
            Object value = actual.get(key);
            rows.put(new org.json.JSONArray().put(key).put(value == null ? "null" : value.getClass().getSimpleName()).put(value));
        }
        StringBuilder hash = new StringBuilder();
        for (byte value : MessageDigest.getInstance("SHA-256").digest(rows.toString().getBytes(StandardCharsets.UTF_8))) hash.append(String.format("%02x", value & 255));
        Bundle result = new Bundle();
        result.putString("managedPolicySha256", hash.toString());
        result.putInt("managedPolicyKeyCount", actual.size());
        InstrumentationRegistry.getInstrumentation().sendStatus(0, result);
    }

    private String required(String name) {
        String value = arguments.getString(name, "");
        assertFalse("Required operator argument missing: " + name, value.isEmpty());
        return value;
    }
    private String evaluate(String script) throws Exception {
        AtomicReference<String> value = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        activity.onActivity(screen -> screen.getBridge().getWebView().evaluateJavascript(script, result -> {
            value.set(result); done.countDown();
        }));
        assertTrue("UI observation timed out", done.await(15, TimeUnit.SECONDS));
        return value.get();
    }
    private void waitFor(String expression) throws Exception {
        long deadline = System.currentTimeMillis() + 45000;
        while (System.currentTimeMillis() < deadline) {
            if ("true".equals(evaluate("Boolean(" + expression + ")"))) return;
            Thread.sleep(150);
        }
        // Never include expressions, page text, artifacts or credentials in failure output.
        fail("Expected managed UI state did not appear within 45 seconds");
    }
    private byte[] sealed() {
        String value = context.getSharedPreferences("connection-v1", Context.MODE_PRIVATE).getString("encrypted", null);
        assertNotNull("Existing sealed connection must be present", value);
        return value.getBytes(StandardCharsets.UTF_8);
    }
    private void reportDigest(String phase, byte[] bytes) throws Exception {
        StringBuilder hash = new StringBuilder();
        for (byte value : MessageDigest.getInstance("SHA-256").digest(bytes)) hash.append(String.format("%02x", value & 255));
        Bundle result = new Bundle(); result.putString("managedObservationPhase", phase);
        result.putString("sealedConnectionSha256", hash.toString());
        InstrumentationRegistry.getInstrumentation().sendStatus(0, result);
    }
    private void assertNoEditableOrigin() throws Exception {
        assertEquals("Managed server must not expose an editable URL", "true", evaluate(
            "!Array.from(document.querySelectorAll('input[type=url]')).some(input=>!input.disabled&&!input.readOnly)"));
    }
    private void assertManagedOrigin() throws Exception {
        String origin = required("expectedManagedOrigin");
        Bundle restrictions = context.getSystemService(RestrictionsManager.class).getApplicationRestrictions();
        assertTrue("Actual policy must retain typed managed origin", restrictions.get("serverOrigin") instanceof String);
        assertTrue("Actual policy must match the operator-approved origin", origin.equals(restrictions.getString("serverOrigin")));
        assertNoEditableOrigin();
    }

    @Test public void pairingConflict() throws Exception {
        assertNull("Conflict probe requires a fresh unpaired app", context.getSharedPreferences("connection-v1", Context.MODE_PRIVATE).getString("encrypted", null));
        String artifact = new String(Base64.decode(required("artifactBase64"), Base64.NO_WRAP), StandardCharsets.UTF_8);
        new JSONObject(artifact); // Validate syntax without logging the one-use artifact.
        String origin = required("expectedManagedOrigin");
        activity = ActivityScenario.launch(MainActivity.class);
        try {
            waitFor("document.querySelector('input[type=file]') && document.querySelector('.android-managed-connection')");
            assertManagedOrigin();
            assertEquals("Managed origin must be shown during pairing", "true", evaluate(
                "document.querySelector('.android-managed-connection').textContent.includes(" + JSONObject.quote(origin) + ")"));
            AndroidUiInput.importPairing(this::evaluate, this::waitFor, artifact);
            waitFor("Array.from(document.querySelectorAll('[role=alert]')).some(node=>node.textContent.includes('Pairing conflicts with the managed connection.')) && document.querySelector('input[type=file]') && !document.querySelector('input[type=file]').disabled");
            assertEquals("Conflicting artifact must not expose enrollment confirmation or personal UI", "true", evaluate(
                "!document.querySelector('input[type=checkbox],input[maxlength=\"100\"],input[name=username],.session-identity,.call-directory')"));
            assertNull("Rejected preview must not create sealed enrollment", context.getSharedPreferences("connection-v1", Context.MODE_PRIVATE).getString("encrypted", null));
            assertManagedOrigin();
        } finally { activity.close(); }
    }

    @Test public void managedBlocked() throws Exception {
        String alert = required("expectedAlertText");
        assertTrue("Use an exact known English managed-policy message", Set.of(
            "Managed settings are missing. Contact IT.",
            "Managed settings are invalid. Contact IT.",
            "The managed connection changed. Contact IT to restore or reassign this installation."
        ).contains(alert));
        byte[] before = sealed();
        activity = ActivityScenario.launch(MainActivity.class);
        try {
            waitFor("Array.from(document.querySelectorAll('[role=alert]')).some(node=>node.textContent.includes(" + JSONObject.quote(alert) + ")) && !document.querySelector(" + JSONObject.quote(PERSONAL_UI) + ")");
            assertNoEditableOrigin();
            // Observe a stable blocked state, not merely the first frame during startup.
            Thread.sleep(1000);
            assertEquals("Blocked policy must hide personal, login, pairing and clinical workspace UI", "true", evaluate(
                "!document.querySelector(" + JSONObject.quote(PERSONAL_UI) + ")"));
            assertTrue("Blocked activity launch must preserve exact sealed envelope bytes", Arrays.equals(before, sealed()));
            reportDigest("managed-blocked", before);
        } finally { activity.close(); }
        assertTrue("Closing blocked activity must preserve exact sealed envelope bytes", Arrays.equals(before, sealed()));
    }

    @Test public void managedRestored() throws Exception {
        sealed();
        activity = ActivityScenario.launch(MainActivity.class);
        try {
            waitFor("document.querySelector('.session-identity') && document.querySelector('.call-directory') && !document.querySelector('input[name=username],input[type=password],input[type=file]')");
            assertManagedOrigin();
            ConnectionVault vault = new ConnectionVault(context);
            var connection = vault.read();
            assertNotNull("Original encrypted connection must remain decryptable", connection);
            assertTrue("Decrypted native connection must match the restored managed endpoint", required("expectedManagedOrigin").equals(connection.origin));
            var cookies = connection.saved().getJSONArray("cookies");
            boolean personal = false, installation = false;
            for (int i = 0; i < cookies.length(); i++) {
                JSONObject cookie = cookies.getJSONObject(i);
                boolean live = cookie.optLong("expires", 0) > System.currentTimeMillis() && !cookie.optString("value").isEmpty();
                if (live && "open_triage_session".equals(cookie.optString("name"))) personal = true;
                if (live && "open_triage_installation".equals(cookie.optString("name"))) installation = true;
            }
            assertTrue("Native personal and installation credentials must remain present and unexpired", personal && installation);
            assertNotNull("Native personal continuation must remain present", vault.personalContinuation());
            reportDigest("managed-restored", sealed());
        } finally { activity.close(); }
    }
}
