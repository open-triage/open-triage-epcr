import {cosVerificationAudit} from './fixtures/cos-verification-audit.mjs';
import {SignReportService} from '../dist/reports/sign-report.service.js';
import {cosJournalSettlingSql,cosSigningCheckDueSql,cosJournalCheckScopeSql} from '../dist/hospital/cos-journal-settling.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DataSource} from 'typeorm';
import {makePackage} from '../dist/admin/canonical-package.js';
import {COS_PROFILE} from '../dist/hospital/cos-configuration.js';
import {processCosWork} from '../dist/hospital/cos-worker.js';
import {bytesHash} from '../dist/hospital/cos-payload.js';
import {contentDigest} from '../dist/admin/canonical-package.js';
import {prepareSigningSubmission,finalizeEpsSigning,finalizeVerifiedSigning,finalizeSigningSnapshot,skipCosSigning,signingSubmissionStatus} from '../dist/reports/signing-submission.js';
import {commandSha256} from '../dist/reports/draft-report.validation.js';
import {readCosPatientComparison} from '../dist/hospital/cos-patient-comparison.js';
import {signedReportSource} from '../dist/reports/signed-report-pdf.persistence.js';
const integration=process.env.DATABASE_URL?test:test.skip;
if(process.env.REQUIRE_DATABASE_INTEGRATION&&!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
integration('COS signing freezes content, gates finalization, rejects stale revisions, and audits explicit bypass',async()=>{
 const db=new DataSource({type:'postgres',url:process.env.DATABASE_URL,synchronize:false});await db.initialize();
 const runner=db.createQueryRunner();await runner.connect();await runner.startTransaction();
 try{
  const m=runner.manager;
  const [sample]=await m.query(`select r.* from clinical.report r where r.synthetic order by r.created_at desc limit 1`);
  assert.ok(sample,'seeded synthetic report required');
  const [{id:group}]=await m.query('select app_identity.organization_group($1) id',[sample.organization_id]);
  const [{revision}]=await m.query('select coalesce(max(revision),0)+1 revision from app_identity.hospital_cos_version where group_id=$1',[group]);
  const mapping=makePackage({kind:'hospital-mapping',name:'COS signing regression',version:'1',catalog:{sha256:'a'.repeat(64)},definition:{schemaVersion:2,id:randomUUID(),revision:1,authoredAt:new Date().toISOString(),author:sample.documenting_user_id,profile:COS_PROFILE,pdfLinkId:'371530004',patientIdentifier:{field:{kind:'nemsis',elementId:'ePatient.01'},namespace:'urn:oid:1.2.752.129.2.1.3.1',aliases:[]},clinicalMappings:[]}});
  await m.query(`insert into app_identity.hospital_cos_version(group_id,revision,credential_id,endpoint,settings,canonical_mapping,catalog_release_id,form_version_id,created_by)
   values($1,$2,$3,'https://example.invalid',$4::jsonb,$5::jsonb,$6,$7,$8)`,[group,revision,randomUUID(),JSON.stringify({mode:'simulator',authentication:'api-key',template:'urn:test',encounterNamespace:'urn:test',organizationHsaId:'test',defaultAmbulanceCareUnit:'test'}),JSON.stringify(mapping),sample.catalog_release_id,sample.form_version_id,sample.documenting_user_id]);
  await m.query(`insert into app_identity.hospital_cos_state(group_id,draft_revision,active_revision) values($1,$2,$2) on conflict(group_id) do update set draft_revision=$2,active_revision=$2,state_revision=hospital_cos_state.state_revision+1`,[group,revision]);
  async function fixture(){
   const id=randomUUID(),patient=randomUUID(),incident=randomUUID();
   await m.query('insert into clinical.incident(id,organization_id,synthetic) values($1,$2,true)',[incident,sample.organization_id]);
   await m.query("insert into clinical.patient(id,organization_id,identity_state,pseudonymous_key,pseudonymous_key_version) values($1,$2,'unknown',$3,1)",[patient,sample.organization_id,patient.replaceAll('-','').repeat(2)]);
   await m.query(`insert into clinical.report(id,organization_id,incident_id,patient_id,agency_demographic_version_id,form_version_id,catalog_release_id,documenting_user_id,synthetic,validation_version_id,form_definition_sha256,catalog_artifact_sha256,validation_compiled_sha256)
    select $1,organization_id,$2,$3,agency_demographic_version_id,form_version_id,catalog_release_id,documenting_user_id,true,validation_version_id,form_definition_sha256,catalog_artifact_sha256,validation_compiled_sha256 from clinical.report where id=$4`,[id,incident,patient,sample.id]);
   const result={id,status:'signed',signedSnapshotId:randomUUID(),signedRevision:0,signerId:sample.documenting_user_id,signedAt:new Date().toISOString(),formVersionId:sample.form_version_id,catalogReleaseId:sample.catalog_release_id,validationVersionId:sample.validation_version_id,reportingDate:'2026-10-30',reportingDateSource:'signing-time',qualityRuleVersion:'clinical-quality-1.0.0',normalizationRuleVersion:'clinical-normalization-1.0.0',qualityFindings:[],derivedValues:[]};
   const manifest={schemaVersion:1,clinicalContentVersion:2,report:{id,revision:0,formVersionId:result.formVersionId,catalogReleaseId:result.catalogReleaseId},groups:[],occurrences:[],notes:[]};
   result.canonicalSha256=commandSha256(manifest);
   return {result,manifest,validationVersionId:sample.validation_version_id,command:{commandId:randomUUID(),expectedRevision:0,signerId:sample.documenting_user_id,attestation:{meaning:'synthetic workflow test'}}};
  }
  // Both selected integrations must resolve before any signature or receipt exists.
  const [{revision:epsRevision}]=await m.query('select coalesce(max(revision),0)+1 revision from app_identity.hospital_eps_version where group_id=$1',[group]);
  const epsMapping=makePackage({kind:'hospital-mapping',name:'EPS signing gate',version:'1',catalog:{sha256:'a'.repeat(64)},definition:{schemaVersion:1,id:randomUUID(),revision:1,authoredAt:new Date().toISOString(),author:sample.documenting_user_id,profile:{package:'hl7.fhir.eu.eps',version:'1.0.0-ballot',fhirVersion:'4.0.1'},patientIdentifier:{field:{kind:'nemsis',elementId:'ePatient.01'},namespace:'urn:fictional',aliases:[]},outputMappings:[]}});
  await m.query(`insert into app_identity.hospital_eps_version(group_id,revision,credential_id,endpoint,canonical_mapping,catalog_release_id,form_version_id,created_by)
   values($1,$2,$3,'https://example.invalid',$4::jsonb,$5,$6,$7)`,[group,epsRevision,randomUUID(),JSON.stringify(epsMapping),sample.catalog_release_id,sample.form_version_id,sample.documenting_user_id]);
  await m.query(`insert into app_identity.hospital_eps_state(group_id,draft_revision,active_revision) values($1,$2,$2) on conflict(group_id) do update set draft_revision=$2,active_revision=$2`,[group,epsRevision]);
  const both=await fixture();both.command.exportEps=true;
  const bothPending=await prepareSigningSubmission(m,both);
  assert.equal(bothPending.status,'awaiting-cos');
  await m.query("update clinical.cos_delivery set state='confirmed',finding='clinicalProjectionIncomplete' where id=$1",[bothPending.deliveryId]);
  assert.equal(await finalizeVerifiedSigning(m,bothPending.deliveryId,true),false,'COS acceptance alone cannot sign when EPS is selected');
  assert.equal((await signingSubmissionStatus(m,both.result.id)).status,'awaiting-eps');
  assert.equal((await m.query('select count(*)::int n from clinical.signed_snapshot where report_id=$1',[both.result.id]))[0].n,0);
  const [{id:epsId}]=await m.query('select id from clinical.eps_submission where signing_submission_id=$1',[both.result.signedSnapshotId]);
  const epsAttempt=randomUUID();
  await m.query('insert into clinical.eps_submission_attempt(id,submission_id,command_id,actor_id) values($1,$2,$3,$4)',[epsAttempt,epsId,randomUUID(),both.command.signerId]);
  await m.query(`insert into clinical.eps_submission_result(attempt_id,state,evidence) values($1,'accepted','{"state":"accepted","issues":[],"headers":{"x-pass":"true"}}')`,[epsAttempt]);
  assert.equal(await finalizeEpsSigning(m,both.result.signedSnapshotId),true,'EPS acceptance completes both gates and retains the COS warning acknowledgement');
  assert.equal((await signingSubmissionStatus(m,both.result.id)).status,'signed');
  assert.equal(await finalizeEpsSigning(m,both.result.signedSnapshotId),false,'replayed completion cannot create another signature');
  const prepared=await fixture();
  await m.query('set local role open_triage_api_runtime');
  const previews=new SignReportService({transaction:async(_isolation,fn)=>fn(m),query:(...args)=>m.query(...args)},
   {requireCapability:async()=>({organization:{id:sample.organization_id},user:{id:sample.documenting_user_id}})});
  assert.ok((await previews.cosContext('token',prepared.result.id)).binding);
  const preview=await previews.cosPdfPreview('token',prepared.result.id,'0','en');
  assert.equal(preview.subarray(0,5).toString(),'%PDF-');
  assert.equal((await m.query('select id from clinical.signed_snapshot where report_id=$1',[prepared.result.id])).length,0);
  assert.equal((await m.query('select id from clinical.cos_delivery where report_id=$1',[prepared.result.id])).length,0);

  const pending=await prepareSigningSubmission(m,prepared);
  assert.equal(pending.status,'awaiting-cos');
  await cosVerificationAudit(m,pending.deliveryId);
  await m.query('set local role open_triage_api_runtime');
  const checklist=await signingSubmissionStatus(m,prepared.result.id);
  assert.equal(checklist.status,'awaiting-cos');
  assert.ok(checklist.context.authorName);
  assert.deepEqual(checklist.issues,[]);
  assert.equal((await m.query('select status from clinical.report where id=$1',[prepared.result.id]))[0].status,'draft');
  assert.equal((await m.query('select id from clinical.signed_snapshot where report_id=$1',[prepared.result.id])).length,0);
  const frozen=await signedReportSource(m,prepared.result.id,prepared.result.signedSnapshotId,0,true);
  assert.equal(frozen.canonicalSha256,prepared.result.canonicalSha256);
  await assert.rejects(signedReportSource(m,prepared.result.id,prepared.result.signedSnapshotId,0),'ordinary signed PDF path cannot expose a pending signature');
  assert.equal(await finalizeVerifiedSigning(m,pending.deliveryId),false);
  const duplicate=await prepareSigningSubmission(m,{...prepared,result:{...prepared.result,signedSnapshotId:randomUUID()},command:{...prepared.command,commandId:randomUUID()}});
  assert.equal(duplicate.deliveryId,pending.deliveryId);
  await m.query("update clinical.cos_delivery set state='uncertain',finding='reconciliationUnresolved' where id=$1",[pending.deliveryId]);
  assert.equal(await finalizeVerifiedSigning(m,pending.deliveryId),false,'HTTP acceptance without proof cannot sign');
  await m.query(`insert into clinical.cos_delivery_event(delivery_id,report_id,actor_id,state,evidence) values($1,$2,$3,'uncertain','{"action":"signing-check"}'::jsonb)`,[pending.deliveryId,prepared.result.id,prepared.command.signerId]);
  assert.equal((await signingSubmissionStatus(m,prepared.result.id)).finding,'inFlight','queued reconciliation is visible before the worker starts');
  await m.query(`insert into clinical.cos_delivery_event(delivery_id,report_id,worker_id,state,evidence) values($1,$2,$3,'uncertain','{"action":"signing-checked"}'::jsonb)`,[pending.deliveryId,prepared.result.id,randomUUID()]);
  assert.equal((await signingSubmissionStatus(m,prepared.result.id)).finding,'reconciliationUnresolved');
  await m.query("update clinical.cos_delivery set state='confirmed',finding='clinicalProjectionIncomplete' where id=$1",[pending.deliveryId]);
  assert.equal(await finalizeVerifiedSigning(m,pending.deliveryId),false,'coverage warning requires acknowledgement');
  assert.equal(await finalizeVerifiedSigning(m,pending.deliveryId,true),true);
  assert.equal((await signingSubmissionStatus(m,prepared.result.id)).status,'signed');
  assert.equal(await finalizeVerifiedSigning(m,pending.deliveryId,true),false,'finalization is idempotent');
  const [snapshot]=await m.query('select * from clinical.signed_snapshot where report_id=$1',[prepared.result.id]);
  assert.equal(snapshot.canonical_sha256,prepared.result.canonicalSha256);assert.deepEqual(snapshot.integrity_manifest,prepared.manifest);
  assert.equal(snapshot.warning_acknowledgements['cos:clinicalProjectionIncomplete'],true);
  const [receipt]=await m.query('select request_sha256 from clinical.command_receipt where idempotency_key=$1',[prepared.command.commandId]);
  assert.equal(receipt.request_sha256,commandSha256(prepared.command));
  await m.query('reset role');

  // A checkbox acknowledged on retry survives asynchronous delivery verification.
  const acknowledged=await fixture();
  const acknowledgedDelivery=await prepareSigningSubmission(m,acknowledged);
  const retryCommand={...acknowledged,command:{...acknowledged.command,commandId:randomUUID(),warningAcknowledgements:{'cos:clinicalProjectionIncomplete':true}}};
  await prepareSigningSubmission(m,retryCommand);
  assert.equal(await finalizeVerifiedSigning(m,acknowledgedDelivery.deliveryId),false,'acknowledgement cannot bypass unverified delivery');
  await m.query("update clinical.cos_delivery set state='confirmed',finding='clinicalProjectionIncomplete' where id=$1",[acknowledgedDelivery.deliveryId]);
  assert.equal(await finalizeVerifiedSigning(m,acknowledgedDelivery.deliveryId),true,'worker honors the recorded checkbox acknowledgement');
  assert.equal((await m.query('select warning_acknowledgements from clinical.signed_snapshot where report_id=$1',[acknowledged.result.id]))[0].warning_acknowledgements['cos:clinicalProjectionIncomplete'],true);
  const revoked=await fixture();
  revoked.command.warningAcknowledgements={'cos:clinicalProjectionIncomplete':true};
  const revokedDelivery=await prepareSigningSubmission(m,revoked);
  await prepareSigningSubmission(m,{...revoked,command:{...revoked.command,commandId:randomUUID(),warningAcknowledgements:{}}});
  await m.query("update clinical.cos_delivery set state='confirmed',finding='clinicalProjectionIncomplete' where id=$1",[revokedDelivery.deliveryId]);
  assert.equal(await finalizeVerifiedSigning(m,revokedDelivery.deliveryId),false,'a later unchecked submission revokes earlier acknowledgement');

  // A demographic correction must replace an attempted submission when patient
  // verification stopped it before any clinical writes (PCR 672 regression).
  const corrected=await fixture(),conflicted=await prepareSigningSubmission(m,corrected);
  await m.query(`insert into clinical.cos_attempt(delivery_id,report_id,configuration_revision,mapping_id,mapping_revision,mapping_sha256,payload_sha256,pdf_sha256,worker_id)
   select id,report_id,configuration_revision,mapping_id,mapping_revision,mapping_sha256,$2,$2,gen_random_uuid() from clinical.cos_delivery where id=$1`,[conflicted.deliveryId,'a'.repeat(64)]);
  await m.query(`insert into clinical.cos_artifact(delivery_id,report_id,artifact_key,kind,content_sha256,resource)
   values($1,$2,'patient','patient',$3,'{}'::jsonb)`,[conflicted.deliveryId,corrected.result.id,'a'.repeat(64)]);
  await m.query(`insert into clinical.cos_artifact_event(delivery_id,report_id,artifact_key,state,evidence)
   values($1,$2,'patient','unresolved','{"reason":"patientIdentityConflict"}'::jsonb)`,[conflicted.deliveryId,corrected.result.id]);
  await m.query("update clinical.cos_delivery set state='uncertain',finding='reconciliationUnresolved' where id=$1",[conflicted.deliveryId]);
  await m.query('update clinical.report set revision=1 where id=$1',[corrected.result.id]);
  corrected.result.signedRevision=1;corrected.result.signedSnapshotId=randomUUID();
  corrected.command.expectedRevision=1;corrected.command.commandId=randomUUID();
  await m.query('set local role open_triage_api_runtime');
  const replacement=await prepareSigningSubmission(m,corrected);
  assert.notEqual(replacement.deliveryId,conflicted.deliveryId);
  assert.equal(replacement.deliveryState,'pending');
  assert.equal(replacement.revision,1);
  assert.equal((await m.query('select state from clinical.cos_delivery where id=$1',[conflicted.deliveryId]))[0].state,'superseded');
  assert.deepEqual((await signingSubmissionStatus(m,corrected.result.id)).issues,[]);
  await m.query('reset role');

  const unchecked=await fixture();unchecked.command.exportCos=false;
  assert.equal(await prepareSigningSubmission(m,unchecked),undefined);
  await finalizeSigningSnapshot(m,unchecked);
  await skipCosSigning(m,unchecked.result.id,unchecked.result.signedSnapshotId,unchecked.command);
  assert.equal((await m.query('select state from clinical.cos_delivery where report_id=$1',[unchecked.result.id]))[0].state,'excluded');
  assert.equal((await m.query('select id from clinical.cos_attempt where report_id=$1',[unchecked.result.id])).length,0);

  const stale=await fixture();const old=await prepareSigningSubmission(m,stale);
  await m.query('update clinical.report set revision=1 where id=$1',[stale.result.id]);
  await m.query("update clinical.cos_delivery set state='confirmed' where id=$1",[old.deliveryId]);
  assert.equal(await finalizeVerifiedSigning(m,old.deliveryId),false);
  assert.equal((await signingSubmissionStatus(m,stale.result.id)).finding,'draftChanged');
  await m.query('update app_identity.hospital_cos_state set active_revision=null where group_id=$1',[group]);
  const local=await fixture();assert.equal(await prepareSigningSubmission(m,local),undefined);await finalizeSigningSnapshot(m,local);
  assert.equal((await signingSubmissionStatus(m,local.result.id)).status,'signed');
  await m.query('update app_identity.hospital_cos_state set active_revision=$2 where group_id=$1',[group,revision]);
  const skipped=await fixture();skipped.command.skipCosReason='Synthetic verification outage';
  const beforeSkip=structuredClone(skipped);delete beforeSkip.command.skipCosReason;await prepareSigningSubmission(m,beforeSkip);
  await m.query('update app_identity.hospital_cos_state set active_revision=null where group_id=$1',[group]);
  assert.equal(await prepareSigningSubmission(m,skipped),undefined);
  await finalizeSigningSnapshot(m,skipped);await skipCosSigning(m,skipped.result.id,skipped.result.signedSnapshotId,skipped.command);
  const [review]=await m.query("select active_match,status from clinical.review_item where report_id=$1 and transmission_reason='delivery-failure'",[skipped.result.id]);
  assert.equal(review.active_match,true);assert.equal(review.status,'new');
  const [event]=await m.query("select evidence from clinical.cos_delivery_event where report_id=$1 and finding='signingSkipped'",[skipped.result.id]);
  assert.equal(event.evidence.reason,skipped.command.skipCosReason);
  await m.query('update app_identity.hospital_cos_state set active_revision=$2 where group_id=$1',[group,revision]);
  // Exercise the actual worker against staged, immutable bytes. No receiver network
  // is involved; the receiver checks local unsigned state before returning proof.
  const work=await fixture(),queued=await prepareSigningSubmission(m,work);
  const pdf=Buffer.from('%PDF-1.4 synthetic regression'),bundle={resourceType:'Bundle'},contact={encounter:{system:'urn:test',value:work.result.id}};
  const pdfHash=bytesHash(pdf),payloadHash=contentDigest({bundle,pdfSha256:pdfHash});
  await m.query(`insert into clinical.cos_payload(delivery_id,report_id,bundle,pdf,payload_sha256,pdf_sha256,contact,contact_sha256) values($1,$2,$3,$4,$5,$6,$7,$8)`,[queued.deliveryId,work.result.id,bundle,pdf,payloadHash,pdfHash,contact,contentDigest(contact)]);
  await m.query("update clinical.cos_delivery set finding='signingResume' where id=$1",[queued.deliveryId]);
  // Nested worker transactions stay inside this rollback-only fixture.
  const scoped={query:async(sql,args)=>(await m.query(sql,args)).filter(row=>!row.report_id||row.report_id===work.result.id),transaction:async(...args)=>args.at(-1)(m),createQueryRunner:()=>({manager:m,query:(...args)=>m.query(...args),connect:async()=>{},startTransaction:async()=>{},commitTransaction:async()=>{},rollbackTransaction:async()=>{},release:async()=>{}})};
  let writes=0;
  const assertUnsigned=async()=>assert.equal((await m.query('select status from clinical.report where id=$1',[work.result.id]))[0].status,'draft');
  await processCosWork(scoped,10,{contact:async()=>{writes++;await assertUnsigned();return {kind:'simulator-stored',contactKey:`urn:test|${work.result.id}`};},note:async()=>{writes++;await assertUnsigned();return {kind:'simulator-stored',contactKey:`urn:test|${work.result.id}`,receiptId:randomUUID(),payloadSha256:payloadHash,pdfSha256:pdfHash};}});
  assert.equal(writes,2);
  assert.equal((await signingSubmissionStatus(m,work.result.id)).status,'signed');

  // Administrative response-only acceptance can finalize the exact prepared
  // revision, while preserving the distinction from verified remote storage.
  const responseOnly=await fixture();
  const responseDelivery=await prepareSigningSubmission(m,responseOnly);
  await m.query("update clinical.cos_delivery set state='confirmed',finding='readBackDisabled' where id=$1",[responseDelivery.deliveryId]);
  await m.query(`insert into clinical.cos_delivery_event(delivery_id,report_id,worker_id,state,finding,evidence)
   values($1,$2,gen_random_uuid(),'confirmed','readBackDisabled','{"outcome":"accepted"}'::jsonb)`,[responseDelivery.deliveryId,responseOnly.result.id]);
  assert.equal(await finalizeVerifiedSigning(m,responseDelivery.deliveryId),true);
  assert.equal((await signingSubmissionStatus(m,responseOnly.result.id)).status,'signed');

  // Journal visibility is bounded by the original send time; successful receipts
  // trigger read-only checks, while rejected/unknown writes keep their errors.
  for(const scenario of ['settling','fresh','expired','rejected','error-outcome','unknown-observation','initial-delay','initial-due']){
   const waiting=await fixture(),delivery=await prepareSigningSubmission(m,waiting);
   for(const kind of ['encounter','note','pdf',...(scenario==='unknown-observation'?['observation']:[])]){
    await m.query(`insert into clinical.cos_artifact(delivery_id,report_id,artifact_key,kind,content_sha256,resource)
     values($1,$2,$3,$3,$4,'{}'::jsonb)`,[delivery.deliveryId,waiting.result.id,kind,'a'.repeat(64)]);
   }
   await m.query(`insert into clinical.cos_artifact_event(delivery_id,report_id,artifact_key,state,created_at)
    values($1,$2,'note','sending',clock_timestamp()-$3::interval)`,[delivery.deliveryId,waiting.result.id,scenario==='expired'?'6 minutes':'20 seconds']);
   const evidence={httpStatus:scenario==='rejected'?400:201,reason:'pdfNoteNotFound',responseEvidence:{issues:scenario==='error-outcome'?[{severity:'error',code:'processing'}]:[]}};
   if(scenario.startsWith('initial-')){
    evidence.reason='journalProcessing';
    evidence.journalVerificationNotBefore=new Date(Date.now()+(scenario==='initial-delay'?20_000:-1_000)).toISOString();
   }
   await m.query(`insert into clinical.cos_artifact_event(delivery_id,report_id,artifact_key,state,evidence)
    values($1,$2,'note',$3,$4::jsonb),($1,$2,'encounter','verified','{}'::jsonb)`,[delivery.deliveryId,waiting.result.id,scenario==='rejected'?'rejected':'uncertain',JSON.stringify(evidence)]);
   await m.query(`update clinical.cos_delivery set state='uncertain',finding='reconciliationUnresolved',updated_at=clock_timestamp()-$2::interval where id=$1`,[delivery.deliveryId,scenario==='fresh'?'1 second':'20 seconds']);
   const [state]=await m.query(`select ${cosJournalSettlingSql} settling,${cosSigningCheckDueSql} due from clinical.cos_delivery d where d.id=$1`,[delivery.deliveryId]);
   assert.equal(state.settling,['settling','fresh','initial-delay','initial-due'].includes(scenario),scenario);
   assert.equal(state.due,['settling','initial-due'].includes(scenario),scenario);
   if(scenario==='initial-delay'){
    await m.query(`insert into clinical.cos_delivery_event(delivery_id,report_id,worker_id,state,evidence)
     values($1,$2,gen_random_uuid(),'uncertain','{"action":"signing-check"}'::jsonb)`,[delivery.deliveryId,waiting.result.id]);
    const [manual]=await m.query(`select ${cosSigningCheckDueSql} due from clinical.cos_delivery d where d.id=$1`,[delivery.deliveryId]);
    assert.equal(manual.due,false,'manual requests cannot bypass receipt deadline');
   }
   const [signedScope]=await m.query(`select ${cosJournalCheckScopeSql} eligible
    from (select source.*,gen_random_uuid() snapshot_id from
     (select id,state,signing_submission_id,updated_at from clinical.cos_delivery where id=$1) source) d
    cross join (select 'signed'::text status) r`,[delivery.deliveryId]);
   assert.equal(signedScope.eligible,state.settling,'signed amendments share bounded verification eligibility');
   const status=await signingSubmissionStatus(m,waiting.result.id);
   assert.equal(status.finding,['settling','fresh','initial-delay','initial-due'].includes(scenario)?'inFlight':'reconciliationUnresolved',scenario);
   if(state.settling)assert.deepEqual(status.issues,[],'transient journal lookup is pending, not a duplicate error');
  }

  // Exercise comparison authorization and its real audit constraints with a fake receiver.
  await m.query('reset role');
  const liveRevision=Number(revision)+1;
  await m.query(`insert into app_identity.hospital_cos_version(group_id,revision,credential_id,endpoint,settings,canonical_mapping,catalog_release_id,form_version_id,created_by)
   select group_id,$3,$4,endpoint,settings||'{"mode":"live"}'::jsonb,canonical_mapping,catalog_release_id,form_version_id,created_by
   from app_identity.hospital_cos_version where group_id=$1 and revision=$2`,[group,revision,liveRevision,randomUUID()]);
  await m.query('update app_identity.hospital_cos_state set active_revision=$2,draft_revision=$2 where group_id=$1',[group,liveRevision]);
  const comparisonReport=await fixture();
  await m.query('set local role open_triage_api_runtime');
  const comparisonDelivery=await prepareSigningSubmission(m,comparisonReport);
  const patient={resourceType:'Patient',identifier:[{system:'urn:test',value:'fictional-patient'}],name:[{given:['Local'],family:'Name'}]};
  await m.query(`insert into clinical.cos_artifact(delivery_id,artifact_key,report_id,kind,content_sha256,resource)
   values($1,'patient',$2,'patient',$3,$4::jsonb)`,[comparisonDelivery.deliveryId,comparisonReport.result.id,contentDigest(patient),JSON.stringify(patient)]);
  await m.query("update clinical.cos_delivery set state='waiting',finding='patientIdentityConflict' where id=$1",[comparisonDelivery.deliveryId]);
  const comparisonDb={manager:m,query:(...args)=>m.query(...args),transaction:fn=>fn(m)};
  const comparisonSession={requireCapability:async()=>({organization:{id:sample.organization_id},user:{id:sample.documenting_user_id}})};
  let lookups=0;
  const comparison=await readCosPatientComparison(comparisonDb,comparisonSession,'fixture',comparisonReport.result.id,
   {revision:0,deliveryId:comparisonDelivery.deliveryId},async()=>({findPatient:async identifier=>{
    lookups++;
    return {...patient,identifier:[identifier],name:[{given:['COS'],family:'Patient'}]};
   }}));
  await m.query('reset role');
    const [audit]=await m.query("select action,care_process,integration_provenance from clinical_audit.patient_access_event where report_id=$1",[comparisonReport.result.id]);
    assert.equal(audit.action,'report.read');assert.equal(audit.care_process,'documentation');
    assert.equal(audit.integration_provenance,null,'EPS-only provenance must not be attached to COS report reads');
  assert.equal(lookups,1);assert.equal(comparison.canApply,true);assert.equal(comparison.displayName,'COS Patient');
  await m.query('set constraints all immediate');
 }finally{await runner.rollbackTransaction();await runner.release();await db.destroy();}
});
