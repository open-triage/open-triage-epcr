# Dispatch Payload PRD

## Problem Statement

OpenTriage currently synthesizes dispatch, incident, unit, patient, and timeline context across browser fixtures, API response properties, database columns, and a bundled encounter document. That makes the mobile demonstration usable, but it does not establish a single vendor-facing dispatch contract or prove that the application can operate from externally supplied NEMSIS-addressed data. Some duplicated projections are semantically incorrect, including treating `eScene.16` as a unit identifier even though it represents an apartment, suite, or room. The parallel browser `events` collection can also diverge from or discard values in the canonical encounter document.

An EMD vendor needs a precise synthetic example and machine-readable schema to develop against before a production delivery endpoint exists. OpenTriage contributors need those same artifacts to be executable test fixtures. The server must be able to ingest a complete dispatch snapshot from a flat JSON file, validate included NEMSIS 3.5.1 content, route it to the configured unit, preserve all valid fields, project the mobile subset, merge later dispatch revisions without overwriting clinician-owned data, and retain an auditable record of rejected or conflicting content.

## Solution

Define a versioned OpenTriage dispatch-message envelope containing transport metadata and a partial NEMSIS 3.5.1 `EMSDataSet`-addressed document. Publish a strict JSON Schema, an integration guide, and three synthetic flat JSON examples for initial assignment, update, and cancellation. The examples use official NEMSIS group IDs, element IDs, datatypes, codes, and attributes, while clearly stating that they are partial dispatch snapshots rather than complete NEMSIS submissions.

Implement ingestion as a reusable server-side library with a file CLI. The CLI receives organization and source context separately, validates the envelope and all supplied NEMSIS content, retains immutable source artifacts and findings, projects valid content into operational and clinical storage, and supports deterministic complete-snapshot revisions. The existing synthetic bootstrap invokes the same ingestion library with the initial-assignment sample. A future authenticated REST endpoint can wrap this library, but no delivery controller, vendor authentication, or credential-management workflow is included now.

Make the canonical NEMSIS encounter document the browser's sole durable encounter source. Opening and reopening a call returns the complete payload-derived document. Timeline and mobile summaries are derived from it, editor saves mutate it directly, and later dispatch snapshots are merged using per-occurrence provenance. Clinician-authored values always win automatically; unresolved differences appear in both Checklist and Review. Remove the patient-information editor and all patient presentation from this mobile workflow while continuing to retain and export valid patient data supplied by dispatch.

## User Stories

1. As an EMD vendor, I want a versioned JSON Schema for dispatch messages, so that I can validate my integration before delivery.
2. As an EMD vendor, I want a complete initial-assignment example, so that I can see the minimum required response, unit, and timing data.
3. As an EMD vendor, I want an update example, so that I can see complete-snapshot revision semantics and later operational timestamps.
4. As an EMD vendor, I want a cancellation example, so that I can implement cancellation without guessing at tombstone behavior.
5. As an EMD vendor, I want a concise integration guide, so that structural rules and lifecycle behavior are understandable beyond what JSON Schema expresses.
6. As an EMD vendor, I want the contract described accurately as a NEMSIS-addressed partial dispatch snapshot, so that it is not confused with a complete conformant NEMSIS submission.
7. As an EMD vendor, I want every clinical or operational value addressed by its official NEMSIS 3.5.1 identity, so that I do not need to maintain OpenTriage-specific aliases.
8. As an EMD vendor, I want codes to be authoritative and display labels optional, so that textual label differences do not change clinical meaning.
9. As an EMD vendor, I want stable opaque group-instance and value-occurrence identities, so that repeated values can be updated or retracted safely.
10. As an EMD vendor, I want explicit parent-instance identities for nested groups, so that arbitrary valid NEMSIS hierarchy is unambiguous.
11. As an integration operator, I want unknown envelope properties rejected, so that vendor typos do not silently change the contract.
12. As an integration operator, I want unsupported NEMSIS versions and unknown or custom element IDs rejected, so that version 1 has a precise semantic boundary.
13. As an integration operator, I want every supplied value validated against NEMSIS placement, datatype, cardinality, code, and attribute rules, so that malformed data does not enter the canonical record.
14. As a dispatcher, I want an assignment accepted when optional content is invalid, so that a nonessential vendor error does not prevent the crew from seeing a call.
15. As an integration operator, I want invalid optional content excluded with precise findings, so that malformed values are visible without contaminating the canonical record.
16. As a dispatcher, I want a payload rejected when required identity, routing, or timing content is invalid, so that unusable assignments are not shown to the wrong crew.
17. As an integration operator, I want findings to identify JSON Pointer paths and NEMSIS element IDs, so that corrections are actionable.
18. As an integration operator, I want exact source files and canonical content digests retained, so that delivery and semantic equality can be audited independently.
19. As an integration operator, I want equivalent JSON whitespace and property ordering treated identically, so that serialization details do not cause conflicts.
20. As a dispatcher, I want exact retries to be idempotent, so that uncertain delivery outcomes do not duplicate assignments.
21. As an integration operator, I want one immutable message ID to map to one content digest, so that an identifier cannot be reused for different data.
22. As an integration operator, I want one response revision to have one canonical snapshot, so that competing payloads cannot redefine accepted history.
23. As a dispatcher, I want newer complete snapshots accepted even when intermediate revisions are missing, so that a delivery gap does not strand a current assignment.
24. As an integration operator, I want stale revisions rejected and revision gaps recorded, so that ordering anomalies remain visible.
25. As a dispatcher, I want omitted vendor-owned values in a newer complete snapshot treated as retractions, so that corrections can remove prior data.
26. As a clinical-system operator, I want organization and source context supplied outside the vendor payload, so that transport authorization cannot be forged inside clinical data.
27. As a clinical-system operator, I want assignments routed by agency-scoped `eResponse.14`, so that the dispatched call sign selects the correct operational unit.
28. As a clinical-system operator, I want `eResponse.13` retained as the physical vehicle identifier, so that vehicle and call-sign identities can differ without misrouting the call.
29. As a clinical-system operator, I want an unknown call sign quarantined rather than assigned incorrectly, so that valid source data is preserved safely.
30. As a dispatcher, I want reassignment represented by cancellation of the old response and creation of a new response, so that unit-response history remains auditable.
31. As a clinical-system operator, I want the vendor's stable source-record identity separate from `eResponse.04`, so that ingestion identity does not misuse a vehicle-response number.
32. As a clinical-system operator, I want OpenTriage to generate `eRecord.01` when the ePCR opens, so that the EMS agency—not the EMD vendor—owns the PCR number.
33. As a clinician, I want assignment cards populated only from the ingested NEMSIS document, so that displayed call context has one source of truth.
34. As a clinician, I want the assignment card to show incident number, call sign, unit-notified time, and optional dispatch reason, so that I can identify the call quickly.
35. As a clinician, I want a neutral label when dispatch reason is absent, so that chief complaint is never used as an implicit fallback.
36. As a clinician, I want the encounter header to show incident number, response number, call sign, and formatted scene location, so that operational context remains visible while documenting.
37. As a clinician, I want dispatch and unit timestamps shown on the timeline, so that response progress is chronologically understandable.
38. As a clinician, I want timestamps shown in the configured agency time zone, so that a device location cannot shift incident time.
39. As a privacy-conscious clinician, I want patient demographics, phone numbers, and chief complaint hidden in this mobile workflow, so that the interface exposes only its intended operational subset.
40. As a records custodian, I want hidden valid NEMSIS data retained in the canonical report and signed export, so that UI visibility never causes data loss.
41. As a clinician, I want a newly opened call initialized from the complete payload-derived encounter document, so that browser constants do not replace dispatch data.
42. As a clinician, I want the timeline and editors to operate directly on the canonical encounter document, so that parallel browser models cannot diverge.
43. As a clinician, I want saved groups removable through the existing editor Remove controls, so that direct document editing retains current form behavior.
44. As a clinician, I want an opened report to remain usable offline, so that payload-derived documentation survives connectivity loss.
45. As a clinician, I want opening a previously unopened assignment to require connectivity, so that report and form identities remain server-authoritative.
46. As a clinician, I want an actively open report to discover dispatch updates within the existing ten-second refresh interval, so that new operational information appears without reopening.
47. As a clinician, I want dispatch-authored values updated by newer dispatch snapshots until I touch them, so that vendor corrections remain useful.
48. As a clinician, I want newer dispatch values to fill untouched empty fields automatically, so that later information is incorporated without manual copying.
49. As a clinician, I want creating, editing, clearing, or affirming a value to make it clinician-owned, so that later dispatch cannot silently overwrite my work.
50. As a clinician, I want blocked dispatch differences shown non-modally in Checklist and Review, so that documentation is not interrupted and conflicts remain discoverable.
51. As a clinician, I want to keep my value, accept the dispatch value, or acknowledge the unresolved difference, so that each conflict has an explicit disposition.
52. As a clinician, I want unresolved dispatch conflicts acknowledged before signing, so that the signed record reflects conscious review.
53. As a clinician, I want dispatch cancellation before opening to remove an assignment, so that obsolete work is not started.
54. As a clinician, I want dispatch cancellation after opening to preserve the report and show a prominent notice, so that legally relevant documentation is not deleted.
55. As a records custodian, I want post-signature dispatch revisions retained without mutating the signed snapshot, so that immutable records remain trustworthy.
56. As a records custodian, I want accepted post-signature differences routed through amendments, so that later corrections follow the established legal workflow.
57. As a contributor, I want synthetic bootstrap to load the initial vendor sample through the production ingestion library, so that demo data exercises the intended boundary.
58. As a contributor, I want the static prototype generated from the same committed sample, so that browser-only demonstrations do not reintroduce hardcoded call data.
59. As a contributor, I want the committed examples to be executable contract tests, so that documentation cannot drift from behavior.
60. As a maintainer, I want obsolete hardcoded dispatch fixtures, chief-complaint projections, patient editing code, and parallel event persistence removed, so that the new architecture has one clear source of truth.

## Implementation Decisions

### Dispatch contract and vendor artifacts

- Version 1 is a strict JSON envelope with a schema identity, schema version, immutable UUID message ID, stable vendor source-record ID, positive revision, `upsert` or `cancel` event type, offset-aware sent time, NEMSIS data-model declaration, and canonical groups.
- Structural objects reject unknown properties. NEMSIS attributes are accepted only when valid for the pinned NEMSIS 3.5.1 XSD/catalog definition.
- The clinical body reuses the canonical group-instance-element-value representation. Nested group instances add `parentInstanceId`, required when the catalog group has a parent. This structural addition increments the encounter model version.
- Instance and occurrence IDs are opaque, stable, non-PHI vendor identities. They remain stable across revisions. OpenTriage derives its internal UUID identities rather than requiring internal IDs in the payload.
- Coded values require a code. Display labels are optional and are checked or canonicalized against the pinned catalog. The examples include displays for readability.
- The primary example contains dispatch-originated response, unit, patient demographic, repeated phone, scene, dispatch, and time data. It contains no vitals, medications, procedures, clinical history, impressions, or notes. Clinical NEMSIS content could be ingested generically, but a workflow for dispatch-supplied clinical data is deferred.
- Patient telephone numbers use repeatable `ePatient.18` values and valid `PhoneNumberType` attributes, including the pinned codes for home and mobile. All names, addresses, identifiers, dates, and telephone numbers are conspicuously synthetic.
- The update and cancellation examples are complete snapshots of the same source record with increasing revisions. Cancellation uses `eventType: "cancel"` and includes `eTimes.14`.
- The integration guide documents ownership, complete-snapshot semantics, validation behavior, canonical equality, revision rules, cancellation, required fields, examples, and the future single-message JSON REST shape. It does not claim full NEMSIS submission conformance.

### Required and optional NEMSIS content

- Every accepted assignment revision requires concrete, non-null values for incident number (`eResponse.03`), EMS response number (`eResponse.04`), vehicle number (`eResponse.13`), unit call sign (`eResponse.14`), dispatch-notified time (`eTimes.02`), and unit-notified time (`eTimes.03`).
- Dispatch reason (`eDispatch.01`) is optional. The sample includes it. When absent, the mobile projection uses “Dispatch reason not provided.”
- Any element valid in the pinned NEMSIS 3.5.1 EMS dataset may be supplied and retained, including chief complaint, but only explicitly configured elements are projected in the mobile UI.
- Version 1 rejects unknown and namespaced custom element IDs. It validates included content rather than requiring completion of every mandatory or required field in a finished NEMSIS ePCR.
- Invalid required envelope, identity, routing, or timing data rejects the revision atomically. Invalid optional groups, elements, occurrences, or attributes are omitted from the canonical projection, preserved in the immutable source artifact, and returned as structured findings. A revision with such findings has an `applied_with_findings` result.

### Ingestion, storage, and operational projection

- A reusable server-side ingestion library accepts parsed payload content, exact source bytes, authenticated-equivalent organization context, and source-integration context. It returns a structured receipt/result suitable for the CLI now and a REST adapter later.
- A file CLI accepts a JSON path plus explicit organization and source IDs. It exits nonzero for rejected payloads and emits a machine-readable result for applied, replayed, applied-with-findings, quarantined, stale, conflicting, and post-signature outcomes.
- No REST controller, vendor authentication, credential provisioning, credential CLI, or network delivery implementation is included in this feature.
- Ingestion preserves the exact source artifact, an exact SHA-256 digest, a canonical JSON digest, organization/source context, receipt time, validation findings, and applied or blocked changes under clinical-data access and retention controls. Raw payloads are never written to ordinary application logs.
- Semantic equality ignores JSON whitespace and object-property order. Stable identities govern unordered structural collections; any order that affects meaning is represented explicitly rather than inferred from incidental serialization order.
- An exact retry returns the original result. Reusing a message ID with different canonical content conflicts. Reusing an organization/source-record revision with different canonical content conflicts. Older revisions are stale. Newer complete snapshots are accepted despite gaps, with gaps recorded operationally.
- Omission from a newer complete snapshot retracts a vendor-owned value. Retractions and replacements never remove or rewrite clinician-owned values.
- Organization and source are caller context, never trusted payload fields. The agency-scoped `eResponse.14` resolves the operational unit. `eResponse.13` is retained as the physical vehicle number and may equal the call sign when the source has no distinct value.
- Unknown call signs are retained in a quarantined state and are not visible to clinicians. A quarantine reprocessing workflow is not included now.
- A unit reassignment is a cancellation of the old unit response followed by a new revision-1 source record with a new `eResponse.04` and new `eResponse.14`, retaining the shared `eResponse.03` as appropriate.
- One source record represents one unit response for one patient in this feature. `sourceRecordId` is the stable ingestion/revision identity. OpenTriage generates `eRecord.01` when the report opens. Multi-patient response semantics are deferred.
- Database assignment summaries may materialize indexed projections derived solely from the accepted payload. The immutable payload and provenance are authoritative, and projections must be rebuildable.
- Dispatch and report revisions are separate. `dispatchRevision` follows the vendor stream; `reportRevision` advances for accepted clinician and dispatch changes and drives mobile ETags and synchronization.
- Existing data may be discarded. Update the current foundation schema and make clean development/test bootstrap explicit. Normal application startup must never delete data.

### Provenance, merge, cancellation, and signature behavior

- Provenance is tracked per stable group, element occurrence, and value. Vendor revisions may replace or retract vendor-authored content until a clinician creates, edits, clears, or explicitly affirms that target.
- Clinician action makes the target clinician-owned. Later dispatch may populate other untouched targets but cannot overwrite that target.
- Blocked differences retain clinician and proposed dispatch values, source revision, receipt time, and lineage. They become non-blocking warnings in both Checklist and Review.
- A conflict can be resolved by retaining the clinician value, accepting the dispatch proposal as a new clinician-authored edit, or explicitly acknowledging an unresolved difference. One of those dispositions is required before signing, while Save & close remains allowed.
- Cancellation before opening removes the assignment from the clinician list. Cancellation after opening imports `eTimes.14`, preserves all work, marks the report canceled by dispatch, and shows a prominent non-modal notice.
- A dispatch revision received after signature never mutates the signed snapshot. Its artifact and differences are retained and marked as requiring the existing amendment workflow.
- Delivery and provenance metadata remain outside standard NEMSIS XML. Exports contain accepted NEMSIS groups, values, and valid NEMSIS attributes only; audit metadata may be represented separately.

### Canonical encounter and mobile behavior

- The canonical encounter document becomes the only persisted encounter-content source. Remove the durable parallel timeline `events` representation. Temporary editor drafts may remain outside the document.
- Editor Save writes directly to stable NEMSIS group and occurrence identities. Editor Remove deletes the selected canonical group instance. Timeline, validation, Checklist, Review, and completed summaries derive from the document.
- Opening and reopening return the complete validated payload-derived encounter document with the server-pinned form and NEMSIS catalog context. The vendor does not choose form, catalog, organization, assignment, patient, report, or other OpenTriage UUIDs.
- The mobile assignment projection shows `eResponse.03`, `eResponse.14`, `eTimes.03`, and optional `eDispatch.01`. It never falls back to chief complaint.
- The encounter header shows `eResponse.03`, `eResponse.04`, `eResponse.14`, and a correctly formatted subset of `eScene` location elements. `eScene.16` is treated as apartment/suite/room, not a unit.
- The timeline projects supported operational timestamps from `eTimes.02` through `.06`, `.14`, and `.17`. Original offset-aware lexical values are preserved, and presentation uses the configured agency time zone rather than the device zone.
- Patient demographics, date of birth, identifiers, telephone numbers, chief complaint, physical vehicle number, and other unconfigured NEMSIS values remain hidden on mobile while surviving cache, save, sign, and export.
- Remove the patient quick action, dialog, patient-specific editor helpers, and UI tests. Generic NEMSIS validation, storage, and export continue to support patient content.
- An active report polls its report resource every ten seconds using report revision or ETag conditional requests. Unchanged state returns no document. Changed state returns the server's provenance-aware canonical merge and current conflicts.
- New server state is merged with unsaved local edits by stable identities. A brief dispatch-updated notice appears for applied changes; blocked conflicts remain visible until disposition.
- Previously opened reports cache the payload-derived document and remain usable offline. First opening requires connectivity for server-authoritative report creation, form selection, and catalog pinning.
- Existing sign-in, Assigned/Open separation, foreground and manual refresh, polling pause in the background, quick clinical capture, autosave, Save & close, offline recovery, validation, review, and signing behavior otherwise remains intact.

### Synthetic and static workflows

- Replace the existing synthetic dispatch/database constants and bundled synthetic encounter document with the versioned dispatch samples as the sole fixture source for call, unit, patient, scene, and operational timeline data.
- Synthetic bootstrap loads only the initial-assignment sample so the normal demo begins with an actionable call. Update and cancellation examples are invoked explicitly by targeted tests or CLI demonstrations.
- The browser-only static build runs the same validation/projection core against the committed sample and generates its lightweight fixtures. React and TypeScript contain no duplicated incident values.

## Testing Decisions

- Good tests verify externally observable behavior and durable contracts rather than private helper structure.
- All new or materially changed modules are tested: dispatch schema and catalog validation, ingestion and revision handling, immutable artifact retention, operational projection, canonical encounter mutation, provenance merge and conflicts, mobile synchronization and projection, file CLI/bootstrap, and static fixture generation.
- Contract tests validate all three committed examples against JSON Schema and the pinned NEMSIS catalog, including group placement, nested parentage, datatypes, code/display behavior, attributes, repeated phone numbers, required concrete fields, and rejection of unknown properties or elements.
- Ingestion tests cover exact retries, canonical equivalence, message-ID reuse, same-revision disagreement, stale revisions, revision gaps, complete-snapshot replacement and retraction, invalid required content, partial acceptance of invalid optional content, unknown-call-sign quarantine, and organization/source isolation.
- Database integration tests verify immutable raw artifacts and digests, provenance, rebuildable projections, unit routing by `eResponse.14`, distinct physical vehicle identity, report creation, server-generated `eRecord.01`, separate dispatch/report revisions, cancellation before and after open, and post-signature amendment-required outcomes.
- Canonical encounter tests prove that direct Save and Remove operations preserve unrelated and unprojected inbound NEMSIS groups and nested relationships. They replace tests centered on the removed persisted `events` shape.
- Merge tests prove that vendor-authored values can change, untouched fields can be filled, clinician create/edit/clear/affirm actions establish ownership, vendor retractions cannot remove clinician data, and every blocked difference retains lineage.
- Checklist and Review tests cover conflict visibility, keep/accept/acknowledge dispositions, non-blocking Save & close, and required pre-signature acknowledgment.
- Mobile workflow tests prove that assignment cards, headers, locations, and timeline times are derived from sample values; chief complaint and patient/phone values are not rendered; dispatch reason has a neutral absence label; active polling uses conditional revisions; and dispatch update/cancellation notices behave as specified.
- Offline tests cover caching the opened canonical document, editing without connectivity, preserving hidden inbound content, reconnect merge, and the continued inability to open an uncached assignment offline.
- Static-deployment tests prove generated fixtures come from the committed sample and retain the usable browser-only workflow without hardcoded clinical context.
- The existing draft-report PostgreSQL integration suite provides prior art for stable identities, revisions, reconciliation audit, and signed immutability. Existing encounter-document, NEMSIS data-model, incident-flow, offline-report, review, accessibility, persistence, and static-deployment suites provide prior art for catalog validation, document preservation, UI projection, and end-to-end behavior.
- A guard test changes fixture values or compares unique fixture markers to prove the UI source is the JSON sample rather than browser constants.

## Out of Scope

- The production REST ingestion endpoint, HTTP controller, network delivery, bearer authentication, mutual TLS, vendor credential provisioning, rotation, revocation, or rate limiting.
- A quarantine administration or reprocessing workflow.
- Multi-patient calls or multiple patient-care records for one vehicle response.
- A clinician workflow for clinical data supplied by dispatch, even though generic valid NEMSIS content is retained.
- Namespaced custom elements or NEMSIS versions other than 3.5.1.
- Patient viewing or editing in the mobile application.
- Automatic cross-encounter patient matching by identifier, name, date of birth, or telephone number.
- WebSockets, server-sent events, push notifications, or changes to the existing ten-second polling cadence.
- Letting the vendor select organizations, forms, form versions, catalogs, reports, assignments, or internal identities.
- Automatic mutation of signed records; existing amendments remain the only route for post-signature changes.
- Backward-compatible migration of existing synthetic, database, or browser data.
- Normal application-startup data deletion.

## Further Notes

- The implementation is intentionally broad below the UI: all valid NEMSIS 3.5.1 EMSDataSet elements are retained, while mobile presentation remains a small configured projection.
- The current catalog model records core datatype and NV/PN capability but may need enrichment to validate named XSD attributes such as `PhoneNumberType`. Attribute validation must come from pinned source artifacts rather than permissive arbitrary metadata.
- Partial acceptance requires careful dependency handling: an invalid optional parent group or identity must prevent application of dependent children while still returning all discoverable findings.
- Canonical equality needs deterministic ordering rules based on stable identities so harmless serializer differences do not conflict while meaningful repeated-value order is not lost.
- The canonical encounter model version bump is intentionally allowed because existing data may be discarded. Schema, TypeScript contracts, validators, persistence, API DTOs, and fixtures must advance together.
- Source payloads contain patient identifiers and contact information even though mobile hides them. Tests and examples must remain conspicuously synthetic, and production storage must apply clinical-data security and retention controls.
- Future REST behavior should preserve the agreed single-message JSON semantics and distinguish created, replayed, quarantined, conflicting, invalid, and applied-with-findings outcomes, but those HTTP mappings are documentation only in this feature.
- The earlier red Remove-button work already present on the feature branch remains part of the direct canonical group-editing behavior.
