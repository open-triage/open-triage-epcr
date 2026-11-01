import {COS_ELEMENT_MAPPINGS,type CosMappingDefinition} from '@open-triage/contracts';
import type {SignedReportClinicalSource} from '../reports/signed-report-pdf.js';
import type {CosProjectionFinding} from './cos-vitals.js';
import {qualified,matches} from './cos-clinical-context.js';
import {buildCosMedications} from './cos-medications.js';
/** Enabling v2 cannot silently downgrade documented supported care to note-only. */
export function cosUnmappedClinicalFindings(source:SignedReportClinicalSource,mapping:CosMappingDefinition):CosProjectionFinding[]{
 const findings:CosProjectionFinding[]=[];
 for(const [vital,spec] of Object.entries(COS_ELEMENT_MAPPINGS.vitals)){
  const ids=[spec.source,...(vital==='bloodPressure'&&'companionSource' in spec?[spec.companionSource]:[])];
  for(const row of source.occurrences.filter(row=>ids.includes(row.element_id)&&!qualified(row))){
   if(mapping.vitalMappings?.some(config=>config.vital===vital&&(matches(row,config.source)||(vital==='bloodPressure'&&config.companionSource&&matches(row,config.companionSource)))))continue;
   findings.push({mappingId:vital,occurrenceId:row.id,code:'clinicalMappingMissing',coverage:'partial'});
  }
 }
 if(!mapping.medicationMappings?.length){
  const probe=buildCosMedications(source,[{id:'administered-medications',groupId:COS_ELEMENT_MAPPINGS.assessment.medicationGroup}]);
  findings.push(...probe.findings);
  for(const id of probe.projectedGroupIds)findings.push({mappingId:'administered-medications',occurrenceId:id,code:'clinicalMappingMissing',coverage:'partial'});
 }
 return findings;
}
