package org.opentriage.development;

import static org.junit.Assert.*;
import org.junit.Test;
import org.json.JSONObject;

public class NativePdfContractTest {
    private static final String ID = "11111111-1111-4111-8111-111111111111", OTHER = "22222222-2222-4222-8222-222222222222";
    private JSONObject headers() throws Exception { return new JSONObject().put("x-organization-id",ID); }
    private String snapshot() { return "/api/review/reports/"+ID+"/snapshots/"+OTHER+"/pdf?amendmentSequence=0&language=en&dataset=synthetic&timeZone=America%2FNew_York"; }
    @Test public void onlyVersionedExistingPdfRoutesAreAccepted() throws Exception {
        NativePdfContract.request(snapshot(),headers());
        NativePdfContract.request("/api/reports/"+ID+"/cos/pdf?revision=1&language=sv",headers());
        NativePdfContract.request("/api/review/reports/"+ID+"/cos-deliveries/"+OTHER+"/pdf?amendmentSequence=3&language=sv&dataset=real",headers());
        for (String path : new String[]{"https://evil.example"+snapshot(),"//evil.example"+snapshot(),snapshot()+"#fragment",snapshot()+"&language=sv",snapshot()+"&redirect=https://evil.example",snapshot().replace("/snapshots/","/%73napshots/"),snapshot().replace("language=en","language=%0d%0aCookie"),snapshot().replace("amendmentSequence=0","amendmentSequence=-1"),snapshot().replace("&dataset=synthetic","")}) {
            assertThrows(Exception.class,()->NativePdfContract.request(path,headers()));
        }
        assertThrows(Exception.class,()->NativePdfContract.request(snapshot(),new JSONObject()));
        assertThrows(Exception.class,()->NativePdfContract.request(snapshot(),headers().put("authorization","Bearer arbitrary")));
        assertThrows(Exception.class,()->NativePdfContract.request(snapshot(),headers().put("cookie","personal")));
    }
    @Test public void binaryContractRejectsHtmlPartialDenialAndOversizedArtifacts() throws Exception {
        byte[] pdf="%PDF-1.4\nfixture".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        JSONObject type=new JSONObject().put("Content-Type","application/pdf");
        NativePdfContract.bytes(200,type,pdf);
        NativePdfContract.bytes(200,new JSONObject().put("content-type","application/pdf"),pdf);
        NativePdfContract.bytes(200,new JSONObject().put("cOnTeNt-TyPe","Application/PDF; charset=binary"),pdf);
        assertThrows(Exception.class,()->NativePdfContract.bytes(200,type.put("content-type","text/html"),pdf));
        type.remove("content-type");
        for(int status:new int[]{206,302,401,403,404,422,500})assertThrows(Exception.class,()->NativePdfContract.bytes(status,type,pdf));
        assertThrows(Exception.class,()->NativePdfContract.bytes(200,new JSONObject().put("Content-Type","text/html"),pdf));
        assertThrows(Exception.class,()->NativePdfContract.bytes(200,type,"<html>login</html>".getBytes()));
        assertThrows(Exception.class,()->NativePdfContract.bytes(200,type,new byte[NativePdfContract.MAX_BYTES+1]));
    }
    private JSONObject saved(long expiry) throws Exception { return new JSONObject().put("origin","https://agency.example").put("caPem","approved-public-ca").put("cookies",new org.json.JSONArray().put(new JSONObject().put("name","open_triage_session").put("value","private-cookie").put("expires",expiry))); }
    private JSONObject current() throws Exception { return new JSONObject().put("user",new JSONObject().put("id",OTHER)).put("organization",new JSONObject().put("id",ID)).put("expiresAt","2030-01-01T00:00:00Z"); }
    @Test public void realServerPrincipalAndOriginalCookieExpiryBindTheLeaseWithoutRenewal() throws Exception {
        long now=java.time.Instant.parse("2029-01-01T00:00:00Z").toEpochMilli();
        var authority=NativePdfContract.authority(current(),saved(now+1000),ID,now);
        assertEquals(now+1000,authority.expiresAt());assertEquals(OTHER,authority.user());assertEquals(ID,authority.organization());
        assertFalse(authority.cookie().contains("private-cookie"));
        assertNotEquals(authority.cookie(),NativePdfContract.cookie(saved(now+1000).put("origin","https://other.example")));
        assertThrows(Exception.class,()->NativePdfContract.authority(current(),saved(now),ID,now));
        assertThrows(Exception.class,()->NativePdfContract.authority(current(),saved(now+1000),OTHER,now));
        assertThrows(Exception.class,()->NativePdfContract.authority(current().put("expiresAt","2020-01-01T00:00:00Z"),saved(Long.MAX_VALUE),ID,now));
        assertThrows(Exception.class,()->NativePdfContract.authority(current(),saved(Long.MAX_VALUE).put("cookies",new org.json.JSONArray()),ID,now));
    }
    @Test public void trustedServerDateBoundsRemainingAuthorityDespiteClientClockSkew() throws Exception {
        long server=java.time.Instant.parse("2029-01-01T00:00:00Z").toEpochMilli();
        JSONObject date=new JSONObject().put("dAtE","Mon, 1 Jan 2029 00:00:00 GMT");
        for(long skew:new long[]{-86_400_000,86_400_000}) {
            var authority=NativePdfContract.authority(current(),saved(server+10_000),ID,server+skew,date);
            assertEquals(9001,authority.remainingMillis());
        }
        assertThrows(Exception.class,()->NativePdfContract.authority(current(),saved(server+999),ID,server,date));
        assertThrows(Exception.class,()->NativePdfContract.authority(current(),saved(server+10_000),ID,server,new JSONObject().put("Date","invalid")));
        assertThrows(Exception.class,()->NativePdfContract.authority(current(),saved(server+10_000),ID,server,date.put("Date","Mon, 1 Jan 2029 00:00:00 GMT")));
    }
}
