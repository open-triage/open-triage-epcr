import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL(
  "../../../supabase/migrations/20260917194212_recover_one_protected_report_after_browser_restart.sql",
  import.meta.url,
), "utf8");

test("restart recovery grants are short lived, single use, and fully bound", () => {
  assert.match(migration, /expires_at = created_at \+ interval '60 seconds'/);
  for (const binding of ["session_id", "user_id", "organization_id", "report_id", "envelope_version",
    "required_capability", "owner_user_id", "eligible_report_state"]) {
    assert.match(migration, new RegExp(`${binding}[^]*create_report_recovery_grant`));
  }
  assert.match(migration, /for update;/);
  assert.match(migration, /consumed_at is not null[^]*'replayed'/);
  assert.match(migration, /set consumed_at = selected_now[^]*where id = selected_grant\.id and consumed_at is null/);
  assert.match(migration, /app_identity\.user_has_capability\([^]*'clinical:document'/);
});

test("all externally generic denial causes use a bounded internal audit vocabulary", () => {
  for (const reason of ["missing", "expired", "purged", "unauthorized", "wrong_owner",
    "ineligible_state", "grant_expired", "replayed", "binding_mismatch"]) {
    assert.match(migration, new RegExp(`'${reason}'`));
  }
  assert.match(migration, /reason text not null check \(reason in/);
  assert.match(migration, /report_recovery_event_append_only/);
  assert.match(migration, /return query select 'denied'::text/);
});

test("recovery internals remain inaccessible except through the narrow runtime functions", () => {
  assert.match(migration, /revoke all on offline_recovery\.report_recovery_grant,[^]*report_recovery_event from public/);
  assert.match(migration, /security definer\s+set search_path = ''/);
  assert.match(migration, /grant execute on function offline_recovery\.create_report_recovery_grant/);
  assert.doesNotMatch(migration, /grant (?:select|insert|update|delete|all) on offline_recovery\.report_recovery_/i);
});
