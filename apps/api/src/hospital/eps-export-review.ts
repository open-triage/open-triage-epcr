import {mutationRows} from '../database/mutation-result.js';
import {createHash} from 'node:crypto';
import type {EntityManager} from 'typeorm';
import {eligibleReviewers} from '../review/review-assignment.js';

/** Caller holds the report lock. One stable operational item survives retries. */
export async function queueEpsExportReview(manager:EntityManager,reportId:string,snapshotId:string,amendmentSequence=0){
 const [report]=await manager.query<Array<{organization_id:string;documenting_user_id:string}>>(
  "select organization_id,documenting_user_id from clinical.report where id=$1 and status='signed'",[reportId]);
 if(!report)return;
 await manager.query('select id from app_identity.organization where id=$1 for share',[report.organization_id]);
 const hash=createHash('md5').update(`eps-export:${report.organization_id}`).digest('hex');
 const criterion=`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20)}`;
 const [prior]=await manager.query<Array<{id:string;eps_snapshot_id:string;eps_amendment_sequence:number}>>(
  'select id,eps_snapshot_id,eps_amendment_sequence from clinical.review_item where organization_id=$1 and report_id=$2 and criterion_id=$3 for update',[report.organization_id,reportId,criterion]);
 if(prior){
  if(prior.eps_snapshot_id!==snapshotId||amendmentSequence>prior.eps_amendment_sequence){
   const [updated]=mutationRows<{version:string}>(await manager.query(`update clinical.review_item set eps_snapshot_id=$2,eps_amendment_sequence=$3,active_match=true,
    status='new',closure_reason=null,reopened=true,outcome_option_id=null,outcome_revision=null,version=version+1,updated_at=clock_timestamp()
    where id=$1 returning version`,[prior.id,snapshotId,amendmentSequence]));
   await manager.query(`insert into clinical.review_progress_history(organization_id,item_id,command_id,actor_id,item_version,status,reason)
    values($1,$2,gen_random_uuid(),null,$3,'new','eps-export-requested')`,[report.organization_id,prior.id,updated!.version]);
  }
  return;
 }
 const eligible=await eligibleReviewers(manager,report.organization_id,report.documenting_user_id,false,report.documenting_user_id);
 const assignee=eligible.length?report.documenting_user_id:null;
 const rows=mutationRows<{id:string}>(await manager.query(`insert into clinical.review_item
  (organization_id,report_id,criterion_id,kind,eps_snapshot_id,eps_amendment_sequence,priority,status,assignee_id,version,first_matched_at,recovery_reason)
  values($1,$2,$3,'eps-export',$4,$6,'medium','new',$5,case when $5::uuid is null then 0 else 1 end,clock_timestamp(),case when $5::uuid is null then 'configured-assignee-ineligible' else null end)
  on conflict(organization_id,report_id,criterion_id) do nothing returning id`,[report.organization_id,reportId,criterion,snapshotId,assignee,amendmentSequence]));
 if(rows[0]&&assignee)await manager.query(`insert into clinical.review_assignment_history
  (organization_id,item_id,command_id,actor_id,assignee_id,item_version,action,reason)
  values($1,$2,gen_random_uuid(),null,$3,1,'routed','author')`,[report.organization_id,rows[0].id,assignee]);
}

/** Only confirmed acceptance closes an item; rejected/unknown/validation errors remain open. */
export async function resolveEpsExportReview(manager:EntityManager,reportId:string,snapshotId:string,amendmentSequence=0){
 await manager.query('select id from clinical.report where id=$1 for update',[reportId]);
 const rows=mutationRows<{id:string;organization_id:string;version:string}>(await manager.query(`update clinical.review_item
  set active_match=false,status='completed',closure_reason='eps-export-accepted',clearance_pending=false,
      version=version+1,updated_at=clock_timestamp()
  where report_id=$1 and eps_snapshot_id=$2 and eps_amendment_sequence=$3 and kind='eps-export' and active_match
  returning id,organization_id,version`,[reportId,snapshotId,amendmentSequence]));
 for(const row of rows)await manager.query(`insert into clinical.review_progress_history
  (organization_id,item_id,command_id,actor_id,item_version,status,reason)
  values($1,$2,gen_random_uuid(),null,$3,'completed','eps-export-accepted')`,[row.organization_id,row.id,row.version]);
}
