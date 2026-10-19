import assert from 'node:assert/strict';
import test from 'node:test';
import {COS_PROFILE,cosMappingPackage,compileCosMapping,connectionSettings,resolveCosCareUnit,cosFindings} from '../dist/hospital/cos-configuration.js';
import {makePackage} from '../dist/admin/canonical-package.js';
const settings={mode:'simulator',authentication:'api-key',template:'urn:template:test',encounterNamespace:'urn:encounter:test',organizationHsaId:'ORG',defaultAmbulanceCareUnit:'AMB',staff:[{userId:'11111111-1111-1111-1111-111111111111',hsaId:'STAFF'}],careUnits:[{hospital:'HOSP',localCareUnit:'ER',hsaId:'ER-HSA'}]};
const definition={schemaVersion:1,id:'test-mapping',revision:1,authoredAt:'2026-10-19T12:00:00Z',author:'author',profile:COS_PROFILE,patientIdentifier:{field:{kind:'nemsis',elementId:'ePatient.01'},namespace:'urn:patient:test',aliases:[]},clinicalMappings:[{id:'symptom',source:{kind:'nemsis',elementId:'ePatient.05'},linkId:'404684003',answerType:'string'}]};
const pack=d=>makePackage({kind:'hospital-mapping',name:'COS-test',version:'1',catalog:{sha256:'a'.repeat(64)},definition:d});
const form={definition:{sections:[{fields:['ePatient.01','ePatient.05'].map(elementId=>({source:{kind:'nemsis',elementId}}))}]},catalogFields:Object.fromEntries(['ePatient.01','ePatient.05'].map(id=>[id,{name:id,generation:{base:'string',definition:{valueSource:{kind:'scalar'}}}}]))};
test('COS canonical mapping round-trip and rebuildable projection enforce profile, dependency fields and types',()=>{
 const mapping=pack(definition);assert.deepEqual(cosMappingPackage(JSON.parse(JSON.stringify(mapping))),mapping);assert.deepEqual(compileCosMapping(mapping,form),definition);
 for(const extra of [{secret:'secret'},{staff:settings.staff},{endpoint:'https://example.org'},{patientData:'clinical'}])assert.throws(()=>cosMappingPackage(pack({...definition,...extra})));
 assert.throws(()=>cosMappingPackage(pack({...definition,profile:{...COS_PROFILE,version:'99'}})));
 assert.throws(()=>cosMappingPackage(pack({...definition,patientIdentifier:{...definition.patientIdentifier,aliases:['urn:patient:test']}})));
 assert.throws(()=>compileCosMapping(pack({...definition,clinicalMappings:[{...definition.clinicalMappings[0],answerType:'decimal'}]}),form));
 assert.throws(()=>compileCosMapping(pack({...definition,clinicalMappings:[{...definition.clinicalMappings[0],source:{kind:'nemsis',elementId:'ePatient.06'}}]}),form));
 assert.throws(()=>cosMappingPackage(pack({...definition,clinicalMappings:[definition.clinicalMappings[0],definition.clinicalMappings[0]]})));
});
test('COS required settings and destination resolver never guess receiving units',()=>{
 assert.deepEqual(connectionSettings(settings),settings);assert.deepEqual(cosFindings(settings,definition),[]);
 assert.equal(resolveCosCareUnit(settings,null),'AMB');assert.equal(resolveCosCareUnit(settings,{hospital:'HOSP',localCareUnit:'ER'}),'ER-HSA');
 assert.equal(resolveCosCareUnit(settings,{hospital:'UNKNOWN',localCareUnit:'ER'}),null);assert.equal(resolveCosCareUnit(settings,{hospital:'HOSP',localCareUnit:'UNKNOWN'}),null);
 assert.throws(()=>connectionSettings({...settings,staff:[settings.staff[0],settings.staff[0]]}));
 assert.deepEqual(cosFindings({...settings,template:'',staff:[]},definition),['template','staff']);
});

test('COS retry schedules are finite, explicit, and validate every delay',()=>{
 for(const retryScheduleMinutes of [[],[1,5,15,30,60],[1440]])assert.deepEqual(connectionSettings({...settings,retryScheduleMinutes}).retryScheduleMinutes,retryScheduleMinutes);
 for(const retryScheduleMinutes of [[0],[-1],[1.5],[1441],Array(6).fill(1),'1,5',[null],[NaN]])assert.throws(()=>connectionSettings({...settings,retryScheduleMinutes}));
});
