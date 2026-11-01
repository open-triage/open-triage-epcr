import {epsImportBrowser} from './eps-import-browser.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {EpsImportService} from '../../dist/hospital/eps-import.service.js';
export async function epsCrosswalkJourney({database,query,sessions,configuration,adminToken,body,token,actor,report,service,drafts,fixtures}) {
 await query('savepoint eps_crosswalk');const original=structuredClone(fixtures[0]);
 try {
  const patient=fixtures[0].entry.find(e=>e.resource.resourceType==='Patient');
  fixtures[0].entry=fixtures[0].entry.filter(e=>!['MedicationStatement','AllergyIntolerance','Condition'].includes(e.resource.resourceType));
  const mappings=[];
  for(const [code,target,label] of [['B01AF02','1364430','apixaban'],['C09AA05','35296','ramipril']]){
   fixtures[0].entry.push({fullUrl:`urn:uuid:crosswalk-${code}`,resource:{resourceType:'MedicationStatement',id:code,status:'active',subject:{reference:patient.fullUrl},medicationCodeableConcept:{coding:[{system:'http://www.whocc.no/atc',code}]},dosage:[{text:'Original regimen retained'}]}});
   mappings.push({id:code,resourceType:'MedicationStatement',semanticRole:'medication-history',system:'http://www.whocc.no/atc',code,destination:{kind:'nemsis',elementId:'eHistory.12'},representation:'coded',crosswalk:{system:'RxNorm',code:target,display:label,relationship:'broader',reference:`https://rxnav.nlm.nih.gov/REST/rxcui/${target}/properties.json`}});
  }
  const allergyMappings=[['penicillin','Z88.0'],['sulfa','Z88.2']].map(([code,target])=>({id:code,resourceType:'AllergyIntolerance',system:'urn:fictional:allergen',code,destination:{kind:'nemsis',elementId:'eHistory.06'},representation:'coded',crosswalk:{system:'ICD-10-CM',code:target,display:code,relationship:'broader',reference:'https://nemsis.org/'}}));
  let config=await configuration.save(adminToken,{...body,expectedRevision:1,replacementSecret:undefined,clinicalMappings:[...mappings,...allergyMappings]});
  config=await configuration.test(adminToken,{expectedRevision:2});await configuration.activate(adminToken,{expectedRevision:2,expectedStateRevision:config.stateRevision,testId:config.tests.find(t=>t.revision===2).id});
  const context=await service.context(token,report.id),imports=new EpsImportService(database,sessions,service,drafts);
  await query('savepoint empty_history_crosswalk');
  const emptyPlan=await imports.plan(token,report.id,{binding:context.binding,entryId:'urn:uuid:crosswalk-B01AF02'});
  await imports.apply(token,report.id,{planId:emptyPlan.id,commandId:randomUUID(),decision:'import'});
  assert.equal((await query("select count(*)::int n from clinical.group_instance where report_id=$1 and group_id in ('eHistorySection','eHistory.CurrentMedsGroup')",[report.id]))[0].n,2);
  await query('rollback to savepoint empty_history_crosswalk');await query('release savepoint empty_history_crosswalk');
  const [root]=await query("select id from clinical.group_instance where report_id=$1 and group_id='PatientCareReportGroup'",[report.id]);
  const history={id:randomUUID(),groupId:'eHistorySection',parentGroupInstanceId:root.id,ordinal:0};
  const existing={id:randomUUID(),groupId:'eHistory.CurrentMedsGroup',parentGroupInstanceId:history.id,ordinal:0};
  let current=await drafts.get(token,report.id);
  await drafts.save(token,report.id,{commandId:randomUUID(),expectedRevision:current.revision,authorId:actor.user.id,groups:[history,existing],occurrences:[{id:randomUUID(),groupInstanceId:existing.id,elementId:'eHistory.13',ordinal:0,value:{kind:'numeric',value:17}}]},actor.csrfToken);
  const before=await query('select * from clinical.element_occurrence where group_instance_id=$1',[existing.id]);
  assert.equal((await imports.rows(token,report.id,context.binding)).rows.filter(r=>!r.finding).length,2);
  await epsImportBrowser({imports,configuration,query,token,adminToken,reportId:report.id,binding:context.binding,crosswalk:true});
  for(const mapping of mappings){
   const plan=await imports.plan(token,report.id,{binding:context.binding,entryId:`urn:uuid:crosswalk-${mapping.code}`});
   assert.equal(plan.projection,'medication-identity');assert.match(plan.proposedValue,new RegExp(mapping.crosswalk.code));assert.match(plan.incoming,/Original regimen retained/);assert.equal(plan.conflict,false);
   const command={planId:plan.id,commandId:randomUUID(),decision:'import'};
   await imports.apply(token,report.id,command);assert.equal((await imports.apply(token,report.id,command)).duplicate,true);
  }
  for(const mapping of allergyMappings){
   fixtures[0].entry.push({fullUrl:`urn:uuid:allergy-${mapping.code}`,resource:{resourceType:'AllergyIntolerance',type:'allergy',id:mapping.code,patient:{reference:patient.fullUrl},code:{coding:[{system:mapping.system,code:mapping.code}]},clinicalStatus:{coding:[{system:'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',code:'active'}]},verificationStatus:{coding:[{system:'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification',code:'confirmed'}]}}});
   const plan=await imports.plan(token,report.id,{binding:context.binding,entryId:`urn:uuid:allergy-${mapping.code}`});
   assert.equal(plan.canAppend,true);assert.equal(plan.projection,'allergy-code');
   await imports.apply(token,report.id,{planId:plan.id,commandId:randomUUID(),decision:plan.conflict?'append':'import'});
  }
  const allergies=await query("select code from clinical.element_occurrence where report_id=$1 and element_id='eHistory.06' and tombstoned_at is null order by code",[report.id]);assert.deepEqual(allergies.map(a=>a.code),['Z88.0','Z88.2']);
  const same=await imports.plan(token,report.id,{binding:context.binding,entryId:'urn:uuid:allergy-penicillin'});assert.equal(same.alreadyImported,true);assert.equal(same.canAppend,false);
  const stored=await query("select code,code_system,group_instance_id,provenance_detail from clinical.element_occurrence where report_id=$1 and element_id='eHistory.12' and tombstoned_at is null order by code",[report.id]);
  assert.equal(stored.length,2);assert.equal(new Set(stored.map(r=>r.group_instance_id)).size,2);assert.ok(stored.every(r=>r.group_instance_id!==existing.id&&r.code_system==='RxNorm'));
  assert.ok(stored.every(r=>r.provenance_detail.epsImport.crosswalk.reference.startsWith('https://rxnav.nlm.nih.gov/')));
  assert.deepEqual(await query('select * from clinical.element_occurrence where group_instance_id=$1',[existing.id]),before);
  assert.equal((await query("select count(*)::int n from clinical.element_occurrence where report_id=$1 and element_id like 'eMedications.%'",[report.id]))[0].n,0);
 } finally {fixtures[0]=original;await query('rollback to savepoint eps_crosswalk');await query('release savepoint eps_crosswalk');}
}
