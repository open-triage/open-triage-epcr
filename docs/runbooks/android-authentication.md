# Android authentication

Android uses the installation's existing local or configured OIDC sign-in.
The current valid login authorizes permitted actions and protected-work recovery,
including reopening old calls and login evidence older than five minutes. There
are no repeated password, OIDC, shift or new-job identity-confirmation prompts.
Initial sign-in, explicit logout/user switching, session expiry/revocation,
current capabilities, report ownership and recovery deadlines still apply.
Installation-owner recovery retains the existing local policy.

## Continuing a valid login after process loss

WebView localStorage is public session metadata, not a durable authentication
commit. Before reporting a successful local login or password replacement, the
native connection saves the cookie and minimal continuation material in the
same Keystore-encrypted connection envelope. OIDC completion and agency handoff
completion preserve this boundary before acknowledging their native journals.
The continuation contains the CSRF value and exact principal, agency, personal
cookie hash, approved origin/CA hash and installation-cookie binding. It contains
no cached roles, expiry extension, clinical keys or report payloads.

If public metadata disappears at a cold start, the native connection first
requires a compatible, unblocked current policy and a settled connection. It
then validates the saved CSRF through a fresh protected server current-session
request. Only that response supplies the current capabilities, expiry and
personal authentication timestamp, and its principal and agency must still match
the sealed binding. Matching management-policy adoption or restoration can
continue the valid login. Pending enrollment, agency handoff, OIDC completion,
replacement, stale connection contexts and conflicting policy cannot use this
generic path. Explicit logout/new primary login clears the continuation before
the request; cookie, trust or installation changes invalidate its binding.

The actual agency acceptance deliberately deletes only public session/candidate
metadata after a successful ordinary native login and before a cold restart,
including before matching managed-policy adoption. The old protected ciphertext
and recovery deadline remain under their original boundaries. Run the early
`node --test tests/android-*.test.mjs`, native JVM tests and the complete emulator
journey to cover this persistence boundary; a successful warm WebView login alone
does not prove restart continuity.

The generic read is `POST /api/sessions/current/continuation`, with the ordinary
CSRF guard and the same limited-account metadata eligibility as `GET current`.
The agency-handoff current endpoint retains its existing eligibility. Servers
advertise `personal-session-continuation-v1`; new APK descriptors require it.
Native checks the shared protocol/capability contract at initial pairing and
before authentication or continuation, and checks a cross-host target before
source-session revocation. An unsupported server shows localized upgrade
guidance. Older immutable APK descriptors retain their original requirements.
Native OIDC finish includes fresh public session metadata with first delivery
and exact-cookie retry, so the cookie and continuation commit together before
the separate pending-return journal is cleared.

## External browser and native return

OIDC follows the external-user-agent model in
[RFC 8252](https://www.rfc-editor.org/rfc/rfc8252). Provider pages open in the system
browser and never inside a WebView with the Capacitor bridge. The existing
server confidential client performs the authorization-code exchange, PKCE S256,
nonce/state, signed issuer/audience/expiry and configured initial-login method
validation. The registered provider redirect remains the installation's HTTPS
`/api/sessions/oidc/callback`; no separate provider client secret enters the APK.

The APK starts through its existing approved native API connection. The server
binds a five-minute transaction to that origin, agency, live installation,
provider revision and login purpose. It supplies a one-use browser bootstrap
ticket and a separate random native redemption secret. Only the bootstrap ticket
appears in the browser URL. The redemption secret stays in Android Keystore
AES-GCM protected, backup-excluded native storage with a distinct authenticated
envelope label. It is never returned by a JavaScript plugin method, saved in
web setup/localStorage, placed in an Intent or included in the browser callback.

The bootstrap installs the ordinary short-lived HttpOnly correlation cookie
before opening the provider. Callback consumption is atomic even on failure.
A native callback stores the completed application session encrypted with the
agency key, then returns a credential-free URI:

- Development APK: `org.opentriage.development.auth://return/oidc`.
- Production APK: `org.opentriage.android.auth://return/oidc`.

These are the only server-accepted return schemes. The APK derives its scheme
from its actual application ID. The URI merely brings the intended APK forward;
its data never supplies authentication authority. A forged return, another app
claiming the scheme or a browser replay cannot redeem the pending native secret.
On foreground/restart, native polling redeems against the approved origin with
the same live installation. Delivery rechecks expiry, provider policy, current
user/session authority and atomically consumes the native return. If process loss interrupts pending-slot cleanup after durable cookie delivery,
the native return verifies that its current cookie matches the exact already-issued
OIDC session in that transaction, then reuses it without issuing credentials. The session
cookie enters only the existing native cookie vault. The shared UI obtains its
ordinary public session and CSRF material through `/api/sessions/current`.

A browser cancellation leaves login available; a new login replaces the pending
native return. Local login/logout removes it. Network loss retains the encrypted
return until its original expiry, allowing restart after process termination.
The pending return is also bound to the exact approved origin, CA identity and
stable live installation credential. Personal login changes and process restart
preserve that binding; replacement pairing or installation expiry invalidates it.
An unconfirmed replacement preview pauses authentication traffic without discarding
the original login or pending return, so cancellation can resume the original
context. Confirmed pending enrollment blocks authentication until its durable
journal resolves. Delayed authentication outcomes cannot navigate a newer
connection context.
Managed policy checks apply before and after every native request and before
browser launch; changed/blocked policy cannot revive an old connection. Losing
native return storage requires a new login, not a provider/session-cookie import.
Shared writer settlement removes outgoing plaintext/keys before login or switch;
eligible encrypted work retains its owner and deadline.

## Certificate and deployment prerequisites

App-provisioned CA roots configure only OpenTriage's native HTTPS transport.
They do **not** configure Chrome, another browser or a regional identity app.
The system browser must independently trust the installation HTTPS callback and
provider HTTPS endpoint, using a platform-trusted chain or an IT-installed CA
supported by that browser/device policy. Provider-side token/JWKS HTTPS trust and
explicit private-provider origin approval must also be configured on the API.
Never bypass a TLS warning, disable verification or assume app pairing installed
a browser certificate. IT must supply a supported external browser and the
provider's ordinary interactive login/approved method configuration.

Future APK descriptors require `native-oidc-return-v1` alongside the merged
`native-enrollment-attempt-v1`. The API health contract advertises these
implemented capabilities; compatible earlier immutable APK descriptors keep
their original requirements.

## Validation

Run `npm run check:ci` and `npm run android:test`. The default Android harness
runs ordinary pairing, protected-work recovery and standard managed settings,
then reuses API port 9443 and provider port 9444 for actual OIDC acceptance. Its
separate test-only DPC temporarily installs the synthetic public CA into device
browser trust and removes it afterward; the clinical APK is never device owner.
The signed TLS provider exposes an emulator-reachable authorization URL and
explicitly approved host-interface issuer/token/JWKS URLs with matching SANs.
There is no production network/TLS exception or mocked session issuer.

The native journey checks unknown identity then ordinary approval, approved login,
logout/another provider user, provider outage/cancellation, credential isolation, recovery with current login
evidence older than five minutes and unchanged deadline, and a real host-issued
force-stop while the browser transaction is pending followed by native return.
The service/browser suite additionally rejects wrong/missing installations,
wrong redemption/correlation/origin, replay, cancellation, expired/revoked
sessions, changed provider policy and withdrawn recovery authority.
`npm run android:test -- --skip-build --oidc-only` runs the same real OIDC and
clinical-work journey with fresh fixtures for focused iteration. Default
acceptance reopens the exact report previously created by the protected-work
journey and uses its actual revision baseline; focused acceptance opens the
fresh assigned call. Both require an actual API-acknowledged online marker
before producing offline unacknowledged ciphertext. The default
command retains all preceding acceptance journeys. `--skip-oidc` is only for focused `--external-apis` diagnostics; default/CI
acceptance includes OIDC. Synthetic emulator acceptance does not establish real
regional provider or physical-device acceptance: record those in ticket 019.

## Agency handoff

The APK keeps the bundled `https://localhost` workspace when switching agencies.
Agency-less installation superusers retain the existing cross-host eligibility;
agency-bound local and OIDC accounts use their ordinary accessible-agency policy.
No current valid login needs another personal-authentication prompt.

A native cross-host handoff first asks the currently approved API for the
registered destination. It creates a fresh target connection with an empty
cookie jar and the already approved public CA roots. Strict TLS hostname and CA
verification remain enabled. A target requiring different trust, an unexpected
host/redirect, or managed-origin conflict fails before source issuance, leaving
the original login usable. The APK never accepts a CA from a return URL and
never copies source personal or installation cookies to the target.

After a target challenge succeeds, the shared transition barrier settles local
writers and removes readable keys. Only then does native code issue and consume
the one-use handoff. Verifiers, challenge cookies, source cookies and intermediate
state stay in the Keystore-encrypted vault. The returned public session has new
cookie/CSRF authority, the original start/proof/maximum expiry, and no old unit
binding. Same-origin browser and APK switching use that same authority rotation.
The original reports retain their author, agency, unit and recovery deadlines.

Uncertain issue/consume responses are recorded before dispatch and are never
replayed automatically. On restart the workspace stays locked and offers
**Return to original installation**. This clears the interrupted private intent
while preserving the original cookie and installation. Cancellation verifies
that cookie with the server and restores only the matching sealed source session
metadata; a still-valid login resumes without another sign-in. Only actual source
revocation or expiry requires ordinary initial login. Eligible encrypted work
remains unchanged. A successfully transferred session does not
acquire the old unit's pairing. Pair the target explicitly if unit work is needed.

Pending encrypted work does not prohibit an agency switch once its editor is
closed. It remains in its original native-origin/agency scope, without retagging,
deleting or extending recovery. Returning to that scope and original authorized
identity is required for ordinary recovery. An active/opening report still blocks
switching until it has been closed through the shared workflow.

Native switch and consume commands preselect a random replacement CSRF value in
the encrypted journal. If response headers install a new personal cookie before
the body is interrupted, that jar is retained without replaying the one-use
consume. A read-only `POST /api/sessions/agency-handoff/current` keeps the normal
cookie CSRF guard and current server authorization; it verifies the sealed value
before returning current public session metadata. Missing/incorrect CSRF never
turns this into a login or recovery bypass.

Completed target promotion and cancellation back to a still-valid source keep a
sealed completion journal. JavaScript stores the validated public metadata inside
the typed `handoff` cross-tab barrier, waits for its matching marker to clear, and
only then acknowledges native completion. A restart before acknowledgement
exposes **Finish agency switch**, keeps clinical work locked, and validates the
private cookie before restoring metadata. Original author, unit, agency and
recovery deadline remain attached to retained encrypted reports.
## Interrupted native transitions

If Android stops after a confirmed operation settles natively but before its UI
finishes, reopening the app reconciles the abandoned transition under the same
exclusive clinical-storage barrier. It preserves ciphertext and its original
deadlines. A pending native enrollment or blocked managed policy remains locked.
An interrupted logout cannot restore the previous personal session. An enrollment
that never crossed native confirmation can retain a valid login only after fresh
server verification of the same user and agency; cached public metadata supplies
no authentication authority. Ambiguous older transition markers require ordinary
primary login. Do not clear app storage to bypass these checks.
