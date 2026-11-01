# Problem Statement

> **Planned — scope, five modules and testing of all five confirmed on 27 October
> 2026.** This PRD defines the next COS delivery milestone. It builds on the
> Hospital integration PRD and the existing simulator workflow. Sandbox evidence
> establishes several working contracts; it does not establish a complete live
> application integration or production acceptance.

Clinicians need a signed patient-care record to reach COSMIC with the correct
patient, author, ambulance and destination, without entering the same information
again. The current application has signed snapshots, PDF rendering, versioned
integration configuration, delivery queues and Review recovery, but its delivery
worker remains simulator-only. Successful sandbox submissions currently depend on
local scripts and manually supplied identifiers.

User HSA identifiers belong with users, and Rakel identifiers belong with
configured operational units. Destinations need an administered directory that
connects a clinician's selection to the correct receiving HSA identifier. Matching
free-text hospital names and codes is too fragile to be the normal routing method.

COS can accept Observation-shaped input and render it as journal text. A successful
note submission therefore does not establish that independently queryable vital
Observations exist. Initial HTTPS PDF downloads failed despite successful note
receipts; sending the PDF inline subsequently produced a typed document entry in
the journal. The exact submitted PDF has also been extracted from the outgoing
payload, checked against its recorded hash and rendered locally. The application
must distinguish this local inspection from COS attachment verification: the
current receiver APIs do not expose the stored PDF bytes for download.

# Solution

Extend the existing COS workflow to automatically export newly signed
records and signed amendments, using the exact signed clinical version. Signing
continues to work when COS is unavailable or integration configuration is
incomplete. Delivery problems appear in the existing Review workflow.

Add HSA identifiers to user administration, an optional HSA claim mapping to the
existing SSO configuration, and Rakel identifiers to unit administration. Keep
ambulance care-provider and care-unit HSA settings explicit and separate from the
receiving destination's HSA identifier.

Add an admin-managed destination directory. Clinicians receive a searchable
recommended list for `eDisposition.01`; selecting an entry fills its destination
name and corresponding local code in `eDisposition.02`. Store a stable reference
to the selected entry as well. Administrators associate each entry with a receiving
HSA identifier. Preserve free-text documentation and NEMSIS string semantics.

The only additional clinical mappings in this milestone are **blood pressure,
oxygen saturation, AVPU, numeric pain score and administered medications**.
Preserve the existing pulse, respiratory-rate and temperature mappings. Send
supported vital signs through clinical Observation routes as well as representing
the signed record in the prehospital note and PDF. Send medications using COS's
nested prehospital-note medication structure; this milestone does not claim
independent MedicationAdministration storage.

Delivery is complete only when the required encounter, note, PDF and applicable
structured Observations have the specified verification evidence. Show partial
delivery and uncertain outcomes accurately, preserve successful parts, and avoid
blind resubmission.

# User Stories

1. As a clinician, I want my newly signed record exported automatically, so that I do not need a second routine submission action.
2. As a clinician, I want signing to complete during a COS outage, so that external availability does not prevent completing my record.
3. As a clinician, I want signed amendments exported in order, so that the receiving record reflects my latest signed documentation.
4. As a clinician, I want the export to use my signed version, so that later draft or configuration changes cannot silently change what I submitted.
5. As a clinician, I want my user account to hold my HSA identifier, so that I do not repeatedly enter it for exports.
6. As an administrator, I want to set and correct user HSA identifiers with a history of changes, so that exported authorship can be maintained and investigated.
7. As an administrator, I want to capture an HSA identifier from a configured, trusted SSO claim when available, so that verified identity data can reduce manual entry.
8. As an administrator, I want conflicting SSO and saved HSA values exposed, so that a later login cannot silently change clinical attribution.
9. As an administrator, I want manual HSA configuration to work without SSO, so that COS delivery does not depend on an unconfirmed identity-provider claim.
10. As an administrator, I want each configured unit to have a Rakel identifier, so that COS receives the ambulance identity associated with the call.
11. As a clinician, I want exports to retain the call's unit context, so that signing from another workstation or shift does not change the ambulance identity.
12. As an administrator, I want ambulance care-unit identifiers configured separately from receiving destinations, so that clinical observations retain the correct organizational context.
13. As an administrator, I want to maintain destination names, stable local codes and HSA identifiers in one directory, so that clinicians can select destinations consistently.
14. As a clinician, I want a searchable recommended destination list, so that I can select the intended facility or receiving unit quickly.
15. As a clinician, I want a destination selection to populate its name and local code together, so that the record does not contain a mismatched pair.
16. As a clinician, I want to document an unlisted destination, so that incomplete administration does not prevent accurate clinical documentation.
17. As an administrator, I want an unmapped destination to create actionable delivery work, so that the system does not guess an HSA identifier.
18. As an administrator, I want renamed or retired destinations to remain interpretable in old records, so that directory maintenance does not rewrite signed history.
19. As a clinician, I want destination selection to survive the existing protected offline workflow, so that interrupted connectivity does not lose my selection.
20. As a receiving clinician, I want systolic and diastolic pressure paired from the same assessment, so that readings from different times are not combined.
21. As a receiving clinician, I want oxygen saturation stored as a percentage Observation, so that the value is available as structured clinical data.
22. As a receiving clinician, I want AVPU responses translated accurately, so that alertness is not inferred from a different assessment scale.
23. As a receiving clinician, I want numeric pain scores to retain their scale, so that a FACES or FLACC score is not presented as NRS.
24. As a receiving clinician, I want repeated measurements with their original times, so that the course of the encounter remains visible.
25. As a receiving clinician, I want missing or qualified measurements distinguished from actual values, so that the integration does not invent normal findings.
26. As a receiving clinician, I want each administered medication documented with its time, name, dose, unit and route, so that separate administrations remain distinguishable.
27. As a clinician, I want medication response, complications and other signed details retained in the note or PDF, so that limits in the structured medication format do not hide documentation.
28. As a receiving clinician, I want a readable PDF of the same signed version, so that I can see information outside the supported structured mappings.
29. As an administrator, I want to enter and rotate COS credentials through the panel, so that normal operation does not depend on editing environment files.
30. As an administrator, I want connectivity checks distinguished from clinical submission tests, so that I know what a successful test proves.
31. As an administrator, I want activation tied to the tested configuration, so that an untested edit does not replace a working connection.
32. As a clinician, I want delivery status to distinguish a stored note from stored vital signs and a recorded PDF attachment, so that partial export is visible.
33. As a reviewer, I want actionable failures in the existing Review queue, so that recovery has one operational home.
34. As a reviewer, I want retry to preserve successfully delivered resources, so that resolving a later failure does not create duplicates.
35. As a reviewer, I want ambiguous timeouts reconciled before another write, so that uncertainty does not result in duplicated clinical data.
36. As an administrator, I want identity and destination repairs to retain prior delivery evidence, so that corrections remain attributable.
37. As an auditor, I want to trace an exported value to its signed occurrence, configuration and remote resource, so that delivery can be reconstructed.
38. As a clinician, I want care without a selected destination handled explicitly, so that an absent hospital destination is not confused with missing ambulance context.
39. As an administrator, I want activation to affect subsequent signatures and amendments, so that historical records are not unexpectedly exported.
40. As an English- or Swedish-speaking user, I want the new controls and findings localized and accessible, so that they fit the existing clinical and administrative workflow.

# Implementation Decisions

## Confirmed module boundaries

All five modules are in scope and selected for testing. They extend existing
components rather than requiring separate services or deployments.

| Module | Responsibility | Stable interface |
| --- | --- | --- |
| Identity and unit configuration | User HSA assignments and provenance, optional SSO capture, unit Rakel assignments, ambulance organizational context | Resolve a versioned export identity context from the signed author, report organization and call unit; return all actionable findings. |
| Destination directory | Versioned destination entries, scalar-field recommendations, paired name/code selection and destination HSA resolution | List permitted recommendations; select an entry; resolve a signed directory selection. |
| Signed clinical projection | Group-aware BP, SpO2, AVPU, NRS and medication mapping, existing scalar vitals, note representation and completeness findings | Build an immutable export manifest from a signed version and pinned mapping/context. |
| Live COS adapter | OAuth and subscription-key handling, bounded COS HTTP operations, PDF availability and receiver-specific reads/writes | Submit or read a named artifact and return sanitized acceptance, identity and verification evidence. |
| Delivery and recovery | Durable sequencing, artifact state, version ordering, read-back, safe recovery, status and existing Review/audit integration | Queue a signed version; process or reconcile a delivery; expose status; request authorized repair or retry. |

Administration and clinical UI changes belong to these modules. Reuse existing
Users, Units, Authentication, Hospital integrations, report status and Review
surfaces. Do not create a second integration recovery queue.

## User HSA and SSO

- Store an optional HSA identifier with each shared user identity. It is required
  for that user's applicable COS authorship, not for creating an account, logging
  in or signing locally. Use the HSA namespace
  `urn:oid:1.2.752.129.2.1.4.1` in COS references.
- Expose manual editing through authorized user administration with revision
  checks, source, actor and change history. Reject ambiguous duplicate assignments
  to distinct users within the agency group; do not invent a global account-link
  rule from HSA equality.
- Add an optional HSA claim name to the existing OIDC provider draft/test/activate
  lifecycle. No claim name is assumed to be universal, and no regional provider
  contract has yet been supplied.
- **Design decision:** once an administrator enables a claim mapping for the
  active trusted provider, a validated login for an already linked account may
  fill a missing HSA value. New-user approval may carry the captured value into
  the approved account. Draft connection tests only display candidate evidence.
  Retain issuer, subject, provider revision and capture time as provenance.
- Accept claim data only from the validated identity-provider flow, with the
  existing subject binding for UserInfo if that source is supported. Missing,
  malformed or multi-valued claims produce a finding rather than a guessed value.
  They do not prevent ordinary login. Never derive HSA from email or display name.
  Automatic capture requires an administrator-confirmed authoritative HSA attribute;
  a user-editable profile hint is only a candidate for manual verification.
- A differing later claim does not overwrite an existing HSA identifier. Surface
  the discrepancy for authorized resolution and hold affected new exports until
  attribution is unambiguous. Removing an optional claim does not erase a manually
  maintained identifier.
- An HSA attribute does not grant roles, link accounts or prove SITHS/fresh personal
  authentication. Preserve the existing identity and signing assurance rules.
- Pin the resolved identity and its revision in delivery evidence. Reuse the
  original identities for already prepared artifacts. Amendments identify their
  own signer without relabelling unchanged previously delivered observations.

## Unit and organizational context

- Extend each configured operational unit with an optional text Rakel identifier,
  managed through the existing unit editor and revision/audit mechanisms. Preserve
  separators and leading zeroes. Use namespace `https://cambio.codes/msb/is/rakel`;
  do not derive it from the unit name or call sign.
- Require an unambiguous Rakel mapping for a COS export. Validate the
  destination-specific identifier contract without hardcoding sandbox values or
  assuming that every identifier is a fixed number of digits.
- Capture the call/report's operational-unit identity durably and pin its resolved
  Rakel revision for delivery. A later login, unit selection, vehicle reassignment
  or configuration edit cannot silently retarget an already prepared export.
- The existing operational-unit model is not a physical fleet inventory. This
  milestone treats Rakel as the administrator-maintained COS identity assigned to
  that unit. Physical vehicle swaps require an explicit mapping update with history;
  full fleet management remains outside scope.
- Configure ambulance care-provider, responsible care-unit and performing-unit
  HSA identifiers as required by the verified receiver contract. Provide the
  existing integration defaults and explicit unit context where needed. The
  receiving hospital's HSA identifier is a separate destination attribute and
  must not replace the ambulance organization as an Observation performer.

## Destination directory and NEMSIS compatibility

- **Design decision:** add local recommendation support for scalar destination
  fields; preserve the official NEMSIS 3.5.1 definitions. `eDisposition.01` remains
  the destination name string and `.02` remains the local destination code string.
  Neither becomes an exhaustive NEMSIS code set or a disguised HSA field.
- Maintain a group-scoped destination directory alongside COS administration,
  inherited consistently with the existing group integration. Each entry has a
  stable ID, unique local code, display name identifying the facility/receiving
  unit, optional HSA identifier, active state and revision. Entries without HSA
  can be documented but cannot satisfy the selected destination's HSA requirement.
- Different receiving units can have distinct entries even when they share a
  hospital. Enforce the existing NEMSIS length and missing-value constraints for
  the recorded name and code; store identifiers as text.
- Provide searchable recommendations on `eDisposition.01`. An explicit selection
  populates `.01` and `.02` together and records directory ID/revision and selected
  name/code in signed provenance. Opening the field does not select a default.
- Preserve the scalar datatype throughout draft validation, signing, amendments,
  NEMSIS export/import, PDF rendering and analytics. Extend form/catalog metadata
  and controls where necessary to reference a recommendation source; do not force
  these values through the existing exhaustive coded-list mechanism. The current
  catalog editor cannot simply attach a new editable list to an arbitrary scalar.
- Keep the directory authoritative for entries and HSA mappings. Any published
  or cached recommendation list is a versioned projection, not a second editable
  copy of the directory. Reusable clinical mapping packages exclude local HSA
  assignments and credentials.
- While COS is active, use the shared destination picker instead of separate
  name/code inputs. Require a destination or an explicit **None** before signing.
  None clears the hospital strings and directory provenance and records NEMSIS
  Not Applicable (7701001) on both fields; it is not a directory entry. Delete
  removes the answer and restores the built-in missing-destination error.
  Preserve None through saving and offline reopening. With COS inactive, retain
  the scalar inputs; manual changes clear the stable directory association.
  An unmapped documented destination permits local signing and creates Review work.
- Resolve by stable directory entry identity. Missing selection provenance requires
  explicit resolution; never match by free text or choose the first duplicate name.
- Retiring an entry removes it from new recommendations while retaining history.
  Renames and HSA corrections create revisions. Signed selections retain their
  recorded name/code; prepared exports retain their HSA mapping snapshot. Repairing
  a failed export creates explicit mapping lineage instead of rewriting signed data.
- Include recommendations and selected-entry provenance in the existing protected
  offline form/draft lifecycle. A stale or newly retired selection remains readable;
  reconnect-time validation exposes any export issue without discarding documentation.

## Clinical mapping and completeness

The signed source, including the selected amendment sequence, remains authoritative.
Mappings are canonical schema version 2 configuration with group-aware composite
and coded targets. Unsupported package schemas are rejected rather than upgraded
or interpreted through compatibility paths.

| Addition | NEMSIS source | COS representation and rules |
| --- | --- | --- |
| Blood pressure | `eVitals.06` and `.07`, with `.01` measurement time | `ObservationBPLite/v1`, systolic and diastolic components in UCUM `mm[Hg]`. Join within the same blood-pressure/vital assessment ancestry, never by nearest time or array position. |
| Oxygen saturation | `eVitals.12`, with `.01` | `ObservationOxygenSaturationLite/v1`, percentage quantity. Preserve zero and legitimate values; do not fill missing values. |
| AVPU | `eVitals.26`, with `.01` | `ObservationAcvpuLite/v1`. Explicit NEMSIS-to-SNOMED mapping: Alert `3326001` to `248234008`; Verbal `3326003` to `300202002`; Painful `3326005` to `450847001`; Unresponsive `3326007` to `422768004`. Do not infer Confusion or convert GCS. |
| Numeric pain | `eVitals.27` and `.28`, with `.01` | `ObservationPainNrsLite/v1` only for Numeric scale `3328003`. Send a CodeableConcept using `https://cambio.codes/nrs/cs/pain-numeric-rating-scale` and code `0` through `10`, not a quantity. |
| Administered medication | `eMedications.01`, `.03`, `.05`, `.06`, `.04` | Repeated prehospital-note medication groups containing administration time, medication name, decimal dose, unit text and route text. Preserve each administration's grouping. |

- Preserve existing heart-rate (`eVitals.10`), respiratory-rate (`.14`) and Celsius
  temperature (`.24`) behavior and include them in the live structured pathway.
- Do not copy fictional fixture defaults for confusion, supplemental oxygen or
  hypercapnic respiratory failure into real payloads. An undocumented contextual
  flag remains unknown; this scope does not add those clinical assessments.
- Use signed measurement/administration timestamps with timezone. Resolve nested
  groups to their authoritative assessment context and detect conflicting explicit
  times. Never substitute signing time for an undocumented measurement time.
- COS medication parent link ID is `62521000052103`, with the required parent
  SNOMED Coding. Child link IDs are time `118575009`, drug name `410942007`, dose
  `118555000`, unit `767525000` and route `410675002`. Their value types are
  dateTime, string, decimal, string and string respectively.
- Resolve drug codes through the signed/pinned terminology or an explicit versioned
  mapping. Resolve route and dose-unit enumerations to meaningful text. Never send
  a NEMSIS enumeration number as a drug name, route or unit, or reinterpret an
  infusion rate as a bolus dose. Historical medication lists are not administrations.
- Respect flags for administration before this unit's care or by another unit.
  Preserve such qualifiers in the note/PDF; do not attribute that administration
  to the signing clinician merely because COS note authorship requires a signer.
- Medication response, complications, authorization and other details remain in
  the complete signed PDF and applicable existing narrative mappings. Do not
  invent nested medication fields that COS does not support.
- Missing observations and absent medications do not prevent a note/PDF export.
  Do not manufacture data to satisfy a bundle. Missing required fields inside an
  intended structured artifact, ambiguous grouping or an unresolved code produce
  an explicit completeness finding.
- Qualified values retain their meaning. A partial BP may use a documented absent
  component representation only after profile/read-back verification. Otherwise
  retain it in the signed note/PDF and expose the structured limitation. Non-NRS
  pain remains labelled with its actual scale in the note/PDF and is outside NRS
  structured coverage; no numeric reinterpretation is allowed.
- **Design decision:** deliver independently valid artifacts when another clinical
  artifact cannot be projected, while retaining a partial status and Review work
  for a failed in-scope projection. Up-front patient, author, unit or destination
  ambiguity blocks dependent writes. Known out-of-scope representations are shown
  as note/PDF-only coverage, not misreported as structured success.

## COS connection and artifact contracts

- Replace the live-incompatible choice of API key *or* bearer token with the
  verified combination: OAuth client credentials plus an API subscription key.
  Administration supplies API/token endpoints, client ID, replace-only client
  secret, replace-only subscription key and approved scopes. Server-side token
  acquisition, expiry handling and bounded refresh keep secrets out of the browser.
- Extend the existing encrypted credential, draft/test/activate, rotation and
  configuration-history mechanisms. Expose configured/replacement state rather
  than saved secret values. Routine setup must not require `.env` editing.
- Send `Accept-Language: sv-SE` for the verified sandbox contract, appropriate FHIR
  content/accept headers and `Prefer: return=OperationOutcome`. Pin any other
  installation's validated language requirements in its connection configuration.
- Restrict authenticated requests and pagination to the configured trusted API
  origin/path. Keep token and clinical transports bounded; do not forward
  credentials across redirects or log tokens, secrets or unrestricted payloads.
- Create/link the contact with a direct `EncounterPreHospital/v1` resource at
  `PUT /fhir/subscription/Encounter/{external-id}`. Preserve a stable business
  identifier and the COS internal encounter ID. The generic Bundle route printed
  in the encounter summary was not the route verified by the sandbox exercise.
- Use the report's creation timestamp for the COS ambulance-record start,
  as required by `EncounterPreHospital.period.start`. This is not a dispatch or
  patient-contact timestamp. Use its signed
  completion time for the completed encounter end according to the COS contract.
  Do not substitute handover time for signing time. Map destination arrival from
  `eTimes.11` when available; do not invent an estimated arrival.
- Send the prehospital note using `BundlePrehospitalNote/v2` and
  `QuestionnaireResponsePreHospitalNote/v2` at
  `PUT /fhir/subscription/Bundle/{external-id}`. Include required resource identity
  and update metadata and the encounter business identifier. Bind the configured
  questionnaire/template and link IDs to validated installation evidence.
- Use dedicated `POST /fhir/Observation` routes for each actually documented vital
  sign, with patient, encounter, performer, codes, units and measurement time.
  Verify each in-scope profile before enabling it. The previous NEWS2 bundle is
  evidence of structured storage, not a requirement to calculate or create NEWS2
  in this milestone. Do not fill six observations merely to use that bundle.
- The note's resource-reference slice does not itself prove structured storage.
  Avoid creating duplicate clinical Observations when also representing values
  in the note. Pain may use its dedicated Observation API and supported note text;
  do not force an unsupported NRS reference into the prehospital-note profile.
- Reuse the signed-report PDF renderer, including current signed amendments,
  custom fields, photos within supported limits and existing audio-omission labels.
  Send those exact immutable bytes in PDF item `772786005` as
  `answer.valueUri = data:application/pdf;base64,{encoded bytes}` inside the
  authenticated HTTPS bundle. The simulator URN is not a live attachment.
- **Design decision, verified 27 October 2026:** use inline PDF delivery by default.
  A fresh encounter `106960` and note `135137` confirmed a typed `Document` entry
  without a hosted download endpoint. The reusable command repeated this on
  encounter `106952`, note `135158`. Persist the exact PDF bytes, artifact hash and
  deterministic encoding with the prepared delivery; keep the PDF/data URI out of
  routine logs.
  Enforce the encoded bundle limit, including base64 expansion, without truncation.
  The current local limit is 2 MiB for the whole bundle; this is not a discovered
  COS server maximum. Large reports need explicit handling before live activation.
- Inspection or download of a submitted PDF must use that delivery's persisted
  artifact, with its signed version and hash, rather than regenerate from current
  report data, configuration or renderer output. Decoding the inline value must
  reproduce the same bytes. Existing clinical access controls apply. Identify this
  as the submitted copy; do not present it as a PDF downloaded from COS.
- A hosted HTTPS alternative is not required for this milestone. The controlled
  sandbox HTTPS downloads failed; their receiver-side cause is unresolved. If a
  future size requirement warrants hosting, verify that route separately with
  scoped expiring access, redacted URLs and unchanged artifact bytes. Do not switch
  patient documents to plaintext HTTP as a fallback.
- Verify the active note's typed `Document`/`PDFDocument` value in the REST journal,
  matching patient, contact and exact submitted version evidence, and reject the
  English or Swedish PDF-failure fallback. A 201 or fetch log alone is insufficient.
  The FHIR QuestionnaireResponse read omits even successful PDF answers; current
  API evidence proves a document entry, not byte-for-byte stored PDF retrieval.
  Record local artifact integrity/preview evidence separately from receiver
  attachment evidence. A successful local preview cannot substitute for the
  journal check or establish how COSMIC renders the document. Receiver PDF download
  is not a dependency for automated per-delivery verification in this milestone.
- A 2xx response can contain a rejection or report an ignored older update. Inspect
  OperationOutcome and distinguish acceptance from verified storage. Preserve
  signed clinical timestamps separately from monotonic transport update metadata;
  unchanged retries reuse their prepared representation.

## Delivery, read-back and amendment handling

- Export every newly signed version and amendment through the transactional queue.
  Disposition fields, including cancellation, missing patient-contact classification
  and transport status, do not gate delivery. Activation starts with subsequent
  signed versions. Deactivation pauses pending work without discarding history.
- Use the explicitly selected destination when present; otherwise use the
  configured ambulance care unit, regardless of disposition. Missing dispatch
  time does not block delivery; the COS ambulance-record start is the report
  creation timestamp. Do not create a fictitious receiving hospital. Verify this use of
  the live encounter contract explicitly; a receiver rejection remains visible
  rather than being converted to a fabricated transport.
- Persist a delivery manifest with the signed version, source occurrence IDs,
  group identities, mapping/profile versions, resolved identity/destination
  revisions, payload hashes and required artifact list. Each contact, Observation,
  note and PDF verification has independent state and evidence.
- Prepare the manifest before external writes, establish and verify the encounter,
  then submit eligible Observations and the note/PDF with dependency-aware ordering.
  Record intent before each request and persist receipts/internal IDs durably.
  A crash after remote commit but before local receipt is an uncertain outcome.
- The verified encounter read path is outpatient search using patient identifier,
  `EncounterOutpatientReadSe` and the returned internal ID. Verify the encounter's
  business identifier, patient and context; a search hit alone is insufficient.
- Discover the note through the journal-notes v2 API using the patient header and
  bounded clinical dates; match patient and contact, extract the internal note ID,
  then read `QuestionnaireResponse/{id}`. Verify the expected signed version's
  mapped content and medication administrations; verify the PDF result in the
  REST journal as specified above. If exact version
  identity cannot be established, retain acceptance/uncertainty rather than guessing.
- Read Observations using the supported Lite profile search, date bounds and
  pagination. Match the receipt's remote ID where available plus patient, encounter,
  measurement time, status, codes, quantities/components or coded result. Similar
  values on another encounter do not establish delivery. Historical matching
  values without reliable resource identity cannot resolve an ambiguous POST.
- Keep medication verification accurate: this milestone verifies medication
  documentation in the note, not separate MedicationAdministration resources.
  Do not demand a nonexistent medication-resource read API to complete that part.
- Overall completion requires all required artifacts to meet their evidence
  criteria. Expose awaiting configuration/identifiers, pending, sending, partially
  delivered, accepted awaiting verification, uncertain, failed, paused, superseded
  and verified states as domain distinctions, not mandatory enum spellings.
- Reuse bounded retries and Review routing. Retry only a request proven safe to
  replay. Definite validation/authentication failures require repair; timeouts and
  potentially committed 5xx writes require reconciliation. Repeated empty searches
  alone are not proof that resending an Observation is safe.
- Maintain a per-source-observation ledger across report versions. Reuse verified
  unchanged Observations; send genuinely new measurements once. Serialize note
  replacement so an older retry cannot overwrite a newer version.
- Changed or removed already-delivered measurements require a verified correction
  or invalidation mechanism. A newer note does not correct an old clinical
  Observation. Establish the supported COS procedure during adapter acceptance;
  until resolved, show partial amendment delivery and actionable Review work and
  do not append contradictory values or claim complete correction.
- Changing the patient identity after contact creation requires a verified
  invalidation/recreation workflow and reconciliation of its clinical artifacts.
  Never move an existing COS encounter or observations to another patient by merely
  changing a reference. Unsupported recovery remains explicit.
- Keep Retry and identifier/mapping repair in existing Review actions. Preserve
  successful artifact receipts, previous mappings and superseded versions. An
  administrator's routing repair is not a clinical amendment; a corrected signed
  clinical destination or patient identity uses the existing amendment process.

## Persistence, administration and migration

- Add versioned user HSA and unit Rakel assignments/provenance, a destination
  directory and revisions, signed destination-selection provenance, immutable
  resolved export context and artifact/observation delivery lineage, including PDF
  hashes and attachment verification evidence. Extend existing delivery tables and
  immutable evidence conventions where practical instead of creating a parallel queue.
- Use stable keys and tenant-scoped foreign keys/uniqueness, timezone-aware times,
  identifier text and exact clinical numeric representations. Add indexes for
  scoped directory lookup, unresolved delivery work and remote-resource correlation.
  Preserve the application's database privilege model and database-enforced tenant
  boundaries; do not substitute generic authentication-only policies.
- Treat user HSA, unit Rakel and destination assignments as the authoritative
  operational records. Per-integration staff/name mappings are not supported. Resolve user and destination
  identities from these authoritative records.
- Preserve signed hashes, simulator evidence and already prepared payloads.
  Missing required provenance receives actionable resolution requirements on export;
  it does not enable alternate identity or clinical projection paths.
- Extend existing shared API contracts for user/unit edits, OIDC claim mapping,
  directory search/edit, form recommendation metadata, COS credentials/mappings,
  readiness and per-artifact delivery state. Mutations use scoped authorization
  and expected revisions; clinical access is checked separately from admin access.
- The COS panel shows identity/destination readiness, credential state, supported
  mapping coverage and distinct connectivity versus synthetic clinical-test results.
  Use replacement-only secrets and existing canonical mapping import/export.
- Follow the existing UI style guide: compact searchable/paginated directories,
  keyboard-accessible controls, mobile layouts and necessary help in tooltips.
  All new user-visible text, errors and generated labels use localization resources.

# Testing Decisions

The user confirmed **all five modules** for testing. Tests must verify externally
observable behavior and clinical meaning, not mirror private implementation steps.
Use existing COS payload/configuration, sandbox verification, delivery/recovery,
OIDC identity, unit administration, catalog/form, signed-PDF, offline and browser
integration tests as prior art. Extend shared fixtures where they expose the same
failure category across signing, amendments, exports and configuration revisions.

| Module | Required representative coverage |
| --- | --- |
| Identity and unit configuration | Manual HSA edits, tenant permissions, duplicate/conflicting identities, optional verified SSO capture, absent/malformed claims, draft-test isolation, no role/account-link side effects, unit reassignment and old-context preservation. |
| Destination directory | Same hospital with different receiving units, stable IDs, paired name/code selection, manual edits clearing associations, free text, retirement/rename/HSA correction, stale offline selections, tenant isolation, missing or conflicting directory identity and unchanged NEMSIS scalar output. |
| Signed clinical projection | Repeated/nested BP groups, missing components, valid zero values, SpO2 units, all four AVPU codes, NRS versus FLACC/FACES, repeated medication doses, drug/route/unit resolution, prior-care qualifiers, timezones, absence flags and signed-amendment lineage. |
| Live COS adapter | Token acquisition/expiry/rotation, required headers, trusted-origin pagination, redirects and secret redaction, real request shapes, 2xx OperationOutcome failures, bounded reads, exact structured-resource verification, inline PDF byte identity/base64 size limits, active-version document evidence, localized attachment failures and no false receiver-download claim from a local preview. |
| Delivery and recovery | Transactional enqueue, deactivation, partial success, concurrent workers/retries, crash after remote commit, uncertain POST, no duplicate unchanged Observations, ordered note replacement, changed/deleted measurements, identity changes, Review completion, attributable history and access-controlled inspection of the exact submitted PDF after later amendments/configuration changes. |

## Acceptance scenarios

1. An administrator configures user HSA, unit Rakel, ambulance context, destination
   directory and COS credentials through the panel; readiness and test evidence
   refer to the exact configuration revision.
2. A clinician selects a destination, documents repeated BP/SpO2/AVPU/NRS readings
   and at least two medication administrations, and signs. Signing commits even
   when COS is temporarily unavailable.
3. On recovery, the application creates one intended encounter, sends the correct
   signed note/PDF and creates the expected separate clinical Observations. Read-back
   confirms codes, values, grouping, times, patient, encounter and resource IDs.
4. Medication note read-back retains every expected administration's five fields
   and does not combine doses. The UI describes this as medication documentation.
5. COS actually includes the generated signed PDF. The previously observed
   "PDF could not be included" fallback, an HTTP fetch alone or a 201 receipt does
   not satisfy acceptance. Decode the outgoing PDF value and confirm equality
   with the persisted artifact/hash; render that copy to check the signed patient,
   clinical values and version. Independently require the active version's typed
   journal document entry. Verify representative PDF rendering in COSMIC during
   installation acceptance, without requiring a manual check for every delivery.
   Local preview/download is labelled as the submitted copy; do not claim
   byte-for-byte receiver retrieval from the current journal API.
6. A later artifact failure produces partial delivery and one actionable Review
   item. Recovery does not recreate already verified resources.
7. A timeout after an Observation commit leaves uncertainty, then reconciles only
   with sufficient identity evidence. It does not silently repeat the POST.
8. A signed amendment adds one new measurement without duplicating unchanged
   readings and replaces the note in order. A changed/deleted delivered reading
   exercises the agreed correction mechanism or remains explicitly unresolved;
   the latter cannot pass full amendment-delivery acceptance.
9. Renaming a destination or changing a unit's Rakel ID after preparation does not
   change that delivery. Deliberate mapping repair has new attributable lineage.
10. Cancellation and missing disposition or dispatch-time fields do not prevent
    delivery. Explicit destination selection determines routing, with configured
    ambulance context when no destination is selected. The COS ambulance-record
    start uses the report creation timestamp.
11. English/Swedish, keyboard and mobile flows cover setup, selection, status and
    Review recovery; protected offline selection and reconnect remain usable.
12. Existing simulator, EPS, NEMSIS export, signing, amendment and user/unit workflows
    retain their behavior after migration.

Run focused tests during implementation and the repository's full local CI
preflight before sending implementation PRs. Add migration/upgrade tests and
representative browser tests where contracts change. Live acceptance uses approved
fictional patients and dedicated encounters; CI must not submit to COS. Capture
sanitized payload digests, receipts and read-back evidence with profile versions.

Production activation requires installation-specific identity/template checks,
successful PDF ingestion and verified write/read contracts for the enabled targets.
Do not turn unresolved correction/reconciliation behavior into silent success;
its release limitation must be explicit and accepted separately if full acceptance
cannot be achieved.

# Out of Scope

- New clinical mappings for weight, height, airway patency, inspired oxygen/FiO2,
  mean arterial pressure, GCS, glucose, ECG, stroke scores, allergies or history.
- RETTS or other triage integration, new NEWS2 calculation/export, and general
  QuestionnaireResponse diagnosis/procedure workflows.
- Independent MedicationAdministration, prescribing, medication orders or medication
  reconciliation. The in-scope medication output is the prehospital-note structure.
- A national HSA directory integration, automatic discovery of destination HSA
  codes, a new SSO provider or an assumption that a provider exposes an HSA claim.
- Physical fleet/vehicle scheduling beyond maintaining the unit's Rakel assignment.
- Historical bulk export, new EPS functionality or a general-purpose FHIR server.
- Replacing NEMSIS destination datatypes or shipping local HSA identities in the
  official NEMSIS catalog or reusable clinical mapping package.
- Unrelated UI redesign, a second recovery queue, audio transfer or transcription.

# Further Notes

## Relationship to existing specifications

This PRD specializes the COS work in the [Hospital integration PRD](hospital-integration.md)
and extends [Authentication, units and shifts](authentication-units-and-shifts.md)
with user HSA and operational-unit Rakel identifiers. It preserves the earlier
automatic-signature trigger, patient-identifier selection,
immutable mappings, PDF content and Review recovery requirements. It does not
expand EPS scope. Clinical additions are limited to the five requested categories.

Existing implementation has only the three scalar vital mappings and a simulator
delivery worker. Treat richer structured projection, the live adapter, destination
recommendations and identifier fields as new work. The earlier statement that COS
sandbox access is pending is superseded by the evidence below.

## Evidence and unresolved external contracts

- On 27 October 2026, an ambulance encounter and note were independently read back;
  a NEWS2 bundle also yielded six separate structured vital Observations. Standalone
  temperature POST/read-back worked. BP, SpO2 and ACVPU storage is established in
  that bundle context; the intended independent write paths still need acceptance.
- The demo note template renders vital keywords and its medication keyword as
  strings. NRS and medication submission/read-back remain unverified. Medication
  structure does not imply a separate medication-administration registry.
- Public and controlled HTTPS PDF downloads produced failure fallbacks. Inline
  delivery of a generated signed-report PDF then succeeded on fresh encounter
  `106960`, note `135137`, with the matching unique marker and a typed journal
  `Document` value. The reusable sandbox command repeated the result on encounter
  `106952`, note `135158`, with document name `Komplett ambulansanteckning.pdf`.
- The latest submitted PDF was decoded directly from that note's outgoing bundle,
  verified byte-for-byte against the prepared artifact and rendered as two pages.
  It contains the fictional patient Richard Lindeskog, pulse 72/min, respiratory
  rate 16/min, temperature 36.7 Cel and the unique test marker. The 25,044-byte file
  was saved for inspection as `COS-submitted-note-135158.pdf`; its SHA-256 is
  `4f85057cb2eb6af9a31570b1bff42ad46a22cda4e471028dfe58bcbc91d16a50`.
  This is the exact submitted copy, not a receiver download. API read-back does
  not expose the stored document bytes; viewing its rendered content in COSMIC
  remains part of installation acceptance.
- The shared export encoder supports inline PDF bytes and the sandbox harness
  submits and verifies them. The API build and 35 focused COS regression tests
  passed. The application's automatic delivery worker remains simulator-only;
  these results establish the PDF contract without completing the live adapter.
- Exact SSO HSA claim availability, deployed care-unit relationships, non-transport
  acceptance, observation correction/invalidation, and ambiguous-write reconciliation
  need installation-specific verification. These are dependencies, not reasons to
  invent identifiers, clinical values or success states.

Local evidence and reproduction instructions are maintained in the
[COS sandbox runbook](../runbooks/cos-sandbox-testing.md). Relevant primary contracts:
[prehospital note](https://fhir.openservices.cambio.se/site/StructureDefinition-QuestionnaireResponsePreHospitalNoteV2.html),
[prehospital encounter](https://fhir.openservices.cambio.se/site/StructureDefinition-EncounterPreHospital.html),
[BP](https://fhir.openservices.cambio.se/site/StructureDefinition-ObservationBPLite.html),
[oxygen saturation](https://fhir.openservices.cambio.se/site/StructureDefinition-ObservationOxygenSaturationLite.html),
[ACVPU](https://fhir.openservices.cambio.se/site/StructureDefinition-ObservationAcvpuLite.html),
[pain NRS](https://fhir.openservices.cambio.se/site/StructureDefinition-ObservationPainNrsLite.html),
and [journal notes v2](https://developer.openservices.cambio.se/api-details#api=journal-notes-v2).
