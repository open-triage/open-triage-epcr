import { randomUUID } from "node:crypto";
import { ConflictException, ForbiddenException, Injectable, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { ProvisionAdminUserCommand, ProvisionedAdminUser } from "@open-triage/contracts";
import { DataSource } from "typeorm";
import { createPasswordVerifier } from "../identity/password.js";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";

type RoleRow = { id: string; system_key: string | null; capability_key: string | null };

@Injectable()
export class UserProvisioningService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ClinicianSessionService
  ) {}

  async provision(token: string, command: ProvisionAdminUserCommand, now = new Date()): Promise<ProvisionedAdminUser> {
    const passwordVerifier = await createPasswordVerifier(command.temporaryPassword);
    const userId = randomUUID();
    const expiresAt = new Date(now.getTime() + command.temporaryPasswordHours * 60 * 60 * 1_000);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const actor = await this.sessions.requireCapability(token, "users:write", manager, now);
        if (command.roleIds.length && !actor.capabilities?.includes("roles:assign")) {
          throw new ForbiddenException("roles:assign is required to provision initial roles");
        }
        const roleRows = command.roleIds.length ? await manager.query<RoleRow[]>(`
          select role.id, role.system_key, definition.capability_key from app_identity.role role
          left join app_identity.role_version_capability definition
            on definition.organization_id = role.organization_id and definition.role_id = role.id
            and definition.role_version_id = role.current_version_id
          where role.organization_id = $1 and role.id = any($2::uuid[])
            and role.active and role.assignable and not role.hidden
          for share of role
        `, [actor.organization.id, command.roleIds]) : [];
        const roles = new Map<string, { systemKey: string | null; capabilities: string[] }>();
        for (const row of roleRows) {
          const role = roles.get(row.id) ?? { systemKey: row.system_key, capabilities: [] };
          if (row.capability_key) role.capabilities.push(row.capability_key);
          roles.set(row.id, role);
        }
        if (roles.size !== command.roleIds.length) {
          throw new UnprocessableEntityException("Every initial role must be active, assignable, and in this organization");
        }
        const ownerRows = await manager.query<Array<{ owner: boolean }>>(`select exists (
          select 1 from app_identity.installation_owner where organization_id = $1 and user_id = $2
        ) owner`, [actor.organization.id, actor.user.id]);
        const actorIsOwner = Boolean(ownerRows[0]?.owner);
        const actorCapabilities = new Set(actor.capabilities ?? []);
        if (!actorIsOwner && [...roles.values()].some((role) =>
          role.capabilities.some((capability) => !actorCapabilities.has(capability)))) {
          throw new ForbiddenException("Administrators may assign only roles whose capabilities they possess");
        }
        if ([...roles.values()].some((role) =>
          role.systemKey === "administrator" || role.systemKey === "demo")) {
          if (!actorIsOwner) throw new ForbiddenException("Only the installation owner may assign Administrator or Demo");
          await this.sessions.requireRecentReauthentication(token, manager, now);
        }
        await manager.query(
          "insert into app_identity.app_user (id, organization_id, display_name) values ($1, $2, $3)",
          [userId, actor.organization.id, command.displayName]
        );
        await manager.query(`insert into app_identity.local_credential
          (user_id, username, password_verifier, must_change_password, temporary_password_expires_at, created_at, updated_at)
          values ($1, $2, $3, true, $4, $5, $5)`,
        [userId, command.username, passwordVerifier, expiresAt, now]);
        if (command.roleIds.length) await manager.query(`insert into app_identity.user_role_assignment
          (organization_id, user_id, role_id, assigned_by, note)
          select $1, $2, role.id, $3, $5 from app_identity.role role
          where role.organization_id = $1 and role.id = any($4::uuid[])`,
        [actor.organization.id, userId, actor.user.id, command.roleIds, command.note ?? null]);
        await manager.query(`insert into app_identity.authentication_event
          (organization_id, actor_id, action, result, target_user_id, note, details)
          values ($1, $2, 'account.provision', 'succeeded', $3, $4,
            jsonb_build_object('roleIds', $5::uuid[], 'temporaryPasswordExpiresAt', $6::timestamptz))`,
        [actor.organization.id, actor.user.id, userId, command.note ?? null, command.roleIds, expiresAt]);
        return { userId, username: command.username, displayName: command.displayName,
          roleIds: command.roleIds, temporaryPasswordExpiresAt: expiresAt.toISOString() };
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        throw new ConflictException("That username is already reserved");
      }
      throw error;
    }
  }
}
