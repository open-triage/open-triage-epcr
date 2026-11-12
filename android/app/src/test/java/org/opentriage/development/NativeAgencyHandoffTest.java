package org.opentriage.development;

import static org.junit.Assert.*;
import org.junit.Test;
import org.json.JSONObject;
import org.json.JSONArray;
import java.util.ArrayList;
import java.util.List;

public class NativeAgencyHandoffTest {
    private static final String ID="10000000-0000-4000-8000-000000000001", AGENCY="20000000-0000-4000-8000-000000000002";
    private static final String SOURCE="https://source.example.test", TARGET="https://target.example.test";
    private TrustedConnection source() throws Exception {
        return TrustedConnection.restore(new JSONObject().put("origin",SOURCE).put("caPem","").put("cookies",new JSONArray()
            .put(new JSONObject().put("name","open_triage_session").put("value","source-personal-secret").put("expires",System.currentTimeMillis()+60000))
            .put(new JSONObject().put("name","open_triage_installation").put("value","source-installation-secret").put("expires",System.currentTimeMillis()+60000))));
    }
    private TrustedConnection.Reply response(JSONObject body) { return new TrustedConnection.Reply(201,new JSONObject(),body.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
    private String url(String origin,String stage,String extra) { return origin+"/#agencyHandoff="+stage+"&transactionId="+ID+extra; }
    private NativeAgencyHandoff.Request requests(TrustedConnection source,List<String> calls) {
        return (connection,path,headers,body)->{
            calls.add(connection.origin+path);
            if(connection!=source) {
                assertEquals(TARGET,connection.origin);assertEquals(source.caPem,connection.caPem);
                assertEquals("Source personal and installation cookies never cross origins",0,connection.saved().getJSONArray("cookies").length());
                assertFalse(headers.has("x-csrf-token"));
            }
            assertEquals("1",headers.getString("x-agency-handoff"));
            if(path.endsWith("/start"))return response(new JSONObject().put("transactionId",ID).put("targetOrigin",TARGET).put("targetUrl",url(TARGET,"prepare","")));
            if(path.endsWith("/challenge"))return response(new JSONObject().put("sourceUrl",url(SOURCE,"issue","&challengeHash="+"a".repeat(64))));
            if(path.endsWith("/issue"))return response(new JSONObject().put("targetUrl",url(TARGET,"consume","&code="+"b".repeat(43))));
            if(path.endsWith("/consume"))return response(new JSONObject().put("organization",new JSONObject().put("id",AGENCY)).put("csrfToken","new-target-csrf"));
            throw new AssertionError(path);
        };
    }
    @Test public void completesOnlyValidatedPrivateExchangeWithEmptyTargetJarAndDurablePhaseBarriers() throws Exception {
        var source=source();var calls=new ArrayList<String>();var phases=new ArrayList<String>();var request=requests(source,calls);
        var pending=NativeAgencyHandoff.prepare(source,AGENCY,"csrf",request,target->assertEquals(TARGET,target.origin));
        assertEquals("prepared",pending.getString("phase"));assertEquals(2,calls.size());
        var result=NativeAgencyHandoff.finish(pending,source,request,target->assertEquals(TARGET,target.origin),value->phases.add(value.getString("phase")));
        assertEquals(List.of("issuing","consuming","consuming"),phases);assertEquals(TARGET,result.connection().origin);assertEquals(AGENCY,result.session().getJSONObject("organization").getString("id"));assertEquals(4,calls.size());
    }
    @Test public void managedConflictAndUntrustedTargetFailBeforeSourceIssuance() throws Exception {
        for(boolean managed:new boolean[]{true,false}) {
            var source=source();var calls=new ArrayList<String>();var request=requests(source,calls);
            assertThrows(Exception.class,()->NativeAgencyHandoff.prepare(source,AGENCY,"csrf",(connection,path,headers,body)->{
                if(connection!=source&&!managed)throw new javax.net.ssl.SSLHandshakeException("different CA");return request.send(connection,path,headers,body);
            },target->{if(managed)throw new IllegalStateException("Managed origin conflict");}));
            assertEquals(List.of(SOURCE+"/api/sessions/agency-handoff/start"),calls);
            assertEquals(2,source.saved().getJSONArray("cookies").length());
        }
    }
    @Test public void tamperedChallengeCannotCauseSourceCredentialRequestToAnotherHost() throws Exception {
        var source=source();var calls=new ArrayList<String>();var request=requests(source,calls);
        assertThrows(IllegalArgumentException.class,()->NativeAgencyHandoff.prepare(source,AGENCY,"csrf",(connection,path,headers,body)->{
            if(path.endsWith("/challenge"))return response(new JSONObject().put("sourceUrl",url(TARGET,"issue","&challengeHash="+"a".repeat(64))));return request.send(connection,path,headers,body);
        },target->{}));assertEquals(1,calls.size());
    }
    @Test public void ambiguousIssueOrConsumeIsJournaledAndNeverAutomaticallyReplayed() throws Exception {
        for(String fault:new String[]{"/issue","/consume"}) {
            var source=source();var calls=new ArrayList<String>();var request=requests(source,calls);var phases=new ArrayList<String>();
            var pending=NativeAgencyHandoff.prepare(source,AGENCY,"csrf",request,target->{});
            assertThrows(java.io.IOException.class,()->NativeAgencyHandoff.finish(pending,source,(connection,path,headers,body)->{
                if(path.endsWith(fault))throw new java.io.IOException("lost reply");return request.send(connection,path,headers,body);
            },target->{},value->phases.add(value.getString("phase"))));
            assertEquals(fault.equals("/issue")?"issuing":"consuming",pending.getString("phase"));
            int count=calls.size();assertThrows(IllegalStateException.class,()->NativeAgencyHandoff.finish(pending,source,request,target->{},value->{}));assertEquals(count,calls.size());
        }
    }
    @Test public void expiredChangedOrFutureContextCannotConsumeAnOldIntent() throws Exception {
        for(String change:new String[]{"expired","future","session"}) {
            var source=source();var calls=new ArrayList<String>();var request=requests(source,calls);var pending=NativeAgencyHandoff.prepare(source,AGENCY,"csrf",request,target->{});
            if(change.equals("session"))source.clearPersonalSession();else pending.put("createdAt",System.currentTimeMillis()+(change.equals("expired")?-90001:60000));
            assertThrows(IllegalStateException.class,()->NativeAgencyHandoff.finish(pending,source,request,target->{},value->{}));assertEquals(2,calls.size());
        }
    }
    @Test public void returnParserRejectsUnexpectedHostsPathsQueriesDuplicateParametersAndReplayTransaction() {
        for(String value:new String[]{url("https://evil.test","consume","&code="+"b".repeat(43)),TARGET+"/other#agencyHandoff=consume&transactionId="+ID+"&code="+"b".repeat(43),TARGET+"/?query=secret#agencyHandoff=consume&transactionId="+ID+"&code="+"b".repeat(43),url(TARGET,"consume","&code="+"b".repeat(43)+"&code="+"b".repeat(43)),url(TARGET,"consume","&code=bad"),url(TARGET,"issue","&challengeHash="+"a".repeat(64))})
            assertThrows(IllegalArgumentException.class,()->NativeAgencyHandoff.destination(value,TARGET,"consume",ID));
        assertThrows(IllegalArgumentException.class,()->NativeAgencyHandoff.destination(url(TARGET,"prepare",""),TARGET,"prepare",AGENCY));
    }
    @Test public void completedSessionRemainsBoundToItsCookieOriginIdentityAndAgencyUntilAcknowledged() throws Exception {
        var connection=source();var session=new JSONObject().put("csrfToken","sealed-csrf")
            .put("user",new JSONObject().put("id",ID)).put("organization",new JSONObject().put("id",AGENCY));
        var completed=NativeAgencyHandoff.completed(connection,session);
        assertEquals("completed",completed.getString("phase"));assertFalse(completed.has("source"));assertFalse(completed.has("verifier"));
        var current=new JSONObject(session.toString());current.remove("csrfToken");
        assertEquals("sealed-csrf",NativeAgencyHandoff.recovered(completed,connection,current).getString("csrfToken"));
        for(String changed:new String[]{"user","organization","origin","cookie"}) {
            var copy=new JSONObject(completed.toString());var response=new JSONObject(session.toString());
            if(changed.equals("origin"))copy.put("origin",TARGET);
            else if(changed.equals("cookie"))copy.put("session","different-session");
            else response.getJSONObject(changed).put("id","different-identity");
            assertThrows(IllegalStateException.class,()->NativeAgencyHandoff.recovered(copy,connection,response));
        }
        connection.clearPersonalSession();
        assertThrows(IllegalStateException.class,()->NativeAgencyHandoff.recovered(completed,connection,new JSONObject(session.toString())));
    }

    @Test public void interruptedConsumeOrRotationResumesOnlyWithADurableNewCookieWithoutReplay() throws Exception {
        var original=source();var pending=new JSONObject().put("phase","rotating").put("session",NativeAgencyHandoff.sessionIdentity(original));
        final JSONObject originalRotation=pending;
        assertThrows(IllegalStateException.class,()->NativeAgencyHandoff.resumeDestination(originalRotation,original));
        var saved=original.saved();var jar=saved.getJSONArray("cookies");for(int i=0;i<jar.length();i++)if(jar.getJSONObject(i).getString("name").equals("open_triage_session"))jar.getJSONObject(i).put("value","new-personal-cookie");
        var rotated=TrustedConnection.restore(saved);
        assertSame(rotated,NativeAgencyHandoff.resumeDestination(pending,rotated));
        var target=new TrustedConnection(TARGET,original.caPem);
        pending=new JSONObject().put("phase","consuming").put("target",target.saved());
        final JSONObject withoutCookie=pending;
        assertThrows(IllegalStateException.class,()->NativeAgencyHandoff.resumeDestination(withoutCookie,original));
        var targetSaved=target.saved();targetSaved.getJSONArray("cookies").put(new JSONObject().put("name","open_triage_session").put("value","valid-target-cookie").put("expires",System.currentTimeMillis()+60000));
        pending.put("target",targetSaved);
        assertEquals(TARGET,NativeAgencyHandoff.resumeDestination(pending,original).origin);
        pending.put("phase","issuing");final JSONObject noReplay=pending;
        assertThrows(IllegalStateException.class,()->NativeAgencyHandoff.resumeDestination(noReplay,original));
    }

}
