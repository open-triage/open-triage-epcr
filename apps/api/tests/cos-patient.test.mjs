import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCosPatient,cosPatientCanRegister,cosPatientMatches} from '../dist/hospital/cos-patient.js';
import {ensureCosPatient,deliverCosLive} from '../dist/hospital/cos-live-delivery.js';
const identifier={system:'urn:oid:1.2.752.129.2.1.3.3',value:'201304822172'};
const source={amendments:[],amendmentSequence:0,occurrences:[
 ['ePatient.02','text','value_text','Söderberg'],['ePatient.03','text','value_text','Vilhelm'],['ePatient.04','text','value_text','Erik'],['ePatient.17','date','value_date','2013-04-22'],['ePatient.25','coded','code','9919003']
].map(([element_id,value_kind,key,value],index)=>({id:String(index),element_id,value_kind,[key]:value}))};
const resource=buildCosPatient(source,identifier);
function fixture(shared=new Set()){
 const events=[],writes=[];let stored;
 const patient={artifact_key:'patient',kind:'patient',resource:structuredClone(resource),state:'prepared',evidence:{}};
 const db={query:async(sql,params)=>{
  if(sql.includes('on conflict do nothing returning id')){
   const evidence=JSON.parse(params[2]);if(shared.has(evidence.patientRegistrationKey))return [];
   shared.add(evidence.patientRegistrationKey);events.push({state:'sending',evidence});return [{id:'1'}];
  }
  if(sql.startsWith('insert into clinical.cos_artifact_event')){
   events.push({state:params[2],evidence:JSON.parse(params[4])});return [{id:'2'}];
  }
  throw Error('Unexpected SQL');
 }};
 const adapter={settings:{baseUrl:'https://cos.example/api/',tokenUrl:'https://cos.example/token',clientId:'client'},authenticate:async()=>{},findPatient:async()=>stored,
  write:async(path,method,payload)=>{assert.equal(events.at(-1).state,'sending');writes.push({path,method,payload});stored={...payload,id:'6905'};return {state:'uncertain',status:201,issues:null,remoteId:'6905'};}};
 return {db,patient,adapter,events,writes,setStored:p=>{stored=p;}};
}
test('registration uses signed demographics and unchanged coordination identity, never EPS name fields',()=>{
 assert.equal(cosPatientCanRegister(resource),true);assert.deepEqual(resource.identifier,[identifier]);
 assert.deepEqual(resource.name,[{family:'Söderberg',given:['Vilhelm','Erik']}]);assert.equal(resource.birthDate,'2013-04-22');
 for(const patch of [{birthDate:'2013-02-30'},{name:[{}]},{gender:undefined},{identifier:[{...identifier,value:'201304822173'}]}])assert.equal(cosPatientCanRegister({...resource,...patch}),false);
 assert.equal(cosPatientCanRegister(buildCosPatient({...source,occurrences:[]},identifier)),false);
 const duplicate={...source,occurrences:[...source.occurrences,{...source.occurrences[0],id:"duplicate"}]};assert.equal(cosPatientCanRegister(buildCosPatient(duplicate,identifier)),false);
});
test('existing exact patient is read before any write and never re-registered',async()=>{
 const f=fixture();f.setStored({...resource,id:'6905'});
 assert.equal(await ensureCosPatient(f.db,'delivery',f.patient,f.adapter,true),true);assert.equal(f.writes.length,0);assert.equal(f.events.at(-1).state,'verified');
});
test('missing patient is registered once with committed intent then independently verified after empty 201',async()=>{
 const f=fixture();assert.equal(await ensureCosPatient(f.db,'delivery',f.patient,f.adapter,true),true);
 assert.equal(f.writes.length,1);assert.equal(f.writes[0].path,'fhir/Patient');assert.equal(f.events.at(-1).state,'verified');
});
test('read-only reconciliation, incomplete demographics, lookup failures and identity conflict never create',async()=>{
 for(const mode of ['readOnly','missingName','readFailure','wrongIdentity','wrongDemographics']){
  const f=fixture();if(mode==='missingName')f.patient.resource.name=[];
  if(mode==='readFailure')f.adapter.findPatient=async()=>{throw Error('unavailable');};
  if(mode==='wrongIdentity')f.setStored({...resource,id:'6905',identifier:[{...identifier,system:'wrong'}]});
  if(mode==='wrongDemographics')f.setStored({...resource,id:'6905',birthDate:'2014-04-22'});
  assert.equal(await ensureCosPatient(f.db,'delivery',f.patient,f.adapter,mode!=='readOnly'),false);assert.equal(f.writes.length,0);
 }
});
test('concurrent reports share one creation claim and lost receipts cannot cause POST replay',async()=>{
 const shared=new Set(),one=fixture(shared),two=fixture(shared);let count=0;
 for(const f of [one,two])f.adapter.write=async()=>{count++;throw Error('lost receipt');};
 await Promise.all([ensureCosPatient(one.db,'one',one.patient,one.adapter,true),ensureCosPatient(two.db,'two',two.patient,two.adapter,true)]);
 assert.equal(count,1);
 await ensureCosPatient(one.db,'one',one.patient,one.adapter,true);assert.equal(count,1);
 two.setStored({...resource,id:'6905'});assert.equal(await ensureCosPatient(two.db,'two',two.patient,two.adapter,false),true);
});
test('rejected creation and accepted but invisible patient are not replayed',async()=>{
 for(const status of [422,201]){
  const f=fixture();let count=0;f.adapter.write=async()=>{count++;return {state:status===422?'rejected':'uncertain',status};};
  assert.equal(await ensureCosPatient(f.db,'delivery',f.patient,f.adapter,true),false);
  assert.equal(await ensureCosPatient(f.db,'delivery',f.patient,f.adapter,true),false);assert.equal(count,1);
 }
});
test('unverified patient gates clinical writes in the delivery orchestrator',async()=>{
 const f=fixture();const original=f.db.query;const artifacts=[f.patient,...['context','encounter','note','pdf'].map(kind=>({artifact_key:kind,kind,resource:{findings:[]},state:'prepared',evidence:{}}))];
 f.db.query=async(sql,p)=>sql.startsWith('select a.*,coalesce')?artifacts:sql.startsWith('select a.resource')?[]:original(sql,p);
 f.adapter.findPatient=async()=>{throw Error('unavailable');};
 assert.equal((await deliverCosLive(f.db,'delivery','report',f.adapter,true)).outcome,'unresolved');assert.equal(f.writes.length,0);
});

test('personal identifiers are also supported and signed amendments determine registration demographics',()=>{
 const personal=buildCosPatient(source,{system:'urn:oid:1.2.752.129.2.1.3.1',value:'194609073277'});
 assert.equal(cosPatientCanRegister(personal),true);
 const amended={...source,amendmentSequence:1,amendments:[{sequence:1,changes:[{action:'replace',targetId:'0',corrected:{...source.occurrences[0],id:'corrected',value_text:'Corrected'}}]}]};
 assert.equal(buildCosPatient(amended,identifier).name[0].family,'Corrected');
});
