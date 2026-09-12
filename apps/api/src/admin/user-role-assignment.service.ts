import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { AdminRoleSummary, ReplaceAdminUserRolesCommand, UpdatedAdminUserRoles } from "@open-triage/contracts";
import { DataSource } from "typeorm";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";

type TargetRow = {
  id: string; display_name: string; username: string; active: boolean; revision: string | number; owner: boolean;
};
type RoleCapabilityRow = {
  id: string; display_name: string; active: boolean; protected: boolean; assignable: boolean;
  system_key: string | null; capability_key: string | null;
};
type RoleDefinition = AdminRoleSummary & {
  assignable: boolean; systemKey: string | null; capabilities: string[];
};

const OWNER_ONLY_ROLE_KEYS = new Set(["administrator", "demo"]);

@Injectable()
export class UserRoleAssignmentService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ClinicianSessionService
  ) {}

  async replace(token: string, targetUserId: string, command: ReplaceAdminUserRolesCommand,
    now = new Date()): Promise<UpdatedAdminUserRoles> {
    return this.dataSource.transaction(async (manager) => {
      const actor = await this.sessions.requireCapability(token, "roles:assign", manager, now);
      // Serialize Administrator eligibility changes with ownership acceptance.
      await manager.query(`select organization_id from app_identity.installation_owner
        where organization_id = $1 for update`, [actor.organization.id]);
      const targets = await manager.query<TargetRow[]>(`
        select u.id, u.display_name, credential.username, u.active, u.revision,
          exists (select 1 from app_identity.installation_owner owner_record
            where owner_record.organization_id = u.organization_id and owner_record.user_id = u.id) owner
        from app_identity.app_user u
        join app_identity.local_credential credential on credential.user_id = u.id
        where u.organization_id = $1 and u.id = $2
        for update of u
      `, [actor.organization.id, targetUserId]);
      const target = targets[0];
      if (!target) throw new NotFoundException("User was not found");
      if (target.id === actor.user.id) throw new ForbiddenException("Administrators cannot change their own roles");
      if (target.owner) throw new ForbiddenException("The installation owner's roles cannot be changed here");
      if (Number(target.revision) !== command.expectedRevision) {
        throw new ConflictException("This user changed after it was loaded");
      }

      const currentRows = await manager.query<Array<{ role_id: string }>>(`
        select assignment.role_id
        from app_identity.user_role_assignment assignment
        join app_identity.role role on role.organization_id = assignment.organization_id
          and role.id = assignment.role_id and not role.hidden
        where assignment.organization_id = $1 and assignment.user_id = $2 and assignment.ended_at is null
        order by assignment.role_id for update of assignment
      `, [actor.organization.id, target.id]);
      const currentRoleIds = currentRows.map(({ role_id }) => role_id);
      const involvedIds = [...new Set([...currentRoleIds, ...command.roleIds])];
      const rows = involvedIds.length ? await manager.query<RoleCapabilityRow[]>(`
        select role.id, role.display_name, role.active, role.protected, role.assignable, role.system_key,
          definition.capability_key
        from app_identity.role role
        left join app_identity.role_version_capability definition
          on definition.organization_id = role.organization_id and definition.role_id = role.id
          and definition.role_version_id = role.current_version_id
        where role.organization_id = $1 and role.id = any($2::uuid[]) and not role.hidden
        order by role.id, definition.capability_key
        for share of role
      `, [actor.organization.id, involvedIds]) : [];
      const roles = this.roles(rows);
      if (command.roleIds.some((id) => !roles.has(id))) {
        throw new UnprocessableEntityException("Every desired role must belong to this organization and be visible");
      }
      const desired = command.roleIds.map((id) => roles.get(id)!);
      if (desired.some((role) => !role.active || !role.assignable)) {
        throw new UnprocessableEntityException("Every desired role must be active and assignable");
      }

      const additions = command.roleIds.filter((id) => !currentRoleIds.includes(id));
      const removals = currentRoleIds.filter((id) => !command.roleIds.includes(id));
      const changed = [...additions, ...removals].map((id) => roles.get(id)!);
      const ownerRows = await manager.query<Array<{ owner: boolean }>>(`select exists (
        select 1 from app_identity.installation_owner
        where organization_id = $1 and user_id = $2
      ) owner`, [actor.organization.id, actor.user.id]);
      const actorIsOwner = Boolean(ownerRows[0]?.owner);
      if (!actorIsOwner) {
        const actorCapabilities = new Set(actor.capabilities ?? []);
        if (changed.some((role) => role.capabilities.some((capability) => !actorCapabilities.has(capability)))) {
          throw new ForbiddenException("Administrators may add or remove only roles whose capabilities they possess");
        }
      }
      if (changed.some((role) => role.systemKey && OWNER_ONLY_ROLE_KEYS.has(role.systemKey))) {
        if (!actorIsOwner) {
          throw new ForbiddenException("Only the installation owner may assign or remove Administrator or Demo");
        }
        await this.sessions.requireRecentReauthentication(token, manager, now);
      }

      await manager.query(`update app_identity.user_role_assignment
        set ended_at = $4, ended_by = $3, note = coalesce($5, note)
        where organization_id = $1 and user_id = $2 and ended_at is null
          and role_id = any($6::uuid[])`,
      [actor.organization.id, target.id, actor.user.id, now, command.note ?? null, removals]);
      await manager.query(`insert into app_identity.user_role_assignment
        (organization_id, user_id, role_id, assigned_by, note)
        select $1, $2, requested.id, $3, $4 from app_identity.role requested
        where requested.organization_id = $1 and requested.id = any($5::uuid[])`,
      [actor.organization.id, target.id, actor.user.id, command.note ?? null, additions]);
      await manager.query("update app_identity.app_user set revision = revision + 1 where id = $1", [target.id]);
      await manager.query(`insert into app_identity.authentication_event
        (organization_id, actor_id, action, result, target_user_id, note, details)
        values ($1, $2, 'account.roles_change', 'succeeded', $3, $4,
          jsonb_build_object('beforeRoleIds', $5::jsonb, 'afterRoleIds', $6::jsonb,
            'addedRoleIds', $7::jsonb, 'removedRoleIds', $8::jsonb,
            'targetActive', $9::boolean, 'revision', $10::bigint))`,
      [actor.organization.id, actor.user.id, target.id, command.note ?? null,
        JSON.stringify(currentRoleIds), JSON.stringify(command.roleIds), JSON.stringify(additions),
        JSON.stringify(removals), target.active, command.expectedRevision + 1]);

      const summary = (role: RoleDefinition): AdminRoleSummary => ({ id: role.id, displayName: role.displayName,
        active: role.active, protected: role.protected });
      return { id: target.id, displayName: target.display_name, username: target.username,
        active: target.active, revision: command.expectedRevision + 1, roles: desired.map(summary),
        addedRoles: additions.map((id) => summary(roles.get(id)!)),
        removedRoles: removals.map((id) => summary(roles.get(id)!)) };
    });
  }

  private roles(rows: RoleCapabilityRow[]): Map<string, RoleDefinition> {
    const result = new Map<string, RoleDefinition>();
    for (const row of rows) {
      const role = result.get(row.id) ?? { id: row.id, displayName: row.display_name, active: row.active,
        protected: row.protected, assignable: row.assignable, systemKey: row.system_key, capabilities: [] };
      if (row.capability_key) role.capabilities.push(row.capability_key);
      result.set(row.id, role);
    }
    return result;
  }
}
