import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { hospitalFieldId, resolveHospitalIdentifier, hospitalIdentifierSchemeFinding, type ReviewIdentifierCorrectionCommand, type ReviewIdentifierCorrectionContext, type CosConnectionSettings } from '@open-triage/contracts';
import type { DataSource, EntityManager } from 'typeorm';
import type { ClinicianSessionService } from '../sessions/clinician-session.service.js';
import { reviewScope, reviewTargetScope, reviewIdentifying } from './review-scope.js';
import { cosMappingPackage, compileCosMapping } from '../hospital/cos-configuration.js';
import type { CanonicalPackage } from '../admin/canonical-package.js';
import { signedReportPdfSource } from '../reports/signed-report-pdf.persistence.js';
import { effectiveSignedPdfOccurrences } from '../reports/signed-report-pdf.js';
import { encounterDocument } from '../reports/encounter-document.persistence.js';
import { AmendReportService } from '../reports/amend-report.service.js';
import { commandSha256 } from '../reports/draft-report.validation.js';
import type { AmendmentChange } from '../reports/amend-report.types.js';
import { cosIdentifierRequirements } from '../hospital/cos-payload.js';
import { reconcileTransmissionReview } from './review-transmission.js';
import { recordPatientAccess } from '../reports/patient-access-audit.js';

const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
async function authorized(manager: EntityManager, sessions: ClinicianSessionService, token: string, itemId: string, dataset: string) {
 await sessions.lockPersonalAuthenticationContext(manager,null,token);
 const session=await sessions.get(token,new Date(),false,manager);
 const scope=await reviewTargetScope(manager,reviewScope(session),itemId,'item');
 if(!['real','synthetic'].includes(dataset))throw new BadRequestException();
 const [report]=await manager.query<Array<{id:string;documenting_user_id:string;revision:number;group_id:string;snapshot_id:string}>>(`select r.id,r.documenting_user_id,r.revision,app_identity.organization_group(r.organization_id) group_id,s.id snapshot_id
 from clinical.review_item i join clinical.report r on r.id=i.report_id join clinical.signed_snapshot s on s.report_id=r.id
 where i.id=$1 and i.organization_id=$2 and r.organization_id=$2 and r.synthetic=$3 and r.status='signed'
 and (r.expires_at is null or r.expires_at>clock_timestamp()) and ($4::boolean or r.documenting_user_id=$5) for update of r`,[itemId,scope.organizationId,dataset==='synthetic',scope.reports==='all',scope.userId]);
 if(!report)throw new NotFoundException();
 if(!reviewIdentifying(scope,report.documenting_user_id))throw new ForbiddenException();
 // Match queue/activation ordering: report, group, state, agency, then item.
 await manager.query('select group_id from app_identity.group_authentication_policy where group_id=$1 for update',[report.group_id]);
 const [state]=await manager.query<Array<{active_revision:string|null;state_revision:string}>>('select active_revision,state_revision from app_identity.hospital_cos_state where group_id=$1 for update',[report.group_id]);
 await manager.query('select id from app_identity.organization where id=$1 for share',[scope.organizationId]);
 const [item]=await manager.query<Array<{version:string;status:string;assignee_id:string|null;independent_review:boolean}>>(`select i.version,i.status,i.assignee_id,coalesce(route.independent_review,false) independent_review from clinical.review_item i
 left join clinical.review_criterion_route route on route.organization_id=i.organization_id and route.criterion_id=i.criterion_id
 where i.id=$1 and i.organization_id=$2 and i.kind='missing-transmission-identifiers' and i.transmission_reason='patient-identity' for update of i`,[itemId,scope.organizationId]);
 if(!item)throw new NotFoundException();
 if(item.assignee_id!==scope.userId||(item.independent_review&&report.documenting_user_id===scope.userId))throw new ForbiddenException();
 return {scope,session,report,item,state};
}
async function configuration(manager:EntityManager,auth:Awaited<ReturnType<typeof authorized>>){
 const {report,state}=auth;
 if(!state?.active_revision)throw new ConflictException({code:'hospital.stale'});
 const [version]=await manager.query<Array<{canonical_mapping:CanonicalPackage;settings:CosConnectionSettings}>>(`select canonical_mapping,settings from app_identity.hospital_cos_version where group_id=$1 and revision=$2 and settings->>'mode'='simulator'`,[report.group_id,state.active_revision]);
 if(!version)throw new ConflictException({code:'hospital.stale'});
 const [sequence]=await manager.query<Array<{sequence:number}>>('select coalesce(max(sequence),0)::integer sequence from clinical.amendment where report_id=$1',[report.id]);
 const source=await signedReportPdfSource(manager,report.id,report.snapshot_id,sequence!.sequence);
 const mapping=cosMappingPackage(version.canonical_mapping).definition;
 const patient=compileCosMapping(version.canonical_mapping,source.configuration).patientIdentifier;
 const id=hospitalFieldId(patient.field);
 const [metadata]=patient.field.kind==='custom'?[{identifying:source.configuration.customFields?.[id]?.identifying===true}]:await manager.query<Array<{identifying:boolean}>>('select identifying from catalog.analytics_element_mapping where release_id=$1 and element_id=$2',[source.catalogReleaseId,id]);
 if(!metadata?.identifying)throw new UnprocessableEntityException({code:'review.identifier.incompatible'});
 const context:ReviewIdentifierCorrectionContext={expectedVersion:Number(auth.item.version),expectedReportRevision:Number(report.revision),expectedAmendmentSequence:sequence!.sequence,
 configurationRevision:Number(state.active_revision),stateRevision:Number(state.state_revision),mappingSha256:version.canonical_mapping.sha256,
 mappingRevision:mapping.revision,field:patient.field,namespace:patient.namespace,
 label:patient.field.kind==='custom'?source.configuration.customFields![id]!.title:source.configuration.catalogFields[id]!.name??id};
 return {context,source,patient,version,mapping};
}
export async function identifierCorrectionContext(database:DataSource,sessions:ClinicianSessionService,token:string,itemId:string,dataset:string){
 return database.transaction('REPEATABLE READ',async manager=>{
  const auth=await authorized(manager,sessions,token,itemId,dataset);
  if(auth.item.status==='completed')throw new ConflictException();
  const {context}=await configuration(manager,auth);
  await recordPatientAccess(manager,{organizationId:auth.scope.organizationId,actorId:auth.scope.userId,accessOrganizationId:auth.session.organization.id,reportIds:[auth.report.id],action:'review.report',careProcess:'review'});
  return context;
 });
}
export async function correctReviewIdentifier(database:DataSource,sessions:ClinicianSessionService,token:string,itemId:string,command:ReviewIdentifierCorrectionCommand,csrfToken?:string){
 if(!command||!uuid(command.commandId)||typeof command.value!=='string'||!command.value.trim()||command.value.length>512||/[\u0000-\u001f]/.test(command.value)||typeof command.reason!=='string'||!command.reason.trim()||command.reason.length>2000||command.attested!==true||!command.context)throw new BadRequestException();
 const digest=commandSha256({itemId,command});
 return database.transaction('SERIALIZABLE',async manager=>{
  await sessions.assertCsrf(token,csrfToken,manager);
  const auth=await authorized(manager,sessions,token,itemId,command.dataset);
  await manager.query('select pg_advisory_xact_lock(hashtext($1))',[command.commandId]);
  const [replay]=await manager.query<Array<{request_sha256:string;response_body:{actorId:string}}>>(`select request_sha256,response_body from clinical.command_receipt where idempotency_key=$1`,[command.commandId]);
  if(replay){if(replay.request_sha256!==digest||replay.response_body.actorId!==auth.scope.userId)throw new ConflictException();return replay.response_body;}
  if(auth.item.status==='completed')throw new ConflictException();
  const {context,source,patient,version,mapping}=await configuration(manager,auth);
  if(commandSha256(command.context)!==commandSha256(context)||command.namespace!==patient.namespace)throw new ConflictException({code:'hospital.stale'});
  if(hospitalIdentifierSchemeFinding(command.namespace,command.value))throw new UnprocessableEntityException({code:'review.identifier.scheme'});
  const fieldId=hospitalFieldId(patient.field),rows=effectiveSignedPdfOccurrences(source).filter(row=>patient.field.kind==='custom'?row.element_identity_id===fieldId:row.element_id===fieldId);
  if(rows.length>1)throw new UnprocessableEntityException({code:'review.identifier.ambiguous'});
  let change:AmendmentChange;
  if(rows[0])change={action:'replace',targetElementOccurrenceId:rows[0].id,value:{kind:'text',value:command.value}};
  else {
   const custom=patient.field.kind==='custom'?source.configuration.customFields![fieldId]:undefined;
   const elementId=custom?`${custom.namespace}.${custom.slug}`:fieldId;
   const [standard]=custom?[]:await manager.query<Array<{group_path:string[]}>>('select group_path from catalog.element_definition where release_id=$1 and element_id=$2',[source.catalogReleaseId,fieldId]);
   const groupId=custom?(custom.correlatesTo??'PatientCareReportGroup'):standard?.group_path.at(-1);
   if(!groupId)throw new UnprocessableEntityException();
   const groups=source.groups.filter(group=>group.group_id===groupId);
   const fields=source.configuration.definition.sections.flatMap(section=>section.fields).filter(field=>field.source.kind===patient.field.kind&&hospitalFieldId(field.source)===fieldId);
   if(groups.length!==1||fields.length!==1)throw new UnprocessableEntityException({code:'review.identifier.ambiguous'});
   const [formField]=await manager.query<Array<{id:string}>>('select id from forms.form_field where form_version_id=$1 and stable_key=$2',[source.formVersionId,fields[0]!.key]);
   if(!formField)throw new UnprocessableEntityException();
   change={action:'add',occurrence:{id:randomUUID(),elementId,groupInstanceId:groups[0]!.id,formFieldId:formField.id,ordinal:0,value:{kind:'text',value:command.value}}};
  }
  // Internal command ID is separate from the complete Review outcome receipt.
  const amendment=await new AmendReportService(database).amendInTransaction(manager,auth.report.id,{commandId:randomUUID(),expectedSequence:context.expectedAmendmentSequence+1,authorId:auth.scope.userId,reason:command.reason,
   attestation:{accepted:true,actorId:auth.scope.userId,action:'document-valid-identifier',itemId,configurationRevision:context.configurationRevision,mappingRevision:context.mappingRevision,mappingSha256:context.mappingSha256},changes:[change]});
  const document=await encounterDocument(manager,auth.report.id,true,amendment.amendmentSequence);
  const resolved=resolveHospitalIdentifier(patient,document,source.configuration);
  if(!resolved.identifier||resolved.identifier.system!==command.namespace||resolved.identifier.value!==command.value)throw new UnprocessableEntityException({code:'review.identifier.ambiguous'});
  const updated=await signedReportPdfSource(manager,auth.report.id,auth.report.snapshot_id,amendment.amendmentSequence);
  const [delivery]=await manager.query<Array<{id:string}>>('select id from clinical.cos_delivery where snapshot_id=$1 and amendment_sequence=$2 and lineage_parent_id is null',[auth.report.snapshot_id,amendment.amendmentSequence]);
  if(!delivery)throw new ConflictException({code:'hospital.stale'});
  const requirements=cosIdentifierRequirements(updated,version.canonical_mapping,version.settings);
  await reconcileTransmissionReview(manager,auth.report.id,{integration:'cos',deliveryId:delivery.id,amendmentSequence:amendment.amendmentSequence,configurationRevision:String(context.configurationRevision),mappingId:mapping.id,mappingRevision:mapping.revision,mappingSha256:context.mappingSha256,...requirements});
  const result={actorId:auth.scope.userId,amendmentId:amendment.amendmentId,amendmentSequence:amendment.amendmentSequence,deliveryId:delivery.id,remaining:requirements.missing,configurationRevision:context.configurationRevision,mappingSha256:context.mappingSha256};
  await manager.query(`insert into clinical.command_receipt(idempotency_key,report_id,command_type,request_sha256,response_status,response_body) values($1,$2,'review-correct-identifier',$3,201,$4::jsonb)`,[command.commandId,auth.report.id,digest,JSON.stringify(result)]);
  return result;
 }).catch((error:unknown)=>{
  const code=error&&typeof error==='object'&&'code' in error?String(error.code):null;
  if(code&&['40001','40P01','23505'].includes(code))throw new ConflictException({code:'hospital.stale'});
  throw error;
 });
}
