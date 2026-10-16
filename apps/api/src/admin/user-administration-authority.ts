import { ForbiddenException } from "@nestjs/common";
import type { ClinicianSession } from "@open-triage/contracts";
import type { EntityManager } from "typeorm";

/** Installation administration is independent of patient-review authority.
 * Resolve it live rather than treating restricted review capabilities as a
 * privilege ceiling for the owner or installation superadmins. */
export async function assertUserAdministrationCeiling(manager: EntityManager,
  actor: ClinicianSession, targetUserId: string, message: string): Promise<void> {
  const [authority] = await manager.query<Array<{ allowed: boolean }>>(`
    select (app_identity.is_installation_superadmin($2)
      and app_identity.user_can_access_organization($2, $1)) as allowed`,
  [actor.organization.id, actor.user.id]);
  if (authority?.allowed) return;
  const targetOnly = await manager.query<Array<{ capability_key: string }>>(`
    select distinct capability.capability_key
    from app_identity.user_role_assignment assignment
    join app_identity.role role on role.organization_id = assignment.organization_id
      and role.id = assignment.role_id and role.active and role.assignable
    join app_identity.role_version version on version.organization_id = role.organization_id
      and version.role_id = role.id and version.id = role.current_version_id
    join app_identity.role_version_capability capability on capability.organization_id = version.organization_id
      and capability.role_id = version.role_id and capability.role_version_id = version.id
    join app_identity.capability definition on definition.key = capability.capability_key
    where app_identity.organization_group(assignment.organization_id) = app_identity.organization_group($1) and assignment.user_id = $2 and assignment.ended_at is null
      and definition.administrative
      and not (capability.capability_key = any($3::text[]))
  `, [actor.organization.id, targetUserId, actor.capabilities ?? []]);
  if (targetOnly.length) throw new ForbiddenException(message);
}
