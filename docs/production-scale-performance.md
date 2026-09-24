# Production-scale performance policy and evidence

Status: approved under owner delegation; production-schema rebaseline on 2026-09-10
Version: `production-scale-performance-1.2.0`

The requesting product and operations owner instructed the implementation agent to complete the
feature without further input and authorized defensible operating thresholds. The exact approved
thresholds and capacity model are the machine-readable
`packages/database/config/production-scale-performance.json`; results always embed its SHA-256 hash.

## Capacity and thresholds

The production profile is ten years online at one million reports per year: 10,000,000 wide rows,
60,000,000 representative repeatable rows, 5% amendments, ten annual wide partitions, and 120
monthly repeatable partitions. Common wide queries must be at most 250 ms p95, repeatable queries at
most 500 ms p95, and partition-pruned queries at most 250 ms p95. Signing must sustain at least 100
reports/second. Production projector batches are 500 reports, sustain at least 35 reports/second,
and complete within 13 seconds. Reconciliation sustains at least 50 reports/second and amendment
replay at least 17 reports/second. Common query plans may not spill to temporary storage.

Operations retain the already approved five-minute RPO and four-hour RTO. Production-like steady
CPU must remain at or below 70%, peak CPU at or below 80%, connection use at or below 70%, and
storage headroom at or above 30%.

## Reproducible exercise

On 2026-09-24, the owner requested more generous shared-runner CI gates. The `ci`
profile now allows twice the production latency limits and half its minimum
throughput: 500/1,000/500 ms for wide/repeatable/partition queries, 50 signing
reports/second, 17.5 projector reports/second with a 26-second batch limit, 25
reconciliation reports/second, and 8.5 amendment reports/second. Dataset and batch
sizes, correctness checks, no-temp-spill requirements, and all production targets
remain unchanged. The explicit `ciThresholds` are versioned with the policy;
measured results record both the applied threshold and its production counterpart.
The production profile never uses the CI overrides. This is a CI tolerance change,
not new calibration evidence or a production capacity claim.

`npm run scale:test:ci -w @open-triage/database` creates a uniquely named scratch database, applies
the production migration and synthetic bootstrap path, loads a deterministic bounded distribution
into the production analytics tables, runs the production projector for signing and amendment
batches, records `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` plans, evaluates the approved thresholds,
and writes `packages/database/artifacts/scale-test-ci.json`. CI uploads that file even on failure.

`npm run scale:test:production -w @open-triage/database` runs the same framework with exactly ten
million reports. It must run against an isolated PostgreSQL 15 production-like environment with
the intended instance, storage, connection pool, backup, and recovery topology. The scratch database
is dropped after evidence is written. The configured database is used only as the administrative
connection for creating that isolated database and is never migrated or loaded.

The generated fixture covers ten years in the deployed wide and repeatable tables. Its measured
clinical batch uses real reports, occurrences, signed snapshots, transactional outbox events, the
production projector, reconciliation, and amendments. Every threshold result carries its dataset
size, PostgreSQL environment, measured query or executable path, production table names, migration
count, and wide-table column count; the artifact also records migration/bootstrap and projector
hash/run evidence.

## Evidence status and follow-up

The CI artifact is a measured, resource-bounded representative run, not a ten-million-report claim.
It reports each approved threshold as `pass`, `fail`, `not-applicable`, or
`pending-production-run`. A failed measured target causes the command to fail and retains the
approved target plus a follow-up; the harness never rewrites or relaxes policy. Infrastructure
resource, backup/recovery, and full-capacity results remain explicitly pending until the production
profile is executed.

Required deployment follow-up: run the production profile before production readiness sign-off,
archive its JSON artifact with the release evidence, and open a blocking issue for every `fail` or
`pending-production-run`. Record remediation and rerun against the same policy hash. No pending or
failed threshold may be interpreted as a capacity pass.

## Recorded bounded runs

Artifacts produced before the production-schema harness are historical only: their simplified
schema and duplicate projection SQL do not substantiate the current thresholds. New evidence must
have artifact schema version 2 and include `productionSchemaEvidence`. The artifact continues to
record recovery RPO/RTO, CPU, connections, and storage headroom as `pending-production-run` until a
production-profile exercise supplies that environment evidence.

The 2026-09-10 production-schema calibration ran PostgreSQL 17.6 on a bounded Linux development
runner with 128 MB shared buffers and 4 MB work memory. It applied 11 migrations and measured 10,000
wide rows, 40,000 repeatable rows, 500 clinical reports, and 25 amendments against the 566-column
wide and 66-column repeatable production tables. Across three runs, the slowest production
projector result was 48.617 reports/second and the longest 500-report batch was 10,284.526 ms;
reconciliation's slowest result was 69.814 reports/second and amendment replay's was 22.702
reports/second. The rebaselined gates round conservatively beyond at least 25% headroom from those
worst observations: 35 reports/second, 13,000 ms, 50 reports/second, and 17 reports/second,
respectively. Dataset, environment, schema, query/path, all observations, threshold, and exact
margin are retained in the machine-readable policy and each new run artifact.
