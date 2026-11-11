package org.opentriage.development;

import static org.junit.Assert.*;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;
import org.junit.Test;

public class ManagedConnectionPolicyTest {
    private JSONObject configuration(String origin, String ca) throws Exception {
        return new JSONObject().put("configurationVersion", 1).put("serverOrigin", origin).put("publicCaPem", ca);
    }
    private String ca() throws Exception { return new String(getClass().getResourceAsStream("/tls/ca.pem").readAllBytes(), StandardCharsets.UTF_8); }
    @Test public void missingOrPendingPolicyNeverSilentlyRestoresManualConfiguration() throws Exception {
        assertFalse(ManagedConnectionPolicy.evaluate(new JSONObject(), false, false).managed());
        for (boolean seen : new boolean[]{false, true}) {
            var pending = ManagedConnectionPolicy.evaluate(new JSONObject(), seen, true);
            assertTrue(pending.managed()); assertTrue(pending.blocked()); assertEquals("pending", pending.status());
        }
        var missing = ManagedConnectionPolicy.evaluate(new JSONObject(), true, false);
        assertTrue(missing.managed()); assertTrue(missing.blocked()); assertEquals("missing", missing.status());
        assertTrue("Unknown policy availability blocks even before management has been observed",
            new ManagedConnectionPolicy.State(false, "unavailable", null, null, null).blocked());
    }
    @Test public void explicitTypedCompletePolicySupportsSystemAndPrivateTrust() throws Exception {
        for (String pem : new String[]{"", ca()}) {
            var state = ManagedConnectionPolicy.evaluate(configuration("https://agency.example", pem), false, false);
            assertTrue(state.managed()); assertFalse(state.blocked()); assertEquals("valid", state.status());
            assertTrue(state.matches(new TrustedConnection("https://agency.example", pem)));
            assertFalse(state.matches(new TrustedConnection("https://other.example", pem)));
            assertEquals("changed", state.forConnection(new TrustedConnection("https://other.example", pem)).status());
        }
        var privateTrust = ManagedConnectionPolicy.evaluate(configuration("https://agency.example", ca()), false, false);
        assertTrue(privateTrust.matches(new TrustedConnection("https://agency.example", "\n" + ca() + "\n")));
        assertTrue("Repeated roots do not change the effective trust set", privateTrust.matches(new TrustedConnection("https://agency.example", ca() + "\n" + ca())));
        assertEquals("changed", privateTrust.forConnection(new TrustedConnection("https://agency.example", "")).status());
    }
    @Test public void partialMalformedOrSecretPolicyIsBlockedBeforeAnyRequest() throws Exception {
        JSONObject good = configuration("https://agency.example", "");
        for (String key : ManagedConnectionPolicy.KEYS) {
            JSONObject partial = new JSONObject(good.toString()); partial.remove(key);
            assertEquals("invalid", ManagedConnectionPolicy.evaluate(partial, false, false).status());
        }
        for (Object version : new Object[]{"1", 1.5, 2, true}) assertTrue(ManagedConnectionPolicy.evaluate(new JSONObject(good.toString()).put("configurationVersion", version), false, false).blocked());
        for (String origin : new String[]{"http://agency.example", "https://agency.example/path", "https://user:secret@agency.example"}) assertTrue(ManagedConnectionPolicy.evaluate(configuration(origin, ""), false, false).blocked());
        for (String pem : new String[]{"not a certificate", "-----BEGIN PRIVATE KEY-----", "a".repeat(50000)}) assertTrue(ManagedConnectionPolicy.evaluate(configuration("https://agency.example", pem), false, false).blocked());
    }
    @Test public void unchangedResumeDoesNotRejectAnInflightOperationButRealChangesDo() throws Exception {
        var revisions = new ManagedPolicyRevision();
        var original = ManagedConnectionPolicy.evaluate(configuration("https://agency.example", ""), false, false);
        revisions.observe(original); long inFlight = revisions.current();
        for (int resume = 0; resume < 3; resume++) revisions.observe(ManagedConnectionPolicy.evaluate(configuration("https://agency.example", ""), true, false));
        assertEquals("Same policy after scanner/activity resume preserves the operation", inFlight, revisions.current());
        revisions.observe(ManagedConnectionPolicy.evaluate(configuration("https://other.example", ""), true, false));
        assertNotEquals(inFlight, revisions.current());
        revisions.observe(original);
        assertNotEquals("Changed then restored authority still invalidates an older in-flight result", inFlight, revisions.current());
        long restored = revisions.current();
        revisions.observe(original); assertEquals(restored, revisions.current());
    }
    @Test public void nativeOriginsRejectRepresentationsThatTheSharedUrlParserNormalizes() throws Exception {
        for (String origin : new String[]{"https://AGENCY.example", "https://agency.example:443", "https://agency.example/", "https://127.00.0.1", "https://127.0.0.1.", "https://2130706433", "https://[0:0:0:0:0:0:0:1]", "https://[::FFFF:192.0.2.1]"}) {
            assertTrue(origin, ManagedConnectionPolicy.evaluate(configuration(origin, ""), false, false).blocked());
            assertThrows(origin, IllegalArgumentException.class, () -> new TrustedConnection(origin, ""));
        }
        for (String origin : new String[]{"https://agency.example", "https://127.0.0.1:9443", "https://[::1]:9443", "https://[::ffff:c000:201]"}) {
            assertFalse(origin, ManagedConnectionPolicy.evaluate(configuration(origin, ""), false, false).blocked());
        }
    }
}
