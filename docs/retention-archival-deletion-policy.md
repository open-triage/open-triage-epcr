# Retention, archival, legal-hold, and deletion policy

Status: **approved by the installation owner on 2026-09-02**
Policy version: `retention-1.0.0`

This is the approved review artifact for ticket 042. The requesting human reviewer
approved all four decisions below, including the revised administrator-authorized
deletion clause. A deployment must still bind the approved values to an exact
organization and archive URI in `retention.policy`; no batch can run while that
organization row remains pending.

## Approved decisions

| Decision | Approved policy |
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

## Approval record

Approved on 2026-09-02 by the requesting human reviewer in the ticket 042 Codex
session. The approval covers policy version `retention-1.0.0`: the archive
destination template and Object Lock controls, administrator-authorized deletion,
canonical NDJSON and hash-chained evidence, and ten years of online retention with
no local override. The deleting administrator must be active, belong to the batch
organization, hold `installation:administer`, be distinct from preparation and
verification identities, and be recorded by validated UUID evidence through the
restricted executor role.
