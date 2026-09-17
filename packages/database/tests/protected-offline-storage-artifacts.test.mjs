import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../../../supabase/migrations/20260917100000_protected_offline_report_envelopes.sql", import.meta.url), "utf8");
const checkpoints = await readFile(new URL("../../../supabase/migrations/20260917110000_protected_offline_ciphertext_checkpoints.sql", import.meta.url), "utf8");

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
