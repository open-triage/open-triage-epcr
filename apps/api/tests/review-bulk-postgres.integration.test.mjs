import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { ReviewService } from "../dist/review/review.service.js";
import { eligibleReviewer } from "../dist/review/review-assignment.js";

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
const migration = (name) => readFileSync(new URL(`../../../supabase/migrations/${name}.sql`, import.meta.url), "utf8");

integrationTest("bulk claim and assignment report independent, stale, and scoped results without losing history", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query("rollback"); await client.end(); });
  await client.query("begin");
  for (const [table, file] of [
    ["clinical.review_item", "20261002160000_review_sign_to_queue"],
    ["clinical.review_assignment_history", "20261002170000_review_claim_item"],
    ["clinical.review_criterion_route", "20261002200000_review_assignment_routing"],
    ["clinical.review_outcome_option", "20261002210000_review_completion"],
    ["clinical.review_overdue_policy", "20261002250000_review_overdue_drafts"],
    ["clinical.review_amendment_decision", "20261002270000_review_amendment_rereview"],
  ]) if (!(await client.query("select to_regclass($1) relation", [table])).rows[0].relation)
    await client.query(migration(file));
  if (!(await client.query("select 1 from information_schema.columns where table_schema='clinical' and table_name='review_item' and column_name='exception_code'")).rows[0])
    await client.query(migration("20261002280000_review_overdue_exceptions"));
  if (!(await client.query("select to_regclass('clinical.review_comment') relation")).rows[0].relation)
    await client.query(migration("20261002290000_review_discussion"));
  const candidate = (await client.query(`select r.id,r.organization_id,r.documenting_user_id,r.synthetic,
      owner.user_id reviewer_id from clinical.report r join clinical.signed_snapshot s on s.report_id=r.id
    join app_identity.installation_owner owner on owner.organization_id=r.organization_id
      and owner.user_id<>r.documenting_user_id where r.status='signed' limit 1`)).rows[0];
  if (!candidate) return t.skip("No signed report with a different installation owner is available");
  const initialQuery = async (sql, params) => (await client.query(sql, params)).rows;
  if (!await eligibleReviewer({ query: initialQuery }, candidate.organization_id,
    candidate.documenting_user_id, candidate.documenting_user_id, false)) {
    const role = (await client.query(`select role.id from app_identity.role role
      join app_identity.role_version version on version.id=role.current_version_id
      join app_identity.role_version_capability capability on capability.role_version_id=version.id
      where role.organization_id=$1 and role.active and role.assignable
        and capability.capability_key='review:self' limit 1`, [candidate.organization_id])).rows[0];
    if (!role) return t.skip("No self-review role is available in the report organization");
    await client.query(`insert into app_identity.user_role_assignment
      (organization_id,user_id,role_id,assigned_by) values ($1,$2,$3,$4)
      on conflict do nothing`, [candidate.organization_id,candidate.documenting_user_id,
      role.id,candidate.reviewer_id]);
  }
  const [normal, independent, stale] = [randomUUID(), randomUUID(), randomUUID()];
  const criteria = [randomUUID(), randomUUID(), randomUUID()];
  for (const criterion of criteria) await client.query(`insert into validation.rule_identity
    (id,organization_id,created_by) values ($1,$2,$3)`,
  [criterion,candidate.organization_id,candidate.documenting_user_id]);
  await client.query(`insert into clinical.review_criterion_route
    (organization_id,criterion_id,route,independent_review) values ($1,$2,'unassigned',true)`,
  [candidate.organization_id,criteria[1]]);
  for (const [id, criterion] of [[normal,criteria[0]],[independent,criteria[1]],[stale,criteria[2]]])
    await client.query(`insert into clinical.review_item
      (id,organization_id,report_id,criterion_id,priority,first_matched_at)
      values ($1,$2,$3,$4,'medium',now())`,
    [id,candidate.organization_id,candidate.id,criterion]);
  await client.query("set local role open_triage_api_runtime");
  const query = async (sql, params) => (await client.query(sql, params)).rows;
  let session = { user: { id: candidate.documenting_user_id },
    organization: { id: candidate.organization_id }, capabilities: ["review:all"] };
  const service = new ReviewService({ manager: { query }, query,
    transaction: async (level, work) => (typeof level === "function" ? level : work)({ query }) },
  { get: async () => session, assertCsrf: async () => {} });
  const dataset = candidate.synthetic ? "synthetic" : "real";
  const absent = randomUUID();
  const selections = [normal, independent, stale, absent].map((itemId) =>
    ({ itemId, commandId: randomUUID(), expectedVersion: 0 }));
  await assert.rejects(service.bulkClaim("unused", { dataset,
    selections: [selections[0], selections[0]] }, "valid"), { status: 400 });
  // A second actor has changed one selected item since the queue was loaded.
  await client.query(`update clinical.review_item set assignee_id=$2,version=1 where id=$1`,
    [stale,candidate.reviewer_id]);
  const claimed = await service.bulkClaim("unused", { dataset, selections }, "valid");
  assert.deepEqual(claimed.results.map((result) => [result.itemId,result.status,result.reason]), [
    [normal,"succeeded",undefined], [independent,"failed","ineligible"],
    [stale,"failed","conflict"], [absent,"failed","out-of-scope"],
  ]);
  assert.deepEqual((await service.bulkClaim("unused", { dataset, selections }, "valid")).results
    .map((result) => result.status), ["succeeded","failed","failed","failed"]);
  assert.equal((await client.query(`select count(*)::int n from clinical.review_assignment_history
    where item_id=$1`, [normal])).rows[0].n, 1);
  session = { ...session, capabilities: ["review:self"] };
  await assert.rejects(service.bulkClaim("unused", { dataset, selections }, "valid"), { status: 403 });
  session = { ...session, user: { id: candidate.reviewer_id },
    capabilities: ["review:all","review:admin"] };
  const assignSelections = [normal,independent,stale].map((itemId) =>
    ({ itemId, commandId: randomUUID(), expectedVersion: itemId === normal || itemId === stale ? 1 : 0 }));
  const assigned = await service.bulkAssign("unused", { dataset, assigneeId: candidate.reviewer_id,
    selections: assignSelections }, "valid");
  assert.deepEqual(assigned.results.map((result) => result.status),
    ["succeeded","succeeded","failed"]);
  assert.equal(assigned.results[2].reason, "conflict");
  assert.equal((await service.bulkAssign("unused", { dataset, assigneeId: candidate.reviewer_id,
    selections: assignSelections }, "valid")).results[0].status, "succeeded");
  assert.equal((await client.query(`select count(*)::int n from clinical.review_assignment_history
    where item_id=any($1::uuid[])`, [[normal,independent]])).rows[0].n, 3);
  assert.equal((await client.query(`select assignee_id from clinical.review_item where id=$1`,
    [independent])).rows[0].assignee_id, candidate.reviewer_id);
  const toAuthor = await service.bulkAssign("unused", { dataset,
    assigneeId: candidate.documenting_user_id, selections: [
      { itemId: normal, commandId: randomUUID(), expectedVersion: 2 },
      { itemId: independent, commandId: randomUUID(), expectedVersion: 1 },
    ] }, "valid");
  assert.deepEqual(toAuthor.results.map((result) => [result.status,result.reason]),
    [["succeeded",undefined],["failed","ineligible"]]);
  assert.equal((await client.query(`select assignee_id from clinical.review_item where id=$1`,
    [independent])).rows[0].assignee_id, candidate.reviewer_id);
});
