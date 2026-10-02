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
