import {catalogElements} from '../../dist/review/analytics-catalog.js';
import {mkdtemp,rm} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {EpsImportService} from '../../dist/hospital/eps-import.service.js';
import {SignReportService} from '../../dist/reports/sign-report.service.js';
import {epsImportBrowser} from './eps-import-browser.mjs';
export async function epsMedicationJourney({database,query,sessions,configuration,adminToken,body,token,actor,report,service,drafts,fixtures,historyFieldId}) {
 const oldRoot=process.env.OPENTRIAGE_DEFINITIONS_ROOT,folder=await mkdtemp('/tmp/eps-medication-');process.env.OPENTRIAGE_DEFINITIONS_ROOT=folder;
 await query('savepoint eps_medication');const original=structuredClone(fixtures[0]);
 try {
  const patient=fixtures[0].entry.find(e=>e.resource.resourceType==='Patient');
  const product={resourceType:'Medication',id:'history-product',code:{coding:[{system:'http://www.whocc.no/atc',code:'C09AA02',display:'Enalapril'}]}};
  fixtures[0].entry=fixtures[0].entry.filter(e=>!['MedicationStatement','AllergyIntolerance','Condition'].includes(e.resource.resourceType));
  fixtures[0].entry.push({fullUrl:'urn:uuid:history-product',resource:product});
  for(const [id,dose,route] of [['first',10,'26643006'],['second',20,'47625008'],['unmapped',5,'26643006']])fixtures[0].entry.push({fullUrl:`urn:uuid:medication-${id}`,resource:{resourceType:'MedicationStatement',id,status:'active',subject:{reference:patient.fullUrl},...(id==='unmapped'?{medicationCodeableConcept:{coding:[{system:'urn:unsupported',code:'unmapped'}]}}:{medicationReference:{reference:'urn:uuid:history-product'}}),effectivePeriod:{start:'2020-01-01',end:'2021-01-01'},dateAsserted:'2021-03-01',dosage:[{route:{coding:[{system:'http://snomed.info/sct',code:route}]},doseAndRate:[{doseQuantity:{value:dose,unit:'mg',system:'http://unitsofmeasure.org',code:'mg'}}]}]}});
  const mappings=[{id:'medication',resourceType:'MedicationStatement',semanticRole:'medication-history',system:'http://www.whocc.no/atc',code:'C09AA02',destination:{kind:'custom',elementDefinitionId:historyFieldId},representation:'text'}];
  let config=await configuration.save(adminToken,{...body,expectedRevision:1,replacementSecret:undefined,clinicalMappings:mappings});
  config=await configuration.test(adminToken,{expectedRevision:2});await configuration.activate(adminToken,{expectedRevision:2,expectedStateRevision:config.stateRevision,testId:config.tests.find(t=>t.revision===2).id});
  const canonical=await configuration.export(adminToken,'2');assert.deepEqual(canonical.definition.clinicalMappings,mappings);
  const context=await service.context(token,report.id),imports=new EpsImportService(database,sessions,service,drafts);
  const rows=await imports.rows(token,report.id,context.binding);assert.equal(rows.rows.filter(r=>!r.finding).length,2);assert.equal(rows.rows.find(r=>r.entryId==='urn:uuid:medication-unmapped').finding,'unmapped');
  await epsImportBrowser({imports,configuration,query,token,adminToken,reportId:report.id,binding:context.binding,medication:true});
  const first=await imports.plan(token,report.id,{binding:context.binding,entryId:'urn:uuid:medication-first'});assert.equal(first.conflict,false);assert.equal(first.canAppend,true);
  await assert.rejects(imports.apply(token,report.id,{planId:first.id,commandId:randomUUID(),decision:'append'}),e=>e.getStatus()===409);
  const firstCommand={planId:first.id,commandId:randomUUID(),decision:'import'};const imported=await imports.apply(token,report.id,firstCommand);
  const [stored]=await query('select occurrence_id,evidence from clinical.eps_import where id=$1',[imported.id]);
  assert.equal(stored.evidence.mapping.sha256,canonical.sha256);const [before]=await query('select * from clinical.element_occurrence where id=$1',[stored.occurrence_id]);
  const second=await imports.plan(token,report.id,{binding:context.binding,entryId:'urn:uuid:medication-second'});assert.equal(second.conflict,true);assert.equal(second.canAppend,true);assert.match(second.incoming,/value: 20/);assert.match(second.incoming,/47625008/);assert.match(second.existing.join(),/value: 10/);
  const append={planId:second.id,commandId:randomUUID(),decision:'append'};await imports.apply(token,report.id,append);assert.equal((await imports.apply(token,report.id,append)).duplicate,true);
  assert.deepEqual((await query('select * from clinical.element_occurrence where id=$1',[stored.occurrence_id]))[0],before,'append cannot overwrite previous occurrence or lineage');
  assert.equal((await query("select count(*)::int n from clinical.element_occurrence where report_id=$1 and provenance_detail ? 'epsImport' and tombstoned_at is null",[report.id]))[0].n,2);
  assert.equal((await query("select count(*)::int n from clinical.element_occurrence where report_id=$1 and element_id like 'eMedications.%'",[report.id]))[0].n,0);
  assert.equal((await imports.plan(token,report.id,{binding:context.binding,entryId:'urn:uuid:medication-second'})).alreadyImported,true);
  const current=await drafts.get(token,report.id);const signed=await new SignReportService(database,sessions).sign(token,report.id,{commandId:randomUUID(),expectedRevision:current.revision,signerId:actor.user.id,attestation:{accepted:true}});
  const [snapshot]=await query('select integrity_manifest from clinical.signed_snapshot where id=$1',[signed.signedSnapshotId]);assert.match(JSON.stringify(snapshot.integrity_manifest),/history-product/);assert.match(JSON.stringify(snapshot.integrity_manifest),/C09AA02/);assert.match(JSON.stringify(snapshot.integrity_manifest),/2020-01-01/);
  const reviewer=await sessions.get(adminToken);
  const scope={organizationId:actor.organization.id,userId:reviewer.user.id,reports:'all',identifying:false,defaultDataset:'synthetic'};
  assert.ok(!(await catalogElements({query},scope,undefined,false)).some(e=>e.id.startsWith(`custom:${historyFieldId}:`)),'other reviewer cannot discover identifying imported source text');
  assert.ok((await catalogElements({query},{...scope,userId:actor.user.id},undefined,false)).some(e=>e.id.startsWith(`custom:${historyFieldId}:`)),'own-report clinician still sees their medication history field');
 } finally {fixtures[0]=original;await query('rollback to savepoint eps_medication');await query('release savepoint eps_medication');process.env.OPENTRIAGE_DEFINITIONS_ROOT=oldRoot;await rm(folder,{recursive:true,force:true});}
}
