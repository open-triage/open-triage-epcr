package org.opentriage.development;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.cert.CertificateFactory;
import java.util.Base64;
import java.util.Set;
import java.util.TreeSet;
import org.json.JSONObject;

/** Pure policy evaluation shared by Android restrictions and JVM contract checks. */
final class ManagedConnectionPolicy {
    static final String VERSION = "configurationVersion", ORIGIN = "serverOrigin", CA = "publicCaPem";
    static final Set<String> KEYS = Set.of(VERSION, ORIGIN, CA);
    record State(boolean managed, String status, String origin, String caPem, String context) {
        boolean blocked() { return !status.equals("valid") && !status.equals("unmanaged"); }
        boolean matches(TrustedConnection connection) throws Exception {
            return connection != null && context.equals(ManagedConnectionPolicy.context(connection.origin, connection.caPem));
        }
        State forConnection(TrustedConnection connection) throws Exception {
            return !blocked() && managed && connection != null && !matches(connection)
                ? new State(true, "changed", origin, caPem, context) : this;
        }
    }
    static State evaluate(JSONObject values, boolean seen, boolean pending) throws Exception {
        boolean present = KEYS.stream().anyMatch(values::has);
        if (pending) return new State(true, "pending", null, null, null);
        if (!present) return new State(seen, seen ? "missing" : "unmanaged", null, null, null);
        try {
            if (!(values.opt(VERSION) instanceof Integer) || values.getInt(VERSION) != 1 ||
                !(values.opt(ORIGIN) instanceof String) || !(values.opt(CA) instanceof String)) throw new IllegalArgumentException();
            String origin = values.getString(ORIGIN), ca = values.getString(CA);
            new TrustedConnection(origin, ca); // Same origin/CA validation as every native request.
            return new State(true, "valid", origin, ca, context(origin, ca));
        } catch (Exception invalid) { return new State(true, "invalid", null, null, null); }
    }
    static String context(String origin, String ca) throws Exception {
        var certificates = new TreeSet<String>();
        if (!ca.isEmpty()) for (var certificate : CertificateFactory.getInstance("X.509")
                .generateCertificates(new ByteArrayInputStream(ca.getBytes(StandardCharsets.US_ASCII)))) {
            certificates.add(Base64.getEncoder().encodeToString(certificate.getEncoded()));
        }
        return Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256")
            .digest((origin + "\n" + String.join("\n", certificates)).getBytes(StandardCharsets.UTF_8)));
    }
}
