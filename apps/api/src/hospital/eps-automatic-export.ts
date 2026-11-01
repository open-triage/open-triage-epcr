import {mutationRows} from '../database/mutation-result.js';
import {ConflictException} from '@nestjs/common';
import {finalizeEpsSigning} from '../reports/signing-submission.js';
import {randomUUID} from 'node:crypto';
import type {DataSource,EntityManager} from 'typeorm';
import {signedReportSource} from '../reports/signed-report-pdf.persistence.js';
import {recordPatientAccess} from '../reports/patient-access-audit.js';
import {decryptAgencyCredential} from '../authentication/agency-oidc-keys.js';
import type {CredentialEnvelope} from '../authentication/oidc-credentials.js';
import {contentDigest,EPS_ENDPOINT,mappingPackage} from './hospital-mapping.js';
import {buildEpsOutput} from './eps-output.js';
import {receiverEpsValidation} from './eps-validation.js';
import {publishEps,type EpsSubmissionEvidence} from './eps-submission-transport.js';
import {queueEpsExportReview,resolveEpsExportReview} from './eps-export-review.js';

type Submission={id:string;report_id:string;snapshot_id:string;signing_submission_id?:string;amendment_sequence:number;organization_id:string;
 group_id:string;configuration_revision:string;mapping_id:string;mapping_revision:number;mapping_sha256:string;
 prepared_by:string;bundle:unknown};
async function audit(manager:EntityManager,row:Submission,action:'eps.export'|'eps.submit'){
 await recordPatientAccess(manager,{organizationId:row.organization_id,actorId:row.prepared_by,reportIds:[row.report_id],
  action,resourceId:row.id,careProcess:'documentation',integrationProvenance:{configurationRevision:Number(row.configuration_revision),
   mappingId:row.mapping_id,mappingRevision:row.mapping_revision,mappingSha256:row.mapping_sha256,decision:'automatic-signing-export'}});
}

/** Called in the signature transaction. The immutable prepared document is the durable work item. */
export async function queueSignedEps(manager:EntityManager,reportId:string,snapshotId:string,actorId:string,signingSubmission=false,retry=false){
 await manager.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`${snapshotId}:0`]);
 const [prior]=await manager.query(`select s.id,r.state from clinical.eps_submission s
 left join clinical.eps_submission_attempt a on a.submission_id=s.id left join clinical.eps_submission_result r on r.attempt_id=a.id
 where coalesce(s.snapshot_id,s.signing_submission_id)=$1 and s.amendment_sequence=0 and s.validation->>'automatic'='true'
 order by s.created_at desc,s.id desc limit 1`,[snapshotId]);
 if(prior&&(!retry||prior.state!=='rejected'))return;
 const [config]=await manager.query<Array<{revision:string;group_id:string;canonical_mapping:unknown}>>(`select v.revision,v.group_id,v.canonical_mapping
  from clinical.report r join app_identity.hospital_eps_state s on s.group_id=app_identity.organization_group(r.organization_id)
  join app_identity.hospital_eps_version v on v.group_id=s.group_id and v.revision=coalesce(s.active_revision,case when $2 then s.draft_revision end) where r.id=$1`,[reportId,signingSubmission]);
 if(!config){if(signingSubmission)throw new ConflictException({code:'epsSubmission.disabled'});await queueEpsExportReview(manager,reportId,snapshotId);return;}
 const source=await signedReportSource(manager,reportId,snapshotId,0,signingSubmission);
 // The configured EPS destination is public and accepts fictional records only.
 if(!source.synthetic){if(signingSubmission)throw new ConflictException({code:'epsSubmission.fictionalOnly'});await queueEpsExportReview(manager,reportId,snapshotId);return;}
 const id=randomUUID(),mapping=mappingPackage(config.canonical_mapping),output=buildEpsOutput(source,config.canonical_mapping,id);
 const validation={findings:output.findings,profile:await receiverEpsValidation(),automatic:true};
 const [row]=mutationRows<Submission>(await manager.query(`insert into clinical.eps_submission
  (id,report_id,snapshot_id,amendment_sequence,organization_id,group_id,configuration_revision,mapping_id,mapping_revision,mapping_sha256,
   destination,bundle,validation,payload_sha256,source_sha256,amendment_hashes,prepared_by,signing_submission_id,lineage_parent_id)
  select $1,r.id,case when $16 then null else $3::uuid end,0,r.organization_id,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14::jsonb,$15,case when $16 then $3::uuid else null end,$17
  from clinical.report r where r.id=$2 and r.status=case when $16 then 'draft' else 'signed' end returning *`,
 [id,reportId,snapshotId,config.group_id,config.revision,mapping.definition.id,mapping.definition.revision,mapping.sha256,
  `${EPS_ENDPOINT}/Bundle/$validate`,JSON.stringify(output.bundle),JSON.stringify(validation),contentDigest(output.bundle),source.canonicalSha256,JSON.stringify(output.amendmentHashes),actorId,signingSubmission,prior?.id??null]));
 if(row)await audit(manager,row,'eps.export');
}

const rejection=(code:string):EpsSubmissionEvidence=>({state:'rejected',issues:[{severity:'error',code,expression:[]}],headers:{}});
const unknown=():EpsSubmissionEvidence=>({state:'unknown',issues:[],headers:{}});
async function complete(manager:EntityManager,row:Submission,attemptId:string,evidence:EpsSubmissionEvidence){
 await manager.query('select id from clinical.report where id=$1 for update',[row.report_id]);
 await manager.query(`insert into clinical.eps_submission_result(attempt_id,state,evidence) values($1,$2,$3::jsonb)
  on conflict(attempt_id) do nothing`,[attemptId,evidence.state,JSON.stringify(evidence)]);
 const [stored]=await manager.query<Array<{state:string}>>('select state from clinical.eps_submission_result where attempt_id=$1',[attemptId]);
 if(stored?.state==='accepted'&&row.signing_submission_id){await finalizeEpsSigning(manager,row.signing_submission_id);return;}
 if(stored?.state==='accepted')await resolveEpsExportReview(manager,row.report_id,row.snapshot_id,row.amendment_sequence);
 else await queueEpsExportReview(manager,row.report_id,row.snapshot_id,row.amendment_sequence);
}

/** Same durable-intent pattern as COS: commit before contact, and never blind-resend an uncertain attempt. */
export async function processEpsWork(database:DataSource,limit=10,publish:typeof publishEps=publishEps){
 if(!Number.isInteger(limit)||limit<1||limit>100)throw new RangeError('Invalid EPS batch size');
 const candidates=await database.query<Submission[]>(`select s.* from clinical.eps_submission s
  join clinical.report r on r.id=s.report_id
  left join clinical.eps_submission_attempt a on a.submission_id=s.id
  left join clinical.eps_submission_result result on result.attempt_id=a.id
  where s.validation->>'automatic'='true' and result.attempt_id is null
   and (a.id is null or a.created_at<clock_timestamp()-interval '2 minutes')
   and (r.status='signed' and s.snapshot_id is not null or r.status='draft' and exists(select 1 from clinical.signing_submission signing where signing.id=s.signing_submission_id and signing.revision=r.revision)) and (r.expires_at is null or r.expires_at>clock_timestamp())
  order by s.created_at,s.id limit $1`,[limit]);
 let processed=0;
 for(const row of candidates){
  const runner=database.createQueryRunner();await runner.connect();let held=false;
  const key=`${row.snapshot_id??row.signing_submission_id}:${row.amendment_sequence}`;
  try{
   const [lock]=await runner.query('select pg_try_advisory_lock(hashtextextended($1,0)) locked',[key]);held=!!lock?.locked;if(!held)continue;
   const reserved=await runner.manager.transaction(async manager=>{
    const [report]=await manager.query<Array<{synthetic:boolean}>>(`select synthetic from clinical.report where id=$1 and organization_id=$2
     and (status='signed' and $3::uuid is null or status='draft' and revision=(select revision from clinical.signing_submission where id=$3)) and (expires_at is null or expires_at>clock_timestamp()) for update`,[row.report_id,row.organization_id,row.signing_submission_id??null]);
    if(!report)return;
    const [prior]=await manager.query<Array<{id:string;state:string|null;stale:boolean}>>(`select a.id,r.state,a.created_at<clock_timestamp()-interval '2 minutes' stale
     from clinical.eps_submission_attempt a left join clinical.eps_submission_result r on r.attempt_id=a.id where a.submission_id=$1`,[row.id]);
    if(prior){if(!prior.state&&prior.stale)await complete(manager,row,prior.id,unknown());return;}
    // Share the exact-version publication barrier with the manual Review workflow.
    const [other]=await manager.query<Array<{state:string|null}>>(`select result.state from clinical.eps_submission s
     join clinical.eps_submission_attempt a on a.submission_id=s.id left join clinical.eps_submission_result result on result.attempt_id=a.id
     where coalesce(s.snapshot_id,s.signing_submission_id)=$1 and s.amendment_sequence=$2 and (result.state is null or result.state in ('accepted','unknown')) limit 1`,[row.snapshot_id??row.signing_submission_id,row.amendment_sequence]);
    const attemptId=randomUUID();
    let failure:EpsSubmissionEvidence|undefined,secret:string|undefined;
    if(other)failure=other.state==='accepted'?{state:'accepted',issues:[],headers:{}}:unknown();
    else if(!report.synthetic)failure=rejection('fictionalOnly');
    else {
     const [prepared]=await manager.query<Array<{invalid:boolean}>>(`select
      exists(select 1 from jsonb_array_elements(validation->'findings') f where f->>'severity'='error')
       or coalesce(validation->'profile'->>'state','') not in ('passed','pending') invalid
      from clinical.eps_submission where id=$1`,[row.id]);
     const [version]=await manager.query<Array<{encrypted_credential:CredentialEnvelope;credential_id:string}>>(`select v.encrypted_credential,v.credential_id
      from app_identity.hospital_eps_state s join app_identity.hospital_eps_version v on v.group_id=s.group_id and v.revision=s.active_revision
      where s.group_id=$1 and s.active_revision=$2 and s.group_id=app_identity.organization_group($3) for share of s`,[row.group_id,row.configuration_revision,row.organization_id]);
     if(prepared?.invalid)failure=rejection('validationRequired');
     else if(!version?.encrypted_credential)failure=rejection('configurationChanged');
     else {
      try{secret=await decryptAgencyCredential(manager,version.encrypted_credential,row.group_id,`hospital-eps:${version.credential_id}`);}
      catch{failure=rejection('credentialUnavailable');}
     }
    }
    await manager.query('insert into clinical.eps_submission_attempt(id,submission_id,command_id,actor_id) values($1,$2,$3,$4)',[attemptId,row.id,randomUUID(),row.prepared_by]);
    await audit(manager,row,'eps.submit');
    if(failure){await complete(manager,row,attemptId,failure);return;}
    return {attemptId,secret:secret!};
   });
   if(reserved){
    let evidence=unknown();
    try{evidence=await publish(row.bundle,reserved.secret);}catch{/* Intent is committed; leave recovery in Review. */}
    await runner.manager.transaction(manager=>complete(manager,row,reserved.attemptId,evidence));
   }
   processed++;
  }finally{if(held)await runner.query('select pg_advisory_unlock(hashtextextended($1,0))',[key]);await runner.release();}
 }
 return {processed};
}
