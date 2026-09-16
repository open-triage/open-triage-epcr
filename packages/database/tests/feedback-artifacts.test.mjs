import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sql = await readFile(path.join(repoRoot, "supabase/migrations/20260916120000_accept_authenticated_feedback.sql"), "utf8");
const deliverySql = await readFile(path.join(repoRoot, "supabase/migrations/20260916130000_feedback_delivery_safety.sql"), "utf8");

test("feedback storage is private, append-only, attributed, and narrowly writable", () => {
  assert.match(sql, /create schema feedback/);
  assert.match(sql, /revoke all on schema feedback from public/);
  assert.match(sql, /feedback_submission_immutable/);
  assert.match(sql, /before update or delete/);
  assert.match(sql, /foreign key \(organization_id, actor_id\)/);
  assert.match(sql, /grant insert on table feedback\.submission to open_triage_feedback_writer/);
  assert.doesNotMatch(sql, /grant (?:select|update|delete|all).*open_triage_feedback_writer/i);
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
