import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {contentDigest} from '../../dist/admin/canonical-package.js';
import {cosArtifacts,cosArtifactEvent,deliverCosLive} from '../../dist/hospital/cos-live-delivery.js';
/** Runs against a real queued report; all receiver effects remain explicit fakes. */
export async function liveArtifactFixture(db,reportId){
 const [delivery]=await db.query('select id from clinical.cos_delivery where report_id=$1 order by created_at desc limit 1',[reportId]);
 const id=delivery.id;
 let now=Date.now();
 const deliver=(db,id,report,adapter,write=true)=>deliverCosLive(db,id,report,adapter,write,false,()=>now);
 const observation={resourceType:'Observation',id:'test-observation',meta:{profile:['test-profile']},identifier:[{system:'urn:opentriage:cos:source',value:'source-1'}]};
 for(const [key,kind,resource,source] of [['context','context',{findings:[]},null],['encounter','encounter',{resourceType:'Encounter',id:'test-encounter'},null],['observation:test-observation','observation',observation,'source-1'],['note','note',{resourceType:'Bundle'},null],['pdf','pdf',{sha256:'a'.repeat(64)},null]]){
  await db.query('insert into clinical.cos_artifact(delivery_id,report_id,artifact_key,kind,source_key,content_sha256,resource) values($1,$2,$3,$4,$5,$6,$7)',[id,reportId,key,kind,source,contentDigest(resource),resource]);
 }
 await cosArtifactEvent(db,id,'context','verified');
 const writes=[];let readAvailable=false;
 const adapter={bindObservation:async resource=>({...structuredClone(resource),encounter:{type:'Encounter',reference:'Encounter/101'}}),settings:{acceptedProfiles:['test-profile']},write:async(path,method)=>{
  // The real journal must contain committed intent before the test receiver sees a request.
  const rows=await cosArtifacts(db,id);const key=path.includes('Observation')?'observation:test-observation':path.includes('Encounter')?'encounter':'note';
  assert.equal(rows.find(a=>a.artifact_key===key).state,'sending');if(method==='POST'){const [intent]=await db.query("select evidence from clinical.cos_artifact_event where delivery_id=$1 and artifact_key=$2 and state='sending' order by id desc limit 1",[id,key]);assert.equal(intent.evidence.request.resource.encounter.reference,'Encounter/101');assert.equal(intent.evidence.request.sha256,contentDigest(intent.evidence.request.resource));}writes.push({path,method});
  if(method==='POST')throw new Error('Lost receipt after remote commit');return {state:'accepted',status:201,issues:[],remoteId:'101'};
 },bindEncounter:async resource=>structuredClone(resource),verifyEncounter:async()=>({id:'101'}),verifyObservation:async()=>{throw new Error('No receipt ID, cannot safely search for lookalikes');},verifyPdf:async()=>readAvailable?{state:'document-recorded',noteId:'201',pdfBytesReadBack:false}:{state:'pending',reason:'pdfNoteNotFound',pdfBytesReadBack:false},verifyNote:async()=>readAvailable?{noteId:'201',documentRecorded:true,pdfBytesReadBack:false}:undefined};
 const untouched=await deliver(db,id,reportId,adapter,false);
 assert.equal(untouched.safeToResume,true,'crash after manifest but before first sending intent is safe to resume');assert.equal(writes.length,0);
 let result=await deliver(db,id,reportId,adapter);
 assert.equal(result.outcome,'unresolved');assert.equal(writes.filter(w=>w.method==='POST').length,1);
 assert.equal(result.artifacts.find(a=>a.kind==='observation').state,'uncertain');
 readAvailable=true;now+=20_000;
 result=await deliver(db,id,reportId,{...adapter,verifyNote:async()=>undefined},false);
 assert.equal(result.artifacts.find(a=>a.kind==='pdf').state,'verified','PDF verifies even while structured note remains uncertain');
 assert.equal(result.artifacts.find(a=>a.kind==='note').state,'accepted');
 result=await deliver(db,id,reportId,adapter,false);
 assert.equal(writes.length,3,'reconciliation is strictly read-only');assert.equal(result.outcome,'unresolved');
 assert.equal(result.artifacts.find(a=>a.kind==='pdf').state,'verified','successful note/PDF evidence survives uncertain vital POST');
 const noteMismatch={...adapter,verifyNote:async()=>undefined};
 result=await deliver(db,id,reportId,noteMismatch,false);
 assert.equal(result.artifacts.find(a=>a.kind==='pdf').state,'verified','structured note failure does not erase independently verified PDF');
 result=await deliver(db,id,reportId,{...noteMismatch,verifyPdf:async()=>{throw new Error('temporary read outage');}},false);
 assert.equal(result.artifacts.find(a=>a.kind==='pdf').state,'verified','temporary read outage preserves earlier document evidence');
 await deliver(db,id,reportId,adapter,true);
 assert.equal(writes.length,3,'even a resumed worker never blindly repeats a committed POST intent');
 await assert.rejects(db.query("update clinical.cos_artifact set resource='{}' where delivery_id=$1",[id]),/immutable|append|update|modif/i);
 await cosArtifactEvent(db,id,'observation:test-observation','verified','301',{clinicalContentMatched:true});
 for(const changed of [false,true]){
  const rollback=new Error('rollback isolated amendment fixture');
  await assert.rejects(db.transaction(async manager=>{
   const child=randomUUID();
   await manager.query(`insert into clinical.cos_delivery(id,report_id,snapshot_id,organization_id,group_id,configuration_revision,mapping_id,mapping_revision,mapping_sha256,pdf_language,amendment_sequence,lineage_parent_id,queued_by)
    select $2,report_id,snapshot_id,organization_id,group_id,configuration_revision,mapping_id,mapping_revision,mapping_sha256,pdf_language,amendment_sequence,$1,queued_by from clinical.cos_delivery where id=$1`,[id,child]);
   await manager.query(`insert into clinical.cos_artifact(delivery_id,report_id,artifact_key,kind,source_key,content_sha256,resource)
    select $2,report_id,artifact_key,kind,source_key,case when kind='observation' and $3 then repeat('b',64) else content_sha256 end,resource from clinical.cos_artifact where delivery_id=$1`,[id,child,changed]);
   await cosArtifactEvent(manager,child,'context','verified');
   const amendmentWrites=[];
   const amendmentAdapter={...adapter,write:async(path,method)=>{amendmentWrites.push(method);return {state:'accepted',status:201,issues:[],remoteId:'101'};}};
   await deliver(manager,child,reportId,amendmentAdapter);
   now+=20_000;
   const amendment=await deliver(manager,child,reportId,amendmentAdapter,false);
   assert.equal(amendmentWrites.includes('POST'),false,'unchanged reuse and unsupported corrections both avoid duplicate observations');
   assert.equal(amendment.artifacts.find(a=>a.kind==='observation').state,changed?'unresolved':'verified');
   assert.equal(amendment.outcome,changed?'unresolved':'stored');
   throw rollback;
  }),error=>error===rollback);
 }

}
