import test from 'node:test';
import assert from 'node:assert/strict';
import {deliverCosLive} from '../dist/hospital/cos-live-delivery.js';
import {contentDigest} from '../dist/admin/canonical-package.js';

function fixture(){
 const original={resourceType:'Encounter',id:'report',meta:{lastUpdated:'2026-11-01T10:00:00Z'}};
 const request={method:'PUT',path:'fhir/subscription/Encounter/report',resource:original,sha256:contentDigest(original)};
 const responseEvidence={httpStatus:400,issueCount:1,issues:[{severity:'error',code:'processing',diagnostics:'revisionId must be non-null and non-empty'}]};
 const artifacts=['context','encounter','note','pdf'].map(kind=>({artifact_key:kind,kind,resource:kind==='context'?{findings:[]}:kind==='encounter'?original:{},state:kind==='encounter'?'rejected':kind==='context'?'verified':'prepared',remote_id:null,evidence:kind==='encounter'?{responseEvidence}: {}}));
 const requests=[request],writes=[];
 const db={query:async(sql,params)=>{
  if(sql.startsWith('select a.*,coalesce'))return structuredClone(artifacts);
  if(sql.startsWith('select a.resource')||sql.startsWith('select a.*,e.state'))return [];
  if(sql.startsWith('select evidence'))return params[1]==='encounter'?[{evidence:{request:requests.at(-1)}}]:[];
  if(sql.startsWith('insert into clinical.cos_artifact_event')){
   const [,key,state,remote_id,raw]=params,evidence=JSON.parse(raw);Object.assign(artifacts.find(a=>a.artifact_key===key),{state,remote_id,evidence});
   if(evidence.request&&key==='encounter')requests.push(evidence.request);return [{id:'event'}];
  }
  throw Error(sql);
 }};
 const adapter={settings:{acceptedProfiles:[]},bindEncounter:async(resource,required)=>{assert.equal(required,true);return {...resource,meta:{...resource.meta,versionId:'107304'}};},verifyEncounter:async()=>['accepted','verified'].includes(artifacts.find(a=>a.kind==='encounter').state)?{id:'107299'}:undefined,
  write:async(path,method,resource)=>{writes.push({path,method,resource});if(path.includes('Encounter')){assert.equal(requests.at(-1).resource.meta.versionId,'107304','version is durably pinned before PUT');assert.equal(resource.meta.versionId,'107304');}return {state:'accepted',status:201,remoteId:'107299'};},
  verifyPdf:async()=>({state:'document-recorded',noteId:'135930'}),verifyNote:async()=>({noteVerified:true,noteId:'135930'})};
 return {db,adapter,artifacts,writes,requests};
}
test('rejected or uncertain encounter writes cannot be replaced on retry',async()=>{
 for(const state of ['rejected','uncertain']){
  const f=fixture();f.artifacts[1].state=state;
  const result=await deliverCosLive(f.db,'delivery','report',f.adapter,true,true);
  assert.notEqual(result.safeToResume,true);assert.equal(f.writes.length,0);
 }
});

test('safe recovery retires an obsolete draft but never unblocks an unknown remote write',async()=>{
 const {cosSigningCheckOutcome}=await import('../dist/hospital/cos-signing-check.js');
 const current={compatible:true,revision:'5',current_revision:'5'},changed={...current,current_revision:'9'};
 assert.deepEqual(cosSigningCheckOutcome(current,{outcome:'unresolved',safeToResume:true}),{state:'pending',finding:'signingResume',resume:true});
 assert.deepEqual(cosSigningCheckOutcome(changed,{outcome:'unresolved',safeToResume:true}),{state:'superseded',finding:'draftChanged',resume:false});
 for(const job of [current,changed])assert.equal(cosSigningCheckOutcome(job,{outcome:'unresolved',safeToResume:false}).state,'uncertain');
 assert.equal(cosSigningCheckOutcome({...current,compatible:false},{outcome:'unresolved',safeToResume:true}).state,'uncertain');
 assert.equal(cosSigningCheckOutcome(changed,{outcome:'stored'}).state,'confirmed','storage proof survives draft changes; finalization separately checks the revision');
});

function completedContactFixture(){
 const f=fixture();const encounter=f.artifacts.find(a=>a.kind==='encounter');
 encounter.resource={resourceType:'Encounter',id:'report',status:'finished',identifier:[{system:'report',value:'report'}],subject:{identifier:{system:'patient',value:'123'}},participant:[{individual:{identifier:{system:'hsa',value:'author'}}}],location:[{location:{identifier:{system:'rakel',value:'unit'}}}],hospitalization:{destination:{identifier:{system:'hsa',value:'destination'}}},meta:{profile:['profile'],lastUpdated:'2026-11-01T10:00:00Z'},period:{start:'2026-11-01T08:00:00Z',end:'2026-11-01T10:00:00Z'}};
 encounter.evidence={responseEvidence:{httpStatus:400,issueCount:1,issues:[{severity:'error',code:'processing',diagnostics:"It should only be possible to update outpatient contacts that are in status 'Arrived' and 'Open'"}]}};
 const prior={delivery_id:'original',state:'verified',remote_id:'107299',resource:structuredClone(encounter.resource),evidence:{}};prior.resource.period.end='2026-11-01T09:00:00Z';prior.resource.meta.lastUpdated=prior.resource.period.end;
 const query=f.db.query;f.db.query=(sql,args)=>sql.startsWith('select a.resource')?Promise.resolve([structuredClone(prior)]):query(sql,args);
 let noteStored=false;
 f.adapter.bindEncounter=async()=>assert.fail('An unchanged completed contact must not be updated');
 f.adapter.verifyEncounter=async(expected,remoteId)=>{
  assert.equal(remoteId,'107299');assert.equal(expected.period.end,'2026-11-01T09:00:00Z');return {id:'107299'};
 };
 f.adapter.write=async(path,method,resource)=>{assert.ok(!path.includes('Encounter'));noteStored=true;f.writes.push({path,method,resource});return {state:'accepted',status:201};};
 f.adapter.verifyPdf=async()=>noteStored?{state:'document-recorded',noteId:'new-note'}:{state:'pending',reason:'pdfNoteNotFound'};
 f.adapter.verifyNote=async()=>noteStored?{noteVerified:true,noteId:'new-note'}:undefined;
 return {...f,prior,encounter};
}
test('rejected update reuses freshly verified completed contact, then delivers only the new note/PDF',async()=>{
 const f=completedContactFixture();
 const checked=await deliverCosLive(f.db,'delivery','report',f.adapter,false);
 assert.equal(checked.outcome,'unresolved','old successful delivery does not prove the latest note/PDF');assert.equal(checked.safeToResume,true);assert.equal(f.writes.length,0);
 assert.equal(f.encounter.state,'verified');assert.equal(f.encounter.evidence.reusedDeliveryId,'original');assert.equal(f.encounter.evidence.retainedPeriodEnd,'2026-11-01T09:00:00Z');
 const delivered=await deliverCosLive(f.db,'delivery','report',f.adapter,true,true);
 assert.equal(delivered.outcome,'unresolved');
 assert.equal((await deliverCosLive(f.db,'delivery','report',f.adapter,false,false,()=>Date.now()+20_000)).outcome,'stored');assert.equal(f.writes.length,1);assert.match(f.writes[0].path,/Bundle/);
 assert.equal(f.encounter.resource.period.end,'2026-11-01T10:00:00Z','immutable prepared manifest is not rewritten');
});
test('new versions reuse completed contacts before making any unnecessary PUT',async()=>{
 const f=completedContactFixture();f.encounter.state='prepared';f.encounter.evidence={};
 const delivered=await deliverCosLive(f.db,'delivery','report',f.adapter,true);
 assert.equal(delivered.outcome,'unresolved');
 assert.equal((await deliverCosLive(f.db,'delivery','report',f.adapter,false,false,()=>Date.now()+20_000)).outcome,'stored');assert.equal(f.writes.length,1);assert.match(f.writes[0].path,/Bundle/);
});
test('contact reuse does not hide changed clinical context, failed read-back, or unknown PUTs',async()=>{
 for(const change of [
  f=>f.encounter.resource.subject.identifier.value='different',
  f=>f.encounter.resource.participant[0].individual.identifier.value='different',
  f=>f.encounter.resource.location[0].location.identifier.value='different',
  f=>f.encounter.resource.hospitalization.destination.identifier.value='different',
  f=>f.encounter.resource.period.start='2026-11-01T07:00:00Z',
  f=>f.encounter.resource.status='cancelled',
  f=>f.encounter.resource.meta.profile=['different'],
  f=>f.encounter.state='uncertain',
  f=>f.prior.state='uncertain',
 ]){
  const f=completedContactFixture();change(f);f.adapter.verifyEncounter=async()=>undefined;
  const result=await deliverCosLive(f.db,'delivery','report',f.adapter,false);
  assert.equal(result.outcome,'unresolved');assert.notEqual(result.safeToResume,true);assert.equal(f.writes.length,0);assert.notEqual(f.encounter.state,'verified');
 }
 for(const throws of [false,true]){
  const f=completedContactFixture();f.encounter.state='prepared';f.adapter.verifyEncounter=async()=>{if(throws)throw Error('receiver unavailable');return undefined;};
  const result=await deliverCosLive(f.db,'delivery','report',f.adapter,true);
  assert.equal(result.outcome,'unresolved');assert.equal(f.writes.length,0,'failed reuse verification never falls back to a blind update');assert.notEqual(f.encounter.state,'verified');
 }
});

test('automatic journal checks can confirm storage but never authorize sending prepared artifacts',async()=>{
 const {cosSigningCheckOutcome}=await import('../dist/hospital/cos-signing-check.js');
 const job={compatible:true,revision:'9',current_revision:'9',automatic:true};
 for(const proof of [{outcome:'unresolved',safeToResume:true},{outcome:'not-stored'}]){
  const result=cosSigningCheckOutcome(job,proof);assert.equal(result.state,'uncertain');assert.equal(result.resume,false);
 }
 assert.equal(cosSigningCheckOutcome(job,{outcome:'stored'}).state,'confirmed');
});
