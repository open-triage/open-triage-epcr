package org.opentriage.development;

import static org.junit.Assert.*;
import android.os.ParcelFileDescriptor;
import android.view.WindowManager;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.lifecycle.Lifecycle;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** The host force-stops the real application process between the four phases. */
@RunWith(AndroidJUnit4.class)
public class ReportRecoveryJourneyTest {
    private ActivityScenario<MainActivity> activity;
    private static final String RETAINED = "ANDROID-RETAINED-SYNTHETIC";
    private static final String FIELD = "document.querySelector('[data-element-id=\"ePatient.03\"] input[type=\"text\"]')";
    private String evaluate(String script) throws Exception {
        AtomicReference<String> value = new AtomicReference<>(); CountDownLatch done = new CountDownLatch(1);
        activity.onActivity(screen -> screen.getBridge().getWebView().evaluateJavascript(script, result -> { value.set(result); done.countDown(); }));
        assertTrue("WebView evaluation timed out", done.await(20, TimeUnit.SECONDS));
        return value.get();
    }
    private void waitFor(String expression) throws Exception {
        long end = System.currentTimeMillis() + 90000;
        while (System.currentTimeMillis() < end) {
            if ("true".equals(evaluate("Boolean(" + expression + ")"))) return;
            Thread.sleep(150);
        }
        fail("UI condition failed: " + expression + " field=" + evaluate("(" + FIELD + ")?.value ?? null") + " body=" + evaluate("document.body.innerText.slice(0,1800)"));
    }
    private void setInput(String expression, String value) throws Exception {
        waitFor("(" + expression + ") && !(" + expression + ").matches(':disabled') && !(" + expression + ").readOnly");
        assertEquals("The actual input must be editable", "true", evaluate("(()=>{const input=" + expression + ";if(!input || input.matches(':disabled') || input.readOnly)return false;input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input," + JSONObject.quote(value) + ");input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.blur();return true;})()"));
    }
    private void click(String label) throws Exception {
        String button = "Array.from(document.querySelectorAll('button')).find(button=>button.offsetParent!==null && button.textContent.trim()===" + JSONObject.quote(label) + ")";
        waitFor(button + " && !(" + button + ").disabled"); evaluate("(" + button + ").click()");
    }
    private void connection(boolean connected) throws Exception {
        for (String command : new String[]{"svc wifi " + (connected ? "enable" : "disable"), "svc data " + (connected ? "enable" : "disable")}) {
            try (var result = new ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command))) { result.readAllBytes(); }
        }
        waitFor(connected ? "navigator.onLine" : "!navigator.onLine");
        assertEquals("Radio transitions must affect the actual API transport", connected, apiReachable());
    }
    private boolean apiReachable() {
        var endpoint = java.net.URI.create(InstrumentationRegistry.getArguments().getString("apiOrigin"));
        try (var socket = new java.net.Socket()) {
            socket.connect(new java.net.InetSocketAddress(endpoint.getHost(), endpoint.getPort()), 2000);
            return true;
        } catch (java.io.IOException connectionLoss) { return false; }
    }
    private void records() throws Exception {
        evaluate("window.__retained=null;(()=>{const request=indexedDB.open('open-triage-protected-clinical-v1');request.onupgradeneeded=()=>{request.transaction.abort();window.__retained=[];};request.onsuccess=()=>{const db=request.result;if(!db.objectStoreNames.contains('encrypted-reports')){window.__retained=[];db.close();return;}const query=db.transaction('encrypted-reports').objectStore('encrypted-reports').getAll();query.onsuccess=()=>{window.__retained=query.result.map(row=>({...row,ciphertext:Array.from(new Uint8Array(row.ciphertext)),nonce:Array.from(new Uint8Array(row.nonce))}));db.close();};};})()");
        waitFor("window.__retained!==null");
    }
    private String retainedDigest() throws Exception {
        byte[] digest = java.security.MessageDigest.getInstance("SHA-256").digest(evaluate("JSON.stringify(window.__retained)").getBytes(StandardCharsets.UTF_8));
        var encoded = new StringBuilder();
        for (byte value : digest) encoded.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        return encoded.toString();
    }
    private void signIn(String username, String password) throws Exception {
        waitFor("document.querySelector('input[name=username]')");
        setInput("document.querySelector('input[name=username]')", username); setInput("document.querySelector('input[name=password]')", password);
        evaluate("document.querySelector('.login-sign-in').requestSubmit()");
        waitFor("document.querySelector('.session-identity') && document.querySelector('.call-directory')");
    }
    private void serverValue(String expected) throws Exception {
        evaluate("window.__serverVerified=null;(async()=>{for(let i=0;i<30;i++){try{const response=await fetch('/api/reports/'+window.__reportId,{cache:'no-store'});if(response.ok && (await response.text()).includes(" + JSONObject.quote(expected) + ")){window.__serverVerified=true;return}}catch{}await new Promise(resolve=>setTimeout(resolve,500))}window.__serverVerified=false})()");
        waitFor("window.__serverVerified!==null"); assertEquals("true", evaluate("window.__serverVerified"));
        waitFor("document.querySelector('.sync-status')?.textContent==='Saved'");
    }
    private String connectionIdentity() throws Exception {
        var context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        JSONObject saved = new ConnectionVault(context).read().saved();
        String installation = null;
        for (int i = 0; i < saved.getJSONArray("cookies").length(); i++) {
            JSONObject cookie = saved.getJSONArray("cookies").getJSONObject(i);
            if (cookie.getString("name").equals("open_triage_installation")) installation = cookie.getString("value");
        }
        assertNotNull("Real enrolled installation cookie survives", installation);
        byte[] hash = java.security.MessageDigest.getInstance("SHA-256").digest(
            (saved.getString("origin") + "\n" + saved.getString("caPem") + "\n" + installation).getBytes(StandardCharsets.UTF_8));
        var encoded = new StringBuilder();
        for (byte value : hash) encoded.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        return encoded.toString();
    }
    private void snapshotUpgrade() throws Exception {
        if (!"1".equals(InstrumentationRegistry.getArguments().getString("upgrade"))) return;
        var context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("Production identity must be installed", "org.opentriage.android", context.getPackageName());
        assertEquals("Stationary preference was set by the real UI", JSONObject.quote("stationary"), evaluate("localStorage.getItem('open-triage.presentation-mode.v1')"));
        assertEquals("true", evaluate("location.origin==='https://localhost' && !navigator.serviceWorker?.controller"));
        var editor = context.getSharedPreferences("release-upgrade-acceptance", android.content.Context.MODE_PRIVATE).edit();
        editor.putString("connection", connectionIdentity()).putString("ciphertext", retainedDigest()).putInt("uid", context.getApplicationInfo().uid)
            .putString("presentation", evaluate("localStorage.getItem('open-triage.presentation-mode.v1')"));
        assertTrue(editor.commit());
    }
    private void verifyUpgrade() throws Exception {
        if (!"1".equals(InstrumentationRegistry.getArguments().getString("upgrade"))) return;
        var context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        var previous = context.getSharedPreferences("release-upgrade-acceptance", android.content.Context.MODE_PRIVATE);
        assertEquals("In-place update retains Android UID", previous.getInt("uid", -1), context.getApplicationInfo().uid);
        assertEquals("Connection, CA and exact enrollment remain decryptable with the original Keystore key", previous.getString("connection", "missing"), connectionIdentity());
        assertEquals("Pending ciphertext bytes and all its metadata survive exactly", previous.getString("ciphertext", "missing"), retainedDigest());
        assertEquals("Presentation preference survives", previous.getString("presentation", "missing"), evaluate("localStorage.getItem('open-triage.presentation-mode.v1')"));
        assertEquals("true", evaluate("location.origin==='https://localhost' && !navigator.serviceWorker?.controller"));
        var restrictions = context.getSystemService(android.content.RestrictionsManager.class).getApplicationRestrictions();
        assertEquals(1, restrictions.getInt("configurationVersion"));
        var connection = new ConnectionVault(context).read().saved();
        assertEquals(connection.getString("origin"), restrictions.getString("serverOrigin"));
        assertEquals(connection.getString("caPem"), restrictions.getString("publicCaPem"));
        assertFalse("Clinical app remains an ordinary managed application", context.getSystemService(android.app.admin.DevicePolicyManager.class).isDeviceOwnerApp(context.getPackageName()));
    }
    private void prepare() throws Exception {
        var args = InstrumentationRegistry.getArguments();
        String artifact = new String(android.util.Base64.decode(args.getString("artifactBase64", ""), android.util.Base64.NO_WRAP), StandardCharsets.UTF_8);
        waitFor("document.querySelector('input[type=file]')");
        evaluate("(()=>{const input=document.querySelector('input[type=file]'),files=new DataTransfer();files.items.add(new File([" + JSONObject.quote(artifact) + "],'pairing.json',{type:'application/json'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()");
        waitFor("document.querySelector('input[type=checkbox]')");
        setInput("document.querySelector('input[maxlength=\"100\"]')", "Synthetic recovery ambulance");
        evaluate("document.querySelector('input[type=checkbox]').click()");
        waitFor("!document.querySelector('button[type=submit]').disabled"); evaluate("document.querySelector('form').requestSubmit()");
        signIn(args.getString("username"), args.getString("password"));
        if ("1".equals(args.getString("upgrade"))) {
            evaluate("window.__deployment=null;fetch('/api/__android-web-deployment',{method:'POST'}).then(response=>response.json()).then(value=>window.__deployment=value)");
            waitFor("window.__deployment?.revision===2");
            activity.onActivity(screen -> screen.getBridge().getWebView().reload());
            waitFor("document.querySelector('.session-identity') && document.querySelector('.call-directory')");
            assertFalse("Remote web deployment cannot replace APK UI after reload", evaluate("document.body.innerText").contains("SYNTHETIC-REMOTE-WEB-DEPLOYMENT"));
            assertEquals("true", evaluate("location.origin==='https://localhost' && !navigator.serviceWorker?.controller"));
        }
        evaluate("window.__nativeEvents=[];window.__nativeActive=true;window.__backgroundRequests=0;window.__assignedReads=0;window.addEventListener('open-triage.foreground-changed',event=>{window.__nativeActive=event.detail.active;window.__nativeEvents.push(event.detail.active)},true);window.__originalFetch=window.fetch;window.fetch=(input,init)=>{const url=typeof input==='string'?input:input.url;if(url.includes('/api/')){if(!window.__nativeActive)window.__backgroundRequests++;if(url.includes('/calls/assigned'))window.__assignedReads++;}return window.__originalFetch(input,init)}");
        activity.moveToState(Lifecycle.State.CREATED); Thread.sleep(1200); activity.moveToState(Lifecycle.State.RESUMED);
        waitFor("window.__nativeEvents.includes(false) && window.__nativeEvents.includes(true) && window.__assignedReads>0");
        assertEquals("No new API drains while the native activity is paused", "0", evaluate("window.__backgroundRequests"));
        assertEquals("Actual Android runtime supplies protected-storage primitives", "true", evaluate("Boolean(crypto.subtle && indexedDB && navigator.locks?.request && navigator.storage)"));
        // Missing primitives retain online-only editing without an unprotected clinical copy.
        evaluate("window.__locks=navigator.locks;Object.defineProperty(navigator,'locks',{configurable:true,value:undefined})");
        click("Open call"); waitFor("document.querySelector('.encounter-header')");
        evaluate("window.__reportId=document.querySelector('.active-report-notice').dataset.reportId");
        waitFor("document.body.innerText.toLowerCase().includes('offline storage unavailable')");
        records(); assertEquals("0", evaluate("window.__retained.length"));
        click("Save & close");
        evaluate("Object.defineProperty(navigator,'locks',{configurable:true,value:window.__locks});Object.defineProperty(navigator.storage,'persisted',{configurable:true,value:async()=>false});Object.defineProperty(navigator.storage,'persist',{configurable:true,value:async()=>false})");
        click("Reopen report"); waitFor("document.body.innerText.toLowerCase().includes('best-effort offline storage')");
        click("Stationary"); waitFor(FIELD);
        setInput(FIELD, "ANDROID-CONNECTED-SYNTHETIC");
        serverValue("ANDROID-CONNECTED-SYNTHETIC"); records();
        assertEquals("1", evaluate("window.__retained.length"));
        assertEquals("true", evaluate("!JSON.stringify({...localStorage}).includes('ANDROID-CONNECTED') && !JSON.stringify(window.__retained).includes('ANDROID-CONNECTED')"));
        connection(false); setInput(FIELD, "ANDROID-RECONNECTED-SYNTHETIC");
        waitFor("document.querySelector('.sync-status')?.textContent==='Pending sync'");
        connection(true); serverValue("ANDROID-RECONNECTED-SYNTHETIC");
        assertEquals(JSONObject.quote("ANDROID-RECONNECTED-SYNTHETIC"), evaluate("(" + FIELD + ").value"));
        connection(false); records();
        evaluate("window.__beforeRetainedRevision=window.__retained[0].ciphertextRevision");
        setInput(FIELD, RETAINED);
        waitFor("document.querySelector('.sync-status')?.textContent==='Pending sync'");
        // Exercise the real application durability boundary before injecting disk failure.
        click("Save & close"); waitFor("!document.querySelector('.encounter-header')");
        records();
        assertEquals("The retained edit must have its own durable pending ciphertext", "true", evaluate("window.__retained[0].ciphertextRevision>window.__beforeRetainedRevision && window.__retained[0].ciphertextRevision>window.__retained[0].synchronizedRevision"));
        click("Reopen report"); waitFor("document.querySelector('.encounter-header')");
        if (!"true".equals(evaluate("Boolean(" + FIELD + ")"))) click("Stationary");
        waitFor("(" + FIELD + ")?.value==='" + RETAINED + "'");
        // Reopening locally must still show the exact retained value before process loss.
        records();
        String reportId = evaluate("window.__reportId");
        assertFalse("Local metadata must not identify the report", evaluate("JSON.stringify(window.__retained)").contains(reportId.substring(1, reportId.length() - 1)));
        assertFalse(evaluate("JSON.stringify(window.__retained)").contains(RETAINED));
        evaluate("window.__beforeStorageFailure=JSON.stringify(window.__retained);window.__put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='encrypted-reports')throw new DOMException('Synthetic storage failure','QuotaExceededError');return window.__put.apply(this,args)}");
        setInput(FIELD, "ANDROID-WRITE-FAILURE");
        waitFor("document.body.innerText.includes('Protected storage failed while offline')"); waitFor("!(" + FIELD + ") || (" + FIELD + ").matches(':disabled') || (" + FIELD + ").readOnly");
        records(); assertEquals("true", evaluate("JSON.stringify(window.__retained)===window.__beforeStorageFailure"));
        // The test runner must not finish/close the Activity before abrupt process loss.
        assertEquals("true", evaluate("Boolean(document.querySelector('.encounter-header'))"));
        snapshotUpgrade();
        var ready = new android.os.Bundle(); ready.putString("opentriage_phase", "ready-for-process-kill");
        InstrumentationRegistry.getInstrumentation().sendStatus(2, ready);
        Thread.sleep(600000);
        fail("The host must force-stop the prepared live process");
    }
    private void offlineRestart() throws Exception {
        waitFor("document.body.innerText.includes('Reconnect to continue') || document.body.innerText.includes('Unable to')");
        String body = evaluate("document.body.innerText"); assertFalse(body.contains(RETAINED)); assertFalse(body.contains(InstrumentationRegistry.getArguments().getString("callNumber")));
        assertEquals("null", evaluate("document.querySelector('.encounter-header')"));
        records(); assertEquals("1", evaluate("window.__retained.length"));
        assertEquals("true", evaluate("window.__retained[0].ciphertextRevision>window.__retained[0].synchronizedRevision"));
        assertFalse(evaluate("JSON.stringify(window.__retained)").contains(RETAINED));
        assertFalse(evaluate("JSON.stringify({...localStorage})").contains(RETAINED));
        assertFalse(evaluate("JSON.stringify(window.__retained)").contains(InstrumentationRegistry.getArguments().getString("reportId")));
        assertFalse(evaluate("JSON.stringify({...localStorage})").contains(InstrumentationRegistry.getArguments().getString("reportId")));
        assertFalse(evaluate("JSON.stringify({...localStorage})").contains(InstrumentationRegistry.getArguments().getString("callNumber")));
        assertEquals("true", evaluate("!Object.keys(window.__retained[0]).some(key=>/^(reportId|callNumber|ownerUserId|reportKey|reportKeyBase64|dataKey|key)$/.test(key))"));
        verifyUpgrade();
        var retained = new android.os.Bundle(); retained.putString("retained_sha256", retainedDigest());
        InstrumentationRegistry.getInstrumentation().addResults(retained);
        // The host revokes the old session before reconnect; no native vault changes.
        evaluate("localStorage.removeItem('open-triage.clinician-session.v1')");
    }
    private void differentClinician() throws Exception {
        var args = InstrumentationRegistry.getArguments(); signIn(args.getString("username"), args.getString("password"));
        assertFalse(evaluate("document.body.innerText").contains(args.getString("callNumber")));
        String reportId = args.getString("reportId");
        evaluate("window.__denial=null;(()=>{const session=JSON.parse(localStorage.getItem('open-triage.clinician-session.v1'));fetch('/api/reports/" + reportId + "/recovery-grants',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.csrfToken},body:JSON.stringify({schemaVersion:1,envelopeVersion:1})}).then(response=>{window.__denial=response.status})})()");
        waitFor("window.__denial!==null"); assertEquals("404", evaluate("window.__denial"));
        records(); assertEquals("1", evaluate("window.__retained.length"));
        assertEquals("Another clinician must preserve the exact retained ciphertext", args.getString("retainedSha256"), retainedDigest());
        click("Log out"); waitFor("document.querySelector('input[name=username]')");
    }
    private void recover() throws Exception {
        var args = InstrumentationRegistry.getArguments(); signIn(args.getString("username"), args.getString("password"));
        click("Reopen report"); waitFor("document.querySelector('.encounter-header')");
        evaluate("window.__reportId=document.querySelector('.active-report-notice').dataset.reportId");
        if (!"true".equals(evaluate("Boolean(" + FIELD + ")"))) click("Stationary");
        waitFor("(" + FIELD + ")?.value==='" + RETAINED + "'"); serverValue(RETAINED);
        assertFalse(evaluate("JSON.stringify({...localStorage})").contains(RETAINED));
    }
    @Test public void realProcessRecovery() throws Exception {
        String phase = InstrumentationRegistry.getArguments().getString("phase", "");
        if (phase.equals("offline")) {
            // Prove the actual TLS endpoint is unreachable before any WebView startup can recover a key.
            assertFalse("The real API must be unreachable before offline Activity launch", apiReachable());
        }
        activity = ActivityScenario.launch(MainActivity.class);
        activity.onActivity(screen -> assertTrue("Prevent Android task snapshots and captures", (screen.getWindow().getAttributes().flags & WindowManager.LayoutParams.FLAG_SECURE) != 0));
        switch (phase) {
            case "prepare": prepare(); break;
            case "offline": offlineRestart(); activity.close(); break;
            case "other": differentClinician(); activity.close(); break;
            case "recover": recover(); activity.close(); break;
            default: fail("Host must supply a recovery phase");
        }
    }
}
