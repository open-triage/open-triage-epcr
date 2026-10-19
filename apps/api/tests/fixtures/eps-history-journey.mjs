import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {EpsImportService} from '../../dist/hospital/eps-import.service.js';
import {epsHistoryBrowser} from './eps-history-browser.mjs';

export async function epsHistoryJourney({database,query,sessions,configuration,adminToken,otherToken,body,token,actor,report,service,drafts,fixtures,historyFieldId}) {
 const oldRoot=process.env.OPENTRIAGE_DEFINITIONS_ROOT,folder=await mkdtemp('/tmp/eps007-canonical-');process.env.OPENTRIAGE_DEFINITIONS_ROOT=folder;
 await query('savepoint eps_history_journey');
 const original=structuredClone(fixtures[0]);
 try {
  const bundle=fixtures[0],patient=bundle.entry.find(e=>e.resource.resourceType==='Patient'),subject={reference:patient.fullUrl??`Patient/${patient.resource.id}`};
  const observation={resourceType:'Observation',id:'eps007-weight-old',status:'final',code:{coding:[{system:'http://loinc.org',code:'29463-7',display:'Historical body weight'}]},subject,effectiveDateTime:'2020-05-12',valueQuantity:{value:78.5,system:'http://unitsofmeasure.org',code:'kg',unit:'kg'}};
  const procedure={resourceType:'Procedure',id:'eps007-procedure',status:'completed',code:{coding:[{system:'http://snomed.info/sct',code:'80146002',display:'Historical appendectomy'}]},subject,performedDateTime:'2015-01-01'};
  const second={...observation,id:'eps007-weight-new',effectiveDateTime:'2021-08-15',valueQuantity:{...observation.valueQuantity,value:82}};
  const mismatch={...observation,id:'eps007-wrong-unit',valueQuantity:{value:170,system:'http://unitsofmeasure.org',code:'[lb_av]',unit:'lb'}};
  bundle.entry.push(...[observation,second,mismatch,procedure].map(resource=>({fullUrl:`urn:uuid:${resource.id}`,resource})));
  const alias='urn:opentriage:eps007:equivalent-patient-namespace';
  patient.resource.identifier.push({system:alias,value:'different-current-identity',use:'official'});
  const destination={kind:'custom',elementDefinitionId:historyFieldId};
  const mappings=[{id:'history-weight',resourceType:'Observation',system:'http://loinc.org',code:'29463-7',destination,representation:'text',semanticRole:'historical-observation',expectedUnit:{system:'http://unitsofmeasure.org',code:'kg'}},{id:'history-procedure',resourceType:'Procedure',system:'http://snomed.info/sct',code:'80146002',destination,representation:'text',semanticRole:'historical-procedure'},{id:'patient-identifier',resourceType:'Patient',system:alias,code:'identifier',destination:{kind:'nemsis',elementId:'ePatient.01'},representation:'text',semanticRole:'patient-identifier'}];
  const configBody={...body,replacementSecret:undefined,clinicalMappings:mappings,patientIdentifier:{...body.patientIdentifier,aliases:[...body.patientIdentifier.aliases,alias]}};
  let config=await configuration.save(adminToken,{...configBody,expectedRevision:1});config=await configuration.test(adminToken,{expectedRevision:2});await configuration.activate(adminToken,{expectedRevision:2,expectedStateRevision:config.stateRevision,testId:config.tests.find(t=>t.revision===2).id});
  const canonical=await configuration.export(adminToken,'2');assert.deepEqual(canonical.definition.clinicalMappings,mappings);
  await query('savepoint history_transfer');
  const transferred=await configuration.save(adminToken,{expectedRevision:2,endpoint:body.endpoint,authentication:body.authentication,mapping:JSON.parse(JSON.stringify(canonical))});assert.equal(transferred.draft.mapping.sha256,canonical.sha256);
  const invalid=structuredClone(mappings);invalid[0].destination={kind:'nemsis',elementId:'eVitals.23'};
  await assert.rejects(configuration.save(adminToken,{...configBody,expectedRevision:3,clinicalMappings:invalid}),e=>e.getStatus()===422);
  await query('rollback to savepoint history_transfer');await query('release savepoint history_transfer');
  const imports=new EpsImportService(database,sessions,service,drafts),context=await service.context(token,report.id),lookup=await service.lookup(token,report.id,context.binding);
  const entryId=id=>lookup.summary.importEntries.find(e=>e.resource.id===id).identity;
  const rows=await imports.rows(token,report.id,context.binding);
  assert.equal(rows.rows.find(r=>r.entryId===entryId(observation.id)).finding,null);
  assert.equal(rows.rows.find(r=>r.entryId===entryId(mismatch.id)).finding,'historicalUnit');
  assert.ok(lookup.summary.sections.some(s=>s.rows.some(r=>r.value==='[lb_av]')),'unsupported measurement remains fully readable');
  await assert.rejects(imports.plan(otherToken,report.id,{binding:context.binding,entryId:entryId(observation.id)}));
  await epsHistoryBrowser({database,query,sessions,configuration,adminToken,token,actor,report,service,drafts,imports,binding:context.binding,historyFieldId,entryIds:{first:entryId(observation.id),second:entryId(second.id),procedure:entryId(procedure.id),patient:entryId(patient.resource.id)},canonical});
  const first=await imports.plan(token,report.id,{binding:context.binding,entryId:entryId(observation.id)});assert.equal(first.conflict,false);
  const command={planId:first.id,commandId:randomUUID(),decision:'import'};const result=await imports.apply(token,report.id,command);assert.equal((await imports.apply(token,report.id,command)).duplicate,true);
  const repeated=await imports.plan(token,report.id,{binding:context.binding,entryId:entryId(second.id)});assert.equal(repeated.conflict,true);assert.equal(repeated.canAppend,true);
  await imports.apply(token,report.id,{planId:repeated.id,commandId:randomUUID(),decision:'append'});
  const procedurePlan=await imports.plan(token,report.id,{binding:context.binding,entryId:entryId(procedure.id)});await imports.apply(token,report.id,{planId:procedurePlan.id,commandId:randomUUID(),decision:'append'});
  const occurrences=await query("select ordinal,value_text,provenance_detail from clinical.element_occurrence where report_id=$1 and tombstoned_at is null and provenance_detail ? 'epsImport' order by ordinal",[report.id]);
  assert.equal(occurrences.length,3);assert.deepEqual(occurrences.map(o=>o.ordinal),[0,1,2]);assert.match(JSON.stringify(occurrences),/2020-05-12/);assert.match(JSON.stringify(occurrences),/2015-01-01/);
  assert.equal((await query('select evidence from clinical.eps_import where id=$1',[result.id]))[0].evidence.mapping.sha256,canonical.sha256);
  const patientPlan=await imports.plan(token,report.id,{binding:context.binding,entryId:entryId(patient.resource.id)});assert.equal(patientPlan.proposedValue,'different-current-identity');assert.equal(patientPlan.conflict,true);assert.equal(patientPlan.canAppend,false);
  await imports.apply(token,report.id,{planId:patientPlan.id,commandId:randomUUID(),decision:'replace'});
  const changed=await service.context(token,report.id);assert.notEqual(changed.binding,context.binding);assert.equal((await imports.history(token,report.id)).inconsistent,true);
  await assert.rejects(service.lookup(token,report.id,context.binding),e=>e.getStatus()===409);
  assert.equal((await query('select evidence from clinical.eps_import where id=$1',[result.id]))[0].evidence.patient.value,'200207252388');
 }finally{Object.keys(fixtures[0]).forEach(k=>delete fixtures[0][k]);Object.assign(fixtures[0],original);await query('rollback to savepoint eps_history_journey');await query('release savepoint eps_history_journey');process.env.OPENTRIAGE_DEFINITIONS_ROOT=oldRoot;await rm(folder,{recursive:true,force:true});}
}
