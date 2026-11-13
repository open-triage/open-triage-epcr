package org.opentriage.development;

import static org.junit.Assert.*;
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

/** Actual bundled UI, private cookie vault and two real HTTPS agency origins. */
@RunWith(AndroidJUnit4.class)
public class AgencyHandoffJourneyTest {
    private ActivityScenario<MainActivity> activity;
    private static final String FIELD="document.querySelector('[data-element-id=\"ePatient.03\"] input[type=\"text\"]')";
    private String evaluate(String script) throws Exception {
        var value=new AtomicReference<String>();var done=new CountDownLatch(1);
        activity.onActivity(screen->screen.getBridge().getWebView().evaluateJavascript(script,result->{value.set(result);done.countDown();}));
        assertTrue("Bundled WebView must answer",done.await(15,TimeUnit.SECONDS));return value.get();
    }
    private void waitFor(String expression) throws Exception {
        long end=android.os.SystemClock.elapsedRealtime()+60000;
        while(android.os.SystemClock.elapsedRealtime()<end){if("true".equals(evaluate("Boolean("+expression+")")))return;Thread.sleep(100);}
        fail("Agency UI condition failed: "+expression+" body="+evaluate("document.body.innerText.slice(0,1600)"));
    }
    private void set(String expression,String value) throws Exception {waitFor(expression+" && !("+expression+").disabled");evaluate(WebViewTestInput.change(expression,value));}
    private void click(String label) throws Exception {
        String button="Array.from(document.querySelectorAll('button')).find(b=>b.offsetParent!==null&&b.textContent.trim()==="+JSONObject.quote(label)+")";
        waitFor(button+" && !("+button+").disabled");
        if(label.equals("Save & close")){
            evaluate("setTimeout(()=>("+button+").click(),0)");
            var confirm=androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).wait(androidx.test.uiautomator.Until.findObject(androidx.test.uiautomator.By.text("OK")),1500);if(confirm!=null)confirm.click();
        }else evaluate("("+button+").click()");
    }
    private void login(String username,String password) throws Exception {
        waitFor("document.querySelector('input[name=username]') && document.querySelector('.login-sign-in button[type=submit]') && !document.querySelector('.login-sign-in button[type=submit]').disabled");
        set("document.querySelector('input[name=username]')",username);set("document.querySelector('input[name=password]')",password);evaluate("document.querySelector('.login-sign-in').requestSubmit()");waitFor("document.querySelector('.session-identity')");
    }
    private void logout(boolean pending) throws Exception {
        click("Log out");
        if(pending){waitFor("document.querySelector('.logout-dialog')");click("Log out and lock work");}
        waitFor("document.querySelector('input[name=username]') && !document.querySelector('.login-sign-in button[type=submit]').disabled");
    }
    private String records() throws Exception {
        evaluate("window.__agencyRecords=null;(()=>{const r=indexedDB.open('open-triage-protected-clinical-v1');r.onsuccess=()=>{const db=r.result;const q=db.transaction('encrypted-reports').objectStore('encrypted-reports').getAll();q.onsuccess=()=>{window.__agencyRecords=q.result.map(x=>({...x,ciphertext:Array.from(new Uint8Array(x.ciphertext)),nonce:Array.from(new Uint8Array(x.nonce))}));db.close()}}})()");
        waitFor("window.__agencyRecords!==null");
        byte[] bytes=java.security.MessageDigest.getInstance("SHA-256").digest(evaluate("JSON.stringify(window.__agencyRecords)").getBytes(StandardCharsets.UTF_8));var hash=new StringBuilder();for(byte b:bytes)hash.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return hash.toString();
    }
    private ConnectionVault vault(){return new ConnectionVault(InstrumentationRegistry.getInstrumentation().getTargetContext());}
    private String session(){return "JSON.parse(localStorage.getItem('open-triage.clinician-session.v1')||'null')";}
    private void status(String key,String value){var data=new android.os.Bundle();data.putString(key,value);InstrumentationRegistry.getInstrumentation().sendStatus(0,data);}
    /** Diagnostic fields are public identifiers/booleans or one-way cookie hashes only. */
    private void sessionEvidence(String phase) {
        try {
            String hash;try {hash=NativeAgencyHandoff.sessionIdentity(vault().read());}catch(Exception missing){hash="absent";}
            status("agency_session_cookie_sha256",hash);
            status("agency_expected_cookie_sha256",InstrumentationRegistry.getInstrumentation().getTargetContext().getSharedPreferences("agency-test-evidence",0).getString("cookie","unset"));
            evaluate("window.__agencyDiagnostic=null;window.__agencyPolicy=null;window.Capacitor.nativePromise('OpenTriageConnection','state',{}).then(s=>window.__agencyPolicy={configured:s.configured,blocked:s.blocked,managed:s.managed,managedStatus:s.managedStatus,managedContext:s.managedContext,connectionContext:s.connectionContext,origin:s.origin}).catch(()=>window.__agencyPolicy={unavailable:true});fetch('/api/sessions/current').then(async r=>{let b={};try{b=await r.json()}catch{}window.__agencyDiagnostic={status:r.status,userId:b.user?.id,organizationId:b.organization?.id,expiresAt:b.expiresAt}}).catch(()=>window.__agencyDiagnostic={unavailable:true})");
            long deadline=android.os.SystemClock.elapsedRealtime()+3000;
            while(android.os.SystemClock.elapsedRealtime()<deadline&&!"true".equals(evaluate("Boolean(window.__agencyDiagnostic&&window.__agencyPolicy)")))Thread.sleep(50);
            status("agency_session_evidence",new org.json.JSONTokener(evaluate("JSON.stringify((()=>{const s=JSON.parse(localStorage.getItem('open-triage.clinician-session.v1')||'null');return{phase:"+JSONObject.quote(phase)+",sessionPresent:!!s,userId:s?.user?.id,organizationId:s?.organization?.id,csrfPresent:!!s?.csrfToken,expiresAt:s?.expiresAt,marker:localStorage.getItem('open-triage.installation-transition.v1'),generation:localStorage.getItem('open-triage.installation-generation.v1'),candidatePresent:!!localStorage.getItem('open-triage.installation-session-candidate.v1'),policy:window.__agencyPolicy,current:window.__agencyDiagnostic}})())")).nextValue().toString());
        } catch(Exception | AssertionError unavailable) {try{status("agency_session_evidence","unavailable");}catch(Exception ignored){/* Preserve the original failure if the runner already closed. */}}
    }
    private void verifySuperuser(String userId,String organizationId) throws Exception {
        current();assertEquals(JSONObject.quote(userId),evaluate("window.__agencyCurrent.body.user.id"));assertEquals(JSONObject.quote(organizationId),evaluate("window.__agencyCurrent.body.organization.id"));
        assertEquals(JSONObject.quote(userId),evaluate(session()+".user.id"));assertEquals(JSONObject.quote(organizationId),evaluate(session()+".organization.id"));
        String csrf=new org.json.JSONTokener(evaluate(session()+".csrfToken")).nextValue().toString();
        var connection=vault().read();String hash=NativeAgencyHandoff.sessionIdentity(connection);
        var guarded=connection.request("/api/sessions/agency-handoff/current","POST",new JSONObject().put("content-type","application/json").put("x-csrf-token",csrf),"{}");
        assertEquals("Current private cookie and public CSRF must identify the logged-in superuser",200,guarded.status());
        assertEquals(userId,new JSONObject(guarded.body()).getJSONObject("user").getString("id"));assertEquals(hash,NativeAgencyHandoff.sessionIdentity(connection));
        assertTrue(InstrumentationRegistry.getInstrumentation().getTargetContext().getSharedPreferences("agency-test-evidence",0).edit().putString("cookie",hash).commit());
        sessionEvidence("valid-before-managed-cold-start");
    }
    private void losePublicSessionMetadata() throws Exception {
        var vault=vault();var continuation=vault.personalContinuation();
        assertTrue("Successful native login commits continuation before public metadata may disappear",NativePersonalContinuation.matches(continuation,vault.read()));
        assertEquals(new org.json.JSONTokener(evaluate(session()+".csrfToken")).nextValue().toString(),continuation.getString("csrf"));
        evaluate("localStorage.removeItem('open-triage.clinician-session.v1');localStorage.removeItem('open-triage.installation-session-candidate.v1')");
        assertEquals("null",evaluate("localStorage.getItem('open-triage.clinician-session.v1')"));
        status("agency_public_metadata_removed","1");
    }
    /** Test-only document-start observer/seed; never changes native credentials. */
    private void stalePublicIdentityCannotVetoCurrentNativeLogin(JSONObject oldPublic) throws Exception {
        String currentUser=new org.json.JSONTokener(evaluate(session()+".user.id")).nextValue().toString();
        String currentCsrf=new org.json.JSONTokener(evaluate(session()+".csrfToken")).nextValue().toString();
        assertFalse("The public snapshot belongs to the real previous clinician",oldPublic.getJSONObject("user").getString("id").equals(currentUser));
        oldPublic.put("csrfToken","s".repeat(43));oldPublic.remove("accessToken"); // Deliberately inert public proof, never an old credential.
        String cookie=NativeAgencyHandoff.sessionIdentity(vault().read()),before=records(),time=evaluate("performance.timeOrigin");
        assertTrue(NativePersonalContinuation.matches(vault().personalContinuation(),vault().read()));
        evaluate("window.__staleContext=null;window.Capacitor.nativePromise('OpenTriageConnection','state',{}).then(s=>window.__staleContext=s.connectionContext)");waitFor("typeof window.__staleContext==='string'");
        String expectedContext=new org.json.JSONTokener(evaluate("window.__staleContext")).nextValue().toString();
        String script="(()=>{const old="+oldPublic+",expectedUser="+JSONObject.quote(currentUser)+",expectedContext="+JSONObject.quote(expectedContext)+";localStorage.setItem('open-triage.clinician-session.v1',JSON.stringify(old));localStorage.removeItem('open-triage.installation-session-candidate.v1');const initial=JSON.parse(localStorage.getItem('open-triage.clinician-session.v1'));const p=window.__staleNativeProbe={initialWasA:initial.user.id===old.user.id,initialWasB:initial.user.id===expectedUser,candidatePresent:!!localStorage.getItem('open-triage.installation-session-candidate.v1'),nativeCalled:false,nativeResult:'unseen',contextMatches:false,hooked:false};const cap=window.Capacitor,send=cap?.nativePromise;if(typeof send==='function'){p.hooked=true;cap.nativePromise=function(plugin,method,options){const reply=send.apply(this,arguments);if(plugin==='OpenTriageConnection'&&method==='resumePersonalSession'){p.nativeCalled=true;p.contextMatches=options?.connectionContext===expectedContext;void reply.then(value=>{p.nativeResult=value.session?.user?.id===expectedUser?'current-B':value.unavailable?'unavailable':'empty'},()=>{p.nativeResult='rejected'});}return reply;};}})();";
        final Object[] handler={null};final boolean[] supported={false};
        try{
            activity.onActivity(screen->{try{
                supported[0]=(Boolean)Class.forName("androidx.webkit.WebViewFeature").getMethod("isFeatureSupported",String.class).invoke(null,"DOCUMENT_START_SCRIPT");
                if(supported[0])handler[0]=Class.forName("androidx.webkit.WebViewCompat").getMethod("addDocumentStartJavaScript",android.webkit.WebView.class,String.class,java.util.Set.class).invoke(null,screen.getBridge().getWebView(),script,java.util.Collections.singleton("https://localhost"));
            }catch(Exception error){throw new IllegalStateException("Document-start test setup failed",error);}});
            if(!supported[0]){evaluate("localStorage.setItem('open-triage.clinician-session.v1',"+JSONObject.quote(oldPublic.toString())+");localStorage.removeItem('open-triage.installation-session-candidate.v1')");assertEquals(JSONObject.quote(oldPublic.getJSONObject("user").getString("id")),evaluate(session()+".user.id"));}
            activity.onActivity(screen->screen.getBridge().getWebView().reload());
            waitFor("performance.timeOrigin!=="+time+" && document.querySelector('.session-identity') && "+session()+"?.user?.id==="+JSONObject.quote(currentUser));
            if(supported[0]){
                assertEquals("true",evaluate("window.__staleNativeProbe?.initialWasA && !window.__staleNativeProbe.initialWasB && !window.__staleNativeProbe.candidatePresent && window.__staleNativeProbe.hooked && window.__staleNativeProbe.nativeCalled && window.__staleNativeProbe.contextMatches && window.__staleNativeProbe.nativeResult==='current-B'"));
                status("agency_stale_public_probe",new org.json.JSONTokener(evaluate("JSON.stringify(window.__staleNativeProbe)")).nextValue().toString());
            }else status("agency_stale_public_probe","document-start-unavailable; verified-seed-and-fresh-JS-reload-passed");
            assertEquals(cookie,NativeAgencyHandoff.sessionIdentity(vault().read()));assertTrue(NativePersonalContinuation.matches(vault().personalContinuation(),vault().read()));
            assertTrue("Fresh native CSRF is retained without copying the inert stale public value",currentCsrf.equals(new org.json.JSONTokener(evaluate(session()+".csrfToken")).nextValue().toString()));
            assertEquals("null",evaluate("document.querySelector('.encounter-header')"));unchanged(before);bundled();
            status("agency_stale_public_current_native","passed-fresh-JS-startup-not-process-death");
        }finally{if(handler[0]!=null)activity.onActivity(screen->{try{Class.forName("androidx.webkit.ScriptHandler").getMethod("remove").invoke(handler[0]);}catch(Exception error){throw new IllegalStateException("Document-start test cleanup failed",error);}});}
    }
    private void select(String id) throws Exception {
        waitFor("document.querySelector('.session-agency-selector select') && !document.querySelector('.session-agency-selector select').disabled");
        evaluate("(()=>{const s=document.querySelector('.session-agency-selector select');s.value="+JSONObject.quote(id)+";s.dispatchEvent(new Event('change',{bubbles:true}));})()");
    }
    private void current() throws Exception {
        evaluate("window.__agencyCurrent=null;fetch('/api/sessions/current').then(async r=>window.__agencyCurrent={status:r.status,body:await r.json()}).catch(()=>window.__agencyCurrent={status:0})");waitFor("window.__agencyCurrent");assertEquals("200",evaluate("window.__agencyCurrent.status"));
    }
    private void bundled() throws Exception {
        assertEquals("\"https://localhost\"",evaluate("location.origin"));assertEquals("null",evaluate("document.querySelector('body').textContent.includes('SYNTHETIC-REMOTE-WEB-DEPLOYMENT')?true:null"));
        assertNull("No remote credential enters the WebView cookie store",android.webkit.CookieManager.getInstance().getCookie("https://localhost/api"));
        assertEquals("true",evaluate("!document.cookie.includes('open_triage_session') && !document.cookie.includes('open_triage_installation')"));
    }
    private void unchanged(String expected) throws Exception {assertEquals("Agency transition preserves exact old opaque clinical record",expected,records());}
    @Test public void isolatedAgencyHandoff() throws Exception {
        var args=InstrumentationRegistry.getArguments();String phase=args.getString("phase");
        AndroidFixtureNetwork.await(InstrumentationRegistry.getInstrumentation().getTargetContext(),args.getString("apiOrigin"),null,true);
        activity=ActivityScenario.launch(MainActivity.class);
        try {
            if(phase.equals("setup")){
                String artifact=new String(android.util.Base64.decode(args.getString("artifactBase64"),android.util.Base64.NO_WRAP),StandardCharsets.UTF_8);
                waitFor("document.querySelector('input[type=file]')");AndroidUiInput.importPairing(this::evaluate,this::waitFor,artifact);waitFor("document.querySelector('input[type=checkbox]')");set("document.querySelector('input[maxlength=\"100\"]')","Agency handoff source");evaluate("document.querySelector('input[type=checkbox]').click();document.querySelector('form').requestSubmit()");
                login(args.getString("username"),args.getString("password"));
                String row="Array.from(document.querySelectorAll('.assigned-call-card')).find(row=>row.textContent.includes("+JSONObject.quote(args.getString("callNumber"))+"))";
                AndroidUiInput.clickEnabled(this::evaluate,this::waitFor,"("+row+")?.querySelector('button')");waitFor("document.querySelector('.encounter-header')");
                if(!"true".equals(evaluate("Boolean("+FIELD+")")))click("Stationary");
                set(FIELD,"ANDROID-AGENCY-ORIGINAL");waitFor("document.querySelector('.sync-status')?.textContent==='Saved'");
                String reportId=new org.json.JSONTokener(evaluate("document.querySelector('.active-report-notice').dataset.reportId")).nextValue().toString();
                status("agency_report_id",reportId);
                var active=vault().read();var fault=new TrustedConnection(active.origin,active.caPem);
                assertEquals(200,fault.request("/api/__android-agency-write-outage","POST",new JSONObject().put("content-type","application/json"),new JSONObject().put("reportId",reportId).put("enabled",true).toString()).status());
                set(FIELD,"ANDROID-AGENCY-PENDING");waitFor("document.querySelector('.sync-status')?.textContent!=='Saved'");Thread.sleep(1200);click("Save & close");waitFor("!document.querySelector('.encounter-header')");
                JSONObject oldPublic=new JSONObject(new org.json.JSONTokener(evaluate("JSON.stringify("+session()+")")).nextValue().toString());
                logout(true);login(args.getString("superuser"),args.getString("superuserPassword"));
                stalePublicIdentityCannotVetoCurrentNativeLogin(oldPublic);
                // Probe the real private transport without presenting a deliberate
                // permission denial as a clinician UI session-expiry response.
                var nonclinical=vault().read();String beforeDenied=NativeAgencyHandoff.sessionIdentity(nonclinical);
                var forbidden=nonclinical.request("/api/reports/"+reportId,"GET",new JSONObject(),null);
                assertEquals("Installation identity cannot read another clinician report",404,forbidden.status());
                assertFalse(forbidden.body().contains("ANDROID-AGENCY-ORIGINAL"));assertFalse(new JSONObject(forbidden.body()).has("report"));assertEquals(beforeDenied,NativeAgencyHandoff.sessionIdentity(nonclinical));current();assertEquals(beforeDenied,NativeAgencyHandoff.sessionIdentity(vault().read()));
                status("retained_sha256",records());status("source_cookie_sha256",NativeAgencyHandoff.sessionIdentity(vault().read()));bundled();
                losePublicSessionMetadata();
            } else if(phase.equals("bad-ca")||phase.equals("managed-denied")){
                waitFor("document.querySelector('.session-identity')");String cookie=NativeAgencyHandoff.sessionIdentity(vault().read());String before=records();select(args.getString("targetAgency"));waitFor("document.querySelector('.admin-entry-blocked[role=alert]')");
                current();assertEquals(JSONObject.quote(args.getString("sourceAgency")),evaluate("window.__agencyCurrent.body.organization.id"));assertEquals(cookie,NativeAgencyHandoff.sessionIdentity(vault().read()));assertEquals(args.getString("apiOrigin"),vault().read().origin);unchanged(before);assertNull(vault().pendingHandoff());bundled();
            } else if(phase.equals("prepare-interrupted")){
                waitFor("document.querySelector('.session-identity')");
                evaluate("window.__prepared=null;window.Capacitor.Plugins.OpenTriageConnection.state().then(state=>window.Capacitor.Plugins.OpenTriageConnection.prepareAgencyHandoff({organizationId:"+JSONObject.quote(args.getString("targetAgency"))+",csrfToken:"+session()+".csrfToken,connectionContext:state.connectionContext})).then(v=>window.__prepared=v)");waitFor("window.__prepared?.crossHost");
                assertEquals("prepared",vault().pendingHandoff().getString("phase"));status("retained_sha256",records());status("agency_handoff_live","1");
                long end=android.os.SystemClock.elapsedRealtime()+120000;while(android.os.SystemClock.elapsedRealtime()<end)Thread.sleep(100);fail("Host must kill the actual live process at the checkpoint");
            } else if(phase.equals("cancel-interrupted")){
                waitFor("document.body.innerText.includes('The agency switch was interrupted')");assertEquals("null",evaluate("document.querySelector('.session-identity')"));unchanged(args.getString("retainedSha256"));click("Return to original installation");waitFor("document.querySelector('.session-identity')");
                assertEquals("No new login was needed for an unissued cancelled handoff","null",evaluate("document.querySelector('input[name=password]')"));assertEquals(args.getString("sourceCookieSha256"),NativeAgencyHandoff.sessionIdentity(vault().read()));assertNull(vault().pendingHandoff());unchanged(args.getString("retainedSha256"));current();bundled();
            } else if(phase.equals("consume-interrupted")){
                waitFor("document.querySelector('.session-identity')");current();status("source_expires_at",new org.json.JSONTokener(evaluate("window.__agencyCurrent.body.expiresAt")).nextValue().toString());
                select(args.getString("targetAgency"));waitFor("document.body.innerText.includes('The agency switch is ready to finish')");
                assertEquals("consuming",vault().pendingHandoff().getString("phase"));assertEquals(args.getString("apiOrigin"),vault().read().origin);
                NativeAgencyHandoff.sessionIdentity(TrustedConnection.restore(vault().pendingHandoff().getJSONObject("target")));
                status("retained_sha256",records());status("agency_handoff_live","1");
                long end=android.os.SystemClock.elapsedRealtime()+120000;while(android.os.SystemClock.elapsedRealtime()<end)Thread.sleep(100);fail("Host must kill the actual ambiguous consume after its target cookie is journaled");
            } else if(phase.equals("return-source-superuser")){
                waitFor("document.querySelector('.session-identity')");evaluate("window.dispatchEvent(new Event('open-triage.android-replace-installation'))");waitFor("document.querySelector('input[type=file]')");
                String artifact=new String(android.util.Base64.decode(args.getString("artifactBase64"),android.util.Base64.NO_WRAP),StandardCharsets.UTF_8);AndroidUiInput.importPairing(this::evaluate,this::waitFor,artifact);waitFor("document.querySelector('input[type=checkbox]')");set("document.querySelector('input[maxlength=\"100\"]')","Explicit original installation");evaluate("document.querySelector('input[type=checkbox]').click();document.querySelector('form').requestSubmit()");
                login(args.getString("superuser"),args.getString("superuserPassword"));unchanged(args.getString("retainedSha256"));bundled();
            } else if(phase.equals("prepare-completed")){
                waitFor("document.querySelector('.session-identity')");
                // Hold only delivery of the real native result. The real UI owns
                // its Web Lock/marker, and the actual server/Keystore promotion runs.
                evaluate("(()=>{const cap=window.Capacitor,send=cap.nativePromise.bind(cap);cap.nativePromise=(plugin,method,options)=>{const reply=send(plugin,method,options);if(plugin==='OpenTriageConnection'&&method==='confirmAgencyHandoff')return reply.then(value=>new Promise(()=>{window.__completedHandoffHeld=true}));return reply;};})()");
                select(args.getString("targetAgency"));waitFor("window.__completedHandoffHeld===true");
                assertEquals("completed",vault().pendingHandoff().getString("phase"));assertEquals("https://127.0.0.1",vault().read().origin);
                assertEquals("true",evaluate("localStorage.getItem('open-triage.installation-transition.v1')?.startsWith('handoff:')"));
                assertEquals("null",evaluate(session()));status("retained_sha256",records());status("agency_handoff_live","1");
                long end=android.os.SystemClock.elapsedRealtime()+120000;while(android.os.SystemClock.elapsedRealtime()<end)Thread.sleep(100);fail("Host must kill the actual promoted handoff before JS delivery");
            } else if(phase.equals("finish-completed")){
                waitFor("document.body.innerText.includes('The agency switch is ready to finish')");unchanged(args.getString("retainedSha256"));
                var completed=vault().pendingHandoff().optJSONObject("publicSession");String expiry=completed!=null?completed.getString("expiresAt"):args.getString("sourceExpiresAt");assertNotNull(expiry);
                click("Finish agency switch");waitFor("document.querySelector('.session-identity')");current();
                assertEquals(JSONObject.quote(expiry),evaluate("window.__agencyCurrent.body.expiresAt"));
                assertEquals(JSONObject.quote(args.getString("targetAgency")),evaluate("window.__agencyCurrent.body.organization.id"));
                assertNotEquals(args.getString("sourceCookieSha256"),NativeAgencyHandoff.sessionIdentity(vault().read()));
                assertNull(vault().pendingHandoff());assertEquals("null",evaluate("localStorage.getItem('open-triage.installation-transition.v1')"));
                assertEquals("null",evaluate("document.querySelector('input[name=password]')"));
                var cookies=vault().read().saved().getJSONArray("cookies");for(int i=0;i<cookies.length();i++)assertEquals("Target has only its own new personal cookie","open_triage_session",cookies.getJSONObject(i).getString("name"));
                unchanged(args.getString("retainedSha256"));bundled();
            } else if(phase.equals("switch")){
                waitFor("document.querySelector('.session-identity')");String before=records();String oldCookie=NativeAgencyHandoff.sessionIdentity(vault().read());current();String expiry=evaluate("window.__agencyCurrent.body.expiresAt"),proof=evaluate("window.__agencyCurrent.body.personallyAuthenticatedAt");select(args.getString("targetAgency"));
                waitFor(session()+"?.organization?.id==="+JSONObject.quote(args.getString("targetAgency")));waitFor("document.querySelector('.session-identity')");current();assertEquals(expiry,evaluate("window.__agencyCurrent.body.expiresAt"));assertEquals(proof,evaluate("window.__agencyCurrent.body.personallyAuthenticatedAt"));assertNotEquals(oldCookie,NativeAgencyHandoff.sessionIdentity(vault().read()));
                assertEquals("https://127.0.0.1",vault().read().origin);assertNull(vault().pendingHandoff());
                var cookies=vault().read().saved().getJSONArray("cookies");for(int i=0;i<cookies.length();i++)assertEquals("Target has only its own new personal cookie","open_triage_session",cookies.getJSONObject(i).getString("name"));
                unchanged(before);bundled();
            } else if(phase.equals("restart-target")){
                waitFor("document.querySelector('.session-identity')");assertEquals("https://127.0.0.1",vault().read().origin);assertEquals(JSONObject.quote(args.getString("targetAgency")),evaluate(session()+".organization.id"));unchanged(args.getString("retainedSha256"));bundled();
            } else if(phase.equals("return-source")){
                waitFor("document.querySelector('.session-identity')");evaluate("window.dispatchEvent(new Event('open-triage.android-replace-installation'))");waitFor("document.querySelector('input[type=file]')");
                String artifact=new String(android.util.Base64.decode(args.getString("artifactBase64"),android.util.Base64.NO_WRAP),StandardCharsets.UTF_8);AndroidUiInput.importPairing(this::evaluate,this::waitFor,artifact);waitFor("document.querySelector('input[type=checkbox]')");set("document.querySelector('input[maxlength=\"100\"]')","Explicit original installation");evaluate("document.querySelector('input[type=checkbox]').click();document.querySelector('form').requestSubmit()");
                waitFor("document.querySelector('input[name=username]')");unchanged(args.getString("retainedSha256"));bundled();
            } else if(phase.equals("recover-source")){
                login(args.getString("username"),args.getString("password"));click("Reopen report");waitFor("document.querySelector('.encounter-header')");if(!"true".equals(evaluate("Boolean("+FIELD+")")))click("Stationary");waitFor("("+FIELD+")?.value==='ANDROID-AGENCY-PENDING'");waitFor("document.querySelector('.sync-status')?.textContent==='Saved'");click("Save & close");waitFor("!document.querySelector('.encounter-header')");logout(false);login(args.getString("superuser"),args.getString("superuserPassword"));bundled();verifySuperuser(args.getString("superuserId"),args.getString("sourceAgency"));losePublicSessionMetadata();
            }else fail("Unknown agency test phase");
        }catch(AssertionError failure){sessionEvidence(phase);throw failure;}finally{activity.close();}
    }
}
