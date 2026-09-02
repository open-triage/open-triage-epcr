# Retention, archival, legal-hold, and deletion policy

Status: **proposed — installation-owner approval required**  
Policy version: `retention-1.0.0-proposed`

No retention batch may be prepared until the installation owner records approval
of the four decisions below in `retention.policy`. The migration does not infer or
self-certify that approval.

## Decisions submitted for approval

| Decision | Proposed policy |
| --- | --- |
| Archive destination | S3-compatible object storage at `s3://open-triage-retention-archive/<installation-id>/<organization-id>/`, in a separate security account, with versioning and S3 Object Lock in compliance mode for at least the applicable legal retention period. |
| Deletion authority | An active application user in the batch organization with the existing `installation:administer` capability may authorize deletion. The retention service invokes the function through the non-login `open_triage_retention_executor` database role; the function validates the administrator UUID and records it as the actor. Application, clinical, analyst, projector, and ordinary operational database roles receive neither table deletion privileges nor direct execution rights. The deleting administrator must be distinct from the preparation and verification identities. |
| Evidence format | Canonical PostgreSQL `jsonb` NDJSON payload, one complete report per line, plus SHA-256 payload and manifest digests, immutable object URI/version, actor and timestamps, counts, failures, and append-only SHA-256-chained database evidence. Evidence contains identifiers and hashes, not copied clinical values. |
| Online retention | Ten years by default. No local override is proposed. An approved organization-specific value from 1–100 years may replace the default only when the installation owner documents the governing obligation in the approval note. |

## Safety invariants

- Only signed reports whose reporting date is strictly earlier than the policy
  cutoff are eligible. Drafts are never selected.
- An active report legal hold excludes the report during selection. Holds are
  checked again under lock immediately before deletion, so a newly placed hold
  stops the whole batch.
- Preparation freezes the report set and hashes each complete archival payload.
  Export reproduces the canonical NDJSON bytes and refuses a checksum mismatch.
- Deletion requires a verified object URI under the approved destination, an
  immutable object version, and a matching SHA-256 digest. Archive failure is an
  evidenced terminal state and never enables deletion.
- The privileged deletion function removes the frozen transactional, audit,
  outbox, and analytical rows atomically. Its narrowly scoped transaction marker
  is the only exception to signed-record immutability triggers.
- Analytical partitions are dropped only when empty. If held and non-held reports
  share a year or month, eligible rows are deleted individually and the partition
  remains attached for the held rows.
- Batch membership and evidence survive deletion and are append-only. A failed
  deletion rolls back both source removal and deletion evidence.

See [Retention operations](runbooks/retention.md) for the executable workflow.
