# Problem Statement

Administrators can already maintain some local code-list values, but cannot systematically define and deploy custom clinical elements through the catalog. An existing custom-configuration model is not connected to a complete administration and clinical-documentation workflow. The current Stationary form editor has limited section editing, and code-choice enablement and ordering belong to catalog versions even though different fields and forms need different choices.

Clinicians need the resulting fields to work consistently in Mobile and Stationary, including direct correction of flagged fields in the review checklist. They also need fast, searchable choice selectors without a separate concept of defaults or automatic entry of clinical values.

# Solution

Provide catalog authoring for custom elements aligned with the NEMSIS 3.5.1 custom-configuration and custom-result model. Administrators define elements and available codes in the catalog, then configure their presentation and available choices in the renamed **Form editor**. Custom values retain stable identities and their relationships to repeated entries regardless of visual placement.

The Form editor supports creating and naming sections, arranging standard and custom fields, configuring enabled choices and choice order independently for each field, and strengthening field requiredness within catalog constraints. Published versions and historical reports retain their meaning.

Remove defaults entirely. A shared searchable selector makes deliberate selection quick: opening the list places its first option at the original pointer position, with the list extending above the field where space permits, so a second click or tap at that position selects the first option. Typing searches immediately. The review checklist uses normal field controls to edit flagged fields directly in both clinical views.

# User Stories

1. As an administrator, I want to create a custom element in the catalog, so that local documentation needs do not require a developer to add a field.
2. As an administrator, I want to define a custom element's title and meaning, so that clinicians understand what to document.
3. As an administrator, I want custom elements to follow NEMSIS datatype, recurrence, usage, permitted-value, and grouping rules, so that local extensions use a consistent model.
4. As an administrator, I want to define coded choices separately from their use on a form, so that several fields can reuse catalog content.
5. As an administrator, I want to distinguish adding a code to an eligible existing list from creating a new custom element, so that these different operations retain their proper semantics.
6. As an administrator, I want to configure permitted NOT values and pertinent-negative values, so that exceptional documentation follows the element's rules.
7. As an administrator, I want to define standalone custom fields and custom fields associated with repeated entries, so that a value can describe either the report or a particular medication, assessment, or other entry.
8. As an administrator, I want to group custom elements according to NEMSIS semantics, so that related values retain their relationships.
9. As an administrator, I want stable custom-element identifiers that are distinct from standard identifiers, so that labels and layout do not determine data identity.
10. As an administrator, I want to explicitly classify whether a custom element contains identifying information, so that existing analytical access boundaries remain effective.
11. As an administrator, I want to draft, validate, publish, and retire custom elements through the catalog lifecycle, so that local definitions are controlled and historical records remain readable.
12. As an administrator, I want incompatible datatype or meaning changes to require a new element identity, so that old answers are not reinterpreted.
13. As an administrator, I want the administration feature to be named Form editor, so that its purpose is clear across supported clinical views.
14. As an administrator, I want to create, rename, and reorder visual sections, so that the form matches the documentation workflow.
15. As an administrator, I want to add and move standard and custom fields between visual sections, so that the form presents information where clinicians need it.
16. As an administrator, I want field movement to preserve data relationships, so that relocating a medication-related field does not turn it into a report-level value.
17. As an administrator, I want to enable and order choices separately for each field in each form, so that fields sharing a list can offer different subsets and ordering.
18. As an administrator, I want permitted NOT values to participate in field choice configuration, so that exceptional choices are available in the same workflow as ordinary values.
19. As an administrator, I want to strengthen a field's requiredness without weakening catalog requirements, so that forms can impose appropriate local completion rules.
20. As an administrator, I want newly available codes highlighted and initially disabled when an existing form adopts a newer catalog, so that catalog updates do not silently broaden clinical choices.
21. As an administrator, I want existing enabled choices and ordering preserved during catalog adoption, so that updates retain the form's intended behavior.
22. As an administrator, I want to preview the configured form before publication and activation, so that I can verify custom fields and their choices.
23. As a clinician, I want custom fields to work in Mobile and Stationary, so that switching views does not prevent me from completing the report.
24. As a clinician, I want to record and recover custom values against the correct repeated entry, so that documentation remains unambiguous after saving or changing views.
25. As a clinician, I want opening a selector and clicking again in the same position to select its first option, so that commonly ordered choices are quick to enter.
26. As a clinician, I want typing to immediately search an open list, so that I do not need another click before finding a choice.
27. As a clinician, I want typing and opening a list to leave my recorded value unchanged, so that only deliberate selection records an answer.
28. As a clinician, I want to select an option with a click, tap, or Enter, so that the selector supports pointer and keyboard use.
29. As a clinician, I want Escape or clicking outside to close the list, so that I can dismiss it without recording an unselected suggestion.
30. As a clinician, I want a single-choice selector to close after selection, so that I can continue documenting.
31. As a clinician, I want a multi-choice selector to stay open and retain each committed selection, so that I can enter several permitted values efficiently.
32. As a clinician, I want permitted NOT values available in the same searchable selectors, so that documenting a missing-value reason does not require a separate interaction model.
33. As a clinician, I want to edit flagged standard and custom fields directly in the review checklist, so that I can resolve findings without navigating away.
34. As a clinician, I want checklist controls to identify the specific repeated entry they edit, so that I correct the intended medication or assessment.
35. As a clinician, I want the checklist to remain focused on flagged fields, so that unanswered optional fields do not obscure completion problems.
36. As a clinician, I want selections to receive the same validation wherever I enter them, so that checklist and form behavior agree.
37. As a clinician reviewing an older report, I want its recorded values and pinned definitions preserved, so that later catalog and form changes do not alter its meaning.

# Implementation Decisions

## Confirmed module boundaries

The user approved these five boundaries and testing for all five:

1. **Catalog definitions:** encapsulate custom-definition validation, code identities, NEMSIS metadata and relationships, publication, retirement, and identifying-data classification. Expose validated catalog definitions and diagnostics to authoring and runtime consumers.
2. **Form configuration:** encapsulate section structure, field placement, per-field choice policies, effective requiredness, and catalog adoption. Resolve a form against its pinned catalog into an effective configuration with actionable diagnostics.
3. **Encounter runtime:** encapsulate typed custom values, occurrence identity and correlation, validation, persistence, and recovery. Use the same edit and validation semantics across clinical views and checklist controls.
4. **Shared selectors and checklist editing:** encapsulate search, explicit selection, pointer placement, focus, dismissal, and single/multiple selection. Adapt flagged field targets to the normal field controls rather than creating a separate checklist value model.
5. **Compatibility:** encapsulate the transition from catalog-owned choice settings to form-owned settings, removal of default behavior, and compatibility with published definitions and stored reports.

These are responsibilities with small, independently testable interfaces, not a requirement to introduce five new services or packages. Extend existing authoring and runtime boundaries where suitable.

## NEMSIS model and catalog authoring

- Target the repository's pinned NEMSIS 3.5.1 model. Use the official custom schema to settle spec-defined details rather than treating existing application helper types as authoritative.
- Represent custom identity, title, definition, datatype, recurrence, usage, potential values, permitted NOT values, permitted pertinent negatives, and optional grouping metadata. Preserve the optional standard-element and standard-code mapping metadata supported by NEMSIS.
- Support the NEMSIS custom datatype categories through suitable clinical controls and validation. Do not equate a datatype category with an arbitrary new storage format or infer attachment behavior from the name alone.
- Preserve the distinction between the configuration grouping identifier, an element's recurrence, a result's own occurrence identity, and its correlation to a patient-report element or group. A visual section is not a NEMSIS data group.
- Support standalone custom values and values associated with particular repeated entries. Any custom grouping authoring must follow the verified NEMSIS model; do not introduce arbitrary nested record structures merely because the editor supports visual sections.
- Keep custom identifiers distinct from standard NEMSIS identifiers. Retain the application's existing namespaced identity convention where compatible; that convention is application policy, not a claimed NEMSIS requirement.
- Continue to support eligible local code-list additions without automatically converting those codes into custom elements. Standard list restrictions and any required extension/mapping semantics remain enforceable.
- Require the existing explicit identifying/non-identifying classification before publishing a custom element. Preserve the established analytical projection and authorization boundary.
- Published element identity and meaning remain stable. Label and description refinements can appear in a later catalog version; a datatype or semantic replacement requires a new identity. Retirement prevents new authoring use without invalidating historical reports or already-published forms.

## Form authoring and effective configuration

- Rename the user-facing Stationary form editor to **Form editor**. This does not rename the Stationary clinical view or require unrelated internal identifier changes.
- Add creation and renaming of visual sections alongside section ordering and existing removal behavior. Support adding and moving standard and custom fields between sections.
- Moving a field changes presentation only. Preserve the element's report-level or occurrence-specific data binding and make that binding understandable in authoring and clinical controls.
- Catalogs own element definitions and available choice identities. Forms own enabled choices and their ordering separately for each field, including fields sharing a catalog list.
- Include permitted NOT values in configuration, search, and selection. Preserve pertinent-negative semantics and enforce catalog permissions and NEMSIS combination rules; not every exceptional choice can be treated as an ordinary independent multi-select value.
- Resolve requiredness from catalog usage plus a form's permitted strengthening. Reject changes that weaken catalog requirements or make required documentation impossible. Keep permitted missing-value semantics consistent with NEMSIS usage.
- Extend draft read/save/validate/publish contracts and runtime form configuration to carry the new definitions, section edits, choice policies, and effective requirements. Keep authorization, version pinning, publication immutability, and existing edit-conflict protections.
- When an existing form adopts a newer catalog, preserve the identity, enabled state, and relative ordering of retained choices. Show newly available codes as disabled and identify them for review. Missing or incompatible references must produce actionable diagnostics rather than silently reinterpreting data.
- Preview uses the same effective configuration and rendering behavior as clinical entry.

## Removal of defaults and compatibility

- Remove default-value configuration and all proposed default application actions from the product. Neither opening a field nor creating a report populates a value from configuration.
- Choice ordering is the only mechanism agreed for putting a value first. Do not replace defaults with hidden preferred-value behavior or automatically move an old default to the top.
- Preserve existing recorded clinical values. A value already committed to a report is not removed because the default concept is removed.
- Implementation decision: when creating an editable successor for legacy forms, materialize their existing effective catalog enablement and ordering as per-field form settings. Do not rewrite immutable published artifacts to accomplish this transition.
- Historical artifacts may retain inert legacy default metadata where necessary for lossless compatibility, but new authoring and clinical behavior must not use it. A compatibility reader can derive legacy choice settings without mutating the source version.
- Preserve pinned definitions, unknown extension data, and existing save/recovery guarantees while integrating typed custom elements into the supported clinical workflow.

## Selector interaction

- Apply the shared interaction to dropdown code selectors, including checklist selectors and permitted NOT-value choices.
- On opening, position the first option at the original click/tap location and extend the list above the field where possible. A subsequent click/tap at that location selects that option. Treat these as an open action followed by a selection action, not a requirement to detect an operating-system double-click gesture.
- The opening event must never also select the newly displayed option. Opening alone does not write a value.
- Focus search immediately without requiring a second click. With an empty query, options follow the form's configured ordering; typing filters available choices without committing a value.
- Click/tap or Enter explicitly commits a selected option. Preserve normal keyboard navigation, accessible names, focus visibility, and screen-reader semantics.
- Escape or clicking outside closes the list. Closing discards uncommitted search/navigation state and retains any selections already committed during that session.
- Single-choice selection closes the list. Multi-choice selection commits each choice, visibly marks it selected, and keeps the list open. Subsequent dismissal does not roll back committed selections.
- Use a usable placement fallback when viewport boundaries or an on-screen keyboard prevent the preferred positioning. Exact pointer overlap must not override access to search or choices.

## Checklist and clinical runtime

- Provide direct editing only for editable field targets flagged by the existing review/validation findings. Do not enumerate unanswered optional fields in the checklist.
- Cover standard and custom fields, fields with and without coded choices, and permitted exceptional values, using the field's normal control and validation.
- Keep non-field findings and findings without an unambiguous editable target on their existing resolution path; do not invent an inline input for an ambiguous target.
- Show enough occurrence context to identify the repeated entry being edited. Route edits to the same canonical value and occurrence that the normal form edits.
- Recompute findings after committed edits through the existing validation lifecycle. Checklist editing must not bypass server validation or signing requirements.
- Custom fields and selector/checklist behavior must work in Mobile and Stationary. Switching views, saving, and recovering a report must preserve custom values and correlations.
- Keep the existing canonical JSON persistence boundary. XML import or export is not part of this feature.

# Testing Decisions

Test all five approved modules. Good tests verify externally observable behavior and invariants rather than mirroring helper functions or component internals.

## Catalog definitions

- Validate required metadata, datatype and recurrence rules, usage semantics, permitted values and exceptional codes, duplicate identities, mappings, and grouping/correlation references against pinned NEMSIS inputs.
- Exercise authorized creation, validation, publication, compatible revisions, retirement, and rejection of incompatible reuse of an identity.
- Verify identifying-data classification is required and that analytical visibility respects it.
- Use existing custom-configuration, catalog-authoring, catalog-localization, and analytical privacy tests as prior art.

## Form configuration

- Verify section creation, renaming and movement, custom-field discovery and placement, and preservation of data binding across visual moves.
- Verify two fields using the same code list can have independent enabled subsets and ordering, including NOT values.
- Verify permitted requiredness strengthening and rejection of weakening or impossible configurations.
- Verify catalog adoption preserves retained settings, highlights new disabled codes, and reports missing or incompatible references.
- Verify draft validation, publication, activation, and preview agree on effective configuration.
- Extend existing form-authoring, form-publication, clinical-form-configuration, localization, and admin-shell test patterns.

## Encounter runtime

- Round-trip supported custom values and exceptional values through save/reload and existing recovery paths.
- Verify repeated custom values remain associated with the intended entry after visual movement, view switching, and persistence.
- Verify shared validation, requiredness, and signing behavior across Mobile, Stationary, and checklist edits.
- Preserve unknown extension data and historical report readability.
- Use existing scalar, coded-value, repeating-group, encounter-profile, browser-persistence, and complete Mobile journey tests as prior art.

## Shared selectors and checklist editing

- Browser-test that the first click opens without selection and the second click at the same coordinates commits the first option when preferred placement is possible.
- Verify immediate typing filters the list, empty search respects configured order, and neither typing nor opening commits an answer.
- Verify explicit pointer/Enter selection, keyboard navigation, focus restoration, Escape, and outside-click dismissal.
- Verify single-choice closure, multi-choice persistence, selected-state feedback, and retention of committed values after dismissal.
- Cover NOT values and applicable exceptional-value constraints, empty search results, small viewports, and placement fallback. Include representative real-device/manual verification for on-screen-keyboard behavior where automation cannot reproduce it reliably.
- Verify only flagged editable fields receive checklist inputs; edits target the correct occurrence and update findings through normal validation.
- Verify both clinical views and accessibility using the existing coded-field, accessibility, localization, and browser journey patterns.

## Compatibility

- Verify legacy enabled choices and ordering become equivalent per-field settings in successor forms.
- Verify no new default setting or default application behavior remains, and old default metadata does not select or reorder choices.
- Verify recorded values are preserved and published catalog/form artifacts are not mutated.
- Verify old pinned reports remain readable and new catalog choices do not silently appear in existing form configurations.

## End-to-end acceptance

An authorized administrator can create and publish a custom element, place it in a newly created section, configure independent choices and ordering, preview and activate the form, and document the field in both clinical views. A flagged instance can be corrected in the checklist using the shared selector. The value survives save/reload with its identity and occurrence relationship intact. A later catalog update exposes new codes for explicit admin review without changing historical reports or introducing defaults.

# Out of Scope

- NEMSIS XML record import/export or a claim of record-level XML interchange compatibility.
- Defaults of any kind, including default configuration, suggested-default actions, automatic population, or bulk application.
- Turning the checklist into an inventory of all fields or unanswered optional fields.
- Weakening catalog requirements through form settings.
- Reinterpreting an existing published element by changing its datatype or meaning under the same identity.
- Rewriting historical reports or immutable published artifacts to apply new definitions or choice policies.
- Arbitrary custom grouping structures beyond the verified NEMSIS model.
- Unrelated expansion of form management, such as a new unit-specific activation model, new permission system, or new general-purpose analytics interface.

# Further Notes

- Agreed through the design interview on 2026-09-29. The user confirmed the five module boundaries and testing for all five before PRD creation.
- The initial request to move defaults into the Form editor was explicitly superseded: defaults are removed entirely. Fast selection comes from deliberate choice ordering and selector positioning.
- Earlier discussion of checklist default actions was superseded by direct editing of flagged fields only.
- Primary specification: [NEMSIS 3.5.1 custom configuration and results schema documentation](https://nemsis.org/media/nemsis_v3/release-3.5.1/DataDictionary/APIs/EMSDataSetAPI/eCustom_v3_xsd.html). Configuration grouping is represented by eCustomConfiguration.09; result element references and patient-report correlation are represented separately by eCustomResults.02 and eCustomResults.03. Check the complete pinned schema and applicable usage guidance when implementing repeated custom grouping.
- The repository already has custom-configuration validation and combined catalog lookup, but these helpers are not evidence that database-backed admin authoring and both clinical views support the full workflow. Reconcile those layers rather than adding a parallel custom-element system.
- Existing repository policy requires an explicit identifying-data decision for custom definitions. This requirement comes from the established analytical boundary, not from the NEMSIS custom schema.
- Necessary implementation assumptions: legacy settings are carried into editable successor forms rather than mutating published artifacts; non-field/ambiguous findings retain their existing resolution behavior; compatible localization and authorization follow existing application conventions. These are implementation decisions grounded in current behavior, not additional user-requested features.
- The user specified initial disablement for new codes when updating an existing form. Initial choice selection for a genuinely new field was not separately specified; follow a clear existing authoring convention and make the resulting enabled set visible before publication.
- Exact layout mechanics for simultaneous pointer overlap and immediately focused search need a browser prototype. Validate touch, keyboard, screen-reader, viewport, and on-screen-keyboard behavior before treating the preferred geometry as complete.
- Principal risks are losing repeated-entry correlations, diverging validation across surfaces, accidentally weakening NEMSIS usage rules, changing legacy choice behavior during migration, and exposing identifying custom values through analytical projections. The test plan directly covers these risks.
