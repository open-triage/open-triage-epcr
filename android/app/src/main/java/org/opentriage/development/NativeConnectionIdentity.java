package org.opentriage.development;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
/** Stable across CA renewal and pairing, distinct across approved server origins. */
final class NativeConnectionIdentity {
    static String storageScope(String origin) throws Exception {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(origin.getBytes(StandardCharsets.UTF_8)));
    }
}
