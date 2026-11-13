package org.opentriage.development;

import java.net.URI;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import org.json.JSONObject;

/** Native-only exchange. No browser navigation or credential crosses origins. */
final class NativeAgencyHandoff {
    interface Request { TrustedConnection.Reply send(TrustedConnection connection, String path, JSONObject headers, JSONObject body) throws Exception; }
    interface Check { void target(TrustedConnection connection) throws Exception; }
    interface Save { void phase(JSONObject pending) throws Exception; }
    record Result(TrustedConnection connection, JSONObject session) {}
    static String secret() { byte[] bytes = new byte[32]; new java.security.SecureRandom().nextBytes(bytes); return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
    private static String digest(String value) throws Exception { byte[] bytes = java.security.MessageDigest.getInstance("SHA-256").digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)); StringBuilder result = new StringBuilder(); for (byte b : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", b & 255)); return result.toString(); }
    static String sessionIdentity(TrustedConnection connection) throws Exception {
        var cookies = connection.saved().getJSONArray("cookies");
        for (int i = 0; i < cookies.length(); i++) {
            var cookie = cookies.getJSONObject(i);
            if (cookie.getString("name").equals("open_triage_session") && cookie.getLong("expires") > System.currentTimeMillis()) return digest(cookie.getString("value"));
        }
        throw new IllegalStateException("Current login required");
    }
    static Map<String,String> destination(String value, String origin, String stage, String transactionId) {
        URI uri = URI.create(value);
        if (!value.startsWith(origin + "/#") || !uri.getRawPath().equals("/") || uri.getRawQuery() != null || uri.getRawFragment() == null || !URI.create(origin).getRawAuthority().equals(uri.getRawAuthority()) || !"https".equals(uri.getScheme())) throw new IllegalArgumentException("Unexpected handoff origin");
        Map<String,String> parameters = new HashMap<>();
        for (String part : uri.getRawFragment().split("&", -1)) {
            String[] pair = part.split("=", -1);
            if (pair.length != 2 || !pair[1].matches("[A-Za-z0-9_-]+") || parameters.put(pair[0], pair[1]) != null) throw new IllegalArgumentException("Invalid handoff return");
        }
        var expected = stage.equals("prepare") ? Set.of("agencyHandoff", "transactionId") : stage.equals("issue") ? Set.of("agencyHandoff", "transactionId", "challengeHash") : Set.of("agencyHandoff", "transactionId", "code");
        if (!parameters.keySet().equals(expected) || !stage.equals(parameters.get("agencyHandoff")) || !transactionId.equals(parameters.get("transactionId")) ||
            stage.equals("issue") && !parameters.get("challengeHash").matches("[a-f0-9]{64}") || stage.equals("consume") && !parameters.get("code").matches("[A-Za-z0-9_-]{43}")) throw new IllegalArgumentException("Invalid handoff transaction");
        return parameters;
    }
    private static JSONObject json(TrustedConnection.Reply reply) throws Exception {
        if (reply.status() != 200 && reply.status() != 201) throw new IllegalStateException("Agency switch denied");
        return new JSONObject(reply.body());
    }
    static JSONObject prepare(TrustedConnection source, String organizationId, String csrf, Request request, Check check) throws Exception {
        if (!organizationId.matches("[a-fA-F0-9-]{36}") || csrf == null || csrf.isEmpty()) throw new IllegalArgumentException("Invalid agency intent");
        String verifier = secret();
        JSONObject headers = new JSONObject().put("content-type", "application/json").put("x-agency-handoff", "1").put("x-csrf-token", csrf);
        var start = json(request.send(source, "/api/sessions/agency-handoff/start", headers, new JSONObject().put("organizationId", organizationId).put("verifierHash", digest(verifier))));
        if (start.isNull("targetUrl")) return null;
        String id = start.getString("transactionId");
        if (!id.matches("[a-fA-F0-9-]{36}")) throw new IllegalArgumentException("Invalid handoff transaction");
        String targetOrigin = start.getString("targetOrigin");
        // The already approved public CA is reused; never accept a target-supplied CA.
        var target = TrustedConnection.personalHandoffTarget(targetOrigin, source.caPem);
        if (target.origin.equals(source.origin)) throw new IllegalArgumentException("Unexpected same-origin handoff");
        destination(start.getString("targetUrl"), target.origin, "prepare", id);
        check.target(target); // Managed-origin conflicts fail before any target request or source revocation.
        var challenge = json(request.send(target, "/api/sessions/agency-handoff/challenge", new JSONObject().put("content-type", "application/json").put("x-agency-handoff", "1"), new JSONObject().put("transactionId", id)));
        String hash = destination(challenge.getString("sourceUrl"), source.origin, "issue", id).get("challengeHash");
        return new JSONObject().put("phase", "prepared").put("transactionId", id).put("organizationId", organizationId)
            .put("source", source.saved()).put("target", target.saved()).put("verifier", verifier).put("csrf", csrf).put("challengeHash", hash)
            .put("session", sessionIdentity(source)).put("replacementCsrf", secret()).put("createdAt", System.currentTimeMillis());
    }
    static TrustedConnection resumeDestination(JSONObject pending, TrustedConnection active) throws Exception {
        String phase=pending.getString("phase");
        if (phase.equals("consuming")) {
            var target=TrustedConnection.restore(pending.getJSONObject("target"));
            if (!target.caPem.equals(active.caPem) || target.origin.equals(active.origin)) throw new IllegalStateException("Agency destination changed");
            sessionIdentity(target); return target;
        }
        if (phase.equals("completed") && active.origin.equals(pending.getString("origin")) && sessionIdentity(active).equals(pending.getString("session"))) return active;
        if (phase.equals("rotating") && !sessionIdentity(active).equals(pending.getString("session"))) return active;
        throw new IllegalStateException("No validated replacement cookie");
    }
    static JSONObject completed(TrustedConnection connection, JSONObject session) throws Exception {
        if (session.getString("csrfToken").isEmpty()) throw new IllegalStateException("Session response required");
        return new JSONObject().put("phase", "completed").put("origin", connection.origin)
            .put("session", sessionIdentity(connection)).put("publicSession", session);
    }
    static JSONObject recovered(JSONObject pending, TrustedConnection connection, JSONObject current) throws Exception {
        var original = pending.getJSONObject("publicSession");
        if (!pending.getString("phase").equals("completed") || !connection.origin.equals(pending.getString("origin")) ||
            !sessionIdentity(connection).equals(pending.getString("session")) ||
            !current.getJSONObject("user").getString("id").equals(original.getJSONObject("user").getString("id")) ||
            !current.getJSONObject("organization").getString("id").equals(original.getJSONObject("organization").getString("id"))) throw new IllegalStateException("Agency completion changed");
        return current.put("csrfToken", original.getString("csrfToken"));
    }
    static Result finish(JSONObject pending, TrustedConnection source, Request request, Check check, Save save) throws Exception {
        if (!pending.getString("phase").equals("prepared") || System.currentTimeMillis() < pending.getLong("createdAt") || System.currentTimeMillis() - pending.getLong("createdAt") >= 90000 ||
            !sessionIdentity(source).equals(pending.getString("session"))) throw new IllegalStateException("Interrupted agency switch must be cancelled");
        var original = TrustedConnection.restore(pending.getJSONObject("source"));
        if (!original.origin.equals(source.origin) || !original.caPem.equals(source.caPem)) throw new IllegalStateException("Installation changed");
        var target = TrustedConnection.restore(pending.getJSONObject("target"));
        check.target(target);
        pending.put("phase", "issuing"); save.phase(pending); // A lost issue/consume response is never replayed automatically.
        var headers = new JSONObject().put("content-type", "application/json").put("x-agency-handoff", "1").put("x-csrf-token", pending.getString("csrf"));
        var issued = json(request.send(source, "/api/sessions/agency-handoff/issue", headers,
            new JSONObject().put("transactionId", pending.getString("transactionId")).put("verifier", pending.getString("verifier")).put("challengeHash", pending.getString("challengeHash"))));
        String code = destination(issued.getString("targetUrl"), target.origin, "consume", pending.getString("transactionId")).get("code");
        pending.put("phase", "consuming"); pending.put("source", source.saved()); save.phase(pending);
        check.target(target);
        JSONObject session;
        try {
            session = json(request.send(target, "/api/sessions/agency-handoff/consume", new JSONObject().put("content-type", "application/json").put("x-agency-handoff", "1"),
                new JSONObject().put("transactionId", pending.getString("transactionId")).put("code", code).put("replacementCsrf", pending.getString("replacementCsrf"))));
        } finally {
            // Headers can install the valid cookie before a body is lost. Keep
            // that jar with the preselected CSRF, never replay one-use consume.
            pending.put("target", target.saved()); save.phase(pending);
        }
        if (!session.getJSONObject("organization").getString("id").equals(pending.getString("organizationId"))) throw new IllegalStateException("Unexpected target agency");
        return new Result(target, session);
    }
}
