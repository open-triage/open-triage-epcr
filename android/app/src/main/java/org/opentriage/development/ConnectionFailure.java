package org.opentriage.development;

/** Public failure categories only; certificate/credential details never cross the bridge. */
final class ConnectionFailure {
    static String code(Throwable failure) {
        for (int depth = 0; failure != null && depth < 16; depth++, failure = failure.getCause()) {
            if (failure instanceof javax.net.ssl.SSLException || failure instanceof java.security.cert.CertificateException) return "TLS_FAILED";
        }
        return "CONNECTION_FAILED";
    }
}
