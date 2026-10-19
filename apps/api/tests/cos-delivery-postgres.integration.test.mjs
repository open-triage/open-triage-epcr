import {reconcileCosReview} from '../dist/hospital/cos-reconcile.js';
import sharp from 'sharp';
import {signedReportPdfSource} from '../dist/reports/signed-report-pdf.persistence.js';
import {CatalogAuthoringService} from '../dist/admin/catalog-authoring.service.js';
import {identifierCorrectionContext,correctReviewIdentifier} from '../dist/review/review-identifier-correction.js';

import {AuditService} from '../dist/admin/audit.service.js';
import {retryCosReview} from '../dist/hospital/cos-retry.js';
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
  const customIdentity={id:randomUUID(),namespace:'org.correction.fixture',slug:`identity${randomUUID().replaceAll('-','')}`,title:'Verified patient identity',definition:'Explicit alternative identifying field',datatype:'string',recurrence:'single',usage:'Optional',constraints:{maxLength:12},identifying:true};
  const catalogs=new CatalogAuthoringService(db,{requireCapability:async()=>({organization:{id:organization},user:{id:actor.userId}})});
  const catalogDraft=await catalogs.cloneActive('fixture',{sourceVersionId:sample.catalog_release_id,displayName:'Identifier correction catalog'});
  const catalogSaved=await catalogs.save('fixture',catalogDraft.id,{expectedRevision:catalogDraft.revision,displayName:catalogDraft.displayName,definition:{...catalogDraft.definition,customElements:[...(catalogDraft.definition.customElements??[]),customIdentity]}});
  const customCatalog=await catalogs.publish('fixture',catalogDraft.id,{expectedRevision:catalogSaved.revision,definitionSha256:catalogSaved.definitionSha256,displayName:catalogSaved.displayName,changeNote:'Pinned custom identifier regression'});
  sample.catalog_release_id=customCatalog.id;
  demographic.id=(await db.query('select id from app_identity.agency_demographic_version where organization_id=$1 and catalog_release_id=$2',[organization,customCatalog.id]))[0].id;
  [{id:group}]=await db.query('select app_identity.organization_group($1) id',[sample.organization_id]);
  const [previous]=await db.query('select * from app_identity.hospital_cos_state where group_id=$1',[group]);
  const form=randomUUID(),version=randomUUID(),fields=['ePatient.01','ePatient.05','eNarrative.01','eDisposition.01','eDisposition.02','eDisposition.27','eDisposition.28','eDisposition.30'];
  const definition={schemaVersion:1,sections:[{key:'cos',fields:[...fields.map(elementId=>({key:elementId,source:{kind:'nemsis',elementId}})),{key:'custom-identity',source:{kind:'custom',elementDefinitionId:customIdentity.id}}]}]};
  const digest=canonicalDefinitionSha256(definition);
  await db.query("insert into forms.form(id,organization_id,slug,name) values($1,$2,$3,'COS delivery fixture')",[form,group,`cos-${form}`]);
  await db.query('insert into forms.form_version(id,form_id,catalog_release_id,version,canonical_definition,definition_sha256,created_by) values($1,$2,$3,1,$4::jsonb,$5,$6)',[version,form,sample.catalog_release_id,JSON.stringify(definition),digest,sample.documenting_user_id]);
  await new FormPublicationService(db).publish(version,{publishedBy:sample.documenting_user_id,definitionSha256:digest,changeNote:'Delivery fixture'},group);
  const validationSessions={requireCapability:async()=>({organization:{id:sample.organization_id},user:{id:sample.documenting_user_id}})};
  const validations=new ValidationAuthoringService(db,validationSessions);
  const validationDraft=await validations.create('fixture',{catalogReleaseId:sample.catalog_release_id,displayName:'COS delivery policy'},{importedRules:[{id:randomUUID(),name:'Fictional identifier',enabled:false,severity:'error',executionTargets:['live','sign'],primaryTargetElementId:'ePatient.01',message:'Fictional identifier required',source:'require present("ePatient.01")'}]});
  const validation=await validations.publish('fixture',validationDraft.id,{expectedRevision:validationDraft.revision,displayName:validationDraft.displayName,changeNote:'COS delivery fixture'});
  for(let activation=0;activation<2;activation++)await validations.activate('fixture',validation.id,{formVersionId:version,catalogReleaseId:sample.catalog_release_id,changeNote:'COS delivery populated configuration fixture'});
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
  async function draft(overrides={},generated=false){
   const id=randomUUID();reports.push(id);
   const incident=randomUUID(),patient=randomUUID();
   await db.query('insert into clinical.incident(id,organization_id,synthetic) values($1,$2,true)',[incident,sample.organization_id]);
   await db.query("insert into clinical.patient(id,organization_id,identity_state,pseudonymous_key,pseudonymous_key_version) values($1,$2,'unknown',$3,1)",[patient,sample.organization_id,patient.replaceAll('-','').repeat(2)]);
   await db.query(`insert into clinical.report(id,organization_id,incident_id,patient_id,agency_demographic_version_id,form_version_id,catalog_release_id,documenting_user_id,synthetic,validation_version_id,form_definition_sha256,catalog_artifact_sha256,validation_compiled_sha256,synthetic_generated_by) values($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11,$12,$13)`,[id,sample.organization_id,incident,patient,demographic.id,version,sample.catalog_release_id,sample.documenting_user_id,pins.validation_version_id,pins.form_definition_sha256,pins.catalog_artifact_sha256,pins.validation_compiled_sha256,generated?sample.documenting_user_id:null]);
   const rootGroup=randomUUID();await db.query("insert into clinical.group_instance(id,report_id,catalog_release_id,group_id,ordinal,created_by) values($1,$2,$3,'PatientCareReportGroup',0,$4)",[rootGroup,id,sample.catalog_release_id,sample.documenting_user_id]);
   const fixtureGroups=new Map([['PatientCareReportGroup',rootGroup]]);
   const entries={'ePatient.01':'200207252388','ePatient.05':'200207262387','eNarrative.01':'Fictional documented assessment.','eDisposition.01':'Fictional hospital','eDisposition.02':'ED','eDisposition.27':'4227001','eDisposition.28':'4228001','eDisposition.30':'4230001',...overrides};
   for(const [element,value] of Object.entries(entries)){if(value===null)continue;const [identity]=await db.query('select e.element_identity_id,e.group_path,m.identifying from catalog.element_definition e join catalog.analytics_element_mapping m using(release_id,element_id) where e.release_id=$1 and e.element_id=$2',[sample.catalog_release_id,element]);
    const coded=['eDisposition.27','eDisposition.28','eDisposition.30'].includes(element);
    await db.query(`insert into clinical.element_occurrence(id,report_id,catalog_release_id,element_identity_id,element_id,analytical_repeatable,identifying,value_kind,value_text,code,code_system,author_id) values($1,$2,$3,$4,$5,false,$6,$7,$8,$9,$10,$11)`,[randomUUID(),id,sample.catalog_release_id,identity.element_identity_id,element,identity.identifying,coded?'coded':'text',coded?null:value,coded?value:null,null,sample.documenting_user_id]);
    if(element.startsWith('ePatient.')){
     let parent=null;for(const groupId of identity.group_path){if(!fixtureGroups.has(groupId)){const groupIdValue=randomUUID();await db.query('insert into clinical.group_instance(id,report_id,catalog_release_id,parent_group_instance_id,group_id,ordinal,created_by) values($1,$2,$3,$4,$5,0,$6)',[groupIdValue,id,sample.catalog_release_id,parent,groupId,sample.documenting_user_id]);fixtureGroups.set(groupId,groupIdValue);}parent=fixtureGroups.get(groupId);}
     await db.query('update clinical.element_occurrence set group_instance_id=$2 where report_id=$1 and element_id=$3',[id,parent,element]);
    }
   }
   return id;
  }
  function unavailablePhotoStorage(reportId){
   let reads=0;
   const wrapManager=manager=>new Proxy(manager,{get(target,key){if(key==='query')return async(sql,params)=>{if(sql.includes('from clinical.report_photo_blob b')&&params[0]===reportId){reads++;return [];}return target.query(sql,params);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
   const database=new Proxy(db,{get(target,key){if(key==='createQueryRunner')return ()=>{const runner=target.createQueryRunner(),manager=wrapManager(runner.manager);return new Proxy(runner,{get(inner,field){if(field==='manager')return manager;const value=Reflect.get(inner,field);return typeof value==='function'?value.bind(inner):value;}});};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
   return {database,manager:wrapManager(db.manager),get reads(){return reads;},reset(){reads=0;}};
  }
  async function attachPhoto(id){
   const note=randomUUID(),bytes=await sharp({create:{width:8,height:8,channels:3,background:'#498f95'}}).jpeg().toBuffer();
   await db.query(`insert into clinical.report_photo_note(id,organization_id,report_id,captured_at,captured_utc_offset_minutes,content_type,byte_size,sha256,width,height,created_by,updated_by)
    values($1,$2,$3,clock_timestamp(),0,'image/jpeg',$4,$5,8,8,$6,$6)`,[note,sample.organization_id,id,bytes.length,bytesHash(bytes),sample.documenting_user_id]);
   await db.query('insert into clinical.report_photo_blob(organization_id,report_id,note_id,canonical_bytes) values($1,$2,$3,$4)',[sample.organization_id,id,note,bytes]);
   return note;
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
  // Every non-transport care fact uses the same durable signed-version receiver path.
  for(const care of ['4228001','4228003','4228005','4228007','4228009'])for(const transport of ['4230009','4230013']){
   const id=await draft({'eDisposition.28':care,'eDisposition.30':transport});await sign(id);await processCosWork(db);
   const [contact]=await db.query('select content as contact from clinical.cos_simulator_contact where report_id=$1',[id]);
   assert.equal(contact.contact.careUnit,'fictional-ambulance');
   assert.deepEqual(contact.contact.disposition,{unit:'4227001',care,transport});
   assert.equal((await db.query('select state from clinical.cos_delivery where report_id=$1',[id]))[0].state,'confirmed');
  }
  // Review correction is one attributed amendment/queue/outcome transaction.
  let correctionActor={capabilities:['review:self'],organization:{id:organization},user:{id:actor.userId}};
  const correctionSessions={get:async()=>correctionActor,assertCsrf:async()=>{},lockPersonalAuthenticationContext:async()=>{}};
  const correctionReport=await draft({'ePatient.01':''});await sign(correctionReport);await processCosWork(db);
  const [correctionItem]=await db.query("select * from clinical.review_item where report_id=$1 and transmission_reason='patient-identity'",[correctionReport]);
  const originalSnapshot=(await db.query('select * from clinical.signed_snapshot where report_id=$1',[correctionReport]))[0];
  let correctionContext=await identifierCorrectionContext(db,correctionSessions,'fixture',correctionItem.id,'synthetic');
  const correctionCommand={commandId:randomUUID(),dataset:'synthetic',context:correctionContext,namespace:correctionContext.namespace,value:'200207252388',reason:'Verified fictional patient identifier',attested:true};
  await assert.rejects(correctReviewIdentifier(db,correctionSessions,'fixture',correctionItem.id,{...correctionCommand,value:'200207252389'}));
  await assert.rejects(correctReviewIdentifier(db,correctionSessions,'fixture',correctionItem.id,{...correctionCommand,namespace:'urn:wrong'}));
  await assert.rejects(correctReviewIdentifier(db,correctionSessions,'fixture',correctionItem.id,{...correctionCommand,attested:false}));
  const beforeCounts=await db.query('select (select count(*) from clinical.amendment where report_id=$1)::int amendments,(select count(*) from clinical.cos_delivery where report_id=$1)::int deliveries',[correctionReport]);
  const faultDb={transaction:(isolation,work)=>db.transaction(isolation,manager=>work(new Proxy(manager,{get(target,key){if(key==='query')return async(sql,args)=>{if(sql.includes('insert into clinical.cos_delivery(report_id'))throw new Error('Injected queue failure after persisted amendment');return target.query(sql,args);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}})))};
  await assert.rejects(correctReviewIdentifier(faultDb,correctionSessions,'fixture',correctionItem.id,correctionCommand),/Injected queue failure/);
  assert.deepEqual(await db.query('select (select count(*) from clinical.amendment where report_id=$1)::int amendments,(select count(*) from clinical.cos_delivery where report_id=$1)::int deliveries',[correctionReport]),beforeCounts);
  assert.equal((await db.query('select status from clinical.review_item where id=$1',[correctionItem.id]))[0].status,'new');
  correctionActor={...correctionActor,user:{id:randomUUID()}};await assert.rejects(correctReviewIdentifier(db,correctionSessions,'fixture',correctionItem.id,correctionCommand));
  correctionActor={...correctionActor,user:{id:actor.userId}};
  const correctionResult=await correctReviewIdentifier(db,correctionSessions,'fixture',correctionItem.id,correctionCommand);
  assert.deepEqual(await correctReviewIdentifier(db,correctionSessions,'fixture',correctionItem.id,correctionCommand),correctionResult);
  assert.equal((await db.query('select count(*)::int n from clinical.amendment where report_id=$1',[correctionReport]))[0].n,1);
  assert.equal((await db.query('select status from clinical.review_item where id=$1',[correctionItem.id]))[0].status,'completed');
  assert.equal((await db.query('select state from clinical.cos_delivery where id=$1',[correctionResult.deliveryId]))[0].state,'pending');
  assert.deepEqual((await db.query('select * from clinical.signed_snapshot where report_id=$1',[correctionReport]))[0],originalSnapshot);
  const [correctionAmendment]=await db.query('select author_id,attestation from clinical.amendment where id=$1',[correctionResult.amendmentId]);
  assert.equal(correctionAmendment.author_id,actor.userId);assert.equal(correctionAmendment.attestation.actorId,actor.userId);
  await assert.rejects(correctReviewIdentifier(db,correctionSessions,'fixture',correctionItem.id,{...correctionCommand,reason:'Changed replay'}));
  // Eligibility is decided from validated signed metadata before protected photo IO/rendering.
  for(const {overrides,state,finding} of [
   {overrides:{'eDisposition.27':'4227005'},state:'excluded',finding:'noContact'},
   {overrides:{'eDisposition.30':null},state:'waiting',finding:'eligibility'},
   {overrides:{'eDisposition.30':'4230011'},state:'waiting',finding:'eligibility'}]){
   const id=await draft(overrides);await attachPhoto(id);const snapshot=await sign(id);
   const storage=unavailablePhotoStorage(id);
   await assert.rejects(signedReportPdfSource(storage.manager,id,snapshot.signedSnapshotId,0),{code:'pdf.media-unavailable'});storage.reset();
   const receiver={contact:async()=>{assert.fail('ineligible report contacted receiver');},note:async()=>{assert.fail('ineligible report sent note');}};
   await processCosWork(storage.database,100,receiver);
   assert.equal(storage.reads,0,'eligibility does not fetch protected photo bytes');
   assert.deepEqual((await db.query('select state,finding from clinical.cos_delivery where report_id=$1',[id]))[0],{state,finding});
   assert.equal((await db.query('select id from clinical.cos_attempt where report_id=$1',[id])).length,0);
   assert.equal((await db.query('select delivery_id from clinical.cos_payload where report_id=$1',[id])).length,0);
  }
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
  // 019: failure creates one shared operational home; clicking Retry never resolves it.
  let recoveryActor={capabilities:['review:all','review:admin','review:identifying'],organization:{id:sample.organization_id},user:{id:sample.documenting_user_id}};
  const recoverySessions={get:async()=>recoveryActor,assertCsrf:async()=>{},lockPersonalAuthenticationContext:async()=>{}};
  const recoveryReview=new ReviewService(db,recoverySessions);
  const [failureItem]=await db.query("select * from clinical.review_item where report_id=$1 and kind='cos-delivery-failed'",[outage]);
  assert.ok(failureItem);assert.equal(failureItem.assignee_id,null);assert.equal(failureItem.active_match,true);
  const failureRoute=(await recoveryReview.routes('fixture')).find(route=>route.transmissionReason==='delivery-failure');assert.equal(failureRoute.route,'unassigned');
  await recoveryReview.claim('fixture',failureItem.id,{commandId:randomUUID(),expectedVersion:Number(failureItem.version),dataset:'synthetic'});
  async function retryInput(itemId=failureItem.id){const detail=await recoveryReview.item('fixture',itemId,'synthetic');return {commandId:randomUUID(),expectedVersion:detail.version,dataset:'synthetic',deliveryId:detail.transmission.deliveryId,amendmentSequence:detail.transmission.amendmentSequence,configurationRevision:Number(detail.transmission.configurationRevision),stateRevision:detail.transmission.stateRevision};}
  let retryCommand=await retryInput();
  recoveryActor={...recoveryActor,capabilities:[]};await assert.rejects(retryCosReview(db,recoverySessions,'fixture',failureItem.id,retryCommand));
  recoveryActor={...recoveryActor,capabilities:['review:all','review:admin','review:identifying']};
  await assert.rejects(retryCosReview(db,recoverySessions,'fixture',failureItem.id,{...retryCommand,dataset:'real'}));
  await assert.rejects(retryCosReview(db,recoverySessions,'fixture',failureItem.id,{...retryCommand,configurationRevision:999}));
  recoveryActor={...recoveryActor,user:{id:randomUUID()}};await assert.rejects(retryCosReview(db,recoverySessions,'fixture',failureItem.id,retryCommand));
  recoveryActor={...recoveryActor,user:{id:sample.documenting_user_id}};
  const [originalPayload]=await db.query('select * from clinical.cos_payload where report_id=$1',[outage]);
  const clicks=await Promise.allSettled([retryCosReview(db,recoverySessions,'fixture',failureItem.id,retryCommand),retryCosReview(db,recoverySessions,'fixture',failureItem.id,{...retryCommand,commandId:randomUUID()})]);
  assert.equal(clicks.filter(x=>x.status==='fulfilled').length,1);
  retryCommand={...retryCommand,commandId:(await db.query('select id from clinical.cos_recovery_command where report_id=$1',[outage]))[0].id};
  await retryCosReview(db,recoverySessions,'fixture',failureItem.id,retryCommand);
  assert.equal((await recoveryReview.item('fixture',failureItem.id,'synthetic')).status,'new');
  const assigned=await recoveryReview.item('fixture',failureItem.id,'synthetic');
  await recoveryReview.assign('fixture',failureItem.id,{commandId:randomUUID(),expectedVersion:assigned.version,dataset:'synthetic',assigneeId:null});
  await assert.rejects(retryCosReview(db,recoverySessions,'fixture',failureItem.id,retryCommand),/assigned reviewer/);
  const unassigned=await recoveryReview.item('fixture',failureItem.id,'synthetic');
  await recoveryReview.claim('fixture',failureItem.id,{commandId:randomUUID(),expectedVersion:unassigned.version,dataset:'synthetic'});
  recoveryActor={...recoveryActor,capabilities:[]};await assert.rejects(retryCosReview(db,recoverySessions,'fixture',failureItem.id,retryCommand));
  recoveryActor={...recoveryActor,capabilities:['review:all','review:admin','review:identifying']};
  await retryCosReview(db,recoverySessions,'fixture',failureItem.id,retryCommand);

  await processCosWork(db,100,{contact:async()=>{throw new CosRejected('outage');},note:simulator.note.bind(simulator)});
  assert.equal((await db.query('select count(*)::int n from clinical.cos_attempt where report_id=$1',[outage]))[0].n,2);
  assert.deepEqual((await db.query('select * from clinical.cos_payload where report_id=$1',[outage]))[0],originalPayload);
  retryCommand=await retryInput();await retryCosReview(db,recoverySessions,'fixture',failureItem.id,retryCommand);
  let recoveryEntered,recoveryRelease;
  const recoveryArrived=new Promise(resolve=>recoveryEntered=resolve),recoveryBarrier=new Promise(resolve=>recoveryRelease=resolve);
  const heldRecovery=processCosWork(db,100,{contact:async(...args)=>{recoveryEntered();await recoveryBarrier;return simulator.contact(...args);},note:simulator.note.bind(simulator)});
  await recoveryArrived;
  await assert.rejects(retryCosReview(db,recoverySessions,'fixture',failureItem.id,retryCommand),/in progress/);
  await processCosWork(db);
  recoveryRelease();await heldRecovery;
  const recovered=await recoveryReview.item('fixture',failureItem.id,'synthetic');assert.equal(recovered.status,'completed');assert.equal(recovered.activeMatch,false);
  assert.equal(recovered.transmission.recoveryCommands.length,2);assert.equal(recovered.transmission.recoveryCommands[0].outcome,'failed');assert.equal(recovered.transmission.recoveryCommands[1].outcome,'confirmed');
  assert.equal((await db.query('select count(*)::int n from clinical.cos_attempt where report_id=$1',[outage]))[0].n,3);
  assert.equal((await db.query("select count(*)::int n from clinical.review_item where report_id=$1 and kind='cos-delivery-failed'",[outage]))[0].n,1);
  await assert.rejects(db.query('update clinical.cos_recovery_command set amendment_sequence=99 where id=$1',[retryCommand.commandId]));
  const audit=new AuditService(db,{requireCapability:async()=>({...recoveryActor,capabilities:['audit:read','audit:identifying']})});
  const recoveryAudit=await audit.list('fixture',{category:'review',targetId:failureItem.id,from:new Date(Date.now()-86400000).toISOString(),to:new Date(Date.now()+1000).toISOString()});
  const manualAudit=recoveryAudit.entries.filter(e=>e.source==='clinical.cos_recovery_command');assert.equal(manualAudit.length,2);
  assert.ok(manualAudit.every(e=>e.actorId===sample.documenting_user_id&&e.outcome==='queued'&&e.recovery.itemId===failureItem.id&&e.recovery.amendmentSequence===0));
  assert.ok(recoveryAudit.entries.some(e=>e.source==='clinical.cos_delivery_event'&&e.outcome==='confirmed'&&e.actorId===sample.documenting_user_id));
  assert.doesNotMatch(JSON.stringify(recoveryAudit.entries),/200207252388|Fictional documented assessment/);
  // A definite outage after contact acceptance can resume the same note without a second contact.
  const afterContact=await draft();await sign(afterContact);await processCosWork(db,100,{contact:simulator.contact.bind(simulator),note:async()=>{throw new CosRejected('outage');}});
  const [contactFailure]=await db.query("select * from clinical.review_item where report_id=$1 and kind='cos-delivery-failed'",[afterContact]);
  await recoveryReview.claim('fixture',contactFailure.id,{commandId:randomUUID(),expectedVersion:Number(contactFailure.version),dataset:'synthetic'});
  await retryCosReview(db,recoverySessions,'fixture',contactFailure.id,await retryInput(contactFailure.id));await processCosWork(db);
  assert.equal((await db.query('select count(*)::int n from clinical.cos_simulator_contact where report_id=$1',[afterContact]))[0].n,1);
  assert.equal((await recoveryReview.item('fixture',contactFailure.id,'synthetic')).status,'completed');
  const partial=await draft();await sign(partial);await processCosWork(db,10,{contact:simulator.contact.bind(simulator),note:async()=>{throw new CosRejected('noteRejected');}});
  assert.equal((await db.query('select report_id from clinical.cos_simulator_contact where report_id=$1',[partial])).length,1);assert.equal((await db.query('select state from clinical.cos_delivery where report_id=$1',[partial]))[0].state,'failed');
  async function reconcileInput(reportId){
   const [row]=await db.query("select * from clinical.review_item where report_id=$1 and kind='cos-delivery-failed'",[reportId]);
   if(!row.assignee_id)await recoveryReview.claim('fixture',row.id,{commandId:randomUUID(),expectedVersion:Number(row.version),dataset:'synthetic'});
   const detail=await recoveryReview.item('fixture',row.id,'synthetic');
   return {itemId:row.id,command:{commandId:randomUUID(),expectedVersion:detail.version,dataset:'synthetic',...detail.transmission.reconciliationTarget,stateRevision:detail.transmission.stateRevision}};
  }
  for(const stage of ['contact','note']){
   const id=await draft();await sign(id);await processCosWork(db,10,{contact:async(...args)=>{const r=await simulator.contact(...args);if(stage==='contact')throw new Error('lost contact acknowledgment');return r;},note:async(...args)=>{await simulator.note(...args);throw new Error('lost note acknowledgment');}});
   assert.equal((await db.query('select state from clinical.cos_delivery where report_id=$1',[id]))[0].state,'uncertain');
   await processCosWork(db);assert.equal((await db.query('select count(*)::int count from clinical.cos_attempt a join clinical.cos_delivery d on d.id=a.delivery_id where d.report_id=$1',[id]))[0].count,1,'restart never blind resends');
   const {itemId,command}=await reconcileInput(id);
   await assert.rejects(reconcileCosReview(db,recoverySessions,'fixture',itemId,{...command,dataset:'real'}));
   const originalActor=recoveryActor;
   recoveryActor={...recoveryActor,capabilities:['review:all'],user:{id:randomUUID()}};await assert.rejects(reconcileCosReview(db,recoverySessions,'fixture',itemId,command));
   recoveryActor={...originalActor,user:{id:randomUUID()}};await assert.rejects(reconcileCosReview(db,recoverySessions,'fixture',itemId,command));recoveryActor=originalActor;
   await assert.rejects(reconcileCosReview(db,{...recoverySessions,assertCsrf:async()=>{throw new Error('Invalid CSRF');}},'fixture',itemId,command),/Invalid CSRF/);
   await reconcileCosReview(db,recoverySessions,'fixture',itemId,command);
   await reconcileCosReview(db,recoverySessions,'fixture',itemId,command);
   await assert.rejects(reconcileCosReview(db,recoverySessions,'fixture',itemId,{...command,amendmentSequence:999}));
   const [proof]=await db.query('select * from clinical.cos_reconciliation where report_id=$1',[id]);
   assert.equal(proof.actor_id,sample.documenting_user_id);assert.equal(proof.outcome,stage==='note'?'stored':'not-stored');
   assert.equal(proof.evidence.contact,'known');assert.equal(proof.evidence.storage,stage==='note'?'known':'rejected');
   assert.doesNotMatch(JSON.stringify(proof.evidence),/200207252388|Fictional documented assessment|token|credential/);
   assert.equal((await db.query('select count(*)::int n from clinical.cos_reconciliation where report_id=$1',[id]))[0].n,1);
   if(stage==='contact'){
    assert.equal((await recoveryReview.item('fixture',itemId,'synthetic')).transmission.retryable,true);
    await retryCosReview(db,recoverySessions,'fixture',itemId,await retryInput(itemId));await processCosWork(db);
    assert.equal((await db.query('select count(*)::int n from clinical.cos_simulator_contact where report_id=$1',[id]))[0].n,1);
   }
   assert.equal((await recoveryReview.item('fixture',itemId,'synthetic')).status,'completed');

  }
  for(const unsafe of await db.query("select i.id from clinical.review_item i join clinical.cos_delivery d on d.report_id=i.report_id where i.kind='cos-delivery-failed' and d.state in ('uncertain','failed') and d.finding<>'outage' and i.organization_id=$1",[sample.organization_id])){
   const detail=await recoveryReview.item('fixture',unsafe.id,'synthetic');assert.equal(detail.transmission.retryable,false);
   if(!detail.assigneeId)await recoveryReview.claim('fixture',unsafe.id,{commandId:randomUUID(),expectedVersion:detail.version,dataset:'synthetic'});
   await assert.rejects(retryCosReview(db,recoverySessions,'fixture',unsafe.id,await retryInput(unsafe.id)));
  }
  for(const crashStage of ['intent','contact','note']){
   const crashed=await draft();await sign(crashed);let journalWrites=0;
   const crash=new Error('process vanished before outcome journal commit');
   const crashDatabase={query:db.query.bind(db),createQueryRunner:db.createQueryRunner.bind(db),transaction:async work=>{if(crashStage==='note'&&journalWrites++===0)return db.transaction(work);throw crash;}};
   await assert.rejects(processCosWork(crashDatabase,100,{contact:async(...args)=>{if(crashStage==='intent')throw crash;const contact=await simulator.contact(...args);if(crashStage==='contact')throw crash;return contact;},note:async(...args)=>{await simulator.note(...args);throw crash;}}),error=>error===crash);
   assert.equal((await db.query('select finding from clinical.cos_delivery where report_id=$1',[crashed]))[0].finding,crashStage==='note'?'contactStored':'inFlight');
   assert.equal((await db.query("select id from clinical.review_item where report_id=$1 and kind='cos-delivery-failed'",[crashed])).length,0);
   await processCosWork(db);await processCosWork(db);
   const [crashItem]=await db.query("select * from clinical.review_item where report_id=$1 and kind='cos-delivery-failed'",[crashed]);assert.ok(crashItem);
   assert.equal((await db.query('select count(*)::int n from clinical.cos_attempt where report_id=$1',[crashed]))[0].n,1,'restart classifies abandoned intent without resend');
   const crashDetail=await recoveryReview.item('fixture',crashItem.id,'synthetic');assert.equal(crashDetail.transmission.finding,'outcomeUnknown');assert.equal(crashDetail.transmission.deliveryState,'uncertain');assert.equal(crashDetail.transmission.retryable,false);
   assert.equal((await db.query('select count(*)::int n from clinical.cos_simulator_contact where report_id=$1',[crashed]))[0].n,crashStage==='intent'?0:1);
   assert.equal((await db.query('select count(*)::int n from clinical.cos_simulator_note where report_id=$1',[crashed]))[0].n,crashStage==='note'?1:0);
   const reconciliation=await reconcileInput(crashed);await reconcileCosReview(db,recoverySessions,'fixture',reconciliation.itemId,reconciliation.command);
   assert.equal((await db.query('select outcome from clinical.cos_reconciliation where report_id=$1',[crashed]))[0].outcome,crashStage==='note'?'stored':'not-stored');

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
  const alternate=await draft();await sign(alternate);await processCosWork(db);assert.equal((await db.query('select p.bundle from clinical.cos_payload p join clinical.cos_delivery d on d.id=p.delivery_id where d.report_id=$1',[alternate]))[0].bundle.entry[0].resource.subject.identifier.value,'200207262387');
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
  // Eligibility/routing amendments use effective immutable values and replace only this report's receiver version.
  const routeChanged=await draft();await sign(routeChanged);await processCosWork(db);
  const [transportTarget]=await db.query("select id from clinical.element_occurrence where report_id=$1 and element_id='eDisposition.30'",[routeChanged]);
  async function amendTransport(sequence,code){return amendService.amend(routeChanged,{commandId:randomUUID(),expectedSequence:sequence,authorId:sample.documenting_user_id,reason:'Fictional disposition correction',attestation:{meaning:'author approval'},changes:[{action:'replace',targetElementOccurrenceId:transportTarget.id,value:{kind:'coded',code}}]});}
  await amendTransport(1,'4230013');await processCosWork(db);
  let [routeCurrent]=await db.query('select * from clinical.cos_simulator_current where report_id=$1',[routeChanged]);
  assert.equal(routeCurrent.amendment_sequence,1);assert.equal(routeCurrent.contact.careUnit,'fictional-ambulance');assert.equal(routeCurrent.contact.disposition.transport,'4230013');
  await amendTransport(2,'4230009');await amendTransport(3,'4230001');await processCosWork(db);
  [routeCurrent]=await db.query('select * from clinical.cos_simulator_current where report_id=$1',[routeChanged]);
  assert.equal(routeCurrent.amendment_sequence,3);assert.equal(routeCurrent.contact.careUnit,'fictional-ed');
  assert.equal((await db.query('select state from clinical.cos_delivery where report_id=$1 and amendment_sequence=2',[routeChanged]))[0].state,'superseded');
  assert.equal((await db.query('select count(*)::int n from clinical.cos_simulator_note where report_id=$1',[routeChanged]))[0].n,3);
  const [deliveredUnit]=await db.query("select id from clinical.element_occurrence where report_id=$1 and element_id='eDisposition.27'",[routeChanged]);
  await amendService.amend(routeChanged,{commandId:randomUUID(),expectedSequence:4,authorId:sample.documenting_user_id,reason:'Fictional contact correction after delivery',attestation:{meaning:'author approval'},changes:[{action:'replace',targetElementOccurrenceId:deliveredUnit.id,value:{kind:'coded',code:'4227007'}}]});await processCosWork(db);
  assert.equal((await db.query('select state from clinical.cos_delivery where report_id=$1 and amendment_sequence=4',[routeChanged]))[0].state,'excluded');
  assert.equal((await db.query('select amendment_sequence from clinical.cos_simulator_current where report_id=$1',[routeChanged]))[0].amendment_sequence,3,'exclusion is not remote retraction');
  assert.equal((await db.query('select count(*)::int n from clinical.cos_simulator_note where report_id=$1',[routeChanged]))[0].n,3);
  const contactCorrected=await draft({'ePatient.01':null,'ePatient.05':null,'eDisposition.30':'4230013'});await attachPhoto(contactCorrected);await sign(contactCorrected);const contactStorage=unavailablePhotoStorage(contactCorrected);await processCosWork(contactStorage.database);assert.equal(contactStorage.reads,0);
  const [contactReview]=await db.query("select id from clinical.review_item where report_id=$1 and transmission_reason='patient-identity'",[contactCorrected]);assert.ok(contactReview);
  async function amendContact(sequence,code,field='eDisposition.27'){const [unitTarget]=await db.query('select id from clinical.element_occurrence where report_id=$1 and element_id=$2',[contactCorrected,field]);await amendService.amend(contactCorrected,{commandId:randomUUID(),expectedSequence:sequence,authorId:sample.documenting_user_id,reason:'Fictional contact correction',attestation:{meaning:'author approval'},changes:[{action:'replace',targetElementOccurrenceId:unitTarget.id,value:{kind:'coded',code}}]});}
  await amendContact(1,'4230011','eDisposition.30');await processCosWork(contactStorage.database);assert.equal(contactStorage.reads,0);
  assert.equal((await db.query('select finding from clinical.cos_delivery where report_id=$1 and amendment_sequence=1',[contactCorrected]))[0].finding,'eligibility');
  assert.equal((await db.query('select active_match from clinical.review_item where id=$1',[contactReview.id]))[0].active_match,true,'unknown eligibility cannot clear an unresolved concern');
  await amendContact(2,'4230013','eDisposition.30');await processCosWork(contactStorage.database);assert.equal(contactStorage.reads,0);
  await amendContact(3,'4227005');await processCosWork(contactStorage.database);assert.equal(contactStorage.reads,0);
  assert.equal((await db.query('select state from clinical.cos_delivery where report_id=$1 and amendment_sequence=3',[contactCorrected]))[0].state,'excluded');
  assert.equal((await db.query('select status from clinical.review_item where id=$1',[contactReview.id]))[0].status,'completed');
  await amendContact(4,'4227001');await processCosWork(contactStorage.database);assert.equal(contactStorage.reads,0);
  assert.equal((await db.query('select active_match from clinical.review_item where id=$1',[contactReview.id]))[0].active_match,true);
  assert.equal((await db.query('select report_id from clinical.cos_simulator_contact where report_id=$1',[contactCorrected])).length,0);
  // Later amendment failure reopens the same concern, retains old attempts, and rejects stale version selection.
  const beforeNew=await retryInput();await amend(outage,1,'Later delivery correction');
  await processCosWork(db,100,{contact:async()=>{throw new CosRejected('outage');},note:simulator.note.bind(simulator)});
  const reopenedFailure=await recoveryReview.item('fixture',failureItem.id,'synthetic');assert.equal(reopenedFailure.activeMatch,true);assert.equal(reopenedFailure.reopened,true);assert.equal(reopenedFailure.transmission.amendmentSequence,1);
  await assert.rejects(retryCosReview(db,recoverySessions,'fixture',failureItem.id,{...beforeNew,commandId:randomUUID()}));
  await retryCosReview(db,recoverySessions,'fixture',failureItem.id,await retryInput());await processCosWork(db);
  assert.equal((await recoveryReview.item('fixture',failureItem.id,'synthetic')).status,'completed');
  assert.equal((await db.query("select count(*)::int n from clinical.review_item where report_id=$1 and kind='cos-delivery-failed'",[outage]))[0].n,1);
  // An unconsumed retry overtaken by a new signed amendment is recorded as superseded,
  // never shown forever as pending and never sends the older prepared payload.
  const overtaken=await draft();await sign(overtaken);await processCosWork(db,100,{contact:async()=>{throw new CosRejected('outage');},note:simulator.note.bind(simulator)});
  const [overtakenItem]=await db.query("select * from clinical.review_item where report_id=$1 and kind='cos-delivery-failed'",[overtaken]);
  await recoveryReview.claim('fixture',overtakenItem.id,{commandId:randomUUID(),expectedVersion:Number(overtakenItem.version),dataset:'synthetic'});
  await retryCosReview(db,recoverySessions,'fixture',overtakenItem.id,await retryInput(overtakenItem.id));
  await amend(overtaken,1,'New version before retry starts');await processCosWork(db);
  const overtakenDetail=await recoveryReview.item('fixture',overtakenItem.id,'synthetic');assert.equal(overtakenDetail.transmission.recoveryCommands[0].outcome,'superseded');
  assert.equal(overtakenDetail.status,'completed');
  assert.equal((await db.query('select count(*)::int n from clinical.cos_attempt a join clinical.cos_delivery d on d.id=a.delivery_id where d.report_id=$1 and d.amendment_sequence=0',[overtaken]))[0].n,1);
  // A remote request can finish after its caller timed out. The fence must stop
  // every write from that exact operation before allowing a competing version.
  for(const delayedStage of ['contact','note']){
   const delayed=await draft();await sign(delayed);let late;
   await processCosWork(db,100,{
    contact:async(...args)=>{if(args[0]!==delayed)return simulator.contact(...args);if(delayedStage==='contact'){late=()=>simulator.contact(...args);throw new Error('contact timeout before delayed effect');}return simulator.contact(...args);},
    note:async(...args)=>{if(args[0]!==delayed)return simulator.note(...args);late=()=>simulator.note(...args);throw new Error('note timeout before delayed effect');}
   });
   await amend(delayed,1,'Newer signed note waits for proof');await processCosWork(db);
   assert.equal((await db.query("select count(*)::int n from clinical.cos_attempt where report_id=$1",[delayed]))[0].n,1);
   let {itemId,command}=await reconcileInput(delayed);
   const lane=db.createQueryRunner();await lane.connect();await lane.startTransaction();
   await lane.query('select pg_advisory_xact_lock(731021,hashtext($1))',[delayed]);
   try{await reconcileCosReview(db,recoverySessions,'fixture',itemId,command);}finally{await lane.rollbackTransaction();await lane.release();}
   assert.equal((await db.query('select outcome from clinical.cos_reconciliation where id=$1',[command.commandId]))[0].outcome,'unresolved');
   assert.equal((await db.query('select attempt_id from clinical.cos_simulator_fence where report_id=$1',[delayed])).length,0);
   ({itemId,command}=await reconcileInput(delayed));

   const results=await Promise.allSettled([reconcileCosReview(db,recoverySessions,'fixture',itemId,command),reconcileCosReview(db,recoverySessions,'fixture',itemId,command)]);
   assert.ok(results.some(r=>r.status==='fulfilled'));
   await reconcileCosReview(db,recoverySessions,'fixture',itemId,command);
   await assert.rejects(late(),CosRejected);
   await processCosWork(db);
   assert.equal((await db.query('select amendment_sequence from clinical.cos_simulator_current where report_id=$1',[delayed]))[0].amendment_sequence,1);
   await assert.rejects(late(),CosRejected);
   assert.equal((await db.query('select count(*)::int n from clinical.cos_simulator_contact where report_id=$1',[delayed]))[0].n,1);
   assert.equal((await db.query('select count(*)::int n from clinical.cos_reconciliation where report_id=$1',[delayed]))[0].n,2);
   const [prepared]=await db.query('select * from clinical.cos_payload where report_id=$1 order by created_at limit 1',[delayed]);
   await assert.rejects(simulator.contact(delayed,{contact:prepared.contact,contactSha256:prepared.contact_sha256}),CosRejected);
  }
  const queued=await draft();await sign(queued);await amend(queued,1,'First correction');await amend(queued,2,'Newest correction');
  assert.deepEqual((await db.query('select state from clinical.cos_delivery where report_id=$1 order by amendment_sequence',[queued])).map(x=>x.state),['superseded','superseded','pending']);
  await Promise.all([processCosWork(db),processCosWork(db)]);
  const current=async id=>(await db.query('select c.*,n.bundle,n.pdf,n.pdf_sha256 from clinical.cos_simulator_current c join clinical.cos_simulator_note n on n.delivery_id=c.delivery_id where c.report_id=$1',[id]))[0];
  const latest=await current(queued);assert.equal(latest.amendment_sequence,2);assert.equal(latest.bundle.entry[0].resource.item[0].answer[0].valueString,'Newest correction');assert.equal(bytesHash(latest.pdf),latest.pdf_sha256);
  const pdfDocument=await getDocument({data:new Uint8Array(latest.pdf),useSystemFonts:false}).promise;
  let pdfText='';try{for(let page=1;page<=pdfDocument.numPages;page++)pdfText+=(await (await pdfDocument.getPage(page)).getTextContent()).items.map(x=>x.str).join(' ');}finally{await pdfDocument.destroy();}
  assert.match(pdfText,/Newest correction/);assert.match(pdfText,/First correction/);assert.match(pdfText,/Fictional clinician/);
  const corrected=await amend(queued,3,'200207272386','ePatient.05');await processCosWork(db);
  const correctedNote=await current(queued);assert.equal(correctedNote.amendment_sequence,3);assert.equal(correctedNote.contact.patient.value,'200207272386');assert.equal(correctedNote.bundle.entry[0].resource.authored,corrected.signedAt);
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
   await manager.query(`insert into clinical_audit.synthetic_purge_tombstone(record_type,record_id,organization_id,server_created_at,expired_at,purged_at) values('report',$1,$2,clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day',clock_timestamp())`,[outage,sample.organization_id]);
   await manager.query("select set_config('open_triage.synthetic_purge_report',$1,true)",[outage]);
   await manager.query('delete from clinical.signed_snapshot where report_id=$1',[outage]);
   assert.equal((await manager.query('select id from clinical.cos_recovery_command where report_id=$1',[outage])).length,0);
   throw rollback;
  }),error=>error===rollback);

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
  const expiring=await draft({'ePatient.01':null,'ePatient.05':null},true);await sign(expiring);await processCosWork(db);
  assert.ok((await db.query('select id from clinical.review_transmission_history where report_id=$1',[expiring])).length);
  const [expiry]=await db.query('select expires_at from clinical.report where id=$1',[expiring]);assert.ok(expiry.expires_at);
  await assert.rejects(db.transaction(async manager=>{
   await manager.query("select retention.purge_expired_synthetic_records($1::timestamptz+interval '1 minute')",[expiry.expires_at]);
   assert.equal((await manager.query('select id from clinical.report where id=$1',[expiring])).length,0);
   assert.equal((await manager.query('select id from clinical.review_transmission_history where report_id=$1',[expiring])).length,0);
   throw rollback;
  }),error=>error===rollback);
  // Imported canonical revision targets an empty custom identifying field, never ePatient.01.
  const {format:customFormat,schemaVersion:customSchema,sha256:customHash,...customPortable}=mapping;
  const customMapping=makePackage({...customPortable,version:'3',definition:{...mapping.definition,revision:3,patientIdentifier:{field:{kind:'custom',elementDefinitionId:customIdentity.id},namespace:'urn:oid:1.2.752.129.2.1.3.3',aliases:[]}}});
  await config(next+10,customMapping);
  const customReport=await draft();await sign(customReport);await processCosWork(db);
  const [customOriginalSnapshot]=await db.query('select * from clinical.signed_snapshot where report_id=$1',[customReport]);
  const [customItem]=await db.query("select * from clinical.review_item where report_id=$1 and transmission_reason='patient-identity'",[customReport]);
  const customContext=await identifierCorrectionContext(db,correctionSessions,'fixture',customItem.id,'synthetic');
  assert.deepEqual(customContext.field,{kind:'custom',elementDefinitionId:customIdentity.id});
  const customCommand={...correctionCommand,commandId:randomUUID(),context:customContext,namespace:customContext.namespace,value:'200207852385'};
  // Moving active configuration, including a same-content revision, invalidates a prepared command.
  await config(next+11,customMapping);await assert.rejects(correctReviewIdentifier(db,correctionSessions,'fixture',customItem.id,customCommand));
  customCommand.context=await identifierCorrectionContext(db,correctionSessions,'fixture',customItem.id,'synthetic');
  const reviewer=await new AccountService(db).provision({organizationId:organization,username:`reviewer-${randomUUID()}`,displayName:'Fictional assigned reviewer',role:'administrator',temporaryPassword:'Fictional reviewer password 42!'});
  await db.query('update clinical.review_item set assignee_id=$2,version=version+1 where id=$1',[customItem.id,reviewer.userId]);
  await assert.rejects(correctReviewIdentifier(db,correctionSessions,'fixture',customItem.id,customCommand));
  correctionActor={capabilities:['review:all'],organization:{id:organization},user:{id:reviewer.userId}};
  await assert.rejects(identifierCorrectionContext(db,correctionSessions,'fixture',customItem.id,'synthetic'));
  correctionActor.capabilities.push('review:identifying');customCommand.context=await identifierCorrectionContext(db,correctionSessions,'fixture',customItem.id,'synthetic');
  // Mutable authoring metadata must never rewrite sealed report meaning or value constraints.
  await db.query("update forms.custom_element_definition set title='Later catalog title',identifying=false,definition=jsonb_set(definition,'{constraints}', '{\"maxLength\":1}'::jsonb) where id=$1",[customIdentity.id]);
  assert.equal((await identifierCorrectionContext(db,correctionSessions,'fixture',customItem.id,'synthetic')).label,customIdentity.title);
  const contenders=await Promise.allSettled([correctReviewIdentifier(db,correctionSessions,'fixture',customItem.id,customCommand),correctReviewIdentifier(db,correctionSessions,'fixture',customItem.id,customCommand)]);
  assert.ok(contenders.some(result=>result.status==='fulfilled'));
  const customOutcome=await correctReviewIdentifier(db,correctionSessions,'fixture',customItem.id,customCommand);
  assert.equal((await db.query('select count(*)::int n from clinical.amendment where report_id=$1',[customReport]))[0].n,1);

  const customSource=await signedReportPdfSource(db.manager,customReport,customOriginalSnapshot.id,1);assert.equal(customSource.configuration.customFields[customIdentity.id].title,customIdentity.title);
  assert.deepEqual((await db.query('select * from clinical.signed_snapshot where report_id=$1',[customReport]))[0],customOriginalSnapshot);
  const [customAmendment]=await db.query('select author_id,attestation from clinical.amendment where id=$1',[customOutcome.amendmentId]);
  assert.equal(customAmendment.author_id,reviewer.userId);assert.equal(customAmendment.attestation.actorId,reviewer.userId);
  assert.equal((await db.query('select status from clinical.review_item where id=$1',[customItem.id]))[0].status,'completed');
  assert.ok(customOutcome.remaining.includes('staff'),'reviewer needs their own HSA mapping');
  assert.equal((await db.query("select active_match from clinical.review_item where report_id=$1 and transmission_reason='integration-mapping'",[customReport]))[0].active_match,true);
  const [originalPatient]=await db.query("select value_text from clinical.element_occurrence where report_id=$1 and element_id='ePatient.01'",[customReport]);assert.equal(originalPatient.value_text,'200207252388');
  const [customChange]=await db.query('select corrected_value from clinical.amendment_change where amendment_id=$1',[customOutcome.amendmentId]);assert.equal(customChange.corrected_value.element_identity_id,customIdentity.id);
  // Committed ordinary report expiry removes the operation and fence together;
  // an original delayed request cannot recreate receiver state after retention.
  await config(next+12);
  const retained=await draft({},true);await sign(retained);let retainedLate;
  await processCosWork(db,100,{contact:simulator.contact.bind(simulator),note:async(...args)=>{if(args[0]!==retained)return simulator.note(...args);retainedLate=()=>simulator.note(...args);throw new Error('Delayed until after retention');}});
  const retentionCommand=await reconcileInput(retained);await reconcileCosReview(db,recoverySessions,'fixture',retentionCommand.itemId,retentionCommand.command);
  assert.equal((await db.query('select attempt_id from clinical.cos_simulator_fence where report_id=$1',[retained])).length,1);
  const [retainedExpiry]=await db.query('select expires_at from clinical.report where id=$1',[retained]);
  let writerEntered,writerRelease;const writerArrived=new Promise(resolve=>writerEntered=resolve),writerGate=new Promise(resolve=>writerRelease=resolve);
  const pausedReceiver=new PersistentCosSimulator({transaction:work=>db.transaction(manager=>work(new Proxy(manager,{get(target,key){if(key==='query')return async(sql,args)=>{const result=await target.query(sql,args);if(sql.includes('for key share')&&args?.[0]===retained){writerEntered();await writerGate;}return result;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}})))});
  const [retainedPayload]=await db.query('select p.*,a.id attempt_id from clinical.cos_payload p join clinical.cos_attempt a on a.delivery_id=p.delivery_id where p.report_id=$1',[retained]);
  const pendingWriter=pausedReceiver.note(retained,retainedPayload.delivery_id,{contact:retainedPayload.contact,contactSha256:retainedPayload.contact_sha256,bundle:retainedPayload.bundle,pdf:retainedPayload.pdf,payloadSha256:retainedPayload.payload_sha256,pdfSha256:retainedPayload.pdf_sha256,amendmentSequence:0},retainedPayload.attempt_id);
  const writerOutcome=assert.rejects(pendingWriter,CosRejected);await writerArrived;
  try{
   await assert.rejects(reconcileCosReview(db,recoverySessions,'fixture',retentionCommand.itemId,{...retentionCommand.command,commandId:randomUUID()}),/receiver operation is still in progress/);
   await db.query("select retention.purge_expired_synthetic_records($1::timestamptz+interval '1 minute')",[retainedExpiry.expires_at]);
   assert.equal((await db.query('select id from clinical.report where id=$1',[retained])).length,1,'retention skips an existing receiver operation holding report key-share');
   assert.equal((await db.query('select attempt_id from clinical.cos_simulator_fence where report_id=$1',[retained])).length,1,'fence remains until the old writer finishes');
  }finally{writerRelease();await writerOutcome;}
  await db.query("select retention.purge_expired_synthetic_records($1::timestamptz+interval '1 minute')",[retainedExpiry.expires_at]);
  for(const table of ['cos_reconciliation','cos_simulator_fence','cos_simulator_contact','cos_simulator_note'])assert.equal((await db.query(`select 1 from clinical.${table} where report_id=$1`,[retained])).length,0);
  await assert.rejects(retainedLate(),CosRejected);
  // A later configuration without a default leaves a mapping concern; stale hospital fields cannot rescue it.
  settings.defaultAmbulanceCareUnit='';await config(next+100);
  const noDefault=await draft({'eDisposition.30':'4230013'});await sign(noDefault);await processCosWork(db);
  assert.deepEqual((await db.query('select state,finding from clinical.cos_delivery where report_id=$1',[noDefault]))[0],{state:'waiting',finding:'ambulanceCareUnit'});
  const [defaultReview]=await db.query("select transmission_reason,assignee_id from clinical.review_item where report_id=$1 and active_match",[noDefault]);
  assert.equal(defaultReview.transmission_reason,'integration-mapping');
  assert.deepEqual((await db.query('select evidence from clinical.review_transmission_history where report_id=$1 order by item_version desc limit 1',[noDefault]))[0].evidence.missing,['ambulanceCareUnit']);
  assert.equal((await db.query('select report_id from clinical.cos_simulator_contact where report_id=$1',[noDefault])).length,0);
  assert.deepEqual(await db.query('select * from app_identity.hospital_cos_state where group_id=app_identity.organization_group($1)',[baseline.organization_id]),sharedState);
  assert.deepEqual(await db.query('select * from app_identity.active_configuration_bundle where organization_id=$1',[baseline.organization_id]),sharedBundle);
  if(previous)await db.query('update app_identity.hospital_cos_state set active_revision=$2 where group_id=$1',[group,previous.active_revision]);else await db.query('update app_identity.hospital_cos_state set active_revision=null where group_id=$1',[group]);
 }finally{if(group)await db.query('update app_identity.hospital_cos_state set active_revision=null where group_id=$1',[group]);await db.destroy();}
});
