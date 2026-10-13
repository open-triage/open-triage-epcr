# OIDC provider drafts

Authentication now stores versioned OIDC drafts at agency-group scope. Children
inherit their group's configuration. Saving an incomplete draft or a failed
discovery check preserves the active configuration. Failed checks retain the last
successful read-only metadata and mark its health failed; a new draft starts
without discovery metadata. This slice does not activate
SSO or perform authentication; the following tickets add real test login and
activation. Discovery success is connectivity evidence, not regional acceptance.

The maintained protocol library is [openid-client v6](https://github.com/panva/openid-client),
pinned in the API package/lockfile. Use its server-side authorization-code flow,
`ClientSecretPost` (`client_secret_post`), nonce and state validation, ID-token
validation and S256 PKCE for the future code exchange. Discovery rejects a provider
that does not advertise this client authentication mechanism. Regional IT must
confirm that the AD FS v6 registration supports it and S256. Do not guess the
issuer, client identifier, credentials, claims or host registrations. If another
mechanism is required, implement and test it before activation. Microsoft documents
[AD FS code flow and PKCE](https://learn.microsoft.com/en-us/windows-server/identity/ad-fs/overview/ad-fs-openid-connect-oauth-flows-scenarios).

Registration details show exact HTTPS URLs for active registered group agency
hosts: `/api/sessions/oidc/callback` and `/api/sessions/oidc/logout-callback`.
These are the reserved routing contract for the later protocol handlers; draft
configuration does not make either handler or provider logout active. Logout
registration is informational and does not enable regional global logout.
Required ID-token claims are `iss`, `sub`, `aud`, `exp`, `iat`, `nonce`; supported
profile mappings are display name and optional email. Profile claims never grant
roles and email must not link application identities automatically.

For the forthcoming callback, keep the existing application cookie/CSRF/origin
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
