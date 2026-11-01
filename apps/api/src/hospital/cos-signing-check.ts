import {reconcileCosFailure} from './cos-recovery-review.js';
import {cosSigningCheckDueSql,cosSigningCheckRequestedSql,cosJournalCheckScopeSql} from './cos-journal-settling.js';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import type { CosConnectionSettings } from '@open-triage/contracts';
import { createCosLiveAdapter, deliverCosLive } from './cos-live-delivery.js';
import { reconcileSimulator } from './cos-simulator.js';
import { finalizeVerifiedSigning } from '../reports/signing-submission.js';

export function cosSigningCheckOutcome(job:{compatible:boolean;revision:string;current_revision:string;automatic?:boolean},proof:{outcome:string;safeToResume?:boolean;coverageIncomplete?:boolean}){
 const resume=!job.automatic&&job.compatible&&job.revision===job.current_revision&&(proof.safeToResume||proof.outcome==='not-stored');
 const superseded=!job.automatic&&job.revision!==job.current_revision&&(proof.safeToResume||proof.outcome==='not-stored');
 const state=(proof.outcome==='stored'||proof.outcome==='accepted')?'confirmed':resume?'pending':superseded?'superseded':'uncertain';
 const finding=state==='confirmed'?(proof.coverageIncomplete?'clinicalProjectionIncomplete':proof.outcome==='accepted'?'readBackDisabled':null):resume?'signingResume':superseded?'draftChanged':'reconciliationUnresolved';
 return {state,finding,resume:!!resume};
}

/** Explicit Sign retries and bounded automatic journal checks reconcile durable intent. */
export async function processSigningChecks(database:DataSource,limit:number){
 const candidates=await database.query<Array<{id:string;report_id:string}>>(`select d.id,d.report_id from clinical.cos_delivery d
 join clinical.report r on r.id=d.report_id
 where ${cosJournalCheckScopeSql} and d.state in ('uncertain','failed')
 and (r.expires_at is null or r.expires_at>clock_timestamp())
 and ${cosSigningCheckDueSql}
 order by d.created_at limit $1`,[limit]);
 for(const candidate of candidates){
  const runner=database.createQueryRunner();await runner.connect();let held=false;
  try{
   const [lock]=await runner.query('select pg_try_advisory_lock(731013,hashtext($1)) locked',[candidate.report_id]);held=!!lock?.locked;if(!held)continue;
   const [job]=await runner.manager.query<Array<{id:string;report_id:string;group_id:string;credential_revision:string;configuration_revision:string;settings:CosConnectionSettings;attempt_id:string;compatible:boolean;current_revision:string;revision:string;automatic:boolean}>>(`
    select d.*,coalesce(s.revision,r.revision) revision,r.revision current_revision,v.settings,cs.active_revision credential_revision,
    (r.status='signed' or not (${cosSigningCheckRequestedSql})) automatic,
    app_identity.cos_configuration_compatible(d.group_id,d.configuration_revision,cs.active_revision) compatible,
    (select id from clinical.cos_attempt where delivery_id=d.id order by created_at desc limit 1) attempt_id
    from clinical.cos_delivery d left join clinical.signing_submission s on s.id=d.signing_submission_id
    join clinical.report r on r.id=d.report_id
    join app_identity.hospital_cos_version v on v.group_id=d.group_id and v.revision=d.configuration_revision
    join app_identity.hospital_cos_state cs on cs.group_id=d.group_id
    where d.id=$1 and ${cosJournalCheckScopeSql} and d.state in ('uncertain','failed') and ${cosSigningCheckDueSql}
    and (r.expires_at is null or r.expires_at>clock_timestamp())`,[candidate.id]);
   if(!job||!job.attempt_id)continue;
   let proof:{outcome:string;safeToResume?:boolean;coverageIncomplete?:boolean}={outcome:'unresolved'};
   try{
    proof=job.settings.mode==='simulator'?await database.transaction(manager=>reconcileSimulator(manager,job.report_id,job.id,job.attempt_id)):
     await deliverCosLive(runner.manager,job.id,job.report_id,await createCosLiveAdapter(runner.manager,job.group_id,job.compatible?job.credential_revision:job.configuration_revision,job.settings),false);
   }catch{/* Retain uncertainty and expose a retryable status check. */}
   await runner.startTransaction();
   try{
    await runner.manager.query('select id from clinical.report where id=$1 for update',[job.report_id]);
    const {state,finding,resume}=cosSigningCheckOutcome(job,proof);
    await runner.manager.query('update clinical.cos_delivery set state=$2,finding=$3,updated_at=clock_timestamp() where id=$1',[job.id,state,finding]);
    await runner.manager.query(`insert into clinical.cos_delivery_event(delivery_id,report_id,worker_id,state,finding,evidence)
     values($1,$2,$3,$4,$5,$6::jsonb)`,[job.id,job.report_id,randomUUID(),state,finding,JSON.stringify({action:'signing-checked',automatic:job.automatic,outcome:proof.outcome,safeToResume:resume})]);
    if(state==='confirmed')await finalizeVerifiedSigning(runner.manager,job.id);
    if(state==='confirmed')await reconcileCosFailure(runner.manager,job.report_id);
    await runner.commitTransaction();
   }catch(error){await runner.rollbackTransaction();throw error;}
  }finally{try{if(held)await runner.query('select pg_advisory_unlock(731013,hashtext($1))',[candidate.report_id]);}finally{await runner.release();}}
 }
}
