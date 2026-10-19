import test from 'node:test';
import assert from 'node:assert/strict';
import {clinicalMappings,importCandidate,importDestination} from '../dist/hospital/eps-import-mapping.js';
import {makePackage,mappingPackage} from '../dist/hospital/hospital-mapping.js';
const field=elementId=>({kind:'nemsis',elementId});
const crosswalk={system:'RxNorm',code:'1364430',display:'apixaban',relationship:'broader',reference:'https://rxnav.nlm.nih.gov/REST/rxcui/1364430/properties.json'};
const medication={id:'apixaban',resourceType:'MedicationStatement',semanticRole:'medication-history',system:'http://www.whocc.no/atc',code:'B01AF02',destination:field('eHistory.12'),representation:'coded',crosswalk};
const allergy={id:'penicillin',resourceType:'AllergyIntolerance',system:'http://snomed.info/sct',code:'764146007',destination:field('eHistory.06'),representation:'coded',crosswalk:{...crosswalk,system:'ICD-10-CM',code:'Z88.0',display:'Penicillin allergy'}};
const form={definition:{sections:[{fields:[{source:field('eHistory.12')},{source:field('eHistory.06')}]}]},catalogFields:{'eHistory.12':{name:'Current medications',generation:{definition:{valueSource:{kind:'external-code-system'}}},codeChoices:[]},'eHistory.06':{name:'Medication allergies',codeChoices:[{code:'Z88.0',codeSystem:'ICD-10-CM'}]}}};
const entry={identity:'urn:medication',patientMatches:true,resource:{resourceType:'MedicationStatement',status:'active',medicationCodeableConcept:{coding:[{system:medication.system,code:medication.code,display:'Apixaban 5 mg tablet'}]},dosage:[{text:'5 mg twice daily'}]}};
test('crosswalks round trip in canonical JSON and reject malformed or unrelated translations',()=>{
 assert.deepEqual(clinicalMappings([medication,allergy]),[medication,allergy]);
 const p=makePackage({kind:'hospital-mapping',name:'crosswalk',version:'1',catalog:{sha256:'a'.repeat(64)},definition:{schemaVersion:1,id:'crosswalk',revision:1,author:'test',authoredAt:'2026-10-19T00:00:00Z',profile:{package:'hl7.fhir.eu.eps',version:'1.0.0-ballot',fhirVersion:'4.0.1'},patientIdentifier:{field:field('ePatient.01'),namespace:'urn:patient',aliases:[]},clinicalMappings:[medication,allergy]}});
 assert.deepEqual(mappingPackage(JSON.parse(JSON.stringify(p))),p);
 for(const change of [{representation:'text'},{resourceType:'Procedure',semanticRole:undefined},{crosswalk:{...crosswalk,relationship:'narrower'}},{crosswalk:{...crosswalk,reference:'javascript:alert(1)'}},{crosswalk:{...crosswalk,extra:true}}])assert.throws(()=>clinicalMappings([{...medication,...change}]));
 assert.equal(importDestination({...allergy,destination:field('eHistory.12')},form).finding,'historicalDestination');
 assert.equal(importDestination({...medication,destination:field('eMedications.03')},form).finding,'medicationHistory');
});
test('current medication identity uses explicit target, retains regimen, and respects pinned choice policy',()=>{
 const result=importCandidate(entry,[medication],form);assert.equal(result.finding,null);assert.deepEqual(result.value,{kind:'coded',code:'1364430',codeSystem:'RxNorm',display:'apixaban'});assert.match(result.incoming,/5 mg twice daily/);
 for(const status of ['completed','stopped','on-hold','intended','not-taken','unknown','entered-in-error'])assert.equal(importCandidate({...entry,resource:{...entry.resource,status}},[medication],form).finding,'status');
 assert.equal(importCandidate({...entry,resource:{...entry.resource,effectivePeriod:{end:'2020-01-01'}}},[medication],form).finding,'status');
 assert.equal(importCandidate({...entry,resource:{...entry.resource,effectivePeriod:{start:'2999-01-01'}}},[medication],form).finding,'status');
 const limited=structuredClone(form);limited.definition.sections[0].fields[0].choicePolicy=[];assert.equal(importDestination(medication,limited).finding,'code');
 assert.equal(importDestination({...medication,crosswalk:{...crosswalk,system:'ATC'}},form).finding,'code');
 assert.equal(importDestination({...medication,crosswalk:undefined},form).finding,'medicationHistory');
 const unsupported=structuredClone(entry);unsupported.resource.dosage[0].modifierExtension=[{url:'urn:unknown'}];assert.equal(importCandidate(unsupported,[medication],form).finding,'semantics');
});
test('allergy crosswalk needs confirmed active allergy, displays target and preserves reaction details',()=>{
 const resource={resourceType:'AllergyIntolerance',type:'allergy',code:{coding:[{system:allergy.system,code:allergy.code}]},clinicalStatus:{coding:[{system:'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',code:'active'}]},verificationStatus:{coding:[{system:'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification',code:'confirmed'}]},reaction:[{description:'Anaphylaxis'}]};
 const e={identity:'urn:allergy',patientMatches:true,resource};const result=importCandidate(e,[allergy],form);assert.equal(result.finding,null);assert.equal(result.value.code,'Z88.0');assert.match(result.incoming,/Anaphylaxis/);
 for(const change of [{type:'intolerance'},{verificationStatus:undefined},{clinicalStatus:undefined},{abatementDateTime:'2020-01-01'}])assert.equal(importCandidate({...e,resource:{...resource,...change}},[allergy],form).finding,'status');
 assert.equal(importCandidate({...e,resource:{...resource,extension:[{url:'urn:unknown'}]}},[allergy],form).finding,'semantics');
 assert.equal(importCandidate({...e,patientMatches:false},[allergy],form).finding,'patient');
 assert.equal(importDestination({...allergy,crosswalk:undefined},form).finding,'code','legacy mappings cannot silently translate');
});

test('condition crosswalk imports active confirmed problems into medical/surgical history',()=>{
 const mapping={id:'hypertension',resourceType:'Condition',system:'http://snomed.info/sct',code:'59621000',destination:field('eHistory.08'),representation:'coded',crosswalk:{system:'ICD-10-CM',code:'I10',display:'Essential hypertension',relationship:'equivalent',reference:'https://nemsis.org/'}};
 const historyForm=structuredClone(form);
 historyForm.definition.sections[0].fields.push({source:field('eHistory.08')});
 historyForm.catalogFields['eHistory.08']={name:'Medical/Surgical History',codeChoices:[{code:'I10',codeSystem:'ICD-10-CM'}]};
 assert.deepEqual(clinicalMappings([mapping]),[mapping]);
 const resource={resourceType:'Condition',code:{coding:[{system:mapping.system,code:mapping.code}]},clinicalStatus:{coding:[{system:'http://terminology.hl7.org/CodeSystem/condition-clinical',code:'active'}]},verificationStatus:{coding:[{system:'http://terminology.hl7.org/CodeSystem/condition-ver-status',code:'confirmed'}]},onsetDateTime:'2012-01-01'};
 const e={identity:'urn:condition',patientMatches:true,resource};
 const result=importCandidate(e,[mapping],historyForm);
 assert.equal(result.finding,null);
 assert.deepEqual(result.value,{kind:'coded',code:'I10',codeSystem:'ICD-10-CM',display:'Essential hypertension'});
 assert.match(result.incoming,/2012-01-01/);
 for(const status of ['resolved','remission','inactive'])assert.equal(importCandidate({...e,resource:{...resource,clinicalStatus:{coding:[{system:'http://terminology.hl7.org/CodeSystem/condition-clinical',code:status}]}}},[mapping],historyForm).finding,'status');
 for(const change of [{verificationStatus:undefined},{abatementDateTime:'2020-01-01'}])assert.equal(importCandidate({...e,resource:{...resource,...change}},[mapping],historyForm).finding,'status');
 assert.equal(importCandidate({...e,resource:{...resource,modifierExtension:[{url:'urn:unknown'}]}},[mapping],historyForm).finding,'semantics');
 assert.equal(importCandidate({...e,patientMatches:false},[mapping],historyForm).finding,'patient');
 assert.equal(importDestination({...mapping,destination:field('eSituation.11')},historyForm).finding,'historicalDestination');
 assert.equal(importDestination({...mapping,crosswalk:{...mapping.crosswalk,code:'invalid'}},historyForm).finding,'code');
 assert.throws(()=>clinicalMappings([{...mapping,crosswalk:{...mapping.crosswalk,system:'RxNorm'}}]));
 historyForm.definition.sections[0].fields.at(-1).choicePolicy=[];
 assert.equal(importDestination(mapping,historyForm).finding,'code');
});
