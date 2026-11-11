package org.opentriage.development;

import java.net.URI;
import java.util.Objects;
import org.json.JSONObject;

/** Only the approved API bootstrap URL leaves the app; redemption remains in the vault. */
final class NativeAuthentication {
    static void validateStart(String origin, String destination, String secret) {
        URI uri = URI.create(destination);
        if (!secret.matches("[A-Za-z0-9_-]{43}") || destination.contains(secret) || !destination.startsWith(origin + "/api/sessions/oidc/native/start?ticket=") ||
            !uri.getRawPath().equals("/api/sessions/oidc/native/start") || uri.getRawFragment() != null ||
            !uri.getRawQuery().matches("ticket=[A-Za-z0-9_-]{43}")) throw new IllegalArgumentException("Unapproved sign-in destination");
    }
    static String connectionIdentity(String origin, String caPem) throws Exception {
        byte[] digest = java.security.MessageDigest.getInstance("SHA-256").digest((origin + "\n" + caPem).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
    }
    static String installationIdentity(JSONObject saved, long now) throws Exception {
        var cookies = saved.getJSONArray("cookies");
        for (int i = 0; i < cookies.length(); i++) {
            var cookie = cookies.getJSONObject(i);
            if (cookie.getString("name").equals("open_triage_installation") && cookie.getLong("expires") > now && !cookie.getString("value").isEmpty())
                return connectionIdentity("installation", cookie.getString("value"));
        }
        throw new IllegalStateException("Live installation required");
    }
    static boolean contextMatches(JSONObject pending, String origin, String caPem, String context, String installation) throws Exception {
        return pending.getString("origin").equals(origin) && pending.getString("trust").equals(connectionIdentity(origin, caPem)) &&
            Objects.equals(pending.optString("context", null), context) && installation != null &&
            installation.equals(pending.optString("installation", null));
    }
}
