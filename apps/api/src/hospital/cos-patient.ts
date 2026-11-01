import { hospitalIdentifierSchemeFinding, SWEDISH_PATIENT_IDENTIFIER_NAMESPACES } from '@open-triage/contracts';
import { effectiveSignedPdfOccurrences, type SignedReportClinicalSource } from '../reports/signed-report-pdf.js';
import type { CosResource } from './cos-live-adapter.js';
export const COS_PATIENT_PROFILE='https://fhir.cambio.se/StructureDefinition/PatientSe/v1';
/** Pin only documented demographics from the effective signed version. Never infer
 * birth date or administrative sex from an identifier or manufacture a name. */
export function buildCosPatient(source:Pick<SignedReportClinicalSource,'occurrences'|'amendments'|'amendmentSequence'>,identifier:CosResource):CosResource {
 const rows=effectiveSignedPdfOccurrences(source);
 const scalar=(field:string,kind:string,key:string)=>{
  const values=rows.filter(row=>row.element_id===field);
  const row=values.length===1?values[0]:undefined;
  return row?.value_kind===kind&&!row.not_value_code&&!row.pertinent_negative_code&&typeof row[key]==='string'&&String(row[key]).trim()?String(row[key]):undefined;
 };
 const family=scalar('ePatient.02','text','value_text'),first=scalar('ePatient.03','text','value_text'),middle=scalar('ePatient.04','text','value_text');
 const sex=rows.filter(row=>row.element_id==='ePatient.25');
 const gender=sex.length===1&&!sex[0]!.code_system?({'9919001':'female','9919003':'male','9919005':'unknown'} as Record<string,string>)[scalar('ePatient.25','coded','code')??'']:undefined;
 const birthDate=scalar('ePatient.17','date','value_date');
 return {resourceType:'Patient',meta:{profile:[COS_PATIENT_PROFILE]},identifier:[identifier],
  name:[{...(family?{family}:{}),...(first?{given:[first,...(middle?[middle]:[])]}:{})}],...(gender?{gender}:{}),...(birthDate?{birthDate}:{})};
}
export function cosPatientCanRegister(patient:CosResource){
 const id=patient.identifier?.[0];
 if(!id||![SWEDISH_PATIENT_IDENTIFIER_NAMESPACES.personal,SWEDISH_PATIENT_IDENTIFIER_NAMESPACES.coordination].includes(id.system)||hospitalIdentifierSchemeFinding(id.system,id.value)!==null)return false;
 const name=patient.name?.[0],date=patient.birthDate;
 return !!(name?.family&&name.given?.length&&['female','male','unknown'].includes(patient.gender)&&typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date);
}
/** Existing demographics may be richer, but any supplied signed value must agree.
 * An exact identifier alone never clears conflicting demographics. */
export function cosPatientMatches(expected:CosResource,actual:CosResource){
 const id=expected.identifier?.[0],name=expected.name?.[0];
 return actual.resourceType==='Patient'&&typeof actual.id==='string'&&/^[A-Za-z0-9.-]{1,100}$/.test(actual.id)&&
  actual.identifier?.some((i:CosResource)=>i.system===id?.system&&i.value===id?.value)&&
  (!expected.birthDate||actual.birthDate===expected.birthDate)&&(!expected.gender||expected.gender==='unknown'||actual.gender===expected.gender)&&
  (!(name?.family||name?.given?.length)||actual.name?.some((n:CosResource)=>(!name.family||n.family===name.family)&&(!name.given?.length||JSON.stringify(n.given)===JSON.stringify(name.given))));
}
