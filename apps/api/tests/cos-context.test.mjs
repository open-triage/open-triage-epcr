import assert from 'node:assert/strict';
import test from 'node:test';
import {validateDestination,DestinationService} from '../dist/hospital/destination.service.js';
import {hsaCandidate,captureHsa} from '../dist/authentication/hsa-capture.js';
import {externalIdentity} from '../dist/authentication/external-identity.service.js';
import {resolveCosExportContext} from '../dist/hospital/cos-export-context.js';
import {selectDestination,destinationSelectionMatches} from '@open-triage/contracts';
const id='00000000-0000-4000-8000-000000000001';
const entry={id,groupId:'group',revision:1,displayName:'Hospital — receiving unit',localCode:'001-A',hsaId:'SE-001',active:true};
test('directory pairs remain strings and stable selection is invalid after either manual edit',()=>{
 const {name,code,selection}=selectDestination(entry);
 assert.equal(name,entry.displayName);assert.equal(code,'001-A');
 assert.ok(destinationSelectionMatches(selection,name,code));
 assert.equal(destinationSelectionMatches(selection,name+'x',code),false);
 assert.equal(destinationSelectionMatches(selection,name,'different'),false);
 assert.deepEqual(validateDestination({displayName:name,localCode:code,hsaId:null,active:true},false),{displayName:name,localCode:code,hsaId:null,active:true});
 for(const change of [{localCode:'A'},{displayName:'A'},{localCode:12},{displayName:'x'.repeat(101)},{localCode:'x'.repeat(51)},{hsaId:['A']},{groupId:'forged'},{expectedRevision:2}])assert.throws(()=>validateDestination({displayName:name,localCode:code,hsaId:null,active:true,...change},false));
});
test('HSA claims are opt-in, singular validated strings; no email/name inference or account-link effect',()=>{
 const claims={iss:'https://issuer.example',sub:'subject',email:'hsa@email',hsa:['A','B']};
 assert.equal(hsaCandidate(claims,undefined),undefined);
 assert.equal(hsaCandidate(claims,'missing',true).finding,'missing');
 for(const hsa of [[],['A'],12,'','bad\nvalue'])assert.equal(hsaCandidate({...claims,hsa},'hsa',true).finding,'malformed');
 assert.deepEqual(hsaCandidate({...claims,hsa:' 001-ABC '},'hsa',true),{value:'001-ABC',finding:null,authoritative:true});
 const identity=externalIdentity({...claims,hsa:'001-ABC'},{displayName:'name',email:'email',hsaId:'hsa',hsaAuthoritative:true});
 assert.equal(identity.subject,'subject');assert.equal(identity.hsa.value,'001-ABC');assert.equal('role' in identity,false);
});
test('active HSA capture fills missing, never overwrites conflicts, and ignores profile hints',async()=>{
 for(const [existing,authoritative,duplicate,expected] of [[null,true,false,'hsa_id=$2'],['OLD',true,false,'hsa_conflict=true'],[null,true,true,'hsa_conflict=true'],[null,false,false,null]]){
  const writes=[];const manager={query:async(sql,params)=>{
   writes.push({sql,params});if(sql.startsWith('select hsa_id'))return [{hsa_id:existing,revision:1}];
   if(sql.startsWith('select id from'))return duplicate?[{id:'other'}]:[];return [];
  }};
  await captureHsa(manager,'user','agency',{value:'001-ABC',finding:null,authoritative},{issuer:'issuer',subject:'subject',providerRevision:5,providerId:'provider'});
  const updates=writes.filter(row=>row.sql.startsWith('update'));
  assert.equal(updates.length,expected?1:0);if(expected)assert.ok(updates[0].sql.includes(expected));
  const evidence=JSON.parse(writes.at(-1).params[3]);assert.equal(evidence.providerRevision,5);assert.equal(evidence.subject,'subject');
 }
});
test('directory rejects stale and cross-group edits before writing',async()=>{
 for(const rows of [[],[{...entry,revision:2}]]){
  let writes=0;const manager={query:async(sql)=>{if(sql.startsWith('select app_identity'))return [{id:'group'}];if(sql.startsWith('select'))return rows;writes++;return [];}};
  const service=new DestinationService({transaction:work=>work(manager)},{requireCapability:async()=>({organization:{id:'agency'},user:{id:'actor'}})});
  await assert.rejects(service.save('token',id,{displayName:'Hospital',localCode:'001',hsaId:null,active:true,expectedRevision:1}));assert.equal(writes,0);
 }
});
test('context uses immutable signed author, pinned unit and exact destination revision, reports all missing identities',async()=>{
 const source={amendmentSequence:0,reportId:id,signerId:'original',amendments:[],occurrences:[],groups:[]};
 const manager={query:async sql=>sql.includes('from clinical.report')?[{organization_id:'agency',group_id:'group',cos_unit_id:null,created_at:'2026-10-27T12:00:00Z'}]:[]};
 const result=await resolveCosExportContext(manager,source,{});
 assert.ok(result.missing.includes('staff'));assert.ok(result.missing.includes('rakel'));assert.ok(!result.missing.includes('encounterStart'));assert.equal(result.context.startedAt,'2026-10-27T12:00:00.000Z');assert.equal(result.settings.authorHsaId,null);
});
test('destination revision repair is explicit, bound to same stable entry and pins approved revision against later edits',async()=>{
 const selection={directoryId:id,revision:1,displayName:'Hospital',localCode:'001'};
 const source={reportId:id,signerId:'author',amendmentSequence:0,amendments:[],groups:[],occurrences:[
  {id:'a',element_id:'eDisposition.01',value_kind:'text',value_text:'Hospital',provenance_detail:{destinationSelection:selection}},
  {id:'b',element_id:'eDisposition.02',value_kind:'text',value_text:'001'},
  {id:'d',element_id:'eTimes.03',value_kind:'datetime',value_datetime:'2026-10-27T12:00:00Z'}]};
 let currentRevision=2;
 const manager={query:async sql=>{
  if(sql.includes('from clinical.report'))return [{organization_id:'agency',group_id:'group',cos_unit_id:'unit',created_at:'2026-10-27T11:00:00Z'}];
  if(sql.includes('from app_identity.app_user'))return [{userId:'author',hsaId:'AUTHOR',revision:3,source:'manual',conflict:false}];
  if(sql.includes('from app_identity.operational_unit'))return [{id:'unit',rakelId:'001',revision:2}];
  if(sql.includes('destination_revision'))return [{...entry,displayName:'Hospital',localCode:'001',hsaId:null,revision:1}];
  if(sql.includes('destination_directory'))return [{...entry,displayName:'Renamed',localCode:'001',hsaId:'CORRECTED',revision:currentRevision}];return [];
 }};
 const settings={};
 const absent=await resolveCosExportContext(manager,{...source,occurrences:[]},settings);
 assert.equal(absent.settings.destinationHsaId,null);assert.ok(!absent.missing.includes('destination'));
 const explicitNone=await resolveCosExportContext(manager,{...source,occurrences:['eDisposition.01','eDisposition.02'].map(element_id=>({
  id:element_id,element_id,value_kind:'null',not_value_code:'7701001',absence_code:'7701001',
 }))},settings);
 assert.equal(explicitNone.settings.destinationHsaId,null);
 assert.ok(!explicitNone.missing.includes('destination'));
 assert.equal(explicitNone.context.destination,null);
 const malformed=await resolveCosExportContext(manager,{...source,occurrences:[{id:'bad',element_id:'eDisposition.01',value_kind:'null',provenance_detail:{destinationSelection:{directoryId:'invalid'}}}]},settings);
 assert.ok(malformed.missing.includes('destination'));
 const initial=await resolveCosExportContext(manager,source,settings);
 assert.equal(initial.context.startedAt,'2026-10-27T11:00:00.000Z','record start comes from metadata independently of clinical dispatch time');
 assert.ok(initial.missing.includes('destinationStale'));assert.equal(initial.context.destination.hsaId,null);
 const repaired=await resolveCosExportContext(manager,source,settings,{acceptDestinationRevision:true,expectedDestinationRevision:2});
 assert.equal(repaired.missing.includes('destinationStale'),false);assert.equal(repaired.context.destination.revision,2);
 assert.deepEqual(repaired.context.signedDestinationSelection,selection);
 assert.equal(repaired.settings.destinationHsaId,'CORRECTED');
 const unselected=await resolveCosExportContext(manager,{...source,occurrences:source.occurrences.map(row=>({...row,provenance_detail:null}))},settings);
 assert.ok(unselected.missing.includes('destination'));assert.equal(unselected.settings.destinationHsaId,null,'matching signed strings never infer a directory association');
 currentRevision=3;
 const raced=await resolveCosExportContext(manager,source,settings,{acceptDestinationRevision:true,expectedDestinationRevision:2});
 assert.ok(raced.missing.includes('destinationStale'));assert.equal(raced.context.destination.revision,1);
});

test('pre-signing COS resolves the call unit while signed versions retain their immutable pin',async()=>{
 for(const [status,pinned,assigned,expected] of [
  ['draft',null,['actual'],'actual'],['draft','old',['actual'],'actual'],
  ['draft',null,[],null],['draft',null,['a','b'],null],
  ['signed',null,['actual'],null],['signed','pinned',['other'],'pinned'],
 ]){
  const queries=[];
  const manager={query:async(sql,args)=>{
   queries.push({sql,args});
   if(sql.includes('from clinical.report'))return [{organization_id:'agency',group_id:'group',status,cos_unit_id:pinned,created_at:'2026-10-30T10:00:00Z'}];
   if(sql.includes('from clinical.call_assignment')){assert.deepEqual(args,['agency',id]);return assigned.map(unit_id=>({unit_id}));}
   if(sql.includes('from app_identity.operational_unit')){assert.deepEqual(args,['agency',expected]);return [{id:args[1],rakelId:'123-223',revision:1}];}
   return [];
  }};
  const result=await resolveCosExportContext(manager,{reportId:id,signerId:'author',amendmentSequence:0,amendments:[],groups:[],occurrences:[]},{});
  assert.equal(result.context.unit?.id??null,expected);
  assert.equal(result.missing.includes('rakel'),expected===null);
  if(status==='signed')assert.equal(queries.some(q=>q.sql.includes('from clinical.call_assignment')),false);
 }
});
