import { medicationSource } from './eps-medication-import.js';
import { narrativeText, hospitalFieldId, type ClinicalFormConfiguration, type EpsClinicalMapping, type PatientSummary } from '@open-triage/contracts';
import { invalid, keys, namespace, patientField } from './hospital-mapping.js';
import type { DraftValue } from '../reports/draft-report.types.js';
export function clinicalMappings(input:unknown):EpsClinicalMapping[] {
  if(input===undefined)return [];
  if(!Array.isArray(input)||input.length>200)return invalid();
  const ids=new Set<string>(),sources=new Set<string>();
  return input.map(item=>{
    const m=keys(item,['id','resourceType','system','code','destination','representation','semanticRole']);
    if(typeof m.id!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(m.id)||ids.has(m.id)||!['AllergyIntolerance','Condition','MedicationStatement'].includes(String(m.resourceType))||
      typeof m.code!=='string'||!m.code||m.code.length>200||!['text','coded'].includes(String(m.representation)))return invalid();
    if(m.resourceType==='MedicationStatement'?m.semanticRole!=='medication-history':m.semanticRole!==undefined)return invalid();
    ids.add(m.id);const system=namespace(m.system),source=JSON.stringify([m.resourceType,system,m.code]);
    if(sources.has(source))return invalid();sources.add(source);
    return {id:m.id,resourceType:m.resourceType,system,code:m.code,destination:patientField(m.destination),representation:m.representation,...(m.semanticRole?{semanticRole:m.semanticRole}:{})} as EpsClinicalMapping;
  });
}
export function importDestination(mapping:EpsClinicalMapping,form:ClinicalFormConfiguration) {
  const id=hospitalFieldId(mapping.destination);
  const fields=form.definition.sections.flatMap(s=>s.fields).filter(f=>f.source.kind===mapping.destination.kind&&hospitalFieldId(f.source)===id);
  const custom=mapping.destination.kind==='custom'?form.customFields?.[id]:undefined;
  const standard=mapping.destination.kind==='nemsis'?form.catalogFields[id]:undefined;
  const elementId=custom?`${custom.namespace}.${custom.slug}`:id;
  const label=custom?.title??standard?.name??elementId;
  const fail=(finding:string)=>({elementId,label,finding});
  if(mapping.resourceType==='MedicationStatement'&&(mapping.semanticRole!=='medication-history'||mapping.destination.kind!=='custom'||mapping.representation!=='text'||custom?.correlatesTo||custom?.groupDefinitionId))return fail('medicationHistory');
  if(id==='eRecord.01'||fields.length!==1||!custom&&!standard||custom?.retired)return fail('fieldUnavailable');
  if(custom?.correlatesTo||custom?.groupDefinitionId)return fail('cardinality');
  if(mapping.representation==='text') {
    if(custom?custom.datatype!=='string':standard?.generation?.base!=='string'||standard.generation.definition.valueSource?.kind!=='scalar')return fail('datatype');
  } else {
    const choices=custom?.datatype==='coded'?custom.choices.map(c=>({code:c.code,codeSystem:custom.codeSystem})):standard?.codeChoices??[];
    if(!choices.some(c=>c.code===mapping.code&&c.codeSystem===mapping.system))return fail('code');
    if(fields[0]?.choicePolicy&&!fields[0].choicePolicy.some(c=>c.kind==='code'&&c.code===mapping.code&&c.codeSystem===mapping.system))return fail('code');
  }
  return {elementId,label,finding:null};
}
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
/** A bare destination code asserts the concept. Provenance cannot turn a refuted,
 * resolved or uncertain source into an affirmative documented finding. Only exact
 * active/confirmed status codings are supported by this first coded projection. */
export function codedSourceStatusCompatible(resource:Record<string,unknown>):boolean {
  const allergy=resource.resourceType==='AllergyIntolerance';
  const matches=(value:unknown,system:string,code:string)=>{
    const concept=object(value),codings=Array.isArray(concept.coding)?concept.coding.map(object):[];
    return codings.length===1&&codings[0]?.system===system&&codings[0]?.code===code;
  };
  return matches(resource.clinicalStatus,`http://terminology.hl7.org/CodeSystem/${allergy?'allergyintolerance-clinical':'condition-clinical'}`,'active')&&
    matches(resource.verificationStatus,`http://terminology.hl7.org/CodeSystem/${allergy?'allergyintolerance-verification':'condition-ver-status'}`,'confirmed')&&
    !Object.keys(resource).some(key=>key.startsWith('abatement'));
}
export function importCandidate(entry:NonNullable<PatientSummary['importEntries']>[number], mappings:EpsClinicalMapping[],form:ClinicalFormConfiguration) {
  const resource=entry.resource, medication=resource.resourceType==='MedicationStatement'?medicationSource(entry):null, concept=medication?.concept??object(resource.code), coding=Array.isArray(concept.coding)?concept.coding.map(object):[];
  const label=typeof concept.text==='string'?concept.text:coding.map(c=>c.display??c.code).join('; ')||String(resource.resourceType);
  const matching=mappings.filter(m=>m.resourceType===resource.resourceType&&coding.some(c=>c.system===m.system&&c.code===m.code));
  const mapping=matching.length===1?matching[0]:undefined;
  const target=mapping?importDestination(mapping,form):null;
  const codingValue=mapping?coding.find(c=>c.system===mapping.system&&c.code===mapping.code):undefined;
  // Explicit source codes, status and dates are retained verbatim. No inferred clinical negation,
  // terminology conversion, unit coercion, or current-encounter observation is synthesized.
  const narrative=narrativeText(typeof object(resource.text).div==='string'?String(object(resource.text).div):'');
  const statuses=[resource.clinicalStatus,resource.verificationStatus].flatMap(status=>{
    const concept=object(status);return Array.isArray(concept.coding)?concept.coding.map(c=>{const value=object(c);return String(value.display??value.code??'');}):[];
  });
  const dates=Object.entries(resource).filter(([key,value])=>/Date|DateTime|onset|abatement/.test(key)&&typeof value==='string').map(([,value])=>String(value));
  const incoming=medication?.incoming??[label,narrative,coding.map(c=>`${c.system??''} | ${c.code??''}`).join('; '),statuses.join('; '),dates.join('; ')].filter(Boolean).join('\n');
  const value:DraftValue=mapping?.representation==='coded'?{kind:'coded',code:mapping.code,codeSystem:mapping.system,...(typeof codingValue?.display==='string'?{display:codingValue.display}:{})}:{kind:'text',value:incoming};
  const destinationId=mapping?hospitalFieldId(mapping.destination):'';
  const custom=form.customFields?.[destinationId];
  const limits=custom&&custom.datatype!=='coded'?custom.constraints:form.catalogFields[destinationId]?.generation?.definition.datatype?.constraints;
  const invalidText=mapping?.representation==='text'&&limits&&(limits.minLength!==undefined&&incoming.length<Number(limits.minLength)||limits.maxLength!==undefined&&incoming.length>Number(limits.maxLength)||typeof limits.pattern==='string'&&!new RegExp(`^(?:${limits.pattern})$`).test(incoming));
  const finding=medication?.finding??(mapping?.representation==='coded'&&!codedSourceStatusCompatible(resource)?'status':invalidText?'constraints':!entry.identity||entry.identity.endsWith('/undefined')?'identity':Array.isArray(resource.modifierExtension)&&resource.modifierExtension.length?'semantics':!entry.patientMatches?'patient':matching.length>1?'ambiguous':!mapping?'unmapped':target?.finding??null);
  return {entryId:entry.identity,label,destination:target?.label??null,finding,mappingId:mapping?.id??null,mapping,target,value,incoming};
}
export function clinicalOptions(form:ClinicalFormConfiguration) {
  return form.definition.sections.flatMap(s=>s.fields).map(f=>({field:f.source,id:hospitalFieldId(f.source),name:f.source.kind==='custom'?form.customFields?.[hospitalFieldId(f.source)]?.title:form.catalogFields[hospitalFieldId(f.source)]?.name}));
}
