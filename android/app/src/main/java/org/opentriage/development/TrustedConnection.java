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
    private final List<X509Certificate> caCertificates = new ArrayList<>();
    private final java.util.function.LongSupplier clock;
    private final Map<String, SavedCookie> cookies = new HashMap<>();
    // Connection purpose survives cookie expiry, process death and personal logout.
    private boolean installationRequired = true;
    private static final Set<String> COOKIE_NAMES = Set.of("open_triage_session", "open_triage_installation", "open_triage_agency_handoff");
    private static final Set<String> HEADERS = Set.of("accept", "content-type", "x-csrf-token", "x-organization-id", "x-installation-enrollment", "x-personal-authentication", "x-job-confirmation", "x-agency-handoff", "if-match", "if-none-match");
    record SavedCookie(String value, long expires, String path) { SavedCookie(String value, long expires) { this(value, expires, "/api"); } }
    record Reply(int status, JSONObject headers, byte[] bytes) {
        String body() { return new String(bytes, StandardCharsets.UTF_8); }
        String bodyBase64() { return java.util.Base64.getEncoder().encodeToString(bytes); }
    }

    TrustedConnection(String origin, String caPem) throws Exception {
        this(origin, caPem, System::currentTimeMillis, false);
    }
    TrustedConnection(String origin, String caPem, java.util.function.LongSupplier clock) throws Exception {
        this(origin, caPem, clock, false);
    }
    private TrustedConnection(String origin, String caPem, java.util.function.LongSupplier clock, boolean restoring) throws Exception {
        this.clock = clock;
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
                if (x509.getBasicConstraints() < 0) throw new IllegalArgumentException("CA certificate required");
                caCertificates.add(x509);
                store.setCertificateEntry("root-" + i++, cert);
            }
            trust.init(store);
        }
        // An expired saved CA must remain available for explicit replacement, but
        // it must never authorize a request or be accepted as a new pairing input.
        if (!restoring) checkTrustValidity();
        SSLContext tls = SSLContext.getInstance("TLS");
        tls.init(null, trust.getTrustManagers(), null);
        socketFactory = tls.getSocketFactory();
    }
    private void checkTrustValidity() throws Exception {
        var now = new java.util.Date(clock.getAsLong());
        for (var certificate : caCertificates) certificate.checkValidity(now);
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
        // Matches MAX_PAIRING_EXPIRY_MINUTES; allow 30 seconds for clock skew.
        if (expires <= now || expires > now + 24L * 60 * 60 * 1000 + 30000) throw new IllegalArgumentException("Expired artifact");
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

    /** Android and desktop HttpCookie parsers disagree on expiry-only tombstones. */
    static long credentialExpiry(HttpCookie cookie, String raw, long now) {
        if (cookie.getValue().isEmpty()) return 0;
        String maxAge = null, expires = null;
        for (String attribute : raw.split(";")) {
            int separator = attribute.indexOf('=');
            if (separator < 0) continue;
            String name = attribute.substring(0, separator).trim().toLowerCase(Locale.ROOT);
            String value = attribute.substring(separator + 1).trim();
            if (name.equals("max-age")) maxAge = value;
            if (name.equals("expires")) expires = value;
        }
        long maximum = 366L * 24 * 3600;
        if (maxAge != null) {
            long seconds = Long.parseLong(maxAge);
            return seconds <= 0 ? 0 : now + Math.min(seconds, maximum) * 1000;
        }
        if (expires != null) {
            for (var format : List.of(java.time.format.DateTimeFormatter.RFC_1123_DATE_TIME,
                    new java.time.format.DateTimeFormatterBuilder().parseCaseInsensitive()
                        .appendPattern("EEE, d-MMM-uuuu HH:mm:ss z").toFormatter(Locale.US))) {
                try {
                    long expiry = java.time.ZonedDateTime.parse(expires, format).toInstant().toEpochMilli();
                    return expiry <= now ? 0 : Math.min(expiry, now + maximum * 1000);
                } catch (java.time.format.DateTimeParseException invalidFormat) { /* Try the other HTTP cookie date form. */ }
            }
            return 0; // Malformed credential expiry must not become an unlimited session cookie.
        }
        return Long.MAX_VALUE;
    }

    /** Public UI transport shares TLS verification, never authentication or Set-Cookie processing. */
    Reply publicUi(String path) throws Exception {
        if (NativeUiRequest.path("https://localhost" + path, "GET") == null) throw new IllegalArgumentException("Invalid UI request");
        checkTrustValidity();
        HttpsURLConnection connection = (HttpsURLConnection) URI.create(origin + path).toURL().openConnection();
        connection.setSSLSocketFactory(socketFactory); connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(5000); connection.setReadTimeout(10000); connection.setUseCaches(false);
        connection.setRequestProperty("Accept-Encoding", "identity");
        connection.setRequestProperty("Cache-Control", "no-cache");
        try {
            int status = connection.getResponseCode(); checkTrustValidity();
            if (status != 200 || connection.getContentLengthLong() > MAX_BODY || !NativeUiRequest.accepts(path, connection.getContentType())) throw new java.io.IOException("UI unavailable");
            String encoding = connection.getContentEncoding();
            if (encoding != null && !encoding.equalsIgnoreCase("identity") && !encoding.equalsIgnoreCase("gzip")) throw new java.io.IOException("Unsupported UI encoding");
            try (var stream = "gzip".equalsIgnoreCase(encoding) ? new java.util.zip.GZIPInputStream(connection.getInputStream()) : connection.getInputStream()) {
                byte[] bytes = stream.readNBytes(MAX_BODY + 1);
                if (bytes.length > MAX_BODY) throw new java.io.IOException("Oversized UI resource");
                return new Reply(status, new JSONObject().put("content-type", connection.getContentType()), bytes);
            }
        } finally { connection.disconnect(); }
    }

    Reply request(String path, String method, JSONObject headers, String body) throws Exception {
        return requestBytes(path, method, headers, body == null ? null : body.getBytes(StandardCharsets.UTF_8));
    }

    Reply requestBytes(String path, String method, JSONObject headers, byte[] body) throws Exception {
        return requestBytes(path, method, headers, body, null);
    }
    Reply requestBytes(String path, String method, JSONObject headers, byte[] body, Long androidVersion) throws Exception {
        checkTrustValidity();
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
        // Set only from the installed package, after validating all caller headers.
        // The JS header allowlist deliberately excludes this field.
        if (androidVersion != null) {
            if (androidVersion < 1 || androidVersion > 2100000000L) throw new IllegalArgumentException("Invalid installed version");
            connection.setRequestProperty("X-OpenTriage-Android-Version", Long.toString(androidVersion));
        }
        List<String> cookieValues = new ArrayList<>();
        cookies.entrySet().removeIf(entry -> entry.getValue().expires <= System.currentTimeMillis());
        for (var entry : cookies.entrySet()) if (path.equals(entry.getValue().path) || path.startsWith(entry.getValue().path + "/") || path.startsWith(entry.getValue().path + "?")) cookieValues.add(entry.getKey() + "=" + entry.getValue().value);
        if (!cookieValues.isEmpty()) connection.setRequestProperty("Cookie", String.join("; ", cookieValues));
        try {
            if (body != null) {
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(body.length);
                try (var output = connection.getOutputStream()) { output.write(body); }
            }
            int status = connection.getResponseCode();
            checkTrustValidity();
            if (status >= 300 && status < 400 && status != 304) throw new IllegalStateException("Redirect requires explicit platform flow");
            for (var header : connection.getHeaderFields().entrySet()) {
                if (header.getKey() != null && header.getKey().equalsIgnoreCase("Set-Cookie")) {
                    for (String raw : header.getValue()) for (HttpCookie cookie : HttpCookie.parse(raw)) {
                        if (!COOKIE_NAMES.contains(cookie.getName()) || !cookie.getSecure() || !cookie.isHttpOnly() ||
                                cookie.getDomain() != null || !cookiePath(cookie.getName()).equals(cookie.getPath())) throw new IllegalStateException("Invalid credential cookie");
                        long expiry = credentialExpiry(cookie, raw, System.currentTimeMillis());
                        if (expiry == 0) cookies.remove(cookie.getName());
                        else cookies.put(cookie.getName(), new SavedCookie(cookie.getValue(), expiry, cookie.getPath()));
                    }
                }
            }
            JSONObject responseHeaders = new JSONObject();
            for (String name : List.of("Content-Type", "ETag", "Retry-After", "Date")) {
                String value = connection.getHeaderField(name);
                if (value != null) responseHeaders.put(name, value);
            }
            if (connection.getContentLengthLong() > MAX_BODY && !method.equals("HEAD") && !Set.of(204, 205, 304).contains(status)) throw new IllegalStateException("Oversized response");
            InputStream stream = Set.of(204, 205, 304).contains(status) || method.equals("HEAD") ? null
                : status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            byte[] bytes = stream == null ? new byte[0] : readBounded(stream);
            checkTrustValidity();
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

    /** Candidate enrollment can reuse only installation authority, never personal login. */
    TrustedConnection enrollmentCandidate(String nextOrigin, String nextCa) throws Exception {
        TrustedConnection next = new TrustedConnection(nextOrigin, nextCa);
        if (origin.equals(nextOrigin) && cookies.containsKey("open_triage_installation")) next.cookies.put("open_triage_installation", cookies.get("open_triage_installation"));
        return next;
    }

    static TrustedConnection personalHandoffTarget(String origin, String caPem) throws Exception {
        TrustedConnection target = new TrustedConnection(origin, caPem);
        target.installationRequired = false;
        return target;
    }
    boolean requiresInstallation() { return installationRequired; }

    private static String cookiePath(String name) { return name.equals("open_triage_agency_handoff") ? "/api/sessions/agency-handoff" : "/api"; }
    void clearPersonalSession() { cookies.remove("open_triage_session"); cookies.remove("open_triage_agency_handoff"); }
    /** Copy only already-approved immutable trust; credential removal does not revalidate or replace it. */
    private TrustedConnection(TrustedConnection source) {
        this.origin = source.origin;
        this.caPem = source.caPem;
        this.socketFactory = source.socketFactory;
        this.clock = source.clock;
        this.installationRequired = source.installationRequired;
        this.caCertificates.addAll(source.caCertificates);
    }
    TrustedConnection installationOnly() {
        return installationOnly(clock.getAsLong());
    }
    TrustedConnection installationOnly(long now) {
        TrustedConnection next = new TrustedConnection(this);
        SavedCookie installation = cookies.get("open_triage_installation");
        if (installation != null && installation.expires > now) next.cookies.put("open_triage_installation", installation);
        return next;
    }

    JSONObject saved() throws Exception {
        JSONArray savedCookies = new JSONArray();
        for (var entry : cookies.entrySet()) savedCookies.put(new JSONObject().put("name", entry.getKey()).put("value", entry.getValue().value).put("expires", entry.getValue().expires).put("path", entry.getValue().path));
        return new JSONObject().put("origin", origin).put("caPem", caPem).put("installationRequired", installationRequired).put("cookies", savedCookies);
    }
    static TrustedConnection restore(JSONObject saved) throws Exception {
        return restore(saved, System::currentTimeMillis);
    }
    static TrustedConnection restore(JSONObject saved, java.util.function.LongSupplier clock) throws Exception {
        TrustedConnection connection = new TrustedConnection(saved.getString("origin"), saved.getString("caPem"), clock, true);
        connection.installationRequired = saved.optBoolean("installationRequired", true);
        JSONArray cookies = saved.getJSONArray("cookies");
        for (int i = 0; i < cookies.length(); i++) {
            JSONObject cookie = cookies.getJSONObject(i);
            if (!COOKIE_NAMES.contains(cookie.getString("name"))) throw new IllegalArgumentException("Invalid stored cookie");
            if (!cookiePath(cookie.getString("name")).equals(cookie.optString("path", "/api"))) throw new IllegalArgumentException("Invalid stored cookie path");
            String value = cookie.getString("value"); long expiry = cookie.getLong("expires");
            if (!value.isEmpty() && expiry > System.currentTimeMillis())
                connection.cookies.put(cookie.getString("name"), new SavedCookie(value, expiry, cookiePath(cookie.getString("name"))));
        }
        return connection;
    }
}
