# Protected offline clinical storage

## Operator claim and boundary

In server-backed mobile and stationary workflows, OpenTriage persists clinical
working copies, queued changes, synchronization state, shell drafts, and
incompatible recovery payloads only inside one AES-256-GCM authenticated
ciphertext record in IndexedDB. A random per-report data key exists in browser
memory only while that report is unlocked. The server keeps that key only as an
authenticated envelope under the installation's dedicated offline-recovery
wrapping secret. The browser record exposes an opaque local identifier,
recovery handle, algorithm and schema versions, ciphertext revision, timestamps,
and recovery deadline. It does not expose a report ID, call number, user ID,
patient value, report label, queued command, or key material.

This claim applies to the server-backed product. The explicitly marked static
demonstration contains fictional build-time fixtures and is not a production
clinical-data deployment. It has no server recovery service and must never be
used for real clinical data.

The application deletes all known legacy clinical local-storage and raw-recovery
keys without migration at startup and identity changes. Session and presentation
preferences may remain in local storage because they contain no report or patient
content. The service worker caches only the static application root, manifest,
and fingerprinted framework assets; API responses, JSON, arbitrary same-origin
responses, reports, and recovery traffic are never cache candidates. Fetches use
`cache: no-store`; clinical and recovery API responses use `Cache-Control:
no-store, private`. Application logs, diagnostics, and audit events must contain
bounded outcome metadata only and never clinical values, report data keys,
wrapping secrets, grants, wrapped keys, request bodies, or ciphertext samples.

## Recovery and lifecycle guarantees

- Offline editing requires Web Crypto, IndexedDB, and Web Locks. When the browser
  denies persistent storage, encrypted IndexedDB remains available in an explicit
  best-effort mode with an eviction warning. Missing storage primitives keep the
  report online-only; a write failure while disconnected makes it read-only without
  evicting unsynchronized ciphertext.
- A page restart reveals no retained-report label. After the server identifies a
  report already authorized to the current user, recent password reauthentication
  is required before a single-use, 60-second, report/session/user/organization
  bound grant releases exactly that report's key. A grant cannot be replayed.
- An authorized second browser can use that grant to create its own encrypted
  offline copy when it has no local record. Its opaque local record ID gives it
  an independent ciphertext revision and rollback checkpoint. The first
  browser's encrypted copy and pending changes remain in that browser. Each
  browser must reach the server once to establish its recovery receipt before
  it can continue editing offline.
- Opening an assigned call also uses this recovery flow if another browser
  already registered its key, including password confirmation when required.
  Open-report lists render before background recovery. Completed-report checks
  run only when this browser retains locked, unsynchronized ciphertext, stop
  when its handles are recovered, and pause after a reauthentication requirement.
- A different user receives neither a list nor labels from the browser store and
  cannot request or consume the original user's grant. Concurrent tabs use an
  exclusive per-report lock. Tampering fails AES-GCM authentication. A server
  checkpoint rejects a synchronized revision rollback or a different ciphertext
  at the same revision.
- Logout warns about active unsynchronized work, settles writes, destroys all
  in-memory keys and plaintext, and retains only unexpired unsynchronized
  ciphertext. Session expiry does the same. Supabase session timeout and
  revocation are enforced when the session/JWT is next validated; while wholly
  offline, an already unlocked report remains readable no later than the local
  shift-session deadline.
- Removing `clinical:document` locks editing and the server envelope. Restoring
  authority before the original deadline can recover it; neither event extends
  that deadline. Password reset revokes sessions and grants but preserves an
  otherwise eligible envelope until its existing deadline. Account removal,
  organization removal, administrative recovery purge, report deletion, and a
  server-authorized purge destroy the server key envelope. Opaque browser bytes
  then remain unreadable and expire locally.
- Policy shortening never extends existing deadlines. Closed-browser expiry is
  enforced by the server cleanup job and by opaque-metadata cleanup on next app
  startup, reconnect, or visibility change. Completion purges fully synchronized
  browser state. If a report completes while offline work remains, the key is
  retained only long enough to submit that work through the late-work audit path,
  after which it is purged.
- Storage pressure may evict expired and then synchronized ciphertext, never
  unsynchronized ciphertext. Invalid, incompatible, or authentication-failing
  records are not decrypted or rewritten. Authorization and recovery denials are
  generic so they cannot be used to enumerate reports.

## Deployment and operations

Production startup must fail unless `OFFLINE_RECOVERY_SECRET_BASE64` is canonical
base64 for exactly 32 independently random bytes. `OFFLINE_RECOVERY_KEY_VERSION`
is a positive integer. Do not derive or reuse this secret for sessions, CSRF,
database access, patient pseudonymization, or application signing. Store the live
keyring in the approved secret manager and every still-referenced version in
separately protected offline escrow. Database backup alone cannot recover it.

Use the rotation inventory, staged old-plus-new keyring deployment, idempotent
rewrap command, retirement check, and backup-retention procedure in
[Database operations](runbooks/database-operations.md#offline-recovery-wrapping-secret-backup-and-rotation).
Defaults are configured by `offlineRecovery` in the installation settings: retain
only pending work, use the configured bounded recovery window, require recent
password reauthentication, and issue a one-time short-lived grant. Monitor
aggregate outcomes and cleanup lag without report labels or payloads. Alert on
cleanup failure, repeated generic denials, checkpoint conflicts, storage-failure
mode, and old wrapping-key versions. Run the database expiry function at least
once per minute (the API does this while healthy) and include it in platform job
monitoring.

For an incident, revoke sessions, invoke the administrative recovery purge for
the affected account or organization, verify envelope and outstanding-grant
counts reach zero, preserve metadata-only audit evidence, and rotate the wrapping
secret if exposure is possible. Never request browser database exports or clinical
plaintext for diagnosis. Local development uses the deterministic development
wrapping key only outside `NODE_ENV=production`; start API and web separately as
documented in the repository `AGENTS.md`, and use only fictional seeded accounts.

The deployable web artifact is a static shell. It may include the explicitly
fictional demo fixtures used by demo mode, but contains no production report key,
recovery grant, wrapping secret, or runtime clinical record. Production secrets
belong only in the API runtime Secret and must not use a `NEXT_PUBLIC_` variable.

## Accepted threat-model exclusions

The product does not claim protection against a compromised operating system,
malicious browser extension, active same-origin code compromise while a report is
unlocked, inspection of process memory while plaintext or a key is in use, or
rollback/loss of offline revisions that were never checkpointed by the server.
These are explicit residual risks, not recovery guarantees.

## Deferred device management

WebAuthn device registration, administrator-managed device inventory, vehicle
linking, device revocation, and device decommissioning are intentionally deferred
to later work. The current report-scoped browser lock and recovery envelope must
not be represented as any of those controls.
