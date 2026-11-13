package org.opentriage.development;

import static org.junit.Assert.*;
import android.content.Context;
import android.util.Base64;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;

/** Real native TLS and the existing confirmed replacement UI; no TLS or crypto mocks. */
public class TlsRotationJourneyTest {
    private ActivityScenario<MainActivity> activity;
    private static Context context() { return InstrumentationRegistry.getInstrumentation().getTargetContext(); }
    private static String digest(String value) throws Exception {
        byte[] bytes=java.security.MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        var result=new StringBuilder();for(byte item:bytes)result.append(String.format(java.util.Locale.ROOT,"%02x",item&255));return result.toString();
    }
    static void snapshotIdentity() throws Exception {
        var connection=new ConnectionVault(context()).read();
        assertNotNull(connection);
        assertTrue(context().getSharedPreferences("tls-journey-v1",Context.MODE_PRIVATE).edit()
            .putString("identity",digest(connection.saved().toString())).putInt("uid",context().getApplicationInfo().uid).commit());
    }
    private String evaluate(String expression) throws Exception {
        var result=new AtomicReference<String>();var done=new CountDownLatch(1);
        activity.onActivity(screen->screen.getBridge().getWebView().evaluateJavascript(expression,value->{result.set(value);done.countDown();}));
        assertTrue("WebView evaluation completed",done.await(15,TimeUnit.SECONDS));return result.get();
    }
    private void waitFor(String expression) throws Exception {
        long end=System.currentTimeMillis()+45000;
        while(System.currentTimeMillis()<end){if("true".equals(evaluate("Boolean("+expression+")")))return;Thread.sleep(100);}
        fail("TLS fixture UI condition failed: "+expression);
    }
    private void input(String selector,String value) throws Exception {
        waitFor("document.querySelector("+JSONObject.quote(selector)+")");
        evaluate("(()=>{const input=document.querySelector("+JSONObject.quote(selector)+");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,"+JSONObject.quote(value)+");input.dispatchEvent(new Event('input',{bubbles:true}));})()");
    }
    private String retained(String expected) throws Exception {
        evaluate("window.__retained=null;(()=>{const request=indexedDB.open('open-triage-protected-clinical-v1');request.onupgradeneeded=()=>{request.transaction.abort();window.__retained=[]};request.onsuccess=()=>{const db=request.result;const query=db.transaction('encrypted-reports').objectStore('encrypted-reports').getAll();query.onsuccess=()=>{window.__retained=query.result.map(row=>({...row,ciphertext:Array.from(new Uint8Array(row.ciphertext)),nonce:Array.from(new Uint8Array(row.nonce))}));db.close()}}})()");
        waitFor("window.__retained!==null");
        String actual=digest(evaluate("JSON.stringify(window.__retained)"));
        if(expected!=null&&!expected.isEmpty())assertEquals("Only an opaque digest is compared; failed trust must retain the exact pending record",expected,actual);
        assertEquals("true",evaluate("!JSON.stringify(window.__retained).includes('ANDROID-RETAINED-SYNTHETIC')"));
        return actual;
    }
    private JSONObject artifact(String name) throws Exception {
        return new JSONObject(new String(Base64.decode(InstrumentationRegistry.getArguments().getString(name,""),Base64.NO_WRAP),StandardCharsets.UTF_8));
    }
    private void importArtifact(JSONObject value) throws Exception {
        waitFor("document.querySelector('input[type=file]') && !document.querySelector('input[type=file]').disabled");
        evaluate("(()=>{const input=document.querySelector('input[type=file]'),files=new DataTransfer();files.items.add(new File(["+JSONObject.quote(value.toString())+"],'pairing.json',{type:'application/json'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()");
    }
    private void policy(JSONObject artifact) throws Exception {
        String encoded=Base64.encodeToString(new JSONObject().put("configurationVersion",1).put("serverOrigin",artifact.getString("origin")).put("publicCaPem",artifact.getString("caPem")).toString().getBytes(StandardCharsets.UTF_8),Base64.NO_WRAP);
        try(var descriptor=InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand("am broadcast --include-stopped-packages -a org.opentriage.managementtest.SET_CONFIGURATION -n org.opentriage.managementtest/.ConfigurationReceiver --es configurationBase64 "+encoded);
            var stream=new java.io.FileInputStream(descriptor.getFileDescriptor())) {
            assertTrue(new String(stream.readAllBytes(),StandardCharsets.UTF_8).contains("result=0"));
        }
    }
    private String intentDigest(JSONObject pending) throws Exception {
        return digest(new JSONObject().put("body",pending.getJSONObject("body")).put("origin",pending.getJSONObject("candidate").getString("origin"))
            .put("cookies",pending.getJSONObject("candidate").getJSONArray("cookies")).put("createdAt",pending.getLong("createdAt")).toString());
    }
    private void radios(boolean enabled) throws Exception {
        for(String radio:new String[]{"wifi","data"})try(var descriptor=InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand("svc "+radio+" "+(enabled?"enable":"disable"));var stream=new java.io.FileInputStream(descriptor.getFileDescriptor())){stream.readAllBytes();}
        waitFor(enabled?"navigator.onLine":"!navigator.onLine");
    }
    private void awaitFixtureNetwork(String origin) throws Exception {
        // No Activity, WebView, TLS, credentials or application request before the one strict proof.
        AndroidFixtureNetwork.await(context(), origin, null, true);
    }
    @Test public void certificateRotationPreservesProtectedWork() throws Exception {
        var args=InstrumentationRegistry.getArguments();String phase=args.getString("tlsPhase","");
        var vault=new ConnectionVault(context());
        if(phase.equals("renewal-proof")||phase.equals("failure"))awaitFixtureNetwork(vault.read().origin);
        if(phase.equals("renewal-proof")) {
            var connection=vault.read();var saved=context().getSharedPreferences("tls-journey-v1",Context.MODE_PRIVATE);
            assertEquals(saved.getInt("uid",-1),context().getApplicationInfo().uid);
            assertEquals("Renewal does not change native login, installation, origin or CA",saved.getString("identity",null),digest(connection.saved().toString()));
            assertEquals("The original still-valid login works against the renewed certificate without another sign-in",200,connection.request("/api/sessions/current","GET",new JSONObject(),null).status());
            assertEquals(200,connection.request("/api/installations/current","GET",new JSONObject(),null).status());
            assertEquals(saved.getString("identity",null),digest(connection.saved().toString()));return;
        }
        if(phase.equals("expired-trust")) {
            String ca=new String(Base64.decode(args.getString("expiredCaBase64",""),Base64.NO_WRAP),StandardCharsets.UTF_8);
            var expired=TrustedConnection.restore(vault.read().saved().put("caPem",ca));vault.write(expired);
            assertThrows(java.security.cert.CertificateExpiredException.class,()->new ConnectionVault(context()).read().request("/api/health","GET",new JSONObject(),null));return;
        }
        if(phase.equals("pending-policy")) { policy(artifact("artifactBase64"));return; }
        if(phase.equals("managed-establish")) policy(artifact("artifactBase64"));
        String before=context().getSharedPreferences("connection-v1",Context.MODE_PRIVATE).getString("encrypted",null);
        activity=ActivityScenario.launch(MainActivity.class);
        try {
            if(phase.startsWith("pending-") && !phase.equals("pending-offline") && !phase.equals("pending-live")) {
                waitFor("document.querySelector('[data-pending-enrollment]')");
                String intent=intentDigest(vault.pending());
                if(args.containsKey("pendingIntentSha256"))assertEquals(args.getString("pendingIntentSha256"),intent);
                if(phase.equals("pending-trust")) {
                    importArtifact(artifact("artifactBase64"));waitFor("document.querySelector('input[type=checkbox]')");
                    evaluate("document.querySelector('input[type=checkbox]').click()");waitFor("!document.querySelector('button[type=submit]').disabled");evaluate("document.querySelector('form').requestSubmit()");
                    waitFor("document.querySelector('[data-pending-enrollment] input[type=file]')");
                    assertEquals("Trust confirmation preserves the immutable journal intent",intent,intentDigest(vault.pending()));
                    assertTrue(ManagedConnectionPolicy.context(vault.pending().getJSONObject("candidate").getString("origin"),vault.pending().getJSONObject("candidate").getString("caPem")).equals(ManagedConnectionPolicy.context(artifact("artifactBase64").getString("origin"),artifact("artifactBase64").getString("caPem"))));
                } else {
                    if(phase.equals("pending-retry")) {
                        var original=TrustedConnection.restore(vault.pending().getJSONObject("candidate"));
                        assertEquals("The original 15-minute POST retry window remains closed",401,original.request("/api/installations/enroll","POST",new JSONObject().put("content-type","application/json").put("x-installation-enrollment","1"),vault.pending().getJSONObject("body").toString()).status());
                    }
                    evaluate("Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='Retry confirmed pairing').click()");
                    if(phase.equals("pending-retry")) {
                        waitFor("document.querySelector('input[name=username]')");assertNull(vault.pending());
                        assertEquals(200,vault.read().request("/api/installations/current","GET",new JSONObject(),null).status());
                        var cookies=vault.read().saved().getJSONArray("cookies");for(int index=0;index<cookies.length();index++)assertFalse(cookies.getJSONObject(index).getString("name").equals("open_triage_session")&&!cookies.getJSONObject(index).getString("value").isEmpty());
                    } else {
                        waitFor("document.querySelector('[data-pending-enrollment] [role=alert]')");
                        assertNotNull(vault.pending());assertEquals(intent,intentDigest(vault.pending()));
                        if(phase.equals("pending-not-committed")) {
                            waitFor("Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()==='Use a new pairing code' && !button.disabled)");
                            evaluate("Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='Use a new pairing code').click()");
                            waitFor("!document.querySelector('[data-pending-enrollment]') && document.querySelector('input[type=file]')");assertNull(vault.pending());
                            evaluate("Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='Return to current installation').click()");waitFor("document.querySelector('input[name=username]')");
                        } else assertEquals("No unknown, missing-endpoint or revoked result can enable journal abandonment","false",evaluate("Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()==='Use a new pairing code')"));
                    }
                }
                retained(args.getString("retainedSha256"));return;
            }
            if(phase.equals("managed-establish")) {
                waitFor("document.querySelector('input[name=username]')");
                var state=new ManagedConfiguration(context()).refresh();assertTrue(state.managed());assertTrue(state.matches(vault.read()));
                retained(args.getString("retainedSha256"));return;
            }
            if(phase.equals("failure")) {
                waitFor("document.querySelector('[role=alert],.session-identity')");
                evaluate("window.__tlsResult=null;fetch('/api/installations/current').then(response=>window.__tlsResult={status:response.status}).catch(error=>window.__tlsResult={code:error.code})");
                waitFor("window.__tlsResult");assertEquals(JSONObject.quote("TLS_FAILED"),evaluate("window.__tlsResult.code"));
                waitFor("document.querySelector('[data-android-tls-failure]')");
                assertEquals("true",evaluate("!document.querySelector('.encounter-header') && !document.body.innerText.includes('ANDROID-RETAINED-SYNTHETIC')"));
                assertTrue("Failed TLS cannot replace the saved connection or credentials",java.util.Objects.equals(before,context().getSharedPreferences("connection-v1",Context.MODE_PRIVATE).getString("encrypted",null)));
                retained(args.getString("retainedSha256"));return;
            }
            JSONObject next=artifact("artifactBase64");
            if(phase.equals("managed-replace") || phase.equals("managed-conflict")) {
                policy(next);waitFor("document.querySelector('[data-managed-status=changed]')");
                assertFalse(context().getSystemService(android.app.admin.DevicePolicyManager.class).isDeviceOwnerApp(context().getPackageName()));
            }
            waitFor("document.querySelector('[role=alert],.session-identity')");evaluate("window.dispatchEvent(new Event('open-triage.android-replace-installation'))");
            if(phase.equals("managed-replace") || phase.equals("managed-conflict")) {
                var conflict=new JSONObject(next.toString()).put("caPem",artifact("oldArtifactBase64").getString("caPem"));
                importArtifact(conflict);waitFor("document.querySelector('[role=alert]') && !document.querySelector('input[type=file]').disabled");
                assertEquals("true",evaluate("document.querySelector('[role=alert]').textContent.includes('conflicts')"));
                if(phase.equals("managed-conflict")) { retained(args.getString("retainedSha256"));return; }
            }
            importArtifact(next);waitFor("document.querySelector('input[type=checkbox]')");
            retained(args.getString("retainedSha256"));
            if(phase.equals("preview")) {
                assertTrue("An interrupted preview cannot promote trust or credentials",java.util.Objects.equals(before,context().getSharedPreferences("connection-v1",Context.MODE_PRIVATE).getString("encrypted",null)));return;
            }
            AndroidUiInput.installationName(this::evaluate,this::waitFor,"TLS rotation ambulance");evaluate("document.querySelector('input[type=checkbox]').click()");
            if(phase.equals("pending-offline"))radios(false);
            waitFor("!document.querySelector('button[type=submit]').disabled");evaluate("document.querySelector('form').requestSubmit()");
            if(phase.equals("pending")||phase.equals("pending-offline")||phase.equals("pending-live")) {
                waitFor("document.querySelector('[data-pending-enrollment]')");assertNotNull(vault.pending());
                String retained=retained(args.getString("retainedSha256"));
                var result=new android.os.Bundle();result.putString("pending_token_sha256",digest(vault.pending().getJSONObject("body").getString("token")));
                result.putString("pending_intent_sha256",intentDigest(vault.pending()));result.putString("retained_sha256",retained);
                if(phase.equals("pending-live")) {
                    result.putString("opentriage_phase","pending-confirmation-ready");
                    InstrumentationRegistry.getInstrumentation().sendStatus(2,result);
                    // The host must kill this live Activity after all durable-state
                    // assertions, rather than observing normal JUnit cleanup.
                    while(true)Thread.sleep(1000);
                }
                InstrumentationRegistry.getInstrumentation().addResults(result);return;
            }
            waitFor("document.querySelector('input[name=username]')");retained(args.getString("retainedSha256"));
            var approved=new ConnectionVault(context()).read();
            assertTrue("Only explicitly approved public CA identity is promoted",ManagedConnectionPolicy.context(approved.origin,approved.caPem).equals(ManagedConnectionPolicy.context(next.getString("origin"),next.getString("caPem"))));
        } finally { activity.close(); }
    }
}
