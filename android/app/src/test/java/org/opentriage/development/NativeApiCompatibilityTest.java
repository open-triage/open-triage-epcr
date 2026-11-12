package org.opentriage.development;

import static org.junit.Assert.*;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class NativeApiCompatibilityTest {
    private JSONObject health() { return new JSONObject().put("androidApiProtocol",1).put("androidApiCapabilities",new JSONArray(NativeApiCompatibility.REQUIRED)); }
    @Test public void compatibleProtocolRequiresEveryImplementedCapabilityButAllowsAdditiveServerSupport() {
        var health=health();NativeApiCompatibility.require(health);health.getJSONArray("androidApiCapabilities").put("future-feature");NativeApiCompatibility.require(health);
        for(String omitted:NativeApiCompatibility.REQUIRED){var capabilities=new JSONArray();for(String required:NativeApiCompatibility.REQUIRED)if(!required.equals(omitted))capabilities.put(required);assertThrows(NativeApiCompatibility.Incompatible.class,()->NativeApiCompatibility.require(health().put("androidApiCapabilities",capabilities)));}
        for(Object protocol:new Object[]{"1",0,2,1.5,JSONObject.NULL})assertThrows(NativeApiCompatibility.Incompatible.class,()->NativeApiCompatibility.require(health().put("androidApiProtocol",protocol)));
        assertThrows(NativeApiCompatibility.Incompatible.class,()->NativeApiCompatibility.require(health().put("androidApiCapabilities",new JSONArray().put(1))));
    }
    @Test public void incompatibleTargetIsRejectedBeforeChallengeOrSourceRevocation() throws Exception {
        var source=TrustedConnection.restore(new JSONObject().put("origin","https://source.example.test").put("caPem","").put("cookies",new JSONArray().put(new JSONObject().put("name","open_triage_session").put("value","source-cookie").put("expires",System.currentTimeMillis()+60000))));
        var before=NativeAgencyHandoff.sessionIdentity(source);var calls=new java.util.ArrayList<String>();
        assertThrows(NativeApiCompatibility.Incompatible.class,()->NativeAgencyHandoff.prepare(source,"20000000-0000-4000-8000-000000000002","csrf",(connection,path,headers,body)->{
            calls.add(path);assertSame(source,connection);
            return new TrustedConnection.Reply(200,new JSONObject(),new JSONObject().put("transactionId","10000000-0000-4000-8000-000000000001").put("targetOrigin","https://target.example.test").put("targetUrl","https://target.example.test/#agencyHandoff=prepare&transactionId=10000000-0000-4000-8000-000000000001").toString().getBytes());
        },target->{assertEquals(0,target.saved().getJSONArray("cookies").length());NativeApiCompatibility.require(health().put("androidApiCapabilities",new JSONArray()));}));
        assertEquals(java.util.List.of("/api/sessions/agency-handoff/start"),calls);assertEquals(before,NativeAgencyHandoff.sessionIdentity(source));
    }
}
