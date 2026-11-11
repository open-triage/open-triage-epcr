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
                    String path = reader.readLine().split(" ")[1], originHeader = "null", cookieHeader = "null", line;
                    while ((line = reader.readLine()) != null && !line.isEmpty()) {
                        if (line.toLowerCase().startsWith("origin: ")) originHeader = line.substring(8);
                        if (line.toLowerCase().startsWith("cookie: ")) cookieHeader = line.substring(8);
                    }
                    String extra = "", status = "200 OK";
                    if (path.endsWith("pair")) extra = "Set-Cookie: open_triage_installation=installation-secret; Path=/api; Secure; HttpOnly; SameSite=Strict; Max-Age=3600\r\n";
                    if (path.endsWith("login")) extra = "Set-Cookie: open_triage_session=clinician-secret; Path=/api; Secure; HttpOnly; SameSite=Strict; Max-Age=3600\r\n";
                    if (path.endsWith("logout")) extra = "Set-Cookie: open_triage_session=; Path=/api; Secure; HttpOnly; SameSite=Strict; Max-Age=0\r\n";
                    if (path.endsWith("redirect")) { extra = "Location: https://attacker.test/api/leak\r\n"; status = "302 Found"; }
                    byte[] body = (originHeader + "|" + cookieHeader).getBytes(StandardCharsets.UTF_8);
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
            first.request("/api/login", "POST", new JSONObject(), "{}");
            assertTrue(first.request("/api/current", "GET", new JSONObject(), null).body().contains("clinician-secret"));
            assertEquals(origin + "|null", new TrustedConnection(origin, ca()).request("/api/current", "GET", new JSONObject(), null).body());
            var restored = TrustedConnection.restore(first.saved());
            restored.request("/api/logout", "DELETE", new JSONObject(), null);
            String after = restored.request("/api/current", "GET", new JSONObject(), null).body();
            assertTrue(after.contains("installation-secret")); assertFalse(after.contains("clinician-secret"));
            assertThrows(Exception.class, () -> restored.request("/api/redirect", "GET", new JSONObject(), null));
            assertThrows(Exception.class, () -> restored.request("/api/current", "GET", new JSONObject().put("Origin", "https://attacker.test"), null));
            assertThrows(Exception.class, () -> new TrustedConnection(origin, "").request("/api/current", "GET", new JSONObject(), null));
            assertThrows(Exception.class, () -> new TrustedConnection(origin.replace("localhost", "127.0.0.1"), ca()).request("/api/current", "GET", new JSONObject(), null));
        } finally { server.close(); worker.join(3000); }
    }
}
