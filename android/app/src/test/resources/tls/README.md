These are fictional, isolated TLS regression fixtures. `server.p12` contains a
localhost-only test certificate and test key under the public password
`synthetic-only`, signed by `ca.pem`. They authorize no deployment. Native test
resources are excluded from the application APK. Replace both together before
their ten-year validity expires; the tests retain normal validity and hostname
checks.
