import test from 'node:test';
import assert from 'node:assert/strict';
import { historicalDestination, historicalSource, historicalConcept } from '../dist/hospital/eps-history-import.js';
const field={kind:'custom',elementDefinitionId:'history'};
const mapping={id:'weight',resourceType:'Observation',system:'http://loinc.org',code:'29463-7',destination:field,representation:'text',semanticRole:'historical-observation',expectedUnit:{system:'http://unitsofmeasure.org',code:'kg'}};
const form={customFields:{history:{datatype:'string',recurrence:'multiple'}},catalogFields:{}};
const observation={resourceType:'Observation',id:'weight-2020',status:'final',code:{coding:[{system:mapping.system,code:mapping.code,display:'Body weight'}]},effectiveDateTime:'2020-05-12',valueQuantity:{value:78.5,system:'http://unitsofmeasure.org',code:'kg',unit:'kg'},subject:{reference:'Patient/patient'},note:[{text:'Historical outpatient measurement'}]};

test('historical destinations require explicit semantics and never use current encounter values',()=>{
 assert.equal(historicalDestination(mapping,form),null);
 for(const elementId of ['eVitals.23','eProcedures.03','eNarrative.01','ePatient.01'])assert.equal(historicalDestination({...mapping,destination:{kind:'nemsis',elementId}},form),'historicalDestination');
 assert.equal(historicalDestination({...mapping,semanticRole:undefined},form),'historicalDestination');
 assert.equal(historicalDestination({...mapping,representation:'coded'},form),'historicalDestination');
 assert.equal(historicalDestination(mapping,{...form,customFields:{history:{datatype:'string',correlatesTo:'eVitals.VitalGroup'}}}),'historicalDestination');
});
test('historical measurements preserve dates, status, code, units, comparisons and repeated independent source entries',()=>{
 const first=historicalSource(observation,mapping);assert.equal(first.finding,null);assert.deepEqual(JSON.parse(first.value),observation);
 const second={...observation,id:'weight-2021',effectiveDateTime:'2021-09-01',valueQuantity:{...observation.valueQuantity,value:80,comparator:'>'}};
 assert.equal(historicalSource(second,mapping).finding,null);assert.deepEqual(JSON.parse(historicalSource(second,mapping).value),second);assert.notEqual(first.value,historicalSource(second,mapping).value);
 for(const quantity of [{...observation.valueQuantity,system:'urn:other'},{...observation.valueQuantity,code:'[lb_av]'}, {value:78.5,unit:'kg'}])assert.equal(historicalSource({...observation,valueQuantity:quantity},mapping).finding,'historicalUnit');
 assert.equal(historicalSource(observation,{...mapping,expectedUnit:undefined}).finding,'historicalUnit');
 assert.equal(historicalSource({...observation,component:[{code:observation.code,valueQuantity:observation.valueQuantity}]},mapping).finding,'historicalComponents');
});
test('historical uncertainty, absence and unsupported values remain explicit',()=>{
 for(const status of ['preliminary','unknown','cancelled','entered-in-error',undefined])assert.equal(historicalSource({...observation,status},mapping).finding,'status');
 for(const effectiveDateTime of [undefined,'2020-02-31','yesterday'])assert.equal(historicalSource({...observation,effectiveDateTime},mapping).finding,'historicalDate');
 const absent={...observation,dataAbsentReason:{coding:[{system:'http://terminology.hl7.org/CodeSystem/data-absent-reason',code:'not-asked'}]}};delete absent.valueQuantity;
 assert.equal(historicalSource(absent,mapping).finding,null);assert.match(historicalSource(absent,mapping).value,/not-asked/);
 assert.equal(historicalSource({...absent,valueQuantity:observation.valueQuantity},mapping).finding,'semantics');
 assert.equal(historicalSource({...observation,modifierExtension:[{url:'urn:uncertain',valueBoolean:true}]},mapping).finding,'semantics');
 assert.equal(historicalSource({...observation,valueQuantity:{...observation.valueQuantity,extension:[{url:'urn:meaning'}]}},mapping).finding,'semantics');
});
test('historical procedures preserve original dates and context without asserting a treatment during this call',()=>{
 const procedure={resourceType:'Procedure',id:'old-op',status:'completed',performedPeriod:{start:'2015-01-01',end:'2015-01-02'},code:{coding:[{system:'http://snomed.info/sct',code:'80146002',display:'Appendectomy'}]},subject:{reference:'Patient/patient'},bodySite:[{text:'Appendix'}]};
 const m={...mapping,resourceType:'Procedure',semanticRole:'historical-procedure',expectedUnit:undefined};
 assert.equal(historicalDestination(m,form),null);assert.deepEqual(JSON.parse(historicalSource(procedure,m).value),procedure);
 assert.equal(historicalSource({...procedure,status:'not-done'},m).finding,'status');
 assert.equal(historicalSource({...procedure,performedPeriod:{start:'2015-01-02',end:'2015-01-01'}},m).finding,'historicalDate');
});
test('patient context identifier imports require exact unique current namespace and preserve scalar identity',()=>{
 const resource={resourceType:'Patient',id:'patient',identifier:[{system:'urn:old',value:'existing'},{system:'urn:new',value:'000123',use:'official'}]};
 const m={...mapping,resourceType:'Patient',system:'urn:new',code:'identifier',semanticRole:'patient-identifier',expectedUnit:undefined,destination:{kind:'nemsis',elementId:'ePatient.01'}};
 assert.equal(historicalDestination(m,form),null);assert.equal(historicalSource(resource,m).value,'000123');assert.match(historicalSource(resource,m).incoming,/urn:new/);
 assert.deepEqual(historicalConcept(resource).coding[1],{system:'urn:new',code:'identifier',display:'000123'});
 assert.equal(historicalSource({...resource,identifier:[...resource.identifier,{system:'urn:new',value:'other'}]},m).finding,'identifierAmbiguous');
 assert.equal(historicalSource({...resource,identifier:[{system:'urn:new',value:'000123',use:'old'}]},m).finding,'identifierAmbiguous');
 assert.equal(historicalSource(resource,{...m,system:'urn:unknown'}).finding,'identifierAmbiguous');
 assert.equal(historicalDestination({...m,destination:{kind:'nemsis',elementId:'ePatient.05'}},form),'historicalDestination');
});
