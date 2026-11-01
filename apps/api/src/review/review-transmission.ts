import { contentDigest } from '../admin/canonical-package.js';
import type { EntityManager } from 'typeorm';
import type { ReviewTransmissionEvidence } from '@open-triage/contracts';
import { mutationRows } from '../database/mutation-result.js';
import { eligibleReviewers } from './review-assignment.js';

export const transmissionReasons = ['patient-identity','integration-mapping'] as const;
/** Caller holds the report lock. Lock ordering matches Review routes: agency then item.
 * Evidence carries configuration/version identifiers, never the patient's identifier value.
 * The same report/integration/reason identity survives resolution and recurrence. */
export async function reconcileTransmissionReview(manager:EntityManager,reportId:string,evidence:ReviewTransmissionEvidence){
 const [report]=await manager.query<Array<{organization_id:string;documenting_user_id:string}>>(
  `select organization_id,documenting_user_id from clinical.report where id=$1 and status='signed'`,[reportId]);
 if(!report)return;
 await manager.query('select id from app_identity.organization where id=$1 for share',[report.organization_id]);
 for(const reason of transmissionReasons){
  const active=evidence.missing.some(code=>reason==='patient-identity'?code==='patientIdentifier':code!=='patientIdentifier');
  await reconcileTransmissionReason(manager,reportId,reason,active,evidence);
 }
}
export async function reconcileTransmissionReason(manager:EntityManager,reportId:string,reason:'patient-identity'|'integration-mapping'|'delivery-failure',active:boolean,evidence:ReviewTransmissionEvidence){
 const [report]=await manager.query<Array<{organization_id:string;documenting_user_id:string}>>(`select organization_id,documenting_user_id from clinical.report where id=$1 and status='signed'`,[reportId]);
 if(!report)return;
 await manager.query('select id from app_identity.organization where id=$1 for share',[report.organization_id]);
  const [criterion]=await manager.query<Array<{id:string}>>('select clinical.review_cos_criterion_id($1,$2) id',[report.organization_id,reason]);
  let [item]=await manager.query<Array<{id:string;version:string;active_match:boolean;status:string}>>(
   'select id,version,active_match,status from clinical.review_item where organization_id=$1 and report_id=$2 and criterion_id=$3 for update',
   [report.organization_id,reportId,criterion!.id]);
  if(!item&&!active)return;
  if(!item){
   const [route]=await manager.query<Array<{route:string;named_user_id:string|null;independent_review:boolean}>>(
    'select route,named_user_id,independent_review from clinical.review_criterion_route where organization_id=$1 and criterion_id=$2',[report.organization_id,criterion!.id]);
   const target=route?.route??(reason==='patient-identity'?'author':'unassigned');
   const proposed=target==='author'?report.documenting_user_id:target==='named'?route?.named_user_id:null;
   const eligible=proposed?(await eligibleReviewers(manager,report.organization_id,report.documenting_user_id,route?.independent_review??false,proposed))[0]:undefined;
   const assignee=eligible&&(target!=='named'||eligible.all_access)?proposed:null;
   [item]=mutationRows(await manager.query(`insert into clinical.review_item
    (organization_id,report_id,criterion_id,kind,transmission_reason,priority,status,assignee_id,version,first_matched_at,recovery_reason)
    values($1,$2,$3,case when $4='delivery-failure' then 'cos-delivery-failed' else 'missing-transmission-identifiers' end,$4,'medium','new',$5,case when $5::uuid is null then 0 else 1 end,clock_timestamp(),$6)
    returning id,version,active_match,status`,[report.organization_id,reportId,criterion!.id,reason,assignee,proposed&&!assignee?'configured-assignee-ineligible':null]));
   if(assignee)await manager.query(`insert into clinical.review_assignment_history
    (organization_id,item_id,command_id,actor_id,assignee_id,item_version,action,reason)
    values($1,$2,gen_random_uuid(),null,$3,1,'routed',$4)`,[report.organization_id,item!.id,assignee,target]);
  }
  const [prior]=await manager.query<Array<{evidence:ReviewTransmissionEvidence;active:boolean}>>(
   'select evidence,active from clinical.review_transmission_history where item_id=$1 order by item_version desc limit 1',[item!.id]);
  // Replayed evaluation is idempotent; changed version or remaining requirements gets new evidence.
  if(prior&&prior.active===active&&contentDigest(prior.evidence)===contentDigest(evidence))return;
  const next=Number(item!.version)+(prior?1:0);
  await manager.query(`update clinical.review_item set version=$2,active_match=$3,
   status=case when not $3 then 'completed' when not active_match then 'new' else status end,
   outcome_option_id=case when $3 and not active_match then null else outcome_option_id end,
   outcome_revision=case when $3 and not active_match then null else outcome_revision end,
   reopened=case when $3 and not active_match then true else reopened end,
   closure_reason=case when $3 then null else 'transmission-requirements-satisfied' end,
   clearance_pending=false,updated_at=clock_timestamp() where id=$1`,[item!.id,next,active]);
  await manager.query(`insert into clinical.review_transmission_history
   (organization_id,report_id,item_id,item_version,delivery_id,evidence,active) values($1,$2,$3,$4,$5,$6::jsonb,$7)`,
   [report.organization_id,reportId,item!.id,next,evidence.deliveryId,JSON.stringify(evidence),active]);
}
