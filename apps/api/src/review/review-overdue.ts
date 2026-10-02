import type { EntityManager } from "typeorm";
import { mutationRows } from "../database/mutation-result.js";
import { eligibleReviewers } from "./review-assignment.js";

type Candidate = { id: string; organization_id: string; documenting_user_id: string;
  criterion_id: string;
  basis_at: Date | string; deadline_source: "call-completed" | "report-created";
  deadline_at: Date | string; route: "unassigned" | "author" | "named";
  named_user_id: string | null; independent_review: boolean };

/** Select only overdue server-known drafts and lock their report rows before
 * insertion. Signing takes the same row lock, so the two paths cannot cross. */
export async function discoverOverdueDrafts(manager: EntityManager, limit: number,
  now = new Date(), reportId?: string): Promise<number> {
  const candidates = await manager.query<Candidate[]>(`
    select r.id,r.organization_id,r.documenting_user_id,
      clinical.review_overdue_criterion_id(r.organization_id) criterion_id,
      coalesce(completion.value_datetime,r.created_at) basis_at,
      case when completion.value_datetime is null then 'report-created'
        else 'call-completed' end deadline_source,
      coalesce(completion.value_datetime,r.created_at)
        + make_interval(hours => coalesce(policy.deadline_hours,24)) deadline_at,
      coalesce(route.route,'unassigned') route,route.named_user_id,
      coalesce(route.independent_review,false) independent_review
    from clinical.report r
    left join clinical.review_overdue_policy policy on policy.organization_id=r.organization_id
    left join clinical.review_criterion_route route on route.organization_id=r.organization_id
      and route.criterion_id=clinical.review_overdue_criterion_id(r.organization_id)
    left join lateral (select o.value_datetime from clinical.element_occurrence o
      where o.report_id=r.id and o.element_id='eTimes.16' and o.value_kind='datetime'
        and o.tombstoned_at is null
      order by o.updated_at desc,o.id desc limit 1) completion on true
    where r.status='draft' and r.created_at <= $1::timestamptz
      and ($3::uuid is null or r.id=$3::uuid)
      and coalesce(completion.value_datetime,r.created_at)
        + make_interval(hours => coalesce(policy.deadline_hours,24)) <= $1::timestamptz
      and not exists (select 1 from clinical.review_item item
        where item.organization_id=r.organization_id and item.report_id=r.id
          and item.criterion_id=clinical.review_overdue_criterion_id(r.organization_id))
    order by deadline_at,r.id limit $2 for update of r skip locked`,
  [now.toISOString(), limit, reportId ?? null]);
  let created = 0;
  for (const row of candidates) {
    const proposed = row.route === "author" ? row.documenting_user_id
      : row.route === "named" ? row.named_user_id : null;
    const eligible = proposed ? (await eligibleReviewers(manager, row.organization_id,
      row.documenting_user_id, row.independent_review, proposed))[0] : undefined;
    const assignee = eligible && (row.route !== "named" || eligible.all_access) ? proposed : null;
    const recovery = proposed && !assignee ? "configured-assignee-ineligible" : null;
    const [inserted] = mutationRows<{ id: string }>(await manager.query(`
      insert into clinical.review_item
        (organization_id,report_id,criterion_id,kind,priority,status,assignee_id,version,
         first_matched_at,deadline_basis_at,deadline_source,deadline_at,recovery_reason)
      values ($1,$2,$3,'overdue-unsigned','medium','new',$4,$5,$6,$7,$8,$9,$10)
      on conflict (organization_id,report_id,criterion_id) do nothing returning id`,
    [row.organization_id,row.id,row.criterion_id,assignee,assignee ? 1 : 0,
      now.toISOString(),row.basis_at,row.deadline_source,row.deadline_at,recovery]));
    if (!inserted) continue;
    created++;
    await manager.query(`insert into clinical.review_overdue_history
      (organization_id,item_id,item_version,action) values ($1,$2,$3,'detected')`,
    [row.organization_id,inserted.id,assignee ? 1 : 0]);
    if (assignee) await manager.query(`insert into clinical.review_assignment_history
      (organization_id,item_id,command_id,actor_id,assignee_id,item_version,action,reason)
      values ($1,$2,gen_random_uuid(),null,$3,1,'routed',$4)`,
    [row.organization_id,inserted.id,assignee,row.route]);
  }
  return created;
}
