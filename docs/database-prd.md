# Problem Statement

OpenTriage needs a durable clinical database that can accept form-driven electronic
patient care reports (ePCRs), preserve their NEMSIS meaning, support offline and
auditable clinical workflows, and remain straightforward to analyze. The original
prototype stored reports and form definitions primarily as JSONB. That shape is
useful for a browser prototype but is not sufficient as the authoritative record
for signed clinical data, amendments, access control, retention, or ten years of
reporting at up to one million ePCRs per year.

The current analytical system also requires analysts to interpret a generic long
table containing record, timestamp, correlation, variable, and value columns.
Common questions therefore require repeated pivots, joins, and datatype recovery.
Analysts need most useful non-repeatable ePCR data in one row per report, while
retaining a faithful long representation for elements that legitimately repeat.

# Solution

Build a PostgreSQL 15+ persistence platform with separate transactional and
analytical models. The API will be the only writer to normalized clinical tables.
Those tables will preserve typed NEMSIS element occurrences, repeating-group
structure, drafts, change history, immutable signatures, amendments, form and
catalog versions, and audit lineage.

An outbox-driven projector will produce two analyst-facing datasets from effective
signed records: a wide table with one row per ePCR for non-repeatable elements and
a long table with one row per repeatable element occurrence. The projections will
include every standard PatientCareReport element, use predictable SQL column
names, preserve explicit missing-value states, and expose documented and clinical
times for repeatable elements. Default views will exclude explicitly identifying
fields and narrative, while separately authorized views will expose them. Other
pseudonymous clinical data, including exact age, will not be coarsened.

The database foundation already committed on the database feature branch provides
the baseline schemas, catalog mapping, analytical tables and views, catalog loader,
projection worker, TypeORM mappings, and static artifact checks. Completing this
PRD requires implementing and validating the application workflows, database
operations, security provisioning, and production-scale tests around that
foundation.

# User Stories

1. As a clinician, I want my draft ePCR to save incrementally, so that routine autosaves do not create complete duplicate records.
2. As a clinician working offline, I want records and repeating entries to retain stable client-generated identifiers, so that synchronization does not duplicate my work.
3. As a clinician, I want stale-write conflicts detected explicitly, so that one device cannot silently overwrite newer documentation from another device.
4. As a clinician, I want incomplete or unusual values preserved in a draft, so that data entry remains non-blocking while care is underway.
5. As a clinician, I want authoritative validation to run when I sign an ePCR, so that signed records satisfy the pinned form, NEMSIS catalog, and applicable value sets.
6. As a clinician, I want signing to atomically freeze the validated revision, so that the signed clinical record cannot change afterward.
7. As a clinician, I want corrections to signed reports recorded as signed amendments, so that the original record and the reason for each correction remain available.
8. As a clinician, I want a report's relevant agency demographics pinned to a version, so that historical records retain the configuration that applied when they were documented.
9. As a form administrator, I want form definitions stored as immutable versions, so that a published form cannot change the interpretation of an existing report.
10. As a form administrator, I want canonical form configuration and searchable relational metadata to stay synchronized, so that forms can be rendered faithfully and inspected efficiently.
11. As a form administrator, I want publication checks to reject invalid custom clinical repeating groups, so that every such group declares exactly one clinical date-time element.
12. As a standards administrator, I want a checksummed, versioned NEMSIS catalog, so that every report and analytical field has traceable source definitions.
13. As a standards administrator, I want the same NEMSIS element identifier to retain one application identity across catalog releases, so that compatible upgrades do not fragment longitudinal analysis.
14. As a standards administrator, I want incompatible datatype changes for an existing NEMSIS identifier to block catalog adoption, so that apparent backward compatibility cannot corrupt values.
15. As a standards administrator, I want every PatientCareReport element classified before deployment as wide or repeatable, so that no standard field silently disappears from analytics.
16. As a standards administrator, I want repeating groups with zero or multiple local time candidates flagged before runtime, so that clinical-time behavior is reviewed explicitly.
17. As an analyst, I want one row per effective signed ePCR containing all non-repeatable PatientCareReport elements, so that common analysis uses simple SQL.
18. As an analyst, I want one row per repeatable element occurrence, so that repeated vitals, medications, procedures, and other groups remain lossless and queryable.
19. As an analyst, I want stable, lowercase NEMSIS-derived column names such as `esituation_11`, so that queries remain recognizable and easy to write.
20. As an analyst, I want coded values accompanied by their display, system, and terminology version, so that I can analyze codes without discarding their meaning.
21. As an analyst, I want repeatable rows to include group and parent instance identifiers, ordinals, paths, and correlation identifiers, so that related elements can be reconstructed correctly.
22. As an analyst, I want repeatable rows to contain both documented time and the group's mapped clinical time, so that documentation timing and clinical event timing can be analyzed independently.
23. As an analyst, I want server receipt time, UTC offsets, and recorded precision retained, so that temporal uncertainty and ingestion delay remain visible.
24. As an analyst, I want ordinary missing data represented by SQL `NULL`, so that sparse wide rows remain efficient and use normal SQL semantics.
25. As an analyst, I want pertinent negatives, NEMSIS not-values, and explicit absence preserved separately from ordinary nulls, so that distinct clinical meanings are not collapsed.
26. As an analyst, I want analytical values to retain their native types and original lexical representation where needed, so that calculations do not depend on parsing generic strings.
27. As an analyst, I want current projections to reflect the latest signed amendment, so that routine reports use the effective clinical record.
28. As an analyst, I want signed snapshot, amendment, catalog, form, and projector lineage on projected rows, so that every result can be traced and reproduced.
29. As an analyst, I want an element dictionary containing names, definitions, datatypes, paths, and sensitivity classifications, so that the analytical schema is self-describing.
30. As an analyst, I want a stable installation-scoped pseudonymous patient key, so that I can perform longitudinal analysis without receiving direct identifiers.
31. As an analyst, I want exact pseudonymous clinical values such as age rather than generalized replacements, so that privacy controls do not unnecessarily reduce analytical utility.
32. As an authorized identified-data analyst, I want separately controlled views containing identifying elements, so that approved operational or compliance work remains possible.
33. As a privacy officer, I want default analytical access to exclude direct identifiers and narrative, so that broad analytical permission does not expose explicitly identifying content.
34. As a privacy officer, I want identifying and non-identifying additions separated, so that custom or future elements cannot bypass the intended access boundary.
35. As a compliance officer, I want append-only report audit history and immutable signed content, so that clinical changes and access-relevant events can be investigated.
36. As a compliance officer, I want data-quality rules to flag suspect or extreme values without deleting, clipping, winsorizing, or silently replacing them, so that the source record remains faithful.
37. As a compliance officer, I want normalization to add approved derived values while retaining original values and rule versions, so that transformations remain reversible and auditable.
38. As an installation administrator, I want the online retention period configurable with a ten-year default, so that local obligations can be met without changing the schema.
39. As an installation administrator, I want legal holds to override ordinary archival and deletion, so that protected records cannot be removed by scheduled maintenance.
40. As an operator, I want signing and amendment transactions to enqueue projection work atomically, so that analytical updates cannot be lost between systems.
41. As an operator, I want projection retries, replay, reconciliation, and backfill to be idempotent, so that failures can be repaired safely.
42. As an operator, I want analytical data to be no more than five minutes behind signed clinical data during normal operation, so that reporting remains timely.
43. As an operator, I want analytical tables partitioned by relevant reporting periods, so that ten years of data can be maintained and queried predictably.
44. As an operator, I want analysts to be deployable against a reporting replica, so that expensive queries do not impair clinical transactions.
45. As an operator, I want verified backup, restore, archive, partition maintenance, and monitoring procedures, so that the database can be operated safely in production.
46. As an API developer, I want PostgreSQL constraints to enforce universal structural invariants while the API enforces catalog-dependent semantics, so that responsibilities are clear and validation remains maintainable.
47. As an API developer, I want idempotent command handling for externally submitted mutations, so that retries do not create duplicate clinical actions.
48. As a deployment owner, I want PostgreSQL to remain the portable system of record without mandatory Supabase-specific clinical dependencies, so that hosting choices remain open.

# Implementation Decisions

## Modules to build or modify

1. **NEMSIS catalog and form-definition module.** Load immutable, checksummed
   catalog releases and terminology, maintain deterministic identities by NEMSIS
   identifier, store canonical immutable form versions with relational
   projections, and run publication-time validation. All 441 NEMSIS 3.5.1
   PatientCareReport elements are in scope for analytical mapping. The three
   `dAgency` definitions are versioned agency reference data rather than repeated
   report columns; the remaining non-PCR catalog definitions support custom
   configuration.
2. **Transactional ePCR lifecycle module.** Represent incidents, one-patient
   reports, group instances, sparse typed element occurrences, draft change sets,
   tombstones, validation findings, signed snapshot hashes, immutable amendments,
   and idempotent commands. UUIDv4 is used for offline-created clinical and
   idempotency identities. Signing and amendments are atomic API transactions.
3. **Analytical projection module.** Consume a transactional outbox and rebuild
   the effective signed representation idempotently. Maintain one yearly
   partitioned wide row per report and monthly partitioned long rows per
   repeatable occurrence. Drafts are excluded. Corrected reporting dates move
   projections to the appropriate partitions.
4. **Privacy, identity, authorization, and audit module.** Keep application users
   and external identity bindings independent of a particular hosting provider;
   use versioned, installation-scoped HMAC patient keys; expose separate
   pseudonymous and identified views; provision least-privilege roles; and retain
   append-only report audit history. Direct access to private projection tables is
   not granted to analyst roles.
5. **Retention and database-operations module.** Configure retention per
   installation with ten years as the default, honor legal holds, manage
   partitions and archives, reconcile projections, support read replicas, and
   provide backup, restore, monitoring, query-audit, and deletion evidence.
6. **API persistence integration module.** Replace prototype persistence paths
   with transactions against the normalized schema, retain TypeORM only for
   straightforward mappings, and keep handwritten migrations authoritative.
   Provide commands for draft creation and mutation, synchronization conflicts,
   form publication, signing, and amendment.

## Schema and data decisions

- PostgreSQL 15 or newer is required. Supabase may host it, but no clinical
  relationship depends on Supabase authentication, PostgREST, or hosted-only
  behavior.
- The API is the sole writer to clinical and configuration data. Analytics views
  are read-only contracts.
- Typed sparse columns with an exclusive value-kind discriminator replace a
  generic string value. Coded, numeric, temporal, binary, null, pertinent-negative,
  and absent states remain distinguishable.
- NEMSIS medication dose and unit remain separate NEMSIS element occurrences;
  group-instance identity relates them without inventing a compound value.
- Catalog identity UUIDv5 values are stable across installations and releases when
  the NEMSIS identifier is unchanged. Clinical UUIDv4 values remain valid NEMSIS
  UUID/CorrelationID values.
- Missing projected values use SQL `NULL`. Sparse status or extension JSON is
  itself `NULL` when empty; no empty object is written merely to indicate absence.
- The reporting date uses the explicit service date when available. If it must be
  inferred, it uses the earliest valid timestamp associated with the record and
  exposes the selected source.
- Repeatable clinical time is resolved by a committed build-time mapping to one
  element, an inherited group time, or an explicit non-temporal classification.
- The default analytical views exclude fields explicitly classified as identifying
  and exclude narrative. Exact age and other pseudonymous clinical values remain
  unchanged.
- Quality checks never mutate source values. Any normalization is additive,
  approved, versioned, and traceable to its original occurrence.
- The effective projection applies the latest signed amendment. Original signed
  state and the complete amendment chain remain available for audit and
  point-in-time reconstruction.
- Catalog and analytical generation fail when element coverage, SQL-name
  uniqueness, datatype compatibility, or repeating-group time classification is
  unresolved.

## Interfaces and interactions

- Draft commands accept stable client identities, an idempotency identity, and an
  expected revision; successful changes update current draft rows and append a
  change set.
- Signing reruns semantic validation against the pinned form, catalog, and value
  sets, records the canonical payload hash and signature metadata, freezes the
  report, and emits an outbox event in one transaction.
- Amendments record a reason and ordered add, replace, or remove overlays, are
  independently signed, and emit a projection event without unlocking the
  original report.
- The projector claims outbox work in bounded batches, derives effective values,
  creates required partitions, replaces both projections for a report, and marks
  work complete in one retry-safe transaction.
- Analyst contracts consist of a wide ePCR view, a repeatable-element view,
  privileged identified equivalents, agency reference data, and an element
  dictionary. NEMSIS column names are lowercase with dots converted to
  underscores, for example `eSituation.11` to `esituation_11`.
- Projected rows expose source report and occurrence identities, effective
  amendment sequence, form and catalog versions, signed snapshot/hash, projector
  version, and projection time.

## Existing foundation

The feature branch already contains a clean replacement for the undeployed
prototype migration, the purpose-specific schemas and core constraints, generated
NEMSIS analytical mapping, base analytical tables and access views, catalog loader,
outbox projector, renamed core TypeORM mappings, and static database artifact
tests. This foundation is not considered production complete until the workflows,
security provisioning, operations, and live-database verification in this PRD are
implemented.

# Testing Decisions

Good tests must verify externally observable behavior and durable data contracts,
not private function structure. All six modules are selected for testing.

1. **Catalog and form tests** will verify checksum replay, release immutability,
   deterministic identity reuse, rejection of incompatible datatype changes,
   form-version immutability, complete analytical classification, SQL-name
   uniqueness, and explicit repeating-group time resolution.
2. **Transactional lifecycle tests** will run against PostgreSQL 15+ and cover
   UUID and typed-value constraints, draft revisions, idempotent retry, stale-write
   conflict, tombstones, atomic signing failure/success, signed immutability,
   amendment ordering, and reconstruction of original and effective state.
3. **Projection tests** will verify outbox atomicity, batch retry, replay,
   reconciliation, amendment overlays, reporting-date fallback and repartitioning,
   all supported datatypes, missing-value semantics, repeating-group relationships,
   and clinical/documented/server timestamps.
4. **Privacy and audit tests** will connect using actual database roles and prove
   that pseudonymous users cannot read private or identified values, identified
   users receive only the intended views, pseudonymous keys are stable and
   versioned, and audit/signed rows cannot be rewritten or removed.
5. **Retention and operations tests** will cover configurable policy, legal-hold
   exclusion, partition creation and maintenance, archive/delete evidence,
   backup/restore exercises, projector backfill, and replica-compatible read
   behavior.
6. **API integration tests** will exercise complete draft, synchronization,
   validation, signing, and amendment journeys through public API behavior and
   confirm database transactions roll back fully on failure.
7. **Performance tests** will use representative distributions at the projected
   scale of one million reports per year and ten years online. They will record
   query plans and latency for common wide and repeatable queries, signing writes,
   projection batches, partition pruning, and amendment replay. Acceptance
   thresholds must be established before production rollout rather than inferred
   from synthetic unit tests.
8. **Recovery tests** will demonstrate that the analytical projections can be
   rebuilt from transactional signed state and amendments and that database
   backups can be restored to a usable, internally consistent system.

Existing prior art includes the repository's generated-catalog audit and guardrail
checks, Node artifact tests that verify all 441 PatientCareReport mappings and
privacy-view generation, API unit tests, and the project-wide typecheck, lint,
test, and build pipeline. Static SQL inspection remains useful as a fast check but
does not replace tests executed by real PostgreSQL with production-equivalent
roles and extensions.

# Out of Scope

- Redesigning the clinical form user interface or changing the complaint-neutral
  encounter interaction model.
- Treating the analytical wide/long schema as the transactional write model.
- Adding non-PatientCareReport catalog definitions as columns on every report;
  agency and custom-configuration definitions remain versioned reference data.
- Deleting, clipping, winsorizing, or silently correcting extreme clinical values.
- Coarsening otherwise pseudonymous clinical data such as exact age.
- Allowing ordinary analyst roles to query private analytical base tables.
- Making Supabase, a particular identity provider, a warehouse product, or a
  hosted terminology service mandatory.
- Building predictive models, dashboards, or a general-purpose data lake.
- Defining deployment-specific legal retention periods, identifying-element
  policy, performance thresholds, or key-management procedures on behalf of an
  operator; the product must make these configurable and auditable.
- Guaranteeing production readiness solely from the existing foundation commit.

# Further Notes

- The committed NEMSIS 3.5.1 source artifact currently yields 441
  PatientCareReport elements: 198 non-repeatable elements in the wide projection
  and 243 repeatable elements in the long projection.
- The current generated audit identifies 34 repeating groups. Eleven have exactly
  one local NEMSIS date-time candidate; the other 23 require and currently carry
  explicit inherited or non-temporal decisions. A future catalog change must
  rerun this audit before deployment.
- Analytical freshness is a normal-operation objective of five minutes, not a
  distributed-transaction guarantee. The transactional signed record remains
  authoritative whenever projections lag.
- Ten years is the default online retention assumption, not a hard-coded deletion
  mandate. Legal, state, organizational, and litigation requirements can extend
  retention.
- Identification classification and HMAC key rotation require deployment review.
  Neither secrets nor source patient identifiers may enter analytical tables.
- A real PostgreSQL integration environment, seed catalog and form, synthetic
  fixtures, role provisioning, and measurable performance criteria are dependencies
  for production acceptance.
