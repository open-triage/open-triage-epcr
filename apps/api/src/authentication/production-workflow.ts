import type { EntityManager } from "typeorm";
import type { ProductionWorkflowRollout } from "@open-triage/contracts";

/** Acquire after personal authority, before registration/agency/unit/session locks.
 * Separate from policy rows: policy writers already hold session locks. */
export async function productionWorkflow(manager: EntityManager, organizationId: string,
  lock?: "share" | "update"): Promise<ProductionWorkflowRollout> {
  const [row] = await manager.query<Array<{group_id: string; revision: number; enabled_at: Date | null}>>(`
    select group_id,revision,enabled_at from app_identity.production_workflow_rollout
    where group_id=app_identity.organization_group($1) ${lock === "update" ? "for update" : lock === "share" ? "for share" : ""}`,
    [organizationId]);
  if (!row) throw new Error("Production workflow migration is required");
  return { groupId: row.group_id, revision: Number(row.revision),
    state: row.enabled_at ? "enabled" : "preparation", enabledAt: row.enabled_at ? new Date(row.enabled_at).toISOString() : null };
}

/** Same order as clinical mutations and user/role withdrawal. */
export async function lockProductionWorkflowAuthority(manager: EntityManager, userId: string): Promise<void> {
  await manager.query("select id from app_identity.app_user where id=$1 for share", [userId]);
  await manager.query("select id from app_identity.user_role_assignment where user_id=$1 and ended_at is null order by id for share", [userId]);
  await manager.query(`select id from app_identity.role where id in (
    select role_id from app_identity.user_role_assignment where user_id=$1 and ended_at is null) order by id for share`, [userId]);
}
