import { createHash } from "node:crypto";
import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { AdminSessionList, ResetAdminCredentialCommand, ResetAdminCredentialResult,
  RevokedAdminSession, RevokeAdminSessionCommand } from "@open-triage/contracts";
import { DataSource } from "typeorm";
import { createPasswordVerifier } from "../identity/password.js";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { selectedInstallationSettings } from "../config/installation-settings.js";
import { mutationRows } from "../database/mutation-result.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const iso = (value: Date | string) => new Date(value).toISOString();

type SessionRow = {
  id: string; created_at: Date | string; last_activity_at: Date | string; expires_at: Date | string;
  device_label: string; current: boolean; owner: boolean;
};
type RevocationTarget = { id: string; revoked_at: Date | string | null; current: boolean; owner: boolean };
type ResetTarget = {
  id: string; active: boolean; revision: string | number; owner: boolean; actor_owner: boolean;
};

@Injectable()
export class SessionAdministrationService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ClinicianSessionService) {}

  async list(token: string, targetUserId: string, now = new Date()): Promise<AdminSessionList> {
    const actor = await this.sessions.requireCapability(token, "sessions:read", this.dataSource.manager, now);
    this.requireCombinedSessionAuthority(actor.capabilities, false);
    const users = await this.dataSource.query<Array<{ id: string }>>(
      "select id from app_identity.app_user where organization_id = $1 and id = $2",
      [actor.organization.id, targetUserId]
    );
    if (!users[0]) throw new NotFoundException("User was not found");
    const rows = await this.dataSource.query<SessionRow[]>(`
      select session.id, session.created_at, session.last_activity_at, session.expires_at,
             session.device_label, session.token_sha256 = $3 as current,
             exists (select 1 from app_identity.installation_owner owner_record
               where owner_record.organization_id = app_user.organization_id
                 and owner_record.user_id = app_user.id) as owner
      from app_identity.app_session session
      join app_identity.app_user app_user on app_user.id = session.user_id
      join app_identity.local_credential credential on credential.user_id = app_user.id
      where app_user.organization_id = $1 and app_user.id = $2
        and session.revoked_at is null and session.expires_at > $4
        and session.credential_version = credential.credential_version
      order by session.last_activity_at desc, session.id
    `, [actor.organization.id, targetUserId, digest(token), now]);
    return { userId: targetUserId, items: rows.map((row) => ({
      id: row.id, startedAt: iso(row.created_at), lastActivityAt: iso(row.last_activity_at),
      expiresAt: iso(row.expires_at), deviceLabel: row.device_label, current: row.current, owner: row.owner
    })) };
  }

  async revoke(token: string, targetUserId: string, sessionId: string, command: RevokeAdminSessionCommand,
    now = new Date()): Promise<RevokedAdminSession> {
    return this.dataSource.transaction(async (manager) => {
      const actor = await this.sessions.requireCapability(token, "sessions:revoke", manager, now);
      this.requireCombinedSessionAuthority(actor.capabilities, true);
      const rows = await manager.query<RevocationTarget[]>(`
        select session.id, session.revoked_at, session.token_sha256 = $4 as current,
               exists (select 1 from app_identity.installation_owner owner_record
                 where owner_record.organization_id = app_user.organization_id
                   and owner_record.user_id = app_user.id) as owner
        from app_identity.app_session session
        join app_identity.app_user app_user on app_user.id = session.user_id
        where app_user.organization_id = $1 and app_user.id = $2 and session.id = $3
        for update of session
      `, [actor.organization.id, targetUserId, sessionId, digest(token)]);
      const target = rows[0];
      if (!target) throw new NotFoundException("Session was not found");
      if (target.owner && command.confirmOwner !== true) {
        throw new ConflictException("Revoking an installation owner session requires confirmation");
      }
      const alreadyRevoked = target.revoked_at !== null;
      if (!alreadyRevoked) {
        await manager.query(`update app_identity.app_session
          set revoked_at = $2, revocation_reason = 'administrator_revoke'
          where id = $1 and revoked_at is null`, [target.id, now]);
        await manager.query(`insert into app_identity.authentication_event
          (organization_id, actor_id, action, result, target_user_id, session_id, details)
          values ($1, $2, 'authentication.session_revoke', 'succeeded', $3, $4,
            jsonb_build_object('ownerSession', $5::boolean, 'currentSession', $6::boolean))`,
        [actor.organization.id, actor.user.id, targetUserId, target.id, target.owner, target.current]);
      }
      return { sessionId: target.id, revoked: true, alreadyRevoked, currentSessionRevoked: target.current };
    });
  }

  async resetCredential(token: string, targetUserId: string, command: ResetAdminCredentialCommand,
    now = new Date()): Promise<ResetAdminCredentialResult> {
    const verifier = await createPasswordVerifier(command.temporaryPassword);
    const temporaryPasswordHours = selectedInstallationSettings().authentication.temporaryPasswordHours;
    const expiresAt = new Date(now.getTime() + temporaryPasswordHours * 60 * 60 * 1_000);
    return this.dataSource.transaction(async (manager) => {
      const actor = await this.sessions.requireCapability(token, "credentials:reset", manager, now);
      if (!actor.capabilities?.includes("users:read")) {
        throw new UnauthorizedException("users:read and credentials:reset are required");
      }
      const rows = await manager.query<ResetTarget[]>(`
        select app_user.id, app_user.active, app_user.revision,
               exists (select 1 from app_identity.installation_owner target_owner
                 where target_owner.organization_id = app_user.organization_id
                   and target_owner.user_id = app_user.id) as owner,
               exists (select 1 from app_identity.installation_owner actor_owner
                 where actor_owner.organization_id = app_user.organization_id
                   and actor_owner.user_id = $3) as actor_owner
        from app_identity.app_user app_user
        join app_identity.local_credential credential on credential.user_id = app_user.id
        where app_user.organization_id = $1 and app_user.id = $2
        for update of app_user, credential
      `, [actor.organization.id, targetUserId, actor.user.id]);
      const target = rows[0];
      if (!target) throw new NotFoundException("User was not found");
      if (target.id === actor.user.id) throw new ForbiddenException("Administrators cannot reset their own credential");
      if (target.owner) throw new ForbiddenException("The installation owner credential cannot be reset here");
      if (Number(target.revision) !== command.expectedRevision) {
        throw new ConflictException("This user changed after it was loaded");
      }
      if (!target.actor_owner) {
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
            and definition.administrative and not (capability.capability_key = any($3::text[]))
        `, [actor.organization.id, target.id, actor.capabilities ?? []]);
        if (targetOnly.length) {
          throw new ForbiddenException("A more-capable user cannot be reset by this administrator");
        }
      }
      await manager.query(`update app_identity.local_credential
        set password_verifier = $2, must_change_password = true, temporary_password_expires_at = $3,
            credential_version = credential_version + 1, password_changed_at = null, updated_at = $4
        where user_id = $1`, [target.id, verifier, expiresAt, now]);
      await manager.query("update app_identity.app_user set revision = revision + 1 where id = $1", [target.id]);
      const revoked = mutationRows<{ id: string }>(await manager.query(`update app_identity.app_session
        set revoked_at = $2, revocation_reason = 'password_reset'
        where user_id = $1 and revoked_at is null returning id`, [target.id, now]));
      await manager.query(`insert into app_identity.authentication_event
        (organization_id, actor_id, action, result, target_user_id, note, details)
        values ($1, $2, 'account.reset_password', 'succeeded', $3, $4,
          jsonb_build_object('temporaryPasswordExpiresAt', $5::timestamptz,
            'sessionsRevoked', $6::integer, 'revision', $7::bigint))`,
      [actor.organization.id, actor.user.id, target.id, command.note ?? null, expiresAt, revoked.length,
        command.expectedRevision + 1]);
      return { userId: target.id, revision: command.expectedRevision + 1, active: target.active,
        temporaryPasswordExpiresAt: expiresAt.toISOString(), sessionsRevoked: revoked.length };
    });
  }

  private requireCombinedSessionAuthority(capabilities: string[] | undefined, revocation: boolean): void {
    const required = revocation ? ["users:read", "sessions:read", "sessions:revoke"] : ["users:read", "sessions:read"];
    if (required.some((capability) => !capabilities?.includes(capability))) {
      throw new UnauthorizedException(`${required.join(" and ")} are required`);
    }
  }
}
