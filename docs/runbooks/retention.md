# Retention operations

This runbook is disabled until an installation owner approves the proposed
[retention policy](../retention-archival-deletion-policy.md). Use dedicated
credentials that can assume `open_triage_retention_executor`; never use an API,
clinical, projector, or analyst credential.

## Configure and approve

Insert a pending `retention.policy` row with the exact organization destination
prefix. Review the destination, role, evidence format, retention years, and
approval note out of band. The owner then performs the single permitted policy
transition to `approved-installation-owner`, recording their identity and time.
Approved policy rows are immutable.

Place a hold as soon as preservation is anticipated:

```sql
insert into retention.legal_hold
  (organization_id, report_id, reason, authority_reference, placed_by)
values (:organization_id, :report_id, :reason, :case_reference, :actor);
```

Release it only with `released_by`, `released_at`, and `release_reason`. Holds
cannot be deleted.

## Prepare, export, and archive

```bash
npm run retention -w @open-triage/database -- prepare \
  --organization ORGANIZATION_UUID --as-of 2036-09-02 --actor OPERATOR_ID

npm run retention -w @open-triage/database -- export \
  --batch BATCH_UUID --output /secure/staging/BATCH_UUID.ndjson
```

Upload the exported file to the approved prefix using deployment-controlled
S3 tooling. Require TLS, server-side encryption, versioning, and Object Lock
compliance mode. Compare the object's downloaded SHA-256 with the export result.
Do not verify a mutable object or a storage response that lacks a version ID.

On upload or verification failure, preserve evidence and do not delete:

```bash
npm run retention -w @open-triage/database -- fail \
  --batch BATCH_UUID --actor OPERATOR_ID --code UPLOAD_FAILED --detail "ticket reference"
```

After independent verification:

```bash
npm run retention -w @open-triage/database -- verify \
  --batch BATCH_UUID \
  --object-uri s3://open-triage-retention-archive/INSTALLATION/ORGANIZATION/BATCH_UUID.ndjson \
  --object-version IMMUTABLE_VERSION_ID --sha256 EXPORT_SHA256 --actor VERIFIER_ID
```

## Delete and reconcile evidence

Use a different authorized operator for deletion. Confirm no hold was added and
then invoke the atomic path:

```bash
npm run retention -w @open-triage/database -- delete \
  --batch BATCH_UUID --actor DELETION_OPERATOR_ID

npm run retention -w @open-triage/database -- maintain \
  --batch BATCH_UUID --actor MAINTENANCE_OPERATOR_ID
```

Partition maintenance runs after the deletion transaction so it never waits on
the deletion's row locks. It checks only year/month partitions represented in
the expired batch, drops them only when empty, skips any partition it cannot lock
within 100 ms, and records its result.

Reconcile `retention.archive_batch.report_count` to the deletion result and
inspect every `retention.evidence` sequence. Verify each `previous_hash` equals
the preceding `event_hash`, retain the final deletion evidence with the change
ticket, and alert on any prepared batch that is not verified or failed within the
deployment window. Restore tests must periodically download by immutable object
version, verify SHA-256, load every NDJSON line, and validate its per-report hash.
