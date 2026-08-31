# Problem Statement

Ambulance clinicians need to document patient care without a cumbersome interface interrupting clinical work or forcing them to reconstruct events afterward. Before OpenTriage invests in production infrastructure, comprehensive interoperability, administration, or regulatory hardening, it needs evidence that its core documentation interaction is meaningfully easier and smoother for care providers than their current workflow.

The current product roadmap describes a broad demo platform containing clinical workflows, configurable forms, NEMSIS import, offline synchronization, signing, audit, administration, shared sandbox behavior, and Kubernetes deployment. Building that entire platform before testing the interaction would delay learning and make it difficult to distinguish feedback about documentation usability from feedback about secondary systems.

The MVP must therefore isolate the riskiest product assumption: that an event-first, phone-based workflow can help an ambulance clinician capture and finish a representative encounter smoothly while retaining essential, NEMSIS-derived validation.

# Solution

Build a static, synthetic-data-only Android-phone prototype centered on one prefilled adult chest-pain transport encounter. The clinician records timestamped vital sets, medications, procedures, and notes through persistent quick actions. These entries immediately appear in a chronological timeline. A compact checklist captures essential non-event information such as assessment, disposition, and narrative.

The prototype contains approximately 20–30 curated inputs and repeatable groups mapped to NEMSIS 3.5.1. Every included element is validated against the applicable NEMSIS datatype, cardinality, usage, and permitted `NV`/`PN` requirements. Validation errors block completion, warnings require acknowledgement, and every finding links directly to the relevant entry.

The full applicable NEMSIS recommended medication and procedure lists are pinned as compact, searchable local assets with recorded provenance. The prototype saves progress in the browser, survives a refresh, offers a reset action, and ends with a read-only completed summary. It has no login, backend, shared state, formal signature, interoperability export, or production-clinical claim.

Care providers try the same facilitated scenario on an Android phone. The team observes hesitation, backtracking, missed information, entry flow, and validation recovery, then collects structured qualitative feedback about whether the workflow feels smoother than current documentation. The precise go/no-go threshold will be decided before making the later investment decision.

# User Stories

1. As an ambulance clinician, I want a documentation workflow optimized for an Android phone, so that I can capture care without navigating a desktop-oriented form.
2. As an ambulance clinician, I want the prototype to open directly into a synthetic encounter, so that I can evaluate documentation without login or setup friction.
3. As an ambulance clinician, I want the encounter clearly labeled as synthetic and not for clinical use, so that I do not mistake the prototype for a production patient record.
4. As an ambulance clinician, I want the patient and dispatch context prefilled, so that the usability test focuses on documenting evolving care rather than creating a call.
5. As an ambulance clinician, I want the scenario to represent an adult chest-pain transport encounter, so that I can exercise a familiar workflow containing observations, treatment, and disposition.
6. As an ambulance clinician, I want persistent quick actions for vitals, medications, procedures, and notes, so that common clinical events require minimal navigation.
7. As an ambulance clinician, I want each clinical entry timestamped, so that the sequence of care is documented accurately.
8. As an ambulance clinician, I want to add more than one vital set, medication, procedure, or note, so that evolving care can be represented naturally.
9. As an ambulance clinician, I want newly captured events to appear immediately in a chronological timeline, so that I can confirm what has been documented.
10. As an ambulance clinician, I want to open and edit the same canonical entry from the timeline, so that I do not maintain separate copies of clinical information.
11. As an ambulance clinician, I want a compact checklist for essential non-event information, so that assessment, disposition, narrative, and remaining omissions are visible without a large section hierarchy.
12. As an ambulance clinician, I want roughly 20–30 clinically meaningful inputs rather than a comprehensive ePCR, so that the test evaluates interaction quality rather than endurance.
13. As an ambulance clinician, I want medication selection to search the full applicable NEMSIS recommended list, so that the selector behaves credibly rather than offering only scenario-specific choices.
14. As an ambulance clinician, I want procedure selection to search the full applicable NEMSIS recommended list, so that procedure entry reflects realistic list breadth.
15. As an ambulance clinician, I want terminology search to remain responsive on the phone, so that comprehensive lists do not make bedside entry cumbersome.
16. As an ambulance clinician, I want the recorded medication and procedure codes displayed with understandable labels, so that coded documentation remains clinically legible.
17. As an ambulance clinician, I want every included input validated against its NEMSIS 3.5.1 requirements, so that the prototype does not invent arbitrary completion rules.
18. As an ambulance clinician, I want required values and repeatable-group requirements enforced, so that the completed summary does not silently omit essential information.
19. As an ambulance clinician, I want numeric and date/time inputs checked against their applicable NEMSIS datatype constraints, so that invalid values are caught clearly.
20. As an ambulance clinician, I want permitted NEMSIS `NV` and `PN` values available where applicable, so that the prototype handles absence and pertinent negatives correctly for its included fields.
21. As an ambulance clinician, I want validation messages to show the relevant NEMSIS element reference, so that the origin of the requirement is transparent.
22. As an ambulance clinician, I want errors to block finishing the record, so that the prototype does not present invalid documentation as complete.
23. As an ambulance clinician, I want warnings to permit clinically plausible values after acknowledgement, so that validation does not reject unusual but possible care.
24. As an ambulance clinician, I want the final validation summary to navigate directly to each problem, so that correction is fast and does not require searching the form.
25. As an ambulance clinician, I want progress saved immediately in my browser, so that a refresh does not erase the usability session.
26. As an ambulance clinician, I want to reset the synthetic encounter, so that the scenario can be repeated from a clean baseline.
27. As an ambulance clinician, I want to review all documented information before finishing, so that I can identify omissions and incorrect entries.
28. As an ambulance clinician, I want a read-only completed summary after resolving errors and acknowledging warnings, so that I can assess the result of the documentation journey.
29. As an ambulance clinician, I want the completed summary labeled as a usability prototype rather than a complete clinical record, so that its limited scope is not overstated.
30. As a clinician with accessibility needs, I want readable typography, sufficient contrast, large touch targets, labeled controls, visible focus, and non-color status cues, so that basic interface barriers do not invalidate the usability test.
31. As a clinician participating in evaluation, I want one consistent scenario and task prompt, so that my feedback can be compared meaningfully with other participants.
32. As a clinician participating in evaluation, I want feedback gathered through conversation rather than embedded tracking, so that I can explain the reasons behind friction or preference.
33. As a product evaluator, I want to observe hesitation, backtracking, missed fields, and validation recovery, so that feedback is grounded in actual use rather than visual preference alone.
34. As a product evaluator, I want anonymized structured notes from each session, so that repeated strengths and failures can be identified without building analytics infrastructure.
35. As a product evaluator, I want the prototype available at a stable HTTPS URL, so that it can be tested on a physical Android phone without local development setup.
36. As a product decision-maker, I want to learn whether care providers find the workflow meaningfully smoother than current documentation, so that further investment is based on evidence.

# Implementation Decisions

## MVP boundary

- The primary user is an ambulance clinician. Administrator, Reviewer, interoperability, deployment, and audit personas are not MVP users.
- The problem under test is documentation ease and smoothness, particularly capturing events during care and reviewing a coherent encounter afterward.
- The MVP is a usability prototype and never accepts or claims suitability for real patient data.
- The existing broader demo PRD remains a roadmap. It does not define the MVP build boundary.

## Synthetic Encounter Definition module

- The MVP contains one fixed, prefilled adult chest-pain transport encounter.
- Patient and dispatch context is synthetic and loaded automatically.
- The scenario exercises repeated vital signs, medication administration, a procedure, timestamped notes, assessment, disposition, and narrative.
- The form contains approximately 20–30 curated NEMSIS-mapped inputs and repeatable groups.
- Field selection must be sufficient to evaluate quick capture, list selection, repeatable entries, checklist completion, and validation recovery; it is not intended to constitute a legally complete ePCR.
- Each included definition records its NEMSIS element or group identity and the subset of source requirements needed by the prototype.
- The scenario and field mapping are version-controlled static assets.

## NEMSIS Terminology Assets module

- The full applicable NEMSIS recommended medication and procedure lists are included rather than scenario-only subsets.
- Lists are pinned to explicit source releases and converted into compact local searchable assets during development.
- Each asset records its source URL, version or release identifier, and checksum.
- Terminology is bundled with the static prototype and is never fetched from NEMSIS at runtime.
- The search interface exposes understandable labels while preserving the corresponding codes.
- The module provides a small stable interface for searching and resolving coded concepts; generalized terminology administration is not included.

## Event Documentation Model module

- The prototype has one in-browser encounter state.
- Vitals, medications, procedures, and notes are canonical timestamped repeatable entries with stable local identities.
- Quick actions create entries and the chronological timeline renders those same entries.
- Editing from the timeline updates the canonical entry rather than a second view-specific copy.
- Clinical time determines the timeline order. The prototype does not model device/server synchronization timestamps.
- A compact checklist stores the curated non-event values, including assessment, disposition, and narrative.
- Event state and checklist state feed one validation and review model.

## Fixed NEMSIS Validation module

- Validation is mandatory in the MVP and is fixed to the curated scenario definition.
- Every included field and group applies the relevant NEMSIS 3.5.1 datatype, cardinality, usage, and permitted `NV`/`PN` constraints extracted from the supplied schemas and associated lists.
- Validation messages retain the relevant NEMSIS element or group reference.
- Errors block completion. Warnings require explicit acknowledgement.
- The Review and finish step presents a consolidated list and direct navigation to each failing entry or field.
- Plausibility warnings may be included for curated vital-sign inputs when they are explicitly defined as prototype warnings rather than NEMSIS conformance rules.
- There is no generalized expression language, Administrator rule builder, runtime XSD validation, XML generation, Schematron execution, or claim of full NEMSIS conformance.

## Phone Clinical Experience module

- Android Chrome is the target browser and a 360 by 800 CSS-pixel portrait viewport is the minimum design reference.
- The interface is event-first rather than a conventional large section form.
- Persistent quick actions add vital sets, medications, procedures, and notes.
- The timeline is the primary record of event documentation.
- A compact checklist exposes non-event fields and remaining omissions.
- Full medication and procedure lists use phone-friendly searchable selection.
- Review and finish runs validation, supports correction and warning acknowledgement, and produces a read-only completed summary.
- Continue editing and reset are available because all data is synthetic and no legal signature boundary exists.
- The prototype uses the attached design as visual context only and may substantially rework it for the phone experience.

## Local Prototype Persistence module

- Encounter state is saved immediately in browser-local storage appropriate for structured application data.
- Refreshing or reopening the prototype on the same browser restores the in-progress encounter.
- Reset returns the scenario and all documentation state to the version-controlled baseline.
- There is no server, shared record, account, cross-device continuation, synchronization queue, or concurrent editing.
- Service-worker caching and installable PWA behavior are not MVP requirements.

## Prototype Safety and Hosting module

- The prototype opens directly with no login.
- A persistent notice identifies it as a synthetic-data-only usability prototype that is not for clinical use.
- Direct patient context is prefilled with fictional data.
- The build is deployed as a static site at a stable HTTPS URL using the simplest available hosting.
- Kubernetes, persistent infrastructure, database migrations, secrets management, and server cleanup are not dependencies.
- No embedded third-party analytics, session recording, or clinical-content telemetry is included.

## Clinician Evaluation Protocol module

- Evaluation uses facilitated sessions with a consistent scenario prompt and task sequence.
- Facilitators observe hesitation, backtracking, missed fields, quick-action use, terminology search, validation recovery, and completion behavior.
- A short interview asks which parts feel smoother or worse than the provider's current system and why.
- Notes are anonymized and stored outside the prototype.
- Embedded surveys and analytics are unnecessary for the first learning cycle.
- The main assumption is supported by a consistent pattern of care providers describing the workflow as meaningfully smoother without repeated critical omissions.
- Consistent preference for existing workflows, confusion about the event-first model, or repeated missed critical information is failure evidence.
- The exact quantitative go/no-go threshold is unresolved by decision and must be defined before using results for a consequential investment decision.

## Accessibility fundamentals

- The MVP requires large touch targets, readable contrast and typography, non-color status cues, labeled controls, visible focus, and basic keyboard and screen-reader semantics.
- Formal WCAG 2.2 AA certification and exhaustive assistive-technology testing are not prerequisites for initial clinician sessions.
- Accessibility problems observed during evaluation are captured as product feedback.

# Testing Decisions

- Good tests verify externally observable behavior and stable module interfaces rather than component internals or implementation details.
- All eight MVP modules are selected for testing: Synthetic Encounter Definition, NEMSIS Terminology Assets, Event Documentation Model, Fixed NEMSIS Validation, Phone Clinical Experience, Local Prototype Persistence, Prototype Safety and Hosting, and Clinician Evaluation Protocol.
- The repository currently contains no existing test suite that provides prior art. The MVP establishes the initial testing conventions.
- Scenario-definition tests verify that every configured input has a stable identity, NEMSIS reference, label, type, validation metadata, and expected initial state.
- Terminology tests verify pinned provenance metadata, checksums, code/label preservation, full asset loading, deterministic search, and acceptable search response with comprehensive lists.
- Event-model tests verify creation, stable local identity, editing, deletion where supported, repeatable entries, chronological ordering, and consistency between timeline and review state.
- Validation tests cover each included NEMSIS datatype, required cardinality, usage rule, permitted and prohibited `NV`/`PN` state, blocking error, warning acknowledgement, and navigation target.
- Validation fixtures include valid, invalid, missing, boundary, and clinically unusual-but-acknowledgeable values.
- Phone end-to-end tests run at the minimum viewport and cover opening the scenario, adding every event type, searching full medication/procedure lists, editing timeline entries, completing checklist fields, encountering and resolving errors, acknowledging warnings, finishing, and reviewing the summary.
- Persistence tests verify immediate save, restoration after refresh, partial-entry recovery, completed-state restoration, and complete reset to baseline.
- Safety tests verify the persistent synthetic/not-for-clinical-use notice, absence of login or real-data prompts, and prototype labeling on the completed summary.
- Hosting smoke tests verify that the static build loads at the HTTPS test URL on Android Chrome without backend dependencies.
- Automated accessibility checks cover labels, focusability, common contrast failures, and obvious semantic issues. Manual checks cover touch targets, visible focus, text scaling, keyboard navigation where relevant, and non-color validation cues.
- A manual acceptance script runs on at least one physical Android phone; desktop emulation alone is insufficient.
- The evaluation protocol is dry-run before provider sessions to ensure the scenario instructions, observation prompts, and interview questions do not coach participants through the interface.
- Qualitative clinician feedback is evidence, not an automated test result. The team records both positive and negative observations and does not treat visual preference alone as proof of smoother documentation.

# Out of Scope

- Real patient data, clinical use, or claims of legal record completeness.
- Dispatch queue, call simulation, assignment, acknowledgement, or blank-record creation.
- More than one clinical scenario.
- Trauma, cardiac arrest, pediatric, refusal, non-transport, or mass-casualty workflows.
- PC/tablet full documentation, separate desktop layouts, or cross-device continuation.
- Authentication, Demo credentials, users, roles, permissions, or access control.
- Server API, PostgreSQL, Supabase persistence, or shared records.
- Multi-user editing, optimistic concurrency, idempotent network commands, or conflict resolution.
- Installable PWA behavior, application-shell caching, offline operation, synchronization queues, or sync indicators.
- Formal signature, identity attestation, immutable snapshots, payload hashes, structured amendments, or addenda.
- Access logging, append-only audit events, hash chaining, or audit viewers.
- Administrator form configuration, form cloning, preview, publication, or version pinning.
- Complete NEMSIS XSD-to-catalog import.
- Administrator terminology updates, terminology services, or generalized code-list packaging.
- Custom elements or NEMSIS `eCustom*` mapping.
- Generalized conditional-rule or validation engines.
- Full NEMSIS record coverage, NEMSIS XML generation, Schematron/state validation, or conformance certification.
- Full Swedish localization or localization administration.
- PDF, print, NEMSIS, FHIR, hospital, or other export.
- Reviewer workflow, quality assurance findings, analytics, search, statistics, or reporting.
- CAD, dispatch, hospital, Cambio Cosmic, Inera/RIV-TA, monitor, Bluetooth, ECG, or device integrations.
- Clinical decision support, NEWS2, risk prediction, or voice-to-structured documentation.
- Embedded surveys, analytics, session recording, or third-party telemetry.
- Formal accessibility certification.
- Kubernetes, production infrastructure, secrets management, backup, autoscaling, SBOM automation, or deployment portability.
- Production regulatory, privacy, clinical-safety, identity, audit-retention, or security compliance.

# Further Notes

- The MVP intentionally leaves the existing backend scaffold unused. Removing it is unnecessary; making it a prerequisite would add work unrelated to the assumption under test.
- NEMSIS remains the source for included validation requirements, but the MVP does not import the entire XSD package dynamically or claim that a completed prototype record is NEMSIS conformant.
- The medication and procedure list decision is a deliberate exception to aggressive scope reduction. Full lists remain because realistic search and selection behavior can materially affect clinician feedback about documentation smoothness.
- Recommended lists not embedded in the supplied XSD archive must be acquired from an authoritative NEMSIS source. Their release identifiers, source URLs, checksums, and redistribution conditions must be recorded.
- Plausibility warnings and NEMSIS conformance requirements must be distinguished in the UI and test fixtures.
- The prototype's completed summary is a usability artifact, not a signed medical record.
- Basic accessibility is included to avoid contaminating feedback with preventable interface barriers; formal compliance work is deferred.
- The exact success threshold was intentionally deferred. It should be defined before clinician feedback is used for a go/no-go funding or architecture decision.
- Future work is revisited only when evidence creates a need:
  - Add dispatch and blank-record workflows after the documentation interaction succeeds and operational flow becomes the next assumption.
  - Add desktop and cross-device behavior if clinicians say phone-only completion is unrealistic.
  - Add backend persistence and authentication when durable shared records are needed.
  - Add offline-first behavior after positive workflow feedback and evidence of field connectivity constraints.
  - Add signing, amendments, and audit before any controlled clinical-record pilot.
  - Add form administration and versioning when a second deployment requires materially different forms.
  - Add the full NEMSIS importer when maintaining the curated subset becomes costly or export becomes committed scope.
  - Add terminology administration when updates must occur without a code release.
  - Add more scenarios after the chest-pain journey succeeds and providers identify scenario-specific gaps.
  - Add a generalized validation engine when a second form requires materially different rules.
  - Add formal accessibility work before broad or clinical deployment.
  - Add PDF or interoperability output when an evaluator or receiving system requires it.
  - Add Kubernetes when a persistent API or regional deployment trial exists.
  - Add Reviewer, reporting, and analytics workflows when retrospective quality assurance is validated as a separate user problem.
  - Add external integrations only after the relevant vendor, source system, contract, and workflow are confirmed.
  - Begin production regulatory and security work before introducing real patient data or clinical decision functionality.
- The next concrete build step is to create the version-controlled synthetic scenario definition mapping the selected 20–30 fields and repeatable groups to their NEMSIS 3.5.1 validation requirements. That definition becomes the stable contract for the event model, validation, phone UI, and completed summary.
