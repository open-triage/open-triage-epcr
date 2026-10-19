import test from 'node:test';
import assert from 'node:assert/strict';
import {clinicalMappings,importCandidate,importDestination} from '../dist/hospital/eps-import-mapping.js';
import {mappingPackage,makePackage} from '../dist/hospital/hospital-mapping.js';
const destination={kind:'custom',elementDefinitionId:'med-history'};
const mapping={id:'medication',resourceType:'MedicationStatement',semanticRole:'medication-history',system:'http://www.whocc.no/atc',code:'C09AA02',destination,representation:'text'};
const form={definition:{sections:[{fields:[{source:destination}]}]},catalogFields:{},customFields:{'med-history':{id:'med-history',namespace:'org.example',slug:'medication-history',title:'Medication history',datatype:'string',constraints:{},recurrence:'multiple'}}};
const entry={identity:'urn:uuid:medication-one',patientMatches:true,resource:{resourceType:'MedicationStatement',id:'one',status:'active',medicationCodeableConcept:{coding:[{system:mapping.system,code:mapping.code,display:'Enalapril'}]},effectivePeriod:{start:'2020-01-01'},dateAsserted:'2021-03-01',dosage:[{route:{coding:[{system:'http://snomed.info/sct',code:'26643006',display:'Oral'}]},doseAndRate:[{doseQuantity:{value:10,unit:'mg',system:'http://unitsofmeasure.org',code:'mg'}}],timing:{repeat:{frequency:1,period:1,periodUnit:'d'}}}]}};
test('medication history preserves dose, units, route, status and original dates without recording administration',()=>{
 const projected=importCandidate(entry,[mapping],form);assert.equal(projected.finding,null);assert.equal(projected.value.kind,'text');
 for(const expected of ['status: active','effectivePeriod.start: 2020-01-01','dateAsserted: 2021-03-01','doseQuantity.value: 10','doseQuantity.unit: mg','route.coding[1].code: 26643006'])assert.ok(projected.incoming.includes(expected),expected);
 assert.equal(importDestination({...mapping,destination:{kind:'nemsis',elementId:'eMedications.03'}},form).finding,'medicationHistory');
 assert.equal(importDestination({...mapping,destination:{kind:'nemsis',elementId:'eHistory.12'}},form).finding,'medicationHistory','a bare code field cannot preserve the regimen');
 assert.equal(importDestination({...mapping,representation:'coded'},form).finding,'medicationHistory');
 assert.throws(()=>clinicalMappings([{...mapping,semanticRole:undefined}]));
 assert.equal(importCandidate(entry,[{...mapping,code:'unsupported'}],form).finding,'unmapped');
});
test('medication status, repeated regimens and unresolved references remain distinct',()=>{
 for(const status of ['active','completed','stopped','on-hold','intended','not-taken','unknown']){
  const e=structuredClone(entry);e.resource.status=status;const result=importCandidate(e,[mapping],form);assert.equal(result.finding,null);assert.ok(result.incoming.includes(`status: ${status}`));
 }
 for(const status of ['entered-in-error',null,'bogus']){const e=structuredClone(entry);e.resource.status=status;assert.equal(importCandidate(e,[mapping],form).finding,'status');}
 const e=structuredClone(entry);e.identity='urn:uuid:medication-two';e.resource.dosage[0].doseAndRate[0].doseQuantity.value=20;e.resource.dosage[0].route.coding[0].code='unsupported-route';assert.notEqual(importCandidate(e,[mapping],form).incoming,importCandidate(entry,[mapping],form).incoming);assert.equal(importCandidate(e,[mapping],form).finding,null,'text preserves the unconverted source route');
 const referenced=structuredClone(entry);referenced.resource.medicationReference={reference:'Medication/product'};delete referenced.resource.medicationCodeableConcept;
 assert.equal(importCandidate(referenced,[mapping],form).finding,'medicationReference');referenced.medication={resourceType:'Medication',id:'product',code:entry.resource.medicationCodeableConcept};assert.equal(importCandidate(referenced,[mapping],form).finding,null);
 referenced.medication.modifierExtension=[{url:'urn:unknown',valueBoolean:true}];assert.equal(importCandidate(referenced,[mapping],form).finding,'semantics');
 const nested=structuredClone(entry);nested.resource.dosage[0].modifierExtension=[{url:'urn:unknown',valueBoolean:true}];assert.equal(importCandidate(nested,[mapping],form).finding,'semantics');
});
test('canonical medication semantic role transfers and custom field constraints are enforced',()=>{
 const p=makePackage({kind:'hospital-mapping',name:'EPS',version:'1',catalog:{sha256:'a'.repeat(64)},definition:{schemaVersion:1,id:'example',revision:1,authoredAt:'2026-10-19T00:00:00Z',author:'fixture',profile:{package:'hl7.fhir.eu.eps',version:'1.0.0-ballot',fhirVersion:'4.0.1'},patientIdentifier:{field:{kind:'nemsis',elementId:'ePatient.01'},namespace:'urn:patient',aliases:[]},clinicalMappings:[mapping]}});
 assert.deepEqual(mappingPackage(JSON.parse(JSON.stringify(p))),p);
 const limited=structuredClone(form);limited.customFields['med-history'].constraints.maxLength=10;assert.equal(importCandidate(entry,[mapping],limited).finding,'constraints');
 const correlated=structuredClone(form);correlated.customFields['med-history'].correlatesTo='eMedications.MedicationGroup';assert.equal(importDestination(mapping,correlated).finding,'medicationHistory');
});

test('summary parsing resolves products only in the current bundle and never invents negative medication history',async()=>{
 const {parsePatientSummary}=await import('@open-triage/contracts');
 const bundle={resourceType:'Bundle',type:'document',id:'test',entry:[{fullUrl:'urn:composition',resource:{resourceType:'Composition',type:{text:'EPS'},status:'final',date:'2026-10-19T00:00:00Z',subject:{reference:'urn:patient'},section:[]}},{fullUrl:'urn:patient',resource:{resourceType:'Patient',id:'patient',identifier:[{system:'urn:patient',value:'fictional'}]}}]};
 assert.deepEqual(parsePatientSummary(bundle).summary.importEntries,[]);
 const e=structuredClone(entry);e.resource.subject={reference:'urn:patient'};delete e.resource.medicationCodeableConcept;e.resource.medicationReference={reference:'https://elsewhere.invalid/Medication/one'};
 bundle.entry.push({fullUrl:e.identity,resource:e.resource});let projected=parsePatientSummary(bundle).summary.importEntries[0];assert.equal(projected.medication,undefined);assert.equal(importCandidate(projected,[mapping],form).finding,'medicationReference');
 bundle.entry.push({fullUrl:'https://elsewhere.invalid/Medication/one',resource:{resourceType:'Medication',id:'product',code:entry.resource.medicationCodeableConcept}});projected=parsePatientSummary(bundle).summary.importEntries[0];assert.equal(projected.medication.id,'product');assert.equal(importCandidate(projected,[mapping],form).finding,null);
});
