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
        fail("UI condition failed: " + expression + " field=" + evaluate("(" + FIELD + ")?.value ?? null") + " lifecycle=" + evaluate("JSON.stringify({timeOrigin:performance.timeOrigin,oldDocument:window.__beforeUpgradeReload,events:window.__nativeEvents,assignedReads:window.__assignedReads})") + " body=" + evaluate("document.body.innerText.slice(0,1800)"));
    }
    private void setInput(String expression, String value) throws Exception {
        waitFor("(" + expression + ") && !(" + expression + ").matches(':disabled') && !(" + expression + ").readOnly");
        assertEquals("The actual input must be editable", "true", evaluate("(()=>{const input=" + expression + ";if(!input || input.matches(':disabled') || input.readOnly)return false;input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input," + JSONObject.quote(value) + ");input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.blur();return true;})()"));
    }
    private void click(String label) throws Exception {
        String button = "Array.from(document.querySelectorAll('button')).find(button=>button.offsetParent!==null && (button.textContent.trim()===" + JSONObject.quote(label) + " || button.getAttribute('aria-label')===" + JSONObject.quote(label) + "))";
        waitFor(button + " && !(" + button + ").disabled");
        if (label.equals("Save & close")) {
            evaluate("setTimeout(()=>(" + button + ").click(),0)");
            var confirmation = androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).wait(
                androidx.test.uiautomator.Until.findObject(androidx.test.uiautomator.By.text("OK")), 2000);
            if (confirmation != null) confirmation.click();
        } else if (label.equals("Add photo note")) evaluate("setTimeout(()=>(" + button + ").click(),0)");
        else evaluate("(" + button + ").click()");
    }
    private void connection(boolean connected) throws Exception {
        for (String command : new String[]{"svc wifi " + (connected ? "enable" : "disable"), "svc data " + (connected ? "enable" : "disable")}) {
            try (var result = new ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command))) { result.readAllBytes(); }
        }
        waitFor(connected ? "navigator.onLine" : "!navigator.onLine");
        AndroidFixtureNetwork.await(InstrumentationRegistry.getInstrumentation().getTargetContext(),
            InstrumentationRegistry.getArguments().getString("apiOrigin"), () -> {
                String value = evaluate("navigator.onLine");
                if (!"true".equals(value) && !"false".equals(value)) throw new AssertionError("WebView network signal unavailable");
                return Boolean.parseBoolean(value);
            }, connected);
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
    private void photoOfflineCapture() throws Exception {
        click("Mobile");
        click("Add photo note");
        var denied = androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).wait(
            androidx.test.uiautomator.Until.findObject(androidx.test.uiautomator.By.res(java.util.regex.Pattern.compile(".*:id/permission_deny_button"))), 15000);
        assertNotNull("Shared photo camera requests actual Android permission", denied); denied.click();
        waitFor("document.querySelector('.photo-note-dialog [role=alert]')");
        click("Cancel");
        click("Add photo note");
        var granted = androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).wait(
            androidx.test.uiautomator.Until.findObject(androidx.test.uiautomator.By.res(java.util.regex.Pattern.compile(".*:id/permission_allow_foreground_only_button"))), 15000);
        assertNotNull("Retry must permit actual camera permission grant", granted); granted.click();
        // Prove granted permission reaches the real WebView camera before substituting synthetic pixels.
        waitFor("document.querySelector('.photo-note-dialog video')?.videoWidth>0");
        activity.moveToState(Lifecycle.State.CREATED); Thread.sleep(300);
        assertEquals("Native pause stops the actual camera track", "true", evaluate("Array.from(document.querySelector('.photo-note-dialog video').srcObject.getTracks()).every(track=>track.readyState==='ended')"));
        activity.moveToState(Lifecycle.State.RESUMED);
        waitFor("Array.from(document.querySelector('.photo-note-dialog video')?.srcObject?.getTracks()??[]).some(track=>track.readyState==='live')");
        stageSyntheticPhoto("ANDROID-PHOTO-RESUME-SYNTHETIC");
        evaluate("window.__backgroundRequests=0;window.__backgroundPaths=[]");
        activity.moveToState(Lifecycle.State.CREATED);
        waitFor("window.__nativeActive===false");
        connection(true); Thread.sleep(1200);
        assertEquals("Paused reconnect must not start new API traffic: " + evaluate("JSON.stringify(window.__backgroundPaths)"), "0", evaluate("window.__backgroundRequests"));
        activity.moveToState(Lifecycle.State.RESUMED);
        verifyCanonicalPhoto("ANDROID-PHOTO-RESUME-SYNTHETIC");
        connection(false); click("Mobile"); click("Add photo note");
        waitFor("document.querySelector('.photo-note-dialog video')?.videoWidth>0");
        stageSyntheticPhoto("ANDROID-PHOTO-SYNTHETIC");
        records(); assertFalse("Photo caption is encrypted at rest", evaluate("JSON.stringify(window.__retained)").contains("ANDROID-PHOTO-SYNTHETIC"));
        assertFalse("Photo bytes never enter localStorage", evaluate("JSON.stringify({...localStorage})").contains("data:image"));
    }
    private void stageSyntheticPhoto(String caption) throws Exception {
        waitFor("(()=>{const video=document.querySelector('.photo-note-dialog video');const capture=document.querySelector('.camera-capture-button');return video?.readyState>=2 && video.currentTime>0 && !video.paused && capture && !capture.disabled})()");
        // Substitute only the hardware frame source. Capture, normalization, staging and API calls stay production.
        evaluate("(()=>{const video=document.querySelector('.photo-note-dialog video');const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const context=canvas.getContext('2d');context.fillStyle='#275d38';context.fillRect(0,0,640,480);context.fillStyle='#eee';context.fillRect(100,100,230,180);window.__syntheticPhotoStream=canvas.captureStream(5);video.srcObject=window.__syntheticPhotoStream;video.play()})()");
        waitFor("document.querySelector('.photo-note-dialog video')?.videoWidth===640");
        click("Take photo"); waitFor("document.querySelector('.photo-note-dialog img')?.naturalWidth>0");
        evaluate("window.__syntheticPhotoStream.getTracks().forEach(track=>track.stop())");
        evaluate("(()=>{const input=document.querySelector('#report-photo-caption');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input," + JSONObject.quote(caption) + ");input.dispatchEvent(new Event('input',{bubbles:true}))})()");
        click("Use photo"); waitFor("!document.querySelector('.photo-note-dialog') && document.body.innerText.includes(" + JSONObject.quote(caption) + ")");
        click("Stationary"); waitFor(FIELD);
    }
    private void verifyCanonicalPhoto(String caption) throws Exception {
        evaluate("window.__photoVerified=null;(async()=>{for(let attempt=0;attempt<80;attempt++){try{const report=await (await fetch('/api/reports/'+window.__reportId)).json();const find=value=>{if(!value||typeof value!=='object')return null;if(value.type==='photo'&&value.caption===" + JSONObject.quote(caption) + ")return value;for(const item of Object.values(value)){const found=find(item);if(found)return found}return null};const note=find(report);if(note?.persistenceState==='ready'){const response=await fetch('/api/reports/'+window.__reportId+'/photos/'+note.id+'/image');if(!response.ok)throw Error('image');const bytes=new Uint8Array(await response.arrayBuffer());const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');if(hash!==note.sha256||bytes[0]!==255||bytes[1]!==216)throw Error('bytes');const blob=new Blob([bytes],{type:'image/jpeg'});const image=await createImageBitmap(blob);if(image.width!==640||image.height!==480)throw Error('dimensions');image.close();window.__photoVerified=true;return}}catch{}await new Promise(resolve=>setTimeout(resolve,500))}window.__photoVerified=false})()");
        waitFor("window.__photoVerified!==null"); assertEquals("Recovered photo uploads and returns exact authenticated JPEG bytes", "true", evaluate("window.__photoVerified"));
    }
    private void verifyRecoveredPhoto() throws Exception {
        verifyCanonicalPhoto("ANDROID-PHOTO-SYNTHETIC");
        click("Mobile");
        waitFor("Array.from(document.querySelectorAll('.photo-note-event')).some(row=>row.textContent.includes('ANDROID-PHOTO-SYNTHETIC')&&row.querySelector('.photo-thumbnail')?.naturalWidth===640)");
        evaluate("Array.from(document.querySelectorAll('.photo-note-event')).find(row=>row.textContent.includes('ANDROID-PHOTO-SYNTHETIC')).querySelector('button').click()");
        waitFor("document.querySelector('.photo-viewer-image')?.naturalWidth===640");
        click("Cancel"); click("Stationary"); waitFor(FIELD);
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
    private java.util.List<String> publicCertificateIdentities(String pem) throws Exception {
        var factory = java.security.cert.CertificateFactory.getInstance("X.509");
        var certificates = factory.generateCertificates(new java.io.ByteArrayInputStream(pem.getBytes(StandardCharsets.UTF_8)));
        assertFalse("The private-CA upgrade fixture must contain public certificates", certificates.isEmpty());
        var encoded = new java.util.ArrayList<String>();
        for (var certificate : certificates) encoded.add(android.util.Base64.encodeToString(certificate.getEncoded(), android.util.Base64.NO_WRAP));
        java.util.Collections.sort(encoded);
        return encoded;
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
        assertEquals("Managed and retained trust must contain the same DER public certificates, independent of PEM whitespace",
            publicCertificateIdentities(connection.getString("caPem")), publicCertificateIdentities(restrictions.getString("publicCaPem")));
        assertFalse("Clinical app remains an ordinary managed application", context.getSystemService(android.app.admin.DevicePolicyManager.class).isDeviceOwnerApp(context.getPackageName()));
    }
    private void prepare() throws Exception {
        var args = InstrumentationRegistry.getArguments();
        String artifact = new String(android.util.Base64.decode(args.getString("artifactBase64", ""), android.util.Base64.NO_WRAP), StandardCharsets.UTF_8);
        AndroidUiInput.importPairing(this::evaluate, this::waitFor, artifact);
        waitFor("document.querySelector('input[type=checkbox]')");
        setInput("document.querySelector('input[maxlength=\"100\"]')", "Synthetic recovery ambulance");
        evaluate("document.querySelector('input[type=checkbox]').click()");
        waitFor("!document.querySelector('button[type=submit]').disabled"); evaluate("document.querySelector('form').requestSubmit()");
        signIn(args.getString("username"), args.getString("password"));
        if ("1".equals(args.getString("upgrade"))) {
            evaluate("window.__deployment=null;fetch('/api/__android-web-deployment',{method:'POST'}).then(response=>response.json()).then(value=>window.__deployment=value)");
            waitFor("window.__deployment?.revision===2");
            String previousTimeOrigin = evaluate("performance.timeOrigin");
            evaluate("window.__beforeUpgradeReload=true");
            activity.onActivity(screen -> screen.getBridge().getWebView().reload());
            // Old and new pages render identical selectors; require a new JS realm
            // before attaching observations that would otherwise be discarded.
            waitFor("window.__beforeUpgradeReload===undefined && performance.timeOrigin!==" + previousTimeOrigin);
            waitFor("document.querySelector('.session-identity') && document.querySelector('.call-directory')");
            assertFalse("Remote web deployment cannot replace APK UI after reload", evaluate("document.body.innerText").contains("SYNTHETIC-REMOTE-WEB-DEPLOYMENT"));
            assertEquals("true", evaluate("location.origin==='https://localhost' && !navigator.serviceWorker?.controller"));
        }
        evaluate("window.__nativeEvents=[];window.__nativeActive=true;window.__backgroundRequests=0;window.__assignedReads=0;window.addEventListener('open-triage.foreground-changed',event=>{window.__nativeActive=event.detail.active;window.__nativeEvents.push(event.detail.active)},true);window.__originalFetch=window.fetch;window.fetch=(input,init)=>{const url=typeof input==='string'?input:input.url;if(url.includes('/api/')){if(!window.__nativeActive){window.__backgroundRequests++;window.__backgroundPaths?.push(url)}if(url.includes('/calls/assigned'))window.__assignedReads++;}return window.__originalFetch(input,init)}");
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
        connection(false); photoOfflineCapture(); records();
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
        if ("1".equals(args.getString("tlsChecks"))) TlsRotationJourneyTest.snapshotIdentity();
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
        verifyRecoveredPhoto();
        assertFalse(evaluate("JSON.stringify({...localStorage})").contains(RETAINED));
    }
    private void reassignWithLostResponse() throws Exception {
        var args = InstrumentationRegistry.getArguments();
        waitFor("document.querySelector('[data-change-installation]')");
        evaluate("document.querySelector('[data-change-installation]').click()");
        JSONObject expiring = new JSONObject(new String(android.util.Base64.decode(args.getString("expiredArtifactBase64"), android.util.Base64.NO_WRAP), StandardCharsets.UTF_8));
        AndroidUiInput.importPairing(this::evaluate, this::waitFor, expiring.toString());
        waitFor("document.querySelector('input[type=checkbox]')");
        var fault = new TrustedConnection(expiring.getString("origin"), expiring.getString("caPem"));
        var expired = fault.request("/api/__android-enrollment-expire", "POST", new JSONObject().put("content-type", "application/json"), new JSONObject().put("token", expiring.getString("token")).toString());
        assertTrue(new JSONObject(expired.body()).getBoolean("expired"));
        setInput("document.querySelector('input[maxlength=\"100\"]')", "Expired preview");
        evaluate("document.querySelector('input[type=checkbox]').click()");waitFor("!document.querySelector('button[type=submit]').disabled");
        evaluate("document.querySelector('form').requestSubmit()");
        waitFor("document.querySelector('[data-pending-enrollment]') && Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='Use a new pairing code')");
        assertNotNull("Even a proved unconsumed expired intent stays durable until explicit abandonment", new ConnectionVault(InstrumentationRegistry.getInstrumentation().getTargetContext()).pending());
        click("Use a new pairing code");
        waitFor("!document.querySelector('[data-pending-enrollment]') && document.querySelector('input[type=file]') && !document.querySelector('input[type=file]').disabled");
        assertNull("Fresh read-only not-committed proof and explicit abandonment permit a fresh code", new ConnectionVault(InstrumentationRegistry.getInstrumentation().getTargetContext()).pending());
        records();
        assertEquals("Abandoning an unconsumed intent preserves the original encrypted work", args.getString("retainedSha256"), retainedDigest());
        var armed = fault.request("/api/__android-enrollment-drop-arm", "POST", new JSONObject().put("content-type", "application/json"), "{}");
        assertTrue(new JSONObject(armed.body()).getBoolean("armed"));
        String artifact = new String(android.util.Base64.decode(args.getString("artifactBase64"), android.util.Base64.NO_WRAP), StandardCharsets.UTF_8);
        AndroidUiInput.importPairing(this::evaluate, this::waitFor, artifact);
        waitFor("document.querySelector('input[type=checkbox]')");
        setInput("document.querySelector('input[maxlength=\"100\"]')", "Reassigned Android installation");
        evaluate("document.querySelector('input[type=checkbox]').click()");
        waitFor("!document.querySelector('button[type=submit]').disabled");
        evaluate("document.querySelector('form').requestSubmit()");
        waitFor("Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='Retry confirmed pairing')");
        assertEquals("No personal UI may remain after confirmed transition", "null", evaluate("document.querySelector('.session-identity')"));
        var vault = new ConnectionVault(InstrumentationRegistry.getInstrumentation().getTargetContext());
        JSONObject pending = vault.pending(); assertNotNull("Reply loss must retain the encrypted native journal", pending);
        assertEquals(43, pending.getJSONObject("body").getString("attempt").length());
        var candidateCookies = pending.getJSONObject("candidate").getJSONArray("cookies");
        for (int i=0;i<candidateCookies.length();i++) assertNotEquals("Candidate must never reuse personal authentication", "open_triage_session", candidateCookies.getJSONObject(i).getString("name"));
        assertFalse("Journal secret cannot be readable in WebView storage", evaluate("JSON.stringify({...localStorage})").contains(pending.getJSONObject("body").getString("attempt")));
        records(); assertEquals(args.getString("retainedSha256"), retainedDigest());
        var ready = new android.os.Bundle(); ready.putString("opentriage_phase", "ready-for-process-kill");
        InstrumentationRegistry.getInstrumentation().sendStatus(2, ready);
        Thread.sleep(600000); fail("Host must kill the process holding the unacknowledged journal");
    }
    private void resumeReassignment() throws Exception {
        var args = InstrumentationRegistry.getArguments();
        waitFor("Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='Retry confirmed pairing')");
        assertNotNull(new ConnectionVault(InstrumentationRegistry.getInstrumentation().getTargetContext()).pending());
        click("Retry confirmed pairing"); waitFor("document.querySelector('input[name=username]')");
        assertNull("Promotion and journal removal commit atomically", new ConnectionVault(InstrumentationRegistry.getInstrumentation().getTargetContext()).pending());
        assertEquals("Existing personal evidence is not restored by retried pairing", "null", evaluate("document.querySelector('.session-identity')"));
        evaluate("window.__binding=null;fetch('/api/installations/current').then(response=>response.json()).then(value=>window.__binding=value)");
        waitFor("window.__binding?.enrolled");
        assertEquals(JSONObject.quote(args.getString("unitId")), evaluate("window.__binding.installation.unitId"));
        assertEquals(JSONObject.quote(args.getString("installationId")), evaluate("window.__binding.installation.installationId"));
        records(); assertEquals("Reassignment and process loss preserve exact eligible encrypted work", args.getString("retainedSha256"), retainedDigest());
    }
    @Test public void realProcessRecovery() throws Exception {
        String phase = InstrumentationRegistry.getArguments().getString("phase", "");
        if (phase.equals("offline")) {
            // Prove the actual TLS endpoint is unreachable before any WebView startup can recover a key.
            AndroidFixtureNetwork.await(InstrumentationRegistry.getInstrumentation().getTargetContext(),
                InstrumentationRegistry.getArguments().getString("apiOrigin"), null, false);
        } else if (phase.equals("reassign") || phase.equals("resume-reassignment")) {
            // Host radio enable is asynchronous. Never retry a pairing request to compensate.
            AndroidFixtureNetwork.await(InstrumentationRegistry.getInstrumentation().getTargetContext(),
                InstrumentationRegistry.getArguments().getString("apiOrigin"), null, true);
        }
        activity = ActivityScenario.launch(MainActivity.class);
        var startup=new android.os.Bundle();startup.putString("opentriage_startup_pid",String.valueOf(android.os.Process.myPid()));
        InstrumentationRegistry.getInstrumentation().sendStatus(0,startup);
        activity.onActivity(screen -> assertTrue("Prevent Android task snapshots and captures", (screen.getWindow().getAttributes().flags & WindowManager.LayoutParams.FLAG_SECURE) != 0));
        switch (phase) {
            case "prepare": prepare(); break;
            case "offline": offlineRestart(); activity.close(); break;
            case "reassign": reassignWithLostResponse(); break;
            case "resume-reassignment": resumeReassignment(); activity.close(); break;
            case "other": differentClinician(); activity.close(); break;
            case "recover": recover(); activity.close(); break;
            default: fail("Host must supply a recovery phase");
        }
    }
}
