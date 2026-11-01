# COS sandbox payload testing

## Verified result (27 October 2026)

A prehospital encounter, an ambulance note with vital values, and a separate bundle
of **structured** vital Observations have now been created and independently read
back from COS. A generated signed-report PDF has also been submitted inline and
verified as a journal document on a fresh encounter. The working paths are
different; a note's Observation inputs do not prove that numeric clinical
Observations were created.

All clinical API requests in the reusable sandbox client send
`Accept-Language: sv-SE`, in addition to the bearer token and
`Ocp-Apim-Subscription-Key`. This was verified experimentally: the same nonempty
historical heart-rate search returned HTTP 500 without this header and HTTP 200
with it. Empty searches had returned 200 even without the header, masking the
problem. Structured temperature POST succeeded after adding the header; the NEWS2
bundle's previous HTTP 500 (`language is not supported - {}`) also resolved.
This requirement was not listed in the public FHIR gateway OpenAPI parameters.

| Resource | Stored ID | Read-back result |
| --- | --- | --- |
| Ambulance encounter | `106952` | Patient `456`, external encounter identifier, ambulance type, status and period match |
| Initial ambulance note | `135044` | Pulse 72/min, respiration 16/min and temperature 36.7 Cel are present as **text**; superseded by PDF tests |
| Standalone temperature | `19908` | Structured `valueQuantity`: 37 Cel, linked to encounter `106952` |
| NEWS2 | `19915` | Structured calculated score 0, with six `derivedFrom` references |
| Heart rate | `19913` | 78/min |
| Respiratory rate | `19909` | 17/min |
| Body temperature | `19911` | 36.9 Cel |
| Blood pressure | `19912` | Structured systolic/diastolic components: 120/80 mm[Hg] |
| ACVPU | `19914` | Coded Alert (`http://snomed.info/sct|248234008`) |
| Oxygen saturation | `19910` | 98% |
| Fresh PDF-test encounter | `106960` | New ambulance encounter, same fictional patient and configured unit |
| Inline PDF-test note | `135137` | Exact test marker and typed `Document`: `Komplett ambulansanteckning.pdf` |
| Reusable PDF-command note | `135158` | Active note on original encounter `106952`, matching generated PDF and typed document entry |

All six NEWS2 vitals were read as separate `Observation` resources, with the expected
codes, units, measurement time (`2026-10-23T12:00:00+02:00`), patient and encounter.
The verifier also checks that their exact internal IDs are the ones referenced by
NEWS2 `19915`; unrelated observations with similar values cannot pass.

The active application delivery worker remains simulator-only. This establishes a
sandbox contract and reproducible tests, not production credential management,
automatic signed-record delivery, or automatic retries for live clinical writes.

## Working write and read routes

The API base below is `https://api.openservices.cambio.se/api/open`.

1. Create the ambulance contact using
   `PUT /fhir/subscription/Encounter/{external-id}` with an `EncounterPreHospital/v1`
   resource. The sandbox vehicle identifier is
   `https://cambio.codes/msb/is/rakel|123-223`. This returned HTTP 201 and
   `Content-Location: .../Encounter/106952`. Its business identifier is
   `urn:opentriage:cos:sandbox:encounter|0f25a0cd-998c-48bb-8898-05e430fb1f7d`.
2. **Read the contact through outpatient search**, despite the prehospital write
   profile: `GET /fhir/Encounter?subject.identifier={system|patient}&_profile=https://fhir.cambio.se/StructureDefinition/EncounterOutpatientReadSe&_id=106952`.
   The result has class `AMB` and type display `Ambulans`. Direct `GET /Encounter/106952`
   is unsupported; `EncounterLite` inpatient search is not the right read path.
3. Submit the final note with
   `PUT /fhir/subscription/Bundle/{external-id}` and profile `BundlePrehospitalNote/v2`.
   Reference the encounter by its business identifier. Bundle and entries require
   `meta.lastUpdated`; the Bundle also needs its `id`. A future update time is
   rejected, and an unchanged/older update may return 200 without updating data.
4. Discover the internal note ID with
   `GET /journalnotes/?api-version=v2&fromDateTime=2026-10-23T00:00:00&toDateTime=2026-10-28T00:00:00`,
   with request header `patient: 194609073277`. Match both the patient's identifier
   and `hCMContact.hCMContactInternalID`, then obtain `135044` from
   `note.noteId.extension` (`...:JournalNoteId:135044`). This REST route is the
   missing bridge between the write receipt and the FHIR note read.
5. `GET /fhir/QuestionnaireResponse/135044` returns the saved note as
   `QuestionnaireResponseSe/v1`. The external UUID is not the internal note ID.
   The associated template can be inspected with `GET /fhir/Questionnaire/1860`;
   version `2037` uses string fields for these ambulance vital keywords.
6. **For structured storage**, send `BundleNews2/v1` to
   `PUT /fhir/subscription/Bundle/{external-id}`. Include the NEWS2 Observation and
   all six required vital Observations, connected by `derivedFrom`/`fullUrl`.
   COS calculates the score when omitted. This returned `Observation/19915`.
   Alternatively, `POST /fhir/Observation` with `ObservationBodyTemperatureLite/v1`
   and the ambulance encounter was independently verified for a single reading.
7. Read each structured profile with
   `GET /fhir/Observation/_search?patient=456&date=ge2026-10-23&date=le2026-10-24&_profile={profile-url}`.
   Always include `Accept-Language: sv-SE` and follow pagination. The prehospital
   Observation search profile returned 501; use the corresponding Lite read profiles.

Useful primary contracts:
[Encounter example](https://simplifier.net/guide/CambioImplementationGuide2/Examples32?version=current),
[outpatient encounter search](https://fhir.openservices.cambio.se/site/StructureDefinition-EncounterOutpatientReadSe.html),
[journal notes REST API](https://developer.openservices.cambio.se/api-details#api=journal-notes-v2),
[NEWS2 bundle](https://fhir.openservices.cambio.se/site/StructureDefinition-BundleNews2.html).
The current prehospital encounter summary incorrectly lists a Bundle route;
the direct Encounter example was validated by the successful write/read pair.

## Reproduce structured bundle verification

Credentials remain in ignored root `.env.local`. The fixture helper is restricted
to the known fictional patient and a read-confirmed dedicated sandbox encounter.
It reuses `buildCosVitals` for the three implemented scalar export mappings. BP,
SpO2 and ACVPU are explicit fictional fixture data, not newly enabled production
mappings. Never manufacture missing vitals to satisfy NEWS2 for real records;
send the actually available readings using the dedicated Observation APIs instead.

```sh
npm run build -w @open-triage/api
node --env-file=.env.local scripts/cos-sandbox-news2.mjs prepare /tmp/cos-news2-fixture.json
# Explicit write; creates one new NEWS2, then reads and verifies all seven observations:
node --env-file=.env.local scripts/cos-sandbox-news2.mjs submit /tmp/cos-news2-fixture.json
# Read-only verification of the same attempt:
node --env-file=.env.local scripts/cos-sandbox-news2.mjs verify /tmp/cos-news2-fixture.json
```

The helper saves payload, attempt marker, receipt, and independent read-back evidence.
It refuses to resend an attempted write and checks same-origin sandbox URLs before
sending credentials or following pagination links. Failures and timeouts are not
automatically retried. Regression tests cover the language header, wrong patient,
wrong encounter, wrong time/unit/code, text-only values, NEWS2 reference matching,
and pagination failures:

```sh
node --test tests/cos-sandbox.test.mjs
```

Evidence from this investigation is stored locally (not credentials):
`/tmp/cos-structured-news2-sv-payload.json`,
`/tmp/cos-structured-news2-sv-result.json`, and
`/tmp/cos-structured-news2-sv-payload.json.verification.json`.
The last file was produced by the checked-in verifier against the live sandbox.

## PDF works with inline delivery

COS accepted an actual PDF produced by `renderSignedReportPdf` in the following
prehospital note item. The value is a **URI containing base64 PDF bytes**, not a
`valueAttachment` or a reference to a Binary resource:

```json
{
  "linkId": "772786005",
  "answer": [{ "valueUri": "data:application/pdf;base64,JVBERi0..." }]
}
```

The entire bundle travels over the authenticated HTTPS API. This route needs no
public URL, browser login, download token or external document host. Keep the
inline bytes out of routine logs. The shared `cosPdfItem` helper encodes an existing
PDF artifact; `buildCosPayload(..., 'inline')` supports the same transport while
retaining its live-mode gate and default simulator behavior. The serialized bundle
limit includes base64 expansion. The current 2 MiB local bundle limit is not a
verified COS server limit; oversized reports are rejected without truncation.

On 27 October, a completely new encounter `106960` (external identifier
`76a5fe53-ee7a-4ec6-bc5a-8a3e8b5e5263`) and note `135137` were created. The 25,154-byte
PDF and note came from the same fictional source: pulse 72/min, respiration 16/min,
temperature 36.7 Cel, patient `456`, and a unique verification marker. No prior
attachment existed on that encounter. The source PDF SHA-256 is
`7a8d6aeaa4a27a671bd82b1b807845e42b8620266943001e7468b59d97d17f80`.

The REST journal (`GET /journalnotes/?api-version=v2&...`, with the `patient` header)
returned the exact marker on the active note and, under keyword
`Fullständig ambulansanteckning`:

```json
{"value":"Komplett ambulansanteckning.pdf","journalValueType":"Document"}
```

Check `journalValueType`; the enclosing `keywordToolType` is still `Text` even
when PDF storage succeeds. FHIR `GET /fhir/QuestionnaireResponse/{id}` omits the
PDF answer entirely, so it cannot verify the attachment. `verifyCosPdfNote` matches
patient, encounter, active note and exact version marker, then requires the typed
document value and rejects English/Swedish PDF-failure text. Read-only polling is
needed because the journal can briefly return the preceding note after a 201.
This establishes a document entry, **not byte-for-byte retrieval of the stored PDF**.
Viewing the document in COSMIC remains useful for final rendering acceptance.

Controlled comparisons explain why the earlier public URL was misleading:

| Transport | Result |
| --- | --- |
| Original public HTTPS PDF | Note accepted, PDF-failure fallback |
| Generated PDF at a verified HTTPS endpoint | Endpoint preflight succeeded, COS PDF inclusion failed |
| Same generated PDF at HTTP, fictional diagnostic only | COS Java client fetched it; typed document recorded |
| W3C public HTTPS dummy PDF | Note accepted, PDF-failure fallback |
| Inline PDF data URI | Typed document recorded, including on a fresh encounter |

The receiver-side HTTPS download failure is unresolved. Inline delivery avoids
that dependency. Plaintext HTTP is not an application fallback; the temporary
synthetic host/tunnel are no longer needed.

Reproduce using the fixed fictional sandbox patient and existing owned encounter
`106952`. Build first, prepare a new private evidence directory, then submit once:

```sh
npm run build -w @open-triage/api
node scripts/cos-sandbox-pdf.mjs prepare /tmp/cos-pdf-check
node --env-file=.env.local scripts/cos-sandbox-pdf.mjs submit /tmp/cos-pdf-check --inline
node --env-file=.env.local scripts/cos-sandbox-pdf.mjs verify /tmp/cos-pdf-check
```

`submit` defaults to inline when no transport argument is supplied. It checks the
owned encounter, submits the bundle and verifies the active journal document. It
records write intent and refuses to submit the same directory a second time; use
`verify` after a timeout instead of blindly repeating the write. Each preparation
uses a different marker. The harness has no database access or real-patient mode.
Prepared source, PDF, payload, receipts and verification evidence are private local
files. Do not commit credentials or patient documents.

The optional `serve DIR [PORT]` and `submit DIR URL` commands support further
synthetic HTTPS diagnosis. They expose only one immutable generated PDF for a
bounded lifetime. `--allow-http-synthetic` is an explicit fictional diagnostic
exception; normal exporter URLs require HTTPS.

Fresh-encounter evidence: `/tmp/cos-pdf-fresh-inline/verification.json`,
`manifest.json`, `report.pdf`, `payload.json`, encounter/note receipts and
`journal-read-1.json`. Reusable-command evidence is in
`/tmp/cos-pdf-inline-verify/`. Focused regression tests cover exact inline byte
identity, size bounds and attachment verification failures:

```sh
node --test apps/api/tests/cos-pdf.test.mjs apps/api/tests/cos-payload.test.mjs \
  apps/api/tests/cos-configuration.test.mjs tests/cos-sandbox.test.mjs \
  tests/cos-sandbox-pdf-server.test.mjs
```

## Referenced vital signs

The [v2 note profile](https://fhir.openservices.cambio.se/site/StructureDefinition-QuestionnaireResponsePreHospitalNoteV2.html)
supports `resourceReference` items with one or more `valueReference` answers.
Exported observations live in the same collection Bundle; each reference resolves
to one entry's `fullUrl`. Multiple readings remain separate observations, with
their original signed group measurement times. Signing time is never substituted.

Optional `vitalMappings` are part of the immutable canonical mapping package:

```json
{
  "id": "pulse",
  "source": { "kind": "nemsis", "elementId": "eVitals.10" },
  "vital": "heartRate",
  "linkId": "364075005",
  "unit": "/min"
}
```

Supported targets are `heartRate` (`/min`), `respiratoryRate` (`/min`), and
`bodyTemperature` (`Cel`). The source must be numeric, present in the pinned form,
and belong to a signed group with a complete timestamp and timezone. Mapping units
are explicit assertions about the source; there is no implicit unit conversion.
Qualified, absent, malformed or ambiguous measurements stop payload preparation.
These three link IDs were verified in sandbox template 1860 version 2037. They
produce text in that note template; structured persistence requires the separate
clinical Observation/NEWS2 path described above. Other installations need their
own template verification.

Mappings can be supplied through canonical JSON import or the existing COS save
API's `vitalMappings` property. Existing mappings are preserved when an older panel
omits that property; an explicit empty array clears them. No new mapping controls
have been added to the panel. Existing packages without this optional property
retain their original mapping hashes and do not gain vital resources. Newly
prepared payloads include the required PUT identity/update metadata; existing
durable prepared payloads are not rewritten. Blood pressure, oxygen saturation,
ACVPU, triage and medication structures require their own mappings and are not
implemented by these three scalar vital projections.

## Local draft

Keep the client credentials and subscription key in ignored root `.env.local`.
The local draft script reads only these non-secret fixture settings:

```dotenv
COS_SANDBOX_PATIENT_IDENTIFIER=194609073277
COS_SANDBOX_PRACTITIONER_HSA_ID=SE20260202-EXTERNTEST
COS_SANDBOX_CARE_UNIT_HSA_ID=SE162321000024-0016313
COS_SANDBOX_MEASUREMENT_TIME=2026-10-23T12:00:00+02:00
COS_SANDBOX_AMBULANCE_RAKEL_ID=123-223
COS_SANDBOX_PREHOSPITAL_ENCOUNTER_REFERENCE=Encounter/106952
```

These identities come from Cambio's public
[synthetic test data](https://developer.openservices.cambio.se/test-data).
Refresh and verify fixture identities before later sandbox sessions.

```sh
npm run build -w @open-triage/api
node --env-file=.env.local scripts/cos-sandbox-vitals.mjs
```

This writes `/tmp/opentriage-cos-vitals-draft.json` using the shared exporter. It
contains three observations and their questionnaire reference items, plus a new
local contact identity. It is a fragment, not a complete note, and sends nothing.
The contact identity is not a claim that a corresponding contact exists in COSMIC.

Before submitting a complete note, verify contact creation, the receiving template
and link IDs. The PDF slice is mandatory in the published profile; use the verified
inline contract above and confirm the journal document entry. Do not use the
simulator's PDF URN as a live URI.

After submission, confirm persistence and content through a supported read-back
or demo COSMIC inspection. Retain sanitized receipts separately from tokens and
credentials; distinguish acceptance, confirmed storage and uncertain outcomes.

## Coordination-number fixture setup (29 October 2026)

Ville's EPS fixture uses coordination number `201304822172`. COS accepts the same
value with system `urn:oid:1.2.752.129.2.1.3.3`, as specified by
[PatientSe](https://fhir.openservices.cambio.se/site/StructureDefinition-PatientSe.html).
Do not relabel it as a personal number or subtract 60 from its identifier day.

For PCR-000000660, automatic contact creation returned HTTP 400,
`The Person cannot be imported for the given Identifier`. Exact PatientSe search
returned HTTP 404, `Patient Not found for the given identifier`. Registering the
fictional patient with `POST /fhir/Patient` returned 201 and patient `6905`;
independent search verified the unchanged coordination identifier, name, birth
date and gender. Retrying the identical contact request then returned 201 and
encounter `107078`; independent encounter verification passed. This establishes a
missing sandbox patient/import problem for this fixture, not a general lack of
coordination-number support or a universal preregistration requirement.

PatientSe disallows the EPS `name.use` and `name.text` fields (422). Project only
`family` and `given`, alongside the identifier, gender and actual birth date.
The reusable setup command is restricted to the checked-in Ville fixture and
Cambio sandbox. It never sends a clinical report or provisions real patients:

```sh
node --env-file=.env.local scripts/cos-sandbox-patient.mjs verify /tmp/cos-ville-setup
# Only when missing: explicit fixture registration followed by independent readback.
node --env-file=.env.local scripts/cos-sandbox-patient.mjs register /tmp/cos-ville-setup
node --test tests/cos-sandbox-patient.test.mjs
```

Registration requires the exact documented not-found response and saves an
exclusive intent before POST. A previous intent blocks another POST, including
after a timeout; use `verify` to investigate an ambiguous attempt. A 201 with an
empty body is insufficient by itself: matching readback is required. Existing
patients are verified without writing. The application now also checks and registers unknown patients for new live
manifests; see [the signed-record export runbook](cos-signed-record-export.md#registering-an-unknown-cos-patient).

## Draft-note lifecycle blocker (30 October 2026)

Requested workflow: send draft clinical content during online synchronization as
soon as identifiers are available, expose COS failures in the pre-sign checklist,
and generate/send the PDF only after signing. This workflow is not enabled yet.

The current `QuestionnaireResponsePreHospitalNote/v2` contract permits only
`completed`, mapped to Signed in COSMIC. It must not be used to represent an
unsigned OpenTriage draft. The general `QuestionnaireResponseSe/v1` route documents
`in-progress` support, but requires invalidation and recreation for changes.

A single synthetic marker note was submitted with `POST /fhir/QuestionnaireResponse`,
using `status: in-progress`, questionnaire `1860|2037`, the fixed fictional sandbox
patient `456` and sandbox encounter `106952`. COS returned 201 and note `135392`.
Independent `GET /fhir/QuestionnaireResponse/135392` returned the exact marker with
`status: in-progress` and the receiver's read-only extension.

The documented `POST /fhir/Provenance` NULLIFY operation then returned 400 with
`Has signable-status!`. Read-back still showed `in-progress`. The test note contains
only a synthetic lifecycle marker, no clinical assertions or PDF. No application
report was changed. Local intent/receipt files are `/tmp/cos-draft-note-probe-*.json`
and `/tmp/cos-draft-note-invalidate-*.json`.

Do not enable automatic draft-note replacements until a supported unsigned
update/invalidation route is verified. Repeatedly creating new draft notes would
leave stale active versions; sending them as completed would misrepresent signing.
The receiver must support a verifiable transition for edited/deleted drafts and
finalization before the complete requested synchronization workflow can ship.

Contracts:
- https://fhir.openservices.cambio.se/site/StructureDefinition-QuestionnaireResponsePreHospitalNoteV2.html
- https://fhir.openservices.cambio.se/site/StructureDefinition-QuestionnaireResponseSe.html
- https://fhir.openservices.cambio.se/site/StructureDefinition-ProvenanceStatusSe.html

## PCR 668: empty journal despite accepted inline PDF (1 November 2026)

PCR-000000668, report `ab4f0f8b-6717-4d05-89cd-ccaf98b1827d`, delivery
`b027392f-2f96-4c44-a008-3f804bae9e46`, remains unverified. The retained note
bundle contains one 47,273-byte inline PDF whose SHA-256 matches the delivery
manifest. Its PUT returned HTTP 201 with an empty body, request ID
`YFPc0hDx5Pjz4cEq`, traceparent
`00-9683b5563a33d78c681ce8c7fd39f3c2-b94fbb8c92ed2175-01`.
This proves submission of the PDF, not persistence in COSMIC.

FHIR resolves patient `6905` with the unchanged coordination-number namespace
`urn:oid:1.2.752.129.2.1.3.3`; contact `107291` and all seven observations
`20125`–`20131` independently verified. In contrast, both the REST patient lookup
and journal-notes v2 lookup return HTTP 200 with `[]`. Removing the journal date
filter gives the same empty response. The modern `/patient/...` routes described
on the public getting-started page return 404 in this configured environment.
No supported alternative read path has established note or PDF storage.

An empty journal now yields `pdfJournalEmpty`, distinct from a nonempty journal
that lacks the exact version marker (`pdfNoteNotFound`). Neither permits an
automatic resend or confirmation. COS support needs to trace the above PUT and
explain why REST does not resolve the FHIR-verified patient. Do not change the
identifier namespace, register a duplicate patient, or mark the PDF verified to
work around the missing read evidence. No clinical payload was resent during
this investigation.

Further read-only lookup checks on 1 November confirmed exact PatientSe search
with `identifier=urn:oid:1.2.752.129.2.1.3.3|201304822172` returns patient `6905`.
COS marks that identifier `use: secondary`; no alternative identifier is returned.
That is a diagnostic clue, not proof that REST excludes secondary identifiers.
The same patient and journal REST paths with `api-version=deprecated` return 410;
`api-version=v1` returns 404, so these are not usable fallback readers. The public
REST Postman example documents only the bare `patient` header, and the journal
OpenAPI definition has no identifier-namespace parameter. No verified REST
coordination-number lookup workaround was found.
