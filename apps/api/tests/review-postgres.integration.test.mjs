import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { ReviewService } from "../dist/review/review.service.js";

const integrationTest = process.env.DATABASE_URL ? test : test.skip;

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
  t.after(() => client.end());
  await client.query("set role open_triage_api_runtime");
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
