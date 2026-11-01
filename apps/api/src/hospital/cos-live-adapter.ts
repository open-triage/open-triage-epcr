import {COS_PATIENT_PROFILE} from './cos-patient.js';
import { requestFhirHttp, fhirOutcomeIssues } from './fhir-http.js';
import { contentDigest } from '../admin/canonical-package.js';
import {cosResponseEvidence,CosReadFailure} from './cos-response-evidence.js';
import { verifyCosPdfNote, type CosPdfNoteResult } from './cos-pdf.js';

export type CosLiveSettings = {initialVerificationDelaySeconds?:number;readBackVerification?:boolean;baseUrl:string;tokenUrl:string;clientId:string;scope?:string;acceptedProfiles:string[];pdfKeyword:string;versionMarkerLinkId:string;acceptanceRevision?:string};
export type CosResource=Record<string,any>;
export type CosReceipt={state:'accepted'|'rejected'|'uncertain';remoteId?:string;status:number;issues:ReturnType<typeof fhirOutcomeIssues>;responseEvidence?:ReturnType<typeof cosResponseEvidence>};
export type CosHttp=typeof requestFhirHttp;
const identifier=(value:unknown)=>contentDigest(value??null);
export function cosApiUrl(base:string,path:string){
 const root=new URL(base),url=new URL(path,root);
 if(/%(?:2f|5c|00)/i.test(url.pathname)||root.protocol!=='https:'||root.username||root.password||root.hash||root.search||!root.pathname.endsWith('/')||url.origin!==root.origin||!url.pathname.startsWith(root.pathname)||url.username||url.password||url.hash)throw new Error('Invalid COS endpoint');
 return url;
}
export function cosRemoteId(headers:Record<string,unknown>,resourceType:string,baseUrl:string):string|undefined{
 const raw=headers.location??headers['content-location'];if(typeof raw!=='string')return;
 const url=cosApiUrl(baseUrl,raw);return url.pathname.match(new RegExp(`/${resourceType}/([A-Za-z0-9.-]{1,100})(?:/_history/[^/]+)?$`))?.[1];
}
/** Compare clinical semantics, never merely similar values or a successful search. */
const codesMatch=(expected:CosResource,actual:CosResource)=>Array.isArray(expected?.coding)&&expected.coding.length>0&&expected.coding.every((e:CosResource)=>actual?.coding?.some((a:CosResource)=>a.system===e.system&&a.code===e.code));
const quantityMatches=(expected:CosResource,actual:CosResource)=>actual&&typeof actual.value==='number'&&actual.value===expected.value&&['unit','system','code','comparator'].every(key=>expected[key]===undefined?key!=='comparator'||actual[key]===undefined:actual[key]===expected[key]);
const referenceId=(reference:unknown,type:string)=>typeof reference==='string'?reference.match(new RegExp(`(?:^|/)${type}/([A-Za-z0-9.-]{1,100})$`))?.[1]:undefined;
export function cosObservationMatches(expected:CosResource,actual:CosResource,remoteId:string,verifiedContext?:{patientReference:string;encounterId:string}){
 if(actual.resourceType!=='Observation'||actual.id!==remoteId||actual.status!==expected.status)return false;
 const identityMatched=verifiedContext?actual.subject?.reference===verifiedContext.patientReference&&referenceId(actual.encounter?.reference,'Encounter')===verifiedContext.encounterId:identifier(expected.subject)===identifier(actual.subject)&&identifier(expected.encounter)===identifier(actual.encounter);
 if(!identityMatched||Math.floor(Date.parse(expected.effectiveDateTime)/1000)!==Math.floor(Date.parse(actual.effectiveDateTime)/1000)||!Number.isFinite(Date.parse(expected.effectiveDateTime)))return false;
 if(expected.meta?.profile?.some((profile:string)=>!actual.meta?.profile?.includes(profile)))return false;
 if(expected.code&&!codesMatch(expected.code,actual.code))return false;
 if(expected.valueQuantity&&!quantityMatches(expected.valueQuantity,actual.valueQuantity))return false;
 if(expected.valueCodeableConcept&&!codesMatch(expected.valueCodeableConcept,actual.valueCodeableConcept))return false;
 if(expected.component&&(actual.component?.length!==expected.component.length||!expected.component.every((e:CosResource)=>actual.component.filter((a:CosResource)=>codesMatch(e.code,a.code)&&quantityMatches(e.valueQuantity,a.valueQuantity)).length===1)))return false;
 return true;
}
export function cosNoteItemsMatch(expected:CosResource[],actual:CosResource[]){
 const remaining=actual.map(item=>identifier(item));
 for(const item of expected){const index=remaining.indexOf(identifier(item));if(index<0)return false;remaining.splice(index,1);}return true;
}
function questionnaireIdentity(canonical:unknown){
 if(typeof canonical!=='string')return;
 const match=canonical.match(/^https?:\/\/fhir\.cambio\.se\/fhir\/Questionnaire\/([A-Za-z0-9.-]+)(?:\|([A-Za-z0-9.-]+))?$/);
 return match?{id:match[1]!,version:match[2]}:undefined;
}
/** COS renders the five medication fields in Stockholm local time, to minutes.
 * Only this complete known shape can be compared as text; additional fields
 * must remain unverified rather than silently disappear in the projection. */
function renderedMedication(item:CosResource):string[]|undefined{
 if(item.linkId!=='62521000052103'||Object.keys(item).some(key=>!['linkId','answer'].includes(key))||!item.answer?.length)return;
 const lines:string[]=[];
 for(const answer of item.answer){
  if(Object.keys(answer).some(key=>!['valueCoding','item'].includes(key))||identifier(answer.valueCoding)!==identifier({system:'http://snomed.info/sct',code:item.linkId})||answer.item?.length!==5)return;
  const fields:Record<string,unknown>={};
  for(const [code,type] of [['118575009','valueDateTime'],['410942007','valueString'],['118555000','valueDecimal'],['767525000','valueString'],['410675002','valueString']]){
   const rows=answer.item.filter((child:CosResource)=>child.linkId===code);
   if(rows.length!==1||Object.keys(rows[0]).some(key=>!['linkId','answer'].includes(key))||rows[0].answer?.length!==1||Object.keys(rows[0].answer[0]).length!==1)return;
   fields[code!]=rows[0].answer[0][type!];
  }
  const time=fields['118575009'],dose=fields['118555000'];
  if(typeof time!=='string'||!/(?:Z|[+-]\d{2}:\d{2})$/.test(time)||!Number.isFinite(Date.parse(time))||typeof dose!=='number'||!Number.isFinite(dose))return;
  const text=['410942007','767525000','410675002'].map(code=>fields[code]);
  if(text.some(value=>typeof value!=='string'||!value||/[\r\n]/.test(value)))return;
  const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(time));
  const part=(type:string)=>parts.find(value=>value.type===type)!.value;
  lines.push(`(${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')})     ${text[0]} ${dose} ${text[1]} ${text[2]}`);
 }
 return lines;
}
/** Receiver ordinals can change, but a keyword ID in an exact questionnaire version
 * may only resolve when all matching template entries agree on one SNOMED code. */
export function cosTemplateNoteItemsMatch(expected:CosResource[],actual:CosResource[],template:CosResource,canonical:string){
 const identity=questionnaireIdentity(canonical);
 if(!identity?.version||template.resourceType!=='Questionnaire'||template.id!==identity.id||template.version!==identity.version||template.url!==canonical)return false;
 const flatten=(items:CosResource[]):CosResource[]=>items.flatMap(item=>[item,...flatten(item.item??[])]);
 const keywords=new Map<string,Set<string>>();
 for(const item of flatten(template.item??[])){
  const parts=String(item.linkId??'').split('.');if(parts[0]!==identity.id||parts[1]!==identity.version)continue;
  const key=parts.at(-1)!;const codes=keywords.get(key)??new Set<string>();
  for(const code of item.code??[])if(code.system==='http://snomed.info/sct'&&typeof code.code==='string')codes.add(code.code);
  keywords.set(key,codes);
 }
 const expectedValues=new Map<string,string[]>();
 for(const item of expected){
  const medication=renderedMedication(item);
  if(medication){expectedValues.set(item.linkId,[...(expectedValues.get(item.linkId)??[]),...medication]);continue;}
  if(item.item?.length||!Array.isArray(item.answer)||item.answer.some((answer:CosResource)=>typeof answer.valueString!=='string'||Object.keys(answer).some(key=>key!=='valueString')))return false;
  expectedValues.set(item.linkId,[...(expectedValues.get(item.linkId)??[]),...item.answer.map((answer:CosResource)=>answer.valueString)]);
 }
 const actualValues=new Map<string,string[]>();
 for(const item of flatten(actual)){
  if(!item.answer?.length||item.answer.every((answer:CosResource)=>answer.valueString===''&&Object.keys(answer).every(key=>key==='valueString')))continue;
  const parts=String(item.linkId??'').split('.');if(parts[0]!==identity.id||parts[1]!==identity.version)return false;
  const codes=keywords.get(parts.at(-1)!);if(!codes||codes.size!==1)return false;
  const code=[...codes][0]!;if(!expectedValues.has(code))continue;
  if(item.answer.some((answer:CosResource)=>typeof answer.valueString!=='string'||Object.keys(answer).some(key=>key!=='valueString')))return false;
  actualValues.set(code,[...(actualValues.get(code)??[]),...item.answer.map((answer:CosResource)=>answer.valueString)]);
 }
 return [...expectedValues].every(([code,values])=>{
  const received=actualValues.get(code)??[];
  if(identifier([...values].sort())===identifier([...received].sort()))return true;
  // COS can render repeated text answers as one newline-joined answer. Compare
  // the exact submitted sequence: never split, trim, reorder or deduplicate it.
  return values.length>1&&received.length===1&&received[0]===values.join('\n');
 });
}
export class CosLiveAdapter {
 private token:string|undefined;private tokenExpiresAt=0;
 constructor(readonly settings:CosLiveSettings,private readonly credential:{clientSecret:string;subscriptionKey:string},private readonly http:CosHttp=requestFhirHttp,readonly credentialRevision?:string){}
 private async headers(){
  if(!this.token||Date.now()>=this.tokenExpiresAt){
   const url=new URL(this.settings.tokenUrl);
   if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new Error('Invalid COS token endpoint');
   const response=await this.http({url,method:'POST',headers:{authorization:`Basic ${Buffer.from(`${this.settings.clientId}:${this.credential.clientSecret}`).toString('base64')}`,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',...(this.settings.scope?{scope:this.settings.scope}:{})}).toString(),maxResponseBytes:65536});
   const body=JSON.parse(response.body);if(response.status!==200||typeof body.access_token!=='string'||!body.access_token||body.access_token.length>16384)throw new Error('COS authentication failed');this.token=body.access_token;this.tokenExpiresAt=Date.now()+Math.max(0,Math.min(Number(body.expires_in)||0,3600)-30)*1000;
  }
  return {authorization:`Bearer ${this.token}`,'Ocp-Apim-Subscription-Key':this.credential.subscriptionKey,accept:'application/fhir+json, application/json','content-type':'application/fhir+json','accept-language':'sv-SE',prefer:'return=OperationOutcome'};
 }
 async authenticate(){await this.headers();}
 /** Only a valid empty search or COS's explicit patient-not-found response permits creation. */
 async findPatient(identifier:CosResource):Promise<CosResource|undefined>{
  let result:CosResource;
  try{result=await this.read(`fhir/Patient/_search?${new URLSearchParams({identifier:`${identifier.system}|${identifier.value}`,_profile:COS_PATIENT_PROFILE})}`);}
  catch(error){
   if(error instanceof CosReadFailure&&error.responseEvidence.httpStatus===404&&error.responseEvidence.issueCount===1&&error.responseEvidence.issues[0]?.severity==='error'&&error.responseEvidence.issues[0]?.code==='processing'&&error.responseEvidence.issues[0]?.diagnostics==='Patient Not found for the given identifier')return;
   throw error;
  }
  if(result.resourceType!=='Bundle'||result.type!=='searchset'||result.link?.some((link:CosResource)=>link.relation==='next')||!Array.isArray(result.entry??[]))throw new Error('COS patient search incomplete');
  const patients=(result.entry??[]).map((entry:CosResource)=>entry.resource);
  if(patients.length>1||result.total!==undefined&&result.total!==patients.length||patients.some((p:CosResource)=>p?.resourceType!=='Patient')||!patients.length&&result.total!==0)throw new Error('COS patient identity ambiguous');
  return patients[0];
 }

 async read(path:string):Promise<CosResource>{
  const response=await this.http({url:cosApiUrl(this.settings.baseUrl,path),method:'GET',headers:await this.headers()});
  let body:CosResource;try{body=JSON.parse(response.body);}catch{throw new CosReadFailure(cosResponseEvidence(response),cosApiUrl(this.settings.baseUrl,path).pathname);}
  if(response.status!==200||body?.resourceType==='OperationOutcome')throw new CosReadFailure(cosResponseEvidence(response),cosApiUrl(this.settings.baseUrl,path).pathname);return body;
 }
 async search(path:string):Promise<CosResource[]>{
  const resources:CosResource[]=[],seen=new Set<string>();let next:string|undefined=path;
  while(next){const url=cosApiUrl(this.settings.baseUrl,next).href;if(seen.has(url)||seen.size>=20)throw new Error('COS search incomplete');seen.add(url);
   const result=await this.read(url);if(result.resourceType!=='Bundle'||result.type!=='searchset'||!Array.isArray(result.entry??[]))throw new Error('COS search incomplete');
   resources.push(...(result.entry??[]).map((entry:CosResource)=>entry.resource).filter(Boolean));if(resources.length>2000)throw new Error('COS search incomplete');
   next=result.link?.find((link:CosResource)=>link.relation==='next')?.url;
  }return resources;
 }
 async write(path:string,method:'PUT'|'POST',resource:CosResource):Promise<CosReceipt>{
  const response=await this.http({url:cosApiUrl(this.settings.baseUrl,path),method,headers:await this.headers(),body:JSON.stringify(resource)});
  const remoteId=cosRemoteId(response.headers,resource.resourceType==='Bundle'?'QuestionnaireResponse':resource.resourceType,this.settings.baseUrl);
  const responseEvidence=cosResponseEvidence(response);
  let body:CosResource;try{body=JSON.parse(response.body);}catch{return {state:[401,403].includes(response.status)?'rejected':'uncertain',status:response.status,issues:null,remoteId,responseEvidence};}
  const issues=fhirOutcomeIssues(body);
  const rejected=issues?.some(issue=>['error','fatal'].includes(issue.severity));
  // Potentially committed 5xx and ignored/older informational updates are never safe replay evidence.
  const state=response.status>=500?'uncertain':rejected||[400,401,403,422].includes(response.status)?'rejected':response.status>=200&&response.status<300&&issues&&issues.every(issue=>issue.code==='informational'&&!['warning','error','fatal'].includes(issue.severity))?'accepted':'uncertain';
  return {state,status:response.status,issues,remoteId,responseEvidence};
 }
 private async referenceMatches(actual:CosResource,expected:CosResource,type:string){
  if(identifier(actual?.identifier)===identifier(expected))return true;
  const id=referenceId(actual?.reference,type);if(!id)return false;
  const resource=await this.read(`fhir/${type}/${id}`);
  return resource.resourceType===type&&resource.id===id&&resource.identifier?.some((value:CosResource)=>value.system===expected.system&&value.value===expected.value);
 }
 /** Resolve the receiver's optimistic-lock version without changing the pinned clinical manifest. */
 async bindEncounter(expected:CosResource,requireExisting=false):Promise<CosResource>{
  const query=new URLSearchParams({'subject.identifier':`${expected.subject.identifier.system}|${expected.subject.identifier.value}`,_profile:'https://fhir.cambio.se/StructureDefinition/EncounterOutpatientReadSe'});
  const found=(await this.search(`fhir/Encounter?${query}`)).filter(row=>row.resourceType==='Encounter'&&row.identifier?.some((id:CosResource)=>id.system===expected.identifier[0].system&&id.value===expected.identifier[0].value));
  if(!found.length){if(requireExisting)throw new Error('COS existing encounter unavailable');return structuredClone(expected);}
  if(found.length!==1||!await this.referenceMatches(found[0]!.subject,expected.subject.identifier,'Patient'))throw new Error('COS encounter identity ambiguous');
  const version=found[0]!.meta?.versionId;
  if(typeof version!=='string'||!/^[-A-Za-z0-9.]{1,64}$/.test(version))throw new Error('COS encounter revision unavailable');
  return {...structuredClone(expected),meta:{...expected.meta,versionId:version}};
 }
 async verifyEncounter(expected:CosResource,remoteId?:string,organizations?:{careProviderHsaId:string;careUnitHsaId:string}):Promise<CosResource|undefined>{
  const query=new URLSearchParams({'subject.identifier':`${expected.subject.identifier.system}|${expected.subject.identifier.value}`,_profile:'https://fhir.cambio.se/StructureDefinition/EncounterOutpatientReadSe',...(remoteId?{_id:remoteId}:{})});
  const found=(await this.search(`fhir/Encounter?${query}`)).filter(row=>row.resourceType==='Encounter'&&(!remoteId||row.id===remoteId)&&row.identifier?.some((id:CosResource)=>id.system===expected.identifier[0].system&&id.value===expected.identifier[0].value)&&row.status===expected.status&&Math.floor(Date.parse(row.period?.start)/1000)===Math.floor(Date.parse(expected.period.start)/1000)&&Math.floor(Date.parse(row.period?.end)/1000)===Math.floor(Date.parse(expected.period.end)/1000));
  if(found.length!==1)return;const candidate=found[0]!;
  if(!await this.referenceMatches(candidate.subject,expected.subject.identifier,'Patient'))return;
  for(const participant of expected.participant??[]){let matched=false;for(const actual of candidate.participant??[]){if(await this.referenceMatches(actual.individual,participant.individual.identifier,'Practitioner')){matched=true;break;}}if(!matched)return;}
  if(!organizations?.careProviderHsaId||!organizations.careUnitHsaId)return;
  const hsa='urn:oid:1.2.752.129.2.1.4.1';
  if(!await this.referenceMatches(candidate.serviceProvider,{system:hsa,value:organizations.careProviderHsaId},'Organization'))return;
  const performing=(candidate.extension??[]).filter((extension:CosResource)=>typeof extension.url==='string'&&/\/encounterPerformingUnit(?:\/v\d+)?$/.test(extension.url));
  if(performing.length!==1||!await this.referenceMatches(performing[0].valueReference,{system:hsa,value:organizations.careUnitHsaId},'Organization'))return;
  if(candidate.location?.length)for(const location of expected.location??[]){let matched=false;for(const actual of candidate.location){if(await this.referenceMatches(actual.location,location.location.identifier,'Location')){matched=true;break;}}if(!matched)return;}
  if(expected.hospitalization?.destination&&candidate.hospitalization?.destination&&!await this.referenceMatches(candidate.hospitalization.destination,expected.hospitalization.destination.identifier,'Organization'))return;
  return {...candidate,_openTriageVerification:{businessIdentifier:'verified',patient:'verified',period:'verified-to-second',practitioner:'verified',careProvider:'verified',performingUnit:'verified',rakel:candidate.location?.length?'verified':'submitted-not-returned',destination:expected.hospitalization?.destination?(candidate.hospitalization?.destination?'verified':'submitted-not-returned'):'not-applicable'}};
 }
 /** Standalone Observation writes require the verified internal Encounter reference.
  * Patient/performer identifiers remain unchanged: those are accepted by this route.
  * The caller persists the returned representation before sending it. */
 async bindObservation(expected:CosResource,encounter:CosResource):Promise<CosResource>{
  if(expected.resourceType!=='Observation'||!referenceId(`Encounter/${encounter.id}`,'Encounter')||
   !encounter.identifier?.some((value:CosResource)=>value.system===expected.encounter?.identifier?.system&&value.value===expected.encounter?.identifier?.value))throw new Error('COS encounter binding unavailable');
  return {...structuredClone(expected),encounter:{type:'Encounter',reference:`Encounter/${encounter.id}`}};
 }
 async verifyObservation(expected:CosResource,remoteId:string,encounter?:CosResource){
  const patientId=referenceId(encounter?.subject?.reference,'Patient'),measurement=Date.parse(expected.effectiveDateTime);
  if(!patientId||!Number.isFinite(measurement))throw new Error('COS observation read context unavailable');
  const query=new URLSearchParams({patient:patientId,_profile:expected.meta.profile[0]});
  query.append('date',`ge${new Date(measurement-86400000).toISOString().slice(0,10)}`);
  query.append('date',`le${new Date(measurement+86400000).toISOString().slice(0,10)}`);
  const found=(await this.search(`fhir/Observation/_search?${query}`)).filter(row=>cosObservationMatches(expected,row,remoteId,encounter?.subject?.reference?{patientReference:encounter.subject.reference,encounterId:encounter.id}:undefined));
  if(found.length!==1)return;
  for(const performer of expected.performer??[]){
   let matched=false;
   for(const actual of found[0]!.performer??[]){
    const role=typeof actual.reference==='string'&&actual.reference.startsWith('#')?found[0]!.contained?.find((resource:CosResource)=>resource.id===actual.reference.slice(1)&&resource.resourceType==='PractitionerRole'):undefined;
    const reference=role?(performer.type==='Practitioner'?role.practitioner:performer.type==='Organization'?role.organization:undefined):actual;
    if(reference&&await this.referenceMatches(reference,performer.identifier,performer.type)){matched=true;break;}
   }
   if(!matched)return;
  }
  return found[0];
 }
 async verifyPdf(bundle:CosResource,encounter:CosResource,deliveryId:string):Promise<CosPdfNoteResult>{
  const note=bundle.entry.find((entry:CosResource)=>entry.resource.resourceType==='QuestionnaireResponse').resource;
  const start=note.authored.slice(0,10)+'T00:00:00',end=new Date(Date.parse(note.authored)+86400000).toISOString().slice(0,10)+'T00:00:00';
  const response=await this.http({url:cosApiUrl(this.settings.baseUrl,`journalnotes/?${new URLSearchParams({'api-version':'v2',fromDateTime:start,toDateTime:end})}`),method:'GET',headers:{...await this.headers(),patient:note.subject.identifier.value}});
  if(response.status!==200)throw new CosReadFailure(cosResponseEvidence(response),'journalnotes/');
  let journal:CosResource;try{journal=JSON.parse(response.body);}catch{throw new CosReadFailure(cosResponseEvidence(response),'journalnotes/');}
  const bodies=Array.isArray(journal)?journal:[journal];
  // An empty array is a valid empty journal. A malformed/OperationOutcome body
  // must not silently become "note not found" through optional property access.
  if(bodies.some(body=>!body||typeof body!=='object'||!Array.isArray(body.journalNoteEHRExtract)||body.journalNoteEHRExtract.some((extract:unknown)=>!extract||typeof extract!=='object'||Array.isArray(extract))))throw new CosReadFailure(cosResponseEvidence(response),'journalnotes/');
  const extracts=bodies.flatMap(body=>body.journalNoteEHRExtract);
  const {httpStatus,bodyBytes,bodySha256,correlation}=cosResponseEvidence(response);
  const journalEvidence={httpStatus,bodyBytes,bodySha256,correlation,extractCount:extracts.length};
  const patientId=encounter.subject?.reference?.match(/Patient\/([^/]+)$/)?.[1];if(!patientId)return {state:'pending',pdfBytesReadBack:false,reason:'pdfIdentityUnavailable'};
  return {...verifyCosPdfNote(extracts,{patientId,patientIdentifier:note.subject.identifier.value,encounterId:encounter.id,marker:`OpenTriage delivery ${deliveryId}`,pdfKeyword:this.settings.pdfKeyword}),journalEvidence};
 }
 async verifyNote(bundle:CosResource,encounter:CosResource,deliveryId:string,pdfEvidence?:CosPdfNoteResult){
  const note=bundle.entry.find((entry:CosResource)=>entry.resource.resourceType==='QuestionnaireResponse').resource;
  const pdf=pdfEvidence??await this.verifyPdf(bundle,encounter,deliveryId);
  if(!pdf.noteId)return;
  const stored=await this.read(`fhir/QuestionnaireResponse/${pdf.noteId}`);
  const expectedItems=note.item.filter((item:CosResource)=>!item.answer?.some((answer:CosResource)=>answer.valueUri?.startsWith('data:application/pdf;')));
  const authorRole=typeof stored.author?.reference==='string'&&stored.author.reference.startsWith('#')?stored.contained?.find((resource:CosResource)=>resource.resourceType==='PractitionerRole'&&resource.id===stored.author.reference.slice(1)):undefined;
  const author=authorRole?.practitioner??stored.author;
  const encounterMatches=!stored.encounter||identifier(stored.encounter.identifier)===identifier(note.encounter.identifier)||referenceId(stored.encounter.reference,'Encounter')===encounter.id;
  // The exact journal record already binds this internal note ID to patient/contact.
  // If FHIR also exposes an encounter it must agree; omission is not a guessed match.
  if(stored.resourceType!=='QuestionnaireResponse'||stored.id!==pdf.noteId||stored.status!==note.status||Math.floor(Date.parse(stored.authored)/1000)!==Math.floor(Date.parse(note.authored)/1000)||!await this.referenceMatches(author,note.author.identifier,'Practitioner')||!(identifier(stored.subject?.identifier)===identifier(note.subject.identifier)||typeof encounter.subject?.reference==='string'&&stored.subject?.reference===encounter.subject.reference)||!encounterMatches)return;
  const received=questionnaireIdentity(stored.questionnaire),configured=questionnaireIdentity(note.questionnaire);
  if(!received?.version||!configured||received.id!==configured.id||configured.version&&configured.version!==received.version)return;
  const template=await this.read(`fhir/Questionnaire/${received.id}`);
  if(template.resourceType!=='Questionnaire'||template.id!==received.id||template.version!==received.version||template.url!==stored.questionnaire)return;
  const noteVerified=cosNoteItemsMatch(expectedItems,stored.item??[])||cosTemplateNoteItemsMatch(expectedItems,stored.item??[],template,stored.questionnaire);
  const textItems=expectedItems.filter((item:CosResource)=>!item.item?.length&&!item.answer?.some((answer:CosResource)=>answer.item?.length));
  if(!noteVerified&&(textItems.length===expectedItems.length||!cosTemplateNoteItemsMatch(textItems,stored.item??[],template,stored.questionnaire)))return;
  const templateCanonical=stored.questionnaire;
  return {noteId:pdf.noteId,pdfBytesReadBack:false,documentRecorded:pdf.state==='document-recorded',pdfState:pdf.state,templateCanonical,noteVerified,
   ...(noteVerified&&expectedItems.some((item:CosResource)=>renderedMedication(item))?{verificationCoverage:{medications:'rendered-fields-matched',medicationTime:'Europe/Stockholm-minute-precision'}}:{}),
   ...(!noteVerified?{verificationFinding:'medicationRepresentationUnverified'}:{})};
 }
}
