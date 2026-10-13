import { assertRoleAssignmentScope, lockAssignedRoles, readLockedRoleDefinitions } from "./role-assignment-locks.js";
import { localPolicy } from "../authentication/local-policy.js";
import { randomUUID } from "node:crypto";
import { ConflictException, ForbiddenException, Injectable, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { ProvisionAdminUserCommand, ProvisionedAdminUser } from "@open-triage/contracts";
import { DataSource } from "typeorm";
import { createPasswordVerifier } from "../identity/password.js";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { selectedInstallationSettings } from "../config/installation-settings.js";

@Injectable()
export class UserProvisioningService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ClinicianSessionService
  ) {}

  async provision(token: string, command: ProvisionAdminUserCommand, now = new Date()): Promise<ProvisionedAdminUser> {
    const passwordVerifier = await createPasswordVerifier(command.temporaryPassword);
    const userId = randomUUID();
    try {
      return await this.dataSource.transaction(async (manager) => {
        let actor = await this.sessions.requireCapability(token, "users:write", manager, now);
        const originalActor = { user: { id: actor.user.id }, organization: { id: actor.organization.id } };
        const policy = await localPolicy(manager, actor.organization.id);
        const expiresAt = new Date(now.getTime() + (policy?.temporaryPasswordHours ?? selectedInstallationSettings().authentication.temporaryPasswordHours) * 60 * 60 * 1_000);
        if (command.roleIds.length && !actor.capabilities?.includes("roles:assign")) {
          throw new ForbiddenException("roles:assign is required to provision initial roles");
        }
        // Serialize with ownership/assignment changes and keep actor role
        // definitions stable while authoring the desired roles may be in flight.
        await manager.query("select user_id from app_identity.installation_owner for update");
        await lockAssignedRoles(manager, [actor.user.id]);
        const roleRows = (await readLockedRoleDefinitions(manager, actor.organization.id, command.roleIds))
          .filter(role => role.active && role.assignable);
        actor = await this.sessions.requireCapability(token, "users:write", manager, now);
        assertRoleAssignmentScope(originalActor, actor);
        if (command.roleIds.length && !actor.capabilities?.includes("roles:assign")) {
          throw new ForbiddenException("roles:assign is required to provision initial roles");
        }
        const roles = new Map<string, { systemKey: string | null; capabilities: string[] }>();
        for (const row of roleRows) {
          const role = roles.get(row.id) ?? { systemKey: row.system_key, capabilities: [] };
          if (row.capability_key) role.capabilities.push(row.capability_key);
          roles.set(row.id, role);
        }
        if (roles.size !== command.roleIds.length) {
          throw new UnprocessableEntityException("Every initial role must be active, assignable, and in this organization");
        }
        const ownerRows = await manager.query<Array<{ owner: boolean }>>(`select (app_identity.is_installation_superadmin($2) and app_identity.user_can_access_organization($2, $1)) owner`, [actor.organization.id, actor.user.id]);
        const actorIsOwner = Boolean(ownerRows[0]?.owner);
        if ([...roles.values()].some((role) => role.systemKey === "administrator" || role.systemKey === "demo")) {
          if (!actorIsOwner) throw new ForbiddenException("Only the installation owner or a superadmin may assign Administrator or Demo");
        }
        const actorCapabilities = new Set(actor.capabilities ?? []);
        if (!actorIsOwner && [...roles.values()].some((role) =>
          role.capabilities.some((capability) => !actorCapabilities.has(capability)))) {
          throw new ForbiddenException("Administrators may assign only roles whose capabilities they possess");
        }
        await manager.query(
          "insert into app_identity.app_user (id, organization_id, display_name) values ($1, app_identity.organization_group($2), $3)",
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
