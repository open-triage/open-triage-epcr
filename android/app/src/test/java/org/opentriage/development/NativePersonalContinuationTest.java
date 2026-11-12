package org.opentriage.development;

import static org.junit.Assert.*;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class NativePersonalContinuationTest {
    private TrustedConnection connection() throws Exception {
        return TrustedConnection.restore(new JSONObject().put("origin","https://source.example.test").put("caPem","").put("cookies",new JSONArray()
            .put(new JSONObject().put("name","open_triage_session").put("value","private-personal").put("expires",System.currentTimeMillis()+60000))
            .put(new JSONObject().put("name","open_triage_installation").put("value","private-installation").put("expires",System.currentTimeMillis()+60000))));
    }
    private JSONObject session() throws Exception {
        return new JSONObject().put("csrfToken","c".repeat(43)).put("user",new JSONObject().put("id","principal"))
            .put("organization",new JSONObject().put("id","agency")).put("capabilities",new JSONArray().put("old:role"))
            .put("expiresAt",java.time.Instant.now().plusSeconds(7200).toString()).put("personallyAuthenticatedAt","2026-01-01T00:00:00Z");
    }
    @Test public void absentPublicMetadataRecoversOnlyFreshServerFieldsAndOriginalCsrf() throws Exception {
        var connection=connection();var saved=NativePersonalContinuation.capture(connection,session());
        assertEquals(6,saved.length());assertFalse(saved.has("capabilities"));assertFalse(saved.has("expiresAt"));assertFalse(saved.toString().contains("private-personal"));
        String currentExpiry=java.time.Instant.now().plusSeconds(3600).toString();
        var current=session().put("capabilities",new JSONArray().put("current:role")).put("expiresAt",currentExpiry);current.remove("csrfToken");
        var recovered=NativePersonalContinuation.restore(saved,connection,current);
        assertEquals("current:role",recovered.getJSONArray("capabilities").getString(0));assertEquals(currentExpiry,recovered.getString("expiresAt"));
        assertEquals("2026-01-01T00:00:00Z",recovered.getString("personallyAuthenticatedAt"));assertEquals("c".repeat(43),recovered.getString("csrfToken"));
    }
    @Test public void currentPrincipalOrOrganizationMismatchCannotRecover() throws Exception {
        for(String field:new String[]{"user","organization"}) {
            var connection=connection();var saved=NativePersonalContinuation.capture(connection,session());var current=session();current.getJSONObject(field).put("id","other");
            assertThrows(IllegalStateException.class,()->NativePersonalContinuation.restore(saved,connection,current));
        }
    }
    @Test public void cookieTrustInstallationChangesExpiryAndLogoutInvalidateBinding() throws Exception {
        for(String change:new String[]{"personal","installation","expired","origin","ca","logout"}) {
            var connection=connection();var saved=NativePersonalContinuation.capture(connection,session());var json=connection.saved();
            if(change.equals("origin"))json.put("origin","https://other.example.test");
            else if(change.equals("ca"))saved.put("trust","changed-trust");
            else if(change.equals("logout"))connection=connection.installationOnly();
            else {var cookie=json.getJSONArray("cookies").getJSONObject(0);for(int i=0;i<json.getJSONArray("cookies").length();i++){var candidate=json.getJSONArray("cookies").getJSONObject(i);if(candidate.getString("name").equals(change.equals("installation")?"open_triage_installation":"open_triage_session"))cookie=candidate;}if(change.equals("expired"))cookie.put("expires",0);else cookie.put("value","replacement");}
            if(!change.equals("logout"))connection=TrustedConnection.restore(json);
            assertFalse(change,NativePersonalContinuation.matches(saved,connection));
        }
    }
    @Test public void agencylessAndCrossHostSessionsWithoutInstallationCookieRemainSupported() throws Exception {
        var connection=connection();var json=connection.saved();var personal=new JSONArray();for(int i=0;i<json.getJSONArray("cookies").length();i++){var cookie=json.getJSONArray("cookies").getJSONObject(i);if(cookie.getString("name").equals("open_triage_session"))personal.put(cookie);}json.put("cookies",personal);connection=TrustedConnection.restore(json);
        var session=session().put("organization",JSONObject.NULL);var saved=NativePersonalContinuation.capture(connection,session);
        assertTrue(NativePersonalContinuation.matches(saved,connection));assertTrue(NativePersonalContinuation.restore(saved,connection,new JSONObject(session.toString())).isNull("organization"));
    }
    @Test public void malformedCsrfCannotBecomeContinuationMaterial() throws Exception {
        var connection=connection();assertThrows(IllegalStateException.class,()->NativePersonalContinuation.capture(connection,session().put("csrfToken","bad")));
    }
    @Test public void revokedExpiredAndRejectedCsrfNeverReturnCachedAuthority() throws Exception {
        var connection=connection();var saved=NativePersonalContinuation.capture(connection,session());
        for(int status:new int[]{401,403}) assertNull(NativePersonalContinuation.resume(saved,connection,csrf->{assertEquals("c".repeat(43),csrf);return new TrustedConnection.Reply(status,new JSONObject(),"{}".getBytes());}));
        assertNull(NativePersonalContinuation.resume(saved,connection,csrf->new TrustedConnection.Reply(200,new JSONObject(),session().put("expiresAt","2000-01-01T00:00:00Z").toString().getBytes())));
        assertThrows(IllegalStateException.class,()->NativePersonalContinuation.resume(saved,connection,csrf->new TrustedConnection.Reply(503,new JSONObject(),"{}".getBytes())));
        assertTrue("An outage does not rewrite the original binding",NativePersonalContinuation.matches(saved,connection));
        connection.clearPersonalSession();assertNull(NativePersonalContinuation.resume(saved,connection,csrf->{throw new AssertionError("No request after logout");}));
    }
}
