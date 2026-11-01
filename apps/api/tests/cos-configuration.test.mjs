import assert from 'node:assert/strict';
import test from 'node:test';
import {COS_PROFILE,cosMappingPackage,compileCosMapping,connectionSettings,cosFindings} from '../dist/hospital/cos-configuration.js';
import {makePackage} from '../dist/admin/canonical-package.js';
const settings={mode:'simulator',authentication:'api-key',template:'urn:template:test',encounterNamespace:'urn:encounter:test',organizationHsaId:'ORG',defaultAmbulanceCareUnit:'AMB',};
const definition={schemaVersion:2,id:'test-mapping',revision:1,authoredAt:'2026-10-19T12:00:00Z',author:'author',profile:COS_PROFILE,patientIdentifier:{field:{kind:'nemsis',elementId:'ePatient.01'},namespace:'urn:patient:test',aliases:[]},clinicalMappings:[{id:'symptom',source:{kind:'nemsis',elementId:'ePatient.05'},linkId:'404684003',answerType:'string'}]};
const pack=d=>makePackage({kind:'hospital-mapping',name:'COS-test',version:'1',catalog:{sha256:'a'.repeat(64)},definition:d});
const form={definition:{sections:[{fields:['ePatient.01','ePatient.05'].map(elementId=>({source:{kind:'nemsis',elementId}}))}]},catalogFields:Object.fromEntries(['ePatient.01','ePatient.05'].map(id=>[id,{name:id,generation:{base:'string',definition:{valueSource:{kind:'scalar'}}}}]))};
test('COS canonical mapping round-trip and rebuildable projection enforce profile, dependency fields and types',()=>{
 assert.throws(()=>cosMappingPackage(pack({...definition,schemaVersion:1})));
 const mapping=pack(definition);assert.deepEqual(cosMappingPackage(JSON.parse(JSON.stringify(mapping))),mapping);assert.deepEqual(compileCosMapping(mapping,form),definition);
 for(const extra of [{secret:'secret'},{staff:[]},{endpoint:'https://example.org'},{patientData:'clinical'}])assert.throws(()=>cosMappingPackage(pack({...definition,...extra})));
 assert.throws(()=>cosMappingPackage(pack({...definition,profile:{...COS_PROFILE,version:'99'}})));
 assert.throws(()=>cosMappingPackage(pack({...definition,patientIdentifier:{...definition.patientIdentifier,aliases:['urn:patient:test']}})));
 assert.throws(()=>compileCosMapping(pack({...definition,clinicalMappings:[{...definition.clinicalMappings[0],answerType:'decimal'}]}),form));
 assert.throws(()=>compileCosMapping(pack({...definition,clinicalMappings:[{...definition.clinicalMappings[0],source:{kind:'nemsis',elementId:'ePatient.06'}}]}),form));
 assert.throws(()=>cosMappingPackage(pack({...definition,clinicalMappings:[definition.clinicalMappings[0],definition.clinicalMappings[0]]})));
});
test('COS required connection settings do not contain clinical identity assignments',()=>{
 for(const removed of [{staff:[]},{careUnits:[]}])assert.throws(()=>connectionSettings({...settings,...removed}));
 assert.deepEqual(connectionSettings(settings),settings);assert.deepEqual(cosFindings(settings),[]);
 assert.deepEqual(cosFindings({...settings,template:''}),['template']);
});

test('COS retry schedules are finite, explicit, and validate every delay',()=>{
 for(const retryScheduleMinutes of [[],[1,5,15,30,60],[1440]])assert.deepEqual(connectionSettings({...settings,retryScheduleMinutes}).retryScheduleMinutes,retryScheduleMinutes);
 for(const retryScheduleMinutes of [[0],[-1],[1.5],[1441],Array(6).fill(1),'1,5',[null],[NaN]])assert.throws(()=>connectionSettings({...settings,retryScheduleMinutes}));
});

test('vital mapping packages pin numeric sources and units, reject collisions, and require the current mapping schema',()=>{
 const vital={id:'pulse',source:{kind:'nemsis',elementId:'eVitals.10'},vital:'heartRate',linkId:'364075005',unit:'/min'};
 const numericForm=structuredClone(form);numericForm.catalogFields['eVitals.10']={generation:{base:'integer'}};
 numericForm.definition.sections[0].fields.push({source:vital.source});
 const d={...definition,vitalMappings:[vital]},p=pack(d);
 assert.deepEqual(compileCosMapping(p,numericForm),d);
 assert.deepEqual(cosMappingPackage(JSON.parse(JSON.stringify(p))),p);
 assert.deepEqual(cosFindings(settings),[]);
 for(const change of [{unit:'Cel'},{vital:'unknown'},{linkId:'62521000052103'},{id:'symptom'},{linkId:'404684003'},{unexpected:true}])assert.throws(()=>cosMappingPackage(pack({...d,vitalMappings:[{...vital,...change}]})));
 assert.throws(()=>cosMappingPackage(pack({...d,pdfLinkId:vital.linkId})));
 assert.throws(()=>cosMappingPackage(pack({...d,vitalMappings:[vital,vital]})));
 assert.throws(()=>compileCosMapping(p,form));
 numericForm.catalogFields['eVitals.10'].generation.base='string';assert.throws(()=>compileCosMapping(p,numericForm));
});

test('v2 composite mappings require paired sources and reject unsupported package versions',async()=>{
 const {vitalMappings}=await import('../dist/hospital/cos-configuration.js');
 const row={id:'bp',source:{kind:'nemsis',elementId:'eVitals.06'},linkId:'75367002',vital:'bloodPressure',unit:'mm[Hg]'};
 assert.throws(()=>vitalMappings([row]));
 assert.deepEqual(vitalMappings([{...row,companionSource:{kind:'nemsis',elementId:'eVitals.07'}}])[0].companionSource,{kind:'nemsis',elementId:'eVitals.07'});
});
test('OAuth replacement credentials and live activation prerequisites are validated without exposing secrets',async()=>{
 const {oauthCredential,liveAcceptanceFindings}=await import('../dist/hospital/cos.service.js');
 const secret=JSON.stringify({clientSecret:'fictional-secret',subscriptionKey:'fictional-key'});
 assert.deepEqual(oauthCredential(secret),{clientSecret:'fictional-secret',subscriptionKey:'fictional-key'});
 for(const invalid of ['token','{}',JSON.stringify({clientSecret:'',subscriptionKey:'x'}),JSON.stringify({clientSecret:'x',subscriptionKey:'y',extra:'z'})])assert.throws(()=>oauthCredential(invalid));
 assert.deepEqual(liveAcceptanceFindings({mode:'live'},{vitalMappings:[]}),['installationAcceptance']);
 assert.deepEqual(liveAcceptanceFindings({mode:'live',live:{acceptanceRevision:'accepted',pdfKeyword:'document',versionMarkerLinkId:'404684003',acceptedProfiles:[]}},{pdfLinkId:'371530004',vitalMappings:[{vital:'heartRate'}]}),['profileAcceptance']);
});

test('partial mapping edits preserve an omitted PDF link but explicit clearing removes it',async()=>{
 const {cosPdfMappingEdit}=await import('../dist/hospital/cos-configuration.js');
 assert.deepEqual(cosPdfMappingEdit(undefined,'371530004'),{pdfLinkId:'371530004'});
 assert.deepEqual(cosPdfMappingEdit('','371530004'),{});
 assert.deepEqual(cosPdfMappingEdit('123456789','371530004'),{pdfLinkId:'123456789'});
 assert.throws(()=>cosPdfMappingEdit(null,'371530004'));
});
test('official NEMSIS BP compiles integer systolic and numeric-or-palpated string diastolic sources',()=>{
 const bp={id:'bp',source:{kind:'nemsis',elementId:'eVitals.06'},companionSource:{kind:'nemsis',elementId:'eVitals.07'},vital:'bloodPressure',linkId:'75367002',unit:'mm[Hg]'};
 const bpForm=structuredClone(form);
 for(const [elementId,base] of [['eVitals.06','integer'],['eVitals.07','string']]){bpForm.catalogFields[elementId]={generation:{base,definition:{valueSource:{kind:'scalar'}}}};bpForm.definition.sections[0].fields.push({source:{kind:'nemsis',elementId}});}
 assert.equal(compileCosMapping(pack({...definition,schemaVersion:2,vitalMappings:[bp]}),bpForm).vitalMappings[0].vital,'bloodPressure');
 bpForm.catalogFields['eVitals.06'].generation.base='string';assert.throws(()=>compileCosMapping(pack({...definition,schemaVersion:2,vitalMappings:[bp]}),bpForm));
});

test('read-back policy defaults to enabled and accepts only explicit boolean overrides',()=>{
 const live={baseUrl:'https://example.invalid/api/',tokenUrl:'https://example.invalid/token',clientId:'test',acceptedProfiles:[],pdfKeyword:'PDF',versionMarkerLinkId:'123456'};
 const input={...settings,mode:'live',authentication:'oauth-client-credentials',live};
 assert.notEqual(connectionSettings(input).live.readBackVerification,false);
 for(const readBackVerification of [true,false])assert.equal(connectionSettings({...input,live:{...live,readBackVerification}}).live.readBackVerification,readBackVerification);
 for(const readBackVerification of ['false',0,null,{}])assert.throws(()=>connectionSettings({...input,live:{...live,readBackVerification}}));
});

test('initial verification delay accepts whole seconds within the bounded settling window',()=>{
 const live={baseUrl:'https://example.org/',tokenUrl:'https://example.org/token',clientId:'client',pdfKeyword:'pdf',versionMarkerLinkId:'123456789',acceptedProfiles:[]};
 assert.equal(connectionSettings({...settings,live}).live.initialVerificationDelaySeconds,undefined);
 for(const delay of [0,20,60,240])assert.equal(connectionSettings({...settings,live:{...live,initialVerificationDelaySeconds:delay}}).live.initialVerificationDelaySeconds,delay);
 for(const delay of [-1,241,1.5,'20',null,NaN,Infinity])assert.throws(()=>connectionSettings({...settings,live:{...live,initialVerificationDelaySeconds:delay}}));
});

test('pain mappings compile with only the score field, including legacy scale companions',()=>{
 const painForm=structuredClone(form);
 painForm.catalogFields['eVitals.27']={generation:{base:'integer'}};
 painForm.definition.sections[0].fields.push({source:{kind:'nemsis',elementId:'eVitals.27'}});
 for(const companion of [{},{companionSource:{kind:'nemsis',elementId:'eVitals.28'}}]){
  const pain={id:'pain',source:{kind:'nemsis',elementId:'eVitals.27'},vital:'painNrs',linkId:'49121000146105',unit:'',...companion};
  assert.deepEqual(compileCosMapping(pack({...definition,vitalMappings:[pain]}),painForm).vitalMappings,[pain]);
 }
});
