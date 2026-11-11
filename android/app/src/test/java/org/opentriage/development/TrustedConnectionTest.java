package org.opentriage.development;

import static org.junit.Assert.*;
import org.junit.Test;
import org.json.JSONObject;
import javax.net.ssl.SSLServerSocket;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.time.Instant;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;

public class TrustedConnectionTest {
    private String ca() throws Exception { try (var stream = getClass().getResourceAsStream("/tls/ca.pem")) { return new String(stream.readAllBytes(), StandardCharsets.US_ASCII); } }
    private JSONObject artifact() throws Exception {
        return new JSONObject().put("version", 1).put("origin", "https://localhost").put("caPem", "").put("token", "a".repeat(43)).put("expiresAt", Instant.now().plusSeconds(250).toString());
    }
    @Test public void rejectsMalformedExpiredAndOversizedImports() throws Exception {
        assertEquals(1, TrustedConnection.artifact(artifact().toString(), System.currentTimeMillis()).getInt("version"));
        for (JSONObject bad : new JSONObject[]{artifact().put("version", 2), artifact().put("version", 1.5), artifact().put("privateKey", "secret"), artifact().put("token", "bad"), artifact().put("expiresAt", Instant.now().minusSeconds(1).toString())}) {
            assertThrows(Exception.class, () -> TrustedConnection.artifact(bad.toString(), System.currentTimeMillis()));
        }
        assertThrows(Exception.class, () -> TrustedConnection.artifact(" ".repeat(65537), System.currentTimeMillis()));
    }
    @Test public void rejectsCredentialForwardingAndOriginConfusion() throws Exception {
        for (String path : new String[]{"https://attacker.test/api/x", "//attacker.test/api/x", "/api/../outside", "/api/%2e%2e/outside", "/api/x#secret", "/api/\\attacker", "/not-api"}) {
            assertThrows(Exception.class, () -> TrustedConnection.requestPath(path));
        }
        for (String origin : new String[]{"http://localhost", "https://user:password@localhost", "https://localhost/path", "https://localhost#fragment", "https://localhost/"}) {
            assertThrows(Exception.class, () -> new TrustedConnection(origin, ""));
        }
        assertThrows(Exception.class, () -> new TrustedConnection("https://localhost", "-----BEGIN PRIVATE KEY-----"));
    }
    @Test public void trustedTlsCookiesIsolationLogoutAndRedirectBoundaries() throws Exception {
        KeyStore store = KeyStore.getInstance("PKCS12");
        try (var file = getClass().getResourceAsStream("/tls/server.p12")) { store.load(file, "synthetic-only".toCharArray()); }
        KeyManagerFactory km = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()); km.init(store, "synthetic-only".toCharArray());
        SSLContext tls = SSLContext.getInstance("TLS"); tls.init(km.getKeyManagers(), null, null);
        SSLServerSocket server = (SSLServerSocket) tls.getServerSocketFactory().createServerSocket(0);
        Thread worker = new Thread(() -> {
            while (!server.isClosed()) {
                try (var socket = server.accept()) {
                    socket.setSoTimeout(3000);
                    BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII));
                    String path = reader.readLine().split(" ")[1], originHeader = "null", cookieHeader = "null", jobHeader = "null", conditionalHeader = "null", line;
                    while ((line = reader.readLine()) != null && !line.isEmpty()) {
                        if (line.toLowerCase().startsWith("origin: ")) originHeader = line.substring(8);
                        if (line.toLowerCase().startsWith("cookie: ")) cookieHeader = line.substring(8);
                        if (line.toLowerCase().startsWith("x-job-confirmation: ")) jobHeader = line.substring(20);
                        if (line.toLowerCase().startsWith("if-none-match: ")) conditionalHeader = line.substring(15);
                    }
                    String extra = "", status = "200 OK";
                    if (path.endsWith("pair")) extra = "Set-Cookie: open_triage_installation=installation-secret; Path=/api; Secure; HttpOnly; SameSite=Strict; Max-Age=3600\r\n";
                    if (path.endsWith("login")) extra = "Set-Cookie: open_triage_session=clinician-secret; Path=/api; Secure; HttpOnly; SameSite=Strict; Max-Age=3600\r\n";
                    if (path.endsWith("logout")) extra = "Set-Cookie: open_triage_session=; Path=/api; Secure; HttpOnly; SameSite=Strict; Max-Age=0\r\n";
                    if (path.endsWith("expires-logout")) extra = "Set-Cookie: open_triage_session=; Path=/api; Secure; HttpOnly; Expires=Thu, 01 Jan 1970 00:00:00 GMT\r\n";
                    if (path.endsWith("expired-value")) extra = "Set-Cookie: open_triage_session=expired-secret; Path=/api; Secure; HttpOnly; Expires=Wed, 01 Jan 2020 00:00:00 GMT\r\n";
                    if (path.endsWith("negative-logout")) extra = "Set-Cookie: open_triage_session=expired-secret; Path=/api; Secure; HttpOnly; Max-Age=-1\r\n";
                    if (path.endsWith("legacy-expiry")) extra = "Set-Cookie: open_triage_session=expired-secret; Path=/api; Secure; HttpOnly; Expires=Thu, 01-Jan-1970 00:00:00 GMT\r\n";
                    if (path.endsWith("installation-logout")) extra = "Set-Cookie: open_triage_installation=; Path=/api; Secure; HttpOnly; Expires=Thu, 01 Jan 1970 00:00:00 GMT\r\n";

                    if (path.endsWith("positive-precedence")) extra = "Set-Cookie: open_triage_session=current-secret; Path=/api; Secure; HttpOnly; Max-Age=60; Expires=Thu, 01 Jan 1970 00:00:00 GMT\r\n";
                    if (path.endsWith("bad-cookie-name")) extra = "Set-Cookie: Open_Triage_Session=wrong; Path=/api; Secure; HttpOnly; Max-Age=60\r\n";
                    if (path.endsWith("bad-cookie-domain")) extra = "Set-Cookie: open_triage_session=wrong; Domain=localhost; Path=/api; Secure; HttpOnly; Max-Age=60\r\n";
                    if (path.endsWith("bad-cookie-path")) extra = "Set-Cookie: open_triage_session=wrong; Path=/; Secure; HttpOnly; Max-Age=60\r\n";

                    if (path.endsWith("redirect")) { extra = "Location: https://attacker.test/api/leak\r\n"; status = "302 Found"; }
                    if (path.endsWith("conditional")) {
                        extra = "ETag: \"revision-1\"\r\n";
                        if (conditionalHeader.equals("\"revision-1\"")) status = "304 Not Modified";
                    }
                    byte[] body = (path.endsWith("confirmed-job") ? jobHeader : originHeader + "|" + cookieHeader).getBytes(StandardCharsets.UTF_8);
                    if (status.startsWith("304")) body = new byte[0];
                    String head = "HTTP/1.1 " + status + "\r\n" + extra + "Content-Length: " + body.length + "\r\nConnection: close\r\n\r\n";
                    socket.getOutputStream().write(head.getBytes(StandardCharsets.US_ASCII)); socket.getOutputStream().write(body); socket.getOutputStream().flush();
                } catch (Exception expectedHandshakeOrShutdown) { /* Rejected TLS clients do not terminate the test listener. */ }
            }
        });
        worker.setDaemon(true); worker.start();
        try {
            String origin = "https://localhost:" + server.getLocalPort();
            var first = new TrustedConnection(origin, ca());
            assertEquals(origin + "|null", first.request("/api/pair", "GET", new JSONObject(), null).body());
            assertEquals("a".repeat(43), first.request("/api/confirmed-job", "POST", new JSONObject().put("X-Job-Confirmation", "a".repeat(43)), "{}").body());
            assertEquals("\"revision-1\"", first.request("/api/conditional", "GET", new JSONObject(), null).headers().getString("ETag"));
            var unchanged = first.request("/api/conditional", "GET", new JSONObject().put("If-None-Match", "\"revision-1\""), null);
            assertEquals(304, unchanged.status()); assertEquals("", unchanged.body());
            first.request("/api/login", "POST", new JSONObject(), "{}");
            assertTrue(first.request("/api/current", "GET", new JSONObject(), null).body().contains("clinician-secret"));
            assertEquals(origin + "|null", new TrustedConnection(origin, ca()).request("/api/current", "GET", new JSONObject(), null).body());
            var restored = TrustedConnection.restore(first.saved());
            restored.request("/api/logout", "DELETE", new JSONObject(), null);
            String after = restored.request("/api/current", "GET", new JSONObject(), null).body();
            assertTrue(after.contains("installation-secret")); assertFalse(after.contains("clinician-secret"));
            assertFalse(after.contains("open_triage_session="));
            for (String clear : new String[]{"logout", "expires-logout", "expired-value", "negative-logout", "legacy-expiry"}) {
                restored.request("/api/login", "POST", new JSONObject(), "{}");
                restored.request("/api/" + clear, "POST", new JSONObject(), "{}");
                var cleared = TrustedConnection.restore(restored.saved());
                String echo = cleared.request("/api/current", "GET", new JSONObject(), null).body();
                assertTrue("Credential clearing preserves installation pairing", echo.contains("installation-secret"));
                assertFalse("Empty/zero/negative/expired credentials must be absent after persistence", echo.contains("open_triage_session="));
            }
            JSONObject legacyState = restored.saved();
            legacyState.getJSONArray("cookies").put(new JSONObject().put("name", "open_triage_session").put("value", "").put("expires", Long.MAX_VALUE));
            String legacyEcho = TrustedConnection.restore(legacyState).request("/api/current", "GET", new JSONObject(), null).body();
            assertTrue(legacyEcho.contains("installation-secret")); assertFalse("An upgraded vault drops prior empty cookie tombstones", legacyEcho.contains("open_triage_session="));
            restored.request("/api/positive-precedence", "GET", new JSONObject(), null);
            assertTrue("Max-Age takes precedence over Expires", restored.request("/api/current", "GET", new JSONObject(), null).body().contains("current-secret"));
            for (String invalid : new String[]{"bad-cookie-name", "bad-cookie-domain", "bad-cookie-path"})
                assertThrows(Exception.class, () -> restored.request("/api/" + invalid, "GET", new JSONObject(), null));

            restored.request("/api/installation-logout", "POST", new JSONObject(), "{}");
            String installationCleared = restored.request("/api/current", "GET", new JSONObject(), null).body();
            assertFalse(installationCleared.contains("open_triage_installation="));
            assertTrue("Installation retirement does not silently replace a different cookie", installationCleared.contains("current-secret"));
            assertThrows(Exception.class, () -> restored.request("/api/redirect", "GET", new JSONObject(), null));
            for (String forbidden : new String[]{"Origin", "Cookie", "Authorization"}) {
                assertThrows(Exception.class, () -> restored.request("/api/current", "GET", new JSONObject().put(forbidden, "unapproved"), null));
            }
            assertThrows(Exception.class, () -> new TrustedConnection(origin, "").request("/api/current", "GET", new JSONObject(), null));
            assertThrows(Exception.class, () -> new TrustedConnection(origin.replace("localhost", "127.0.0.1"), ca()).request("/api/current", "GET", new JSONObject(), null));
            // Public-CA management selects platform trust rather than requiring app-specific PEM.
            // Give this isolated JVM a synthetic platform root and prove a real TLS handshake.
            KeyStore platformRoots = KeyStore.getInstance("PKCS12"); platformRoots.load(null);
            platformRoots.setCertificateEntry("synthetic-platform-root", java.security.cert.CertificateFactory.getInstance("X.509")
                .generateCertificate(new java.io.ByteArrayInputStream(ca().getBytes(StandardCharsets.US_ASCII))));
            var rootsFile = java.nio.file.Files.createTempFile("android-managed-platform-roots", ".p12");
            String[] properties = {"javax.net.ssl.trustStore", "javax.net.ssl.trustStoreType", "javax.net.ssl.trustStorePassword"};
            String[] previous = java.util.Arrays.stream(properties).map(System::getProperty).toArray(String[]::new);
            try {
                try (var output = java.nio.file.Files.newOutputStream(rootsFile)) { platformRoots.store(output, "synthetic-only".toCharArray()); }
                System.setProperty(properties[0], rootsFile.toString()); System.setProperty(properties[1], "PKCS12"); System.setProperty(properties[2], "synthetic-only");
                assertEquals(origin + "|null", new TrustedConnection(origin, "").request("/api/current", "GET", new JSONObject(), null).body());
            } finally {
                for (int i = 0; i < properties.length; i++) {
                    if (previous[i] == null) System.clearProperty(properties[i]); else System.setProperty(properties[i], previous[i]);
                }
                java.nio.file.Files.deleteIfExists(rootsFile);
            }
        } finally { server.close(); worker.join(3000); }
    }
    @Test public void replacementCandidatesNeverCopyPersonalOrForeignOriginAuthority() throws Exception {
        var cookies = new org.json.JSONArray().put(new JSONObject().put("name", "open_triage_installation").put("value", "installation-only").put("expires", Long.MAX_VALUE))
            .put(new JSONObject().put("name", "open_triage_session").put("value", "personal-never-copied").put("expires", Long.MAX_VALUE));
        var original = TrustedConnection.restore(new JSONObject().put("origin", "https://original.example").put("caPem", "").put("cookies", cookies));
        var same = original.enrollmentCandidate("https://original.example", ca()).saved().getJSONArray("cookies");
        assertEquals(1, same.length()); assertEquals("open_triage_installation", same.getJSONObject(0).getString("name"));
        assertEquals(0, original.enrollmentCandidate("https://different.example", ca()).saved().getJSONArray("cookies").length());
        assertEquals("Original jar unchanged until explicit lock transition", 2, original.saved().getJSONArray("cookies").length());
    }

}
