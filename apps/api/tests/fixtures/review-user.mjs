import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Call inside the fixture's rollback-only transaction, before SET ROLE.
export async function createAgencyReviewer(client, organizationId, actorId) {
  const role = (await client.query(`select role.id from app_identity.role role
    join app_identity.role_version_capability capability on capability.role_version_id=role.current_version_id
    where role.organization_id=$1 and role.active and capability.capability_key='review:all'
    order by role.id limit 1`, [organizationId])).rows[0];
  assert.ok(role, "The fixture agency must have an organization-wide Review role");
  const userId = randomUUID();
  await client.query(`insert into app_identity.app_user(id,organization_id,display_name)
    values($1,$2,'Fictional agency reviewer')`, [userId, organizationId]);
  await client.query(`insert into app_identity.user_role_assignment(organization_id,user_id,role_id,assigned_by)
    values($1,$2,$3,$4)`, [organizationId, userId, role.id, actorId]);
  return userId;
}
