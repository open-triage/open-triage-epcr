# COS signed-record export

The signed-record exporter extends the existing COS queue and Review workflow.
EPS and COS share the bounded HTTPS transport in `hospital/fhir-http.ts`, canonical
mapping storage, signed clinical sources, credential encryption and PDF rendering.
The live adapter never sends clinical data during the connectivity check or CI.

## Configuration

Apply the repository migrations before using the new controls. In the existing
administration panels:

1. Set each signing user's HSA identifier in Users. Conflicting assignments within
   an agency group are rejected. Optional trusted OIDC HSA capture is configured in
   Authentication; enable authoritative capture only for an administrator-verified
   identity-provider attribute. Draft tests do not assign HSA identifiers.
2. Set each operational unit's Rakel identifier in Units. Identifiers are text;
   leading zeroes and separators are preserved. The report pins its call's unit at
   signing, rather than using the exporting worker's or current session's unit.
3. Maintain destination names, local codes and receiving HSA identifiers in the COS
   destination directory. Clinical selection fills the two ordinary NEMSIS scalar
   fields together. Manual editing clears the selection association. Protected
   offline drafts retain their recommendation projection and selected revision.
4. Configure ambulance provider/care-unit HSA values separately from receiving
   destinations. Configure the patient identifier, note template and PDF link.
5. For live mode, configure the HTTPS API and token URLs, client ID, approved scope,
   replacement client secret and subscription key. Saved secrets are not returned.
   Record installation acceptance evidence and the profiles actually verified for
   that installation. A connectivity result is not a clinical submission test.
6. Save, test and activate that exact revision. Editing or rotating credentials
   requires testing the new revision. Activation affects subsequent signatures and
   amendments; it does not bulk-export historical records.

The clinical element crosswalk is canonical JSON at
`packages/contracts/src/cos-element-mappings.json`. API projection and browser
mapping controls consume that same file. Organization-specific mappings remain
versioned, hashed canonical packages in the existing hospital-mapping definition
store. Portable packages do not contain credentials or operational HSA/Rakel
assignments. COS mappings require schema 2; older mapping schemas are rejected.

## Delivery and recovery

Every request to sign and each signed amendment enters the active COS workflow.
The initial signature stays pending until verification or an explicit skip to Review. Disposition
fields, cancellation, missing patient-contact classification and transport status
do not gate delivery. Route to the explicitly selected destination when present,
otherwise to the configured ambulance care unit. Missing dispatch time does not
block delivery. COS requires the ambulance-record start, which uses the report
creation timestamp rather than a dispatch or patient-contact time. Patient and
operational identifiers and valid configuration remain required.

Local signing does not wait for COS. The queue prepares an immutable manifest,
including exact PDF bytes, signed version, mapping hash, resolved context and each
required artifact. Encounter, observations, note and PDF evidence are separate.
A note receipt does not establish independently stored observations or PDF ingestion.

PDF verification reads the active COS journal for the exact patient, encounter and
delivery marker. A typed PDF document under the configured keyword confirms a
document entry independently of structured-note/template verification. It does not
confirm byte-for-byte retrieval or rendering of the receiver's PDF. Refresh status
rechecks this evidence without resending. Missing or ambiguous notes/documents,
explicit PDF inclusion failures and unavailable journal reads appear as PDF
findings; temporary read failures do not erase previously verified PDF evidence.

COS artifact events retain bounded receiver response evidence: HTTP status,
OperationOutcome diagnostics/details/codes/field locations, selected correlation
IDs and a response-body fingerprint. Read-back failures are recorded separately
from the original write receipt, preserving a rejected write's state. Detailed
diagnostics may contain patient data and remain in the private report-retained
artifact journal. The documenting clinician’s signing view and identifying Review
view show bounded receiver reasons and HTTP status; operational summaries and
copyable support details do not expose them. Arbitrary HTML bodies,
authentication headers and cookies are not retained. Historical discarded response
text cannot be recovered by this logging change; do not resend merely to collect it.

Once every submitted remote artifact is verified, a partial clinical projection
does not keep delivery uncertain or block a queued corrected copy. Delivery is
confirmed with an incomplete-coverage finding, and the review item remains active
for that coverage concern. Missing clinical values are never filled in by recovery.

Review shows artifact progress and clinical projection limitations. A submitted PDF
can be inspected through the existing PDF dialog using the stored artifact, with
hash validation and identifying report authorization. It is the submitted copy;
the adapter does not claim to download the receiver's stored PDF bytes.

A potentially committed write has durable intent before the HTTP request. Lost
receipts, timeouts and potentially committed server failures require reconciliation.
Reconciliation performs reads, preserves verified artifacts and never blindly
repeats an Observation POST. Existing encounter updates resolve the exact patient/business
identifier and pin the receiver’s `meta.versionId` in durable request intent before
the PUT. Repeated approval of the same report retains the first verified completed
contact when patient, staff, unit, destination, start time and other contact content
are unchanged. The exporter-generated approval/end timestamp alone never triggers
a completed-contact update. Reuse requires fresh read-back and records the prior
delivery and retained end time; each new note/PDF still needs independent evidence.
An unknown contact PUT cannot be resolved by reusing older evidence.
A legacy HTTP 400 rejection explicitly stating that `revisionId` is missing
can resume with a freshly resolved version when all downstream artifacts remain
unattempted. Unknown writes and already versioned rejections cannot use this repair. When only untouched prepared artifacts remain, the
existing Retry action can resume those parts. Unchanged verified observations are
reused across amendments. Changed or removed previously delivered observations
remain unresolved until the installation has a verified correction procedure.

Use existing Review identifier/mapping repair for unprepared held exports. A
repair records new lineage; it does not rewrite signed clinical data. Unsupported
patient-identity changes after encounter creation remain unresolved.

## Validation and installation acceptance

Run `npm run check:ci` for type checks, lint, unit/browser checks, migrations,
database integration and scale preflight. Tests use fictional data and fake COS
receivers. The sandbox commands in [COS sandbox testing](cos-sandbox-testing.md)
are separate, explicit operations; do not run them against real patients.

Installation acceptance must establish the configured template, each enabled
Observation write/read route, non-transport encounter behavior, exact-version note
verification and typed journal PDF document evidence. A successful metadata read
or an entered acceptance reference does not prove those clinical contracts.
Observation correction/invalidation and receiver PDF rendering require explicit
installation evidence. Keep unresolved delivery evidence visible in Review.

## Retry and review completion

In the report view's COS delivery section, the assigned reviewer can choose
**Retry latest signed version** when the delivery is retryable. For an uncertain result, use
**Refresh status** first; an uncertain outcome is not permission
to resend.

**Close review** records the selected review outcome without retransmitting or
marking COS delivery successful. This is available for both delivery failures
and missing transmission identifiers. The delivery evidence remains visible.
Closing a review does not cancel already scheduled automatic delivery retries.

### Rebuild after an exporter correction

Use **Rebuild corrected export** in the report view's COS delivery section to
prepare a fresh PDF and structured payload from the same signed clinical
version. The assigned reviewer needs identifying access. The action preserves
the original delivery, payload, receipts, and signed record and creates an
audited child delivery using compatible active settings. It does not amend
clinical content or permit patient/recipient changes.

If any earlier delivery is uncertain, the corrected copy is prepared and queued
but cannot send. **Refresh status** continues to target that earlier
attempt. Only after receiver evidence resolves the uncertainty may the worker
send the corrected copy; it cannot retry the superseded parent instead.
An ordinary **Retry latest signed version** still reuses its existing payload.


When COS is active, clinicians must choose a destination or **None** before signing.
None is a picker-only answer for no receiving destination; it records Not Applicable
on both destination fields and uses the configured ambulance care unit for COS.
It creates no hospital directory entry. **Delete** removes the answer and restores
the missing-destination validation error.

## Registering an unknown COS patient

New live manifests pin a `patient` artifact from the effective signed report.
Before the contact is sent, the worker searches PatientSe by the exact identifier
system and value. It reuses one matching patient; conflicting demographics,
multiple results, malformed responses and lookup/authentication failures stop the
export. Only a valid empty search (`total: 0`) or COS's explicit patient-not-found
404 permits registration.

Creation supports validated Swedish personal and coordination numbers. It uses
the documented family/given names, birth date and administrative sex, with no
inference from the identifier. Missing required demographics prevent creation.
COS receives only the PatientSe fields; EPS `name.use` and `name.text` are omitted.
Existing COS demographics are never overwritten. A matching read-back is required
before sending the contact, observations, note or PDF; HTTP 201 alone is not proof.

A unique committed creation intent is shared across retained reports for the
same receiver/client and exact identifier. Concurrent workers, rebuilt deliveries,
restarts and lost responses cannot repeat that POST. Reconciliation is read-only.
A rejected or uncertain creation stays blocked until receiver-side resolution and
matching read-back; retries do not blindly create another patient. Private payloads
and diagnostics follow existing report retention, while Review shows only status
and localized findings. This safeguard is bounded by retained delivery evidence.

Previously prepared manifests keep their original contents; use the existing
rebuild workflow to prepare a new manifest with patient registration. Deploy the
`cos_patient_registration` migration with the API change before new manifests
are prepared.

## Signing waits for COS verification

For an active COS integration, clicking Sign validates the draft and records an
immutable `clinical.signing_submission`. This contains the clinician's approval,
revision, content hash, note manifest and proposed signature metadata. It is not
a signed snapshot. The normal worker renders the PDF from that frozen content,
sends the contact and clinical artifacts, and independently verifies delivery.
Only confirmed delivery of the current revision can finalize the signed snapshot.
Incomplete structured coverage requires an explicit acknowledgement before
finalization. The submitted PDF and finalized snapshot use the same content and
approval timestamp.

The signing screen polls `GET /api/reports/:id/signing-status`. After a successful
note receipt, the first note/PDF read-back waits for the configured initial delay
(default 20 seconds). Admin → COS → Live connection exposes **Initial verification
delay (seconds)**, accepting whole seconds from 0 to 240. Save, test and activate
the configuration through the normal admin workflow. Zero checks immediately;
the maximum leaves time within the five-minute settling window. The setting is
ignored when read-back verification is disabled. Existing receipt deadlines are
not changed when a new configuration is activated. The deadline
is persisted with the receipt and survives restarts; manual checks respect it too.
No report lock is held while waiting. An empty or older journal result then remains
pending while the worker performs read-only verification checks at least ten
seconds apart, for up to five
minutes from the original send. This never authorizes a resend. Explicit receiver
rejections and unrelated unresolved artifacts remain blocking. If visibility does
not resolve within that window, the specific finding remains available for manual
Refresh status. A repeated Sign
request reuses the pending delivery and requests reconciliation. Unknown writes
are not blindly repeated; only verified non-delivery or unattempted artifacts
can resume. Editing changes the revision and prevents the old submission from
signing the new draft. An earlier unknown clinical write must be reconciled before
a changed revision can be delivered. Preclinical failures can be corrected and
submitted again without this barrier.

The signing panel does not offer delivery details or a skip action. The API
skip operation requires a reason, records an excluded delivery, and creates
a delivery-failure review item in the same transaction as the local signature.
It cancels outstanding unstarted work, preserves uncertain remote evidence, and
does not mark COS delivery as verified. Installations without active COS continue
to sign locally. Existing signed reports and their amendment/review delivery paths
remain supported.

Pending delivery audit rows have a `signing_submission_id` and no `snapshot_id`.
Both identifiers are retained separately after signature finalization. Clinical
submission manifests expire with the report; the operational audit retains only
its existing nonclinical metadata.

### Optional read-back verification

Admin → Hospital integrations → COS → Live connection includes **Perform read-back
verification**. Existing configurations default to enabled. Save, test and activate
an edited configuration using the normal configuration workflow. The setting is
pinned to each delivery; it does not silently change already prepared submissions.

When disabled, a successful COS receipt (including an empty HTTP 201) can complete
delivery and permit signing without observation, note or PDF read-back. Completion
is recorded as `accepted` with `readBackDisabled`, never as verified storage.
Explicit rejections, missing receipts, timeouts, malformed responses, identity
conflicts and required routing failures remain blocking. Patient resolution and
contact lookup still run because subsequent resources need the verified contact.
Projection warnings do not require acknowledgement under this policy.

Audit logs → Integrations retains COS artifact outcomes, including successful,
unresolved and skipped verification, artifact identity, configuration revision,
HTTP status and available request correlation. The retained projection excludes
clinical content, PDF bytes, patient identifiers and raw receiver bodies. Earlier
artifact events remain in their original ledger; the retained projection begins
with deployment of the verification audit migration.


### Measured journal visibility delay

On 2026-11-01, five sequential fictional sandbox note/PDF submissions returned
HTTP 201. Polling immediately and then two seconds after each unsuccessful read
verified the exact delivery marker, structured note and PDF document evidence
after 11.493, 6.002, 6.294, 6.221 and 6.073 seconds from the receipt. Median:
6.221 seconds; maximum: 11.493 seconds. The PDF was 24,472 bytes; these timings
include polling granularity and read request latency, not just receiver processing.
PDF document evidence does not mean PDF bytes were downloaded and compared.

The 20-second initial delay exceeds the slowest observed verification by about
8.5 seconds. This small sandbox sample is not a production SLA; slower visibility
continues through the bounded read-only checks above. Earlier report audit events
had sparse manual checks, so their multi-minute first-verification timestamps
cannot establish the actual COS processing time.
