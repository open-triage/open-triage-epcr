import {BadRequestException,ConflictException,ForbiddenException,NotFoundException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import type {DataSource,EntityManager} from 'typeorm';
import type {CosConnectionSettings,CosRebuildContext,RetryCosReviewCommand} from '@open-triage/contracts';
import type {ClinicianSessionService} from '../sessions/clinician-session.service.js';
import {reviewIdentifying,reviewScope,reviewTargetScope} from '../review/review-scope.js';
import {commandSha256} from '../reports/draft-report.validation.js';
import {recordPatientAccess} from '../reports/patient-access-audit.js';
import {contentDigest,type CanonicalPackage} from '../admin/canonical-package.js';
import {signedReportSource,loadSignedReportPdfPhotos} from '../reports/signed-report-pdf.persistence.js';
import {renderSignedReportPdf} from '../reports/signed-report-pdf.js';
import {resolveCosExportContext} from './cos-export-context.js';
import {buildCosPayload,cosIdentifierRequirements} from './cos-payload.js';
import {cosMappingPackage} from './cos-configuration.js';
import {prepareCosArtifacts,pinCosTransportTime} from './cos-live-delivery.js';
import {reconcileCosFailure} from './cos-recovery-review.js';
type Delivery={id:string;report_id:string;snapshot_id:string;organization_id:string;group_id:string;configuration_revision:string;amendment_sequence:number;pdf_language:'en'|'sv';state:string};
async function target(manager:EntityManager,sessions:ClinicianSessionService,token:string,itemId:string,dataset:string,lock=false){
 if(!['real','synthetic'].includes(dataset))throw new BadRequestException();
 const actor=await sessions.get(token,new Date(),false,manager);
 const scope=await reviewTargetScope(manager,reviewScope(actor),itemId,'item');
 const [candidate]=await manager.query<Array<{report_id:string}>>('select report_id from clinical.review_item where id=$1 and organization_id=$2',[itemId,scope.organizationId]);
 if(!candidate)throw new NotFoundException();
 if(lock){const [held]=await manager.query<Array<{locked:boolean}>>('select pg_try_advisory_xact_lock(731013,hashtext($1)) locked',[candidate.report_id]);if(!held?.locked)throw new ConflictException('COS delivery is in progress');}
 const [report]=await manager.query<Array<{documenting_user_id:string;group_id:string}>>(`select documenting_user_id,app_identity.organization_group(organization_id) group_id from clinical.report where id=$1 and organization_id=$2 and synthetic=$3 and status='signed' and (expires_at is null or expires_at>clock_timestamp()) and ($4::boolean or documenting_user_id=$5) ${lock?'for update':''}`,[candidate.report_id,scope.organizationId,dataset==='synthetic',scope.reports==='all',scope.userId]);
 if(!report)throw new NotFoundException();
 if(!reviewIdentifying(scope,report.documenting_user_id))throw new ForbiddenException();
 const [item]=await manager.query<Array<{version:string;assignee_id:string|null;independent_review:boolean;active_match:boolean}>>(`select i.version,i.assignee_id,i.active_match,coalesce(route.independent_review,false) independent_review from clinical.review_item i left join clinical.review_criterion_route route on route.organization_id=i.organization_id and route.criterion_id=i.criterion_id where i.id=$1 and i.report_id=$2 and i.kind='cos-delivery-failed' ${lock?'for update of i':''}`,[itemId,candidate.report_id]);
 if(!item)throw new NotFoundException();
 if(item.assignee_id!==scope.userId||item.independent_review&&report.documenting_user_id===scope.userId)throw new ForbiddenException('Only the eligible assigned reviewer can rebuild');
 const [delivery]=await manager.query<Delivery[]>(`select * from clinical.cos_delivery where report_id=$1 order by amendment_sequence desc,created_at desc,id desc limit 1 ${lock?'for update':''}`,[candidate.report_id]);
 if(!delivery)throw new NotFoundException();
 const [state]=await manager.query<Array<{active_revision:string|null;state_revision:string;compatible:boolean;uncertain:boolean;newer:boolean}>>(`select s.active_revision,s.state_revision,app_identity.cos_configuration_compatible(s.group_id,$2,s.active_revision) compatible,exists(select 1 from clinical.cos_delivery where report_id=$3 and state='uncertain') uncertain,exists(select 1 from clinical.amendment where report_id=$3 and sequence>$4) newer from app_identity.hospital_cos_state s where group_id=$1 ${lock?'for share of s':''}`,[report.group_id,delivery.configuration_revision,delivery.report_id,delivery.amendment_sequence]);
 if(!state)throw new NotFoundException();
 const reason:CosRebuildContext['reason']=!state.compatible?'configurationChanged':state.newer?'versionChanged':!item.active_match||!['failed','uncertain'].includes(delivery.state)?'alreadyPrepared':null;
 const context:CosRebuildContext={available:reason===null,blockedByUncertain:state.uncertain,reason,deliveryId:delivery.id,amendmentSequence:delivery.amendment_sequence,configurationRevision:Number(delivery.configuration_revision),stateRevision:Number(state.state_revision),expectedVersion:Number(item.version)};
 return {scope,actor,item,delivery,state,context};
}
export async function cosRebuildContext(database:DataSource,sessions:ClinicianSessionService,token:string,itemId:string,dataset:string){return database.transaction(manager=>target(manager,sessions,token,itemId,dataset).then(value=>value.context));}
/** Creates an immutable prepared copy only. No network request occurs here, and
 * the original uncertain delivery remains the worker's report-wide barrier. */
export async function rebuildCosReview(database:DataSource,sessions:ClinicianSessionService,token:string,itemId:string,input:RetryCosReviewCommand,csrfToken?:string){
 const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
 if(!input||!uuid(input.commandId)||!uuid(input.deliveryId)||![input.expectedVersion,input.amendmentSequence,input.configurationRevision,input.stateRevision].every(v=>Number.isSafeInteger(v)&&v>=0))throw new BadRequestException('Invalid COS rebuild command');
 const digest=commandSha256({...input,itemId});
 return database.transaction(async manager=>{
  await sessions.lockPersonalAuthenticationContext(manager,null,token);await sessions.assertCsrf(token,csrfToken,manager);
  const {scope,actor,delivery,state,context}=await target(manager,sessions,token,itemId,input.dataset,true);
  const [replay]=await manager.query<Array<{id:string;command_sha256:string;queued_by:string}>>('select id,command_sha256,queued_by from clinical.cos_delivery where command_id=$1',[input.commandId]);
  if(replay){if(replay.command_sha256!==digest||replay.queued_by!==scope.userId)throw new ConflictException('Rebuild command already used');return replay.id;}
  if(!context.available||(['deliveryId','amendmentSequence','configurationRevision','stateRevision','expectedVersion'] as const).some(key=>context[key]!==input[key]))throw new ConflictException({code:'hospital.cos.rebuildStale'});
  const [version]=await manager.query<Array<{settings:CosConnectionSettings;canonical_mapping:CanonicalPackage}>>('select settings,canonical_mapping from app_identity.hospital_cos_version where group_id=$1 and revision=$2',[delivery.group_id,state.active_revision]);
  if(!version)throw new ConflictException({code:'hospital.cos.rebuildStale'});
  const source=await signedReportSource(manager,delivery.report_id,delivery.snapshot_id,delivery.amendment_sequence);
  const [repair]=await manager.query<Array<{revision:number}>>(`select (evidence->'repair'->>'acceptedDestinationRevision')::integer revision from clinical.cos_delivery_event where delivery_id=$1 and evidence->'repair'->>'destinationRevisionAccepted'='true' order by created_at limit 1`,[delivery.id]);
  const resolved=await resolveCosExportContext(manager,source,version.settings,{acceptDestinationRevision:!!repair,expectedDestinationRevision:repair?.revision});
  if([...cosIdentifierRequirements(source,version.canonical_mapping,resolved.settings).missing,...resolved.missing].length)throw new ConflictException({code:'hospital.cos.rebuildIdentifiers'});
  const id=randomUUID(),pdf=await renderSignedReportPdf(await loadSignedReportPdfPhotos(manager,source),delivery.pdf_language);
  const payload=buildCosPayload(source,version.canonical_mapping,resolved.settings,pdf,id);
  const prior=await manager.query<Array<{contact:typeof payload.contact;updated:string}>>(`select contact,bundle->'meta'->>'lastUpdated' updated from clinical.cos_payload where report_id=$1`,[delivery.report_id]);
  const binding=(contact:typeof payload.contact)=>({patient:contact.patient,encounter:contact.encounter,staff:contact.staff,organization:contact.organization,careUnit:contact.careUnit});
  if(prior.some(row=>contentDigest(binding(row.contact))!==contentDigest(binding(payload.contact))))throw new ConflictException({code:'hospital.cos.rebuildIdentityChanged'});
  if(version.settings.mode==='live')pinCosTransportTime(payload,prior.map(row=>row.updated),new Date());
  const mapping=cosMappingPackage(version.canonical_mapping).definition;
  await manager.query(`insert into clinical.cos_delivery(id,report_id,snapshot_id,organization_id,group_id,configuration_revision,mapping_id,mapping_revision,mapping_sha256,amendment_sequence,lineage_parent_id,queued_by,pdf_language,command_id,command_sha256) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,[id,delivery.report_id,delivery.snapshot_id,delivery.organization_id,delivery.group_id,state.active_revision,mapping.id,mapping.revision,version.canonical_mapping.sha256,delivery.amendment_sequence,delivery.id,scope.userId,delivery.pdf_language,input.commandId,digest]);
  await manager.query(`insert into clinical.cos_payload(delivery_id,report_id,bundle,pdf,payload_sha256,pdf_sha256,contact,contact_sha256) values($1,$2,$3::jsonb,$4,$5,$6,$7::jsonb,$8)`,[id,delivery.report_id,JSON.stringify(payload.bundle),pdf,payload.payloadSha256,payload.pdfSha256,JSON.stringify(payload.contact),payload.contactSha256]);
  if(version.settings.mode==='live')await prepareCosArtifacts(manager,id,source,payload,{...resolved.context,ambulanceOrganizations:{careProviderHsaId:resolved.settings.organizationHsaId,careUnitHsaId:resolved.settings.defaultAmbulanceCareUnit}});
  const finding=context.blockedByUncertain?'rebuildAwaitingReconciliation':null;
  await manager.query('update clinical.cos_delivery set finding=$2 where id=$1',[id,finding]);
  await manager.query(`insert into clinical.cos_delivery_event(delivery_id,report_id,actor_id,state,finding,evidence) values($1,$2,$3,'pending',$4,$5::jsonb)`,[id,delivery.report_id,scope.userId,finding,JSON.stringify({action:'rebuild',commandId:input.commandId,parentDeliveryId:delivery.id,blockedByUncertain:context.blockedByUncertain,...(repair?{repair:{destinationRevisionAccepted:true,acceptedDestinationRevision:repair.revision}}:{})})]);
  if(delivery.state==='failed'){
   await manager.query("update clinical.cos_delivery set state='superseded',updated_at=clock_timestamp() where id=$1",[delivery.id]);
   await manager.query('update clinical.cos_retry_state set next_due=null where delivery_id=$1',[delivery.id]);
   await manager.query(`insert into clinical.cos_delivery_event(delivery_id,report_id,actor_id,state,evidence) values($1,$2,$3,'superseded',$4::jsonb)`,[delivery.id,delivery.report_id,scope.userId,JSON.stringify({action:'rebuildSuperseded',childDeliveryId:id,commandId:input.commandId})]);
  }
  await recordPatientAccess(manager,{organizationId:scope.organizationId,actorId:scope.userId,accessOrganizationId:actor.organization.id,reportIds:[delivery.report_id],action:'review.report',careProcess:'review'});
  await reconcileCosFailure(manager,delivery.report_id);
  return id;
 });
}
