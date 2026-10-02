import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { ReviewService } from "../dist/review/review.service.js";
import { reconcileAmendedReview } from "../dist/review/review-amendment.js";
import { eligibleReviewer } from "../dist/review/review-assignment.js";

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
const migration = (name) => readFileSync(new URL(`../../../supabase/migrations/${name}.sql`, import.meta.url), "utf8");

integrationTest("signed amendment decisions preserve conclusions and apply both agency clearance policies", async (t) => {
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
  const candidate = (await client.query(`select r.id,r.organization_id,r.documenting_user_id,
      r.catalog_release_id,r.synthetic,s.id snapshot_id,s.signed_revision,
      s.validation_version_id,owner.user_id reviewer_id
    from clinical.report r join clinical.signed_snapshot s on s.report_id=r.id
    join app_identity.installation_owner owner on owner.organization_id=r.organization_id
      and owner.user_id<>r.documenting_user_id
    where r.status='signed' and s.validation_version_id is not null limit 1`)).rows[0];
  if (!candidate) return t.skip("No signed report with a separate owner and validation version is available");
  const criterionId = randomUUID();
  const outcomeId = randomUUID();
  const query = async (sql, params) => (await client.query(sql, params)).rows;
  const manager = { query };
  if (!await eligibleReviewer(manager, candidate.organization_id,
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
  assert.equal(await eligibleReviewer(manager, candidate.organization_id,
    candidate.documenting_user_id, candidate.documenting_user_id, false), true);
  await client.query(`insert into clinical.review_outcome_option
    (id,organization_id,current_revision) values ($1,$2,1)`, [outcomeId, candidate.organization_id]);
  await client.query(`insert into clinical.review_outcome_revision
    (option_id,organization_id,revision,command_id,actor_id,label,meaning,active)
    values ($1,$2,1,$3,$4,'Reviewed','Original conclusion',true)`,
  [outcomeId, candidate.organization_id, randomUUID(), candidate.reviewer_id]);
  await client.query("set local role open_triage_api_runtime");
  let session = { user: { id: candidate.reviewer_id }, organization: { id: candidate.organization_id },
    capabilities: ["review:all", "review:admin"] };
  const service = new ReviewService({ manager, query,
    transaction: async (level, work) => (typeof level === "function" ? level : work)(manager) },
  { get: async () => session, assertCsrf: async () => {} });
  const bundle = { rules: [{ ruleId: criterionId, enabled: true, executionTargets: ["review"],
    reviewPriority: "high", primaryTarget: { elementId: "eVitals.06" },
    references: { elementIds: ["eVitals.06"], codes: [] } }] };
  const document = (values, other = "unchanged") => ({ groups: [{ id: "eVitalsSection",
    instances: [{ instanceId: "vitals-1", elements: [
      { id: "eVitals.06", values },
      { id: "eOther.01", values: [{ occurrenceId: "other", kind: "scalar", value: other }] },
    ] }] }] });
  const value = (n) => ({ occurrenceId: "pulse-1", kind: "scalar", value: n });
  const finding = { validationVersionId: candidate.validation_version_id, ruleId: criterionId,
    severity: "warning", executionTarget: "review", message: "Review pulse",
    primaryTarget: { elementId: "eVitals.06", groupInstanceId: "vitals-1", occurrenceId: "pulse-1" },
    inputFingerprint: "fnv1a32:12345678" };
  const run = async (sequence, source, matches) => {
    const workId = randomUUID();
    const work = { id: workId, organization_id: candidate.organization_id, report_id: candidate.id,
      documenting_user_id: candidate.documenting_user_id, catalog_release_id: candidate.catalog_release_id,
      amendment_sequence: sequence };
    await client.query(`insert into clinical.review_work
      (id,organization_id,report_id,signed_snapshot_id,amendment_sequence,validation_version_id)
      values ($1,$2,$3,$4,$5,$6)`, [workId,candidate.organization_id,candidate.id,
      candidate.snapshot_id,sequence,candidate.validation_version_id]);
    const evaluationId = randomUUID();
    await client.query(`insert into clinical.review_evaluation
      (id,work_id,attempt,organization_id,report_id,signed_snapshot_id,signed_revision,
       amendment_sequence,validation_version_id,validation_compiled_sha256,evaluated_at,outcome,findings)
      values ($1,$2,1,$3,$4,$5,$6,$7,$8,repeat('a',64),now(),$9,$10::jsonb)`,
    [evaluationId,workId,candidate.organization_id,candidate.id,candidate.snapshot_id,
      candidate.signed_revision,sequence,candidate.validation_version_id,
      matches.length ? "findings" : "passed",JSON.stringify(matches)]);
    await reconcileAmendedReview(manager, work, bundle, source, evaluationId, matches, new Date().toISOString());
    return { workId, evaluationId };
  };
  const first = await run(100, document([value(90)]), [finding]);
  const itemId = (await client.query(`select id from clinical.review_item
    where organization_id=$1 and report_id=$2 and criterion_id=$3`,
  [candidate.organization_id,candidate.id,criterionId])).rows[0].id;
  await client.query(`update clinical.review_item set status='completed',assignee_id=$2,version=3,
    outcome_option_id=$3,outcome_revision=1 where id=$1`, [itemId,candidate.documenting_user_id,outcomeId]);
  await client.query(`insert into clinical.review_progress_history
    (organization_id,item_id,command_id,actor_id,item_version,status,outcome_option_id,outcome_revision)
    values ($1,$2,$3,$4,3,'completed',$5,1)`,
  [candidate.organization_id,itemId,randomUUID(),candidate.documenting_user_id,outcomeId]);
  await run(101, document([value(90)], "unrelated edit"), [finding]);
  assert.deepEqual((await client.query(`select status,version from clinical.review_item where id=$1`,
  [itemId])).rows[0], { status: "completed", version: "3" });
  const changedWork = await run(102, document([value(91)]), [finding]);
  const changedContext = { id: changedWork.workId, organization_id: candidate.organization_id,
    report_id: candidate.id, documenting_user_id: candidate.documenting_user_id,
    catalog_release_id: candidate.catalog_release_id, amendment_sequence: 102 };
  await reconcileAmendedReview(manager, changedContext, bundle, document([value(91)]),
    changedWork.evaluationId, [finding], new Date().toISOString());
  const reopened = (await client.query(`select status,version,assignee_id,outcome_option_id,reopened
    from clinical.review_item where id=$1`, [itemId])).rows[0];
  assert.deepEqual(reopened, { status: "in-review", version: "4",
    assignee_id: candidate.documenting_user_id, outcome_option_id: null, reopened: true });
  assert.equal((await service.item("unused", itemId, candidate.synthetic ? "synthetic" : "real"))
    .progressHistory[0].outcome?.label, "Reviewed");
  // A reviewer who loaded the completed item before the amendment cannot
  // overwrite the worker's newer decision with that stale item version.
  session = { ...session, user: { id: candidate.documenting_user_id }, capabilities: ["review:self"] };
  await assert.rejects(service.progress("unused", itemId, { commandId: randomUUID(),
    expectedVersion: 3, dataset: candidate.synthetic ? "synthetic" : "real",
    status: "completed", outcomeOptionId: outcomeId }, "valid"), { status: 409 });
  session = { ...session, user: { id: candidate.reviewer_id },
    capabilities: ["review:all", "review:admin"] };
  await client.query(`update clinical.review_item set status='completed',version=5,
    outcome_option_id=$2,outcome_revision=1,reopened=false where id=$1`, [itemId,outcomeId]);
  await client.query(`insert into clinical.review_progress_history
    (organization_id,item_id,command_id,actor_id,item_version,status,outcome_option_id,outcome_revision)
    values ($1,$2,$3,$4,5,'completed',$5,1)`,
  [candidate.organization_id,itemId,randomUUID(),candidate.documenting_user_id,outcomeId]);
  await client.query(`update app_identity.app_user set active=false where id=$1`, [candidate.documenting_user_id]);
  await run(103, document([{ occurrenceId: "pulse-1", kind: "null", notValue: { code: "not-known" } }]), []);
  const awaiting = (await client.query(`select status,active_match,clearance_pending,reopened,version,assignee_id
    from clinical.review_item where id=$1`, [itemId])).rows[0];
  assert.deepEqual(awaiting, { status: "in-review", active_match: false,
    clearance_pending: true, reopened: true, version: "6", assignee_id: null });
  assert.equal((await client.query(`select reason from clinical.review_assignment_history
    where item_id=$1 and action='recovered'`, [itemId])).rows[0].reason, "assignee-ineligible");
  await client.query(`update app_identity.app_user set active=true where id=$1`, [candidate.documenting_user_id]);
  await service.assign("unused", itemId, { commandId: randomUUID(), expectedVersion: 6,
    dataset: candidate.synthetic ? "synthetic" : "real", assigneeId: candidate.documenting_user_id }, "valid");
  session = { ...session, user: { id: candidate.documenting_user_id }, capabilities: ["review:self"] };
  const confirmed = await service.progress("unused", itemId, { commandId: randomUUID(),
    expectedVersion: 7, dataset: candidate.synthetic ? "synthetic" : "real",
    status: "completed", outcomeOptionId: outcomeId }, "valid");
  assert.equal(confirmed.closureReason, "criterion-cleared-confirmed");
  assert.equal(confirmed.progressHistory[0].outcome?.meaning, "Original conclusion");
  session = { ...session, user: { id: candidate.reviewer_id }, capabilities: ["review:all", "review:admin"] };
  const policyCommand = { commandId: randomUUID(), expectedVersion: 0, clearance: "automatic" };
  const policy = await service.configureAmendmentPolicy("unused", policyCommand, "valid");
  assert.deepEqual(policy, { clearance: "automatic", version: 1 });
  assert.deepEqual(await service.configureAmendmentPolicy("unused", policyCommand, "valid"), policy);
  await assert.rejects(service.configureAmendmentPolicy("unused", { ...policyCommand,
    commandId: randomUUID() }, "valid"), { status: 409 });
  session = { ...session, capabilities: ["review:all"] };
  await assert.rejects(service.configureAmendmentPolicy("unused", { commandId: randomUUID(),
    expectedVersion: 1, clearance: "confirm" }, "valid"), { status: 403 });
  session = { ...session, capabilities: ["review:all", "review:admin"] };
  await run(104, document([value(95)]), [finding]);
  assert.equal((await client.query(`select status from clinical.review_item where id=$1`,
  [itemId])).rows[0].status, "in-review");
  await run(105, document([]), []);
  await reconcileAmendedReview(manager, changedContext, bundle, document([value(91)]),
    changedWork.evaluationId, [finding], new Date().toISOString());
  const automatic = (await client.query(`select status,active_match,clearance_pending,closure_reason
    from clinical.review_item where id=$1`, [itemId])).rows[0];
  assert.deepEqual(automatic, { status: "completed", active_match: false,
    clearance_pending: false, closure_reason: "criterion-cleared-automatic-policy" });
  const decisions = (await client.query(`select action from clinical.review_amendment_decision
    where item_id=$1 order by amendment_sequence`, [itemId])).rows.map((row) => row.action);
  assert.deepEqual(decisions, ["created", "unchanged", "reopened", "confirmation-required",
    "reopened", "automatic-closure"]);
  assert.equal((await client.query(`select count(*)::int n from clinical.review_progress_history
    where item_id=$1 and reason='relevant-amendment'`, [itemId])).rows[0].n, 2);
  assert.equal((await client.query(`select count(*)::int n from clinical.review_item_evidence
    where item_id=$1`, [itemId])).rows[0].n, 4);
  assert.equal((await client.query(`select count(*)::int n from clinical.review_amendment_policy_history
    where organization_id=$1`, [candidate.organization_id])).rows[0].n, 1);
  assert.equal(first.workId.length, 36);
});
