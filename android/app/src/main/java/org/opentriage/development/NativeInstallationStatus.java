package org.opentriage.development;

import org.json.JSONObject;

/** Only an explicit successful pairing assessment can withdraw the connection. */
final class NativeInstallationStatus {
    static boolean requiresPairing(int status, String body) throws Exception {
        return status == 200 && Boolean.FALSE.equals(new JSONObject(body).opt("enrolled"));
    }
}
