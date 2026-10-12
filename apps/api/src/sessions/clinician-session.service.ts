import { createHash, randomBytes } from "node:crypto";
import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { SYNTHETIC_DEMO_FIXTURE, type ChangePasswordCommand, type ClinicianSession, type CreateClinicianSessionCommand,
  type ReauthenticationResult } from "@open-triage/contracts";
import { DataSource, type EntityManager } from "typeorm";
import { mutationRows } from "../database/mutation-result.js";
import { createPasswordVerifier, verifyPassword } from "../identity/password.js";
import { beginAuthenticationAttempt, finishAuthenticationAttempt } from "./authentication-throttle.js";
import { AgencyDirectoryService } from "./agency-directory.service.js";
import { agencyRequest } from "./agency-context.js";

export const DEMO_CLINICIAN_USERNAME = SYNTHETIC_DEMO_FIXTURE.username;
export const DEMO_CLINICIAN_PASSWORD = SYNTHETIC_DEMO_FIXTURE.password;

type CredentialRow = {
  user_id: string; display_name: string; organization_id: string; organization_name: string;
  username: string;
  shift_session_duration_hours: number; password_verifier: string; must_change_password: boolean;
  temporary_password_expires_at: Date | string | null; credential_version: string; active: boolean;
};
type SessionRow = Omit<CredentialRow, "password_verifier" | "username"> & {
  session_id: string; created_at: Date | string; expires_at: Date | string; csrf_sha256: string;
  session_credential_version: string; revoked_at: Date | string | null;
  browser_origin?: string | null; agency_access?: boolean;
};
export type CreatedSession = { session: ClinicianSession; sessionToken: string };
const dummyVerifier = createPasswordVerifier("invalid-password-only");
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const timestamp = (value: Date | string) => value instanceof Date ? value.getTime() : Date.parse(value);
const REAUTHENTICATION_MILLISECONDS = 5 * 60 * 1_000;

export function coarseDeviceLabel(userAgent: string | undefined): string {
  const source = userAgent ?? "";
  const browser = /Edg\//.test(source) ? "Edge" : /Firefox\//.test(source) ? "Firefox"
    : /(?:Chrome|CriOS)\//.test(source) ? "Chrome" : /Safari\//.test(source) ? "Safari" : "Other browser";
  const os = /Windows NT/.test(source) ? "Windows" : /(?:iPhone|iPad|iPod)/.test(source) ? "iOS"
    : /Android/.test(source) ? "Android" : /Mac OS X/.test(source) ? "macOS"
      : /Linux/.test(source) ? "Linux" : "Other OS";
  return `${browser} on ${os}`;
}

@Injectable()
export class ClinicianSessionService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource,
    private readonly agencies: AgencyDirectoryService = new AgencyDirectoryService(dataSource)) {}

  async create(command: CreateClinicianSessionCommand, now = new Date(), userAgent?: string,
    networkSource?: string): Promise<CreatedSession> {
    const username = command.username.trim().toLowerCase();
    const selectedAgency = await this.agencies.forLogin();
    const throttle = await beginAuthenticationAttempt(this.dataSource.manager, username, networkSource, now, { organizationId: selectedAgency?.id, portalOnly: !!agencyRequest.getStore()?.origin && !selectedAgency });
    if (!throttle) throw new UnauthorizedException("The username or password is incorrect");
    const rows = await this.dataSource.query<CredentialRow[]>(`
      select u.id as user_id, u.display_name, (u.active and o.active) as active, o.id as organization_id,
             o.name as organization_name, o.shift_session_duration_hours,
             c.username, c.password_verifier, c.must_change_password, c.temporary_password_expires_at, c.credential_version
      from app_identity.local_credential c
      join app_identity.app_user u on u.id = c.user_id
      join app_identity.organization o on o.id = u.organization_id
      where c.username = $1 and (
        ($2::uuid is not null and app_identity.user_can_access_organization(u.id, $2)) or
        ($2::uuid is null and (not $3::boolean or app_identity.is_installation_superadmin(u.id))))
      limit 2
    `, [username, selectedAgency?.id ?? null, !!agencyRequest.getStore()?.origin && !selectedAgency]);
    const account = rows.length === 1 ? rows[0] : undefined;
    const passwordMatches = await verifyPassword(command.password, account?.password_verifier ?? await dummyVerifier);
    const temporaryExpired = account?.must_change_password && (!account.temporary_password_expires_at ||
      timestamp(account.temporary_password_expires_at) <= now.getTime());
    const accessible = account && passwordMatches && selectedAgency ? await this.dataSource.query<Array<{ allowed: boolean }>>(
      "select app_identity.user_can_access_organization($1, $2) allowed", [account.user_id, selectedAgency.id]) : null;
    if (!account || !passwordMatches || !account.active || temporaryExpired || accessible && !accessible[0]?.allowed) {
      await finishAuthenticationAttempt(this.dataSource.manager, throttle, false, now);
      await this.audit(this.dataSource.manager, account, "authentication.sign_in", "failed");
      throw new UnauthorizedException("The username or password is incorrect");
    }
    await finishAuthenticationAttempt(this.dataSource.manager, throttle, true, now);
    if (selectedAgency) {
      account.organization_id = selectedAgency.id;
      account.organization_name = selectedAgency.name;
      account.shift_session_duration_hours = selectedAgency.shift_session_duration_hours;
    }
    const sessionToken = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const normalExpiry = new Date(now.getTime() + account.shift_session_duration_hours * 60 * 60 * 1_000);
    const expiresAt = account.must_change_password
      ? new Date(Math.min(normalExpiry.getTime(), timestamp(account.temporary_password_expires_at!)))
      : normalExpiry;
    const inserted = mutationRows<{ id: string }>(await this.dataSource.query(`
      insert into app_identity.app_session
        (user_id, token_sha256, csrf_sha256, credential_version, created_at, last_activity_at, expires_at, device_label,
         organization_id, browser_origin)
      values ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9) returning id
    `, [account.user_id, digest(sessionToken), digest(csrfToken), account.credential_version, now, expiresAt,
      coarseDeviceLabel(userAgent), account.organization_id, agencyRequest.getStore()?.origin ?? null]));
    await this.audit(this.dataSource.manager, account, "authentication.sign_in", "succeeded", inserted[0]?.id);
    return { sessionToken, session: await this.publicSession(account, now, expiresAt, csrfToken) };
  }

  async get(sessionToken: string, now = new Date(), allowPasswordChange = false, manager = this.dataSource.manager): Promise<ClinicianSession> {
    const rows = await manager.query<SessionRow[]>(`
      select s.id as session_id, s.created_at, s.expires_at, s.csrf_sha256,
             s.browser_origin, app_identity.user_can_access_organization(s.user_id, s.organization_id) as agency_access,
             s.credential_version as session_credential_version, s.revoked_at,
             u.id as user_id, u.display_name, u.active, o.id as organization_id,
             o.name as organization_name, o.shift_session_duration_hours,
             c.must_change_password, c.temporary_password_expires_at, c.credential_version
      from app_identity.app_session s
      join app_identity.app_user u on u.id = s.user_id
      join app_identity.organization o on o.id = s.organization_id
      join app_identity.local_credential c on c.user_id = u.id
      where s.token_sha256 = $1
    `, [digest(sessionToken)]);
    const row = rows[0];
    if (!row || row.revoked_at || !row.active || row.agency_access === false ||
        agencyRequest.getStore()?.organizationId && row.organization_id !== agencyRequest.getStore()!.organizationId ||
        row.browser_origin && agencyRequest.getStore()?.origin && row.browser_origin !== agencyRequest.getStore()!.origin ||
        timestamp(row.expires_at) <= now.getTime() ||
        row.session_credential_version !== row.credential_version ||
        (row.must_change_password && (!row.temporary_password_expires_at ||
          timestamp(row.temporary_password_expires_at) <= now.getTime())) ||
        (row.must_change_password && !allowPasswordChange)) {
      throw new UnauthorizedException(row?.must_change_password ? "A password change is required" : "The clinician session has ended");
    }
    const session = await this.publicSession(row, new Date(row.created_at), new Date(row.expires_at), undefined, manager);
    if (!session.workspaceAvailable && !allowPasswordChange) {
      throw new UnauthorizedException("No workspace role is assigned to this account");
    }
    await manager.query(`update app_identity.app_session set last_activity_at = $2
      where id = $1 and last_activity_at < $2::timestamptz - interval '1 minute'`, [row.session_id, now]);
    return session;
  }

  async assertCsrf(sessionToken: string, csrfToken: string | undefined, manager = this.dataSource.manager): Promise<void> {
    if (!csrfToken) throw new UnauthorizedException("A valid CSRF token is required");
    const rows = await manager.query<Array<{ csrf_sha256: string }>>(
      "select csrf_sha256 from app_identity.app_session where token_sha256 = $1 and revoked_at is null", [digest(sessionToken)]
    );
    if (!rows[0] || rows[0].csrf_sha256 !== digest(csrfToken)) throw new UnauthorizedException("A valid CSRF token is required");
  }

  async changePassword(sessionToken: string, command: ChangePasswordCommand, now = new Date(), userAgent?: string,
    networkSource?: string): Promise<CreatedSession> {
    const passwordVerifier = await createPasswordVerifier(command.newPassword);
    const result = await this.dataSource.transaction(async (manager) => {
      await this.assertCsrf(sessionToken, command.csrfToken, manager);
      const current = await this.get(sessionToken, now, true, manager);
      const rows = await manager.query<CredentialRow[]>(`
        select c.password_verifier, c.username, c.credential_version, c.must_change_password,
               c.temporary_password_expires_at,
               u.id as user_id, u.display_name, u.active, o.id as organization_id,
               o.name as organization_name, o.shift_session_duration_hours
        from app_identity.local_credential c join app_identity.app_user u on u.id = c.user_id
        join app_identity.organization o on o.id = $2 where u.id = $1
        for update of c
      `, [current.user.id, current.organization.id]);
      const account = rows[0];
      const throttle = await beginAuthenticationAttempt(manager, account?.username ?? current.user.id, networkSource, now, { userId: current.user.id });
      if (!throttle) return undefined;
      if (!account || !await verifyPassword(command.currentPassword, account.password_verifier)) {
        await finishAuthenticationAttempt(manager, throttle, false, now);
        await this.audit(manager, account, "authentication.password_change", "failed");
        return undefined;
      }
      await finishAuthenticationAttempt(manager, throttle, true, now);
      const credentials = mutationRows<{ credential_version: string }>(await manager.query(`update app_identity.local_credential set password_verifier = $2,
        must_change_password = false, temporary_password_expires_at = null,
        credential_version = credential_version + 1,
        password_changed_at = $3, updated_at = $3 where user_id = $1
        returning credential_version`, [account.user_id, passwordVerifier, now]));
      if (!credentials[0]) throw new Error("The password credential update returned no row");
      await manager.query(`update app_identity.app_session set revoked_at = $2,
        revocation_reason = 'password_change' where user_id = $1 and revoked_at is null`, [account.user_id, now]);
      await manager.query(
        "select offline_recovery.revoke_user_recovery_grants($1, $2, 'password_reset')",
        [account.organization_id, account.user_id]
      );
      await this.audit(manager, account, "authentication.password_change", "succeeded");

      const replacementSessionToken = randomBytes(32).toString("base64url");
      const csrfToken = randomBytes(32).toString("base64url");
      const expiresAt = new Date(now.getTime() + account.shift_session_duration_hours * 60 * 60 * 1_000);
      const inserted = mutationRows<{ id: string }>(await manager.query(`
        insert into app_identity.app_session
          (user_id, token_sha256, csrf_sha256, credential_version, created_at, last_activity_at, expires_at, device_label,
           organization_id, browser_origin)
        values ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9) returning id
      `, [account.user_id, digest(replacementSessionToken), digest(csrfToken), credentials[0].credential_version,
        now, expiresAt, coarseDeviceLabel(userAgent), current.organization.id, agencyRequest.getStore()?.origin ?? null]));
      await this.audit(manager, account, "authentication.sign_in", "succeeded", inserted[0]?.id);
      return {
        sessionToken: replacementSessionToken,
        session: await this.publicSession({ ...account, organization_id: current.organization.id,
          organization_name: current.organization.name, must_change_password: false }, now, expiresAt, csrfToken, manager)
      };
    });
    if (!result) throw new UnauthorizedException("The current password is incorrect");
    return result;
  }

  async end(sessionToken: string, csrfToken?: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.assertCsrf(sessionToken, csrfToken, manager);
      await this.get(sessionToken, new Date(), true, manager);
      const rows = mutationRows<{ id: string; user_id: string; organization_id: string }>(await manager.query(`
        update app_identity.app_session s set revoked_at = now(), revocation_reason = 'logout'
        from app_identity.app_user u where s.user_id = u.id and s.token_sha256 = $1 and s.revoked_at is null
        returning s.id, s.user_id, s.organization_id
      `, [digest(sessionToken)]));
      const ended = rows[0];
      if (!ended) throw new UnauthorizedException("The clinician session has ended");
      await manager.query(`insert into app_identity.authentication_event
        (organization_id, actor_id, action, result, target_user_id, session_id)
        values ($1, $2, 'authentication.sign_out', 'succeeded', $2, $3)`,
      [ended.organization_id, ended.user_id, ended.id]);
    });
  }

  async requireCapability(sessionToken: string, capability: string,
    manager: EntityManager = this.dataSource.manager, now = new Date()): Promise<ClinicianSession> {
    const session = await this.get(sessionToken, now, false, manager);
    if (!session.capabilities?.includes(capability)) throw new UnauthorizedException("The requested capability is required");
    // Staff and roles are administered once for the whole agency group.
    if (/^(users|roles|credentials|sessions):/.test(capability) && session.organization.groupId &&
        session.organization.groupId !== session.organization.id) {
      const group = session.agencies?.find((agency) => agency.id === session.organization.groupId);
      if (!group) throw new ForbiddenException("The parent agency is unavailable");
      return { ...session, organization: { id: group.id, name: group.name, groupId: group.id } };
    }
    return session;
  }

  async switchAgency(token: string, organizationId: string): Promise<ClinicianSession> {
    return this.dataSource.transaction(async (manager) => {
      const current = await this.get(token, new Date(), false, manager);
      if (!current.agencies?.some((agency) => agency.id === organizationId)) {
        throw new ForbiddenException("This agency is not available to this account");
      }
      if (current.organization.id === organizationId) return current;
      const changed = mutationRows<{ id: string }>(await manager.query(`update app_identity.app_session set organization_id=$2,
        expires_at=least(expires_at,now() + make_interval(hours => (
          select shift_session_duration_hours from app_identity.organization where id=$2)))
        where token_sha256=$1 and revoked_at is null and organization_id=$3 returning id`,
      [digest(token), organizationId, current.organization.id]));
      if (!changed.length) throw new ConflictException("Agency changed; reload before saving");
      await manager.query(`insert into app_identity.organization_event(organization_id, actor_id, action, details)
        values ($1, $2, 'agency.switch', jsonb_build_object('previousAgencyId', $3::text))`,
      [organizationId, current.user.id, current.organization.id]);
      const request = agencyRequest.getStore();
      if (request) request.organizationId = organizationId;
      return this.get(token, new Date(), false, manager);
    });
  }

  async reauthenticate(sessionToken: string, csrfToken: string | undefined, currentPassword: string,
    now = new Date(), networkSource?: string): Promise<ReauthenticationResult> {
    const verified = await this.dataSource.transaction(async (manager) => {
      await this.assertCsrf(sessionToken, csrfToken, manager);
      const session = await this.get(sessionToken, now, false, manager);
      const rows = await manager.query<CredentialRow[]>(`
        select c.password_verifier, c.username, c.credential_version, c.must_change_password,
          c.temporary_password_expires_at, u.id as user_id, u.display_name, u.active,
          u.organization_id, o.name as organization_name, o.shift_session_duration_hours
        from app_identity.local_credential c
        join app_identity.app_user u on u.id = c.user_id
        join app_identity.organization o on o.id = u.organization_id
        where u.id = $1 for update of c
      `, [session.user.id]);
      const account = rows[0];
      const throttle = await beginAuthenticationAttempt(manager, account?.username ?? session.user.id, networkSource, now, { userId: session.user.id });
      if (!throttle) return false;
      if (!account || !await verifyPassword(currentPassword, account.password_verifier)) {
        await finishAuthenticationAttempt(manager, throttle, false, now);
        await this.audit(manager, account, "authentication.reauthenticate", "failed");
        return false;
      }
      await finishAuthenticationAttempt(manager, throttle, true, now);
      await manager.query(`update app_identity.app_session set reauthenticated_at = $2
        where token_sha256 = $1 and revoked_at is null`, [digest(sessionToken), now]);
      await this.audit(manager, account, "authentication.reauthenticate", "succeeded");
      return true;
    });
    if (!verified) throw new UnauthorizedException("The current password is incorrect");
    return { reauthenticatedUntil: new Date(now.getTime() + REAUTHENTICATION_MILLISECONDS).toISOString() };
  }

  async requireRecentReauthentication(sessionToken: string, manager: EntityManager = this.dataSource.manager,
    now = new Date()): Promise<void> {
    const earliest = new Date(now.getTime() - REAUTHENTICATION_MILLISECONDS);
    const rows = await manager.query<Array<{ recent: boolean }>>(`select exists (
      select 1 from app_identity.app_session
      where token_sha256 = $1 and revoked_at is null
        and reauthenticated_at between $2 and $3
    ) recent`, [digest(sessionToken), earliest, now]);
    if (!rows[0]?.recent) {
      throw new ForbiddenException("Recent password reauthentication is required for this protected role change");
    }
  }

  private async audit(manager: EntityManager, account: Partial<CredentialRow> | undefined, action: string, result: string, sessionId?: string): Promise<void> {
    await manager.query(`insert into app_identity.authentication_event
      (organization_id, actor_id, action, result, target_user_id, session_id)
      values ($1, $2, $3, $4, $2, $5)`,
    [account?.organization_id ?? null, account?.user_id ?? null, action, result, sessionId ?? null]);
  }

  private async publicSession(
    account: Pick<CredentialRow, "user_id" | "display_name" | "organization_id" | "organization_name" | "must_change_password">,
    startedAt: Date, expiresAt: Date, csrfToken?: string, manager = this.dataSource.manager
  ): Promise<ClinicianSession> {
    const resolvedCapabilities = (await manager.query<Array<{ capability_key: string }>>(`
      select capability.key as capability_key
      from app_identity.capability capability
      where app_identity.user_has_capability($1, $2, capability.key)
      order by capability.key
    `, [account.user_id, account.organization_id])).map(({ capability_key }) => capability_key);
    const agencies = await this.agencies.accessible(account.user_id, manager);
    const identities = await manager.query<Array<{ owner: boolean; superadmin: boolean; organization_id: string }>>(
      "select app_identity.is_installation_owner(id) owner, app_identity.is_installation_superadmin(id) superadmin, organization_id from app_identity.app_user where id=$1", [account.user_id]);
    return {
      installationOwner: identities[0]?.owner ?? false,
      installationSuperadmin: identities[0]?.superadmin ?? false,
      homeOrganizationId: identities[0]?.organization_id,
      agencies,
      ...(csrfToken ? { csrfToken } : {}),
      user: { id: account.user_id, displayName: account.display_name },
      organization: { id: account.organization_id, name: account.organization_name,
        groupId: agencies.find((agency) => agency.id === account.organization_id)?.groupId },
      startedAt: startedAt.toISOString(), expiresAt: expiresAt.toISOString(),
      passwordChangeRequired: account.must_change_password, capabilities: resolvedCapabilities,
      workspaceAvailable: resolvedCapabilities.length > 0
    };
  }
}
