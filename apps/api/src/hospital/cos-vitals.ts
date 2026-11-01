import { createHash } from 'node:crypto';
import type { CosVitalMapping } from '@open-triage/contracts';
import type { SignedReportClinicalSource } from '../reports/signed-report-pdf.js';
import { CosFinding } from './cos-finding.js';
import { COS_VITAL_PROFILES,COS_ELEMENT_MAPPINGS } from './cos-vital-profiles.js';
import {clinicalContext,companion,matches,numeric,qualified,nemsisEnumeration} from './cos-clinical-context.js';
type Identity={system:string;value:string};
export type CosProjectionFinding={mappingId:string;occurrenceId:string;code:string;coverage:'partial'|'note-pdf-only'};
const coding=(loinc:string,snomed:string)=>({coding:[...(loinc?[{system:'http://loinc.org',code:loinc}]:[]),{system:'http://snomed.info/sct',code:snomed}]});
const quantity=(value:number,unit:string)=>({value,unit,system:'http://unitsofmeasure.org',code:unit});
/** Retain independent valid artifacts and explicit findings for incomplete projection. */
export function buildCosVitals(source:SignedReportClinicalSource,mappings:CosVitalMapping[],context:{
 deliveryId:string;patient:Identity;encounter:Identity;staff:string;careUnit:string;
},remaining:number){
 const entries:Array<{fullUrl:string;resource:Record<string,unknown>}>=[];
 const items:Array<{linkId:string;answer:Array<{valueReference:{reference:string}}>}> = [];
 const findings:CosProjectionFinding[]=[];
 for(const mapping of mappings){
  const spec=COS_VITAL_PROFILES[mapping.vital],answer:Array<{valueReference:{reference:string}}>=[];
  for(const row of source.occurrences.filter(row=>matches(row,mapping.source))){
   try{
    if(entries.length>=remaining)throw new CosFinding('simulatorLimit','failed');
    if(qualified(row))throw new CosFinding('clinicalValue');
    const effectiveDateTime=clinicalContext(source,row,COS_ELEMENT_MAPPINGS.assessment.vitalGroup).time;
    let value:Record<string,unknown>;
    if(mapping.vital==='avpu'){
     const code=COS_ELEMENT_MAPPINGS.avpu[String(row.code) as keyof typeof COS_ELEMENT_MAPPINGS.avpu];
     if(!nemsisEnumeration(row)||!code)throw new CosFinding('clinicalTerminology');value={valueCodeableConcept:coding('',code)};
    }else if(mapping.vital==='painNrs'){
     const score=numeric(row);if(!Number.isInteger(score)||score<0||score>10)throw new CosFinding('clinicalValue');
     value={valueCodeableConcept:{coding:[{system:COS_ELEMENT_MAPPINGS.numericPainSystem,code:String(score)}]}};
    }else if(mapping.vital==='bloodPressure'){
     if(!mapping.companionSource)throw new CosFinding('clinicalGroup');const diastolic=companion(source,row,mapping.companionSource);if(companion(source,diastolic,mapping.source).id!==row.id)throw new CosFinding('clinicalGroup');
     value={component:[{code:coding(COS_ELEMENT_MAPPINGS.bloodPressureComponents.systolic.loinc,COS_ELEMENT_MAPPINGS.bloodPressureComponents.systolic.snomed),valueQuantity:quantity(numeric(row),'mm[Hg]')},{code:coding(COS_ELEMENT_MAPPINGS.bloodPressureComponents.diastolic.loinc,COS_ELEMENT_MAPPINGS.bloodPressureComponents.diastolic.snomed),valueQuantity:quantity(numeric(diastolic,mapping.companionSource.kind==='nemsis'?COS_ELEMENT_MAPPINGS.numericTextRules.bloodPressure:undefined),'mm[Hg]')}]};
    }else value={valueQuantity:quantity(numeric(row),spec.unit)};
    const sourceId=createHash('sha256').update(JSON.stringify([source.reportId,mapping.vital,row.id])).digest('hex');
    const hex=createHash('sha256').update(JSON.stringify([context.deliveryId,mapping.id,row.id])).digest('hex');
    const id=`${hex.slice(0,8)}-${hex.slice(8,12)}-8${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
    const fullUrl=`urn:uuid:${id}`;
    entries.push({fullUrl,resource:{resourceType:'Observation',id,identifier:[{system:'urn:opentriage:cos:source',value:sourceId}],meta:{profile:[spec.profile],lastUpdated:source.amendments.at(-1)?.signedAt??source.signedAt},status:'final',
     category:[{coding:[{system:'http://terminology.hl7.org/CodeSystem/observation-category',code:'vital-signs'}]}],code:coding(spec.loinc,spec.snomed),
     subject:{type:'Patient',identifier:context.patient},encounter:{identifier:context.encounter},effectiveDateTime,
     performer:[{type:'Practitioner',identifier:{system:'urn:oid:1.2.752.129.2.1.4.1',value:context.staff}},{type:'Organization',identifier:{system:'urn:oid:1.2.752.129.2.1.4.1',value:context.careUnit}}],...value}});
    // The note profile has no NRS reference slice; preserve it in the signed PDF.
    if(mapping.vital!=='painNrs')answer.push({valueReference:{reference:fullUrl}});
   }catch(error){if(!(error instanceof CosFinding)||error.code==='simulatorLimit')throw error;findings.push({mappingId:mapping.id,occurrenceId:row.id,code:error.code,coverage:'partial'});}
  }
  if(mapping.vital==='bloodPressure'&&mapping.companionSource){
   for(const row of source.occurrences.filter(row=>matches(row,mapping.companionSource!))){
    try{companion(source,row,mapping.source);}catch(error){if(!(error instanceof CosFinding))throw error;findings.push({mappingId:mapping.id,occurrenceId:row.id,code:error.code,coverage:'partial'});}
   }
  }
  if(answer.length)items.push({linkId:mapping.linkId,answer});
 }
 return {entries,items,findings};
}
