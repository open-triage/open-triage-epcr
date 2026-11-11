# Android TLS provisioning and CA rotation

Use the same generic APK for every installation. TLS terminates at the existing
ingress; Helm references an existing `kubernetes.io/tls` Secret. Only public CA
certificates go into Admin pairing files or Android managed configuration. Never
put the server private key, CA signing key or credentials into Helm values, Admin,
QR codes, APKs, shell variables containing PEM, command output or support bundles.

## Validate and install IT-provided material

Obtain the server private key, leaf-first full chain and approved public CA bundle
through the installation's secret manager. Use a protected working directory,
`umask 077`, and mode 600 for the private key. Do not enable shell tracing. Install
Node 22.12+, OpenSSL 3 and the supported `kubectl`; select the workload context and
namespace from the [production runbook](kubernetes-production.md). Do not overwrite
a Secret managed by a certificate controller; use that controller's renewal path.

For a manually maintained internal-PKI Secret:

```sh
umask 077
chmod 600 "$OT_PRIVATE/tls.key"
npm run provision:tls -- \
  --cert "$OT_PRIVATE/fullchain.pem" --key "$OT_PRIVATE/tls.key" \
  --hosts epcr.your-agency.org,api.epcr.your-agency.org \
  --ca "$OT_PRIVATE/approved-public-ca.pem" \
  --pairing-ca-out "$OT_PRIVATE/validated-public-ca.pem"
```

This validates every supplied certificate's dates, the leaf's SANs for **all**
ingress hosts, the key/certificate match, and the server-authentication chain to
the supplied roots. It writes only the validated public CA bundle and prints
public fingerprint/expiry metadata. It changes no cluster resources and refuses
to overwrite an exported bundle. For public PKI, replace `--ca <file>` with
`--system-ca`; the exported pairing file is intentionally empty, selecting the
Android platform trust store. Full chains must include required intermediates.

Apply the same inputs to the existing TLS Secret, omitting the already-created
`--pairing-ca-out` option:

```sh
npm run provision:tls -- \
  --cert "$OT_PRIVATE/fullchain.pem" --key "$OT_PRIVATE/tls.key" \
  --hosts epcr.your-agency.org,api.epcr.your-agency.org \
  --ca "$OT_PRIVATE/approved-public-ca.pem" \
  --context "$OT_CONTEXT" --namespace "$OT_NAMESPACE" \
  --secret open-triage-tls --apply
```

The helper sends the exact validated bytes in a Secret over `kubectl` stdin. It
does not print the Secret or pass private PEM in process arguments. Server-side
apply uses the `open-triage-tls` field manager and fails on ownership conflicts;
resolve those with the platform operator rather than forcing ownership.
`ingress.tls[].secretName` in installation values must reference this Secret.
RBAC must permit applying it. Normal Kubernetes Secret encryption-at-rest, RBAC,
backup and secret-manager retention remain the platform operator's responsibility.

Wait for ingress certificate reload, then verify the real API endpoint:

```sh
npm run provision:tls -- \
  --cert "$OT_PRIVATE/fullchain.pem" --key "$OT_PRIVATE/tls.key" \
  --hosts epcr.your-agency.org,api.epcr.your-agency.org \
  --ca "$OT_PRIVATE/approved-public-ca.pem" \
  --check-url https://api.epcr.your-agency.org/api/health
```

The check uses ordinary HTTPS hostname/chain validation, accepts no redirects,
requires the API health response and the exact validated leaf fingerprint. Check
each ingress address during a multi-node rollout; one successful request is not
proof that every replica has reloaded. A failed post-apply check leaves the applied
Secret in place; diagnose rollout/DNS/chain readiness or deliberately reapply the
previous still-valid material. The helper never disables verification or silently
rolls back trust. Run the ordinary deployment preflight and verify browser access.

In Admin's existing vehicle pairing flow, paste the **contents** of the validated
public CA bundle into Public CA certificates, then issue a new Android pairing
file/QR. Check the displayed server and unit before confirming. A private key or
server leaf certificate is not a public CA bundle.

## Ordinary leaf renewal

Renew the server leaf/full chain under the same trusted CA, validate and apply it,
then verify API health and a real APK connection. No APK rebuild, re-pairing,
managed-policy edit, cookie rotation or pending-work reset is needed. The app
trusts the approved CA and hostname rather than a particular server leaf. Keep
renewal inside CA and leaf validity windows; replacing an expired leaf with a
valid one under a still-valid CA restores connectivity.

## Deliberate CA replacement

An API response, redirect, TLS error or failed connection can never introduce a
new CA. Obtain replacement trust through the approved operator/MDM channel, not
by accepting a certificate from the failing connection. Do not clear app data,
uninstall the APK, delete encrypted records, move the device clock or extend
recovery deadlines to recover connectivity.

Where both CAs remain valid, use this overlap sequence:

1. Validate the new server key/full chain against the replacement CA. Prepare a
   public bundle containing old and new CAs, within the 48,000-character/16-CA
   native limits; do not include private keys or expired roots.
2. Deliver the exact overlap bundle via a newly confirmed pairing. For managed
   devices, first deliver the same origin and bundle in the complete version-1
   managed configuration, then explicitly enter replacement and import its
   matching pairing artifact. A changed policy locks the old connection; it does
   not silently expand trust. Pending/missing/invalid policy remains blocked.
3. Confirm sign-in, eligible pending-work recovery and synchronization through
   the installation's normal authorization. Apply the new server chain and check
   real API/APK traffic. A successful new session alone does not extend a recovery
   deadline; only the existing acknowledged-write rules may advance it.
4. After the fleet has moved and old server certificates are no longer needed,
   deliver the new-only bundle through the same explicit replacement path. Keep
   historical registration/audit records. Verify representative devices before
   retiring the old root or its secret-manager backup.

If the old leaf/CA is already expired or inaccessible, IT must make the new chain
reachable and obtain a fresh pairing artifact through an independently trusted
Admin connection. Deliver approved managed settings when applicable, enter the
app's explicit connection replacement, and confirm the new pairing. Restoring an
expired saved CA preserves the old connection metadata and ciphertext for this
flow, but **every** request using that trust is rejected, including a process
which stayed alive across expiry. New imports also reject expired CAs. Failed,
cancelled or interrupted changes preserve old encrypted work; they never label
old credentials as a successfully confirmed new installation. Recovery still
requires its original authorized clinician/server context and unexpired limits.

No manual artifact can override managed origin/trust. Bundle ordering and PEM
whitespace do not change managed certificate identity; adding/removing a CA does.
An approved origin change isolates old cookies, requests and local records from
the new server. See [managed configuration](android-managed-configuration.md)
and [protected-work recovery](android-development.md).

## Application trust and external identity

The supplied CA is scoped to the app's native connection and approved API origin.
It does not install a device CA, confer trust on arbitrary hosts, change browser
trust, or make an external OIDC provider trustworthy. Empty CA settings select
Android platform trust, subject to the platform's supported trust policy. An MDM
may independently install an approved device/browser CA where its product and
Android policy support that operation; verify that separately with IT. OIDC uses
the system browser, so both the provider's browser-facing endpoint and server-side
discovery/token/JWKS endpoints need their own approved trust. Do not enable
permissive hostname verifiers, cleartext, trust-all managers or TLS-error bypasses.

## Early verification and rollout evidence

`node --test tests/android-tls-provisioning.test.mjs` is included in workflow tests
and `npm run check:ci`. It uses runtime-generated synthetic keys and real local
HTTPS to verify key/chain/SAN/purpose/expiry rejection, renewal, explicit overlap,
untrusted replacement, secret-safe installation and operator file permissions.
Native JVM checks cover CA expiry during a process lifetime and after restart.
Run `npm run android:build` and the full `npm run android:test -- --skip-build`
with the documented isolated emulator prerequisites before publishing changes.
Record the same-APK renewal, manual/managed replacement, failed/interrupted change
and retained-work results. Emulator evidence does not replace the real Intune,
Headwind/MDMesh or physical phone/tablet checkpoints.

Chain verification follows [OpenSSL verification options](https://docs.openssl.org/3.0/man1/openssl-verification-options/)
and Node's [standard TLS server identity checks](https://nodejs.org/api/tls.html#tlscheckserveridentityhostname-cert).
