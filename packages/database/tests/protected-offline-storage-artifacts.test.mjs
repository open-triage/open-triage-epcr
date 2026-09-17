import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../../../supabase/migrations/20260917100000_protected_offline_report_envelopes.sql", import.meta.url), "utf8");
const checkpoints = await readFile(new URL("../../../supabase/migrations/20260917110000_protected_offline_ciphertext_checkpoints.sql", import.meta.url), "utf8");
const expiryMigration = await readFile(new URL("../../../supabase/migrations/20260917120000_enforce_offline_recovery_expiry.sql", import.meta.url), "utf8");

test("organization offline recovery policy is stored with safe immutable defaults", () => {
  assert.match(migration, /offline_recovery_window_hours integer not null default 24/);
  assert.match(migration, /offline_recovery_window_hours between 1 and 168/);
  assert.match(migration, /offline_recovery_restart_reauthentication_required boolean not null default true/);
});

test("server ciphertext checkpoints lock the row and reject rollback or same-revision substitution", () => {
  assert.match(checkpoints, /for update/);
  assert.match(checkpoints, /candidate_ciphertext_revision < current_envelope\.ciphertext_revision/);
  assert.match(checkpoints, /protected ciphertext rollback rejected/);
  assert.match(checkpoints, /current_envelope\.ciphertext_sha256 is distinct from candidate_ciphertext_sha256/);
  assert.match(checkpoints, /Never-synchronized local revisions cannot be detected after complete client loss/);
});

test("report key custody exposes one narrow runtime operation and no table access", () => {
  assert.match(migration, /create table offline_recovery\.report_key_envelope/);
  assert.match(migration, /revoke all on offline_recovery\.report_key_envelope from public/);
  assert.match(migration, /create role open_triage_offline_runtime nologin/);
  assert.match(migration, /grant execute on function offline_recovery\.register_report_key/);
  assert.doesNotMatch(migration, /grant (?:select|insert|update|delete|all) on offline_recovery\.report_key_envelope/i);
  assert.match(migration, /wrapped_data_key bytea/);
  assert.match(migration, /wrapping_key_version integer/);
  assert.match(migration, /recovery_handle uuid not null unique/);
  assert.match(migration, /report_id uuid primary key references clinical\.report\(id\) on delete cascade/);
});

test("each ciphertext write derives a fresh policy-bound deadline capped by report expiry", () => {
  assert.match(expiryMigration, /create function offline_recovery\.record_ciphertext_write/);
  assert.match(expiryMigration, /candidate_written_at \+ make_interval\(hours => selected_window\)/);
  assert.match(expiryMigration, /least\(selected_deadline, selected_report_expiry\)/);
  assert.match(expiryMigration, /candidate_ciphertext_revision <= selected_envelope\.ciphertext_revision/);
  assert.match(expiryMigration, /set ciphertext_revision = candidate_ciphertext_revision/);
});

test("shorter policy applies immediately while a longer policy cannot rewrite live deadlines", () => {
  assert.match(expiryMigration, /if new\.offline_recovery_window_hours >= old\.offline_recovery_window_hours then\s+return new/);
  assert.match(expiryMigration, /set recovery_deadline = least/);
  assert.match(expiryMigration, /create trigger organization_shorter_offline_recovery_policy/);
});

test("deadline expiry destroys wrapped keys, leaves a non-revivable tombstone, and is audited", () => {
  assert.match(expiryMigration, /set state = 'expired', wrapping_nonce = null, wrapped_data_key = null/);
  assert.match(expiryMigration, /'key_expired'/);
  assert.match(expiryMigration, /where report_id = candidate_report_id and state <> 'live'/);
  assert.match(expiryMigration, /then return; end if/);
});

test("recovery is deadline checked, generic to callers, and internally audited", () => {
  assert.match(expiryMigration, /create (?:or replace )?function offline_recovery\.recover_report_key/);
  assert.match(expiryMigration, /selected\.recovery_deadline <= candidate_now/);
  assert.match(expiryMigration, /'recovery_unavailable'/);
  assert.match(expiryMigration, /'recovery_succeeded'/);
  assert.doesNotMatch(expiryMigration, /grant (?:select|insert|update|delete|all) on offline_recovery\.event/i);
});
