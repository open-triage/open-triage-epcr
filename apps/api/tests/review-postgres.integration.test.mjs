import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { ReviewService } from "../dist/review/review.service.js";
import { reconcileReviewAssignments } from "../dist/review/review-assignment.js";

const integrationTest = process.env.DATABASE_URL ? test : test.skip;

async function ensureCustomReviewSource(client) {
  if (!(await client.query("select to_regclass('analytics.review_field_source_with_identity') as relation")).rows[0].relation)
    await client.query(readFileSync(new URL("../../../supabase/migrations/20261002180000_review_repeated_field_source.sql", import.meta.url), "utf8"));
  if (!(await client.query("select to_regclass('analytics.review_custom_dictionary') as relation")).rows[0].relation)
    await client.query(readFileSync(new URL("../../../supabase/migrations/20261002190000_review_custom_scalar_analytics.sql", import.meta.url), "utf8"));
  if (!(await client.query(`select 1 from information_schema.columns where table_schema='analytics'
    and table_name='review_custom_dictionary' and column_name='grouped'`)).rows[0])
    await client.query(readFileSync(new URL("../../../supabase/migrations/20261002220000_review_custom_grouped_source.sql", import.meta.url), "utf8"));
}

integrationTest("Review operational time uses offset-aware signed endpoints and scoped denominators", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query("rollback"); await client.end(); });
  await client.query("begin");
  await ensureCustomReviewSource(client);
  if (!(await client.query("select to_regclass('analytics.review_operational_time_source') as relation")).rows[0].relation)
    await client.query(readFileSync(new URL("../../../supabase/migrations/20261002230000_review_operational_time_source.sql", import.meta.url), "utf8"));
  const privileges = (await client.query(`select
    has_table_privilege('open_triage_api_runtime', 'analytics.review_operational_time_source', 'select') api_source,
    has_table_privilege('open_triage_analyst', 'analytics.review_operational_time_source', 'select') analyst_source`)).rows[0];
  assert.deepEqual(privileges, { api_source: true, analyst_source: false });
  await client.query("select analytics_private.ensure_partitions(date '2026-10-01', date '2026-10-03')");
  const organizationId = randomUUID();
  const otherOrganizationId = randomUUID();
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const reportIds = [];
  const fixtures = [
    [organizationId, userId, false, "2026-10-01T12:00:00+02:00", "2026-10-01T10:12:00Z", null],
    [organizationId, userId, false, "2026-10-01T10:00:00Z", "2026-10-01T10:18:00Z", null],
    [organizationId, userId, false, "2026-10-01T10:00:00Z", null, null],
    [organizationId, userId, false, "2026-10-01T10:00:00Z", null, { "eTimes.06": { kind: "null" } }],
    [organizationId, userId, false, "2026-10-01T10:20:00Z", "2026-10-01T10:10:00Z", null],
    [organizationId, otherUserId, false, "2026-10-01T10:00:00Z", "2026-10-01T10:30:00Z", null],
    [otherOrganizationId, userId, false, "2026-10-01T10:00:00Z", "2026-10-01T10:45:00Z", null],
    [organizationId, userId, true, "2026-10-01T10:00:00Z", "2026-10-01T10:50:00Z", null],
  ];
  for (const [index, [organization, user, synthetic, start, end, status]] of fixtures.entries()) {
    const reportId = randomUUID();
    reportIds.push(reportId);
    await client.query(`insert into analytics_private.epcr
      (reporting_date, reporting_date_source, report_id, incident_id, organization_id,
       agency_demographic_version_id, patient_key, patient_key_version, form_version_id,
       form_version, catalog_release_id, catalog_version, signed_snapshot_id,
       signed_snapshot_sha256, signed_at, projector_version, projected_at,
       documenting_user_id, synthetic, etimes_03, etimes_06, etimes_09, etimes_11,
       esituation_11, element_statuses)
      values ('2026-10-01', 'signing-time', $1, $2, $3, $4, $5, 1, $6,
        1, $7, '3.5.1', $8, repeat('a', 64), now(), '1.1.0', now(), $9, $10,
        $11::timestamptz, $12::timestamptz, $13::timestamptz, $14::timestamptz,
        'A', $15::jsonb)`,
    [reportId, randomUUID(), organization, randomUUID(), `time-fixture-${index}`,
      randomUUID(), randomUUID(), randomUUID(), user, synthetic, start, end,
      index < 2 ? "2026-10-01T10:40:00Z" : null,
      index < 2 ? "2026-10-01T11:00:00Z" : null,
      status ? JSON.stringify(status) : null]);
  }
  await client.query("set local role open_triage_api_runtime");
  let session = { capabilities: ["review:self"], user: { id: userId },
    organization: { id: organizationId } };
  const service = new ReviewService({ query: async (sql, params) => sql.includes("projection_health")
    ? [{ observed_at: new Date(), oldest_backlog_age_seconds: null,
      persistent_failure_count: 0, retrying_count: 0, stale_run_count: 0, last_run_status: "succeeded",
      is_read_only_replica: false, replay_lag_seconds: null }]
    : (await client.query(sql, params)).rows }, { get: async () => session });
  const definition = { fieldId: "review.duration.response", operation: "mean",
    filters: { from: "2026-10-01", to: "2026-10-02", dataset: "real" } };
  const own = await service.analysis("unused", definition);
  assert.deepEqual(own.groups.map(({ denominator, missing, absent, invalid, summary }) =>
    ({ denominator, missing, absent, invalid, summary })),
  [{ denominator: 5, missing: 1, absent: 1, invalid: 1, summary: 15 }]);
  const filtered = await service.analysis("unused", { ...definition, groupBy: "eSituation.11",
    filters: { ...definition.filters, field: { id: "eSituation.11", value: "A" } } });
  assert.equal(filtered.groups[0].denominator, 5);
  assert.equal((await service.analysis("unused", { ...definition,
    fieldId: "review.duration.scene" })).groups[0].summary, 25);
  assert.equal((await service.analysis("unused", { ...definition,
    fieldId: "review.duration.transport" })).groups[0].summary, 20);
  session = { ...session, capabilities: ["review:all"] };
  assert.equal((await service.analysis("unused", definition)).groups[0].denominator, 6);
  session = { ...session, organization: { id: otherOrganizationId } };
  assert.equal((await service.analysis("unused", definition)).groups[0].denominator, 1);
  session = { ...session, capabilities: [] };
  await assert.rejects(service.analysis("unused", definition), { status: 403 });
  await client.query("reset role");
  // A signed correction is reflected by the effective projection replacing its
  // endpoint, without changing the stored signing snapshot or old source rows.
  await client.query(`update analytics_private.epcr set etimes_06='2026-10-01T10:24:00Z',
    effective_amendment_sequence=1 where report_id=$1`, [reportIds[0]]);
  await client.query("set local role open_triage_api_runtime");
  session = { ...session, capabilities: ["review:self"], organization: { id: organizationId } };
  assert.equal((await service.analysis("unused", definition)).groups[0].summary, 21);
});

async function ensureReviewWorkflowSchema(client) {
  for (const [table, file] of [
    ["clinical.review_item", "20261002160000_review_sign_to_queue.sql"],
    ["clinical.review_assignment_history", "20261002170000_review_claim_item.sql"],
    ["clinical.review_criterion_route", "20261002200000_review_assignment_routing.sql"],
    ["clinical.review_outcome_option", "20261002210000_review_completion.sql"],
  ]) if (!(await client.query("select to_regclass($1) relation", [table])).rows[0].relation)
    await client.query(readFileSync(new URL(`../../../supabase/migrations/${file}`, import.meta.url), "utf8"));
  if (!(await client.query(`select 1 from information_schema.columns where table_schema='clinical'
    and table_name='review_criterion_route_history' and column_name='independent_review'`)).rows[0])
    await client.query(readFileSync(new URL("../../../supabase/migrations/20261002240000_review_independent_route_history.sql", import.meta.url), "utf8"));
  if (!(await client.query("select to_regclass('clinical.review_overdue_policy') relation")).rows[0].relation)
    await client.query(readFileSync(new URL("../../../supabase/migrations/20261002250000_review_overdue_drafts.sql", import.meta.url), "utf8"));
  if (!(await client.query("select to_regclass('clinical.review_amendment_decision') relation")).rows[0].relation)
    await client.query(readFileSync(new URL("../../../supabase/migrations/20261002270000_review_amendment_rereview.sql", import.meta.url), "utf8"));
}

integrationTest("Review claim stores one versioned assignment and immutable history in PostgreSQL", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query("rollback"); await client.end(); });
  await client.query("begin");
  await ensureReviewWorkflowSchema(client);
  const candidate = (await client.query(`select r.id,r.organization_id,r.documenting_user_id,r.synthetic
    from clinical.report r join clinical.signed_snapshot s on s.report_id=r.id
    where r.status='signed' and exists (select 1 from app_identity.installation_owner owner
      where owner.organization_id=r.organization_id) limit 1`)).rows[0];
  if (!candidate) return t.skip("No signed report is available in the local database");
  const itemId = randomUUID();
  await client.query(`insert into clinical.review_item
    (id,organization_id,report_id,criterion_id,priority,first_matched_at)
    values ($1,$2,$3,$4,'high',now())`,
  [itemId, candidate.organization_id, candidate.id, randomUUID()]);
  await client.query("set local role open_triage_api_runtime");
  let session = { user: { id: candidate.documenting_user_id },
    organization: { id: candidate.organization_id }, capabilities: ["review:all"] };
  const database = { transaction: async (work) => work({ query: async (sql, params) =>
    (await client.query(sql, params)).rows }), query: async (sql, params) => (await client.query(sql, params)).rows };
  const service = new ReviewService(database, { get: async () => session, assertCsrf: async () => {} });
  const command = { commandId: randomUUID(), expectedVersion: 0,
    dataset: candidate.synthetic ? "synthetic" : "real" };
  const claimed = await service.claim("unused", itemId, command, "valid");
  assert.equal(claimed.assigneeId, candidate.documenting_user_id);
  assert.equal(claimed.version, 1);
  assert.equal(claimed.assignmentHistory.length, 1);
  assert.equal((await service.claim("unused", itemId, command, "valid")).assignmentHistory.length, 1);
  assert.equal((await service.queue("unused", { dataset: command.dataset })).items
    .find((item) => item.id === itemId)?.assigneeId, candidate.documenting_user_id);
  await assert.rejects(service.claim("unused", itemId, { ...command, commandId: randomUUID() }, "valid"),
    { status: 409 });
  session = { ...session, capabilities: ["review:self"] };
  await assert.rejects(service.claim("unused", itemId, { ...command, commandId: randomUUID() }, "valid"),
    { status: 403 });
  session = { ...session, capabilities: ["review:all"], organization: { id: randomUUID() } };
  await assert.rejects(service.claim("unused", itemId, { ...command, commandId: randomUUID() }, "valid"),
    { status: 404 });
});

integrationTest("Review administration reassigns eligible users and recovers disabled assignees", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query("rollback"); await client.end(); });
  await client.query("begin");
  await ensureReviewWorkflowSchema(client);
  const candidate = (await client.query(`select r.id,r.organization_id,r.documenting_user_id,r.synthetic
    from clinical.report r join clinical.signed_snapshot s on s.report_id=r.id
    where r.status='signed' and exists (select 1 from app_identity.installation_owner owner
      where owner.organization_id=r.organization_id) limit 1`)).rows[0];
  if (!candidate) return t.skip("No signed report with a configured organization is available");
  const itemId = randomUUID();
  const criterionId = randomUUID();
  await client.query(`insert into validation.rule_identity (id,organization_id,created_by)
    values ($1,$2,$3)`, [criterionId, candidate.organization_id, candidate.documenting_user_id]);
  await client.query(`insert into clinical.review_item
    (id,organization_id,report_id,criterion_id,priority,first_matched_at)
    values ($1,$2,$3,$4,'medium',now())`,
  [itemId, candidate.organization_id, candidate.id, criterionId]);
  await client.query("set local role open_triage_api_runtime");
  const actor = candidate.documenting_user_id;
  const session = { user: { id: actor }, organization: { id: candidate.organization_id },
    capabilities: ["review:all", "review:admin"] };
  const query = async (sql, params) => (await client.query(sql, params)).rows;
  const database = { manager: { query }, query, transaction: async (work) => work({ query }) };
  const service = new ReviewService(database, { get: async () => session, assertCsrf: async () => {} });
  const dataset = candidate.synthetic ? "synthetic" : "real";
  const eligible = await service.reviewers("unused", itemId, dataset);
  const ownerId = (await client.query(`select user_id from app_identity.installation_owner
    where organization_id=$1`, [candidate.organization_id])).rows[0]?.user_id;
  const nonOwner = eligible.find((user) => user.id !== ownerId);
  if (!nonOwner) return t.skip("No eligible non-owner reviewer is available in the local organization");
  const firstReviewer = eligible.find((user) => user.id !== nonOwner.id) ?? nonOwner;
  const first = await service.assign("unused", itemId, { commandId: randomUUID(), expectedVersion: 0,
    dataset, assigneeId: firstReviewer.id }, "valid");
  assert.equal(first.version, 1);
  assert.equal(first.assigneeId, firstReviewer.id);
  assert.equal(first.assignmentHistory[0].action, "assigned");
  await assert.rejects(service.assign("unused", itemId, { commandId: randomUUID(), expectedVersion: 0,
    dataset, assigneeId: null }, "valid"), { status: 409 });
  if (firstReviewer.id !== nonOwner.id) {
    const second = await service.assign("unused", itemId, { commandId: randomUUID(), expectedVersion: 1,
      dataset, assigneeId: nonOwner.id }, "valid");
    assert.equal(second.assigneeId, nonOwner.id);
    assert.equal(second.assignmentHistory.length, 2);
  }
  const latest = await service.item("unused", itemId, dataset);
  await client.query("update app_identity.app_user set active=false where id=$1", [latest.assigneeId]);
  await reconcileReviewAssignments(database);
  const recovered = await service.item("unused", itemId, dataset);
  assert.equal(recovered.assigneeId, null);
  assert.equal(recovered.recoveryReason, "assignee-ineligible");
  assert.equal(recovered.assignmentHistory.at(-1).action, "recovered");
  assert.equal(recovered.assignmentHistory.at(-1).previousAssigneeId, latest.assigneeId);
  await client.query("update app_identity.app_user set active=true where id=$1", [nonOwner.id]);
  const reassigned = await service.assign("unused", itemId, { commandId: randomUUID(),
    expectedVersion: recovered.version, dataset, assigneeId: nonOwner.id }, "valid");
  assert.equal(reassigned.assigneeId, nonOwner.id);
  await client.query(`insert into clinical.review_criterion_route
    (organization_id,criterion_id,route,named_user_id) values ($1,$2,'named',$3)`,
  [candidate.organization_id, criterionId, nonOwner.id]);
  await client.query(`update app_identity.user_role_assignment set ended_at=now(),ended_by=$2
    where user_id=$1 and ended_at is null`, [nonOwner.id, ownerId]);
  await reconcileReviewAssignments(database);
  const roleLoss = await service.item("unused", itemId, dataset);
  assert.equal(roleLoss.assigneeId, null);
  assert.equal(roleLoss.assignmentHistory.at(-1).action, "recovered");
  const routeRecovery = (await client.query(`select route,named_user_id,recovery_reason
    from clinical.review_criterion_route where organization_id=$1 and criterion_id=$2`,
  [candidate.organization_id, criterionId])).rows[0];
  assert.deepEqual(routeRecovery, { route: "unassigned", named_user_id: null,
    recovery_reason: "configured-assignee-ineligible" });
});

integrationTest("Review criterion routing is configured without validation-write authority", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query("rollback"); await client.end(); });
  await client.query("begin");
  await ensureReviewWorkflowSchema(client);
  const criterion = (await client.query(`select v.organization_id,v.created_by,
      (rule.value->>'ruleId')::uuid criterion_id
    from validation.version v cross join lateral jsonb_array_elements(v.compiled_bundle->'rules') rule(value)
    join app_identity.app_user u on u.id=v.created_by and u.active
    where v.status='published' and rule.value->'executionTargets' ? 'review' limit 1`)).rows[0];
  if (!criterion) return t.skip("No published Review criterion is available");
  const owner = (await client.query(`select user_id from app_identity.installation_owner
    where organization_id=$1`, [criterion.organization_id])).rows[0];
  if (!owner) await client.query(`insert into app_identity.installation_owner
    (organization_id,user_id,established_by_operator_id) values ($1,$2,'review-test')`,
  [criterion.organization_id, criterion.created_by]);
  const actorId = owner?.user_id ?? criterion.created_by;
  await client.query("set local role open_triage_api_runtime");
  let session = { user: { id: actorId }, organization: { id: criterion.organization_id },
    capabilities: ["review:all", "review:admin"] };
  const query = async (sql, params) => (await client.query(sql, params)).rows;
  const database = { manager: { query }, query, transaction: async (work) => work({ query }) };
  const service = new ReviewService(database, { get: async () => session, assertCsrf: async () => {} });
  const initial = (await service.routes("unused")).find((route) => route.criterionId === criterion.criterion_id);
  assert.equal(initial?.route, "unassigned");
  session = { ...session, capabilities: ["review:all"] };
  await assert.rejects(service.configureRoute("unused", criterion.criterion_id, { commandId: randomUUID(),
    expectedVersion: 0, route: "named", namedUserId: actorId, independentReview: false }, "valid"), { status: 403 });
  session = { ...session, capabilities: ["review:all", "review:admin"] };
  const command = { commandId: randomUUID(), expectedVersion: 0,
    route: "named", namedUserId: actorId, independentReview: false };
  const named = await service.configureRoute("unused", criterion.criterion_id, command, "valid");
  assert.equal(named.route, "named");
  assert.equal(named.version, 1);
  assert.equal((await service.configureRoute("unused", criterion.criterion_id, command, "valid")).version, 1);
  await assert.rejects(service.configureRoute("unused", criterion.criterion_id,
    { ...command, commandId: randomUUID() }, "valid"), { status: 409 });
  await assert.rejects(service.configureRoute("unused", criterion.criterion_id, {
    commandId: randomUUID(), expectedVersion: 1, route: "author", namedUserId: null,
    independentReview: true }, "valid"), { status: 400 });
  const independent = await service.configureRoute("unused", criterion.criterion_id, {
    commandId: randomUUID(), expectedVersion: 1, route: "named", namedUserId: actorId,
    independentReview: true }, "valid");
  assert.equal(independent.independentReview, true);
  assert.equal(independent.version, 2);
  const history = (await client.query(`select count(*)::integer total,
    array_agg(independent_review order by route_version) independent
    from clinical.review_criterion_route_history
    where organization_id=$1 and criterion_id=$2`,
  [criterion.organization_id, criterion.criterion_id])).rows[0];
  assert.equal(history.total, 2);
  assert.deepEqual(history.independent, [false, true]);
});

integrationTest("Review signed-report list is scoped by current organization, author, and dataset in PostgreSQL", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(() => client.end());
  await client.query("set role open_triage_api_runtime");
  const candidate = (await client.query(`select r.organization_id, r.documenting_user_id, r.synthetic
    from clinical.report r join clinical.signed_snapshot s on s.report_id = r.id
    where r.status = 'signed' limit 1`)).rows[0];
  if (!candidate) return t.skip("No signed report is available in the local database");
  let session = {
    user: { id: candidate.documenting_user_id }, organization: { id: candidate.organization_id },
    capabilities: ["review:self"],
  };
  const service = new ReviewService({ query: async (sql, params) => (await client.query(sql, params)).rows },
    { get: async () => session });
  const dataset = candidate.synthetic ? "synthetic" : "real";
  const own = await service.signedReports("unused", dataset);
  const expectedOwn = (await client.query(`select count(*)::integer total from clinical.report r
    join clinical.signed_snapshot s on s.report_id = r.id
    where r.organization_id = $1 and r.documenting_user_id = $2
      and r.status = 'signed' and r.synthetic = $3`,
  [candidate.organization_id, candidate.documenting_user_id, candidate.synthetic])).rows[0].total;
  assert.equal(own.total, expectedOwn);
  assert.ok(own.reports.every((report) => !Object.hasOwn(report, "documentingClinician")));
  session = { ...session, user: { id: "00000000-0000-4000-8000-000000000000" } };
  assert.equal((await service.signedReports("unused", dataset)).total, 0);
  session = { ...session, organization: { id: "00000000-0000-4000-8000-000000000000" },
    capabilities: ["review:all", "review:identifying"] };
  assert.equal((await service.signedReports("unused", dataset)).total, 0);
});

integrationTest("Review signed detail is server-redacted and directly scoped in PostgreSQL", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query("rollback"); await client.end(); });
  await client.query("begin");
  await ensureReviewWorkflowSchema(client);
  await client.query("set local role open_triage_api_runtime");
  const candidate = (await client.query(`select r.id, r.organization_id, r.documenting_user_id, r.synthetic
    from clinical.report r join clinical.signed_snapshot s on s.report_id = r.id
    where r.status = 'signed' limit 1`)).rows[0];
  if (!candidate) return t.skip("No signed report is available in the local database");
  let session = { user: { id: candidate.documenting_user_id }, organization: { id: candidate.organization_id },
    capabilities: ["review:self"] };
  const manager = { query: async (sql, params) => (await client.query(sql, params)).rows };
  const service = new ReviewService({ transaction: async (level, work) =>
    (typeof level === "function" ? level : work)(manager) }, { get: async () => session });
  const dataset = candidate.synthetic ? "synthetic" : "real";
  const limited = await service.report("unused", candidate.id, dataset);
  assert.equal(limited.id, candidate.id);
  assert.equal(limited.identifying, false);
  assert.deepEqual(limited.notes, []);
  assert.ok(limited.values.every(({ valueKind }) => !["text", "uri", "binary"].includes(valueKind)));
  await assert.rejects(service.media("unused", candidate.id, "00000000-0000-4000-8000-000000000000", "photo", dataset),
    { status: 403 });
  session = { ...session, user: { id: "00000000-0000-4000-8000-000000000000" } };
  await assert.rejects(service.report("unused", candidate.id, dataset), { status: 404 });
  session = { ...session, user: { id: candidate.documenting_user_id }, capabilities: [] };
  await assert.rejects(service.report("unused", candidate.id, dataset), { status: 403 });
});

integrationTest("Review volume counts patient reports separately within incidents and respects all analytical scopes", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query("rollback"); await client.end(); });
  await client.query("begin");
  await client.query("select analytics_private.ensure_partitions(date '2026-10-01', date '2026-10-03')");
  const privileges = (await client.query(`select
    has_table_privilege('open_triage_api_runtime', 'analytics.review_volume_source', 'select') as api_source,
    has_table_privilege('open_triage_analyst', 'analytics.review_volume_source', 'select') as analyst_source,
    has_table_privilege('open_triage_api_runtime', 'analytics_private.epcr', 'select') as api_private`)).rows[0];
  assert.deepEqual(privileges, { api_source: true, analyst_source: false, api_private: false });
  const organizationId = randomUUID();
  const otherOrganizationId = randomUUID();
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const incidentId = randomUUID();
  for (const [index, organization, user, synthetic] of [
    [0, organizationId, userId, false], [1, organizationId, userId, false],
    [2, organizationId, otherUserId, false], [3, organizationId, userId, true],
    [4, otherOrganizationId, userId, false],
  ]) {
    await client.query(`insert into analytics_private.epcr
      (reporting_date, reporting_date_source, report_id, incident_id, organization_id,
       agency_demographic_version_id, patient_key, patient_key_version, form_version_id,
       form_version, catalog_release_id, catalog_version, signed_snapshot_id,
       signed_snapshot_sha256, signed_at, projector_version, projected_at,
       documenting_user_id, synthetic)
      values ('2026-10-01', 'signing-time', $1, $2, $3, $4, $5, 1, $6,
        1, $7, '3.5.1', $8, repeat('a', 64), now(), '1.1.0', now(), $9, $10)`,
    [randomUUID(), incidentId, organization, randomUUID(), `fixture-${index}`,
      randomUUID(), randomUUID(), randomUUID(), user, synthetic]);
  }
  await client.query("set local role open_triage_api_runtime");
  let session = { capabilities: ["review:self"], user: { id: userId },
    organization: { id: organizationId } };
  const service = new ReviewService({ query: async (sql, params) => sql.includes("projection_health")
    ? [{ observed_at: new Date(), oldest_backlog_age_seconds: null,
      persistent_failure_count: 0, retrying_count: 0, stale_run_count: 0, last_run_status: "succeeded",
      is_read_only_replica: false, replay_lag_seconds: null }]
    : (await client.query(sql, params)).rows }, { get: async () => session });
  const volume = (dataset = "real") => service.volume("unused", dataset, "2026-10-01", "2026-10-02");
  assert.deepEqual((await volume()).points.map((point) => point.count), [2, 0]);
  assert.equal((await volume("synthetic")).total, 1);
  session = { ...session, capabilities: ["review:all"] };
  assert.equal((await volume()).total, 3);
  session = { ...session, organization: { id: otherOrganizationId } };
  assert.equal((await volume()).total, 1);
});

integrationTest("Review basic analysis uses the scoped effective projection, preserves absence, and never mixes units", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query("rollback"); await client.end(); });
  await client.query("begin");
  await ensureCustomReviewSource(client);
  await client.query("select analytics_private.ensure_partitions(date '2026-10-01', date '2026-10-03')");
  const privileges = (await client.query(`select
    has_table_privilege('open_triage_api_runtime', 'analytics.review_field_source', 'select') api_source,
    has_table_privilege('open_triage_analyst', 'analytics.review_field_source', 'select') analyst_source`)).rows[0];
  assert.deepEqual(privileges, { api_source: true, analyst_source: false });
  const organizationId = randomUUID();
  const otherOrganizationId = randomUUID();
  const userId = randomUUID();
  const otherUserId = randomUUID();
  for (const [index, org, user, synthetic, impression, weight, status] of [
    [0, organizationId, userId, false, "A", 70, null],
    [1, organizationId, userId, false, "A", 80, null],
    [2, organizationId, userId, false, "B", null, { "eExam.01": { kind: "null", code: "not-known" } }],
    [3, organizationId, otherUserId, false, "B", 90, null],
    [4, otherOrganizationId, userId, false, "A", 100, null],
    [5, organizationId, userId, true, "A", 120, null],
  ]) await client.query(`insert into analytics_private.epcr
    (reporting_date, reporting_date_source, report_id, incident_id, organization_id,
     agency_demographic_version_id, patient_key, patient_key_version, form_version_id,
     form_version, catalog_release_id, catalog_version, signed_snapshot_id,
     signed_snapshot_sha256, signed_at, projector_version, projected_at,
     documenting_user_id, synthetic, esituation_11, eexam_01, element_statuses)
    values ('2026-10-01', 'signing-time', $1, $2, $3, $4, $5, 1, $6,
      1, $7, '3.5.1', $8, repeat('a', 64), now(), '1.1.0', now(), $9, $10,
      $11, $12, $13::jsonb)`, [randomUUID(), randomUUID(), org, randomUUID(),
    `analysis-fixture-${index}`, randomUUID(), randomUUID(), randomUUID(), user,
    synthetic, impression, weight, status ? JSON.stringify(status) : null]);
  await client.query("set local role open_triage_api_runtime");
  let session = { capabilities: ["review:self"], user: { id: userId },
    organization: { id: organizationId } };
  const service = new ReviewService({ query: async (sql, params) => sql.includes("projection_health")
    ? [{ observed_at: new Date(), oldest_backlog_age_seconds: null,
      persistent_failure_count: 0, retrying_count: 0, stale_run_count: 0, last_run_status: "succeeded",
      is_read_only_replica: false, replay_lag_seconds: null }]
    : (await client.query(sql, params)).rows }, { get: async () => session });
  const filters = { from: "2026-10-01", to: "2026-10-02", dataset: "real" };
  const distribution = await service.analysis("unused", { fieldId: "eSituation.11",
    operation: "distribution", filters });
  assert.deepEqual(distribution.groups[0].values.map(({ value, count }) => [value, count]),
    [["A", 2], ["B", 1]]);
  const summary = await service.analysis("unused", { fieldId: "eExam.01", operation: "mean", filters });
  assert.equal(summary.field.unit, "kg");
  assert.equal(summary.groups[0].summary, 75);
  assert.equal(summary.groups[0].absent, 1);
  const grouped = await service.analysis("unused", { fieldId: "eExam.01", operation: "median",
    groupBy: "eSituation.11", filters });
  assert.deepEqual(grouped.groups.map(({ group, summary, absent }) => [group, summary, absent]),
    [["A", 75, 0], ["B", null, 1]]);
  const filtered = await service.analysis("unused", { fieldId: "eSituation.11",
    operation: "distribution", filters: { ...filters, field: { id: "eSituation.11", value: "B" } } });
  assert.equal(filtered.groups[0].denominator, 1);
  assert.deepEqual(filtered.groups[0].values.map(({ value, count }) => [value, count]), [["B", 1]]);
  assert.equal((await service.analysis("unused", { fieldId: "eSituation.11",
    operation: "distribution", filters: { ...filters, dataset: "synthetic" } })).groups[0].denominator, 1);
  session = { ...session, capabilities: ["review:all"] };
  assert.equal((await service.analysis("unused", { fieldId: "eExam.01", operation: "minimum", filters }))
    .groups[0].denominator, 4);
  session = { ...session, organization: { id: otherOrganizationId } };
  assert.equal((await service.analysis("unused", { fieldId: "eExam.01", operation: "maximum", filters }))
    .groups[0].summary, 100);
});
