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

integrationTest("controlled overdue clock, retry, cancellation, and signing resolution", async (t) => {
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
  await client.query(migration("20261002250000_review_overdue_drafts"));
  await grantRoleForTesting(client, "open_triage_api_runtime");
  const sample = (await client.query("select * from clinical.report limit 1")).rows[0];
  if (!sample) return t.skip("No local report fixture");
  const criterionId = (await client.query(`select clinical.review_overdue_criterion_id($1) id`,
    [sample.organization_id])).rows[0].id;
  const draft = async (createdAt) => {
    const id = randomUUID();
    await client.query(`insert into clinical.report select
      (jsonb_populate_record(null::clinical.report,to_jsonb(source) || $1::jsonb)).*
      from clinical.report source where source.id=$2`,
    [{ id, status: "draft", revision: 0, reporting_date: null, reporting_date_source: null,
      created_at: createdAt, updated_at: createdAt, dispatch_canceled_at: null,
      dispatch_cancellation_revision: null, dispatch_cancellation_receipt_id: null }, sample.id]);
    return id;
  };
  const manager = { query: async (sql, params) => (await client.query(sql, params)).rows };
  const scan = async (time, reportId) => {
    await client.query("set local role open_triage_api_runtime");
    try { return await discoverOverdueDrafts(manager, 10, new Date(time), reportId); }
    finally { await client.query("reset role"); }
  };
  const first = await draft("2026-10-01T00:00:00Z");
  assert.equal(await scan("2026-10-01T23:59:59.999Z", first), 0);
  await client.query(`update clinical.report set updated_at='2026-10-01T23:50:00Z' where id=$1`, [first]);
  assert.equal(await scan("2026-10-02T00:00:00Z", first), 1);
  assert.equal(await scan("2026-10-03T00:00:00Z", first), 0);
  const [item] = (await client.query(`select id,status,deadline_source,deadline_basis_at,deadline_at
    from clinical.review_item where report_id=$1 and criterion_id=$2`, [first, criterionId])).rows;
  assert.equal(item.deadline_source, "report-created");
  assert.equal(item.deadline_at.toISOString(), "2026-10-02T00:00:00.000Z");
  const identity = (await client.query(`select element_identity_id from catalog.element_definition
    where release_id=$1 and element_id='eTimes.16' limit 1`, [sample.catalog_release_id])).rows[0];
  const identifyingIdentity = (await client.query(`select element_identity_id
    from catalog.element_definition where release_id=$1 and element_id='ePatient.02' limit 1`,
  [sample.catalog_release_id])).rows[0];
  if (identifyingIdentity) await client.query(`insert into clinical.element_occurrence
    (id,report_id,catalog_release_id,element_identity_id,element_id,analytical_repeatable,
     identifying,value_kind,value_text,author_id)
    values ($1,$2,$3,$4,'ePatient.02',false,true,'text',$5,$6)`,
  [randomUUID(),first,sample.catalog_release_id,identifyingIdentity.element_identity_id,
    "Fictional",sample.documenting_user_id]);
  let session = { user: { id: sample.documenting_user_id },
    organization: { id: sample.organization_id }, capabilities: ["review:self"] };
  const database = { query: manager.query,
    transaction: async (isolation, work) => (typeof isolation === "function" ? isolation : work)(manager) };
  const service = new ReviewService(database, { get: async () => session, assertCsrf: async () => {} });
  const dataset = sample.synthetic ? "synthetic" : "real";
  const api = async (work) => {
    await client.query("savepoint overdue_api_call");
    await client.query("set local role open_triage_api_runtime");
    try {
      const result = await work();
      await client.query("reset role");
      await client.query("release savepoint overdue_api_call");
      return result;
    } catch (error) {
      await client.query("rollback to savepoint overdue_api_call");
      await client.query("release savepoint overdue_api_call");
      throw error;
    }
  };
  const visible = await api(() => service.queue("unused", { dataset, criterion: criterionId }));
  assert.ok(visible.items.some((entry) => entry.id === item.id && entry.kind === "overdue-unsigned"));
  const draftRead = await api(() => service.overdueDraft("unused", item.id, dataset));
  assert.equal(draftRead.id, first);
  assert.equal(draftRead.values.length, 0);
  session = { ...session, capabilities: ["review:self", "review:identifying"] };
  if (identifyingIdentity) assert.equal((await api(() => service.overdueDraft("unused", item.id, dataset))).values.length, 1);
  session = { ...session, user: { id: randomUUID() }, capabilities: ["review:self"] };
  await assert.rejects(api(() => service.overdueDraft("unused", item.id, dataset)), { status: 404 });
  session = { ...session, user: { id: sample.documenting_user_id }, capabilities: ["review:self"] };
  await assert.rejects(api(() => service.overdueDraft("unused", item.id,
    dataset === "real" ? "synthetic" : "real")), { status: 404 });
  await assert.rejects(api(() => service.overduePolicy("unused")), { status: 403 });
  session = { ...session, capabilities: ["review:all"] };
  const claimed = await api(() => service.claim("unused", item.id,
    { commandId: randomUUID(), expectedVersion: 0, dataset }, "valid"));
  assert.equal(claimed.assigneeId, sample.documenting_user_id);
  assert.equal(claimed.assignmentHistory.length, 1);
  assert.deepEqual(claimed.overdueHistory?.map((event) => event.action), ["detected"]);
  await client.query(`update clinical.incident set operational_state='canceled'
    where id=(select incident_id from clinical.report where id=$1)`, [first]);
  assert.equal((await client.query(`select status from clinical.review_item where id=$1`, [item.id])).rows[0].status, "new");
  await api(async () => { await client.query(`update clinical.report set status='signed',
    reporting_date='2026-10-02',reporting_date_source='signing-time' where id=$1`, [first]); });
  const resolved = (await client.query(`select status,resolution_reason,version
    from clinical.review_item where id=$1`, [item.id])).rows[0];
  assert.equal(resolved.status, "completed");
  assert.equal(resolved.resolution_reason, "resolved-by-signing");
  assert.deepEqual((await client.query(`select action from clinical.review_overdue_history
    where item_id=$1 order by item_version`, [item.id])).rows.map((row) => row.action),
  ["detected", "resolved-by-signing"]);
  const completed = await draft("2026-10-01T00:00:00Z");
  if (identity) {
    await client.query(`insert into clinical.element_occurrence
      (id,report_id,catalog_release_id,element_identity_id,element_id,analytical_repeatable,
       value_kind,value_datetime,author_id)
      values ($1,$2,$3,$4,'eTimes.16',false,'datetime',$5,$6)`,
    [randomUUID(),completed,sample.catalog_release_id,identity.element_identity_id,
      "2026-10-01T12:00:00Z",sample.documenting_user_id]);
    assert.equal(await scan("2026-10-02T11:59:59Z", completed), 0);
    assert.equal(await scan("2026-10-02T12:00:00Z", completed), 1);
    assert.equal((await client.query(`select deadline_source from clinical.review_item
      where report_id=$1 and criterion_id=$2`, [completed, criterionId])).rows[0].deadline_source,
    "call-completed");
  }
  session = { ...session, capabilities: ["review:all", "review:admin"] };
  assert.deepEqual(await api(() => service.overduePolicy("unused")), { deadlineHours: 24, version: 0 });
  const settingCommand = { commandId: randomUUID(), expectedVersion: 0, deadlineHours: 48 };
  assert.deepEqual(await api(() => service.configureOverduePolicy("unused", settingCommand, "valid")),
    { deadlineHours: 48, version: 1 });
  await assert.rejects(api(() => service.configureRoute("unused", criterionId,
    { commandId: randomUUID(), expectedVersion: 0, route: "author", namedUserId: null,
      independentReview: true }, "valid")), { status: 400 });
  const route = await api(() => service.configureRoute("unused", criterionId,
    { commandId: randomUUID(), expectedVersion: 0, route: "unassigned", namedUserId: null,
      independentReview: true }, "valid"));
  assert.equal(route.independentReview, true);
  assert.deepEqual(await api(() => service.configureOverduePolicy("unused", settingCommand, "valid")),
    { deadlineHours: 48, version: 1 });
  const configured = await draft("2026-10-04T00:00:00Z");
  assert.equal(await scan("2026-10-05T00:00:00Z", configured), 0);
  assert.equal(await scan("2026-10-06T00:00:00Z", configured), 1);
  assert.equal((await client.query(`select count(*)::integer n from clinical.review_item
    where report_id=$1 and criterion_id=$2`, [configured, criterionId])).rows[0].n, 1);
  assert.equal((await client.query(`select assignee_id from clinical.review_item
    where report_id=$1 and criterion_id=$2`, [configured, criterionId])).rows[0].assignee_id,
  null);
});
