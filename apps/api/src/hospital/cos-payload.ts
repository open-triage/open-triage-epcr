import { createHash } from 'node:crypto';
import { hospitalFieldId, hospitalIdentifierSchemeFinding, hospitalIdentifierNamespace, isSupportedHospitalIdentifierNamespace, type CosPayloadSettings, type HospitalField } from '@open-triage/contracts';
import { identifierOptions } from './hospital-mapping.js';
import { compileCosMapping, cosMappingPackage } from './cos-configuration.js';
import { cosDestinationRequested } from './cos-destination.js';
import { contentDigest, type CanonicalPackage } from '../admin/canonical-package.js';
import { effectiveSignedPdfOccurrences, type SignedReportClinicalSource, type SignedOccurrence } from '../reports/signed-report-pdf.js';
import { cosUnmappedClinicalFindings } from './cos-completeness.js';
import { buildCosMedications } from './cos-medications.js';
import { buildCosVitals, type CosProjectionFinding } from './cos-vitals.js';
import { CosFinding } from './cos-finding.js';
import { cosPdfItem } from './cos-pdf.js';
export { CosFinding } from './cos-finding.js';
export const bytesHash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export const COS_SIMULATOR_LIMITS=Object.freeze({sourceOccurrences:10000,items:2000,textBytes:1024*1024,bundleBytes:2*1024*1024});
/** Disposition is descriptive payload content, never a transmission condition. */
function cosDispositionCode(rows:SignedOccurrence[],id:string):string|null {
 const found=rows.filter(row=>row.element_id===id);
 return found.length===1&&found[0]!.value_kind==='coded'&&!found[0]!.not_value_code&&!found[0]!.pertinent_negative_code?String(found[0]!.code):null;
}
function values(source:SignedReportClinicalSource,field:HospitalField){return source.occurrences.filter(row=>field.kind==='custom'?row.element_identity_id===hospitalFieldId(field):row.element_id===hospitalFieldId(field));}
function scalar(source:SignedReportClinicalSource,field:HospitalField,code:string):string {
 const rows=values(source,field);if(rows.length!==1)throw new CosFinding(code);
 const row=rows[0]!;
 if(row.value_kind!=='text'||typeof row.value_text!=='string'||!row.value_text.trim()||row.not_value_code||row.pertinent_negative_code)throw new CosFinding(code);
 return row.value_text;
}
/** Resolve a raw immutable signed version, applying amendments exactly once. */
export function resolveSignedCosCareUnit(source:SignedReportClinicalSource,settings:CosPayloadSettings):string {
 return cosCareUnitFor({...source,occurrences:effectiveSignedPdfOccurrences(source)},settings);
}
/** Destination identity is explicit; absent destination documentation uses the ambulance unit. */
function cosCareUnitFor(source:SignedReportClinicalSource,settings:CosPayloadSettings):string {
 if(!cosDestinationRequested(source.occurrences)){
  const unit=settings.defaultAmbulanceCareUnit;
  if(!unit?.trim())throw new CosFinding('ambulanceCareUnit');
  return unit;
 }
 scalar(source,{kind:'nemsis',elementId:'eDisposition.01'},'destination');
 scalar(source,{kind:'nemsis',elementId:'eDisposition.02'},'destination');
 const unit=settings.destinationHsaId;
 if(!unit?.trim())throw new CosFinding('careUnit');
 return unit;
}
/** Collect all missing requirements together; no patient values enter Review evidence. */
export function cosIdentifierRequirements(source:SignedReportClinicalSource,p:CanonicalPackage,settings:CosPayloadSettings){
 source={...source,occurrences:effectiveSignedPdfOccurrences(source)};
 const configuredField=cosMappingPackage(p).definition.patientIdentifier.field;
 const patientField=identifierOptions(source.configuration).find(option=>option.field.kind===configuredField.kind&&option.id===hospitalFieldId(configuredField))??{field:configuredField,id:hospitalFieldId(configuredField),name:hospitalFieldId(configuredField),localization:null};
 let mapping:ReturnType<typeof compileCosMapping>;
 try{mapping=compileCosMapping(p,source.configuration);}catch(error){
  if(error instanceof Error&&'getStatus' in error&&typeof error.getStatus==='function'&&error.getStatus()===422)return {missing:['configuration'],patientField};
  throw error;
 }
 const missing:string[]=[];
 try{const patient=scalar(source,mapping.patientIdentifier.field,'patientIdentifier');if(hospitalIdentifierSchemeFinding(hospitalIdentifierNamespace(mapping.patientIdentifier.namespace,patient),patient)==='invalid')missing.push('patientIdentifier');}catch(error){if(error instanceof CosFinding)missing.push(error.code);else throw error;}
 if(!isSupportedHospitalIdentifierNamespace(mapping.patientIdentifier.namespace))missing.push('patientNamespace');
 if(!settings.authorHsaId?.trim())missing.push('staff');
 try{cosCareUnitFor(source,settings);}catch(error){if(error instanceof CosFinding)missing.push(error.code);else throw error;}
 if(!settings.defaultAmbulanceCareUnit?.trim()&&!missing.includes('ambulanceCareUnit'))missing.push('ambulanceCareUnit');
 if(!settings.organizationHsaId)missing.push('organization');
 if(!settings.encounterNamespace)missing.push('encounter');
 if(!mapping.pdfLinkId)missing.push('pdfMapping');
 return {missing,patientField};
}
export function buildCosPayload(source:SignedReportClinicalSource,p:CanonicalPackage,settings:CosPayloadSettings,pdf:Buffer,deliveryId:string){
 const identifierSource=source;
 source={...source,occurrences:effectiveSignedPdfOccurrences(source)};
 if(source.occurrences.length>COS_SIMULATOR_LIMITS.sourceOccurrences)throw new CosFinding('simulatorLimit','failed');
 let sourceBytes=0;for(const row of source.occurrences){sourceBytes+=typeof row.value_text==='string'?Buffer.byteLength(row.value_text):0;if(sourceBytes>COS_SIMULATOR_LIMITS.textBytes)throw new CosFinding('simulatorLimit','failed');}
 if(settings.mode==='live'&&!settings.live)throw new CosFinding('liveUnverified','failed');
 const mapping=compileCosMapping(p,source.configuration);
 const requirements=cosIdentifierRequirements(identifierSource,p,settings);
 if(requirements.missing.length)throw new CosFinding(requirements.missing[0]!);
 const patient=scalar(source,mapping.patientIdentifier.field,'patientIdentifier');
 if(!isSupportedHospitalIdentifierNamespace(mapping.patientIdentifier.namespace))throw new CosFinding('patientNamespace');
 const amendment=source.amendments.at(-1);
 const staff=settings.authorHsaId;
 if(!staff?.trim())throw new CosFinding('staff');
 const careUnit=cosCareUnitFor(source,settings);
 if(!settings.template||!settings.organizationHsaId||!settings.encounterNamespace)throw new CosFinding('configuration');
 if(!mapping.pdfLinkId)throw new CosFinding('pdfMapping');
 const patientIdentifier={system:hospitalIdentifierNamespace(mapping.patientIdentifier.namespace,patient),value:patient};
 const encounter={system:settings.encounterNamespace,value:source.reportId};
 const contact={contract:'opentriage-cos-simulator-v1',reportId:source.reportId,patient:patientIdentifier,encounter,staff,
  organization:settings.organizationHsaId,careUnit,synthetic:source.synthetic,
  disposition:{unit:cosDispositionCode(source.occurrences,'eDisposition.27'),care:cosDispositionCode(source.occurrences,'eDisposition.28'),transport:cosDispositionCode(source.occurrences,'eDisposition.30')}};
 let itemCount=0,textBytes=0;const clinicalFindings:CosProjectionFinding[]=[];
 const items=mapping.clinicalMappings.flatMap(row=>{
  const matched=values(source,row.source);
  if(!matched.length)return [];
  itemCount+=matched.length;if(itemCount>COS_SIMULATOR_LIMITS.items)throw new CosFinding('simulatorLimit','failed');
  return matched.flatMap(value=>{
   // Never stringify missing-data flags or silently strip qualifiers into asserted text.
   if(value.value_kind!=='text'||typeof value.value_text!=='string'||value.not_value_code||value.pertinent_negative_code){clinicalFindings.push({mappingId:row.id,occurrenceId:value.id,code:'clinicalValue',coverage:'partial'});return [];}
   textBytes+=Buffer.byteLength(value.value_text);if(textBytes>COS_SIMULATOR_LIMITS.textBytes)throw new CosFinding('simulatorLimit','failed');
   return [{linkId:row.linkId,answer:[{valueString:value.value_text}]}];
  });
 });
 const vitals=buildCosVitals(source,mapping.vitalMappings??[],{deliveryId,patient:patientIdentifier,encounter,staff,careUnit:settings.defaultAmbulanceCareUnit},COS_SIMULATOR_LIMITS.items-itemCount);
 const medications=buildCosMedications(source,mapping.medicationMappings??[]);
 if(itemCount+vitals.entries.length+medications.items.length>COS_SIMULATOR_LIMITS.items)throw new CosFinding('simulatorLimit','failed');
 if(settings.mode==='live'&&settings.live)items.push({linkId:settings.live.versionMarkerLinkId,answer:[{valueString:`OpenTriage delivery ${deliveryId}`}]});
 const pdfSha256=bytesHash(pdf);
 const pdfItem=cosPdfItem(mapping.pdfLinkId,settings.mode==='live'?{kind:'inline',bytes:pdf}:{kind:'simulator',deliveryId,sha256:pdfSha256});
 const noteVitals=settings.mode==='live'?vitals.items.map(item=>({linkId:item.linkId,answer:item.answer.map(answer=>{const observation=vitals.entries.find(entry=>entry.fullUrl===answer.valueReference.reference)!.resource;const q=observation.valueQuantity as {value:number;unit:string}|undefined;const components=observation.component as {valueQuantity:{value:number;unit:string}}[]|undefined;const concept=observation.valueCodeableConcept as {coding:{code:string}[]}|undefined;return {valueString:`${observation.effectiveDateTime}: ${q?`${q.value} ${q.unit}`:components?components.map(component=>`${component.valueQuantity.value} ${component.valueQuantity.unit}`).join(' / '):concept?.coding.map(c=>c.code).join(', ')}`};})})):vitals.items;
 const lastUpdated=amendment?.signedAt??source.signedAt;
 const resourceId=settings.mode==='live'?source.reportId:deliveryId;
 const bundle={resourceType:'Bundle',id:resourceId,type:'collection',meta:{profile:[mapping.profile.bundle],lastUpdated},identifier:{system:'urn:opentriage:cos:delivery',value:deliveryId},
  entry:[{fullUrl:`urn:uuid:${resourceId}`,resource:{resourceType:'QuestionnaireResponse',id:resourceId,meta:{profile:[mapping.profile.questionnaire],lastUpdated},
   identifier:{system:'urn:opentriage:cos:report',value:source.reportId},questionnaire:settings.template,status:'completed',
   subject:{type:'Patient',identifier:patientIdentifier},encounter:{identifier:encounter},authored:amendment?.signedAt??source.signedAt,
   author:{type:'Practitioner',identifier:{system:'urn:oid:1.2.752.129.2.1.4.1',value:staff}},
   item:[...items,...noteVitals,...medications.items,pdfItem]}},...(settings.mode==='live'?[]:vitals.entries)]};
 if(Buffer.byteLength(JSON.stringify(bundle))>COS_SIMULATOR_LIMITS.bundleBytes)throw new CosFinding('simulatorLimit','failed');
 return {observations:vitals.entries.map(entry=>entry.resource),findings:[...cosUnmappedClinicalFindings(source,mapping),...clinicalFindings,...vitals.findings,...medications.findings],amendmentSequence:source.amendmentSequence,bundle,pdf,pdfSha256,payloadSha256:contentDigest({bundle,pdfSha256}),contact,contactSha256:contentDigest(contact)};
}
export type CosPreparedPayload=ReturnType<typeof buildCosPayload>;
