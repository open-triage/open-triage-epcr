import { reviewPriorityOfRule, type CompiledValidationBundle, type EncounterDocument,
  type ValidationFinding } from "@open-triage/contracts";
import type { EntityManager } from "typeorm";
import { encounterDocument } from "../reports/encounter-document.persistence.js";
import { mutationRows } from "../database/mutation-result.js";
import { eligibleReviewer, eligibleReviewers } from "./review-assignment.js";
import { changedReviewInputs, reviewInputLineage, type ReviewInputChange,
  type ReviewInputLine } from "./review-lineage.js";

type WorkContext = { id: string; organization_id: string; report_id: string;
  documenting_user_id: string; catalog_release_id: string; amendment_sequence: number };
type Item = { id: string; version: string; status: string; assignee_id: string | null;
  active_match: boolean; clearance_pending: boolean; outcome_option_id: string | null };
type PriorDecision = { lineage: ReviewInputLine[]; matched: boolean; amendment_sequence: number };

/** Reconcile the durable report-criterion item while retaining every evaluated conclusion. */
export async function reconcileAmendedReview(manager: Pick<EntityManager, "query">,
  work: WorkContext, bundle: CompiledValidationBundle, document: EncounterDocument,
  evaluationId: string, findings: readonly ValidationFinding[], evaluationTime: string): Promise<void> {
  const reviewRules = bundle.rules.filter((rule) => rule.enabled && rule.executionTargets.includes("review") && reviewPriorityOfRule(rule) !== "none");
  const ids = [...new Set(document.groups.flatMap((group) => group.instances.flatMap((instance) =>
    instance.elements.map((element) => element.id))))];
  const privacy = await manager.query<Array<{ element_id: string; identifying: boolean }>>(`
    select element_id,identifying from catalog.analytics_element_mapping
    where release_id=$1 and element_id=any($2::text[])`, [work.catalog_release_id, ids]);
  const visible = new Set(privacy.filter((row) => !row.identifying).map((row) => row.element_id));
  const identifying = new Set(ids.filter((id) => !visible.has(id)));
  const policy = (await manager.query<Array<{ clearance: "confirm" | "automatic" }>>(`
    select clearance from clinical.review_amendment_policy where organization_id=$1`,
  [work.organization_id]))[0]?.clearance ?? "confirm";
  const byCriterion = new Map<string, ValidationFinding[]>();
  for (const finding of findings) byCriterion.set(finding.ruleId,
    [...(byCriterion.get(finding.ruleId) ?? []), finding]);
  const oldDocuments = new Map<number, EncounterDocument>();

  for (const rule of reviewRules) {
    const matches = byCriterion.get(rule.ruleId) ?? [];
    const item = (await manager.query<Item[]>(`
      select id,version,status,assignee_id,active_match,clearance_pending,outcome_option_id
      from clinical.review_item where organization_id=$1 and report_id=$2 and criterion_id=$3
      for update`, [work.organization_id, work.report_id, rule.ruleId]))[0];
    if (!item && !matches.length) continue;
    const currentLineage = reviewInputLineage(document, rule, identifying);
    let itemId = item?.id;
    let itemVersion = Number(item?.version ?? 0);
    let action: "created" | "unchanged" | "reopened" | "confirmation-required" | "automatic-closure" = "unchanged";
    let reason: string | null = null;
    let changes: ReviewInputChange[] = [];

    if (!item) {
      const route = (await manager.query<Array<{ route: string; named_user_id: string | null;
        independent_review: boolean }>>(`select route,named_user_id,independent_review
        from clinical.review_criterion_route where organization_id=$1 and criterion_id=$2`,
      [work.organization_id, rule.ruleId]))[0];
      const proposed = route?.route === "author" ? work.documenting_user_id
        : route?.route === "named" ? route.named_user_id : null;
      const candidates = proposed ? await eligibleReviewers(manager, work.organization_id,
        work.documenting_user_id, route?.independent_review ?? false, proposed) : [];
      const assignee = candidates[0] && (route?.route !== "named" || candidates[0].all_access)
        ? proposed : null;
      const recoveryReason = proposed && !assignee ? "configured-assignee-ineligible" : null;
      const inserted = mutationRows<{ id: string }>(await manager.query(`
        insert into clinical.review_item
          (organization_id,report_id,criterion_id,priority,first_matched_at,assignee_id,version,recovery_reason)
        values ($1,$2,$3,$4,$5,$6,case when $6::uuid is null then 0 else 1 end,$7)
        on conflict (organization_id,report_id,criterion_id) do nothing returning id`,
      [work.organization_id, work.report_id, rule.ruleId, reviewPriorityOfRule(rule), evaluationTime,
        assignee, recoveryReason]))[0];
      // A concurrent worker may have inserted the same item. Its transaction must
      // finish first; the next queued work can then reconcile it from its evidence.
      if (!inserted) continue;
      itemId = inserted.id;
      itemVersion = assignee ? 1 : 0;
      action = "created";
      if (assignee) await manager.query(`insert into clinical.review_assignment_history
        (organization_id,item_id,command_id,actor_id,assignee_id,item_version,action,reason)
        values ($1,$2,gen_random_uuid(),null,$3,1,'routed',$4)`,
      [work.organization_id, itemId, assignee, route!.route]);
    } else {
      const prior = (await manager.query<PriorDecision[]>(`
        select lineage,matched,amendment_sequence from clinical.review_amendment_decision
        where organization_id=$1 and item_id=$2 order by amendment_sequence desc,recorded_at desc,id desc limit 1`,
      [work.organization_id, item.id]))[0];
      // A later effective signing state already won. Replayed or delayed work must
      // retain its evaluation record without reversing the current conclusion.
      if (prior && Number(prior.amendment_sequence) >= Number(work.amendment_sequence)) continue;
      let baseline = prior?.lineage;
      let previousMatched = prior?.matched ?? item.active_match;
      if (!baseline) {
        const evidence = (await manager.query<Array<{ amendment_sequence: number }>>(`
          select evaluation.amendment_sequence from clinical.review_item_evidence evidence
          join clinical.review_evaluation evaluation on evaluation.id=evidence.evaluation_id
          where evidence.organization_id=$1 and evidence.item_id=$2
          order by evaluation.amendment_sequence desc,evidence.recorded_at desc limit 1`,
        [work.organization_id, item.id]))[0];
        if (evidence) {
          const sequence = Number(evidence.amendment_sequence);
          let previous = oldDocuments.get(sequence);
          if (!previous) {
            previous = await encounterDocument(manager, work.report_id, true, sequence);
            oldDocuments.set(sequence, previous);
          }
          baseline = reviewInputLineage(previous, rule, identifying);
          previousMatched = true;
        }
      }
      changes = baseline ? changedReviewInputs(baseline, currentLineage) : [{
        elementId: null, groupInstanceId: "", occurrenceId: null, change: "changed", identifying: false,
      }];
      if (matches.length) {
        if (item.status === "completed" && (changes.length || !previousMatched)) {
          action = "reopened";
          reason = "relevant-amendment";
          itemVersion += 1;
          await manager.query(`update clinical.review_item set status='in-review',active_match=true,
            clearance_pending=false,reopened=true,closure_reason=null,outcome_option_id=null,outcome_revision=null,
            version=$3,priority=$4,updated_at=now() where organization_id=$1 and id=$2`,
          [work.organization_id, item.id, itemVersion, reviewPriorityOfRule(rule)]);
          await manager.query(`insert into clinical.review_progress_history
            (organization_id,item_id,command_id,actor_id,item_version,status,reason,evaluation_id)
            values ($1,$2,gen_random_uuid(),null,$3,'in-review',$4,$5)`,
          [work.organization_id, item.id, itemVersion, reason, evaluationId]);
        } else await manager.query(`update clinical.review_item set active_match=true,
          clearance_pending=false,priority=$3,updated_at=now() where organization_id=$1 and id=$2`,
        [work.organization_id, item.id, reviewPriorityOfRule(rule)]);
      } else if (previousMatched && (changes.length || item.active_match)) {
        action = policy === "automatic" ? "automatic-closure" : "confirmation-required";
        reason = policy === "automatic" ? "criterion-cleared-automatic-policy" : "criterion-cleared-reviewer-confirmation";
        itemVersion += 1;
        const status = policy === "automatic" ? "completed"
          : item.status === "completed" ? "in-review" : item.status;
        await manager.query(`update clinical.review_item set status=$3,active_match=false,
          clearance_pending=$4,reopened=$7,closure_reason=$5,outcome_option_id=null,outcome_revision=null,
          version=$6,updated_at=now() where organization_id=$1 and id=$2`,
        [work.organization_id, item.id, status, policy === "confirm",
          policy === "automatic" ? reason : null, itemVersion,
          policy === "confirm" && item.status === "completed"]);
        await manager.query(`insert into clinical.review_progress_history
          (organization_id,item_id,command_id,actor_id,item_version,status,reason,evaluation_id)
          values ($1,$2,gen_random_uuid(),null,$3,$4,$5,$6)`,
        [work.organization_id, item.id, itemVersion, status, reason, evaluationId]);
      }
      if (action !== "unchanged" && item.assignee_id &&
        !await eligibleReviewer(manager, work.organization_id, work.documenting_user_id,
          item.assignee_id, (await manager.query<Array<{ independent_review: boolean }>>(`
            select independent_review from clinical.review_criterion_route
            where organization_id=$1 and criterion_id=$2`,
          [work.organization_id, rule.ruleId]))[0]?.independent_review ?? false)) {
        await manager.query(`update clinical.review_item set assignee_id=null,recovery_reason='assignee-ineligible',
          updated_at=now() where organization_id=$1 and id=$2`, [work.organization_id, item.id]);
        await manager.query(`insert into clinical.review_assignment_history
          (organization_id,item_id,command_id,actor_id,assignee_id,previous_assignee_id,
           item_version,action,reason)
          values ($1,$2,gen_random_uuid(),null,null,$3,$4,'recovered','assignee-ineligible')`,
        [work.organization_id, item.id, item.assignee_id, itemVersion]);
      }
    }
    if (matches.length) await manager.query(`insert into clinical.review_item_evidence
      (organization_id,item_id,evaluation_id,work_id,findings) values ($1,$2,$3,$4,$5::jsonb)
      on conflict (item_id,work_id) do nothing`,
    [work.organization_id, itemId, evaluationId, work.id, JSON.stringify(matches)]);
    await manager.query(`insert into clinical.review_amendment_decision
      (organization_id,item_id,work_id,evaluation_id,amendment_sequence,matched,lineage,changes,
       action,reason,policy,item_version)
      values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12)
      on conflict (item_id,work_id) do nothing`,
    [work.organization_id, itemId, work.id, evaluationId, work.amendment_sequence,
      matches.length > 0, JSON.stringify(currentLineage), JSON.stringify(changes), action, reason,
      matches.length ? null : policy, itemVersion]);
  }
}
