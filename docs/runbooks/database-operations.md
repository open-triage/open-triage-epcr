# Database recovery and reporting operations

The installation owner approved `database-operations-1.0.0` on 2026-09-02 in the
[database operations policy](../database-operations-policy.md). Bind the approved
bucket, KMS key, PostgreSQL endpoints, identity provider, and monitoring targets
through deployment secrets; never commit credentials or restored data.

## Backup and restore exercise

Create continuous WAL archives and daily physical base backups with the approved
PostgreSQL backup tool. The following logical backup commands provide a portable
exercise in staging; production physical/PITR exercises must use the same checks
after recovery to the selected WAL target:

```bash
pg_dump --format=custom --no-owner --file=/secure/staging/open-triage.dump "$SOURCE_DATABASE_URL"
sha256sum /secure/staging/open-triage.dump
createdb "$RESTORED_DATABASE_NAME"
pg_restore --exit-on-error --no-owner --dbname="$RESTORED_DATABASE_URL" /secure/staging/open-triage.dump
RECOVERY_EXERCISE_ACKNOWLEDGE_RESTORED_DATABASE=1 \
  RESTORED_DATABASE_URL="$RESTORED_DATABASE_URL" \
  npm run verify:recovery -w @open-triage/database
```

Run only against an isolated restored database. The verifier checks PostgreSQL
15+, signed snapshots and audit-chain continuity, then reconciles analytical
projections from authoritative signed state. It emits aggregate JSON evidence
without identifiers or clinical values. Record elapsed time and recovered WAL
target to determine the approved RTO and RPO; destroy restored clinical data
through the installation's approved secure disposal process after evidence is
accepted.

Alert on any non-zero counter from `operations.recovery_readiness`. A derived
projection discrepancy is repairable by reconciliation; a signed snapshot or
audit-chain discrepancy is an integrity incident and must not be patched in
place.

## Reporting replica role test

The Review volume API may use `REVIEW_REPORTING_REPLICA_DATABASE_URL` to query
the physical standby. Provision this URL with an API-runtime credential that
inherits `open_triage_api_runtime`; the API's narrow analytical view and
projection-health grants are separate from general analyst credentials. When
unset, Review volume queries the primary `DATABASE_URL`. The API withholds
counts if replica replay or the projection exceeds the five-minute freshness
target, or projection has failed. `REPORTING_REPLICA_DATABASE_URL` remains the
independent analyst verification credential below.

Create named login roles through the identity broker, grant exactly one portable
`NOLOGIN` analyst role, and route them only through the query gateway. On every
credential issuance and replica replacement run:

```bash
REPORTING_REPLICA_DATABASE_URL="$REPORTING_REPLICA_DATABASE_URL" \
REPORTING_REPLICA_ROLE=open_triage_analyst \
  npm run verify:replica -w @open-triage/database
```

Repeat with `open_triage_identified_analyst` only for the separately authorized
identified-analysis path. The verifier requires a physical standby by default,
opens a read-only transaction, prepares all granted analyst contracts, and
confirms the selected role cannot read `analytics_private` or `clinical` tables.
`ALLOW_PRIMARY_REPLICA_TEST=1` exists only for CI role tests and is forbidden as a
production setting.

Page the database operator at 240 seconds of replay lag and make the analyst
gateway fail closed at 300 seconds. Also alert when WAL archival fails, the last
successful base backup is older than 26 hours, replication disconnects, recovery
integrity counters become non-zero, or query-audit delivery stops for an active
analyst gateway.

## Safe query-audit delivery

For each registered analyst statement, the gateway measures duration and row
count without inspecting or copying returned values. It hashes the immutable
registry definition and sends the safe metadata over a separate primary
connection:

```sql
select operations.record_query_audit(
  :session_uuid, :analyst_role, :contract, :registry_name,
  :registry_sha256, :duration_ms, :row_count, :succeeded,
  :sqlstate_or_null, :application_name
);
```

The writer connection assumes only `open_triage_query_auditor`. Verify PostgreSQL
parameter logging remains disabled after every configuration change. Never grant
the writer clinical or analytical table access, and never add JSON, SQL text,
bind parameters, result samples, report identifiers, or patient identifiers to
the audit event. Monitor only the aggregate `operations.query_audit_health` view.

Rotate analyst credentials at 15 minutes, service credentials by 30 days, and
break-glass credentials at 60 minutes. Revoke the old credential after at most
24 hours of service rotation overlap, confirm connection drain, and retain only
credential identifiers and timestamps in security evidence.

## Offline recovery wrapping-secret backup and rotation

Offline report keys use a dedicated installation secret family. It must never be
derived from or reused as a pseudonymization, database credential, session, CSRF,
or application-signing secret. Store the JSON keyring only in the installation's
approved secret manager and offline escrow; do not put it in PostgreSQL, a database
backup, logs, source control, or a browser. Each value is an independently random
32-byte secret encoded as canonical base64 and keyed by its positive integer version:

```text
OFFLINE_RECOVERY_WRAPPING_KEYS_JSON={"1":"<base64>","2":"<base64>"}
```

Every backup set must include, in separately protected escrow, **every version
referenced by a live `offline_recovery.report_key_envelope`**. Losing any referenced
version makes the affected offline work permanently unrecoverable; a database restore
cannot reconstruct the secret. Before accepting a backup, compare escrow inventory
with this metadata-only query while assuming `open_triage_offline_key_rotator`:

```sql
select wrapping_key_version, count(*)
from offline_recovery.report_key_envelope
where state in ('live', 'locked')
group by wrapping_key_version order by wrapping_key_version;
```

To rotate, add a newly generated version to the secret manager and escrow, deploy the
complete old-plus-new keyring, then run:

```bash
OLD_OFFLINE_RECOVERY_KEY_VERSION=1 \
NEW_OFFLINE_RECOVERY_KEY_VERSION=2 \
OFFLINE_RECOVERY_WRAPPING_KEYS_JSON="$OFFLINE_RECOVERY_WRAPPING_KEYS_JSON" \
DATABASE_URL="$OFFLINE_RECOVERY_ROTATOR_DATABASE_URL" \
  npm run rotate:offline-recovery-keys -w @open-triage/database
```

The rotator decrypts and rewraps in process memory, records one bounded audit event per
envelope, verifies that zero live envelopes reference the old version, and only then
marks it retired. It is restart-safe: envelopes already moved to the new version are
not selected again. Keep retired material through the approved backup-retention window
because an older database backup may still reference it. Remove it only after every
retained backup is newer than the completed rotation and a restore exercise confirms
the version inventory. A failed coverage check is a stop condition, never a reason to
force retirement.

The API runtime role can register, recover, lock, expire, and purge lifecycle state but
has no table privileges. The rotator can call only version/rewrap operations. The
administrative recovery-purger can only delete a selected envelope and receives no
operation that returns wrapped or plaintext keys, so administration cannot use this
workflow to obtain another clinician's key. Audit records contain only bounded actor,
organization, report, policy, outcome, time, reason, and version facts.
