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
        fail("UI condition failed: " + expression + " field=" + evaluate("(" + FIELD + ")?.value ?? null") + " lifecycle=" + evaluate("JSON.stringify({url:location.href,platform:window.Capacitor?.getPlatform?.(),nativePromise:typeof window.Capacitor?.nativePromise,reviewNative:window.__reviewNative,timeOrigin:performance.timeOrigin,oldDocument:window.__beforeUpgradeReload,events:window.__nativeEvents,assignedReads:window.__assignedReads,audio:window.__lastPlayedAudio?{time:window.__lastPlayedAudio.currentTime,paused:window.__lastPlayedAudio.paused,ended:window.__lastPlayedAudio.ended,error:window.__lastPlayedAudio.error?.code}:null})") + " body=" + evaluate("document.body.innerText.slice(0,1800)"));
    }
    private void setInput(String expression, String value) throws Exception {
        waitFor("(" + expression + ") && !(" + expression + ").matches(':disabled') && !(" + expression + ").readOnly");
        assertEquals("The actual input must be editable", "true", evaluate(WebViewTestInput.change(expression,value)));
    }
    private void click(String label) throws Exception {
        if (label.equals("Add photo note") || label.equals("Add audio note")) {
            // Durable discard is asynchronous. A real user cannot activate a
            // quick action through the previous modal's backdrop.
            waitFor("!document.querySelector('[role=dialog], [role=alertdialog]')");
        }
        String button = "Array.from(document.querySelectorAll('button')).find(button=>button.offsetParent!==null && (button.textContent.trim()===" + JSONObject.quote(label) + " || button.getAttribute('aria-label')===" + JSONObject.quote(label) + "))";
        waitFor(button + " && !(" + button + ").disabled");
        if (label.equals("Save & close")) {
            evaluate("setTimeout(()=>(" + button + ").click(),0)");
            var confirmation = androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).wait(
                androidx.test.uiautomator.Until.findObject(androidx.test.uiautomator.By.text("OK")), 2000);
            if (confirmation != null) confirmation.click();
        } else if (label.equals("Add photo note") || label.equals("Add audio note")) evaluate("setTimeout(()=>(" + button + ").click(),0)");
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
    private void observeNativeLifecycle() throws Exception {
        evaluate("window.__nativeEvents=[];window.__nativeActive=true;window.__backgroundRequests=0;window.__assignedReads=0;window.addEventListener('open-triage.foreground-changed',event=>{window.__nativeActive=event.detail.active;window.__nativeEvents.push(event.detail.active)},true);window.__originalFetch=window.fetch;window.fetch=(input,init)=>{const url=typeof input==='string'?input:input.url;if(url.includes('/api/')){if(!window.__nativeActive){window.__backgroundRequests++;window.__backgroundPaths?.push(url)}if(url.includes('/calls/assigned'))window.__assignedReads++;}return window.__originalFetch(input,init)}");
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
    private boolean audioEnabled() { return "1".equals(InstrumentationRegistry.getArguments().getString("audio")); }
    private void observeAudio() throws Exception {
        evaluate("""
            (()=>{if(window.__audioObserved)return;window.__audioObserved=true;window.__audioHardwareGranted=false;window.__audioPermissionPending=0;
            const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
            navigator.mediaDevices.getUserMedia=async options=>{if(options.audio)window.__audioPermissionPending++;try{const stream=await get(options);if(options.audio){window.__audioHardwareTracks=stream.getAudioTracks();window.__audioHardwareGranted=window.__audioHardwareTracks.some(track=>track.readyState==='live')}return stream}finally{if(options.audio)window.__audioPermissionPending--}};
            const start=MediaRecorder.prototype.start;MediaRecorder.prototype.start=function(...args){window.__lastAudioRecorder=this;window.__audioChunkCount=0;this.addEventListener('dataavailable',event=>{if(event.data.size)window.__audioChunkCount++});return start.apply(this,args)};
            const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(...args){if(this.tagName==='AUDIO')window.__lastPlayedAudio=this;return play.apply(this,args)}})()
            """);
    }
    private void tapElement(String expression) throws Exception {
        waitFor("(" + expression + ") && !(" + expression + ").disabled");
        var device = androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        // This status notice intentionally stays until an outside user interaction.
        // Dismiss it normally before testing the underlying control's trusted touch.
        if ("true".equals(evaluate("!!document.querySelector('.active-report-notice')"))) {
            assertTrue("A genuine keyboard interaction dismisses the active report notice", device.pressKeyCode(android.view.KeyEvent.KEYCODE_TAB));
            waitFor("!document.querySelector('.active-report-notice')");
        }
        var ime = new java.util.concurrent.atomic.AtomicBoolean();
        activity.onActivity(screen -> { var insets=screen.getBridge().getWebView().getRootWindowInsets();ime.set(insets!=null&&insets.isVisible(android.view.WindowInsets.Type.ime())); });
        if (ime.get()) {
            assertTrue("Dismiss the visible keyboard before touching a media control", device.pressBack());
            long deadline=System.currentTimeMillis()+5000;
            do { Thread.sleep(100); activity.onActivity(screen -> { var insets=screen.getBridge().getWebView().getRootWindowInsets();ime.set(insets!=null&&insets.isVisible(android.view.WindowInsets.Type.ime())); }); } while(ime.get()&&System.currentTimeMillis()<deadline);
            assertFalse("Keyboard must be gone before screen coordinate conversion",ime.get());
        }
        evaluate("window.__tapReady=false;(" + expression + ").scrollIntoView({block:'end',inline:'nearest',behavior:'instant'});requestAnimationFrame(()=>requestAnimationFrame(()=>window.__tapReady=true))");
        waitFor("window.__tapReady");
        JSONObject rectangle = new JSONObject(evaluate("(()=>{const element=(" + expression + ");const rectangle=element.getBoundingClientRect();const x=rectangle.x+rectangle.width/2,y=rectangle.y+rectangle.height/2;const viewport=visualViewport;const hit=document.elementFromPoint(x,y);window.__lastTrustedTap={x,y,width:innerWidth,height:innerHeight,offsetX:viewport?.offsetLeft??0,offsetY:viewport?.offsetTop??0,viewportWidth:viewport?.width??innerWidth,hit:hit?.tagName,hitClass:hit?.className,targetHit:element===hit||element.contains(hit)};window.__trustedMediaClick=false;element.addEventListener('click',event=>{window.__trustedMediaClick=event.isTrusted},{once:true,capture:true});return{x:x-(viewport?.offsetLeft??0),y:y-(viewport?.offsetTop??0),width:viewport?.width??innerWidth}})()"));
        assertEquals("DOM hit testing must reach the selected media control: "+evaluate("JSON.stringify(window.__lastTrustedTap)"),"true",evaluate("window.__lastTrustedTap.targetHit"));
        int[] origin = new int[2]; var width = new java.util.concurrent.atomic.AtomicInteger();
        activity.onActivity(screen -> { var web = screen.getBridge().getWebView(); web.getLocationOnScreen(origin); width.set(web.getWidth()); });
        double scale = width.get() / rectangle.getDouble("width");
        assertTrue("Trusted input reaches the actual shared media control", device.click(
            origin[0] + (int)Math.round(rectangle.getDouble("x") * scale), origin[1] + (int)Math.round(rectangle.getDouble("y") * scale)));
        long deadline=System.currentTimeMillis()+5000;
        while(!"true".equals(evaluate("window.__trustedMediaClick"))&&System.currentTimeMillis()<deadline)Thread.sleep(100);
        assertEquals("A genuine trusted click must reach the exact selected control: "+evaluate("JSON.stringify(window.__lastTrustedTap)"),"true",evaluate("window.__trustedMediaClick"));
    }
    private void beginAudioHold() throws Exception {
        waitFor("document.querySelector('.audio-hold-button') && !document.querySelector('.audio-hold-button').disabled && window.__nativeActive!==false && document.visibilityState==='visible'");
        evaluate("setTimeout(()=>document.querySelector('.audio-hold-button').dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true})),0)");
    }
    private void navigationChecks() throws Exception {
        var device = androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        String originalFont = device.executeShellCommand("settings get system font_scale").trim();
        if (!originalFont.matches("[0-9]+(?:\\.[0-9]+)?")) originalFont = "1.0";
        String size = device.executeShellCommand("wm size");
        var override = java.util.regex.Pattern.compile("Override size: (\\d+x\\d+)").matcher(size);
        String originalSize = override.find() ? override.group(1) : "reset";
        evaluate("window.__navigationRealm=true;window.__navigationTimeOrigin=performance.timeOrigin");
        try {
            device.setOrientationLeft();
            waitFor("innerWidth>innerHeight");
            closeControlReachable();
            assertEquals(JSONObject.quote("ANDROID-CONNECTED-SYNTHETIC"), evaluate("(" + FIELD + ").value"));
            device.setOrientationNatural(); waitFor("innerHeight>innerWidth");
            device.executeShellCommand("settings put system font_scale 1.5");
            long end = System.currentTimeMillis() + 20000;
            var zoom = new java.util.concurrent.atomic.AtomicInteger();
            do { activity.onActivity(screen -> zoom.set(screen.getBridge().getWebView().getSettings().getTextZoom()));
                if (zoom.get() == 150) break; Thread.sleep(150);
            } while (System.currentTimeMillis() < end);
            assertEquals("System accessibility text size reaches the actual WebView", 150, zoom.get());
            waitFor("document.documentElement.scrollWidth<=innerWidth+1");
            tapElement(FIELD);
            var keyboard = new java.util.concurrent.atomic.AtomicBoolean();
            end = System.currentTimeMillis() + 20000;
            do { activity.onActivity(screen -> { var insets=androidx.core.view.ViewCompat.getRootWindowInsets(screen.getWindow().getDecorView());keyboard.set(insets!=null&&insets.isVisible(androidx.core.view.WindowInsetsCompat.Type.ime())); });
                if (keyboard.get()) break; Thread.sleep(150);
            } while (System.currentTimeMillis() < end);
            assertTrue("A trusted touch opens the real Android keyboard", keyboard.get());
            device.waitForIdle(1000);
            closeControlReachable();
            String keyboardHeight = evaluate("innerHeight");
            device.pressBack();
            waitFor("innerHeight>" + keyboardHeight);
            assertEquals("IME Back keeps the current report and edit", JSONObject.quote("ANDROID-CONNECTED-SYNTHETIC"), evaluate("(" + FIELD + ").value"));
            device.executeShellCommand("wm size 1600x2560");
            waitFor("innerWidth>=600");
            waitFor("document.documentElement.scrollWidth<=innerWidth+1");
            closeControlReachable();
            assertEquals("Rotation, text scale and tablet resize retain the same clinical JS realm", "true", evaluate("window.__navigationRealm && performance.timeOrigin===window.__navigationTimeOrigin"));
            device.executeShellCommand("wm size " + originalSize);
            device.executeShellCommand("settings put system font_scale " + originalFont);
            waitFor("(" + FIELD + ")?.value==='ANDROID-CONNECTED-SYNTHETIC'");
            // Back uses the shared durable Save & close path, then reopens under the valid login.
            device.pressBack(); waitFor("!document.querySelector('.encounter-header')");
            device.pressBack(); waitFor("document.querySelector('.presentation-selector button[aria-pressed=true]')?.textContent==='Mobile'");
            device.pressBack(); waitFor("window.__nativeActive===false");
            String packageName = InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName();
            device.executeShellCommand("am start -n " + packageName + "/org.opentriage.development.MainActivity");
            waitFor("window.__nativeActive===true && window.__navigationRealm && performance.timeOrigin===window.__navigationTimeOrigin");
            click("Stationary");
            click("Reopen report"); waitFor("(" + FIELD + ")?.value==='ANDROID-CONNECTED-SYNTHETIC'");
            assertEquals("No reauthentication prompt is introduced by native navigation", "true", evaluate("!document.querySelector('.report-reauthentication') && !document.querySelector('input[type=password]')"));
        } finally {
            device.executeShellCommand("wm size " + originalSize);
            device.executeShellCommand("settings put system font_scale " + originalFont);
            device.setOrientationNatural(); device.unfreezeRotation();
        }
    }
    private void closeControlReachable() throws Exception {
        String control = "Array.from(document.querySelectorAll('.draft-actions button')).find(button=>button.textContent==='Save & close')";
        evaluate("(" + control + ").scrollIntoView({block:'center',inline:'center'})");
        waitFor("(()=>{const button=" + control + ";const r=button.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()");
    }
    private void endAudioHold() throws Exception {
        evaluate("document.querySelector('.audio-hold-button')?.dispatchEvent(new KeyboardEvent('keyup',{key:' ',bubbles:true}))");
    }
    private void audioCaption(String caption) throws Exception {
        waitFor("document.querySelector('#report-audio-caption')");
        evaluate("(()=>{const input=document.querySelector('#report-audio-caption');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input," + JSONObject.quote(caption) + ");input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()");
    }
    private void recordAudioPreview(boolean interrupted) throws Exception {
        beginAudioHold(); waitFor("window.__lastAudioRecorder?.state==='recording'");
        assertEquals("Actual WebView microphone capture reaches a real live hardware track", "true", evaluate("window.__audioHardwareGranted && window.__audioHardwareTracks.some(track=>track.readyState==='live')"));
        Thread.sleep(2200);
        if (interrupted) { activity.moveToState(Lifecycle.State.CREATED); Thread.sleep(300); }
        else endAudioHold();
        waitFor("document.querySelector('.audio-note-dialog .audio-preview')");
        assertEquals("No hidden recorder or microphone track remains after stopping", "true", evaluate("window.__lastAudioRecorder.state!=='recording' && window.__audioHardwareTracks.every(track=>track.readyState==='ended')"));
        if (interrupted) { activity.moveToState(Lifecycle.State.RESUMED); waitFor("window.__nativeActive!==false && document.querySelector('.audio-note-dialog').innerText.includes('Recording interrupted')"); }
    }
    private void useAudioPreview(String caption, boolean interrupted) throws Exception {
        audioCaption(caption); click(interrupted ? "Use interrupted recording" : "Use recording");
        waitFor("!document.querySelector('.audio-note-dialog') && document.body.innerText.includes(" + JSONObject.quote(caption) + ")");
    }
    private void interruptOnlineAudio() throws Exception {
        click("Add audio note"); beginAudioHold(); waitFor("window.__lastAudioRecorder?.state==='recording'");
        Thread.sleep(2200); records();
        evaluate("window.__beforeOnlineAudioPause=window.__retained[0].ciphertextRevision;window.__backgroundRequests=0;window.__backgroundPaths=[]");
        activity.moveToState(Lifecycle.State.CREATED); waitFor("window.__nativeActive===false");
        waitFor("document.querySelector('.audio-note-dialog .audio-preview') && window.__audioHardwareTracks.every(track=>track.readyState==='ended')");
        long deadline=System.currentTimeMillis()+30000; boolean durable=false;
        while(System.currentTimeMillis()<deadline){records();if("true".equals(evaluate("window.__retained[0].ciphertextRevision>window.__beforeOnlineAudioPause"))){durable=true;break;}Thread.sleep(100);}
        assertTrue("An online interrupted recorder commits encrypted local bytes while native-paused",durable);
        Thread.sleep(1200);
        assertEquals("Paused local audio durability starts no new API requests: "+evaluate("JSON.stringify(window.__backgroundPaths)"),"0",evaluate("window.__backgroundRequests"));
        activity.moveToState(Lifecycle.State.RESUMED);
        waitFor("window.__nativeActive!==false && document.querySelector('.audio-note-dialog').innerText.includes('Recording interrupted')");
        click("Cancel");waitFor("!document.querySelector('.audio-note-dialog')");
    }
    private void audioOfflineCapture() throws Exception {
        click("Mobile"); click("Add audio note"); observeAudio(); beginAudioHold();
        var denied = androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).wait(
            androidx.test.uiautomator.Until.findObject(androidx.test.uiautomator.By.res(java.util.regex.Pattern.compile(".*:id/permission_deny_button"))), 15000);
        assertNotNull("Shared audio capture requests actual Android microphone permission", denied); denied.click();
        waitFor("document.querySelector('.audio-note-dialog [role=alert]')?.textContent.includes('Android app settings')"); endAudioHold(); click("Cancel");
        click("Add audio note"); beginAudioHold();
        var granted = androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).wait(
            androidx.test.uiautomator.Until.findObject(androidx.test.uiautomator.By.res(java.util.regex.Pattern.compile(".*:id/permission_allow_foreground_only_button"))), 15000);
        assertNotNull("Explicit retry permits actual microphone permission grant", granted); granted.click();
        waitFor("window.__audioPermissionPending===0");
        assertEquals(android.content.pm.PackageManager.PERMISSION_GRANTED,
            InstrumentationRegistry.getInstrumentation().getTargetContext().checkSelfPermission(android.Manifest.permission.RECORD_AUDIO));
        assertEquals("A late permission result releases any returned microphone tracks", "true", evaluate("(window.__audioHardwareTracks??[]).every(track=>track.readyState==='ended')"));
        assertEquals("A permission result after native pause cannot secretly begin recording", "true", evaluate("!window.__lastAudioRecorder || window.__lastAudioRecorder.state!=='recording'"));
        recordAudioPreview(false);
        tapElement("Array.from(document.querySelectorAll('.audio-note-dialog button')).find(button=>button.textContent.trim()==='Play preview')");
        waitFor("document.querySelector('.audio-preview audio').currentTime>0 && !document.querySelector('.audio-preview audio').paused");
        activity.moveToState(Lifecycle.State.CREATED); Thread.sleep(300);
        assertEquals("Native pause stops actual preview playback", "true", evaluate("document.querySelector('.audio-preview audio').paused"));
        activity.moveToState(Lifecycle.State.RESUMED); waitFor("window.__nativeActive!==false");
        useAudioPreview("ANDROID-AUDIO-RESUME-SYNTHETIC", false);
        evaluate("window.__backgroundRequests=0;window.__backgroundPaths=[]"); activity.moveToState(Lifecycle.State.CREATED);
        waitFor("window.__nativeActive===false"); connection(true); Thread.sleep(1200);
        assertEquals("Paused reconnect must not start audio or other API drains: " + evaluate("JSON.stringify(window.__backgroundPaths)"), "0", evaluate("window.__backgroundRequests"));
        activity.moveToState(Lifecycle.State.RESUMED); waitFor("window.__nativeActive!==false"); verifyCanonicalAudio("ANDROID-AUDIO-RESUME-SYNTHETIC");
        waitFor("Array.from(document.querySelectorAll('.audio-note-event')).some(row=>row.textContent.includes('ANDROID-AUDIO-RESUME-SYNTHETIC')&&row.textContent.includes('Ready'))");
        interruptOnlineAudio();
        connection(false); click("Stationary"); waitFor(FIELD);
    }
    private void stageRetainedAudio() throws Exception {
        click("Mobile"); click("Add audio note"); recordAudioPreview(true); useAudioPreview("ANDROID-AUDIO-SYNTHETIC", true);
        click("Stationary"); waitFor(FIELD); records();
        assertFalse("Audio captions and source bytes remain encrypted at rest", evaluate("JSON.stringify(window.__retained)").contains("ANDROID-AUDIO"));
        assertFalse("Audio never enters localStorage as plaintext", evaluate("JSON.stringify({...localStorage})").contains("audio/webm"));
    }
    private void startUnfinishedAudio() throws Exception {
        records(); evaluate("window.__audioBeforeCiphertext=window.__retained[0].ciphertextRevision");
        click("Mobile"); click("Add audio note"); beginAudioHold(); waitFor("window.__lastAudioRecorder?.state==='recording'");
        waitFor("window.__audioChunkCount>0");
        androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack();
        waitFor("document.querySelector('.audio-note-dialog .audio-preview') && document.querySelector('.audio-note-dialog').innerText.includes('Recording interrupted')");
        assertEquals("Hardware Back stops the recorder and keeps an explicit unfinished-media decision", "true", evaluate("window.__lastAudioRecorder.state!=='recording' && window.__audioHardwareTracks.every(track=>track.readyState==='ended') && document.querySelector('.audio-note-dialog').innerText.includes('Use interrupted recording')"));
        click("Cancel"); waitFor("!document.querySelector('.audio-note-dialog')");
        records(); evaluate("window.__audioBeforeCiphertext=window.__retained[0].ciphertextRevision");
        click("Add audio note"); beginAudioHold(); waitFor("window.__lastAudioRecorder?.state==='recording'");
        waitFor("window.__audioChunkCount>0");
        long end = System.currentTimeMillis() + 30000;
        boolean durable = false;
        while (System.currentTimeMillis() < end) {
            records(); if ("true".equals(evaluate("window.__retained[0].ciphertextRevision>=window.__audioBeforeCiphertext+2"))) { durable = true; break; }
            Thread.sleep(150);
        }
        assertTrue("An unfinished recording has actual encrypted durable time slices before host process loss", durable);
        assertEquals("The host must kill a genuinely live unsaved recorder", "recording", new org.json.JSONTokener(evaluate("window.__lastAudioRecorder.state")).nextValue());
        assertEquals("Unsaved speech is not advertised as a saved audio note", "true", evaluate("!document.querySelector('.audio-note-dialog').innerText.includes('Saved on this device')"));
    }
    private void verifyCanonicalAudio(String caption) throws Exception {
        evaluate("window.__audioVerified=null;(async()=>{for(let attempt=0;attempt<80;attempt++){try{const report=await(await fetch('/api/reports/'+window.__reportId)).json();const find=value=>{if(!value||typeof value!=='object')return null;if(value.type==='audio'&&value.caption===" + JSONObject.quote(caption) + ")return value;for(const item of Object.values(value)){const found=find(item);if(found)return found}return null};const note=find(report);if(note?.persistenceState==='ready'){const response=await fetch('/api/reports/'+window.__reportId+'/audio/'+note.id+'/content');if(!response.ok||response.headers.get('content-type')!=='audio/mp4')throw Error('audio');const bytes=new Uint8Array(await response.arrayBuffer());const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');if(hash!==note.sha256||bytes.length!==note.byteSize||String.fromCharCode(...bytes.slice(4,8))!=='ftyp')throw Error('bytes');const context=new AudioContext();try{const decoded=await context.decodeAudioData(bytes.buffer.slice(0));if(decoded.numberOfChannels!==1||decoded.sampleRate<=0||decoded.duration<=0||decoded.duration>301)throw Error('decode')}finally{await context.close()}window.__audioVerified=true;return}}catch{}await new Promise(resolve=>setTimeout(resolve,500))}window.__audioVerified=false})()");
        waitFor("window.__audioVerified!==null"); assertEquals("Actual upload and authorized playback return exact fully decoded mono AAC", "true", evaluate("window.__audioVerified"));
    }
    private void playTimelineAudio(String caption) throws Exception {
        String button = "Array.from(document.querySelectorAll('.audio-note-event')).find(row=>row.textContent.includes(" + JSONObject.quote(caption) + "))?.querySelector('.timeline-audio-action')";
        evaluate("window.__lastPlayedAudio=null");
        tapElement(button); waitFor("window.__lastPlayedAudio?.currentTime>0 && !window.__lastPlayedAudio.error && (!window.__lastPlayedAudio.paused || window.__lastPlayedAudio.ended)");
        activity.moveToState(Lifecycle.State.CREATED); Thread.sleep(300);
        assertEquals("Authorized audio playback stops on native pause", "true", evaluate("window.__lastPlayedAudio.paused"));
        activity.moveToState(Lifecycle.State.RESUMED); assertEquals("Playback does not restart without a user action", "true", evaluate("window.__lastPlayedAudio.paused"));
    }
    private void verifyRecoveredAudio() throws Exception {
        observeAudio(); verifyCanonicalAudio("ANDROID-AUDIO-SYNTHETIC"); click("Mobile"); playTimelineAudio("ANDROID-AUDIO-SYNTHETIC");
        assertEquals("An already acknowledged audio note remains ready after recovery", "true", evaluate("Array.from(document.querySelectorAll('.audio-note-event')).some(row=>row.textContent.includes('ANDROID-AUDIO-RESUME-SYNTHETIC')&&row.textContent.includes('Ready'))"));
        click("Stationary"); evaluate("(()=>{const button=document.querySelector('.timeline-toggle-action');if(button?.getAttribute('aria-expanded')==='false')button.click()})()");
        waitFor("document.querySelector('.stationary-timeline-sidebar')"); playTimelineAudio("ANDROID-AUDIO-SYNTHETIC");
        if ("1".equals(InstrumentationRegistry.getArguments().getString("unsavedAudio"))) {
            assertEquals("Revoked microphone permission does not prevent authorized retained playback or restart a recorder", android.content.pm.PackageManager.PERMISSION_DENIED,
                InstrumentationRegistry.getInstrumentation().getTargetContext().checkSelfPermission(android.Manifest.permission.RECORD_AUDIO));
            click("Mobile"); click("Add audio note"); waitFor("document.querySelector('.audio-note-dialog').innerText.includes('Recording interrupted')");
            waitFor("document.querySelector('.audio-note-dialog button') && Array.from(document.querySelectorAll('.audio-note-dialog button')).some(button=>button.textContent.trim()==='Use interrupted recording')");
            assertEquals("A restored incomplete recorder is never restarted automatically", "true", evaluate("!window.__lastAudioRecorder || window.__lastAudioRecorder.state!=='recording'"));
            click("Cancel"); click("Add audio note"); waitFor("document.querySelector('.audio-hold-button')");
            assertEquals("Explicit discard removes the restored partial preview", "null", evaluate("document.querySelector('.audio-preview')")); click("Cancel");
            click("Stationary"); waitFor(FIELD);
        }
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
    private void snapshotUpgradeLogin() throws Exception {
        var context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        JSONObject session=new JSONObject(evaluate("JSON.parse(localStorage.getItem('open-triage.clinician-session.v1'))"));
        var connection=new ConnectionVault(context).read();assertNotNull(connection);
        String cookie=null;var cookies=connection.saved().getJSONArray("cookies");
        for(int index=0;index<cookies.length();index++)if("open_triage_session".equals(cookies.getJSONObject(index).getString("name")))cookie=cookies.getJSONObject(index).getString("value");
        int uid=context.getApplicationInfo().uid;
        String hash=UpgradeSessionProof.cookieHash(cookie,uid,connection.origin);
        String csrf=session.getString("csrfToken"),user=session.getJSONObject("user").getString("id"),organization=session.getJSONObject("organization").getString("id");
        UpgradeSessionProof.csrf(null,csrf,user,user,organization,organization,hash,hash,uid,uid);
        assertTrue(context.getSharedPreferences("release-upgrade-acceptance",android.content.Context.MODE_PRIVATE).edit()
            .putString("loginCsrf",csrf).putString("loginUser",user).putString("loginOrganization",organization).putString("loginCookieHash",hash).putInt("loginUid",uid).commit());
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
        var args=InstrumentationRegistry.getArguments();
        editor.putString("historicalReceipt",HistoricalUpgradePreparation.prepareReceipt(args.getString("preparationProfile","current"),
            args.getString("upgradeReceipt",""),context.getPackageName(),context.getPackageManager().getPackageInfo(context.getPackageName(),0).getLongVersionCode(),
            args.getString("phase"),"1".equals(args.getString("upgrade"))));
        assertTrue(editor.commit());
        snapshotUpgradeLogin();
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
        observeNativeLifecycle();
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
        // Release A may predate navigation support; its pending-work upgrade remains valid.
        if (!"1".equals(args.getString("upgrade"))) navigationChecks();
        assertEquals("1", evaluate("window.__retained.length"));
        assertEquals("true", evaluate("!JSON.stringify({...localStorage}).includes('ANDROID-CONNECTED') && !JSON.stringify(window.__retained).includes('ANDROID-CONNECTED')"));
        connection(false); setInput(FIELD, "ANDROID-RECONNECTED-SYNTHETIC");
        waitFor("document.querySelector('.sync-status')?.textContent==='Pending sync'");
        connection(true); serverValue("ANDROID-RECONNECTED-SYNTHETIC");
        assertEquals(JSONObject.quote("ANDROID-RECONNECTED-SYNTHETIC"), evaluate("(" + FIELD + ").value"));
        connection(false);
        var context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        String historicalReceipt=HistoricalUpgradePreparation.prepareReceipt(args.getString("preparationProfile","current"),
            args.getString("upgradeReceipt",""),context.getPackageName(),context.getPackageManager().getPackageInfo(context.getPackageName(),0).getLongVersionCode(),
            args.getString("phase"),"1".equals(args.getString("upgrade")));
        if (historicalReceipt.isEmpty()) {
            if (audioEnabled()) audioOfflineCapture();
            photoOfflineCapture();
            if (audioEnabled()) stageRetainedAudio();
        }
        else {
            var profile=new android.os.Bundle();profile.putString("opentriage_upgrade_preparation_profile","historical-a1-text-v1");
            InstrumentationRegistry.getInstrumentation().sendStatus(0,profile);
        }
        records();
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
        if ("1".equals(args.getString("unsavedAudio"))) startUnfinishedAudio();
        else {
        evaluate("window.__beforeStorageFailure=JSON.stringify(window.__retained);window.__put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='encrypted-reports')throw new DOMException('Synthetic storage failure','QuotaExceededError');return window.__put.apply(this,args)}");
        setInput(FIELD, "ANDROID-WRITE-FAILURE");
        waitFor("document.body.innerText.includes('Protected storage failed while offline')"); waitFor("!(" + FIELD + ") || (" + FIELD + ").matches(':disabled') || (" + FIELD + ").readOnly");
        records(); assertEquals("true", evaluate("JSON.stringify(window.__retained)===window.__beforeStorageFailure"));
        // The test runner must not finish/close the Activity before abrupt process loss.
        assertEquals("true", evaluate("Boolean(document.querySelector('.encounter-header'))"));
        }
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
        if (!historicalRecovery("recover")) {
            verifyRecoveredPhoto();
            if (audioEnabled()) verifyRecoveredAudio();
        }
        assertFalse(evaluate("JSON.stringify({...localStorage})").contains(RETAINED));
    }
    private String pdfBoundaryEvidence() throws Exception {
        evaluate("window.__pdfBoundaryStats=null;fetch('/api/__android-pdf-download-fail?reportId='+"+JSONObject.quote(InstrumentationRegistry.getArguments().getString("reportId"))+ ").then(response=>response.json()).then(value=>window.__pdfBoundaryStats=value).catch(()=>window.__pdfBoundaryStats={unavailable:true})");
        waitFor("Boolean(window.__pdfBoundaryStats)");
        String proof=evaluate("JSON.stringify({native:window.__nativePdfObservation?{total:window.__nativePdfObservation.total,closes:window.__nativePdfObservation.closes,calls:window.__nativePdfObservation.calls}:null,server:window.__pdfBoundaryStats,interaction:window.__pdfInteraction,modal:document.querySelector('.signed-report-pdf-dialog')?.textContent.slice(0,320),configured:window.__reviewNative?.configured,platform:window.Capacitor?.getPlatform?.()})");
        var evidence=new android.os.Bundle();evidence.putString("opentriage_pdf_boundary",proof);InstrumentationRegistry.getInstrumentation().sendStatus(0,evidence);return proof;
    }
    private void signReview() throws Exception {
        String reportId=InstrumentationRegistry.getArguments().getString("reportId");
        waitFor("document.querySelector('.session-identity') && document.querySelector('.call-directory')");
        assertEquals("A valid retained login opens without another password prompt","false",evaluate("!!document.querySelector('input[name=password]')"));
        click("Reopen report");waitFor("document.querySelector('.encounter-header')");
        evaluate("window.__reportId="+JSONObject.quote(reportId));
        if(!"true".equals(evaluate("Boolean("+FIELD+")")))click("Stationary");
        waitFor("("+FIELD+")?.value==='"+RETAINED+"'");
        evaluate("window.__signAuthenticationPosts=0;(()=>{const original=window.fetch;window.fetch=(input,init)=>{const path=String(input);if((init?.method??'GET').toUpperCase()==='POST'&&/\\/api\\/sessions(?:$|[/?])/.test(path))window.__signAuthenticationPosts++;return original(input,init)}})()");
        evaluate("window.__mediaHold=null;fetch('/api/__android-pdf-media-hold?reportId='+window.__reportId+'&hold=1',{method:'POST'}).then(response=>response.json()).then(value=>window.__mediaHold=value.held)");
        waitFor("window.__mediaHold===true");
        try {
            click("Mobile");click("Add photo note");waitFor("document.querySelector('.photo-note-dialog video')?.videoWidth>0");
            stageSyntheticPhoto("ANDROID-PDF-MEDIA-RETRY-SYNTHETIC");
            click("Review & sign");waitFor("document.querySelector('.note-readiness') && document.querySelector('.review-actions button')?.disabled");
            assertEquals("Online signing retains its existing unresolved-media blocker","true",evaluate("navigator.onLine && document.querySelector('.note-readiness').textContent.includes('Photo')"));
            evaluate("window.__mediaHold=null;fetch('/api/__android-pdf-media-hold?reportId='+window.__reportId+'&hold=0',{method:'POST'}).then(response=>response.json()).then(value=>window.__mediaHold=value.held)");
            waitFor("window.__mediaHold===false");
            waitFor("document.querySelector('.note-readiness').textContent.includes('retry')");
            evaluate("document.querySelector('.note-readiness button').click()");click("Retry upload");
            waitFor("!document.querySelector('.photo-note-dialog') || !Array.from(document.querySelectorAll('.photo-note-dialog button')).some(button=>button.textContent==='Retry upload')");
            if("true".equals(evaluate("!!document.querySelector('.photo-note-dialog')")))click("Cancel");
            verifyCanonicalPhoto("ANDROID-PDF-MEDIA-RETRY-SYNTHETIC");
            waitFor("!document.querySelector('.note-readiness') && document.querySelector('.review-actions button') && !document.querySelector('.review-actions button').disabled");
            click("Sign record");waitFor("document.querySelector('.call-directory') && !document.querySelector('.encounter-header')");
            assertEquals("Shared online signing trusts the existing valid login","0",evaluate("window.__signAuthenticationPosts"));
        } finally {
            evaluate("fetch('/api/__android-pdf-media-hold?reportId='+window.__reportId+'&hold=0',{method:'POST'})");
        }
        evaluate("window.__reviewNative=null;window.Capacitor.nativePromise('OpenTriageConnection','state',{}).then(state=>window.__reviewNative=state)");waitFor("Boolean(window.__reviewNative)");
        String nativeContext=(String)new org.json.JSONTokener(evaluate("window.__reviewNative.connectionContext")).nextValue();
        String beforeReview=evaluate("performance.timeOrigin");
        activity.onActivity(screen->screen.getBridge().getWebView().loadUrl("https://localhost/review-call/?report="+reportId+"&dataset=synthetic&language=en"));
        waitFor("document.readyState==='complete' && performance.timeOrigin!=="+beforeReview+" && location.pathname==='/review-call/' && window.Capacitor?.getPlatform?.()==='android' && Boolean(window.Capacitor?.nativePromise)");
        evaluate("window.__reviewNative=null;window.Capacitor.nativePromise('OpenTriageConnection','state',{}).then(state=>window.__reviewNative=state)");waitFor("Boolean(window.__reviewNative)");
        assertEquals("Full Review navigation keeps the actual configured native installation","true",evaluate("window.__reviewNative.configured"));
        assertEquals(nativeContext,new org.json.JSONTokener(evaluate("window.__reviewNative.connectionContext")).nextValue());
        waitFor("document.querySelector('#review-full-report') && Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='Inspect signed PDF')");
        assertEquals("Signed Review is still under the valid logged-in principal","false",evaluate("!!document.querySelector('input[name=password]')"));
        evaluate("Array.from(document.querySelectorAll('.review-report-toolbar button')).find(button=>button.textContent.startsWith('Timeline')).click()");
        waitFor("document.querySelector('.review-timeline-sidebar .photo-thumbnail')?.naturalWidth===640");
        if(audioEnabled()){observeAudio();playTimelineAudio("ANDROID-AUDIO-SYNTHETIC");}
        String observerBase64=InstrumentationRegistry.getArguments().getString("nativePdfObserverBase64");assertNotNull(observerBase64);assertTrue(observerBase64.length()<16384);
        String observer=new String(java.util.Base64.getDecoder().decode(observerBase64),java.nio.charset.StandardCharsets.UTF_8);
        evaluate("window.__nativePdfObservation=("+observer+")(window.Capacitor)");
        evaluate("window.__pdfFailureArmed=null;fetch('/api/__android-pdf-download-fail?reportId='+"+JSONObject.quote(reportId)+",{method:'POST'}).then(response=>response.json()).then(value=>window.__pdfFailureArmed=value.armed)");
        waitFor("window.__pdfFailureArmed===true");
        click("Inspect signed PDF");
        waitFor("document.querySelector('.signed-report-pdf-dialog [role=alert]')?.textContent.includes('The signed PDF could not be loaded')");
        assertEquals("Native failure preserves localized shared Retry without leaking raw fixture/server prose","false",evaluate("document.querySelector('.signed-report-pdf-dialog').textContent.includes('fixture.download-unavailable')"));
        String firstBoundary=pdfBoundaryEvidence();
        assertEquals("The registered application plugin actually traverses the observed nativePromise boundary: "+firstBoundary,"1",evaluate("window.__nativePdfObservation.total"));
        assertEquals("The first failed open consumed exactly the armed server PDF503 before user Retry: "+firstBoundary,"true",evaluate("window.__pdfBoundaryStats.requests===1 && window.__pdfBoundaryStats.failures===1 && !window.__pdfBoundaryStats.armed && window.__pdfBoundaryStats.statuses.length===1 && window.__pdfBoundaryStats.statuses[0]===503 && window.__nativePdfObservation.calls[0].settled && window.__nativePdfObservation.calls[0].status===503"));
        var rejectedFiles=NativePdfSessions.directory(InstrumentationRegistry.getInstrumentation().getTargetContext()).listFiles((directory,name)->name.matches("[a-f0-9-]{36}\\.pdf"));
        assertTrue("A denied/failed native PDF response leaves no private preview",rejectedFiles==null||rejectedFiles.length==0);
        evaluate("window.__pdfInteraction={candidates:Array.from(document.querySelectorAll('button')).filter(button=>button.offsetParent!==null&&(button.textContent.trim()==='Retry'||button.getAttribute('aria-label')==='Retry')).map(button=>({pdf:!!button.closest('.signed-report-pdf-dialog'),dialog:button.closest('dialog')?.className??null,type:button.type,ancestors:[button.parentElement?.tagName,button.parentElement?.className,button.parentElement?.parentElement?.tagName,button.parentElement?.parentElement?.className]})).slice(0,8),clicks:[],events:[],states:[],errors:[]};document.addEventListener('click',event=>{const button=event.target.closest('button');if(button&&['Retry','Close'].includes(button.textContent.trim())&&window.__pdfInteraction.clicks.length<8)window.__pdfInteraction.clicks.push({retry:button.textContent.trim()==='Retry',pdf:!!button.closest('.signed-report-pdf-dialog'),type:button.type})},true);for(const name of ['close','cancel'])document.querySelector('.signed-report-pdf-dialog').addEventListener(name,()=>{if(window.__pdfInteraction.events.length<8)window.__pdfInteraction.events.push(name)});window.addEventListener('error',event=>{if(window.__pdfInteraction.errors.length<8)window.__pdfInteraction.errors.push(event.error?.name??'unknown')});window.__pdfDomObserver=new MutationObserver(()=>{const state={modal:!!document.querySelector('.signed-report-pdf-dialog'),open:!!document.querySelector('.signed-report-pdf-dialog[open]'),report:!!document.querySelector('#review-full-report'),review:!!document.querySelector('.review-report-full')};const states=window.__pdfInteraction.states;if(states.length<8&&JSON.stringify(states[states.length-1])!==JSON.stringify(state))states.push(state)});window.__pdfDomObserver.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open']})");
        click("Retry");
        var device=androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        var rendered=device.wait(androidx.test.uiautomator.Until.findObject(androidx.test.uiautomator.By.desc(java.util.regex.Pattern.compile("Page 1 of [1-9][0-9]*"))),15000);
        if(rendered==null)pdfBoundaryEvidence();
        assertNotNull("The authorized immutable signed report traverses the configured native TLS/cookie connection into the actual renderer",rendered);
        device.pressBack();waitFor("document.querySelector('[data-native-pdf-controls]')");
        assertEquals("Native signed PDF viewing leaves no browser blob/iframe path","false",evaluate("!!document.querySelector('.signed-report-pdf-dialog iframe')"));
        click("Close");evaluate("window.__nativePdfObservation.restore();window.__pdfDomObserver.disconnect()");
    }
    private void deniedPdf() throws Exception {
        var args=InstrumentationRegistry.getArguments();
        waitFor("document.querySelector('.session-identity') || document.querySelector('input[name=username]')");
        if("true".equals(evaluate("!!document.querySelector('.session-identity')")))click("Log out");
        signIn(args.getString("username"),args.getString("password"));
        assertFalse("A wrapper does not expose an unauthorized clinician's signed call",evaluate("document.body.innerText").contains(args.getString("callNumber")));
        String path="/api/review/reports/"+args.getString("reportId")+"/snapshots/"+args.getString("snapshotId")+"/pdf?amendmentSequence=0&language=en&dataset=synthetic";
        evaluate("window.__pdfDenied=null;(async()=>{const bridge=window.Capacitor.Plugins.OpenTriageConnection;const state=await bridge.state();window.__pdfDenied=await bridge.openPdf({operationId:crypto.randomUUID(),connectionContext:state.connectionContext,path:"+JSONObject.quote(path)+",headers:{'x-organization-id':"+JSONObject.quote(args.getString("organizationId"))+"},action:'view',language:'en'})})().catch(()=>window.__pdfDenied={failed:true})");
        waitFor("window.__pdfDenied!==null");
        assertEquals("Current server scope denies the native signed PDF despite a valid login","404",evaluate("window.__pdfDenied.status"));
        assertEquals("Denied downloads never launch a native file viewer","false",evaluate("window.__pdfDenied.opened"));
        activity.onActivity(screen->screen.getBridge().getWebView().loadUrl("https://localhost/review-call/?report="+args.getString("reportId")+"&dataset=synthetic&language=en"));
        waitFor("document.body.innerText.includes('This signed report is unavailable in your Review scope.')");
        assertEquals("Denied Review has no PDF action","false",evaluate("Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='Inspect signed PDF')"));
    }
    private void remotePdf() throws Exception {
        var args=InstrumentationRegistry.getArguments();String reportId=args.getString("reportId");
        waitFor("document.querySelector('.session-identity')");
        activity.onActivity(screen->screen.getBridge().getWebView().loadUrl("https://localhost/review-call/?report="+reportId+"&dataset=synthetic&language=en"));
        waitFor("Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='Inspect signed PDF')");click("Inspect signed PDF");
        var device=androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        var page=androidx.test.uiautomator.By.desc(java.util.regex.Pattern.compile("Page 1 of [1-9][0-9]*"));
        assertNotNull(device.wait(androidx.test.uiautomator.Until.findObject(page),15000));
        var files=NativePdfSessions.directory(InstrumentationRegistry.getInstrumentation().getTargetContext()).listFiles((directory,name)->name.matches("[a-f0-9-]{36}\\.pdf"));
        assertNotNull(files);assertEquals("A real private signed PDF is visible when the host changes server authority",1,files.length);
        long started=android.os.SystemClock.elapsedRealtime();
        var ready=new android.os.Bundle();ready.putString("opentriage_pdf_authority_phase","visible-awaiting-server-change");InstrumentationRegistry.getInstrumentation().sendStatus(0,ready);
        assertTrue("The static native page detects real server incompatibility/revocation/workspace withdrawal within its 30-second cadence plus request latency",device.wait(androidx.test.uiautomator.Until.gone(page),45000));
        assertFalse("Remote authority loss deletes the actual private signed PDF",files[0].exists());
        if("server-incompatible".equals(args.getString("authorityChange"))) {
            String operation=java.util.UUID.randomUUID().toString();
            String path="/api/review/reports/"+reportId+"/snapshots/"+args.getString("snapshotId")+"/pdf?amendmentSequence=0&language=en&dataset=synthetic";
            evaluate("window.__pdfIncompatible=null;(async()=>{const state=await window.Capacitor.nativePromise('OpenTriageConnection','state',{});try{window.__pdfIncompatible={value:await window.Capacitor.nativePromise('OpenTriageConnection','openPdf',{operationId:"+JSONObject.quote(operation)+",connectionContext:state.connectionContext,path:"+JSONObject.quote(path)+",headers:{'x-organization-id':"+JSONObject.quote(args.getString("organizationId"))+"},language:'en',action:'view',accent:''})};}catch(error){window.__pdfIncompatible={error:error.code};}})()");
            waitFor("Boolean(window.__pdfIncompatible)");
            assertEquals("An incompatible server cannot open another native PDF under the still-valid login","\"SERVER_INCOMPATIBLE\"",evaluate("window.__pdfIncompatible.error"));
            assertNull("Denied open leaves no native authority",NativePdfSessions.get(operation));
            activity.onActivity(screen->assertFalse("Denied open removes the exact pending operation instead of leaking a bounded slot",NativePdfSessions.pending(screen.getBridge().getPlugin("OpenTriageConnection").getInstance(),operation)));
            assertFalse("Denied open cannot display a native page",device.hasObject(page));
            assertEquals("Denied open leaves no private preview",0,NativePdfSessions.directory(InstrumentationRegistry.getInstrumentation().getTargetContext()).listFiles((directory,name)->name.matches("[a-f0-9-]{36}\\.pdf")).length);
        }
        var evidence=new android.os.Bundle();evidence.putLong("opentriage_pdf_authority_detection_ms",android.os.SystemClock.elapsedRealtime()-started);evidence.putString("opentriage_pdf_authority_change",args.getString("authorityChange"));InstrumentationRegistry.getInstrumentation().addResults(evidence);
    }
    private boolean historicalRecovery(String phase) throws Exception {
        var args=InstrumentationRegistry.getArguments();
        var context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        String saved=context.getSharedPreferences("release-upgrade-acceptance",android.content.Context.MODE_PRIVATE).getString("historicalReceipt","");
        return HistoricalUpgradePreparation.recovered(args.getString("originPreparationProfile","current"),saved,args.getString("upgradeReceipt",""),
            context.getPackageName(),context.getPackageManager().getPackageInfo(context.getPackageName(),0).getLongVersionCode(),phase,"1".equals(args.getString("upgrade")));
    }
    private void postUpgradePhoto() throws Exception {
        assertTrue("New media acceptance requires the exact retained A1-to-B receipt",historicalRecovery("post-upgrade-photo"));
        waitFor("document.querySelector('.session-identity') && document.querySelector('.call-directory')");
        click("Reopen report");waitFor("document.querySelector('.encounter-header')");
        evaluate("window.__reportId=document.querySelector('.active-report-notice').dataset.reportId");
        if (!"true".equals(evaluate("Boolean("+FIELD+")"))) click("Stationary");
        waitFor("("+FIELD+")?.value==='"+RETAINED+"'");
        observeNativeLifecycle();
        connection(false);photoOfflineCapture();connection(true);verifyRecoveredPhoto();
        assertFalse(evaluate("JSON.stringify({...localStorage})").contains(RETAINED));
        var proof=new android.os.Bundle();proof.putString("opentriage_upgrade_current_media","real-B-photo-permission-pause-offline-bytes-canonical");
        InstrumentationRegistry.getInstrumentation().sendStatus(0,proof);
        snapshotUpgradeLogin();
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
        var vault=new ConnectionVault(InstrumentationRegistry.getInstrumentation().getTargetContext());
        assertNotNull(vault.pending());
        String journal=vault.pending().toString();
        evaluate("window.__pendingAuthentication=null;(async()=>{const bridge=window.Capacitor.Plugins.OpenTriageConnection;const outcome=await bridge.finishAuthentication();let denied=false;try{await bridge.beginAuthentication({purpose:'login'});}catch{denied=true;}window.__pendingAuthentication={outcome:outcome.outcome,denied};})().catch(()=>window.__pendingAuthentication={failed:true})");
        waitFor("window.__pendingAuthentication!==null");
        assertEquals("Confirmed pending enrollment cannot redeem a browser return", "\"idle\"",evaluate("window.__pendingAuthentication.outcome"));
        assertEquals("Confirmed pending enrollment cannot begin authentication", "true",evaluate("window.__pendingAuthentication.denied"));
        assertTrue("Authentication attempts preserve the exact enrollment journal",journal.equals(vault.pending().toString()));
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
            case "sign-review": signReview(); activity.close(); break;
            case "denied-pdf": deniedPdf(); activity.close(); break;
            case "remote-pdf": remotePdf(); activity.close(); break;
            case "post-upgrade-photo": postUpgradePhoto(); activity.close(); break;
            case "upgrade-session-snapshot": waitFor("document.querySelector('.session-identity')"); snapshotUpgradeLogin(); activity.close(); break;
            default: fail("Host must supply a recovery phase");
        }
    }
}
