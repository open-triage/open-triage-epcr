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
versions and history. COS is explicitly unconfigured in this slice.

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
Version 1 establishes identifier mapping; clinical concept mapping is extended by
subsequent hospital integration slices rather than silently executing unsupported
mapping rules. Runtime identifier settings are rebuilt and validated from the
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
