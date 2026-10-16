# External identity review and new-user approval

In Admin → Users, find a Pending or Denied request and use **Manage** to review the exact issuer,
subject, and integration evidence. Names and email addresses are untrusted
profile hints. A matching email never links accounts or grants roles.

When configured name or email claims are absent from the signed ID token, the
server retrieves them from the provider's UserInfo endpoint using the code-flow
access token and verifies that its subject matches the ID token. Authentication
method and freshness checks use only the signed ID token. Request `profile` and
map the display name to `name` for Duende; request `email` as well if needed.
The optional username mapping defaults to `preferred_username`, also covered by
`profile`. The provider username is captured from the validated ID token or
subject-checked UserInfo response and displayed as **SSO username** on the
account and in the Users username column when no local username exists. The
Users search includes it. Missing or invalid usernames do not block login;
providers with another claim name can configure it in Authentication. Clearing
the mapping disables retrieval. A provider username is a profile hint, not a
password credential, a unique identity key, or automatic account-link evidence.
Existing users receive missing usernames on their next validated SSO login.

A subsequent validated login fills missing hints on an existing request without
replacing previously captured evidence or changing its approval decision. The
application account's display name remains administrator-managed.

Use **Link to an existing user** only after confirming that this is the same
person. Linking preserves that application's immutable user ID, reports,
assignments, and history. Installation owner and superadmin recovery accounts
cannot be external identity targets.

Use **Create an SSO user** for a genuinely new person. Enter the display
name, explicitly choose the current provider evidence, and select roles. Draft
provider tests can establish identity evidence for onboarding; approving their
evidence does not activate the provider or enable organization sign-in. Active and
draft revisions are separate choices and are checked again on submission.
A changed provider version or review decision requires refreshing Users and reviewing the request again.

Use **Deny request** to refuse onboarding without creating an account or session.
Denial requires settings-write, user-write and recent personal authentication.
The decision persists when the identity signs in or completes a provider test again.
Denied requests remain searchable through the Denied filter. An administrator can
explicitly reconsider a denial by creating or linking a user using the current
review revision. Competing decisions cannot overwrite one another.

Approval requires current authentication/settings write, user management, role
assignment, and recent personal authentication. The same role assignment rules
apply as in Users: foreign, hidden, inactive, unassignable, and stronger roles
are rejected, and Administrator/Demo remain restricted to installation recovery
administrators. User administration resolves to the agency group's shared staff
and roles even when the browser session selects a child agency.

Approval atomically creates one group-owned user, assigns the chosen roles,
and links the immutable external identity. It creates no local username,
password verifier, or application session. Concurrent approval/link attempts
produce one outcome, and failed approvals leave no orphan user or role grants.
An empty role selection deliberately creates a user without workspace
capabilities. Later role editing supplies access explicitly.

The Users list defaults to All and combines accounts with unapproved requests
in the same bounded search, status filters and pagination. Requests are visible
only with both users-read and settings-read authority; they are not application
accounts and cannot receive sessions or roles before approval. Approved or linked
requests leave the list, so the application user appears once.

SSO-only users appear in Users and its search/filter, role editing, disable and
reactivate actions, and session administration. The username column identifies
SSO-only accounts; their editor offers no username or password reset. Linked
users that already have a local credential retain the applicable local actions.
Disablement and individual session revocation use the same containment paths
for both account types. Reactivation requires a fresh login and does not restore
revoked sessions. Editing display names does not change external identity keys.

## Session implementation boundary

Personal OIDC login now uses the common application-session authority boundary.
Both authenticated reads and administrative session listing validate explicit
issuance provenance; merely having no local credential does not authorize a
persisted row. Local sessions retain their credential-version check. OIDC sessions
bind the immutable identity, issuance version and approved personal-proof contract;
latest reauthentication evidence is tracked separately. Installation enrollment
attaches existing sessions through this same validation boundary.

See [Personal OIDC application sessions](personal-oidc-sessions.md) for installation
proof-contract approval, shared-device switching, session deadlines and callback
checks. The activation slice still owns production mode changes. Protected-recovery
SQL and password-dependent recovery screens remain the following recovery slice;
they must fail closed while retaining encrypted work within its original deadline.
Independent installation-owner/superadmin CLI recovery and ordinary local account
maintenance remain local.

Real regional AD FS/PAS and Android/Windows device acceptance remains a separate
external acceptance step. Controlled provider, PostgreSQL, and browser tests do
not prove regional production compatibility.

## Installation superuser agency switching

Agency-less installation superusers use a host-specific session handoff when
opening an agency whose registered address differs from the current address.
Ordinary agency users and accounts with a home agency do not use this path.

The source tab records a random intent verifier locally. The destination creates
an HttpOnly Secure SameSite=Strict challenge cookie, then returns the browser to
the initiating tab's origin. That origin verifies the saved intent and its
normal session CSRF before issuing a short-lived, single-use redemption code.
The browser returns to the destination, where the challenge cookie binds
redemption to that browser. Tokens and codes do not enter query strings or server
request URLs; transient fragments are removed before startup proceeds. Only
hashes of intent, challenge and redemption secrets are stored in the private DB.

Issuance revokes the outgoing session; successful redemption creates a new
host-specific session with the same identity, original start, fixed expiry and
personal-authentication timestamps. It carries no new OIDC proof and no device
enrollment from another host. Current account/credential/superuser authority,
registered target address and agency access are rechecked at completion. A
password reset, expiry, revoked authority, wrong origin, different browser or
replay fails closed. A different person already signed in at the destination
must sign out before the handoff can proceed. Source and destination plaintext
and in-memory keys settle through the shared cross-tab transition barrier.

For an existing superuser session already displaying Test Agency at the old
address, use **Open agency** on Test Agency again to perform the handoff to its
registered address. Local demonstration aliases use the configured web port;
production agency addresses use HTTPS. Agency-local OIDC diagnostics can then
start from the correct callback origin.

## Unlink an existing SSO user

Open **Users → Manage** on the linked application account. The ordinary active
session list supports **Revoke session** for both password and SSO sessions.
**Unlink SSO and revoke sessions** removes all approved external identity links
for that user and revokes every application session in the same transaction.
It retains the account, roles, credentials and clinical records. The detached
identities appear as Denied requests; another provider login does not reconnect
them. Explicitly review and link a denied identity to restore SSO access. Old
sessions stay revoked after relinking.

Unlinking requires user and authentication administration rights, session-read
and session-revoke rights. No additional reauthentication is required. Administrators
cannot unlink themselves, an installation owner/superadmin, a user outside the
selected agency group, or a user with greater administrative authority.
