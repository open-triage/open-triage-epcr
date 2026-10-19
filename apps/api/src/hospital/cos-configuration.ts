import { UnprocessableEntityException } from '@nestjs/common';
import { hospitalFieldId, type ClinicalFormConfiguration, type CosMappingDefinition, type CosConnectionSettings } from '@open-triage/contracts';
import { parsePackage, type CanonicalPackage } from '../admin/canonical-package.js';
import { identifier, identifierOptions, invalid, keys, namespace, patientField } from './hospital-mapping.js';
export const COS_PROFILE: CosMappingDefinition['profile'] = {
  package:'cambio.cos.prehospital',version:'2.0.0',fhirVersion:'4.0.1',
  bundle:'https://fhir.cambio.se/StructureDefinition/BundlePrehospitalNote/v2',
  questionnaire:'https://fhir.cambio.se/StructureDefinition/QuestionnaireResponsePreHospitalNote/v2'
};
export function text(value:unknown, optional=false):string {
  if(typeof value!=='string'||(!optional&&!value.trim())||value.length>512||/[\u0000-\u001f\u007f]/.test(value))return invalid();return value;
}
export function connectionSettings(input:unknown):CosConnectionSettings {
  const s=keys(input,['mode','authentication','template','encounterNamespace','organizationHsaId','defaultAmbulanceCareUnit','staff','careUnits','retryScheduleMinutes']);
  if(!['simulator','live'].includes(String(s.mode))||!['api-key','bearer-token'].includes(String(s.authentication)))return invalid();
  namespace(s.encounterNamespace);text(s.template,true);if(s.template)namespace(s.template);text(s.organizationHsaId,true);text(s.defaultAmbulanceCareUnit,true);
  if(!Array.isArray(s.staff)||s.staff.length>2000||!Array.isArray(s.careUnits)||s.careUnits.length>2000)return invalid();
  const staff=s.staff.map(input=>{const row=keys(input,['userId','hsaId']);if(typeof row.userId!=='string'||!/^[-a-f0-9]{36}$/.test(row.userId))return invalid();text(row.hsaId);return row;});
  const careUnits=s.careUnits.map(input=>{const row=keys(input,['hospital','localCareUnit','hsaId']);text(row.hospital);text(row.localCareUnit);text(row.hsaId);return row;});
  if(new Set(staff.map(row=>row.userId)).size!==staff.length||new Set(careUnits.map(row=>`${row.hospital}\0${row.localCareUnit}`)).size!==careUnits.length)return invalid();
  if(s.retryScheduleMinutes!==undefined&&(!Array.isArray(s.retryScheduleMinutes)||s.retryScheduleMinutes.length>5||s.retryScheduleMinutes.some(value=>!Number.isSafeInteger(value)||value<1||value>1440)))return invalid();
  return s as CosConnectionSettings;
}
export function cosEndpoint(input:unknown):string {
  const value=text(input);let url:URL;try{url=new URL(value);}catch{return invalid();}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)return invalid();return value;
}
export function clinicalMappings(input:unknown):CosMappingDefinition['clinicalMappings'] {
  if(!Array.isArray(input)||input.length>500)return invalid();
  const rows=input.map(value=>{
    const row=keys(value,['id','source','linkId','answerType']);
    if(typeof row.id!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(row.id)||typeof row.linkId!=='string'||!/^[-a-zA-Z0-9_.:]{1,120}$/.test(row.linkId)||!['string','decimal','boolean','dateTime'].includes(String(row.answerType)))return invalid();
    patientField(row.source);return row as CosMappingDefinition['clinicalMappings'][number];
  });
  if(new Set(rows.map(row=>row.id)).size!==rows.length||new Set(rows.map(row=>row.linkId)).size!==rows.length)return invalid();return rows;
}
export function cosMappingPackage(input:unknown):CanonicalPackage & {definition:CosMappingDefinition} {
  keys(input,['format','schemaVersion','kind','name','version','catalog','definition','sha256']);
  const p=parsePackage(input,'hospital-mapping');keys(p.catalog,['sha256']);
  const d=keys(p.definition,['schemaVersion','id','revision','authoredAt','author','profile','patientIdentifier','clinicalMappings','pdfLinkId']);
  const profile=keys(d.profile,Object.keys(COS_PROFILE));
  if(d.schemaVersion!==1||typeof d.id!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(d.id)||!Number.isSafeInteger(d.revision)||Number(d.revision)<1||
    typeof d.author!=='string'||d.author.length>120||typeof d.authoredAt!=='string'||!Number.isFinite(Date.parse(d.authoredAt))||
    Object.entries(COS_PROFILE).some(([key,value])=>profile[key]!==value)||p.version!==String(d.revision))return invalid();
  identifier(d.patientIdentifier);clinicalMappings(d.clinicalMappings);
  if(d.pdfLinkId!==undefined&&(typeof d.pdfLinkId!=='string'||!/^\d{6,18}$/.test(d.pdfLinkId)||d.pdfLinkId==='62521000052103'||(d.clinicalMappings as CosMappingDefinition['clinicalMappings']).some(row=>row.linkId===d.pdfLinkId)))return invalid();
  return p as CanonicalPackage & {definition:CosMappingDefinition};
}
/** A rebuildable projection: only immutable canonical input and pinned catalog/form. */
export function compileCosMapping(p:CanonicalPackage,form:ClinicalFormConfiguration) {
  const mapping=cosMappingPackage(p).definition;
  const selected=mapping.patientIdentifier.field;
  if(!identifierOptions(form).some(option=>option.field.kind===selected.kind&&hospitalFieldId(option.field)===hospitalFieldId(selected)))throw new UnprocessableEntityException({code:'hospital.fieldUnavailable'});
  for(const row of mapping.clinicalMappings){
    // Published v2 otherInformation is a single valueString with a SNOMED linkId.
    // The medication slice requires nested Coding + five children, and PDF/Reference
    // slices are separate artifacts. Never accept a flat field as those structures.
    if(row.answerType!=='string'||!/^\d{6,18}$/.test(row.linkId)||row.linkId==='62521000052103')throw new UnprocessableEntityException({code:'hospital.cos.profileMapping'});
    const id=hospitalFieldId(row.source),custom=row.source.kind==='custom'?form.customFields?.[id]:undefined,standard=row.source.kind==='nemsis'?form.catalogFields[id]:undefined;
    if(!form.definition.sections.some(section=>section.fields.some(field=>field.source.kind===row.source.kind&&hospitalFieldId(field.source)===id))||(!custom&&!standard)||custom?.retired)throw new UnprocessableEntityException({code:'hospital.fieldUnavailable'});
    const base=custom?.datatype??standard?.generation?.base;
    // Reject incompatible mappings rather than silently converting coded/scalar values.
    const compatible=row.answerType==='string'?base==='string':row.answerType==='decimal'?['decimal','integer','number'].includes(String(base)):row.answerType==='boolean'?base==='boolean':['dateTime','datetime'].includes(String(base));
    if(!compatible)throw new UnprocessableEntityException({code:'hospital.cos.mappingType'});
  }
  return structuredClone(mapping);
}
export function resolveCosCareUnit(settings:CosConnectionSettings,destination:{hospital:string;localCareUnit:string}|null):string|null {
  if(!destination)return settings.defaultAmbulanceCareUnit||null;
  return settings.careUnits.find(row=>row.hospital===destination.hospital&&row.localCareUnit===destination.localCareUnit)?.hsaId??null;
}
export function cosFindings(settings:CosConnectionSettings,mapping:CosMappingDefinition):string[] {
  const findings:string[]=[];
  if(!settings.template)findings.push('template');
  if(!settings.organizationHsaId)findings.push('organization');
  if(!resolveCosCareUnit(settings,null))findings.push('ambulanceCareUnit');
  if(!settings.staff.length)findings.push('staff');
  if(!settings.careUnits.length)findings.push('careUnits');
  if(!mapping.clinicalMappings.length)findings.push('clinicalMappings');
  return findings;
}
