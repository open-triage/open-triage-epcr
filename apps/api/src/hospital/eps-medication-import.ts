import { narrativeText, type PatientSummary } from '@open-triage/contracts';
type Entry = NonNullable<PatientSummary['importEntries']>[number];
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
/** MedicationStatement is a reported regimen, never an encounter administration.
 * Preserve the source's status, timing and complete dosage structure as text;
 * no code, route, dose or unit conversion is inferred. */
export function medicationSource(entry:Entry) {
 const resource=entry.resource;
 const direct=object(resource.medicationCodeableConcept);
 const concept=Object.keys(direct).length?direct:object(entry.medication?.code);
 const lines:string[]=[];
 let unsupported=false;
 const walk=(value:unknown,path:string,depth=0)=>{
  if(depth>40){unsupported=true;return;}
  if(Array.isArray(value))value.forEach((item,index)=>walk(item,`${path}[${index+1}]`,depth+1));
  else if(value&&typeof value==='object')Object.entries(value).forEach(([key,item])=>{
   if((key==='modifierExtension'||key==='extension')&&Array.isArray(item)&&item.length)unsupported=true;
   walk(item,path?`${path}.${key}`:key,depth+1);
  });
  else if(value!==undefined)lines.push(`${path}: ${path.endsWith('.div')?narrativeText(String(value)):String(value)}`);
 };
 walk(resource,'MedicationStatement');
 if(entry.medication)walk(entry.medication,'Medication');
 const unresolved=!!resource.medicationReference&&!entry.medication;
 const invalidChoice=!!resource.medicationReference&&!!resource.medicationCodeableConcept;
 const status=resource.status;
 const finding=unresolved?'medicationReference':invalidChoice||unsupported?'semantics':
  !['active','completed','stopped','on-hold','intended','not-taken','unknown'].includes(String(status))?'status':null;
 return {concept,incoming:lines.join('\n'),finding};
}
