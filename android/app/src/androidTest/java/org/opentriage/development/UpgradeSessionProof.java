package org.opentriage.development;

/** Test-only CSRF metadata from the real existing login, bound to native authority. */
final class UpgradeSessionProof {
    static String cookieHash(String cookie,int uid,String origin) throws Exception {
        if(cookie==null||cookie.isEmpty()||origin==null||origin.isEmpty())throw new IllegalArgumentException("Missing native login identity");
        byte[] bytes=java.security.MessageDigest.getInstance("SHA-256").digest((uid+"\n"+origin+"\n"+cookie).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder result=new StringBuilder();for(byte value:bytes)result.append(String.format(java.util.Locale.ROOT,"%02x",value&255));return result.toString();
    }
    static String csrf(String current,String saved,String user,String savedUser,String organization,String savedOrganization,String cookieHash,String savedCookieHash,int uid,int savedUid) {
        if(user==null||user.isEmpty()||!user.equals(savedUser)||organization==null||organization.isEmpty()||!organization.equals(savedOrganization)
                ||cookieHash==null||!cookieHash.matches("[a-f0-9]{64}")||!cookieHash.equals(savedCookieHash)||uid!=savedUid) {
            throw new IllegalArgumentException("Login snapshot must match the current principal, organization, native cookie and UID");
        }
        String value=current==null||current.isEmpty()?saved:current;
        if(value==null||!value.matches("[A-Za-z0-9_-]{43}"))throw new IllegalArgumentException("Existing login must supply its valid CSRF metadata");
        return value;
    }
}
