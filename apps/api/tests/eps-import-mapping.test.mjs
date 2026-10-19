import test from 'node:test';
import assert from 'node:assert/strict';
import {clinicalMappings,importCandidate,importDestination} from '../dist/hospital/eps-import-mapping.js';
import {mappingPackage,makePackage} from '../dist/hospital/hospital-mapping.js';
const field={kind:'custom',elementDefinitionId:'allergy'};
const mapping={id:'allergy',resourceType:'AllergyIntolerance',system:'http://snomed.info/sct',code:'91936005',destination:field,representation:'coded'};
const form={definition:{sections:[{fields:[{source:field}]}]},catalogFields:{},customFields:{allergy:{id:'allergy',namespace:'org.example',slug:'allergy',title:'Allergy history',datatype:'coded',codeSystem:mapping.system,choices:[{code:mapping.code,label:'Penicillin allergy'}],recurrence:'single'}}};
const entry={identity:'urn:uuid:allergy',patientMatches:true,resource:{resourceType:'AllergyIntolerance',id:'allergy',code:{coding:[{system:mapping.system,code:mapping.code,display:'Penicillin allergy'}]},clinicalStatus:{coding:[{system:'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',code:'active'}]},verificationStatus:{coding:[{system:'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification',code:'confirmed'}]},recordedDate:'2020-01-01'}};
test('EPS exact-code imports preserve status/time without translating unsupported codes',()=>{
 assert.equal(importCandidate(entry,[mapping],form).finding,null);
 assert.deepEqual(importCandidate(entry,[mapping],form).value,{kind:'coded',code:mapping.code,codeSystem:mapping.system,display:'Penicillin allergy'});
 assert.match(importCandidate(entry,[mapping],form).incoming,/2020-01-01/);
 assert.equal(importCandidate({...entry,patientMatches:false},[mapping],form).finding,'patient');
 assert.equal(importDestination({...mapping,system:'http://different'},form).finding,'code');
 assert.equal(importCandidate(entry,[],form).finding,'unmapped');
 assert.equal(importCandidate(entry,[mapping,{...mapping,id:'other'}],form).finding,'ambiguous');
 assert.throws(()=>clinicalMappings([mapping,{...mapping,id:'other'}]));
});
test('EPS unknown, negative and unavailable source codes remain distinct in text and canonical round trips',()=>{
 const textForm=structuredClone(form);textForm.customFields.allergy.datatype='string';textForm.customFields.allergy.constraints={};
 for(const code of ['no-known-allergies','no-allergy-info','not-asked','unavailable']) {
  const m={...mapping,system:'http://hl7.org/fhir/uv/ips/CodeSystem/absent-unknown-uv-ips',code,representation:'text'};
  const e=structuredClone(entry);e.resource.code.coding=[{system:m.system,code}];
  const result=importCandidate(e,[m],textForm);assert.equal(result.finding,null);assert.match(result.value.value,new RegExp(code));
  const p=makePackage({kind:'hospital-mapping',name:'EPS',version:'1',catalog:{sha256:'a'.repeat(64)},definition:{schemaVersion:1,id:'example',revision:1,authoredAt:'2026-10-19T00:00:00Z',author:'fixture',profile:{package:'hl7.fhir.eu.eps',version:'1.0.0-ballot',fhirVersion:'4.0.1'},patientIdentifier:{field:{kind:'nemsis',elementId:'ePatient.01'},namespace:'urn:patient',aliases:[]},clinicalMappings:[m]}});
  assert.deepEqual(mappingPackage(JSON.parse(JSON.stringify(p))),p);
 }
 const correlated=structuredClone(textForm);correlated.customFields.allergy.correlatesTo='eVitals.VitalGroup';assert.equal(importDestination({...mapping,representation:'text'},correlated).finding,'cardinality');
});

test('coded EPS imports never turn uncertain, resolved, refuted or erroneous sources into affirmative findings',()=>{
 for(const resourceType of ['AllergyIntolerance','Condition']) {
  const allergy=resourceType==='AllergyIntolerance';
  const e=structuredClone(entry);e.resource.resourceType=resourceType;
  e.resource.clinicalStatus={coding:[{system:`http://terminology.hl7.org/CodeSystem/${allergy?'allergyintolerance-clinical':'condition-clinical'}`,code:'active'}]};
  e.resource.verificationStatus={coding:[{system:`http://terminology.hl7.org/CodeSystem/${allergy?'allergyintolerance-verification':'condition-ver-status'}`,code:'confirmed'}]};
  const m={...mapping,resourceType};
  assert.equal(importCandidate(e,[m],form).finding,null);
  for(const [field,statuses] of [['clinicalStatus',['inactive','resolved','unknown',null]],['verificationStatus',['refuted','entered-in-error','unconfirmed','provisional','differential','unknown',null]]]) {
   for(const code of statuses){const changed=structuredClone(e);if(code===null)delete changed.resource[field];else changed.resource[field].coding[0].code=code;
    assert.equal(importCandidate(changed,[m],form).finding,'status',`${resourceType}/${field}/${code}`);
    const textForm=structuredClone(form);textForm.customFields.allergy.datatype='string';textForm.customFields.allergy.constraints={};
    const result=importCandidate(changed,[{...m,representation:'text'}],textForm);assert.equal(result.finding,null);if(code)assert.match(result.value.value,new RegExp(code));
   }
  }
  for(const negative of ['no-known-allergies','no-allergy-info','no-known-problems','no-problem-info']) {
   const changed=structuredClone(e);changed.resource.code.coding=[{system:'http://hl7.org/fhir/uv/ips/CodeSystem/absent-unknown-uv-ips',code:negative}];
   assert.equal(importCandidate(changed,[m],form).finding,'unmapped','negative or unknown never matches affirmative source mapping');
   const negativeMapping={...m,system:changed.resource.code.coding[0].system,code:negative};
   assert.equal(importCandidate(changed,[negativeMapping],form).finding,'code','no substitution of a negative source with the available affirmative destination code');
  }
  const contradictory=structuredClone(e);contradictory.resource.abatementDateTime='2020-01-01';assert.equal(importCandidate(contradictory,[m],form).finding,'status');
 }
});
