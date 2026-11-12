package org.opentriage.development;

/** Test-only historical fixture selection, never a runtime capability bypass. */
final class HistoricalUpgradePreparation {
    private static final String PROFILE="historical-a1-text-v1";
    static boolean enabled(String profile,String packageName,long versionCode,String phase,boolean upgrade) {
        if ("current".equals(profile)) return false;
        if (!PROFILE.equals(profile) || !"org.opentriage.android".equals(packageName)
                || versionCode!=1 || !"prepare".equals(phase) || !upgrade) {
            throw new IllegalArgumentException("Historical preparation requires the verified production A1 upgrade preparation");
        }
        return true;
    }
    private static String[] receipt(String value) {
        if(!value.matches("[A-Za-z0-9_-]+"))throw new IllegalArgumentException("Receipt must be shell-safe base64url");
        byte[] bytes=java.util.Base64.getUrlDecoder().decode(value);
        if(!java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes).equals(value))throw new IllegalArgumentException("Noncanonical receipt encoding");
        String json=new String(bytes,java.nio.charset.StandardCharsets.UTF_8);
        // Canonical JSON array of eight bounded ASCII strings; no permissive token splitting.
        if(!json.matches("\\[\"[a-z0-9-]+\"(?:,\"[a-z0-9]+\"){7}\\]"))throw new IllegalArgumentException("Invalid receipt JSON");
        String[] parts=json.substring(2,json.length()-2).split("\",\"",-1);
        if(parts.length!=8 || !PROFILE.equals(parts[0])
                || !"8a6b1dddabeccf1dde1231e0c1cc1ac50ec69fae13e374636f5fcf4e198a9cbb".equals(parts[1])
                || !"bbb55c5237d4900f450ebf9dca996370254c4704".equals(parts[2])
                || !"f53b493e91bc0511da5b3514ced154e8eed2420b4c5e6a3510ead3060ca2277c".equals(parts[3])
                || !"2103f9a5fd4b17b113666165b86d52fad495d4e07b1507b18ee66a487a552a3a".equals(parts[4])
                || !parts[5].matches("[1-9][0-9]{0,9}") || Long.parseLong(parts[5])<=1 || Long.parseLong(parts[5])>2100000000L
                || !parts[6].matches("[a-f0-9]{40}") || !parts[7].matches("[a-f0-9]{64}")) {
            throw new IllegalArgumentException("Historical receipt must bind the complete published A1 descriptor and exact replacement");
        }
        return parts;
    }
    static String prepareReceipt(String profile,String value,String packageName,long versionCode,String phase,boolean upgrade) {
        if (!enabled(profile,packageName,versionCode,phase,upgrade)) {
            if(!value.isEmpty()) throw new IllegalArgumentException("Current preparation cannot receive a historical receipt");
            return "";
        }
        receipt(value);return value;
    }
    static boolean recovered(String profile,String saved,String supplied,String packageName,long installed,String phase,boolean upgrade) {
        if("current".equals(profile)) {
            if(!saved.isEmpty()||!supplied.isEmpty())throw new IllegalArgumentException("Unexpected historical origin");
            return false;
        }
        String[] parts=receipt(supplied);
        if(!PROFILE.equals(profile)||!saved.equals(supplied)||!"org.opentriage.android".equals(packageName)
                || installed!=Long.parseLong(parts[5])||!upgrade||!("recover".equals(phase)||"post-upgrade-photo".equals(phase))) {
            throw new IllegalArgumentException("Historical recovery requires the exact retained A1 receipt and installed replacement");
        }
        return true;
    }
}
