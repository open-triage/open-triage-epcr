package org.opentriage.development;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Locale;
import java.util.Set;
import org.json.JSONObject;

/** The native document surface accepts only the existing authorized PDF resources. */
final class NativePdfContract {
    static final int MAX_BYTES = 10 * 1024 * 1024;
    private static final String UUID = "[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-4[a-fA-F0-9]{3}-[89abAB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}";
    static void request(String path, JSONObject headers) throws Exception {
        if (path == null || path.length() > 2048 || path.contains("\\") || path.contains("#")) throw new IllegalArgumentException("Invalid PDF resource");
        URI uri = URI.create(path);
        if (uri.isAbsolute() || uri.getRawAuthority() != null || uri.getRawPath().contains("%") || !uri.getPath().matches("/api/(?:reports/" + UUID + "/cos/pdf|review/reports/" + UUID + "/(?:snapshots|cos-deliveries)/" + UUID + "/pdf)")) throw new IllegalArgumentException("Invalid PDF resource");
        var seen = new java.util.HashSet<String>();
        String query = uri.getRawQuery();
        if (query == null || query.isEmpty()) throw new IllegalArgumentException("PDF version required");
        for (String pair : query.split("&", -1)) {
            String[] item = pair.split("=", -1);
            if (item.length != 2 || !seen.add(item[0])) throw new IllegalArgumentException("Invalid PDF dimensions");
            item[1] = java.net.URLDecoder.decode(item[1], StandardCharsets.UTF_8);
            boolean valid = switch (item[0]) {
                case "revision", "amendmentSequence" -> item[1].matches("0|[1-9][0-9]{0,9}");
                case "language" -> item[1].matches("en|sv");
                case "dataset" -> item[1].matches("real|synthetic");
                case "timeZone" -> item[1].matches("[A-Za-z0-9_+./:-]{1,100}");
                default -> false;
            };
            if (!valid) throw new IllegalArgumentException("Invalid PDF dimensions");
        }
        if (!seen.contains("language") || (uri.getPath().startsWith("/api/review/") ? !seen.containsAll(Set.of("amendmentSequence", "dataset")) || seen.contains("revision") : !seen.contains("revision") || seen.contains("amendmentSequence") || seen.contains("dataset"))) throw new IllegalArgumentException("Invalid PDF version");
        for (var iterator = headers.keys(); iterator.hasNext();) {
            String key = iterator.next();
            if (!key.toLowerCase(Locale.ROOT).equals("x-organization-id") || !headers.getString(key).matches(UUID)) throw new IllegalArgumentException("Unapproved PDF header");
        }
        if (!headers.has("x-organization-id")) throw new IllegalArgumentException("Agency required");
    }
    static void bytes(int status, JSONObject headers, byte[] bytes) throws Exception {
        if (status != 200 || !headers.optString("Content-Type").toLowerCase(Locale.ROOT).matches("application/pdf(?:;.*)?") || bytes.length < 8 || bytes.length > MAX_BYTES || !new String(bytes, 0, 5, StandardCharsets.US_ASCII).equals("%PDF-")) throw new IllegalStateException("PDF unavailable");
    }
    record Authority(String user, String organization, String cookie, long expiresAt) {}
    static Authority authority(JSONObject current, JSONObject saved, String organization, long now) throws Exception {
        String user = current.getJSONObject("user").getString("id"), agency = current.getJSONObject("organization").getString("id");
        long expiry = Instant.parse(current.getString("expiresAt")).toEpochMilli();
        if (!user.matches(UUID) || !agency.equals(organization) || expiry <= now) throw new IllegalStateException("PDF authority unavailable");
        long cookieExpiry = Long.MAX_VALUE;
        var cookies = saved.getJSONArray("cookies"); boolean personal = false;
        for (int i = 0; i < cookies.length(); i++) if (cookies.getJSONObject(i).getString("name").equals("open_triage_session")) {
            cookieExpiry = cookies.getJSONObject(i).getLong("expires"); personal = true;
        }
        if (!personal || cookieExpiry <= now) throw new IllegalStateException("PDF authority unavailable");
        return new Authority(user, agency, cookie(saved), Math.min(expiry, cookieExpiry));
    }
    static String cookie(JSONObject saved) throws Exception {
        String personal = "";
        var cookies = saved.getJSONArray("cookies");
        for (int i = 0; i < cookies.length(); i++) if (cookies.getJSONObject(i).getString("name").equals("open_triage_session")) personal = cookies.getJSONObject(i).getString("value");
        if (personal.isEmpty()) return "";
        byte[] digest = MessageDigest.getInstance("SHA-256").digest((saved.getString("origin") + "\n" + saved.getString("caPem") + "\n" + personal).getBytes(StandardCharsets.UTF_8));
        return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
    }
}
