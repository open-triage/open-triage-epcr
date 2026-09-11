import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { AdminRoleSummary, UpdatedAdminUser, UpdateAdminUserCommand } from "@open-triage/contracts";
import { DataSource } from "typeorm";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";

type TargetRow = {
  id: string; display_name: string; username: string; active: boolean; revision: string | number; owner: boolean;
};
type RoleRow = { id: string; display_name: string; active: boolean; protected: boolean; assignable: boolean };

@Injectable()
export class UserLifecycleService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ClinicianSessionService
  ) {}

  async update(token: string, targetUserId: string, command: UpdateAdminUserCommand,
    now = new Date()): Promise<UpdatedAdminUser> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const actor = await this.sessions.requireCapability(token, "users:write", manager, now);
        const targets = await manager.query<TargetRow[]>(`
          select u.id, u.display_name, credential.username, u.active, u.revision,
            exists (select 1 from app_identity.installation_owner owner_record
              where owner_record.organization_id = u.organization_id and owner_record.user_id = u.id) as owner
          from app_identity.app_user u
          join app_identity.local_credential credential on credential.user_id = u.id
          where u.organization_id = $1 and u.id = $2
          for update of u, credential
        `, [actor.organization.id, targetUserId]);
        const target = targets[0];
        if (!target) throw new NotFoundException("User was not found");
        if (target.id === actor.user.id) throw new ForbiddenException("Administrators cannot change their own account");
        if (target.owner) throw new ForbiddenException("The installation owner cannot be changed here");
        if (Number(target.revision) !== command.expectedRevision) {
          throw new ConflictException("This user changed after it was loaded");
        }

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
          where assignment.organization_id = $1 and assignment.user_id = $2 and assignment.ended_at is null
            and definition.administrative
            and not (capability.capability_key = any($3::text[]))
        `, [actor.organization.id, target.id, actor.capabilities ?? []]);
        if (targetOnly.length) throw new ForbiddenException("A more-capable user cannot be changed by this administrator");

        const currentRoleRows = await manager.query<Array<{ role_id: string }>>(`
          select assignment.role_id from app_identity.user_role_assignment assignment
          join app_identity.role role on role.organization_id = assignment.organization_id
            and role.id = assignment.role_id and not role.hidden
          where assignment.organization_id = $1 and assignment.user_id = $2 and assignment.ended_at is null
          order by assignment.role_id for update of assignment
        `, [actor.organization.id, target.id]);
        const currentRoleIds = currentRoleRows.map(({ role_id }) => role_id);
        const roleSetChanged = currentRoleIds.length !== command.roleIds.length ||
          currentRoleIds.some((id) => !command.roleIds.includes(id));
        if (roleSetChanged && !actor.capabilities?.includes("roles:assign")) {
          throw new ForbiddenException("roles:assign is required to change retained roles");
        }

        const roles = command.roleIds.length ? await manager.query<RoleRow[]>(`
          select id, display_name, active, protected, assignable from app_identity.role
          where organization_id = $1 and id = any($2::uuid[]) and not hidden
          for share
        `, [actor.organization.id, command.roleIds]) : [];
        if (roles.length !== command.roleIds.length) {
          throw new UnprocessableEntityException("Every retained role must belong to this organization and be visible");
        }
        const additions = roles.filter((role) => !currentRoleIds.includes(role.id));
        if (additions.some((role) => !role.active || !role.assignable)) {
          throw new UnprocessableEntityException("New role assignments must be active and assignable");
        }

        const before = { username: target.username, displayName: target.display_name, active: target.active,
          roleIds: currentRoleIds, revision: Number(target.revision) };
        await manager.query(`update app_identity.local_credential set username = $2
          where user_id = $1 and username <> $2`, [target.id, command.username]);
        await manager.query(`update app_identity.app_user set display_name = $2, active = $3,
          deactivated_at = case when $3 then null else coalesce(deactivated_at, $4) end,
          revision = revision + 1 where id = $1`, [target.id, command.displayName, command.active, now]);

        if (roleSetChanged) {
          await manager.query(`update app_identity.user_role_assignment
            set ended_at = $4, ended_by = $3, note = coalesce($5, note)
            where organization_id = $1 and user_id = $2 and ended_at is null
              and not (role_id = any($6::uuid[]))
              and exists (select 1 from app_identity.role visible_role
                where visible_role.organization_id = user_role_assignment.organization_id
                  and visible_role.id = user_role_assignment.role_id and not visible_role.hidden)`,
          [actor.organization.id, target.id, actor.user.id, now, command.note ?? null, command.roleIds]);
          await manager.query(`insert into app_identity.user_role_assignment
            (organization_id, user_id, role_id, assigned_by, note)
            select $1, $2, requested.id, $3, $4 from app_identity.role requested
            where requested.organization_id = $1 and requested.id = any($5::uuid[])
              and not exists (select 1 from app_identity.user_role_assignment existing
                where existing.user_id = $2 and existing.role_id = requested.id and existing.ended_at is null)`,
          [actor.organization.id, target.id, actor.user.id, command.note ?? null, command.roleIds]);
        }

        let sessionsRevoked = 0;
        if (target.active && !command.active) {
          const revoked = await manager.query<Array<{ id: string }>>(`update app_identity.app_session
            set revoked_at = $2, revocation_reason = 'account_disabled'
            where user_id = $1 and revoked_at is null returning id`, [target.id, now]);
          sessionsRevoked = revoked.length;
        }
        const action = target.active && !command.active ? "account.disable"
          : !target.active && command.active ? "account.reactivate"
            : roleSetChanged && target.username === command.username && target.display_name === command.displayName
              ? "account.roles_change" : "account.identity_change";
        const after = { username: command.username, displayName: command.displayName, active: command.active,
          roleIds: command.roleIds, revision: command.expectedRevision + 1 };
        await manager.query(`insert into app_identity.authentication_event
          (organization_id, actor_id, action, result, target_user_id, note, details)
          values ($1, $2, $3, 'succeeded', $4, $5,
            jsonb_build_object('before', $6::jsonb, 'after', $7::jsonb, 'sessionsRevoked', $8::integer))`,
        [actor.organization.id, actor.user.id, action, target.id, command.note ?? null,
          JSON.stringify(before), JSON.stringify(after), sessionsRevoked]);

        const roleById = new Map(roles.map((role) => [role.id, role]));
        const retainedRoles = command.roleIds.map((id): AdminRoleSummary => {
          const role = roleById.get(id)!;
          return { id: role.id, displayName: role.display_name, active: role.active, protected: role.protected };
        });
        const reactivated = !target.active && command.active;
        return { id: target.id, username: command.username, displayName: command.displayName,
          active: command.active, revision: command.expectedRevision + 1, roles: retainedRoles,
          restoredRoles: reactivated ? retainedRoles : [], sessionsRevoked,
          freshLoginRequired: reactivated || (target.active && !command.active) };
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        throw new ConflictException("That username is already reserved");
      }
      throw error;
    }
  }
}
