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
