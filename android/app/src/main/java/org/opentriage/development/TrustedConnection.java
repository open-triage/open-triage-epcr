package org.opentriage.development;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.HttpCookie;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;

/** One approved HTTPS origin, one cookie jar and no redirects. Never uses WebView cookies. */
final class TrustedConnection {
    static final int MAX_ARTIFACT = 65536;
    // Bound bridge copies; supports default 10 MiB images in JSON/Base64 commands.
    static final int MAX_BODY = 16 * 1024 * 1024;
    final String origin;
    final String caPem;
    private final javax.net.ssl.SSLSocketFactory socketFactory;
    private final Map<String, SavedCookie> cookies = new HashMap<>();
    private static final Set<String> COOKIE_NAMES = Set.of("open_triage_session", "open_triage_installation");
    private static final Set<String> HEADERS = Set.of("accept", "content-type", "x-csrf-token", "x-organization-id", "x-installation-enrollment", "x-personal-authentication", "x-job-confirmation", "if-match", "if-none-match");
    record SavedCookie(String value, long expires) {}
    record Reply(int status, JSONObject headers, byte[] bytes) {
        String body() { return new String(bytes, StandardCharsets.UTF_8); }
        String bodyBase64() { return java.util.Base64.getEncoder().encodeToString(bytes); }
    }

    TrustedConnection(String origin, String caPem) throws Exception {
        URI uri = URI.create(origin);
        if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null ||
                uri.getRawQuery() != null || uri.getRawFragment() != null || !uri.getRawPath().isEmpty() ||
                !origin.equals("https://" + canonicalHost(uri.getHost()) + (uri.getPort() == -1 ? "" : ":" + uri.getPort())) ||
                uri.getPort() == 443 || uri.getPort() > 65535 || origin.length() > 2048) throw new IllegalArgumentException("Invalid origin");
        this.origin = origin;
        this.caPem = caPem;
        if (caPem.length() > 48000 || caPem.contains("PRIVATE KEY")) throw new IllegalArgumentException("Invalid public CA");
        TrustManagerFactory trust = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        if (caPem.isEmpty()) {
            trust.init((KeyStore) null);
        } else {
            // Explicit supplied CA roots, not an SSL-error bypass or unverified first fetch.
            if (!caPem.matches("(?s)(\\s*-----BEGIN CERTIFICATE-----\\s+[A-Za-z0-9+/=\\s]+-----END CERTIFICATE-----\\s*)+")) throw new IllegalArgumentException("Invalid public CA");
            KeyStore store = KeyStore.getInstance(KeyStore.getDefaultType());
            store.load(null);
            var certificates = CertificateFactory.getInstance("X.509").generateCertificates(new ByteArrayInputStream(caPem.getBytes(StandardCharsets.US_ASCII)));
            if (certificates.isEmpty() || certificates.size() > 16) throw new IllegalArgumentException("Invalid public CA");
            int i = 0;
            for (var cert : certificates) {
                X509Certificate x509 = (X509Certificate) cert;
                x509.checkValidity();
                if (x509.getBasicConstraints() < 0) throw new IllegalArgumentException("CA certificate required");
                store.setCertificateEntry("root-" + i++, cert);
            }
            trust.init(store);
        }
        SSLContext tls = SSLContext.getInstance("TLS");
        tls.init(null, trust.getTrustManagers(), null);
        socketFactory = tls.getSocketFactory();
    }

    /** Reject IP representations that the shared URL-based pairing parser normalizes. */
    private static String canonicalHost(String host) throws Exception {
        String lower = host.toLowerCase(Locale.ROOT);
        if (lower.startsWith("[")) {
            if (lower.contains("%")) throw new IllegalArgumentException("IPv6 zones are not URL origins");
            byte[] bytes = java.net.InetAddress.getByName(lower.substring(1, lower.length() - 1)).getAddress();
            if (bytes.length == 4) {
                byte[] mapped = new byte[16]; mapped[10] = (byte) 255; mapped[11] = (byte) 255;
                System.arraycopy(bytes, 0, mapped, 12, 4); bytes = mapped;
            }
            int[] groups = new int[8];
            for (int i = 0; i < 8; i++) groups[i] = (bytes[i * 2] & 255) * 256 + (bytes[i * 2 + 1] & 255);
            int start = -1, length = 0;
            for (int i = 0; i < 8;) {
                if (groups[i] != 0) { i++; continue; }
                int end = i; while (end < 8 && groups[end] == 0) end++;
                if (end - i >= 2 && end - i > length) { start = i; length = end - i; }
                i = end;
            }
            var before = new ArrayList<String>(); var after = new ArrayList<String>();
            for (int i = 0; i < 8; i++) {
                if (start >= 0 && i >= start && i < start + length) continue;
                (start < 0 || i < start ? before : after).add(Integer.toHexString(groups[i]));
            }
            return "[" + String.join(":", before) + (start >= 0 ? "::" + String.join(":", after) : "") + "]";
        }
        String numericHost = lower.endsWith(".") ? lower.substring(0, lower.length() - 1) : lower;
        String last = numericHost.substring(numericHost.lastIndexOf('.') + 1);
        if (last.matches("[0-9]+|0x[0-9a-f]+")) {
            if (lower.endsWith(".")) throw new IllegalArgumentException("Noncanonical IPv4 origin");
            String[] labels = lower.split("\\.");
            if (labels.length != 4) throw new IllegalArgumentException("Noncanonical IPv4 origin");
            for (String label : labels) if (!label.matches("0|[1-9][0-9]{0,2}") || Integer.parseInt(label) > 255) throw new IllegalArgumentException("Noncanonical IPv4 origin");
        }
        return lower;
    }

    private static Set<String> keys(JSONObject value) {
        Set<String> keys = new java.util.HashSet<>(); value.keys().forEachRemaining(keys::add); return keys;
    }

    static JSONObject artifact(String encoded, long now) throws Exception {
        if (encoded.getBytes(StandardCharsets.UTF_8).length > MAX_ARTIFACT) throw new IllegalArgumentException("Oversized artifact");
        JSONObject value = new JSONObject(encoded);
        if (!keys(value).equals(Set.of("version", "origin", "token", "expiresAt", "caPem")) ||
                !(value.get("version") instanceof Number) || ((Number) value.get("version")).doubleValue() != 1.0 ||
                !(value.get("origin") instanceof String) || !(value.get("token") instanceof String) ||
                !(value.get("expiresAt") instanceof String) || !(value.get("caPem") instanceof String) ||
                !value.getString("token").matches("[A-Za-z0-9_-]{43}")) throw new IllegalArgumentException("Invalid artifact");
        long expires = Instant.parse(value.getString("expiresAt")).toEpochMilli();
        if (expires <= now || expires > now + 330000) throw new IllegalArgumentException("Expired artifact");
        return value;
    }

    static String requestPath(String path) {
        URI uri = URI.create(path);
        if (!path.startsWith("/api/") || path.startsWith("//") || path.contains("\\") || path.contains("\r") || path.contains("\n") ||
                uri.isAbsolute() || uri.getRawAuthority() != null || uri.getRawFragment() != null ||
                !uri.normalize().getRawPath().equals(uri.getRawPath()) || uri.getPath().contains("\\") ||
                java.util.Arrays.stream(uri.getPath().split("/")).anyMatch(segment -> segment.equals("..") || segment.equals(".")) || path.length() > 8192) throw new IllegalArgumentException("Unapproved request");
        return path;
    }

    Reply request(String path, String method, JSONObject headers, String body) throws Exception {
        return requestBytes(path, method, headers, body == null ? null : body.getBytes(StandardCharsets.UTF_8));
    }

    Reply requestBytes(String path, String method, JSONObject headers, byte[] body) throws Exception {
        requestPath(path);
        if (!Set.of("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD").contains(method) ||
                body != null && body.length > MAX_BODY) throw new IllegalArgumentException("Invalid request");
        HttpsURLConnection connection = (HttpsURLConnection) URI.create(origin + path).toURL().openConnection();
        connection.setSSLSocketFactory(socketFactory);
        // Keep platform hostname verification. Do not install a permissive HostnameVerifier.
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        connection.setUseCaches(false);
        connection.setRequestMethod(method);
        connection.setRequestProperty("Origin", origin);
        connection.setRequestProperty("Accept-Encoding", "identity");
        for (String key : keys(headers)) {
            String lower = key.toLowerCase(Locale.ROOT), value = headers.getString(key);
            if (!HEADERS.contains(lower) || value.contains("\r") || value.contains("\n") || value.length() > 8192) throw new IllegalArgumentException("Unapproved header");
            connection.setRequestProperty(key, value);
        }
        List<String> cookieValues = new ArrayList<>();
        cookies.entrySet().removeIf(entry -> entry.getValue().expires <= System.currentTimeMillis());
        for (var entry : cookies.entrySet()) cookieValues.add(entry.getKey() + "=" + entry.getValue().value);
        if (!cookieValues.isEmpty()) connection.setRequestProperty("Cookie", String.join("; ", cookieValues));
        try {
            if (body != null) {
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(body.length);
                try (var output = connection.getOutputStream()) { output.write(body); }
            }
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400 && status != 304) throw new IllegalStateException("Redirect requires explicit platform flow");
            for (var header : connection.getHeaderFields().entrySet()) {
                if (header.getKey() != null && header.getKey().equalsIgnoreCase("Set-Cookie")) {
                    for (String raw : header.getValue()) for (HttpCookie cookie : HttpCookie.parse(raw)) {
                        if (!COOKIE_NAMES.contains(cookie.getName()) || !cookie.getSecure() || !cookie.isHttpOnly() ||
                                cookie.getDomain() != null || !"/api".equals(cookie.getPath())) throw new IllegalStateException("Invalid credential cookie");
                        long maxAge = cookie.getMaxAge();
                        if (maxAge == 0) cookies.remove(cookie.getName());
                        else cookies.put(cookie.getName(), new SavedCookie(cookie.getValue(), maxAge < 0 ? Long.MAX_VALUE : System.currentTimeMillis() + Math.min(maxAge, 366L * 24 * 3600) * 1000));
                    }
                }
            }
            JSONObject responseHeaders = new JSONObject();
            for (String name : List.of("Content-Type", "ETag", "Retry-After")) {
                String value = connection.getHeaderField(name);
                if (value != null) responseHeaders.put(name, value);
            }
            if (connection.getContentLengthLong() > MAX_BODY && !method.equals("HEAD") && !Set.of(204, 205, 304).contains(status)) throw new IllegalStateException("Oversized response");
            InputStream stream = Set.of(204, 205, 304).contains(status) || method.equals("HEAD") ? null
                : status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            byte[] bytes = stream == null ? new byte[0] : readBounded(stream);
            return new Reply(status, responseHeaders, bytes);
        } finally { connection.disconnect(); }
    }

    static byte[] decodeRequestBody(String encoded) {
        if (encoded == null) return null;
        if (encoded.length() > ((long) MAX_BODY + 2) / 3 * 4) throw new IllegalArgumentException("Oversized request");
        byte[] bytes = java.util.Base64.getDecoder().decode(encoded);
        if (bytes.length > MAX_BODY) throw new IllegalArgumentException("Oversized request");
        return bytes;
    }

    private static byte[] readBounded(InputStream stream) throws Exception {
        try (stream; var output = new java.io.ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int length;
            while ((length = stream.read(buffer)) != -1) {
                if (output.size() + length > MAX_BODY) throw new IllegalStateException("Oversized response");
                output.write(buffer, 0, length);
            }
            return output.toByteArray();
        }
    }

    JSONObject saved() throws Exception {
        JSONArray savedCookies = new JSONArray();
        for (var entry : cookies.entrySet()) savedCookies.put(new JSONObject().put("name", entry.getKey()).put("value", entry.getValue().value).put("expires", entry.getValue().expires));
        return new JSONObject().put("origin", origin).put("caPem", caPem).put("cookies", savedCookies);
    }
    static TrustedConnection restore(JSONObject saved) throws Exception {
        TrustedConnection connection = new TrustedConnection(saved.getString("origin"), saved.getString("caPem"));
        JSONArray cookies = saved.getJSONArray("cookies");
        for (int i = 0; i < cookies.length(); i++) {
            JSONObject cookie = cookies.getJSONObject(i);
            if (!COOKIE_NAMES.contains(cookie.getString("name"))) throw new IllegalArgumentException("Invalid stored cookie");
            connection.cookies.put(cookie.getString("name"), new SavedCookie(cookie.getString("value"), cookie.getLong("expires")));
        }
        return connection;
    }
}
