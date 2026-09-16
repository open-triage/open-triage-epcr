import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sql = await readFile(path.join(repoRoot, "supabase/migrations/20260916170000_human_approved_feedback_triage.sql"), "utf8");

test("review lifecycle, priority, provenance, and append-only history are constrained", () => {
  assert.match(sql, /review_status in \('new', 'triaged', 'planned', 'in_progress', 'resolved', 'declined', 'duplicate'\)/);
  assert.match(sql, /review_priority in \('low', 'normal', 'high', 'urgent'\)/);
  assert.match(sql, /reviewer_type in \('human', 'ai_assisted'\)/);
  assert.match(sql, /feedback_review_event_immutable/);
  assert.doesNotMatch(sql, /prompt|reasoning/i);
});

test("one security-definer function locks, checks version, appends, and projects atomically", () => {
  assert.match(sql, /create or replace function feedback\.record_review_decision/);
  assert.match(sql, /for update/);
  assert.match(sql, /v_submission\.review_version <> p_expected_version/);
  assert.match(sql, /insert into feedback\.review_event/);
  assert.match(sql, /update feedback\.submission/);
  assert.match(sql, /grant execute on function feedback\.record_review_decision/);
  assert.match(sql, /revoke all on table feedback\.review_event from open_triage_feedback_reviewer/);
  assert.doesNotMatch(sql, /grant (?:select|insert|update|delete|all).*open_triage_feedback_reviewer/i);
});
