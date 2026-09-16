import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import pg from "pg";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl = process.env.DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;

if (process.env.REQUIRE_DATABASE_INTEGRATION && !databaseUrl) {
  throw new Error("DATABASE_URL is required for feedback diagnostic retention integration tests");
}

integrationTest("terminal diagnostic expiry is bounded, idempotent, indexed, and preserves review state", async (t) => {
  await execFileAsync(process.execPath, [path.join(packageRoot, "scripts/migrate.mjs")], {
    env: { ...process.env, DATABASE_URL: databaseUrl }
  });
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  t.after(() => client.end());
  await client.query("begin");
  try {
    const organizationId = randomUUID();
    const actorId = randomUUID();
    await client.query(`insert into app_identity.organization (id, name, deployment_timezone)
      values ($1, 'Retention test EMS', 'UTC')`, [organizationId]);
    await client.query(`insert into app_identity.app_user (id, organization_id, display_name)
      values ($1, $2, 'Retention test user')`, [actorId, organizationId]);

    const fixtures = [
      ["A7M4Q2K6X5PA", "resolved", "40 days", true],
      ["B7M4Q2K6X5PA", "declined", "31 days", true],
      ["C7M4Q2K6X5PA", "duplicate", "60 days", false],
      ["D7M4Q2K6X5PA", "resolved", "29 days", true],
      ["E7M4Q2K6X5PA", "new", "60 days", true],
      ["F7M4Q2K6X5PA", "in_progress", "60 days", true]
    ];
    for (const [reference, status, age, hasDiagnostic] of fixtures) {
      await client.query(`insert into feedback.submission
        (reference_code, idempotency_key, submission_type, original_description,
         organization_id, actor_id, organization_display_name, actor_display_name,
         review_status, review_priority, approved_summary, approved_review_note,
         review_version, review_updated_at)
        values ($1, $2, 'bug', $3, $4, $5, 'Retention test EMS', 'Retention test user',
          $6, 'normal', 'Preserved summary', 'Preserved note', 1, clock_timestamp() - $7::interval)`,
      [reference, randomUUID(), `Preserved ${reference}`, organizationId, actorId, status, age]);
      if (hasDiagnostic) await client.query(`insert into feedback.diagnostic
        (submission_id, diagnostic_status, schema_version, payload)
        select id, 'available', 1, '{"schemaVersion":1}'::jsonb
        from feedback.submission where reference_code = $1`, [reference]);
    }
    await client.query(`insert into feedback.review_event
      (submission_id, review_version, review_status, review_priority, approved_summary,
       review_note, reviewer_type, human_reviewer_id, reviewed_at)
      select id, 1, 'resolved', 'normal', 'Preserved summary', 'Preserved event',
        'human', 'retention-reviewer', review_updated_at
      from feedback.submission where reference_code = 'A7M4Q2K6X5PA'`);

    await client.query(`do $$ begin
      execute format('grant open_triage_feedback_retention to %I', current_user);
      execute format('grant open_triage_feedback_reviewer to %I', current_user);
    end $$`);
    await client.query("set local role open_triage_feedback_retention");
    assert.equal((await client.query(`select has_function_privilege(current_user,
      'feedback.expire_terminal_diagnostics(integer)', 'execute') allowed`)).rows[0].allowed, true);
    assert.equal((await client.query("select has_table_privilege(current_user, 'feedback.diagnostic', 'delete') allowed")).rows[0].allowed, false);
    assert.equal((await client.query("select has_table_privilege(current_user, 'feedback.diagnostic', 'select') allowed")).rows[0].allowed, false);

    await client.query("savepoint interrupted_batch");
    assert.deepEqual((await client.query("select * from feedback.expire_terminal_diagnostics(1)")).rows[0], {
      deleted_count: 1, remaining_eligible: 1
    });
    await client.query("rollback to savepoint interrupted_batch");
    assert.deepEqual((await client.query("select * from feedback.expire_terminal_diagnostics(1)")).rows[0], {
      deleted_count: 1, remaining_eligible: 1
    });
    assert.deepEqual((await client.query("select * from feedback.expire_terminal_diagnostics(1)")).rows[0], {
      deleted_count: 1, remaining_eligible: 0
    });
    assert.deepEqual((await client.query("select * from feedback.expire_terminal_diagnostics(1)")).rows[0], {
      deleted_count: 0, remaining_eligible: 0
    });
    await client.query("reset role");

    const preserved = (await client.query(`select count(*)::integer submission_count,
      count(*) filter (where original_description like 'Preserved %')::integer content_count,
      count(*) filter (where organization_id = $1 and actor_id = $2)::integer attribution_count
      from feedback.submission where reference_code = any($3::text[])`,
    [organizationId, actorId, fixtures.map(([reference]) => reference)])).rows[0];
    assert.deepEqual(preserved, { submission_count: 6, content_count: 6, attribution_count: 6 });
    assert.deepEqual((await client.query(`select review_status, review_priority, approved_summary,
      approved_review_note, review_version from feedback.submission
      where reference_code = 'A7M4Q2K6X5PA'`)).rows[0], {
      review_status: "resolved", review_priority: "normal", approved_summary: "Preserved summary",
      approved_review_note: "Preserved note", review_version: "1"
    });
    assert.equal((await client.query("select count(*)::integer count from feedback.review_event")).rows[0].count, 1);
    assert.deepEqual((await client.query(`select s.reference_code from feedback.diagnostic d
      join feedback.submission s on s.id = d.submission_id order by s.reference_code`)).rows,
    [{ reference_code: "D7M4Q2K6X5PA" }, { reference_code: "E7M4Q2K6X5PA" }, { reference_code: "F7M4Q2K6X5PA" }]);

    await client.query("set local role open_triage_feedback_reviewer");
    await client.query(`select * from feedback.record_review_decision(
      'A7M4Q2K6X5PA', 1, 'in_progress', 'normal', 'Reopened summary', 'Reopened after cleanup',
      'human', 'retention-reviewer', null, null)`);
    const reopened = (await client.query("select * from feedback.review_detail('A7M4Q2K6X5PA')")).rows[0];
    assert.equal(reopened.submission.status, "in_progress");
    assert.equal(reopened.diagnostics, null);
    assert.equal(reopened.review_history.length, 2);
    await client.query("reset role");

    await client.query("set local enable_seqscan = off");
    const plan = JSON.stringify((await client.query(`explain (format json, costs off)
      select d.submission_id from feedback.submission s
      join feedback.diagnostic d on d.submission_id = s.id
      where s.review_status in ('resolved', 'declined', 'duplicate')
        and s.review_updated_at <= clock_timestamp() - interval '30 days'
      order by s.review_updated_at, s.id limit 100`)).rows[0]["QUERY PLAN"]);
    assert.match(plan, /feedback_submission_terminal_diagnostic_expiry_idx/);
    assert.doesNotMatch(plan, /payload/);
    await client.query("rollback");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
});
