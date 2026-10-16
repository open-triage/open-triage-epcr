import { productionWorkflow } from "../authentication/production-workflow.js";
import { lockInstallationForSession } from "./installation-session.js";
import { localPolicy } from "../authentication/local-policy.js";
import { createHash, randomBytes } from "node:crypto";
import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { SYNTHETIC_DEMO_FIXTURE, type ChangePasswordCommand, type ClinicianSession, type AuthenticatedSession, type CreateClinicianSessionCommand,
  type ReauthenticationResult } from "@open-triage/contracts";
import { DataSource, type EntityManager } from "typeorm";
import { mutationRows } from "../database/mutation-result.js";
import { createPasswordVerifier, verifyPassword } from "../identity/password.js";
import { beginAuthenticationAttempt, finishAuthenticationAttempt } from "./authentication-throttle.js";
import { AgencyDirectoryService } from "./agency-directory.service.js";
import { agencyRequest } from "./agency-context.js";
import { encryptCredential } from "../authentication/oidc-credentials.js";
import {encryptAgencyCredential,decryptAgencyCredential} from "../authentication/agency-oidc-keys.js";
import { assertValidatedPersonalProof, personalProofPolicyDigest, type ValidatedPersonalProof } from "../authentication/personal-proof.js";

export const DEMO_CLINICIAN_USERNAME = SYNTHETIC_DEMO_FIXTURE.username;
export const DEMO_CLINICIAN_PASSWORD = SYNTHETIC_DEMO_FIXTURE.password;

type CredentialRow = {
  user_id: string; display_name: string; organization_id: string | null; organization_name: string;
  username: string; installation_account?: boolean;
  shift_session_duration_hours: number; password_verifier: string; must_change_password: boolean;
  temporary_password_expires_at: Date | string | null; credential_version: string; active: boolean;
};
type SessionRow = Omit<CredentialRow, "password_verifier" | "username"> & {
  authentication_source?: "local" | "oidc"; authentication_valid?: boolean;
  personally_authenticated_at?: Date | string | null; personal_authentication_purpose?: "login" | "switch" | "reauthenticate";
  encrypted_csrf?: ReturnType<typeof encryptCredential>; oidc_group_id?: string;
  session_id: string; created_at: Date | string; expires_at: Date | string; csrf_sha256: string;
  session_credential_version: string; revoked_at: Date | string | null;
  browser_origin?: string | null; agency_access?: boolean; installation_available?: boolean; installation_registration_id?: string | null;
};
export type CreatedSession = { session: AuthenticatedSession; sessionToken: string };
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

  private async requiredAuthentication(manager: EntityManager, userId: string, organizationId: string | null,
    lock = false): Promise<"local" | "oidc"> {
    const [exception] = await manager.query<Array<{recovery:boolean}>>(
      "select app_identity.local_authentication_exception($1,$2) recovery", [userId,organizationId]);
    if (exception?.recovery || !organizationId) return 'local';
    const [policy] = await manager.query<Array<{mode:"local"|"oidc"}>>(
      `select mode from app_identity.group_authentication_policy where group_id=app_identity.organization_group($1) ${lock?'for share':''}`, [organizationId]);
    return policy?.mode ?? 'local';
  }

  async create(command: CreateClinicianSessionCommand, suppliedNow?: Date, userAgent?: string,
    networkSource?: string): Promise<CreatedSession> {
    let now = suppliedNow ?? new Date();
    const username = command.username.trim().toLowerCase();
    const selectedAgency = await this.agencies.forLogin();
    const throttle = await beginAuthenticationAttempt(this.dataSource.manager, username, networkSource, now, { organizationId: selectedAgency?.id, portalOnly: !!agencyRequest.getStore()?.origin && !selectedAgency });
    if (!throttle) throw new UnauthorizedException("The username or password is incorrect");
    const rows = await this.dataSource.query<CredentialRow[]>(`
      select u.id as user_id, (u.account_scope = 'installation') installation_account, u.display_name, (u.active and (u.account_scope = 'installation' or o.active)) as active, o.id as organization_id,
             o.name as organization_name, coalesce(o.shift_session_duration_hours, 12) as shift_session_duration_hours,
             c.username, c.password_verifier, c.must_change_password, c.temporary_password_expires_at, c.credential_version
      from app_identity.local_credential c
      join app_identity.app_user u on u.id = c.user_id
      left join app_identity.organization o on o.id = u.organization_id
      where c.username = $1 and (
        ($2::uuid is not null and app_identity.user_can_access_organization(u.id, $2)) or
        ($2::uuid is null and (not $3::boolean or app_identity.is_installation_superadmin(u.id))))
      limit 2
    `, [username, selectedAgency?.id ?? null, !!agencyRequest.getStore()?.origin && !selectedAgency]);
    const account = rows.length === 1 ? rows[0] : undefined;
    const passwordMatches = await verifyPassword(command.password, account?.password_verifier ?? await dummyVerifier);
    // Sample completion after the expensive verifier, never token issuance/activity.
    if (!suppliedNow) now = await this.authenticationCompletedAt(this.dataSource.manager);
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
    const policy = await localPolicy(this.dataSource.manager, account.installation_account ? null : account.organization_id);
    if (account.installation_account) account.shift_session_duration_hours = 12;
    const normalExpiry = new Date(now.getTime() + (policy?.maximumSessionHours ?? account.shift_session_duration_hours) * 60 * 60 * 1_000);
    const expiresAt = account.must_change_password
      ? new Date(Math.min(normalExpiry.getTime(), timestamp(account.temporary_password_expires_at!)))
      : normalExpiry;
    const created=await this.dataSource.transaction(async manager => {
      await manager.query('select id from app_identity.app_user where id=$1 for share',[account.user_id]);
      await manager.query('select id from app_identity.user_role_assignment where user_id=$1 and ended_at is null order by id for share',[account.user_id]);
      await manager.query('select id from app_identity.role where id in(select role_id from app_identity.user_role_assignment where user_id=$1 and ended_at is null) order by id for share',[account.user_id]);
      const registrationId = await lockInstallationForSession(manager);
      if (registrationId && !await this.agencies.allowsOrigin(agencyRequest.getStore()!.origin,manager)) {
        throw new UnauthorizedException("Registered application origin required");
      }
      if (await this.requiredAuthentication(manager, account.user_id, account.organization_id, true) !== 'local') {
        await this.audit(manager, account, "authentication.sign_in", "failed");
        return undefined;
      }
      const inserted = mutationRows<{ id: string }>(await manager.query(`
        insert into app_identity.app_session
          (user_id, token_sha256, csrf_sha256, credential_version, created_at, last_activity_at, expires_at, device_label,
           organization_id, browser_origin, installation_registration_id, personally_authenticated_at, personal_authentication_purpose)
        values ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10, $5, 'login') returning id
      `, [account.user_id, digest(sessionToken), digest(csrfToken), account.credential_version, now, expiresAt,
        coarseDeviceLabel(userAgent), account.organization_id, agencyRequest.getStore()?.origin ?? null, registrationId]));
      await this.audit(manager, account, "authentication.sign_in", "succeeded", inserted[0]?.id);
      return { sessionToken, session: await this.publicSession(account, now, expiresAt, csrfToken, manager) };
    });
    if(!created)throw new ForbiddenException({code:'login.personalProofRequired'});
    return created;
  }

  async getAuthenticated(sessionToken: string, now = new Date(), allowPasswordChange = false, manager = this.dataSource.manager): Promise<AuthenticatedSession> {
    const rows = await manager.query<SessionRow[]>(`
      select s.id as session_id, s.installation_registration_id, s.created_at, s.expires_at, s.csrf_sha256,
             s.authentication_source, app_identity.session_authentication_valid(s) as authentication_valid,
             s.personally_authenticated_at, s.personal_authentication_purpose, s.encrypted_csrf, s.oidc_group_id,
             s.browser_origin, (s.installation_registration_id is null or exists(
               select 1 from app_identity.installation_registration i
               join app_identity.operational_unit unit on unit.id=i.unit_id and unit.organization_id=i.organization_id
               join app_identity.organization agency on agency.id=i.organization_id
               join app_identity.organization agency_group on agency_group.id=coalesce(agency.parent_organization_id,agency.id)
               where i.id=s.installation_registration_id and i.revoked_at is null
               and unit.active and agency.active and agency_group.active)) as installation_available,
             case when s.organization_id is null then app_identity.is_installation_superadmin(s.user_id)
               else app_identity.user_can_access_organization(s.user_id, s.organization_id) end as agency_access,
             s.credential_version as session_credential_version, s.revoked_at,
             (u.account_scope = 'installation') installation_account, u.id as user_id, u.display_name, u.active, o.id as organization_id,
             o.name as organization_name, coalesce(o.shift_session_duration_hours, 12) as shift_session_duration_hours,
             c.must_change_password, c.temporary_password_expires_at, c.credential_version
      from app_identity.app_session s
      join app_identity.app_user u on u.id = s.user_id
      left join app_identity.organization o on o.id = s.organization_id
      left join app_identity.local_credential c on c.user_id = u.id
      where s.token_sha256 = $1
    `, [digest(sessionToken)]);
    const row = rows[0];
    if (!row || row.revoked_at || !row.active || row.agency_access === false || row.installation_available === false ||
        agencyRequest.getStore()?.organizationId && row.organization_id !== agencyRequest.getStore()!.organizationId ||
        row.browser_origin && agencyRequest.getStore()?.origin && row.browser_origin !== agencyRequest.getStore()!.origin ||
        timestamp(row.expires_at) <= now.getTime() ||
        row.authentication_valid === false ||
        (row.authentication_source === 'oidc' && row.authentication_valid !== true) ||
        (row.authentication_source !== 'oidc' && (!row.credential_version || row.session_credential_version !== row.credential_version)) ||
        (row.authentication_source !== 'oidc' && row.must_change_password && (!row.temporary_password_expires_at ||
          timestamp(row.temporary_password_expires_at) <= now.getTime()))) {
      throw new UnauthorizedException(row?.must_change_password ? "A password change is required" : "The clinician session has ended");
    }
    if (row.installation_registration_id && (!agencyRequest.getStore()?.origin ||
        !await this.agencies.allowsOrigin(agencyRequest.getStore()!.origin,manager))) {
      throw new UnauthorizedException("Registered application origin required");
    }
    // CSRF is recoverable only for signed-in OIDC browsers. It is encrypted at rest
    // and bound to this exact token/group; provider tokens never enter the browser.
    const csrf = row.authentication_source === 'oidc' && row.encrypted_csrf && row.oidc_group_id
      ? await decryptAgencyCredential(manager,row.encrypted_csrf,row.oidc_group_id,`csrf:${digest(sessionToken)}`) : undefined;
    const session = await this.publicSession({...row,must_change_password:row.authentication_source==='oidc'?false:row.must_change_password}, new Date(row.created_at), new Date(row.expires_at), csrf, manager);
    if (row.authentication_source) {
      session.authenticationSource=row.authentication_source;
      session.personallyAuthenticatedAt=new Date(row.personally_authenticated_at??row.created_at).toISOString();
      session.personalAuthenticationPurpose=row.personal_authentication_purpose;
    }
    if (session.passwordChangeRequired && !allowPasswordChange) throw new UnauthorizedException("A password change is required");
    if (!session.workspaceAvailable && !allowPasswordChange) {
      throw new UnauthorizedException("No workspace role is assigned to this account");
    }
    // Transactional authority reads must not take an incidental session write
    // lock ahead of domain user/role/device locks. Ordinary reads still record
    // activity, which never changes proof or the session's fixed maximum.
    if(!manager.queryRunner?.isTransactionActive)await manager.query(`update app_identity.app_session set last_activity_at = $2
      where id = $1 and last_activity_at < $2::timestamptz - interval '1 minute'`, [row.session_id, now]);
    return session;
  }

  /** Agency APIs always require an explicitly selected, accessible workspace. */
  async get(sessionToken: string, now = new Date(), allowPasswordChange = false,
    manager = this.dataSource.manager): Promise<ClinicianSession> {
    const session = await this.getAuthenticated(sessionToken, now, allowPasswordChange, manager);
    if (!session.organization) throw new ForbiddenException("Select an agency before opening this workspace");
    return session as ClinicianSession;
  }

  async assertCsrf(sessionToken: string, csrfToken: string | undefined, manager = this.dataSource.manager): Promise<void> {
    if (!csrfToken) throw new UnauthorizedException("A valid CSRF token is required");
    const rows = await manager.query<Array<{ csrf_sha256: string }>>(
      "select csrf_sha256 from app_identity.app_session where token_sha256 = $1 and revoked_at is null", [digest(sessionToken)]
    );
    if (!rows[0] || rows[0].csrf_sha256 !== digest(csrfToken)) throw new UnauthorizedException("A valid CSRF token is required");
  }

  async changePassword(sessionToken: string, command: ChangePasswordCommand, suppliedNow?: Date, userAgent?: string,
    networkSource?: string): Promise<CreatedSession> {
    let now = suppliedNow ?? new Date();
    const passwordVerifier = await createPasswordVerifier(command.newPassword);
    const result = await this.dataSource.transaction(async (manager) => {
      await this.lockPersonalAuthenticationContext(manager,null,sessionToken);
      await this.assertCsrf(sessionToken, command.csrfToken, manager);
      const current = await this.getAuthenticated(sessionToken, now, true, manager);
      if (current.authenticationSource === 'oidc' || await this.requiredAuthentication(manager,current.user.id,current.organization?.id ?? null,true) === 'oidc') throw new ForbiddenException({code:'login.personalProofRequired'});
      const rows = await manager.query<CredentialRow[]>(`
        select c.password_verifier, c.username, c.credential_version, c.must_change_password,
               c.temporary_password_expires_at,
               (u.account_scope = 'installation') installation_account, u.id as user_id, u.display_name, u.active, o.id as organization_id,
               o.name as organization_name, coalesce(o.shift_session_duration_hours, 12) as shift_session_duration_hours
        from app_identity.local_credential c join app_identity.app_user u on u.id = c.user_id
        left join app_identity.organization o on o.id = $2 where u.id = $1
        for update of c
      `, [current.user.id, current.organization?.id ?? null]);
      const account = rows[0];
      const throttle = await beginAuthenticationAttempt(manager, account?.username ?? current.user.id, networkSource, now, { userId: current.user.id });
      if (!throttle) return undefined;
      if (!account || !await verifyPassword(command.currentPassword, account.password_verifier)) {
        await finishAuthenticationAttempt(manager, throttle, false, now);
        await this.audit(manager, account, "authentication.password_change", "failed");
        return undefined;
      }
      await finishAuthenticationAttempt(manager, throttle, true, now);
      if (!suppliedNow) now = await this.authenticationCompletedAt(manager);
      await this.getAuthenticated(sessionToken, now, true, manager);
      const credentials = mutationRows<{ credential_version: string }>(await manager.query(`update app_identity.local_credential set password_verifier = $2,
        must_change_password = false, temporary_password_expires_at = null,
        credential_version = credential_version + 1,
        password_changed_at = $3, updated_at = $3 where user_id = $1
        returning credential_version`, [account.user_id, passwordVerifier, now]));
      if (!credentials[0]) throw new Error("The password credential update returned no row");
      await manager.query(`update app_identity.app_session set revoked_at = $2,
        revocation_reason = 'password_change' where user_id = $1 and revoked_at is null`, [account.user_id, now]);
      await manager.query(
        `select offline_recovery.revoke_user_recovery_grants(organization_id, $1, 'password_reset')
         from app_identity.organization_user where user_id=$1`,
        [account.user_id]
      );
      await this.audit(manager, account, "authentication.password_change", "succeeded");

      const replacementSessionToken = randomBytes(32).toString("base64url");
      const csrfToken = randomBytes(32).toString("base64url");
      const policy = await localPolicy(manager, account.installation_account ? null : account.organization_id);
      const expiresAt = new Date(now.getTime() + (policy?.maximumSessionHours ?? (account.installation_account ? 12 : account.shift_session_duration_hours)) * 60 * 60 * 1_000);
      const inserted = mutationRows<{ id: string }>(await manager.query(`
        insert into app_identity.app_session
          (user_id, token_sha256, csrf_sha256, credential_version, created_at, last_activity_at, expires_at, device_label,
           organization_id, browser_origin, installation_registration_id, personally_authenticated_at, personal_authentication_purpose)
        values ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, (select installation_registration_id from app_identity.app_session where token_sha256=$10), $5, 'login') returning id
      `, [account.user_id, digest(replacementSessionToken), digest(csrfToken), credentials[0].credential_version,
        now, expiresAt, coarseDeviceLabel(userAgent), current.organization?.id ?? null, agencyRequest.getStore()?.origin ?? null, digest(sessionToken)]));
      await this.audit(manager, account, "authentication.sign_in", "succeeded", inserted[0]?.id);
      return {
        sessionToken: replacementSessionToken,
        session: await this.publicSession({ ...account, organization_id: current.organization?.id ?? null,
          organization_name: current.organization?.name ?? "", must_change_password: false }, now, expiresAt, csrfToken, manager)
      };
    });
    if (!result) throw new UnauthorizedException("The current password is incorrect");
    return result;
  }

  async end(sessionToken: string, csrfToken?: string,reason:"logout"|"user_switch"="logout"): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.assertCsrf(sessionToken, csrfToken, manager);
      await this.getAuthenticated(sessionToken, new Date(), true, manager);
      const rows = mutationRows<{ id: string; user_id: string; organization_id: string }>(await manager.query(`
        update app_identity.app_session s set revoked_at = now(), revocation_reason = $2
        from app_identity.app_user u where s.user_id = u.id and s.token_sha256 = $1 and s.revoked_at is null
        returning s.id, s.user_id, s.organization_id
      `, [digest(sessionToken),reason]));
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
      const current = await this.getAuthenticated(token, new Date(), false, manager);
      if (!current.agencies?.some((agency) => agency.id === organizationId)) {
        throw new ForbiddenException("This agency is not available to this account");
      }
      if (current.organization?.id === organizationId) return current as ClinicianSession;
      const changed = mutationRows<{ id: string }>(await manager.query(`update app_identity.app_session set organization_id=$2,
        expires_at=case when app_identity.is_installation_superadmin(user_id) then expires_at
        else least(expires_at,now() + make_interval(hours => (
          select maximum_session_hours from app_identity.group_authentication_policy where group_id=app_identity.organization_group($2)))) end
        where token_sha256=$1 and revoked_at is null and organization_id is not distinct from $3::uuid returning id`,
      [digest(token), organizationId, current.organization?.id ?? null]));
      if (!changed.length) throw new ConflictException("Agency changed; reload before saving");
      await manager.query(`insert into app_identity.organization_event(organization_id, actor_id, action, details)
        values ($1, $2, 'agency.switch', jsonb_build_object('previousAgencyId', $3::text))`,
      [organizationId, current.user.id, current.organization?.id ?? null]);
      const request = agencyRequest.getStore();
      if (request) request.organizationId = organizationId;
      return this.get(token, new Date(), false, manager);
    });
  }

  async reauthenticate(sessionToken: string, csrfToken: string | undefined, currentPassword: string,
    suppliedNow?: Date, networkSource?: string): Promise<ReauthenticationResult> {
    let now = suppliedNow ?? new Date();
    const verified = await this.dataSource.transaction(async (manager) => {
      await this.lockPersonalAuthenticationContext(manager,null,sessionToken);
      await this.assertCsrf(sessionToken, csrfToken, manager);
      const session = await this.getAuthenticated(sessionToken, now, false, manager);
      if (session.authenticationSource === 'oidc' || await this.requiredAuthentication(manager,session.user.id,session.organization?.id ?? null,true) === 'oidc') throw new ForbiddenException({code:'login.personalProofRequired'});
      const rows = await manager.query<CredentialRow[]>(`
        select c.password_verifier, c.username, c.credential_version, c.must_change_password,
          c.temporary_password_expires_at, u.id as user_id, u.display_name, u.active,
          u.organization_id, o.name as organization_name, coalesce(o.shift_session_duration_hours, 12) as shift_session_duration_hours
        from app_identity.local_credential c
        join app_identity.app_user u on u.id = c.user_id
        left join app_identity.organization o on o.id = u.organization_id
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
      if (!suppliedNow) now = await this.authenticationCompletedAt(manager);
      await this.getAuthenticated(sessionToken, now, false, manager);
      await finishAuthenticationAttempt(manager, throttle, true, now);
      await manager.query(`update app_identity.app_session set reauthenticated_at = $2,
        personally_authenticated_at=$2, personal_authentication_purpose='reauthenticate'
        where token_sha256 = $1 and revoked_at is null`, [digest(sessionToken), now]);
      await this.audit(manager, account, "authentication.reauthenticate", "succeeded");
      return true;
    });
    if (!verified) throw new UnauthorizedException("The current password is incorrect");
    return { reauthenticatedUntil: new Date(now.getTime() + REAUTHENTICATION_MILLISECONDS).toISOString() };
  }

  async requireRecentReauthentication(sessionToken: string, manager: EntityManager = this.dataSource.manager,
    now = new Date()): Promise<void> {
    await this.getAuthenticated(sessionToken,now,false,manager);
    const earliest = new Date(now.getTime() - REAUTHENTICATION_MILLISECONDS);
    const rows = await manager.query<Array<{ recent: boolean }>>(`select exists (
      select 1 from app_identity.app_session
      where token_sha256 = $1 and revoked_at is null
        and expires_at > $3 and app_identity.session_authentication_valid(app_session)
        and app_identity.session_proof_matches_policy(app_session)
        and coalesce(personally_authenticated_at,reauthenticated_at) between $2 and $3
        and (personal_authentication_purpose='reauthenticate' or personal_authentication_purpose is null and reauthenticated_at is not null)
    ) recent`, [digest(sessionToken), earliest, now]);
    if (!rows[0]?.recent) {
      throw new ForbiddenException({code:'login.reauthenticationRequired',message:'Recent personal reauthentication is required'});
    }
  }

  /** Common session issuer. The OIDC service supplies only validated linked identity and personal proof. */
  async lockPersonalAuthenticationContext(manager:EntityManager,identityRequestId:string|null,previousToken?:string,rolloutGroupId?:string):Promise<void>{
    // Immutable user references can be read before locking. Lifecycle and role
    // writers precede session containment; clinical open uses this same order.
    const users=await manager.query<Array<{user_id:string}>>(`select linked_user_id user_id from app_identity.regional_identity_request where id=$1 and linked_user_id is not null
      union select user_id from app_identity.app_session where token_sha256=$2`,[identityRequestId,previousToken?digest(previousToken):null]);
    const ids=users.map(user=>user.user_id);
    await manager.query('select id from app_identity.app_user where id=any($1::uuid[]) order by id for share',[ids]);
    await manager.query('select id from app_identity.user_role_assignment where user_id=any($1::uuid[]) and ended_at is null order by id for share',[ids]);
    await manager.query(`select id from app_identity.role where id in(select role_id from app_identity.user_role_assignment
      where user_id=any($1::uuid[]) and ended_at is null) order by id for share`,[ids]);
    // A missing installation cookie does not erase the immutable association of
    // an established session. Lock both registrations in ID order before any
    // agency/unit/session lock, including the incoming binding validator below.
    const request=agencyRequest.getStore();
    const registrations=await manager.query<Array<{id:string;organization_id:string;unit_id:string}>>(`
      select i.id,i.organization_id,i.unit_id from app_identity.installation_registration i
      where i.credential_sha256=$1 or i.id=(select installation_registration_id from app_identity.app_session where token_sha256=$2)
        or ($3::uuid is not null and app_identity.organization_group(i.organization_id)=$3)
      order by i.id for share of i`,[request?.installationCredential?digest(request.installationCredential):null,previousToken?digest(previousToken):null,rolloutGroupId??null]);
    const agencies=registrations.map(registration=>registration.organization_id);
    await manager.query(`select id from app_identity.organization
      where id=$1 or id=(select parent_organization_id from app_identity.organization where id=$1)
        or id=any($2::uuid[]) or id in(select parent_organization_id from app_identity.organization where id=any($2::uuid[]))
        or id=$3 or parent_organization_id=$3
      order by id for share`,[request?.organizationId,agencies,rolloutGroupId??null]);
    await manager.query(`select id from app_identity.operational_unit where id=any($1::uuid[])
      or ($2::uuid is not null and app_identity.organization_group(organization_id)=$2) order by id for share`,
      [registrations.map(registration=>registration.unit_id),rolloutGroupId??null]);
    await lockInstallationForSession(manager);
    if(previousToken)await manager.query('select id from app_identity.app_session where token_sha256=$1 for update',[digest(previousToken)]);
  }

  async completePersonalAuthentication(manager: EntityManager, identityRequestId: string, revision: number, proof: ValidatedPersonalProof,
    previousToken?: string, now = new Date(), userAgent?: string): Promise<CreatedSession> {
    assertValidatedPersonalProof(proof);
    const policy=proof.policy;
    await this.lockPersonalAuthenticationContext(manager,identityRequestId,previousToken);
    const registrationId=await lockInstallationForSession(manager);
    let previous: AuthenticatedSession | undefined;
    if(previousToken){
      previous=await this.getAuthenticated(previousToken,now,proof.purpose==='reauthenticate',manager);
    }
    const [account]=await manager.query<Array<CredentialRow & {identity_request_id:string;provider_id:string;issuer:string;group_id:string}>>(`
      select r.id identity_request_id,r.provider_id,r.issuer,r.group_id,u.id user_id,u.display_name,u.active,
        o.id organization_id,o.name organization_name,o.shift_session_duration_hours,false must_change_password
      from app_identity.regional_identity_request r join app_identity.app_user u on u.id=r.linked_user_id
      join app_identity.organization o on o.id=$2
      where r.id=$1 and r.group_id=$3 and u.active and u.account_scope='agency'
        and app_identity.organization_group(u.organization_id)=r.group_id
        and app_identity.organization_group(o.id)=r.group_id
        and app_identity.user_can_access_organization(u.id,o.id)
        and not exists(select 1 from app_identity.installation_owner where user_id=u.id)
        and not exists(select 1 from app_identity.installation_superadmin where user_id=u.id)
      for share of u`,[identityRequestId,agencyRequest.getStore()?.organizationId,policy.groupId]);
    if(!account||account.provider_id!==policy.providerId||account.issuer!==proof.issuer) throw new UnauthorizedException({code:'login.identityUnavailable'});
    // All requests hold the current installation/user locks through issuance. Network I/O is complete.
    if(!agencyRequest.getStore()?.origin || !await this.agencies.allowsOrigin(agencyRequest.getStore()!.origin,manager)) throw new UnauthorizedException({code:'login.identityUnavailable'});
    if(proof.purpose==='reauthenticate' && !previous) throw new UnauthorizedException({code:'login.identityUnavailable'});
    if(proof.purpose==='reauthenticate' && previous!.user.id===account.user_id && previous!.authenticationSource==='oidc'){
      // Same-user proof belongs to the initiating session alone; never renew its maximum.
      const updated=mutationRows<{id:string}>(await manager.query(`update app_identity.app_session
        set reauthenticated_at=$2,personally_authenticated_at=$3,personal_authentication_purpose='reauthenticate',
          personal_identity_request_id=$4,personal_group_id=$5,personal_revision=$6,latest_personal_proof_policy_sha256=$7
        where token_sha256=$1 and revoked_at is null and expires_at>$2 returning id`,
        [digest(previousToken!),now,proof.authenticatedAt,identityRequestId,account.group_id,revision,personalProofPolicyDigest(policy)]));
      if(!updated.length)throw new UnauthorizedException({code:'login.identityUnavailable'});
      await manager.query(`insert into app_identity.authentication_event(organization_id,actor_id,action,result,target_user_id,session_id,details)
        values($1,$2,'authentication.reauthenticate','succeeded',$2,$3,$4::jsonb)`,[account.organization_id,account.user_id,updated[0]!.id,
        JSON.stringify({kind:'oidc_personal',purpose:'reauthenticate',providerId:policy.providerId,identityRequestId,revision,proofPolicySha256:personalProofPolicyDigest(policy)})]);
      return {sessionToken:previousToken!,session:await this.getAuthenticated(previousToken!,now,false,manager)};
    }
    const sessionToken=randomBytes(32).toString('base64url'),csrfToken=randomBytes(32).toString('base64url');
    const maximum=await localPolicy(manager,account.organization_id);
    const sameUserTransition=proof.purpose==='reauthenticate' && previous?.user.id===account.user_id;
    const expiresAt=sameUserTransition ? new Date(previous!.expiresAt)
      : new Date(now.getTime()+(maximum?.maximumSessionHours??account.shift_session_duration_hours)*3600000);
    if(previousToken)await manager.query(`update app_identity.app_session set revoked_at=$2,revocation_reason='user_switch'
      where token_sha256=$1 and revoked_at is null`,[digest(previousToken),now]);
    const inserted=mutationRows<{id:string}>(await manager.query(`insert into app_identity.app_session
      (user_id,token_sha256,csrf_sha256,credential_version,created_at,last_activity_at,expires_at,device_label,organization_id,browser_origin,installation_registration_id,
       authentication_source,authentication_purpose,personally_authenticated_at,personal_authentication_purpose,oidc_identity_request_id,oidc_group_id,oidc_revision,personal_proof_policy_sha256,encrypted_csrf,
       personal_identity_request_id,personal_group_id,personal_revision,latest_personal_proof_policy_sha256)
      values($1,$2,$3,null,$4,$4,$5,$6,$7,$8,$9,'oidc',$10,$11,$10,$12,$13,$14,$15,$16::jsonb,$12,$13,$14,$15) returning id`,
      [account.user_id,digest(sessionToken),digest(csrfToken),now,expiresAt,coarseDeviceLabel(userAgent),account.organization_id,agencyRequest.getStore()!.origin,registrationId,
       proof.purpose==='reauthenticate' && !sameUserTransition?'switch':proof.purpose,proof.authenticatedAt,identityRequestId,account.group_id,revision,personalProofPolicyDigest(policy),JSON.stringify(await encryptAgencyCredential(manager,csrfToken,account.group_id,`csrf:${digest(sessionToken)}`))]));
    await this.audit(manager,account,'authentication.sign_in','succeeded',inserted[0]?.id);
    return {sessionToken,session:await this.getAuthenticated(sessionToken,now,true,manager)};
  }

  private async authenticationCompletedAt(manager: EntityManager): Promise<Date> {
    const [row] = await manager.query<Array<{completed_at: Date}>>("select clock_timestamp() as completed_at");
    return new Date(row!.completed_at);
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
  ): Promise<AuthenticatedSession> {
    const resolvedCapabilities = (await manager.query<Array<{ capability_key: string }>>(`
      select capability.key as capability_key
      from app_identity.capability capability
      where app_identity.user_has_capability($1, $2, capability.key)
      order by capability.key
    `, [account.user_id, account.organization_id])).map(({ capability_key }) => capability_key);
    const agencies = await this.agencies.accessible(account.user_id, manager);
    const identities = await manager.query<Array<{ owner: boolean; superadmin: boolean; organization_id: string }>>(
      "select app_identity.is_installation_owner(id) owner, app_identity.is_installation_superadmin(id) superadmin, organization_id from app_identity.app_user where id=$1", [account.user_id]);
    const nextAuthenticationSource=await this.requiredAuthentication(manager,account.user_id,account.organization_id);
    return {
      nextAuthenticationSource,
      ...(account.organization_id ? { productionWorkflow: await productionWorkflow(manager, account.organization_id) } : {}),
      installationOwner: identities[0]?.owner ?? false,
      installationSuperadmin: identities[0]?.superadmin ?? false,
      ...(identities[0]?.organization_id ? { homeOrganizationId: identities[0].organization_id } : {}),
      agencies,
      ...(csrfToken ? { csrfToken } : {}),
      user: { id: account.user_id, displayName: account.display_name },
      organization: account.organization_id ? { id: account.organization_id, name: account.organization_name,
        groupId: agencies.find((agency) => agency.id === account.organization_id)?.groupId } : null,
      startedAt: startedAt.toISOString(), expiresAt: expiresAt.toISOString(),
      passwordChangeRequired: account.must_change_password, capabilities: resolvedCapabilities,
      workspaceAvailable: resolvedCapabilities.length > 0 || !!identities[0]?.superadmin
    };
  }
}
