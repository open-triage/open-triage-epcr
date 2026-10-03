import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

const integrationTest = process.env.DATABASE_URL ? test : test.skip;

integrationTest("Review role grants and revocation follow the durable assignment lifecycle", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query("rollback"); await client.end(); });
  const organizationId = randomUUID();
  const ownerId = randomUUID();
  const reviewerId = randomUUID();
  await client.query("begin");
  await client.query(`insert into app_identity.organization (id, name, deployment_timezone)
    values ($1, 'Review authorization test', 'UTC')`, [organizationId]);
  await client.query(`insert into app_identity.app_user (id, organization_id, display_name)
    values ($1, $3, 'Owner'), ($2, $3, 'Reviewer')`, [ownerId, reviewerId, organizationId]);
  await client.query(`insert into app_identity.installation_owner
    (organization_id, user_id, established_by_operator_id) values ($1, $2, 'review-access-test')`,
  [organizationId, ownerId]);
  const role = (await client.query(`select id from app_identity.role
    where organization_id = $1 and system_key = 'reviewer'`, [organizationId])).rows[0];
  assert.ok(role);
  await client.query(`insert into app_identity.user_role_assignment
    (organization_id, user_id, role_id, assigned_by, note)
    values ($1, $2, $3, $4, 'Review test')`, [organizationId, reviewerId, role.id, ownerId]);
  const has = async (key) => (await client.query(`select app_identity.user_has_capability($1, $2, $3) allowed`,
    [reviewerId, organizationId, key])).rows[0].allowed;
  assert.equal(await has("review:all"), true);
  assert.equal(await has("review:identifying"), false);
  assert.equal(await has("admin-dashboard:read"), false);
  await client.query(`update app_identity.user_role_assignment set ended_at = now(), ended_by = $3
    where organization_id = $1 and user_id = $2 and role_id = $4`,
  [organizationId, reviewerId, ownerId, role.id]);
  assert.equal(await has("review:all"), false);
});
