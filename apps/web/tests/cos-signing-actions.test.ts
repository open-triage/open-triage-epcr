import test from 'node:test';
import assert from 'node:assert/strict';
import type {ClinicalFormConfiguration,CosPatientComparison,EncounterDocument} from '@open-triage/contracts';
import synthetic from '../app/data/synthetic-encounter-document.json';
import {applyCosPatientComparison,cosIssueAction,cosIssueElement,cosIssueIsWarning} from '../app/cos-signing-actions';
const document=synthetic as EncounterDocument;
const fields=['ePatient.02','ePatient.03','ePatient.04','ePatient.17','ePatient.25'];
const form={definition:{schemaVersion:1,sections:[{key:'patient',fields:fields.map(elementId=>({key:elementId,source:{kind:'nemsis',elementId}}))}]},
 catalogFields:Object.fromEntries(fields.map(id=>[id,{}]))} as ClinicalFormConfiguration;
const comparison={canApply:true,changes:[{elementId:'ePatient.03',kind:'text',value:'COS'},{elementId:'ePatient.02',kind:'text',value:'Patient'}]} as CosPatientComparison;
test('demographic application preserves identifiers, immutable input and occurrence IDs',()=>{
 const before=JSON.stringify(document);
 const next=applyCosPatientComparison(document,form,comparison);
 assert.equal(JSON.stringify(document),before);assert.notEqual(next,document);
 for(const group of document.groups)for(const instance of group.instances)for(const element of instance.elements){
  const after=next.groups.find(g=>g.id===group.id)?.instances.find(i=>i.instanceId===instance.instanceId)?.elements.find(e=>e.id===element.id);
  if(!['ePatient.03','ePatient.02'].includes(element.id))assert.deepEqual(after,element);
  else assert.deepEqual(after?.values.map(v=>v.occurrenceId),element.values.map(v=>v.occurrenceId));
 }
});
test('invalid or ambiguous application fails atomically and cannot change identifier',()=>{
 const before=JSON.stringify(document);
 for(const changes of [[...comparison.changes,{elementId:'ePatient.01',kind:'text',value:'new identity'}],[{elementId:'ePatient.17',kind:'date',value:'not a date'}]])
  assert.throws(()=>applyCosPatientComparison(document,form,{...comparison,changes} as CosPatientComparison));
 assert.throws(()=>applyCosPatientComparison(document,{...form,definition:{...form.definition,sections:[]}},comparison));
 assert.equal(JSON.stringify(document),before);
});
test('issues route to correction, configuration or safe verification',()=>{
 for(const [code,action] of [['rakel','units'],['staff','users'],['patientIdentityConflict','demographics'],['patientIdentifier','patient'],['destinationStale','destination'],['clinicalTime','clinical'],['outcomeUnknown','verify'],['outage','retry'],['newFutureCode','verify']] as const)
  assert.equal(cosIssueAction({code}),action);
 assert.equal(cosIssueAction({code:'future',elementId:'eVitals.06'}),'clinical');
 assert.equal(cosIssueElement({code:'patientIdentityConflict'}),'ePatient.03');
 assert.equal(cosIssueElement({code:'clinicalValue',elementId:'eVitals.06'}),'eVitals.06');
});


test('only explicit coverage warnings offer acknowledgement',()=>{
 assert.equal(cosIssueIsWarning({code:'nonNrsPain',artifact:'context',coverage:'note-pdf-only'}),true);
 assert.equal(cosIssueIsWarning({code:'clinicalValue',artifact:'context',coverage:'partial'}),true);
 assert.equal(cosIssueIsWarning({code:'patientIdentityConflict',artifact:'patient'}),false);
 assert.equal(cosIssueIsWarning({code:'reconciliationUnresolved'}),false);
 assert.equal(cosIssueIsWarning({code:'pdfDocumentMissing',artifact:'pdf',coverage:'partial'}),false);
});
