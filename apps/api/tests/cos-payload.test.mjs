import test from 'node:test';
import assert from 'node:assert/strict';
import {signedPdfFixture} from './fixtures/signed-pdf-source.mjs';
import {buildCosPayload,cosIdentifierRequirements,cosEligibility,COS_SIMULATOR_LIMITS} from '../dist/hospital/cos-payload.js';
import {COS_PROFILE,cosMappingPackage} from '../dist/hospital/cos-configuration.js';
import {makePackage} from '../dist/admin/canonical-package.js';
export function deliveryFixture(){
 const {source}=signedPdfFixture();source.amendments=[];source.amendmentSequence=0;
 const add=(id,value,kind='text')=>source.occurrences.push({id,element_id:id,value_kind:kind,[kind==='text'?'value_text':'code']:value});
 add('ePatient.01','200207252388');add('ePatient.05','alternate-identifier');add('eNarrative.01','Fictional clinical assessment.');add('eDisposition.01','Fictional hospital');add('eDisposition.02','ED');
 add('eDisposition.27','4227001','coded');add('eDisposition.28','4228001','coded');add('eDisposition.30','4230001','coded');
 for(const id of ['ePatient.01','ePatient.05','eNarrative.01'])source.configuration.catalogFields[id]={generation:{base:'string',definition:{valueSource:{kind:'scalar'}}}};
 source.configuration.definition.sections=[{key:'data',fields:['ePatient.01','ePatient.05','eNarrative.01'].map(id=>({key:id,source:{kind:'nemsis',elementId:id}}))}];
 const mapping=makePackage({kind:'hospital-mapping',name:'fixture',version:'1',catalog:{sha256:'a'.repeat(64)},definition:{schemaVersion:1,id:'fixture',revision:1,authoredAt:'2026-10-19T00:00:00Z',author:source.signerId,profile:COS_PROFILE,patientIdentifier:{field:{kind:'nemsis',elementId:'ePatient.01'},namespace:'urn:oid:1.2.752.129.2.1.3.1',aliases:[]},pdfLinkId:'371530004',clinicalMappings:[{id:'clinical',source:{kind:'nemsis',elementId:'eNarrative.01'},linkId:'404684003',answerType:'string'}]}});
 const settings={mode:'simulator',authentication:'api-key',template:'urn:fictional:template',encounterNamespace:'urn:fictional:encounter',organizationHsaId:'fixture-org',defaultAmbulanceCareUnit:'fixture-ambulance',staff:[{userId:source.signerId,hsaId:'fixture-staff'}],careUnits:[{hospital:'Fictional hospital',localCareUnit:'ED',hsaId:'fixture-ed'}]};
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
 assert.equal(buildCosPayload(source,next,settings,pdf,'other').contact.patient.value,'alternate-identifier');
 assert.deepEqual(buildCosPayload(source,mapping,settings,pdf,'delivery'),result,'later mappings do not mutate recorded inputs');
});
test('no-contact dispositions exclude, unknown/missing mappings wait, qualifiers never become asserted text',()=>{
 for(const code of ['4227003','4227005','4227007','4227009','4227011']){const f=deliveryFixture();f.source.occurrences.find(x=>x.element_id==='eDisposition.27').code=code;assert.equal(cosEligibility(f.source.occurrences),'excluded');assert.throws(()=>buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'id'),{code:'noContact',state:'excluded'});}
 for(const field of ['ePatient.01','eDisposition.01','eDisposition.30']){const f=deliveryFixture();f.source.occurrences=f.source.occurrences.filter(x=>x.element_id!==field);assert.throws(()=>buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'id'));}
 const f=deliveryFixture();f.settings.careUnits=[];assert.throws(()=>buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'id'),{code:'careUnit'});
 f.settings=deliveryFixture().settings;f.source.occurrences.find(x=>x.element_id==='eNarrative.01').pertinent_negative_code='8801005';assert.throws(()=>buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'id'),{code:'clinicalValue'});
});
test('legacy mapping retains hash and optional PDF mapping absence becomes delivery finding',()=>{
 const f=deliveryFixture(),{format,schemaVersion,sha256,...portable}=f.mapping;const definition={...portable.definition};delete definition.pdfLinkId;
 const old=makePackage({...portable,definition});assert.deepEqual(cosMappingPackage(old),old);
 assert.throws(()=>buildCosPayload(f.source,old,f.settings,f.pdf,'id'),{code:'pdfMapping'});
 assert.throws(()=>cosMappingPackage(makePackage({...portable,definition:{...definition,pdfLinkId:'guessed'}})));
});

test('simulator bounds reject source size, repeated item amplification and escaped serialized bytes without truncation',()=>{
 const run=f=>buildCosPayload(f.source,f.mapping,f.settings,f.pdf,'id');
 const source=deliveryFixture();source.source.occurrences.find(x=>x.element_id==='eNarrative.01').value_text='x'.repeat(COS_SIMULATOR_LIMITS.textBytes+1);assert.throws(()=>run(source),{code:'simulatorLimit',state:'failed'});
 const repeated=deliveryFixture(),row=repeated.source.occurrences.find(x=>x.element_id==='eNarrative.01');repeated.source.occurrences.push(...Array.from({length:COS_SIMULATOR_LIMITS.items},()=>({...row})));assert.throws(()=>run(repeated),{code:'simulatorLimit'});
 const escaped=deliveryFixture();escaped.source.occurrences.find(x=>x.element_id==='eNarrative.01').value_text='\u0001'.repeat(COS_SIMULATOR_LIMITS.textBytes/2);assert.throws(()=>run(escaped),{code:'simulatorLimit'});
 const amplified=deliveryFixture();amplified.source.occurrences.find(x=>x.element_id==='eNarrative.01').value_text='x'.repeat(10000);const {format,schemaVersion,sha256,...portable}=amplified.mapping;amplified.mapping=makePackage({...portable,definition:{...portable.definition,clinicalMappings:Array.from({length:110},(_,i)=>({id:`mapped-${i}`,source:{kind:'nemsis',elementId:'eNarrative.01'},linkId:String(400000+i),answerType:'string'}))}});assert.throws(()=>run(amplified),{code:'simulatorLimit'});
 const many=deliveryFixture();many.source.occurrences=Array.from({length:COS_SIMULATOR_LIMITS.sourceOccurrences+1},()=>({...row}));assert.throws(()=>run(many),{code:'simulatorLimit'});
});

test('all identifier requirements are collected without patient values, including ambiguous patient and encounter namespace',()=>{
 const f=deliveryFixture();f.source.occurrences=f.source.occurrences.filter(row=>row.element_id!=='ePatient.01');
 f.settings.staff=[];f.settings.careUnits=[];f.settings.organizationHsaId='';f.settings.encounterNamespace='';
 const found=cosIdentifierRequirements(f.source,f.mapping,f.settings);
 assert.deepEqual(found.missing,['patientIdentifier','staff','careUnit','organization','encounter']);
 assert.equal(found.patientField.id,'ePatient.01');assert.doesNotMatch(JSON.stringify(found),/200207252388|Fictional hospital/);
 const duplicate=deliveryFixture();duplicate.source.occurrences.push({...duplicate.source.occurrences.find(row=>row.element_id==='ePatient.01')});
 assert.deepEqual(cosIdentifierRequirements(duplicate.source,duplicate.mapping,duplicate.settings).missing,['patientIdentifier']);
});
