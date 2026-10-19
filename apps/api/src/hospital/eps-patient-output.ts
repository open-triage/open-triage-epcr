import {hospitalFieldId,type EpsOutputMapping} from '@open-triage/contracts';
import type {SignedOccurrence} from '../reports/signed-report-pdf.js';
import type {EpsFinding} from './eps-output.js';
const absent={extension:[{url:'http://hl7.org/fhir/StructureDefinition/data-absent-reason',valueCode:'unknown'}]};
type Name={family?:string;given?:string[];suffix?:string[];_text?:typeof absent};
export type EpsPatientFields={name:Name[];birthDate?:string;_birthDate?:typeof absent;gender?:string};
/** Explicit NEMSIS administrative sex crosswalk, never a gender-identity assertion. */
const genderCodes:Record<string,string>={'9919001':'female','9919003':'male','9919005':'unknown'};
function validDate(value:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000'))return false;
 const date=new Date(`${value}T00:00:00Z`);
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function epsPatientOutput(mappings:EpsOutputMapping[],rows:SignedOccurrence[],findings:EpsFinding[]):EpsPatientFields{
 const values:Record<string,string>={};
 for(const mapping of mappings.filter(item=>item.representation==='structured-patient')){
  const matches=rows.filter(row=>row.element_id===hospitalFieldId(mapping.source));
  const error=()=>findings.push({code:'patientDemographic',severity:'error',mappingId:mapping.id});
  if(matches.length>1){error();continue;}
  const row=matches[0];
  if(!row||['absent','null','pertinent-negative'].includes(row.value_kind)||row.not_value_code||row.pertinent_negative_code)continue;
  let value:string|undefined;
  if(mapping.section==='patientGender'){
   if(row.value_kind==='coded'&&!row.code_system)value=genderCodes[String(row.code)];
  }else if(mapping.section==='patientBirthDate'){
   if(row.value_kind==='date'&&typeof row.value_date==='string'&&validDate(row.value_date))value=row.value_date;
  }else if(row.value_kind==='text'&&typeof row.value_text==='string'&&row.value_text.trim())value=row.value_text;
  if(value===undefined){error();continue;}values[mapping.section]=value;
 }
 const given=[values.patientGiven,values.patientMiddle].filter((value):value is string=>!!value);
 const name:Name={...(values.patientFamily?{family:values.patientFamily}:{}),...(given.length?{given}:{}),...(values.patientSuffix?{suffix:[values.patientSuffix]}:{})};
 return {name:[Object.keys(name).length?name:{_text:absent}],...(values.patientBirthDate?{birthDate:values.patientBirthDate}:{_birthDate:absent}),...(values.patientGender?{gender:values.patientGender}:{})};
}
