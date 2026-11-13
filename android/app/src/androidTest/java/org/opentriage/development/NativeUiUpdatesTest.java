package org.opentriage.development;

import static org.junit.Assert.*;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import javax.net.ssl.*;

/** Real WebView, native private-CA transport, document-start bridge and browser CacheStorage. */
@RunWith(AndroidJUnit4.class)
public class NativeUiUpdatesTest {
    private String evaluate(ActivityScenario<MainActivity> activity, String script) throws Exception {
        var result = new AtomicReference<String>(); var done = new CountDownLatch(1);
        activity.onActivity(screen -> screen.getBridge().getWebView().evaluateJavascript(script, value -> { result.set(value); done.countDown(); }));
        assertTrue(done.await(10, TimeUnit.SECONDS)); return result.get();
    }
    private void waitFor(ActivityScenario<MainActivity> activity, String condition) throws Exception {
        long until = System.currentTimeMillis() + 45_000;
        while (System.currentTimeMillis() < until) { if ("true".equals(evaluate(activity, "Boolean(" + condition + ")"))) return; Thread.sleep(100); }
        fail("Hosted UI did not reach: " + condition + "; body=" + evaluate(activity, "document.body.innerText"));
    }
    @Test public void pairedServerUpdatesTheMinimalApkAndCachedUiKeepsItsNativeBridgeOffline() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation(); var context = instrumentation.getTargetContext();
        // The default acceptance owns a cleared app; focused execution uses a separate application ID.
        org.junit.Assume.assumeTrue(context.getPackageName().endsWith(".uiupdates.acceptance") || "1".equals(InstrumentationRegistry.getArguments().getString("fixtureFontProfile")));
        var preferences = context.getSharedPreferences("connection-v1", android.content.Context.MODE_PRIVATE);
        var previous = preferences.getAll(); var revision = new AtomicInteger(1); var leaked = new AtomicBoolean(false);
        java.security.KeyStore keys = java.security.KeyStore.getInstance("PKCS12");
        try (var stream = instrumentation.getContext().getAssets().open("tls/server.p12")) { keys.load(stream, "synthetic-only".toCharArray()); }
        var managers = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()); managers.init(keys, "synthetic-only".toCharArray());
        var tls = SSLContext.getInstance("TLS"); tls.init(managers.getKeyManagers(), null, null);
        var server = (SSLServerSocket) tls.getServerSocketFactory().createServerSocket(0);
        server.setSoTimeout(1000);
        String ca, worker;
        try (var stream = instrumentation.getContext().getAssets().open("tls/ca.pem")) { ca = new String(stream.readAllBytes(), StandardCharsets.US_ASCII); }
        try (var stream = context.getAssets().open("public/sw.js")) { worker = new String(stream.readAllBytes(), StandardCharsets.UTF_8); }
        final String workerSource = worker;
        var running = new AtomicBoolean(true);
        var connections = Executors.newCachedThreadPool();
        Thread listener = new Thread(() -> {
            while (running.get()) try {
                var socket = server.accept(); connections.execute(() -> {
                    try (socket) {
                        socket.setSoTimeout(10_000);
                        var input = new java.io.BufferedReader(new java.io.InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII));
                        String first = input.readLine(); if (first == null) return;
                        String path = first.split(" ")[1], line; boolean privateHeader = false;
                        while ((line = input.readLine()) != null && !line.isEmpty()) if (line.toLowerCase(java.util.Locale.ROOT).startsWith("cookie:")) privateHeader = true;
                        if (!path.startsWith("/api/") && privateHeader) leaked.set(true);
                        int version = revision.get(); String type, body;
                        if (path.equals("/sw.js")) { type = "text/javascript"; body = workerSource.replace("native-bootstrap", "device-hosted-" + version); }
                        else if (path.equals("/_next/static/ui.js")) {
                            type = "text/javascript";
                            body = "window.Capacitor.nativePromise('OpenTriageConnection','version',{}).then(value=>document.body.dataset.nativeVersion=String(value.versionCode));"
                                + "navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload());"
                                + "navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(value=>value.update()).catch(()=>{});";
                        } else if (path.equals("/manifest.webmanifest")) { type = "application/manifest+json"; body = "{\"name\":\"Synthetic UI\"}"; }
                        else if (path.startsWith("/api/")) { type = "application/json"; body = "{\"enrolled\":true}"; }
                        else { type = "text/html"; body = "<html><head><script defer src=\"/_next/static/ui.js\"></script></head><body><h1>Hosted UI " + version + "</h1></body></html>"; }
                        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                        String header = "HTTP/1.1 200 OK\r\nContent-Type: " + type + "\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: " + bytes.length + "\r\n\r\n";
                        socket.getOutputStream().write(header.getBytes(StandardCharsets.US_ASCII)); socket.getOutputStream().write(bytes); socket.getOutputStream().flush();
                    } catch (Exception closed) { /* The test closes sockets during offline recovery. */ }
                });
            } catch (java.net.SocketTimeoutException retry) { /* Poll shutdown. */ }
            catch (Exception closed) { break; }
        });
        listener.start();
        ActivityScenario<MainActivity> activity = null;
        try {
            var connection = new TrustedConnection("https://localhost:" + server.getLocalPort(), ca);
            var saved = connection.saved();
            saved.put("cookies", new org.json.JSONArray().put(new org.json.JSONObject().put("name", "open_triage_installation")
                .put("value", "I".repeat(43)).put("expires", System.currentTimeMillis() + 3600000).put("path", "/api")));
            new ConnectionVault(context).promote(TrustedConnection.restore(saved));
            String installedVersion = org.json.JSONObject.quote(String.valueOf(context.getPackageManager().getPackageInfo(context.getPackageName(), 0).getLongVersionCode()));
            activity = ActivityScenario.launch(MainActivity.class);
            waitFor(activity, "document.body.innerText.includes('Hosted UI 1') && document.body.dataset.nativeVersion===" + installedVersion + " && navigator.serviceWorker.controller");
            assertEquals("true", evaluate(activity, "location.origin==='https://localhost'"));
            evaluate(activity, "localStorage.setItem('ui-update-device-proof','preserved')");
            revision.set(2); evaluate(activity, "navigator.serviceWorker.getRegistration().then(value=>value.update())");
            waitFor(activity, "document.body.innerText.includes('Hosted UI 2') && document.body.dataset.nativeVersion===" + installedVersion + "");
            running.set(false); server.close();
            String beforeReload = evaluate(activity, "performance.timeOrigin");
            activity.onActivity(screen -> screen.getBridge().getWebView().reload());
            waitFor(activity, "performance.timeOrigin!==" + beforeReload + " && document.body.innerText.includes('Hosted UI 2') && document.body.dataset.nativeVersion===" + installedVersion + "");
            assertEquals("true", evaluate(activity, "location.origin==='https://localhost' && localStorage.getItem('ui-update-device-proof')==='preserved'"));
            assertFalse("Public UI transport must not send native cookies", leaked.get());
            evaluate(activity, "window.__uiCleanup=false;(async()=>{localStorage.removeItem('ui-update-device-proof');await Promise.all((await navigator.serviceWorker.getRegistrations()).map(value=>value.unregister()));await Promise.all((await caches.keys()).filter(value=>value.startsWith('open-triage-shell-')).map(value=>caches.delete(value)));window.__uiCleanup=true})()");
            waitFor(activity, "window.__uiCleanup");
        } finally {
            if (activity != null) activity.close(); running.set(false); server.close(); listener.join(2000); connections.shutdownNow();
            var restore = preferences.edit().clear();
            for (var entry : previous.entrySet()) {
                Object value = entry.getValue(); String key = entry.getKey();
                if (value instanceof String) restore.putString(key, (String) value);
                else if (value instanceof Boolean) restore.putBoolean(key, (Boolean) value);
                else if (value instanceof Integer) restore.putInt(key, (Integer) value);
                else if (value instanceof Long) restore.putLong(key, (Long) value);
                else if (value instanceof Float) restore.putFloat(key, (Float) value);
            }
            assertTrue(restore.commit());
        }
    }
}
