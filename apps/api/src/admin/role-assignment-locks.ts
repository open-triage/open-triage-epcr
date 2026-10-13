import { ForbiddenException } from "@nestjs/common";
import type { EntityManager } from "typeorm";

export type RoleCapabilityRow = {
  id: string; display_name: string; active: boolean; protected: boolean; assignable: boolean;
  system_key: string | null; capability_key: string | null;
};

/** Role assignments/lifecycle share the owner lock; role authoring locks each role row. */
export async function lockAssignedRoles(manager: EntityManager, userIds: string[]): Promise<void> {
  await manager.query(`select r.id from app_identity.user_role_assignment a
    join app_identity.role r on r.id=a.role_id and r.organization_id=a.organization_id
    where a.user_id=any($1::uuid[]) and a.ended_at is null
    order by r.organization_id,r.id for share of r`, [userIds]);
}

export async function readLockedRoleDefinitions(manager: EntityManager, organizationId: string,
  roleIds: string[]): Promise<RoleCapabilityRow[]> {
  if (!roleIds.length) return [];
  // At READ COMMITTED, joined definition rows can use the statement's earlier
  // snapshot while FOR SHARE waits for authoring. Acquire locks first, then
  // read the definitions in a new statement with a fresh committed snapshot.
  await manager.query(`select role.id from app_identity.role role
    where role.organization_id=$1 and role.id=any($2::uuid[])
    order by role.id for share of role`, [organizationId, roleIds]);
  return manager.query<RoleCapabilityRow[]>(`
    select role.id, role.display_name, role.active, role.protected, role.assignable, role.system_key,
      definition.capability_key
    from app_identity.role role
    left join app_identity.role_version_capability definition
      on definition.organization_id=role.organization_id and definition.role_id=role.id
      and definition.role_version_id=role.current_version_id
    where role.organization_id=$1 and role.id=any($2::uuid[]) and not role.hidden
    order by role.id,definition.capability_key
  `, [organizationId, roleIds]);
}

type AssignmentActor = { user: { id: string }; organization: { id: string } };
export function assertRoleAssignmentScope(original: AssignmentActor, refreshed: AssignmentActor): void {
  if (original.user.id !== refreshed.user.id || original.organization.id !== refreshed.organization.id) {
    throw new ForbiddenException("The user administration context changed during the operation");
  }
}
