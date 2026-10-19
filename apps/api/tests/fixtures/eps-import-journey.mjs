import {mkdtemp,rm} from 'node:fs/promises';
import {epsImportBrowser} from './eps-import-browser.mjs';
import {SignReportService} from '../../dist/reports/sign-report.service.js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {EpsImportService} from '../../dist/hospital/eps-import.service.js';
export async function epsImportJourney({database,query,sessions,configuration,adminToken,otherToken,body,token,actor,report,service,drafts,fixtures}) {
 const oldRoot=process.env.OPENTRIAGE_DEFINITIONS_ROOT,folder=await mkdtemp('/tmp/eps-import-canonical-');process.env.OPENTRIAGE_DEFINITIONS_ROOT=folder;
 await query('savepoint eps_import_journey');
 try {
  const imports=new EpsImportService(database,sessions,service,drafts);
  const [patientIdentifier]=await query("select id,group_instance_id from clinical.element_occurrence where report_id=$1 and element_id='ePatient.01'",[report.id]);
  let opening=await drafts.get(token,report.id);await drafts.save(token,report.id,{commandId:randomUUID(),expectedRevision:opening.revision,authorId:actor.user.id,occurrences:[{id:patientIdentifier.id,groupInstanceId:patientIdentifier.group_instance_id,elementId:'ePatient.01',ordinal:0,value:{kind:'text',value:'194302096997'}}]},actor.csrfToken);
  const resources=fixtures[1].entry.filter(e=>['AllergyIntolerance','Condition'].includes(e.resource.resourceType));
  const selected=['AllergyIntolerance','Condition'].map(type=>resources.find(e=>e.resource.resourceType===type));
  assert.ok(selected.every(Boolean));
  const mappings=selected.map((entry,index)=>({id:`source-${index}`,resourceType:entry.resource.resourceType,system:entry.resource.code.coding[0].system,code:entry.resource.code.coding[0].code,destination:{kind:'nemsis',elementId:'eNarrative.01'},representation:'text'}));
  let config=await configuration.save(adminToken,{...body,expectedRevision:1,replacementSecret:undefined,clinicalMappings:mappings});
  config=await configuration.test(adminToken,{expectedRevision:2});await configuration.activate(adminToken,{expectedRevision:2,expectedStateRevision:config.stateRevision,testId:config.tests.find(t=>t.revision===2).id});
  const canonical=await configuration.export(adminToken,'2');assert.deepEqual(canonical.definition.clinicalMappings,mappings);
  let current=await drafts.get(token,report.id);
  const [root]=await query("select id from clinical.group_instance where report_id=$1 and group_id='PatientCareReportGroup'",[report.id]);
  const narrative={id:randomUUID(),groupId:'eNarrativeSection',parentGroupInstanceId:root.id,ordinal:0};
  await drafts.save(token,report.id,{commandId:randomUUID(),expectedRevision:current.revision,authorId:actor.user.id,groups:[narrative]},actor.csrfToken);
  let context=await service.context(token,report.id);
  const lookup=await service.lookup(token,report.id,context.binding);
  const entryId=type=>lookup.summary.importEntries.find(e=>e.resource.resourceType===type).identity;
  let rows=await imports.rows(token,report.id,context.binding);assert.equal(rows.rows.filter(r=>!r.finding).length,2);
  await assert.rejects(imports.plan(otherToken,report.id,{binding:context.binding,entryId:entryId('AllergyIntolerance')}));
  await epsImportBrowser({imports,configuration,query,token,adminToken,reportId:report.id,binding:context.binding});
  await query('set local role open_triage_api_runtime');
  const first=await imports.plan(token,report.id,{binding:context.binding,entryId:entryId('AllergyIntolerance')});assert.equal(first.conflict,false);
  const command={planId:first.id,commandId:randomUUID(),decision:'import'};
  const result=await imports.apply(token,report.id,command);assert.equal(result.duplicate,false);
  assert.equal((await imports.apply(token,report.id,command)).duplicate,true);
  await query('reset role');
  assert.equal((await query('select count(*)::integer n from clinical.eps_import where report_id=$1',[report.id]))[0].n,1);
  const [stored]=await query('select evidence from clinical.eps_import where id=$1',[result.id]);assert.equal(stored.evidence.mapping.sha256,canonical.sha256);
  assert.equal((await query("select count(*)::integer n from clinical.element_occurrence where report_id=$1 and provenance_detail ? 'epsImport'",[report.id]))[0].n,1);
  const duplicate=await imports.plan(token,report.id,{binding:context.binding,entryId:entryId('AllergyIntolerance')});assert.equal(duplicate.alreadyImported,true);
  const second=await imports.plan(token,report.id,{binding:context.binding,entryId:entryId('Condition')});assert.equal(second.conflict,true);assert.ok(second.existing.length);
  await assert.rejects(imports.apply(token,report.id,{planId:second.id,commandId:randomUUID(),decision:'import'}),e=>e.getStatus()===409);
  await query('savepoint keep_decision');
  await imports.apply(token,report.id,{planId:second.id,commandId:randomUUID(),decision:'keep'});
  assert.equal((await query("select integration_provenance->>'decision' decision from clinical_audit.patient_access_event where report_id=$1 and action='eps.import' order by occurred_at desc limit 1",[report.id]))[0].decision,'keep');
  await query('rollback to savepoint keep_decision');
  await imports.apply(token,report.id,{planId:second.id,commandId:randomUUID(),decision:'replace'});
  const [count]=await query("select count(*)::integer n from clinical.element_occurrence where report_id=$1 and element_id='eNarrative.01' and tombstoned_at is null",[report.id]);assert.equal(count.n,1);
  assert.equal((await imports.history(token,report.id)).inconsistent,false);
  // Changing to an unknown or missing patient still exposes source inconsistency.
  const [identifier]=await query("select id,group_instance_id from clinical.element_occurrence where report_id=$1 and element_id='ePatient.01'",[report.id]);
  for(const value of ['no-summary-for-this-patient','']){
   current=await drafts.get(token,report.id);await drafts.save(token,report.id,{commandId:randomUUID(),expectedRevision:current.revision,authorId:actor.user.id,occurrences:[{id:identifier.id,groupInstanceId:identifier.group_instance_id,elementId:'ePatient.01',ordinal:0,value:{kind:'text',value}}]},actor.csrfToken);
   assert.equal((await imports.history(token,report.id)).inconsistent,true);
  }
  current=await drafts.get(token,report.id);await drafts.save(token,report.id,{commandId:randomUUID(),expectedRevision:current.revision,authorId:actor.user.id,occurrences:[{id:identifier.id,groupInstanceId:identifier.group_instance_id,elementId:'ePatient.01',ordinal:0,value:{kind:'text',value:'194302096997'}}]},actor.csrfToken);
  context=await service.context(token,report.id);
  const stalePlan=await imports.plan(token,report.id,{binding:context.binding,entryId:entryId('Condition')});
  current=await drafts.get(token,report.id);await drafts.save(token,report.id,{commandId:randomUUID(),expectedRevision:current.revision,authorId:actor.user.id,occurrences:[{id:identifier.id,groupInstanceId:identifier.group_instance_id,elementId:'ePatient.01',ordinal:0,value:{kind:'text',value:'194302096997'}}]},actor.csrfToken);
  await assert.rejects(imports.apply(token,report.id,{planId:stalePlan.id,commandId:randomUUID(),decision:'replace'}),e=>e.getStatus()===409);
  const configPlan=await imports.plan(token,report.id,{binding:context.binding,entryId:entryId('Condition')});
  config=await configuration.save(adminToken,{...body,expectedRevision:2,replacementSecret:undefined,clinicalMappings:mappings});config=await configuration.test(adminToken,{expectedRevision:3});await configuration.activate(adminToken,{expectedRevision:3,expectedStateRevision:config.stateRevision,testId:config.tests.find(t=>t.revision===3).id});
  await assert.rejects(imports.apply(token,report.id,{planId:configPlan.id,commandId:randomUUID(),decision:'replace'}),e=>e.getStatus()===409);
  assert.equal((await query('select evidence from clinical.eps_import where id=$1',[result.id]))[0].evidence.mapping.sha256,canonical.sha256);
  await query('savepoint changed_identifier_mapping');
  let alternate=await configuration.save(adminToken,{...body,expectedRevision:3,replacementSecret:undefined,clinicalMappings:mappings,patientIdentifier:{...body.patientIdentifier,field:{kind:'nemsis',elementId:'ePatient.05'}}});
  alternate=await configuration.test(adminToken,{expectedRevision:4});alternate=await configuration.activate(adminToken,{expectedRevision:4,expectedStateRevision:alternate.stateRevision,testId:alternate.tests.find(t=>t.revision===4).id});
  assert.equal((await imports.history(token,report.id)).inconsistent,true,'current patient field is authoritative even when the old field still matches');
  await configuration.activate(adminToken,{expectedRevision:4,expectedStateRevision:alternate.stateRevision},true);
  assert.equal((await imports.history(token,report.id)).inconsistent,false,'deactivated integration still compares existing pinned source identity');
  await query('rollback to savepoint changed_identifier_mapping');
  context=await service.context(token,report.id);
  // Multiple destination groups must not cause a broad replacement.
  await query('savepoint extra_group');
  await query("insert into clinical.group_instance(id,report_id,catalog_release_id,parent_group_instance_id,group_id,ordinal,created_by) values($1,$2,$3,$4,'eNarrativeSection',1,$5)",[randomUUID(),report.id,report.catalogReleaseId,root.id,actor.user.id]);
  assert.equal((await imports.rows(token,report.id,context.binding)).rows.find(r=>r.entryId===entryId('Condition')).finding,'cardinality');
  await assert.rejects(imports.plan(token,report.id,{binding:context.binding,entryId:entryId('Condition')}),e=>e.getStatus()===422);
  await query('rollback to savepoint extra_group');
  const revoked=await imports.plan(token,report.id,{binding:context.binding,entryId:entryId('Condition')});
  await query('savepoint revoked_import');await query('update app_identity.app_user set active=false where id=$1',[actor.user.id]);await assert.rejects(imports.apply(token,report.id,{planId:revoked.id,commandId:randomUUID(),decision:'replace'}));await query('rollback to savepoint revoked_import');
  await query('savepoint signed_import');current=await drafts.get(token,report.id);const signed=await new SignReportService(database,sessions).sign(token,report.id,{commandId:randomUUID(),expectedRevision:current.revision,signerId:actor.user.id,attestation:{accepted:true}});const [snapshot]=await query('select integrity_manifest from clinical.signed_snapshot where id=$1',[signed.signedSnapshotId]);assert.match(JSON.stringify(snapshot.integrity_manifest),/epsImport/);await assert.rejects(imports.apply(token,report.id,command));await query('rollback to savepoint signed_import');
 }finally{await query('rollback to savepoint eps_import_journey');await query('release savepoint eps_import_journey');process.env.OPENTRIAGE_DEFINITIONS_ROOT=oldRoot;await rm(folder,{recursive:true,force:true});}
}
