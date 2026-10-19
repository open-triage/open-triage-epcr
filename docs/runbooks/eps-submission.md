# Explicit signed EPS submission

Only an identifying, authorized Review user can prepare or submit a signed report.
Choose **Submit EPS**, build the signed-version preview, review the findings, then
confirm the report is fictional before using **Submit to public hackathon service**.
The fixed public endpoint is `POST /fhir/Bundle/$validate`; it records attempts and
can publish passing documents. Admin's GET connectivity check remains read-only.

## Configuration and canonical files

In Admin → Hospital integrations → EPS, configure the exact patient identifier and
**Outgoing EPS mappings**, save, verify connectivity, and activate the revision.
Each outgoing mapping explicitly selects a signed field and an EPS section or structured Patient target. Names map to Patient.name (family, given, middle given name, suffix); date of birth maps to Patient.birthDate. The explicit ePatient.25 crosswalk maps NEMSIS 9919001/9919003/9919005 to administrative gender female/male/unknown, not gender identity. Age is not converted into a fabricated birth date.
The canonical `hospital-mapping` JSON contains `outputMappings` with stable identity,
revision, catalog dependency hash, and `signed-narrative` or `structured-patient` representation. Imported
files preserve their existing bytes/hash identity; malformed or incompatible files
are rejected. Existing identifier/import-only packages remain readable.

Clinical sections use faithful signed narrative, including documented qualifiers,
confirmed import source version/digest/entry/mapping/decision, and effective signed
amendments. It does not manufacture structured longitudinal resources or translate
local codes into an asserted terminology. Current medication administrations,
procedures, and vital signs can only be placed in Patient story. Required sections
without information use `list-empty-reason:unavailable`, never `nilknown`. Missing
required demographics use the EPS/IPS data-absent-reason pattern. Missing or
ambiguous configured patient identity blocks submission.

## Validation at submission

No Java runtime, local validator, or validator environment variables are required,
including in production. Admin configures and activates the EPS connection and
outgoing mappings through Hospital integrations.

Preview checks the selected patient identifier and output mappings locally. Missing
identity and incompatible mappings still block submission. Profile validation is
marked **pending**, not passed. Preview never contacts a public validation service.

On explicit submission (including the opt-in checkbox at signing), the configured
hackathon receiver validates the document through `POST /fhir/Bundle/$validate`.
That endpoint can publish successful documents. Its OperationOutcome and acceptance
headers determine the recorded accepted/rejected/unknown result. No other public
service receives the document, and unknown outcomes are never automatically retried.

Older previews retain their original validation evidence. For a preview blocked by
the former local validator, use **Build with current mapping** to prepare a new
version. This does not resend an accepted or unknown publication.

## Persistence, outcomes, and amendments

A prepared preview stores its exact document, signed snapshot/amendment hashes,
configuration revision, mapping identity/revision/hash, destination, actor, and
validation evidence. Later mapping edits cannot rewrite it. **Build with current
mapping** creates another immutable record with an explicit parent lineage.

Submit commits a durable intent before contacting the receiver. Each command and
preview can have only one attempt. A replay returns the original result. Separate
previews cannot bypass the same signed-version publication lock after acceptance
or an unknown outcome. Lost acknowledgement, process crash, or ambiguous response
remains **Outcome unknown**; there is no automatic retry. Rejection preserves the
service's issue severities/codes/paths and result headers; a new deliberately
remapped preview remains an explicit user action. A signed amendment becomes a
new eligible version and never submits automatically.

Private journal rows and document copies cascade with report retention. Patient
access evidence includes only revision/mapping/decision metadata, with no document
payload or credential. The browser keeps preview data in ephemeral component state;
closing or changing report scope clears it.

## Live acceptance evidence

Use a disposable installation and a deliberately fictional signed report. Enter the
real team credential through the normal Admin password field, activate the tested
configuration, and explicitly submit the preview. Record the public OperationOutcome,
result headers and receiving service rendering separately from deterministic tests.
Never use fixture credentials as real tokens, put a token in source/issues, or treat
an accepted validator result alone as proof the clinical content rendered correctly.

The [19 October 2026 fictional acceptance record](../validation/hospital-eps-submission-2026-10-19.md)
contains the separately recorded public validator headers and receiving-rendering
inspection for the initial narrative output.
