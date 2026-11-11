package org.opentriage.development;

import static org.junit.Assert.*;
import android.content.Intent;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Real system browser, signed TLS provider and native Keystore cookie/return boundaries. */
@RunWith(AndroidJUnit4.class)
public class OidcJourneyTest extends PairingJourneyTest {
    private static final String ORGANIZATION_LOGIN = "Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()==='Sign in with your organization'&&!button.disabled)";
    private void input(String selector, String value) throws Exception {
        String element="document.querySelector("+JSONObject.quote(selector)+")";
        waitFor(element+" && !("+element+").matches(':disabled') && !("+element+").readOnly");
        assertEquals("The actual input must be editable","true",evaluate(WebViewTestInput.change(element,value)));
    }
    private void click(String text) throws Exception {
        String button = "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===" + JSONObject.quote(text) + ")";
        waitFor(button + " && !(" + button + ").disabled"); evaluate("(" + button + ").click()");
    }
    private String retainedDigest() throws Exception {
        evaluate("window.__retained=null;(()=>{const request=indexedDB.open('open-triage-protected-clinical-v1');request.onsuccess=()=>{const db=request.result;const query=db.transaction('encrypted-reports').objectStore('encrypted-reports').getAll();query.onsuccess=()=>{window.__retained=query.result.map(row=>({...row,ciphertext:Array.from(new Uint8Array(row.ciphertext)),nonce:Array.from(new Uint8Array(row.nonce))}));db.close();};};})()");
        waitFor("window.__retained!==null");
        assertEquals("1", evaluate("window.__retained.length"));
        byte[] bytes=java.security.MessageDigest.getInstance("SHA-256").digest(evaluate("JSON.stringify(window.__retained)").getBytes(java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder digest=new StringBuilder();for(byte value:bytes)digest.append(String.format(java.util.Locale.ROOT,"%02x",value&255));return digest.toString();
    }
    private void provider(boolean complete) throws Exception {
        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        long deadline = System.currentTimeMillis() + 60000;
        while (System.currentTimeMillis() < deadline) {
            var link = device.findObject(By.text("Continue fictional provider login"));
            if (link != null) {
                if (!complete) return;
                link.click();
                String intendedPackage=InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName();
                long returnDeadline=System.currentTimeMillis()+30000;
                while(System.currentTimeMillis()<returnDeadline){
                    if(intendedPackage.equals(device.getCurrentPackageName()))return;
                    for(String text:new String[]{"Open", "Just once"}){var button=device.findObject(By.text(text));if(button!=null)button.click();}
                    Thread.sleep(200);
                }
                fail("Provider return must reopen the intended APK");
            }
            // Chrome first-run controls only. TLS interstitials are never accepted.
            for (String text : new String[]{"Accept & continue", "Use without an account", "No thanks", "Got it"}) {
                var button = device.findObject(By.text(text)); if (button != null) button.click();
            }
            Thread.sleep(250);
        }
        fail("The trusted external browser must reach the controlled TLS provider without an SSL exception");
    }
    private void pairIfNeeded() throws Exception {
        var arguments = InstrumentationRegistry.getArguments();
        String encoded = arguments.getString("artifactBase64");
        if (encoded == null) return;
        waitFor("document.querySelector('input[type=file]')");
        importFile(new String(android.util.Base64.decode(encoded, android.util.Base64.NO_WRAP), java.nio.charset.StandardCharsets.UTF_8));
        waitFor("document.querySelector('input[type=checkbox]')");
        input("input[maxlength='100']", "OIDC emulator ambulance");
        evaluate("document.querySelector('input[type=checkbox]').click()");
        waitFor("!document.querySelector('button[type=submit]').disabled");
        evaluate("document.querySelector('form').requestSubmit()");
    }
    @Test public void systemBrowserAuthentication() throws Exception {
        var args = InstrumentationRegistry.getArguments();
        String phase = args.getString("phase", "login"), expected = args.getString("expected", "succeeded");
        if(phase.equals("login")&&"isolate".equals(args.getString("protected"))){
            var endpoint=java.net.URI.create(args.getString("apiOrigin"));boolean reachable=false;long networkDeadline=System.currentTimeMillis()+15000;
            while(!reachable&&System.currentTimeMillis()<networkDeadline){try(var socket=new java.net.Socket()){socket.connect(new java.net.InetSocketAddress(endpoint.getHost(),endpoint.getPort()),1000);reachable=true;}catch(java.io.IOException disconnected){Thread.sleep(100);}}
            assertTrue("Reconnect must restore the real API before the revoked outgoing session can be assessed",reachable);
        }
        activity = ActivityScenario.launch(MainActivity.class);
        String sessionStatus=null,observedUser=null;
        try {
            if(phase.equals("pending")){
                waitFor("document.querySelector('.session-identity')");click("Reopen report");waitFor("document.querySelector('.encounter-header')");
                if(!"true".equals(evaluate("Boolean(document.querySelector('[data-element-id=\"ePatient.03\"] input[type=text]'))")))click("Stationary");
                waitFor("document.querySelector('[data-element-id=\"ePatient.03\"] input[type=text]') && !document.querySelector('[data-element-id=\"ePatient.03\"] input[type=text]').matches(':disabled')");
                for(String command:new String[]{"svc wifi disable","svc data disable"}){
                    try(var result=new android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command))){result.readAllBytes();}
                }
                waitFor("!navigator.onLine");
                var endpoint=java.net.URI.create(args.getString("apiOrigin"));
                try(var socket=new java.net.Socket()){socket.connect(new java.net.InetSocketAddress(endpoint.getHost(),endpoint.getPort()),2000);fail("The real API must be unreachable before pending clinical editing");}catch(java.io.IOException disconnected){ /* Actual radio loss. */ }
                input("[data-element-id=\"ePatient.03\"] input[type=text]", "ANDROID-OIDC-PENDING");
                waitFor("document.querySelector('.sync-status')?.textContent==='Pending sync'");
                click("Save & close");waitFor("!document.querySelector('.encounter-header')");
                String digest=retainedDigest();
                assertEquals("Pending ciphertext must be genuinely unacknowledged","true",evaluate("window.__retained[0].synchronizedRevision<window.__retained[0].ciphertextRevision"));
                assertFalse(evaluate("JSON.stringify({...localStorage})+JSON.stringify(window.__retained)").contains("ANDROID-OIDC-PENDING"));
                android.os.Bundle pendingEvidence=new android.os.Bundle();pendingEvidence.putString("retained_sha256",digest);pendingEvidence.putString("retained_pending",evaluate("window.__retained[0].synchronizedRevision<window.__retained[0].ciphertextRevision"));pendingEvidence.putString("retained_ciphertext_revision",evaluate("window.__retained[0].ciphertextRevision"));pendingEvidence.putString("retained_synchronized_revision",evaluate("window.__retained[0].synchronizedRevision"));InstrumentationRegistry.getInstrumentation().sendStatus(0,pendingEvidence);return;
            }
            if (phase.equals("recovery")) {
                waitFor("document.querySelector('.session-identity')");
                String report = args.getString("reportId");
                evaluate("window.__recovery=null;(async()=>{const current=await fetch('/api/sessions/current');const session=await current.json();const headers={'content-type':'application/json','x-csrf-token':session.csrfToken};const grant=await fetch('/api/reports/" + report + "/recovery-grants',{method:'POST',headers,body:JSON.stringify({schemaVersion:1,envelopeVersion:1})});const body=await grant.json();const consume=grant.ok?await fetch('/api/reports/" + report + "/recovery-grants/consume',{method:'POST',headers,body:JSON.stringify({schemaVersion:1,envelopeVersion:body.envelopeVersion,grant:body.grant})}):null;window.__recovery={grant:grant.status,consume:consume?.status};})().catch(()=>window.__recovery={grant:0})");
                waitFor("window.__recovery");
                assertEquals("201", evaluate("window.__recovery.grant"));assertEquals("200", evaluate("window.__recovery.consume"));
                assertEquals("true", evaluate("!document.querySelector('input[type=password]') && !/Confirm your identity|Reauthenticate/.test(document.body.innerText)"));
                return;
            }
            if (phase.equals("resume")) {
                // The browser transaction survived a real host-issued force-stop.
                var context = InstrumentationRegistry.getInstrumentation().getTargetContext();
                // Launching an exported activity does not require the package
                // query visibility that getLaunchIntentForPackage would need.
                // This restores the actual controlled browser's existing tab.
                Intent browser=new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
                    .setPackage("com.android.chrome").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(browser);
            } else {
                pairIfNeeded();
                waitFor(ORGANIZATION_LOGIN + " || document.querySelector('.session-identity')");
                if ("true".equals(evaluate("Boolean(document.querySelector('.session-identity'))"))) click("Log out");
                click("Sign in with your organization");
                provider(false);
                var cookiesAfterBegin = new ConnectionVault(InstrumentationRegistry.getInstrumentation().getTargetContext()).read().saved().getJSONArray("cookies");
                for(int i=0;i<cookiesAfterBegin.length();i++)assertNotEquals("Native initial login clears outgoing cookies rather than storing a tombstone", "open_triage_session", cookiesAfterBegin.getJSONObject(i).getString("name"));
            }
            if (phase.equals("cancel")) {
                UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack();
                var context = InstrumentationRegistry.getInstrumentation().getTargetContext();
                context.startActivity(new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                waitFor(ORGANIZATION_LOGIN);
                assertEquals("null", evaluate("document.querySelector('.session-identity')"));
                return;
            }
            if (phase.equals("prepare")) {
                android.os.Bundle checkpoint = new android.os.Bundle();checkpoint.putString("opentriage_phase", "oidc-ready-for-process-kill");
                InstrumentationRegistry.getInstrumentation().sendStatus(0, checkpoint);
                Thread.sleep(600000);fail("The host must terminate this still-running process");
            }
            JSONObject interruptedReturn=null;
            var targetContext=InstrumentationRegistry.getInstrumentation().getTargetContext();
            if("create".equals(args.getString("protected")))interruptedReturn=new ConnectionVault(targetContext).pendingAuthentication();
            provider(true);
            if (expected.equals("succeeded")) {
                waitFor("document.querySelector('.session-identity')");
                evaluate("window.__oidc=null;fetch('/api/sessions/current').then(async response=>window.__oidc={status:response.status,session:await response.json()})");
                waitFor("window.__oidc");
                assertEquals("200", evaluate("window.__oidc.status"));
                assertEquals(JSONObject.quote(args.getString("userId")), evaluate("window.__oidc.session.user.id"));
                assertEquals("\"oidc\"", evaluate("window.__oidc.session.authenticationSource"));
                sessionStatus=evaluate("window.__oidc.status");observedUser=evaluate("window.__oidc.session.user.id");
                String protectedPhase=args.getString("protected", "");
                if(protectedPhase.equals("create")) {
                    click("Open call");waitFor("document.querySelector('.encounter-header')");
                    if(!"true".equals(evaluate("Boolean(document.querySelector('[data-element-id=\"ePatient.03\"] input[type=text]'))")))click("Stationary");
                    waitFor("document.querySelector('[data-element-id=\"ePatient.03\"] input[type=text]')");
                    input("[data-element-id=\"ePatient.03\"] input[type=text]", "ANDROID-OIDC-PROTECTED");
                    waitFor("document.querySelector('.sync-status')?.textContent==='Saved'");
                    click("Save & close");waitFor("!document.querySelector('.encounter-header')");
                    android.os.Bundle evidence=new android.os.Bundle();evidence.putString("retained_sha256",retainedDigest());InstrumentationRegistry.getInstrumentation().sendStatus(0,evidence);
                    // Simulate abrupt stop between durable issued-cookie storage
                    // and deletion of its now-consumed pending return slot.
                    String issuedExpiry=evaluate("window.__oidc.session.expiresAt");
                    assertNotNull(interruptedReturn);new ConnectionVault(targetContext).pendingAuthentication(interruptedReturn);
                    activity.recreate();waitFor("document.querySelector('.session-identity')");
                    long cleanupDeadline=System.currentTimeMillis()+15000;
                    while(new ConnectionVault(targetContext).pendingAuthentication()!=null&&System.currentTimeMillis()<cleanupDeadline)Thread.sleep(100);
                    assertNull("An already issued current OIDC session survives interrupted pending-slot cleanup",new ConnectionVault(targetContext).pendingAuthentication());
                    waitFor("document.querySelector('.session-identity')");
                    assertEquals("Pending-slot recovery does not extend session expiry",issuedExpiry,evaluate("JSON.parse(localStorage.getItem('open-triage.clinician-session.v1')).expiresAt"));

                } else if(protectedPhase.equals("isolate")) {
                    assertFalse(evaluate("document.body.innerText").contains("ANDROID-OIDC-PENDING"));
                    assertEquals("Another OIDC user must preserve retained ciphertext exactly",args.getString("retainedSha256"),retainedDigest());
                    assertEquals("true",evaluate("window.__retained[0].synchronizedRevision<window.__retained[0].ciphertextRevision"));
                    evaluate("window.__denial=null;fetch('/api/reports/"+args.getString("reportId")+"/recovery-grants',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':window.__oidc.session.csrfToken},body:JSON.stringify({schemaVersion:1,envelopeVersion:1})}).then(response=>window.__denial=response.status)");
                    waitFor("window.__denial!==null");assertEquals("404",evaluate("window.__denial"));
                } else if(protectedPhase.equals("recover")) {
                    click("Reopen report");waitFor("document.querySelector('.encounter-header')");
                    if(!"true".equals(evaluate("Boolean(document.querySelector('[data-element-id=\"ePatient.03\"] input[type=text]'))")))click("Stationary");
                    waitFor("document.querySelector('[data-element-id=\"ePatient.03\"] input[type=text]')?.value==='ANDROID-OIDC-PENDING'");
                    waitFor("document.querySelector('.sync-status')?.textContent==='Saved'");
                    assertFalse(evaluate("JSON.stringify({...localStorage})").contains("ANDROID-OIDC-PENDING"));
                }

            } else {
                String message=expected.equals("pending")?"Your external identity is awaiting access review. No application access has been granted.":"Personal authentication failed. Start a new login or contact your administrator.";
                waitFor(ORGANIZATION_LOGIN + " && document.body.innerText.includes("+JSONObject.quote(message)+")");
                assertEquals("null", evaluate("document.querySelector('.session-identity')"));
                evaluate("window.__noSession=null;fetch('/api/sessions/current').then(response=>window.__noSession=response.status)");
                waitFor("window.__noSession!==null");assertEquals("401",evaluate("window.__noSession"));
                sessionStatus=evaluate("window.__noSession");observedUser="null";
            }
            android.os.Bundle outcomeEvidence=new android.os.Bundle();outcomeEvidence.putString("oidc_session_status",sessionStatus);outcomeEvidence.putString("oidc_session_user",observedUser);InstrumentationRegistry.getInstrumentation().sendStatus(0,outcomeEvidence);
            assertEquals("No browser/native credentials may enter persistent setup", "true", evaluate("!JSON.stringify(localStorage).match(/nativeSecret|open_triage_session|open_triage_installation|fictional-access-token/)&&!document.cookie.includes('open_triage_session')"));
            assertNull("The external browser session must never enter WebView cookies", android.webkit.CookieManager.getInstance().getCookie(args.getString("apiOrigin") + "/api"));
        } catch(Exception|AssertionError error) {
            var context=InstrumentationRegistry.getInstrumentation().getTargetContext();
            var vault=new ConnectionVault(context);var pending=vault.pendingAuthentication();var connection=vault.read();
            JSONObject state=new JSONObject().put("pendingPresent",pending!=null);
            if(connection!=null){var saved=connection.saved();var cookies=saved.getJSONArray("cookies");var names=new org.json.JSONArray();for(int i=0;i<cookies.length();i++)names.put(cookies.getJSONObject(i).getString("name"));state.put("cookieNames",names);}
            android.os.Bundle evidence=new android.os.Bundle();evidence.putString("oidc_native_state",state.toString());
            evidence.putString("oidc_runtime",evaluate("JSON.stringify({visibility:document.visibilityState,location:location.origin+location.pathname+location.search,body:document.body.innerText.slice(0,1200)})"));
            evidence.putString("oidc_foreground_package",UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).getCurrentPackageName());
            InstrumentationRegistry.getInstrumentation().sendStatus(0,evidence);throw error;
        } finally { activity.close(); }
    }
}
