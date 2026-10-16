import { createHash } from "node:crypto";
import { UnauthorizedException } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { agencyRequest } from "./agency-context.js";
import { mutationRows } from "../database/mutation-result.js";

export const INSTALLATION_COOKIE = "open_triage_installation";
export function installationCredential(cookie?: string): string | undefined {
  const part = cookie?.split(";").map(p => p.trim()).find(p => p.startsWith(`${INSTALLATION_COOKIE}=`));
  const value = part?.slice(INSTALLATION_COOKIE.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}

/** Call inside the short session-creation transaction, after personal authentication. */
export async function lockInstallationForSession(manager: Pick<EntityManager, "query">): Promise<string | null> {
  const request = agencyRequest.getStore();
  if (!request?.installationCredential) return null;
  const hash = createHash("sha256").update(request.installationCredential).digest("hex");
  const [registration]=await manager.query(`select id,organization_id from app_identity.installation_registration
    where credential_sha256=$1 for share`,[hash]);
  if(!registration)return null;
  await manager.query(`select id from app_identity.organization
    where id=$1 or id=(select parent_organization_id from app_identity.organization where id=$1)
    order by id for share`,[registration.organization_id]);
  const [binding] = await manager.query(`select i.id,i.revoked_at,u.active and a.active and g.active as active,
    exists(select 1 from app_identity.unit_enrollment e where e.installation_id=i.id and e.origin=$2) as origin_allowed
    from app_identity.installation_registration i
    join app_identity.operational_unit u on u.id=i.unit_id and u.organization_id=i.organization_id
    join app_identity.organization a on a.id=i.organization_id
    join app_identity.organization g on g.id=coalesce(a.parent_organization_id,a.id)
    where i.credential_sha256=$1 for share of u`, [hash, request.origin]);
  // A bootstrap cookie alone is not enrollment and must preserve unpaired Admin/Review access.
  if (!binding) return null;
  if (binding.revoked_at || !binding.active || !binding.origin_allowed) {
    throw new UnauthorizedException("This installation registration is unavailable; enroll again before signing in");
  }
  return binding.id;
}

/** Caller first holds the registration row FOR UPDATE. Never revoke by user or unit. */
export async function revokeRegistrationSessions(manager: Pick<EntityManager, "query">, registrationId: string): Promise<number> {
  const rows = mutationRows(await manager.query(`update app_identity.app_session set revoked_at=clock_timestamp(),
    revocation_reason='installation_revoked' where installation_registration_id=$1 and revoked_at is null returning id`, [registrationId]));
  return rows.length;
}
