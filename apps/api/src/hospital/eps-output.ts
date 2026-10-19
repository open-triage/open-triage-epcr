import { hospitalFieldId } from '@open-triage/contracts';
import { createHash } from 'node:crypto';
import { mappingPackage } from './hospital-mapping.js';
import { EPS_SECTIONS, outputMappings } from './eps-output-mapping.js';
import { effectiveSignedPdfOccurrences, signedPdfValue, type SignedReportClinicalSource } from '../reports/signed-report-pdf.js';
export const EPS_PROFILE='http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps';
export const EPS_DEPENDENCIES={'hl7.fhir.eu.eps':'1.0.0-ballot','hl7.fhir.r4.core':'4.0.1','hl7.terminology.r4':'7.1.0','hl7.fhir.uv.extensions.r4':'5.3.0','hl7.fhir.uv.ips':'2.0.0','hl7.fhir.eu.base':'2.0.0','hl7.fhir.uv.xver-r5.r4':'0.1.0','hl7.fhir.eu.extensions.r4':'1.3.0','ihe.pharm.mpd.r4':'1.0.0-comment-2'};
export type EpsFinding={code:string;severity:'error'|'warning';mappingId?:string;section?:string};
export const xml=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const narrative=(text:string)=>({status:'generated',div:`<div xmlns="http://www.w3.org/1999/xhtml"><p>${xml(text).replace(/\n/g,'</p><p>')}</p></div>`});
const absent={url:'http://hl7.org/fhir/StructureDefinition/data-absent-reason',valueCode:'unknown'};
export function buildEpsOutput(source:SignedReportClinicalSource,canonical:unknown,id:string){
 const mapping=mappingPackage(canonical).definition,findings:EpsFinding[]=[];
 const rows=effectiveSignedPdfOccurrences(source);
 if(rows.length>10000||rows.reduce((total,row)=>total+Buffer.byteLength(JSON.stringify(row)),0)>2*1024*1024)throw new Error('epsSubmission.tooLarge');
 const values=(field:typeof mapping.patientIdentifier.field)=>rows.filter(row=>field.kind==='custom'?row.element_identity_id===hospitalFieldId(field):row.element_id===hospitalFieldId(field));
 const patientRows=values(mapping.patientIdentifier.field),patientValue=patientRows[0];
 const patient=patientRows.length===1&&patientValue?.value_kind==='text'&&typeof patientValue.value_text==='string'&&patientValue.value_text.trim()&&!patientValue.not_value_code&&!patientValue.pertinent_negative_code?patientValue.value_text:null;
 if(!patient)findings.push({code:'patientIdentifier',severity:'error'});
 const mappings=outputMappings(mapping.outputMappings).filter(item=>{try{outputMappings([item],source.configuration);return true;}catch{findings.push({code:'incompatibleMapping',severity:'error',mappingId:item.id});return false;}});
 if(!mappings.length)findings.push({code:'outputMapping',severity:'error'});
 const sections=Object.entries(EPS_SECTIONS).flatMap(([key,[code,title]],index)=>{
  const selected=mappings.filter(row=>row.section===key),paragraphs:string[]=[];
  for(const item of selected){const matched=values(item.source);for(const row of matched){
   let text=signedPdfValue(row,source,'en');
   const imported=row.provenance_detail as {epsImport?:{mappingId?:string;mappingRevision?:number;documentVersion?:string;documentSha256?:string;entryId?:string;decision?:string}}|null;
   const group=source.groups.find(group=>group.id===row.group_instance_id);
   // Display signed history verbatim, with its signed timing and import attribution. No reconstruction of unimported FHIR.
   text=`${hospitalFieldId(item.source)}${group?` (${group.group_id}, occurrence ${group.ordinal+1}, source group ${group.id})`:''}: ${text}${group?.documented_time?`\nDocumented: ${group.documented_time}`:''}${imported?.epsImport?`\n${row.provenance_kind==='amendment'?'Amended clinical history originally imported from EPS':'Confirmed EPS import (signed clinical history)'}; source document ${imported.epsImport.documentVersion??''}, digest ${imported.epsImport.documentSha256??''}, entry ${imported.epsImport.entryId??''}; mapping ${imported.epsImport.mappingId??''} revision ${imported.epsImport.mappingRevision??''}; decision ${imported.epsImport.decision??''}`:''}`;
   paragraphs.push(text);
  }}
  if(index>4&&!paragraphs.length)return [];
  if(!paragraphs.length)findings.push({code:'missingData',severity:'warning',section:key});
  return [{title,code:{coding:[{system:'http://loinc.org',code}]},text:narrative(paragraphs.length?paragraphs.join('\n'): 'Information unavailable in this signed report; no assertion that none exists.'),...(!paragraphs.length?{emptyReason:{coding:[{system:'http://terminology.hl7.org/CodeSystem/list-empty-reason',code:'unavailable'}]}}:{})}];
 });
 const ref=(suffix:string)=>`urn:uuid:${createHash('sha256').update(`${id}:${suffix}`).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/,'$1-$2-$3-$4-$5')}`;
 const date=source.amendments.at(-1)?.signedAt??source.signedAt;
 const composition={resourceType:'Composition',id:ref('composition').slice(9),text:narrative('Signed European Patient Summary; clinical sections reflect only the selected signed report version.'),meta:{profile:['http://hl7.eu/fhir/eps/StructureDefinition/composition-eu-eps']},identifier:{system:'urn:opentriage:eps:version',value:id},status:'final',type:{coding:[{system:'http://loinc.org',code:'60591-5'}]},subject:{reference:ref('patient')},date,author:[{reference:ref('author')}],title:'Signed European Patient Summary',section:sections};
 const bundle={resourceType:'Bundle',type:'document',meta:{profile:[EPS_PROFILE]},identifier:{system:'urn:opentriage:eps:document',value:id},timestamp:date,entry:[{fullUrl:ref('composition'),resource:composition},{fullUrl:ref('patient'),resource:{resourceType:'Patient',id:ref('patient').slice(9),meta:{profile:['http://hl7.eu/fhir/eps/StructureDefinition/patient-eu-eps']},identifier:patient?[{system:mapping.patientIdentifier.namespace,value:patient}]:[{extension:[absent]}],name:[{_text:{extension:[absent]}}],_birthDate:{extension:[absent]},text:narrative(patient??'Patient identifier unavailable')}},{fullUrl:ref('author'),resource:{resourceType:'Device',id:ref('author').slice(9),deviceName:[{name:'OpenTriage signed EPS generator',type:'user-friendly-name'}],text:narrative('Generated from an immutable signed report version.')}}]};
 if(Buffer.byteLength(JSON.stringify(bundle))>2*1024*1024)throw new Error('epsSubmission.tooLarge');
 return {bundle,findings,dependencies:EPS_DEPENDENCIES,amendmentHashes:source.amendments.map(row=>row.canonicalSha256)};
}
