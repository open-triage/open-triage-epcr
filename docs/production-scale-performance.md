# Production-scale performance policy and evidence

Status: approved under owner delegation on 2026-09-02  
Version: `production-scale-performance-1.0.0`

The requesting product and operations owner instructed the implementation agent to complete the
feature without further input and authorized defensible operating thresholds. The exact approved
thresholds and capacity model are the machine-readable
`packages/database/config/production-scale-performance.json`; results always embed its SHA-256 hash.

## Capacity and thresholds

The production profile is ten years online at one million reports per year: 10,000,000 wide rows,
60,000,000 representative repeatable rows, 5% amendments, ten annual wide partitions, and 120
monthly repeatable partitions. Common wide queries must be at most 250 ms p95, repeatable queries at
most 500 ms p95, and partition-pruned queries at most 250 ms p95. Signing and amendment replay must
sustain at least 100 reports/second. Projector batches are 500 reports, sustain at least 100
reports/second, and complete within five seconds. Reconciliation sustains at least 10,000
reports/second. Common query plans may not spill to temporary storage.

Operations retain the already approved five-minute RPO and four-hour RTO. Production-like steady
CPU must remain at or below 70%, peak CPU at or below 80%, connection use at or below 70%, and
storage headroom at or above 30%.

## Reproducible exercise

`npm run scale:test:ci -w @open-triage/database` rebuilds only the dedicated `scale_validation`
schema, loads a deterministic bounded distribution, runs real PostgreSQL statements, records
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` plans, evaluates the approved thresholds, and writes
`packages/database/artifacts/scale-test-ci.json`. CI uploads that file even on failure.

`npm run scale:test:production -w @open-triage/database` runs the same framework with exactly ten
million reports. It must run against an isolated PostgreSQL 15 production-like environment with
the intended instance, storage, connection pool, backup, and recovery topology. The scale schema is
destructive to its own prior benchmark contents; it never writes clinical, catalog, or production
analytics schemas.

The generated fixture covers ten years, sparse large values in otherwise wide rows, repeatable
vitals/medications/procedures/history, signed write plus outbox work, projector batches, annual and
monthly partitions, reconciliation, and amendments. Existing database integration tests continue
to prove that these modeled operations map to the transactional signing, projector, replay, and
reconciliation implementation.

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

## Recorded bounded run

GitHub Actions run `33683532980` on 2026-09-02 executed the CI profile with PostgreSQL 15.19,
128 MB shared buffers, and 4 MB work memory. Its uploaded `database-scale-test-ci` artifact contains
the complete configuration, environment, samples, threshold evaluations, and JSON query plans. The
policy SHA-256 was `1abfa4477731a93f5f7c32e4e00280e5cc9b3b2663dbb62304345155a2da8c73`.

The measured distribution was 10,000 reports across all ten annual partitions, 38,000 repeatable
rows across 120 monthly partitions, and 475 amendments. All ten CI-measurable thresholds passed:
wide query 1.166 ms p95, repeatable query 2.817 ms p95, partition-pruned query 0.402 ms p95, signing
63,027.858 reports/second, a 500-report projector batch in 11.429 ms (43,748.359 reports/second),
reconciliation 2,901,073.397 reports/second, amendment replay 54,560.074 reports/second, and zero
temporary-query bytes. These figures establish harness correctness and bounded behavior only; they
do not extrapolate or assert ten-million-report capacity.

The artifact records recovery RPO/RTO, CPU, connections, and storage headroom as
`pending-production-run`, each with the production-like exercise as its explicit follow-up. There
were no failed thresholds and no target was changed after the run.
