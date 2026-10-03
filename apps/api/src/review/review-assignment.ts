import type { DataSource, EntityManager } from "typeorm";

export type EligibleReviewer = { id: string; display_name: string; all_access: boolean };

/** Resolve current role versions and account state, just as session authorization does. */
export async function eligibleReviewers(manager: Pick<EntityManager, "query">, organizationId: string,
  authorId: string | null, independent = false, candidateId?: string): Promise<EligibleReviewer[]> {
  return manager.query<Array<EligibleReviewer & { self_access: boolean }>>(`
    select u.id,u.display_name,
      (exists (select 1 from app_identity.installation_owner owner
        where owner.organization_id=u.organization_id and owner.user_id=u.id)
       or exists (select 1 from app_identity.user_role_assignment a
        join app_identity.role role on role.id=a.role_id and role.organization_id=a.organization_id
        join app_identity.role_version rv on rv.id=role.current_version_id
          and rv.role_id=role.id and rv.organization_id=role.organization_id
        join app_identity.role_version_capability cap on cap.role_version_id=rv.id
          and cap.role_id=role.id and cap.organization_id=role.organization_id
        where a.user_id=u.id and a.organization_id=u.organization_id and a.ended_at is null
          and role.active and role.assignable and cap.capability_key='review:all')) as all_access,
      (exists (select 1 from app_identity.installation_owner owner
        where owner.organization_id=u.organization_id and owner.user_id=u.id)
       or exists (select 1 from app_identity.user_role_assignment a
        join app_identity.role role on role.id=a.role_id and role.organization_id=a.organization_id
        join app_identity.role_version rv on rv.id=role.current_version_id
          and rv.role_id=role.id and rv.organization_id=role.organization_id
        join app_identity.role_version_capability cap on cap.role_version_id=rv.id
          and cap.role_id=role.id and cap.organization_id=role.organization_id
        where a.user_id=u.id and a.organization_id=u.organization_id and a.ended_at is null
          and role.active and role.assignable and cap.capability_key='review:self')) as self_access
    from app_identity.app_user u
    where u.organization_id=$1 and u.active and ($2::uuid is null or u.id=$2)
      and exists (select 1 from app_identity.installation_owner installation
        where installation.organization_id=u.organization_id)
    order by u.display_name,u.id`, [organizationId, candidateId ?? null]).then((rows) =>
    rows.filter((row) => (!independent || row.id !== authorId) &&
      (row.all_access || (authorId === row.id && row.self_access))));
}

export async function eligibleReviewer(manager: Pick<EntityManager, "query">, organizationId: string,
  authorId: string | null, candidateId: string, independent = false): Promise<boolean> {
  return (await eligibleReviewers(manager, organizationId, authorId, independent, candidateId)).length > 0;
}

/** Bounded, retryable recovery for revoked roles, disabled users and retired routing targets. */
export async function reconcileReviewAssignments(database: DataSource, limit = 100): Promise<void> {
  await database.transaction(async (manager) => {
    const routes = await manager.query<Array<{ organization_id: string; criterion_id: string;
      named_user_id: string; independent_review: boolean; version: string }>>(`
      select organization_id,criterion_id,named_user_id,independent_review,version
      from clinical.review_criterion_route where route='named'
      order by eligibility_checked_at nulls first,organization_id,criterion_id
      limit $1 for update skip locked`, [limit]);
    for (const route of routes) {
      const eligible = (await eligibleReviewers(manager, route.organization_id, null, false,
        route.named_user_id))[0]?.all_access ?? false;
      if (eligible) {
        await manager.query(`update clinical.review_criterion_route set eligibility_checked_at=now()
          where organization_id=$1 and criterion_id=$2`, [route.organization_id, route.criterion_id]);
      } else {
        await manager.query(`update clinical.review_criterion_route set route='unassigned',named_user_id=null,
          version=version+1,recovery_reason='configured-assignee-ineligible',updated_at=now(),
          eligibility_checked_at=now() where organization_id=$1 and criterion_id=$2`,
        [route.organization_id, route.criterion_id]);
        await manager.query(`insert into clinical.review_criterion_route_history
          (organization_id,criterion_id,command_id,actor_id,route,named_user_id,
           independent_review,route_version,reason)
          values ($1,$2,gen_random_uuid(),null,'unassigned',null,$3,$4,'ineligible')`,
        [route.organization_id, route.criterion_id, route.independent_review, Number(route.version) + 1]);
      }
    }
    const items = await manager.query<Array<{ id: string; organization_id: string; assignee_id: string;
      documenting_user_id: string; independent_review: boolean; version: string }>>(`
      select i.id,i.organization_id,i.assignee_id,r.documenting_user_id,
        coalesce(route.independent_review,false) independent_review,i.version
      from clinical.review_item i join clinical.report r on r.id=i.report_id
      left join clinical.review_criterion_route route on route.organization_id=i.organization_id
        and route.criterion_id=i.criterion_id
      where i.assignee_id is not null
      order by i.eligibility_checked_at nulls first,i.id
      limit $1 for update of i skip locked`, [limit]);
    for (const item of items) {
      const eligible = await eligibleReviewer(manager, item.organization_id, item.documenting_user_id,
        item.assignee_id, item.independent_review);
      if (eligible) {
        await manager.query(`update clinical.review_item set eligibility_checked_at=now() where id=$1`, [item.id]);
      } else {
        await manager.query(`update clinical.review_item set assignee_id=null,version=version+1,
          recovery_reason='assignee-ineligible',updated_at=now(),eligibility_checked_at=now()
          where id=$1`, [item.id]);
        await manager.query(`insert into clinical.review_assignment_history
          (organization_id,item_id,command_id,actor_id,assignee_id,previous_assignee_id,
           item_version,action,reason)
          values ($1,$2,gen_random_uuid(),null,null,$3,$4,'recovered','assignee-ineligible')`,
        [item.organization_id, item.id, item.assignee_id, Number(item.version) + 1]);
      }
    }
  });
}
