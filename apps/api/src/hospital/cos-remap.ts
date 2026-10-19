import { recordPatientAccess } from '../reports/patient-access-audit.js';
import { signedReportSource } from '../reports/signed-report-pdf.persistence.js';
import type { CosConnectionSettings, CosMappingRepairContext } from '@open-triage/contracts';
import { contentDigest } from '../admin/canonical-package.js';
import { reconcileTransmissionReview } from '../review/review-transmission.js';
import { effectiveSignedPdfOccurrences } from '../reports/signed-report-pdf.js';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import type { ClinicianSessionService } from '../sessions/clinician-session.service.js';
import { reviewScope, reviewTargetScope, reviewIdentifying } from '../review/review-scope.js';
import { commandSha256 } from '../reports/draft-report.validation.js';
import { cosMappingPackage } from './cos-configuration.js';
import { cosEligible } from './cos-eligibility.js';
import { resolveSignedCosCareUnit, cosIdentifierRequirements } from './cos-payload.js';
import type { SignedOccurrence } from '../reports/signed-report-pdf.js';
import type { CanonicalPackage } from '../admin/canonical-package.js';
/** Explicit administrator revalidation of waiting Review work.
 * Both configuration authority and scoped identifying report access are required.
 * Only waiting work with NO prepared payload or attempt may be deliberately remapped.
 */
export async function remapWaitingCos(database:DataSource,sessions:ClinicianSessionService,token:string,input:{dataset:'real'|'synthetic';reportId:string;parentId:string;commandId:string;configurationRevision:number;stateRevision:number;acceptRecipientChange?:boolean;acceptPatientMappingChange?:boolean;itemId?:string;expectedVersion?:number;csrfToken?:string}){
 const {csrfToken: _csrfToken,...recordedInput}=input;
 const digest=commandSha256(recordedInput);
 return database.transaction(async manager=>{
  await sessions.lockPersonalAuthenticationContext(manager,null,token);
  if(input.itemId)await sessions.assertCsrf(token,input.csrfToken,manager);
  const actor=await sessions.requireCapability(token,'settings:write',manager);
  const scope=await reviewTargetScope(manager,reviewScope(actor),input.reportId,'report');
  const [workerLock]=await manager.query<Array<{locked:boolean}>>('select pg_try_advisory_xact_lock(731013,hashtext($1)) locked',[input.reportId]);
  if(!workerLock?.locked)throw new ConflictException({code:'hospital.cos.remapUnsafe'});
  const [report]=await manager.query<Array<{documenting_user_id:string;group_id:string;manifest:{occurrences:SignedOccurrence[]}}>>(`select r.documenting_user_id,app_identity.organization_group(r.organization_id) group_id,s.integrity_manifest manifest from clinical.report r join clinical.signed_snapshot s on s.report_id=r.id where r.id=$1 and r.organization_id=$2 and r.status='signed' and r.synthetic=$5 and (r.expires_at is null or r.expires_at>clock_timestamp()) and ($3::boolean or r.documenting_user_id=$4) for update of r`,[input.reportId,scope.organizationId,scope.reports==='all',scope.userId,input.dataset==='synthetic']);
  if(!report)throw new NotFoundException();
  if(!reviewIdentifying(scope,report.documenting_user_id))throw new ForbiddenException();
  await manager.query('select group_id from app_identity.group_authentication_policy where group_id=$1 for update',[report.group_id]);
  const [replay]=await manager.query<Array<{id:string;command_sha256:string}>>('select id,command_sha256 from clinical.cos_delivery where command_id=$1',[input.commandId]);
  if(replay){if(replay.command_sha256!==digest)throw new ConflictException();return replay.id;}
  if(input.itemId){
   const [item]=await manager.query<Array<{version:string}>>(`select version from clinical.review_item where id=$1 and report_id=$2 and organization_id=$3 and kind='missing-transmission-identifiers' and transmission_reason='integration-mapping' for update`,[input.itemId,input.reportId,scope.organizationId]);
   if(!item||Number(item.version)!==input.expectedVersion)throw new ConflictException({code:'hospital.stale'});
  }
  const [state]=await manager.query<Array<{active_revision:string;state_revision:string}>>('select active_revision,state_revision from app_identity.hospital_cos_state where group_id=$1 for update',[report.group_id]);
  if(Number(state?.active_revision)!==input.configurationRevision||Number(state?.state_revision)!==input.stateRevision)throw new ConflictException({code:'hospital.stale'});
  const [parent]=await manager.query<Array<{id:string;snapshot_id:string;amendment_sequence:number;pdf_language:string;state:string}>>(`select d.* from clinical.cos_delivery d where d.id=$1 and d.report_id=$2 and d.organization_id=$3 and d.group_id=$4 for update`,[input.parentId,input.reportId,scope.organizationId,report.group_id]);
  if(!parent||parent.state!=='waiting')throw new ConflictException({code:'hospital.cos.remapUnsafe'});
  const [newer]=await manager.query("select id from clinical.cos_delivery where report_id=$1 and (amendment_sequence>$2 or state='uncertain' or exists(select 1 from clinical.amendment where report_id=$1 and sequence>$2)) limit 1",[input.reportId,parent.amendment_sequence]);
  if(newer)throw new ConflictException({code:'hospital.cos.remapUnsafe'});
  const source=await signedReportSource(manager,input.reportId,parent.snapshot_id,parent.amendment_sequence);
  if(!cosEligible(effectiveSignedPdfOccurrences(source)))throw new ConflictException({code:'hospital.cos.remapUnsafe'});
  const [effects]=await manager.query<Array<{present:boolean}>>(`select exists(select 1 from clinical.cos_attempt a join clinical.cos_delivery d on d.id=a.delivery_id where d.report_id=$1 and d.amendment_sequence=$2) or exists(select 1 from clinical.cos_payload p join clinical.cos_delivery d on d.id=p.delivery_id where d.report_id=$1 and d.amendment_sequence=$2) present`,[input.reportId,parent.amendment_sequence]);
  if(effects?.present)throw new ConflictException({code:'hospital.cos.remapUnsafe'});
  const [version]=await manager.query<Array<{canonical_mapping:CanonicalPackage;settings:CosConnectionSettings;endpoint:string}>>(`select canonical_mapping,settings,endpoint from app_identity.hospital_cos_version where group_id=$1 and revision=$2 and settings->>'mode'='simulator'`,[report.group_id,input.configurationRevision]);
  if(!version)throw new ConflictException({code:'hospital.stale'});
  const [oldVersion]=await manager.query<Array<{canonical_mapping:CanonicalPackage;settings:CosConnectionSettings;endpoint:string}>>(`select v.canonical_mapping,v.settings,v.endpoint from clinical.cos_delivery d join app_identity.hospital_cos_version v on v.group_id=d.group_id and v.revision=d.configuration_revision where d.id=$1`,[parent.id]);
  if(!oldVersion)throw new ConflictException({code:'hospital.cos.remapUnsafe'});
  const conflicts=mappingRepairConflicts(source,oldVersion,version);
  if(conflicts.includes('patientIdentifier')&&!input.acceptPatientMappingChange)throw new ConflictException({code:'hospital.cos.patientMappingConflict'});
  if(conflicts.includes('recipient')&&!input.acceptRecipientChange)throw new ConflictException({code:'hospital.cos.recipientConflict'});
  if(Number((parent as unknown as {configuration_revision:string}).configuration_revision)===input.configurationRevision)return parent.id;
  const priorRequirements=cosIdentifierRequirements(source,oldVersion.canonical_mapping,oldVersion.settings);
  const requirements=cosIdentifierRequirements(source,version.canonical_mapping,version.settings);
  const [oldDelivery]=await manager.query<Array<{configuration_revision:string;mapping_id:string;mapping_revision:number;mapping_sha256:string}>>('select configuration_revision,mapping_id,mapping_revision,mapping_sha256 from clinical.cos_delivery where id=$1',[parent.id]);
  const repair={previousConfigurationRevision:Number(oldDelivery!.configuration_revision),previousMappingId:oldDelivery!.mapping_id,previousMappingRevision:oldDelivery!.mapping_revision,previousMappingSha256:oldDelivery!.mapping_sha256,satisfied:priorRequirements.missing.filter(code=>!requirements.missing.includes(code)),remaining:requirements.missing,recipientChangeAccepted:conflicts.includes('recipient')&&!!input.acceptRecipientChange,patientMappingChangeAccepted:conflicts.includes('patientIdentifier')&&!!input.acceptPatientMappingChange,previousPatientSelector:cosMappingPackage(oldVersion.canonical_mapping).definition.patientIdentifier,patientSelector:cosMappingPackage(version.canonical_mapping).definition.patientIdentifier};
  const mapping=cosMappingPackage(version.canonical_mapping).definition,id=randomUUID();
  await manager.query(`insert into clinical.cos_delivery(id,report_id,snapshot_id,organization_id,group_id,configuration_revision,mapping_id,mapping_revision,mapping_sha256,amendment_sequence,lineage_parent_id,queued_by,pdf_language,command_id,command_sha256) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,[id,input.reportId,parent.snapshot_id,scope.organizationId,report.group_id,input.configurationRevision,mapping.id,mapping.revision,version.canonical_mapping.sha256,parent.amendment_sequence,parent.id,actor.user.id,parent.pdf_language,input.commandId,digest]);
  if(requirements.missing.length)await manager.query("update clinical.cos_delivery set state='waiting',finding=$2 where id=$1",[id,requirements.missing[0]]);
  await manager.query("update clinical.cos_delivery set state='superseded',finding=null,updated_at=clock_timestamp() where id=$1",[parent.id]);
  await manager.query(`insert into clinical.cos_delivery_event(delivery_id,report_id,actor_id,state,evidence) values($1,$2,$3,'superseded',$4::jsonb),($5,$2,$3,$7,$6::jsonb)`,[parent.id,input.reportId,actor.user.id,JSON.stringify({childId:id}),id,JSON.stringify({parentId:parent.id,commandId:input.commandId,repair}),requirements.missing.length?'waiting':'pending']);
  await reconcileTransmissionReview(manager,input.reportId,{integration:'cos',deliveryId:id,amendmentSequence:parent.amendment_sequence,configurationRevision:String(input.configurationRevision),mappingId:mapping.id,mappingRevision:mapping.revision,mappingSha256:version.canonical_mapping.sha256,...requirements,repair});
  return id;
 });
}

type RepairVersion={canonical_mapping:CanonicalPackage;settings:CosConnectionSettings;endpoint:string};
/** Changing an established patient selector requires explicit same-patient verification.
 * Recipient/encounter changes require a deliberate administrator acknowledgement before preparation. */
export function mappingRepairConflicts(source:Parameters<typeof cosIdentifierRequirements>[0],previous:RepairVersion,next:RepairVersion):CosMappingRepairContext['conflicts'] {
 const old=cosMappingPackage(previous.canonical_mapping).definition.patientIdentifier;
 const current=cosMappingPackage(next.canonical_mapping).definition.patientIdentifier;
 const conflicts:CosMappingRepairContext['conflicts']=[];
 if(contentDigest({field:old.field,namespace:old.namespace})!==contentDigest({field:current.field,namespace:current.namespace}))conflicts.push('patientIdentifier');
 const recipient=(version:RepairVersion)=>{let careUnit:string|null=null;try{careUnit=resolveSignedCosCareUnit(source,version.settings);}catch{/* An absent old target is a blocker being repaired, never a guessed recipient. */}return {endpoint:version.endpoint,mode:version.settings.mode,organization:version.settings.organizationHsaId,encounter:version.settings.encounterNamespace,template:version.settings.template,careUnit};};
 // Filling an absent mapping is a repair. Changing any established routing semantics requires acknowledgement.
 const oldRecipient=recipient(previous),newRecipient=recipient(next);
 const changed=Object.keys(oldRecipient).some(key=>{const field=key as keyof typeof oldRecipient;const value=oldRecipient[field];return value!==''&&value!==undefined&&value!==null&&!(Array.isArray(value)&&!value.length)&&contentDigest(value)!==contentDigest(newRecipient[field]);});
 if(changed)conflicts.push('recipient');
 return conflicts;
}

export function patientBinding(source:Parameters<typeof cosIdentifierRequirements>[0],version:RepairVersion){
 const identifier=cosMappingPackage(version.canonical_mapping).definition.patientIdentifier;
 const rows=effectiveSignedPdfOccurrences(source).filter(row=>identifier.field.kind==='custom'?row.element_identity_id===identifier.field.elementDefinitionId:row.element_id===identifier.field.elementId);
 const row=rows.length===1?rows[0]:undefined;
 return {field:identifier.field,namespace:identifier.namespace,value:row?.value_kind==='text'&&typeof row.value_text==='string'&&!row.not_value_code&&!row.pertinent_negative_code?row.value_text:null};
}
/** Read-only preview uses exactly the same immutable source and authority as the command. */
export async function cosMappingRepairContext(database:DataSource,sessions:ClinicianSessionService,token:string,itemId:string,dataset:string):Promise<CosMappingRepairContext>{
 if(!['real','synthetic'].includes(dataset))throw new NotFoundException();
 return database.transaction(async manager=>{
  await sessions.lockPersonalAuthenticationContext(manager,null,token);
  const actor=await sessions.requireCapability(token,'settings:write',manager);
  const scope=await reviewTargetScope(manager,reviewScope(actor),itemId,'item');
  const [item]=await manager.query<Array<{report_id:string;version:string;documenting_user_id:string;group_id:string}>>(`select i.report_id,i.version,r.documenting_user_id,app_identity.organization_group(r.organization_id) group_id from clinical.review_item i join clinical.report r on r.id=i.report_id where i.id=$1 and i.organization_id=$2 and r.organization_id=$2 and r.synthetic=$3 and r.status='signed' and (r.expires_at is null or r.expires_at>clock_timestamp()) and ($4::boolean or r.documenting_user_id=$5) and i.kind='missing-transmission-identifiers' and i.transmission_reason='integration-mapping'`,[itemId,scope.organizationId,dataset==='synthetic',scope.reports==='all',scope.userId]);
  if(!item)throw new NotFoundException();
  if(!reviewIdentifying(scope,item.documenting_user_id))throw new ForbiddenException();
  const [delivery]=await manager.query<Array<{id:string;snapshot_id:string;state:string;amendment_sequence:number;configuration_revision:string;mapping_revision:number;prepared:boolean;barrier:boolean}>>(`select d.*,exists(select 1 from clinical.cos_attempt a join clinical.cos_delivery prior on prior.id=a.delivery_id where prior.report_id=d.report_id and prior.amendment_sequence=d.amendment_sequence) or exists(select 1 from clinical.cos_payload p join clinical.cos_delivery prior on prior.id=p.delivery_id where prior.report_id=d.report_id and prior.amendment_sequence=d.amendment_sequence) prepared,exists(select 1 from clinical.cos_delivery where report_id=d.report_id and state='uncertain') barrier from clinical.cos_delivery d where d.report_id=$1 order by amendment_sequence desc,created_at desc,id desc limit 1`,[item.report_id]);
  if(!delivery)throw new NotFoundException();
  const [state]=await manager.query<Array<{active_revision:string|null;state_revision:string}>>('select active_revision,state_revision from app_identity.hospital_cos_state where group_id=$1',[item.group_id]);
  if(!state?.active_revision)throw new ConflictException({code:'hospital.stale'});
  const versions=await manager.query<Array<RepairVersion&{revision:string}>>('select canonical_mapping,settings,endpoint,revision from app_identity.hospital_cos_version where group_id=$1 and revision=any($2::bigint[])',[item.group_id,[delivery.configuration_revision,state.active_revision]]);
  const previous=versions.find(v=>v.revision===delivery.configuration_revision),active=versions.find(v=>v.revision===state.active_revision);
  if(!previous||!active)throw new ConflictException({code:'hospital.stale'});
  const source=await signedReportSource(manager,item.report_id,delivery.snapshot_id,delivery.amendment_sequence);
  await recordPatientAccess(manager,{organizationId:scope.organizationId,actorId:scope.userId,accessOrganizationId:actor.organization.id,reportIds:[item.report_id],action:'review.report',careProcess:'review'});
  return {deliveryId:delivery.id,reportId:item.report_id,expectedVersion:Number(item.version),configurationRevision:Number(state.active_revision),stateRevision:Number(state.state_revision),previousConfigurationRevision:Number(delivery.configuration_revision),previousMappingRevision:delivery.mapping_revision,mappingRevision:cosMappingPackage(active.canonical_mapping).definition.revision,missing:cosIdentifierRequirements(source,active.canonical_mapping,active.settings).missing,conflicts:mappingRepairConflicts(source,previous,active),safe:delivery.state==='waiting'&&!delivery.prepared&&!delivery.barrier,previousPatient:patientBinding(source,previous),patient:patientBinding(source,active)};
 });
}
