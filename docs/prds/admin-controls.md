# Admin Controls PRD

## Problem Statement

OpenTriage installations need a secure, understandable way to administer the people, permissions, operational resources, clinical configuration, and installation settings that make the documentation workflow function. Today, important behavior is spread across seeded database records, committed configuration, hard-coded demo credentials, generated catalogs, and application constants. An agency cannot safely manage users, tailor its stationary documentation, inspect configuration history, or transfer reusable configuration without developer or database access.

The first administration release must serve one agency per installation. It must support real, database-backed administration without prematurely implementing multi-agency control, reviewer workflow, external identity providers, localization authoring, or integration credential management. A demonstration installation uses the same runtime and ownership model as production; its only installation-specific additions are two synthetic fixture users with deliberately limited role assignments.

## Solution

Add an online-only Admin mode to the existing application endpoint alongside Mobile and Stationary modes. Access is derived from durable users, roles, and capabilities and is enforced by the API and database. The Admin experience uses the Stationary interface's tabbed, collapsible visual language and reusable controls.

Provide administrative areas for users, roles, units and vehicles, agency profile, data catalogs, validation, Stationary forms, appearance, system settings, configuration history, audit history, and read-only integrations. Configuration is represented by schema-validated, versioned canonical JSON, with relational projections where needed for integrity and performance. Published configuration is immutable. Reusable, non-agency-specific configuration can be transferred as atomic JSON packages, and a historical package can be re-imported to roll back by creating a new active revision.

Replace the current demonstration-only session mechanism with provider-neutral local credentials and durable secure sessions while leaving room for a future Swedish external identity provider. Maintain clinical resilience during connectivity interruptions through time-limited, clinician-only offline grants; Admin mode always requires connectivity.

Treat catalog validation as agency-authoritative. NEMSIS-derived rules and metadata are useful starting points and optional diagnostic inputs, not unchangeable US reporting requirements. Versioned catalogs may adapt recommended and third-party code lists, requirements, ordering, defaults, and validation to Swedish agency practice without changing immutable element identities or storage datatypes.

Represent clinical demonstration behavior as a protected, assignable role rather than an installation mode. The Clinical Demo role exposes an authenticated clinical banner and explicit tools to generate a synthetic call, populate or clear an open synthetic draft, and delete that draft. Generated synthetic records carry their own 24-hour expiry. No runtime behavior depends on recognizing a hard-coded organization, installation, username, or deployment profile.

## User Stories

1. As an installation owner, I want a secure administration workspace, so that I can operate the installation without direct database access.
2. As an authorized user, I want Mobile, Stationary, and Admin choices to appear according to my roles, so that one application supports my permitted work.
3. As a clinician-administrator, I want the application to open in clinical mode by default, so that possessing admin rights does not place me in an administrative context accidentally.
4. As a clinician-administrator, I want to deliberately switch into Admin mode, so that privileged activity is an explicit action.
5. As a clinician with an open report, I want Admin mode to require that I save and close it first, so that patient context and unsaved clinical state do not leak into administration.
6. As an administrator, I want Admin mode to use the Stationary interface's aesthetics, tabs, collapsible sections, dialogs, and pickers, so that the application remains visually and behaviorally consistent.
7. As an administrator, I want a dashboard without patient data, so that I can see configuration, security, and operational status safely.
8. As an administrator, I want the dashboard to show drafts, current form and catalog versions, disabled users, security issues, and failed jobs, so that important administrative work is discoverable.
9. As an administrator, I want infrastructure and background-job status to be read-only, so that ordinary administration cannot accidentally operate deployment infrastructure.
10. As an installation owner, I want to create users with local credentials, so that the first release does not depend on an external identity provider.
11. As an administrator, I want to enter a temporary password when creating or resetting a user, so that provisioning works without email infrastructure.
12. As a newly provisioned user, I want to replace my temporary password before entering a workspace, so that an administrator does not retain knowledge of my working password.
13. As an administrator, I want password resets to revoke existing sessions, so that a compromised credential cannot leave active access behind.
14. As an operator, I want web and CLI password resets to use the same service, so that all reset paths enforce identical expiry, revocation, and audit behavior.
15. As an installation operator, I want to create the first owner through a one-time secure CLI, so that production never ships with default credentials.
16. As an installation operator, I want an audited break-glass CLI reset for an existing owner or user, so that access can be recovered without creating an unaudited identity.
17. As an administrator, I want usernames to be case-insensitively unique and renameable, with prior names permanently reserved, so that sign-in identifiers can change without rewriting clinical authorship or enabling ambiguous reuse.
18. As an auditor, I want historical actions to reference immutable user identities, so that username and display-name changes do not obscure attribution.
19. As an administrator, I want to disable and reactivate users rather than delete them, so that referenced clinical and audit history remains intact.
20. As a security administrator, I want disabling a user to revoke their online sessions, so that removal of access takes effect immediately for connected devices.
21. As an administrator, I want to inspect and revoke active sessions, so that lost or shared devices can be contained.
22. As an administrator, I want to manage user-to-role assignments, so that access reflects current responsibilities.
23. As an installation owner, I want protected Clinician, Administrator, Configuration Author, and Clinical Demo roles, so that every installation begins with understandable baseline roles.
24. As an administrator, I want to create custom roles from a fixed capability registry, so that duties can be separated without inventing unsafe permissions.
25. As an administrator, I want role definitions to be versioned and auditable, so that permission changes are explainable.
26. As an administrator, I want roles deactivated rather than deleted and explicitly reactivated without restoring prior assignments, so that historical authorization remains understandable without silently reviving access.
27. As a limited administrator, I want to add or remove only capabilities I possess, so that delegated administration cannot become either self-escalation or denial of higher-privileged access.
28. As an installation owner, I want only an owner to grant or remove the protected Administrator and Clinical Demo roles or transfer ownership, so that the highest-risk privileges remain controlled.
29. As an installation owner, I want the system to prevent disabling or stripping the last owner, so that the installation cannot lock itself out.
30. As an administrator, I want self-disablement and self-service role modification prohibited, so that privilege changes remain deliberate and independently attributable.
31. As a future product developer, I want a reserved Reviewer identity in the authorization model, so that reviewer workflow can be added later without exposing a nonfunctional role now.
32. As a clinician, I want an already-open report to remain editable during a connectivity interruption, so that care documentation is resilient in the field.
33. As a clinician, I want a previously cached report to reopen offline within a configured grant lifetime, so that a page reload does not destroy field usability.
34. As a clinician, I want queued offline changes preserved if my online session expires, so that I can reauthenticate and synchronize without losing work.
35. As a security administrator, I want offline grants to contain clinician capabilities only, so that administrative access is never cached for offline use.
36. As an administrator, I want Admin mode to require a current online session, so that privileged data and mutations always reach the authorization boundary.
37. As an administrator, I want each Admin panel and action separately authorized, so that entering Admin mode does not imply unrestricted administration.
38. As an administrator, I want to manage agency-local units, vehicles, call signs, default forms, active state, and clinician assignments, so that dispatch and documentation routing remain operable.
39. As an administrator, I want referenced units and vehicles deactivated rather than deleted, so that reports and assignments retain their operational history.
40. As a dispatcher or clinician, I want deactivating a unit to stop new assignments without cancelling existing work, so that administration cannot silently destroy operational or clinical state.
41. As an administrator, I want to manage the agency profile, identifiers, contacts, address, time zone, and report-linked demographics, so that reports use current agency information.
42. As a clinician, I want each report to retain its original agency-demographic version, so that later profile edits do not rewrite historical documents.
43. As an administrator, I want to inspect and edit the active element catalog through guided controls, so that clinical configuration does not require hand-editing database rows.
44. As an administrator, I want to clone the active catalog into a draft, so that I can prepare changes without affecting clinical work.
45. As an administrator, I want a published catalog version to be immutable, so that forms and reports remain reproducible.
46. As an administrator, I want to create agency custom elements and groups with stable qualified identities, so that local clinical needs can be represented portably.
47. As an administrator, I want element identity, base datatype, and storage semantics to remain immutable, so that configuration cannot reinterpret stored clinical values.
48. As an administrator, I want to change labels, help text, applicability, validation constraints, and enabled state in a new catalog version, so that the catalog reflects agency practice.
49. As an administrator, I want code-list entries to be added or disabled but never removed, so that historical values always remain resolvable.
50. As an administrator, I want code-list order and defaults to be configurable, so that common selections can be prepared for future optimized documentation workflows.
51. As a clinician, I want a configured default to require an explicit future selection action rather than become a silent assertion, so that defaults do not fabricate clinical data.
52. As an administrator, I want recommended and third-party code lists to use the same manual administration model in v1, so that the agency is not dependent on a live terminology service.
53. As an administrator, I want third-party lists to record code-system identity, version, source, date, and provenance, so that their meaning is not ambiguous.
54. As an interoperability owner, I want officially fixed code identities protected for now, so that an administrative label edit cannot silently change a standard code's meaning.
55. As an administrator in Sweden, I want agency validation to override imported NEMSIS requiredness, so that irrelevant US fields do not block documentation.
56. As an administrator, I want declarative datatype, range, pattern, coded-value, requiredness, conditional, severity, message, and cross-element rules, so that validation can express agency requirements without executable code.
57. As a security operator, I want arbitrary JavaScript, SQL, and executable validation extensions prohibited, so that imported configuration cannot execute code.
58. As an interoperability specialist, I want optional NEMSIS conformance diagnostics, so that compatibility can be assessed without overriding agency-authoritative validation.
59. As a clinician, I want ordinary validation rules to apply only when their targeted elements are in the active form's scope, so that omitted Stationary fields do not create irrelevant findings.
60. As a safety owner, I want explicitly global report rules to remain applicable across forms, so that a critical rule cannot disappear accidentally through presentation configuration.
61. As an administrator, I want a structured Stationary form builder, so that I can manage sections, fields, order, code lists, defaults, and presentation without treating raw JSON as the primary editor.
62. As an administrator, I want form drafts to be editable with stale-revision conflict detection, so that concurrent work is not silently overwritten.
63. As an administrator, I want only one active editable draft per configuration domain, so that v1 publication dependencies remain understandable.
64. As an administrator, I want published form versions to be immutable and permanently pinned to their creation catalog, so that deployed documentation never changes underneath users.
65. As an administrator, I want to clone a published Stationary form into a new draft, so that changes produce a new version rather than mutate history.
66. As an administrator, I want an interactive synthetic preview using the real Stationary controls, so that I can inspect a form before publication without creating a clinical report.
67. As an administrator, I want structural validation and a change summary before publishing, with an optional note, so that form changes are deliberate and reviewable without mandatory free text.
68. As an administrator, I want publication and activation to be separate, so that a valid form can exist without immediately affecting new reports.
69. As an administrator, I want an agency default Stationary form with optional per-unit overrides, so that form selection follows an explicit hierarchy.
70. As a clinician, I want a new report to pin the selected form version immediately, so that later default changes cannot alter my report.
71. As an administrator, I want form retirement blocked while default assignments reference it, so that report creation never falls through to an arbitrary form.
72. As a clinician, I want retired forms to continue rendering existing reports, so that retirement never damages clinical history.
73. As a product owner, I want Mobile form configuration treated as legacy and excluded from v1 editing, so that Stationary administration does not entrench or destabilize code scheduled for redesign.
74. As an administrator, I want general settings for agency name, time zone, session and idle limits, password policy, offline lifetime, bounded synchronization settings, report signing, and ordinary clinical retention, so that operational policy is visible and controlled.
75. As a security owner, I want password hashing, token entropy, rate limiting, audit logging, and minimum production authentication bounds to be non-configurable safety floors, so that an administrator cannot disable foundational protections accidentally.
76. As an administrator, I want infrastructure-derived database, deployment, build, and service details to be read-only, so that status is visible without exposing ordinary mutation paths.
77. As an administrator, I want to set an agency-local accent palette, logo, display name, and browser colors with a live preview, so that the installation can be branded safely.
78. As a user with low vision, I want invalid contrast prevented and critical states represented by more than color, so that agency branding does not make the application inaccessible.
79. As an administrator, I want integrations in a separate read-only panel with safe status and failure metadata, so that I can diagnose availability without viewing or changing secrets.
80. As an administrator, I want immutable, filterable audit history for authentication, identity, permission, configuration, import, and retention events, so that material actions are attributable.
81. As an auditor, I want audit events to contain safe before/after hashes or diffs without passwords, tokens, secrets, or patient content, so that accountability does not create another sensitive-data store.
82. As an auditor in a production installation, I want filtered administrative events exportable as JSON or CSV, so that approved external review is possible.
83. As a configuration author, I want reusable configuration exported as a versioned JSON package, so that forms, catalogs, and unassigned custom role definitions can move between agencies.
84. As a privacy owner, I want users, assignments, units, vehicles, agency profiles, active branding, credentials, and integrations excluded from portable packages, so that transfer does not expose agency-specific data.
85. As a configuration author, I want custom elements and groups to use stable publisher-qualified identities, so that imported packages do not collide silently.
86. As an administrator, I want imported package dependencies and identities validated before activation, so that partial or ambiguous configuration cannot enter service.
87. As an administrator, I want a package import to activate all affected domains atomically, so that the installation never observes a partially applied package.
88. As an administrator, I want imported configuration applied immediately after validation, so that import does not create an additional unpublished staging workflow.
89. As an administrator, I want to roll back by importing a historical configuration snapshot, so that rollback follows the same validation and activation rules as any import.
90. As an auditor, I want configuration history, package hashes, change notes, and safe diffs retained indefinitely, so that every active revision has durable provenance.
91. As an administrator, I want consequential changes to accept an optional note without requiring one, so that administration is never blocked by mandatory free text while audit history remains structurally complete.
92. As an installation owner, I want Clinical Demo access assigned through a protected role, so that synthetic clinical tools can be enabled per user without changing installation behavior.
93. As a Clinical Demo user, I want an explicit banner button to generate one synthetic call for an assigned unit, so that calls are created deliberately rather than replenished automatically.
94. As a Clinical Demo user, I want Populate, Clear, and Delete actions for my open synthetic draft, so that I can exercise and reset the clinical workflow without affecting ordinary reports.
95. As a security owner, I want every demo-only mutation authorized server-side, so that hidden UI controls cannot be invoked without the Clinical Demo role.
96. As a privacy owner, I want synthetic calls and reports to expire 24 hours after server creation, so that their deletion is independent of ordinary installation retention.
97. As an offline user, I want expired local synthetic records removed and permanently rejected after server purge, so that delayed synchronization cannot resurrect deleted reports.
98. As a demo administrator, I want the existing `demo.admin` / `open-triage-demo` fixture login to have only Configuration Author and Clinical Demo access, so that it reproduces the current authoring and clinical demo without full administration or publication rights.
99. As a demo clinician, I want the existing `demo.clinician` / `open-triage-demo` fixture login to have only Clinical Demo access, so that the ordinary clinical journey remains distinct from administration.
100. As an installation operator, I want demo installations to use the normal one-time owner bootstrap and production security policy, so that demonstration does not create a privileged runtime mode.
101. As a production installation owner, I want a safe baseline with ten-year ordinary clinical retention and automatic deletion disabled until explicitly enabled, so that synthetic record handling cannot alter production retention policy.
102. As an administrator, I want configuration lists to use indexed server-side search and cursor pagination, so that large agencies and catalogs remain responsive.
103. As an administrator, I want Admin workflows usable with keyboard-only input at supported desktop and tablet sizes, so that administration meets accessibility requirements.

## Implementation Decisions

### Modules

1. **Identity and Session Service**
   - Extend the provider-neutral application identity model with local credentials, password state, durable sessions, revocation, and authentication events.
   - Hash credentials with a current password-hashing algorithm and store only hashes. Online clients receive opaque rotating tokens through Secure, HttpOnly, SameSite cookies with CSRF protection.
   - Require passwords to contain 12 to 1,024 Unicode characters. Do not impose composition rules or routine expiry; reject known-compromised values when an offline denylist is available and rate-limit authentication.
   - Make newly issued temporary passwords expire after 72 hours, configurable between 1 and 168 hours. An expired temporary password requires another reset but does not disable the user.
   - Replace browser-local bearer sessions and in-memory server sessions for database-backed operation.
   - Issue separately scoped, time-limited offline grants for clinical work. Offline grants never contain administrative capabilities.
   - Provide one shared reset operation used by authorized Admin actions and operator CLI recovery. Resets mark the entered password temporary/expired and revoke sessions.
   - Require immutable user IDs for general break-glass resets and provide an organization-scoped owner-reset command. Require a non-secret operator ID and record the OS account, hostname, command, target, and timestamp without recording the password.
   - Make the one-time owner bootstrap create ownership plus Administrator by default and accept an explicit option to add Clinician. Permit no default production credential and keep application setup incomplete until exactly one owner exists.
   - Preserve external identity records so a future Swedish identity provider can attach to the same immutable application user.

2. **Authorization Service**
   - Make roles the only assignable authorization source; do not support direct per-user capability grants.
   - Maintain a fixed capability registry containing `clinical:document`, the system-only `clinical:demo`, `admin-dashboard:read`, `users:read`, `users:write`, `credentials:reset`, `sessions:read`, `sessions:revoke`, `roles:read`, `roles:write`, `roles:assign`, `catalog:read`, `catalog:write`, `catalog:publish`, `forms:read`, `forms:write`, and `forms:publish`.
   - Enforce registry prerequisites: write requires the domain's read capability; publish requires read and write; credential reset and session read require user read; session revocation requires session and user read; and role assignment requires user and role read.
   - Retire the legacy `installation:administer` and `reports:document` keys after replacing every authorization check with the granular registry and retaining `clinical:document` as the canonical clinical capability.
   - Ship protected Clinician, Administrator, Configuration Author, and Clinical Demo roles and reserve, but do not expose, the Reviewer system key. Protected role definitions use explicit versioned capability sets rather than future-capability wildcards.
   - Keep Clinician and Administrator orthogonal. Administrator explicitly contains every currently registered administrative capability, but registering a future capability does not add it automatically. Configuration Author contains Dashboard read, Users read, Roles read, Catalog read/write, and Forms read/write. Clinical Demo contains `clinical:document` and `clinical:demo`; only the owner may assign or remove it, and it is not available in the custom-role builder.
   - Permit versioned custom roles assembled from registered capabilities. `clinical:document` may be used in custom roles.
   - Require active custom roles to contain at least one capability. Never delete roles: deactivate them, remove all current assignments atomically, and permit reactivation through a new active version without restoring assignments.
   - Apply a newly activated role version immediately to every assignee. Assign users to the stable role identity, retain immutable prior versions and assignment intervals, and resolve effective capabilities on every authorized request.
   - Save and activate custom-role edits atomically with optimistic concurrency; do not introduce persistent role drafts. Role names are versioned, case-insensitively unique among active roles, and reusable after deactivation.
   - Show Admin mode when a user possesses at least one administrative capability, while authorizing every panel and action independently.
   - Hide unauthorized Admin tabs and deny their direct routes and APIs. `roles:read` without `users:read` exposes aggregate assignee counts but not identities; `users:read` may expose assigned role identity/name/status without the detailed capability set.
   - Prevent users from modifying their own roles or active state or editing a role assigned to themselves. Non-owner administrators may add or remove only capabilities they possess and may change roles only when they possess the union of the current and proposed capability sets.
   - Allow the owner to define and assign roles from any registered capability without receiving runtime access to that capability. Restrict protected Administrator and Clinical Demo assignment/removal and ownership transfer to the owner with recent reauthentication.
   - Model exactly one active owner per organization. Keep the current owner in control during a single pending transfer; require acceptance by an active Administrator within 72 hours, atomically transfer ownership, and allow either party to cancel. Disablement or loss of nominee eligibility cancels the transfer.
   - Prevent delegated administrators from renaming, resetting, deactivating, or changing roles on the owner. They may inspect and revoke owner sessions. The owner may rename their own username and change their own password; owner recovery is CLI-only.
   - Require non-owner credential resetters and user/role mutators to possess every effective capability held by the target. Session revocation is the incident-containment exception. The owner may manage any non-owner.
   - Permit custom role definitions in portable configuration packages but never include assignments. Reject protected identities and unknown capabilities, preview affected assignee counts and capability changes, and apply the same non-escalation rules to import.

3. **Configuration Registry and Package Service**
   - Represent each configuration domain as schema-versioned canonical JSON with a stable identity, revision, status, content hash, author, timestamps, and an optional change note.
   - Treat canonical JSON as authoritative. Maintain normalized relational projections for integrity, indexed lookup, joins, and runtime performance; projections must be verifiable and rebuildable.
   - Support editable optimistic-concurrency drafts and immutable published revisions. Permit one active editable draft per domain in v1.
   - Keep domains independently versioned so a theme or security change does not create a clinical form version.
   - Model package manifests with schema versions, qualified object identities, dependencies, and content hashes.
   - Validate packages completely before opening the short activation transaction. Acquire configuration locks in a consistent order and activate all domains atomically.
   - Apply valid imports immediately. Preserve the complete previous active set in history.
   - Implement rollback as importing a historical snapshot into a new active revision; never move or rewrite history pointers invisibly.
   - Reject unknown incompatible schemas, broken references, identity collisions with divergent history, protected-role replacement, and values below non-configurable security floors.
   - Keep configuration history indefinitely and outside clinical retention policies.

4. **Agency Administration Service**
   - Support user creation, rename, display-name changes, deactivation/reactivation, role assignment, temporary password assignment, and session revocation.
   - Use immutable internal user IDs for authorship. Enforce lowercase, case-insensitively unique local usernames matching `[a-z0-9][a-z0-9._-]{2,127}`. Renames take effect immediately, old names stop authenticating, and all historical names remain permanently reserved.
   - Keep usernames installation-unique in the single-agency release. A future multi-agency release may scope uniqueness by organization and derive organization context from the login host rather than accepting it from the request body.
   - Normalize display names to Unicode NFC, require 1 to 200 trimmed characters, reject control characters, and allow duplicates. Normalize custom role names similarly with a 100-character limit and optional descriptions up to 500 characters.
   - Permit active users with no roles; after authentication they receive a clear no-workspace state. Permit role changes while a user is disabled, keep those roles ineffective, and show the resulting role set before reactivation.
   - Retain assigned roles across user deactivation. Deactivation revokes every session immediately; reactivation requires a fresh login and does not implicitly reset the password.
   - Apply user role-set replacements atomically after validating the complete desired set. Use an incrementing administrative user revision for stale-write detection on identity, credential, activation, and role mutations; session revocation remains idempotent.
   - List active users by default with server-side search over username and display name, active/disabled and role filters, stable cursor pagination, and a default page size of 50.
   - Show active-session start, last activity, expiry, coarse browser/OS label, and current-session status. Keep source IP in restricted security audit data rather than the ordinary Users panel and do not derive geolocation.
   - Support agency-local units/vehicles, call signs, active state, clinician assignments, and default Stationary form assignments.
   - Deactivation stops new assignments but does not cancel or rewrite existing assignments or reports.
   - Version agency profile and demographic data. Reports continue pinning the demographic version selected at creation.
   - Do not include users, assignments, units, vehicles, agency profile, or other agency-local records in portable packages.

5. **Catalog and Validation Service**
   - Clone an active catalog into a draft and publish an immutable version. Existing forms and reports remain pinned.
   - Authorize catalog inspection with `catalog:read`, draft creation/editing/deletion with `catalog:write`, and both publication and activation with `catalog:publish`.
   - Permit new Stationary form drafts to select a non-retired catalog only at creation. Do not implement catalog upgrades for an existing form version.
   - Preserve stable element identity, base datatype, and storage semantics across configuration. Fundamentally different fields require new qualified custom elements.
   - Use publisher namespaces plus immutable element/group keys for portable custom identities. Reject divergent collisions.
   - Permit agency changes to labels, help text, applicability, validation, code-list contents, enabled state, ordering, and defaults through new catalog versions.
   - Never physically remove a code-list item. Disabled values remain resolvable for historical records.
   - For now, preserve identities and official meanings in fixed enumerated NEMSIS lists. Treat NEMSIS requiredness as an overridable source default rather than a signing authority.
   - Handle manually maintained third-party lists like recommended lists. Require stable code-system identity, local version, source, creation/import date, and explicit agency-authored provenance when upstream provenance is unavailable.
   - Support declarative element constraints and catalog-level cross-element rules. Prohibit arbitrary executable validation.
   - Make agency-published validation authoritative for clinician entry and signing. Calculate NEMSIS conformance only as optional diagnostic metadata unless a future profile explicitly enables it.
   - Evaluate ordinary rules only when all targeted elements are within the Stationary form's declared scope. Allow a distinct, explicit global-report rule classification.
   - Store configurable defaults but do not modify current Stationary clinical-entry behavior in this feature.

6. **Stationary Form Administration Service**
   - Build a structured editor for Stationary form metadata, sections, fields, ordering, presentation settings, code-list references, and catalog-derived validation visibility.
   - Keep form-owned concerns limited to presentation and field scope; validation definitions remain catalog-owned.
   - Allow a draft version to change until publication. Make published versions and their children immutable.
   - Pin the catalog version when the form draft is created and prohibit later catalog upgrades.
   - Support clone, validate, preview, publish, retire, and history operations.
   - Require a valid structure and generated change summary before publication; accept but do not require an administrator note. A second administrator's approval is not required in v1.
   - Preview with synthetic, non-persisted data through actual Stationary controls at supported desktop and tablet widths.
   - Separate publication from activation. Resolve new-report form selection as unit override followed by agency default, and block creation when neither is valid.
   - Authorize form inspection and preview with `forms:read`, draft creation/editing/deletion with `forms:write`, and both publication and activation with `forms:publish`.
   - Prevent retirement while a default assignment references the form. Retired forms continue rendering historical reports.
   - Do not expose or modify Mobile form configuration. Existing Mobile behavior remains legacy pending redesign.

7. **Admin Workspace**
   - Extend the existing presentation selector into a role-aware Mobile/Stationary/Admin mode switch at the same application endpoint.
   - Default combined clinician-administrator users to clinical mode. Default admin-only users to Admin mode.
   - Require open clinical reports to be saved and closed before entering Admin.
   - Reuse the Stationary interface language and extract reusable tabs, collapsible sections, pickers, dialogs, validation summaries, and sticky actions where this reduces duplicated behavior.
   - Provide capability-sensitive Dashboard, Users, Roles, Units, Agency Profile, Data Catalog, Forms, Validation, Appearance, System Settings, Configuration History, Audit Log, and Integrations tabs. Hide panels the current user cannot read.
   - Target desktop and tablet browsers. No explicit mobile-admin support is required.
   - Keep Admin out of the clinical service worker and offline caches. Draft recovery occurs through server-side state only.
   - Expose agency-local light/dark accent tokens, logo, display name, and browser/PWA colors with live preview and WCAG contrast validation. Keep clinical severity colors, layout, typography, and interaction behavior fixed.
   - Exclude active agency appearance from portable packages. Packages may define inactive generic presets.
   - Display integration identity, status, last success/failure, and redacted safe metadata in a read-only panel. Do not expose endpoints or secrets when they are sensitive.
   - Display infrastructure, build, deployment, service, and job health as read-only. Do not provide job execution or retry actions.

8. **Administrative Audit Service**
   - Record authentication outcomes, password and session events, user lifecycle, role/capability changes, ownership transfer, configuration draft/publication/retirement, imports, rollbacks, and retention runs.
   - Store immutable append-only events with actor, time, action, target, result, optional note, and safe before/after hashes or diffs. Never require free text to complete an administrative action.
   - Never record passwords, reset values, session tokens, secrets, or unnecessary patient content.
   - Provide indexed server-side filtering and cursor pagination. Permit production JSON/CSV export of filtered events.
   - Do not apply synthetic-record purge to audit or configuration history.

9. **Clinical Demo and Synthetic Retention Service**
   - Make Clinical Demo a protected role available in every production or demonstration installation. Do not use an installation-level demo profile, synthetic fixture flag, banner flag, automatic replacement-call setting, lax authentication policy, read-only Admin mode, or username/host heuristic.
   - Expose the demo banner only after authentication, only to `clinical:demo` users, and only in Mobile or Stationary mode. Do not expose the banner on the login page or in Admin mode and do not add further per-record badges.
   - Make demo tools online-only. Exclude `clinical:demo` from offline grants and require a current server-authorized session for Generate, Populate, Clear, and Delete.
   - Show Generate Call only when no report is open. Create at most one unopened synthetic assignment per user/unit; select the only eligible active assigned unit automatically or require a unit choice when several exist. If one already exists, refresh or focus it instead of creating another.
   - Do not generate a replacement call when a synthetic assignment is opened. Populate and Clear apply only to an open synthetic draft. Delete applies to any open synthetic draft after confirmation, including before validation failure, and never to signed or ordinary clinical records.
   - Enforce `clinical:demo` server-side for call generation, synthetic-draft deletion, and draft changes that add or remove demo-owned provenance.
   - Give every generated synthetic call and resulting report immutable provenance and an expiry exactly 24 hours after server creation. Delete expired signed and unsigned synthetic records and dependencies consistently, retain only non-PHI purge audit facts, remove expired browser copies, and reject delayed queues permanently.
   - Seed only the existing `demo.admin` and `demo.clinician` fixture accounts, both using `open-triage-demo`, with forced first-login password change disabled. Assign Configuration Author plus Clinical Demo to `demo.admin`, and Clinical Demo only to `demo.clinician`.
   - Do not expose or prefill fixture credentials through installation configuration. Rerunning fixture bootstrap creates missing fixture users and initial assignments only; it never resets passwords, reactivates users, or restores removed assignments. Fixture evolution uses explicit migrations.
   - Use normal owner bootstrap and production security policy for demonstration installations. Permit fixture seeding before or after owner creation, but keep application setup incomplete and block Admin and clinical work until a normal owner exists.
   - Keep the browser-only static prototype clinician-only; it does not include Admin mode or database-backed fixture accounts.

### Interfaces and Data Boundaries

- Expand the shared session contract with current roles/capabilities, password-change state, session metadata, and the information required to request clinician-only offline access. Do not trust client-submitted claims for authorization.
- Add capability-protected API resources for the dashboard, identity, roles, units, profile, configuration domains, package operations, catalog/validation, Stationary forms, appearance/settings, history, audit, and integration status.
- Use API-derived organization context for every query and mutation. Do not accept an organization binding from a request body as authority.
- Use least-privilege application database roles and database-enforced organization/authorization boundaries where practical. All foreign-key and authorization-filter columns require appropriate indexes.
- Keep secrets, hashes, tokens, keys, connection strings, and sensitive endpoints outside canonical configuration JSON and ordinary Admin responses.
- Use timezone-aware timestamps and immutable stable IDs throughout versioning and audit records.
- Apply optimistic concurrency to editable resources and return a safe conflict representation for stale writes. Never silently apply last-write-wins to admin configuration.
- Apply form/catalog/validation changes only to newly created reports through their pinned versions. Apply theme and ordinary UI settings on refresh. Apply security-critical user changes immediately to connected sessions. Retention publication never performs deletion inline.
- Require current-password reauthentication for ownership transfer, protected Administrator or Clinical Demo assignment/removal, configuration import/rollback, and other high-impact security actions. Store elevated assurance only in the server session and expire it after five minutes.
- Use stable message keys and locale-ready configuration shapes, while deferring translation administration and complete UI localization.

### Capacity and Performance

- Support at least 10,000 users/units, 100 form and catalog versions, the complete pinned NEMSIS catalog, and 1,000,000 administrative audit events per agency.
- Use indexed server-side search, bounded filters, cursor pagination, and virtualized large code lists. Do not load full administrative collections into the browser.
- Target 500 ms p95 for ordinary Admin reads under the administrative capacity profile, excluding full package validation/import.
- Validate package content outside the activation transaction. Keep activation transactions short and acquire affected domain locks in a stable order.

## Testing Decisions

Good tests verify externally observable behavior and durable safety properties rather than internal class structure, SQL formatting, or component implementation details. Every module and the cross-cutting scale/security profile require automated coverage.

1. **Identity and sessions**
   - Integration-test credential creation, constant-result invalid login behavior, forced password change, durable session rotation/revocation, logout, disablement, reset, expiry, owner recovery, and cookie/CSRF boundaries.
   - Test clinician offline grants separately from online sessions, including expiry, missing admin capability, offline reload, reauthentication before sync/signing, and queued-work preservation.
   - Extend the existing clinician-session and offline-report test patterns.

2. **Authorization**
   - Exercise every protected API capability with allowed, denied, stale-session, disabled-user, and wrong-organization cases.
   - Test singular owner transfer, expiry/cancellation, last-owner protection, self-modification prohibitions, protected-role assignment, symmetric non-escalation, capability prerequisites, role-only resolution, and hidden Reviewer behavior.
   - Verify unauthorized Admin panels are hidden and direct routes and APIs remain denied.

3. **Configuration registry and packages**
   - Unit-test schema parsing, canonical hashing, qualified identity resolution, dependency validation, security floors, and safe diff generation.
   - Database-test immutable publication, optimistic conflicts, one-draft-per-domain enforcement, projection verification, and permanent history.
   - Integration-test successful atomic imports, invalid all-or-nothing imports, concurrent activation, protected-role rejection, and historical re-import rollback.
   - Follow existing form-publication tests that validate canonical hashes, projections, and immutability.

4. **Agency administration**
   - Test permanent username reservation, user deactivation/reactivation with retained roles, active zero-role users, temporary-password expiry, target privilege ceilings, atomic role-set changes, optimistic conflicts, session inspection/revocation, and historical authorship preservation.
   - Test custom-role activation, immediate version effects, deactivation with assignment removal, reactivation without assignment restoration, protected-role immutability, and portable definitions without assignments.
   - Test unit/vehicle assignments, default forms, deactivation with active work, and versioned agency profiles without modifying pinned reports.

5. **Catalog and validation**
   - Test catalog cloning/publication, element identity/datatype immutability, code addition/disablement, historical code resolution, ordering/default configuration, provenance, and custom namespace collisions.
   - Test agency overrides of NEMSIS requiredness, optional conformance diagnostics, declarative rule operators, form-scope applicability, explicit global rules, and rejection of executable content.
   - Verify existing forms and reports remain pinned after later catalog publication.

6. **Stationary form administration**
   - Test draft edits and stale conflicts, fixed catalog selection, clone/publish/retire behavior, optional notes, structural diagnostics, preview isolation, publication versus activation, assignment precedence, and historical rendering.
   - Confirm no Admin operation mutates Mobile form configuration or existing reports.
   - Extend existing form-publication, Stationary layout, validation, signing, navigation, and completion-journey test patterns.

7. **Admin workspace**
   - Component-test shared Stationary pickers, dialogs, tabs, collapsible sections, validation summaries, theme contrast validation, and capability-sensitive actions.
   - Add Playwright journeys for admin-only and combined-role users, clinical-report switch blocking, all top-level tabs, user/role operations, catalog/form publication, import/rollback, and session expiry.
   - Verify Admin data is absent from service-worker and offline caches.
   - Require WCAG 2.2 AA checks, keyboard-only completion, visible focus, accessible names, non-color-only states, supported desktop/tablet layouts, and actual browser interaction tests, following existing accessibility and presentation-mode precedent.

8. **Audit**
   - Test event creation for each consequential action, immutability, redaction, pagination/filtering, production export authorization, and permanent retention.
   - Assert that passwords, tokens, secrets, and patient content never appear in audit payloads.

9. **Clinical Demo and synthetic retention**
   - Test Clinical Demo assignment/removal, authenticated clinical-only banner visibility, exclusion from offline grants, and server denial of every demo-only mutation without the live capability.
   - Test explicit call generation, unit choice, one-unopened-call idempotency, removal of automatic replacement generation, and Populate/Clear/Delete synthetic-draft boundaries.
   - Exercise the unchanged `demo.admin`, `demo.clinician`, and `open-triage-demo` credentials and their exact protected-role assignments without exposing or prefilling credentials through installation configuration.
   - Test 24-hour per-record boundaries for signed and unsigned synthetic reports and calls, dependent deletion, minimal audit facts, browser expiry, delayed offline queues, and permanent server rejection after purge.
   - Verify fixture bootstrap does not overwrite administered fixture accounts, demonstration ownership follows the ordinary production flow, and the static prototype does not expose Admin mode or database-backed fixture accounts.

10. **Scale and database security**
    - Add a bounded administrative scale profile covering search/pagination for users, units, catalog values, configuration history, and audit events, with production-profile follow-up for the agreed capacity targets.
    - Verify indexes supporting foreign keys, organization predicates, capability lookups, active-version resolution, audit cursors, and selected JSON queries.
    - Test least-privilege database access and organization isolation as defense in depth, including direct attempts to bypass API filters.

## Out of Scope

- Multi-agency administration, organization switching, cross-agency roles, and shared fleet or configuration ownership.
- Reviewer role visibility, assignment, review queues, reviewer decisions, or any reviewer workflow.
- Mobile form administration or redesign. Current Mobile form code remains legacy.
- Changes to Stationary clinical documentation that surface catalog defaults as one-click Review choices or cursor-stable dialog choices.
- Localization authoring, translation management, and a complete Swedish/English UI localization release. The architecture must remain localization-ready.
- Multifactor authentication.
- Self-service forgotten-password delivery by email, SMS, or another recovery channel.
- Implementation of the future Swedish external identity provider, identity-provider account linking, or federated provisioning.
- Multi-administrator/four-eyes publication approval.
- Live terminology services, automated third-party terminology updates, or terminology-provider synchronization.
- Catalog upgrades for an existing form version.
- Dispatch/integration endpoint configuration, credential provisioning, secret rotation, vendor mapping, quarantine reprocessing, or integration mutation.
- Manual background-job execution or retry from Admin mode.
- Clinical-record archival. Per-record synthetic expiry performs hard deletion; production archival and deletion require future work beyond configuration visibility.
- A general agency-data export or clone operation.
- Admin mode in the browser-only static prototype.
- Explicit phone/mobile support for Admin mode.

## Further Notes

- The project already contains organization, user, capability, unit assignment, versioned agency demographic, custom element/group, versioned form, locale, publication validation, and immutable clinical-record foundations. This PRD extends and connects those foundations rather than introducing a parallel administration model.
- The current database-backed login is a hard-coded synthetic clinician lookup with in-memory sessions. Replacing it is prerequisite infrastructure, not an optional polish item.
- Existing forms store canonical JSON and publish normalized projections. That pattern is the precedent for other configuration domains.
- Existing reports already pin form, catalog, and agency-demographic versions. New configuration must preserve those reproducibility boundaries.
- Supabase migrations remain the schema source of truth, but authentication and authorization remain provider-neutral in the Nest/Postgres application layer. Future external identity integration should attach to `app_user` rather than replace application authorization.
- The installation remains organization-scoped throughout even though multi-agency UI is out of scope. Server-derived organization context and database defense in depth prevent accidental cross-organization access and preserve a safe future boundary.
- Clinical Demo is ordinary protected-role authorization, not an installation profile. Server enforcement is mandatory for all synthetic actions, and synthetic retention is carried by each generated record rather than an installation-wide policy switch.
- Production security floors apply to every installation, including demonstrations. The minimum password length is always 12 characters.
- The production retention default is ten years with automated deletion disabled until the installation owner explicitly enables it. This PRD does not implement production archival.
- Configuration portability is judged by reuse value to another agency. When classification is uncertain, agency identity, personnel, operational resources, branding, integrations, and credentials remain local.
- Existing installations need not be migrated to this authorization model. They may be wiped and freshly bootstrapped; the implementation must not add legacy capability aliases or data-backfill complexity.
- The Users and Roles vertical slice includes schema, API enforcement, Admin UI, ordinary owner bootstrap and transfer, password reset, session inspection/revocation, audit-event writes, Catalog/Form capability splitting, and the Clinical Demo refactor. The general Audit Log UI and unrelated Admin panels remain separate slices.
- Meaningful remaining implementation risks are safely extracting reusable Stationary controls, modeling catalog-owned validation without breaking current signing, atomic configuration activation across domains, enforcing role changes across live sessions, and coordinating per-record synthetic purge with offline browser state.
- Delivery should proceed as one epic through independently testable vertical slices: identity/session foundation; authorization and ownership; configuration registry/packages; agency administration; catalog/validation; Stationary forms; Admin workspace/settings; audit/history; and Clinical Demo/synthetic retention. Each slice must leave the branch working, and the epic is complete only after the integrated acceptance journeys pass.
