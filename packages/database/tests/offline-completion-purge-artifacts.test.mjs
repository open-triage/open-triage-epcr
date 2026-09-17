import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL(
  "../../../supabase/migrations/20260917210000_reconcile_offline_completion_and_purge.sql",
  import.meta.url,
), "utf8");

test("signing locks protected recovery while preserving only unsynchronized late work", () => {
  assert.match(migration, /synchronized_revision bigint not null default 0/);
  assert.match(migration, /old\.status = 'draft' and new\.status = 'signed'/);
  assert.match(migration, /set state = 'completed'/);
  assert.match(migration, /envelope\.state in \('live', 'completed'\)/);
  assert.match(migration, /server cannot observe ciphertext written while disconnected/i);
  assert.match(migration, /eligible_report_state in \('draft', 'signed'\)/);
});

test("server purge destroys key material, grants, and leaves a non-revivable tombstone", () => {
  assert.match(migration, /create table offline_recovery\.report_purge_tombstone/);
  assert.match(migration, /set state = 'purged', wrapping_nonce = null, wrapped_data_key = null/);
  assert.match(migration, /delete from offline_recovery\.report_recovery_grant where report_id = candidate_report_id/);
  assert.match(migration, /report_delete_purges_offline_recovery/);
  assert.match(migration, /register_report_key[\s\S]*report_purge_tombstone/);
  assert.match(migration, /recover_report_key[\s\S]*report_purge_tombstone/);
});

test("purge records only bounded non-clinical facts", () => {
  const tombstone = migration.match(/create table offline_recovery\.report_purge_tombstone \(([\s\S]*?)\n\);/)?.[1] ?? "";
  assert.doesNotMatch(tombstone, /ciphertext|wrapped|patient|clinical|queued|token|credential/i);
  assert.match(tombstone, /report_id uuid primary key/);
  assert.match(tombstone, /organization_id uuid not null/);
  assert.match(tombstone, /reason_code text not null/);
});
