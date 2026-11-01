import test from 'node:test';
import assert from 'node:assert/strict';
import {EpsService} from '../dist/hospital/eps.service.js';
for(const mode of ['denied','missing','inactive'])test(`outgoing preview stops before reading clinical content when ${mode}`,async()=>{
 const queries=[];const manager={query:async(sql,args)=>{
  queries.push(sql);
  if(sql.includes('from clinical.report')){assert.match(sql,/documenting_user_id=\$3 and status='draft'/);assert.deepEqual(args,['report','org','user']);return mode==='missing'?[]:[{patient_id:'patient'}];}
  if(sql.includes('hospital_eps_state'))return [];
  throw Error('Unexpected clinical content read or write');
 }};
 const service=new EpsService({transaction:async(isolation,run)=>{assert.equal(isolation,'REPEATABLE READ');return run(manager);}},{requireCapability:async(token,capability)=>{assert.equal(capability,'clinical:document');if(mode==='denied')throw Error('denied');return {organization:{id:'org'},user:{id:'user'}};}});
 await assert.rejects(service.outgoing('token','report','binding'));
 assert.equal(queries.some(sql=>/element_occurrence|insert|update/i.test(sql)),false);
});
test('outgoing preview requires a current EPS binding',async()=>{
 const service=new EpsService({},{});await assert.rejects(service.outgoing('token','report',''));
});

test('outgoing preview shares export projection, preserves identity, rejects stale configuration, and never publishes',async(t)=>{
 const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);
 const {makePackage}=await import('../dist/hospital/hospital-mapping.js');
 const field=elementId=>({kind:'nemsis',elementId});
 const form={definition:{sections:[{fields:['ePatient.01','ePatient.03','eNarrative.01'].map(id=>({source:field(id)}))}]},catalogFields:Object.fromEntries(['ePatient.01','ePatient.03','eNarrative.01'].map(id=>[id,{name:id,generation:{base:'string',definition:{valueSource:{kind:'scalar'}}}}]))};
 const mapping=makePackage({kind:'hospital-mapping',name:'preview-test',version:'1',catalog:{sha256:'a'.repeat(64)},definition:{schemaVersion:1,id:'preview',revision:1,author:'test',authoredAt:'2026-10-19T00:00:00Z',profile:{package:'hl7.fhir.eu.eps',version:'1.0.0-ballot',fhirVersion:'4.0.1'},patientIdentifier:{field:field('ePatient.01'),namespace:'urn:fictional',aliases:[]},outputMappings:['ePatient.03','eNarrative.01'].map((id,index)=>({id:`map-${index}`,source:field(id),section:'patientStory',representation:'signed-narrative'}))}});
 t.mock.method(require('../dist/forms/clinical-form-configuration.js'),'clinicalFormConfiguration',async()=>form);
 t.mock.method(require('../dist/reports/encounter-document.persistence.js'),'encounterDocument',async()=>({groups:[{instances:[{elements:[{id:'ePatient.01',values:[{kind:'scalar',value:'FICTIONAL'}]}]}]}]}));
 let reads=0;
 const manager={query:async(sql,args)=>{
  if(sql.includes('from clinical.report')&&!sql.includes('insert'))return [{patient_id:'patient',revision:'3',form_version_id:'form',catalog_release_id:'catalog'}];
  if(sql.includes('hospital_eps_state'))return [{revision:'8',canonical_mapping:mapping}];
  if(sql.includes('insert into clinical_audit.patient_access_event')){assert.equal(args[4],'eps.read');assert.equal(args[6],null);return [{recorded:1}];}
  if(sql.includes('from clinical.group_instance'))return [];
  if(sql.includes('from clinical.element_occurrence')){reads++;return ['ePatient.01','ePatient.03','eNarrative.01'].map((id,index)=>({id:`row-${index}`,element_id:id,value_kind:'text',value_text:['FICTIONAL','Fictional name','Saved narrative <unsafe>'][index]})).map(value=>({value}));}
  throw Error(`Unexpected query: ${sql}`);
 }};
 const service=new EpsService({transaction:async(_,run)=>run(manager)},{requireCapability:async()=>({organization:{id:'org'},user:{id:'user'}})});
 service.adapter.discover=()=>{throw Error('No external service may be contacted');};
 const context=await service.context('token','report');const preview=await service.outgoing('token','report',context.binding);
 assert.deepEqual(preview.patientIdentifier,{system:'urn:fictional',value:'FICTIONAL'});
 const story=preview.bundle.entry[0].resource.section.find(section=>section.code.coding[0].code==='81338-6');assert.match(story.text.div,/Fictional name/);assert.match(story.text.div,/Saved narrative &lt;unsafe&gt;/);
 assert.equal(preview.revision,3);assert.equal(preview.findings.some(f=>f.severity==='error'),false);
 await assert.rejects(service.outgoing('token','report','stale'));assert.equal(reads,1);
});
