import { createHash } from "node:crypto";
import { ForbiddenException } from "@nestjs/common";
import type { ClinicianSession, ProductionJobAccess } from "@open-triage/contracts";
import { SYNTHETIC_DEMO_FIXTURE } from "@open-triage/contracts";
import type { EntityManager } from "typeorm";
import { agencyRequest } from "../sessions/agency-context.js";
import type { SchedulesService } from "../schedules/schedules.service.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export function assertProductionJobAccess(access: ProductionJobAccess): void {
  if (access.state === "ready") return;
  const code = { "enrollment-required": "calls.enrollmentRequired", "agency-mismatch": "calls.enrolledAgencyMismatch",
    "schedule-required": "calls.scheduleRequired", "handover-required": "calls.handoverRequired",
    "synthetic-only": "calls.syntheticOnly" }[access.state];
  throw new ForbiddenException({ code, params: {} });
}

/** Personal authority -> registration -> ordered agencies -> unit -> session.
 * Role/version writers also precede session containment; binding writers acquire
 * registration before agency/unit/session rows.
 * Hold these locks until call creation commits. Device context never grants roles. */
export async function productionJobAccess(manager: EntityManager, token: string, session: ClinicianSession,
  schedules: SchedulesService): Promise<ProductionJobAccess> {
  const [subject] = await manager.query<Array<{ synthetic: boolean }>>(
    "select synthetic from app_identity.app_user where id=$1 for share", [session.user.id]);
  await manager.query(`select id from app_identity.user_role_assignment
    where user_id=$1 and ended_at is null order by id for share`, [session.user.id]);
  await manager.query(`select role.id from app_identity.role role
    where role.id in (select role_id from app_identity.user_role_assignment where user_id=$1 and ended_at is null)
    order by role.id for share`, [session.user.id]);
  if (subject?.synthetic || session.user.id === SYNTHETIC_DEMO_FIXTURE.userId) return { state: "synthetic-only" };
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
  const [associated] = await manager.query(`select id from app_identity.app_session
    where token_sha256=$1 and installation_registration_id=$2 and browser_origin=$3
    and organization_id=$4 and revoked_at is null and expires_at>clock_timestamp() for update`,
    [digest(token), registration.id, request.origin, session.organization.id]);
  if (!associated) return { state: "enrollment-required", unit };
  const evaluated = await schedules.evaluateUnit(manager, unit.organizationId, unit.id);
  return { state: evaluated.state === "missing" ? "schedule-required" :
    evaluated.state === "blank" ? "ready" : "handover-required", unit };
}
