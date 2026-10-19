# Hospital integration configuration

Hospital integrations is available in Administration to users with `settings:read`.
Saving, importing, testing, activating and deactivating require `settings:write`
and the existing live personal-session authority. Configuration belongs to the
selected agency's root group; it grants no patient or report access.

## EPS setup

Publish the root agency's form and catalog first. Select EPS, configure the
hackathon FHIR endpoint, identifier namespace and explicit equivalent namespace
aliases, and choose a compatible standard or custom text field. The initial
selection is `ePatient.01`. Enter the team credential and save a draft. The only
initial transport is `https://hackathon2026.vadimperetok.in/fhir`, using the
`X-Team-Token` header. The public hackathon service is for fictional patients.

Test read-only connection issues `GET /Organization/$me` with the protected
credential. It does not call `$validate`, send a patient document or prove document
conformance. Activate the exact successfully tested revision. Editing preserves
the active revision. Deactivation clears the active pointer and preserves all
versions and history. COS has its separate configuration and simulator below.

Credentials use the existing installation-protected, group-owned credential key
conventions. The panel never returns a saved credential. No EPS-specific deployment
secret or CLI action is required for normal configuration.

## Canonical mapping files

Each save writes an `opentriage-definition` package of kind `hospital-mapping` to
`OPENTRIAGE_DEFINITIONS_ROOT/hospital-mapping/local/<group-id>/`, using the existing
canonical package atomic-file writer. The default root is `defines`. A failed
file write prevents publication of the database draft pointer. A transaction
failure after writing may leave a valid discoverable file, but never activates it.
The directory must use the installation's ordinary persistent configuration storage.

Find saved mapping files lists compatible files for the current group and shared
bundled templates. Export downloads the same canonical content. Upload or import
a saved file creates a new local configuration draft and requires a new test.
Its mapping identity, mapping revision and SHA-256 remain intact. Local connection
revisions are distinct from portable mapping revisions. Editing a restored mapping
allocates a new mapping revision beyond every retained revision of that identity.

The schema-versioned mapping definition contains identity, revision, author and
time, the pinned EPS/FHIR profile dependency, and patient-field/namespace mapping.
The package contains the pinned catalog fingerprint and content hash. It contains
no credential, clinical content or local destination/staff assignment. Unsupported
schema/profile/dependency combinations and unknown properties fail closed.
Version 1 also supports optional `clinicalMappings` for selected EPS allergies and
conditions. Packages without that member remain valid identifier-only packages. Runtime identifier settings are rebuilt and validated from the
canonical package, never independently editable database projections.

## Identifier contract

`resolveHospitalIdentifier` takes the authorized draft or effective signed clinical
version and that version's pinned form/catalog. Missing, unavailable, incompatible
and ambiguous values are findings. It does not fall back to a different field,
coerce a number, remove leading zeroes, choose one repeated occurrence or match a
patient name. Custom field UUIDs resolve through pinned namespace/slug definitions.
Callers remain responsible for ordinary report scope, dataset and mutation checks.

## Verification

`hospital-mapping.test.mjs` exercises identifier resolution and portable schema
rejection. `hospital-postgres.integration.test.mjs` runs the panel with real
PostgreSQL/session/file persistence and a simulated read-only external connection,
including activation isolation, stale/unauthorized commands, file round trips,
failed storage, default and alternative fields, mobile layout and revocation.
The latter is part of `npm run test:integration -w @open-triage/api` and therefore
`npm run check:ci`. It uses a temporary configuration root and rolls back its data.
These deterministic tests do not claim live hackathon connectivity or COS acceptance.

## COS configuration and simulator

The COS section stores one immutable connection revision per agency group;
child agencies inherit that connection under existing settings authority. Staff
HSA assignments must belong to active accounts in that group. Hospital/care-unit
pairs are exact mappings; an unknown destination never falls back to the ambulance
care unit. The ambulance default applies only when there is no destination.

Choose the patient field (default `ePatient.01`), namespace and explicit aliases
separately from encounter, staff and organizational identifiers. Configure the
endpoint, API-key or bearer credential, template, local identities and clinical
source-to-template-link mappings in the panel. The pinned development dependency
is `BundlePrehospitalNote/v2` / `QuestionnaireResponsePreHospitalNote/v2` (2.0.0).
Source/answer types must be compatible. Receiver-specific template link IDs and
terminology remain subject to the sandbox gate.

Saving writes an authoritative `hospital-mapping` canonical JSON file through
the existing organization-scoped definitions storage. Portable files include
mapping identity/revision, catalog hash, profile dependency and clinical/patient
mappings; they exclude endpoint, credentials, staff and local care-unit assignments.
Export, saved-file discovery and import retain identity, revision and content hash.
An import creates a new local draft requiring a new test; it never changes the
active revision. Runtime projections are rebuilt from the file and pinned form.
EPS files are rejected by COS and vice versa.

**Simulator evidence is configuration/profile evidence only.** Tests validate
required local mappings, supported patient namespace, pinned field/type
compatibility and credential decryptability. They make no outbound request and
transmit no document. Every result records its exact configuration hash and
explicit simulator/no-transmission status. A simulator activation cannot verify
connectivity, OAuth grants, receiver templates, storage or final acknowledgement.
Live mode can be drafted, but its tests report the missing sandbox verification
and activation is refused server-side. Slice 024 must establish the real target
contract and verification path before live activation can become available.

Published profile inspection (19 October 2026):
[QuestionnaireResponsePreHospitalNote v2 JSON view](https://fhir.openservices.cambio.se/site/StructureDefinition-QuestionnaireResponsePreHospitalNoteV2.profile.json.html)
identifies canonical version 2.0.0, open item slicing, and an `otherInformation`
slice with one `valueString` and a SNOMED CT `linkId`. It does not enumerate the
receiving installation's template codes. This configuration slice supports that
flat text mapping and rejects nonnumeric link IDs, specialized medication IDs,
and unsupported flat answer types. Numeric shape is not terminology validation.
Medication requires a Coding answer and five mandatory nested answers; PDF uses
a separate URI slice and observations/triage use references. Their structured
mapping/composition belongs to slice 013; this simulator does not claim a complete
clinical document validates against all required slices.

The [Bundle prehospital note profile](https://fhir.openservices.cambio.se/site/StructureDefinition-BundlePrehospitalNote.html)
and [questionnaire profile](https://fhir.openservices.cambio.se/site/StructureDefinition-QuestionnaireResponsePreHospitalNoteV2.html)
are development inputs, not proof of target installation compatibility.

## Reading a patient's EPS

After EPS activation, the active draft's call header checks the configured
identifier field. Checking, available, missing identifier, no match, and lookup
failure have distinct localized states. The EPS button opens a bounded clinical
section table with inert narrative, source organization/authorship, summary date,
and retrieval time. Complete source details preserve every resource and field,
including unsupported content. Reference findings stay visible; embedded URLs,
images and markup never execute or trigger additional requests. Source content stays read-only; selective imports and protected offline caching
are described below.

The hackathon adapter reads the public `$samples` and `$exchange` listings and
reads the listed documents using strictly constructed same-service paths. It
indexes each Composition subject's actual Patient identifiers, with explicit
configured namespace aliases. It does not search generic FHIR Patient endpoints,
match listing display numbers/names, or send patient identifiers to the service.
The public reads need no token; the protected team token remains used for the
configured connection test. Requests have bounded document count/concurrency and
a shared time budget; a partial failure is never reported as no match.

Both endpoints authorize the live clinician session and owned draft in the
current agency. Stateless bindings detect report/patient/configuration changes
across API replicas. The API rechecks after remote lookup; the UI also discards
late responses, invalidates when local documentation changes, polls configuration,
and checks again before opening. Successful reads append `eps.read` patient
access evidence with canonical mapping/configuration revisions and hashes, without
patient identifiers or clinical payloads. Unopened summaries remain in current-view memory and follow that view's
report/user/agency lifetime. Opened copies use the protected storage described below.

`eps.test.mjs` covers both pinned example documents, lossless source fallbacks,
unsafe narratives, unsupported references, malformed documents and discovery
failures. The PostgreSQL hospital integration suite additionally covers both
patients, changed identifier selection, late results, authorization/revocation,
revision audit, multiple service instances, and English/Swedish desktop/mobile
keyboard and layout behavior using the actual component and service.

## Protected offline EPS

Opened EPS copies share the encounter's existing protected encrypted payload,
report key, recovery deadline and session lock. Merely discovering a summary
does not cache it. The viewer retains the original source and retrieval dates,
labels the cached copy, and offers an explicit online refresh. Refresh replaces
only the viewer copy; imported encounter provenance is not rewritten.

The cache is scoped to the clinician, agency, report and resolved patient
identifier using the canonical mapping and report's pinned form. Unrelated
clinical edits preserve access; patient changes invalidate it. When connected,
the viewer rechecks the server binding (including configuration revision) and
clears cached access after a denial or changed binding. While disconnected it
cannot discover a new server revocation or configuration change; the existing
local session and protected-record deadlines remain the access boundary. Logout
locks the same key, and reopening requires normal server-authorized recovery;
there is no offline login. Synthetic copies expire with their protected report.
Browsers without protected storage can view online without an offline guarantee.

Under storage pressure the optional EPS copy can be evicted, alongside verified
server media copies. Pending encounter edits and media remain protected. A failed
cache write removes only that attempted EPS copy and never replaces newer work;
the viewer then reports online-only availability.

## Selective EPS allergy and condition imports

In EPS administration, add an exact source resource type, code system and code,
then select a standard or custom destination from the pinned published form.
**Check mappings** reports unavailable fields, incompatible types, unsupported
cardinality and codes absent from the destination. A coded destination must permit
the identical source code and system, plus unambiguous active/confirmed source
statuses in their published status code systems. Missing, uncertain, refuted,
entered-in-error, inactive/resolved or contradictory statuses cannot become a bare
affirmative destination code. There is no inferred translation. Text
mapping retains readable source narrative, exact coding, status and clinical dates.
The original resource remains attached as protected provenance. Correlated custom
groups and ambiguous destination instances are unavailable in this first journey.

Save, export/import, test and activate use the same canonical package workflow as
identifier mappings. Every selected import retains its canonical identity, revision,
hash and configuration revision. Changing activation cannot rewrite that evidence.

The EPS dialog offers a per-entry preview with its EPR destination. Unmapped and
incompatible source entries stay visible. Preview compares the report's pinned
form and exact current draft revision. Existing values require an explicit keep or
replace decision. Replacement is limited to that destination group, and both the
previous value and source remain attributable through existing clinical history.
Duplicate source entries and replayed commands cannot create duplicate imports.
Refresh the summary and preview again after a stale-revision/configuration error.

Imports require a current online documenting-clinician session. They cannot edit
signed reports. Imported source history remains inspectable from the encounter,
including a warning when its pinned patient identifier no longer matches—even if
the new identifier is missing or has no matching EPS. Keep/replace/import decisions
write `eps.import` audit evidence with actor, report and mapping metadata; payloads
and patient identifiers are excluded from routine audit metadata.

`clinical.eps_import` and short-lived `clinical.eps_import_plan` are report-owned
protected records and cascade with report deletion and synthetic expiry. A plan
expires after 15 minutes; new plans remove expired plans and replace that report's
previous preview. Ordinary signed snapshots include occurrence source provenance.
The API never fetches arbitrary source references or accepts a client-supplied
clinical value as authoritative EPS data.

### Medication history imports

For `MedicationStatement`, select an exact source product code and a custom text
field, then explicitly designate its clinical meaning as medication history.
This semantic role is part of the transferable canonical mapping. The text retains
source status, effective dates, assertion date, dosage, route and units without
translating their codes. Medication references resolve only inside the same EPS
bundle; unresolved products and unknown extensions remain readable but cannot be
imported. An absent list creates no negative-history statement.

NEMSIS `eHistory.12`–`.15` describe current medication identity, dose, unit and route
as grouped fields. This initial projection does not distribute an EPS regimen into
those scalar fields or infer code conversions. It never writes `eMedications`
encounter administrations. Use a custom text history field to preserve the whole
regimen; coded-only medication imports are rejected.

A custom history field with multiple occurrences offers **Add alongside existing
history** in the conflict preview. Keep and replace remain explicit choices.
Appending preserves the earlier occurrence and its provenance; replaying the same
source does not append again. Signed provenance includes the original statement
and its resolved Medication resource, with the applied mapping identity and revision.
