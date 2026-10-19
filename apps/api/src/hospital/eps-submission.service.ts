import {ConflictException,ForbiddenException,Injectable,NotFoundException,UnprocessableEntityException} from '@nestjs/common';
import {InjectDataSource} from '@nestjs/typeorm';
import {DataSource,type EntityManager} from 'typeorm';
import {randomUUID} from 'node:crypto';
import {ClinicianSessionService} from '../sessions/clinician-session.service.js';
import {reviewScope,reviewTargetScope,reviewIdentifying} from '../review/review-scope.js';
import {signedReportSource} from '../reports/signed-report-pdf.persistence.js';
import {recordPatientAccess} from '../reports/patient-access-audit.js';
import {decryptAgencyCredential} from '../authentication/agency-oidc-keys.js';
import type {CredentialEnvelope} from '../authentication/oidc-credentials.js';
import {contentDigest,EPS_ENDPOINT,keys,mappingPackage,invalid} from './hospital-mapping.js';
import {buildEpsOutput} from './eps-output.js';
import {validateEpsBundle,type EpsValidation} from './eps-validator.js';
import {publishEps,type EpsSubmissionEvidence} from './eps-submission-transport.js';
type Prepared={id:string;report_id:string;snapshot_id:string;organization_id:string;group_id:string;configuration_revision:string;mapping_id:string;mapping_revision:number;mapping_sha256:string;amendment_sequence:number;bundle:unknown;validation:{findings:{code:string;severity:string}[];profile:EpsValidation};destination:string;payload_sha256:string;lineage_parent_id:string|null};
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
@Injectable()
export class EpsSubmissionService{
 readonly validate=validateEpsBundle;readonly publish=publishEps;
 constructor(@InjectDataSource()private readonly database:DataSource,private readonly sessions:ClinicianSessionService){}
 private async authorize(manager:EntityManager,token:string,reportId:string,dataset:unknown,write=false){
  if(dataset!=='real'&&dataset!=='synthetic')return invalid();
  if(write)await this.sessions.lockPersonalAuthenticationContext(manager,null,token);
  const session=await this.sessions.get(token,new Date(),false,manager),scope=await reviewTargetScope(manager,reviewScope(session),reportId,'report');
  const [report]=await manager.query<Array<{id:string;documenting_user_id:string}>>(`select id,documenting_user_id from clinical.report where id=$1 and organization_id=$2 and synthetic=$3 and status='signed' and ($4 or documenting_user_id=$5) and (expires_at is null or expires_at>clock_timestamp())${write?' for share':''}`,[reportId,scope.organizationId,dataset==='synthetic',scope.reports==='all',scope.userId]);
  if(!report)throw new NotFoundException();if(!reviewIdentifying(scope,report.documenting_user_id))throw new ForbiddenException();
  return {session,scope};
 }
 private async audit(manager:EntityManager,actor:Awaited<ReturnType<EpsSubmissionService['authorize']>>,row:Prepared,decision:string){
  await recordPatientAccess(manager,{organizationId:actor.scope.organizationId,accessOrganizationId:actor.session.organization.id,actorId:actor.scope.userId,reportIds:[row.report_id],action:decision==='eps.submit-intent'?'eps.submit':'eps.export',careProcess:'review',resourceId:row.id,integrationProvenance:{configurationRevision:Number(row.configuration_revision),mappingId:row.mapping_id,mappingRevision:row.mapping_revision,mappingSha256:row.mapping_sha256,decision}});
 }
 private async view(manager:EntityManager,row:Prepared){
  const [attempt]=await manager.query<Array<{id:string;state:string|null;evidence:unknown}>>(`select a.id,r.state,r.evidence from clinical.eps_submission_attempt a left join clinical.eps_submission_result r on r.attempt_id=a.id where a.submission_id=$1`,[row.id]);
  return {id:row.id,snapshotId:row.snapshot_id,amendmentSequence:row.amendment_sequence,configurationRevision:Number(row.configuration_revision),mappingId:row.mapping_id,mappingRevision:row.mapping_revision,mappingSha256:row.mapping_sha256,destination:row.destination,payloadSha256:row.payload_sha256,lineageParentId:row.lineage_parent_id,validation:row.validation,bundle:row.bundle,state:attempt?attempt.state??'unknown':'prepared',result:attempt?.evidence??null};
 }
 async history(token:string,reportId:string,dataset:unknown){return this.database.transaction('REPEATABLE READ',async manager=>{
  const actor=await this.authorize(manager,token,reportId,dataset);const rows=await manager.query<Prepared[]>('select * from clinical.eps_submission where report_id=$1 order by created_at desc limit 30',[reportId]);
  if(rows[0])await this.audit(manager,actor,rows[0],'eps.submission-history');const result=[];for(const row of rows)result.push(await this.view(manager,row));return result;
 });}
 async preview(token:string,reportId:string,input:unknown,csrfToken?:string){
  const body=keys(input,['snapshotId','amendmentSequence','dataset','lineageParentId']);
  if(!uuid(body.snapshotId)||!Number.isSafeInteger(body.amendmentSequence)||Number(body.amendmentSequence)<0||body.lineageParentId!==undefined&&!uuid(body.lineageParentId))return invalid();
  const id=randomUUID();
  const prepared=await this.database.transaction('REPEATABLE READ',async manager=>{
   await this.authorize(manager,token,reportId,body.dataset);await this.sessions.assertCsrf(token,csrfToken,manager);
   const [config]=await manager.query<Array<{revision:string;canonical_mapping:unknown;group_id:string}>>(`select v.* from app_identity.hospital_eps_state s join app_identity.hospital_eps_version v on v.group_id=s.group_id and v.revision=s.active_revision where s.group_id=app_identity.organization_group((select organization_id from clinical.report where id=$1))`,[reportId]);
   if(!config)throw new ConflictException({code:'epsSubmission.disabled'});
   if(body.lineageParentId){const [parent]=await manager.query<Array<{id:string}>>('select id from clinical.eps_submission where id=$1 and report_id=$2 and snapshot_id=$3 and amendment_sequence=$4',[body.lineageParentId,reportId,body.snapshotId,body.amendmentSequence]);if(!parent)throw new NotFoundException();}
   const source=await signedReportSource(manager,reportId,body.snapshotId as string,Number(body.amendmentSequence));
   if(!source.synthetic)throw new UnprocessableEntityException({code:'epsSubmission.fictionalOnly'});
   const output=buildEpsOutput(source,config.canonical_mapping,id);
   return {config,output,sourceHash:source.canonicalSha256};
  });
  const validation={findings:prepared.output.findings,profile:await this.validate(prepared.output.bundle)};
  return this.database.transaction('REPEATABLE READ',async manager=>{
   const actor=await this.authorize(manager,token,reportId,body.dataset,true);await this.sessions.assertCsrf(token,csrfToken,manager);const mapping=mappingPackage(prepared.config.canonical_mapping);
   await manager.query(`insert into clinical.eps_submission(id,report_id,snapshot_id,amendment_sequence,organization_id,group_id,configuration_revision,mapping_id,mapping_revision,mapping_sha256,destination,bundle,validation,payload_sha256,source_sha256,amendment_hashes,lineage_parent_id,prepared_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16::jsonb,$17,$18)`,[id,reportId,body.snapshotId,body.amendmentSequence,actor.scope.organizationId,prepared.config.group_id,prepared.config.revision,mapping.definition.id,mapping.definition.revision,mapping.sha256,`${EPS_ENDPOINT}/Bundle/$validate`,JSON.stringify(prepared.output.bundle),JSON.stringify(validation),contentDigest(prepared.output.bundle),prepared.sourceHash,JSON.stringify(prepared.output.amendmentHashes),body.lineageParentId??null,actor.scope.userId]);
   const [row]=await manager.query<Prepared[]>('select * from clinical.eps_submission where id=$1',[id]);await this.audit(manager,actor,row!,'eps.preview');return this.view(manager,row!);
  });
 }
 async submit(token:string,reportId:string,input:unknown,csrfToken?:string){
  const body=keys(input,['submissionId','commandId','dataset','confirmPublicFictional']);if(!uuid(body.submissionId)||!uuid(body.commandId)||body.confirmPublicFictional!==true)return invalid();
  const reserved=await this.database.transaction(async manager=>{
   const actor=await this.authorize(manager,token,reportId,body.dataset,true);await this.sessions.assertCsrf(token,csrfToken,manager);
   await manager.query('select pg_advisory_xact_lock(hashtextextended($1,1))',[body.commandId]);
   await manager.query('select pg_advisory_xact_lock(hashtextextended($1,2))',[body.submissionId]);
   const [row]=await manager.query<Prepared[]>('select * from clinical.eps_submission where id=$1 and report_id=$2',[body.submissionId,reportId]);if(!row)throw new NotFoundException();
   const prior=await manager.query<Array<{submission_id:string;command_id:string;actor_id:string}>>('select submission_id,command_id,actor_id from clinical.eps_submission_attempt where command_id=$1 or submission_id=$2',[body.commandId,row.id]);
   if(prior.length){if(prior.some(value=>value.submission_id!==row.id||value.command_id===body.commandId&&value.actor_id!==actor.scope.userId))throw new ConflictException({code:'epsSubmission.commandConflict'});return {replay:await this.view(manager,row)};}
   await manager.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`${row.snapshot_id}:${row.amendment_sequence}`]);
   const [previousPublication]=await manager.query<Array<{state:string|null}>>(`select result.state from clinical.eps_submission p join clinical.eps_submission_attempt attempt on attempt.submission_id=p.id left join clinical.eps_submission_result result on result.attempt_id=attempt.id where p.snapshot_id=$1 and p.amendment_sequence=$2 and (result.state is null or result.state in ('accepted','unknown')) limit 1`,[row.snapshot_id,row.amendment_sequence]);
   if(previousPublication)throw new ConflictException({code:'epsSubmission.alreadyAttempted'});
   if(row.validation.findings.some(value=>value.severity==='error')||row.validation.profile.state!=='passed')throw new ConflictException({code:'epsSubmission.validationRequired'});
   // Recheck the current activation before contact; an explicitly remapped preview is separate immutable lineage.
   const [version]=await manager.query<Array<{encrypted_credential:CredentialEnvelope;credential_id:string}>>(`select v.encrypted_credential,v.credential_id from app_identity.hospital_eps_state s join app_identity.hospital_eps_version v on v.group_id=s.group_id and v.revision=s.active_revision where s.group_id=$1 and s.active_revision=$2 for share of s`,[row.group_id,row.configuration_revision]);
   if(!version?.encrypted_credential)throw new ConflictException({code:'epsSubmission.configurationChanged'});
   const secret=await decryptAgencyCredential(manager,version.encrypted_credential,row.group_id,`hospital-eps:${version.credential_id}`);
   const attemptId=randomUUID();await manager.query('insert into clinical.eps_submission_attempt(id,submission_id,command_id,actor_id) values($1,$2,$3,$4)',[attemptId,row.id,body.commandId,actor.scope.userId]);await this.audit(manager,actor,row,'eps.submit-intent');
   return {row,secret,attemptId};
  });
  if('replay' in reserved)return reserved.replay;
  let evidence:EpsSubmissionEvidence={state:'unknown',issues:[],headers:{}};
  try{evidence=await this.publish(reserved.row.bundle,reserved.secret);}catch{/* Committed intent remains unknown, including crash/lost acknowledgement. Never automatically resend. */}
  await this.database.transaction(async manager=>{await manager.query('insert into clinical.eps_submission_result(attempt_id,state,evidence) values($1,$2,$3::jsonb)',[reserved.attemptId,evidence.state,JSON.stringify(evidence)]);});
  return this.database.transaction('REPEATABLE READ',async manager=>{await this.authorize(manager,token,reportId,body.dataset);return this.view(manager,reserved.row);});
 }
}
