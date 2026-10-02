import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";
import { grantRoleForTesting } from "../../../packages/database/tests/postgres-role-test-helpers.mjs";
import { discoverOverdueDrafts } from "../dist/review/review-overdue.js";
import { ReviewService } from "../dist/review/review.service.js";

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
const migration = (name) => readFileSync(new URL(`../../../supabase/migrations/${name}.sql`,
  import.meta.url), "utf8");

integrationTest("overdue exception requires admin and coded reason, survives replay and later signing", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query("rollback"); await client.end(); });
  await client.query("begin");
  for (const [relation,name] of [
    ["clinical.review_item","20261002160000_review_sign_to_queue"],
    ["clinical.review_assignment_history","20261002170000_review_claim_item"],
    ["clinical.review_criterion_route","20261002200000_review_assignment_routing"],
    ["clinical.review_outcome_option","20261002210000_review_completion"],
  ]) if (!(await client.query("select to_regclass($1) relation", [relation])).rows[0].relation)
    await client.query(migration(name));
  if (!(await client.query(`select 1 from information_schema.columns
    where table_schema='clinical' and table_name='review_criterion_route_history'
      and column_name='independent_review'`)).rowCount)
    await client.query(migration("20261002240000_review_independent_route_history"));
  if (!(await client.query("select to_regclass('clinical.review_overdue_history') relation")).rows[0].relation)
    await client.query(migration("20261002250000_review_overdue_drafts"));
  if (!(await client.query(`select 1 from information_schema.columns
    where table_schema='clinical' and table_name='review_item' and column_name='active_match'`)).rowCount)
    await client.query(migration("20261002270000_review_amendment_rereview"));
  await client.query(migration("20261002280000_review_overdue_exceptions"));
  await grantRoleForTesting(client, "open_triage_api_runtime");
  const sample = (await client.query("select * from clinical.report limit 1")).rows[0];
  if (!sample) return t.skip("No local report fixture");
  const reportId = randomUUID();
  await client.query(`insert into clinical.report select
    (jsonb_populate_record(null::clinical.report,to_jsonb(source) || $1::jsonb)).*
    from clinical.report source where source.id=$2`,
  [{ id: reportId, status: "draft", revision: 0, reporting_date: null,
    reporting_date_source: null, created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z", dispatch_canceled_at: null,
    dispatch_cancellation_revision: null, dispatch_cancellation_receipt_id: null }, sample.id]);
  const manager = { query: async (sql, params) => (await client.query(sql, params)).rows };
  const apiRole = async (work) => {
    await client.query("savepoint overdue_exception_api");
    await client.query("set local role open_triage_api_runtime");
    try {
      const result = await work();
      await client.query("reset role");
      await client.query("release savepoint overdue_exception_api");
      return result;
    } catch (error) {
      await client.query("rollback to savepoint overdue_exception_api");
      await client.query("release savepoint overdue_exception_api");
      throw error;
    }
  };
  assert.equal(await apiRole(() => discoverOverdueDrafts(manager, 10,
    new Date("2026-10-02T00:00:00Z"), reportId)), 1);
  const item = (await client.query(`select id,version from clinical.review_item where report_id=$1`, [reportId])).rows[0];
  const dataset = sample.synthetic ? "synthetic" : "real";
  let session = { user: { id: sample.documenting_user_id }, organization: { id: sample.organization_id },
    capabilities: ["review:all"] };
  const database = { query: manager.query,
    transaction: async (work) => work(manager) };
  const service = new ReviewService(database, { get: async () => session, assertCsrf: async () => {} });
  const command = { commandId: randomUUID(), expectedVersion: Number(item.version), dataset,
    reasonCode: "report-not-required" };
  await assert.rejects(apiRole(() => service.closeOverdueException("unused", item.id, command, "valid")),
    { status: 403 });
  session = { ...session, capabilities: ["review:all", "review:admin"] };
  await assert.rejects(apiRole(() => service.closeOverdueException("unused", item.id,
    { ...command, reasonCode: "" }, "valid")), { status: 400 });
  session = { ...session, organization: { id: randomUUID() } };
  await assert.rejects(apiRole(() => service.closeOverdueException("unused", item.id, command, "valid")),
    { status: 404 });
  session = { ...session, organization: { id: sample.organization_id } };
  const closed = await apiRole(() => service.closeOverdueException("unused", item.id, command, "valid"));
  assert.equal(closed.status, "completed");
  assert.equal(closed.resolutionReason, "closed-exceptionally");
  assert.equal(closed.exceptionCode, "report-not-required");
  assert.deepEqual(closed.overdueHistory?.map((event) => event.action), ["detected", "closed-exceptionally"]);
  assert.equal(closed.overdueHistory?.at(-1)?.actorId, sample.documenting_user_id);
  assert.equal(closed.overdueHistory?.at(-1)?.reasonCode, "report-not-required");
  session = { ...session, capabilities: ["review:all"] };
  const scopedRead = await apiRole(() => service.item("unused", item.id, dataset));
  assert.equal(scopedRead.exceptionCode, "report-not-required");
  assert.equal(scopedRead.overdueHistory?.at(-1)?.actorId, sample.documenting_user_id);
  session = { ...session, capabilities: ["review:all", "review:admin"] };
  assert.equal((await client.query("select status from clinical.report where id=$1", [reportId])).rows[0].status, "draft");
  assert.equal(await apiRole(() => discoverOverdueDrafts(manager, 10,
    new Date("2026-10-03T00:00:00Z"), reportId)), 0);
  assert.equal((await client.query("select count(*)::integer n from clinical.review_item where report_id=$1",
    [reportId])).rows[0].n, 1);
  assert.equal((await apiRole(() => service.closeOverdueException("unused", item.id, command, "valid"))).version,
    closed.version);
  await assert.rejects(apiRole(() => service.closeOverdueException("unused", item.id,
    { ...command, commandId: randomUUID() }, "valid")), { status: 409 });
  await assert.rejects(apiRole(() => service.closeOverdueException("unused", item.id,
    { ...command, reasonCode: "duplicate-follow-up" }, "valid")), { status: 409 });
  await apiRole(() => client.query(`update clinical.report set status='signed',
    reporting_date='2026-10-03',reporting_date_source='signing-time' where id=$1`, [reportId]));
  const signed = await apiRole(() => service.item("unused", item.id, dataset));
  assert.equal(signed.resolutionReason, "closed-exceptionally");
  assert.equal(signed.exceptionCode, "report-not-required");
  assert.deepEqual(signed.overdueHistory?.map((event) => event.action),
    ["detected", "closed-exceptionally", "signed-after-exception"]);
  assert.equal((await apiRole(() => service.closeOverdueException("unused", item.id, command, "valid")))
    .resolutionReason, "closed-exceptionally");
  assert.equal((await client.query(`select count(*)::integer n from clinical.review_overdue_history
    where item_id=$1 and action='closed-exceptionally'`, [item.id])).rows[0].n, 1);
});
