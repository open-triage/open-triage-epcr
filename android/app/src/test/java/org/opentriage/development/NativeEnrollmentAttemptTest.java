package org.opentriage.development;
import static org.junit.Assert.*;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class NativeEnrollmentAttemptTest {
    private JSONArray vectors() throws Exception {
        try(var input=getClass().getResourceAsStream("/enrollment-attempt-vectors.json")) {
            return new JSONObject(new String(input.readAllBytes(),StandardCharsets.UTF_8)).getJSONArray("vectors");
        }
    }
    @Test public void resultDerivationMatchesServerCanonicalUnicodeAndDelimiterVectors() throws Exception {
        var all=vectors();
        for(int index=0;index<all.length();index++) {
            var vector=all.getJSONObject(index);
            String binding=NativeEnrollmentAttempt.binding(vector.getString("origin"),vector.getString("token"),vector.getString("name"),vector.getBoolean("reassign"),vector.getString("originalCredential"));
            assertEquals(vector.getString("binding"),binding);
            assertEquals(vector.getString("credential"),NativeEnrollmentAttempt.credential(vector.getString("attempt"),binding));
        }
    }
    @Test public void resultUsesOnlyImmutableIntentAndOriginalInstallationAuthorityWithoutRenewingExpiry() throws Exception {
        var vector=vectors().getJSONObject(0);long now=System.currentTimeMillis(),created=now-3600000,expiry=now+100000;
        JSONObject original=new TrustedConnection(vector.getString("origin"),"").saved().put("cookies",new JSONArray().put(new JSONObject().put("name","open_triage_installation").put("value",vector.getString("originalCredential")).put("expires",expiry)));
        JSONObject body=new JSONObject().put("token",vector.getString("token")).put("name",vector.getString("name")).put("attempt",vector.getString("attempt")).put("confirmInstallation",true).put("reassign",true);
        JSONObject pending=new JSONObject().put("candidate",original).put("body",body).put("createdAt",created);
        String before=pending.toString();JSONObject result=NativeEnrollmentAttempt.resultConnection(pending,now).saved();
        assertEquals(before,pending.toString());assertEquals(1,result.getJSONArray("cookies").length());
        assertEquals(vector.getString("credential"),result.getJSONArray("cookies").getJSONObject(0).getString("value"));
        assertEquals(expiry,result.getJSONArray("cookies").getJSONObject(0).getLong("expires"));
        assertThrows(Exception.class,()->NativeEnrollmentAttempt.resultConnection(pending,expiry+1));
        String ca;
        try(var input=getClass().getResourceAsStream("/tls/ca.pem")){ca=new String(input.readAllBytes(),StandardCharsets.UTF_8);}
        JSONObject trusted=NativeEnrollmentAttempt.replaceTrust(pending,original.getString("origin"),ca);
        assertEquals(before,pending.toString());assertEquals(body.toString(),trusted.getJSONObject("body").toString());
        assertEquals(created,trusted.getLong("createdAt"));assertEquals(original.getJSONArray("cookies").toString(),trusted.getJSONObject("candidate").getJSONArray("cookies").toString());
        assertEquals(ca,trusted.getJSONObject("candidate").getString("caPem"));
        assertThrows(Exception.class,()->NativeEnrollmentAttempt.replaceTrust(pending,"https://other.example", ""));
        assertThrows(Exception.class,()->NativeEnrollmentAttempt.replaceTrust(pending,original.getString("origin"),"-----BEGIN PRIVATE KEY-----"));
        original.getJSONArray("cookies").put(new JSONObject().put("name","open_triage_session").put("value","personal").put("expires",expiry));
        assertThrows(Exception.class,()->NativeEnrollmentAttempt.resultConnection(pending,now));
    }
}
