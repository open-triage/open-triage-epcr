import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sql = await readFile(path.join(repoRoot, "supabase/migrations/20260916180000_complete_feedback_review_flows.sql"), "utf8");
const triageSql = await readFile(path.join(repoRoot, "supabase/migrations/20260916170000_human_approved_feedback_triage.sql"), "utf8");
const cli = await readFile(path.join(repoRoot, "packages/database/scripts/feedback-review.mjs"), "utf8");
const runbook = await readFile(path.join(repoRoot, "docs/runbooks/feedback-review.md"), "utf8");

test("canonical duplicates are relational, indexed, and cannot self-reference", () => {
  assert.match(sql, /canonical_submission_id bigint[\s\S]*references feedback\.submission\(id\)/);
  assert.match(sql, /canonical_submission_id <> id/);
  assert.match(sql, /canonical_submission_id <> submission_id/);
  assert.match(sql, /feedback_submission_canonical_idx/);
  assert.match(sql, /p_duplicate_of_reference = p_reference_code/);
  assert.match(sql, /canonical feedback submission not found/);
});

test("duplicate and external work state is appended and projected atomically", () => {
  assert.match(sql, /insert into feedback\.review_event[\s\S]*canonical_submission_id,[\s\S]*external_work_kind, external_work_url/);
  assert.match(sql, /update feedback\.submission[\s\S]*canonical_submission_id = v_canonical\.id,[\s\S]*external_work_url = p_external_work_url/);
  assert.match(sql, /'duplicateOfReference'/);
  assert.match(sql, /'externalWork'/);
  assert.match(triageSql, /feedback_review_event_immutable/);
});

test("the CLI exposes only fixed review functions and no external automation or arbitrary SQL", () => {
  assert.match(cli, /feedback\.record_review_decision/);
  assert.doesNotMatch(cli, /child_process|execFile|spawn|github|gh\s|fetch\(|https\.request/i);
  assert.doesNotMatch(cli, /--sql|query\([^)]*process\.argv|query\([^)]*option\([^)]*sql/i);
  assert.doesNotMatch(cli, /restore.*diagnostic|update feedback\.submission|delete from feedback/i);
});

test("documentation makes the human and downstream authorization boundaries explicit", () => {
  assert.match(runbook, /human makes every final review\s+decision/i);
  assert.match(runbook, /does not create or modify the linked issue\s+or pull request/i);
  assert.match(runbook, /issue creation, branch creation, pull requests, and implementation\s+each require separate explicit instructions/i);
  assert.match(runbook, /partial success/i);
});
