package org.opentriage.development;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.json.JSONArray;
import org.json.JSONObject;

/** Exact cross-language mirror of the server's immutable native enrollment receipt. */
final class NativeEnrollmentAttempt {
    private static boolean whitespace(char value) {
        return value=='\t'||value=='\n'||value=='\u000b'||value=='\f'||value=='\r'||value==' '||value=='\u00a0'||value=='\u1680'||
            value>='\u2000'&&value<='\u200a'||value=='\u2028'||value=='\u2029'||value=='\u202f'||value=='\u205f'||value=='\u3000'||value=='\ufeff';
    }
    static String normalizedName(String value) {
        int start=0,end=value.length();while(start<end&&whitespace(value.charAt(start)))start++;while(end>start&&whitespace(value.charAt(end-1)))end--;
        return value.substring(start,end);
    }
    /** JSON.stringify string encoding, including lone-surrogate escaping and unescaped slash. */
    static String quote(String value) {
        var out=new StringBuilder("\"");
        for(int index=0;index<value.length();index++) {
            char item=value.charAt(index);
            switch(item) {
                case '"':out.append("\\\"");break;case '\\':out.append("\\\\");break;
                case '\b':out.append("\\b");break;case '\f':out.append("\\f");break;case '\n':out.append("\\n");break;case '\r':out.append("\\r");break;case '\t':out.append("\\t");break;
                default:
                    if(item<32 || Character.isSurrogate(item) && !(Character.isHighSurrogate(item)&&index+1<value.length()&&Character.isLowSurrogate(value.charAt(index+1)))) {
                        out.append(String.format(java.util.Locale.ROOT,"\\u%04x",(int)item));
                    } else { out.append(item);if(Character.isHighSurrogate(item))out.append(value.charAt(++index)); }
            }
        }
        return out.append('"').toString();
    }
    static String binding(String origin,String token,String name,boolean reassign,String originalCredential) {
        return "["+quote("open-triage.native-enrollment.v1")+","+quote(origin)+","+quote(token)+","+quote(normalizedName(name))+","+reassign+","+quote(originalCredential)+"]";
    }
    static String credential(String attempt,String binding) throws Exception {
        byte[] secret=Base64.getUrlDecoder().decode(attempt);
        if(secret.length!=32||!Base64.getUrlEncoder().withoutPadding().encodeToString(secret).equals(attempt))throw new IllegalArgumentException("Invalid pending enrollment secret");
        var hmac=Mac.getInstance("HmacSHA256");hmac.init(new SecretKeySpec(secret,"HmacSHA256"));
        return Base64.getUrlEncoder().withoutPadding().encodeToString(hmac.doFinal(binding.getBytes(StandardCharsets.UTF_8)));
    }
    static TrustedConnection resultConnection(JSONObject pending,long now) throws Exception {
        JSONObject candidate=pending.getJSONObject("candidate"),body=pending.getJSONObject("body");
        JSONArray original=candidate.getJSONArray("cookies");
        if(original.length()!=1||!original.getJSONObject(0).getString("name").equals("open_triage_installation"))throw new IllegalArgumentException("Invalid pending enrollment authority");
        JSONObject cookie=original.getJSONObject(0);String previous=cookie.getString("value");
        if(!previous.matches("[A-Za-z0-9_-]{43}")||!body.getString("token").matches("[A-Za-z0-9_-]{43}")||!body.getBoolean("confirmInstallation"))throw new IllegalArgumentException("Invalid pending enrollment intent");
        long expiry=Math.min(cookie.getLong("expires"),Math.addExact(pending.getLong("createdAt"),365L*24*60*60*1000));
        if(expiry<=now)throw new IllegalStateException("Pending enrollment authority expired");
        String result=credential(body.getString("attempt"),binding(candidate.getString("origin"),body.getString("token"),body.getString("name"),body.optBoolean("reassign"),previous));
        return TrustedConnection.restore(new JSONObject().put("origin",candidate.getString("origin")).put("caPem",candidate.getString("caPem"))
            .put("cookies",new JSONArray().put(new JSONObject().put("name","open_triage_installation").put("value",result).put("expires",expiry))));
    }
    static JSONObject replaceTrust(JSONObject pending,String origin,String ca) throws Exception {
        JSONObject original=pending.getJSONObject("candidate");
        if(!origin.equals(original.getString("origin")))throw new IllegalArgumentException("Pending enrollment origin cannot change");
        new TrustedConnection(origin,ca); // New trust always requires valid public CA material.
        JSONObject updated=new JSONObject(pending.toString());updated.getJSONObject("candidate").put("caPem",ca);return updated;
    }
}
