import { UnprocessableEntityException } from '@nestjs/common';
import { hospitalFieldId, type ClinicalFormConfiguration, type CosMappingDefinition, type CosConnectionSettings } from '@open-triage/contracts';
import { parsePackage, type CanonicalPackage } from '../admin/canonical-package.js';
import { identifier, identifierOptions, invalid, keys, namespace, patientField } from './hospital-mapping.js';
import { COS_VITAL_PROFILES,COS_ELEMENT_MAPPINGS } from './cos-vital-profiles.js';
export const COS_PROFILE: CosMappingDefinition['profile'] = {
  package:'cambio.cos.prehospital',version:'2.0.0',fhirVersion:'4.0.1',
  bundle:'https://fhir.cambio.se/StructureDefinition/BundlePrehospitalNote/v2',
  questionnaire:'https://fhir.cambio.se/StructureDefinition/QuestionnaireResponsePreHospitalNote/v2'
};
export function text(value:unknown, optional=false):string {
  if(typeof value!=='string'||(!optional&&!value.trim())||value.length>512||/[\u0000-\u001f\u007f]/.test(value))return invalid();return value;
}
export function connectionSettings(input:unknown):CosConnectionSettings {
  const s=keys(input,['mode','authentication','template','encounterNamespace','organizationHsaId','defaultAmbulanceCareUnit','retryScheduleMinutes','live']);
  if(!['simulator','live'].includes(String(s.mode))||!['api-key','bearer-token','oauth-client-credentials'].includes(String(s.authentication)))return invalid();
  namespace(s.encounterNamespace);text(s.template,true);if(s.template)namespace(s.template);text(s.organizationHsaId,true);text(s.defaultAmbulanceCareUnit,true);
  if(s.retryScheduleMinutes!==undefined&&(!Array.isArray(s.retryScheduleMinutes)||s.retryScheduleMinutes.length>5||s.retryScheduleMinutes.some(value=>!Number.isSafeInteger(value)||value<1||value>1440)))return invalid();
  if(s.live!==undefined){const live=keys(s.live,['initialVerificationDelaySeconds','readBackVerification','baseUrl','tokenUrl','clientId','scope','acceptedProfiles','pdfKeyword','acceptanceRevision','versionMarkerLinkId']);if(live.initialVerificationDelaySeconds!==undefined&&(!Number.isInteger(live.initialVerificationDelaySeconds)||Number(live.initialVerificationDelaySeconds)<0||Number(live.initialVerificationDelaySeconds)>240))return invalid();if(live.readBackVerification!==undefined&&typeof live.readBackVerification!=='boolean')return invalid();cosEndpoint(live.baseUrl);if(!String(live.baseUrl).endsWith('/'))return invalid();cosEndpoint(live.tokenUrl);text(live.clientId);text(live.pdfKeyword);text(live.versionMarkerLinkId);if(!/^\d{6,18}$/.test(String(live.versionMarkerLinkId)))return invalid();if(live.scope!==undefined)text(live.scope,true);if(live.acceptanceRevision!==undefined)text(live.acceptanceRevision);if(!Array.isArray(live.acceptedProfiles)||live.acceptedProfiles.some(profile=>typeof profile!=='string'||!Object.values(COS_VITAL_PROFILES).some(spec=>spec.profile===profile)))return invalid();}
  if(s.mode==='live'&&(!s.live||s.authentication!=='oauth-client-credentials'))return invalid();
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
    if(typeof row.id!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(row.id)||typeof row.linkId!=='string'||!/^[-a-zA-Z0-9_.:]{1,120}$/.test(row.linkId)||row.answerType!=='string')return invalid();
    patientField(row.source);return row as CosMappingDefinition['clinicalMappings'][number];
  });
  if(new Set(rows.map(row=>row.id)).size!==rows.length||new Set(rows.map(row=>row.linkId)).size!==rows.length)return invalid();return rows;
}
export function cosMappingPackage(input:unknown):CanonicalPackage & {definition:CosMappingDefinition} {
  keys(input,['format','schemaVersion','kind','name','version','catalog','definition','sha256']);
  const p=parsePackage(input,'hospital-mapping');keys(p.catalog,['sha256']);
  const d=keys(p.definition,['schemaVersion','id','revision','authoredAt','author','profile','patientIdentifier','clinicalMappings','pdfLinkId','vitalMappings','medicationMappings']);
  const profile=keys(d.profile,Object.keys(COS_PROFILE));
  if(d.schemaVersion!==2||typeof d.id!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(d.id)||!Number.isSafeInteger(d.revision)||Number(d.revision)<1||
    typeof d.author!=='string'||d.author.length>120||typeof d.authoredAt!=='string'||!Number.isFinite(Date.parse(d.authoredAt))||
    Object.entries(COS_PROFILE).some(([key,value])=>profile[key]!==value)||p.version!==String(d.revision))return invalid();
  identifier(d.patientIdentifier);clinicalMappings(d.clinicalMappings);
  medicationMappings(d.medicationMappings??[]);
  const vitals=vitalMappings(d.vitalMappings??[]);
  if(new Set(vitals.map(row=>`${row.vital}:${row.source.kind}:${hospitalFieldId(row.source)}`)).size!==vitals.length)return invalid();
  const clinical=d.clinicalMappings as CosMappingDefinition['clinicalMappings'];
  if(vitals.some(row=>row.linkId===d.pdfLinkId||clinical.some(other=>other.id===row.id||other.linkId===row.linkId)))return invalid();
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
    const compatible=base==='string';
    if(!compatible)throw new UnprocessableEntityException({code:'hospital.cos.mappingType'});
  }
  for(const row of mapping.vitalMappings??[]){
   for(const source of [row.source,...(row.vital!=='painNrs'&&row.companionSource?[row.companionSource]:[])]){
    const id=hospitalFieldId(source),custom=source.kind==='custom'?form.customFields?.[id]:undefined,standard=source.kind==='nemsis'?form.catalogFields[id]:undefined;
    if(!form.definition.sections.some(section=>section.fields.some(field=>field.source.kind===source.kind&&hospitalFieldId(field.source)===id))||(!custom&&!standard)||custom?.retired)throw new UnprocessableEntityException({code:'hospital.fieldUnavailable'});
    const numericText=row.vital==='bloodPressure'&&source.kind==='nemsis'&&id===COS_ELEMENT_MAPPINGS.numericTextRules.bloodPressure.source&&standard?.generation?.base==='string';
    const coded=row.vital==='avpu';
    if(coded?!(custom?.datatype==='coded'||standard?.codeChoices?.length):!numericText&&!['decimal','integer','number'].includes(String(custom?.datatype??standard?.generation?.base)))throw new UnprocessableEntityException({code:'hospital.cos.mappingType'});
   }
  }
  return structuredClone(mapping);
}
export function cosFindings(settings:CosConnectionSettings):string[] {
  const findings:string[]=[];
  if(!settings.template)findings.push('template');
  if(!settings.organizationHsaId)findings.push('organization');
  if(!settings.defaultAmbulanceCareUnit)findings.push('ambulanceCareUnit');
  return findings;
}

export function vitalMappings(input:unknown):NonNullable<CosMappingDefinition['vitalMappings']> {
  if(!Array.isArray(input)||input.length>500)return invalid();
  const rows=input.map(value=>{
    const row=keys(value,['id','source','linkId','vital','unit','companionSource']);
    if(typeof row.id!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(row.id)||typeof row.linkId!=='string'||!/^\d{6,18}$/.test(row.linkId)||row.linkId==='62521000052103'||typeof row.vital!=='string'||!Object.hasOwn(COS_VITAL_PROFILES,row.vital))return invalid();
    const vital=row.vital as keyof typeof COS_VITAL_PROFILES;
    if(row.unit!==COS_VITAL_PROFILES[vital].unit)return invalid();
    patientField(row.source);if(row.companionSource!==undefined)patientField(row.companionSource);if(vital==='bloodPressure'&&!row.companionSource)return invalid();return row as NonNullable<CosMappingDefinition['vitalMappings']>[number];
  });
  if(new Set(rows.map(row=>row.id)).size!==rows.length||new Set(rows.map(row=>row.linkId)).size!==rows.length)return invalid();
  return rows;
}

export function medicationMappings(input:unknown):NonNullable<CosMappingDefinition["medicationMappings"]>{
 if(!Array.isArray(input)||input.length>1)return invalid();return input.map(value=>{const row=keys(value,["id","groupId"]);text(row.id);if(row.groupId!==COS_ELEMENT_MAPPINGS.assessment.medicationGroup)return invalid();return row as {id:string;groupId:string};});
}

/** Omission preserves a pinned mapping; an explicit empty editor value removes it. */
export function cosPdfMappingEdit(value:unknown,prior:string|undefined):{pdfLinkId?:string}{
 if(value===undefined)return prior?{pdfLinkId:prior}:{};
 if(value==='')return {};
 if(typeof value!=='string'||!/^\d{6,18}$/.test(value))return invalid();
 return {pdfLinkId:value};
}
