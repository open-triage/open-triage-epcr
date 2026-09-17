import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL(
  "../../../supabase/migrations/20260917220000_enforce_offline_recovery_lifecycle.sql",
  import.meta.url,
), "utf8");

test("clinical authority loss locks keys and revokes outstanding grants without extending retention", () => {
  assert.match(migration, /reconcile_user_clinical_authority/);
  assert.match(migration, /state = 'locked'/);
  assert.match(migration, /recovery_deadline > now\(\)/);
  assert.doesNotMatch(migration, /set[^;]*recovery_deadline\s*=/i);
  assert.match(migration, /offline_recovery_role_assignment_authority/);
  assert.match(migration, /offline_recovery_role_definition_authority/);
  assert.match(migration, /revoke_user_recovery_grants/);
});

test("restored authority can recover locked work only through current user, session, capability, and deadline checks", () => {
  assert.match(migration, /envelope\.state in \('live', 'locked', 'completed'\)/);
  assert.match(migration, /app_identity\.user_has_capability\([^]*'clinical:document'/);
  assert.match(migration, /session\.revoked_at is null/);
  assert.match(migration, /session\.credential_version = credential\.credential_version/);
  assert.match(migration, /owner_user_id = candidate_user_id/);
  assert.match(migration, /recovery_deadline <= selected_now/);
});

test("account containment and explicit administrator purge cryptographically destroy all browser envelopes", () => {
  assert.match(migration, /offline_recovery_account_containment/);
  for (const reason of ["account_deleted", "organization_removed", "account_deactivated"]) {
    assert.match(migration, new RegExp(`'${reason}'`));
  }
  assert.match(migration, /purge_user_recovery_as_administrator/);
  assert.match(migration, /delete from offline_recovery\.report_key_envelope/);
  assert.match(migration, /'administrative_recovery_purge'/);
  assert.doesNotMatch(migration, /patient|payload|ciphertext|wrapped_data_key\s+returning/i);
});

test("lifecycle functions and audits expose no broad table access", () => {
  assert.match(migration, /security definer\s+set search_path = ''/);
  assert.match(migration, /revoke all on function offline_recovery\.revoke_user_recovery_grants/);
  assert.doesNotMatch(migration, /grant (?:select|insert|update|delete|all) on offline_recovery/i);
});
