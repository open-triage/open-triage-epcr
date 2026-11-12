package org.opentriage.development;

import org.json.JSONObject;

/** Recovery material only. Every restoration requires fresh, CSRF-guarded server authority. */
final class NativePersonalContinuation {
    interface Current { TrustedConnection.Reply request(String csrf) throws Exception; }
    private static String installation(TrustedConnection connection) throws Exception {
        try { return NativeAuthentication.installationIdentity(connection.saved(), System.currentTimeMillis()); }
        catch (IllegalStateException absent) { return ""; }
    }
    static JSONObject capture(TrustedConnection connection, JSONObject session) throws Exception {
        String csrf = session.getString("csrfToken");
        if (!csrf.matches("[A-Za-z0-9_-]{43}")) throw new IllegalStateException("Invalid session continuation");
        return new JSONObject().put("trust", NativeAuthentication.connectionIdentity(connection.origin, connection.caPem))
            .put("cookie", NativeAgencyHandoff.sessionIdentity(connection)).put("installation", installation(connection))
            .put("csrf", csrf)
            .put("principal", session.getJSONObject("user").getString("id"))
            .put("organization", session.isNull("organization") ? "" : session.getJSONObject("organization").getString("id"));
    }
    static boolean matches(JSONObject saved, TrustedConnection connection) {
        try {
            return saved != null && connection != null && saved.getString("trust").equals(NativeAuthentication.connectionIdentity(connection.origin, connection.caPem))
                && saved.getString("cookie").equals(NativeAgencyHandoff.sessionIdentity(connection))
                && saved.getString("installation").equals(installation(connection));
        } catch (Exception invalid) { return false; }
    }
    static JSONObject restore(JSONObject saved, TrustedConnection connection, JSONObject current) throws Exception {
        if (!matches(saved, connection) || !saved.getString("principal").equals(current.getJSONObject("user").getString("id"))
            || !saved.getString("organization").equals(current.isNull("organization") ? "" : current.getJSONObject("organization").getString("id"))
            || java.time.Instant.parse(current.getString("expiresAt")).toEpochMilli() <= System.currentTimeMillis())
            throw new IllegalStateException("Personal session changed");
        return current.put("csrfToken", saved.getString("csrf"));
    }
    static JSONObject resume(JSONObject saved, TrustedConnection connection, Current current) throws Exception {
        if (!matches(saved, connection)) return null;
        var response=current.request(saved.getString("csrf"));
        if (response.status() == 401 || response.status() == 403) return null;
        if (response.status() != 200) throw new IllegalStateException("Personal session unavailable");
        try { return restore(saved, connection, new JSONObject(response.body())); }
        catch (Exception changed) { return null; }
    }
}
