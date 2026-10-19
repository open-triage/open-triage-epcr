# Problem Statement

> **Planned — agreed design, 19 October 2026.** This PRD captures the hospital
> integration design agreed with the product owner. It covers Cambio COS final
> report delivery and European Patient Summary (EPS) exchange with the Nordic
> Hackathon 2026 service. COS sandbox access is pending. This document does not
> claim implementation, successful COS delivery, or production acceptance.

Ambulance clinicians need their completed patient-care reports to reach the
hospital record without manual re-entry. They also need access to existing
patient summaries while documenting an encounter, with an explicit way to bring
relevant information into the EPR. Today, OpenTriage has signed report snapshots,
amendment persistence, clinical drafts, Review, audit browsing, and protected
offline storage, but no hospital integration or EPS workflow.

The initial hospital target is Cambio COSMIC through Cambio Open Services (COS).
The hackathon provides an immediately accessible EPS service for fictional
patient summaries. These targets share FHIR concepts but have different document
and transport contracts. A valid EPS document is not, by itself, a valid COS
prehospital-note submission.

Administrators must configure and operate these integrations through the app,
including credentials, patient-identifier selection, mappings, activation, and
diagnostics. Missing identifiers and failed transmissions must create actionable
Review work. Audit history must establish what happened without becoming a
second recovery workflow.

# Solution

Add a Hospital integrations administration panel with separate COS and EPS
sections. Share the clinical mapping, identity-resolution, authorization, and
audit behavior needed by both destinations, while keeping their external
contracts separate.

COS automatically receives newly signed reports and signed amendments for
encounters involving patient assessment or care. This includes non-transport
encounters, using an explicitly configured ambulance care unit. Send structured
prehospital-note data and a readable PDF of the signed report. Preserve delivery
history and prevent an older retry from overwriting a newer delivered version.
Signing remains available when the destination is unavailable.

EPS retrieval starts from the configured patient-identifier field. Every
integration defaults to **ePatient.01**, with an administrator-selectable field
dropdown. When a matching EPS is available, enable a button in the call header.
Its dialog displays all summary content and offers individual import actions
for mapped fields. Imports require clinician selection, retain provenance,
prevent duplicates, and expose conflicts. Previously opened EPS information
remains available under the draft's existing protected offline-storage rules.

EPS export is an explicit action on a signed report. It includes only content
documented or explicitly imported into that report, using the applicable signed
amendments. It does not silently carry forward unimported source information.
The first EPS service adapter targets the hackathon; its document handling is
reusable for later adapters.

Create built-in Review items for missing COS transmission identifiers and COS
transmission failures. A dedicated **Document valid identifier** outcome action
records an authorized correction and resumes delivery. A failed-transmission
item offers Retry and resolves only when delivery is confirmed. Both use
existing configurable Review routing and retain their history.

# User Stories

1. As an ambulance clinician, I want my signed report sent to COS automatically, so that the hospital record receives my completed documentation without another routine action.
2. As a clinician, I want signing to finish when COS is unavailable, so that an external outage does not prevent completion of my clinical record.
3. As a clinician, I want signed amendments delivered automatically, so that the hospital receives corrected documentation.
4. As a receiving clinician, I want the newest delivered report to remain current, so that a delayed retry cannot restore an older version.
5. As a clinician, I want reports from assessment, treatment without transport, and refusals included, so that care at the scene remains available in the hospital record.
6. As an agency, I want cancellations without patient contact excluded, so that calls without patient care do not create inappropriate hospital notes.
7. As a receiving clinician, I want structured clinical information and a readable PDF, so that both mapped data and the fuller documented context are available.
8. As a receiving clinician, I want custom fields and text notes represented in the PDF, so that information outside structured COS mappings is not silently lost.
9. As a receiving clinician, I want report photos included subject to supported attachment limits, so that relevant visual documentation accompanies the report.
10. As a receiving clinician, I want audio-note entries to state their timestamp, duration, and that the recording was not transferred, so that I understand the attachment's limits.
11. As a receiving clinician, I want signer, report-version, and amendment information visible, so that I can identify the documentation I received.
12. As a clinician, I want pending, successful, and failed delivery states visible, so that signing and hospital delivery are distinguishable.
13. As a clinician, I want to see when an EPS is available for the current patient, so that I can consult existing information during care.
14. As a clinician, I want an EPS button in the call header, so that the summary is accessible from the active encounter.
15. As a clinician, I want an EPS dialog with a table of all summary information, so that unsupported import mappings do not hide useful source content.
16. As a clinician, I want source organization, authorship where available, clinical dates, summary date, and retrieval time visible, so that I can assess where information came from and how current it is.
17. As a clinician, I want individual Import actions showing the destination field, so that I control what enters my EPR.
18. As a clinician, I want existing documentation compared with conflicting imported information, so that imported values do not silently overwrite my findings.
19. As a clinician, I want repeated import attempts to avoid duplicates, so that revisiting a summary does not multiply medications, conditions, or allergies.
20. As a clinician, I want unmapped information to remain readable with a clear import limitation, so that I understand what can and cannot be added structurally.
21. As a clinician, I want imported information to retain its source and original timing, so that historical information remains distinguishable from this encounter's findings.
22. As a clinician, I want current medication history distinguished from medication administered during this call, so that an import does not misrepresent treatment.
23. As a clinician, I want unknown information distinguished from an explicit negative finding, so that absence of data is not presented as absence of a condition.
24. As a clinician, I want EPS availability rechecked when the selected patient identifier changes, so that another patient's summary is not presented as current.
25. As a clinician, I want a previously opened EPS available during a connection loss, so that interrupted connectivity does not remove information I was using.
26. As a clinician, I want cached summaries to follow the same protection and session rules as my draft, so that offline access does not bypass clinical access controls.
27. As a clinician, I want to refresh a summary after reconnecting and see its age, so that I can distinguish a cached copy from a recent retrieval.
28. As an authorized report user, I want to explicitly submit an EPS from a signed report, so that publication to the hackathon is deliberate.
29. As an authorized report user, I want outgoing EPS to include only signed EPR content and confirmed imports, so that unreviewed incoming information is not presented as my documentation.
30. As an authorized report user, I want an amended signed version available for another explicit EPS submission, so that I can exchange corrected information deliberately.
31. As a hackathon participant, I want submission validation findings and results visible, so that I can improve the document without interpreting raw network traffic.
32. As a hackathon participant, I want demo calls to use the service's test patients, so that retrieval, import, signing, and export can be demonstrated together.
33. As a demo user, I want test-patient names, identity numbers, and demographics to agree, so that a demonstration does not associate one person's summary with another person's call.
34. As an administrator, I want separate COS and EPS sections in Hospital integrations, so that their different settings and activation states are clear.
35. As an administrator, I want normal integration setup and operation entirely in the panel, so that I do not need CLI or deployment-file access.
36. As an administrator, I want to configure endpoints, authentication, credentials, and required mappings, so that the installation can connect to its intended service.
37. As an administrator, I want a Patient identifier field dropdown defaulting to ePatient.01 for every integration, so that the integration follows the agency's actual patient-identifier field.
38. As an administrator, I want the selected identifier field used consistently for lookup, export, validation, and recovery, so that changing the dropdown does not leave hidden hardcoded behavior.
39. As an administrator, I want to configure identifier schemes and issuing authorities where required, so that an identifier's value is interpreted in the correct namespace.
40. As an administrator, I want to configure OpenTriage-to-COS/EPS data-element mappings in the relevant admin panel, version and transfer them as canonical JSON, and inspect incompatibilities, so that mappings are reusable and source data is not coerced into an incompatible destination field or code.
41. As an administrator, I want drafts, connection tests, activation, and configuration history similar to SSO, so that incomplete edits do not replace a working integration.
42. As an administrator, I want to replace and rotate credentials without retrieving saved secrets, so that routine credential maintenance is possible through the app.
43. As an administrator, I want to activate or deactivate COS and EPS independently, so that either service can be operated without requiring the other.
44. As an agency-group administrator, I want one COS connection inherited by child agencies, so that a shared regional installation is configured consistently.
45. As an administrator, I want explicit hospital and care-unit mappings, so that a report reaches its intended context within COS.
46. As an administrator, I want a default ambulance care unit for non-transport encounters, so that an absent hospital destination does not prevent an otherwise eligible transfer.
47. As an administrator, I want unmapped destinations exposed as actionable failures, so that the system does not guess a recipient.
48. As an administrator, I want activation to start with new signatures and amendments, so that existing signed records are not unexpectedly transmitted.
49. As an administrator, I want transmission history to show the report version, destination, attempts, status, timestamps, and useful error details, so that delivery can be investigated.
50. As an administrator, I want transmission-history entries linked to Review recovery items, so that recovery has one operational home.
51. As an administrator, I want a configurable bounded retry schedule, so that temporary outages can recover automatically without indefinite retries.
52. As a reviewer, I want a built-in COS transmission failed item after the first failure, so that unsuccessful delivery is visible while automatic recovery is still running.
53. As a reviewer, I want repeated failures attached to the existing item, so that retries do not flood the queue with duplicate work.
54. As a reviewer, I want to retry the latest eligible signed version from Review, so that I can resume delivery after correcting a problem.
55. As a reviewer, I want a failure item to remain open until confirmed delivery, so that queuing or clicking Retry is not mistaken for success.
56. As a reviewer, I want uncertain delivery outcomes distinguished from definite rejection, so that a timeout does not lead to an unsafe blind resend.
57. As a reviewer, I want a built-in missing transmission identifiers item, so that absent patient, practitioner, care-unit, or encounter identifiers receive follow-up.
58. As an assigned reviewer, I want Document valid identifier to be a Review outcome action, so that correcting the cause and recording resolution form one workflow.
59. As an authorized reviewer, I want a patient-identifier correction recorded as an attributable signed amendment with a reason, so that the original signed record remains intact.
60. As an authorized reviewer, I want a validated identifier outcome to queue delivery, so that correction does not require a separate hidden operational step.
61. As an administrator, I want practitioner and care-unit mapping problems corrected in integration configuration, so that a mapping error does not require rewriting patient documentation.
62. As a Review administrator, I want both built-in item types available in existing routing settings, so that I can choose the documenting clinician, an eligible named reviewer, or the shared queue.
63. As a documenting clinician, I want missing patient-identifier work assigned to me by default, so that I can complete the patient identity I documented.
64. As an agency, I want technical failures and missing integration mappings routed to the shared queue by default, so that operational work is not automatically assigned to an unrelated clinician.
65. As a clinician, I want identifying information visible on my own reports within my permitted scope, so that I can review and correct my documentation without an additional identifying grant.
66. As an agency, I want other reviewers to require both report access and review:identifying, so that assignment alone cannot reveal another clinician's identifying content.
67. As an assigned reviewer, I want correction authority to follow existing Review permissions and assignment rules, so that this feature does not introduce a separate identity-correction permission.
68. As an auditor, I want configuration changes, activation, corrections, transmission attempts, failures, retries, and confirmed results retained, so that I can reconstruct what happened.
69. As an auditor, I want old attempts and superseded versions preserved, so that eventual success does not erase earlier failures or corrections.
70. As an agency, I want credentials and unrestricted clinical payloads excluded from routine diagnostic lists, so that operational monitoring does not bypass access controls.
71. As an English- or Swedish-speaking user, I want localized controls, messages, and generated report labels, so that integration workflows match the rest of OpenTriage.
72. As a mobile or keyboard user, I want the EPS dialog and Review actions usable within the existing interface conventions, so that the feature works at the point of care and on a workstation.
73. As an operator, I want COS development and simulator results distinguished from a verified sandbox connection, so that pending Cambio access is not represented as a working live integration.
74. As a receiving clinician, I want terminology and clinical meaning checked in addition to structural document validation, so that a passing validator result is not the only evidence of a correct exchange.

# Implementation Decisions

## Scope and module boundaries

The product owner confirmed the workflows and acceptance coverage during the
design interview. The boundaries below organize that agreed scope into modules
with small, independently testable interfaces; they do not require separate
deployments. All are included in testing.

| Module | Responsibility | Small interface |
| --- | --- | --- |
| Integration configuration and identity resolution | Versioned connection settings, credentials, activation, shared patient-field selection, identifier schemes, and destination/staff mappings | Read effective configuration; save/test/activate/deactivate a revision; resolve a patient's configured identifier with explicit findings. |
| Clinical exchange mapping and validation | Project source report versions into clinical concepts, preserve provenance and missing-data semantics, map codes/units, and construct or read destination-specific FHIR documents | Produce a versioned projection, parse a summary, plan/apply an import, or validate/build a target document with mapping findings. |
| EPS connection and clinical workflow | Hackathon document discovery, patient matching, availability, complete presentation, selective imports, protected caching, and explicit submission results | Resolve availability; retrieve a particular summary; refresh; request an authorized import or submission. |
| COS delivery coordination | Eligibility, contact/note delivery sequencing, immutable payload identity, attempts, acknowledgement interpretation, bounded retries, and amendment ordering | Queue an eligible signed version; process/reconcile an attempt; expose delivery state; request an authorized recovery attempt. |
| Signed-report rendering | Human-readable PDF from the exact signed report version and amendments, including photos and explicit audio omissions | Render a reproducible report artifact and return completeness/size findings. |
| Review recovery | Built-in conditions, stable work-item identity, routing, identifier outcome actions, retries, and condition-driven completion | Reconcile operational items; document a valid identifier; retry the latest eligible delivery. |
| Shared authorization and audit integration | Report-relative identifying access, mutation authority, protected payload access, and attributable integration events in existing audit browsing | Authorize the actual report/action; record and expose permitted evidence using the existing audit model. |

Use the existing clinical draft and amendment mechanisms, Review assignment and
outcome infrastructure, authentication-administration lifecycle, protected
storage, and audit browser. Do not create parallel role grants, clinical records,
or review queues solely for hospital integration.

## Standards and external contracts

- Target FHIR R4 4.0.1 for the documented EPS and COS contracts. Pin the
  hackathon's EPS package at **hl7.fhir.eu.eps 1.0.0-ballot**, including resolved
  dependencies. Do not silently track the changing EPS development build.
  See the [EPS ballot specification](https://hl7.eu/fhir/eps/1.0.0-ballot/).
- EPS is a document Bundle with a Composition and its required referenced
  resources. COS prehospital-note delivery uses its own collection Bundle with
  a QuestionnaireResponse. Shared clinical concepts do not make the payloads
  interchangeable.
  See the [EPS bundle](https://hl7.eu/fhir/eps/1.0.0-ballot/StructureDefinition-bundle-eu-eps.html)
  and [COS bundle](https://fhir.openservices.cambio.se/site/StructureDefinition-BundlePrehospitalNote.html) profiles.
- The documented COS profiles include BundlePrehospitalNote/v2 and
  QuestionnaireResponsePreHospitalNote/v2. Confirm the actual sandbox/target
  versions, API route, note template, and enabled capabilities before activation
  against a real installation. Public profile version tables do not establish
  which version the intended region has deployed.
- COS permits one prehospital note per contact and replaces it on a subsequent
  submission. Preserve stable contact/note identity and order full report
  versions accordingly. Verify contact creation/linkage and note delivery as
  one coordinated workflow rather than assuming an EPS upload creates a contact.
  See the [COS note contract](https://fhir.openservices.cambio.se/site/StructureDefinition-QuestionnaireResponsePreHospitalNoteV2.html).
- COS authentication requires its supported OAuth arrangement and API key.
  Configure credentials, scopes, required endpoints, and relevant external
  identities through the panel; confirm the permitted grant for this interface
  with Cambio. The hackathon team token is a separate credential.
  See [COS access requirements](https://developer.openservices.cambio.se/getting-started).
- The hackathon provides document/sample listings and document reads, not a
  documented patient-identifier search. Its adapter must discover and index the
  selected service's published/sample documents by Patient identifiers. It must
  not assume that a generic FHIR patient search or summary operation is available.
- Hackathon validation records attempts, reports an OperationOutcome and score
  headers, and publishes successful exchange documents. Explicit submission is
  a publication action, not a read-only diagnostic. Use fictional test records
  with this public service; never embed credentials in fixture files, documents,
  browser bundles, or diagnostics.
  See the [hackathon API specification](https://hackathon2026.vadimperetok.in/openapi.json).
- A generic FHIR patient-summary server is not part of the first adapter. Keep
  its future transport replaceable without redesigning the clinical workflow.

## Configurable patient identifier

**Confirmed requirement:** ePatient.01 is the default patient-identifier source
for every hospital integration. An administrator changes the source through a
**Patient identifier field** dropdown in the panel. COS and EPS must not retain
an independent hardcoded lookup of ePatient.01 after this setting is introduced.

The following details are implementation inferences needed to make that setting
consistent and reviewable:

- Store the selection in each integration's versioned configuration, defaulting
  both COS and EPS to ePatient.01. Use one field-selector/resolver contract for
  every adapter. The selector names a stable catalog element or compatible custom
  field identity and shows its localized label and stable identifier.
- Resolve the selected field against the report's pinned form/catalog and
  effective clinical version. An absent, unavailable, incompatible, or ambiguous
  value produces a finding; do not fall back silently to ePatient.01 or select
  an arbitrary occurrence. Draft lookup uses the current draft; outgoing delivery
  uses the selected signed version and amendments.
- Apply the selection to EPS matching and refresh, COS patient linkage, both
  exports, diagnostics, demo compatibility checks, and the Review correction
  destination. Selecting another field must be exercised in acceptance tests.
- The chosen field supplies the patient identifier's value. Its scheme/issuing
  namespace remains explicit in integration configuration. Staff HSA identifiers,
  care-unit identifiers, and encounter identifiers have separate mappings; they
  are not read from the patient field.
- Normalize only documented equivalent representations. Preserve meaningful
  digits and distinguish national, coordination, and temporary/reserve identifiers
  and issuing authorities. Match by identifier and namespace, never by name alone.
  Map known namespace aliases explicitly where the source and destination use
  different URIs for the same identifier system.
- Using ePatient.01 for the identity number is this installation's integration
  convention. It does not redefine the NEMSIS field globally or prevent another
  installation from selecting a different compatible field.
- Missing identifiers do not prevent clinical documentation or signing. A COS
  report waits in the appropriate operational state and creates Review work.
  Use a reserve identifier only when its issuing namespace is configured and
  verified as accepted by the receiving installation; do not invent one.
- A selected field or patient-value change invalidates old availability results.
  Bind asynchronous responses and cached documents to report, agency, patient
  identifier, and configuration version. Retain imported-value provenance and
  flag any resulting identity inconsistency for deliberate reconciliation rather
  than silently relabelling another patient's source data.

## Administration and configuration lifecycle

- Provide separate COS and EPS sections with independently visible draft,
  testing, active/inactive, and health states. Include endpoints, supported
  authentication settings, protected credentials, the patient-field dropdown,
  identifier schemes, clinical mappings, and service-specific settings.
- COS has one connection per agency group, inherited by child agencies, with
  explicit hospital/care-unit mappings and a default ambulance care unit for
  non-transport encounters. An unresolved destination creates visible recovery
  work, not a guessed route.
- **Implementation inference:** use the same group ownership for EPS configuration
  to match the requested SSO-like administration and avoid a second configuration
  ownership model. Keep report and patient access scoped to existing agency rights.
- Reuse the SSO draft/test/activate pattern: preserve the active revision while
  editing, bind test evidence to the exact revision, and show configuration history.
  Credential rotation, mapping edits, normal cryptographic key management needed
  by this integration, and activation must be possible in the panel. Routine
  operation must not require CLI commands or integration-specific environment edits.
- Protect saved secrets on the server and expose only configured/replacement
  state to the browser. Use existing administrative authorization and sensitive
  change conventions. Integration administration does not itself grant patient
  data access or authority to perform Review corrections.
- Connectivity and validation diagnostics must distinguish inspection from any
  action that transmits or publishes a test document. Tests must show what was
  verified and what still depends on external account enablement or infrastructure.
- Activation starts with subsequent signatures and signed amendments. It does
  not discover and send historical signed reports automatically. Historical bulk
  transfer is a later explicit workflow, not part of this delivery.
- **Implementation inference:** deactivation pauses already queued delivery work
  and preserves its history and Review items. It does not imply successful delivery
  or cancellation. Reconfiguration must not silently retarget pending payloads to
  another recipient or reinterpret their recorded patient identifiers.
- Show transmission history with report version, destination, status, timestamps,
  attempt count, next automatic retry where applicable, and actionable redacted
  errors. Link recovery work to Review. Neither the audit browser nor a separate
  admin Retry button is the recovery entry point.

## Canonical data-element mapping configuration

- Configure mappings between OpenTriage data elements and COS/EPS in the relevant
  Hospital integrations admin section. This covers EPS import and export, COS
  export, and patient-identifier field selection; it is not limited to connection
  settings or identifier mappings. Supported adapter/profile constraints remain
  enforced, and unsupported mappings retain explicit incompatibility findings.
- Save mappings as authoritative, schema-versioned canonical JSON, following the
  existing transferable configuration conventions, including durable canonical
  JSON files in the established configuration storage/export workflow. Include stable configuration
  and data-element identities, revision, content hash, authorship and timestamps,
  plus catalog/profile dependencies. Any relational or runtime projections derive
  from that JSON and must be verifiable and rebuildable, not a second source of
  mapping truth. Adapter code may enforce supported semantics but must not hide
  editable data-element mappings outside this configuration.
- Provide canonical JSON import/export in the respective admin panel. Preserve
  stable identities and validate schema, dependencies, target catalog/profile,
  terminology, units, cardinality and missing-data compatibility before use.
  Transfer reusable mappings without credentials, clinical data or agency-local
  identity assignments; unresolved local references require explicit configuration.
- Use revision-checked drafts and immutable published mappings through the agreed
  draft/test/activate lifecycle. Importing a package creates a draft requiring
  validation/testing before activation; it cannot silently replace active mappings.
  Test evidence binds to the exact mapping revision. Restoring an older mapping
  creates a new revision and preserves history.
- Pin and record the canonical mapping identity/revision used for each import,
  EPS submission and COS payload/delivery. Later edits or package imports cannot
  rewrite provenance, signed content or prepared payloads. Retried work retains
  its recorded mapping; deliberate remapping is explicit and creates new lineage.

## EPS viewing, mapping, and selective import

- Enable the call-header action when a matching summary is available. Distinguish
  no match, checking, lookup failure, and a retained cached copy. A failed lookup
  must not be presented as proof that no summary exists.
- Use a bounded, scrollable dialog table organized by clinical section. Show all
  clinical content, including narrative, unmapped entries, devices, care plans,
  and historical results. Preserve readable fallback details for unsupported
  resource content rather than silently dropping it. Source authorship and dates
  must remain visible; technical payload details need not dominate the clinical UI.
- Display per-item imports only where a compatible mapping exists, with the
  destination clear. Incompatible codes, units, cardinality, or unsupported
  historical context produce an explanation rather than a coerced value.
- Initial mapping work includes patient/history context, allergies, conditions,
  current medication and relevant procedures/observations where the active EPR
  model and destination profile can preserve their meaning. Exact field and
  terminology mappings are implementation outputs to validate, not assumed
  one-to-one correspondences between NEMSIS and European profiles.
- In particular, historical medication statements do not create administrations
  in this encounter; historical observations do not become freshly measured
  vital signs. Keep clinical dates, certainty/status, units, and provenance.
  Distinguish unknown, unavailable, not assessed, and explicitly negative findings
  using the applicable profile and source semantics.
- Plan imports against the current draft and recheck its revision and current
  authorization when applying them. Do not silently overwrite an existing value.
  Expose conflicts and retain deliberate decisions. Repeated actions, refreshes,
  or replayed commands must not duplicate the same imported item.
- Imported values become ordinary documented EPR content with attached source
  lineage. A signed report remains immutable; opening an EPS must not create an
  implicit post-signature edit path.
- Preserve a stable reference to the source document/version and imported entries
  sufficient to explain an import later. Refreshing the available EPS must not
  change the provenance of values already imported.
- Render external narratives safely and resolve supported references through the
  configured adapter. Do not execute supplied markup or fetch arbitrary embedded
  external links as part of displaying a summary.
- Once opened, protect the cached summary through the existing clinical-draft
  storage, locking, expiry, user/agency separation, and online-recovery boundaries.
  Show summary/source dates separately from retrieval time. Refresh requires
  connectivity. No broader offline login or indefinite retention is introduced.
- Outgoing EPS uses the exact signed EPR version and effective signed amendments.
  Required sections with unavailable information must follow EPS missing-data
  rules without inventing a longitudinal history. Validate profile claims and
  show actionable findings before explicit submission.

## COS delivery, versions, and retries

- Queue eligible new signatures and amendments durably without making clinical
  signing depend on a remote request. Prevent a committed eligible signature from
  being silently missed between signing and job creation; a transactional queue
  or equivalent recoverable event boundary is an implementation choice.
- Eligibility includes assessment/care, non-transport, and refusal reports, and
  excludes cancellation without patient contact. Evaluate actual disposition
  and documented care using the report's versioned definitions, not display text.
- Produce payloads from immutable signed snapshots plus a specified amendment
  sequence. Record the mapping/profile configuration and artifact digest used.
  Retries of that version must be reproducible; a deliberate remapping or newer
  amendment is distinguishable from retrying the same payload.
- Coordinate required COS contact creation/linkage and note delivery with stable
  external identities. A partially completed workflow must be recoverable without
  duplicating contacts or delivering the note under a different patient.
- Serialize or otherwise enforce monotonic delivery for each report/contact.
  Supersede an older pending version when a newer eligible signed version must
  be sent, preserve both histories, and recheck latest-version eligibility for
  manual retry. An older in-flight or uncertain attempt must be reconciled before
  it can race a newer replacement.
- Distinguish awaiting identifiers/configuration, queued, sending, retry scheduled,
  confirmed delivery, failed, uncertain outcome, paused, and superseded states as
  appropriate. These are domain distinctions, not mandated enum spellings.
- A successful queue operation is not delivery. Verify what acknowledgement proves
  storage of the COS note. If the API only acknowledges acceptance, expose that
  state separately and obtain the documented final result before claiming delivery.

The confirmed default is an initial attempt plus five automatic retries:

| Retry | Delay after the previous failure | Approximate cumulative delay |
| --- | --- | --- |
| 1 | 1 minute | 1 minute |
| 2 | 5 minutes | 6 minutes |
| 3 | 15 minutes | 21 minutes |
| 4 | 30 minutes | 51 minutes |
| 5 | 60 minutes | 1 hour 51 minutes |

- Configure the finite schedule in the COS panel. Add modest jitter to avoid
  synchronized retry bursts; the elapsed figures exclude request duration.
- Create the Review failure item after the first failure. Automatic retries do
  not hide it, and success resolves it. After the budget is exhausted, leave it
  open for deliberate recovery.
- Retry connection failures and temporary service failures only when replay is
  safe under the verified COS contract. Missing identifiers, invalid payloads,
  and rejected credentials require correction. A timeout with uncertain delivery
  requires reconciliation; do not classify it as a definite rejection and blindly
  resend. The supported reconciliation mechanism remains a sandbox dependency.
- Manual retry performs an authorized, replay-safe attempt against the latest
  eligible version and records its actor. Concurrent clicks or workers must not
  create parallel duplicate attempts or duplicate Review items.

## Signed-report PDF

- **Human review checkpoint (slice 011, HITL):** generate a downloadable PDF
  from representative fictional signed report data and show it to the product
  owner for visual review before finalizing the slice or merging its PR. Include
  long content, repeated/custom fields and signed amendment provenance. Automated
  checks remain required; passing them does not replace explicit PDF approval.

- Build the PDF from the same signed clinical version as the structured payload.
  Render documented fields, repeatable clinical tables, custom fields, text notes,
  authorship, signing details, and amendments using pinned definitions and labels.
- Include report photos subject to the verified COS limits. Identify audio notes
  with their timestamp and duration and explicitly state that the recording was
  not transferred. Audio transfer and automatic transcription are not included.
- An attachment-size or rendering failure must be visible and actionable. Do not
  claim a complete transfer while silently omitting documented content or photos
  to meet a size limit. The supported sizing/rendering approach must be verified
  against the receiving contract.
- Preserve synthetic/demo labelling on fictional reports. Generated labels follow
  the existing localization framework; patient-authored or clinician-authored
  source content is retained faithfully.
- Keep the renderer reusable, but a general-purpose print/PDF workspace is not
  required by this feature beyond the preview/inspection needed for its workflow.

## Built-in Review recovery and identifying access

| Built-in item | Default routing | Actions and completion |
| --- | --- | --- |
| Missing transmission identifiers | Documenting clinician for missing patient identity; shared queue for missing integration mappings | Document valid identifier validates the required correction, records the outcome, and queues eligible delivery. Patient changes create an attributable signed amendment. Mapping changes use integration administration and are revalidated. |
| COS transmission failed | Shared queue | Inspect failure and retry the latest eligible signed version. Complete automatically only after confirmed delivery; queuing an attempt is not completion. |

- These are hardcoded operational conditions with stable identities, comparable
  to the existing built-in overdue workflow. They are not rules an administrator
  must author in the clinical validation language. Expose their routing through
  the existing Review settings, including an eligible named reviewer option.
- Keep stable items for the report, integration, and reason across repeated
  attempts, retaining their version evidence and history. A later relevant failure
  reopens/reconciles the appropriate item instead of losing previous conclusions.
- Missing patient identity does not block signing. The Document valid identifier
  outcome is an authorized command, not a free-text assertion that a correction
  occurred. It validates the configured field and receiving identifier scheme,
  saves the amendment with reason/actor/attestation, records the Review outcome,
  closes the resolved identifier item, and durably queues delivery. A failed
  correction must not close the item or queue a partial update.
- Resolve only requirements actually satisfied by the action. If other identifiers
  remain absent, show the remaining blockers. If subsequent delivery fails, the
  transmission-failure item remains a separate operational concern.
- Staff/care-unit/configuration identifiers are corrected in the integration panel
  under administrative authority. Review permissions do not grant configuration
  editing or permit changes to another user's external identity mapping.
- Use existing Review permissions, report scope, assignment, and concurrency rules
  for corrections; do not add the previously proposed dedicated identity-correction
  permission. Report access alone is not mutation authority.
- **Confirmed change to shared Review behavior:** the documenting clinician can
  see identifying information on their own reports without review:identifying.
  Other reviewers need their existing report/agency scope plus review:identifying.
  Assignment and identifying permission never expand report or agency scope.
- Apply this as a report-relative policy across Review views, related content,
  findings, narratives, media, corrections, and relevant query projections. A
  viewer's access to their own report must not turn a global identifying flag on
  for other reports in a mixed queue or export. Preserve live-session, revocation,
  organization, and real/synthetic dataset boundaries.
- Existing audit-browser permissions remain independent. Own-report Review access
  does not automatically grant unrestricted identifying audit access.

## Persistence, audit, and UI contracts

- Extend the existing persistence model to retain versioned integration settings,
  protected credentials, identifier/mapping configuration, EPS source/import lineage,
  report artifacts, delivery jobs and attempts, and operational Review relationships.
  Physical schema and worker choices are implementation decisions, not settled
  table layouts in this PRD.
- Keep configuration, a signed report/amendment, a rendered payload, an attempt,
  and its remote result separately identifiable. Record stable relationships so
  later configuration edits cannot rewrite the explanation of an earlier send.
- API boundaries must authorize configuration commands, report-scoped EPS lookup
  and imports, explicit submissions, transmission inspection, Review correction
  outcomes, and retries. Derive actor and agency scope from the live session;
  require expected revisions/idempotent command identity for applicable mutations.
- Record configuration changes, tests and activation, EPS retrieval/import/export,
  identifier outcomes, queued/sent/failed/uncertain attempts, manual retries,
  acknowledgement reconciliation, supersession, and Review resolution. Distinguish
  user actions from worker actions and link both to the relevant report/version.
- Surface permitted evidence through existing audit browsing and the integration
  history view. Preserve previous attempts on success. Avoid credentials, tokens,
  unrestricted payloads, and unnecessary patient identifiers in routine errors.
  Protected clinical inspection continues to require the appropriate authority.
- Use existing UI components, agency colors, accessible controls, bounded tables,
  mobile adaptation, focus restoration, and localization files for all new visible
  UI text. Keep save/activation and import errors actionable without clearing
  already loaded permitted data or losing a draft.
- Existing synthetic-record expiry and protected-storage boundaries still apply.
  Integration-related copies must not silently outlive their intended clinical or
  synthetic retention solely because a delivery failed. Retain permitted audit
  metadata under the established audit-retention behavior.

# Testing Decisions

Test all seven module boundaries and the complete user workflows. Tests must
verify observable behavior and failure recovery, not mirror internal helper
implementations. The product owner confirmed the acceptance coverage in the
design interview; the module table organizes that coverage.

## Representative and regression coverage

1. **Configuration and identity:** exercise draft/test/activate/rotate/deactivate
   without CLI access, group inheritance, cross-group denial, credential redaction,
   and tests bound to a configuration revision. Verify the ePatient.01 default for
   both adapters, then select another standard or custom identifier field and prove
   that lookup, exports, diagnostics, and Review outcomes all use it. Include absent
   fields on older pinned reports, invalid namespaces, ambiguous values, formatting,
   and stale responses after a patient/configuration change.
2. **Clinical mapping:** round-trip mappings through admin editing, canonical JSON
   save/export/import, test and activation; verify stable identities, hashes,
   immutable revisions and reproducible projections. Reject incompatible schemas,
   unresolved dependencies, stale revisions and secret-bearing packages. Verify
   that earlier imports and queued deliveries retain their recorded mapping after
   a new revision activates. Use pinned EPS and COS profiles and representative signed
   reports. Check required sections, references, narrative, codes and units,
   repeatable groups, custom fields, missing-data distinctions, provenance, and
   amendments. Verify that historic observations and medication history are not
   turned into current measurements or administrations. Unmapped data remains
   visible, and incompatible imports fail with actionable findings.
3. **EPS workflow:** discover both test patients by identifier, display all sections,
   import selected mapped data, handle conflicts and duplicate clicks, preserve
   drafts and provenance, refresh, and explicitly submit the signed result. Prove
   that unimported incoming content is absent from the outgoing summary. Include
   malformed bundles, unsupported references, and unsafe narrative rendering.
4. **Offline behavior:** open a summary online, lose connectivity, continue to read
   the protected cached copy, and recover under existing session rules. Test expiry,
   logout/user switching, agency switching, revoked access, patient changes, stale
   network responses, and refresh without rewriting imported provenance.
5. **Delivery and retries:** verify new-signature and amendment triggers, no automatic
   activation backfill, non-transport routing, no-contact exclusion, missing mappings,
   and signing during an outage. Use a controlled clock for five delayed retries,
   exhaustion, jitter bounds, nonretryable errors, and manual retry. Simulate worker
   restarts, duplicate commands, partial contact/note success, unknown outcomes,
   acknowledgement delays, and competing amendments so older data cannot win.
6. **PDF:** inspect readable output with repeated fields, custom labels, text notes,
   photos, signer/amendment information, synthetic markings, and explicit audio
   omissions. Check size/render failures and consistency with the structured payload.
   Test English and Swedish labels and representative long content.
7. **Review recovery and authorization:** verify one stable item per operational
   concern, default/configured routing, claim/assignment rules, correction outcomes,
   invalid corrections, duplicate submissions, and automatic failure resolution only
   after confirmed delivery. Cover every combination of own/other report, identifying
   permission, report scope, agency, dataset, assignment, and revoked access. Add
   shared regressions for own-report identifying access, including mixed queues,
   notes, media, and amendment evidence; preserve audit permission separation.
8. **Audit and operational visibility:** reconcile displayed status with persisted
   attempts and remote evidence. Confirm configuration and recovery attribution,
   historical attempt preservation, payload/credential redaction, permitted report
   links, and durable outcomes under concurrent activity.

Prior art includes existing OIDC draft/activation/rotation integration and browser
tests; signing and amendment tests; Review access, routing, completion, discussion,
and overdue-recovery tests; patient/audit-access tests; protected-clinical-storage
tests; and shared synthetic-record generation tests. Extend these shared behaviors
where appropriate so the same failure category is caught outside the new screens.

## End-to-end acceptance

- From the admin panel, configure and activate the hackathon EPS connection and
  test its identifier selection without editing environment files or using a CLI.
- Generate/open demo calls for **Andrea Lindqvist** and **Arne Bergström** with
  matching test identities and demographics. Their supplied sample identifiers are
  **200207252388** and **194302096997**, respectively, in the service's personnummer
  namespace. Use the current sample documents as authoritative fixture references.
  Update the shared demo-call sources so all applicable generation paths agree.
- Retrieve an EPS, inspect all its sections, selectively import mapped fields,
  exercise offline viewing, sign, and explicitly submit a valid EPS. Inspect the
  receiving service's rendering as well as its validation result. Confirm that a
  different configured identifier field drives the same journey.
- With the COS simulator, exercise full delivery, PDF inspection, non-transport,
  missing identifiers, the identifier outcome, temporary failures, retries,
  exhaustion, amendments, and history/audit visibility.
- **COS sandbox acceptance is pending access:** verify actual patient/contact
  linkage, the stored structured note and PDF/photos, replacement by amendments,
  supported identifiers, attachment limits, authentication, and the acknowledgement
  or reconciliation proving storage. Simulator success cannot satisfy this gate.
- Inspect desktop and mobile layouts, keyboard operation, focus restoration,
  nondefault agency branding, and localization. Application runtime and database
  checks must follow the repository's ordinary local-development prerequisites.

For implementation PRs, run the repository's required **npm run check:ci** local
application, browser-deployment, database, and scale preflight before sending a PR.
Add representative local/PR checks for integration failure categories and keep
external-service tests distinct from deterministic local coverage. This PRD-only
change does not claim those implementation checks have run.

# Out of Scope

- Live pre-arrival hospital updates or continuous streaming of an unsigned report.
- COS retrieval of hospital history; the initial inbound workflow is EPS.
- Multiple COS installations per agency group and routing between installations.
- Generic EPS/FHIR server adapters beyond the hackathon service in the first release.
- Automatic publication of EPS, automatic carry-forward of unimported source data,
  and implicit changes to a signed report when a summary is opened.
- Audio transfer, automatic transcription, and a broader media-exchange service.
- Automatic historical-report backfill on activation. A later historical-transfer
  workflow would require explicit selection and preview.
- A general signed-report amendment editor beyond the focused identifier outcome,
  or a general print/PDF workspace beyond this integration's rendering needs.
- Automatic creation of a national/reserve patient identifier, name-based patient
  matching, or unverified terminology conversion to force a passing payload.
- Retry controls in audit logs or a parallel operational recovery queue.
- A new dedicated identity-correction capability separate from Review permissions.
- COS production acceptance, regional account enablement, or a claim that EPS
  validator success establishes clinical or regulatory readiness.

# Further Notes

## Confirmed changes and supersession

- Data-element mappings for both COS and EPS are admin-configurable, versioned
  and saved as transferable canonical JSON using existing configuration patterns.
  This applies to clinical exchange mappings as well as patient-field selection.

- The final patient-identifier instruction applies to **all integrations**:
  ePatient.01 is the default, with an admin dropdown to select another field.
- The later Review decision replaces the earlier suggestion to retry from audit
  logs or the administration transmission list. Recovery actions belong in Review;
  those other views retain history and links.
- Document valid identifier is a structured **outcome action**, not merely an
  instruction to edit somewhere else and manually mark a review complete.
- Existing Review permission rules supply correction authority. This supersedes
  the initially suggested separate correction permission and the older Review
  requirement to hide identifying information even on the clinician's own report.
  The broader identifying-access change is planned work, not current behavior.
- EPS networking is initially limited to the hackathon service. Reusable document
  handling does not imply support for every FHIR server's retrieval API.

## External dependencies and remaining verification

COS sandbox access is pending with Cambio. Continue against published profiles
and a simulator while keeping real COS verification explicitly outstanding. The
target installation must settle its actual profile/API versions, OAuth grant and
scopes, clinician/HSA and organizational mappings, patient/reserve identifier
namespaces, contact lifecycle, medical-record template, attachment handling/limits,
and reliable final delivery acknowledgement or reconciliation. Public
documentation alone does not settle all of these contracts.

The hackathon service was inspected read-only during planning. Its supplied team
credential identified OpenTriage and its validator reported available. No document
was submitted during that investigation. Enter the credential through the future
panel; it is intentionally not included in this PRD.

The event service identifies EPS 1.0.0-ballot as its target and publishes synthetic
worked examples. Its validation checks do not cover every external terminology
system. Pin and independently verify the mappings and terminology used; structural
validation is only one part of acceptance. The EPS ballot and the evolving
development guide must not be confused with identical, finalized requirements.

Implementation inferences are labelled above where the interview did not settle
storage layout, API spellings, configuration ownership for EPS, or detailed state
representation. Resolve routine engineering choices within the agreed scope;
record any materially different external contract discovered during sandbox work.

## Primary references

- [Cambio Open Services developer portal](https://developer.openservices.cambio.se/)
- [COS sandbox access and authentication](https://developer.openservices.cambio.se/getting-started)
- [COS prehospital care](https://fhir.openservices.cambio.se/site/prehospital-care.html)
- [COS prehospital encounter](https://fhir.openservices.cambio.se/site/StructureDefinition-EncounterPreHospital.html)
- [COS prehospital-note bundle](https://fhir.openservices.cambio.se/site/StructureDefinition-BundlePrehospitalNote.html)
- [COS prehospital QuestionnaireResponse v2](https://fhir.openservices.cambio.se/site/StructureDefinition-QuestionnaireResponsePreHospitalNoteV2.html)
- [COS patient identifier definitions](https://fhir.openservices.cambio.se/site/StructureDefinition-PatientSe-definitions.html)
- [HL7 Europe EPS 1.0.0-ballot](https://hl7.eu/fhir/eps/1.0.0-ballot/)
- [EPS bundle profile](https://hl7.eu/fhir/eps/1.0.0-ballot/StructureDefinition-bundle-eu-eps.html)
- [EPS missing-data guidance](https://hl7.eu/fhir/eps/1.0.0-ballot/missing-data.html)
- [HL7 International Patient Summary](https://hl7.org/fhir/uv/ips/)
- [Hackathon service and validation description](https://hackathon2026.vadimperetok.in/)
- [Hackathon OpenAPI specification](https://hackathon2026.vadimperetok.in/openapi.json)
