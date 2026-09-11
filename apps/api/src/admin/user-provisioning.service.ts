import { randomUUID } from "node:crypto";
import { ConflictException, ForbiddenException, Injectable, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { ProvisionAdminUserCommand, ProvisionedAdminUser } from "@open-triage/contracts";
import { DataSource } from "typeorm";
import { createPasswordVerifier } from "../identity/password.js";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";

type RoleRow = { id: string };

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
        const roles = command.roleIds.length ? await manager.query<RoleRow[]>(`
          select id from app_identity.role
          where organization_id = $1 and id = any($2::uuid[])
            and active and assignable and not hidden
          for share
        `, [actor.organization.id, command.roleIds]) : [];
        if (roles.length !== command.roleIds.length) {
          throw new UnprocessableEntityException("Every initial role must be active, assignable, and in this organization");
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
