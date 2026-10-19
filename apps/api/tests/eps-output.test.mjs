import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {buildEpsOutput,EPS_DEPENDENCIES} from '../dist/hospital/eps-output.js';
import {outputMappings} from '../dist/hospital/eps-output-mapping.js';
import {makePackage,mappingPackage,compileMapping} from '../dist/hospital/hospital-mapping.js';
import {receiverEpsValidation} from '../dist/hospital/eps-validation.js';
const field=elementId=>({kind:'nemsis',elementId});
const mapping=()=>makePackage({kind:'hospital-mapping',name:'EPS-output',version:'1',catalog:{sha256:'a'.repeat(64)},definition:{schemaVersion:1,id:'output',revision:1,author:'test',authoredAt:'2026-10-19T00:00:00Z',profile:{package:'hl7.fhir.eu.eps',version:'1.0.0-ballot',fhirVersion:'4.0.1'},patientIdentifier:{field:field('ePatient.01'),namespace:'urn:fictional:patient',aliases:[]},outputMappings:[{id:'story',source:field('eNarrative.01'),section:'patientStory',representation:'signed-narrative'}]}});
const source=()=>({reportId:randomUUID(),snapshotId:randomUUID(),revision:1,amendmentSequence:0,synthetic:true,signerId:randomUUID(),signedAt:'2026-10-19T00:00:00Z',canonicalSha256:'a'.repeat(64),catalogReleaseId:randomUUID(),formVersionId:randomUUID(),groups:[],notes:[],amendments:[],occurrences:[{id:'patient',element_id:'ePatient.01',value_kind:'text',value_text:'FICTIONAL-0001'},{id:'story',element_id:'eNarrative.01',value_kind:'text',value_text:'Confirmed history <script>unsafe()</script> & preserved.',provenance_detail:{epsImport:{mappingId:'import',mappingRevision:2,documentVersion:'3',documentSha256:'b'.repeat(64),entryId:'confirmed-entry',decision:'replace'}}}],configuration:{definition:{sections:[{fields:[{source:field('ePatient.01')},{source:field('eNarrative.01')}]}]},catalogFields:{'ePatient.01':{name:'Identifier',generation:{base:'string',definition:{valueSource:{kind:'scalar'}}}},'eNarrative.01':{name:'Narrative',generation:{base:'string',definition:{valueSource:{kind:'scalar'}}}}}}});
test('EPS output preserves effective signed amendment and confirmed provenance, escapes narrative, excludes all unimported data',()=>{
 const s=source(),p=mapping(),id=randomUUID();s.unimportedEps={secret:'UNIMPORTED incoming content'};
 let result=buildEpsOutput(s,p,id),text=JSON.stringify(result);assert.doesNotMatch(text,/UNIMPORTED/);assert.match(text,/&lt;script&gt;/);assert.match(text,/confirmed-entry/);assert.match(text,/unavailable/);assert.doesNotMatch(text,/nilknown/);assert.equal(result.bundle.entry[0].resource.section.length,6);assert.equal(result.findings.filter(row=>row.code==='missingData').length,5);
 s.amendmentSequence=1;s.amendments=[{id:randomUUID(),sequence:1,authorId:s.signerId,signedAt:'2026-10-19T01:00:00Z',canonicalSha256:'c'.repeat(64),changes:[{action:'replace',targetId:'story',original:s.occurrences[1],corrected:{...s.occurrences[1],id:'corrected',provenance_kind:'amendment',value_text:'Corrected signed history'}}]}];
 result=buildEpsOutput(s,p,id);text=JSON.stringify(result);assert.match(text,/Corrected signed history/);assert.match(text,/Amended clinical history originally imported from EPS/);assert.doesNotMatch(text,/unsafe/);assert.deepEqual(result.amendmentHashes,['c'.repeat(64)]);assert.equal(result.bundle.entry[0].resource.date,'2026-10-19T01:00:00Z');
 const changed=structuredClone(p);changed.definition.patientIdentifier.field=field('ePatient.05');const {format,schemaVersion,sha256,...portable}=changed;assert.equal(buildEpsOutput(s,makePackage(portable),id).findings[0].code,'patientIdentifier');
});
test('canonical output mappings round-trip without changing old package hashes, reject incompatible/history and unknown representations',()=>{
 const p=mapping();assert.equal(mappingPackage(JSON.parse(JSON.stringify(p))).sha256,p.sha256);compileMapping(p,source().configuration);
 assert.throws(()=>outputMappings([{...p.definition.outputMappings[0],representation:'infer-codes'}]));assert.throws(()=>outputMappings([{...p.definition.outputMappings[0],source:field('eMedications.03'),section:'medications'}],{catalogFields:{'eMedications.03':{}},definition:{sections:[]}}));assert.throws(()=>outputMappings([{...p.definition.outputMappings[0],source:field('ePatient.99')}],source().configuration));
 assert.throws(()=>outputMappings([{...p.definition.outputMappings[0],source:field('ePatient.01'),section:'allergies'}],source().configuration));const pinned=source();delete pinned.configuration.catalogFields['eNarrative.01'];assert.ok(buildEpsOutput(pinned,p,randomUUID()).findings.some(finding=>finding.code==='incompatibleMapping'&&finding.mappingId==='story'));assert.equal(EPS_DEPENDENCIES['hl7.fhir.uv.ips'],'2.0.0');
});
test('preview records pending receiver validation without Java or a network request',async()=>{
 const result=await receiverEpsValidation();
 assert.equal(result.engine,'receiver');assert.equal(result.state,'pending');assert.deepEqual(result.issues,[]);
 assert.deepEqual(result.dependencies,EPS_DEPENDENCIES);
});

function demographicFixture(){
 const s=source(),p=mapping();
 const fields={patientFamily:['ePatient.02','text','Example'],patientGiven:['ePatient.03','text','Fictional'],patientMiddle:['ePatient.04','text','Middle'],patientSuffix:['ePatient.23','text','Jr'],patientBirthDate:['ePatient.17','date','1980-02-29'],patientGender:['ePatient.25','coded','9919001']};
 for(const [section,[id,kind,value]] of Object.entries(fields)){
  s.configuration.catalogFields[id]={name:id};
  s.occurrences.push({id,element_id:id,value_kind:kind,...(kind==='coded'?{code:value,code_system:''}:kind==='date'?{value_date:value}:{value_text:value})});
  p.definition.outputMappings.push({id:section,source:field(id),section,representation:'structured-patient'});
 }
 const {format,schemaVersion,sha256,...portable}=p;
 return {s,p:makePackage(portable)};
}
test('EPS demographics populate Patient fields and never the Patient story',()=>{
 const {s,p}=demographicFixture();compileMapping(p,s.configuration);
 const output=buildEpsOutput(s,p,randomUUID());assert.equal(output.findings.some(f=>f.severity==='error'),false);
 const patient=output.bundle.entry.find(e=>e.resource.resourceType==='Patient').resource;
 assert.deepEqual(patient.name,[{family:'Example',given:['Fictional','Middle'],suffix:['Jr']}]);assert.equal(patient.birthDate,'1980-02-29');assert.equal(patient.gender,'female');assert.equal(patient._birthDate,undefined);
 const story=output.bundle.entry[0].resource.section.find(s=>s.code.coding[0].code==='81338-6');assert.match(story.text.div,/Confirmed history/);assert.doesNotMatch(story.text.div,/Example|1980|ePatient\./);
 assert.equal(mappingPackage(JSON.parse(JSON.stringify(p))).sha256,p.sha256);
});
test('demographic qualifiers remain absent and duplicates or invalid values block export',()=>{
 for(const scenario of ['qualifier','missing','duplicate','date','code','system']){
  const {s,p}=demographicFixture();const birth=s.occurrences.find(r=>r.element_id==='ePatient.17'),sex=s.occurrences.find(r=>r.element_id==='ePatient.25');
  if(scenario==='qualifier')birth.not_value_code='7701003';
  if(scenario==='missing')s.occurrences=s.occurrences.filter(r=>r!==birth);
  if(scenario==='duplicate')s.occurrences.push({...birth,id:'duplicate'});
  if(scenario==='date')birth.value_date='2025-02-29';
  if(scenario==='code')sex.code='unrecognized';
  if(scenario==='system')sex.code_system='unrelated-system';
  const output=buildEpsOutput(s,p,randomUUID());const patient=output.bundle.entry.find(e=>e.resource.resourceType==='Patient').resource;
  if(['qualifier','missing'].includes(scenario)){assert.equal(patient.birthDate,undefined);assert.ok(patient._birthDate);assert.equal(output.findings.some(f=>f.severity==='error'),false);}
  else assert.ok(output.findings.some(f=>f.code==='patientDemographic'&&f.severity==='error'),scenario);
 }
});
test('structured mappings reject duplicate targets, wrong sources and narrative representation',()=>{
 const {p,s}=demographicFixture(),m=p.definition.outputMappings.find(m=>m.section==='patientBirthDate');
 assert.throws(()=>outputMappings([m,{...m,id:'duplicate'}],s.configuration));
 assert.throws(()=>outputMappings([{...m,source:field('eNarrative.01')}],s.configuration));
 assert.throws(()=>outputMappings([{...m,representation:'signed-narrative'}],s.configuration));
});
test('structured demographics use effective signed amendments',()=>{
 const {s,p}=demographicFixture();const original=s.occurrences.find(r=>r.element_id==='ePatient.02');
 s.amendmentSequence=1;s.amendments=[{sequence:1,signedAt:s.signedAt,canonicalSha256:'c'.repeat(64),changes:[{action:'replace',targetId:original.id,corrected:{...original,id:'corrected-family',value_text:'Corrected'}}]}];
 assert.equal(buildEpsOutput(s,p,randomUUID()).bundle.entry.find(e=>e.resource.resourceType==='Patient').resource.name[0].family,'Corrected');
});

test('all narrative fields omit technical field/group prefixes while retaining values and timing',()=>{
 const s=source(),p=mapping();
 s.groups=[{id:'internal-group-uuid',group_id:'eNarrativeSection',ordinal:3,documented_time:'2026-10-19T09:30:00Z'}];
 s.occurrences[1]={...s.occurrences[1],group_instance_id:'internal-group-uuid',value_text:'Clinical narrative',provenance_detail:null};
 s.configuration.catalogFields['eHistory.09']={name:'Medical history'};
 s.occurrences.push({id:'history',element_id:'eHistory.09',group_instance_id:'internal-group-uuid',value_kind:'text',value_text:'Recorded medical history'});
 s.configuration.customFields={'custom-field-identity':{title:'Additional history',datatype:'string'}};
 s.occurrences.push({id:'custom-row',element_id:'local.history',element_identity_id:'custom-field-identity',group_instance_id:'internal-group-uuid',value_kind:'text',value_text:'Additional clinical detail'});
 p.definition.outputMappings.push({id:'history',source:field('eHistory.09'),section:'patientHistory',representation:'signed-narrative'},
 {id:'custom',source:{kind:'custom',elementDefinitionId:'custom-field-identity'},section:'patientStory',representation:'signed-narrative'});
 const {format,schemaVersion,sha256,...portable}=p;
 const result=buildEpsOutput(s,makePackage(portable),randomUUID());
 const sections=JSON.stringify(result.bundle.entry[0].resource.section);
 assert.match(sections,/Clinical narrative/);assert.match(sections,/Recorded medical history/);assert.match(sections,/Additional clinical detail/);
 assert.match(sections,/Documented: 2026-10-19T09:30:00Z/);
 assert.doesNotMatch(sections,/eNarrative\.01|eHistory\.09|custom-field-identity|eNarrativeSection|internal-group-uuid|source group|occurrence 4/);
});
