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
        JSONObject pending = new JSONObject().put("secret", "a".repeat(43)).put("origin", "https://installation.test").put("trust", NativeAuthentication.connectionIdentity("https://installation.test", "ROOT1")).put("context", "policy-v1");
        assertTrue(NativeAuthentication.contextMatches(pending, "https://installation.test", "ROOT1", "policy-v1"));
        assertFalse(NativeAuthentication.contextMatches(pending, "https://other.test", "ROOT1", "policy-v1"));
        assertFalse(NativeAuthentication.contextMatches(pending, "https://installation.test", "ROOT1", "policy-v2"));
        assertFalse(NativeAuthentication.contextMatches(pending, "https://installation.test", "ROOT2", "policy-v1"));
        pending.remove("context");
        assertTrue(NativeAuthentication.contextMatches(pending, "https://installation.test", "ROOT1", null));
    }
}
