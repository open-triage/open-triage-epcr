# OpenTriage Demo PRD

> **Original product vision; partially superseded (2026-10-08).** The problem
> statement and exclusions below describe the early scaffold, not today's app.
> [Users and roles](users-roles.md), [protected offline storage](protected-offline-clinical-storage.md),
> [localization](localization.md), [media notes](report-media-notes.md), and
> [Review](review.md) now supply capabilities excluded from this original scope.
> Synthetic tools use role permissions and explicit generation; records use the
> agency's expiry policy rather than an installation-wide demo reset.
> [Custom elements and form authoring](custom-elements-and-form-editor.md) also
> supersedes earlier default-value assumptions. The amendment backend and signed
> Review viewer exist; clinician amendment authoring, general audit browsing, and
> dedicated print/PDF output remain unimplemented parts of this broader vision.
> See the [feature index](README.md) before treating a requirement here as delivered.

## Problem Statement

Ambulance clinicians need an electronic patient care reporting system that supports rapid bedside capture, complete clinical documentation, trustworthy signing, and later correction without silently rewriting the medical record. Existing products may be costly, closed, difficult to adapt to regional practice, or structured around one interoperability standard rather than the needs of the clinicians and healthcare region using them.

OpenTriage needs a demonstrable first release that proves this workflow without accepting real patient data or implying that production identity, regulatory compliance, or external integrations are complete. The demo must show that a mature NEMSIS-derived taxonomy can seed an adaptable form system while keeping regional labels, requirements, coding systems, layouts, and custom elements configurable rather than hard-coded.

The product must also establish its open-source promise early. The application must remain free to use and self-host, must not depend on a proprietary OpenTriage service, and must prevent modified hosted versions from being operated as closed software.

The current repository is an early scaffold. It has a Next.js web application, a NestJS API, shared TypeScript contracts, PostgreSQL/Supabase migrations, and a basic service worker, but it does not yet implement the clinical domain, NEMSIS catalog import, form configuration, offline report persistence, authoritative signing, amendments, audit history, demo lifecycle, or the agreed phone and desktop experiences.

## Solution

Build a synthetic-data-only OpenTriage demo that lets a shared Demo user receive a simulated dispatch assignment or start a blank ePCR, capture time-sensitive information on an Android phone, complete the full report on a PC or tablet, resolve validation findings, sign an immutable clinical snapshot, create structured amendments, inspect the audit history, and generate a watermarked print/PDF representation.

The same demo will let an Administrator configure synthetic users and capabilities and create new versioned forms from a complete NEMSIS 3.5.1-derived catalog. Administrators can curate sections and fields, define compatible custom elements, maintain dropdown options, configure declarative requiredness and visibility rules, preview changes, and publish immutable form versions. Existing drafts and signed records always remain bound to the form and terminology versions against which they were created.

The Android phone experience will prioritize assigned calls, acknowledgement, operational status timestamps, bedside quick capture, offline resilience, and the clinical timeline. The PC/tablet experience will provide comprehensive documentation, signing, amendment, audit, print/PDF, user administration, and form administration. Both surfaces operate over the same clinical domain and API rather than maintaining separate copies of report data.

The demo will run as a guarded public sandbox using fixed Demo credentials and shared synthetic data. Seeded baseline records and the default form are immutable. Visitor-created records and temporary form versions are disposable, rate-limited, and retained for no more than 24 hours. An enforced demo deployment profile will prevent the environment from being mistaken for production clinical software.

## User Stories

1. As an evaluator, I want to use OpenTriage without paying a license fee or creating a proprietary service account, so that I can assess and self-host the complete core product.
2. As an open-source contributor, I want the application source and build process to be available under a strong copyleft license, so that hosted modifications remain available to their users.
3. As an interoperability developer, I want reusable interoperability libraries under a permissive license, so that NEMSIS and future exchange tooling can be adopted broadly.
4. As a demo visitor, I want to sign in with fixed Demo credentials, so that I can begin evaluating the product without account setup.
5. As a demo visitor, I want synthetic data to be clearly and permanently identified, so that I do not mistake the sandbox for a clinical-production environment.
6. As a demo visitor, I want generated patient names, identifiers, addresses, and dispatch details to be fictional, so that the demo does not encourage entry of real patient data.
7. As a demo visitor, I want visitor-created artifacts to expire automatically, so that the shared sandbox does not accumulate abandoned data.
8. As a demo visitor, I want baseline reports and the default form to remain dependable, so that another visitor cannot permanently break the demonstration.
9. As a Documenter, I want to simulate an incoming dispatch assignment, so that I can experience the beginning of the ambulance workflow.
10. As a Documenter, I want simulated dispatch categories to use values from the applicable NEMSIS recommended list, so that generated assignments use recognizable coded values.
11. As a Documenter, I want an assigned call to appear in a queue and require acknowledgement, so that assignment and acknowledgement times are captured distinctly.
12. As a Documenter, I want to start a blank ePCR without dispatch information, so that the workflow also supports calls created locally.
13. As a Documenter, I want dispatch-supplied values to retain their provenance when I correct them, so that the original source information remains inspectable.
14. As a Documenter, I want to edit any draft value without entering a correction reason, so that unfinished documentation remains efficient.
15. As a Documenter, I want meaningful draft changes timestamped and audited, so that the record has useful history without logging every keystroke.
16. As a Documenter, I want operational actions such as En route, On scene, Patient contact, Transporting, At destination, and Clear to populate mapped event times, so that routine documentation takes fewer taps.
17. As a Documenter, I want automatically captured operational times to remain correctable before signing, so that a missed or delayed tap does not create an inaccurate record.
18. As a Documenter, I want operational status and report completion to remain separate, so that clearing the unit never signs the ePCR on my behalf.
19. As a Documenter, I want cleared but unsigned reports to remain visible, so that incomplete documentation is not forgotten.
20. As a Documenter, I want one active call and multiple reports awaiting documentation, so that a new call does not hide prior unfinished work.
21. As a phone user, I want a short-form capture experience optimized for Android Chrome at a 360 by 800 CSS-pixel portrait viewport, so that I can document at the bedside.
22. As a phone user, I want touch-friendly and accessible controls, so that the interface remains usable under ambulance conditions.
23. As a phone user, I want to acknowledge dispatch, record operational times, update key patient and incident details, and add vitals, medications, procedures, and short notes, so that immediate clinical events can be captured quickly.
24. As a phone user, I want a section-completeness view, so that I can see what remains unfinished.
25. As a phone user, I want persistent quick-entry actions for common clinical entries, so that urgent documentation does not require navigating a complete desktop form.
26. As a phone user, I want a chronological timeline, so that I can review the sequence of care and reopen the canonical entry editor.
27. As a phone user, I want the installed application and current report to remain usable through a temporary network loss, so that connectivity does not cause lost work.
28. As a phone user, I want an unmistakable offline and synchronization status, so that I know whether changes have reached the server.
29. As a phone user, I want incomplete medication, procedure, vital, or note entries to be saveable, so that missing details do not block urgent capture.
30. As a phone user, I want incomplete entries highlighted for later completion, so that speed at the bedside does not hide omissions at signing.
31. As a user logging out, I want to be warned about unsynchronized changes, so that I do not accidentally discard offline work.
32. As a user of an expired or reset demo, I want cached clinical data removed from the device, so that disposable records do not remain locally.
33. As a desktop or tablet Documenter, I want the full versioned form, so that I can complete every configured section and field.
34. As a Documenter, I want section and timeline views to edit the same underlying entries, so that the report never contains divergent copies.
35. As a Documenter, I want repeatable vitals, medications, procedures, and notes, so that each occurrence has its own timestamp and clinical context.
36. As a Documenter, I want every repeatable entry to retain its stable identity, author, clinical time, recording time, and synchronization time, so that provenance remains clear.
37. As a Documenter, I want measurements to retain the exact value and unit I entered, so that automatic normalization does not erase clinical provenance.
38. As a reporting or validation user, I want governed normalized measurement values alongside original measurements, so that comparisons and export remain reliable.
39. As a Documenter, I want clinical time, device-recorded time, and server-received time preserved separately, so that offline synchronization and clock errors do not rewrite event history.
40. As a Documenter, I want timezone-aware date-times, so that the record remains meaningful across daylight-saving changes and exchange boundaries.
41. As a Documenter, I want quick notes preserved as individual timeline entries, so that later narrative editing does not destroy what was originally recorded.
42. As a Documenter, I want to insert or summarize selected notes into an editable narrative explicitly, so that narrative construction remains under clinician control.
43. As a Documenter, I want to document an unknown patient or temporary identity, so that emergency care does not require inventing identity data.
44. As a Documenter, I want one patient per ePCR and multiple ePCRs linked to one incident, so that multi-patient incidents retain patient-specific records.
45. As a Documenter, I want explicit absence states such as Unknown, Not applicable, Unable to obtain, or Not recorded with reason when the form permits them, so that requiredness reflects real emergency conditions.
46. As a Documenter, I want silent required-field omissions to block signing, so that incomplete records are not submitted accidentally.
47. As a Documenter, I want validation errors to block signing and warnings to require acknowledgement, so that unusual but plausible findings can be accepted transparently.
48. As a Documenter, I want signing to require connectivity, so that the server can validate the latest revision and create one authoritative immutable snapshot.
49. As a Documenter, I want signing to record an explicit demo attestation, form version, report revision, acknowledgements, timestamp, and integrity hash, so that the signing boundary is demonstrable without claiming a legally verified identity.
50. As a Documenter, I want only the documenting clinician to sign the ePCR, so that contributors are not falsely required to attest.
51. As a Documenter, I want structured values to be correctable after signing only through an amendment, so that the original signed report remains immutable.
52. As a Documenter, I want an amendment to preserve the original value, corrected value, author, time, reason, and its own attestation, so that the correction chain is complete.
53. As a reader of an amended report, I want to see the latest effective value and reveal the original and amendment chain, so that the record is understandable without losing history.
54. As a Documenter, I want to view my recent signed synthetic records, so that I can demonstrate completed documentation without report search or analytics.
55. As a Documenter, I want a watermarked print/PDF representation, so that I can inspect a tangible completed artifact without implying interoperability certification.
56. As a security-conscious user, I want every report view, edit, sign, amendment, and export audited, so that access and changes are traceable.
57. As an auditor of the demo, I want audit events to be append-only and tamper-evident, so that administrators cannot rewrite history.
58. As a user sharing the public Demo account, I want stale concurrent edits rejected explicitly, so that another visitor's later request cannot silently overwrite current data.
59. As an Administrator, I want to manage synthetic users and capability bundles, so that I can demonstrate authorization configuration separately from real authentication.
60. As an Administrator, I want Documenter and Administrator capabilities to be independently assignable, so that administration does not imply access to clinical records.
61. As an Administrator, I want to view operational metadata without automatically viewing report contents, so that least privilege is reflected in the product model.
62. As an Administrator, I want a complete searchable catalog of imported NEMSIS 3.5.1 elements, so that mature standard elements can seed regional forms.
63. As an Administrator, I want the default published form to contain a curated, usable subset, so that clinicians are not presented with every NEMSIS element.
64. As an Administrator, I want to clone a published form into a draft, so that changes never mutate a version already used by reports.
65. As an Administrator, I want to add, remove, reorder, hide, and relabel fields and sections, so that form layout can reflect regional practice.
66. As an Administrator, I want to configure whether a field is required and which absence states it permits, so that signing requirements can diverge deliberately from NEMSIS defaults.
67. As an Administrator, I want NEMSIS usage designations preserved and weakening them flagged, so that divergence remains visible and intentional.
68. As an Administrator, I want a constrained conditional-rule builder, so that visibility and requiredness can respond to report values without executable scripts.
69. As an Administrator, I want conditional rules limited to supported comparisons and Boolean composition, so that configured behavior is portable and testable.
70. As an Administrator, I want to configure repeatable groups and occurrence limits, so that recurring clinical entries are represented structurally.
71. As an Administrator, I want approved field primitives rather than arbitrary custom components, so that configuration does not become an unsafe plugin system.
72. As an Administrator, I want to bind fields to versioned local value sets, so that coded entry remains available offline and historically reproducible.
73. As an Administrator, I want to rename dropdown labels and add or deprecate options in a future form version, so that terminology can evolve without rewriting old reports.
74. As an Administrator, I want deprecated options hidden only from future forms, so that existing drafts and signed reports remain valid against their pinned versions.
75. As an Administrator, I want language-neutral form structure with all labels and descriptions owned by the catalog, so English and Swedish do not silently develop different clinical logic.
76. As an Administrator, I want missing translations visible and validated according to deployment policy, so that localization gaps are deliberate.
77. As an Administrator, I want to create custom elements with immutable application identities and human-readable deployment namespaces, so that regional additions remain stable and distinguishable from NEMSIS identifiers.
78. As an Administrator, I want every custom field to be representable through NEMSIS `eCustomConfiguration` and `eCustomResults`, so that configuration does not create future export dead ends.
79. As an Administrator, I want a projected `eCustom` representation shown during validation, so that mapping errors can be corrected before publication.
80. As an Administrator, I want publication blocked by structural errors and incompatible mappings, so that invalid form versions cannot be activated.
81. As an Administrator, I want non-fatal publication warnings to require acknowledgement and a change note, so that accepted risks are auditable.
82. As an Administrator, I want to preview the exact changes from the current version, so that publication decisions are informed.
83. As an Administrator, I want to publish a form without a second approver in the demo, so that the configuration workflow remains lightweight.
84. As a future regional operator, I want optional multi-approver policy to fit the same publication model, so that governance can become stricter without redesigning form versions.
85. As a clinician using an existing draft, I want it to remain pinned to its original form version after publication, so that requirements do not change beneath active documentation.
86. As a reader of a historical report, I want labels, option meanings, rules, and terminology resolved from its original version, so that historical meaning remains stable.
87. As a terminology administrator, I want external terminology packages kept separate when redistribution rights are unverified, so that the open repository does not distribute restricted data improperly.
88. As an open-source user, I want openly licensed example value sets and import tooling included, so that the application remains usable without proprietary terminology.
89. As a NEMSIS implementer, I want the supplied XSD package converted by a deterministic importer, so that the starter catalog can be reproduced and audited.
90. As a NEMSIS implementer, I want the catalog manifest to record the asserted 3.5.1 version, official source URL, checksum, and import time, so that provenance is explicit.
91. As a NEMSIS implementer, I want hierarchy, groups, cardinality, definitions, constraints, usage, flags, enumerations, null values, pertinent negatives, performance tags, comments, correlations, and code-list references preserved, so that the catalog is not a flattened approximation.
92. As a NEMSIS implementer, I want unsupported XSD constructs reported rather than silently dropped, so that importer limitations are visible.
93. As a NEMSIS implementer, I want application UUIDs to remain canonical while NEMSIS paths and correlation identifiers are retained, so that custom regional data and standard mapping can coexist.
94. As a future exporter, I want missing NEMSIS correlation identifiers generated deterministically, so that repeated exports remain stable.
95. As a contributor, I want the generated starter catalog and manifest available without a runtime download, so that clean local installation is reproducible.
96. As an API consumer, I want every clinical and administrative mutation processed by one authoritative API, so that validation, authorization, auditing, and state transitions cannot be bypassed by the web client.
97. As an offline client, I want to assign permanent globally unique IDs and idempotency keys before synchronization, so that retries do not duplicate reports or clinical entries.
98. As an offline client, I want the server to preserve accepted client-generated identities, so that queued local relationships remain stable.
99. As a user facing a revision conflict, I want both the current and attempted values returned, so that the conflict can be resolved explicitly.
100. As a deployment operator, I want the clinical domain to use standard PostgreSQL without requiring hosted Supabase, so that OpenTriage can run on regional infrastructure.
101. As a deployment operator, I want identity and storage services isolated behind adapters, so that infrastructure choices do not redefine the clinical domain.
102. As a deployment operator, I want Kubernetes to be the supported deployment platform, so that the DigitalOcean demo and future regional installations use a reproducible operational model.
103. As a contributor, I want a lightweight local Node and PostgreSQL workflow, so that ordinary development does not require a Kubernetes cluster.
104. As a deployment operator, I want Kubernetes manifests or a Helm chart covering migrations, ingress, secrets references, health checks, resource limits, cleanup jobs, and persistent services, so that deployment behavior is explicit.
105. As a deployment operator, I want secrets supplied through standard Kubernetes references with optional external-vault integration, so that OpenTriage does not prescribe a proprietary secrets manager.
106. As a deployment operator, I want demo credentials enabled only by the guarded demo profile, so that they cannot accidentally be used in production mode.
107. As a deployment operator, I want production mode to refuse startup with demo shortcuts enabled, so that synthetic safeguards and production behavior cannot be confused.
108. As a public demo operator, I want per-IP and per-device quotas and rate limits, so that shared credentials do not permit unbounded abuse.
109. As a public demo operator, I want baseline restoration and automatic artifact cleanup, so that the sandbox remains dependable without backups of visitor data.
110. As a public demo operator, I want minimal self-hosted operational metrics and sanitized diagnostics, so that failures can be investigated without exporting clinical-form content.
111. As a privacy-conscious operator, I want third-party analytics disabled by default, so that report values and user activity are not sent to external services.
112. As an accessibility user, I want core workflows to meet WCAG 2.2 AA, so that documentation is not dependent on color, precise touch, or one input method.
113. As a phone user, I want the cached app to reopen quickly and interactions not to block typing, so that the interface remains responsive on modest Android hardware.
114. As an evaluator, I want the demo tested on a physical Android phone, so that desktop emulation is not the only evidence of mobile usability.
115. As an open-source consumer, I want release SBOMs, vulnerability scans, and dependency-license checks, so that software composition and licensing are transparent.
116. As an open-source consumer, I want no proprietary runtime dependency for core functionality, so that self-hosting remains meaningful.
117. As an outside contributor, I want to retain copyright in my contribution while certifying my right to submit it, so that participation does not require broad copyright assignment.

## Implementation Decisions

### Product and licensing

- The application is licensed under AGPL-3.0. Reusable interoperability libraries are licensed under Apache-2.0.
- Contributions use Developer Certificate of Origin sign-off without copyright assignment.
- Core installation and operation must not require a paid OpenTriage service or proprietary runtime dependency.
- Third-party terminology packages are separate configuration artifacts unless their redistribution rights are verified.

### NEMSIS Catalog and Terminology module

- A deterministic importer converts the supplied NEMSIS 3.5.1 XSD package into a versioned starter catalog and an import report.
- The source manifest records the official source URL, asserted version, package checksum, and import timestamp.
- The importer preserves hierarchy, nested groups, cardinality, element metadata, datatype constraints, enumerations, usage designations, national/state flags, null and pertinent-negative support, performance-measure tags, comments, correlation support, and code-list references.
- Unsupported constructs generate explicit warnings or errors rather than being omitted silently.
- Runtime deployments consume the generated catalog artifact and do not parse or download XSDs during startup.
- The complete catalog is available to administration, while published forms use curated subsets.
- NEMSIS usage is source metadata and a source of suggested defaults. It does not automatically define OpenTriage signing requirements.
- Terminology snapshots are versioned, local, and available offline. A coded option preserves system, code, version, localized display, and active/deprecated state.
- Live terminology service access may help future administrators but cannot be required during bedside entry.

### Versioned Form Engine module

- A form definition contains stable sections, fields, repeatable groups, presentation metadata, rules, terminology bindings, translations, and validation policy.
- Form versions are language-neutral structures. Localized group names, element labels, and descriptions come from the pinned catalog locale, with visible fallback behavior.
- Published form versions are immutable. Editing begins by cloning a published version into a draft.
- Every report remains pinned to the exact form and terminology versions used at creation. New publications apply only to new reports.
- Field identifiers and fundamental value types become immutable after publication. A materially different field is created as a new element.
- Approved primitives include short text, long text, integer, decimal measurement with unit, date, time, date-time, yes/no, single choice, multiple choice, coded concept, and repeatable group.
- Custom executable components, arbitrary scripts, and administrator-defined clinical formulas are prohibited.
- Declarative rules support visibility and requiredness with constrained comparisons, presence tests, set membership, AND, and OR.
- Rule evaluation occurs from the pinned versioned definition. Publication validation rejects cyclic, dangling, or structurally impossible rules.
- NEMSIS usage weakening and missing non-required translations may be warnings. Cyclic rules, invalid custom mappings, duplicate codes, incompatible types, and required hidden fields without valid resolution are errors.
- Publication errors block. Warnings require explicit acknowledgement and a change note. The validation report and diff are retained with the published version.
- One Administrator may publish in the demo. The model leaves room for an optional future multi-approver policy.
- Option label changes, additions, and removals create future code-list/form versions. Removal deprecates an option for future forms and never invalidates existing drafts or records.

### Custom element mapping

- Custom elements use an immutable application UUID plus a deployment namespace and human-readable slug. They never impersonate NEMSIS `e...` identifiers.
- Every published custom element must be representable by NEMSIS `eCustomConfiguration` and `eCustomResults`.
- Custom definition metadata covers title, definition, NEMSIS-compatible datatype, recurrence, usage, potential values, accepted NV/PN values, grouping, and required custom-element identity.
- Custom results can reference their definition and optionally correlate to a standard report element or group.
- Repeatable custom groups use grouping and correlation identifiers.
- Publication preview displays the projected `eCustom` representation. Incompatible custom elements block publication.
- Patient-level NEMSIS XML import/export is not part of the demo; the compatibility rule preserves a viable future adapter boundary.

### Clinical Record Domain module

- Incident/call and patient-care report are separate aggregates. One incident may link to several ePCRs; each ePCR has exactly one patient.
- A report references its incident, patient identity state, form version, status, mutable draft revision, clinical entries, validation state, and eventual signed snapshot.
- Unknown patients, temporary identifiers, approximate demographics, and unavailable identity states are first-class values.
- Repeatable vitals, medications, procedures, and notes have application UUIDs, clinical times, device-recorded times, server receipt times, author/provenance, and their configured values.
- NEMSIS group paths and imported correlation identifiers are mapping metadata. Application UUIDs are canonical. The export boundary retains or deterministically produces required correlation identifiers.
- Section, timeline, and quick-entry interfaces are projections of one canonical entry model.
- Measurements retain the entered value and unit. A governed, tested conversion may add a normalized value without replacing the original.
- Date-times preserve the timezone-aware instant, local display/entry, UTC offset, deployment timezone, and relevant precision.
- Quick notes remain distinct timestamped entries. Narrative construction may explicitly insert or summarize them but never destroys or silently rewrites the source notes.
- A draft is mutable, uses an incrementing revision, and produces meaningful change audit events on commit, blur, explicit dialog save, or idle autosave rather than on every keystroke.
- Draft edits do not require a reason. Imported dispatch values retain source provenance even after a draft correction.
- Validation has blocking errors and acknowledged warnings. Required fields accept only ordinary values or form-permitted explicit absence states.
- Signing is an online, atomic server operation. It verifies the expected revision, runs authoritative validation, records acknowledgements and demo attestation metadata, creates the immutable snapshot, and hashes its canonical payload.
- Only the documenting clinician signs. Crew attribution remains available without requiring other signatures.
- Signed content cannot be unlocked or edited. Structured amendments preserve the affected identity/path, original value, corrected value, reason, author, timestamp, and separate attestation.
- The effective clinical view may present corrected values but must expose the original and complete amendment chain.
- Operational call state and report completion are separate state machines. Clear never signs a report.

### Clinical API and Persistence module

- All report, entry, status, signing, amendment, user, form, publication, and audit mutations pass through the NestJS API.
- The browser does not write clinical records directly to Supabase or PostgreSQL.
- PostgreSQL is the portable data store. Supabase may supply optional infrastructure through adapters.
- Persistence is hybrid: flexible versioned report values use JSON keyed by stable element identities, while reports, incidents, repeatable entries, signatures, amendments, forms, users, and audit events remain first-class relational concepts.
- Draft commands include an expected revision. Revision mismatch rejects the mutation and returns the current and attempted values; the server does not apply last-write-wins.
- Offline-capable clients create globally unique entity IDs and command idempotency keys. The API deduplicates retries and preserves accepted client-generated identifiers.
- Authorization is capability-based with named role bundles. Administrator capability does not grant clinical-record access.
- The demo reduces report access to its shared synthetic account. Future access can use organizational, assignment, and care-team policy without encoding creator-only ownership.
- The data model represents one regional organization per Live installation. Separate healthcare regions use separate installations; there is no initial healthcare multi-tenancy model.

### Audit module

- Audit events cover report creation, viewing, committed editing, operational status changes, signing, amendment, export, user/capability changes, form publication, and administrative configuration.
- Audit events are append-only. Correction creates a later event.
- The server assigns a sequence and receipt time. Report-specific hash chaining makes mutation detectable.
- Events distinguish actor/persona, device/session identity, client time, server time, action, target, and appropriate prior/new values.
- Administrators cannot edit or delete audit events.
- Demo audit data is disposable with the synthetic artifact lifecycle. Production independent audit storage and retention are future work.

### Offline Capture and Synchronization module

- The installed PWA caches the application shell, current form version, assigned/current synthetic report, and locally queued commands.
- IndexedDB stores the active draft and queue. Local storage intended for small preferences or tokens does not hold clinical payloads.
- Ordinary field and repeatable-entry work continues offline. Synchronization state is visible.
- Queued commands retry idempotently after reconnection.
- The demo does not merge concurrent changes automatically. Conflicts require reload or explicit reapplication.
- Signing, user administration, form editing, validation/publication, and other administrative mutations require connectivity.
- Logout warns about unsynchronized work, attempts synchronization when possible, and clears clinical cache after completion or confirmed discard.
- Reset, expiry, and clear-device operations wipe local demo clinical data.
- The demo does not claim production-grade local encryption. HTTPS is required.

### Phone Clinical Experience module

- Android Chrome is the primary demo client. The minimum supported portrait viewport is 360 by 800 CSS pixels; landscape remains usable.
- Phone design is a single-column, touch-first reworking of the attached visual prototype rather than a literal implementation.
- The primary screen emphasizes assigned calls, active call, documentation remaining, and section completeness.
- Incoming simulated calls require acknowledgement before opening the linked report.
- A separate action starts a blank report.
- Operational status actions create editable mapped clinical/response time events.
- Persistent quick actions add vitals, medications, procedures, and notes.
- The timeline orders entries by clinical time and opens the same canonical editor used by sections.
- Incomplete quick entries are permitted, labeled, and carried into signing validation.
- The phone is not required to provide the complete narrative, signing, review, form-builder, or advanced administrative experience.

### Desktop/Tablet Clinical Experience module

- PC/tablet provides full form documentation, comprehensive validation cleanup, narrative editing, signing, amendment history, audit history, and report print/PDF.
- No report search or flexible filtering is included. The UI provides only status-oriented lists needed for assigned, active, documentation-remaining, and recent signed synthetic reports.
- The Reviewer persona and QA-review workflow are excluded.
- The Documenter can reopen their shared synthetic records and inspect immutable signed content and amendments.
- PDF/print output is watermarked as synthetic and includes form version, signed revision, amendments, validation acknowledgements, and generation time. Generation creates an export audit event.

### Administration Experience module

- Advanced administration targets PC/tablet. Phone administration is not required.
- The demo includes a synthetic personnel directory with activation/deactivation and assignment of Documenter and Administrator capability bundles.
- It does not include real passwords, invitations, recovery, identity verification, or SITHS.
- Administration does not imply access to report contents.
- The form builder supports catalog lookup, curated addition, custom elements, field and section arrangement, visibility, requiredness, allowed absence states, terminology binding, option maintenance, conditional rules, localization, preview, validation, change notes, and publication.
- The default published form and seeded baseline records are immutable in the public sandbox. Visitors may create temporary derived versions.

### Shared Demo Sandbox module

- The public sandbox uses a fixed Demo username and password and a shared synthetic workspace. It intentionally does not implement visitor isolation or session transfer.
- The same credentials can be used on phone and PC. All visitors can see the shared visitor-created data, subject to guarded demo behavior.
- Simulated dispatch generates a plausible synthetic name and basic dispatch data plus a random valid dispatch category. A complex clinically coherent scenario generator is not required.
- Baseline examples and the default form are immutable and reproducible from version-controlled migrations and seed data.
- Visitor-created records and temporary form versions expire within 24 hours. They are not backed up or promised to survive maintenance.
- A reset action and recurring server cleanup restore dependable baseline state.
- Per-IP and per-device rate limits and artifact quotas mitigate abuse. CAPTCHA is deferred unless needed.
- The demo profile adds a permanent synthetic-data-only/not-for-clinical-use banner, restricted direct identifiers, watermarked exports, demo credentials, automatic expiry, baseline restoration, and disabled production integrations.
- Production mode requires separate explicit configuration and refuses startup when demo credentials or synthetic-only shortcuts remain enabled.
- Free-text areas retain warnings because automated PHI detection is not considered reliable enforcement.

### Deployment and Open-Source Distribution module

- Kubernetes is the supported deployment platform for the DigitalOcean demo and future regional installations.
- A versioned Helm chart or equivalent manifests cover web, API, database migration execution, ingress, health checks, resource requests/limits, persistent services, secret references, and demo cleanup jobs.
- CI installs and smoke-tests the deployment package on an ephemeral Kubernetes environment.
- Contributors retain a lightweight Node plus PostgreSQL local workflow, with optional `kind` or `k3d` testing.
- The chart consumes standard Kubernetes Secret references and may integrate with External Secrets or a region-approved vault without prescribing a proprietary vendor.
- Release builds generate an SBOM, scan for known vulnerable dependencies and incompatible licenses, publish license notices, and reject proprietary core-runtime requirements.
- Telemetry is optional and self-hosted by default. Operational metrics and sanitized errors exclude report values, narratives, patient fields, credentials, and access tokens.

### Accessibility and performance

- Core create, edit, validate, sign, amend, configure, and audit flows target WCAG 2.2 AA.
- Controls provide screen-reader labels, visible focus, scalable text, sufficient contrast, keyboard access where applicable, non-color status cues, and at least 44 by 44 CSS-pixel primary touch targets.
- On documented modest Android hardware and throttled test conditions, cached offline reopening targets approximately two seconds, ordinary field interaction targets under 100 milliseconds, and uncached usable load targets within five seconds on a reasonable 4G connection.
- Autosave must not block typing.

## Testing Decisions

- Good tests verify externally observable behavior and stable module contracts rather than internal implementation details.
- All ten major modules are in the required test scope: NEMSIS Catalog and Terminology, Versioned Form Engine, Clinical Record Domain, Clinical API and Persistence, Offline Capture and Synchronization, Phone Clinical Experience, Desktop/Tablet Clinical Experience, Administration Experience, Shared Demo Sandbox, and Deployment/Open-Source Distribution.
- The repository currently contains no existing unit, integration, or end-to-end test suite to use as prior art. The new suite must establish conventions rather than imitate a shallow existing pattern.
- Importer fixture tests verify representative standard elements, repeatable groups, clinical-time membership, enumerations, NV/PN metadata, correlation support, custom structures, source manifest/checksum behavior, and explicit reporting of unsupported constructs.
- Form engine tests verify immutable publication, version pinning, localized label fallback, terminology versioning, option deprecation, conditional-rule evaluation, cycle detection, requiredness, allowed absence states, publication errors, warning acknowledgement, and custom `eCustom` compatibility.
- Clinical domain tests verify incident/report relationships, one patient per ePCR, unknown identity, repeatable entry identity, provenance, timestamps, measurements, validation severity, signing invariants, snapshot hashing, structured amendments, effective views, and separation of operational and documentation states.
- API integration tests use PostgreSQL and verify authoritative mutations, capability enforcement, absence of implicit Administrator clinical access, expected revisions, conflict responses, idempotent retries, client-generated IDs, transactional signing, immutable signed data, and append-only audit behavior.
- Audit tests verify view/edit/sign/amend/export/configuration events, sequence ordering, device attribution, prior/new values for committed edits, and detectable hash-chain mutation.
- Offline tests verify shell and form caching, local quick capture, refresh recovery, command ordering, retry deduplication, visible sync state, conflict handling, logout protection, expiry cleanup, and inability to sign or administer while offline.
- Phone end-to-end tests cover Demo login, assigned-call simulation, acknowledgement, operational statuses, key patient fields, quick vitals/medications/procedures/notes, incomplete entries, timeline navigation, offline recovery, and documentation-remaining lists at the minimum viewport.
- Desktop/tablet end-to-end tests cover blank reports, full form completion, conditional requirements, absence states, error/warning behavior, narrative handling, signing, structured amendment, audit inspection, and watermarked print/PDF generation.
- Administration end-to-end tests cover synthetic user/capability changes, form cloning, catalog lookup, section/field changes, terminology and option maintenance, conditional rules, localization, custom elements, validation preview, warning acknowledgement, publication, and historical form rendering.
- Demo lifecycle tests verify shared Demo credentials, immutable seed data, disposable visitor artifacts, quotas/rate limits, automatic 24-hour expiration, reset behavior, baseline restoration, production startup refusal with demo shortcuts, and watermarked output.
- Deployment tests install the Kubernetes package, run migrations and seed data, exercise readiness/liveness behavior, verify secret-reference use, run a smoke workflow, and test cleanup jobs.
- Supply-chain tests generate an SBOM, detect incompatible licenses and vulnerable dependencies according to project policy, and ensure core operation has no proprietary runtime dependency.
- Automated accessibility checks cover core screens, supplemented by keyboard, screen-reader, contrast, focus, text-scaling, and touch-target manual checks.
- Performance tests use documented hardware and network profiles and measure cached reopen, first usable load, field responsiveness, and non-blocking autosave.
- At least one modest physical Android phone receives a manual release check; desktop emulation alone is insufficient.
- End-to-end release acceptance covers both entry paths and the complete agreed workflow: simulate and acknowledge dispatch, start blank, phone quick capture, desktop completion, conditional validation, permitted absence, warning acknowledgement, signing, structured amendment, audit history, PDF/print, form publication, option deprecation, custom-element validation, offline recovery, idempotent retry, and demo expiry.

## Out of Scope

- Real patient data or any claim that the public demo is suitable for clinical use.
- Production-grade identity, password lifecycle, SITHS, legally verified electronic signatures, or production credential enforcement.
- Reviewer persona, QA findings, draft review, formal review approval, or reviewer analytics.
- Patient or receiving-hospital signatures.
- Full Swedish interface and label localization; the framework and shared structural model are included.
- Patient-level NEMSIS XML import, XML export, conformance certification, or US-market exchange readiness.
- Real CAD/dispatch, FHIR, Cambio Cosmic, Inera/RIV-TA, hospital, monitor, Bluetooth, ECG, or device-vendor integrations.
- Simulated integrations other than the explicitly labeled internal incoming-call generator.
- Live ECG viewing or hospital invitation access.
- Clinical decision support, NEWS2, risk prediction, administrator-defined clinical formulas, or regulatory classification of such functionality.
- Freetext/voice-to-structured-field mapping.
- NPÖ, Swedish national registry, or national patient-data exchange.
- Full production compliance certification for EU MDR, GDPR, Patientdatalagen, data residency, audit retention, or regional security policy.
- Production-grade offline identity and encrypted clinical storage.
- Offline signing.
- Offline administration or form publication.
- Automatic multi-user or multi-device conflict merging.
- Healthcare-region multi-tenancy within one Live installation.
- Report search, arbitrary clinical filtering, flexible reporting, statistics, or analytics.
- General file attachments, photographs, waveform storage, or mock device data.
- Visitor-isolated public-demo workspaces or explicit session-sharing/transfer features.
- Backups or recovery guarantees for visitor-created public-demo artifacts.
- Kubernetes as a requirement for ordinary local development.
- A prescribed proprietary telemetry, identity, storage, terminology, secrets, or deployment service.

## Further Notes

- The attached HTML prototype is design reference material rather than an exact implementation specification. Its clinical sections, event timeline, quick actions, validation cues, and visual language may inform the new UI, but the phone experience should be substantially reworked.
- The public demo's shared credentials intentionally trade visitor isolation and reliable user attribution for minimal setup. Device/session identity supplements the shared persona in the audit trail, but it does not identify a real individual.
- Shared public access creates interference and vandalism risk. Immutable baseline data, revision conflicts, quotas, rate limits, automatic expiration, and continuous restoration are required mitigations.
- The demo is materially larger than a disposable visual prototype. The complete catalog importer, versioned form engine, offline queue, signing/amendment boundary, append-only audit trail, dual clinical surfaces, administration, PDF output, and Kubernetes operations are core agreed scope.
- The NEMSIS 3.5.1 XSD files were supplied from the official Version 3 data-dictionaries resource. Recommended lists not embedded in the XSD package must be acquired and pinned separately, and redistribution rights must be verified.
- The Swedish deployment is expected to diverge from NEMSIS. The product's own element identity and form model therefore remain authoritative, while NEMSIS is retained as source metadata and an export mapping target.
- A form version is a clinical meaning boundary. Historical rendering, validation explanation, amendment display, print/PDF, and future reporting must resolve through the pinned version rather than current administrator settings.
- The demo has one regional organization and does not model separate agencies within a region. Operational units or stations may be added later if needed for assignments or reporting.
- Production access policy is expected eventually to use organizational, assignment, and care-team relationships. The demo's shared user is not the production authorization design.
- Visitor-created demo records may be edited from different devices using the same shared credentials. Optimistic concurrency prevents silent overwrite, but the demo does not attempt collaborative merge.
- The application must avoid overstating NEMSIS compatibility. Importing catalog metadata and ensuring `eCustom` representability do not constitute patient-level NEMSIS conformance.
- The demo must avoid overstating compliance. Correct architectural boundaries for immutability, amendments, and access logging are included, but independent legal, regulatory, security, and clinical-safety work remains before Live use.
