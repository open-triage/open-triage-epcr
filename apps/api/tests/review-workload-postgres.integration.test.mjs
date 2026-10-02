import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";
import { grantRoleForTesting } from "../../../packages/database/tests/postgres-role-test-helpers.mjs";
import { ReviewService } from "../dist/review/review.service.js";

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
const migration = (name) => readFileSync(new URL(`../../../supabase/migrations/${name}.sql`,
  import.meta.url), "utf8");

integrationTest("workload items and signed report filters retain distinct scoped counting units", async (t) => {
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
  if (!(await client.query("select to_regclass('clinical.review_retrospective_run') relation")).rows[0].relation)
    await client.query(migration("20261002260000_review_retrospective"));
  if (!(await client.query("select to_regclass('clinical.review_amendment_decision') relation")).rows[0].relation)
    await client.query(migration("20261002270000_review_amendment_rereview"));
  if (!(await client.query(`select 1 from information_schema.columns
    where table_schema='clinical' and table_name='review_item' and column_name='exception_code'`)).rowCount)
    await client.query(migration("20261002280000_review_overdue_exceptions"));
  for (const [relation,name] of [
    ["analytics.review_field_source_with_identity", "20261002180000_review_repeated_field_source"],
    ["analytics.review_custom_dictionary", "20261002190000_review_custom_scalar_analytics"],
  ]) if (!(await client.query("select to_regclass($1) relation", [relation])).rows[0].relation)
    await client.query(migration(name));
  if (!(await client.query(`select 1 from information_schema.columns
    where table_schema='analytics' and table_name='review_custom_dictionary' and column_name='grouped'`)).rowCount)
    await client.query(migration("20261002220000_review_custom_grouped_source"));
  if (!(await client.query("select to_regclass('analytics.review_operational_time_source') relation")).rows[0].relation)
    await client.query(migration("20261002230000_review_operational_time_source"));
  await grantRoleForTesting(client, "open_triage_api_runtime");
  const cohort = (await client.query(`select a.report_id,a.reporting_date::text reporting_date,
    a.organization_id,a.synthetic,a.documenting_user_id
    from analytics.review_field_source a join clinical.report r on r.id=a.report_id
    where r.status='signed' and a.field_values ? 'eSituation.11'
    order by a.reporting_date,a.report_id limit 2`)).rows;
  if (cohort.length < 2 || cohort[0].reporting_date !== cohort[1].reporting_date ||
    cohort[0].organization_id !== cohort[1].organization_id ||
    cohort[0].synthetic !== cohort[1].synthetic)
    return t.skip("No two-report projected cohort in the local fixture");
  const [first, second] = cohort;
  const [criterionA, criterionB, criterionC, outcomeId] = Array.from({ length: 4 }, () => randomUUID());
  await client.query(`insert into clinical.review_outcome_option (id,organization_id)
    values ($1,$2)`, [outcomeId, first.organization_id]);
  await client.query(`insert into clinical.review_outcome_revision
    (option_id,organization_id,revision,command_id,actor_id,label,meaning,active)
    values ($1,$2,1,$3,$4,'Historical disposition','A retired operational outcome',false)`,
  [outcomeId,first.organization_id,randomUUID(),first.documenting_user_id]);
  const itemIds = Array.from({ length: 3 }, () => randomUUID());
  await client.query(`insert into clinical.review_item
    (id,organization_id,report_id,criterion_id,priority,status,version,first_matched_at,
      outcome_option_id,outcome_revision)
    values ($1,$2,$3,$4,'high','completed',3,'2026-10-01T09:00:00Z',$5,1)`,
  [itemIds[0],first.organization_id,first.report_id,criterionA,outcomeId]);
  await client.query(`insert into clinical.review_item
    (id,organization_id,report_id,criterion_id,priority,status,version,first_matched_at)
    values ($1,$2,$3,$4,'medium','new',0,'2026-10-01T10:00:00Z')`,
  [itemIds[1],first.organization_id,first.report_id,criterionB]);
  await client.query(`insert into clinical.review_item
    (id,organization_id,report_id,criterion_id,priority,status,version,first_matched_at,
      active_match,closure_reason)
    values ($1,$2,$3,$4,'low','completed',1,'2026-10-01T09:00:00Z',false,
      'criterion-cleared-automatic-policy')`,
  [itemIds[2],first.organization_id,second.report_id,criterionC]);
  for (const [itemId,version,status,reason,time] of [
    [itemIds[0],1,"completed",null,"2026-10-01T11:00:00Z"],
    [itemIds[0],2,"in-review","relevant-amendment","2026-10-02T11:00:00Z"],
    [itemIds[0],3,"completed",null,"2026-10-02T13:00:00Z"],
    [itemIds[2],1,"completed","criterion-cleared-automatic-policy","2026-10-01T12:00:00Z"],
  ]) await client.query(`insert into clinical.review_progress_history
    (organization_id,item_id,command_id,actor_id,item_version,status,reason,
      outcome_option_id,outcome_revision,recorded_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
  [first.organization_id,itemId,randomUUID(),first.documenting_user_id,version,status,reason,
    status === "completed" ? outcomeId : null,status === "completed" ? 1 : null,time]);
  const draftId = randomUUID();
  await client.query(`insert into clinical.report select
    (jsonb_populate_record(null::clinical.report,to_jsonb(source) || $1::jsonb)).*
    from clinical.report source where source.id=$2`,
  [{ id: draftId, status: "draft", revision: 0, reporting_date: null,
    reporting_date_source: null, created_at: "2026-10-01T08:00:00Z",
    updated_at: "2026-10-01T08:00:00Z", dispatch_canceled_at: null,
    dispatch_cancellation_revision: null, dispatch_cancellation_receipt_id: null }, first.report_id]);
  const overdueId = randomUUID();
  await client.query(`insert into clinical.review_item
    (id,organization_id,report_id,criterion_id,kind,priority,status,version,
      first_matched_at,deadline_basis_at,deadline_source,deadline_at,
      resolution_reason,exception_code)
    values ($1,$2,$3,clinical.review_overdue_criterion_id($2),'overdue-unsigned',
      'medium','completed',1,'2026-10-01T12:00:00Z','2026-10-01T08:00:00Z',
      'report-created','2026-10-02T08:00:00Z','closed-exceptionally','report-not-required')`,
  [overdueId,first.organization_id,draftId]);
  await client.query(`insert into clinical.review_overdue_history
    (organization_id,item_id,item_version,action,actor_id,command_id,reason_code,recorded_at)
    values ($1,$2,0,'detected',null,null,null,'2026-10-01T12:00:00Z'),
      ($1,$2,1,'closed-exceptionally',$3,$4,'report-not-required','2026-10-02T10:00:00Z')`,
  [first.organization_id,overdueId,first.documenting_user_id,randomUUID()]);
  await client.query("set local role open_triage_api_runtime");
  let session = { user: { id: first.documenting_user_id }, organization: { id: first.organization_id },
    capabilities: ["review:all", "clinical:demo"] };
  const health = { observed_at: new Date(), oldest_backlog_age_seconds: null,
    persistent_failure_count: 0, retrying_count: 0, stale_run_count: 0,
    last_run_status: "succeeded", is_read_only_replica: false, replay_lag_seconds: null };
  const database = { query: async (sql, params) => sql.includes("projection_health")
    ? [health] : (await client.query(sql, params)).rows };
  const service = new ReviewService({ ...database,
    transaction: async (_isolation, run) => run(database) }, { get: async () => session });
  const dataset = first.synthetic ? "synthetic" : "real";
  const work = await service.workload("unused", { groupBy: "status",
    filters: { from: "2026-10-01", to: "2026-10-02", dataset } });
  assert.equal(work.totalItems, 4);
  assert.deepEqual(work.groups, [{ key: "completed", count: 3 }, { key: "new", count: 1 }]);
  assert.equal(work.reopenedItems, 1);
  assert.equal(work.unsignedItems, 1);
  assert.equal(work.exceptionallyClosedItems, 1);
  const duration = await service.workload("unused", { groupBy: "completion-duration",
    filters: { from: "2026-10-01", to: "2026-10-02", dataset } });
  assert.deepEqual(duration.groups, [
    { key: "1-24 hours", count: 3 }, { key: "not completed", count: 1 }]);
  const analysis = { fieldId: "eSituation.11", operation: "distribution",
    filters: { from: first.reporting_date, to: first.reporting_date, dataset } };
  const base = await service.analysis("unused", analysis);
  assert.equal(base.groups.reduce((sum, group) => sum + group.denominator, 0), 2);
  assert.equal(base.sources.length, 2);
  assert.ok(base.sources.every((source) => source.reportingDate === first.reporting_date));
  const volume = await service.volume("unused", dataset, first.reporting_date, first.reporting_date);
  assert.equal(volume.total, 2);
  assert.equal(volume.sources.length, volume.total);
  const operational = await service.analysis("unused", { fieldId: "review.duration.response",
    operation: "mean", filters: analysis.filters });
  assert.equal(operational.sources.length, 2);
  assert.ok(operational.sources.every((source) => source.operationalTime &&
    source.operationalTime.state));
  assert.equal(work.sources.length, 3, "several review items on one report remain one source row");
  assert.equal(work.sources.find((source) => source.reportId === first.report_id)?.items.length, 2);
  const matching = await service.analysis("unused", { ...analysis,
    filters: { ...analysis.filters, review: { criterionId: criterionA, outcomeOptionId: outcomeId } } });
  assert.equal(matching.population.unit, "patient-report");
  assert.equal(matching.groups.reduce((sum, group) => sum + group.denominator, 0), 1);
  const outcomeOnly = await service.analysis("unused", { ...analysis,
    filters: { ...analysis.filters, review: { outcomeOptionId: outcomeId } } });
  assert.equal(outcomeOnly.groups.reduce((sum, group) => sum + group.denominator, 0), 2);
  const cleared = await service.analysis("unused", { ...analysis,
    filters: { ...analysis.filters, review: { criterionId: criterionC, outcomeOptionId: outcomeId } } });
  assert.deepEqual(cleared.groups, []);
  const choices = await service.analysisReviewFilters("unused", dataset);
  assert.equal(choices.criteria.length, 3);
  assert.deepEqual(choices.outcomes, [{ id: outcomeId, label: "Historical disposition" }]);
  session = { ...session, user: { id: randomUUID() }, capabilities: ["review:self", "clinical:demo"] };
  assert.equal((await service.workload("unused", { groupBy: "status",
    filters: { from: "2026-10-01", to: "2026-10-02", dataset } })).totalItems, 0);
  assert.deepEqual((await service.analysis("unused", { ...analysis,
    filters: { ...analysis.filters, review: { outcomeOptionId: outcomeId } } })).groups, []);
  assert.deepEqual(await service.analysisReviewFilters("unused", dataset), { criteria: [], outcomes: [] });
  session = { ...session, organization: { id: randomUUID() }, capabilities: ["review:all", "clinical:demo"] };
  assert.equal((await service.workload("unused", { groupBy: "status",
    filters: { from: "2026-10-01", to: "2026-10-02", dataset } })).totalItems, 0);
});
