# Android authentication

Android uses the installation's existing local or configured OIDC sign-in.
The current valid login authorizes permitted actions and protected-work recovery,
including reopening old calls and login evidence older than five minutes. There
are no repeated password, OIDC, shift or new-job identity-confirmation prompts.
Initial sign-in, explicit logout/user switching, session expiry/revocation,
current capabilities, report ownership and recovery deadlines still apply.
Installation-owner recovery retains the existing local policy.

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
