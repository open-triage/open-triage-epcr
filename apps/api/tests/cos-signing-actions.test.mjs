import test from 'node:test';
import assert from 'node:assert/strict';
import {compareCosPatient,readCosPatientComparison} from '../dist/hospital/cos-patient-comparison.js';
import {cosSigningIssues} from '../dist/hospital/cos-signing-issues.js';
const expected={resourceType:'Patient',identifier:[{system:'urn:test',value:'123'}],name:[{given:['Local','Middle'],family:'Name'}],gender:'female',birthDate:'2000-01-01'};
test('comparison binds identifier namespace, limits demographic fields and maps normal clinical edits',()=>{
 const result=compareCosPatient(expected,{...expected,name:[{use:'official',given:['COS'],family:'Patient'}],gender:'male',birthDate:'2001-02-03',secret:'not exposed'});
 assert.equal(result.displayName,'COS Patient');assert.equal(result.canApply,true);
 assert.deepEqual(result.changes.map(c=>c.elementId),['ePatient.03','ePatient.04','ePatient.02','ePatient.17','ePatient.25']);
 assert.equal(result.changes[1].value,'');assert.equal(result.changes.at(-1).value,'9919003');
 assert.equal(JSON.stringify(result).includes('not exposed'),false);
 for(const identifier of [[{system:'other',value:'123'}],[],[null]])
  assert.throws(()=>compareCosPatient(expected,{...expected,identifier}));
});
test('missing or ambiguous demographics cannot erase documented fields',()=>{
 const result=compareCosPatient(expected,{...expected,name:[{given:['A'],family:'One'},{given:['B'],family:'Two'}],birthDate:'2001-02-30',gender:undefined});
 assert.equal(result.canApply,false);assert.deepEqual(result.changes,[]);
});
test('comparison authorizes and checks revision before COS access; audit failure prevents lookup',async()=>{
 let calls=0;
 const adapter=async()=>{calls++;return {findPatient:async()=>expected};};
 const sessions={requireCapability:async()=>({organization:{id:'org'},user:{id:'user'}})};
 const input={revision:3,deliveryId:'00000000-0000-4000-8000-000000000001'};
 for(const rows of [[],[{revision:4,status:'draft'}],[{revision:3,status:'signed'}]]){
  await assert.rejects(()=>readCosPatientComparison({transaction:fn=>fn({query:async()=>rows})},sessions,'token','report',input,adapter));
 }
 await assert.rejects(()=>readCosPatientComparison({}, {requireCapability:async()=>{throw Error('forbidden');}},'token','report',input,adapter));
 let count=0;
 await assert.rejects(()=>readCosPatientComparison({transaction:fn=>fn({query:async()=>++count===1?[{revision:3,status:'draft'}]:count===2?[{submission_revision:3,settings:{mode:'live'}}]:[{recorded:0}]})},sessions,'token','report',input,adapter));
 assert.equal(calls,0);
});
test('comparison audits before remote read and rejects edits made during lookup',async()=>{
 const events=[];
 const sessions={requireCapability:async()=>({organization:{id:'org'},user:{id:'user'}})};
 let count=0;
 const db={transaction:async fn=>{const value=await fn({query:async()=>++count===1?[{revision:3,status:'draft'}]:count===2?[{submission_revision:3,settings:{mode:'live'},resource:expected}]:[{recorded:1}]});events.push('commit');return value;},query:async()=>[],manager:{}};
 await assert.rejects(()=>readCosPatientComparison(db,sessions,'token','report',{revision:3,deliveryId:'00000000-0000-4000-8000-000000000001'},async()=>({findPatient:async()=>{events.push('read');return expected;}})));
 assert.deepEqual(events,['commit','read']);
});
test('issue details expose pinned targets and bounded codes without raw response bodies',()=>{
 const artifacts=[{kind:'observation',state:'failed',resource:{},evidence:{reason:'clinicalValue',findings:[null,{code:'clinicalValue',occurrenceId:'occ',mappingId:'bp',diagnostics:'SECRET'},{code:'bad <html>'}]}}];
 assert.deepEqual(cosSigningIssues(artifacts,{occurrences:[{id:'occ',element_id:'eVitals.06',group_instance_id:'group'}],groups:[{id:'group',group_id:'eVitals.VitalGroup'}]}),[{code:'clinicalValue',artifact:'observation',mappingId:'bp',occurrenceId:'occ',elementId:'eVitals.06',groupId:'eVitals.VitalGroup',groupInstanceId:'group'}]);
 assert.deepEqual(cosSigningIssues([],null),[]);
});


test('only projection context coverage is exposed as acknowledgeable, never patient or transport findings',()=>{
 const artifacts=['context','patient','note'].map(kind=>({kind,state:'unresolved',resource:{},evidence:{findings:[{code:'clinicalValue',coverage:'partial'}]}}));
 const issues=cosSigningIssues(artifacts,{});
 assert.equal(issues[0].coverage,'partial');assert.equal(issues[1].coverage,undefined);assert.equal(issues[2].coverage,undefined);
});


test('comparison of a revised draft uses its current demographics and rejects a changed identifier before lookup',async()=>{
 const session={requireCapability:async()=>({organization:{id:'org'},user:{id:'user'}})};
 for(const value of ['123','different']){
  let step=0,reads=0;
  const rows=[
   {id:'id',element_id:'ePatient.01',value_kind:'text',value_text:value},
   {id:'first',element_id:'ePatient.03',value_kind:'text',value_text:'Current'},
   {id:'last',element_id:'ePatient.02',value_kind:'text',value_text:'Draft'}];
  const db={transaction:fn=>fn({query:async()=>++step===1?[{revision:4,status:'draft'}]:step===2?
   [{submission_revision:3,identifier_field:{kind:'nemsis',elementId:'ePatient.01'},resource:structuredClone(expected),settings:{mode:'live'}}]:
   step===3?rows:[{recorded:1}]}),query:async()=>[{id:'report'}],manager:{}};
  const run=()=>readCosPatientComparison(db,session,'token','report',{revision:4,deliveryId:'00000000-0000-4000-8000-000000000001'},async()=>({findPatient:async()=>{reads++;return expected;}}));
  if(value==='123'){const result=await run();assert.equal(result.revision,4);assert.equal(result.local.firstName,'Current');assert.equal(result.local.lastName,'Draft');assert.equal(reads,1);}
  else{await assert.rejects(run);assert.equal(reads,0);}
 }
});

test('saved-draft comparison clears only demographics that pass the delivery verifier',()=>{
 const actual={...expected,id:'patient'};
 assert.equal(compareCosPatient(expected,actual).matches,true);
 assert.equal(compareCosPatient({...expected,birthDate:'1999-01-01'},actual).matches,false);
 const incomplete={...actual,name:[],birthDate:undefined,gender:undefined};
 const result=compareCosPatient(expected,incomplete);
 assert.deepEqual(result.changes,[]);
 assert.equal(result.canApply,false);
 assert.equal(result.matches,false,'no applicable changes is not proof of resolution');
});

test('identifying signing issues expose bounded receiver rejection and read failure reasons separately',()=>{
 const response={httpStatus:400,issues:[{severity:'error',code:'processing',diagnostics:'revisionId must be non-null and non-empty'}],authorization:'SECRET',body:'PRIVATE BODY'};
 const artifact={kind:'encounter',state:'rejected',resource:{},evidence:{responseEvidence:response,verificationFailure:{response:{httpStatus:503,issues:[{severity:'error',details:'Temporarily unavailable'}]}}}};
 const issues=cosSigningIssues([artifact],{});
 assert.deepEqual(issues,[{code:'receiverRejected',artifact:'encounter',receiverError:{httpStatus:400,reason:'revisionId must be non-null and non-empty'}},{code:'receiverVerificationFailed',artifact:'encounter',receiverError:{httpStatus:503,reason:'Temporarily unavailable'}}]);
 assert.equal(JSON.stringify(issues).includes('SECRET'),false);assert.equal(JSON.stringify(issues).includes('PRIVATE BODY'),false);
 artifact.evidence.responseEvidence.issues[0].diagnostics='x'.repeat(5000);assert.equal(cosSigningIssues([artifact],{})[0].receiverError.reason.length,2048);
 artifact.state='verified';assert.deepEqual(cosSigningIssues([artifact],{}),[]);
});
