# Explicit signed EPS submission

Only an identifying, authorized Review user can prepare or submit a signed report.
Choose **Submit EPS**, build the signed-version preview, review the findings, then
confirm the report is fictional before using **Submit to public hackathon service**.
The fixed public endpoint is `POST /fhir/Bundle/$validate`; it records attempts and
can publish passing documents. Admin's GET connectivity check remains read-only.

## Configuration and canonical files

In Admin → Hospital integrations → EPS, configure the exact patient identifier and
**Outgoing EPS mappings**, save, verify connectivity, and activate the revision.
Each outgoing mapping explicitly selects a signed field and an EPS section.
The canonical `hospital-mapping` JSON contains `outputMappings` with stable identity,
revision, catalog dependency hash, and `signed-narrative` representation. Imported
files preserve their existing bytes/hash identity; malformed or incompatible files
are rejected. Existing identifier/import-only packages remain readable.

The initial output uses faithful signed narrative, including documented qualifiers,
confirmed import source version/digest/entry/mapping/decision, and effective signed
amendments. It does not manufacture structured longitudinal resources or translate
local codes into an asserted terminology. Current medication administrations,
procedures, and vital signs can only be placed in Patient story. Required sections
without information use `list-empty-reason:unavailable`, never `nilknown`. Missing
required demographics use the EPS/IPS data-absent-reason pattern. Missing or
ambiguous configured patient identity blocks submission.

## Private validator prerequisite

Install Java21 and run:

```sh
node scripts/setup-eps-validator.mjs /private/writable/eps-validator
```

Configure private server values with absolute paths:

```text
EPS_VALIDATOR_JAVA=/absolute/path/to/java
EPS_VALIDATOR_JAR=/private/writable/eps-validator/validator_cli-7.0.2.jar
EPS_VALIDATOR_CACHE_HOME=/private/writable/eps-validator/cache
```

The application verifies the official HL7 validator7.0.2 JAR SHA256
`e3e50f06b806437821b7aef8189a1b790415cb96c5036e0812ed62981452b377`.
The validator loads `hl7.fhir.eu.eps#1.0.0-ballot`, FHIR R4 4.0.1, and its pinned
published dependency graph. Its initial package download requires outbound network
access; the private cache must be writable. Clinical input/output uses temporary
private files, is bounded, and is removed after validation. Do not share this cache
or directory through a web server. Validator stdout and arbitrary provider bodies
are never returned in API/audit evidence.

Preview runs the actual HL7 structural, profile, reference, and invariant checks,
plus application semantic checks. Terminology-server access is disabled (`-tx n/a`)
and that limitation is shown separately; this is not a claim of complete clinical
or terminology acceptance. The public service performs its own checks on explicit
submission. An absent/mismatched runtime, timeout, malformed validator output, or
profile errors blocks Submit. This private validator never calls the hackathon
publishing endpoint.

Run the actual package regression locally with those environment values:

```sh
npm run build -w @open-triage/api
node apps/api/tests/eps-output.test.mjs
```

Ordinary deterministic tests stub external boundaries and identify that evidence
separately. The actual validator regression verifies a generated EPS and rejects a
broken required patient reference.

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
