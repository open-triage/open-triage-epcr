# Regional identity review and new-user approval

In Admin → Authentication → Regional identities, review the exact issuer,
subject, and integration evidence. Names and email addresses are untrusted
profile hints. A matching email never links accounts or grants roles.

Use **Link to an existing user** only after confirming that this is the same
person. Linking preserves that application's immutable user ID, reports,
assignments, and history. Installation owner and superadmin recovery accounts
cannot be regional targets.

Use **Create a regional user** for a genuinely new person. Enter the display
name, explicitly choose the current provider evidence, and select roles. Draft
provider tests can establish identity evidence for onboarding; approving their
evidence does not activate the provider or enable regional login. Active and
draft revisions are separate choices and are checked again on submission.
A changed version requires refreshing and reviewing the request again.

Approval requires current authentication/settings write, user management, role
assignment, and recent personal authentication. The same role assignment rules
apply as in Users: foreign, hidden, inactive, unassignable, and stronger roles
are rejected, and Administrator/Demo remain restricted to installation recovery
administrators. User administration resolves to the agency group's shared staff
and roles even when the browser session selects a child agency.

Approval atomically creates one group-owned user, assigns the chosen roles,
and links the immutable regional identity. It creates no local username,
password verifier, or application session. Concurrent approval/link attempts
produce one outcome, and failed approvals leave no orphan user or role grants.
An empty role selection deliberately creates a user without workspace
capabilities. Later role editing supplies access explicitly.

SSO-only users appear in Users and its search/filter, role editing, disable and
reactivate actions, and session administration. The username column identifies
SSO-only accounts; their editor offers no username or password reset. Linked
users that already have a local credential retain the applicable local actions.
Disablement and individual session revocation use the same containment paths
for both account types. Reactivation requires a fresh login and does not restore
revoked sessions. Editing display names does not change regional identity keys.

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
