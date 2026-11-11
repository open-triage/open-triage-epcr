package org.opentriage.development;

import static org.junit.Assert.*;
import android.content.Context;
import android.util.Base64;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.lifecycle.Lifecycle;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.UUID;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Real DevicePolicyManager delivery from a separate test controller; no production test hooks. */
@RunWith(AndroidJUnit4.class)
public class ManagedConfigurationJourneyTest {
    private ActivityScenario<MainActivity> activity;
    private String evaluate(String script) throws Exception {
        AtomicReference<String> value = new AtomicReference<>(); CountDownLatch done = new CountDownLatch(1);
        activity.onActivity(screen -> screen.getBridge().getWebView().evaluateJavascript(script, result -> { value.set(result); done.countDown(); }));
        assertTrue("WebView evaluation timed out", done.await(15, TimeUnit.SECONDS)); return value.get();
    }
    private void waitFor(String expression) throws Exception {
        long end = System.currentTimeMillis() + 45000;
        while (System.currentTimeMillis() < end) {
            if ("true".equals(evaluate("Boolean(" + expression + ")"))) return;
            Thread.sleep(150);
        }
        fail("Managed UI condition failed: " + expression + " body=" + evaluate("document.body.innerText.slice(0,1800)"));
    }
    private void policy(JSONObject values) throws Exception {
        String encoded = Base64.encodeToString(values.toString().getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
        String command = "am broadcast --include-stopped-packages -a org.opentriage.managementtest.SET_CONFIGURATION -n org.opentriage.managementtest/.ConfigurationReceiver --es configurationBase64 " + encoded;
        try (var descriptor = InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command);
             var input = new FileInputStream(descriptor.getFileDescriptor())) {
            assertTrue("Standard policy delivery must succeed", new String(input.readAllBytes(), StandardCharsets.UTF_8).contains("result=0"));
        }
    }
    private JSONObject config(JSONObject artifact) throws Exception {
        return new JSONObject().put("configurationVersion", 1).put("serverOrigin", artifact.getString("origin")).put("publicCaPem", artifact.getString("caPem"));
    }
    private void importFile(String artifact) throws Exception {
        evaluate("(()=>{const input=document.querySelector('input[type=file]');const files=new DataTransfer();files.items.add(new File([" + JSONObject.quote(artifact) + "],'pairing.json',{type:'application/json'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
    }
    private void requestStatus(String path) throws Exception {
        evaluate("window.__managedResult=null;fetch(" + JSONObject.quote(path) + ").then(async response=>{window.__managedResult={status:response.status,body:await response.json()}}).catch(()=>{window.__managedResult={status:0}})");
        waitFor("window.__managedResult");
    }
    private String holdRequest(JSONObject artifact) throws Exception {
        String id = UUID.randomUUID().toString();
        evaluate("window.__heldManagementResult=null;fetch('/api/__android-managed-hold?requestId=" + id + "').then(response=>{window.__heldManagementResult=response.status}).catch(()=>{window.__heldManagementResult=0})");
        TrustedConnection probe = new TrustedConnection(artifact.getString("origin"), artifact.getString("caPem"));
        long deadline = System.currentTimeMillis() + 10000;
        while (System.currentTimeMillis() < deadline) {
            var observed = probe.request("/api/__android-managed-hold-started?requestId=" + id, "GET", new JSONObject(), null);
            if (new JSONObject(observed.body()).getBoolean("pending")) return id;
            Thread.sleep(30);
        }
        fail("Fixture must acknowledge an actual in-flight native request");
        return null;
    }
    private void releaseRequest(JSONObject artifact, String id) throws Exception {
        TrustedConnection probe = new TrustedConnection(artifact.getString("origin"), artifact.getString("caPem"));
        var response = probe.request("/api/__android-managed-hold-release?requestId=" + id, "GET", new JSONObject(), null);
        assertTrue("Held fixture request must remain pending through the tested transition", new JSONObject(response.body()).getBoolean("released"));
    }
    @Test public void standardManagementLocksAndSafelyTransitionsTheGenericApk() throws Exception {
        var devicePolicy = InstrumentationRegistry.getInstrumentation().getTargetContext().getSystemService(android.app.admin.DevicePolicyManager.class);
        assertFalse("Clinical app must remain an ordinary managed application", devicePolicy.isDeviceOwnerApp("org.opentriage.development"));
        assertTrue("Separate standard test controller owns only the disposable test device", devicePolicy.isDeviceOwnerApp("org.opentriage.managementtest"));
        var arguments = InstrumentationRegistry.getArguments();
        JSONObject artifact = new JSONObject(new String(Base64.decode(arguments.getString("artifactBase64", ""), Base64.NO_WRAP), StandardCharsets.UTF_8));
        JSONObject original = config(artifact);
        policy(new JSONObject().put("restrictions_pending", true));
        activity = ActivityScenario.launch(MainActivity.class);
        try {
            waitFor("document.querySelector('[role=alert]') && !document.querySelector('input[type=file]')");
            policy(new JSONObject().put("restrictions_pending", false));
            waitFor("document.querySelector('[role=alert]').textContent.includes('missing')");
            policy(original);
            waitFor("document.querySelector('input[type=file]') && document.querySelector('.android-managed-connection')");
            evaluate("window.__originalManagedContext=document.querySelector('.android-managed-connection').dataset.managedContext");
            assertEquals("Managed endpoint is visible and cannot be edited", "true", evaluate("document.querySelector('.android-managed-connection').textContent.includes(" + JSONObject.quote(artifact.getString("origin")) + ") && !document.querySelector('input[type=url]')"));
            // Even a valid code/CA for another installation must be rejected before any transfer.
            importFile(new JSONObject(artifact.toString()).put("origin", arguments.getString("wrongOrigin")).toString());
            waitFor("document.querySelector('[role=alert]') && !document.querySelector('input[type=file]').disabled");
            assertEquals("true", evaluate("document.querySelector('[role=alert]').textContent.includes('conflicts')"));
            assertEquals("null", evaluate("document.querySelector('input[type=checkbox]')"));
            // System-CA mode is a supported explicit setting, never trust-on-first-use.
            // On this private-CA fixture it must reject the imported app-specific CA as a conflict.
            policy(new JSONObject(original.toString()).put("publicCaPem", ""));
            waitFor("document.querySelector('.android-managed-connection').dataset.managedContext !== window.__originalManagedContext");
            importFile(artifact.toString());
            waitFor("document.querySelector('[role=alert]') && !document.querySelector('input[type=file]').disabled");
            assertEquals("null", evaluate("document.querySelector('input[type=checkbox]')"));
            policy(original);
            waitFor("document.querySelector('.android-managed-connection').dataset.managedContext === window.__originalManagedContext");
            importFile(artifact.toString());
            waitFor("document.querySelector('input[type=checkbox]')");
            evaluate("(()=>{const input=document.querySelector('input[maxlength=\"100\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Managed emulator ambulance');input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('input[type=checkbox]').click();})()");
            waitFor("!document.querySelector('button[type=submit]').disabled");
            evaluate("document.querySelector('form').requestSubmit()");
            waitFor("document.querySelector('input[name=username]')");
            requestStatus("/api/sessions/current");
            assertEquals("Device policy and enrollment do not sign in a clinician", "401", evaluate("window.__managedResult.status"));
            requestStatus("/api/installations/current");
            assertEquals("true", evaluate("window.__managedResult.body.enrolled"));
            String unchangedRequest = holdRequest(artifact);
            activity.moveToState(Lifecycle.State.CREATED); activity.moveToState(Lifecycle.State.RESUMED);
            releaseRequest(artifact, unchangedRequest);
            waitFor("window.__heldManagementResult !== null");
            assertEquals("Unchanged-policy resume must preserve an in-flight request", "200", evaluate("window.__heldManagementResult"));
            String savedVault = InstrumentationRegistry.getInstrumentation().getTargetContext().getSharedPreferences("connection-v1", Context.MODE_PRIVATE).getString("encrypted", null);
            assertNotNull(savedVault);

            String changedRequest = holdRequest(artifact);
            policy(new JSONObject().put("restrictions_pending", true));
            waitFor("document.querySelector('[role=alert]') && !document.querySelector('input[name=username]')");
            releaseRequest(artifact, changedRequest);
            waitFor("window.__heldManagementResult !== null");
            assertEquals("A genuine policy change must discard an in-flight response", "0", evaluate("window.__heldManagementResult"));
            requestStatus("/api/installations/current"); assertEquals("0", evaluate("window.__managedResult.status"));
            policy(new JSONObject());
            waitFor("document.querySelector('[role=alert]').textContent.includes('missing')");
            activity.recreate();
            waitFor("document.querySelector('[role=alert]') && !document.querySelector('input[type=file]')");
            assertEquals("Removed policy never exposes a remembered editable connection", "null", evaluate("document.querySelector('input[name=username]')"));

            policy(new JSONObject(original.toString()).put("configurationVersion", "1"));
            waitFor("document.querySelector('[role=alert]').textContent.includes('invalid')");
            policy(new JSONObject(original.toString()).put("serverOrigin", arguments.getString("wrongOrigin")));
            waitFor("document.querySelector('[role=alert]').textContent.includes('changed')");
            requestStatus("/api/installations/current"); assertEquals("0", evaluate("window.__managedResult.status"));
            policy(new JSONObject(original.toString()).put("publicCaPem", ""));
            waitFor("document.querySelector('[role=alert]').textContent.includes('changed') && document.querySelector('.android-managed-connection').textContent.includes(" + JSONObject.quote(artifact.getString("origin")) + ")");
            assertEquals("Blocked policy transitions must preserve encrypted credentials", savedVault,
                InstrumentationRegistry.getInstrumentation().getTargetContext().getSharedPreferences("connection-v1", Context.MODE_PRIVATE).getString("encrypted", null));
            policy(original);
            waitFor("document.querySelector('input[name=username]')");
            requestStatus("/api/installations/current"); assertEquals("true", evaluate("window.__managedResult.body.enrolled"));
            activity.recreate(); waitFor("document.querySelector('input[name=username]')");
        } finally { activity.close(); policy(new JSONObject()); }
    }
    @Test public void missingPolicyRemainsLockedAfterProcessRestart() throws Exception {
        // The host runner force-stops the actual app between the main journey and this phase.
        // App data is retained: only a persisted management marker and encrypted enrollment can restore state.
        var arguments = InstrumentationRegistry.getArguments();
        JSONObject artifact = new JSONObject(new String(Base64.decode(arguments.getString("artifactBase64", ""), Base64.NO_WRAP), StandardCharsets.UTF_8));
        activity = ActivityScenario.launch(MainActivity.class);
        try {
            waitFor("document.querySelector('[role=alert]') && document.querySelector('[role=alert]').textContent.includes('missing')");
            assertEquals("Restart cannot turn removed managed settings into manual setup", "null", evaluate("document.querySelector('input[type=file]')"));
            assertEquals("null", evaluate("document.querySelector('input[name=username]')"));
            assertNotNull(InstrumentationRegistry.getInstrumentation().getTargetContext().getSharedPreferences("connection-v1", Context.MODE_PRIVATE).getString("encrypted", null));
            policy(config(artifact));
            waitFor("document.querySelector('input[name=username]')");
            requestStatus("/api/installations/current");
            assertEquals("Encrypted enrollment survives a real app process restart", "true", evaluate("window.__managedResult.body.enrolled"));
            assertEquals("true", evaluate("window.__managedResult.body.installation.name==='Managed emulator ambulance'"));
        } finally { activity.close(); policy(new JSONObject()); }
    }
}
