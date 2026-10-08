# Protected Offline Clinical Storage PRD

> **Implemented (2026-10-08).** The plaintext-storage problem below describes
> the pre-feature state. Current server-backed workflows persist encrypted
> clinical working copies and use online, report-scoped recovery after restart.
> See the [operating guarantees and exclusions](../protected-offline-clinical-storage.md)
> and [browser compatibility policy](../browser-state-compatibility.md).
> Device enrollment, inventory, vehicle pairing, and device revocation remain deferred.

## Problem Statement

OpenTriage currently persists complete encounter documents, queued clinical
changes, workflow state, and recovery payloads as plaintext browser storage.
User identifiers are used to filter those records in application code, but that
filter is not a confidentiality boundary. Another user of a shared browser
profile, a person inspecting browser storage, or code running with the same
origin can read retained clinical content. Logout and session expiry remove the
active session while deliberately retaining that plaintext work.

Field documentation must remain usable through connectivity loss without
silently losing unsynchronized work. At the same time, offline availability
must not turn browser storage into an indefinitely readable clinical archive.
The product needs a defined threat model, authenticated key release, bounded
retention, predictable purge behavior, and failure handling that never falls
back to plaintext.

## Solution

Replace plaintext clinical browser persistence with a protected, versioned
IndexedDB store. Each opened report receives an independent random encryption
key. The browser stores only authenticated ciphertext plus minimal opaque
metadata, while the server stores the report key wrapped by a dedicated,
versioned installation secret. Report keys are released only after current
online authentication, authorization, and a single-use report-scoped recovery
grant. Decrypted keys and clinical content remain in memory only for the active
browser session.

An online report open automatically prepares that report for interrupted
connectivity. A connection loss during the active page session does not stop
documentation. A full browser restart while offline does not unlock records:
the clinician reconnects, authenticates, loads server-authoritative report
summaries, and explicitly chooses a report to recover. Logout, expiry, role
changes, completion, purge, storage failure, and account lifecycle events each
have explicit behavior.

The first implementation is user-bound rather than device-bound. WebAuthn
registration, administrator-managed device inventory, and vehicle linking are
deferred to a later device-vehicle feature. The interim design therefore states
its residual risks rather than claiming protection against a compromised
browser, operating system, extension, or active unlocked session.

## User Stories

1. As a clinician, I want every report I open online prepared automatically for protected offline work, so that a later connectivity loss does not interrupt documentation.
2. As a clinician, I want an already unlocked report to remain editable when connectivity drops, so that field documentation does not require continuous service.
3. As a clinician, I want a browser restart to preserve encrypted unsynchronized work, so that termination does not destroy documentation.
4. As a clinician, I want recovery after restart to require connectivity, so that stored ciphertext is not its own authorization mechanism.
5. As a clinician, I want to unlock one report explicitly, so that reopening one record does not expose every cached record.
6. As a clinician, I want a new login to satisfy the restart authentication requirement, so that I do not authenticate twice unnecessarily.
7. As a clinician, I want recent password reauthentication to authorize restart recovery when my shift session remains active, so that shared-device access has a meaningful user check.
8. As an agency, I want restart reauthentication represented as an organization policy that defaults to required, so that a later Admin control can manage the tradeoff explicitly.
9. As a clinician, I want assigned-call and open-record headers loaded from the authenticated server, so that sensitive summaries are not duplicated in a plaintext local index.
10. As an offline user whose page remains active, I want already-rendered report summaries to remain available in memory, so that an ordinary connection loss does not blank the current workflow.
11. As a user restarting while offline, I want a generic reconnect message rather than cached call details, so that a locked browser reveals no clinical metadata.
12. As a clinician, I want unsynchronized work retained after logout or session expiry, so that ending a session does not silently destroy documentation.
13. As a clinician, I want synchronized browser copies removed when they are no longer needed, so that recovery retains no unnecessary clinical data.
14. As a clinician logging out with pending work, I want a clear warning and recovery deadline before confirming, so that I understand what will happen.
15. As a clinician, I want logout to complete even when work is pending, so that clinical persistence cannot trap me in an authenticated session.
16. As a different user of the same browser, I want no indication of a prior user's retained reports, so that record count, labels, and content remain private.
17. As the original user, I want to recover retained work only while I remain authorized for clinical documentation, so that stale browser data cannot bypass a role change.
18. As an agency, I want a bounded offline-recovery window stored as organization policy, so that retention is explicit and enforceable.
19. As an agency, I want the recovery window to default to 24 hours and accept only 1 through 168 hours, so that useful recovery remains bounded.
20. As an agency, I want a shorter future policy to reduce existing recovery deadlines immediately, so that a stricter retention decision takes effect.
21. As an agency, I want a longer future policy to apply only to new or newly written records, so that retained data is not silently extended.
22. As a clinician, I want a new authenticated edit to advance the recovery deadline, so that active work does not expire unexpectedly.
23. As a privacy officer, I want reading, restarting, or reauthenticating alone not to extend retention, so that passive access does not preserve data indefinitely.
24. As a security administrator, I want disabling, deleting, or removing a user from the organization to make their retained records unrecoverable, so that terminated access does not linger.
25. As a user receiving a password reset, I want locked work preserved until its normal deadline, so that credential recovery does not automatically destroy documentation.
26. As an administrator responding to loss or compromise, I want an explicit operation to purge a user's offline recovery data, so that containment can override normal retention.
27. As a clinical reviewer, I want queued changes preserved when a report is completed elsewhere, so that late field work reaches the existing post-completion audit pathway.
28. As a clinician, I want a completed report locked against further local editing, so that offline state cannot mutate an authoritative completed record.
29. As a data custodian, I want an authorized server purge to override recovery retention, so that deleted records cannot be resurrected by a delayed client.
30. As a data custodian, I want server-held report keys destroyed at expiry, so that closed browsers cannot defer cryptographic deletion indefinitely.
31. As a clinician, I want expired or purged ciphertext physically removed the next time the browser can run cleanup, so that unusable data does not accumulate.
32. As a clinician, I want each report protected by an independent key, so that recovery or purge of one report does not expose every cached report.
33. As a security administrator, I want report keys wrapped under a dedicated offline-recovery secret, so that encryption keys are separated from pseudonymization and authentication secrets.
34. As an operator, I want offline-recovery secret rotation to preserve live work safely, so that normal rotation does not strand ciphertext.
35. As an operator, I want old wrapping-secret versions retained until no live envelope references them, so that recovery remains possible during rotation.
36. As a user, I want tampered, swapped, or corrupted ciphertext rejected rather than partially loaded, so that integrity failures cannot become clinical state.
37. As a user, I want incompatible application data retained as its original authenticated ciphertext, so that a compatible future client may retry without creating an unprotected duplicate.
38. As a privacy officer, I want no plaintext fallback, export, or legacy recovery copy, so that error handling does not bypass the protection boundary.
39. As a user, I want the last valid encrypted version preserved when a new browser write fails, so that a quota or transaction error does not corrupt existing recovery state.
40. As an online clinician experiencing local persistence failure, I want server saves to continue with a prominent online-only warning, so that care can proceed safely.
41. As an offline clinician experiencing local persistence failure, I want further edits blocked while the current form remains readable, so that the interface does not accept work it cannot preserve.
42. As a clinician, I want only one browser tab to edit a report at a time, so that competing local writers cannot overwrite ciphertext.
43. As a clinician, I want a second tab to explain the lock and remain read-only, so that concurrency behavior is understandable.
44. As a clinician, I want expired and synchronized records removed before storage pressure affects pending work, so that unsynchronized ciphertext is never evicted silently.
45. As a clinician, I want denied persistent storage to fall back to explicitly labeled, encrypted best-effort IndexedDB, so that offline work remains possible without promising eviction resistance.
46. As an auditor, I want recovery grants, denials, locks, expiry, purge, and successful recovery recorded, so that sensitive key-release behavior is attributable.
47. As a privacy officer, I want audit records to exclude ciphertext, keys, patient fields, queued changes, browser contents, and credentials, so that auditing does not create another clinical store.
48. As an unauthorized caller, I want the same generic denial for missing, expired, purged, or inaccessible reports, so that key-release APIs do not reveal record existence.
49. As an administrator, I want no backdoor for unlocking another clinician's retained report, so that ordinary administration cannot bypass documenting-user ownership.
50. As a developer, I want the database-backed demo and local environment to exercise the production protection path, so that encryption is continuously tested.
51. As a static-demo user, I want the application to remain online-only and avoid clinical persistence when no trusted API exists, so that a browser-only build does not pretend to protect recoverable keys.
52. As a contributor, I want legacy clinical browser keys deleted during rollout, so that the new feature does not leave old plaintext behind.
53. As a contributor, I want browser-restart, multi-user, offline, expiry, purge, tamper, quota, and concurrency behavior tested through observable workflows, so that the security boundary remains enforceable.

## Implementation Decisions

### Modules

1. **Offline policy and key custody** owns organization policy defaults, report key envelopes, wrapping-secret versions, recovery deadlines, rotation, expiry, purge, and append-only security audit events. It exposes narrow report-key lifecycle operations rather than general access to key tables or secrets.
2. **Recovery authorization** owns current-session and capability checks, optional restart reauthentication policy, documenting-user ownership, single-use grants, generic denials, replay prevention, and report-key release. Its stable interface accepts an authenticated report recovery request and returns either one bounded key release or one non-disclosing denial.
3. **Protected browser store** owns versioned encrypted envelopes, IndexedDB transactions, cryptographic operations, local expiry, persistence capability, quota handling, corruption outcomes, monotonic local revisions, and exclusive per-report browser locks. Clinical components interact through report-oriented load/save/remove operations and never receive raw storage access.
4. **Clinical workflow integration** owns automatic protected caching, explicit report unlock, online authoritative headers, in-memory key lifetime, logout and expiry warnings, authorization locks, completion and late-work behavior, cleanup triggers, and recovery presentation. Existing clinical editing and synchronization contracts remain authoritative after decryption.

All four modules are required. Agency policy controls and device registration are later modules and are not hidden inside these interfaces.

### Threat model and security boundary

- Protect locked data against another OpenTriage user sharing the browser, casual developer-tools or browser-profile inspection, copied ciphertext without server authorization, and stale application sessions after expiry or detected revocation.
- Do not claim protection against a compromised operating system, malicious extension, memory inspection, an active same-origin script while a report is unlocked, or an attacker controlling both a valid session and the user's authentication factor.
- Device-bound protection is deferred. A later device-vehicle linking feature will define administrator approval, WebAuthn-backed device registration, revocation, and decommissioning.
- Immediate revocation cannot be guaranteed while disconnected. Access stops at the earlier of session expiry or the next successful server contact.
- A server-known ciphertext revision and hash checkpoint detects rollback below synchronized state. Rollback among revisions created offline and never checkpointed cannot be conclusively prevented without trusted device state and remains documented residual risk.

### Organization policy and schema

- Persist an organization recovery-window setting with a 24-hour default and a database constraint allowing integer values from 1 through 168 hours.
- Persist an organization restart-reauthentication setting defaulting to required.
- The initial delivery reads these stored defaults but provides no supported mutation API or Admin UI. A later Admin-controls feature adds recently reauthenticated, owner-authorized, audited mutation.
- A shorter policy reduces every live recovery deadline. A longer policy affects new or newly updated ciphertext only and never revives expired material.
- Store per-report key-envelope records behind narrowly privileged database operations. Runtime roles receive only the exact read/write operations required for grant, recovery, rotation, expiry, and purge workflows; they receive no schema-changing authority or broad table access.
- Store wrapped report data keys, wrapping-secret version, opaque recovery handle, owner, organization, report identity, ciphertext checkpoint facts, lifecycle state, and deadline. Do not store browser ciphertext in this key registry.

### Cryptography and key custody

- Generate one random AES-256-GCM data key per report through Web Crypto.
- Generate a fresh 96-bit random nonce for every encrypted write and never reuse a nonce with a report key.
- Authenticate the envelope schema, opaque recovery handle, and ciphertext revision as additional authenticated data.
- Keep report data keys and decrypted clinical content only in memory after release. Do not persist raw keys in browser storage, service-worker state, logs, application state snapshots, or analytics.
- Wrap report keys server-side under a dedicated, versioned offline-recovery secret supplied through the same installation environment-secret pattern as existing installation keys. Do not reuse patient-pseudonymization, session, credential, or CSRF secrets.
- Rotation rewraps every live report key under a newer version and verifies coverage before an old secret version may be retired. Backup and disaster-recovery procedures include every secret version referenced by a live envelope.
- Authentication-tag failure locks the record as corrupt. The client never returns partial plaintext and never falls back to an earlier unauthenticated representation.

### Recovery grants and authorization

- Creating or consuming a recovery grant requires an online authenticated session, current `clinical:document`, matching organization, documenting-user ownership, a live key envelope, and an eligible report state.
- After browser restart, a new login satisfies the authentication requirement. Otherwise, when organization policy requires it, password reauthentication must be no older than five minutes.
- A grant is bound to one user, organization, report, envelope version, and session. It is single-use, expires after 60 seconds, remains only in memory, and is consumed atomically.
- Key-release responses are non-cacheable. Failures use one generic external response while recording a bounded internal reason.
- Grant creation and consumption are rate-limited and replay-safe.
- Administrators cannot release another clinician's report key. Future crew handoff or emergency reassignment requires a separate clinical workflow.

### Browser storage and envelope format

- Use IndexedDB for protected clinical persistence. Do not store clinical documents, report summaries, queued changes, recovery bytes, or report keys in `localStorage`, session storage, Cache Storage, service-worker caches, or logs.
- Outside ciphertext retain only a random local record ID, opaque server recovery handle, envelope and algorithm versions, nonce and authentication-tag material, and recovery deadline.
- Do not expose user ID, organization ID, report ID, call number, patient data, workflow state, or queued-change details as local plaintext metadata.
- Require Web Crypto, IndexedDB, and Web Locks before enabling offline edits. If persistent storage is denied, use explicitly labeled best-effort encrypted IndexedDB; if the required primitives are unsupported, operate online-only and explain the limitation.
- Each write commits a complete replacement atomically while retaining the previous authenticated envelope until success.
- Use an exclusive per-report browser lock. A second tab remains read-only and may take over only after the writer releases the lock.
- Maintain monotonic ciphertext revisions and a hash chain for accidental corruption and local ordering. Server checkpoints provide the authoritative rollback floor after synchronization.
- Remove expired records first and server-confirmed synchronized records second under storage pressure. Never evict unsynchronized ciphertext to make space.
- On rollout, unconditionally delete all known legacy clinical `localStorage` and recovery keys. There is no migration because no production data exists.
- Preserve incompatible application payloads as their existing authenticated ciphertext rather than duplicating them under a global recovery key.

### Workflow and lifecycle behavior

- Opening a report online creates or resolves its report key and recovery handle and writes an initial protected envelope automatically. A previously unseen assignment cannot be opened offline.
- Assigned-call and open-record headers come from authenticated server responses. The active page may retain already rendered summaries in memory through connection loss.
- After restart and before online authentication, show only a generic reconnect state. Do not show locally derived labels, record count, timestamps, complaints, patient details, or validation state.
- After authentication, load the server-authoritative recoverable-report list and match it to opaque local handles. Release a report key only after the clinician explicitly opens that report.
- Losing connectivity while a report is already unlocked permits continued editing and protected local writes until session expiry or another lifecycle rule locks it.
- Explicit logout with pending work shows a warning, the applicable recovery deadline, and a confirmation. Logout is never blocked. It clears in-memory keys, decrypted state, and synchronized disposable caches while retaining eligible encrypted unsynchronized work.
- Session expiry performs the same key and UI clearing without confirmation.
- A different user sees no prior-user local state. The original user may recover it only after online authentication and current authorization.
- Role revocation detected on server contact immediately clears the in-memory key and locks editing. Locked ciphertext remains only until its existing deadline and becomes recoverable again only if authorization is restored before expiry.
- Password reset revokes sessions and grants but preserves locked report envelopes until their deadlines. An explicit administrator recovery purge destroys them.
- Account deactivation, deletion, or organization removal destroys every affected envelope immediately and overrides pending-work recovery.
- When the server reports completion or signing, stop further edits. Submit already queued changes through the existing late-work audit path when authorized; purge local ciphertext after acknowledgement or expiry.
- An authorized server purge destroys the wrapped report key immediately, instructs connected clients to clear memory and ciphertext, and overrides unsynchronized recovery.
- Set the deadline to the last successful encrypted write plus the organization recovery window, capped by any earlier server report expiry. Authenticated edits may advance it; reads, restarts, and reauthentication do not.
- At deadline, destroy the server key envelope. Physically remove browser ciphertext at the next application startup or reliable service-worker opportunity.

### Failure behavior

- If protected storage is unavailable while online, continue authoritative server saves in online-only mode and show a prominent persistence warning.
- If a protected write fails while offline, preserve the last valid ciphertext, stop accepting further edits, and keep the current form visible read-only until persistence succeeds or connectivity returns.
- Never offer a plaintext download, diagnostic dump, browser-storage fallback, or unauthenticated recovery path.
- Manual site-data clearing, profile deletion, or loss of a referenced wrapping-secret version can permanently destroy unsynchronized work. Operations and user-facing documentation state these limits plainly.

### Audit and operational controls

- Append audit events for grant request, issuance, denial, consumption, report-envelope registration, recovery, authorization lock, expiry, rotation, server purge, account purge, and administrative recovery purge.
- Audit actor, organization, report identity, policy version, outcome, time, and bounded reason. Never record ciphertext, raw or wrapped keys, clinical fields, queued changes, browser contents, passwords, tokens, or unnecessary network identifiers.
- The database-backed public demo and local development exercise the same encrypted storage and grant path. Local development may use an explicitly development-only offline-recovery secret.
- Static builds with no trusted API remain online-only and do not persist clinical reports.

## Testing Decisions

- Good tests verify externally observable security, recovery, lifecycle, and failure behavior rather than private component structure or particular cryptographic helper calls.
- Test all four modules: offline policy and key custody, recovery authorization, protected browser storage, and clinical workflow integration.
- Database tests cover organization-setting constraints, envelope ownership, narrowly scoped privileges, deadline shortening, expiry, wrapping-key version references, rotation coverage, purge precedence, and atomic grant consumption.
- API tests cover current capability and ownership, recent reauthentication policy, generic denial, missing and expired records, role revocation, account removal, password reset, rate limits, replay, non-cacheable responses, and audit redaction.
- Cryptographic storage tests cover round trips, unique nonces, authenticated metadata, swapped records, corrupted tags, incompatible payload preservation, monotonic revisions, failed atomic replacements, and unconditional legacy-key removal.
- Browser-storage tests cover persistent-storage denial, quota exhaustion, preservation of the last valid envelope, eviction ordering, exclusive per-report locks, read-only secondary tabs, and manual storage loss messaging.
- Workflow tests cover automatic cache preparation, first-open connectivity, active-session connection loss, explicit unlock, authoritative headers, no pre-authentication metadata, logout warning, session expiry, another user signing in, capability loss, restored capability, completion, late-work acknowledgement, server purge, and recovery deadlines.
- A persistent-profile browser journey creates synchronized and unsynchronized work, terminates the browser, verifies that an offline restart reveals no report metadata, reconnects, authenticates or reauthenticates according to policy, explicitly unlocks one report, and verifies that other reports remain locked.
- Multi-user browser journeys prove that a second user cannot enumerate, label, decrypt, or reopen prior-user records and that the original authorized user can recover eligible work.
- Lifecycle journeys cover a shorter organization policy, expiry while the browser is closed, password reset, administrative recovery purge, account deactivation, report completion, and server-authorized purge.
- Security tests inspect browser storage, service-worker caches, request caching, logs, audit payloads, and diagnostics to ensure that no clinical plaintext or key material escapes the approved boundary.
- Existing offline-report, browser-persistence, clinician-session, report-workspace, completion, session-administration, database integration, and deployment smoke tests provide prior art. Their former plaintext and offline-restart assumptions must be updated rather than duplicated.

## Out of Scope

- Offline unlock after a complete browser restart with no network connection.
- Opening a previously unseen assignment while offline.
- Device enrollment, hardware identity, vehicle pairing, administrator-approved device registration, WebAuthn device credentials, device inventory, remote device revocation, or guaranteed remote erase.
- Protection against compromised operating systems, malicious extensions, active same-origin code while a report is unlocked, memory inspection, or an attacker controlling both a live session and the user's authentication factor.
- Guaranteed detection of rollback among ciphertext revisions created offline and never checkpointed by the server.
- Administrator access to another clinician's report key, crew handoff, emergency reassignment, or break-glass clinical recovery.
- An agency settings mutation API or Admin UI for the stored recovery-window and restart-reauthentication policies.
- Legacy plaintext migration or preservation; rollout deletes it because no production data exists.
- Plaintext export, user-managed recovery keys, printable recovery material, or browser-storage diagnostic downloads.
- Persisting Admin, feedback, analytics, configuration-authoring, or other non-clinical application data in the protected clinical store.
- Native mobile applications, operating-system keystores, MDM integration, or background remote-wipe guarantees.

## Further Notes

- This PRD narrows and supersedes older statements that browser-process restart alone restores locally cached clinical state. Restart recovery now requires online authentication and an eligible server-held key envelope.
- Issue #418 remains the parent delivery item. Implementation should be divided into dependent slices for server policy/key custody, protected browser storage, clinical workflow integration, and complete security/browser validation.
- Agency Admin controls are a later slice. The schema fields and safe defaults are included now so that later controls do not require another policy-model redesign.
- Device-bound protection is intentionally saved for device-vehicle linking. That later design should revisit WebAuthn-backed registration, administrator approval, device/vehicle reassignment, revocation, decommissioning, and recovery-envelope scope.
- The CSP and browser-header work reduces script-injection exposure but does not make active same-origin compromise an in-scope protection claim.
- Physical ciphertext may remain in a closed browser profile after expiry until the browser runs cleanup. Destroying the server-held envelope at the deadline provides the enforceable cryptographic boundary.
