import {recordPatientAccess} from '../reports/patient-access-audit.js';
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import { randomUUID, createHash } from 'node:crypto';
import { hospitalIdentifiersMatch, resolveHospitalIdentifier, type EpsImportPlan, type PatientSummary } from '@open-triage/contracts';
import { ClinicianSessionService } from '../sessions/clinician-session.service.js';
import { clinicalFormConfiguration } from '../forms/clinical-form-configuration.js';
import { encounterDocument } from '../reports/encounter-document.persistence.js';
import { DraftReportService } from '../reports/draft-report.service.js';
import type { DraftOccurrenceMutation } from '../reports/draft-report.types.js';
import { EpsService } from './eps.service.js';
import { contentDigest, keys, mappingPackage } from './hospital-mapping.js';
import { importCandidate, clinicalMappings } from './eps-import-mapping.js';
const stale=()=>new ConflictException({code:'eps.stale'});
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
type Evidence={binding:string; patient:unknown; documentId:string; documentVersion:string; documentSha256:string; entry:NonNullable<PatientSummary['importEntries']>[number]; mapping:ReturnType<typeof mappingPackage>; configurationRevision:number; candidate:ReturnType<typeof importCandidate>; existing:DraftOccurrenceMutation[]; groupInstanceId:string|null; formFieldId:string|null; canAppend?:boolean};
@Injectable()
export class EpsImportService {
 constructor(@InjectDataSource() private readonly database:DataSource,private readonly sessions:ClinicianSessionService,private readonly eps:EpsService,private readonly drafts:DraftReportService){}
 private async scope(manager:EntityManager,token:string,reportId:string,lock=false) {
  if(lock)await this.sessions.lockPersonalAuthenticationContext(manager,null,token);
  const actor=await this.sessions.requireCapability(token,'clinical:document',manager);
  const [report]=await manager.query<Array<{id:string;revision:string;form_version_id:string;catalog_release_id:string;patient_id:string}>>(`select id,revision,form_version_id,catalog_release_id,patient_id from clinical.report where id=$1 and organization_id=$2 and documenting_user_id=$3 and status='draft' and (expires_at is null or expires_at>clock_timestamp()) ${lock?'for update':''}`,[reportId,actor.organization.id,actor.user.id]);
  if(!report)throw new NotFoundException();
  if(lock)await this.sessions.requireCapability(token,'clinical:document',manager,new Date());
  const [active]=await manager.query<Array<{revision:string;canonical_mapping:unknown}>>(`select v.revision,v.canonical_mapping from app_identity.hospital_eps_state s join app_identity.hospital_eps_version v on v.group_id=s.group_id and v.revision=s.active_revision where s.group_id=app_identity.organization_group($1) ${lock?'for share of s':''}`,[actor.organization.id]);
  if(!active)throw stale();
  const form=await clinicalFormConfiguration(manager,report.form_version_id,report.catalog_release_id);
  const mapping=mappingPackage(active.canonical_mapping), document=await encounterDocument(manager,reportId);
  const patient=resolveHospitalIdentifier(mapping.definition.patientIdentifier,document,form);
  if(!patient.identifier)throw stale();
  const binding=createHash('sha256').update(JSON.stringify([reportId,actor.organization.id,actor.user.id,report.patient_id,patient,active.revision,mapping.sha256])).digest('hex');
  return {actor,report,form,mapping,document,binding,patient:patient.identifier,configurationRevision:Number(active.revision)};
 }
 async history(token:string,reportId:string) {
  return this.database.transaction('REPEATABLE READ',async manager=>{
   const actor=await this.sessions.requireCapability(token,'clinical:document',manager);
   const [report]=await manager.query<Array<{form_version_id:string;catalog_release_id:string}>>(`select form_version_id,catalog_release_id from clinical.report where id=$1 and organization_id=$2 and documenting_user_id=$3 and status='draft' and (expires_at is null or expires_at>clock_timestamp())`,[reportId,actor.organization.id,actor.user.id]);
   if(!report)throw new NotFoundException();
   const form=await clinicalFormConfiguration(manager,report.form_version_id,report.catalog_release_id),document=await encounterDocument(manager,reportId);
   const imports=await manager.query<Array<{id:string;decision:string;evidence:Evidence}>>('select id,decision,evidence from clinical.eps_import where report_id=$1 order by created_at,id',[reportId]);
   const [active]=await manager.query<Array<{canonical_mapping:unknown}>>(`select v.canonical_mapping from app_identity.hospital_eps_state s join app_identity.hospital_eps_version v on v.group_id=s.group_id and v.revision=s.active_revision where s.group_id=app_identity.organization_group($1)`,[actor.organization.id]);
   const currentIdentifier=active?mappingPackage(active.canonical_mapping).definition.patientIdentifier:null;
   await recordPatientAccess(manager,{organizationId:actor.organization.id,actorId:actor.user.id,reportIds:[reportId],action:'report.read',careProcess:'documentation'});
   return {items:imports.map(({id,decision,evidence})=>({id,decision,destination:evidence.candidate.target?.label,source:evidence.candidate.incoming,documentId:evidence.documentId,documentVersion:evidence.documentVersion})),inconsistent:imports.some(({evidence})=>{const configuration=currentIdentifier??evidence.mapping.definition.patientIdentifier;const current=resolveHospitalIdentifier(configuration,document,form).identifier;return !current||!hospitalIdentifiersMatch(configuration,current,evidence.patient as {system:string;value:string});})};
  });
 }
 async rows(token:string,reportId:string,binding:string) {
  const lookup=await this.eps.lookup(token,reportId,binding);
  return this.database.transaction(async manager=>{
   const scoped=await this.scope(manager,token,reportId);
   if(scoped.binding!==binding||scoped.mapping.sha256!==lookup.context?.mappingSha256)throw stale();
   const imports=await manager.query<Array<{evidence:Evidence}>>('select evidence from clinical.eps_import where report_id=$1',[reportId]);
   return {rows:(lookup.summary?.importEntries??[]).map(entry=>{
    const candidate=importCandidate(entry,clinicalMappings(scoped.mapping.definition.clinicalMappings),scoped.form,scoped.mapping.definition.patientIdentifier);
    const {entryId,label,destination,mappingId}=candidate;
    const groupId=candidate.mapping?.destination.kind==='custom'?'PatientCareReportGroup':scoped.form.catalogFields[candidate.target?.elementId??'']?.generation?.path.at(-1);
    const groups=scoped.document.groups.find(group=>group.id===groupId)?.instances??[];
    return {entryId,label,destination,finding:candidate.finding??(groups.length===1?null:'cardinality'),mappingId};
   }),inconsistent:imports.some(i=>contentDigest(i.evidence.patient)!==contentDigest(scoped.patient))};
  });
 }
 async plan(token:string,reportId:string,input:unknown):Promise<EpsImportPlan> {
  const body=keys(input,['binding','entryId']);if(typeof body.binding!=='string'||typeof body.entryId!=='string')throw stale();
  const lookup=await this.eps.lookup(token,reportId,body.binding);
  const entries=lookup.summary?.importEntries?.filter(e=>e.identity===body.entryId)??[];
  if(entries.length!==1||!lookup.documentId||!lookup.documentSha256||!lookup.context)throw stale();
  return this.database.transaction(async manager=>{
   const scoped=await this.scope(manager,token,reportId,true);
   if(scoped.mapping.sha256!==lookup.context!.mappingSha256||scoped.configurationRevision!==lookup.context!.configurationRevision)throw stale();
   if(scoped.binding!==body.binding)throw stale();
   const entry=entries[0]!, candidate=importCandidate(entry,clinicalMappings(scoped.mapping.definition.clinicalMappings),scoped.form,scoped.mapping.definition.patientIdentifier);
   if(candidate.finding||!candidate.target)throw new UnprocessableEntityException({code:'hospital.clinicalIncompatible'});
   const sourceKey=contentDigest([lookup.documentId,lookup.summary?.documentVersion,entry.identity,entry.resource,...(entry.medication?[entry.medication]:[])]);
   const [already]=await manager.query('select id from clinical.eps_import where report_id=$1 and source_key=$2',[reportId,sourceKey]);
   const [field]=await manager.query<Array<{id:string;group_id:string|null}>>(`select ff.id,e.group_path[cardinality(e.group_path)] as group_id from forms.form_field ff left join catalog.element_definition e on e.release_id=$2 and e.element_identity_id=ff.catalog_element_identity_id where ff.form_version_id=$1 and (e.element_id=$3 or ff.custom_element_definition_id::text=$4) limit 1`,[scoped.report.form_version_id,scoped.report.catalog_release_id,candidate.target.elementId,candidate.mapping?.destination.kind==='custom'?candidate.mapping.destination.elementDefinitionId:null]);
   if(!field)throw new UnprocessableEntityException({code:'hospital.clinicalIncompatible'});
   if(!field.group_id)field.group_id='PatientCareReportGroup';
   let groupInstanceId:string|null=null;
   if(field.group_id){const groups=await manager.query<Array<{id:string}>>('select id from clinical.group_instance where report_id=$1 and group_id=$2 and tombstoned_at is null',[reportId,field.group_id]);if(groups.length!==1)throw new UnprocessableEntityException({code:'hospital.clinicalIncompatible'});groupInstanceId=groups[0]!.id;}
   const existing=await manager.query<Array<DraftOccurrenceMutation>>(`select id,element_id as "elementId",group_instance_id as "groupInstanceId",ordinal from clinical.element_occurrence where report_id=$1 and element_id=$2 and group_instance_id is not distinct from $3::uuid and tombstoned_at is null order by ordinal,id`,[reportId,candidate.target.elementId,groupInstanceId]);
   const destination=candidate.mapping!.destination;
   const canAppend=destination.kind==='custom'&&scoped.form.customFields?.[destination.elementDefinitionId]?.recurrence==='multiple';
   const evidence:Evidence={canAppend,binding:body.binding,patient:scoped.patient,documentId:lookup.documentId!,documentVersion:lookup.summary?.documentVersion??'',documentSha256:lookup.documentSha256!,entry,mapping:scoped.mapping,configurationRevision:scoped.configurationRevision,candidate,existing,groupInstanceId,formFieldId:field?.id??null};
   const id=randomUUID();
   await manager.query('delete from clinical.eps_import_plan where expires_at<clock_timestamp() or report_id=$1',[reportId]);
   await manager.query('insert into clinical.eps_import_plan(id,report_id,author_id,revision,binding,source_key,evidence) values($1,$2,$3,$4,$5,$6,$7::jsonb)',[id,reportId,scoped.actor.user.id,scoped.report.revision,body.binding,sourceKey,JSON.stringify(evidence)]);
   const existingValues=scoped.document.groups.flatMap(g=>g.instances.filter(i=>i.instanceId===groupInstanceId).flatMap(i=>i.elements)).filter(e=>e.id===candidate.target!.elementId).flatMap(e=>e.values).map(v=>v.kind==='coded'?v.display??v.code:v.kind==='scalar'?String(v.value):v.kind==='pertinent-negative'?v.display??v.code:v.notValue?.display??v.notValue?.code??v.kind);
   return {id,revision:Number(scoped.report.revision),destination:candidate.target.label,incoming:candidate.incoming,...(candidate.mapping?.resourceType==='Patient'&&candidate.value.kind==='text'?{proposedValue:candidate.value.value}:{}),existing:existingValues,conflict:existing.length>0,alreadyImported:!!already,canAppend};
  });
 }
 async apply(token:string,reportId:string,input:unknown) {
  const body=keys(input,['planId','commandId','decision']);
  if(!uuid(body.planId)||!uuid(body.commandId)||!['import','keep','replace','append'].includes(String(body.decision)))throw stale();
  const digest=contentDigest(body);
  return this.database.transaction(async manager=>{
   const scoped=await this.scope(manager,token,reportId,true);
   const [replay]=await manager.query<Array<{id:string;command_sha256:string}>>('select id,command_sha256 from clinical.eps_import where report_id=$1 and command_id=$2',[reportId,body.commandId]);
   if(replay){if(replay.command_sha256!==digest)throw stale();return {id:replay.id,duplicate:true};}
   const [plan]=await manager.query<Array<{revision:string;source_key:string;evidence:Evidence}>>('select revision,source_key,evidence from clinical.eps_import_plan where id=$1 and report_id=$2 and author_id=$3 and expires_at>clock_timestamp()',[body.planId,reportId,scoped.actor.user.id]);
   if(!plan)throw stale();
   const evidence=plan.evidence;
   if(Number(plan.revision)!==Number(scoped.report.revision)||evidence.mapping.sha256!==scoped.mapping.sha256||evidence.configurationRevision!==scoped.configurationRevision||contentDigest(evidence.patient)!==contentDigest(scoped.patient))throw stale();
   const [already]=await manager.query<Array<{id:string}>>('select id from clinical.eps_import where report_id=$1 and source_key=$2',[reportId,plan.source_key]);
   if(already)return {id:already.id,duplicate:true};
   if(body.decision==='append'&&(!evidence.canAppend||!evidence.existing.length))throw stale();
   if(evidence.existing.length&&body.decision==='import'||!evidence.existing.length&&body.decision!=='import')throw stale();
   const id=randomUUID(),occurrenceId=body.decision==='keep'?null:randomUUID();
   const provenance={importId:id,documentId:evidence.documentId,documentVersion:evidence.documentVersion,documentSha256:evidence.documentSha256,entryId:evidence.entry.identity,source:evidence.entry.resource,...(evidence.entry.medication?{medication:evidence.entry.medication}:{}),patient:evidence.patient,mappingId:evidence.mapping.definition.id,mappingRevision:evidence.mapping.definition.revision,mappingSha256:evidence.mapping.sha256,configurationRevision:evidence.configurationRevision,decision:body.decision};
   if(occurrenceId) {
    const occurrences:DraftOccurrenceMutation[]=[...(body.decision==='replace'?evidence.existing.map(o=>({...o,tombstone:true})):[]),{id:occurrenceId,elementId:evidence.candidate.target!.elementId,groupInstanceId:evidence.groupInstanceId,formFieldId:evidence.formFieldId,value:evidence.candidate.value,ordinal:body.decision==='append'?Math.max(...evidence.existing.map(o=>o.ordinal??0))+1:0}];
    await this.drafts.applyImportedOccurrence(manager,reportId,{commandId:body.commandId as string,expectedRevision:Number(plan.revision),authorId:scoped.actor.user.id,occurrences},provenance);
   }
   await manager.query('insert into clinical.eps_import(id,report_id,source_key,occurrence_id,decision,command_id,command_sha256,evidence,author_id) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)',[id,reportId,plan.source_key,occurrenceId,body.decision,body.commandId,digest,JSON.stringify(evidence),scoped.actor.user.id]);
   await recordPatientAccess(manager,{organizationId:scoped.actor.organization.id,actorId:scoped.actor.user.id,reportIds:[reportId],action:'eps.import',careProcess:'documentation',integrationProvenance:{configurationRevision:scoped.configurationRevision,mappingId:scoped.mapping.definition.id,mappingRevision:scoped.mapping.definition.revision,mappingSha256:scoped.mapping.sha256,decision:String(body.decision),importId:id}});
   return {id,duplicate:false};
  });
 }
}
