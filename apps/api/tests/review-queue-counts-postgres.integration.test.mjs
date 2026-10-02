import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { ReviewService } from "../dist/review/review.service.js";

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
integrationTest("assignment badges match queue item totals for every scoped assignment filter", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query("rollback"); await client.end(); });
  await client.query("begin read only");
  await client.query("set local role open_triage_api_runtime");
  const fixture = (await client.query(`select u.id,u.organization_id
    from app_identity.app_user u join app_identity.local_credential c on c.user_id=u.id
    where c.username='demo' and u.active limit 1`)).rows[0];
  if (!fixture) { t.skip("Requires a local demonstration account"); return; }
  const database = { query: async (sql, params) => (await client.query(sql, params)).rows };
  const service = new ReviewService(database, { get: async () => ({ user: { id: fixture.id },
    organization: { id: fixture.organization_id }, capabilities: ["review:all", "review:identifying", "clinical:demo"] }) });
  const [expected] = await database.query(`select count(*)::integer total,
      count(distinct i.report_id)::integer reports
    from clinical.review_item i join clinical.report r on r.id=i.report_id
    where i.organization_id=$1 and r.organization_id=$1 and r.synthetic
      and ((i.kind='criterion' and r.status='signed') or i.kind='overdue-unsigned')`, [fixture.organization_id]);
  assert.ok(expected.total > expected.reports, "Fixture must include multiple review items on one report");
  for (const assignment of ["all", "mine", "unassigned"]) {
    const result = await service.queue("token", { dataset: "synthetic", assignment, pageSize: "1" });
    assert.equal(result.assignmentCounts[assignment], result.total);
    assert.equal(result.assignmentCounts.all, expected.total);
    assert.equal(result.items.length, Math.min(1, result.total), "Badge counts cover all pages");
  }
});
