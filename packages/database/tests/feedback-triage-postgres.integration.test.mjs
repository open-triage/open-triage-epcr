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

integrationTest("real PostgreSQL atomically records approved triage with optimistic concurrency", async (t) => {
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
      values ($1, 'Triage test EMS', 'UTC')`, [organizationId]);
    await client.query(`insert into app_identity.app_user (id, organization_id, display_name)
      values ($1, $2, 'Triage test user')`, [actorId, organizationId]);
    await client.query(`insert into feedback.submission
      (reference_code, idempotency_key, submission_type, original_description, organization_id, actor_id,
       organization_display_name, actor_display_name)
      values ('T7M4Q2K6X5PA', $3, 'bug', 'Original content remains unchanged', $1, $2,
        'Triage test EMS', 'Triage test user')`, [organizationId, actorId, randomUUID()]);
    await client.query(`insert into feedback.submission
      (reference_code, idempotency_key, submission_type, original_description, organization_id, actor_id,
       organization_display_name, actor_display_name)
      values ('C7M4Q2K6X5PA', $3, 'bug', 'Canonical report', $1, $2,
        'Triage test EMS', 'Triage test user')`, [organizationId, actorId, randomUUID()]);
    await grantRoleForTesting(client, "open_triage_feedback_reviewer");
    await client.query("set local role open_triage_feedback_reviewer");

    const aiDecision = await client.query(`select * from feedback.record_review_decision(
      'T7M4Q2K6X5PA', 0, 'triaged', 'high', 'Approved summary', 'Approved AI-assisted note',
      'ai_assisted', 'maintainer-1', 'gpt-5', 'review-run-1')`);
    assert.equal(aiDecision.rows[0].review_version, "1");
    assert.equal(aiDecision.rows[0].model_identifier, "gpt-5");

    await client.query("savepoint before_stale_decision");
    await assert.rejects(client.query(`select * from feedback.record_review_decision(
      'T7M4Q2K6X5PA', 0, 'planned', 'normal', null, 'Stale note',
      'human', 'maintainer-2', null, null)`), (error) => error.code === "PT002");
    await client.query("rollback to savepoint before_stale_decision");

    const humanCorrection = await client.query(`select * from feedback.record_review_decision(
      'T7M4Q2K6X5PA', 1, 'planned', 'normal', 'Corrected summary', 'Human correction',
      'human', 'maintainer-2', null, null)`);
    assert.equal(humanCorrection.rows[0].review_version, "2");

    const detail = (await client.query("select * from feedback.review_detail('T7M4Q2K6X5PA')")).rows[0];
    assert.equal(detail.submission.description, "Original content remains unchanged");
    assert.equal(detail.submission.status, "planned");
    assert.equal(detail.submission.priority, "normal");
    assert.equal(detail.submission.reviewVersion, 2);
    assert.equal(detail.review_history.length, 2);
    assert.equal(detail.review_history[0].reviewerType, "ai_assisted");
    assert.equal(detail.review_history[0].modelIdentifier, "gpt-5");
    assert.equal(detail.review_history[1].reviewerType, "human");
    assert.equal(detail.review_history[1].modelIdentifier, null);

    const duplicate = await client.query(`select * from feedback.record_review_decision(
      'T7M4Q2K6X5PA', 2, 'duplicate', 'normal', 'Known duplicate', 'Canonical relationship approved',
      'human', 'maintainer-2', null, null, 'C7M4Q2K6X5PA', 'issue',
      'https://github.com/open-triage/open-triage-epcr/issues/403')`);
    assert.equal(duplicate.rows[0].review_version, "3");
    assert.equal(duplicate.rows[0].duplicate_of_reference, "C7M4Q2K6X5PA");

    const duplicateDetail = (await client.query("select * from feedback.review_detail('T7M4Q2K6X5PA')")).rows[0];
    assert.equal(duplicateDetail.submission.status, "duplicate");
    assert.equal(duplicateDetail.submission.duplicateOfReference, "C7M4Q2K6X5PA");
    assert.deepEqual(duplicateDetail.submission.externalWork, {
      kind: "issue", url: "https://github.com/open-triage/open-triage-epcr/issues/403"
    });
    assert.equal(duplicateDetail.review_history[2].duplicateOfReference, "C7M4Q2K6X5PA");
    assert.deepEqual(duplicateDetail.review_history[2].externalWork, duplicateDetail.submission.externalWork);

    await client.query("savepoint before_self_duplicate");
    await assert.rejects(client.query(`select * from feedback.record_review_decision(
      'T7M4Q2K6X5PA', 3, 'duplicate', 'normal', null, 'Invalid self duplicate',
      'human', 'maintainer-2', null, null, 'T7M4Q2K6X5PA', null, null)`), (error) => error.code === "PT003");
    await client.query("rollback to savepoint before_self_duplicate");

    await client.query("savepoint before_missing_canonical");
    await assert.rejects(client.query(`select * from feedback.record_review_decision(
      'T7M4Q2K6X5PA', 3, 'duplicate', 'normal', null, 'Missing canonical',
      'human', 'maintainer-2', null, null, 'M7M4Q2K6X5PA', null, null)`), (error) => error.code === "PT004");
    await client.query("rollback to savepoint before_missing_canonical");

    await client.query("savepoint before_invalid_provenance");
    await assert.rejects(client.query(`select * from feedback.record_review_decision(
      'T7M4Q2K6X5PA', 3, 'resolved', 'urgent', null, 'Missing provenance',
      'ai_assisted', 'maintainer-2', null, null)`), (error) => error.code === "PT003");
    await client.query("rollback to savepoint before_invalid_provenance");
    const unchanged = (await client.query("select * from feedback.review_detail('T7M4Q2K6X5PA')")).rows[0];
    assert.equal(unchanged.submission.reviewVersion, 3);
    assert.equal(unchanged.review_history.length, 3);

    assert.equal((await client.query("select has_table_privilege('open_triage_feedback_reviewer', 'feedback.review_event', 'insert') allowed")).rows[0].allowed, false);
    await client.query("savepoint before_direct_event_write");
    await assert.rejects(client.query("update feedback.review_event set review_note = 'rewritten'"), /permission denied/);
    await client.query("rollback to savepoint before_direct_event_write");
    await client.query("reset role");
    await client.query("savepoint before_event_rewrite");
    await assert.rejects(client.query("update feedback.review_event set review_note = 'rewritten'"), /append-only/);
    await client.query("rollback to savepoint before_event_rewrite");
    await client.query("savepoint before_content_rewrite");
    await assert.rejects(client.query("update feedback.submission set original_description = 'rewritten'"), /immutable/);
    await client.query("rollback to savepoint before_content_rewrite");
    await client.query("rollback");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
});
