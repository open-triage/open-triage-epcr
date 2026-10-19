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
  service.validate=async()=>({engine:'hl7-validator-7.0.2',state:'passed',dependencies:{},issues:[]});
  let calls=0,published=[];service.publish=async(bundle,secret)=>{assert.equal(secret,'private-team-credential');calls++;published.push(bundle);return {state:'accepted',issues:[],headers:{'x-pass':'true','x-errors':'0','x-submission-score':'42','content-location':'https://hackathon2026.vadimperetok.in/clinical/submission/fictional'}};};
  let config=await configuration.get(adminToken);
  const mappings=[{id:'story',source:{kind:'nemsis',elementId:'eNarrative.01'},section:'patientStory',representation:'signed-narrative'}];
  const activate=async(patientIdentifier=body.patientIdentifier)=>{const current=await configuration.get(adminToken);let next=await configuration.save(adminToken,{...body,replacementSecret:undefined,expectedRevision:current.draft.revision,patientIdentifier,outputMappings:mappings});next=await configuration.test(adminToken,{expectedRevision:next.draft.revision});return configuration.activate(adminToken,{expectedRevision:next.draft.revision,expectedStateRevision:next.stateRevision,testId:next.tests[0].id});};
  config=await activate();const exported=await configuration.export(adminToken,String(config.draft.revision));assert.deepEqual(exported.definition.outputMappings,mappings);
  const initialHash=exported.sha256;const {format,schemaVersion,sha256,...portable}=exported;
  await assert.rejects(configuration.save(adminToken,{...body,expectedRevision:config.draft.revision,mapping:makePackage({...portable,catalog:{sha256:'0'.repeat(64)}})}));
  const roundTrip=await configuration.save(adminToken,{...body,expectedRevision:config.draft.revision,mapping:JSON.parse(JSON.stringify(exported))});assert.equal(roundTrip.draft.mapping.sha256,initialHash);
  config=await configuration.test(adminToken,{expectedRevision:roundTrip.draft.revision});config=await configuration.activate(adminToken,{expectedRevision:config.draft.revision,expectedStateRevision:config.stateRevision,testId:config.tests[0].id});
  async function createSigned(){
  const report=await drafts.create(token,{commandId:randomUUID(),reportId:randomUUID(),incidentId:randomUUID(),patientId:randomUUID(),organizationId:actor.organization.id,documentingUserId:actor.user.id,patientIdentityState:'unknown'});
  const [root]=await query("select id from clinical.group_instance where report_id=$1 and group_id='PatientCareReportGroup'",[report.id]);
  const patient={id:randomUUID(),groupId:'ePatientSection',parentGroupInstanceId:root.id,ordinal:0},narrative={id:randomUUID(),groupId:'eNarrativeSection',parentGroupInstanceId:root.id,ordinal:0};
  const story={id:randomUUID(),groupInstanceId:narrative.id,elementId:'eNarrative.01',ordinal:0,value:{kind:'text',value:'Fictional signed imported history <script>never executes</script>'}};
  await drafts.save(token,report.id,{commandId:randomUUID(),expectedRevision:report.revision,authorId:actor.user.id,groups:[patient,narrative],occurrences:[{id:randomUUID(),groupInstanceId:patient.id,elementId:'ePatient.01',ordinal:0,value:{kind:'text',value:'FICTIONAL-SUBMISSION-009'}},story]},actor.csrfToken);
  await query("update clinical.element_occurrence set provenance_detail=jsonb_build_object('epsImport',$2::jsonb) where id=$1",[story.id,JSON.stringify({documentVersion:'fictional-original',documentSha256:'c'.repeat(64),entryId:'confirmed-only',mappingId:'incoming-map',mappingRevision:1,decision:'replace'})]);
  const current=await drafts.get(token,report.id),signed=await signer.sign(token,report.id,{commandId:randomUUID(),expectedRevision:current.revision,signerId:actor.user.id,attestation:{meaning:'author approval'}});
  return {report,signed,story,current};}
  const {report,signed,story,current}=await createSigned();
  const input={snapshotId:signed.signedSnapshotId,amendmentSequence:0,dataset:'synthetic'};
  await assert.rejects(rawPreview(token,report.id,input));await assert.rejects(rawPreview(token,report.id,input,'wrong-csrf'));
  await assert.rejects(service.preview(otherToken,report.id,input));await assert.rejects(service.preview(token,report.id,{...input,dataset:'real'}));
  await query('set local role open_triage_api_runtime');let preview=await service.preview(token,report.id,input);await query('reset role');
  assert.equal(preview.mappingSha256,initialHash);assert.equal(preview.validation.profile.state,'passed');assert.match(JSON.stringify(preview.bundle),/confirmed-only/);assert.match(JSON.stringify(preview.bundle),/&lt;script&gt;/);assert.match(JSON.stringify(preview.validation),/missingData/);
  // Editing the active identifier invalidates new previews, while the prepared old payload remains immutable.
  await activate({...body.patientIdentifier,field:{kind:'nemsis',elementId:'ePatient.05'}});
  const remapped=await service.preview(token,report.id,{...input,lineageParentId:preview.id});assert.equal(remapped.lineageParentId,preview.id);assert.notEqual(remapped.mappingSha256,preview.mappingSha256);assert.ok(remapped.validation.findings.some(row=>row.code==='patientIdentifier'));
  await assert.rejects(service.submit(token,report.id,{submissionId:preview.id,commandId:randomUUID(),dataset:'synthetic',confirmPublicFictional:true}));assert.equal(calls,0);
  config=await activate();preview=await service.preview(token,report.id,{...input,lineageParentId:preview.id});
  const submit={submissionId:preview.id,commandId:randomUUID(),dataset:'synthetic',confirmPublicFictional:true};
  await assert.rejects(rawSubmit(token,report.id,submit));await assert.rejects(rawSubmit(token,report.id,submit,'wrong-csrf'));
  await assert.rejects(service.submit(otherToken,report.id,submit));await assert.rejects(service.submit(token,report.id,{...submit,confirmPublicFictional:false}));
  await query('set local role open_triage_api_runtime');let result=await service.submit(token,report.id,submit);await query('reset role');assert.equal(result.state,'accepted');assert.equal(calls,1);assert.equal((await service.submit(token,report.id,submit)).state,'accepted');assert.equal((await service.submit(token,report.id,{...submit,commandId:randomUUID()})).state,'accepted');assert.equal(calls,1);
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
  const rejected=await service.submit(token,rejectedSource.report.id,{...submit,submissionId:rejectedPreview.id,commandId:randomUUID()});assert.equal(rejected.state,'rejected');assert.equal(rejected.result.issues[0].code,'structure');
  const deliberate=await service.preview(token,rejectedSource.report.id,{...rejectedInput,lineageParentId:rejectedPreview.id});assert.equal(deliberate.lineageParentId,rejectedPreview.id);assert.equal((await service.history(token,rejectedSource.report.id,'synthetic')).find(row=>row.id===rejectedPreview.id).state,'rejected');
  service.validate=async()=>({engine:'unavailable',state:'unavailable',dependencies:{},issues:[]});const unavailable=await service.preview(token,rejectedSource.report.id,rejectedInput);await assert.rejects(service.submit(token,rejectedSource.report.id,{...submit,submissionId:unavailable.id,commandId:randomUUID()}));service.validate=async()=>({engine:'hl7-validator-7.0.2',state:'passed',dependencies:{},issues:[]});
  await epsSubmissionBrowser({service,token,reportId:rejectedSource.report.id,snapshotId:rejectedSource.signed.signedSnapshotId,amendmentSequence:0,csrfToken:actor.csrfToken});
  assert.ok(original);assert.equal(published.length,1);
 }finally{await query('reset role');await query('rollback to savepoint eps_submission_journey');await query('release savepoint eps_submission_journey');process.env.OPENTRIAGE_DEFINITIONS_ROOT=originalRoot;await rm(folder,{recursive:true,force:true});}
}
