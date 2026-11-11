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
    @Test public void binaryRequestAndResponseRemainExactOverRealTls() throws Exception {
        KeyStore store = KeyStore.getInstance("PKCS12");
        try (var file = getClass().getResourceAsStream("/tls/server.p12")) { store.load(file, "synthetic-only".toCharArray()); }
        KeyManagerFactory km = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()); km.init(store, "synthetic-only".toCharArray());
        SSLContext tls = SSLContext.getInstance("TLS"); tls.init(km.getKeyManagers(), null, null);
        byte[] payload = new byte[10 * 1024 * 1024];
        byte[] invalidUtf8 = new byte[]{0, (byte) 255, (byte) 254, (byte) 128, (byte) 195, 40, 13, 10};
        for (int index = 0; index < payload.length; index++) payload[index] = invalidUtf8[index % invalidUtf8.length];
        try (SSLServerSocket server = (SSLServerSocket) tls.getServerSocketFactory().createServerSocket(0)) {
            var failure = new java.util.concurrent.atomic.AtomicReference<Throwable>();
            Thread worker = new Thread(() -> {
                for (int attempt = 0; attempt < 3; attempt++) try (var socket = server.accept()) {
                    socket.setSoTimeout(10000);
                    var input = socket.getInputStream();
                    var head = new java.io.ByteArrayOutputStream();
                    while (!head.toString(StandardCharsets.US_ASCII).endsWith("\r\n\r\n")) {
                        int value = input.read(); if (value < 0 || head.size() > 32768) throw new AssertionError("Invalid headers"); head.write(value);
                    }
                    String headers = head.toString(StandardCharsets.US_ASCII);
                    if (!headers.startsWith("POST")) {
                        socket.getOutputStream().write(("HTTP/1.1 200 OK\r\nContent-Length: " + (TrustedConnection.MAX_BODY + 1) + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                        socket.getOutputStream().flush(); continue;
                    }
                    var length = java.util.regex.Pattern.compile("(?im)^Content-Length: (\\d+)").matcher(headers);
                    assertTrue("Explicit request length", length.find());
                    assertArrayEquals(payload, input.readNBytes(Integer.parseInt(length.group(1))));
                    socket.getOutputStream().write(("HTTP/1.1 200 OK\r\nContent-Type: image/jpeg\r\nContent-Length: " + payload.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                    socket.getOutputStream().write(payload); socket.getOutputStream().flush();
                } catch (Throwable error) { failure.set(error); }
            });
            worker.setDaemon(true); worker.start();
            var connection = new TrustedConnection("https://localhost:" + server.getLocalPort(), ca());
            var reply = connection.requestBytes("/api/media", "POST", new JSONObject().put("Content-Type", "application/octet-stream"), payload);
            assertThrows(IllegalStateException.class, () -> connection.request("/api/oversized", "GET", new JSONObject(), null));
            assertEquals(0, connection.request("/api/representation", "HEAD", new JSONObject(), null).bytes().length);
            worker.join(7000); assertFalse(worker.isAlive());
            if (failure.get() != null) throw new AssertionError(failure.get());
            assertEquals("image/jpeg", reply.headers().getString("Content-Type"));
            assertArrayEquals(payload, reply.bytes());
            assertArrayEquals(payload, TrustedConnection.decodeRequestBody(reply.bodyBase64()));
            assertThrows(IllegalArgumentException.class, () -> TrustedConnection.decodeRequestBody("%%%"));
            assertThrows(IllegalArgumentException.class, () -> connection.requestBytes("/api/media", "POST", new JSONObject(), new byte[TrustedConnection.MAX_BODY + 1]));
        }
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
