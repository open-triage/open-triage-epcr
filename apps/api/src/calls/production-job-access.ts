import { createHash, randomBytes } from "node:crypto";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { ClinicianSession, ProductionJobAccess, UnitSchedulePreview, NewJobConfirmation } from "@open-triage/contracts";
import type { EntityManager } from "typeorm";
import { productionWorkflow } from "../authentication/production-workflow.js";
import { mutationRows } from "../database/mutation-result.js";
import { agencyRequest } from "../sessions/agency-context.js";
import type { SchedulesService } from "../schedules/schedules.service.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export function assertProductionJobAccess(access: ProductionJobAccess): void {
  if (access.state === "ready" || access.state === "preparation") return;
  const code = { "enrollment-required": "calls.enrollmentRequired", "agency-mismatch": "calls.enrolledAgencyMismatch",
    "schedule-required": "calls.scheduleRequired", "handover-required": "calls.handoverRequired",
    "reauthentication-required": "calls.shiftReauthenticationRequired",
    "identity-confirmation-required": "calls.identityConfirmationRequired", "synthetic-only": "calls.syntheticOnly" }[access.state];
  throw new ForbiddenException({ code, params: {} });
}

/** Personal authority -> registration -> ordered agencies -> unit -> session.
 * Role/version writers also precede session containment; binding writers acquire
 * registration before agency/unit/session rows.
 * Hold these locks until call creation commits. Device context never grants roles. */
export async function productionJobAccess(manager: EntityManager, token: string, session: ClinicianSession,
  schedules: SchedulesService, confirmation?: JobConfirmation): Promise<ProductionJobAccess> {
  await manager.query<Array<{ synthetic: boolean }>>(
    "select synthetic from app_identity.app_user where id=$1 for share", [session.user.id]);
  await manager.query(`select id from app_identity.user_role_assignment
    where user_id=$1 and ended_at is null order by id for share`, [session.user.id]);
  await manager.query(`select role.id from app_identity.role role
    where role.id in (select role_id from app_identity.user_role_assignment where user_id=$1 and ended_at is null)
    order by role.id for share`, [session.user.id]);
  const rollout = await productionWorkflow(manager, session.organization.id, "share");
  const automatic = await automaticDemoUnitAccess(manager, token, session);
  if (automatic) {
    if (automatic.state !== "ready") return automatic;
    return { state: rollout.state === "preparation" ? "preparation"
      : await currentShiftAccess(manager, token, automatic.unit!, schedules, confirmation), unit: automatic.unit };
  }
  if (rollout.state === "preparation") {
    // Preparation exempts only enrollment/schedules, never live session authority.
    // Lock immutable device associations too, even if its cookie has gone away.
    const request = agencyRequest.getStore();
    const registrations = await manager.query<Array<{id: string; organization_id: string; unit_id: string}>>(`
      select id,organization_id,unit_id from app_identity.installation_registration
      where credential_sha256=$1 or id=(select installation_registration_id from app_identity.app_session where token_sha256=$2)
      order by id for share`, [request?.installationCredential ? digest(request.installationCredential) : null,digest(token)]);
    const agencies = [session.organization.id,...registrations.map(row => row.organization_id)];
    await manager.query(`select id from app_identity.organization where id=any($1::uuid[])
      or id in(select parent_organization_id from app_identity.organization where id=any($1::uuid[])) order by id for share`, [agencies]);
    await manager.query(`select id from app_identity.operational_unit where id=any($1::uuid[])
      or id in(select unit_id from app_identity.unit_clinician where user_id=$2 and organization_id=$3)
      order by id for share`, [registrations.map(row => row.unit_id),session.user.id,session.organization.id]);
    await manager.query(`select unit_id from app_identity.unit_clinician where user_id=$1 and organization_id=$2
      order by unit_id for share`, [session.user.id,session.organization.id]);
    const [live] = await manager.query(`select s.id from app_identity.app_session s
      where token_sha256=$1 and s.organization_id=$2 and s.revoked_at is null and s.expires_at>clock_timestamp()
      and app_identity.session_authentication_valid(s) and app_identity.user_has_capability(s.user_id,s.organization_id,'clinical:document')
      for update of s`, [digest(token),session.organization.id]);
    if (!live) throw new UnauthorizedException({ code: "calls.sessionExpired", params: {} });
    if (registrations.length) {
      const enrolled = await enrolledUnitAccess(manager, token, session);
      return enrolled.state === "ready" ? { state: "preparation", unit: enrolled.unit } : enrolled;
    }
    return { state: "preparation" };
  }
  const enrolled = await enrolledUnitAccess(manager, token, session);
  if (enrolled.state !== "ready") return enrolled;
  return { state: await currentShiftAccess(manager, token, enrolled.unit!, schedules, confirmation), unit: enrolled.unit };
}

/** Resolve a personal Demo default without creating a shared browser binding.
 * Even a retired explicit registration takes precedence, so revocation cannot
 * silently turn into automatic access to another unit. */
async function automaticDemoUnitAccess(manager: EntityManager, token: string,
  session: ClinicianSession): Promise<ProductionJobAccess | null> {
  const request = agencyRequest.getStore();
  const [selected] = await manager.query<Array<{ demo_unit_id: string }>>(`
    select settings.demo_unit_id from app_identity.agency_settings settings
    join app_identity.app_session s on s.organization_id=settings.organization_id
    join app_identity.app_user u on u.id=s.user_id
    where s.token_sha256=$1 and s.user_id=$2 and s.organization_id=$3
      and s.revoked_at is null and s.expires_at>clock_timestamp() and u.active
      and app_identity.session_authentication_valid(s)
      and app_identity.user_can_access_organization(s.user_id,s.organization_id)
      and app_identity.user_has_capability(s.user_id,s.organization_id,'clinical:demo')
      and app_identity.user_has_capability(s.user_id,s.organization_id,'clinical:document')
      and settings.demo_unit_id is not null and s.installation_registration_id is null
      and not exists(select 1 from app_identity.installation_registration r where r.credential_sha256=$4)
    for share of settings`, [digest(token),session.user.id,session.organization.id,
      request?.installationCredential ? digest(request.installationCredential) : null]);
  if (!selected?.demo_unit_id) return null;
  await manager.query(`select id from app_identity.organization where id=$1
    or id=(select parent_organization_id from app_identity.organization where id=$1)
    order by id for share`, [session.organization.id]);
  const [unit] = await manager.query<Array<{id:string;callSign:string;name:string;organizationId:string}>>(`
    select u.id,u.call_sign as "callSign",u.name,u.organization_id as "organizationId"
    from app_identity.operational_unit u
    join app_identity.organization a on a.id=u.organization_id
    join app_identity.organization g on g.id=coalesce(a.parent_organization_id,a.id)
    where u.id=$1 and u.organization_id=$2 and u.active and a.active and g.active for share of u`,
    [selected.demo_unit_id,session.organization.id]);
  const [live] = await manager.query(`select id from app_identity.app_session
    where token_sha256=$1 and revoked_at is null and expires_at>clock_timestamp()
      and installation_registration_id is null and app_identity.session_authentication_valid(app_session)
    for update`, [digest(token)]);
  if (!live) throw new UnauthorizedException({code:"calls.sessionExpired",params:{}});
  return unit ? {state:"ready",unit} : {state:"enrollment-required"};
}

/** A unit pairing never supplies personal authority. Shared by both call datasets. */
async function enrolledUnitAccess(manager: EntityManager, token: string,
  session: ClinicianSession): Promise<ProductionJobAccess> {
  const request = agencyRequest.getStore();
  if (!request?.installationCredential) return { state: "enrollment-required" };
  const [registration] = await manager.query<Array<{ id: string; organization_id: string; unit_id: string; revoked_at: Date | null }>>(
    `select id,organization_id,unit_id,revoked_at from app_identity.installation_registration
      where credential_sha256=$1 for share`, [digest(request.installationCredential)]);
  if (!registration || registration.revoked_at) return { state: "enrollment-required" };
  await manager.query(`select id from app_identity.organization
    where id=$1 or id=(select parent_organization_id from app_identity.organization where id=$1)
    order by id for share`, [registration.organization_id]);
  const [unit] = await manager.query<Array<{ id: string; callSign: string; name: string; organizationId: string }>>(
    `select u.id,u.call_sign as "callSign",u.name,u.organization_id as "organizationId"
      from app_identity.operational_unit u
      join app_identity.organization a on a.id=u.organization_id
      join app_identity.organization g on g.id=coalesce(a.parent_organization_id,a.id)
      where u.id=$1 and u.organization_id=$2 and u.active and a.active and g.active
      and exists(select 1 from app_identity.unit_enrollment e where e.installation_id=$3 and e.origin=$4)
      for share of u`, [registration.unit_id, registration.organization_id, registration.id, request.origin]);
  if (!unit) return { state: "enrollment-required" };
  if (unit.organizationId !== session.organization.id) return { state: "agency-mismatch", unit };
  // Matching both cookies prevents borrowing a paired session on an unpaired browser.
  const [associated] = await manager.query<Array<{ id: string; matches: boolean; live: boolean }>>(`select id,
    (installation_registration_id=$2 and browser_origin=$3 and organization_id=$4) matches,
    (revoked_at is null and expires_at>clock_timestamp() and app_identity.session_authentication_valid(app_session)) live
    from app_identity.app_session where token_sha256=$1 for update`,
    [digest(token), registration.id, request.origin, session.organization.id]);
  if (!associated?.live) throw new UnauthorizedException({ code: "calls.sessionExpired", params: {} });
  if (!associated.matches) return { state: "enrollment-required", unit };
  return { state: "ready", unit };
}

/** A preview is schedule evidence only. Only this session's personal proof qualifies.
 * Grace requires a separate attempt-specific reminder; it never advances proof. */
export function shiftAuthenticationState(evaluated: UnitSchedulePreview, personallyAuthenticatedAt: string | Date | null): ProductionJobAccess["state"] {
  if (evaluated.state === "missing") return "schedule-required";
  if (evaluated.state === "blank") return "ready";
  if (evaluated.graceCheckpoints.length) return "identity-confirmation-required";
  if (!evaluated.activeCheckpoint) return "ready"; // Initial selection is prospective.
  const proof = personallyAuthenticatedAt == null ? NaN : new Date(personallyAuthenticatedAt).getTime();
  return Number.isFinite(proof) && proof >= Date.parse(evaluated.activeCheckpoint.graceStartsAt)
    && proof <= Date.parse(evaluated.evaluatedAt) ? "ready" : "reauthentication-required";
}

/** Repeat at the creation boundary after assignment/command waits. The caller
 * already owns the authority/device/unit/session locks, with no provider interaction. */
export async function currentShiftAccess(manager: EntityManager, token: string,
  unit: {organizationId: string; id: string}, schedules: SchedulesService, confirmation?: JobConfirmation): Promise<ProductionJobAccess["state"]> {
  if ((await productionWorkflow(manager, unit.organizationId, "share")).state === "preparation") return "ready";
  const [evidence] = await manager.query<Array<ConfirmationSessionContext & { personally_authenticated_at: Date | null }>>(`
    select personally_authenticated_at,user_id,organization_id,installation_registration_id,browser_origin from app_identity.app_session
    where token_sha256=$1 and revoked_at is null and expires_at>clock_timestamp()`, [digest(token)]);
  if (!evidence) throw new UnauthorizedException({ code: "calls.sessionExpired", params: {} });
  const evaluated = await schedules.evaluateUnit(manager, unit.organizationId, unit.id);
  const state = shiftAuthenticationState(evaluated, evidence.personally_authenticated_at);
  if (state !== "identity-confirmation-required" || !confirmation?.token) return state;
  const values = [digest(confirmation.token), digest(token), confirmation.target, confirmationContext(evaluated, evidence)];
  const rows = await manager.query(confirmation.consume
    ? `update app_identity.new_job_confirmation set consumed_at=clock_timestamp()
       where token_sha256=$1 and session_sha256=$2 and target=$3 and context_sha256=$4
       and consumed_at is null and expires_at>clock_timestamp() returning token_sha256`
    : `select token_sha256 from app_identity.new_job_confirmation
       where token_sha256=$1 and session_sha256=$2 and target=$3 and context_sha256=$4
       and consumed_at is null and expires_at>clock_timestamp()`, values);
  return (confirmation.consume ? mutationRows(rows) : rows).length ? "ready" : "identity-confirmation-required";
}

export interface JobConfirmation { target: string; token?: string; consume?: boolean; }

// Evaluation time advances normally. Every authority-bearing schedule field stays bound.
interface ConfirmationSessionContext {
  user_id: string; organization_id: string; installation_registration_id: string; browser_origin: string;
}
function confirmationContext({ evaluatedAt: _time, scheduleName: _name, ...context }: UnitSchedulePreview,
  session: ConfirmationSessionContext): string {
  return digest(JSON.stringify({ schedule: context, actor: session.user_id, agency: session.organization_id,
    registration: session.installation_registration_id, origin: session.browser_origin }));
}

export async function prepareNewJobConfirmation(manager: EntityManager, token: string,
  session: ClinicianSession, schedules: SchedulesService, target: string): Promise<NewJobConfirmation | null> {
  const access = await productionJobAccess(manager, token, session, schedules);
  if (access.state === "preparation" || access.state === "ready" || access.state === "synthetic-only") return null;
  if (access.state !== "identity-confirmation-required") assertProductionJobAccess(access);
  const evaluated = await schedules.evaluateUnit(manager, access.unit!.organizationId, access.unit!.id);
  if (!evaluated.graceCheckpoints.length) {
    assertProductionJobAccess({ ...access, state: await currentShiftAccess(manager, token, access.unit!, schedules) });
    return null;
  }
  const [binding] = await manager.query<ConfirmationSessionContext[]>(`select user_id,organization_id,installation_registration_id,browser_origin
    from app_identity.app_session where token_sha256=$1 and revoked_at is null and expires_at>clock_timestamp()`, [digest(token)]);
  if (!binding) throw new UnauthorizedException({ code: "calls.sessionExpired", params: {} });
  const reminder = randomBytes(32).toString("base64url");
  await manager.query(`delete from app_identity.new_job_confirmation where session_sha256=$1
    and (target=$2 or expires_at<=clock_timestamp() or consumed_at is not null)`, [digest(token), target]);
  await manager.query(`insert into app_identity.new_job_confirmation(token_sha256,session_sha256,target,context_sha256)
    values($1,$2,$3,$4)`, [digest(reminder),digest(token),target,confirmationContext(evaluated,binding)]);
  return { token: reminder, clinicianName: session.user.displayName, unit: access.unit! };
}
