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
  throw new Error("DATABASE_URL is required for the feedback PostgreSQL integration suite");
}

integrationTest("real PostgreSQL enforces private immutable feedback submissions", async (t) => {
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
      values ($1, 'Feedback test EMS', 'UTC')`, [organizationId]);
    await client.query(`insert into app_identity.app_user (id, organization_id, display_name)
      values ($1, $2, 'Feedback test user')`, [actorId, organizationId]);
    await client.query(`insert into feedback.submission
      (reference_code, idempotency_key, submission_type, original_description, organization_id, actor_id,
       organization_display_name, actor_display_name)
      values ('J7M4Q2K6X5PN', $3, 'bug', 'Original preserved text', $1, $2,
        'Feedback test EMS', 'Feedback test user')`, [organizationId, actorId, randomUUID()]);
    await client.query(`insert into feedback.diagnostic
      (submission_id, diagnostic_status, schema_version, payload)
      select id, 'available', 1, $1::jsonb from feedback.submission where reference_code = 'J7M4Q2K6X5PN'`,
      [JSON.stringify({ schemaVersion: 1, appVersion: "0.1.0", buildVersion: "test", mode: "mobile",
        screen: "calls", browserFamily: "chromium", viewport: { width: 390, height: 844, category: "narrow" },
        connectivity: "online", structure: { nodes: [{ kind: "main", depth: 1 }], truncated: false } })]);

    const stored = (await client.query(`select reference_code, submission_type, original_description,
      organization_id, actor_id, organization_display_name, actor_display_name
      from feedback.submission where reference_code = 'J7M4Q2K6X5PN'`)).rows[0];
    assert.deepEqual(stored, {
      reference_code: "J7M4Q2K6X5PN", submission_type: "bug", original_description: "Original preserved text",
      organization_id: organizationId, actor_id: actorId,
      organization_display_name: "Feedback test EMS", actor_display_name: "Feedback test user"
    });
    const diagnostic = (await client.query(`select diagnostic_status, schema_version, unavailable_reason, payload
      from feedback.diagnostic where submission_id = (select id from feedback.submission where reference_code = 'J7M4Q2K6X5PN')`)).rows[0];
    assert.equal(diagnostic.diagnostic_status, "available");
    assert.equal(diagnostic.schema_version, 1);
    assert.equal(diagnostic.unavailable_reason, null);
    assert.equal(diagnostic.payload.structure.nodes[0].kind, "main");
    await assert.rejects(client.query("update feedback.submission set original_description = 'rewritten' where reference_code = 'J7M4Q2K6X5PN'"), /append-only/);
    await client.query("rollback");

    assert.equal((await client.query("select has_schema_privilege('public', 'feedback', 'usage') allowed")).rows[0].allowed, false);
    assert.equal((await client.query("select has_table_privilege('open_triage_feedback_writer', 'feedback.submission', 'insert') allowed")).rows[0].allowed, true);
    assert.equal((await client.query("select has_table_privilege('open_triage_feedback_writer', 'feedback.submission', 'select') allowed")).rows[0].allowed, false);
    assert.equal((await client.query("select has_table_privilege('open_triage_feedback_writer', 'feedback.submission', 'update') allowed")).rows[0].allowed, false);
    assert.equal((await client.query("select has_table_privilege('open_triage_feedback_writer', 'feedback.submission', 'delete') allowed")).rows[0].allowed, false);
    assert.equal((await client.query("select has_table_privilege('open_triage_feedback_writer', 'feedback.diagnostic', 'insert') allowed")).rows[0].allowed, true);
    assert.equal((await client.query("select has_table_privilege('open_triage_feedback_writer', 'feedback.diagnostic', 'select') allowed")).rows[0].allowed, false);
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
});
