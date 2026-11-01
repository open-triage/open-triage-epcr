import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { CosPatientComparison, CosPatientDemographics, CosConnectionSettings } from '@open-triage/contracts';
import type { ClinicianSessionService } from '../sessions/clinician-session.service.js';
import { recordPatientAccess } from '../reports/patient-access-audit.js';
import {buildCosPatient,cosPatientMatches} from './cos-patient.js';
import type {SignedOccurrence} from '../reports/signed-report-pdf.js';
import {createCosLiveAdapter} from './cos-live-delivery.js';
import type {CosResource} from './cos-live-adapter.js';

const text=(value:unknown,max=100):string|null=>typeof value==='string'&&value.trim()&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value)?value:null;
function demographics(patient:CosResource):CosPatientDemographics{
 const names=Array.isArray(patient.name)?patient.name.filter((n:CosResource)=>n&&(!n.use||['official','usual'].includes(n.use))):[];
 const official=names.filter((n:CosResource)=>n.use==='official');
 const name=(official.length===1?official:names).length===1?(official.length===1?official[0]:names[0]):undefined;
 const given=Array.isArray(name?.given)&&name.given.every((v:unknown)=>text(v)!==null)?name.given:[];
 return {firstName:text(given[0]),middleNames:given.length?text(given.slice(1).join(' '))??'':null,lastName:text(name?.family),
  birthDate:typeof patient.birthDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(patient.birthDate)&&Number.isFinite(Date.parse(patient.birthDate))&&new Date(patient.birthDate).toISOString().slice(0,10)===patient.birthDate?patient.birthDate:null,
  gender:['female','male','unknown'].includes(patient.gender)?patient.gender:null};
}
/** Never import another identity, ambiguous names, extensions, or arbitrary FHIR data. */
export function compareCosPatient(expected:CosResource,actual:CosResource):Omit<CosPatientComparison,'reportId'|'revision'|'deliveryId'>{
 const id=expected.identifier?.[0];
 if(!id?.system||!id?.value||actual.resourceType!=='Patient'||!Array.isArray(actual.identifier)||
  !actual.identifier.some((i:CosResource)=>i?.system===id.system&&i.value===id.value))throw new UnprocessableEntityException({code:'cos.patientIdentityMismatch'});
 const local=demographics(expected),cos=demographics(actual);
 const changes:CosPatientComparison['changes']=[];
 const fields=[['firstName','ePatient.03','text'],['middleNames','ePatient.04','text'],['lastName','ePatient.02','text'],['birthDate','ePatient.17','date'],['gender','ePatient.25','coded']] as const;
 const gender={female:'9919001',male:'9919003',unknown:'9919005'};
 for(const [field,elementId,kind] of fields){const value=cos[field];if(value!==null&&value!==local[field])changes.push({elementId,kind,value:field==='gender'?gender[value as keyof typeof gender]:value});}
 return {identifier:id.value,local,cos,displayName:[cos.firstName,cos.lastName].filter(Boolean).join(' '),
  canApply:!!cos.firstName&&!!cos.lastName&&changes.length>0,matches:cosPatientMatches(expected,actual),changes};
}

export async function readCosPatientComparison(database:DataSource,sessions:ClinicianSessionService,token:string,reportId:string,input:unknown,
 adapterFactory=createCosLiveAdapter):Promise<CosPatientComparison>{
 const session=await sessions.requireCapability(token,'clinical:document');
 const command=input as {revision?:number;deliveryId?:string};
 if(!command||!Number.isSafeInteger(command.revision)||Number(command.revision)<0||typeof command.deliveryId!=='string'||! /^[0-9a-f-]{36}$/i.test(command.deliveryId))throw new BadRequestException();
 // Read and audit in a committed authorization transaction before querying COS.
 const job=await database.transaction(async(manager:EntityManager)=>{
  const [report]=await manager.query(`select revision,status from clinical.report where id=$1 and organization_id=$2 and documenting_user_id=$3 and (expires_at is null or expires_at>clock_timestamp())`,[reportId,session.organization.id,session.user.id]);
  if(!report)throw new NotFoundException();
  if(report.status!=='draft'||Number(report.revision)!==command.revision)throw new ConflictException({code:'cos.draftChanged'});
  const [job]=await manager.query<Array<{submission_revision:string;identifier_field:{kind:string;elementId?:string;elementDefinitionId?:string};group_id:string;credential_revision:string;configuration_revision:string;settings:CosConnectionSettings;resource:CosResource;mapping_id:string;mapping_revision:number;mapping_sha256:string}>>(`select d.group_id,d.configuration_revision,d.mapping_id,d.mapping_revision,d.mapping_sha256,v.settings,a.resource,s.revision as submission_revision,v.canonical_mapping->'definition'->'patientIdentifier'->'field' as identifier_field,
   case when app_identity.cos_configuration_compatible(d.group_id,d.configuration_revision,c.active_revision) then c.active_revision else d.configuration_revision end credential_revision
   from clinical.cos_delivery d join clinical.signing_submission s on s.id=d.signing_submission_id
   join clinical.cos_artifact a on a.delivery_id=d.id and a.kind='patient'
   join app_identity.hospital_cos_version v on v.group_id=d.group_id and v.revision=d.configuration_revision
   join app_identity.hospital_cos_state c on c.group_id=d.group_id
   where d.id=$1 and d.report_id=$2 and s.revision<=$3 and d.state in ('uncertain','failed','waiting','confirmed')
   and not exists(select 1 from clinical.signing_submission newer where newer.report_id=s.report_id and newer.created_at>s.created_at)`,[command.deliveryId,reportId,command.revision]);
  if(!job||job.settings.mode!=='live')throw new ConflictException({code:'cos.patientComparisonUnavailable'});
  if(Number(job.submission_revision)!==command.revision){
   // The failed submission identifies the COS patient, but corrections apply to today's saved draft.
   const field=job.identifier_field;
   if(!field||!['nemsis','custom'].includes(field.kind))throw new ConflictException({code:'cos.patientComparisonUnavailable'});
   const current=await manager.query<SignedOccurrence[]>(`select id,element_id,element_identity_id,group_instance_id,value_kind,
    value_text,value_date,code,code_system,not_value_code,pertinent_negative_code
    from clinical.element_occurrence where report_id=$1 and tombstoned_at is null
     and (element_id=any($2::text[]) or element_identity_id=$3::uuid)`,
    [reportId,['ePatient.02','ePatient.03','ePatient.04','ePatient.17','ePatient.25',...(field.kind==='nemsis'&&field.elementId?[field.elementId]:[])],
     field.kind==='custom'?field.elementDefinitionId:null]);
   const identifiers=current.filter(row=>field.kind==='custom'?row.element_identity_id===field.elementDefinitionId:row.element_id===field.elementId);
   const identifier=identifiers[0];
   if(identifiers.length!==1||identifier?.value_kind!=='text'||identifier.not_value_code||identifier.pertinent_negative_code||
    identifier.value_text!==job.resource.identifier?.[0]?.value)throw new ConflictException({code:'cos.patientIdentityMismatch'});
   job.resource=buildCosPatient({occurrences:current,amendments:[],amendmentSequence:0},job.resource.identifier[0]);
  }
  // report.read is a documentation access; integration_provenance is restricted to EPS actions.
  await recordPatientAccess(manager,{organizationId:session.organization.id,actorId:session.user.id,reportIds:[reportId],careProcess:'documentation',action:'report.read'});
  return job;
 });
 let actual:CosResource|undefined;
 try{const adapter=await adapterFactory(database.manager,job.group_id,job.credential_revision,job.settings);actual=await adapter.findPatient(job.resource.identifier[0]);}
 catch{throw new UnprocessableEntityException({code:'cos.patientComparisonUnavailable'});}
 if(!actual)throw new UnprocessableEntityException({code:'cos.patientNotFound'});
 const comparison=compareCosPatient(job.resource,actual);
 // A slow lookup cannot return actionable data for a draft edited in the meantime.
 const [still]=await database.query(`select id from clinical.report where id=$1 and organization_id=$2 and documenting_user_id=$3 and revision=$4 and status='draft' and (expires_at is null or expires_at>clock_timestamp())`,[reportId,session.organization.id,session.user.id,command.revision]);
 if(!still)throw new ConflictException({code:'cos.draftChanged'});
 return {...comparison,reportId,revision:command.revision!,deliveryId:command.deliveryId!};
}
