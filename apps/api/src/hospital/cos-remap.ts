import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import type { ClinicianSessionService } from '../sessions/clinician-session.service.js';
import { reviewScope, reviewTargetScope, reviewIdentifying } from '../review/review-scope.js';
import { commandSha256 } from '../reports/draft-report.validation.js';
import { cosMappingPackage } from './cos-configuration.js';
import { cosEligibility } from './cos-payload.js';
import type { SignedOccurrence } from '../reports/signed-report-pdf.js';
import type { CanonicalPackage } from '../admin/canonical-package.js';
/** Internal building block for the later Review recovery command. No endpoint/retry UI.
 * Both configuration authority and scoped identifying report access are required.
 * Only waiting work with NO prepared payload or attempt may be deliberately remapped.
 */
export async function remapWaitingCos(database:DataSource,sessions:ClinicianSessionService,token:string,input:{dataset:'real'|'synthetic';reportId:string;parentId:string;commandId:string;configurationRevision:number;stateRevision:number}){
 const digest=commandSha256(input);
 return database.transaction(async manager=>{
  await sessions.lockPersonalAuthenticationContext(manager,null,token);
  const actor=await sessions.requireCapability(token,'settings:write',manager);
  const scope=await reviewTargetScope(manager,reviewScope(actor),input.reportId,'report');
  const [report]=await manager.query<Array<{documenting_user_id:string;group_id:string;manifest:{occurrences:SignedOccurrence[]}}>>(`select r.documenting_user_id,app_identity.organization_group(r.organization_id) group_id,s.integrity_manifest manifest from clinical.report r join clinical.signed_snapshot s on s.report_id=r.id where r.id=$1 and r.organization_id=$2 and r.status='signed' and r.synthetic=$5 and (r.expires_at is null or r.expires_at>clock_timestamp()) and ($3::boolean or r.documenting_user_id=$4)`,[input.reportId,scope.organizationId,scope.reports==='all',scope.userId,input.dataset==='synthetic']);
  if(!report)throw new NotFoundException();
  if(!reviewIdentifying(scope,report.documenting_user_id))throw new ForbiddenException();
  if(cosEligibility(report.manifest.occurrences)!=='transported')throw new ConflictException({code:'hospital.cos.remapUnsafe'});
  await manager.query('select group_id from app_identity.group_authentication_policy where group_id=$1 for update',[report.group_id]);
  const [replay]=await manager.query<Array<{id:string;command_sha256:string}>>('select id,command_sha256 from clinical.cos_delivery where command_id=$1',[input.commandId]);
  if(replay){if(replay.command_sha256!==digest)throw new ConflictException();return replay.id;}
  const [state]=await manager.query<Array<{active_revision:string;state_revision:string}>>('select active_revision,state_revision from app_identity.hospital_cos_state where group_id=$1 for update',[report.group_id]);
  if(Number(state?.active_revision)!==input.configurationRevision||Number(state?.state_revision)!==input.stateRevision)throw new ConflictException({code:'hospital.stale'});
  const [parent]=await manager.query<Array<{id:string;snapshot_id:string;amendment_sequence:number;pdf_language:string;state:string}>>(`select d.* from clinical.cos_delivery d where d.id=$1 and d.report_id=$2 and d.organization_id=$3 and d.group_id=$4 for update`,[input.parentId,input.reportId,scope.organizationId,report.group_id]);
  if(!parent||parent.state!=='waiting')throw new ConflictException({code:'hospital.cos.remapUnsafe'});
  const [effects]=await manager.query<Array<{present:boolean}>>(`select exists(select 1 from clinical.cos_attempt where delivery_id=$1) or exists(select 1 from clinical.cos_payload where delivery_id=$1) present`,[parent.id]);
  if(effects?.present)throw new ConflictException({code:'hospital.cos.remapUnsafe'});
  const [version]=await manager.query<Array<{canonical_mapping:CanonicalPackage}>>(`select canonical_mapping from app_identity.hospital_cos_version where group_id=$1 and revision=$2 and settings->>'mode'='simulator'`,[report.group_id,input.configurationRevision]);
  if(!version)throw new ConflictException({code:'hospital.stale'});
  const mapping=cosMappingPackage(version.canonical_mapping).definition,id=randomUUID();
  await manager.query(`insert into clinical.cos_delivery(id,report_id,snapshot_id,organization_id,group_id,configuration_revision,mapping_id,mapping_revision,mapping_sha256,amendment_sequence,lineage_parent_id,queued_by,pdf_language,command_id,command_sha256) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,[id,input.reportId,parent.snapshot_id,scope.organizationId,report.group_id,input.configurationRevision,mapping.id,mapping.revision,version.canonical_mapping.sha256,parent.amendment_sequence,parent.id,actor.user.id,parent.pdf_language,input.commandId,digest]);
  await manager.query("update clinical.cos_delivery set state='superseded',finding=null,updated_at=clock_timestamp() where id=$1",[parent.id]);
  await manager.query(`insert into clinical.cos_delivery_event(delivery_id,report_id,actor_id,state,evidence) values($1,$2,$3,'superseded',$4::jsonb),($5,$2,$3,'pending',$6::jsonb)`,[parent.id,input.reportId,actor.user.id,JSON.stringify({childId:id}),id,JSON.stringify({parentId:parent.id,commandId:input.commandId})]);
  return id;
 });
}
