import type {HospitalField} from '@open-triage/contracts';
import {COS_ELEMENT_MAPPINGS,hospitalFieldId} from '@open-triage/contracts';
import type {SignedReportClinicalSource,SignedOccurrence} from '../reports/signed-report-pdf.js';
import {CosFinding} from './cos-finding.js';
export const matches=(row:SignedOccurrence,field:HospitalField)=>(field.kind==='custom'?row.element_identity_id:row.element_id)===hospitalFieldId(field);
/** Canonical NEMSIS enumerations have no external terminology namespace. */
export function nemsisEnumeration(row:SignedOccurrence){return row.value_kind==='coded'&&(row.code_system??'')==='';}
export function qualified(row:SignedOccurrence){return !!(row.not_value_code||row.pertinent_negative_code||['null','absent','pertinent-negative'].includes(row.value_kind));}
export function numeric(row:SignedOccurrence,textRule?:{source:string;pattern:string;minimum:number;maximum:number}){
 if(textRule&&row.value_kind==='text'&&row.element_id===textRule.source){
  if(qualified(row)||typeof row.value_text!=='string'||!new RegExp(textRule.pattern).test(row.value_text))throw new CosFinding('clinicalValue');
  const value=Number(row.value_text);if(!Number.isSafeInteger(value)||value<textRule.minimum||value>textRule.maximum)throw new CosFinding('clinicalValue');return value;
 }
 if(qualified(row)||!['integer','numeric'].includes(row.value_kind))throw new CosFinding('clinicalValue');
 const raw=row.value_kind==='integer'?row.value_integer:row.value_numeric;
 if(typeof raw!=='number'&&(typeof raw!=='string'||! /^-?\d+(?:\.\d+)?$/.test(raw)))throw new CosFinding('clinicalValue');
 const value=Number(raw);if(!Number.isFinite(value)||(row.value_kind==='integer'&&!Number.isSafeInteger(value)))throw new CosFinding('clinicalValue');return value;
}
export function timestamp(raw:unknown):string {
 if(typeof raw!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw)||!Number.isFinite(Date.parse(raw)))throw new CosFinding('clinicalTime');
 const day=raw.slice(0,10);if(new Date(`${day}T00:00:00Z`).toISOString().slice(0,10)!==day)throw new CosFinding('clinicalTime');return raw;
}
/** Walk only actual signed ancestry: never pair by nearest time or array index. */
function clinicalAncestry(source:SignedReportClinicalSource,row:SignedOccurrence,root:string){
 const groups=new Map(source.groups.map(g=>[g.id,g]));if(groups.size!==source.groups.length)throw new CosFinding('clinicalGroup');
 const chain:SignedReportClinicalSource['groups']=[];let id=row.group_instance_id;const seen=new Set<string>();
 while(typeof id==='string'){
  if(seen.has(id)||!groups.has(id))throw new CosFinding('clinicalGroup');seen.add(id);
  const group=groups.get(id)!;chain.push(group);if(group.group_id===root)break;id=group.parent_group_instance_id;
 }
 if(!chain.length||!chain.some(group=>group.group_id===root))throw new CosFinding('clinicalGroup');
 return chain;
}
export function clinicalContext(source:SignedReportClinicalSource,row:SignedOccurrence,root:string){
 const chain=clinicalAncestry(source,row,root);
 const assessment=chain.find(g=>g.group_id===root)!;
 const times=chain.flatMap(g=>g.documented_time?[timestamp(g.documented_time)]:[]);
 const timeField=root===COS_ELEMENT_MAPPINGS.assessment.medicationGroup?COS_ELEMENT_MAPPINGS.assessment.medicationTime:COS_ELEMENT_MAPPINGS.assessment.vitalTime;
 const explicit=source.occurrences.filter(value=>value.element_id===timeField&&chain.some(g=>g.id===value.group_instance_id));
 for(const value of explicit){if(qualified(value))throw new CosFinding('clinicalTime');times.push(timestamp(value.value_datetime??value.value_date_time??value.value_text));}
 if(!times.length||new Set(times.map(Date.parse)).size!==1)throw new CosFinding('clinicalTime');
 return {id:assessment.id,chain:chain.map(g=>g.id),time:times[0]!};
}
export function companion(source:SignedReportClinicalSource,row:SignedOccurrence,field:HospitalField){
 const context=clinicalContext(source,row,COS_ELEMENT_MAPPINGS.assessment.vitalGroup);
 // A BP sibling must be within the same nearest BP subgroup; pain uses its assessment.
 const pairingGroup=context.chain.map(id=>source.groups.find(group=>group.id===id)).find(group=>group&&[COS_ELEMENT_MAPPINGS.assessment.bloodPressureGroup,COS_ELEMENT_MAPPINGS.assessment.painScaleGroup].includes(group.group_id));
 const scope=pairingGroup?.id??context.id;
 const candidates=source.occurrences.filter(value=>matches(value,field)).filter(value=>{
  try{return clinicalAncestry(source,value,COS_ELEMENT_MAPPINGS.assessment.vitalGroup).some(group=>group.id===scope);}catch{return false;}
 });
 if(!candidates.length)throw new CosFinding('clinicalCompanionMissing');
 if(candidates.length!==1)throw new CosFinding('clinicalGroup');
 const other=candidates[0]!;if(Date.parse(clinicalContext(source,other,COS_ELEMENT_MAPPINGS.assessment.vitalGroup).time)!==Date.parse(context.time))throw new CosFinding('clinicalTime');return other;
}
export function terminologyText(source:SignedReportClinicalSource,row:SignedOccurrence){
 if(qualified(row))throw new CosFinding('clinicalValue');
 if(row.value_kind==='text'&&typeof row.value_text==='string'&&row.value_text.trim())return row.value_text;
 if(row.value_kind==='coded'){
  const choice=source.configuration.catalogFields[row.element_id]?.codeChoices?.find(c=>c.code===row.code&&(c.codeSystem??'')===(row.code_system??''));
  // Only the signed catalog is authoritative; never substitute a bare enumeration.
  if(choice?.label&&choice.label!==row.code)return choice.label;
 }
 throw new CosFinding('clinicalTerminology');
}
