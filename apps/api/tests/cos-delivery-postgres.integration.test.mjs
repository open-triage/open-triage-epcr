import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {AmendReportService} from '../dist/reports/amend-report.service.js';
import test from 'node:test';
import {reconcileTransmissionReview} from '../dist/review/review-transmission.js';
import {AccountService} from '../dist/identity/account.service.js';
import {hospitalFixtureBaseline} from './fixtures/hospital-baseline.mjs';
import {ValidationAuthoringService} from '../dist/admin/validation-authoring.service.js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DataSource} from 'typeorm';
import {FormPublicationService} from '../dist/forms/form-publication.service.js';
import {canonicalDefinitionSha256} from '../dist/forms/form-publication.validation.js';
import {SignReportService} from '../dist/reports/sign-report.service.js';
import {remapWaitingCos} from '../dist/hospital/cos-remap.js';
import {ReviewService} from '../dist/review/review.service.js';
import {queueSignedCos} from '../dist/hospital/cos-queue.js';
import {processCosWork} from '../dist/hospital/cos-worker.js';
import {PersistentCosSimulator,CosRejected} from '../dist/hospital/cos-simulator.js';
import {COS_PROFILE} from '../dist/hospital/cos-configuration.js';
import {makePackage} from '../dist/admin/canonical-package.js';
import {bytesHash} from '../dist/hospital/cos-payload.js';
const integration=process.env.DATABASE_URL?test:test.skip;
if(process.env.REQUIRE_DATABASE_INTEGRATION&&!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
for(const run of [1,2])integration(`durable COS signature queue, separately committed receiver, restart and concurrent workers (isolated run ${run})`,async()=>{
 const db=new DataSource({type:'postgres',url:process.env.DATABASE_URL,synchronize:false});await db.initialize();
 const reports=[];let group;
 try{
  const baseline=await hospitalFixtureBaseline(db.query.bind(db));
  const sharedState=await db.query('select * from app_identity.hospital_cos_state where group_id=app_identity.organization_group($1)',[baseline.organization_id]);
  const sharedBundle=await db.query('select * from app_identity.active_configuration_bundle where organization_id=$1',[baseline.organization_id]);
  const organization=randomUUID();
  await db.query("insert into app_identity.organization(id,name,hostname,deployment_timezone) values($1,'Isolated COS delivery fixture',$2,'UTC')",[organization,`delivery-${organization}.example.invalid`]);
  const actor=await new AccountService(db).provision({organizationId:organization,username:`delivery-${randomUUID()}`,displayName:'Fictional clinician',role:'administrator',temporaryPassword:'Fictional delivery password 42!'});
  const sample={...baseline,organization_id:organization,documenting_user_id:actor.userId};
  const demographic={id:randomUUID()};
  await db.query(`insert into app_identity.agency_demographic_version(id,organization_id,catalog_release_id,version,dagency_01,dagency_02,dagency_04,definition_sha256,effective_from,created_by)
   select $1,$2,catalog_release_id,1,dagency_01,dagency_02,dagency_04,definition_sha256,clock_timestamp(),$3 from app_identity.agency_demographic_version where organization_id=$4 and catalog_release_id=$5 order by version desc limit 1`,[demographic.id,organization,actor.userId,baseline.organization_id,baseline.catalog_release_id]);
  [{id:group}]=await db.query('select app_identity.organization_group($1) id',[sample.organization_id]);
  const [previous]=await db.query('select * from app_identity.hospital_cos_state where group_id=$1',[group]);
  const form=randomUUID(),version=randomUUID(),fields=['ePatient.01','ePatient.05','eNarrative.01','eDisposition.01','eDisposition.02','eDisposition.27','eDisposition.28','eDisposition.30'];
  const definition={schemaVersion:1,sections:[{key:'cos',fields:fields.map(elementId=>({key:elementId,source:{kind:'nemsis',elementId}}))}]};
  const digest=canonicalDefinitionSha256(definition);
  await db.query("insert into forms.form(id,organization_id,slug,name) values($1,$2,$3,'COS delivery fixture')",[form,group,`cos-${form}`]);
  await db.query('insert into forms.form_version(id,form_id,catalog_release_id,version,canonical_definition,definition_sha256,created_by) values($1,$2,$3,1,$4::jsonb,$5,$6)',[version,form,sample.catalog_release_id,JSON.stringify(definition),digest,sample.documenting_user_id]);
  await new FormPublicationService(db).publish(version,{publishedBy:sample.documenting_user_id,definitionSha256:digest,changeNote:'Delivery fixture'},group);
  const validationSessions={requireCapability:async()=>({organization:{id:sample.organization_id},user:{id:sample.documenting_user_id}})};
  const validations=new ValidationAuthoringService(db,validationSessions);
  const validationDraft=await validations.create('fixture',{catalogReleaseId:baseline.catalog_release_id,displayName:'COS delivery policy'},{importedRules:[{id:randomUUID(),name:'Fictional identifier',enabled:false,severity:'error',executionTargets:['live','sign'],primaryTargetElementId:'ePatient.01',message:'Fictional identifier required',source:'require present("ePatient.01")'}]});
  const validation=await validations.publish('fixture',validationDraft.id,{expectedRevision:validationDraft.revision,displayName:validationDraft.displayName,changeNote:'COS delivery fixture'});
  for(let activation=0;activation<2;activation++)await validations.activate('fixture',validation.id,{formVersionId:version,catalogReleaseId:baseline.catalog_release_id,changeNote:'COS delivery populated configuration fixture'});
  const [pins]=await db.query('select validation_version_id,form_definition_sha256,catalog_artifact_sha256,validation_compiled_sha256 from app_identity.active_configuration_bundle where organization_id=$1',[sample.organization_id]);
  const mapping=makePackage({kind:'hospital-mapping',name:'COS delivery',version:'1',catalog:{sha256:'a'.repeat(64)},definition:{schemaVersion:1,id:randomUUID(),revision:1,authoredAt:new Date().toISOString(),author:sample.documenting_user_id,profile:COS_PROFILE,pdfLinkId:'371530004',patientIdentifier:{field:{kind:'nemsis',elementId:'ePatient.01'},namespace:'urn:oid:1.2.752.129.2.1.3.1',aliases:[]},clinicalMappings:[{id:'assessment',source:{kind:'nemsis',elementId:'eNarrative.01'},linkId:'404684003',answerType:'string'}]}});
  const settings={mode:'simulator',authentication:'api-key',template:'urn:fictional:template',encounterNamespace:'urn:fictional:encounter',organizationHsaId:'fictional-org',defaultAmbulanceCareUnit:'fictional-ambulance',staff:[{userId:sample.documenting_user_id,hsaId:'fictional-staff'}],careUnits:[{hospital:'Fictional hospital',localCareUnit:'ED',hsaId:'fictional-ed'}]};
  const next=Number(previous?.draft_revision??0)+1;
  async function config(revision,p=mapping,activate=true){await db.transaction(async m=>{
   await m.query('select group_id from app_identity.group_authentication_policy where group_id=$1 for update',[group]);
   await m.query(`insert into app_identity.hospital_cos_version(group_id,revision,credential_id,endpoint,settings,canonical_mapping,catalog_release_id,form_version_id,created_by) values($1,$2,$3,'https://cos.example.invalid',$4::jsonb,$5::jsonb,$6,$7,$8)`,[group,revision,randomUUID(),JSON.stringify(settings),JSON.stringify(p),sample.catalog_release_id,version,sample.documenting_user_id]);
   await m.query(`insert into app_identity.hospital_cos_state(group_id,draft_revision,active_revision) values($1,$2,$3) on conflict(group_id) do update set draft_revision=$2,active_revision=$3,state_revision=hospital_cos_state.state_revision+1`,[group,revision,activate?revision:null]);
  });}
  // Configuration fixture supplies immutable published inputs; lifecycle itself has separate panel tests.
  assert.deepEqual(await db.query('select * from app_identity.hospital_cos_state where group_id=app_identity.organization_group($1)',[baseline.organization_id]),sharedState);
  assert.deepEqual(await db.query('select * from app_identity.active_configuration_bundle where organization_id=$1',[baseline.organization_id]),sharedBundle);
  if(previous)await db.query('update app_identity.hospital_cos_state set active_revision=null where group_id=$1',[group]);
  async function draft(overrides={}){
   const id=randomUUID();reports.push(id);
   const incident=randomUUID(),patient=randomUUID();
   await db.query('insert into clinical.incident(id,organization_id,synthetic) values($1,$2,true)',[incident,sample.organization_id]);
   await db.query("insert into clinical.patient(id,organization_id,identity_state,pseudonymous_key,pseudonymous_key_version) values($1,$2,'unknown',$3,1)",[patient,sample.organization_id,patient.replaceAll('-','').repeat(2)]);
   await db.query(`insert into clinical.report(id,organization_id,incident_id,patient_id,agency_demographic_version_id,form_version_id,catalog_release_id,documenting_user_id,synthetic,validation_version_id,form_definition_sha256,catalog_artifact_sha256,validation_compiled_sha256) values($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11,$12)`,[id,sample.organization_id,incident,patient,demographic.id,version,sample.catalog_release_id,sample.documenting_user_id,pins.validation_version_id,pins.form_definition_sha256,pins.catalog_artifact_sha256,pins.validation_compiled_sha256]);
   const entries={'ePatient.01':'200207252388','ePatient.05':'alternate-identity','eNarrative.01':'Fictional documented assessment.','eDisposition.01':'Fictional hospital','eDisposition.02':'ED','eDisposition.27':'4227001','eDisposition.28':'4228001','eDisposition.30':'4230001',...overrides};
   for(const [element,value] of Object.entries(entries)){if(value===null)continue;const [identity]=await db.query('select e.element_identity_id,m.identifying from catalog.element_definition e join catalog.analytics_element_mapping m using(release_id,element_id) where e.release_id=$1 and e.element_id=$2',[sample.catalog_release_id,element]);
    const coded=['eDisposition.27','eDisposition.28','eDisposition.30'].includes(element);
    await db.query(`insert into clinical.element_occurrence(id,report_id,catalog_release_id,element_identity_id,element_id,analytical_repeatable,identifying,value_kind,value_text,code,code_system,author_id) values($1,$2,$3,$4,$5,false,$6,$7,$8,$9,$10,$11)`,[randomUUID(),id,sample.catalog_release_id,identity.element_identity_id,element,identity.identifying,coded?'coded':'text',coded?null:value,coded?value:null,null,sample.documenting_user_id]);
   }
   return id;
  }
  const signer=new SignReportService(db,{requireCapability:async()=>({organization:{id:sample.organization_id},user:{id:sample.documenting_user_id,displayName:'Fictional clinician'}})});
  const sign=async id=>signer.sign('fixture',id,{commandId:randomUUID(),expectedRevision:0,signerId:sample.documenting_user_id,attestation:{meaning:'author approval'}}).catch(error=>{throw new Error(JSON.stringify(error.getResponse?.()??error));});
  const old=await draft();await sign(old);assert.equal((await db.query('select id from clinical.cos_delivery where report_id=$1',[old])).length,0);
  await config(next);
  const good=await draft();const signed=await sign(good);
  await Promise.all([db.transaction(m=>queueSignedCos(m,good,signed.signedSnapshotId,sample.documenting_user_id)),db.transaction(m=>queueSignedCos(m,good,signed.signedSnapshotId,sample.documenting_user_id))]);
  assert.equal((await db.query('select id from clinical.cos_delivery where report_id=$1',[good])).length,1);
  // Recreated worker after signing finds durable work; two separate connections cannot duplicate effects.
  await Promise.all([processCosWork(db),processCosWork(db)]);
  const [stored]=await db.query('select * from clinical.cos_simulator_note where report_id=$1',[good]);assert.ok(stored);assert.equal(bytesHash(stored.pdf),stored.pdf_sha256);
  assert.equal((await db.query('select state from clinical.cos_delivery where report_id=$1',[good]))[0].state,'confirmed');
  assert.equal((await db.query('select a.id from clinical.cos_attempt a join clinical.cos_delivery d on d.id=a.delivery_id where d.report_id=$1',[good])).length,1);
  assert.equal((await db.query('select id from clinical.cos_delivery where report_id=$1',[old])).length,0,'activation never backfills');
  const missing=await draft({'ePatient.01':null});await sign(missing);await processCosWork(db);assert.equal((await db.query('select finding from clinical.cos_delivery where report_id=$1',[missing]))[0].finding,'patientIdentifier');
  const [patientItem]=await db.query("select * from clinical.review_item where report_id=$1 and kind='missing-transmission-identifiers'",[missing]);
  assert.equal(patientItem.transmission_reason,'patient-identity');assert.equal(patientItem.assignee_id,sample.documenting_user_id);
  assert.equal((await db.query('select status from clinical.report where id=$1',[missing]))[0].status,'signed');
  const [originalEvidence]=await db.query('select evidence from clinical.review_transmission_history where item_id=$1',[patientItem.id]);
  const reconcile=evidence=>db.transaction(async manager=>{await manager.query('select id from clinical.report where id=$1 for update',[missing]);await reconcileTransmissionReview(manager,missing,evidence);});
  await Promise.all([reconcile(originalEvidence.evidence),reconcile(originalEvidence.evidence)]);
  assert.equal((await db.query('select count(*)::int n from clinical.review_transmission_history where item_id=$1',[patientItem.id]))[0].n,1);
  let operationalSession={capabilities:['review:self'],organization:{id:sample.organization_id},user:{id:sample.documenting_user_id}};
  const operationalReview=new ReviewService(db,{get:async()=>operationalSession,assertCsrf:async()=>{}});
  const patientDetail=await operationalReview.item('fixture',patientItem.id,'synthetic');
  assert.deepEqual(patientDetail.transmission.missing,['patientIdentifier']);assert.equal(patientDetail.transmission.patientField.id,'ePatient.01');
  await assert.rejects(operationalReview.progress('fixture',patientItem.id,{commandId:randomUUID(),expectedVersion:patientDetail.version,dataset:'synthetic',status:'completed',outcomeOptionId:randomUUID()}),/technical workflow/);
  await assert.rejects(db.query("update clinical.review_item set status='completed' where id=$1",[patientItem.id]),/Unresolved transmission/);
  operationalSession={...operationalSession,capabilities:['review:all'],user:{id:randomUUID()}};
  assert.equal((await operationalReview.item('fixture',patientItem.id,'synthetic')).transmission,undefined);
  operationalSession={...operationalSession,capabilities:['review:all','review:identifying']};
  assert.deepEqual((await operationalReview.item('fixture',patientItem.id,'synthetic')).transmission.missing,['patientIdentifier']);
  operationalSession={...operationalSession,capabilities:['review:self']};await assert.rejects(operationalReview.item('fixture',patientItem.id,'synthetic'));
  operationalSession={...operationalSession,user:{id:sample.documenting_user_id}};await assert.rejects(operationalReview.item('fixture',patientItem.id,'real'));
  operationalSession={...operationalSession,capabilities:[]};await assert.rejects(operationalReview.item('fixture',patientItem.id,'synthetic'));
  // Both categories share all remaining requirements and independently configurable routing.
  const allMissing={...originalEvidence.evidence,missing:['patientIdentifier','staff','careUnit','encounter']};
  await reconcile(allMissing);
  const [mappingItem]=await db.query("select * from clinical.review_item where report_id=$1 and transmission_reason='integration-mapping'",[missing]);
  assert.equal(mappingItem.assignee_id,null);
  operationalSession={...operationalSession,capabilities:['review:all','review:admin','review:identifying']};
  const routes=await operationalReview.routes('fixture');const mappingRoute=routes.find(route=>route.transmissionReason==='integration-mapping');
  assert.ok(mappingRoute);assert.equal(routes.find(route=>route.transmissionReason==='patient-identity').route,'author');
  await operationalReview.configureRoute('fixture',mappingRoute.criterionId,{commandId:randomUUID(),expectedVersion:0,route:'named',namedUserId:sample.documenting_user_id,independentReview:false});
  const namedReport=await draft({'eDisposition.02':null});await sign(namedReport);await processCosWork(db);
  const [namedItem]=await db.query("select * from clinical.review_item where report_id=$1 and transmission_reason='integration-mapping'",[namedReport]);assert.equal(namedItem.assignee_id,sample.documenting_user_id);
  await reconcile({...originalEvidence.evidence,missing:[]});assert.equal((await db.query('select status from clinical.review_item where id=$1',[patientItem.id]))[0].status,'completed');
  await reconcile(originalEvidence.evidence);const [recurred]=await db.query('select status,reopened,outcome_option_id from clinical.review_item where id=$1',[patientItem.id]);assert.deepEqual(recurred,{status:'new',reopened:true,outcome_option_id:null});
  assert.equal((await db.query('select count(*)::int n from clinical.review_item where report_id=$1 and transmission_reason is not null',[missing]))[0].n,2);

  const cancelled=await draft({'eDisposition.27':'4227005'});await sign(cancelled);await processCosWork(db);assert.equal((await db.query('select state from clinical.cos_delivery where report_id=$1',[cancelled]))[0].state,'excluded');
  const simulator=new PersistentCosSimulator(db);
  const outage=await draft();await sign(outage);await processCosWork(db,10,{contact:async()=>{throw new CosRejected('outage');},note:simulator.note.bind(simulator)});
  assert.equal((await db.query('select state from clinical.cos_delivery where report_id=$1',[outage]))[0].state,'failed');
  const partial=await draft();await sign(partial);await processCosWork(db,10,{contact:simulator.contact.bind(simulator),note:async()=>{throw new CosRejected('noteRejected');}});
  assert.equal((await db.query('select report_id from clinical.cos_simulator_contact where report_id=$1',[partial])).length,1);assert.equal((await db.query('select state from clinical.cos_delivery where report_id=$1',[partial]))[0].state,'failed');
  for(const stage of ['contact','note']){
   const id=await draft();await sign(id);await processCosWork(db,10,{contact:async(...args)=>{const r=await simulator.contact(...args);if(stage==='contact')throw new Error('lost contact acknowledgment');return r;},note:async(...args)=>{await simulator.note(...args);throw new Error('lost note acknowledgment');}});
   assert.equal((await db.query('select state from clinical.cos_delivery where report_id=$1',[id]))[0].state,'uncertain');
   await processCosWork(db);assert.equal((await db.query('select count(*)::int count from clinical.cos_attempt a join clinical.cos_delivery d on d.id=a.delivery_id where d.report_id=$1',[id]))[0].count,1,'restart never blind resends');
  }
  const pinned=await draft();await sign(pinned);
  const {format,schemaVersion,sha256,...portable}=mapping;
  const newer=makePackage({...portable,version:'2',definition:{...mapping.definition,revision:2,patientIdentifier:{...mapping.definition.patientIdentifier,field:{kind:'nemsis',elementId:'ePatient.05'}}}});
  await config(next+1,newer);await processCosWork(db);
  const [pin]=await db.query('select d.mapping_sha256,p.bundle from clinical.cos_delivery d join clinical.cos_payload p on p.delivery_id=d.id where d.report_id=$1',[pinned]);assert.equal(pin.mapping_sha256,mapping.sha256);assert.equal(pin.bundle.entry[0].resource.subject.identifier.value,'200207252388');
  const [waiting]=await db.query('select * from clinical.cos_delivery where report_id=$1',[missing]);
  const [remapState]=await db.query('select state_revision from app_identity.hospital_cos_state where group_id=$1',[group]);
  let remapActor={capabilities:['settings:write','review:self'],organization:{id:sample.organization_id},user:{id:sample.documenting_user_id}};
  const remapSessions={lockPersonalAuthenticationContext:async()=>{},requireCapability:async(_token,capability)=>{assert.equal(capability,'settings:write');if(!remapActor.capabilities.includes(capability))throw new Error('denied');return remapActor;}};
  const remapInput={dataset:'synthetic',reportId:missing,parentId:waiting.id,commandId:randomUUID(),configurationRevision:next+1,stateRevision:Number(remapState.state_revision)};
  await assert.rejects(remapWaitingCos(db,remapSessions,'fixture',{...remapInput,dataset:'real'}));
  remapActor={...remapActor,capabilities:['review:self']};await assert.rejects(remapWaitingCos(db,remapSessions,'fixture',remapInput));
  remapActor={...remapActor,capabilities:['settings:write','review:self'],user:{id:randomUUID()}};await assert.rejects(remapWaitingCos(db,remapSessions,'fixture',remapInput));
  remapActor={...remapActor,user:{id:sample.documenting_user_id}};
  const child=await remapWaitingCos(db,remapSessions,'fixture',remapInput);assert.equal(await remapWaitingCos(db,remapSessions,'fixture',remapInput),child);
  assert.equal((await db.query('select state from clinical.cos_delivery where id=$1',[waiting.id]))[0].state,'superseded');
  const [lineage]=await db.query('select lineage_parent_id,mapping_sha256 from clinical.cos_delivery where id=$1',[child]);assert.equal(lineage.lineage_parent_id,waiting.id);assert.equal(lineage.mapping_sha256,newer.sha256);
  assert.equal((await db.query('select mapping_sha256 from clinical.cos_delivery where id=$1',[waiting.id]))[0].mapping_sha256,mapping.sha256);
  await processCosWork(db);assert.equal((await db.query('select state from clinical.cos_delivery where id=$1',[child]))[0].state,'confirmed');
  for(const unsafe of await db.query("select id,report_id from clinical.cos_delivery where group_id=$1 and state in ('confirmed','uncertain') limit 20",[group]))await assert.rejects(remapWaitingCos(db,remapSessions,'fixture',{...remapInput,commandId:randomUUID(),parentId:unsafe.id,reportId:unsafe.report_id}));
  const alternate=await draft();await sign(alternate);await processCosWork(db);assert.equal((await db.query('select p.bundle from clinical.cos_payload p join clinical.cos_delivery d on d.id=p.delivery_id where d.report_id=$1',[alternate]))[0].bundle.entry[0].resource.subject.identifier.value,'alternate-identity');
  const paused=await draft();await sign(paused);await db.query('update app_identity.hospital_cos_state set active_revision=null where group_id=$1',[group]);await processCosWork(db);assert.equal((await db.query('select state from clinical.cos_delivery where report_id=$1',[paused]))[0].state,'pending');
  await db.query('update app_identity.hospital_cos_state set active_revision=$2 where group_id=$1',[group,next+1]);await processCosWork(db);assert.equal((await db.query('select state from clinical.cos_delivery where report_id=$1',[paused]))[0].state,'confirmed');
  // Live report scope also protects delivery status; no identifying payload is returned.
  let session={capabilities:['review:self'],organization:{id:sample.organization_id},user:{id:sample.documenting_user_id}};
  const review=new ReviewService(db,{get:async()=>session});
  const viewed=await review.report('fixture',good,'synthetic');assert.equal(viewed.cosDelivery.state,'confirmed');assert.equal(viewed.cosDelivery.simulated,true);
  assert.doesNotMatch(JSON.stringify(viewed.cosDelivery),/200207252388|fictional-staff|Fictional documented/);
  session={...session,user:{id:randomUUID()}};await assert.rejects(review.report('fixture',good,'synthetic'));
  session={...session,user:{id:sample.documenting_user_id},organization:{id:randomUUID()}};await assert.rejects(review.report('fixture',good,'synthetic'));
  session={...session,organization:{id:sample.organization_id}};await assert.rejects(review.report('fixture',good,'real'));
  session={...session,capabilities:[]};await assert.rejects(review.report('fixture',good,'synthetic'));
  // Force activation/deactivation to commit after signing's snapshot is established.
  // The shared group lock and state-row lock cause SERIALIZABLE retry, never stale routing.
  for(const enabled of [false,true]){
   const id=await draft(),activation=db.createQueryRunner();await activation.connect();await activation.startTransaction();
   await activation.query('select group_id from app_identity.group_authentication_policy where group_id=$1 for update',[group]);
   await activation.query('update app_identity.hospital_cos_state set active_revision=$2 where group_id=$1',[group,enabled?next+1:null]);
   let released=false;
   const racingDatabase={transaction:(isolation,work)=>db.transaction(isolation,m=>work({query:async(sql,args)=>{
    if(!released&&sql.includes('group_authentication_policy')){released=true;await activation.commitTransaction();}
    return m.query(sql,args);
   }}))};
   const raceSigner=new SignReportService(racingDatabase,{requireCapability:async()=>({organization:{id:sample.organization_id},user:{id:sample.documenting_user_id,displayName:'Fictional clinician'}})});
   try{await raceSigner.sign('fixture',id,{commandId:randomUUID(),expectedRevision:0,signerId:sample.documenting_user_id,attestation:{meaning:'author approval'}});}finally{if(activation.isTransactionActive)await activation.rollbackTransaction();await activation.release();}
   assert.equal((await db.query('select id from clinical.cos_delivery where report_id=$1',[id])).length,enabled?1:0);
  }
  const runtime=new DataSource({type:'postgres',url:process.env.DATABASE_URL,synchronize:false,extra:{options:'-c role=open_triage_api_runtime'}});await runtime.initialize();
  try{await processCosWork(runtime);}finally{await runtime.destroy();}
  assert.equal((await db.query("select count(*)::int count from clinical.cos_delivery where group_id=$1 and state='pending'",[group]))[0].count,0);
  // Deactivation wins while preparation still has an older database snapshot.
  const deactivateReport=await draft();await sign(deactivateReport);
  const changing=db.createQueryRunner();await changing.connect();await changing.startTransaction();
  await changing.query('update app_identity.hospital_cos_state set active_revision=null where group_id=$1',[group]);
  let changed=false;
  const racingWorkerDb={query:db.query.bind(db),transaction:db.transaction.bind(db),createQueryRunner:()=>{
   const runner=db.createQueryRunner(),query=runner.query.bind(runner);
   runner.query=async(sql,...args)=>{
    if(!changed&&sql.includes('select d.*,v.settings')){await query('select 1');changed=true;await changing.commitTransaction();}
    return query(sql,...args);
   };return runner;
  }};
  try{await assert.rejects(processCosWork(racingWorkerDb),error=>error.driverError?.code==='40001');}finally{if(changing.isTransactionActive)await changing.rollbackTransaction();await changing.release();}
  assert.equal((await db.query('select state from clinical.cos_delivery where report_id=$1',[deactivateReport]))[0].state,'pending');
  assert.equal((await db.query('select report_id from clinical.cos_simulator_contact where report_id=$1',[deactivateReport])).length,0);
  await processCosWork(db);assert.equal((await db.query('select report_id from clinical.cos_simulator_contact where report_id=$1',[deactivateReport])).length,0);
  await db.query('update app_identity.hospital_cos_state set active_revision=$2 where group_id=$1',[group,next+1]);
  await processCosWork(db);
  const [language]=await db.query("select coalesce((select language from app_identity.agency_settings where organization_id=$1),'en') language",[sample.organization_id]);
  assert.equal((await db.query('select pdf_language from clinical.cos_delivery where report_id=$1',[good]))[0].pdf_language,language.language);
  // Actual signed amendments, independent receiver commits, and one-note replacement.
  const amendService=new AmendReportService(db);
  async function amend(id,sequence,text,field='eNarrative.01'){
   const [target]=await db.query('select id from clinical.element_occurrence where report_id=$1 and element_id=$2',[id,field]);
   return amendService.amend(id,{commandId:randomUUID(),expectedSequence:sequence,authorId:sample.documenting_user_id,reason:'Fictional signed correction',attestation:{meaning:'author approval'},changes:[{action:'replace',targetElementOccurrenceId:target.id,value:{kind:'text',value:text}}]});
  }
  const queued=await draft();await sign(queued);await amend(queued,1,'First correction');await amend(queued,2,'Newest correction');
  assert.deepEqual((await db.query('select state from clinical.cos_delivery where report_id=$1 order by amendment_sequence',[queued])).map(x=>x.state),['superseded','superseded','pending']);
  await Promise.all([processCosWork(db),processCosWork(db)]);
  const current=async id=>(await db.query('select c.*,n.bundle,n.pdf,n.pdf_sha256 from clinical.cos_simulator_current c join clinical.cos_simulator_note n on n.delivery_id=c.delivery_id where c.report_id=$1',[id]))[0];
  const latest=await current(queued);assert.equal(latest.amendment_sequence,2);assert.equal(latest.bundle.entry[0].resource.item[0].answer[0].valueString,'Newest correction');assert.equal(bytesHash(latest.pdf),latest.pdf_sha256);
  const pdfDocument=await getDocument({data:new Uint8Array(latest.pdf),useSystemFonts:false}).promise;
  let pdfText='';try{for(let page=1;page<=pdfDocument.numPages;page++)pdfText+=(await (await pdfDocument.getPage(page)).getTextContent()).items.map(x=>x.str).join(' ');}finally{await pdfDocument.destroy();}
  assert.match(pdfText,/Newest correction/);assert.match(pdfText,/First correction/);assert.match(pdfText,/Fictional clinician/);
  const corrected=await amend(queued,3,'corrected-identity','ePatient.05');await processCosWork(db);
  const correctedNote=await current(queued);assert.equal(correctedNote.amendment_sequence,3);assert.equal(correctedNote.contact.patient.value,'corrected-identity');assert.equal(correctedNote.bundle.entry[0].resource.authored,corrected.signedAt);
  assert.equal((await db.query('select count(*)::int count from clinical.cos_simulator_contact where report_id=$1',[queued]))[0].count,1);
  // Hold the first remote note call after its durable intent. New signatures remain possible.
  let entered,release;const arrived=new Promise(r=>entered=r),barrier=new Promise(r=>release=r);
  const racing=await draft();await sign(racing);
  const delayed=processCosWork(db,100,{contact:simulator.contact.bind(simulator),note:async(...args)=>{entered();await barrier;return simulator.note(...args);}});
  await arrived;await amend(racing,1,'Intermediate correction');
  const third=makePackage({...portable,version:'3',definition:{...newer.definition,revision:3,clinicalMappings:[{...newer.definition.clinicalMappings[0],linkId:'123456789'}]}});
  await config(next+2,third);await amend(racing,2,'Latest mapped correction');
  await processCosWork(db);assert.equal(await current(racing),undefined,'newer worker cannot pass live report lock');
  release();await delayed;await processCosWork(db);
  const raced=await current(racing);assert.equal(raced.amendment_sequence,2);assert.equal(raced.bundle.entry[0].resource.item[0].linkId,'123456789');
  const prepared=await db.query('select d.amendment_sequence,d.mapping_sha256,p.* from clinical.cos_delivery d join clinical.cos_payload p on p.delivery_id=d.id where d.report_id=$1 order by d.amendment_sequence',[racing]);
  assert.deepEqual(prepared.map(x=>[x.amendment_sequence,x.mapping_sha256]),[[0,newer.sha256],[2,third.sha256]]);
  const earlier=prepared[0];await assert.rejects(simulator.note(racing,earlier.delivery_id,{...earlier,payloadSha256:earlier.payload_sha256,pdfSha256:earlier.pdf_sha256,contactSha256:earlier.contact_sha256,amendmentSequence:0}),{code:'identityConflict'});
  assert.equal((await current(racing)).delivery_id,raced.delivery_id,'late receiver replay cannot replace newest note');
  // Lost acknowledgment must remain a durable barrier, including after session lock release/restart.
  for(const stage of ['contact','note']){
   const unknown=await draft();await sign(unknown);
   await processCosWork(db,100,{contact:async(...args)=>{const evidence=await simulator.contact(...args);if(stage==='contact')throw new Error('lost acknowledgement');return evidence;},note:async(...args)=>{await simulator.note(...args);throw new Error('lost acknowledgement');}});
   await amend(unknown,1,'Blocked correction');await amend(unknown,2,'Newest blocked correction');
   await Promise.all([processCosWork(db),processCosWork(db)]);
   const versions=await db.query('select state,amendment_sequence from clinical.cos_delivery where report_id=$1 order by amendment_sequence',[unknown]);assert.deepEqual(versions.map(x=>x.state),['uncertain','superseded','pending']);
   assert.equal((await db.query('select count(*)::int count from clinical.cos_attempt where report_id=$1',[unknown]))[0].count,1);
   assert.equal((await current(unknown))?.amendment_sequence,stage==='note'?0:undefined);
  }
  // Remote processing can continue AFTER the local call fails and releases its lock.
  const remoteLate=await draft();await sign(remoteLate);let completeRemote;
  await processCosWork(db,100,{contact:simulator.contact.bind(simulator),note:async(...args)=>{completeRemote=()=>simulator.note(...args);throw new Error('transport ended before remote processing');}});
  await amend(remoteLate,1,'Must wait for reconciliation');await processCosWork(db);
  assert.equal(await current(remoteLate),undefined);await completeRemote();await processCosWork(db);
  assert.equal((await current(remoteLate)).amendment_sequence,0);
  assert.equal((await db.query('select count(*)::int count from clinical.cos_attempt where report_id=$1',[remoteLate]))[0].count,1,'lease/session release is not remote completion');
  const independent=await draft();await sign(independent);await processCosWork(db,1);
  assert.equal((await current(independent)).amendment_sequence,0,'uncertain reports must not starve independent work in bounded batches');
  // Immutable payload/evidence and runtime privilege boundaries.
  await assert.rejects(db.query('update clinical.cos_payload set pdf=$2 where delivery_id=$1',[stored.delivery_id,Buffer.from('tampered')]));
  await assert.rejects(db.query("update clinical.cos_attempt set mapping_revision=999 where delivery_id=$1",[stored.delivery_id]));
  const [permissions]=await db.query("select has_table_privilege('open_triage_analyst','clinical.cos_payload','select') analyst,has_table_privilege('open_triage_api_runtime','clinical.cos_payload','update') mutable");assert.deepEqual(permissions,{analyst:false,mutable:false});
  const rollback=new Error('rollback retention fixture');
  await assert.rejects(db.transaction(async manager=>{
   await manager.query(`insert into clinical_audit.synthetic_purge_tombstone(record_type,record_id,organization_id,server_created_at,expired_at,purged_at) values('report',$1,$2,clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day',clock_timestamp())`,[good,sample.organization_id]);
   await manager.query("select set_config('open_triage.synthetic_purge_report',$1,true)",[good]);
   await manager.query('delete from clinical.signed_snapshot where report_id=$1',[good]);
   assert.equal((await manager.query('select delivery_id from clinical.cos_payload where report_id=$1',[good])).length,0);
   assert.equal((await manager.query('select delivery_id from clinical.cos_simulator_note where report_id=$1',[good])).length,0);
   throw rollback;
  }),error=>error===rollback);
  await assert.rejects(db.transaction(async manager=>{
   await manager.query(`insert into clinical_audit.synthetic_purge_tombstone(record_type,record_id,organization_id,server_created_at,expired_at,purged_at) values('report',$1,$2,clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day',clock_timestamp())`,[missing,sample.organization_id]);
   await manager.query("select set_config('open_triage.synthetic_purge_report',$1,true)",[missing]);
   await manager.query('delete from clinical.signed_snapshot where report_id=$1',[missing]);
   assert.equal((await manager.query('select id from clinical.review_transmission_history where report_id=$1',[missing])).length,0);
   throw rollback;
  }),error=>error===rollback);
  assert.deepEqual(await db.query('select * from app_identity.hospital_cos_state where group_id=app_identity.organization_group($1)',[baseline.organization_id]),sharedState);
  assert.deepEqual(await db.query('select * from app_identity.active_configuration_bundle where organization_id=$1',[baseline.organization_id]),sharedBundle);
  if(previous)await db.query('update app_identity.hospital_cos_state set active_revision=$2 where group_id=$1',[group,previous.active_revision]);else await db.query('update app_identity.hospital_cos_state set active_revision=null where group_id=$1',[group]);
 }finally{if(group)await db.query('update app_identity.hospital_cos_state set active_revision=null where group_id=$1',[group]);await db.destroy();}
});
