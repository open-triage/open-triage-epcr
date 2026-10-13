/** Privileged fixture setup only: production gate regressions deliberately select
 * the enforced stage. Real activation/readiness/freshness uses its service tests. */
export async function enableProductionWorkflowForTesting(database,groupId,actorId) {
  await database.query(`update app_identity.production_workflow_rollout
    set enabled_at=clock_timestamp(),enabled_by=$2,revision=revision+1 where group_id=$1 and enabled_at is null`,[groupId,actorId]);
}
