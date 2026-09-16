import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sql = await readFile(path.join(repoRoot, "supabase/migrations/20260916160000_feedback_review_reader.sql"), "utf8");

test("reviewer has execute-only access to the supported read workflow", () => {
  assert.match(sql, /create role open_triage_feedback_reviewer[\s\S]*nologin/);
  assert.match(sql, /grant execute on function feedback\.review_queue/);
  assert.match(sql, /grant execute on function feedback\.review_detail/);
  assert.match(sql, /revoke all on table feedback\.submission from open_triage_feedback_reviewer/);
  assert.doesNotMatch(sql, /grant (?:select|insert|update|delete|all).*open_triage_feedback_reviewer/i);
});

test("queue uses bounded keyset pagination and all approved filters", () => {
  assert.match(sql, /limit least\(greatest\(coalesce\(p_limit, 25\), 1\), 101\)/);
  assert.match(sql, /\(s\.created_at, s\.id\) < \(p_cursor_created_at, p_cursor_id\)/);
  for (const filter of ["p_status", "p_type", "p_priority", "p_organization_id", "p_created_from", "p_created_before"]) {
    assert.match(sql, new RegExp(filter));
  }
});
