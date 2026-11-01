import {epsDeliverySummary} from '../../dist/hospital/eps-delivery-summary.js';
import {processEpsWork,queueSignedEps} from '../../dist/hospital/eps-automatic-export.js';
import {HospitalHistoryService} from '../../dist/hospital/hospital-history.service.js';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {DraftReportService} from '../../dist/reports/draft-report.service.js';
import {SignReportService} from '../../dist/reports/sign-report.service.js';
import {AmendReportService} from '../../dist/reports/amend-report.service.js';
import {EpsSubmissionService} from '../../dist/hospital/eps-submission.service.js';
import {makePackage} from '../../dist/admin/canonical-package.js';
import {epsSubmissionBrowser} from './eps-submission-browser.mjs';
/** Rollback-contained fixture uses normal configuration/signing and real authorization; only external boundaries are deterministic. */
export async function epsSubmissionJourney({database,query,sessions,configuration,adminToken,otherToken,body}){
 const originalRoot=process.env.OPENTRIAGE_DEFINITIONS_ROOT,folder=await mkdtemp('/tmp/eps-submission-fixture-');process.env.OPENTRIAGE_DEFINITIONS_ROOT=folder;
 await query('savepoint eps_submission_journey');
 try{
  process.env.PATIENT_KEY_INSTALLATION_ID??='91000000-0000-4000-8000-000000000001';process.env.PATIENT_KEY_VERSION??='1';process.env.PATIENT_KEY_SECRET_BASE64??=Buffer.alloc(32,0x31).toString('base64');
  const login=await sessions.create({username:'demo',password:'opentriagedemo'}),token=login.sessionToken,actor=login.session;
  const drafts=new DraftReportService(database,sessions),signer=new SignReportService(database,sessions),service=new EpsSubmissionService(database,sessions);
  const rawPreview=service.preview.bind(service),rawSubmit=service.submit.bind(service);service.preview=(t,id,body,csrf=actor.csrfToken)=>rawPreview(t,id,body,csrf);service.submit=(t,id,body,csrf=actor.csrfToken)=>rawSubmit(t,id,body,csrf);
  let calls=0,published=[];service.publish=async(bundle,secret)=>{assert.equal(secret,'private-team-credential');calls++;published.push(bundle);return {state:'accepted',issues:[],headers:{'x-pass':'true','x-errors':'0','x-submission-score':'42','content-location':'https://hackathon2026.vadimperetok.in/clinical/submission/fictional'}};};
  let config=await configuration.get(adminToken);
  const mappings=[{id:'story',source:{kind:'nemsis',elementId:'eNarrative.01'},section:'patientStory',representation:'signed-narrative'}];
  const activate=async(patientIdentifier=body.patientIdentifier)=>{const current=await configuration.get(adminToken);let next=await configuration.save(adminToken,{...body,replacementSecret:undefined,expectedRevision:current.draft.revision,patientIdentifier,outputMappings:mappings});next=await configuration.test(adminToken,{expectedRevision:next.draft.revision});return configuration.activate(adminToken,{expectedRevision:next.draft.revision,expectedStateRevision:next.stateRevision,testId:next.tests[0].id});};
  config=await activate();const exported=await configuration.export(adminToken,String(config.draft.revision));assert.deepEqual(exported.definition.outputMappings,mappings);
  const initialHash=exported.sha256;const {format,schemaVersion,sha256,...portable}=exported;
  await assert.rejects(configuration.save(adminToken,{...body,expectedRevision:config.draft.revision,mapping:makePackage({...portable,catalog:{sha256:'0'.repeat(64)}})}));
  const roundTrip=await configuration.save(adminToken,{...body,expectedRevision:config.draft.revision,mapping:JSON.parse(JSON.stringify(exported))});assert.equal(roundTrip.draft.mapping.sha256,initialHash);
  config=await configuration.test(adminToken,{expectedRevision:roundTrip.draft.revision});config=await configuration.activate(adminToken,{expectedRevision:config.draft.revision,expectedStateRevision:config.stateRevision,testId:config.tests[0].id});
  async function createSigned(exportEps=false){
  const report=await drafts.create(token,{commandId:randomUUID(),reportId:randomUUID(),incidentId:randomUUID(),patientId:randomUUID(),organizationId:actor.organization.id,documentingUserId:actor.user.id,patientIdentityState:'unknown'});
  const [root]=await query("select id from clinical.group_instance where report_id=$1 and group_id='PatientCareReportGroup'",[report.id]);
  const patient={id:randomUUID(),groupId:'ePatientSection',parentGroupInstanceId:root.id,ordinal:0},narrative={id:randomUUID(),groupId:'eNarrativeSection',parentGroupInstanceId:root.id,ordinal:0};
  const story={id:randomUUID(),groupInstanceId:narrative.id,elementId:'eNarrative.01',ordinal:0,value:{kind:'text',value:'Fictional signed imported history <script>never executes</script>'}};
  await drafts.save(token,report.id,{commandId:randomUUID(),expectedRevision:report.revision,authorId:actor.user.id,groups:[patient,narrative],occurrences:[{id:randomUUID(),groupInstanceId:patient.id,elementId:'ePatient.01',ordinal:0,value:{kind:'text',value:'FICTIONAL-SUBMISSION-009'}},story]},actor.csrfToken);
  await query("update clinical.element_occurrence set provenance_detail=jsonb_build_object('epsImport',$2::jsonb) where id=$1",[story.id,JSON.stringify({documentVersion:'fictional-original',documentSha256:'c'.repeat(64),entryId:'confirmed-only',mappingId:'incoming-map',mappingRevision:1,decision:'replace'})]);
  const current=await drafts.get(token,report.id),signed=await signer.sign(token,report.id,{commandId:randomUUID(),expectedRevision:current.revision,signerId:actor.user.id,attestation:{meaning:'author approval'},exportEps});
  if(exportEps){assert.equal(signed.status,'awaiting-eps');signed.signedSnapshotId=signed.submissionId;assert.equal((await query('select status from clinical.report where id=$1',[report.id]))[0].status,'draft');}
  const [queued]=await query("select active_match,eps_snapshot_id from clinical.review_item where report_id=$1 and kind='eps-export'",[report.id]);
  assert.equal(queued,undefined,'signing does not create premature EPS Review work');
  if(exportEps)assert.equal((await query("select count(*)::int n from clinical.eps_submission where report_id=$1 and validation->>'automatic'='true'",[report.id]))[0].n,1);
  return {report,signed,story,current};}
  const {report,signed,story,current}=await createSigned();
  const input={snapshotId:signed.signedSnapshotId,amendmentSequence:0,dataset:'synthetic'};
  await assert.rejects(rawPreview(token,report.id,input));await assert.rejects(rawPreview(token,report.id,input,'wrong-csrf'));
  await assert.rejects(service.preview(otherToken,report.id,input));await assert.rejects(service.preview(token,report.id,{...input,dataset:'real'}));
  await query('set local role open_triage_api_runtime');let preview=await service.preview(token,report.id,input);await query('reset role');
  assert.equal(preview.mappingSha256,initialHash);assert.equal(preview.validation.profile.state,'pending');assert.equal(preview.validation.profile.engine,'receiver');assert.match(JSON.stringify(preview.bundle),/confirmed-only/);assert.match(JSON.stringify(preview.bundle),/&lt;script&gt;/);assert.match(JSON.stringify(preview.validation),/missingData/);
  // Editing the active identifier invalidates new previews, while the prepared old payload remains immutable.
  await activate({...body.patientIdentifier,field:{kind:'nemsis',elementId:'ePatient.05'}});
  const remapped=await service.preview(token,report.id,{...input,lineageParentId:preview.id});assert.equal(remapped.lineageParentId,preview.id);assert.notEqual(remapped.mappingSha256,preview.mappingSha256);assert.ok(remapped.validation.findings.some(row=>row.code==='patientIdentifier'));
  await assert.rejects(service.submit(token,report.id,{submissionId:preview.id,commandId:randomUUID(),dataset:'synthetic',confirmPublicFictional:true}));assert.equal(calls,0);
  config=await activate();preview=await service.preview(token,report.id,{...input,lineageParentId:preview.id});
  const submit={submissionId:preview.id,commandId:randomUUID(),dataset:'synthetic',confirmPublicFictional:true};
  await assert.rejects(rawSubmit(token,report.id,submit));await assert.rejects(rawSubmit(token,report.id,submit,'wrong-csrf'));
  await assert.rejects(service.submit(otherToken,report.id,submit));await assert.rejects(service.submit(token,report.id,{...submit,confirmPublicFictional:false}));
  await query('set local role open_triage_api_runtime');let result=await service.submit(token,report.id,submit);await query('reset role');assert.equal(result.state,'accepted');assert.equal((await query("select active_match from clinical.review_item where report_id=$1 and kind='eps-export'",[report.id]))[0].active_match,false);assert.equal(calls,1);assert.equal((await service.submit(token,report.id,submit)).state,'accepted');assert.equal((await service.submit(token,report.id,{...submit,commandId:randomUUID()})).state,'accepted');assert.equal(calls,1);
  const duplicate=await service.preview(token,report.id,input);await assert.rejects(service.submit(token,report.id,{...submit,submissionId:duplicate.id,commandId:randomUUID()}));assert.equal(calls,1);await assert.rejects(service.submit(token,report.id,{...submit,submissionId:duplicate.id}));
  const audit=await query('select integration_provenance from clinical_audit.patient_access_event where report_id=$1',[report.id]);assert.doesNotMatch(JSON.stringify(audit),/FICTIONAL-SUBMISSION|confirmed-only|never executes|private-team/);
  const operational=await new HospitalHistoryService(database,sessions).list(adminToken,{dataset:'synthetic',reportId:report.id});
  const acceptedOperational=operational.entries.find(row=>row.id===preview.id);assert.equal(acceptedOperational.state,'accepted');assert.equal(acceptedOperational.attemptCount,1);assert.equal(acceptedOperational.mapping.sha256,preview.mappingSha256);
  assert.ok(acceptedOperational.events.some(e=>e.action==='eps.submit'&&e.state==='unknown'));assert.ok(acceptedOperational.events.some(e=>e.action==='eps.result'&&e.acknowledgement.pass===true&&e.acknowledgement.errors===0));
  assert.doesNotMatch(JSON.stringify(operational),/FICTIONAL-SUBMISSION|confirmed-only|never executes|private-team|resourceType|Bundle.entry/);
  const retainedOperational=await query('select * from clinical_audit.hospital_operational_event where source_id=$1',[preview.id]);assert.ok(retainedOperational.some(e=>e.remote_pass===true&&e.remote_errors===0));assert.doesNotMatch(JSON.stringify(retainedOperational),/FICTIONAL-SUBMISSION|confirmed-only|private-team/);
  const original=(await query('select * from clinical.element_occurrence where id=$1',[story.id]))[0];
  const amend=new AmendReportService(database);
  await amend.amend(report.id,{commandId:randomUUID(),expectedSequence:1,authorId:actor.user.id,reason:'Fictional correction',attestation:{meaning:'author approval'},changes:[{action:'replace',targetElementOccurrenceId:story.id,value:{kind:'text',value:'Fictional corrected history'}}]}).catch(error=>{throw new Error(JSON.stringify(error.getResponse?.()??error));});
  const amended=await service.preview(token,report.id,{...input,amendmentSequence:1});assert.match(JSON.stringify(amended.bundle),/corrected history/);assert.doesNotMatch(JSON.stringify(amended.bundle),/never executes/);assert.equal(calls,1,'amendment never automatically publishes');
  service.publish=async()=>{calls++;throw new Error('Lost acknowledgement PRIVATE provider body');};
  result=await service.submit(token,report.id,{...submit,submissionId:amended.id,commandId:randomUUID()});assert.equal(result.state,'unknown');assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
  const uncertain=await service.preview(token,report.id,{...input,amendmentSequence:1,lineageParentId:amended.id});await assert.rejects(service.submit(token,report.id,{...submit,submissionId:uncertain.id,commandId:randomUUID()}));assert.equal(calls,2);
  // Separate signed report gives rejection coverage without pretending savepoints advance transaction_timestamp().
  const rejectedSource=await createSigned(),rejectedInput={snapshotId:rejectedSource.signed.signedSnapshotId,amendmentSequence:0,dataset:'synthetic'};
  const rejectedPreview=await service.preview(token,rejectedSource.report.id,rejectedInput);
  service.publish=async()=>({state:'rejected',issues:[{severity:'error',code:'structure',expression:['Bundle.entry[0]']}],headers:{'x-pass':'false','x-errors':'1'}});
  const rejected=await service.submit(token,rejectedSource.report.id,{...submit,submissionId:rejectedPreview.id,commandId:randomUUID()});assert.equal((await query("select active_match from clinical.review_item where report_id=$1 and kind='eps-export'",[rejectedSource.report.id]))[0].active_match,true);assert.equal(rejected.state,'rejected');assert.equal(rejected.result.issues[0].code,'structure');
  const deliberate=await service.preview(token,rejectedSource.report.id,{...rejectedInput,lineageParentId:rejectedPreview.id});assert.equal(deliberate.lineageParentId,rejectedPreview.id);assert.equal((await service.history(token,rejectedSource.report.id,'synthetic')).find(row=>row.id===rejectedPreview.id).state,'rejected');
  service.validate=async()=>({engine:'unavailable',state:'unavailable',dependencies:{},issues:[]});const unavailable=await service.preview(token,rejectedSource.report.id,rejectedInput);await assert.rejects(service.submit(token,rejectedSource.report.id,{...submit,submissionId:unavailable.id,commandId:randomUUID()}));service.validate=async()=>({engine:'receiver',state:'pending',dependencies:{},issues:[]});
  await epsSubmissionBrowser({service,token,reportId:rejectedSource.report.id,snapshotId:rejectedSource.signed.signedSnapshotId,amendmentSequence:0,csrfToken:actor.csrfToken});
  // Automatic exports run under service authority, independently of a browser or Review session.
  const autoDb={...database,query:async(sql,args)=>(await query(sql,args)).filter(row=>!row.report_id||autoReports.has(row.report_id)),
   createQueryRunner:()=>({connect:async()=>{},release:async()=>{},query,manager:{query,transaction:database.transaction}})};
  const autoReports=new Set();let automaticCalls=0;const failures={};
  const deliver=async()=>{automaticCalls++;return {state:'accepted',issues:[],headers:{'x-pass':'true'}};};
  const auto=await createSigned(true);autoReports.add(auto.report.id);
  assert.deepEqual(await epsDeliverySummary(database.manager,auto.report.id),{state:'prepared',issues:[]});
  await queueSignedEps(database.manager,auto.report.id,auto.signed.signedSnapshotId,actor.user.id);
  assert.equal((await query('select count(*)::int n from clinical.eps_submission where report_id=$1',[auto.report.id]))[0].n,1);
  await query('set local role open_triage_api_runtime');
  await processEpsWork(autoDb,100,deliver);await processEpsWork(autoDb,100,deliver);
  await query('reset role');assert.equal(automaticCalls,1);
  assert.equal((await service.history(token,auto.report.id,'synthetic'))[0].state,'accepted');
  assert.equal((await service.history(token,auto.report.id,'synthetic'))[0].snapshotId,auto.signed.signedSnapshotId);
  assert.equal((await query("select count(*)::int n from clinical.review_item where report_id=$1 and kind='eps-export'",[auto.report.id]))[0].n,0);
  const duplicateAutomatic=await service.preview(token,auto.report.id,{dataset:'synthetic',snapshotId:auto.signed.signedSnapshotId,amendmentSequence:0});
  await assert.rejects(service.submit(token,auto.report.id,{dataset:'synthetic',submissionId:duplicateAutomatic.id,commandId:randomUUID(),confirmPublicFictional:true}),error=>error.getResponse?.().code==='epsSubmission.alreadyAttempted');


  for(const state of ['rejected','unknown']){
   const failed=await createSigned(true);autoReports.add(failed.report.id);failures[state]=failed;
   await processEpsWork(autoDb,100,async()=>{automaticCalls++;if(state==='unknown')throw new Error('lost acknowledgement');return {state,issues:[],headers:{'x-pass':'false'}};});
   assert.equal((await query('select status from clinical.report where id=$1',[failed.report.id]))[0].status,'draft');
   assert.equal((await query('select count(*)::int n from clinical.signed_snapshot where report_id=$1',[failed.report.id]))[0].n,0);
   assert.equal((await epsDeliverySummary(database.manager,failed.report.id)).state,state);
   assert.equal((await query("select count(*)::int n from clinical.review_item where report_id=$1 and kind='eps-export'",[failed.report.id]))[0].n,0);
  }
  await processEpsWork(autoDb,100,deliver);assert.equal(automaticCalls,3,'failed and uncertain attempts are never blindly resent');
  const rejectedDraft=failures.rejected;
  const retry=await signer.sign(token,rejectedDraft.report.id,{commandId:randomUUID(),expectedRevision:rejectedDraft.current.revision,signerId:actor.user.id,attestation:{meaning:'author approval'},exportEps:true});
  assert.equal(retry.status,'awaiting-eps');
  await processEpsWork(autoDb,100,deliver);
  assert.equal((await signer.signingStatus(token,rejectedDraft.report.id)).status,'signed');
  const unknownDraft=failures.unknown;
  const unknownRetry=await signer.sign(token,unknownDraft.report.id,{commandId:randomUUID(),expectedRevision:unknownDraft.current.revision,signerId:actor.user.id,attestation:{meaning:'author approval'},exportEps:true});
  assert.equal(unknownRetry.status,'awaiting-eps');
  assert.equal(unknownRetry.epsDelivery.state,'unknown');
  await processEpsWork(autoDb,100,deliver);assert.equal(automaticCalls,4,'explicit retry only sends the rejected submission');
  const interrupted=await createSigned(true);autoReports.add(interrupted.report.id);
  const [pending]=await query('select id from clinical.eps_submission where report_id=$1',[interrupted.report.id]);
  await query("insert into clinical.eps_submission_attempt(id,submission_id,command_id,actor_id,created_at) values($1,$2,$3,$4,clock_timestamp()-interval '3 minutes')",[randomUUID(),pending.id,randomUUID(),actor.user.id]);
  await processEpsWork(autoDb,100,deliver);
  assert.equal((await epsDeliverySummary(database.manager,interrupted.report.id)).state,'unknown');
  assert.equal(automaticCalls,4,'a crashed process never causes an unproven second send');
  const disabled=await createSigned(true);autoReports.add(disabled.report.id);
  await query('savepoint disable_automatic_eps');
  await query('update app_identity.hospital_eps_state set active_revision=null where group_id=$1',[actor.organization.id]);
  await processEpsWork(autoDb,100,deliver);
  assert.equal((await epsDeliverySummary(database.manager,disabled.report.id)).issues[0].code,'configurationChanged');
  assert.equal(automaticCalls,4);
  await query('rollback to savepoint disable_automatic_eps');await query('release savepoint disable_automatic_eps');
  // A response for an edited draft cannot finalize the old prepared content.
  const editedDuringSend=await createSigned(true);autoReports.add(editedDuringSend.report.id);
  await processEpsWork(autoDb,100,async()=>{await query('update clinical.report set revision=revision+1 where id=$1',[editedDuringSend.report.id]);return {state:'accepted',issues:[],headers:{'x-pass':'true'}};});
  assert.equal((await query('select status from clinical.report where id=$1',[editedDuringSend.report.id]))[0].status,'draft');
  assert.equal((await query('select count(*)::int n from clinical.signed_snapshot where report_id=$1',[editedDuringSend.report.id]))[0].n,0);
  const editedBeforeSend=await createSigned(true);autoReports.add(editedBeforeSend.report.id);
  await query('update clinical.report set revision=revision+1 where id=$1',[editedBeforeSend.report.id]);
  assert.equal((await epsDeliverySummary(database.manager,editedBeforeSend.report.id)).state,'draftChanged');
  const correctedRequest=await signer.sign(token,editedBeforeSend.report.id,{commandId:randomUUID(),expectedRevision:editedBeforeSend.current.revision+1,signerId:actor.user.id,attestation:{meaning:'author approval'},exportEps:true});
  assert.equal(correctedRequest.status,'awaiting-eps');
  let correctedSends=0;
  await processEpsWork(autoDb,100,async()=>{correctedSends++;return {state:'accepted',issues:[],headers:{'x-pass':'true'}};});
  await processEpsWork(autoDb,100,async()=>{correctedSends++;throw Error('Obsolete EPS must never be sent after signing');});
  assert.equal(correctedSends,1);
  assert.equal((await signer.signingStatus(token,editedBeforeSend.report.id)).status,'signed');
  assert.ok(original);assert.equal(published.length,1);
 }finally{await query('reset role');await query('rollback to savepoint eps_submission_journey');await query('release savepoint eps_submission_journey');process.env.OPENTRIAGE_DEFINITIONS_ROOT=originalRoot;await rm(folder,{recursive:true,force:true});}
}
