import test from 'node:test';
import assert from 'node:assert/strict';
import {deliverCosLive} from '../dist/hospital/cos-live-delivery.js';

function fixture() {
 const artifacts=['context','encounter','note','pdf'].map(kind=>({artifact_key:kind,kind,resource:kind==='context'?{findings:[]}: {},state:kind==='note'?'uncertain':kind==='pdf'?'prepared':'verified',remote_id:null,evidence:{}}));
 const events=[];
 const db={query:async(sql,params)=>{
  if(sql.startsWith('select a.*,coalesce'))return structuredClone(artifacts);
  if(sql.startsWith('select evidence'))return [];
  if(sql.startsWith('select a.resource')||sql.startsWith('select a.*,e.state'))return [];
  if(sql.startsWith('insert into clinical.cos_artifact_event')){
   const [,key,state,remoteId,evidence]=params;
   const row=artifacts.find(a=>a.artifact_key===key);
   Object.assign(row,{state,remote_id:remoteId,evidence:JSON.parse(evidence)});
   events.push(structuredClone(row));return [{id:String(events.length)}];
  }
  throw new Error('Unexpected query');
 }};
 const adapter={settings:{acceptedProfiles:[]},bindEncounter:async resource=>structuredClone(resource),verifyEncounter:async()=>({id:'101'}),
  write:async()=>{assert.fail('Reconciliation must never resend');},
  verifyPdf:async()=>({state:'document-recorded',noteId:'201',pdfBytesReadBack:false}),
  verifyNote:async(_bundle,_encounter,_id,pdf)=>{assert.equal(pdf.noteId,'201');return undefined;}};
 return {db,adapter,artifacts,events};
}
test('reconciliation records PDF independently of a failing structured note and preserves verified evidence',async()=>{
 const {db,adapter}=fixture();
 let result=await deliverCosLive(db,'delivery','report',adapter,false);
 assert.equal(result.outcome,'unresolved');
 assert.equal(result.artifacts.find(a=>a.kind==='note').state,'uncertain');
 const pdf=result.artifacts.find(a=>a.kind==='pdf');
 assert.equal(pdf.state,'verified');assert.equal(pdf.remote_id,'201');assert.equal(pdf.evidence.pdfBytesReadBack,false);
 adapter.verifyPdf=async()=>{throw new Error('PRIVATE response body');};adapter.verifyNote=async()=>undefined;
 result=await deliverCosLive(db,'delivery','report',adapter,false);
 assert.equal(result.artifacts.find(a=>a.kind==='pdf').state,'verified');
});
test('PDF failures retain safe, specific diagnostics without exposing receiver errors',async()=>{
 for(const reason of ['pdfJournalEmpty','pdfNoteNotFound','pdfDocumentMissing','pdfNoteAmbiguous','pdfInclusionFailed','pdfJournalUnavailable']){
  const {db,adapter}=fixture();
  adapter.verifyNote=async()=>undefined;
  adapter.verifyPdf=async()=>{if(reason==='pdfJournalUnavailable')throw new Error('PRIVATE response body');return {state:'pending',pdfBytesReadBack:false,reason};};
  const result=await deliverCosLive(db,'delivery','report',adapter,false);
  const pdf=result.artifacts.find(a=>a.kind==='pdf');
  assert.equal(pdf.state,'unresolved');assert.equal(pdf.evidence.reason,reason);
  assert.deepEqual(pdf.evidence.findings,[{mappingId:'pdf',code:reason,coverage:'partial'}]);
  assert.equal(JSON.stringify(pdf).includes('PRIVATE'),false);
 }
});

test('verified remote artifacts resolve delivery despite pinned incomplete clinical projection',async()=>{
 for(const write of [false,true]){
  const {db,adapter,artifacts}=fixture();
  const context=artifacts.find(a=>a.kind==='context');
  context.resource.findings=[{mappingId:'bloodPressure',code:'clinicalCompanionMissing',coverage:'partial'}];
  context.state='unresolved';context.evidence={pinned:true};
  adapter.verifyNote=async()=>({noteVerified:true,noteId:'201'});
  const result=await deliverCosLive(db,'delivery','report',adapter,write);
  assert.equal(result.outcome,'stored');assert.equal(result.coverageIncomplete,true);
  assert.equal(result.artifacts.find(a=>a.kind==='context').state,'unresolved','clinical coverage warning remains visible');
  assert.equal(result.artifacts.find(a=>a.kind==='note').state,'verified');
 }
});
test('partial coverage cannot conceal uncertain artifacts or unresolved correction evidence',async()=>{
 for(const failure of ['note','context']){
  const {db,adapter,artifacts}=fixture();
  const context=artifacts.find(a=>a.kind==='context');
  context.resource.findings=[{coverage:'partial'}];context.state='unresolved';context.evidence={pinned:true};
  if(failure==='context'){context.evidence={reason:'observationCorrectionUnverified'};adapter.verifyNote=async()=>({noteVerified:true,noteId:'201'});}
  const result=await deliverCosLive(db,'delivery','report',adapter,false);
  assert.equal(result.outcome,'unresolved');
 }
});

test('encounter verification logging preserves the original rejection and stores read-back diagnostics separately',async()=>{
 const {CosReadFailure}=await import('../dist/hospital/cos-response-evidence.js');
 const {db,adapter,artifacts}=fixture();const encounter=artifacts.find(a=>a.kind==='encounter');
 encounter.state='rejected';encounter.evidence={httpStatus:400,issues:[{code:'processing',severity:'error'}]};
 adapter.verifyEncounter=async()=>{throw new CosReadFailure({httpStatus:404,issues:[{diagnostics:'Patient Not found for the given identifier'}]},'/api/fhir/Encounter');};
 const result=await deliverCosLive(db,'delivery','report',adapter,false);
 const stored=result.artifacts.find(a=>a.kind==='encounter');
 assert.equal(stored.state,'rejected');assert.equal(stored.evidence.httpStatus,400);
 assert.equal(stored.evidence.verificationFailure.response.httpStatus,404);
 assert.equal(stored.evidence.verificationFailure.response.issues[0].diagnostics,'Patient Not found for the given identifier');
});

test('response-only policy accepts empty 201 without note/PDF read-back and never claims verification',async()=>{
 const {db,adapter,artifacts}=fixture();adapter.settings.readBackVerification=false;
 adapter.verifyPdf=adapter.verifyNote=async()=>assert.fail('Optional read-back must be skipped');
 const note=artifacts.find(a=>a.kind==='note');note.evidence={httpStatus:201,responseEvidence:{bodyBytes:0}};
 const result=await deliverCosLive(db,'delivery','report',adapter,false);
 assert.equal(result.outcome,'accepted');assert.equal(result.coverageIncomplete,false);
 for(const kind of ['note','pdf']){const artifact=result.artifacts.find(a=>a.kind===kind);assert.equal(artifact.state,'accepted');assert.equal(artifact.evidence.verificationOutcome,'skipped');}
});
test('response-only policy retains blockers for rejection, timeout, malformed success, and missing routing',async()=>{
 for(const [state,evidence] of [['rejected',{httpStatus:400}],['uncertain',{}],['uncertain',{httpStatus:500,responseEvidence:{bodyBytes:0}}],['uncertain',{httpStatus:201,responseEvidence:{bodyBytes:10}}],['prepared',{}]]){
  const {db,adapter,artifacts}=fixture();adapter.settings.readBackVerification=false;
  adapter.verifyPdf=adapter.verifyNote=async()=>assert.fail('Optional read-back must be skipped');
  Object.assign(artifacts.find(a=>a.kind==='note'),{state,evidence});
  const result=await deliverCosLive(db,'delivery','report',adapter,false);
  assert.equal(result.outcome,'unresolved');assert.notEqual(result.artifacts.find(a=>a.kind==='pdf').state,'accepted');
 }
 const {db,adapter,artifacts}=fixture();adapter.settings.readBackVerification=false;adapter.verifyEncounter=async()=>undefined;
 artifacts.find(a=>a.kind==='note').evidence={httpStatus:201,responseEvidence:{bodyBytes:0}};
 assert.equal((await deliverCosLive(db,'delivery','report',adapter,false)).outcome,'unresolved');
});


test('accepted note waits for its persisted deadline across checks, then verifies without resending',async()=>{
 for(const receipt of [{state:'accepted',status:201},{state:'uncertain',status:201,responseEvidence:{bodyBytes:0}}]){
  const {db,adapter,artifacts}=fixture();let now=Date.parse('2026-11-01T12:00:00Z'),writes=0,reads=0;
  artifacts.find(a=>a.kind==='note').state='prepared';
  adapter.write=async()=>{writes++;return receipt;};
  adapter.verifyPdf=async()=>{reads++;return {state:'document-recorded',noteId:'201'};};
  adapter.verifyNote=async()=>{reads++;return {noteVerified:true,noteId:'201'};};
  const run=write=>deliverCosLive(db,'delivery','report',adapter,write,false,()=>now);
  const sent=await run(true);assert.equal(sent.outcome,'unresolved');assert.equal(sent.safeToResume,false);
  const deadline=artifacts.find(a=>a.kind==='note').evidence.journalVerificationNotBefore;
  assert.equal(deadline,'2026-11-01T12:00:20.000Z');assert.equal(reads,0);assert.equal(writes,1);
  now+=19_999;
  assert.equal((await run(false)).outcome,'unresolved');assert.equal(reads,0);
  assert.equal(artifacts.find(a=>a.kind==='note').evidence.journalVerificationNotBefore,deadline);
  now++;
  assert.equal((await run(false)).outcome,'stored');assert.equal(reads,2);assert.equal(writes,1);
 }
});
test('rejected and malformed receipts do not acquire a journal settling deadline',async()=>{
 for(const receipt of [{state:'rejected',status:400},{state:'uncertain',status:201,responseEvidence:{bodyBytes:10}}]){
  const {db,adapter,artifacts}=fixture();artifacts.find(a=>a.kind==='note').state='prepared';
  adapter.write=async()=>receipt;adapter.verifyPdf=async()=>({state:'pending',reason:'pdfNoteNotFound'});
  await deliverCosLive(db,'delivery','report',adapter);
  assert.equal(artifacts.find(a=>a.kind==='note').evidence.journalVerificationNotBefore,undefined);
 }
});

test('configured delay determines the persisted deadline and zero permits immediate verification',async()=>{
 for(const seconds of [0,45,240]){
  const {db,adapter,artifacts}=fixture();const now=Date.parse('2026-11-01T12:00:00Z');
  adapter.settings.initialVerificationDelaySeconds=seconds;
  artifacts.find(a=>a.kind==='note').state='prepared';
  adapter.write=async()=>({state:'accepted',status:201});
  adapter.verifyNote=async()=>({noteVerified:true,noteId:'201'});
  const result=await deliverCosLive(db,'delivery','report',adapter,true,false,()=>now);
  assert.equal(result.outcome,seconds===0?'stored':'unresolved');
  if(seconds){
   assert.equal(Date.parse(artifacts.find(a=>a.kind==='note').evidence.journalVerificationNotBefore),now+seconds*1000);
   adapter.settings.initialVerificationDelaySeconds=0;
   assert.equal((await deliverCosLive(db,'delivery','report',adapter,false,false,()=>now)).outcome,'unresolved','later settings cannot shorten a persisted receipt deadline');
  }
 }
});
