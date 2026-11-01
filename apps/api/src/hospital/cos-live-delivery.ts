import {buildCosPatient,cosPatientCanRegister,cosPatientMatches} from './cos-patient.js';
import { mutationRows } from '../database/mutation-result.js';
import type { EntityManager } from 'typeorm';
import type { CosConnectionSettings } from '@open-triage/contracts';
import { contentDigest } from '../admin/canonical-package.js';
import { decryptAgencyCredential } from '../authentication/agency-oidc-keys.js';
import type { CredentialEnvelope } from '../authentication/oidc-credentials.js';
import { CosLiveAdapter, type CosLiveSettings, type CosResource } from './cos-live-adapter.js';
import type { CosPreparedPayload } from './cos-payload.js';
import type { CosPdfNoteResult } from './cos-pdf.js';
import {COS_JOURNAL_INITIAL_DELAY_MS} from './cos-journal-settling.js';
import {cosVerificationFailure} from './cos-response-evidence.js';
import { effectiveSignedPdfOccurrences, type SignedReportClinicalSource } from '../reports/signed-report-pdf.js';

type Db=Pick<EntityManager,'query'>;
export type CosArtifact={delivery_id:string;artifact_key:string;kind:string;source_key:string|null;content_sha256:string;resource:CosResource;state:string;remote_id:string|null;evidence:CosResource};
/** The exporter derives period.end from approval time, not a clinical field.
 * Re-approving a report does not reopen or extend its already completed contact. */
export function cosEncounterContentDigest(resource:CosResource){
 const {lastUpdated:_updated,versionId:_version,...meta}=resource.meta??{};
 const {end:_approvalTime,...period}=resource.period??{};
 return contentDigest({...resource,meta,period});
}
function cosCompletedEncounterUpdateRejected(artifact:CosArtifact){
 const response=artifact.evidence.responseEvidence;
 return artifact.state==='rejected'&&response?.httpStatus===400&&response.issueCount===1&&response.issues?.length===1&&
  response.issues[0].severity==='error'&&response.issues[0].code==='processing'&&
  response.issues[0].diagnostics==="It should only be possible to update outpatient contacts that are in status 'Arrived' and 'Open'";
}
export async function cosArtifactEvent(db:Db,id:string,key:string,state:string,remoteId?:string,evidence:unknown={}){
 const rows=mutationRows<{id:string}>(await db.query(`insert into clinical.cos_artifact_event(delivery_id,artifact_key,report_id,state,remote_id,evidence) select $1,$2,a.report_id,$3,$4,$5::jsonb from clinical.cos_artifact a join clinical.report r on r.id=a.report_id where a.delivery_id=$1 and a.artifact_key=$2 and (r.expires_at is null or r.expires_at>clock_timestamp()) returning id`,[id,key,state,remoteId??null,JSON.stringify(evidence)]));
 if(rows.length!==1)throw new Error('COS artifact unavailable');
}
export async function cosArtifacts(db:Db,id:string):Promise<CosArtifact[]>{
 return db.query(`select a.*,coalesce(e.state,'prepared') state,e.remote_id,coalesce(e.evidence,'{}'::jsonb) evidence from clinical.cos_artifact a left join lateral (select state,remote_id,evidence from clinical.cos_artifact_event where delivery_id=a.delivery_id and artifact_key=a.artifact_key order by id desc limit 1)e on true where a.delivery_id=$1 order by a.artifact_key`,[id]);
}
/** Hash only clinical content across amendments; transport IDs and signing metadata differ. */
export function cosObservationDigest(resource:CosResource){
 const {id:_id,meta:_meta,identifier:_identifier,performer,...clinical}=resource;return contentDigest({...clinical,performer:performer?.filter((row:CosResource)=>row.type!=='Practitioner')});
}
/** Transport updates advance across prepared versions, independently of clinical times.
 * Called once before persistence; replay always loads the existing representation. */
export function pinCosTransportTime(payload:CosPreparedPayload,previous:string[],now:Date){
 const prior=previous.map(value=>Date.parse(value)).filter(Number.isFinite);
 const timestamp=new Date(Math.max(now.getTime(),...prior.map(value=>value+1))).toISOString();
 payload.bundle.meta.lastUpdated=timestamp;
 for(const entry of payload.bundle.entry)(entry.resource.meta as CosResource).lastUpdated=timestamp;
 for(const observation of payload.observations)(observation.meta as CosResource).lastUpdated=timestamp;
 payload.payloadSha256=contentDigest({bundle:payload.bundle,pdfSha256:payload.pdfSha256});
 return timestamp;
}
export function buildCosEncounter(source:SignedReportClinicalSource,payload:CosPreparedPayload,context:CosResource){
 const destination=context.destination;
 const c=payload.contact,hsa='urn:oid:1.2.752.129.2.1.4.1';
 if(!context.unit?.rakelId||!context.startedAt||!Number.isFinite(Date.parse(context.startedAt)))throw new Error('COS encounter context incomplete');
 const signedAt=source.amendments.at(-1)?.signedAt??source.signedAt;
 const arrival=effectiveSignedPdfOccurrences(source).filter(row=>row.element_id==='eTimes.11'&&!row.not_value_code&&!row.pertinent_negative_code);
 const rawArrival=arrival.length===1?arrival[0]?.value_datetime:undefined;
 const arrivalTime=typeof rawArrival==='string'&&Number.isFinite(Date.parse(rawArrival))?rawArrival:undefined;
 return {resourceType:'Encounter',id:source.reportId,meta:{profile:['https://fhir.cambio.se/StructureDefinition/EncounterPreHospital/v1'],lastUpdated:payload.bundle?.meta.lastUpdated??signedAt},identifier:[c.encounter],status:'finished',
  class:{system:'http://terminology.hl7.org/CodeSystem/v3-ActCode',version:'2018-08-12',code:'EMER'},type:[{coding:[{system:'http://snomed.info/sct',code:'308335008'}]}],
  subject:{type:'Patient',identifier:c.patient},participant:[{individual:{type:'Practitioner',identifier:{system:hsa,value:c.staff}}}],period:{start:context.startedAt,end:signedAt},
  ...(destination?.hsaId?{hospitalization:{...(arrivalTime?{extension:[{url:'https://fhir.cambio.se/StructureDefinition/EncounterPreHospital/encounter-destinationArrivalTime/v1',valueDateTime:arrivalTime}]}:{}),destination:{type:'Organization',identifier:{system:hsa,value:destination.hsaId}}}}:{}),
  location:[{location:{type:'Location',identifier:{system:'https://cambio.codes/msb/is/rakel',value:context.unit.rakelId}},physicalType:{coding:[{system:'http://snomed.info/sct',code:'465341007'}]}}]};
}
export async function prepareCosArtifacts(db:Db,id:string,source:SignedReportClinicalSource,payload:CosPreparedPayload,context:CosResource){
 const artifacts:Array<{key:string;kind:string;source?:string;resource:CosResource;hash?:string}>=[
  {key:'context',kind:'context',resource:{...context,findings:payload.findings??[],snapshotId:source.snapshotId,amendmentSequence:source.amendmentSequence,sourceSha256:source.canonicalSha256}},
  {key:'patient',kind:'patient',resource:buildCosPatient(source,payload.contact.patient)},
  {key:'encounter',kind:'encounter',resource:buildCosEncounter(source,payload,context)},
  {key:'note',kind:'note',resource:payload.bundle},
  {key:'pdf',kind:'pdf',resource:{sha256:payload.pdfSha256,bytes:payload.pdf.length,receiverBytesAvailable:false},hash:payload.pdfSha256}];
 for(const resource of payload.observations as CosResource[]){if(resource.resourceType!=='Observation')continue;
  const sourceKey=resource.identifier?.find((value:CosResource)=>value.system==='urn:opentriage:cos:source')?.value;
  if(!sourceKey)throw new Error('Missing COS observation source identity');
  artifacts.push({key:`observation:${resource.id}`,kind:'observation',source:sourceKey,resource,hash:cosObservationDigest(resource)});
 }
 for(const artifact of artifacts)await db.query(`insert into clinical.cos_artifact(delivery_id,report_id,artifact_key,kind,source_key,content_sha256,resource) values($1,$2,$3,$4,$5,$6,$7::jsonb) on conflict do nothing`,[id,source.reportId,artifact.key,artifact.kind,artifact.source??null,artifact.hash??contentDigest(artifact.resource),JSON.stringify(artifact.resource)]);
 await cosArtifactEvent(db,id,'context',payload.findings?.some(f=>f.coverage==='partial')?'unresolved':'verified',undefined,{pinned:true,findings:payload.findings??[]});
}
export async function createCosLiveAdapter(db:Db,groupId:string,revision:string,settings:CosConnectionSettings){
 if(!settings.live)throw new Error('COS live configuration incomplete');
 const [version]=await db.query<Array<{encrypted_credential:CredentialEnvelope;credential_id:string}>>(`select encrypted_credential,credential_id from app_identity.hospital_cos_version where group_id=$1 and revision=$2`,[groupId,revision]);
 if(!version?.encrypted_credential)throw new Error('COS credentials unavailable');
 const raw=await decryptAgencyCredential(db as EntityManager,version.encrypted_credential,groupId,`hospital-cos:${version.credential_id}`);
 let credential;try{credential=JSON.parse(raw);}catch{throw new Error('COS credentials unavailable');}
 if(typeof credential.clientSecret!=='string'||!credential.clientSecret||typeof credential.subscriptionKey!=='string'||!credential.subscriptionKey)throw new Error('COS credentials unavailable');
 return new CosLiveAdapter(settings.live as CosLiveSettings,credential,undefined,revision);
}
/** A unique committed intent across retained reports prevents duplicate POSTs,
 * including concurrent workers, lost receipts, restarts and rebuilt deliveries. */
export async function ensureCosPatient(db:Db,id:string,patient:CosArtifact,adapter:CosLiveAdapter,write:boolean){
 const record=async(state:string,reason:string,remoteId?:string,extra:CosResource={})=>cosArtifactEvent(db,id,patient.artifact_key,state,remoteId,{...extra,reason,...(state==='verified'?{}:{findings:[{mappingId:'patient',code:reason,coverage:'partial'}]})});
 const verify=async()=>{
  const stored=await adapter.findPatient(patient.resource.identifier[0]);
  if(!stored){await record('unresolved','patientRegistrationUnverified',undefined,{verificationOutcome:'not-found'});return false;}
  if(!cosPatientMatches(patient.resource,stored)){await record('unresolved','patientIdentityConflict');return 'conflict' as const;}
  await record('verified','patientIdentityVerified',stored.id,{identityMatched:true});return true;
 };
 try{
  const found=await verify();if(found)return found===true;
  if(!write)return false;
  if(!cosPatientCanRegister(patient.resource)){await record('unresolved','patientRegistrationDemographics');return false;}
  // Authentication failure must not consume the one permitted creation intent.
  await adapter.authenticate();
  const request={method:'POST',path:'fhir/Patient',resource:patient.resource,sha256:contentDigest(patient.resource)};
  const patientRegistrationKey=contentDigest({baseUrl:adapter.settings.baseUrl,tokenUrl:adapter.settings.tokenUrl,clientId:adapter.settings.clientId,identifier:patient.resource.identifier[0]});
  const claimed=mutationRows(await db.query(`insert into clinical.cos_artifact_event(delivery_id,artifact_key,report_id,state,evidence)
   select $1,$2,a.report_id,'sending',$3::jsonb from clinical.cos_artifact a join clinical.report r on r.id=a.report_id
   where a.delivery_id=$1 and a.artifact_key=$2 and (r.expires_at is null or r.expires_at>clock_timestamp())
   on conflict do nothing returning id`,[id,patient.artifact_key,JSON.stringify({request,patientRegistrationKey})]));
  if(!claimed.length){await record('unresolved','patientRegistrationUnverified');return false;}
  try{
   const receipt=await adapter.write('fhir/Patient','POST',request.resource);
   await record(receipt.state,receipt.state==='rejected'?'patientRegistrationRejected':'patientRegistrationUnverified',receipt.remoteId,{httpStatus:receipt.status,issues:receipt.issues,responseEvidence:receipt.responseEvidence,credentialRevision:adapter.credentialRevision});
  }catch(error){await record('uncertain','patientRegistrationUnverified',undefined,{verificationFailure:cosVerificationFailure(error)});return false;}
  return await verify()===true;
 }catch(error){await record('unresolved','patientRegistrationUnverified',undefined,{verificationFailure:cosVerificationFailure(error)});return false;}
}
/** Called with the report advisory lock held. Every possible write has committed intent.
 * Reconciliation passes write=false, and can never turn an empty POST search into replay permission. */
export async function deliverCosLive(db:Db,id:string,reportId:string,adapter:CosLiveAdapter,write=true,retryRejected=false,clock:()=>number=Date.now){
 const verifyReadBack=adapter.settings.readBackVerification!==false;
 let artifacts=await cosArtifacts(db,id);if(!artifacts.length)throw new Error('COS manifest unavailable');
 const readFailed=async(key:string,error:unknown)=>{
  const latest=(await cosArtifacts(db,id)).find(a=>a.artifact_key===key)!;
  await cosArtifactEvent(db,id,key,latest.state,latest.remote_id??undefined,{...latest.evidence,verificationOutcome:'unresolved',verificationFailure:cosVerificationFailure(error)});
 };
 const context=artifacts.find(a=>a.kind==='context')!,encounter=artifacts.find(a=>a.kind==='encounter')!,note=artifacts.find(a=>a.kind==='note')!;
 if(!write&&encounter.state==='prepared'&&artifacts.every(a=>a.kind==='context'||a.state==='prepared'))return {outcome:'unresolved' as const,artifacts,safeToResume:true};
 const coverageIncomplete=(context.resource.findings??[]).some((finding:CosResource)=>finding.coverage==='partial');
 let unresolved=false;
 const priorContacts=await db.query<Array<CosArtifact>>(`select a.resource,a.delivery_id,e.state,e.remote_id,e.evidence from clinical.cos_artifact a
  left join lateral(select state,remote_id,evidence from clinical.cos_artifact_event where delivery_id=a.delivery_id and artifact_key=a.artifact_key order by id desc limit 1)e on true
  where a.report_id=$1 and a.delivery_id<>$2 and a.kind='encounter' and exists(select 1 from clinical.cos_artifact_event sent where sent.delivery_id=a.delivery_id and sent.artifact_key=a.artifact_key and sent.state in ('sending','accepted','verified','uncertain')) order by a.delivery_id`,[reportId,id]);
 if(priorContacts.some(prior=>contentDigest(prior.resource.subject??null)!==contentDigest(encounter.resource.subject??null))){await cosArtifactEvent(db,id,'context','unresolved',undefined,{reason:'patientCorrectionUnverified'});return {outcome:'unresolved' as const,artifacts:await cosArtifacts(db,id),safeToResume:false};}
 const patient=artifacts.find(a=>a.kind==='patient');
 if(patient&&!await ensureCosPatient(db,id,patient,adapter,write))return {outcome:'unresolved' as const,artifacts:await cosArtifacts(db,id),safeToResume:false};
 const previous=await db.query<Array<CosArtifact>>(`select a.*,e.state,e.remote_id,e.evidence from clinical.cos_artifact a join clinical.cos_delivery d on d.id=a.delivery_id join lateral(select state,remote_id,evidence from clinical.cos_artifact_event where delivery_id=a.delivery_id and artifact_key=a.artifact_key order by id desc limit 1)e on true where a.report_id=$1 and a.delivery_id<>$2 and a.kind='observation' and e.state in ('verified','accepted','sending','uncertain') order by d.amendment_sequence desc,d.created_at desc`,[reportId,id]);
 const current=artifacts.filter(a=>a.kind==='observation');
 const removedSource=previous.some(prior=>!current.some(a=>a.source_key===prior.source_key));
 // A deleted or changed delivered source has no accepted COS invalidation contract.
 for(const prior of previous){const next=current.find(a=>a.source_key===prior.source_key);if(!next||next.content_sha256!==prior.content_sha256)unresolved=true;}
 const execute=async(artifact:CosArtifact,path:string,method:'PUT'|'POST',bind?:()=>Promise<CosResource>)=>{
  const repairedAuthentication=retryRejected&&artifact.state==='rejected'&&([401,403].includes(artifact.evidence.httpStatus)||artifact.evidence.clinicalRequestSent===false)&&!!adapter.credentialRevision&&artifact.evidence.credentialRevision!==adapter.credentialRevision;
  if((artifact.state==='prepared'||repairedAuthentication)&&write){
   try{await adapter.authenticate?.();}catch{artifact.state='rejected';await cosArtifactEvent(db,id,artifact.artifact_key,'rejected',undefined,{credentialRevision:adapter.credentialRevision,reason:'authenticationUnavailable',clinicalRequestSent:false});return;}
   const [priorRequest]=await db.query<Array<{evidence:CosResource}>>(`select evidence from clinical.cos_artifact_event where delivery_id=$1 and artifact_key=$2 and state='sending' and evidence ? 'request' order by id desc limit 1`,[id,artifact.artifact_key]);
   let request:CosResource;
   if(priorRequest){const prior=priorRequest.evidence.request;if(prior.method!==method||prior.path!==path||contentDigest(prior.resource)!==prior.sha256)throw new Error('COS persisted request integrity failure');}
   if(priorRequest)request=priorRequest.evidence.request;
   else {let resource:CosResource;try{resource=bind?await bind():artifact.resource;}catch(error){await cosArtifactEvent(db,id,artifact.artifact_key,artifact.state,artifact.remote_id??undefined,{...artifact.evidence,reason:'referenceBindingUnavailable',verificationFailure:cosVerificationFailure(error)});return;}request={method,path,resource,sha256:contentDigest(resource)};}
   await cosArtifactEvent(db,id,artifact.artifact_key,'sending',undefined,{request});artifact.state='sending';
   try{const receipt=await adapter.write(path,method,request.resource);artifact.state=receipt.state;artifact.remote_id=receipt.remoteId??null;
    artifact.evidence={httpStatus:receipt.status,issues:receipt.issues,credentialRevision:adapter.credentialRevision,responseEvidence:receipt.responseEvidence};
    if(verifyReadBack&&artifact.kind==='note'&&receipt.status>=200&&receipt.status<300&&
     (receipt.state==='accepted'||receipt.state==='uncertain'&&(receipt.responseEvidence?.bodyBytes===0||
      Array.isArray(receipt.issues)&&receipt.issues.every(issue=>!['error','fatal'].includes(issue.severity??''))))){
     artifact.evidence={...artifact.evidence,reason:'journalProcessing',
      journalVerificationNotBefore:new Date(clock()+(adapter.settings.initialVerificationDelaySeconds===undefined?COS_JOURNAL_INITIAL_DELAY_MS:adapter.settings.initialVerificationDelaySeconds*1000)).toISOString()};
    }
    await cosArtifactEvent(db,id,artifact.artifact_key,receipt.state,receipt.remoteId,artifact.evidence);
   }catch{artifact.state='uncertain';await cosArtifactEvent(db,id,artifact.artifact_key,'uncertain');}
  }
 };
 // Reuse is independently verified on the current receiver. Never infer delivery
 // from a closed-contact rejection, or use an older contact to resolve an unknown PUT.
 const mayReuse=['prepared','verified'].includes(encounter.state)||cosCompletedEncounterUpdateRejected(encounter);
 const reused=mayReuse&&encounter.resource.status==='finished'?priorContacts.find(prior=>prior.state==='verified'&&prior.remote_id&&
  prior.resource.status==='finished'&&typeof prior.resource.period?.end==='string'&&cosEncounterContentDigest(prior.resource)===cosEncounterContentDigest(encounter.resource)):undefined;
 const retainedPeriodEnd=reused?(reused.evidence.retainedPeriodEnd??reused.resource.period.end):undefined;
 const expectedEncounter=reused?{...reused.resource,period:{...reused.resource.period,end:retainedPeriodEnd}}:encounter.resource;
 if(!reused){
  await execute(encounter,`fhir/subscription/Encounter/${encodeURIComponent(encounter.resource.id)}`,'PUT',()=>adapter.bindEncounter(encounter.resource,priorContacts.length>0));
  if(!verifyReadBack&&encounter.state==='rejected')return {outcome:'unresolved' as const,artifacts:await cosArtifacts(db,id),safeToResume:false};
 }
 const storedEncounter=await adapter.verifyEncounter(expectedEncounter,reused?.remote_id??encounter.remote_id??undefined,context.resource.ambulanceOrganizations).catch(async error=>{await readFailed(encounter.artifact_key,error);return undefined;});
 if(!storedEncounter){const latest=(await cosArtifacts(db,id)).find(a=>a.kind==='encounter')!;await cosArtifactEvent(db,id,encounter.artifact_key,latest.state,latest.remote_id??undefined,{...latest.evidence,verificationOutcome:'unresolved'});return {outcome:'unresolved' as const,artifacts:await cosArtifacts(db,id)};}
 await cosArtifactEvent(db,id,encounter.artifact_key,'verified',storedEncounter.id,{identityMatched:true,verificationCoverage:storedEncounter._openTriageVerification??null,
  ...(reused?{reusedDeliveryId:reused.delivery_id,retainedPeriodEnd}:{})});
 for(const artifact of current){
  if(artifact.state==='verified')continue;
  const prior=previous.find(a=>a.source_key===artifact.source_key);
  if(prior){
   if(prior.content_sha256===artifact.content_sha256&&(prior.state==='verified'||!verifyReadBack&&prior.state==='accepted')&&prior.remote_id){await cosArtifactEvent(db,id,artifact.artifact_key,prior.state,prior.remote_id,{reusedDeliveryId:prior.delivery_id});continue;}
   unresolved=true;await cosArtifactEvent(db,id,artifact.artifact_key,'unresolved',undefined,{reason:'observationCorrectionUnverified'});continue;
  }
  if(removedSource){unresolved=true;await cosArtifactEvent(db,id,artifact.artifact_key,'unresolved',undefined,{reason:'observationCorrectionUnverified'});continue;}
  const profile=artifact.resource.meta?.profile?.[0];
  if(!adapter.settings.acceptedProfiles.includes(profile)){unresolved=true;await cosArtifactEvent(db,id,artifact.artifact_key,'unresolved',undefined,{reason:'profileAcceptanceRequired'});continue;}
  if(!write&&artifact.state==='prepared')continue;
  await execute(artifact,'fhir/Observation','POST',()=>adapter.bindObservation(artifact.resource,storedEncounter));
  if(!verifyReadBack)continue;
  try{if(artifact.remote_id&&await adapter.verifyObservation(artifact.resource,artifact.remote_id,storedEncounter))await cosArtifactEvent(db,id,artifact.artifact_key,'verified',artifact.remote_id,{clinicalContentMatched:true});else {unresolved=true;await cosArtifactEvent(db,id,artifact.artifact_key,artifact.state,artifact.remote_id??undefined,{...artifact.evidence,verificationOutcome:'unresolved'});}}catch(error){unresolved=true;await readFailed(artifact.artifact_key,error);}
 }
 // Notes are serialized by the report lock. Same report business ID replaces the preceding note.
 await execute(note,`fhir/subscription/Bundle/${encodeURIComponent(reportId)}`,'PUT');
 if(!verifyReadBack){
  artifacts=await cosArtifacts(db,id);
  // Accept an explicit successful receipt, including COS's empty 201. Missing
  // receipts, malformed bodies, rejection outcomes and timeouts remain uncertain.
  const accepted=(a:CosArtifact)=>a.state==='verified'||a.state==='accepted'||a.state==='uncertain'&&
   Number(a.evidence.httpStatus)>=200&&Number(a.evidence.httpStatus)<300&&(a.evidence.responseEvidence?.bodyBytes===0||Array.isArray(a.evidence.issues)&&a.evidence.issues.every((issue:CosResource)=>!['error','fatal'].includes(issue.severity)));
  for(const artifact of artifacts.filter(a=>['observation','note'].includes(a.kind))){
   if(accepted(artifact)&&artifact.state!=='verified')await cosArtifactEvent(db,id,artifact.artifact_key,'accepted',artifact.remote_id??undefined,{...artifact.evidence,readBackVerification:false,verificationOutcome:'skipped'});
   else if(!accepted(artifact))unresolved=true;
  }
  const submittedNote=artifacts.find(a=>a.kind==='note')!;
  if(accepted(submittedNote)&&!artifacts.some(a=>a.kind==='pdf'&&a.state==='verified'))await cosArtifactEvent(db,id,'pdf','accepted',undefined,{readBackVerification:false,verificationOutcome:'skipped',reason:'readBackDisabled',bundledWithNote:true});
  artifacts=await cosArtifacts(db,id);
  const complete=artifacts.every(a=>['verified','accepted'].includes(a.state)||a.kind==='context'&&a.evidence.pinned===true);
  return {outcome:!unresolved&&complete?'accepted' as const:'unresolved' as const,artifacts,safeToResume:false,coverageIncomplete:false};
 }
 // Persisted receipt deadline survives restarts and applies to manual reconciliation too.
 // Never sleep while holding a report lock, or resend an accepted note.
 if(Date.parse(note.evidence.journalVerificationNotBefore)>clock())
  return {outcome:'unresolved' as const,artifacts:await cosArtifacts(db,id),safeToResume:false};
 // Journal document evidence is independent of structured-note/template verification.
 let pdfReadFailure:ReturnType<typeof cosVerificationFailure>|undefined;
 const pdf=await adapter.verifyPdf(note.resource,storedEncounter,id).catch((error):CosPdfNoteResult=>{pdfReadFailure=cosVerificationFailure(error);return {state:'pending',pdfBytesReadBack:false,reason:'pdfJournalUnavailable'};});
 if(pdf.state==='document-recorded'||!artifacts.some(a=>a.kind==='pdf'&&a.state==='verified')){
  await cosArtifactEvent(db,id,'pdf',pdf.state==='document-recorded'?'verified':'unresolved',pdf.noteId,
   {...pdf,documentRecorded:pdf.state==='document-recorded',verificationFailure:pdfReadFailure,...(pdf.reason?{findings:[{mappingId:'pdf',code:pdf.reason,coverage:'partial'}]}:{})});
  if(pdf.state!=='document-recorded')unresolved=true;
 }else {
  const prior=artifacts.find(a=>a.kind==='pdf')!;
  await cosArtifactEvent(db,id,'pdf','verified',prior.remote_id??undefined,{...prior.evidence,verificationOutcome:'unresolved',reason:pdf.reason,journalEvidence:pdf.journalEvidence,verificationFailure:pdfReadFailure});
 }
 const verified=await adapter.verifyNote(note.resource,storedEncounter,id,pdf).catch(async error=>{await readFailed('note',error);return undefined;});
 if(verified){await cosArtifactEvent(db,id,'note',verified.noteVerified===false?'unresolved':'verified',verified.noteId,{exactVersion:true,templateCanonical:verified.templateCanonical,reason:verified.verificationFinding,verificationCoverage:verified.verificationCoverage});if(verified.noteVerified===false)unresolved=true;}
 else if(write||note.state!=='prepared'){unresolved=true;const latest=(await cosArtifacts(db,id)).find(a=>a.kind==='note')!;await cosArtifactEvent(db,id,'note',latest.state,latest.remote_id??undefined,{...latest.evidence,verificationOutcome:'unresolved',reason:pdf.reason});}
 artifacts=await cosArtifacts(db,id);
 if(previous.some(prior=>!current.some(a=>a.source_key===prior.source_key))){await cosArtifactEvent(db,id,'context','unresolved',undefined,{reason:'observationCorrectionUnverified'});artifacts=await cosArtifacts(db,id);}
 const safeToResume=!write&&artifacts.some(a=>a.state==='prepared')&&artifacts.every(a=>['verified','prepared','unresolved'].includes(a.state));
 // Pinned projection gaps describe what could be exported, not whether COS stored
 // the submitted artifacts. Other unresolved context (e.g. corrections) still blocks.
 const stored=artifacts.every(a=>a.state==='verified'||a.kind==='context'&&a.state==='unresolved'&&coverageIncomplete&&a.evidence.pinned===true);
 return {outcome:!unresolved&&stored?'stored' as const:'unresolved' as const,artifacts,safeToResume,coverageIncomplete};
}
