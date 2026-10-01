# Users and Roles PRD

## Problem Statement

OpenTriage has durable application users, local credentials, sessions, and a small set of directly assigned capabilities, but it does not yet provide a complete administrative model for managing people and access. Administrators cannot safely create, rename, disable, reactivate, or inspect users; manage active sessions; define reusable roles; explain historical permission changes; or transfer installation ownership without direct database or CLI intervention.

The existing broad `installation:administer` capability cannot express separation of duties. Direct user-capability grants make access difficult to understand, while Catalog and Forms endpoints cannot distinguish readers, authors, and publishers. The current installation-level synthetic-demo settings also couple clinical demonstration tools to a deployment instead of to the users authorized to exercise them.

Without a coherent Users and Roles vertical slice, delegated administrators can either receive too much authority or cannot perform useful work, security-sensitive changes are difficult to constrain, and the demonstration workflow remains unlike production.

## Solution

Build a database-backed Users and Roles administration feature based exclusively on versioned roles and a fixed capability registry. Add protected baseline roles, custom role authoring, one active installation owner, accepted ownership transfers, user lifecycle management, temporary-password resets, active-session inspection and revocation, immutable assignment history, and capability-sensitive Admin navigation.

Replace broad Catalog and Forms authorization with separate read, write, and publish capabilities. Apply role changes immediately by resolving current role versions at the server authorization boundary on every request. Prevent self-modification, privilege escalation, and lower-privileged administrators from disabling or stripping access from more privileged users.

Replace installation-level clinical-demo behavior with a protected Clinical Demo role. Give authorized users online banner tools to generate, populate, clear, and delete synthetic work. Synthetic calls and reports receive their own 24-hour expiry. A demonstration installation otherwise uses the same ownership, authentication, authorization, and retention behavior as production, with only two additional fixture users.

This feature is a complete vertical slice spanning schema, application services, APIs, Admin UI, owner and fixture bootstrap, audit-event creation, existing Catalog/Form authorization, and Clinical Demo behavior. Existing installations may be wiped and freshly bootstrapped; legacy authorization data does not require migration.

## User Stories

1. As an installation owner, I want one coherent Users and Roles workspace, so that access can be administered without database access.
2. As an administrator, I want Admin navigation to show only panels I can read, so that the interface reflects my authority.
3. As a user with no assigned workspace role, I want a clear no-access state after signing in, so that an active but unprovisioned account does not encounter a broken application.
4. As an administrator, I want to create a user with a local username, display name, temporary password, and initial roles, so that new staff can be provisioned without email infrastructure.
5. As a newly provisioned user, I want to replace my temporary password before entering a workspace, so that the administrator does not retain my working credential.
6. As an administrator, I want temporary passwords to expire, so that unused provisioning credentials do not remain valid indefinitely.
7. As an administrator, I want password resets to revoke all existing sessions, so that a compromised account cannot retain access.
8. As an administrator, I want reactivation and password reset to remain separate actions, so that restoring an identity does not silently change its credential.
9. As an administrator, I want to rename usernames and display names without changing immutable authorship identity, so that personnel records can be corrected safely.
10. As an auditor, I want every historical username permanently reserved, so that a prior sign-in identity cannot later identify another person.
11. As an administrator, I want users disabled and reactivated rather than deleted, so that clinical and audit references remain intact.
12. As a security administrator, I want disabling a user to revoke all sessions immediately, so that online access ends at once.
13. As an administrator, I want user roles retained but ineffective during disablement, so that reactivation can restore reviewed access deliberately.
14. As an administrator, I want to prepare role assignments while a user is disabled, so that access is correct before reactivation.
15. As an administrator, I want reactivation to display the roles being restored, so that restored access is explicit.
16. As an administrator, I want to inspect active sessions with useful device and activity context, so that I can identify a lost or shared session.
17. As a security administrator, I want to revoke an individual session, so that an incident can be contained without resetting the account.
18. As a privacy-conscious administrator, I want ordinary session views to omit source IP and geolocation, so that personnel data is not exposed unnecessarily.
19. As an administrator, I want server-side user search, filters, and pagination, so that the Users panel remains usable with 10,000 users.
20. As an administrator, I want user edits protected from stale writes, so that concurrent administration does not silently overwrite changes.
21. As an administrator, I want a user's complete desired role set applied atomically, so that access is never partially updated.
22. As an administrator, I want capabilities granted only through roles, so that every permission has an understandable source.
23. As an installation owner, I want protected Clinician, Administrator, Configuration Author, and Clinical Demo roles, so that common responsibilities have safe baseline definitions.
24. As a future product developer, I want a reserved but hidden Reviewer role key, so that later reviewer workflow does not require redefining identity concepts.
25. As an administrator, I want protected role definitions to be immutable in the UI, so that baseline semantics cannot drift locally.
26. As a security owner, I want protected roles to use explicit versioned capability sets rather than wildcards, so that software updates cannot grant new authority silently.
27. As an administrator, I want to define custom roles from a fixed registry, so that duties can be separated without inventing arbitrary permissions.
28. As a role author, I want active roles to contain at least one capability, so that empty roles are represented by deactivation instead of misleading definitions.
29. As a role author, I want saving an edit to create and activate an immutable role version, so that history is preserved without a separate draft workflow.
30. As an administrator, I want a changed role version to apply immediately to all assignees, so that current authorization reflects the active definition.
31. As an auditor, I want historical role versions and assignment intervals retained, so that access at an earlier time can be reconstructed.
32. As an administrator, I want roles deactivated rather than deleted, so that historical references remain understandable.
33. As an administrator, I want role deactivation to remove that role from all users, so that its permissions stop immediately.
34. As an administrator, I want to reactivate a role without restoring prior assignments, so that dormant access cannot return silently.
35. As a role author, I want active role names to be case-insensitively unique, so that administrators can distinguish assignments.
36. As a role author, I want a deactivated role's display name reusable, so that a replacement role can use familiar terminology without rewriting history.
37. As a configuration author, I want custom role definitions portable without user assignments, so that reusable access patterns can move between installations without moving personnel data.
38. As a limited administrator, I want to add and remove only capabilities I possess, so that delegated role management cannot escalate privileges or disable higher authority.
39. As a limited administrator, I want role capability prerequisites enforced, so that I cannot create unusable mutation-only roles.
40. As an administrator, I want self-disablement, self-service role changes, and edits to roles assigned to me prohibited, so that privilege changes remain independently attributable.
41. As a higher-privileged user, I want lower-privileged administrators unable to rename, disable, reset, or strip my access, so that delegated administration cannot become an account-takeover or denial path.
42. As a security operator, I want session revocation exempt from the target privilege ceiling, so that an incident involving a more privileged account can still be contained.
43. As an installation owner, I want to manage any non-owner's roles from the fixed registry without receiving those runtime permissions myself, so that the installation can be provisioned from an admin-only owner account.
44. As an installation owner, I want only the owner to assign or remove Administrator and Clinical Demo, so that the highest-risk protected roles remain controlled.
45. As an installation owner, I want exactly one active owner, so that ultimate responsibility is unambiguous.
46. As an installation owner, I want ownership transfer to require acceptance by an active Administrator, so that ownership cannot be imposed accidentally.
47. As an ownership nominee, I want a pending transfer to expire or be cancelable, so that stale transfers cannot complete unexpectedly.
48. As an installation owner, I want owner-account mutation protected from delegated administrators, so that the installation cannot be taken over or locked out.
49. As an installation operator, I want a one-time owner bootstrap with no default credential, so that a fresh installation starts securely.
50. As an installation operator, I want the first owner to be admin-only by default with an explicit Clinician option, so that clinical access follows least privilege.
51. As an installation operator, I want audited break-glass reset commands to identify the operator and immutable target, so that recovery is attributable after username changes.
52. As a catalog reader, I want to inspect element definitions without editing them, so that viewing clinical configuration does not imply authoring authority.
53. As a catalog author, I want to edit element, code-list, requiredness, and constraint drafts without publishing, so that authoring and deployment are separated.
54. As a catalog publisher, I want publication and activation protected by a publish capability, so that release authority is explicit.
55. As a form reader, I want to inspect and preview form definitions without editing them, so that reviewing presentation does not imply authoring authority.
56. As a form author, I want to create, edit, and delete form drafts without publishing, so that authoring and deployment are separated.
57. As a form publisher, I want publication and activation protected by a publish capability, so that release authority is explicit.
58. As a limited administrator, I want Users and Roles read access without write actions, so that the demonstration and audit of access configuration does not imply mutation rights.
59. As a role reader without Users read access, I want aggregate assignee counts without personnel identities, so that role inspection does not leak user data.
60. As a user reader without Roles read access, I want role names and statuses on user records without full capability definitions, so that access remains understandable within my scope.
61. As a Clinical Demo user, I want an authenticated clinical banner, so that synthetic tools appear only when I am authorized to use them.
62. As a Clinical Demo user, I want to generate a synthetic call explicitly, so that opening one call does not create another automatically.
63. As a Clinical Demo user assigned to multiple units, I want to select the target unit, so that the synthetic assignment enters the intended queue.
64. As a Clinical Demo user, I want generation to reuse an existing unopened synthetic assignment for the same user and unit, so that repeated clicks do not create a backlog.
65. As a Clinical Demo user, I want to populate or clear an open synthetic draft, so that I can exercise documentation efficiently.
66. As a Clinical Demo user, I want to delete any open synthetic draft after confirmation, so that I can restart without waiting for a validation failure.
67. As a clinician, I want demo actions unable to modify ordinary or signed reports, so that synthetic tooling cannot damage clinical records.
68. As a security owner, I want every demo-only mutation checked by the server, so that hidden controls or forged requests cannot bypass the Clinical Demo role.
69. As a privacy owner, I want generated synthetic calls and reports removed 24 hours after server creation, so that demo records do not accumulate.
70. As an offline user, I want expired local synthetic data removed and delayed synchronization rejected, so that purged records cannot return.
71. As a demonstration operator, I want the demo installation to use normal production ownership and security, so that evaluation reflects the real product.
72. As a demo administrator, I want `demo` / `opentriagedemo` to use the protected Demo role, so that current demonstration workflows remain available.
73. As a demo clinician, I want `demo` / `opentriagedemo` to support clinical demonstration workflows through its protected Demo role.
74. As a demonstration operator, I want fixture bootstrap to preserve later account administration, so that rerunning it cannot reset passwords, reactivate users, or restore removed roles.
75. As an auditor, I want user, credential, session, role, capability, ownership, and synthetic actions recorded without secrets or patient content, so that accountability does not create another sensitive store.
76. As an administrator, I want optional notes accepted but never required, so that structured audit history does not block time-sensitive administration.

## Implementation Decisions

### 1. Identity and Session Security

- Continue using immutable application-user IDs as the identity referenced by clinical authorship, audit records, sessions, roles, and ownership.
- Local usernames are trimmed, lowercased, and limited to 3–128 ASCII characters matching `[a-z0-9][a-z0-9._-]{2,127}`.
- Usernames are case-insensitively unique across the installation. A rename disables the prior username immediately and records it in permanent reservation history. Historical usernames are never login aliases.
- The single-agency API derives organization context from the authenticated session. A future multi-agency implementation may scope username uniqueness by organization and derive that organization from the login host or subdomain; clients never supply an authoritative organization ID.
- Display names are trimmed, normalized to Unicode NFC, 1–200 characters, may duplicate another display name, and reject control characters.
- Passwords are 12–1,024 Unicode characters. There are no composition quotas or routine password expiry. Authentication is rate-limited, and known-compromised values are rejected when an offline denylist is available.
- Administrator-entered temporary passwords expire after 72 hours by default. The configurable range is 1–168 hours. Expiry prevents sign-in until another reset but does not disable the user.
- Creating or resetting a credential stores only a current password verifier, marks the credential for mandatory replacement, and never returns or audits the password.
- Resetting a password revokes all active sessions in the same transaction. Reactivation never performs an implicit password reset.
- Online sessions remain opaque, durable, cookie-based, CSRF-protected, and revocable. Current roles and capabilities are resolved from active role state at request time rather than trusted from client claims.
- Session administration exposes start time, last-activity time, expiry, a coarse browser/OS label, and whether the session is the viewer's current session. Source IP is restricted to security audit data; no geolocation is derived.

### 2. Fixed Capability Registry

- The initial registry contains:
  - `clinical:document`
  - `clinical:demo` (system-only)
  - `admin-dashboard:read`
  - `users:read`
  - `users:write`
  - `credentials:reset`
  - `sessions:read`
  - `sessions:revoke`
  - `roles:read`
  - `roles:write`
  - `roles:assign`
  - `catalog:read`
  - `catalog:write`
  - `catalog:publish`
  - `forms:read`
  - `forms:write`
  - `forms:publish`
- `users:write` and `credentials:reset` require `users:read`.
- `sessions:read` requires `users:read`; `sessions:revoke` requires both `sessions:read` and `users:read`.
- `roles:write` requires `roles:read`; `roles:assign` requires both `roles:read` and `users:read`.
- Catalog and Forms write requires the matching read capability; publish requires matching read and write capabilities.
- Capability prerequisites are validated before a role version can activate.
- `installation:administer` and `reports:document` are removed after all authorization checks move to granular capabilities. `clinical:document` is the sole canonical clinical-documentation capability.
- Publishing and activation remain separate workflow actions but share the corresponding Catalog or Forms publish capability.
- Any administrative capability makes Admin mode available. Individual navigation panels, routes, queries, and actions remain separately authorized.

### 3. Protected Roles

- Protected roles have stable system identities and explicit, immutable, versioned definitions. Registering a future capability does not add it to a protected role automatically.
- Clinician contains `clinical:document` only.
- Administrator contains every currently registered administrative capability and no clinical capability.
- Configuration Author contains `admin-dashboard:read`, `users:read`, `roles:read`, `catalog:read`, `catalog:write`, `forms:read`, and `forms:write`.
- Clinical Demo contains `clinical:document` and `clinical:demo`.
- Reviewer has a reserved system key but is hidden, unassignable, and otherwise nonfunctional in this release.
- Protected roles cannot be renamed, edited, deactivated, replaced by imports, or recreated as custom roles.
- Administrator and Clinical Demo may be assigned or removed only by the current owner after recent reauthentication.
- Clinician and Configuration Author follow normal role-assignment and non-escalation rules.
- `clinical:document` is available to custom roles. `clinical:demo` is never shown in the custom-role builder and can be obtained only through Clinical Demo.

### 4. Custom Role Lifecycle

- Roles, not direct per-user grants, are the only assignable source of capabilities.
- A custom role has an immutable stable ID and immutable version history. Users are assigned to the stable role, not to a particular version.
- Custom role display names are trimmed, NFC-normalized, 1–100 characters, and case-insensitively unique among active roles. Descriptions are optional and limited to 500 characters.
- A deactivated role's display name may be reused because stable IDs and audit history distinguish the identities.
- Active custom roles contain at least one registered capability and satisfy every prerequisite.
- Editing uses an `edit -> save and activate new version` flow with optimistic concurrency. There is no persistent role-draft or separate role-publish workflow.
- Activating a new version changes authorization for every assignee immediately. Prior versions remain immutable with effective timestamps.
- Roles are never hard-deleted. Deactivation atomically ends every current assignment and makes the role ineffective and unassignable.
- A deactivated role may be reactivated by creating a new active version. Reactivation never restores ended assignments; users must be reassigned explicitly.
- Role definitions and assignment intervals retain actor, timestamps, and optional notes sufficient for historical reconstruction.

### 5. User Lifecycle and Role Assignment

- Users are created, renamed, disabled, and reactivated but never hard-deleted.
- An active user may have zero roles. Such a user may authenticate or complete mandatory password replacement but receives no workspace.
- User deactivation retains role assignments as ineffective state and revokes every active session. Reactivation makes the retained roles effective again only after the administrator reviews the resulting role set, and it requires a fresh login.
- Administrators may edit role assignments while a user is disabled.
- A user role update submits the complete desired set. The service validates authorization, protected-role rules, capability ceilings, role status, and the expected user revision before applying additions and removals in one transaction and one audit diff.
- Each administratively editable user has an incrementing revision. Identity edits, activation changes, credential resets, and role changes require the loaded revision. Stale writes return a safe conflict response; session revocation is idempotent.
- Users cannot change their own active state or roles. A user also cannot edit, deactivate, or reactivate a custom role currently assigned to them.
- Non-owner administrators may add or remove a role only when they possess every capability affected. Role definition edits, deactivation, and reactivation require possession of the union of current and proposed capabilities.
- A non-owner may rename, activate, deactivate, or reset only a non-owner whose effective capabilities are a subset of the actor's. This prevents password reset and user mutation from bypassing non-escalation.
- Session revocation is exempt from the target capability ceiling for incident containment, but it still requires the session capabilities and confirmation for owner sessions.
- The owner may define and assign roles containing any registered capability without gaining that runtime capability. The owner may manage any non-owner.
- Delegated administrators cannot rename, reset, deactivate, or change roles on the owner. They may inspect and revoke owner sessions. The owner may rename their own username and change their own password.

### 6. Ownership and Recovery

- Each organization has exactly one active owner represented independently of role membership. The owner must also hold Administrator, but ownership itself grants no implicit endpoint capability.
- The current owner's Administrator role and active state cannot be removed. Self-disablement and self-service role mutation remain prohibited.
- Only one ownership transfer may be pending. The current owner initiates it for another active Administrator after reauthentication.
- The current owner retains ownership until the nominee accepts after their own reauthentication. Acceptance atomically moves ownership and leaves the former owner's Administrator role unchanged.
- Either party may cancel before acceptance. A transfer expires after 72 hours. Disabling either party or removing the nominee's Administrator role cancels it.
- High-impact reauthentication checks the current password and records elevated assurance only in the server session for five minutes. No elevation token is exposed to client JavaScript.
- One-time owner bootstrap creates an ordinary local user, Administrator assignment, and ownership in one transaction. It adds Clinician only when the operator selects the explicit option. No default owner credential exists.
- Installation setup is incomplete while no owner exists, and Admin and clinical work remain blocked.
- General break-glass reset targets an immutable user ID. Owner recovery uses an organization-scoped owner-reset command rather than a renameable username.
- Break-glass commands require a non-secret operator ID and record command type, target user ID, OS account, hostname, and timestamp. Passwords are read from standard input and never appear in arguments or audit payloads.

### 7. Administrative APIs and UI

- The Users panel defaults to active users sorted by display name. Search matches normalized username and display name. Filters cover active/disabled state and assigned role.
- User lists use stable cursor pagination with a default page size of 50 and indexed server-side predicates.
- User detail exposes identity state, assigned role summaries, credential state without secrets, ownership state, and authorized active-session metadata.
- The Roles panel exposes active roles by default, deactivated-role filtering, protected/custom state, current version, capability set, and aggregate assignee count.
- `roles:read` without `users:read` exposes role definitions and aggregate assignee counts but no user identities.
- `users:read` without `roles:read` exposes assigned role ID, display name, and active/deactivated state but not the detailed capability set.
- Session listing requires both `sessions:read` and `users:read`. Revocation additionally requires `sessions:revoke`.
- Unauthorized Admin tabs are hidden. Direct UI routes and APIs still reject unauthorized access with a forbidden response.
- After a role or user security change, the next server request uses the new authority. A client holding stale navigation state must refresh session state and leave a workspace or panel it no longer has permission to use.
- No state-changing request accepts user, role, capability, ownership, or organization claims from the client as authority.

### 8. Role Portability

- Portable configuration packages may include custom role identities and versioned definitions but never users, credentials, ownership, sessions, or user-role assignments.
- Imports reject protected-role identities, unregistered or system-only capabilities, invalid prerequisites, incompatible schemas, and stable identities with divergent history.
- Import preview includes capability changes and the number of current assignees affected by an update.
- Updating an existing assigned custom role through import follows the same immediate activation and non-escalation rules as an interactive edit.
- Exporting custom role definitions requires `roles:read`. Importing them requires `roles:write`, recent reauthentication, and full validation before atomic activation. Notes remain optional.

### 9. Clinical Demo

- Clinical Demo is an ordinary protected role available in every installation, not a deployment profile or installation setting.
- The demo banner appears only after authentication, only to `clinical:demo` users, and only in Mobile or Stationary mode. It is absent from login and Admin mode. No additional per-record synthetic badge is added.
- Demo tooling is online-only. `clinical:demo` is excluded from offline grants, and Generate, Populate, Clear, and Delete require a current online session.
- Generate Call appears only when no report is open. If the user has one eligible active assigned unit it is selected automatically; multiple units require a choice.
- Generation creates at most one unopened synthetic assignment for the same user and unit. Repeated activation refreshes or focuses the existing call rather than creating another.
- Opening a synthetic call never generates a replacement automatically.
- Populate and Clear operate only on an open synthetic draft. Delete is available for any open synthetic draft after confirmation, regardless of validation state. No demo action applies to an ordinary report or signed record.
- The server requires `clinical:demo` for synthetic-call generation, synthetic-draft deletion, and draft mutations that add or remove demo-owned provenance.
- Every generated synthetic call and resulting report has immutable synthetic provenance and an expiry exactly 24 hours after server creation.
- Expiry deletes signed and unsigned synthetic records and dependent clinical data consistently, retains only non-PHI purge audit facts, removes local browser copies, and permanently rejects delayed queues that target a purged report.

### 10. Demonstration Fixtures

- A demonstration installation uses normal production ownership, password policy, authorization, and ordinary clinical retention. It has no synthetic-demo configuration profile, lax password mode, automatic sample-call setting, login banner setting, or read-only Admin switch.
- The fixture adds one ordinary account: `demo`, initialized with password `opentriagedemo` and no forced first-login password change.
- `demo` receives the protected Demo role for demonstration workflows.
- Fixture credentials are not returned by installation configuration and are not prefilled on the login form.
- Fixture seeding may occur before or after ordinary owner bootstrap, but setup remains blocked until a normal owner exists.
- Bootstrap creates missing fixture accounts and their initial role assignments only. Rerunning it never resets a password, changes active state, or restores removed roles. Fixture changes use explicit schema/data revisions.

### 11. Audit and Data Boundaries

- Append-only audit events cover user creation and edits, activation changes, password and session actions, role versioning, assignment changes, role deactivation/reactivation, protected-role actions, ownership transfer, CLI recovery, demo call generation, synthetic draft deletion, and synthetic expiry.
- Events store actor, target stable identity, timestamp, action, result, safe structured before/after data or hashes, and an optional note.
- No action requires a human-entered reason or note.
- Passwords, password verifiers, session and CSRF tokens, recovery values, secrets, unnecessary source IP, and patient content never appear in administrative audit payloads.
- User and role foreign keys, organization predicates, active-role resolution, username history, assignment intervals, ownership lookups, active sessions, and pagination cursors require supporting indexes.
- Database constraints and transactional locking enforce organization consistency, singular ownership, active-role validity, immutable versions, and last-owner protection in addition to application checks.
- Existing installations do not require data migration. The feature may replace the prior authorization schema and require a database reset and fresh bootstrap. No compatibility alias for retired capabilities remains.

## Testing Decisions

Good tests verify externally observable behavior and durable safety properties rather than class structure, SQL formatting, or private helper calls. Every module in this PRD is tested at the narrowest reliable boundary, with integration and browser coverage for behavior that crosses boundaries.

### Identity and Sessions

- Integration-test user provisioning, forced password replacement, the 72-hour temporary-password boundary, fixed 12-character minimum, reset revocation, disabled-user denial, and constant-result invalid login behavior.
- Test username normalization, case-insensitive uniqueness, permanent historical reservation, display-name validation, and immutable attribution after renames.
- Test session metadata visibility, combined read requirements, individual revocation, idempotency, current-session handling, owner-session confirmation, and audit redaction.
- Extend the existing clinician-session, account-service, cookie, and CSRF tests.

### Authorization and Ownership

- Test every capability against allowed, denied, disabled-user, stale-client, and wrong-organization cases.
- Test every prerequisite combination and confirm `clinical:demo` is unavailable to custom roles.
- Prove role-only authorization and absence of working `installation:administer`, `reports:document`, or direct user grants.
- Test protected role immutability and exact capability sets, including separation of Administrator from clinical access.
- Exercise self-modification prohibitions, target capability ceilings, symmetric add/remove non-escalation, the owner override, and the session-revocation exception.
- Test exactly-one-owner constraints, pending-transfer uniqueness, dual reauthentication, five-minute assurance expiry, 72-hour transfer expiry, cancellation, eligibility loss, atomic acceptance, and owner-account protections.
- Test one-time owner bootstrap, optional Clinician assignment, setup blocking, immutable-ID recovery, owner recovery, and operator attribution.

### User Administration

- Service and API integration tests cover create, rename, display-name edit, disable, reactivate, retained roles, disabled-user role preparation, zero-role users, and separate reactivation/reset behavior.
- Test atomic full role-set replacement, protected assignments, failed all-or-nothing validation, optimistic revision conflicts, and one structured audit diff.
- Test default active-user listing, search, active/disabled and role filters, cursor stability, bounded page size, and indexed behavior at the agreed administrative scale.

### Role Administration and Portability

- Test role creation, naming constraints, active-name uniqueness, optional descriptions, immutable versions, optimistic conflicts, and immediate authorization changes for assignees.
- Test deactivation removing all assignments, inactive-role denial, reactivation as a new version, no assignment restoration, and name reuse.
- Test aggregate-only assignee visibility and limited role summaries under asymmetric read capabilities.
- Test package create/update behavior, absence of assignments and users, protected/system-only rejection, prerequisite validation, divergent-history rejection, affected-user preview, non-escalation, reauthentication, and atomic activation.

### Catalog and Forms Authorization

- Update existing Admin shell, Catalog authoring, Form authoring, and Form publication tests to cover independent read, write, and publish capabilities.
- Verify write-only and publish-without-prerequisite roles cannot activate.
- Verify Configuration Author can inspect and edit drafts but cannot publish or activate.
- Verify publication and activation remain distinct actions authorized by the same publish capability.

### Admin UI

- Component-test Users and Roles list, filters, pagination, editors, role capability selection, protected-role states, stale-conflict presentation, confirmation dialogs, session metadata, and ownership-transfer states.
- Test action visibility for each relevant capability combination and hidden unauthorized tabs.
- Add Playwright journeys for owner provisioning, user creation and forced password change, limited administration, custom-role lifecycle, role assignment, disable/reactivate, session revocation, protected-role assignment, ownership transfer, and no-workspace users.
- Extend existing Admin shell and presentation-mode browser tests and retain keyboard-only, visible-focus, accessible-name, and supported desktop/tablet checks.

### Clinical Demo and Fixtures

- Test banner visibility by role, authentication state, presentation mode, and online status. Confirm no extra per-record badge is introduced.
- Test server denial of generation, provenance mutation, and deletion without live `clinical:demo`.
- Test one-unit and multi-unit generation, one-unopened-call idempotency per user/unit, no automatic replacement after open, and ordinary-call isolation.
- Test Populate, Clear, and Delete across synthetic draft, ordinary draft, validation state, and signed-record boundaries.
- Test exact 24-hour server expiry for calls and signed/unsigned reports, dependent deletion, minimal audit facts, browser cleanup, and permanent delayed-sync rejection.
- Test the `demo` / `opentriagedemo` fixture behavior, protected Demo role assignment, lack of credential prefill, ordinary owner requirement, and bootstrap idempotency after administrative changes.

### Database and Scale

- Database tests cover organization-consistent foreign keys, role/version immutability, assignment intervals, username reservation, atomic role deactivation, user revisions, singular ownership, transfer constraints, active-session indexes, and synthetic expiry indexes.
- Test least-privilege database access and direct attempts to bypass API organization and authorization checks.
- Exercise 10,000-user search, filtering, role resolution, and cursor pagination with bounded result sets and ordinary Admin read targets consistent with the parent Admin Controls PRD.

## Out of Scope

- General Audit Log browsing/export UI; this slice writes the required audit events only.
- Units, vehicles, agency profile, appearance, system settings, configuration history, integrations, and other unrelated Admin panels.
- Multi-agency administration, organization switching, and cross-agency roles. Future multi-agency login may resolve organization from the host/subdomain.
- External identity-provider implementation or account linking.
- Multifactor authentication and self-service forgotten-password delivery.
- Email, SMS, or other temporary-password delivery.
- Role inheritance, deny permissions, direct per-user capability grants, and arbitrary custom capabilities.
- Persistent role drafts or a separate custom-role publication step.
- Reviewer visibility, assignment, or workflow.
- Mandatory administrator-entered reasons or change notes.
- Migration or compatibility support for existing installations, direct capability assignments, or retired capability keys.
- Installation-level synthetic-demo profiles, lax authentication, automatic replacement calls, credential prefill, or username/organization heuristics.
- Offline Clinical Demo tooling.
- Additional synthetic badges on calls or reports.
- Changes to ordinary production clinical retention or archival beyond per-record synthetic expiry.
- Mobile-specific Admin layouts.

## Further Notes

- This PRD is a focused extraction from the broader Admin Controls PRD and supersedes its older user/role and installation-level demo assumptions where they conflict.
- Supabase migrations remain the schema source of truth, while authentication and authorization remain provider-neutral in the Nest/Postgres application layer.
- The current repository already has local credentials, durable sessions, password replacement, direct capability checks, Catalog/Form authoring, an Admin shell, synthetic dispatch generation, demo-data Populate/Clear controls, synthetic draft deletion, and fixture bootstrap. This feature replaces and connects those foundations rather than creating parallel implementations.
- The highest implementation risks are enforcing current role state on every online request, expressing singular ownership and transfer safely at both API and database boundaries, removing broad legacy authorization without missed endpoints, validating demo-owned provenance changes, and coordinating per-record expiry with browser queues.
- The agreed delivery boundary includes schema, application services, APIs, Users/Roles UI, owner bootstrap and transfer, password/session administration, audit writes, Catalog/Form capability splitting, Clinical Demo, fixture changes, and synthetic retention. The feature is complete only when the integrated acceptance journeys pass.
