package org.opentriage.development;
import static org.junit.Assert.*;
import org.json.JSONObject;
import org.junit.Test;

public class NativeAuthenticationTest {
    @Test public void rejectsRedirectAndSecretConfusion() {
        String origin = "https://installation.test", secret = "a".repeat(43);
        String start = origin + "/api/sessions/oidc/native/start?ticket=" + "b".repeat(43);
        NativeAuthentication.validateStart(origin, start, secret);
        for (String bad : new String[]{start.replace("b".repeat(43), secret), start + "&redirect=https://attacker.test", start + "#fragment", start.replace("installation.test", "installation.test.attacker.test"), start.replace("https:", "http:"), start.replace("native/start", "native/../start")})
            assertThrows(IllegalArgumentException.class, () -> NativeAuthentication.validateStart(origin, bad, secret));
        assertThrows(IllegalArgumentException.class, () -> NativeAuthentication.validateStart(origin, start, "short"));
    }
    @Test public void interruptedHandoffRemainsBoundToConnectionAndPolicy() throws Exception {
        JSONObject pending = new JSONObject().put("secret", "a".repeat(43)).put("origin", "https://installation.test").put("trust", NativeAuthentication.connectionIdentity("https://installation.test", "ROOT1")).put("context", "policy-v1").put("installation", "installation-a");
        assertTrue(NativeAuthentication.contextMatches(pending, "https://installation.test", "ROOT1", "policy-v1", "installation-a"));
        assertFalse(NativeAuthentication.contextMatches(pending, "https://other.test", "ROOT1", "policy-v1", "installation-a"));
        assertFalse(NativeAuthentication.contextMatches(pending, "https://installation.test", "ROOT1", "policy-v2", "installation-a"));
        assertFalse(NativeAuthentication.contextMatches(pending, "https://installation.test", "ROOT2", "policy-v1", "installation-a"));
        assertFalse(NativeAuthentication.contextMatches(pending, "https://installation.test", "ROOT1", "policy-v1", "installation-b"));
        pending.remove("context");
        assertTrue(NativeAuthentication.contextMatches(pending, "https://installation.test", "ROOT1", null, "installation-a"));
    }
    @Test public void installationBindingSurvivesRestartButNotReplacementOrExpiry() throws Exception {
        JSONObject saved = new JSONObject("{\"cookies\":[{\"name\":\"open_triage_installation\",\"value\":\"stable-installation-token\",\"expires\":2000},{\"name\":\"open_triage_session\",\"value\":\"personal-login-a\",\"expires\":2000}]}");
        String identity = NativeAuthentication.installationIdentity(saved, 1000);
        assertEquals(identity, NativeAuthentication.installationIdentity(new JSONObject(saved.toString()), 1000));
        saved.getJSONArray("cookies").getJSONObject(1).put("value", "personal-login-b");
        assertEquals(identity, NativeAuthentication.installationIdentity(saved, 1000));
        saved.getJSONArray("cookies").getJSONObject(0).put("value", "replacement-installation-token");
        assertNotEquals(identity, NativeAuthentication.installationIdentity(saved, 1000));
        assertThrows(IllegalStateException.class, () -> NativeAuthentication.installationIdentity(saved, 2000));
        saved.getJSONArray("cookies").getJSONObject(0).put("value", "");
        assertThrows(IllegalStateException.class, () -> NativeAuthentication.installationIdentity(saved, 1000));
    }
}
