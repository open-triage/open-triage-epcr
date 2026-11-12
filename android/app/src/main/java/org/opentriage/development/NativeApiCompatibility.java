package org.opentriage.development;

import org.json.JSONObject;

/** Kept in agreement with the shared descriptor contract by early host checks. */
final class NativeApiCompatibility {
    static final String[] REQUIRED = {"native-enrollment-attempt-v1", "native-enrollment-outcome-v1", "native-oidc-return-v1", "audio-webm-live-v1", "android-upgrade-policy-v1", "native-agency-handoff-v1", "android-upgrade-gate-v1", "personal-session-continuation-v1"};
    static final class Incompatible extends IllegalStateException {}
    static void require(JSONObject health) {
        Object protocol = health.opt("androidApiProtocol");
        if (!(protocol instanceof Number) || ((Number)protocol).doubleValue() != 1) throw new Incompatible();
        var capabilities = health.optJSONArray("androidApiCapabilities");
        if (capabilities == null) throw new Incompatible();
        var supported = new java.util.HashSet<String>();
        for (int i = 0; i < capabilities.length(); i++) {
            Object value = capabilities.opt(i);
            if (!(value instanceof String)) throw new Incompatible();
            supported.add((String)value);
        }
        for (String required : REQUIRED) if (!supported.contains(required)) throw new Incompatible();
    }
}
