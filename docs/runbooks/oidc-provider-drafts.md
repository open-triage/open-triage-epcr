# OIDC provider drafts

Authentication now stores versioned OIDC drafts at agency-group scope. Children
inherit their group's configuration. Saving an incomplete draft or a failed
discovery check preserves the active configuration. Failed checks retain the last
successful read-only metadata and mark its health failed; a new draft starts
without discovery metadata. Real test login validates identity and records
pending review requests, while production SSO activation remains a later slice.
Discovery success is connectivity evidence, not regional acceptance.

The maintained protocol library is [openid-client v6](https://github.com/panva/openid-client),
pinned in the API package/lockfile. Use its server-side authorization-code flow,
`ClientSecretPost` (`client_secret_post`), nonce and state validation, ID-token
validation and S256 PKCE for code exchange. Discovery rejects a provider
that does not advertise this client authentication mechanism. Regional IT must
confirm that the AD FS v6 registration supports it and S256. Do not guess the
issuer, client identifier, credentials, claims or host registrations. If another
mechanism is required, implement and test it before activation. Microsoft documents
[AD FS code flow and PKCE](https://learn.microsoft.com/en-us/windows-server/identity/ad-fs/overview/ad-fs-openid-connect-oauth-flows-scenarios).

Registration details show exact HTTPS URLs for active registered group agency
hosts: `/api/sessions/oidc/callback` and `/api/sessions/oidc/logout-callback`.
The callback handles real draft test login; the logout callback remains reserved
for later protocol handling. Draft configuration does not enable provider logout.
Logout
registration is informational and does not enable regional global logout.
Required ID-token claims are `iss`, `sub`, `aud`, `exp`, `iat`, `nonce`; supported
profile mappings are display name and optional email. Profile claims never grant
roles and email must not link application identities automatically.

For the callback, keep the existing application cookie/CSRF/origin
checks. Use a separate short-lived random HttpOnly Secure SameSite=Lax callback
correlation cookie scoped to `/api/sessions/oidc/callback`, never relax the
application session cookie. Store the transaction server-side, binding its hash,
state, nonce, PKCE verifier, group, registered origin, purpose, draft revision and
allowlisted return destination, with one-time atomic consumption. Only that narrow
GET callback may omit the usual request-origin gate, and must validate all the
bindings before minting an application session. A silent callback or `prompt=login`
alone is not fresh-personal-authentication evidence.

## Installation credential protection

Inject `OIDC_CREDENTIAL_KEYS_JSON` into the API from the installation secret
manager: an object mapping key versions to independently generated base64 32-byte
keys. `OIDC_CREDENTIAL_KEY_VERSION` selects the current version (default `1`).
`prepare:kubernetes` generates the initial dedicated key in the private API bundle;
the Helm API deployment reads these values from its API Secret. The web receives
neither keys nor credentials. No development fallback key exists. Without a valid
key, replacement-credential saves fail closed while existing configuration stays
intact. Never generate a new key on every deployment.

Credentials use AES-256-GCM, a fresh random 96-bit nonce, and authenticated context
containing group, immutable provider ID and key version. A changed issuer or client
ID creates a new provider ID and requires a replacement credential. Responses,
version history and audit expose only whether credentials are configured. There
is no saved-secret retrieval endpoint; only future server-side protocol code may
decrypt an envelope. Audit stores group, actor, revision and operation only. Do
not enable HTTP body/credential logging, and redact secrets in upstream diagnostics.
Keep historical keys while retained versions use them, add a new key/version for
rotation, and replace the client credential through Authentication. Retiring old
keys requires a separate controlled re-encryption/retention procedure.

## Outbound discovery and regional private hosting

All provider addresses must use HTTPS with valid TLS and no userinfo, fragments
or query strings. Requests do not follow redirects. Every discovered endpoint is
checked, including JWKS. DNS results are checked and the accepted address is pinned
for each HTTPS connection, retaining hostname certificate validation. Mixed public
and forbidden answers fail closed; every later request must reuse this transport
policy. DNS lookup and response deadlines and a 256 KiB response limit bound work;
JWKS has at most 100 keys. Metadata returned to browsers contains only issuer,
relevant endpoint addresses, signing-key identifiers and PKCE support.

By default only public unicast addresses are permitted. To support an internal
regional IdP, an installation operator sets `OIDC_PRIVATE_ORIGINS_JSON` to exact
HTTPS origins, for example `["https://idp.region.example"]`, through the protected
API deployment configuration. The allowlist permits only RFC1918 and IPv6 ULA at
those origins, including mapped IPv4. Loopback, link-local/metadata, unspecified,
multicast, reserved and transition address ranges remain denied. Each separate
endpoint origin needs independent consent. Agency administrators cannot extend
this installation trust boundary through the draft editor. Installation egress
controls should also restrict access to the intended regional IdP.

## Real draft test login

After saving and inspecting a complete draft, an administrator opens the selected
agency's registered origin, enters their current password and chooses **Test
provider login**. The browser visits the provider; the GET callback returns to
that same agency. Reloading the OIDC draft shows its latest completed test,
configuration revision, S256 capability and identity validation result. Saving
another draft revision removes the previous result from the current draft.
Failure/cancellation preserves the active policy and existing clinical access.
This workflow records or reuses a pending regional identity request. It does not
activate a provider, grant an application session or assert fresh personal
authentication. Linking requires a separate authorized review.

Five-minute transactions bind agency, group, actor, purpose, registered origin,
fixed `/` return path, immutable revision, state, nonce and PKCE verifier. The
saved initiating session must still have write authority and recent local
reauthentication at completion. A separate HttpOnly Secure Lax cookie is restricted
to the callback path; the application cookie remains Strict. Transactions consume
atomically before network exchange; failures, expiry and concurrent replay cannot
be reused. The final short commit rechecks authority, version, inspected metadata,
health and transaction expiry. Tokens and raw claim objects remain transient in
server memory and never enter
the result, audit, browser response or logs. Pending requests retain only exact
validated issuer/subject keys and bounded optional mapped display-name/email
hints. These hints are escaped in Admin and never affect authorization.
Transaction binding data is encrypted with context distinct from provider secrets.

The library explicitly verifies ID-token signatures in addition to code-flow TLS
validation. Token and JWKS requests use the same DNS/address/TLS policy as
discovery, with no redirects, shared time/size limits and pinned addresses. Each
new exchange fetches current keys, accepting overlapping and rotated public keys
and rejecting missing/malformed or unverifiable keys. Neither a prompt request,
`iat`, `auth_time`, silent callback nor a refresh is approved personal proof.

### Supplemental public interoperability check

On 2026-10-13, the optional public Duende demo check completed browser login,
authorization-code exchange with S256, and ID-token issuer/audience/nonce/signature
validation. The result was `identityValidated: true`,
`freshPersonalAuthentication: false`, `pkceS256: true`. It captured the browser's
navigation toward a disposable `.invalid` callback and exchanged that code on the
server; it did not run the application callback or create an application session.
The deterministic PostgreSQL/browser fixture separately exercises the actual
controllers, callback cookies, CSRF guard and shared deployment proxy.

To reproduce manually (internet access and installed Chromium required):

```sh
npm run build -w @open-triage/api
node scripts/test-oidc-public-demo.mjs
```

The [Duende demo source](https://github.com/DuendeSoftware/demo.duendesoftware.com)
publishes the `interactive.confidential` demo client and public credential
`secret`; its [quickstart](https://docs.duendesoftware.com/identityserver/quickstarts/2-interactive/)
uses fictional `alice` / `alice`. Issuer:
`https://demo.duendesoftware.com`. The script uses only those published demo values,
prints a sanitized result and is never part of CI. No account creation is needed.
A public demo success does not validate regional AD FS v6/PAS registrations,
network access, personal authentication evidence, or physical deployment
acceptance; those remain explicit regional acceptance work.

Completed failures contain only a bounded category: `canceled` (restart),
`expired` (confirm password and restart), `draft_changed` (inspect/retest the
saved version), `origin_changed` (open the registered agency origin),
`authority_changed` (sign in and confirm current administration authority),
`provider_validation` (IT checks client registration, callback, claims and signing
keys), or `transaction_invalid` (restart with a new transaction). The UI offers
this guidance in English/Swedish. Provider/library messages and identity/token
contents never become diagnostics. Invalid state/correlation/replay callbacks
receive an invalid-or-expired error without disclosing any stored transaction.

## Review regional identity requests

Open **Authentication → Regional identities** with both settings-read and
user-read authority. The directory is group-scoped, paginated and bounded;
**Review** opens the identity and its optional untrusted profile hints. A matching
email or display name never selects an application user automatically.

With settings-write and user-write authority, explicitly select an existing
ordinary active group user and the current draft or active provider revision.
Confirm personal authentication through the session's local or regional method
to **Link existing user**. The target must be within the administrator’s capability boundary.
Installation owners, superadmins and other installation recovery accounts cannot
be linked here. A link preserves the immutable application user ID, roles, report
authorship and existing audit records. The audit appends request/actor/target IDs
and revision without provider claims or tokens. A test still grants no ordinary
application access after linking. New-user approval, shared personal OIDC sessions
and production activation are separate later slices.

Identity keys contain owning group, immutable provider integration ID, exact
case-sensitive issuer and exact subject. Concurrent callbacks reuse one request;
competing approvals cannot replace a completed link. Changing issuer or client ID
creates another integration, leaving all prior keys and links unchanged. Pending
requests from a replaced integration require current-provider review and cannot
be approved as though they belonged to the new draft. A conflict retains the
selection and gives English/Swedish guidance to reload and inspect the current
integration. Repeated approval of the same existing link is idempotent.

The callback derives agency scope from its encrypted server-side transaction,
not a browser selected-workspace header. Code exchange completes outside the
short persistence transaction; authority, registered origin, draft/discovery and
expiry are checked again before an identity is recorded. Failed, stale or expired
exchanges do not create a pending request.

Personal clinical login uses the separately approved contract and shared session
boundary described in [Personal OIDC application sessions](personal-oidc-sessions.md).
A draft diagnostic still cannot create a clinical application session.
