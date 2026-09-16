import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sql = await readFile(path.join(repoRoot, "supabase/migrations/20260916120000_accept_authenticated_feedback.sql"), "utf8");
const diagnosticsSql = await readFile(path.join(repoRoot, "supabase/migrations/20260916140000_attach_feedback_diagnostics.sql"), "utf8");
const deliverySql = await readFile(path.join(repoRoot, "supabase/migrations/20260916130000_feedback_delivery_safety.sql"), "utf8");
const retentionSql = await readFile(path.join(repoRoot, "supabase/migrations/20260916190000_expire_terminal_feedback_diagnostics.sql"), "utf8");
const retentionRunbook = await readFile(path.join(repoRoot, "docs/runbooks/feedback-diagnostic-retention.md"), "utf8");

test("feedback storage is private, append-only, attributed, and narrowly writable", () => {
  assert.match(sql, /create schema feedback/);
  assert.match(sql, /revoke all on schema feedback from public/);
  assert.match(sql, /feedback_submission_immutable/);
  assert.match(sql, /before update or delete/);
  assert.match(sql, /foreign key \(organization_id, actor_id\)/);
  assert.match(sql, /grant insert on table feedback\.submission to open_triage_feedback_writer/);
  assert.doesNotMatch(sql, /grant (?:select|update|delete|all).*open_triage_feedback_writer/i);
});

test("feedback diagnostics are private, bounded, separately removable, and narrowly writable", () => {
  assert.match(diagnosticsSql, /create table feedback\.diagnostic/);
  assert.match(diagnosticsSql, /references feedback\.submission\(id\) on delete cascade/);
  assert.match(diagnosticsSql, /schema_version = 1/);
  assert.match(diagnosticsSql, /pg_column_size\(payload\) <= 16384/);
  assert.match(diagnosticsSql, /revoke all on table feedback\.diagnostic from public/);
  assert.match(diagnosticsSql, /grant insert on table feedback\.diagnostic to open_triage_feedback_writer/);
  assert.doesNotMatch(diagnosticsSql, /grant (?:select|update|delete|all).*open_triage_feedback_writer/i);
  assert.doesNotMatch(diagnosticsSql, /feedback_diagnostic_immutable/);
});

test("feedback retries have a required actor-scoped idempotency identity", () => {
  assert.match(deliverySql, /add column idempotency_key uuid/);
  assert.match(deliverySql, /alter column idempotency_key set not null/);
  assert.match(deliverySql, /unique \(actor_id, idempotency_key\)/);
});

test("feedback content and opaque references are constrained in PostgreSQL", () => {
  assert.match(sql, /submission_type in \('bug', 'feature'\)/);
  assert.match(sql, /char_length\(original_description\) between 1 and 4000/);
  assert.match(sql, /original_description = btrim\(original_description\)/);
  assert.match(sql, /reference_code ~ '\^\[A-Z2-7\]\{12\}\$'/);
});

test("diagnostic expiry is fixed, bounded, indexed, least-privilege, and documented", () => {
  assert.match(retentionSql, /review_status in \('resolved', 'declined', 'duplicate'\)/);
  assert.match(retentionSql, /review_updated_at <= clock_timestamp\(\) - interval '30 days'/);
  assert.match(retentionSql, /for update of d skip locked/);
  assert.match(retentionSql, /limit p_batch_size/);
  assert.match(retentionSql, /delete from feedback\.diagnostic/);
  assert.match(retentionSql, /feedback_submission_terminal_diagnostic_expiry_idx/);
  assert.doesNotMatch(retentionSql, /payload\s*(?:->|#>|@>|\?|=)/);
  assert.match(retentionSql, /revoke all on table feedback\.diagnostic from open_triage_feedback_retention/);
  assert.match(retentionSql, /grant execute on function feedback\.expire_terminal_diagnostics/);
  assert.match(retentionRunbook, /Each batch is its own transaction/);
  assert.match(retentionRunbook, /interrupted or failed batch rolls back completely/);
  assert.match(retentionRunbook, /Deleting diagnostics is irreversible/);
});
