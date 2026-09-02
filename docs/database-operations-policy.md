# Database backup, recovery, replica, and query-audit policy

Status: **approved by the installation owner on 2026-09-02**
Policy version: `database-operations-1.0.0`

This is the approved review artifact for ticket 044. The requesting human reviewer,
acting as the delegating installation owner, approved every decision below on
2026-09-02 without changing its proposed value. The machine-readable values are
in `packages/database/config/database-operations-policy.json`; changing an approved
deployment choice requires a new policy version and another owner review.

## Approved decisions

| Decision | Approved policy |
| --- | --- |
| Backup storage | Continuous PostgreSQL WAL archiving plus a physical base backup every 24 hours to `s3://open-triage-database-backups/<installation-id>/`. The bucket is in a separate security account, encrypted with a deployment KMS key, versioned, and protected by Object Lock compliance mode. Retain backup material for 35 days. |
| Recovery objectives | Recovery point objective: 5 minutes. Recovery time objective: 4 hours. Complete a production-equivalent restore exercise every 90 days and retain its non-clinical evidence. |
| Replica topology | One asynchronous physical hot standby in the same region and a different availability zone. Only analyst traffic uses it. The gateway stops new analyst queries when replay lag exceeds 300 seconds; failover is an explicit operator action, not automatic promotion. |
| Credential lifecycle | Analysts receive named, per-user gateway credentials lasting at most 15 minutes. Service credentials last at most 30 days with no more than 24 hours of rotation overlap. Break-glass credentials last at most 60 minutes and page security. Portable database group roles remain `NOLOGIN`. |
| Monitoring and query audit | PostgreSQL exporter plus the safe `operations` views supplies database, projection, replica-lag, recovery, and audit-delivery metrics. Every analyst query goes through the trusted gateway; the gateway writes only the approved metadata to the primary through `open_triage_query_auditor`. Retain metadata for 365 days. PostgreSQL statement and parameter logging are disabled. SQL text, bind values, and returned clinical values are never audit fields. |

## Query-audit boundary

`operations.query_audit_event` contains only time, a random session UUID, one of
the two analyst roles, an approved analyst contract, a deployment query-registry
name and SHA-256 fingerprint, duration, returned-row count, success/SQLSTATE,
database name, application name, and backend PID. It has no flexible metadata,
SQL-text, bind-value, result-value, report-ID, patient-ID, or organization-ID
column. Rows are append-only. The metadata writer is a separate non-login role
that has execute permission on a constrained function but no clinical reads.

The analyst gateway uses a read-only replica connection for the query and a
separate primary connection for its audit metadata. It must write one event after
every attempt, including failed attempts, and fail closed when audit delivery is
unavailable. Inline user-provided SQL is prohibited: deployed queries are chosen
from the approved registry and values are bound parameters. PostgreSQL settings
must keep `log_statement=none`, `log_min_duration_statement=-1`,
`log_parameter_max_length=0`, and `log_parameter_max_length_on_error=0`.

## Recovery evidence

A successful exercise records backup object version and checksum, source and
restored PostgreSQL versions, recovery target, start/end times, RPO/RTO results,
aggregate consistency counters, aggregate projection reconciliation counts,
replica role-test outcome, operator identities, and change-ticket reference. It
must not copy query results, SQL binds, signed payloads, patient identifiers, or
other clinical values into the exercise record.

The restore is usable only when `operations.recovery_readiness` reports no
missing/mismatched/orphan snapshots and no broken audit-chain links. Analytical
tables are derived state: `verify-recovery.mjs` reconciles every signed reporting
date from immutable signed state and then requires zero missing or stale
projections. The exercise is not complete until the replica verifier confirms
both analyst contracts are readable in a read-only transaction and private
tables remain inaccessible.

See [Database recovery and reporting operations](runbooks/database-operations.md)
for the executable exercise and deployment checks.

## Approval record

Approved on 2026-09-02 by the requesting human reviewer acting as the delegating
installation owner in the ticket 044 Codex session. The approval promotes the
unchanged proposal to `database-operations-1.0.0` and covers backup storage,
recovery objectives, reporting-replica topology, credential lifecycle, and the
monitoring/query-audit mechanism and privacy boundary.
