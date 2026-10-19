import { createHash } from 'node:crypto';
import { hospitalFieldId, type CosConnectionSettings, type HospitalField } from '@open-triage/contracts';
import { identifierOptions } from './hospital-mapping.js';
import { compileCosMapping, cosMappingPackage, resolveCosCareUnit } from './cos-configuration.js';
import { contentDigest, type CanonicalPackage } from '../admin/canonical-package.js';
import { effectiveSignedPdfOccurrences, type SignedOccurrence, type SignedReportPdfSource } from '../reports/signed-report-pdf.js';
export const bytesHash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export const COS_SIMULATOR_LIMITS=Object.freeze({sourceOccurrences:10000,items:2000,textBytes:1024*1024,bundleBytes:2*1024*1024});
export class CosFinding extends Error { constructor(public readonly code:string,public readonly state:'waiting'|'failed'|'excluded'='waiting'){super(code);} }
function values(source:SignedReportPdfSource,field:HospitalField){return source.occurrences.filter(row=>field.kind==='custom'?row.element_identity_id===hospitalFieldId(field):row.element_id===hospitalFieldId(field));}
function scalar(source:SignedReportPdfSource,field:HospitalField,code:string):string {
 const rows=values(source,field);if(rows.length!==1)throw new CosFinding(code);
 const row=rows[0]!;
 if(row.value_kind!=='text'||typeof row.value_text!=='string'||!row.value_text.trim()||row.not_value_code||row.pertinent_negative_code)throw new CosFinding(code);
 return row.value_text;
}
function coded(rows:SignedOccurrence[],id:string):string|null {
 const found=rows.filter(row=>row.element_id===id);
 return found.length===1&&found[0]!.value_kind==='coded'&&!found[0]!.not_value_code&&!found[0]!.pertinent_negative_code?String(found[0]!.code):null;
}
export function cosEligibility(rows:SignedOccurrence[]):'transported'|'excluded'|'waiting' {
 const unit=coded(rows,'eDisposition.27');
 if(unit&&['4227003','4227005','4227007','4227009','4227011'].includes(unit))return 'excluded';
 const care=coded(rows,'eDisposition.28'),transport=coded(rows,'eDisposition.30');
 return unit==='4227001'&&care&&['4228001','4228003','4228005','4228007','4228009'].includes(care)&&transport&&['4230001','4230003','4230005','4230007'].includes(transport)?'transported':'waiting';
}
/** Collect all missing requirements together; no patient values enter Review evidence. */
export function cosIdentifierRequirements(source:SignedReportPdfSource,p:CanonicalPackage,settings:CosConnectionSettings){
 source={...source,occurrences:effectiveSignedPdfOccurrences(source),signerId:source.amendments.at(-1)?.authorId??source.signerId};
 const configuredField=cosMappingPackage(p).definition.patientIdentifier.field;
 const patientField=identifierOptions(source.configuration).find(option=>option.field.kind===configuredField.kind&&option.id===hospitalFieldId(configuredField))??{field:configuredField,id:hospitalFieldId(configuredField),name:hospitalFieldId(configuredField),localization:null};
 let mapping:ReturnType<typeof compileCosMapping>;
 try{mapping=compileCosMapping(p,source.configuration);}catch(error){
  if(error instanceof Error&&'getStatus' in error&&typeof error.getStatus==='function'&&error.getStatus()===422)return {missing:['configuration'],patientField};
  throw error;
 }
 const missing:string[]=[];
 try{scalar(source,mapping.patientIdentifier.field,'patientIdentifier');}catch(error){if(error instanceof CosFinding)missing.push(error.code);else throw error;}
 if(!['urn:oid:1.2.752.129.2.1.3.1','urn:oid:1.2.752.129.2.1.3.2'].includes(mapping.patientIdentifier.namespace))missing.push('patientNamespace');
 if(!settings.staff.find(row=>row.userId===source.signerId)?.hsaId)missing.push('staff');
 let destination:{hospital:string;localCareUnit:string}|undefined;
 try{destination={hospital:scalar(source,{kind:'nemsis',elementId:'eDisposition.01'},'destination'),localCareUnit:scalar(source,{kind:'nemsis',elementId:'eDisposition.02'},'destination')};}
 catch(error){if(error instanceof CosFinding)missing.push(error.code);else throw error;}
 if(destination&&!resolveCosCareUnit(settings,destination))missing.push('careUnit');
 if(!settings.organizationHsaId)missing.push('organization');
 if(!settings.encounterNamespace)missing.push('encounter');
 return {missing,patientField};
}
export function buildCosPayload(source:SignedReportPdfSource,p:CanonicalPackage,settings:CosConnectionSettings,pdf:Buffer,deliveryId:string){
 const identifierSource=source;
 source={...source,occurrences:effectiveSignedPdfOccurrences(source)};
 if(source.occurrences.length>COS_SIMULATOR_LIMITS.sourceOccurrences)throw new CosFinding('simulatorLimit','failed');
 let sourceBytes=0;for(const row of source.occurrences){sourceBytes+=typeof row.value_text==='string'?Buffer.byteLength(row.value_text):0;if(sourceBytes>COS_SIMULATOR_LIMITS.textBytes)throw new CosFinding('simulatorLimit','failed');}
 const eligibility=cosEligibility(source.occurrences);
 if(eligibility!=='transported')throw new CosFinding(eligibility==='excluded'?'noContact':'eligibility',eligibility==='excluded'?'excluded':'waiting');
 if(settings.mode!=='simulator')throw new CosFinding('liveUnverified','failed');
 const mapping=compileCosMapping(p,source.configuration);
 const requirements=cosIdentifierRequirements(identifierSource,p,settings);
 if(requirements.missing.length)throw new CosFinding(requirements.missing[0]!);
 const patient=scalar(source,mapping.patientIdentifier.field,'patientIdentifier');
 if(!['urn:oid:1.2.752.129.2.1.3.1','urn:oid:1.2.752.129.2.1.3.2'].includes(mapping.patientIdentifier.namespace))throw new CosFinding('patientNamespace');
 const amendment=source.amendments.at(-1);
 const staff=settings.staff.find(row=>row.userId===(amendment?.authorId??source.signerId))?.hsaId;
 if(!staff)throw new CosFinding('staff');
 const hospital=scalar(source,{kind:'nemsis',elementId:'eDisposition.01'},'destination');
 const localCareUnit=scalar(source,{kind:'nemsis',elementId:'eDisposition.02'},'destination');
 const careUnit=resolveCosCareUnit(settings,{hospital,localCareUnit});
 if(!careUnit)throw new CosFinding('careUnit');
 if(!settings.template||!settings.organizationHsaId||!settings.encounterNamespace)throw new CosFinding('configuration');
 if(!mapping.pdfLinkId)throw new CosFinding('pdfMapping');
 const patientIdentifier={system:mapping.patientIdentifier.namespace,value:patient};
 const encounter={system:settings.encounterNamespace,value:source.reportId};
 const contact={contract:'opentriage-cos-simulator-v1',reportId:source.reportId,patient:patientIdentifier,encounter,staff,
  organization:settings.organizationHsaId,careUnit,synthetic:source.synthetic};
 let itemCount=0,textBytes=0;
 const items=mapping.clinicalMappings.flatMap(row=>{
  const matched=values(source,row.source);
  if(!matched.length)return [];
  itemCount+=matched.length;if(itemCount>COS_SIMULATOR_LIMITS.items)throw new CosFinding('simulatorLimit','failed');
  return matched.map(value=>{
   // Never stringify missing-data flags or silently strip qualifiers into asserted text.
   if(value.value_kind!=='text'||typeof value.value_text!=='string'||value.not_value_code||value.pertinent_negative_code)throw new CosFinding('clinicalValue');
   textBytes+=Buffer.byteLength(value.value_text);if(textBytes>COS_SIMULATOR_LIMITS.textBytes)throw new CosFinding('simulatorLimit','failed');
   return {linkId:row.linkId,answer:[{valueString:value.value_text}]};
  });
 });
 if(!items.length)throw new CosFinding('clinicalValue');
 const pdfSha256=bytesHash(pdf);
 const bundle={resourceType:'Bundle',type:'collection',meta:{profile:[mapping.profile.bundle]},identifier:{system:'urn:opentriage:cos:delivery',value:deliveryId},
  entry:[{fullUrl:`urn:uuid:${deliveryId}`,resource:{resourceType:'QuestionnaireResponse',id:deliveryId,meta:{profile:[mapping.profile.questionnaire]},
   identifier:{system:'urn:opentriage:cos:report',value:source.reportId},questionnaire:settings.template,status:'completed',
   subject:{type:'Patient',identifier:patientIdentifier},encounter:{identifier:encounter},authored:amendment?.signedAt??source.signedAt,
   author:{type:'Practitioner',identifier:{system:'urn:oid:1.2.752.129.2.1.4.1',value:staff}},
   item:[...items,{linkId:mapping.pdfLinkId,answer:[{valueUri:`urn:opentriage:cos-simulator:pdf:${deliveryId}:${pdfSha256}`}]}]}}]};
 if(Buffer.byteLength(JSON.stringify(bundle))>COS_SIMULATOR_LIMITS.bundleBytes)throw new CosFinding('simulatorLimit','failed');
 return {amendmentSequence:source.amendmentSequence,bundle,pdf,pdfSha256,payloadSha256:contentDigest({bundle,pdfSha256}),contact,contactSha256:contentDigest(contact)};
}
export type CosPreparedPayload=ReturnType<typeof buildCosPayload>;
