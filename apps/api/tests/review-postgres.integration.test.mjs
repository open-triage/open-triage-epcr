import assert from "node:assert/strict";
import test from "node:test";
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
