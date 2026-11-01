import {epsDeliverySummary} from '../hospital/eps-delivery-summary.js';
import {cosJournalSettlingSql,cosSigningCheckRequestedSql} from '../hospital/cos-journal-settling.js';
import {cosSigningIssues} from '../hospital/cos-signing-issues.js';
import {mutationRows} from '../database/mutation-result.js';
import {cosArtifacts} from '../hospital/cos-live-delivery.js';
import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { SignReportCommand, SignReportResult, SignedReportResult } from './sign-report.types.js';
import { commandSha256 } from './draft-report.validation.js';
import { appendSigningAudit } from './signing-audit.js';
import { queueSignedCos } from '../hospital/cos-queue.js';
import { queueSignedEps } from '../hospital/eps-automatic-export.js';
import { reconcileTransmissionReason } from '../review/review-transmission.js';

export interface PreparedSignature {
 result: SignedReportResult;
 command: SignReportCommand;
 manifest: unknown;
 validationVersionId: string | null;
}

export async function signingSubmissionStatus(manager:EntityManager, reportId:string):Promise<SignReportResult|undefined>{
 const [completed]=await manager.query<Array<{response_body:SignedReportResult}>>(`select c.response_body from clinical.command_receipt c
  join clinical.report r on r.id=c.report_id where c.report_id=$1 and c.command_type='sign-report' and r.status='signed'
  and c.response_body->>'status'='signed' limit 1`,[reportId]);
 if(completed)return completed.response_body;
 const [row]=await manager.query<Array<{prepared:PreparedSignature; signed:boolean; current_revision:string; id:string; state:string; finding:string|null;checking:boolean;settling:boolean}>>(`
 select s.prepared,r.revision current_revision,(r.status='signed' and snap.id=s.id) signed,d.id,d.state,d.finding,
 (d.state in ('uncertain','failed') and ${cosSigningCheckRequestedSql}) checking,
 ${cosJournalSettlingSql} settling
 from clinical.signing_submission s join clinical.report r on r.id=s.report_id
 left join clinical.signed_snapshot snap on snap.report_id=r.id
 left join clinical.cos_delivery d on d.signing_submission_id=s.id
 where s.report_id=$1 order by s.created_at desc,s.id desc limit 1`,[reportId]);
 if(!row)return;
 if(row.signed)return row.prepared.result;
 const eps=await epsDeliverySummary(manager,reportId);
 if(!row.id||row.state==='confirmed'){
  if(row.prepared.command.exportEps&&eps)return {id:reportId,status:'awaiting-eps',submissionId:row.prepared.result.signedSnapshotId,revision:row.prepared.result.signedRevision,epsDelivery:eps};
  if(!row.id)return;
 }
 const result=row.prepared.result;
 const issues=cosSigningIssues(await cosArtifacts(manager,row.id),row.prepared.manifest)
  .filter(issue=>!row.settling||!['journalProcessing','pdfJournalEmpty','pdfNoteNotFound'].includes(issue.code));
 const findings=[...new Set(issues.map(issue=>issue.code))];
 const [context]=await manager.query(`select u.name as "unitName",u.call_sign as "callSign",author.display_name as "authorName",
 d.configuration_revision as "configurationRevision",d.mapping_id as "mappingId",d.mapping_revision as "mappingRevision"
 from clinical.cos_delivery d join clinical.report r on r.id=d.report_id
 left join app_identity.app_user author on author.id=r.documenting_user_id
 left join app_identity.operational_unit u on u.id=(case when r.status='draft' then (select case when count(distinct ca.unit_id)=1 then (array_agg(distinct ca.unit_id))[1] end from clinical.call_assignment ca where ca.report_id=r.id and ca.organization_id=r.organization_id) else r.cos_unit_id end)
 where d.id=$1`,[row.id]);
 return {id:reportId,status:'awaiting-cos',submissionId:result.signedSnapshotId,revision:result.signedRevision,
  deliveryId:row.id,deliveryState:row.state,findings,issues,context,finding:Number(row.current_revision)!==result.signedRevision?'draftChanged':row.checking||row.settling?'inFlight':row.finding};
}

/** Caller owns the report and COS advisory locks. No receiver writes here. */
async function prepareCosSigningSubmission(manager:EntityManager, prepared:PreparedSignature):Promise<SignReportResult|undefined>{
 const {result,command}=prepared;
 if(command.skipCosReason||command.exportCos===false)return;
 const [prior]=await manager.query<Array<{prepared:PreparedSignature; command_sha256:string; state:string; id:string; finding:string|null; attempted:boolean}>>(`
 select s.prepared,s.command_sha256,d.state,d.id,d.finding,exists(select 1 from clinical.cos_attempt a where a.delivery_id=d.id) attempted
 from clinical.signing_submission s join clinical.cos_delivery d on d.signing_submission_id=s.id
 where s.report_id=$1 order by s.created_at desc,s.id desc limit 1`,[result.id]);
 if(prior){
  const same=prior.prepared.result.signedRevision===result.signedRevision;
  if(same&&(prior.attempted||prior.state==='pending'||prior.state==='confirmed')){
   // Repeated Sign is a status/reconciliation request, never another clinical POST.
   if(prior.state==='confirmed') {
    if(prior.finding==='clinicalProjectionIncomplete'&&command.warningAcknowledgements?.['cos:clinicalProjectionIncomplete']!==true)
      return (await signingSubmissionStatus(manager,result.id));
    await finalizeVerifiedSigning(manager,prior.id,command.warningAcknowledgements?.['cos:clinicalProjectionIncomplete']===true);
    return await signingSubmissionStatus(manager,result.id);
   }
   await manager.query(`insert into clinical.cos_delivery_event(delivery_id,report_id,actor_id,state,finding,evidence)
    values($1,$2,$3,$4,$5,$6::jsonb)`,[prior.id,result.id,command.signerId,prior.state,prior.finding,JSON.stringify({action:'signing-check',acknowledgeCoverage:command.warningAcknowledgements?.['cos:clinicalProjectionIncomplete']===true})]);
   return (await signingSubmissionStatus(manager,result.id));
  }
  const [remote]=await manager.query<Array<{sent:boolean}>>(`select exists(select 1 from clinical.cos_artifact_event e join clinical.cos_artifact a on a.delivery_id=e.delivery_id and a.artifact_key=e.artifact_key where e.delivery_id=$1 and a.kind not in ('patient','context') and (e.state in ('sending','accepted','uncertain') or e.evidence ? 'request')) or exists(select 1 from clinical.cos_simulator_contact where report_id=$2) sent`,[prior.id,result.id]);
  if(prior.state==='uncertain'&&remote?.sent){
   await manager.query(`insert into clinical.cos_delivery_event(delivery_id,report_id,actor_id,state,finding,evidence)
    values($1,$2,$3,'uncertain',$4,'{"action":"signing-check"}'::jsonb)`,[prior.id,result.id,command.signerId,prior.finding]);
   return await signingSubmissionStatus(manager,result.id);
  }
  if(!prior.attempted||!remote?.sent){
   await manager.query(`update clinical.cos_delivery set state='superseded',finding=null,updated_at=clock_timestamp() where id=$1`,[prior.id]);
   await manager.query(`insert into clinical.cos_delivery_event(delivery_id,report_id,actor_id,state,evidence)
    values($1,$2,$3,'superseded','{"action":"signing-replaced"}'::jsonb)`,[prior.id,result.id,command.signerId]);
  }
 }
 await manager.query(`insert into clinical.signing_submission(id,report_id,revision,command_id,command_sha256,prepared)
  values($1,$2,$3,$4,$5,$6::jsonb)`,[result.signedSnapshotId,result.id,result.signedRevision,command.commandId,commandSha256(command),JSON.stringify(prepared)]);
 const deliveryId=await queueSignedCos(manager,result.id,result.signedSnapshotId,command.signerId,0,true);
 if(!deliveryId){if(command.exportCos===true)throw new ConflictException({code:'cos.disabled'});return;}
 return {id:result.id,status:'awaiting-cos',submissionId:result.signedSnapshotId,revision:result.signedRevision,deliveryId,deliveryState:'pending',finding:null};
}

/** Resume the same immutable signing request; only a rejected EPS may be deliberately retried. */
export async function prepareSigningSubmission(manager:EntityManager,prepared:PreparedSignature):Promise<SignReportResult|undefined>{
 const {result,command}=prepared;
 const [prior]=await manager.query<Array<{prepared:PreparedSignature;state:string|null;attempt_id:string|null;cos_id:string|null}>>(`select s.prepared,result.state,a.id attempt_id,d.id cos_id
 from clinical.signing_submission s join clinical.eps_submission e on e.signing_submission_id=s.id
 left join clinical.eps_submission_attempt a on a.submission_id=e.id left join clinical.eps_submission_result result on result.attempt_id=a.id
 left join clinical.cos_delivery d on d.signing_submission_id=s.id
 where s.report_id=$1 order by e.created_at desc,e.id desc limit 1`,[result.id]);
 if(prior&&(prior.prepared.result.signedRevision===result.signedRevision||prior.state===null&&!!prior.attempt_id||prior.state==='unknown')){
  if(prior.state==='rejected'&&prior.prepared.result.signedRevision===result.signedRevision)
   await queueSignedEps(manager,result.id,prior.prepared.result.signedSnapshotId,command.signerId,true,true);
  return await signingSubmissionStatus(manager,result.id);
 }
 if(command.exportEps){
  const [active]=await manager.query(`select 1 from app_identity.hospital_eps_state state join clinical.report r on state.group_id=app_identity.organization_group(r.organization_id)
   where r.id=$1 and state.active_revision is not null`,[result.id]);
  if(!active)throw new ConflictException({code:'epsSubmission.disabled'});
 }
 const pending=await prepareCosSigningSubmission(manager,prepared);
 if(pending)return pending;
 if(!command.exportEps)return;
 await manager.query(`insert into clinical.signing_submission(id,report_id,revision,command_id,command_sha256,prepared)
 values($1,$2,$3,$4,$5,$6::jsonb) on conflict(command_id) do nothing`,[result.signedSnapshotId,result.id,result.signedRevision,command.commandId,commandSha256(command),JSON.stringify(prepared)]);
 await queueSignedEps(manager,result.id,result.signedSnapshotId,command.signerId,true);
 return await signingSubmissionStatus(manager,result.id);
}

/** EPS completion uses the same exact-revision and COS verification barriers. */
export async function finalizeEpsSigning(manager:EntityManager,submissionId:string){
 const [row]=await manager.query<Array<{prepared:PreparedSignature;delivery_id:string|null}>>(`select s.prepared,d.id delivery_id
 from clinical.signing_submission s join clinical.report r on r.id=s.report_id
 left join clinical.cos_delivery d on d.signing_submission_id=s.id
 where s.id=$1 and r.status='draft' and r.revision=s.revision
 and r.documenting_user_id=(s.prepared->'command'->>'signerId')::uuid`,[submissionId]);
 if(!row)return false;
 if(row.delivery_id)return finalizeVerifiedSigning(manager,row.delivery_id);
 if(!await finalizeSigningSnapshot(manager,row.prepared))return false;
 const {result,command}=row.prepared;
 await manager.query(`insert into clinical.command_receipt(idempotency_key,report_id,command_type,request_sha256,response_status,response_body)
 values($1,$2,'sign-report',$3,201,$4::jsonb) on conflict(idempotency_key) do nothing`,[command.commandId,result.id,commandSha256(command),JSON.stringify(result)]);
 return true;
}

/** The only finalization path, shared by ordinary local signing and verified COS signing. */
export async function finalizeSigningSnapshot(manager:EntityManager,prepared:PreparedSignature){
 const {result:r,command,manifest,validationVersionId}=prepared;
 if(command.exportEps){
  const [accepted]=await manager.query(`select 1 from clinical.eps_submission s join clinical.eps_submission_attempt a on a.submission_id=s.id
   join clinical.eps_submission_result result on result.attempt_id=a.id where s.signing_submission_id=$1 and result.state='accepted'`,[r.signedSnapshotId]);
  if(!accepted){await queueSignedEps(manager,r.id,r.signedSnapshotId,command.signerId,true);return false;}
 }
 await manager.query(`update clinical.report set status='signed',reporting_date=$2,reporting_date_source=$3,updated_at=$4
  where id=$1 and status='draft' and revision=$5`,[r.id,r.reportingDate,r.reportingDateSource,r.signedAt,r.signedRevision]);
 await manager.query(`insert into clinical.signed_snapshot
 (id,report_id,signed_revision,form_version_id,catalog_release_id,validation_version_id,signer_id,signed_at,canonical_sha256,
 attestation,warning_acknowledgements,quality_rule_version,normalization_rule_version,quality_findings,derived_values,integrity_manifest)
 values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb)`,
 [r.signedSnapshotId,r.id,r.signedRevision,r.formVersionId,r.catalogReleaseId,validationVersionId,r.signerId,r.signedAt,r.canonicalSha256,
 JSON.stringify(command.attestation),JSON.stringify(command.warningAcknowledgements??{}),r.qualityRuleVersion,r.normalizationRuleVersion,
 JSON.stringify(r.qualityFindings),JSON.stringify(r.derivedValues),JSON.stringify(manifest)]);
 await appendSigningAudit(manager,{id:r.id,revision:r.signedRevision},command,r.signedSnapshotId,r.canonicalSha256,r.signedAt);
 return true;
}

/** Caller holds report lock. Exact revision, signer and proven delivery must still agree. */
export async function finalizeVerifiedSigning(manager:EntityManager,deliveryId:string,acknowledgeCoverage?:boolean){
 const [row]=await manager.query<Array<{prepared:PreparedSignature;state:string;finding:string|null;revision:string;status:string;documenting_user_id:string;coverage_acknowledged:boolean|null}>>(`
 select s.prepared,d.state,d.finding,r.revision,r.status,r.documenting_user_id,
 (select (e.evidence->>'acknowledgeCoverage')::boolean from clinical.cos_delivery_event e
  where e.delivery_id=d.id and e.actor_id=r.documenting_user_id and e.evidence->>'action'='signing-check'
   and e.evidence->>'acknowledgeCoverage' in ('true','false') order by e.id desc limit 1) coverage_acknowledged
 from clinical.cos_delivery d
 join clinical.signing_submission s on s.id=d.signing_submission_id
 join clinical.report r on r.id=d.report_id where d.id=$1`,[deliveryId]);
 if(!row||row.state!=='confirmed'||row.status!=='draft'||Number(row.revision)!==row.prepared.result.signedRevision||
 row.documenting_user_id!==row.prepared.command.signerId)return false;
 if(acknowledgeCoverage!==undefined)await manager.query(`insert into clinical.cos_delivery_event(delivery_id,report_id,actor_id,state,finding,evidence)
 values($1,$2,$3,$4,$5,$6::jsonb)`,[deliveryId,row.prepared.result.id,row.documenting_user_id,row.state,row.finding,JSON.stringify({action:'signing-check',acknowledgeCoverage})]);
 const coverageAcknowledged=acknowledgeCoverage??row.coverage_acknowledged??(row.prepared.command.warningAcknowledgements?.['cos:clinicalProjectionIncomplete']===true);
 if(row.finding==='clinicalProjectionIncomplete'&&!coverageAcknowledged)return false;
 const originalDigest=commandSha256(row.prepared.command);
 const prepared=row.prepared;
 if(coverageAcknowledged)prepared.command.warningAcknowledgements={...prepared.command.warningAcknowledgements,'cos:clinicalProjectionIncomplete':true};
 if(!await finalizeSigningSnapshot(manager,prepared))return false;
 await manager.query('update clinical.cos_delivery set snapshot_id=$2 where id=$1',[deliveryId,prepared.result.signedSnapshotId]);
 await manager.query(`insert into clinical.command_receipt(idempotency_key,report_id,command_type,request_sha256,response_status,response_body)
 values($1,$2,'sign-report',$3,201,$4::jsonb) on conflict(idempotency_key) do nothing`,
 [prepared.command.commandId,prepared.result.id,originalDigest,JSON.stringify(prepared.result)]);
 return true;
}

/** Explicit bypass still leaves a durable COS delivery and a routed review item. */
export async function skipCosSigning(manager:EntityManager,reportId:string,snapshotId:string,command:SignReportCommand){
 let deliveryId=await queueSignedCos(manager,reportId,snapshotId,command.signerId);
 if(!deliveryId){
  // Disabling COS after a failed submission must not remove the explicit bypass.
  const rows=mutationRows<{id:string}>(await manager.query(`insert into clinical.cos_delivery
   (report_id,snapshot_id,organization_id,group_id,configuration_revision,mapping_id,mapping_revision,mapping_sha256,queued_by,pdf_language,amendment_sequence)
   select report_id,$2,organization_id,group_id,configuration_revision,mapping_id,mapping_revision,mapping_sha256,$3,pdf_language,0
   from clinical.cos_delivery where report_id=$1 order by created_at desc,id desc limit 1 returning id`,[reportId,snapshotId,command.signerId]));
  deliveryId=rows[0]?.id;
 }
 if(!deliveryId){if(command.exportCos===false)return;throw new ConflictException('COS is not enabled for this report');}
 await manager.query(`update clinical.cos_delivery set state='excluded',finding='signingSkipped',updated_at=clock_timestamp() where id=$1`,[deliveryId]);
 // Cancel only work that has not left this application. Preserve unknown receiver outcomes.
 await manager.query(`update clinical.cos_delivery set state='superseded',updated_at=clock_timestamp()
 where report_id=$1 and id<>$2 and snapshot_id is null and state in ('pending','waiting','failed')`,[reportId,deliveryId]);
 await manager.query(`insert into clinical.cos_delivery_event(delivery_id,report_id,actor_id,state,finding,evidence)
 values($1,$2,$3,'excluded','signingSkipped',$4::jsonb)`,[deliveryId,reportId,command.signerId,JSON.stringify({action:'skip-signing',reason:command.skipCosReason??'COS export deselected at signing'})]);
 const [d]=await manager.query(`select * from clinical.cos_delivery where id=$1`,[deliveryId]);
 await reconcileTransmissionReason(manager,reportId,'delivery-failure',true,{integration:'cos',deliveryId,amendmentSequence:0,
 configurationRevision:d.configuration_revision,mappingId:d.mapping_id,mappingRevision:d.mapping_revision,mappingSha256:d.mapping_sha256,
 missing:[],patientField:null,deliveryState:'excluded',finding:'signingSkipped'});
}
