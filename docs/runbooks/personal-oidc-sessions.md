# Personal OIDC application sessions

Personal login uses the existing OpenTriage session, immutable user identity,
clinical workflows, Admin controls and protected browser storage. The regional
provider never supplies roles, and its access/ID tokens never enter the browser
or durable session records. Ordinary users without local passwords use the same
live agency, role, capability, origin, installation and revocation checks.
Local sessions still require their current local credential version. Installation
owner/superadmin recovery remains independent and local.

The active provider version is used for personal login; draft tests continue to
establish identity evidence only. This slice introduces no activation endpoint.
Production activation and group login-mode transitions are the separate activation
slice. An unavailable provider cannot enable password reauthentication or password
replacement for an OIDC-issued session, renew freshness, or extend its deadline.

## Approve a trustworthy personal proof contract

An installation operator must supply `OIDC_PERSONAL_PROOF_POLICIES_JSON` in the
private API deployment Secret. Its absence fails closed for personal OIDC login
while identity-only diagnostics remain usable. Discovery metadata, `prompt=login`,
ID-token `iat`, arbitrary `acr`/`amr`, or `auth_time` alone never approve a contract.
Regional IT must first establish that the declared issuer/client methods and signed
claims prove the intended person's fresh personal authentication, including cached
regional SSO, shared-device handover and disabled accounts.

The value is an array of explicitly reviewed contracts. A fictional example:

```json
[
  {
    "id": "reviewed-personal-contract-v1",
    "groupId": "11111111-1111-4111-8111-111111111111",
    "providerId": "22222222-2222-4222-8222-222222222222",
    "issuer": "https://fictional-provider.example/issuer",
    "clientId": "fictional-client",
    "acr": "fictional:interactive-personal",
    "requiredAmr": ["fictional-personal"]
  }
]
```

These strings are examples, not regional AD FS/PAS claims or agreed deployment
values. A contract binds the exact group, immutable integration UUID, issuer and
client. Credential-only provider revisions retain that approval. Changed issuer,
client or integration requires another explicitly reviewed contract. Contracts
have a canonical digest, recorded separately for issuance and the latest proof.
Reordering JSON fields or the required-method list does not change the digest.

The required ACR must match exactly and every declared required AMR must be
present in signature-validated ID-token claims. Signed `auth_time` must be an
integer at or after the next whole second following transaction creation and no
later than current server time. Authorization URL delivery waits to that boundary
outside the database transaction, so earlier authentication in the transaction's
starting second cannot qualify. Provider/server clocks therefore need to agree.
A transaction expires after five minutes. No clock-skew allowance silently admits
older personal authentication.

The application's login, switch or sensitive-action purpose is bound to immutable
server transaction state, state/nonce, PKCE and the authorization code. If the
reviewed provider also supplies a signed purpose claim, the contract may add
`purposeClaim` plus distinct `purposes.login`, `purposes.switch` and
`purposes.reauthenticate` values. This additional requirement is optional;
conventional OIDC does not need an invented custom claim.

## Session and handover behavior

- Fresh login and explicit user switch establish a new maximum session duration
  from the effective group policy. Activity, reminder acknowledgment and background
  requests preserve both that deadline and the existing personal-proof timestamp.
- Same-user sensitive-action reauthentication updates only the initiating session's
  recent proof. It preserves that session's expiry and records the latest identity,
  provider revision and contract separately from immutable issuance provenance.
  A proof in another browser/device/session cannot satisfy its gate.
- Starting explicit Switch revokes the outgoing application session and clears its
  cookie. Cancellation, provider failure, pending review and a no-role incoming
  account cannot restore outgoing authority. A validated wrong subject during
  sensitive reauthentication also becomes a safe switch; a pending identity revokes
  the outgoing session, and a linked identity receives its own replacement session.
- Every callback consumes its transaction atomically before network exchange. The
  final commit rechecks the exact active revision, inspected metadata, approved
  contract, registered origin, expiry and current user/device authority. Later
  provider rotation preserves already-issued session lifetimes and their historical
  provenance. Repeated or ambiguous callbacks cannot reuse a code or proof.
- Browser redirects settle pending writers through the existing cross-tab barrier,
  clear clinical plaintext and keys, and preserve opaque pending ciphertext and its
  original recovery deadline. Another person cannot obtain outgoing labels or keys.
  OIDC protected-report recovery is handled by the following recovery slice.
- Logout calls only OpenTriage's session endpoint. It locks all participating tabs
  before the server request and disables the next login until the cookie-clearing
  response finishes. A five-second request timeout keeps offline/stalled logout
  bounded. No provider end-session/global regional logout is invoked. The next
  regional login requires new approved personal proof despite regional cookies.

The application cookie stays HttpOnly/Secure/SameSite=Strict. A distinct five-minute
HttpOnly/Secure/Lax correlation cookie is restricted to the registered callback
path. The session CSRF token is encrypted with the dedicated OIDC keyring and bound
to the exact session token/group, allowing the common current-session endpoint to
restore a redirected browser without disclosing provider tokens.

Transactional session authority reads do not update activity before domain locks.
Personal authority locks precede registration, ordered agencies, unit and session
locks, matching clinical access and account containment. In-transaction origin reads
use that same database connection, avoiding nested pool exhaustion. Provider/DNS
requests remain outside database transactions.

## Handoff to activation and recovery

Activation must use these declared purposes and proof contracts, retain independent
local installation recovery, and govern the next required authentication after a
mode change. An old local session that now needs regional authentication requires
a safe replacement with OIDC provenance and its prior deadline preserved; stamping
OIDC freshness onto a local-only session is insufficient. This slice intentionally
does not implement that mode transition. Latest proof columns permit OIDC sessions
to record a new approved active provider without rewriting their original provenance.

Protected recovery uses the shared source/authority boundary and sensitive-action
control. A fresh local or approved OIDC reauthentication unlocks only the same
clinician's eligible report through a one-use grant; ordinary login and activity
cannot advance recovery proof. Ciphertext deadlines never renew on login or pairing.
See [protected storage](../protected-offline-clinical-storage.md).

Controlled TLS-provider, real PostgreSQL runtime and proxy-browser regressions are
mandatory in API integration checks. Deployment browser checks also cover delayed
logout, both next-login modes and stalled-server cleanup. These checks do not prove
regional AD FS v6/PAS or physical Android/Windows acceptance. No regional issuer,
registration, claim contract or device facts have been supplied; regional acceptance
remains the separate external acceptance slice.
