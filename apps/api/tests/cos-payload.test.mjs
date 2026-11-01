import {PersistentCosSimulator} from '../dist/hospital/cos-simulator.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {signedPdfFixture} from './fixtures/signed-pdf-source.mjs';
import {buildCosPayload,cosIdentifierRequirements,COS_SIMULATOR_LIMITS,resolveSignedCosCareUnit} from '../dist/hospital/cos-payload.js';
import {COS_PROFILE,cosMappingPackage} from '../dist/hospital/cos-configuration.js';
import {makePackage} from '../dist/admin/canonical-package.js';
export function deliveryFixture(){
 const {source}=signedPdfFixture();source.amendments=[];source.amendmentSequence=0;
 const add=(id,value,kind='text')=>source.occurrences.push({id,element_id:id,value_kind:kind,[kind==='text'?'value_text':'code']:value});
 add('ePatient.01','200207252388');add('ePatient.05','200207262387');add('eNarrative.01','Fictional clinical assessment.');add('eDisposition.01','Fictional hospital');add('eDisposition.02','ED');
 add('eDisposition.27','4227001','coded');add('eDisposition.28','4228001','coded');add('eDisposition.30','4230001','coded');
 for(const id of ['ePatient.01','ePatient.05','eNarrative.01'])source.configuration.catalogFields[id]={generation:{base:'string',definition:{valueSource:{kind:'scalar'}}}};
 source.configuration.definition.sections=[{key:'data',fields:['ePatient.01','ePatient.05','eNarrative.01'].map(id=>({key:id,source:{kind:'nemsis',elementId:id}}))}];
 const mapping=makePackage({kind:'hospital-mapping',name:'fixture',version:'1',catalog:{sha256:'a'.repeat(64)},definition:{schemaVersion:2,id:'fixture',revision:1,authoredAt:'2026-10-19T00:00:00Z',author:source.signerId,profile:COS_PROFILE,patientIdentifier:{field:{kind:'nemsis',elementId:'ePatient.01'},namespace:'urn:oid:1.2.752.129.2.1.3.1',aliases:[]},pdfLinkId:'371530004',clinicalMappings:[{id:'clinical',source:{kind:'nemsis',elementId:'eNarrative.01'},linkId:'404684003',answerType:'string'}]}});
 const settings={mode:'simulator',authentication:'api-key',template:'urn:fictional:template',encounterNamespace:'urn:fictional:encounter',organizationHsaId:'fixture-org',defaultAmbulanceCareUnit:'fixture-ambulance',authorHsaId:'fixture-staff',destinationHsaId:'fixture-ed'};
 return {source,mapping,settings,pdf:Buffer.from('%PDF-fictional-test')};
}
test('COS collection projects exact configured fields and one matching PDF URI reproducibly',()=>{
 const {source,mapping,settings,pdf}=deliveryFixture();const result=buildCosPayload(source,mapping,settings,pdf,'delivery');
 assert.equal(result.bundle.type,'collection');const qr=result.bundle.entry[0].resource;
 assert.equal(qr.resourceType,'QuestionnaireResponse');assert.equal(qr.subject.identifier.value,'200207252388');
 assert.deepEqual(qr.item[0],{linkId:'404684003',answer:[{valueString:'Fictional clinical assessment.'}]});
 assert.match(qr.item[1].answer[0].valueUri,new RegExp(result.pdfSha256));assert.equal(result.contact.careUnit,'fixture-ed');
 assert.deepEqual(buildCosPayload(source,mapping,settings,pdf,'delivery'),result);
 const {format,schemaVersion,sha256,...portable}=mapping;
 const next=makePackage({...portable,version:'2',definition:{...mapping.definition,revision:2,patientIdentifier:{...mapping.definition.patientIdentifier,field:{kind:'nemsis',elementId:'ePatient.05'}}}});
 assert.equal(buildCosPayload(source,next,settings,pdf,'other').contact.patient.value,'200207262387');
 assert.deepEqual(buildCosPayload(source,mapping,settings,pdf,'delivery'),result,'later mappings do not mutate recorded inputs');
});
test('inline COS export uses the same signed artifact and includes base64 expansion in bundle limits',()=>{
 const f=deliveryFixture();f.settings.mode='live';f.settings.live={versionMarkerLinkId:'12345'};
 const run=()=>buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'delivery');
 const payload=run(),uri=payload.bundle.entry[0].resource.item.at(-1).answer[0].valueUri;
 assert.match(uri,/^data:application\/pdf;base64,/);
 assert.deepEqual(Buffer.from(uri.split(',')[1],'base64'),payload.pdf);
 assert.equal(payload.pdfSha256,buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'delivery').pdfSha256);
 assert.deepEqual(run(),payload,'retry encoding is deterministic');
 f.pdf=Buffer.alloc(Math.ceil(COS_SIMULATOR_LIMITS.bundleBytes*0.76),32);f.pdf.write('%PDF-1.7');
 assert.throws(run,{code:'simulatorLimit',state:'failed'});
 delete f.settings.live;assert.throws(run,{code:'liveUnverified'});
});
test('dispositions never exclude delivery, required identifiers still block, qualifiers never become asserted text',()=>{
 for(const code of ['4227003','4227005','4227007','4227009','4227011']){const f=deliveryFixture();f.source.occurrences.find(x=>x.element_id==='eDisposition.27').code=code;assert.ok(buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'id'));}
 for(const field of ['ePatient.01','eDisposition.01']){const f=deliveryFixture();f.source.occurrences=f.source.occurrences.filter(x=>x.element_id!==field);assert.throws(()=>buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'id'));}
 const f=deliveryFixture();f.settings.destinationHsaId=null;assert.throws(()=>buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'id'),{code:'careUnit'});
 f.settings=deliveryFixture().settings;f.source.occurrences.find(x=>x.element_id==='eNarrative.01').pertinent_negative_code='8801005';assert.ok(buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'id').findings.some(finding=>finding.code==='clinicalValue'));
});
test('current mapping validates its hash and missing PDF mapping becomes a delivery finding',()=>{
 const f=deliveryFixture(),{format,schemaVersion,sha256,...portable}=f.mapping;const definition={...portable.definition};delete definition.pdfLinkId;
 const old=makePackage({...portable,definition});assert.deepEqual(cosMappingPackage(old),old);
 assert.throws(()=>buildCosPayload(f.source,old,f.settings,f.pdf,'id'),{code:'pdfMapping'});
 assert.throws(()=>cosMappingPackage(makePackage({...portable,definition:{...definition,pdfLinkId:'guessed'}})));
});

test('simulator bounds reject source size, repeated item amplification and escaped serialized bytes without truncation',()=>{
 const run=f=>buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'id');
 const source=deliveryFixture();source.source.occurrences.find(x=>x.element_id==='eNarrative.01').value_text='x'.repeat(COS_SIMULATOR_LIMITS.textBytes+1);assert.throws(()=>run(source),{code:'simulatorLimit',state:'failed'});
 const repeated=deliveryFixture(),row=repeated.source.occurrences.find(x=>x.element_id==='eNarrative.01');repeated.source.occurrences.push(...Array.from({length:COS_SIMULATOR_LIMITS.items},(_,i)=>({...row,id:`row-${i}`})));assert.throws(()=>run(repeated),{code:'simulatorLimit'});
 const escaped=deliveryFixture();escaped.source.occurrences.find(x=>x.element_id==='eNarrative.01').value_text='\u0001'.repeat(COS_SIMULATOR_LIMITS.textBytes/2);assert.throws(()=>run(escaped),{code:'simulatorLimit'});
 const amplified=deliveryFixture();amplified.source.occurrences.find(x=>x.element_id==='eNarrative.01').value_text='x'.repeat(10000);const {format,schemaVersion,sha256,...portable}=amplified.mapping;amplified.mapping=makePackage({...portable,definition:{...portable.definition,clinicalMappings:Array.from({length:110},(_,i)=>({id:`mapped-${i}`,source:{kind:'nemsis',elementId:'eNarrative.01'},linkId:String(400000+i),answerType:'string'}))}});assert.throws(()=>run(amplified),{code:'simulatorLimit'});
 const many=deliveryFixture();many.source.occurrences=Array.from({length:COS_SIMULATOR_LIMITS.sourceOccurrences+1},(_,i)=>({...row,id:`row-${i}`}));assert.throws(()=>run(many),{code:'simulatorLimit'});
});

test('amendment projections use effective identifiers, narrative, signer and timestamp while retaining base source',()=>{
 const f=deliveryFixture(),original=f.source.occurrences.find(x=>x.element_id==='eNarrative.01'),patient=f.source.occurrences.find(x=>x.element_id==='ePatient.01');
 const author='amending-clinician',signedAt='2026-10-19T15:00:00Z';
 f.settings.authorHsaId='amendment-staff';
 f.source.amendmentSequence=1;f.source.amendments=[{id:'amendment',sequence:1,authorId:author,signedAt,reason:'Correction',canonicalSha256:'a'.repeat(64),changes:[{action:'replace',targetId:original.id,original,corrected:{...original,value_text:'Corrected clinical account'}},{action:'replace',targetId:patient.id,original:patient,corrected:{...patient,value_text:'200207272386'}}]}];
 const payload=buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'amended');const qr=payload.bundle.entry[0].resource;
 assert.equal(payload.amendmentSequence,1);assert.equal(qr.subject.identifier.value,'200207272386');assert.equal(qr.item[0].answer[0].valueString,'Corrected clinical account');assert.equal(qr.author.identifier.value,'amendment-staff');assert.equal(qr.authored,signedAt);
 assert.equal(patient.value_text,'200207252388');assert.equal(original.value_text,'Fictional clinical assessment.');
 f.settings.authorHsaId=null;assert.throws(()=>buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'amended'),{code:'staff'});
});


test('simulator rejects changed contact identity without its recorded digest before storage',async()=>{
 const f=deliveryFixture(),payload=buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'delivery');
 payload.contact.patient.value='tampered';
 const receiver=new PersistentCosSimulator({transaction:()=>{throw new Error('must not reach storage');}});
 await assert.rejects(receiver.contact('report',payload),{code:'identityConflict'});
 await assert.rejects(receiver.note('report','delivery',payload),{code:'identityConflict'});
});

test('all identifier requirements are collected without patient values, including ambiguous patient and encounter namespace',()=>{
 const f=deliveryFixture();f.source.occurrences=f.source.occurrences.filter(row=>row.element_id!=='ePatient.01');
 f.settings.authorHsaId=null;f.settings.destinationHsaId=null;f.settings.organizationHsaId='';f.settings.encounterNamespace='';
 const found=cosIdentifierRequirements(f.source,f.mapping,f.settings);
 assert.deepEqual(found.missing,['patientIdentifier','staff','careUnit','organization','encounter']);
 assert.equal(found.patientField.id,'ePatient.01');assert.doesNotMatch(JSON.stringify(found),/200207252388|Fictional hospital/);
 const duplicate=deliveryFixture();duplicate.source.occurrences.push({...duplicate.source.occurrences.find(row=>row.element_id==='ePatient.01'),id:'duplicate-patient'});
 assert.deepEqual(cosIdentifierRequirements(duplicate.source,duplicate.mapping,duplicate.settings).missing,['patientIdentifier']);
});

test('Review and payload evaluate amendment additions and removals exactly once',()=>{
 const f=deliveryFixture(),patient=f.source.occurrences.find(row=>row.element_id==='ePatient.01');
 f.source.amendmentSequence=1;f.source.amendments=[{id:'amendment',sequence:1,authorId:f.source.signerId,signedAt:f.source.signedAt,reason:'Correction',canonicalSha256:'a'.repeat(64),changes:[
  {action:'remove',targetId:patient.id,original:patient},
  {action:'add',corrected:{...patient,id:'new-patient-occurrence',value_text:'200207272386'}}]}];
 assert.deepEqual(cosIdentifierRequirements(f.source,f.mapping,f.settings).missing,[]);
 assert.equal(buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'amended').contact.patient.value,'200207272386');
 assert.equal(patient.value_text,'200207252388');
});

test('unavailable configured patient field retains exact canonical identity for protected troubleshooting',()=>{
 const f=deliveryFixture();f.source.configuration.definition.sections[0].fields=f.source.configuration.definition.sections[0].fields.filter(row=>row.source.elementId!=='ePatient.01');
 const result=cosIdentifierRequirements(f.source,f.mapping,f.settings);
 assert.deepEqual(result.missing,['configuration']);assert.deepEqual(result.patientField.field,{kind:'nemsis',elementId:'ePatient.01'});
 assert.equal(result.patientField.id,'ePatient.01');assert.equal(result.patientField.name,'ePatient.01');
});

test('destination routing is independent of disposition and preserves exact documented codes',()=>{
 for(const care of ['4228001','4228003','4228005','4228007','4228009'])for(const transport of ['4230009','4230013']){
  const f=deliveryFixture();
  f.source.occurrences.find(row=>row.element_id==='eDisposition.28').code=care;
  f.source.occurrences.find(row=>row.element_id==='eDisposition.30').code=transport;
  const result=buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'id');
  assert.equal(result.contact.careUnit,'fixture-ed','explicit destination identity determines the recipient');
  assert.deepEqual(result.contact.disposition,{unit:'4227001',care,transport});
  f.source.occurrences=f.source.occurrences.filter(row=>!['eDisposition.01','eDisposition.02'].includes(row.element_id));
  assert.deepEqual(cosIdentifierRequirements(f.source,f.mapping,f.settings).missing,[]);
  f.settings.defaultAmbulanceCareUnit='';
  assert.deepEqual(cosIdentifierRequirements(f.source,f.mapping,f.settings).missing,['ambulanceCareUnit']);
  assert.throws(()=>buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'id'),{code:'ambulanceCareUnit',state:'waiting'});
 }
 for(const transport of ['4230011','unknown',null]){
  const f=deliveryFixture();f.source.occurrences.find(row=>row.element_id==='eDisposition.30').code=transport;
  assert.ok(buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'id'));
 }
 const duplicate=deliveryFixture();duplicate.source.occurrences.push({...duplicate.source.occurrences.find(row=>row.element_id==='eDisposition.30'),id:'duplicate-transport',code:'4230013'});
 assert.ok(buildCosPayload(duplicate.source,duplicate.mapping,duplicate.settings,duplicate.pdf,'id'));
});

test('collector and payload share exact PNR, coordination and Carelink reserve scheme validation',()=>{
 for(const [namespace,value] of [['urn:oid:1.2.752.129.2.1.3.1','200207252388'],['urn:oid:1.2.752.129.2.1.3.3','200207852385'],['urn:oid:1.2.752.129.2.1.3.2','198108320014']]){
  const f=deliveryFixture(),{format,schemaVersion,sha256,...portable}=f.mapping;
  f.mapping=makePackage({...portable,definition:{...portable.definition,patientIdentifier:{...portable.definition.patientIdentifier,namespace}}});
  f.source.occurrences.find(row=>row.element_id==='ePatient.01').value_text=value;
  assert.deepEqual(cosIdentifierRequirements(f.source,f.mapping,f.settings).missing,[]);
  assert.deepEqual(buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'delivery').contact.patient,{system:namespace,value});
  f.source.occurrences.find(row=>row.element_id==='ePatient.01').value_text='200207252389';
  assert.ok(cosIdentifierRequirements(f.source,f.mapping,f.settings).missing.includes('patientIdentifier'));
  assert.throws(()=>buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'delivery'),{code:'patientIdentifier'});
 }
});


test('raw signed recipient resolver projects destination removal/addition amendments exactly once',()=>{
 const f=deliveryFixture(),destination=f.source.occurrences.filter(row=>['eDisposition.01','eDisposition.02'].includes(row.element_id));
 assert.equal(resolveSignedCosCareUnit(f.source,f.settings),'fixture-ed');
 const amendment={id:'amendment',sequence:1,authorId:f.source.signerId,signedAt:f.source.signedAt,reason:'Correction',canonicalSha256:'a'.repeat(64),
  changes:destination.map(row=>({action:'remove',targetId:row.id,original:row,corrected:null}))};
 f.source.amendments=[amendment];f.source.amendmentSequence=1;
 assert.equal(resolveSignedCosCareUnit(f.source,f.settings),'fixture-ambulance');
 assert.equal(buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'amended').contact.careUnit,'fixture-ambulance','internal projected source must not apply removals twice');
 f.source.amendments.push({...amendment,id:'amendment-2',sequence:2,changes:destination.map(row=>({action:'add',targetId:null,original:null,corrected:{...row,id:`restored-${row.id}`}}))});
 f.source.amendmentSequence=2;
 assert.equal(resolveSignedCosCareUnit(f.source,f.settings),'fixture-ed');
 assert.equal(buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'amended-again').contact.careUnit,'fixture-ed');
});

test('missing PDF link mapping is actionable in Review before payload preparation',()=>{
 const f=deliveryFixture(),{format,schemaVersion,sha256,...portable}=f.mapping;
 const {pdfLinkId,...definition}=portable.definition;
 const mapping=makePackage({...portable,definition});
 assert.deepEqual(cosIdentifierRequirements(f.source,mapping,f.settings).missing,['pdfMapping']);
 assert.throws(()=>buildCosPayload(f.source,mapping,f.settings,f.pdf,'waiting-pdf-mapping'),{code:'pdfMapping',state:'waiting'});
});

function withVitals(){
 const f=deliveryFixture(),{format,schemaVersion,sha256,...portable}=f.mapping;
 const specs=[['heartRate','eVitals.10','364075005','/min'],['respiratoryRate','eVitals.14','86290005','/min'],['bodyTemperature','eVitals.24','276885007','Cel']];
 for(const [,id] of specs){
  f.source.configuration.catalogFields[id]={generation:{base:'decimal',definition:{valueSource:{kind:'scalar'}}}};
  f.source.configuration.definition.sections[0].fields.push({source:{kind:'nemsis',elementId:id}});
 }
 f.source.occurrences.push({id:'rr',element_id:'eVitals.14',group_instance_id:'vital-0',value_kind:'integer',value_integer:16});
 f.source.occurrences.push({id:'temp',element_id:'eVitals.24',group_instance_id:'vital-0',value_kind:'numeric',value_numeric:'36.7'});
 f.mapping=makePackage({...portable,definition:{...portable.definition,vitalMappings:specs.map(([vital,elementId,linkId,unit])=>({id:vital,vital,source:{kind:'nemsis',elementId},linkId,unit}))}});
 return f;
}
test('v2 vital answers resolve to same-Bundle observations with pinned units and measurement times',()=>{
 const f=withVitals();const result=buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'delivery');
 const qr=result.bundle.entry[0].resource;
 const references=qr.item.flatMap(i=>i.answer).filter(a=>a.valueReference).map(a=>a.valueReference.reference);
 assert.equal(references.length,14);assert.equal(new Set(references).size,14);
 for(const reference of references){
  const matches=result.bundle.entry.filter(e=>e.fullUrl===reference);assert.equal(matches.length,1);
  const observation=matches[0].resource;
  assert.equal(observation.resourceType,'Observation');assert.deepEqual(observation.subject,qr.subject);
  assert.deepEqual(observation.encounter,qr.encounter);assert.equal(observation.valueQuantity.system,'http://unitsofmeasure.org');
 }
 const hr=qr.item.find(i=>i.linkId==='364075005');assert.equal(hr.answer.length,12);
 const first=result.bundle.entry.find(e=>e.fullUrl===hr.answer[0].valueReference.reference).resource;
 assert.equal(first.effectiveDateTime,'2026-10-19T10:00:00Z');assert.equal(first.valueQuantity.value,88);
 assert.deepEqual(first.code.coding,[{system:'http://loinc.org',code:'8867-4'},{system:'http://snomed.info/sct',code:'364075005'}]);
 const temp=result.bundle.entry.find(e=>e.resource.meta.profile[0].includes('BodyTemperature')).resource;
 assert.equal(temp.valueQuantity.value,36.7);assert.equal(temp.valueQuantity.code,'Cel');
 assert.deepEqual(buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'delivery'),result);
 assert.equal(result.bundle.entry[0].resource.item.at(-1).answer[0].valueUri.includes(result.pdfSha256),true);
});
test('vital projection applies signed corrections once and does not mutate the original readings',()=>{
 const f=withVitals(),original=f.source.occurrences.find(row=>row.id==='pulse-0');
 f.source.amendmentSequence=1;f.source.amendments=[{id:'correction',sequence:1,authorId:f.source.signerId,signedAt:f.source.signedAt,changes:[{action:'replace',targetId:original.id,original,corrected:{...original,value_integer:77}}]}];
 const result=buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'amended');
 const ref=result.bundle.entry[0].resource.item.find(i=>i.linkId==='364075005').answer[0].valueReference.reference;
 assert.equal(result.bundle.entry.find(e=>e.fullUrl===ref).resource.valueQuantity.value,77);
 assert.equal(original.value_integer,88);
});
test('vitals reject missing/ambiguous times, nonnumeric values, and clinical qualifiers',()=>{
 for(const changes of [{value_integer:null},{value_integer:''},{value_integer:true},{value_integer:Infinity},{value_integer:1.5},{not_value_code:'7701003'},{pertinent_negative_code:'8801005'},{group_instance_id:'missing'}]){
  const f=withVitals();Object.assign(f.source.occurrences.find(r=>r.id==='pulse-0'),changes);
  assert.ok(buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'delivery').findings.some(finding=>finding.coverage==='partial'));
 }
 for(const time of [null,'2026-10-19','not a time','2026-10-19T10:00:00','2026-02-30T10:00:00Z']){
  const f=withVitals();f.source.groups[0].documented_time=time;
  assert.ok(buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'delivery').findings.some(finding=>finding.coverage==='partial'));
 }
 const f=withVitals();f.source.groups.push({...f.source.groups[0]});
 assert.ok(buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'delivery').findings.some(finding=>finding.coverage==='partial'));
});
test('vital-only mappings export and share payload amplification limits; live mode remains blocked',()=>{
 const f=withVitals(),{format,schemaVersion,sha256,...portable}=f.mapping;
 f.mapping=makePackage({...portable,definition:{...portable.definition,clinicalMappings:[]}});
 assert.equal(buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'delivery').bundle.entry.length,15);
 const row=f.source.occurrences.find(r=>r.id==='pulse-0');
 f.source.occurrences.push(...Array.from({length:COS_SIMULATOR_LIMITS.items},(_,i)=>({...row,id:`extra-${i}`})));
 assert.throws(()=>buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'delivery'),{code:'simulatorLimit'});
 f.settings.mode='live';assert.throws(()=>buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'delivery'),{code:'liveUnverified'});
});

test('subscription PUT includes Bundle identity and resource update metadata pinned to signing',()=>{
 const f=withVitals();
 for(const amended of [false,true]){
  if(amended){f.source.amendmentSequence=1;f.source.amendments=[{id:'amendment',sequence:1,authorId:f.source.signerId,signedAt:'2026-10-23T12:05:00Z',changes:[]}];}
  const payload=buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'delivery');
  const timestamp=amended?f.source.amendments[0].signedAt:f.source.signedAt;
  assert.equal(payload.bundle.id,'delivery');assert.equal(payload.bundle.meta.lastUpdated,timestamp);
  for(const entry of payload.bundle.entry)assert.equal(entry.resource.meta.lastUpdated,timestamp);
  const observation=payload.bundle.entry[1].resource;
  assert.equal(observation.effectiveDateTime,'2026-10-19T10:00:00Z','measurement time remains distinct from update time');
  assert.deepEqual(buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'delivery'),payload,'retries cannot invent new timestamps');
 }
});

test('missing or contradictory disposition data never gates export; absent destination uses ambulance unit',()=>{
 const f=deliveryFixture();
 f.source.occurrences=f.source.occurrences.filter(row=>!row.element_id.startsWith('eDisposition.'));
 f.settings.destinationHsaId=null;
 assert.deepEqual(cosIdentifierRequirements(f.source,f.mapping,f.settings).missing,[]);
 assert.equal(buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'id').contact.careUnit,'fixture-ambulance');
 f.source.occurrences.push({id:'partial',element_id:'eDisposition.01',value_kind:'text',value_text:'Unresolved destination'});
 assert.throws(()=>buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'id'),{code:'destination'});
});

test('COS resolves a valid coordination number under a personal-number default without changing signed data',()=>{
 const f=deliveryFixture();
 f.source.occurrences.find(row=>row.element_id==='ePatient.01').value_text='201304822172';
 const original=structuredClone(f.source);
 assert.deepEqual(cosIdentifierRequirements(f.source,f.mapping,f.settings).missing,[]);
 const payload=buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'coordination');
 assert.deepEqual(payload.contact.patient,{system:'urn:oid:1.2.752.129.2.1.3.3',value:'201304822172'});
 assert.deepEqual(payload.bundle.entry[0].resource.subject.identifier,payload.contact.patient);
 assert.deepEqual(f.source,original);
});
