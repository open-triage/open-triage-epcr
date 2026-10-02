import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { ReviewService } from "../dist/review/review.service.js";

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
const migration = (name) => readFileSync(new URL(`../../../supabase/migrations/${name}.sql`, import.meta.url), "utf8");

integrationTest("assigned reviewer completes one item with pinned outcome and replay-safe history", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query("rollback"); await client.end(); });
  await client.query("begin");
  if (!(await client.query("select to_regclass('clinical.review_item') relation")).rows[0].relation)
    await client.query(migration("20261002160000_review_sign_to_queue"));
  if (!(await client.query("select to_regclass('clinical.review_assignment_history') relation")).rows[0].relation)
    await client.query(migration("20261002170000_review_claim_item"));
  if (!(await client.query("select to_regclass('clinical.review_criterion_route') relation")).rows[0].relation)
    await client.query(migration("20261002200000_review_assignment_routing"));
  if (!(await client.query("select to_regclass('clinical.review_outcome_option') relation")).rows[0].relation)
    await client.query(migration("20261002210000_review_completion"));
  if (!(await client.query("select to_regclass('clinical.review_overdue_policy') relation")).rows[0].relation)
    await client.query(migration("20261002250000_review_overdue_drafts"));
  if (!(await client.query("select to_regclass('clinical.review_amendment_decision') relation")).rows[0].relation)
    await client.query(migration("20261002270000_review_amendment_rereview"));
  const candidate = (await client.query(`select r.id,r.organization_id,r.documenting_user_id,r.synthetic
    from clinical.report r join clinical.signed_snapshot s on s.report_id=r.id
    where r.status='signed' limit 1`)).rows[0];
  if (!candidate) return t.skip("No signed report is available in the local database");
  const itemId = randomUUID();
  await client.query(`insert into clinical.review_item
    (id,organization_id,report_id,criterion_id,priority,first_matched_at)
    values ($1,$2,$3,$4,'high',now())`,
  [itemId, candidate.organization_id, candidate.id, randomUUID()]);
  await client.query("set local role open_triage_api_runtime");
  let session = { user: { id: candidate.documenting_user_id },
    organization: { id: candidate.organization_id }, capabilities: ["review:all", "review:admin"] };
  const database = { transaction: async (work) => work({ query: async (sql, params) =>
    (await client.query(sql, params)).rows }), query: async (sql, params) => (await client.query(sql, params)).rows };
  const service = new ReviewService(database, { get: async () => session, assertCsrf: async () => {} });
  const dataset = candidate.synthetic ? "synthetic" : "real";
  const configured = await service.configureOutcome("unused", { commandId: randomUUID(),
    label: "Follow-up", meaning: "Clinical follow-up requested", active: true }, "valid");
  const revised = await service.configureOutcome("unused", { commandId: randomUUID(),
    optionId: configured.id, expectedRevision: 1,
    label: "Clinical follow-up", meaning: "Clinician will review the finding", active: true }, "valid");
  assert.equal(revised.revision, 2);
  const claimed = await service.claim("unused", itemId, { commandId: randomUUID(),
    expectedVersion: 0, dataset }, "valid");
  assert.equal(claimed.version, 1);
  const move = async (status, expectedVersion, outcomeOptionId) => service.progress("unused", itemId,
    { commandId: randomUUID(), expectedVersion, dataset, status, ...(outcomeOptionId ? { outcomeOptionId } : {}) }, "valid");
  assert.equal((await move("in-review", 1)).version, 2);
  assert.equal((await move("awaiting-clinician", 2)).status, "awaiting-clinician");
  assert.equal((await move("in-review", 3)).version, 4);
  const command = { commandId: randomUUID(), expectedVersion: 4, dataset,
    status: "completed", outcomeOptionId: revised.id };
  const completed = await service.progress("unused", itemId, command, "valid");
  assert.equal(completed.outcome?.revision, 2);
  assert.equal(completed.progressHistory.length, 4);
  assert.equal((await service.progress("unused", itemId, command, "valid")).progressHistory.length, 4);
  const alternate = await service.configureOutcome("unused", { commandId: randomUUID(),
    label: "Accepted", meaning: "No further action", active: true }, "valid");
  const changed = await move("completed", 5, alternate.id);
  assert.equal(changed.outcome?.label, "Accepted");
  assert.equal(changed.progressHistory[3].outcome?.label, "Clinical follow-up");
  assert.equal(changed.progressHistory.length, 5);
  await assert.rejects(move("completed", 4, revised.id), { status: 409 });
  session = { ...session, user: { id: randomUUID() } };
  await assert.rejects(move("completed", 6, revised.id), { status: 403 });
  session = { ...session, user: { id: candidate.documenting_user_id } };
  await service.configureOutcome("unused", { commandId: randomUUID(), optionId: revised.id,
    expectedRevision: 2, label: "Retired", meaning: "No longer available", active: false }, "valid");
  assert.equal((await service.item("unused", itemId, dataset)).progressHistory[3].outcome?.label,
    "Clinical follow-up");
  assert.equal((await service.outcomes("unused")).find((option) => option.id === revised.id)?.active, false);
  const historical = await client.query(`select label,meaning from clinical.review_outcome_revision
    where option_id=$1 and revision=2`, [revised.id]);
  assert.equal(historical.rows[0].label, "Clinical follow-up");
  assert.equal((await client.query(`select count(*)::integer n from clinical.review_progress_history
    where item_id=$1`, [itemId])).rows[0].n, 5);
});

integrationTest("independent review rejects the author after configuration changes and permits another reviewer", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query("rollback"); await client.end(); });
  await client.query("begin");
  if (!(await client.query("select to_regclass('clinical.review_item') relation")).rows[0].relation)
    await client.query(migration("20261002160000_review_sign_to_queue"));
  if (!(await client.query("select to_regclass('clinical.review_assignment_history') relation")).rows[0].relation)
    await client.query(migration("20261002170000_review_claim_item"));
  if (!(await client.query("select to_regclass('clinical.review_criterion_route') relation")).rows[0].relation)
    await client.query(migration("20261002200000_review_assignment_routing"));
  if (!(await client.query("select to_regclass('clinical.review_outcome_option') relation")).rows[0].relation)
    await client.query(migration("20261002210000_review_completion"));
  if (!(await client.query("select to_regclass('clinical.review_overdue_policy') relation")).rows[0].relation)
    await client.query(migration("20261002250000_review_overdue_drafts"));
  if (!(await client.query("select to_regclass('clinical.review_amendment_decision') relation")).rows[0].relation)
    await client.query(migration("20261002270000_review_amendment_rereview"));
  const candidate = (await client.query(`select r.id,r.organization_id,r.documenting_user_id,r.synthetic,
    owner.user_id reviewer_id from clinical.report r join clinical.signed_snapshot s on s.report_id=r.id
    join app_identity.installation_owner owner on owner.organization_id=r.organization_id
      and owner.user_id<>r.documenting_user_id
    where r.status='signed' limit 1`)).rows[0];
  if (!candidate) return t.skip("No signed report with a different installation owner is available");
  const criterionId = randomUUID();
  const secondCriterionId = randomUUID();
  const itemId = randomUUID();
  const secondItemId = randomUUID();
  for (const id of [criterionId, secondCriterionId])
    await client.query(`insert into validation.rule_identity (id,organization_id,created_by)
      values ($1,$2,$3)`, [id, candidate.organization_id, candidate.documenting_user_id]);
  await client.query(`insert into clinical.review_criterion_route
    (organization_id,criterion_id,route,independent_review) values ($1,$2,'unassigned',false),
    ($1,$3,'unassigned',true)`, [candidate.organization_id, criterionId, secondCriterionId]);
  await client.query(`insert into clinical.review_item
    (id,organization_id,report_id,criterion_id,priority,first_matched_at,assignee_id,version)
    values ($1,$3,$4,$5,'low',now(),$6,1),($2,$3,$4,$7,'high',now(),null,0)`,
  [itemId, secondItemId, candidate.organization_id, candidate.id, criterionId,
    candidate.documenting_user_id, secondCriterionId]);
  await client.query("set local role open_triage_api_runtime");
  let session = { user: { id: candidate.documenting_user_id },
    organization: { id: candidate.organization_id }, capabilities: ["review:all", "review:admin"] };
  const query = async (sql, params) => (await client.query(sql, params)).rows;
  const service = new ReviewService({ manager: { query }, query,
    transaction: async (level, work) => (typeof level === "function" ? level : work)({ query }) },
  { get: async () => session, assertCsrf: async () => {} });
  const dataset = candidate.synthetic ? "synthetic" : "real";
  const outcome = await service.configureOutcome("unused", { commandId: randomUUID(),
    label: "Reviewed", meaning: "Independent review complete", active: true }, "valid");
  assert.equal((await service.progress("unused", itemId, { commandId: randomUUID(),
    expectedVersion: 1, dataset, status: "in-review" }, "valid")).priority, "low");
  await client.query(`update clinical.review_criterion_route set independent_review=true,version=version+1
    where organization_id=$1 and criterion_id=$2`, [candidate.organization_id, criterionId]);
  await assert.rejects(service.claim("unused", secondItemId, { commandId: randomUUID(),
    expectedVersion: 0, dataset }, "valid"), { status: 403 });
  await assert.rejects(service.progress("unused", itemId, { commandId: randomUUID(),
    expectedVersion: 2, dataset, status: "completed", outcomeOptionId: outcome.id }, "valid"),
  { status: 403 });
  await assert.rejects(service.assign("unused", secondItemId, { commandId: randomUUID(),
    expectedVersion: 0, dataset, assigneeId: candidate.documenting_user_id }, "valid"),
  { status: 400 });
  const reassigned = await service.assign("unused", itemId, { commandId: randomUUID(),
    expectedVersion: 2, dataset, assigneeId: candidate.reviewer_id }, "valid");
  assert.equal(reassigned.assigneeId, candidate.reviewer_id);
  session = { ...session, user: { id: candidate.reviewer_id }, capabilities: ["review:all"] };
  const completed = await service.progress("unused", itemId, { commandId: randomUUID(),
    expectedVersion: 3, dataset, status: "completed", outcomeOptionId: outcome.id }, "valid");
  assert.equal(completed.status, "completed");
  assert.equal(completed.priority, "low");
  assert.equal((await service.claim("unused", secondItemId, { commandId: randomUUID(),
    expectedVersion: 0, dataset }, "valid")).assigneeId, candidate.reviewer_id);
  session = { ...session, user: { id: candidate.documenting_user_id }, capabilities: ["review:self"] };
  assert.equal((await service.report("unused", candidate.id, dataset)).reviewItems
    .find((item) => item.id === itemId)?.status, "completed");
});
