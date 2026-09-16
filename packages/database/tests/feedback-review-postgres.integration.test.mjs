import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { grantRoleForTesting } from "./postgres-role-test-helpers.mjs";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl = process.env.DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;

integrationTest("real PostgreSQL restricts reviewer access and preserves cursor boundaries", async (t) => {
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
      values ($1, 'Review CLI EMS', 'UTC')`, [organizationId]);
    await client.query(`insert into app_identity.app_user (id, organization_id, display_name)
      values ($1, $2, 'Review CLI user')`, [actorId, organizationId]);
    for (const [reference, type, createdAt] of [
      ["R7M4Q2K6X5PA", "bug", "2026-09-16T12:00:00Z"],
      ["R7M4Q2K6X5PB", "feature", "2026-09-16T12:00:00Z"],
      ["R7M4Q2K6X5PC", "bug", "2026-09-15T12:00:00Z"]
    ]) {
      await client.query(`insert into feedback.submission
        (reference_code, submission_type, original_description, organization_id, actor_id,
         organization_display_name, actor_display_name, created_at, idempotency_key)
        values ($1, $2, 'Sanitized review text', $3, $4, 'Review CLI EMS', 'Review CLI user', $5, $6)`,
      [reference, type, organizationId, actorId, createdAt, randomUUID()]);
    }

    const ids = (await client.query(`select id, reference_code, created_at from feedback.submission
      where reference_code like 'R7M4Q2K6X5P_' order by created_at desc, id desc`)).rows;
    await grantRoleForTesting(client, "open_triage_feedback_reviewer");
    await client.query("savepoint before_denied_read");
    await client.query("set local role open_triage_feedback_reviewer");
    await assert.rejects(client.query("select * from feedback.submission"), /permission denied/);
    await client.query("rollback to savepoint before_denied_read");
    await client.query("set local role open_triage_feedback_reviewer");
    const firstPage = await client.query(`select * from feedback.review_queue(
      2, null, null, null, false, $1, null, null, null, null)`, [organizationId]);
    assert.deepEqual(firstPage.rows.map((row) => row.reference_code), ids.slice(0, 2).map((row) => row.reference_code));
    const secondPage = await client.query(`select * from feedback.review_queue(
      2, null, null, null, false, $1, null, null, $2, $3)`,
    [organizationId, ids[1].created_at, ids[1].id]);
    assert.deepEqual(secondPage.rows.map((row) => row.reference_code), [ids[2].reference_code]);

    const detail = await client.query("select * from feedback.review_detail('R7M4Q2K6X5PA')");
    assert.equal(detail.rows[0].submission.referenceCode, "R7M4Q2K6X5PA");
    assert.equal(detail.rows[0].diagnostics, null);
    assert.deepEqual(detail.rows[0].review_history, []);
    assert.equal((await client.query("select * from feedback.review_detail('ZZZZZZZZZZZZ')")).rowCount, 0);
    await client.query("rollback");

    assert.equal((await client.query("select has_table_privilege('open_triage_feedback_reviewer', 'feedback.submission', 'select') allowed")).rows[0].allowed, false);
    assert.equal((await client.query("select has_function_privilege('open_triage_feedback_reviewer', 'feedback.review_detail(text)', 'execute') allowed")).rows[0].allowed, true);
    assert.equal((await client.query("select has_function_privilege('open_triage_feedback_writer', 'feedback.review_detail(text)', 'execute') allowed")).rows[0].allowed, false);
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
});
