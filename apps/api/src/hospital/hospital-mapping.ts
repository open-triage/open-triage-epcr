import { outputMappings } from './eps-output-mapping.js';
import {clinicalMappings,importDestination} from './eps-import-mapping.js';
import { UnprocessableEntityException } from '@nestjs/common';
import { type ClinicalFormConfiguration, type HospitalField, type HospitalMappingDefinition, hospitalFieldId } from '@open-triage/contracts';
import { contentDigest, makePackage, parsePackage, type CanonicalPackage } from '../admin/canonical-package.js';
export const EPS_ENDPOINT = 'https://hackathon2026.vadimperetok.in/fhir';
export function invalid(): never { throw new UnprocessableEntityException({code:'hospital.invalid'}); }
export function keys(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key=>!allowed.includes(key))) return invalid();
  return value as Record<string,unknown>;
}
export function patientField(input: unknown): HospitalField {
  const field=keys(input,['kind','elementId','elementDefinitionId']);
  if(field.kind==='nemsis' && typeof field.elementId==='string' && /^e[A-Za-z]+\.\d{2}$/.test(field.elementId) && !field.elementDefinitionId)
    return {kind:'nemsis',elementId:field.elementId};
  if(field.kind==='custom' && typeof field.elementDefinitionId==='string' && /^[a-zA-Z0-9_.:-]{1,200}$/.test(field.elementDefinitionId) && !field.elementId)
    return {kind:'custom',elementDefinitionId:field.elementDefinitionId};
  return invalid();
}
export function namespace(value: unknown): string {
  if(typeof value!=='string'||value.length>512||/\s|[\u0000-\u001f]/.test(value))return invalid();
  try { const url=new URL(value);if(!['https:','http:','urn:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)return invalid(); }catch{return invalid();}
  return value;
}
export function identifier(input:unknown):HospitalMappingDefinition['patientIdentifier'] {
  const value=keys(input,['field','namespace','aliases']);
  if(!Array.isArray(value.aliases)||value.aliases.length>20)return invalid();
  const system=namespace(value.namespace),aliases=value.aliases.map(namespace);
  if(new Set([system,...aliases]).size!==aliases.length+1)return invalid();
  return {field:patientField(value.field),namespace:system,aliases};
}
export function mappingPackage(input:unknown): CanonicalPackage & {definition:HospitalMappingDefinition} {
  keys(input,['format','schemaVersion','kind','name','version','catalog','definition','sha256']);
  const p=parsePackage(input,'hospital-mapping');
  keys(p.catalog,['sha256']);
  const d=keys(p.definition,['schemaVersion','id','revision','authoredAt','author','profile','patientIdentifier','clinicalMappings','outputMappings']);
  const profile=keys(d.profile,['package','version','fhirVersion']);
  if(d.schemaVersion!==1||typeof d.id!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(d.id)||!Number.isSafeInteger(d.revision)||Number(d.revision)<1||
    typeof d.author!=='string'||d.author.length>120||typeof d.authoredAt!=='string'||!Number.isFinite(Date.parse(d.authoredAt))||
    profile.package!=='hl7.fhir.eu.eps'||profile.version!=='1.0.0-ballot'||profile.fhirVersion!=='4.0.1'||p.version!==String(d.revision))return invalid();
  identifier(d.patientIdentifier);
  clinicalMappings(d.clinicalMappings);
  outputMappings(d.outputMappings);
  return p as CanonicalPackage & {definition:HospitalMappingDefinition};
}
export function compileMapping(p:CanonicalPackage, form:ClinicalFormConfiguration) {
  const mapping=mappingPackage(p).definition;
  const selected=mapping.patientIdentifier.field,id=hospitalFieldId(selected);
  const options=identifierOptions(form);
  if(!options.some(option=>option.field.kind===selected.kind&&hospitalFieldId(option.field)===id))throw new UnprocessableEntityException({code:'hospital.fieldUnavailable'});
  for(const item of clinicalMappings(mapping.clinicalMappings)) { if(importDestination(item,form,mapping.patientIdentifier).finding)throw new UnprocessableEntityException({code:"hospital.clinicalIncompatible"}); }
  outputMappings(mapping.outputMappings,form);
  return structuredClone(mapping.patientIdentifier);
}
export function identifierOptions(form:ClinicalFormConfiguration) {
  const seen=new Set<string>();
  return form.definition.sections.flatMap(section=>section.fields).flatMap(({source})=>{
    const id=hospitalFieldId(source),key=`${source.kind}:${id}`;
    if(seen.has(key))return [];seen.add(key);
    const field=source.kind==='nemsis'?form.catalogFields[id]:form.customFields?.[id];
    if(!field)return [];
    if(source.kind==='nemsis') {
      const standard=form.catalogFields[id]!;
      if(standard.generation?.base!=='string'||standard.generation.definition.valueSource?.kind!=='scalar')return [];
    }else {const custom=form.customFields![id]!;if(custom.datatype!=='string'||custom.retired)return [];}
    const fieldIdentity:HospitalField=source.kind==='nemsis'?{kind:'nemsis',elementId:source.elementId}:{kind:'custom',elementDefinitionId:source.elementDefinitionId};
    return [{field:fieldIdentity,id,name:(source.kind==='nemsis'?form.catalogFields[id]?.name:form.customFields?.[id]?.title)??id,localization:field.localization??null}];
  });
}
export {contentDigest,makePackage};
