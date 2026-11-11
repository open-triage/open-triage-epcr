package org.opentriage.development;

import static org.junit.Assert.*;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Runs the actual bundled React UI against the real synthetic API, not mocked browser requests. */
@RunWith(AndroidJUnit4.class)
public class PairingJourneyTest {
    private ActivityScenario<MainActivity> activity;
    private String evaluate(String script) throws Exception {
        AtomicReference<String> value = new AtomicReference<>(); CountDownLatch done = new CountDownLatch(1);
        activity.onActivity(screen -> screen.getBridge().getWebView().evaluateJavascript(script, result -> { value.set(result); done.countDown(); }));
        assertTrue("WebView evaluation timed out", done.await(15, TimeUnit.SECONDS));
        return value.get();
    }
    private void waitFor(String expression) throws Exception {
        long end = System.currentTimeMillis() + 45000;
        while (System.currentTimeMillis() < end) {
            if ("true".equals(evaluate("Boolean(" + expression + ")"))) return;
            Thread.sleep(150);
        }
        fail("UI condition failed: " + expression + " body=" + evaluate("document.body.innerText.slice(0,1800)"));
    }
    private void importFile(String artifact) throws Exception {
        evaluate("(()=>{const input=document.querySelector('input[type=file]');const files=new DataTransfer();files.items.add(new File([" + JSONObject.quote(artifact) + "],'pairing.json',{type:'application/json'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
    }
    private void rejected(String artifact) throws Exception {
        importFile(artifact);
        waitFor("document.querySelector('[role=alert]') && !document.querySelector('input[type=file]').disabled");
        assertEquals("Failed setup must remain unconfigured", "true", evaluate("Boolean(document.querySelector('input[type=file]'))"));
        assertEquals("Failed setup cannot expose confirmation", "null", evaluate("document.querySelector('input[type=checkbox]')"));
    }
    private void setInput(String selector, String value) throws Exception {
        evaluate("(()=>{const input=document.querySelector(" + JSONObject.quote(selector) + ");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input," + JSONObject.quote(value) + ");input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()");
    }
    @Test public void importConfirmLoginAssignedCallsLogoutAndRetainPairing() throws Exception {
        var arguments = InstrumentationRegistry.getArguments();
        String artifact = new String(android.util.Base64.decode(arguments.getString("artifactBase64", ""), android.util.Base64.NO_WRAP), StandardCharsets.UTF_8);
        assertFalse("Runner must provide a fresh synthetic pairing artifact", artifact.isEmpty());
        String username = arguments.getString("username", "android.clinician"), password = arguments.getString("password", "AndroidFixtureClinician123!");
        activity = ActivityScenario.launch(MainActivity.class);
        try {
            waitFor("document.querySelector('input[type=file]')");
            rejected("{broken");
            rejected(new JSONObject(artifact).put("expiresAt", "2000-01-01T00:00:00Z").toString());
            rejected(new JSONObject(artifact).put("token", "b".repeat(43)).toString());
            rejected(new JSONObject(artifact).put("caPem", "").toString());
            String wrongOrigin = arguments.getString("wrongOrigin");
            if (wrongOrigin != null) rejected(new JSONObject(artifact).put("origin", wrongOrigin).toString());
            // Exercise the same File/change entry point as Android's document picker.
            importFile(artifact);
            waitFor("document.querySelector('input[type=checkbox]')");
            assertFalse("Preview must not enroll or mount clinician UI", "true".equals(evaluate("Boolean(document.querySelector('input[name=username]'))")));
            setInput("input[maxlength='100']", "Synthetic emulator ambulance");
            evaluate("document.querySelector('input[type=checkbox]').click()");
            waitFor("!document.querySelector('button[type=submit]').disabled");
            evaluate("document.querySelector('form').requestSubmit()");
            waitFor("document.querySelector('input[name=username]')");
            setInput("input[name=username]", username); setInput("input[name=password]", password);
            evaluate("document.querySelector('.login-sign-in').requestSubmit()");
            waitFor("document.querySelector('.session-identity') && document.querySelector('.call-directory')");
            assertEquals("Mobile must be the initial clinical mode", "true", evaluate("Boolean(document.querySelector('.mobile-shell'))"));
            evaluate("window.__androidResult=null;fetch('/api/calls/assigned').then(async response=>{window.__androidResult={status:response.status,body:await response.json()}}).catch(()=>{window.__androidResult={status:0}})");
            waitFor("window.__androidResult");
            assertEquals("Assigned calls API must authenticate through native cookies", "200", evaluate("window.__androidResult.status"));
            assertNull("Native cookies must not enter Capacitor global handling", java.net.CookieHandler.getDefault());
            assertNull("Remote credentials must not be copied into WebView cookies", android.webkit.CookieManager.getInstance().getCookie(new JSONObject(artifact).getString("origin") + "/api"));
            // Browser-visible JS must never receive the protected cookie credentials.
            assertEquals("true", evaluate("!document.cookie.includes('open_triage_session') && !document.cookie.includes('open_triage_installation')"));
            evaluate("Array.from(document.querySelectorAll('button')).find(button=>['Log out','Logga ut'].includes(button.textContent.trim())).click()");
            waitFor("document.querySelector('input[name=username]')");
            evaluate("window.__androidResult=null;fetch('/api/installations/current').then(async response=>{window.__androidResult=await response.json()})");
            waitFor("window.__androidResult");
            assertEquals("Pairing must survive clinician logout", "true", evaluate("window.__androidResult.enrolled"));
            assertEquals("true", evaluate("window.__androidResult.installation.name==='Synthetic emulator ambulance'"));
            // Cookie vault and provisioned connection survive activity recreation.
            activity.recreate();
            waitFor("document.querySelector('input[name=username]')");
            assertEquals("null", evaluate("document.querySelector('input[type=file]')"));
        } finally { activity.close(); }
    }
}
