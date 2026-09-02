# Database architecture and implementation design

Status: proposed architecture with an initial persistence foundation implemented
on `feature/database-foundation`. This document records the design decisions from
the database specification interview, describes what this branch already adds,
and identifies the work that remains before production use.

## Decision summary

- PostgreSQL 15 or newer is the authoritative portable database; Supabase is optional
  infrastructure rather than a domain dependency.
- The transactional model is normalized around incidents, reports, group
  instances, typed element occurrences, immutable form/catalog versions, signing,
  amendments, and audit history. The analytical shape is not the write model.
- Analysts receive two base projections: one row per signed ePCR for all
  non-repeatable PatientCareReport elements, and one row per repeatable element
  occurrence. Views control identifying-data access.
- The primary projections show latest effective amended values. Original signed
  state and the amendment chain remain available transactionally for audit and
  point-in-time reconstruction.
- Drafts do not enter the clinical analytical projections. A separately authorized
  operational work queue covers active and cleared-but-unsigned reports.
- Production sizing assumes up to one million reports per year with ten years
  online. Retention is installation-configurable, subject to legal holds.
- Analytical projection may lag by up to five minutes and can run on a reporting
  replica. A transactional outbox makes projection retryable and rebuildable.
- UUIDv4 is used for offline-created record, occurrence, group, and idempotency
  identifiers because NEMSIS 3.5.1 permits UUID versions 1–5. Catalog element
  identities use deterministic UUIDv5 and remain stable when the NEMSIS element
  identifier is unchanged.
- Data quality logic flags values but never deletes, clips, winsorizes, or silently
  replaces them. Approved unit normalization is additive and versioned.

## Changes implemented on this branch

The original two-table JSONB scaffold is replaced with a clean baseline migration
because it has not held production or real patient data. The migration currently
adds:

- application-owned users and external identity bindings instead of foreign keys
  to Supabase `auth.users`;
- a relational, checksummed NEMSIS catalog and terminology model;
- immutable form versions with searchable relational sections, fields, rules,
  locales, custom definitions, and publication findings;
- incident, patient, report, group-instance, typed occurrence, change-set,
  validation, signing, amendment, command-idempotency, and audit structures;
- database checks for UUIDv4 client identities, typed-value exclusivity,
  standard-element analytical classification, signed immutability, amendment
  sequencing, and report-specific audit-chain continuity;
- a transactional outbox and an idempotent batch projector;
- private yearly/monthly partitioned analytical tables and pseudonymous versus
  identified access views;
- a generated 3.5.1 mapping/data dictionary covering all 441 PatientCareReport
  elements—198 wide and 243 repeatable;
- build-time repeating-group time analysis with explicit element, inherited, or
  non-temporal resolutions;
- catalog loading, projection, generated-artifact checks, static database tests,
  TypeORM mappings for the renamed core entities, and operator documentation;
- an explicit, replay-safe synthetic bootstrap that creates a complete installation
  and a baseline draft report pinned to its immutable agency, form, and catalog versions;
- public API transactions for form publication, one-patient draft creation, retrieval,
  and incremental autosave with optimistic revisions and replay-safe command receipts;
- separately authorized unsigned-work and immutable report-history views, without
  granting their readers access to transactional or analytical base tables.

The generated audit found 34 repeating groups: 11 have exactly one local NEMSIS
date-time element and 23 have no local candidate. Every exception is visible in
the mapping artifact and explicitly classified as inherited or non-temporal.
Custom clinical repeating groups are required by the database to declare exactly
one custom date-time element before use.

## Not implemented yet

This branch is a foundation, not a production-ready clinical database. Follow-up
vertical slices still need to add:

- API commands and transactions for signing and amendments;
- authoritative semantic validation against the pinned form, catalog, and value
  sets, including validation of amendment payloads;
- integration tests against a real supported PostgreSQL version, including
  triggers, partitions, grants, loader replay, projector replay, and query plans;
- human approval of the proposed identifying-element classification, role
  boundary, and HMAC custody/rotation policy in
  [Analytical privacy boundary](analytical-privacy-boundary.md);
- approved normalization and quality-flag rule sets;
- retention archival, legal-hold, partition maintenance, and deletion jobs; and
- database backup/restore, read-replica, query-audit, monitoring, and load testing.

The recommended implementation order is: validate the migration in PostgreSQL;
seed the catalog and one complete form; implement one draft command end to end;
implement atomic signing and projection; implement amendments and reconciliation;
then add access controls, retention operations, and ten-year-scale performance
tests.

## Projection recovery operations

`npm run project -w @open-triage/database` consumes the transactional outbox. The
same projector also rebuilds projections directly from immutable signed state and
ordered amendments:

```sh
npm run project -w @open-triage/database -- --replay REPORT_UUID
npm run project -w @open-triage/database -- --reconcile --report REPORT_UUID
npm run project -w @open-triage/database -- --reconcile --from 2026-01-01 --to 2026-01-31
npm run project -w @open-triage/database -- --backfill JOB_KEY --from 2026-01-01 --to 2026-01-31
```

Date bounds are inclusive. A backfill job's selector is immutable, its cursor is
advanced in the same transaction as each report rebuild, and rerunning the same
job key resumes it safely. `ANALYTICS_PROJECTOR_BATCH_SIZE` bounds work per run.
Every rebuild locks one report, removes both old analytical shapes across all
partitions, and inserts both effective shapes in one transaction. The latest
signed amendment carrying a reporting-date correction determines the destination
year and month.

OpenTriage uses PostgreSQL 15 or newer as the portable system of record. PostgreSQL
15 is the minimum because the schema uses `UNIQUE NULLS NOT DISTINCT` to enforce
clinical occurrence uniqueness without sentinel values. The API is the only
writer to clinical and configuration data. Supabase can provide infrastructure,
but no clinical table depends on `auth.users`, PostgREST, or another hosted-only
feature.

## Data boundaries

The initial migration creates purpose-specific schemas:

- `app_identity`: application users, external identity-provider bindings,
  capabilities, organizations, versioned `dAgency` demographics, and configurable
  retention.
- `catalog`: immutable, versioned NEMSIS definitions, value sets, stable element
  identities, analytical mappings, and repeating-group time mappings.
- `forms`: canonical JSON form versions and relational projections used for
  search and validation. Published versions and their child rows are immutable.
- `clinical`: incidents, one-patient ePCRs, group instances, typed element
  occurrences, draft change sets, signed snapshots, and amendments.
- `clinical_audit`: append-only, hash-chain-ready audit events.
- `integration`: the transactional outbox used to project signed data.
- `analytics_private`: the two physical analytical projection tables. Application
  and analyst roles do not receive direct access.
- `analytics`: stable read-only analyst views and the element dictionary.

Client-generated clinical identifiers and idempotency keys are UUIDv4. UUIDv4 is
valid for both the NEMSIS 3.5.1 `UUID` type and its 2–255 character
`CorrelationID` type. Deterministic UUIDv5 values identify catalog elements
across installations; those identifiers are generated artifacts rather than
patient-record UUIDs.

## Transactional clinical model

An incident can have multiple reports; a report has exactly one patient. Reports
pin a published form version and a NEMSIS catalog release. Every group instance
and element occurrence has a stable UUID assigned before offline synchronization.
An element occurrence uses sparse typed columns with a `value_kind` discriminator,
never a sentinel string. Numeric entries preserve both a queryable number and the
exact lexical entry. Coded entries preserve code, system, display, and terminology
version. Null values, pertinent negatives, and explicit absence are distinct.

The database enforces universal invariants: UUID format, relationships, one typed
value representation, stable standard-element classification, form immutability,
signed-content immutability, sequential amendments, and append-only history.
Catalog-dependent cardinality, conditional requiredness, and value-set rules are
validated by the API and rerun atomically at signing.

A draft keeps its current rows and append-only change sets rather than a complete
copy per autosave. Signing freezes the report revision and records the canonical
payload hash; it does not duplicate the full report into a second JSON blob.
Amendments are immutable overlays and never unlock signed rows.

## Analytical contract

The two physical projections contain effective signed data only:

1. `analytics_private.epcr` has one row per ePCR and typed columns for all 198
   non-repeatable NEMSIS PatientCareReport elements.
2. `analytics_private.epcr_repeatable_element` has one row per occurrence for all
   243 elements that repeat directly or through a repeating group.

Analysts query the corresponding `analytics` views. `analytics.epcr` and
`analytics.epcr_repeatable_element` exclude explicitly identifying elements and
free text. The privileged `*_identified` views include those values. The physical
tables remain inaccessible to both analyst roles so a broad `select *` cannot
bypass the restriction. Exact age, clinical timestamps, and other pseudonymous
clinical values are not coarsened.

`patient_key` is a versioned HMAC-derived value using an installation secret; the
secret and internal patient UUID used as its source never enter analytics. It is
stable within an installation and key version and unrelated across installations.
See [Analytical privacy boundary](analytical-privacy-boundary.md) for the exact
proposed input framing, custody, rotation procedure, and pending approval.

The three `dAgency` definitions in the EMS dataset are stored once per immutable
agency-demographic version and exposed through `analytics.agency`. Each report
pins that version rather than copying agency configuration into every ePCR row.
The other nine catalog definitions outside `PatientCareReport` configure custom
elements and likewise do not become per-report columns.

NEMSIS columns use the lowercase element identifier with its dot replaced by an
underscore: `eSituation.11` becomes `esituation_11`. Coded fields use the base
column for the code and companion `_display`, `_system`, and
`_terminology_version` columns. The `analytics.element_dictionary` view supplies
official names, definitions, types, paths, and sensitivity classifications.

Explicit NV/PN/absence states are stored in sparse `element_statuses`; it is SQL
`NULL` when no such state exists. `additional_elements` is reserved for future or
custom non-repeatable elements, and identifying additions are isolated in
`additional_identifying_elements`. Neither stores an empty JSON object.

Repeatable rows retain group and ancestor instance IDs, correlation IDs, element
and group ordinals, original values, clinical time, documented time, server
receipt time, offsets, precision, and projection lineage. A clinical-time value
comes from the explicitly mapped NEMSIS time element. The generated mapping flags
all groups with zero or multiple local candidates and requires an explicit
`element`, `inherited`, or `non-temporal` resolution before runtime.

The wide table uses yearly service-date partitions; repeatable elements use
monthly partitions. A signed report uses the explicit service date, otherwise the
earliest valid clinical/operational timestamp, earliest server timestamp, and
finally signing time. The selected source is always exposed. Amendments that
correct the date move the projections to the corrected partitions.

## Projection and operations

Signing and amendment transactions enqueue an outbox event. The idempotent
projector rebuilds both rows for a report, so retries and reconciliation are safe:

```bash
npm run project -w @open-triage/database
```

The production Kubernetes scheduler runs one bounded batch every two minutes and
checks projection health every minute. `ANALYTICS_PROJECTOR_BATCH_SIZE` controls
one invocation. The projector creates required partitions before insert.
Each row carries its signed snapshot/hash, effective amendment sequence,
form/catalog versions, projector version, and projection timestamp.

See [Analytics projection operations](runbooks/analytics-projection.md) for the
scheduler, safe health contract, alerts, replay, reconciliation, and backfill.

Load the checksummed catalog after applying the migration:

```bash
npm run load:catalog -w @open-triage/database
```

Generate and verify the catalog-to-SQL contract with:

```bash
npm run generate:database
npm run check:database
```

The generator owns only the marked blocks in the initial migration and the JSON
mapping artifact. It currently asserts the expected split of 441 ePCR elements:
198 wide and 243 repeatable. A catalog change that alters that contract fails the
build until reviewed.

Production installations may point analysts at a PostgreSQL read replica or
reporting instance. Use named or short-lived database credentials and log query
metadata. Do not log returned clinical values or SQL bind values. The configured
retention defaults to ten years; legal holds and verifiable archival/deletion are
operator workflows and must never be exposed as ordinary clinical deletes.

## Example queries

```sql
select
  report_id,
  epatient_15 as patient_age,
  esituation_11 as primary_impression_code,
  esituation_11_display as primary_impression,
  etimes_07 as arrived_at_patient
from analytics.epcr
where reporting_date >= current_date - 30;
```

```sql
select
  report_id,
  group_instance_id,
  element_id,
  value_numeric,
  code,
  clinical_time,
  documented_time
from analytics.epcr_repeatable_element
where element_id in ('eVitals.06', 'eVitals.10')
  and reporting_date >= current_date - 30;
```
