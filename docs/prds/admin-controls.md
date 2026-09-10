# Admin Controls PRD

## Problem Statement

OpenTriage installations need a secure, understandable way to administer the people, permissions, operational resources, clinical configuration, and installation settings that make the documentation workflow function. Today, important behavior is spread across seeded database records, committed configuration, hard-coded demo credentials, generated catalogs, and application constants. An agency cannot safely manage users, tailor its stationary documentation, inspect configuration history, or transfer reusable configuration without developer or database access.

The first administration release must serve one agency per installation. It must support real, database-backed administration without prematurely implementing multi-agency control, reviewer workflow, external identity providers, localization authoring, or integration credential management. It must also preserve the database-backed demonstration instance as an inspectable test installation whose intentionally extreme behaviors are selected through explicit configuration rather than hidden, hard-coded properties.

## Solution

Add an online-only Admin mode to the existing application endpoint alongside Mobile and Stationary modes. Access is derived from durable users, roles, and capabilities and is enforced by the API and database. The Admin experience uses the Stationary interface's tabbed, collapsible visual language and reusable controls.

Provide administrative areas for users, roles, units and vehicles, agency profile, data catalogs, validation, Stationary forms, appearance, system settings, configuration history, audit history, and read-only integrations. Configuration is represented by schema-validated, versioned canonical JSON, with relational projections where needed for integrity and performance. Published configuration is immutable. Reusable, non-agency-specific configuration can be transferred as atomic JSON packages, and a historical package can be re-imported to roll back by creating a new active revision.

Replace the current demonstration-only session mechanism with provider-neutral local credentials and durable secure sessions while leaving room for a future Swedish external identity provider. Maintain clinical resilience during connectivity interruptions through time-limited, clinician-only offline grants; Admin mode always requires connectivity.

Treat catalog validation as agency-authoritative. NEMSIS-derived rules and metadata are useful starting points and optional diagnostic inputs, not unchangeable US reporting requirements. Versioned catalogs may adapt recommended and third-party code lists, requirements, ordering, defaults, and validation to Swedish agency practice without changing immutable element identities or storage datatypes.

Represent demonstration behavior as independent, visible configuration controls. The demo configuration package selects the 24-hour clinical-record purge, synthetic data, sample dispatch assignment, synthetic-data banner, read-only administration, lax authentication values, and download/export restrictions. A safe production baseline selects production-appropriate values. No behavior may depend on recognizing one hard-coded demo organization or installation identifier.

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
17. As an administrator, I want usernames to be case-insensitively unique and renameable, so that sign-in identifiers can change without rewriting clinical authorship.
18. As an auditor, I want historical actions to reference immutable user identities, so that username and display-name changes do not obscure attribution.
19. As an administrator, I want to disable and reactivate users rather than delete them, so that referenced clinical and audit history remains intact.
20. As a security administrator, I want disabling a user to revoke their online sessions, so that removal of access takes effect immediately for connected devices.
21. As an administrator, I want to inspect and revoke active sessions, so that lost or shared devices can be contained.
22. As an administrator, I want to manage user-to-role assignments, so that access reflects current responsibilities.
23. As an installation owner, I want protected Clinician and Administrator roles, so that every installation begins with understandable baseline roles.
24. As an administrator, I want to create custom roles from a fixed capability registry, so that duties can be separated without inventing unsafe permissions.
25. As an administrator, I want role definitions to be versioned and auditable, so that permission changes are explainable.
26. As an administrator, I want used roles retired rather than deleted, so that historical authorization remains understandable.
27. As a limited administrator, I want to grant only capabilities I possess, so that delegated administration cannot become self-escalation.
28. As an installation owner, I want only an owner to grant the protected Administrator role or transfer ownership, so that the highest privileges remain controlled.
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
67. As an administrator, I want structural validation, a change summary, and a required change note before publishing, so that form changes are deliberate and reviewable.
68. As an administrator, I want publication and activation to be separate, so that a valid form can exist without immediately affecting new reports.
69. As an administrator, I want an agency default Stationary form with optional per-unit overrides, so that form selection follows an explicit hierarchy.
70. As a clinician, I want a new report to pin the selected form version immediately, so that later default changes cannot alter my report.
71. As an administrator, I want form retirement blocked while default assignments reference it, so that report creation never falls through to an arbitrary form.
72. As a clinician, I want retired forms to continue rendering existing reports, so that retirement never damages clinical history.
73. As a product owner, I want Mobile form configuration treated as legacy and excluded from v1 editing, so that Stationary administration does not entrench or destabilize code scheduled for redesign.
74. As an administrator, I want general settings for agency name, time zone, session and idle limits, password policy, offline lifetime, bounded synchronization settings, report signing, retention, and selectable demo behaviors, so that operational policy is visible and controlled.
75. As a security owner, I want password hashing, token entropy, rate limiting, audit logging, and minimum production authentication bounds to be non-configurable safety floors, so that an administrator cannot disable foundational protections accidentally.
76. As an administrator, I want infrastructure-derived database, deployment, build, and service details to be read-only, so that status is visible without exposing ordinary mutation paths.
77. As an administrator, I want to set an agency-local accent palette, logo, display name, and browser colors with a live preview, so that the installation can be branded safely.
78. As a user with low vision, I want invalid contrast prevented and critical states represented by more than color, so that agency branding does not make the application inaccessible.
79. As an administrator, I want integrations in a separate read-only panel with safe status and failure metadata, so that I can diagnose availability without viewing or changing secrets.
80. As an administrator, I want immutable, filterable audit history for authentication, identity, permission, configuration, import, and retention events, so that material actions are attributable.
81. As an auditor, I want audit events to contain safe before/after hashes or diffs without passwords, tokens, secrets, or patient content, so that accountability does not create another sensitive-data store.
82. As an auditor in a production installation, I want filtered administrative events exportable as JSON or CSV, so that approved external review is possible.
83. As a configuration author, I want reusable configuration exported as a versioned JSON package, so that forms and catalogs can move between agencies.
84. As a privacy owner, I want users, assignments, units, vehicles, agency profiles, active branding, credentials, and integrations excluded from portable packages, so that transfer does not expose agency-specific data.
85. As a configuration author, I want custom elements and groups to use stable publisher-qualified identities, so that imported packages do not collide silently.
86. As an administrator, I want imported package dependencies and identities validated before activation, so that partial or ambiguous configuration cannot enter service.
87. As an administrator, I want a package import to activate all affected domains atomically, so that the installation never observes a partially applied package.
88. As an administrator, I want imported configuration applied immediately after validation, so that import does not create an additional unpublished staging workflow.
89. As an administrator, I want to roll back by importing a historical configuration snapshot, so that rollback follows the same validation and activation rules as any import.
90. As an auditor, I want configuration history, package hashes, change notes, and safe diffs retained indefinitely, so that every active revision has durable provenance.
91. As an administrator, I want catalog, form, validation, retention, security, role, import, and rollback changes to require a note, so that consequential configuration has human context.
92. As a test-instance operator, I want demo behaviors represented as individually selectable settings, so that testing can combine them deliberately rather than rely on a hard-coded demo identity.
93. As a test-instance operator, I want to select a 24-hour report purge independently, so that short retention can be tested without implicitly enabling every other demo behavior.
94. As a test-instance operator, I want synthetic seeding and a sample dispatch assignment to be explicit controls, so that fixture creation is visible and repeatable.
95. As a user, I want a synthetic-data banner controlled explicitly, so that simulated clinical content is unmistakable whenever that setting is enabled.
96. As a test-instance operator, I want read-only Admin behavior, lax authentication values, and download/export restrictions selected explicitly, so that each safety or test characteristic can be inspected independently.
97. As a demo administrator, I want every configured panel and value visible while mutations, imports, downloads, and exports are rejected server-side, so that the interface can be evaluated without changing the test instance.
98. As a demo administrator, I want to sign in with `demo.clinician_admin` and `open-triage-demo_admin`, so that the administrative test account is predictable and distinct from the clinician account.
99. As a privacy owner, I want signed and unsigned demo reports deleted when their server creation time is more than 24 hours old, so that the selected short-retention behavior is real.
100. As an offline demo user, I want local copies to expire at the same deadline and be rejected permanently after server purge, so that delayed synchronization cannot resurrect deleted reports.
101. As a production installation owner, I want a safe baseline with ten-year retention and automatic deletion disabled until explicitly enabled, so that demo settings cannot become accidental production defaults.
102. As an administrator, I want configuration lists to use indexed server-side search and cursor pagination, so that large agencies and catalogs remain responsive.
103. As an administrator, I want Admin workflows usable with keyboard-only input at supported desktop and tablet sizes, so that administration meets accessibility requirements.

## Implementation Decisions

### Modules

1. **Identity and Session Service**
   - Extend the provider-neutral application identity model with local credentials, password state, durable sessions, revocation, and authentication events.
   - Hash credentials with a current password-hashing algorithm and store only hashes. Online clients receive opaque rotating tokens through Secure, HttpOnly, SameSite cookies with CSRF protection.
   - Replace browser-local bearer sessions and in-memory server sessions for database-backed operation.
   - Issue separately scoped, time-limited offline grants for clinical work. Offline grants never contain administrative capabilities.
   - Provide one shared reset operation used by authorized Admin actions and operator CLI recovery. Resets mark the entered password temporary/expired and revoke sessions.
   - Preserve external identity records so a future Swedish identity provider can attach to the same immutable application user.

2. **Authorization Service**
   - Maintain a fixed capability registry with separate read, write, publish, security, and ownership-sensitive actions.
   - Ship protected Clinician and Administrator roles and reserve, but do not expose, the Reviewer system key.
   - Permit versioned custom roles assembled from registered capabilities.
   - Show Admin mode when a user possesses at least one administrative capability, while authorizing every panel and action independently.
   - Prevent users from modifying their own roles or active state. Prevent delegated administrators from granting capabilities they do not possess.
   - Restrict protected Administrator assignment and ownership transfer to the current installation owner.
   - Preserve at least one active owner and require acceptance by another eligible administrator before ownership transfer completes.

3. **Configuration Registry and Package Service**
   - Represent each configuration domain as schema-versioned canonical JSON with a stable identity, revision, status, content hash, author, timestamps, and change note where required.
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
   - Use immutable internal user IDs for authorship. Enforce case-insensitive unique local usernames and a reuse cooling-off period.
   - Support agency-local units/vehicles, call signs, active state, clinician assignments, and default Stationary form assignments.
   - Deactivation stops new assignments but does not cancel or rewrite existing assignments or reports.
   - Version agency profile and demographic data. Reports continue pinning the demographic version selected at creation.
   - Do not include users, assignments, units, vehicles, agency profile, or other agency-local records in portable packages.

5. **Catalog and Validation Service**
   - Clone an active catalog into a draft and publish an immutable version. Existing forms and reports remain pinned.
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
   - Require a valid structure, generated change summary, and administrator-entered change note before publication. A second administrator's approval is not required in v1.
   - Preview with synthetic, non-persisted data through actual Stationary controls at supported desktop and tablet widths.
   - Separate publication from activation. Resolve new-report form selection as unit override followed by agency default, and block creation when neither is valid.
   - Prevent retirement while a default assignment references the form. Retired forms continue rendering historical reports.
   - Do not expose or modify Mobile form configuration. Existing Mobile behavior remains legacy pending redesign.

7. **Admin Workspace**
   - Extend the existing presentation selector into a role-aware Mobile/Stationary/Admin mode switch at the same application endpoint.
   - Default combined clinician-administrator users to clinical mode. Default admin-only users to Admin mode.
   - Require open clinical reports to be saved and closed before entering Admin.
   - Reuse the Stationary interface language and extract reusable tabs, collapsible sections, pickers, dialogs, validation summaries, and sticky actions where this reduces duplicated behavior.
   - Provide Dashboard, Users, Roles, Units, Agency Profile, Data Catalog, Forms, Validation, Appearance, System Settings, Configuration History, Audit Log, and Integrations tabs.
   - Target desktop and tablet browsers. No explicit mobile-admin support is required.
   - Keep Admin out of the clinical service worker and offline caches. Draft recovery occurs through server-side state only.
   - Expose agency-local light/dark accent tokens, logo, display name, and browser/PWA colors with live preview and WCAG contrast validation. Keep clinical severity colors, layout, typography, and interaction behavior fixed.
   - Exclude active agency appearance from portable packages. Packages may define inactive generic presets.
   - Display integration identity, status, last success/failure, and redacted safe metadata in a read-only panel. Do not expose endpoints or secrets when they are sensitive.
   - Display infrastructure, build, deployment, service, and job health as read-only. Do not provide job execution or retry actions.

8. **Administrative Audit Service**
   - Record authentication outcomes, password and session events, user lifecycle, role/capability changes, ownership transfer, configuration draft/publication/retirement, imports, rollbacks, and retention runs.
   - Store immutable append-only events with actor, time, action, target, result, reason/change note, and safe before/after hashes or diffs.
   - Never record passwords, reset values, session tokens, secrets, or unnecessary patient content.
   - Provide indexed server-side filtering and cursor pagination. Permit production JSON/CSV export of filtered events.
   - Do not apply the demo clinical purge to audit or configuration history.

9. **Selectable Demo Controls and Retention Service**
   - Define independent configuration controls for synthetic data mode, synthetic-data banner, synthetic bootstrap records, sample dispatch assignment, short clinical retention, authentication-policy values, read-only Admin enforcement, and download/export restrictions.
   - Do not infer any control from an organization name, ID, credential, deployment host, or monolithic hard-coded demo property.
   - Ship a schema-validated demo configuration package that explicitly selects the agreed demo controls and a safe production package that selects production defaults.
   - Expose the selected demo-related values in System Settings even when read-only enforcement prevents changing them in that instance.
   - Enforce read-only Admin, import blocking, mutation blocking, and file-download/export blocking in the API as well as the UI when their controls are selected.
   - Seed the demo administrator with username `demo.clinician_admin` and password `open-triage-demo_admin`. Demo credentials are an explicit synthetic bootstrap concern and are never production defaults.
   - Apply the selected 24-hour purge to signed and unsigned clinical reports using server creation time. Delete dependent clinical records consistently and retain only non-PHI purge audit facts.
   - Publish report expiry to clinical clients. Remove expired local records and prevent offline queues from recreating server-purged reports.
   - Keep the browser-only static prototype clinician-only; it does not include Admin mode or the database-backed admin fixture.

### Interfaces and Data Boundaries

- Expand the shared session contract with current roles/capabilities, password-change state, session metadata, and the information required to request clinician-only offline access. Do not trust client-submitted claims for authorization.
- Add capability-protected API resources for the dashboard, identity, roles, units, profile, configuration domains, package operations, catalog/validation, Stationary forms, appearance/settings, history, audit, and integration status.
- Use API-derived organization context for every query and mutation. Do not accept an organization binding from a request body as authority.
- Use least-privilege application database roles and database-enforced organization/authorization boundaries where practical. All foreign-key and authorization-filter columns require appropriate indexes.
- Keep secrets, hashes, tokens, keys, connection strings, and sensitive endpoints outside canonical configuration JSON and ordinary Admin responses.
- Use timezone-aware timestamps and immutable stable IDs throughout versioning and audit records.
- Apply optimistic concurrency to editable resources and return a safe conflict representation for stale writes. Never silently apply last-write-wins to admin configuration.
- Apply form/catalog/validation changes only to newly created reports through their pinned versions. Apply theme and ordinary UI settings on refresh. Apply security-critical user changes immediately to connected sessions. Retention publication never performs deletion inline.
- Require reauthentication for ownership transfer, protected Administrator assignment, configuration import/rollback, and other high-impact security actions.
- Use stable message keys and locale-ready configuration shapes, while deferring translation administration and complete UI localization.

### Capacity and Performance

- Support at least 10,000 users/units, 100 form and catalog versions, the complete pinned NEMSIS catalog, and 1,000,000 administrative audit events per agency.
- Use indexed server-side search, bounded filters, cursor pagination, and virtualized large code lists. Do not load full administrative collections into the browser.
- Target 500 ms p95 for ordinary Admin reads under the administrative capacity profile, excluding full package validation/import.
- Validate package content outside the activation transaction. Keep activation transactions short and acquire affected domain locks in a stable order.

## Testing Decisions

Good tests verify externally observable behavior and durable safety properties rather than internal class structure, SQL formatting, or component implementation details. All nine modules require automated coverage.

1. **Identity and sessions**
   - Integration-test credential creation, constant-result invalid login behavior, forced password change, durable session rotation/revocation, logout, disablement, reset, expiry, owner recovery, and cookie/CSRF boundaries.
   - Test clinician offline grants separately from online sessions, including expiry, missing admin capability, offline reload, reauthentication before sync/signing, and queued-work preservation.
   - Extend the existing clinician-session and offline-report test patterns.

2. **Authorization**
   - Exercise every protected API capability with allowed, denied, stale-session, disabled-user, and wrong-organization cases.
   - Test owner-transfer invariants, last-owner protection, self-modification prohibitions, protected-role assignment, non-escalation, and hidden Reviewer behavior.
   - For the current release, verify the eleven product-approved unavailable panels remain visible, select only their explicit non-interactive placeholder, and do not weaken denial of unsupported direct API calls.

3. **Configuration registry and packages**
   - Unit-test schema parsing, canonical hashing, qualified identity resolution, dependency validation, security floors, and safe diff generation.
   - Database-test immutable publication, optimistic conflicts, one-draft-per-domain enforcement, projection verification, and permanent history.
   - Integration-test successful atomic imports, invalid all-or-nothing imports, concurrent activation, protected-role rejection, and historical re-import rollback.
   - Follow existing form-publication tests that validate canonical hashes, projections, and immutability.

4. **Agency administration**
   - Test user rename/deactivation/reactivation, username uniqueness and cooling-off, temporary-password assignment, role changes, session revocation, and historical authorship preservation.
   - Test unit/vehicle assignments, default forms, deactivation with active work, and versioned agency profiles without modifying pinned reports.

5. **Catalog and validation**
   - Test catalog cloning/publication, element identity/datatype immutability, code addition/disablement, historical code resolution, ordering/default configuration, provenance, and custom namespace collisions.
   - Test agency overrides of NEMSIS requiredness, optional conformance diagnostics, declarative rule operators, form-scope applicability, explicit global rules, and rejection of executable content.
   - Verify existing forms and reports remain pinned after later catalog publication.

6. **Stationary form administration**
   - Test draft edits and stale conflicts, fixed catalog selection, clone/publish/retire behavior, change-note requirements, structural diagnostics, preview isolation, publication versus activation, assignment precedence, and historical rendering.
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

9. **Selectable demo controls and retention**
   - Test each demo-related control independently and in combinations to prove behavior is not keyed to one hard-coded installation identity.
   - Verify the production baseline does not inherit demo selections.
   - Exercise demo credentials, visible read-only panels, API mutation denial, import denial, and all download/export denial.
   - Test 24-hour boundaries for signed and unsigned reports, dependent deletion, minimal audit facts, browser expiry, delayed offline queues, and permanent server rejection after purge.
   - Verify the static prototype does not expose Admin mode or demo-admin fixtures.

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
- Clinical-record archival. The selected demo policy performs hard deletion; production archival and deletion require future work beyond configuration visibility.
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
- Selectable demo controls must be explicit schema fields with safe defaults and visible effective values. The demo baseline is a convenient preset, not a privileged code path. Server enforcement remains mandatory for controls such as read-only administration and export denial.
- Production security floors remain platform constraints even when authentication-policy values are configurable. A synthetic test configuration may select intentionally lax values only within the explicitly supported test-control model.
- The production retention default is ten years with automated deletion disabled until the installation owner explicitly enables it. This PRD does not implement production archival.
- Configuration portability is judged by reuse value to another agency. When classification is uncertain, agency identity, personnel, operational resources, branding, integrations, and credentials remain local.
- Meaningful remaining implementation risks are the breadth of the migration from the current demo session model, safely extracting reusable Stationary controls, modeling catalog-owned validation without breaking current signing, atomic configuration activation across domains, and coordinating the demo server purge with offline browser state.
- Delivery should proceed as one epic through independently testable vertical slices: identity/session foundation; authorization and ownership; configuration registry/packages; agency administration; catalog/validation; Stationary forms; Admin workspace/settings; audit/history; and selectable demo controls/retention. Each slice must leave the branch working, and the epic is complete only after the integrated acceptance journeys pass.
