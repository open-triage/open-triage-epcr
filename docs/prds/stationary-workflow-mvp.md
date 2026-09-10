# Stationary Workflow MVP PRD

## Problem Statement

OpenTriage's current documentation workflow is optimized for mobile field use. A clinician can sign in, see calls assigned through their unit association, open a call, document a focused set of clinical events, save locally while offline, synchronize revisions, and return to an unsigned report. The mobile form intentionally exposes only a small quick-documentation profile, so it cannot collect every required NEMSIS value and cannot currently produce a signable complete report.

Clinicians normally begin documentation on mobile and finish it later on a workstation or tablet. OpenTriage does not yet provide that stationary continuation workflow. It also does not yet prove that its canonical NEMSIS catalog can drive generic controls for every supported datatype, coded-value source, absence state, cardinality, group, and nested repeating structure. Building a second independent form or persistence path would risk divergent records, duplicated synchronization behavior, and inconsistent conflict handling.

The first stationary release must prove that the same clinician can continue the same canonical report on a stationary device, work with the complete NEMSIS hierarchy, retain the mobile workflow's offline and synchronization guarantees, validate the full record, and sign it. The initial layout will be controlled by canonical JSON rather than an administrator interface. Demo-only population controls are needed to exercise all generated fields and make a complete signing journey practical without prepopulating the report before the user requests it.

## Solution

Add a stationary presentation to the existing authenticated workflow. The application will retain the same login and home page for both device modes. A persisted Mobile/Stationary mode control in the top blue application banner, alongside controls such as Logout, will explicitly select the presentation; viewport resolution will affect responsive styling but will not determine workflow behavior or authorization.

Both presentations open and edit the same form-version-pinned canonical encounter document through a shared report-workspace layer. The stationary presentation renders one scrollable record following the NEMSIS hierarchy. A sticky left navigation rail shows the current section, allows jumps between sections, and displays section-level validation state. Non-repeating groups are rendered inline. Repeating groups are rendered as tables whose rows are added or edited through accessible dialogues, including support for nested group structures. Every catalog element is accounted for: patient-care-report and custom-result values receive generated editable controls where appropriate, while agency and configuration metadata are represented read-only.

The stationary renderer is driven by a checked-in, versioned canonical JSON layout that references the canonical NEMSIS data-element catalog and namespaced custom elements by stable identifiers. The configuration controls presentation without redefining catalog-owned datatype, cardinality, coded-value, NV, PN, or structural semantics. Every element remains discoverable in the MVP; applicability may mark or disable a field but will not hide it.

The stationary form reuses the mobile workflow's immediate local persistence, offline queue, debounced server synchronization, stable identities, revision reconciliation, conflict handling, and sync-state feedback. Opening a new assigned call continues to require connectivity, while an already-opened stationary report and its bundled layout remain editable offline. Mobile signing is disabled. Stationary signing is allowed only after full-record blocking errors are resolved, warnings are acknowledged, and dispatch conflicts are resolved. After signing, the report becomes immutable, disappears from active calls, and the user returns to the shared home page.

For demonstration and exhaustive renderer testing, the existing prototype notification will contain Populate and Clear controls. Populate deterministically fills every empty editable NEMSIS element with catalog-valid synthetic data and creates representative instances for repeating groups without overwriting dispatch, mobile, or manually entered data. Generated values carry demo provenance. Clear removes only Populate-generated values and group instances. Both operations pass through the same document mutation, persistence, synchronization, validation, and audit boundaries as ordinary edits, and neither signs the report automatically.

## User Stories

1. As a clinician, I want to use the existing login on either mobile or stationary devices, so that I do not learn or maintain separate authentication workflows.
2. As a clinician, I want the existing shared home page in both modes, so that assigned and open work is presented consistently.
3. As a clinician, I want to select Mobile or Stationary mode from the top blue application banner alongside Logout, so that I can explicitly choose the appropriate documentation interface.
4. As a clinician, I want my selected device mode retained locally, so that I do not need to select it repeatedly.
5. As a clinician, I want to change device mode when automatic or deployment defaults are unsuitable, so that window size or device classification does not trap me in the wrong workflow.
6. As a clinician, I want viewport size to affect layout responsiveness without changing my authorization or calls, so that resizing a window cannot alter operational behavior.
7. As a clinician, I want calls assigned through my existing unit association visible in either mode, so that stationary and mobile use the same current assignment rules.
8. As a clinician, I want to open an assigned call in stationary mode, so that a workstation can be used from the beginning of an encounter when appropriate.
9. As a clinician, I want to see only my own unsigned open reports, so that report ownership remains unambiguous.
10. As a clinician, I want to start a report on mobile and open that exact report on stationary, so that documentation continues without duplication or transcription.
11. As a clinician, I want mobile-entered values already present when I open the stationary form, so that earlier field documentation is preserved.
12. As a clinician, I want stationary edits to use the same canonical report and stable occurrence identities as mobile edits, so that changes reconcile at the correct clinical targets.
13. As a clinician, I want the stationary record presented as one vertically scrollable page, so that I can review the report as a coherent whole.
14. As a clinician, I want stationary sections ordered according to the NEMSIS hierarchy, so that the record follows a recognizable standard structure.
15. As a clinician, I want every supported patient-care-report element discoverable in the stationary form, so that uncommon documentation is not blocked by a focused profile.
16. As a clinician, I want agency and configuration metadata visible as read-only information, so that complete catalog coverage does not imply unsafe clinician editing of system configuration.
17. As a clinician, I want a sticky left section rail to identify my current location, so that a long record remains navigable.
18. As a clinician, I want to select a section in the left rail and jump directly to it, so that I can move efficiently through the report.
19. As a keyboard or assistive-technology user, I want section jumps to move focus meaningfully as well as scroll, so that navigation is accessible.
20. As a clinician, I want section navigation to show errors, warnings, and incomplete state, so that I can locate outstanding work.
21. As a clinician, I want ordinary non-repeating groups displayed inline, so that common fields can be reviewed and edited without opening unnecessary dialogues.
22. As a clinician, I want repeating group occurrences displayed as table rows, so that repeated vitals, medications, procedures, crew members, and other records can be compared efficiently.
23. As a clinician, I want to add or edit a repeating occurrence in a dialogue, so that complex rows can be documented without an excessively wide table.
24. As a clinician, I want nested repeating structures supported by the group editor, so that valid NEMSIS hierarchy is not flattened or lost.
25. As a clinician, I want table rows and values to retain their stable group-instance and occurrence identities, so that edits from multiple presentations target the same data.
26. As a clinician, I want controls generated from canonical datatype metadata, so that each value is captured in an appropriate format.
27. As a clinician, I want exhaustive coded elements presented using their configured choices, so that only permitted values are selected.
28. As a clinician, I want large or external terminology sets searchable, so that coded documentation remains usable without loading an impractical select menu.
29. As a clinician, I want numeric, boolean, date, time, date-time, text, URI, duration, and binary-capable elements given suitable presentations, so that the full catalog can be documented without ad hoc component data models.
30. As a clinician, I want permitted Not Values and Pertinent Negatives available for the applicable element, so that exceptional documentation retains its NEMSIS meaning.
31. As a clinical-system operator, I want datatype, cardinality, coded-value, NV, and PN semantics owned by the canonical catalog rather than layout JSON, so that presentation configuration cannot corrupt the data contract.
32. As a form author, I want the stationary layout to reference elements and groups by stable NEMSIS or namespaced custom identifiers, so that component names never become persisted clinical keys.
33. As a form author, I want every catalog element accounted for exactly once by the full stationary configuration, so that omissions and accidental duplicate placement fail validation.
34. As a form author, I want unsupported or semantically illegal layout overrides rejected with useful paths, so that invalid configurations cannot be published or bundled silently.
35. As a clinician, I want edits saved immediately on the workstation's local storage, so that browser or network interruptions do not lose work.
36. As a clinician, I want local changes synchronized after the same debounce behavior used on mobile, so that persistence behavior is consistent across presentations.
37. As a clinician, I want to see Saved, Saving, Offline or Pending sync, and Conflict state on stationary, so that I understand whether my work is durable and synchronized.
38. As a clinician, I want to continue editing an already-opened stationary report without connectivity, so that a temporary workstation outage does not stop documentation.
39. As a clinical-system operator, I want the first opening of an assigned call to require connectivity in either mode, so that report identity, assignment state, and pinned form version remain authoritative.
40. As a clinician, I want queued stationary changes retried after connectivity returns, so that offline work reaches the server without manual re-entry.
41. As a clinician, I want non-overlapping mobile and stationary edits merged, so that work performed on both presentations is preserved.
42. As a clinical reviewer, I want conflicting edits handled through the existing revision and audit behavior, so that the stationary workflow does not introduce a weaker reconciliation path.
43. As a clinician, I want a report signed elsewhere to become non-editable, so that neither presentation changes an immutable completed record.
44. As a clinician, I want Save and close available on mobile even when documentation is incomplete, so that field documentation can be handed off to stationary.
45. As a clinician, I do not want a mobile signing action presented while the mobile profile cannot collect all required data, so that the interface does not promise an impossible completion path.
46. As a clinician, I want full-record validation on stationary, so that every configured blocking requirement is considered before signing.
47. As a clinician, I want to open a validation finding at its affected section, group, occurrence, or field, so that I can correct the problem directly.
48. As a clinician, I want to acknowledge every warning before signing, so that completion preserves the existing review policy.
49. As a clinician, I want unresolved dispatch conflicts to block signing, so that authoritative dispatch differences are not ignored.
50. As a clinician, I want signing to wait for local changes to synchronize, so that the signed snapshot contains the work I just completed.
51. As a clinician, I want a signed report removed from the active call list and its actionable local cache, so that completed work does not remain available for editing.
52. As a clinician, I want to return to the shared home page after signing, so that I can continue with active work.
53. As a demo user, I want Populate and Clear located in the prototype notification, so that synthetic test controls are visibly separate from clinical workflow actions.
54. As a demo user, I want Populate to fill every empty editable NEMSIS element with deterministic catalog-valid data, so that I can exercise the complete generated form without manually entering hundreds of values.
55. As a demo user, I want Populate to create representative instances for every repeating group, so that table and dialogue behavior can be inspected across the hierarchy.
56. As a clinician, I want Populate to preserve dispatch, mobile, and manually entered values, so that demo assistance cannot overwrite intentional documentation.
57. As a demo user, I want populated values to travel through the normal save and validation path, so that the demonstration tests production boundaries rather than a parallel shortcut.
58. As a demo user, I want Populate to leave signing under my control, so that generated data cannot complete a clinical action automatically.
59. As a demo user, I want Clear to remove only values and groups created by Populate, so that repeated demonstrations do not destroy other encounter data.
60. As a clinical-system operator, I want populated occurrences tagged with demo provenance, so that safe clearing does not depend on guessing from their values.
61. As a contributor, I want automated proof that every canonical NEMSIS element and group maps to a supported generated or read-only presentation, so that catalog completeness is measurable.
62. As a contributor, I want an end-to-end mobile-to-stationary journey covering offline recovery and signing, so that the main workflow is protected against regression.

## Implementation Decisions

### Modules

1. **Shared workflow shell** owns the existing login and home-page experience, explicit presentation-mode selection, application-banner placement, clinician-unit assigned-call visibility, creator-owned open-call visibility, and navigation into the selected report presentation. Device mode is persisted locally and is not an authorization input.
2. **Stationary definition compiler** owns the versioned canonical stationary JSON contract, references to the canonical element catalog, hierarchy and placement validation, presentation-only overrides, custom-element identity validation, and exhaustive catalog-coverage diagnostics. It exposes a compiled immutable stationary definition to the renderer.
3. **Generic stationary renderer** owns the single-page hierarchy, sticky section navigation, active-section tracking, section validation summaries, generic type-based controls, read-only metadata, non-repeating group layout, repeating tables, accessible group-editor dialogues, and nested group presentation. Specialized editors may be registered behind stable group or element identifiers, while a generic control remains available for every supported catalog case.
4. **Shared report workspace** owns the canonical encounter document in use, immediate user-scoped local persistence, queued mutations, debounce and retry behavior, revision tracking, server reconciliation, conflict state, completion detection, and shared sync-state reporting. Mobile and stationary presentation components consume this interface rather than implementing independent persistence protocols.
5. **Demo data controls** own deterministic catalog-valid generation, representative repeating-group creation, demo provenance, and provenance-scoped clearing. The module changes the canonical encounter document through the shared report workspace and does not write directly to storage or bypass validation.
6. **Validation and completion** owns full-record validation projection, section and target association for findings, warning acknowledgements, dispatch-conflict completion gates, stationary-only signing, mobile signing removal or disabling, post-signature navigation, active-list reconciliation, and eligible actionable-cache cleanup.

### Configuration and data model

- The generated NEMSIS 3.5.1 catalog remains the semantic authority for all 453 elements and 88 structural groups, including 37 repeating groups.
- The stationary layout is a checked-in canonical JSON artifact for the MVP. An administrator editor is not required.
- The stationary configuration is designed as a future publication input even though the MVP is authored in source control.
- Shared clinical field rules and separate mobile and stationary presentation concerns remain associated with the same versioned form contract. A report continues to pin its form version and catalog release when opened.
- Configuration can control section and field ordering, labels, help, table columns, inline versus dialogue presentation, and read-only presentation. It cannot redefine catalog-owned datatypes, value sets, cardinality, group ancestry, NV, PN, or standard identity.
- The compiler must account for every canonical element. Patient-care-report and custom-result elements are editable where their ownership permits; agency, custom-configuration, and other system-owned metadata are explicitly represented read-only.
- Every element remains discoverable in this MVP. Conditional applicability may annotate or disable a field but does not remove it from the full page.
- Existing encounter group `instanceId` and value `occurrenceId` identities remain authoritative. UI row indices and component identities are never persisted as clinical identifiers.
- Populate-generated group instances and occurrences carry explicit demo provenance. Clear targets that provenance and never infers ownership from synthetic-looking content.

### Workflow and interactions

- The top blue application banner contains the persisted Mobile/Stationary switch alongside Logout and other application-level controls.
- The prototype notification, rather than the application banner or clinical action ribbon, contains Populate and Clear.
- Viewport size controls responsive CSS only. It does not select authorization, unit association, assigned-call visibility, or immutable workflow mode.
- An installation or deployment may supply an initial device-mode default, but the clinician can explicitly switch and the selection is persisted locally.
- Mobile and stationary use the same existing clinician-unit association. True workstation-to-vehicle linkage is deferred.
- Both modes can list and open assigned calls when the clinician is associated with the relevant unit. Opening remains an idempotent online server command.
- Both modes show only the authenticated clinician's own unsigned open reports under the existing ownership rules.
- Selecting a report opens its mobile or stationary presentation according to explicit device mode; it does not create a second report.
- The stationary record uses a sticky header for encounter context, synchronization status, validation summary, Save and close, and stationary review/sign actions.
- The left navigation follows configured NEMSIS section order. Scroll position updates its active item, and selecting an item scrolls and moves focus to the corresponding section.
- Repeating groups are summarized as tables. Add and edit actions open a catalogue-driven dialogue; nested groups are edited within the occurrence workflow instead of being flattened into unrelated rows.
- Existing enhanced time, medication, and procedure behaviors should be reused behind the generic renderer where they already express correct catalog semantics.
- Mobile retains Save and close and its focused quick-documentation interface. Mobile Review and sign entry points and signing actions are removed or disabled for this MVP.
- Stationary uses the full definition for validation. Blocking errors, unacknowledged warnings, unresolved dispatch conflicts, pending synchronization, or offline state prevent signing.
- Successful stationary signing makes the report immutable, removes it from the active call list, purges its eligible actionable cache, and returns the clinician to the home page.

### Persistence and API contracts

- The canonical encounter document and existing revisioned draft mutation contract remain the only clinical editing representation.
- The mobile synchronization implementation is extracted behind the shared report-workspace boundary rather than copied into the stationary page.
- Immediate local persistence, debounced server saves, queued retry, conflict reconciliation, and completion polling behave consistently in both presentations.
- Already-opened reports and their compatible bundled definitions are available offline. Authentication and first assignment opening continue to require connectivity.
- Stationary mutations identify a stationary client/device for existing audit metadata without granting that client additional authorization.
- Server-side creator ownership, organization checks, form-version pinning, idempotent commands, append-only reconciliation auditing, signed immutability, and post-signature attempt retention continue to apply.
- The active-report and open-call contracts are reused. Necessary additions may expose the compatible published presentation definition and validation findings organized by stable section and target identifiers.
- Populate and Clear use ordinary draft mutations and revision checks. They do not update signed records or bypass authorization.
- Successful signing must be followed by active-report reconciliation so the signed report is absent from subsequent active-call results and cannot be reopened as a draft.

## Testing Decisions

- Good tests verify externally observable behavior and durable contracts rather than component structure or private implementation details.
- All six modules will be tested.
- Shared workflow-shell tests cover the unchanged login/home experience, application-banner placement of the mode switch, local mode persistence, explicit switching, identical clinician-unit call visibility, creator-owned open calls, and the fact that viewport resizing does not change authorization or workflow mode.
- Stationary-definition tests validate legal configuration, unknown identities, illegal semantic overrides, duplicate placement, missing placement, group ancestry, custom namespaces, and exact accounting for all 453 catalog elements and all structural groups.
- Generic-renderer contract tests use representative catalog metadata to cover every datatype family, inline and externally sourced codes, single and repeating elements, NV, PN, nillability, non-repeating groups, repeating groups, and nested groups.
- Renderer interaction tests cover one-page section order, active left-navigation tracking, section jumps and focus, validation badges, read-only metadata, table summaries, dialogue add/edit/remove behavior, stable identities, and keyboard and screen-reader behavior.
- Shared report-workspace tests cover immediate local save, debounce, offline editing, queue persistence, reconnect retry, browser restart, disjoint mobile/stationary changes, same-target conflicts, server completion detection, and signed immutability.
- Demo-control tests prove that Populate is deterministic, fills every empty editable element, creates representative repeating structures, preserves existing values, marks provenance, uses normal mutations, and never signs. Clear must remove all and only generated values and generated group instances.
- Validation-and-completion tests cover catalog-wide validation projection, section targeting, correction navigation, warning acknowledgement, unresolved dispatch conflicts, pending-sync signing prevention, stationary signing, mobile signing absence, post-signature navigation, active-list removal, reopen prevention, and actionable-cache cleanup.
- An automated model-completeness gate proves that every canonical element and group is supported by a generic control, registered enhancement, or explicit read-only presentation. Adding or changing a catalog release without updating renderer coverage fails the gate.
- A Playwright journey starts a report in mobile mode, enters mobile documentation, saves and closes, switches presentation mode from the top application banner, reopens the same report in stationary mode, exercises scalar, coded, NV, PN, and repeating-group edits, verifies an offline/reconnect cycle, uses Populate and Clear safely, repopulates, resolves validation, signs, returns home, and verifies the signed call is gone.
- Accessibility coverage includes the long-page section navigation, active-section announcement, focus movement, table/dialog interaction, exceptional-value choices, validation navigation, and signing flow.
- Existing mobile journey, browser-persistence, encounter-document, form-profile, model-completeness, interface-composition, review-flow, draft-report, active-report reconciliation, and signing tests provide prior art and regression coverage.

## Out of Scope

- An administrator UI for configuring, previewing, or publishing stationary layouts.
- True device-to-vehicle enrollment, pairing, reassignment, verification, or revocation.
- Using screen resolution as the authoritative device-mode decision.
- Cross-user draft access, report ownership transfer, crew handoff, shared authorship, or reviewer takeover.
- Completed or signed-report history on the home page.
- Mobile review and signing.
- Opening a previously unopened assignment while offline.
- Hiding non-applicable elements through conditional presentation rules.
- A separate stationary encounter schema, database representation, save API, or conflict policy.
- Hard locks that prevent simultaneous mobile and stationary editing.
- Production availability of Populate or Clear.
- Production patient data or a production-clinical claim for the synthetic demonstration controls.
- A production administrator workflow for custom elements or form migration.
- Physical-device enrollment or proof of tablet, phone, or workstation hardware identity.
- Performance optimization or virtualization without measurements showing that the complete page requires it.
- Completed-record review, amendments, case review, billing review, or quality-assurance workflows.

## Further Notes

- The main assumption under test is that one catalog-driven renderer can handle every NEMSIS structural and datatype case while editing the same canonical document used by mobile. A need for many element-specific data models would disprove the intended generic boundary; bounded presentation enhancements do not.
- MVP success requires both exhaustive automated catalog coverage and an end-to-end mobile-start, stationary-finish, offline/reconnect, sign-and-disappear journey.
- The checked-in JSON is deliberately the first authoring surface. The future administrator editor should manipulate this validated contract rather than define a second configuration model.
- The catalog contains configuration and demographic material that is not ordinary clinician-entered PCR content. Covering every catalog element therefore means editable controls where clinically appropriate plus explicit read-only presentation for system-owned data, not universal editability.
- Populate is an explicit user-triggered demo action rather than an initially prefilled report. Its generated content must be obvious as synthetic and removable without affecting real user or dispatch content.
- The existing synchronization behavior is currently coupled partly to the mobile page and focused encounter reducer. Extracting a shared report workspace is necessary reuse work, not a requirement to reuse the mobile visual component tree.
- The existing backend already supplies important foundations: form-version pinning, a canonical form definition, stable group and occurrence persistence, idempotent report commands, revision reconciliation, audit retention, active-report polling, and signed immutability.
- The current form-profile compiler supports only the focused mobile event types. The stationary compiler is a deeper general-purpose contract and should not be forced into that narrow type model.
- The first implementation step is to define the stationary JSON schema, generate the canonical full-hierarchy configuration from the pinned catalog, and add the exact-coverage test before building the visual renderer.
