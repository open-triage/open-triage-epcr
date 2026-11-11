# Personal OIDC application sessions

Personal login uses the existing OpenTriage session, immutable user identity,
clinical workflows, Admin controls and protected browser storage. The identity
provider never supplies roles, and its access/ID tokens never enter the browser
or durable session records. Ordinary users without local passwords use the same
live agency, role, capability, origin, installation and revocation checks.
Local sessions still require their current local credential version. Installation
owner/superadmin recovery remains independent and local.

An administrator activates the exact saved draft after its latest real diagnostic
login succeeds. Activation binds that test to unchanged inspected discovery and
requires the current authenticated session plus an installation-approved proof contract.
The active version and the group's inherited `oidc` mode change atomically with audit;
failed/stale activation keeps the prior policy. Draft tests remain identity evidence
only and never grant clinical access or fresh personal proof. An unavailable provider cannot enable password reauthentication or password
replacement for an OIDC-issued session, renew freshness, or extend its deadline.

## Approve a trustworthy personal proof contract

Use **Admin → Authentication → Personal authentication requirements** to approve
the group's provider, set its required AMR methods and optional exact ACR, and
configure an optional signed purpose claim. These settings are saved with the
draft and take effect only after discovery, a real diagnostic and activation of
that exact revision. Child agencies inherit the group's settings. Clearing the
approval explicitly disables personal proof for that revision; it cannot fall
back to an installation policy. Signature validation and fresh signed `auth_time`
remain mandatory. Review the provider's real behavior, including cached SSO,
shared-device handover and disabled accounts, before production activation.

Setup uses the agency configuration and does not require environment editing or
API restarts. Discovery, prompts, token `iat` and arbitrary method claims never
approve a contract on their own. A fictional requirements example:

```json
{
  "id": "reviewed-personal-contract-v1",
  "acr": "fictional:interactive-personal",
  "requiredAmr": ["fictional-personal"]
}
```

These strings are examples, not regional AD FS/PAS claims or agreed deployment
values. A contract binds the exact group, immutable integration UUID, issuer and
client. Credential-only provider revisions retain that approval. Changed issuer,
client or integration requires another explicitly reviewed contract. Contracts
have a canonical digest, recorded separately for issuance and the latest proof.
Reordering JSON fields or the required-method list does not change the digest.

Set `acr` to an exact nonempty string to require that value in the signed ID
token. Set it explicitly to JSON `null` for a reviewed contract that relies on
authentication methods and freshness without an ACR requirement. Omitting `acr`,
using an empty string, or using `false` is invalid. Existing string-valued
contracts retain their exact-match behavior. With `acr: null`, authorization
requests omit `acr_values` and the essential ACR claim request; a returned ACR
does not contribute to approval. Every declared required AMR must still be
present in signature-validated ID-token claims. Signed `auth_time` must be an
integer at or after the next whole second following transaction creation and no
later than current server time. Authorization URL delivery waits to that boundary
outside the database transaction, so earlier authentication in the transaction's
starting second cannot qualify. Provider/server clocks therefore need to agree.
A transaction expires after five minutes. No clock-skew allowance silently admits
older personal authentication.

For fictional local Duende testing, approve personal authentication in the panel,
enter `pwd` as the required AMR and uncheck **Require a specific authentication
context (ACR)**. This saves `acr: null`. Keep the public-only origin list empty.
Save, inspect, perform a diagnostic, link the identity to an ordinary test user in
Users → Manage, and activate the tested draft. Then perform a fresh provider
login for application access. This does not approve a regional production
contract. Changing string/null ACR or any other proof requirements changes the
contract digest; existing proof must be refreshed before it satisfies the new
contract.

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
- The current valid login authorizes application actions throughout its fixed
  lifetime. Recovery, administrative actions and shift changes do not request
  repeated passwords, OIDC authentication or clinician confirmation. Normal
  role, owner, enrollment and agency authorization still applies.
- Logout followed by login performs an explicit user switch. The outgoing
  session is revoked and the linked identity receives its own new session.
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
  bounded. No provider end-session/global provider logout is invoked. The next
  organization sign-in requires new approved personal proof despite provider cookies.

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

## SSO activation and required authentication

SSO activation stops new ordinary local-password sessions throughout the group.
It neither revokes existing local sessions/credentials nor changes their fixed expiry
or already-satisfied shift evidence. Blank-schedule and eligible existing-report
access retain their ordinary authority boundaries. An established temporary-password session remains limited to authentication: it
cannot enter clinical or Admin work before completing its required personal SSO
proof. Its recovery/current-session view displays the organization sign-in completion path,
while ordinary authority reads still deny it. The resulting same-user OIDC
replacement retains the temporary session's original fixed deadline.

Existing valid sessions retain access allowed by their live authority; a
provider policy change does not introduce a repeated action-authentication prompt.
Initial login and explicit user switching still validate the configured provider
and approved claim contract. Temporary sessions limited to completing account
setup cannot enter clinical or Admin work before that initial login completes.

Installation owner and superadmin local recovery remain independent. The only demo
exception is the immutable demonstration fixture ID in its exact demonstration
tenant, with its `demo` username and only the active protected Demo assignment.
Adding an ordinary/custom assignment removes its exception. A synthetic flag on
another account grants none. Existing production gates deny the known fixture real
jobs; neither enrollment nor this authentication exception confers staff authority.
The login screen offers deliberately selected installation recovery, and ordinary
staff cannot use it to bypass SSO.

Administrative provider/local-policy writes hold live actor/assignment/role/device
and agency/session authority before configuration locks. Policy, provider state and
version locks follow a consistent order. Network exchanges complete outside these
short transactions. Starting a diagnostic or personal flow clears the other flow's
callback correlation cookie so an abandoned attempt cannot steal recovery testing.

Protected recovery uses the current authenticated session and releases only
the original clinician's eligible report through a one-use grant. No extra
password or OIDC proof is requested. Login, activity and pairing cannot extend
protected recovery deadlines.
See [protected storage](../protected-offline-clinical-storage.md).

Controlled TLS-provider, real PostgreSQL runtime and proxy-browser regressions are
mandatory in API integration checks, including activation races and local-session transitions. Deployment browser checks also cover delayed
logout, both next-login modes and stalled-server cleanup. These checks do not prove
regional AD FS v6/PAS or physical Android/Windows acceptance. No regional issuer,
registration, claim contract or device facts have been supplied; regional acceptance
remains the separate external acceptance slice.
