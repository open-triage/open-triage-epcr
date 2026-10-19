import { EPS_PATIENT_OUTPUT_FIELDS, type ClinicalFormConfiguration, type EpsOutputMapping, hospitalFieldId } from '@open-triage/contracts';
import { invalid, keys, patientField } from './hospital-mapping.js';
export const EPS_SECTIONS={problems:['11450-4','Problem list'],allergies:['48765-2','Allergies and adverse reactions'],medications:['10160-0','History of medication use'],procedures:['47519-4','History of procedures'],devices:['46264-8','Medical devices'],patientStory:['81338-6','Patient story'],patientHistory:['11329-0','History of general health']} as const;
export function outputMappings(input:unknown,form?:ClinicalFormConfiguration):EpsOutputMapping[]{
 if(input===undefined)return [];
 if(!Array.isArray(input)||input.length>200)return invalid();
 const seen=new Set<string>(),targets=new Set<string>();
 return input.map(value=>{
  const row=keys(value,['id','source','section','representation']);
  if(typeof row.id!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(row.id)||seen.has(row.id)||typeof row.section!=='string'||!Object.hasOwn({...EPS_SECTIONS,...EPS_PATIENT_OUTPUT_FIELDS},row.section))return invalid();
  seen.add(row.id);const source=patientField(row.source),id=hospitalFieldId(source);
  const structured=Object.hasOwn(EPS_PATIENT_OUTPUT_FIELDS,row.section);
  if(row.representation!==(structured?'structured-patient':'signed-narrative'))return invalid();
  if(structured){
   if(targets.has(row.section))return invalid();targets.add(row.section);
   // Fixed, explicit NEMSIS crosswalks; no arbitrary field can claim to be a demographic.
   if(source.kind!=='nemsis'||EPS_PATIENT_OUTPUT_FIELDS[row.section as keyof typeof EPS_PATIENT_OUTPUT_FIELDS]!==id)return invalid();
  }
  if(form){const field=source.kind==='custom'?form.customFields?.[id]:form.catalogFields[id];if(!field||source.kind==='custom'&&form.customFields?.[id]?.retired)return invalid();
   // Administrative configuration cannot turn current medications/vitals/treatments into longitudinal history.
   if(source.kind==='nemsis'){
    const sections:Record<string,string[]>={allergies:['eHistory.06','eHistory.07'],problems:['eHistory.08','eHistory.09'],medications:['eHistory.12','eHistory.13','eHistory.14','eHistory.15'],procedures:[],devices:[]};
    if(sections[row.section]&&!sections[row.section]!.includes(id))return invalid();
    if(row.section==='patientHistory'&&!id.startsWith('eHistory.'))return invalid();
   }
  }
  return {id:row.id,source,section:row.section as EpsOutputMapping['section'],representation:structured?'structured-patient':'signed-narrative'};
 });
}
