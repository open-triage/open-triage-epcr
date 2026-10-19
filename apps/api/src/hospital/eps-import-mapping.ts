import { hasUnknownSemantics, historicalConcept, historicalDestination, historicalResource, historicalSource } from './eps-history-import.js';
import { medicationSource } from './eps-medication-import.js';
import { narrativeText, hospitalFieldId, type ClinicalFormConfiguration, type EpsClinicalMapping, type PatientSummary, type HospitalIdentifier } from '@open-triage/contracts';
import { invalid, keys, namespace, patientField } from './hospital-mapping.js';
import type { DraftValue } from '../reports/draft-report.types.js';
export function clinicalMappings(input:unknown):EpsClinicalMapping[] {
  if(input===undefined)return [];
  if(!Array.isArray(input)||input.length>200)return invalid();
  const ids=new Set<string>(),sources=new Set<string>();
  return input.map(item=>{
    const m=keys(item,['id','resourceType','system','code','destination','representation','semanticRole','expectedUnit','crosswalk']);
    if(typeof m.id!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(m.id)||ids.has(m.id)||!['AllergyIntolerance','Condition','MedicationStatement','Observation','Procedure','Patient'].includes(String(m.resourceType))||
      typeof m.code!=='string'||!m.code||m.code.length>200||!['text','coded'].includes(String(m.representation)))return invalid();
    const role=({MedicationStatement:'medication-history',Observation:'historical-observation',Procedure:'historical-procedure',Patient:'patient-identifier'} as Record<string,string>)[String(m.resourceType)];
    if(m.semanticRole!==role)return invalid();
    if(m.resourceType==='Patient'&&m.code!=='identifier')return invalid();
    let crosswalk:EpsClinicalMapping['crosswalk'];
    if(m.crosswalk!==undefined){
      const c=keys(m.crosswalk,['system','code','display','relationship','reference']);
      if(m.representation!=='coded'||!['AllergyIntolerance','MedicationStatement','Condition'].includes(String(m.resourceType))||
        typeof c.code!=='string'||!c.code.trim()||c.code.length>200||typeof c.display!=='string'||!c.display.trim()||c.display.length>300||
        !['equivalent','broader'].includes(String(c.relationship))||typeof c.reference!=='string'||c.reference.length>1000||!/^https:\/\/[^\s]+$/.test(c.reference))return invalid();
      if(m.resourceType==='Condition'&&c.system!=='ICD-10-CM')return invalid();
      if(!['RxNorm','ICD-10-CM','SNOMED-CT'].includes(String(c.system)))return invalid();
      crosswalk={system:String(c.system),code:c.code,display:c.display,relationship:c.relationship as 'equivalent'|'broader',reference:c.reference};
    }
    let expectedUnit: {system:string;code:string}|undefined;
    if(m.expectedUnit!==undefined){if(m.resourceType!=='Observation')return invalid();const unit=keys(m.expectedUnit,['system','code']);if(typeof unit.code!=='string'||!unit.code||unit.code.length>200)return invalid();expectedUnit={system:namespace(unit.system),code:unit.code};}
    ids.add(m.id);const system=namespace(m.system),source=JSON.stringify([m.resourceType,system,m.code]);
    if(sources.has(source))return invalid();sources.add(source);
    return {id:m.id,resourceType:m.resourceType,system,code:m.code,destination:patientField(m.destination),representation:m.representation,...(m.semanticRole?{semanticRole:m.semanticRole}:{}),...(expectedUnit?{expectedUnit}:{}),...(crosswalk?{crosswalk}:{})} as EpsClinicalMapping;
  });
}
export function importDestination(mapping:EpsClinicalMapping,form:ClinicalFormConfiguration,identifier?:HospitalIdentifier) {
  const id=hospitalFieldId(mapping.destination);
  const fields=form.definition.sections.flatMap(s=>s.fields).filter(f=>f.source.kind===mapping.destination.kind&&hospitalFieldId(f.source)===id);
  const custom=mapping.destination.kind==='custom'?form.customFields?.[id]:undefined;
  const standard=mapping.destination.kind==='nemsis'?form.catalogFields[id]:undefined;
  const elementId=custom?`${custom.namespace}.${custom.slug}`:id;
  const label=custom?.title??standard?.name??elementId;
  const fail=(finding:string)=>({elementId,label,finding});
  if(mapping.resourceType==='Patient'&&identifier&&hospitalFieldId(mapping.destination)===hospitalFieldId(identifier.field)&&mapping.destination.kind===identifier.field.kind&&![identifier.namespace,...identifier.aliases].includes(mapping.system))return fail('identifierNamespace');
  const historicalFinding=historicalDestination(mapping,form);if(historicalFinding)return fail(historicalFinding);
  const medicationCode=isCurrentMedicationMapping(mapping);
  if(mapping.resourceType==='MedicationStatement'&&!medicationCode&&(mapping.semanticRole!=='medication-history'||mapping.destination.kind!=='custom'||mapping.representation!=='text'||custom?.correlatesTo||custom?.groupDefinitionId))return fail('medicationHistory');
  if(mapping.crosswalk&&(mapping.destination.kind!=='nemsis'||!(mapping.resourceType==='AllergyIntolerance'?['eHistory.06','eHistory.07']:mapping.resourceType==='Condition'?['eHistory.08']:['eHistory.12']).includes(id)))return fail('historicalDestination');
  if(id==='eRecord.01'||fields.length!==1||!custom&&!standard||custom?.retired)return fail('fieldUnavailable');
  if(custom?.correlatesTo||custom?.groupDefinitionId)return fail('cardinality');
  if(mapping.representation==='text') {
    // Source narrative can contain identifying facts even when its concept code
    // is non-identifying. Custom string analytics follows this catalog flag.
    if(custom&&custom.identifying!==true)return fail('identifyingDestination');
    if(custom?custom.datatype!=='string':standard?.generation?.base!=='string'||standard.generation.definition.valueSource?.kind!=='scalar')return fail('datatype');
  } else {
    const choices=custom?.datatype==='coded'?custom.choices.map(c=>({code:c.code,codeSystem:custom.codeSystem})):standard?.codeChoices??[];
    const code=mapping.crosswalk??mapping;
    // eHistory.12 is an open RxNorm vocabulary. An explicit crosswalk may name
    // an external concept outside the non-exhaustive suggested medication list.
    const externalMedication=medicationCode&&standard?.generation?.definition.valueSource?.kind==='external-code-system'&&
      code.system==='RxNorm'&&/^[0-9]{2,9}$/.test(code.code);
    if(!externalMedication&&!choices.some(c=>c.code===code.code&&c.codeSystem===code.system))return fail('code');
    if(fields[0]?.choicePolicy&&!fields[0].choicePolicy.some(c=>c.kind==='code'&&c.code===code.code&&c.codeSystem===code.system))return fail('code');
  }
  return {elementId,label,finding:null};
}
export function isCurrentMedicationMapping(mapping:EpsClinicalMapping):boolean {
  return mapping.resourceType==='MedicationStatement'&&mapping.semanticRole==='medication-history'&&mapping.representation==='coded'&&
    mapping.destination.kind==='nemsis'&&mapping.destination.elementId==='eHistory.12'&&!!mapping.crosswalk;
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
export function importCandidate(entry:NonNullable<PatientSummary['importEntries']>[number], mappings:EpsClinicalMapping[],form:ClinicalFormConfiguration,identifier?:HospitalIdentifier) {
  const resource=entry.resource, medication=resource.resourceType==='MedicationStatement'?medicationSource(entry):null, concept=medication?.concept??historicalConcept(resource), coding=Array.isArray(concept.coding)?concept.coding.map(object):[];
  const label=typeof concept.text==='string'?concept.text:coding.map(c=>c.display??c.code).join('; ')||String(resource.resourceType);
  const matching=mappings.filter(m=>m.resourceType===resource.resourceType&&coding.some(c=>c.system===m.system&&c.code===m.code));
  const mapping=matching.length===1?matching[0]:undefined;
  const target=mapping?importDestination(mapping,form,identifier):null;
  const historical=mapping&&historicalResource(String(resource.resourceType))?historicalSource(resource,mapping):null;
  const codingValue=mapping?coding.find(c=>c.system===mapping.system&&c.code===mapping.code):undefined;
  // Source codes, status and dates remain in provenance. Only the explicit crosswalk
  // can change the destination code; no negation, unit conversion or encounter treatment is inferred.
  const narrative=narrativeText(typeof object(resource.text).div==='string'?String(object(resource.text).div):'');
  const statuses=[resource.clinicalStatus,resource.verificationStatus].flatMap(status=>{
    const concept=object(status);return Array.isArray(concept.coding)?concept.coding.map(c=>{const value=object(c);return String(value.display??value.code??'');}):[];
  });
  const dates=Object.entries(resource).filter(([key,value])=>/Date|DateTime|onset|abatement/.test(key)&&typeof value==='string').map(([,value])=>String(value));
  const incoming=historical?.incoming??medication?.incoming??(mapping?.crosswalk?JSON.stringify({...resource,text:undefined},null,2):undefined)??[label,narrative,coding.map(c=>`${c.system??''} | ${c.code??''}`).join('; '),statuses.join('; '),dates.join('; ')].filter(Boolean).join('\n');
  const targetCode=mapping?.crosswalk??mapping;
  const value:DraftValue=mapping?.representation==='coded'?{kind:'coded',code:targetCode!.code,codeSystem:targetCode!.system,...(mapping.crosswalk?{display:mapping.crosswalk.display}:typeof codingValue?.display==='string'?{display:codingValue.display}:{})}:{kind:'text',value:historical?.value??incoming};
  const destinationId=mapping?hospitalFieldId(mapping.destination):'';
  const custom=form.customFields?.[destinationId];
  const limits=custom&&custom.datatype!=='coded'?custom.constraints:form.catalogFields[destinationId]?.generation?.definition.datatype?.constraints;
  const textValue=value.kind==='text'?value.value:incoming;
  const invalidText=mapping?.representation==='text'&&limits&&(limits.minLength!==undefined&&textValue.length<Number(limits.minLength)||limits.maxLength!==undefined&&textValue.length>Number(limits.maxLength)||typeof limits.pattern==='string'&&!new RegExp(`^(?:${limits.pattern})$`).test(textValue));
  const currentMedication=!!mapping&&isCurrentMedicationMapping(mapping);
  const sourceStatus=currentMedication?resource.status==='active'&&!object(resource.effectivePeriod).end&&
    [resource.effectiveDateTime,object(resource.effectivePeriod).start].every(date=>date===undefined||typeof date==='string'&&Number.isFinite(Date.parse(date))&&Date.parse(date)<=Date.now()):
    codedSourceStatusCompatible(resource)&&(!mapping?.crosswalk||resource.resourceType==='Condition'||resource.type==='allergy');
  const finding=historical?.finding??medication?.finding??(mapping?.crosswalk&&(hasUnknownSemantics(resource)||hasUnknownSemantics(entry.medication))?'semantics':mapping?.representation==='coded'&&!sourceStatus?'status':invalidText?'constraints':!entry.identity||entry.identity.endsWith('/undefined')?'identity':Array.isArray(resource.modifierExtension)&&resource.modifierExtension.length?'semantics':!entry.patientMatches?'patient':matching.length>1?'ambiguous':!mapping?'unmapped':target?.finding??null);
  return {entryId:entry.identity,label,destination:target?.label??null,finding,mappingId:mapping?.id??null,mapping,target,value,incoming};
}
export function clinicalOptions(form:ClinicalFormConfiguration) {
  return form.definition.sections.flatMap(s=>s.fields).map(f=>({field:f.source,id:hospitalFieldId(f.source),name:f.source.kind==='custom'?form.customFields?.[hospitalFieldId(f.source)]?.title:form.catalogFields[hospitalFieldId(f.source)]?.name}));
}
