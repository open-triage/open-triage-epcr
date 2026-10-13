import type { EntityManager } from "typeorm";
import { selectedInstallationSettings } from "../config/installation-settings.js";

export type LocalPolicy = import("@open-triage/contracts").GroupAuthenticationPolicy;
export async function localPolicy(manager: Pick<EntityManager, "query">, organizationId: string | null): Promise<LocalPolicy | undefined> {
  if (!organizationId) return undefined; // Independent installation recovery has no agency policy.
  const rows = await manager.query<Array<{ group_id: string; revision: string | number; maximum_session_hours: number;
    temporary_password_hours: number | null; account_attempt_limit: number; network_attempt_limit: number }>>(`
    select * from app_identity.group_authentication_policy
    where group_id = app_identity.organization_group($1)`, [organizationId]);
  const row = rows[0];
  if (!row) throw new Error("The agency group authentication policy is missing");
  return { groupId: row.group_id, revision: Number(row.revision), maximumSessionHours: row.maximum_session_hours,
    temporaryPasswordHours: row.temporary_password_hours ?? selectedInstallationSettings().authentication.temporaryPasswordHours,
    accountAttemptsPer15Minutes: row.account_attempt_limit, networkAttemptsPer5Minutes: row.network_attempt_limit };
}
