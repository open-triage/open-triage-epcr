# Admin Controls MVP PRD

> **Historical delivery slice; implemented and extended (2026-10-08).**
> Catalog/form authoring and activation are present. [Users and roles](users-roles.md),
> [custom elements/form authoring](custom-elements-and-form-editor.md),
> [Validation](validation-authoring.md), [localization](localization.md),
> [media/agency settings](report-media-notes.md), and [Review](review.md) supersede
> the relevant exclusions below. The current Admin shell exposes authorized,
> functional panels; its earlier eleven-placeholder navigation policy is historical.
> See the [feature index](README.md) for current boundaries and the
> [validation runbook](../runbooks/admin-controls-mvp-representative-validation.md)
> for the separate representative-user acceptance process.

## Problem Statement

A Swedish EMS agency cannot currently configure and activate its Stationary documentation form without developer or database assistance. Form behavior, catalog metadata, validation, synthetic fixtures, and session behavior are spread across generated assets, database records, and application constants. This prevents an installation owner from adapting the product to local clinical practice and leaves no safe end-to-end proof that self-service clinical configuration is viable.

The complete administration vision includes users, roles, units, agency profile, appearance, settings, audit exploration, integrations, portable packages, and advanced catalog and form management. Building all of those areas before testing clinical configuration would delay the most consequential learning: whether a representative administrator can use guided controls to publish a valid Stationary form that clinicians can actually complete and sign against without changing historical reports.

## Solution

Build the smallest secure, database-backed Admin experience that lets one installation owner create a new immutable catalog version, tailor an immutable Stationary form version to that catalog, preview and activate it as the agency default, and prove that a clinician can use it successfully.

The owner will be provisioned through an operator CLI and authenticate through provider-neutral local credentials backed by durable secure sessions. Admin mode will appear beside Mobile and Stationary at the existing application endpoint, use the Stationary interface's visual language, and enforce Administrator capabilities in the API and database.

The MVP catalog editor will support one narrow but meaningful set of agency changes: element-level requiredness and existing constraints, plus adding, labeling, enabling, disabling, re-enabling, ordering, and choosing defaults for values in agency-maintained or recommended code lists. The Stationary builder will clone the active layout into a new form pinned to the newly published catalog. It will add existing catalog elements without duplicates, remove and reorder elements, and remove and reorder sections. A synthetic preview will use the actual Stationary renderer before publication and activation.

New reports will pin the newly active catalog and form versions. Existing reports will remain pinned to their original versions and must continue rendering and validating exactly as before. All broader Admin areas will remain visible as clearly labeled placeholders so the intended information architecture can be evaluated without expanding the functional MVP.

Success means a representative agency administrator completes the entire configuration journey in less than 30 minutes without developer or database help, after which a clinician successfully completes and signs a new report while an older report remains unchanged. Authorization bypass, clinical-data corruption, historical mutation, or failure to complete the configured report is an automatic MVP failure.

## User Stories

1. As an installation owner, I want to administer Stationary clinical configuration without developer or database help, so that the agency can adapt documentation to Swedish practice.
2. As an installation operator, I want to provision the first owner through a secure CLI, so that the installation does not ship with production default credentials.
3. As an installation operator, I want to provision the clinician used in the acceptance journey through the same identity foundation, so that the configured form is tested through a real authorization boundary.
4. As an operator, I want owner and clinician password resets to use one audited pathway, so that recovery behaves consistently.
5. As a newly provisioned user, I want to replace the temporary password entered by an operator, so that the operator does not retain knowledge of my working password.
6. As an owner, I want a durable authenticated session, so that administrative work does not depend on the current in-memory demo session implementation.
7. As a security owner, I want credentials and session tokens protected from browser scripts and logs, so that adding Admin mode does not weaken account security.
8. As an authorized user, I want Mobile, Stationary, and Admin choices shown according to my capabilities, so that one application endpoint supports the work I may perform.
9. As a clinician-administrator, I want clinical mode to remain the default, so that possessing admin rights does not put me in a privileged context accidentally.
10. As a clinician with an open report, I want the application to require Save and close before entering Admin mode, so that patient context and unsaved work do not leak into administration.
11. As an owner, I want Admin mode to reuse Stationary tabs, collapsible sections, dialogs, pickers, and validation presentation, so that the experience is consistent with the product I already know.
12. As an owner, I want a minimal landing page showing the active catalog and Stationary form versions, so that I understand the configuration currently used for new reports.
13. As an owner, I want non-MVP Admin panels to remain visible as unavailable placeholders, so that the future administration structure can be evaluated without implying unfinished controls work.
14. As an owner, I want to clone the active element catalog into one editable draft, so that I can prepare changes without affecting clinical work.
15. As an owner, I want stale catalog saves rejected, so that another tab cannot silently overwrite a newer draft revision.
16. As an owner, I want to change an element's agency-required status, so that irrelevant NEMSIS requiredness does not control Swedish documentation.
17. As an owner, I want to adjust existing element-level constraints supported by the catalog, so that agency validation reflects local practice.
18. As an owner, I want to add a value to an agency-maintained or recommended code list, so that the list can represent a locally needed choice.
19. As an owner, I want to edit the label of a draft code-list value, so that choices are understandable to clinicians.
20. As an owner, I want to disable and re-enable code-list values without deleting them, so that historical values always remain resolvable.
21. As an owner, I want to reorder code-list values with accessible controls, so that common choices appear predictably.
22. As an owner, I want to designate a code-list default for future use, so that the catalog can carry intended selection guidance without silently writing clinical data.
23. As a clinical-record owner, I want published codes and catalog versions to become immutable, so that later editing cannot reinterpret existing reports.
24. As an owner, I want catalog validation errors shown before publication, so that malformed or internally inconsistent configuration cannot become active.
25. As an owner, I want to publish the catalog with a change note, so that the new immutable version has human-readable provenance.
26. As an owner, I want to clone the active Stationary layout into a new form draft pinned to the newly published catalog, so that I can reuse a known layout without mutating or upgrading the old form.
27. As an owner, I want incompatible or disabled references reported during layout cloning, so that the new draft does not hide catalog conflicts.
28. As an owner, I want to add an existing catalog element through a searchable picker, so that I can expand the form without creating new data definitions.
29. As an owner, I want duplicate element placement prevented, so that one field cannot appear ambiguously more than once.
30. As an owner, I want to remove an element from the form, so that the Stationary layout contains only relevant fields.
31. As an owner, I want to reorder an element with keyboard-accessible move controls, so that field sequence matches the documentation workflow.
32. As an owner, I want to remove an ePCR section, so that an irrelevant section does not appear to clinicians.
33. As an owner, I want to reorder an ePCR section, so that the form follows agency workflow.
34. As an owner, I want stale form saves rejected, so that a second browser tab cannot silently replace newer form work.
35. As an owner, I want to preview the draft with synthetic, non-persisted data through the actual Stationary renderer, so that I can verify the form before activation.
36. As an owner, I want the preview to display catalog-owned validation relevant to the form's included elements, so that I can see the behavior clinicians will encounter.
37. As an owner, I want structural validation and a change note required before publication, so that invalid or unexplained form versions cannot be deployed.
38. As a clinical-record owner, I want published form versions to be immutable and permanently pinned to their creation catalog, so that active and historical reports remain reproducible.
39. As an owner, I want publication and activation to be separate explicit actions, so that a published form does not affect clinicians until I choose it.
40. As an owner, I want to activate one form as the agency-wide Stationary default, so that new reports use the intended configuration.
41. As a clinician, I want a new report to pin the active catalog and form versions at creation, so that later configuration cannot change my in-progress report.
42. As a clinician, I want the changed code list and requiredness reflected in the new Stationary report, so that the agency configuration has real clinical effect.
43. As a clinician, I want the added, removed, and reordered elements reflected in the new form, so that the rendered layout matches the owner's configuration.
44. As a clinician, I want the removed and reordered sections reflected in the new form, so that navigation matches the configured workflow.
45. As a clinician, I want to complete and sign the configured report according to agency validation, so that the new form is operational rather than a visual mock-up.
46. As a clinician viewing an older report, I want its catalog, layout, and validation to remain unchanged, so that administration never rewrites clinical history.
47. As an auditor, I want sign-in, catalog publication, form publication, activation, and failed privileged actions recorded immutably, so that MVP configuration changes remain attributable.
48. As a security owner, I want Admin authorization enforced by the API and database rather than trusted to the browser, so that hidden controls cannot be invoked directly.
49. As a test-instance operator, I want synthetic fixtures, sample dispatch assignment, synthetic-data banner, retention duration, authentication values, read-only administration, and export restrictions represented as independent JSON settings, so that test behavior is not inferred from a hard-coded demo identity.
50. As a user, I want the synthetic-data banner and sample fixture behavior to follow the selected test settings, so that the existing demo signals are explicit and reproducible.
51. As a production operator, I want safe production defaults distinct from the demo selections, so that test settings do not become accidental production behavior.
52. As a keyboard-only owner, I want to complete the entire functional Admin journey without a pointer, so that the MVP is accessible.
53. As a user with low vision, I want visible focus, labeled validation, sufficient contrast, and non-color-only states, so that the functional Admin journey meets WCAG 2.2 AA.

## Implementation Decisions

### Identity, Sessions, and Authorization

- Extend the provider-neutral application identity model with local credentials, temporary-password state, durable sessions, revocation, and authentication audit events.
- Provision and reset the MVP owner and clinician through operator CLI commands. Both roles use the same credential-reset service and forced-password-change behavior.
- Use a current password-hashing algorithm and store only hashes. Do not place credentials in configuration JSON, command arguments, logs, or audit payloads.
- Transport opaque rotating session tokens in Secure, HttpOnly, SameSite cookies and protect state-changing requests against CSRF.
- Replace the current database-backed demo login's in-memory session authority for MVP users.
- Ship only the built-in Clinician and Administrator capability sets needed by the acceptance journey. Do not implement role-management UI, custom roles, or ownership transfer.
- Make the API derive the user and organization context from the session. Do not accept client-submitted role, capability, or organization claims as authority.
- Use least-privilege database access and organization/capability-aware database enforcement where practical. Index foreign keys and authorization predicates.
- The protected offline-grant architecture is deferred to the [Protected Offline Clinical Storage PRD](protected-offline-clinical-storage.md). Existing queued clinical-draft behavior should not be intentionally removed, but production-ready offline reload and expired-session recovery are not MVP claims.

### Admin Application Shell

#### Historical unavailable-capability treatment

The policy below applied to the original MVP. The current
[Admin shell](../../apps/web/components/admin-shell.tsx) replaces it with
capability-filtered Dashboard, Users, Roles, Element catalog, Stationary form,
Validation rules, Agency Settings, and Review settings panels. Unimplemented
destinations are not presented as the eleven original placeholders.

The product owner approved the MVP-release visibility rule on 2026-09-10
under cleanup issue 021: all eleven deferred Admin destinations remain visible
and selectable in the Administration panels navigation. Selecting one shows its
named panel with the explicit message `Unavailable in this release`; it must not
show controls, issue a mutation, or imply that the capability is operational.
This applies to Users, Roles, Units, Agency Profile, Validation, Appearance,
System Settings, Configuration History, Audit Log, Integrations, and Advanced
Dashboard. The rule is deliberate release communication, not an indication
that these capabilities are implemented. Revisit it when a panel gains a real,
authorized workflow or when product research calls for a different disclosure
policy.

- Extend the existing presentation selector at the same application endpoint to support the role-aware values Mobile, Stationary, and Admin.
- Combined clinician-administrator users begin in clinical mode. Admin-only users begin in Admin mode.
- Block entry into Admin while a clinical report is open and direct the user to save and close it.
- Reuse or extract the existing Stationary visual primitives for tabs, collapsible sections, dialogs, searchable pickers, validation summaries, and actions.
- Target a desktop browser for the MVP authoring workflow. Responsive tablet-specific authoring polish and phone support are deferred.
- Keep Admin online-only and outside clinical service-worker/offline caches.
- Provide a minimal landing view with the current owner identity, active catalog version, active Stationary form version, and entry into the configuration journey.
- Show placeholders for Users, Roles, Units, Agency Profile, Validation, Appearance, System Settings, Configuration History, Audit Log, Integrations, and advanced Dashboard content. Placeholders must be clearly non-interactive and announce that the capability is unavailable in this release.

### Catalog Authoring

- Store canonical, schema-versioned catalog JSON as the authoritative representation. Use validated relational projections for integrity, runtime lookup, and performance where appropriate.
- Support one editable catalog draft cloned from the active version. Apply revision preconditions to every save.
- Preserve stable element identity, base datatype, and storage semantics. The MVP cannot create custom elements/groups or change these properties.
- Allow editing only of agency requiredness, already supported element-level constraints, and code-list configuration.
- For agency-maintained and recommended code lists, support adding draft values, editing draft labels, enabling/disabling values, reordering values, and selecting a default.
- Never delete a published code value. Published catalog content is immutable; further changes require another catalog version.
- Defaults are configuration only. This MVP does not modify Stationary documentation to preselect, persist, or offer one-click default values.
- Use agency validation as the runtime authority. Imported NEMSIS requiredness is a configurable starting value, not an unchangeable signing requirement.
- Validate the complete canonical catalog, calculate its stable content hash, generate/verify projections, require a change note, and publish it as a new immutable version.
- Do not activate a catalog independently for reports. It becomes clinically relevant through a published and activated form pinned to it.

### Stationary Form Authoring

- Store canonical, schema-versioned form JSON as authoritative and preserve the existing normalized publication projections.
- Provide one form draft at a time with revision-precondition saves.
- Create the MVP form draft by cloning the active Stationary layout into a newly selected catalog. This creates a new form version; it does not upgrade or mutate the old version.
- Copy compatible references and report disabled, missing, or incompatible references for owner resolution.
- Support adding existing catalog elements through a server-backed searchable picker. Reject duplicate placement in both editor validation and the API.
- Support removing and reordering elements and removing and reordering existing sections. Use accessible move controls rather than requiring drag-and-drop.
- Do not support creating a blank form, creating new sections, editing Mobile forms, custom elements/groups, conditional rules, or unit-specific variants.
- Treat forms as field scope and presentation. The catalog owns element validation. Only findings relevant to elements included in the form are displayed and enforced in this MVP.
- Render a desktop synthetic preview through the actual Stationary component path. Preview data is ephemeral and must never create or mutate a clinical report.
- Require structural validation, a generated summary of the edited structure, and a change note before publication.
- Make a published form and its child configuration immutable and permanently pinned to its creation catalog.

### Activation and Clinical Runtime

- Keep form publication and agency activation as distinct explicit owner actions.
- Maintain one agency-wide active Stationary form for the MVP. Unit-specific overrides are deferred.
- Record activation as an immutable event containing the previous and new form/catalog identifiers, actor, time, and change note.
- Select and store the active form and catalog versions when a report is created. Never resolve them dynamically on later reads.
- Ensure the Stationary renderer and signing validator use the report's pinned versions.
- Do not change Mobile form configuration or treat Mobile rendering as an MVP administration target.
- Preserve old catalog/form versions for all historical and in-progress reports. No rollback UI or historical recombination is included.

### Minimal Audit Evidence

- Record immutable events for successful and failed authentication, forced password changes, catalog publication, form publication, form activation, and denied privileged requests.
- Include actor, organization, time, action, target/version IDs, result, change note where applicable, and safe content hashes.
- Never store passwords, raw session tokens, secrets, or clinical content in administrative audit events.
- Do not implement audit browsing, filtering, export, correction, or deletion UI in the MVP.

### Selectable Test and Demo Configuration Foundation

- Define independent schema-validated JSON settings for synthetic fixture enablement, sample dispatch assignment, synthetic-data banner, retention duration, authentication-policy values, read-only administration, and download/export restrictions.
- Ship distinct safe production and synthetic demo baseline JSON. Do not derive behavior from an organization ID, organization name, hostname, credential, or monolithic hard-coded `demo` branch.
- Make the existing synthetic-data banner and sample fixture/dispatch behavior consume their selected configuration values in this MVP.
- Retain the selected 24-hour duration as configuration, but defer the automated server purge and browser-expiry implementation.
- Define read-only-admin and download/export restriction values in the configuration schema, but defer the database-backed demo Admin showcase and its demo-admin login.
- Do not expose a System Settings editor for these controls in the MVP.

### Concurrency, Performance, and Accessibility

- Assume one active owner-author and one draft per catalog/form domain. Parallel drafts, collaborative editing, and merges are deferred.
- Reject stale revisions to protect against overwrites from multiple tabs.
- Support responsive server-side search and bounded pagination over the complete current element catalog. Broader administrative capacity benchmarks are deferred.
- Meet WCAG 2.2 AA for the functional desktop journey, including keyboard navigation, focus management, accessible names, status announcements, non-color-only validation states, and contrast.

## Testing Decisions

Good tests verify externally observable behavior and durable safety properties rather than internal class structure, component boundaries, or SQL formatting. Every functional MVP module requires automated testing; placeholder panels require only shell, accessibility, and non-interaction coverage.

### Identity and Authorization Tests

- Database/API integration tests cover CLI-created users, temporary-password enforcement, successful and failed login, durable sessions, logout, reset revocation, expiry, disabled users, CSRF protection, and capability enforcement.
- Test missing, wrong, or client-forged organization and capability claims.
- Test direct API access to every MVP mutation rather than relying on hidden UI controls.
- Extend the repository's existing clinician-session and PostgreSQL integration patterns.

### Catalog Tests

- Unit-test canonical schema parsing, hashing, element-identity/datatype immutability, supported constraint edits, code addition, label edits, enabled state, ordering, defaults, and duplicate-code rejection.
- Database/API integration tests verify draft revision conflicts, validation failures, immutable publication, relational projection consistency, change notes, and preservation of old catalog versions.
- Test that agency requiredness overrides imported NEMSIS requiredness in runtime validation.

### Form Builder Tests

- Unit-test catalog-to-layout cloning, missing/disabled reference diagnostics, element addition, duplicate prevention, removal, and element/section ordering.
- Database/API integration tests verify stale draft rejection, catalog pinning, structural validation, immutable publication, and separation of publication from activation.
- Component tests cover the searchable catalog picker, accessible move controls, remove confirmations, collapsible sections, validation feedback, and change summary.
- Extend the repository's existing form-publication, Stationary layout, and validation tests.

### Preview and Clinical Acceptance Tests

- Verify preview uses the real Stationary rendering behavior while never creating or changing a clinical report.
- Add an end-to-end browser journey in which the owner changes one code list and one requiredness rule; adds, removes, and reorders elements; removes and reorders sections; previews; publishes; and activates the form.
- Continue the end-to-end journey as a clinician who opens a new report, observes the configured catalog/form behavior, completes the record, and signs it.
- Verify a report created before activation retains its exact catalog, form structure, validation behavior, and rendering.
- Extend existing Stationary navigation, completion, signing, presentation-mode, and browser-persistence journeys.

### Shell, Audit, and Demo-Configuration Tests

- Test role-aware mode availability, clinical default mode, blocking Admin entry while a report is open, online-only behavior, and placeholder semantics.
- Verify required audit events and redaction through database/API integration tests without building an Audit interface.
- Test synthetic fixture, sample dispatch, and banner settings independently to prove they are not keyed to a hard-coded demo identity.
- Verify production baseline settings do not inherit synthetic demo selections.

### Accessibility Tests

- Combine automated accessibility checks with a keyboard-only Playwright journey covering Admin entry, catalog editing, form editing, preview, publication, and activation.
- Test visible focus, accessible names/descriptions, dialog focus management, collapsible state, picker results, reorder announcements, validation status, and non-color-only feedback.
- Follow the repository's existing accessibility journey and Stationary component precedents.

### Success and Failure Evaluation

- Observe at least one representative agency administrator attempting the complete journey without developer/database assistance.
- Success requires completion in less than 30 minutes, successful clinician completion/signing, and unchanged behavior for an older report.
- Treat authorization bypass, data corruption, mutation of a published version or historical report, duplicate form elements, or inability to sign the configured report as an automatic failure regardless of elapsed time.

## Out of Scope

- Functional Users or Roles panels, custom roles, role-definition portability, ownership transfer UI, active-session UI, and routine web provisioning.
- Functional Units, Vehicles, Agency Profile, Appearance, System Settings, Configuration History, Audit Log, Integrations, background-job, or advanced Dashboard panels.
- Configuration package import/export, file downloads, package dependencies, historical import, rollback actions, visual history diffs, and domain-by-domain restoration.
- Multi-agency administration, organization switching, and cross-agency access.
- Multiple active administrator authors, parallel drafts, collaborative editing, merge tools, and rich conflict diffs.
- Blank form creation, new section creation, custom elements/groups, unit-specific form defaults, form retirement, and catalog upgrade of an existing form version.
- Mobile form administration or redesign.
- Changes to Stationary clinical entry that surface configured defaults as one-click choices or cursor-stable dialog options.
- Conditional validation, cross-element rules, global report rules, custom severity/message authoring, and optional NEMSIS conformance diagnostics.
- Fixed official-code identity or meaning modification, code-list grouping, bulk import, third-party terminology import, provenance editing, and live terminology services.
- Localization authoring, translation management, and complete UI localization.
- Theme, logo, and accent-color editing.
- Multifactor authentication, self-service forgotten-password delivery, the future Swedish external identity provider, and federated provisioning.
- Protected offline grants, encrypted reload authorization, and expired-session reconnect handling defined by the [Protected Offline Clinical Storage PRD](protected-offline-clinical-storage.md).
- The read-only database-backed demo Admin experience and demo-admin credentials.
- Automated 24-hour server deletion, browser cache expiry, delayed-sync tombstones, production archival, and production retention execution.
- Audit browsing, filtering, CSV/JSON export, and administrative file downloads.
- Integration status content, integration mutation, endpoints, credentials, vendor mappings, and retry controls.
- Tablet-specific Admin authoring polish, phone support, and broad administrative scale benchmarks.

## Further Notes

- The broader product vision remains documented separately. This MVP intentionally validates only self-service Stationary clinical configuration and its minimum security/runtime dependencies.
- Existing organization, user, capability, form, catalog, clinical report, and version-pinning foundations should be extended rather than replaced with parallel concepts.
- Existing form publication already uses canonical JSON plus normalized projections and provides the preferred pattern for MVP catalog/form configuration.
- The current hard-coded synthetic clinician authentication and in-memory sessions cannot authorize a real Admin workflow; replacing that authority is part of the MVP even though broad identity administration is deferred.
- CLI provisioning/reset is acceptable manual work for this evaluation. A Users panel becomes necessary when an agency needs routine provisioning without an installation operator.
- The MVP supports one agency-wide Stationary default. Unit-specific form selection becomes relevant only when a participating agency demonstrates distinct unit configuration needs.
- Rollback UI is not required. Immutable versions and activation history must nevertheless avoid closing off a later rollback implementation.
- Demo behaviors remain independent configuration fields. The automated purge must be implemented before any test/demo environment is allowed to contain non-synthetic clinical data.
- The read-only demo Admin showcase should be revisited only after the mutable owner journey proves usable; a showcase is not evidence that self-service authoring works.
- Advanced validation should be revisited when a real Swedish agency rule cannot be expressed through element-level requiredness and constraints.
- Custom elements/groups should be revisited when an agency requirement cannot be satisfied by the existing catalog.
- Portable configuration should be revisited when a second agency needs to reuse the first agency's catalog/form work.
- The [Protected Offline Clinical Storage PRD](protected-offline-clinical-storage.md) must be completed before the new session system is represented as fully production-ready for disrupted field connectivity.
- Administrative scale profiles should be added when the corresponding Users, Units, History, or Audit collections become functional.
- The first implementation slice is: operator CLI owner provisioning, forced password replacement, secure sign-in, capability-authorized Admin mode, the Stationary-styled shell with placeholders, and read-only display of active catalog/form versions.
