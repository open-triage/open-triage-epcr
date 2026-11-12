import {AndroidUpgradePolicyService} from '../dist/admin/android-upgrade-policy.service.js';
import {AndroidReleaseService} from '../dist/admin/android-release.service.js';
import catalog from '@open-triage/contracts/config/android-releases.json' with {type:'json'};
import {createHash} from 'node:crypto';
import {enableProductionWorkflowForTesting} from './fixtures/production-workflow-rollout.mjs';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { DataSource } from 'typeorm';
import { SYNTHETIC_DEMO_FIXTURE } from '@open-triage/contracts';
import { AssignedCallsService } from '../dist/calls/assigned-calls.service.js';
import { DraftReportService } from '../dist/reports/draft-report.service.js';
import { ProtectedReportKeyService } from '../dist/reports/protected-report-key.service.js';
import { AgencySettingsService } from '../dist/admin/agency-settings.service.js';
import { InstallationEnrollmentService } from '../dist/admin/installation-enrollment.service.js';
import { ClinicianSessionService } from '../dist/sessions/clinician-session.service.js';
import { AgencyDirectoryService } from '../dist/sessions/agency-directory.service.js';
import { SchedulesService } from '../dist/schedules/schedules.service.js';
import { createPasswordVerifier } from '../dist/identity/password.js';
import { agencyRequest } from '../dist/sessions/agency-context.js';
import { ValidationAuthoringService } from '../dist/admin/validation-authoring.service.js';
import { FormPublicationService } from '../dist/forms/form-publication.service.js';
import { canonicalDefinitionSha256 } from '../dist/forms/form-publication.validation.js';
import { routeDispatchAssignment } from '../dist/dispatch/dispatch-assignment.projection.js';
const integration=process.env.DATABASE_URL?test:test.skip;
if(process.env.REQUIRE_DATABASE_INTEGRATION&&!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
process.env.PATIENT_KEY_INSTALLATION_ID ??= '91000000-0000-4000-8000-000000000001';
process.env.PATIENT_KEY_VERSION ??= '1';
process.env.PATIENT_KEY_SECRET_BASE64 ??= Buffer.alloc(32,0x31).toString('base64');
const secret=()=>randomBytes(32).toString('base64url');
const denied=code=>error=>error.getResponse?.().code===code;

integration('runtime production jobs resolve live enrollment, schedules, dispatch and report ownership across PostgreSQL races',async()=>{
 const admin=new pg.Client({connectionString:process.env.DATABASE_URL});await admin.connect();
 const db=new DataSource({type:'postgres',url:process.env.DATABASE_URL,extra:{options:'-c role=open_triage_api_runtime'}});await db.initialize();
 const agency=SYNTHETIC_DEMO_FIXTURE.organizationId,user=randomUUID(),username=`jobs-${user}`,password='Production regression password 42!',origin='https://production-jobs.example';
 let scope=agency;
 const directory=new AgencyDirectoryService(db);
 const agencies={allowsOrigin:async x=>x===origin,forLogin:async()=>({id:scope,name:'Fictional job agency',shift_session_duration_hours:12}),accessible:(...args)=>directory.accessible(...args)};
 const sessions=new ClinicianSessionService(db,agencies),schedules=new SchedulesService(db,sessions);
 const calls=new AssignedCallsService(db,sessions,schedules),reports=new DraftReportService(db,sessions,schedules);
 const administrative={requireCapability:async()=>({organization:{id:scope},user:{id:SYNTHETIC_DEMO_FIXTURE.userId}})};
 const enrollment=new InstallationEnrollmentService(db,administrative,agencies);
 const scheduleAdmin=new SchedulesService(db,administrative);
 const run=(credential,work,organizationId=scope)=>agencyRequest.run({origin,organizationId,installationCredential:credential},work);
 const unit=async organizationId=>{const id=randomUUID();await admin.query(`insert into app_identity.operational_unit(id,organization_id,name,call_sign) values($1,$2,'Production fixture',$3)`,[id,organizationId,`JOB-${id}`]);return id;};
 const pair=async unitId=>{const code=await run(undefined,()=>enrollment.issue('admin',unitId));return run(undefined,()=>enrollment.consume({token:code.token,name:'Job browser',confirmInstallation:true},secret()));};
 const login=credential=>run(credential,()=>sessions.create({username,password}));
 const template=JSON.parse(await readFile(new URL('../../../packages/contracts/examples/dispatch/synthetic-assignment-01.json',import.meta.url),'utf8'));
 const dispatch=async unitId=>{const payload=structuredClone(template),record=randomUUID();payload.messageId=randomUUID();payload.sourceRecordId=record;
  const elements=payload.groups.flatMap(x=>x.instances).flatMap(x=>x.elements);
  const set=(id,value)=>{elements.find(x=>x.id===id).values[0].value=value;};
  set('eResponse.03',`REAL-${record}`);set('eResponse.04',`RESPONSE-${record}`);set('eResponse.14',`JOB-${unitId}`);
  const routed=await db.transaction(manager=>routeDispatchAssignment(manager,{organizationId:agency,sourceId:'production-regression',sourceBytes:Buffer.from(JSON.stringify(payload)),canonical:payload,validationStatus:'applied',findings:[]}));
  return routed.assignmentId;
 };
 const blank=async unitId=>{const selected=await scheduleAdmin.save('admin',null,{name:`Blank ${unitId}`,breakpoints:[]});await scheduleAdmin.select('admin',unitId,{scheduleId:selected.id,expectedRevision:0});return selected;};
 const open=(binding,session,assignment)=>run(binding?.credential,()=>calls.open(session.sessionToken,assignment));
 const state=(binding,session)=>run(binding?.credential,()=>calls.list(session.sessionToken));
 const waitFor=async(sql,values=[])=>{const deadline=Date.now()+5000;for(;;){await admin.query('select pg_stat_clear_snapshot()');const [row]=(await admin.query(sql,values)).rows;if(row.ready)return;assert.ok(Date.now()<deadline,'PostgreSQL authority wait did not reach the expected boundary');await new Promise(resolve=>setTimeout(resolve,20));}};
 const waitForAssignmentLock=()=>waitFor(`select exists(select 1 from pg_stat_activity
  where wait_event_type='Lock' and pg_backend_pid()=any(pg_blocking_pids(pid))
  and query like '%clinical.call_assignment%') ready`);
 const waitForExpiry=session=>waitFor("select expires_at<=clock_timestamp() ready from app_identity.app_session where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(session.sessionToken)]);

 try{
 await enableProductionWorkflowForTesting(admin,agency,SYNTHETIC_DEMO_FIXTURE.userId);
 await admin.query(`insert into app_identity.app_user(id,organization_id,display_name,synthetic) values($1,$2,'Fictional production clinician',false)`,[user,agency]);
 await admin.query(`insert into app_identity.local_credential(user_id,username,password_verifier,must_change_password) values($1,$2,$3,false)`,[user,username,await createPasswordVerifier(password)]);
 await admin.query(`insert into app_identity.user_role_assignment(organization_id,user_id,role_id) select $1,$2,id from app_identity.role where organization_id=$1 and system_key='clinician'`,[agency,user]);
 // Publish a minimal real configuration through the same API authoring boundary.
 const baseline=(await admin.query('select catalog_release_id from forms.form_version limit 1')).rows[0];
 const formId=randomUUID(),formVersionId=randomUUID(),actor=SYNTHETIC_DEMO_FIXTURE.userId;
 const definition={schemaVersion:1,sections:[{key:'narrative',fields:[{key:'narrative',source:{kind:'nemsis',elementId:'eNarrative.01'}}]}]};
 const sha=canonicalDefinitionSha256(definition);
 await db.query(`insert into forms.form(id,organization_id,slug,name) values($1,$2,$3,'Production job form')`,[formId,agency,`jobs-${formId}`]);
 await db.query(`insert into forms.form_version(id,form_id,catalog_release_id,version,canonical_definition,definition_sha256,created_by)
 values($1,$2,$3,1,$4::jsonb,$5,$6)`,[formVersionId,formId,baseline.catalog_release_id,JSON.stringify(definition),sha,actor]);
 await new FormPublicationService(db).publish(formVersionId,{publishedBy:actor,definitionSha256:sha,changeNote:'Production regression'},agency);
 const validations=new ValidationAuthoringService(db,administrative);
 const policy=await validations.create('admin',{catalogReleaseId:baseline.catalog_release_id,displayName:'Job test policy'},
 {importedRules:[{id:randomUUID(),name:'Fictional narrative',enabled:false,severity:'error',executionTargets:['live','sign'],primaryTargetElementId:'eNarrative.01',message:'Fictional narrative required',source:'require present("eNarrative.01")'}]});
 const publishedPolicy=await validations.publish('admin',policy.id,{expectedRevision:policy.revision,displayName:policy.displayName,changeNote:'Production regression'});
 await validations.activate('admin',publishedPolicy.id,{formVersionId,catalogReleaseId:baseline.catalog_release_id,changeNote:'Production regression'});
 const firstUnit=await unit(agency),otherUnit=await unit(agency),binding=await pair(firstUnit),paired=await login(binding.credential),unpaired=await login();
 const assignment=await dispatch(firstUnit),otherAssignment=await dispatch(otherUnit);
 assert.equal((await state(undefined,unpaired)).productionAccess.state,'enrollment-required');
 await assert.rejects(open(undefined,unpaired,assignment),denied('calls.enrollmentRequired'));
 assert.equal((await state(binding,paired)).productionAccess.state,'schedule-required');
 await assert.rejects(open(binding,paired,assignment),denied('calls.scheduleRequired'));
 const selected=await blank(firstUnit);await blank(otherUnit);
 const listed=await state(binding,paired);assert.equal(listed.productionAccess.state,'ready');assert.equal(listed.productionAccess.unit.id,firstUnit);
 assert.ok(listed.assignedCalls.some(x=>x.id===assignment));assert.ok(!listed.assignedCalls.some(x=>x.id===otherAssignment));
 assert.equal((await admin.query('select count(*) n from app_identity.unit_clinician where user_id=$1',[user])).rows[0].n,'0','production authority needs no roster');
 await assert.rejects(open(binding,paired,otherAssignment),/unavailable/);
 await assert.rejects(open(undefined,paired,assignment),denied('calls.enrollmentRequired'),'a paired session cookie alone cannot enroll a browser');
 const published=(await admin.query('select * from app_identity.active_configuration_bundle where organization_id=$1',[agency])).rows[0];
 const opened=await Promise.all([open(binding,paired,assignment),open(binding,paired,assignment)]);
 assert.equal(opened[0].report.id,opened[1].report.id);assert.equal(opened[0].report.formVersionId,published.form_version_id);
 const reportId=opened[0].report.id;
 const original=(await admin.query(`select organization_id,incident_id,documenting_user_id,form_version_id,catalog_release_id,validation_version_id,
 synthetic,synthetic_generated_by,expires_at from clinical.report where id=$1`,[reportId])).rows[0];
 assert.equal(original.synthetic,false);assert.equal(original.synthetic_generated_by,null);assert.equal(original.expires_at,null);
 assert.equal((await admin.query('select count(*) n from clinical.report where incident_id=$1',[original.incident_id])).rows[0].n,'1');
 // Existing owned reports and idempotent call retries remain usable without pairing.
 assert.equal((await open(undefined,unpaired,assignment)).report.id,reportId);
 assert.equal((await run(undefined,()=>reports.reopen(unpaired.sessionToken,reportId))).report.formVersionId,original.form_version_id);
 const standalone={commandId:randomUUID(),reportId:randomUUID(),incidentId:randomUUID(),patientId:randomUUID(),organizationId:agency,documentingUserId:user,patientIdentityState:'unknown'};
 await assert.rejects(run(undefined,()=>reports.create(unpaired.sessionToken,standalone)),denied('calls.enrollmentRequired'));
 // Real new-work gates cover both dispatch-open and standalone creation, while
 // retirement cannot invalidate owned report reopen, call retry or command replay.
 {
  const previousSelection=process.env.ANDROID_APPROVED_RELEASE;
  const approved=structuredClone(catalog),replacement=approved.releases[0],bytes=Buffer.from('synthetic upgrade-policy replacement');
  const hash=createHash('sha256').update(bytes).digest('hex');
  replacement.descriptor.apkSha256=hash;replacement.descriptor.apkBytes=bytes.length;
  replacement.descriptor.artifact=`opentriage-${replacement.descriptor.versionName}-${replacement.descriptor.versionCode}-${hash}.apk`;
  replacement.downloadUrl=`https://github.com/open-triage/open-triage-epcr/releases/download/${replacement.tag}/${replacement.descriptor.artifact}`;
  const lifecycle={schemaVersion:1,retirements:[]};
  process.env.ANDROID_APPROVED_RELEASE=replacement.tag;
  const release=new AndroidReleaseService(sessions,async()=>new Response(bytes),approved);
  const upgrade=new AndroidUpgradePolicyService(db,sessions,release,enrollment,approved,lifecycle);
  const gatedCalls=new AssignedCallsService(db,sessions,schedules,upgrade),gatedReports=new DraftReportService(db,sessions,schedules,upgrade);
  const android=(version,work,legacy=false)=>agencyRequest.run({origin,installationCredential:binding.credential,androidVersion:version,legacyAndroid:legacy},work);
  try {
   const pendingCommand={...standalone,commandId:randomUUID(),reportId:randomUUID(),incidentId:randomUUID(),patientId:randomUUID()};
   const before=await android(undefined,()=>gatedReports.create(paired.sessionToken,pendingCommand),true);
   assert.equal(before.id,pendingCommand.reportId,'the oldest supported unversioned APK starts before retirement');
   lifecycle.retirements.push({versionCode:1,supersededAt:'2000-01-01T00:00:00.000Z',replacementTag:replacement.tag});
   const incoming=await dispatch(firstUnit);
   await assert.rejects(android('1',()=>gatedCalls.open(paired.sessionToken,incoming)),error=>error.getStatus?.()===426);
   await assert.rejects(android(undefined,()=>gatedCalls.open(paired.sessionToken,incoming),true),error=>error.getStatus?.()===426);
   const freshCommand={...pendingCommand,commandId:randomUUID(),reportId:randomUUID(),incidentId:randomUUID(),patientId:randomUUID()};
   await assert.rejects(android('1',()=>gatedReports.create(paired.sessionToken,freshCommand)),error=>error.getStatus?.()===426);
   assert.equal((await admin.query('select report_id,status from clinical.call_assignment where id=$1',[incoming])).rows[0].report_id,null);
   assert.equal((await admin.query('select count(*)::int n from clinical.report where id=$1',[freshCommand.reportId])).rows[0].n,0);
   assert.equal((await admin.query('select count(*)::int n from clinical.command_receipt where idempotency_key=$1',[freshCommand.commandId])).rows[0].n,0);
   assert.equal((await android('1',()=>gatedCalls.open(paired.sessionToken,assignment))).report.id,reportId);
   assert.equal((await android('1',()=>gatedReports.reopen(paired.sessionToken,reportId))).report.id,reportId);
   assert.equal((await android('1',()=>gatedReports.create(paired.sessionToken,pendingCommand))).id,pendingCommand.reportId);
   assert.equal((await android('1',()=>gatedReports.create(paired.sessionToken,{...freshCommand,commandId:randomUUID(),reportId:randomUUID(),patientId:randomUUID(),incidentId:original.incident_id}))).status,'draft','authorized existing-incident documentation can continue');
   // A real browser and an explicitly supported replacement retain independent paths.
   assert.equal((await android('2',()=>gatedCalls.open(paired.sessionToken,incoming))).assignmentId,incoming);
   const browserIncoming=await dispatch(firstUnit);
   assert.equal((await run(binding.credential,()=>gatedCalls.open(paired.sessionToken,browserIncoming))).assignmentId,browserIncoming);
  } finally {if(previousSelection===undefined)delete process.env.ANDROID_APPROVED_RELEASE;else process.env.ANDROID_APPROVED_RELEASE=previousSelection;}
 }
 // Force a committed schedule snapshot update after the SERIALIZABLE snapshot
 // exists, before its first evaluation write. This reproduces the browser race
 // deterministically instead of depending on request timing.
 const racingSchedules=Object.create(schedules);
 let collide=true,serializationFailures=0,evaluations=0;
 racingSchedules.evaluateUnit=async(manager,organizationId,unitId)=>{
  evaluations++;
  if(collide){collide=false;await scheduleAdmin.getPreview('admin',unitId);}
  try{return await schedules.evaluateUnit(manager,organizationId,unitId);}
  catch(error){if(error.code==='40001')serializationFailures++;throw error;}
 };
 const racingReports=new DraftReportService(db,sessions,racingSchedules);
 await run(binding.credential,()=>racingReports.create(paired.sessionToken,standalone));
 assert.equal(serializationFailures,1,'the fixture must cause a real PostgreSQL serialization failure');
 assert.equal(evaluations,3,'the whole creation transaction retries and rechecks schedule access before commit');
 assert.equal((await run(binding.credential,()=>racingReports.create(paired.sessionToken,standalone))).id,standalone.reportId);
 assert.equal((await admin.query('select count(*)::int n from clinical.report where id=$1',[standalone.reportId])).rows[0].n,1);
 assert.equal((await admin.query('select count(*)::int n from clinical.command_receipt where idempotency_key=$1',[standalone.commandId])).rows[0].n,1);
 // Authority can change between rolled-back attempts. A retry must fail closed
 // rather than reuse the outer session assessment or partially create a report.
 const revokedLogin=await login(binding.credential),revokedCommand={...standalone,commandId:randomUUID(),reportId:randomUUID(),incidentId:randomUUID(),patientId:randomUUID()};
 collide=true;
 const revokedSchedules=Object.create(racingSchedules);
 revokedSchedules.evaluateUnit=async(...args)=>{
  try{return await racingSchedules.evaluateUnit(...args);}
  catch(error){
   if(error.code==='40001')await admin.query("update app_identity.app_session set revoked_at=clock_timestamp(),revocation_reason='regression_test' where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(revokedLogin.sessionToken)]);
   throw error;
  }
 };
 await assert.rejects(run(binding.credential,()=>new DraftReportService(db,sessions,revokedSchedules).create(revokedLogin.sessionToken,revokedCommand)),error=>error.getStatus?.()===401);
 assert.equal(serializationFailures,2);
 assert.equal((await admin.query('select count(*)::int n from clinical.report where id=$1',[revokedCommand.reportId])).rows[0].n,0);
 assert.equal((await admin.query('select count(*)::int n from clinical.command_receipt where idempotency_key=$1',[revokedCommand.commandId])).rows[0].n,0);
 assert.equal((await admin.query('select synthetic from clinical.report where id=$1',[standalone.reportId])).rows[0].synthetic,false);
 const follow={...standalone,commandId:randomUUID(),reportId:randomUUID(),patientId:randomUUID(),incidentId:original.incident_id};
 await run(undefined,()=>reports.create(unpaired.sessionToken,follow));
 const additional=(await admin.query('select synthetic,form_version_id,catalog_release_id from clinical.report where id=$1',[follow.reportId])).rows[0];
 assert.deepEqual(additional,{synthetic:false,form_version_id:original.form_version_id,catalog_release_id:original.catalog_release_id});
 // Adding Demo capability cannot classify a production follow-on report as synthetic.
 await admin.query(`insert into app_identity.user_role_assignment(organization_id,user_id,role_id) select $1,$2,id from app_identity.role where organization_id=$1 and system_key in ('clinical-demo','demo')`,[agency,user]);
 const demoFollow={...follow,commandId:randomUUID(),reportId:randomUUID(),patientId:randomUUID()};
 await run(undefined,()=>reports.create(unpaired.sessionToken,demoFollow));
 assert.equal((await admin.query('select synthetic,expires_at from clinical.report where id=$1',[demoFollow.reportId])).rows[0].synthetic,false);
 // A capability removed between the preliminary assessment and transaction
 // cannot authorize synthetic listing from the stale outer session snapshot.
 await admin.query('insert into app_identity.unit_clinician(organization_id,unit_id,user_id) values($1,$2,$3)',[agency,otherUnit,user]);
 const generated=await run(undefined,()=>calls.generateSynthetic(unpaired.sessionToken,unpaired.session.csrfToken,otherUnit));
 assert.ok(!(await state(binding,paired)).assignedCalls.some(x=>x.id===generated.assignment.id),'paired Demo users receive only their enrolled unit');
 let initial=true;
 const changingSession={requireCapability:async(...args)=>{const result=await sessions.requireCapability(...args);
  if(initial){initial=false;await admin.query(`update app_identity.user_role_assignment a set ended_at=clock_timestamp(),ended_by=$3 from app_identity.role r
    where a.role_id=r.id and a.user_id=$1 and a.organization_id=$2 and r.system_key in ('clinical-demo','demo') and a.ended_at is null`,[user,agency,SYNTHETIC_DEMO_FIXTURE.userId]);}
  return result;}};
 const changingCalls=new AssignedCallsService(db,changingSession,schedules);
 const afterWithdrawal=await run(binding.credential,()=>changingCalls.list(paired.sessionToken));
 assert.ok(!afterWithdrawal.assignedCalls.some(x=>x.id===generated.assignment.id));
 assert.ok(afterWithdrawal.assignedCalls.every(x=>x.unit.id===firstUnit));
 // Exact historical repair requires real assignment + incident and leaves all pins untouched.
 await admin.query('update clinical.report set synthetic=true where id=$1',[reportId]);
 await admin.query(await readFile(new URL('../../../supabase/migrations/20261013164048_enrolled_unit_production_jobs.sql',import.meta.url),'utf8'));
 assert.deepEqual((await admin.query(`select organization_id,incident_id,documenting_user_id,form_version_id,catalog_release_id,validation_version_id,
 synthetic,synthetic_generated_by,expires_at from clinical.report where id=$1`,[reportId])).rows[0],original);
 const scheduled=await scheduleAdmin.save('admin',null,{name:'Daily gate',breakpoints:Array.from({length:7},(_,i)=>({weekday:i+1,time:'07:00',graceMinutes:15}))});
 await scheduleAdmin.select('admin',firstUnit,{scheduleId:scheduled.id,expectedRevision:1});
 assert.equal((await state(binding,paired)).productionAccess.state,'ready');
 const blocked=await dispatch(firstUnit); // Initial selection remains prospective, with no invented old checkpoint.
 // A pending blank change cannot bypass the active nonblank gate.
 const pending=await scheduleAdmin.select('admin',firstUnit,{scheduleId:selected.id,expectedRevision:2});assert.ok(pending.pending);
 assert.equal((await state(binding,paired)).productionAccess.state,'ready');
 // A persisted nonblank schedule uses authoritative server time and this session's proof.
 const shiftUnit=await unit(agency),shiftBinding=await pair(shiftUnit),shiftLogin=await login(shiftBinding.credential),secondDevice=await login(shiftBinding.credential);
 const [{now:serverNow}]=(await admin.query('select clock_timestamp() as now')).rows;
 const checkpoint=new Date(Math.floor(new Date(serverNow).getTime()/60000)*60000),graceStart=new Date(checkpoint.getTime()-15*60000),shiftSchedule=randomUUID();
 const weekday=checkpoint.getUTCDay()||7,time=checkpoint.toISOString().slice(11,16);
 // Fixture history predates selection; production APIs cannot backdate these immutable rows.
 await admin.query("insert into app_identity.weekly_schedule(id,group_id,name) values($1,$2,'Shift proof fixture')",[shiftSchedule,agency]);
 await admin.query(`insert into app_identity.weekly_schedule_version(schedule_id,revision,effective_at,breakpoints,actor_id)
 values($1,1,$2,$3::jsonb,$4)`,[shiftSchedule,new Date(checkpoint.getTime()-86400000),JSON.stringify([{weekday,time,graceMinutes:15}]),actor]);
 await admin.query(`insert into app_identity.unit_schedule_selection(organization_id,unit_id,revision,schedule_id,effective_at,actor_id)
 values($1,$2,1,$3,$4,$5)`,[agency,shiftUnit,shiftSchedule,new Date(checkpoint.getTime()-86400000),actor]);
 const stamp=async(session,at)=>admin.query("update app_identity.app_session set personally_authenticated_at=$2 where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(session.sessionToken),at]);
 // Current login, including legacy sessions without proof metadata, crosses
 // schedule/grace boundaries without another credential or identity interaction.
 await admin.query("update app_identity.app_session set personally_authenticated_at=null,reauthenticated_at=null,personal_authentication_purpose=null where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(shiftLogin.sessionToken)]);
 assert.equal((await state(shiftBinding,shiftLogin)).productionAccess.state,'ready');
 const beforeContinue=(await admin.query("select personally_authenticated_at,reauthenticated_at,expires_at from app_identity.app_session where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(shiftLogin.sessionToken)])).rows[0];
 const shiftJob=await dispatch(shiftUnit),shiftOpened=await open(shiftBinding,shiftLogin,shiftJob);
 assert.equal((await open(shiftBinding,shiftLogin,shiftJob)).report.id,shiftOpened.report.id);
 let crossingAt=checkpoint.getTime()-1;
 const crossingSchedules=new SchedulesService(db,sessions);crossingSchedules.now=async()=>crossingAt;
 const crossingCalls=new AssignedCallsService(db,sessions,crossingSchedules);
 assert.equal((await run(shiftBinding.credential,()=>crossingCalls.list(shiftLogin.sessionToken))).productionAccess.state,'ready');
 assert.equal(await run(shiftBinding.credential,()=>crossingCalls.prepareConfirmation(shiftLogin.sessionToken,shiftLogin.session.csrfToken,`assignment:${shiftJob}`)),null);
 const crossing=await dispatch(shiftUnit);
 await admin.query('begin');await admin.query('select id from clinical.call_assignment where id=$1 for update',[crossing]);
 const crossingWait=run(shiftBinding.credential,()=>crossingCalls.open(shiftLogin.sessionToken,crossing));
 await waitForAssignmentLock();crossingAt=checkpoint.getTime();await admin.query('commit');
 assert.ok((await crossingWait).report.id,'crossing the checkpoint retains valid-login authority');
 const crossingReports=new DraftReportService(db,sessions,crossingSchedules);
 await run(shiftBinding.credential,()=>crossingReports.create(shiftLogin.sessionToken,{...standalone,commandId:randomUUID(),reportId:randomUUID(),incidentId:randomUUID(),patientId:randomUUID()}));
 assert.deepEqual((await admin.query("select personally_authenticated_at,reauthenticated_at,expires_at from app_identity.app_session where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(shiftLogin.sessionToken)])).rows[0],beforeContinue,'new work never fabricates proof or renews session expiry');
 // Session expiry still wins while a creation waits at the domain boundary.
 const expiryJob=await dispatch(shiftUnit),expiryLogin=await login(shiftBinding.credential);
 await admin.query("update app_identity.app_session set expires_at=clock_timestamp()+interval '500 milliseconds' where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(expiryLogin.sessionToken)]);
 await admin.query('begin');await admin.query('select id from clinical.call_assignment where id=$1 for update',[expiryJob]);
 const expiryWait=run(shiftBinding.credential,()=>crossingCalls.open(expiryLogin.sessionToken,expiryJob));const expiryDenied=assert.rejects(expiryWait,denied('calls.sessionExpired'));
 await waitForAssignmentLock();await waitForExpiry(expiryLogin);await admin.query('commit');await expiryDenied;
 assert.equal((await admin.query('select report_id from clinical.call_assignment where id=$1',[expiryJob])).rows[0].report_id,null);
 // Synthetic accounts are confined even when enrolled, rostered and assigned a real call.
 const demo=await run(binding.credential,()=>sessions.create({username:SYNTHETIC_DEMO_FIXTURE.username,password:SYNTHETIC_DEMO_FIXTURE.password}));
 await admin.query('insert into app_identity.unit_clinician(organization_id,unit_id,user_id) values($1,$2,$3)',[agency,firstUnit,SYNTHETIC_DEMO_FIXTURE.userId]);

 assert.ok(!(await state(binding,demo)).assignedCalls.some(x=>x.id===blocked));
 await assert.rejects(open(binding,demo,blocked),denied('calls.syntheticOnly'));
 // Two different clinicians cannot acquire duplicate reports or each other's ownership.
 const contender=randomUUID(),contenderName=`contender-${contender}`;
 await admin.query(`insert into app_identity.app_user(id,organization_id,display_name) values($1,$2,'Fictional second clinician')`,[contender,agency]);
 await admin.query(`insert into app_identity.local_credential(user_id,username,password_verifier,must_change_password) values($1,$2,$3,false)`,[contender,contenderName,await createPasswordVerifier(password)]);
 await admin.query(`insert into app_identity.user_role_assignment(organization_id,user_id,role_id) select $1,$2,id from app_identity.role where organization_id=$1 and system_key='clinician'`,[agency,contender]);
 const competitionUnit=await unit(agency);await blank(competitionUnit);const competitionBinding=await pair(competitionUnit);
 const primaryLogin=await login(competitionBinding.credential);
 const contenderLogin=await run(competitionBinding.credential,()=>sessions.create({username:contenderName,password}));
 const competingAssignment=await dispatch(competitionUnit);
 const competition=await Promise.allSettled([open(competitionBinding,primaryLogin,competingAssignment),open(competitionBinding,contenderLogin,competingAssignment)]);
 assert.equal(competition.filter(x=>x.status==='fulfilled').length,1);assert.match(competition.find(x=>x.status==='rejected').reason.message,/not open for this clinician/);
 const winner=competition.find(x=>x.status==='fulfilled').value;
 assert.ok([user,contender].includes(winner.report.documentingUserId));
 assert.equal((await admin.query(`select count(*) n from clinical.report r join clinical.call_assignment ca on ca.incident_id=r.incident_id and ca.id=$1`,[competingAssignment])).rows[0].n,'1');
 // Cancellation wins while a stale opening waits for the current assignment row.
 const raceUnit=await unit(agency);await blank(raceUnit);const raceBinding=await pair(raceUnit),raceSession=await login(raceBinding.credential);
 const canceled=await dispatch(raceUnit);await admin.query('begin');await admin.query('select id from clinical.call_assignment where id=$1 for update',[canceled]);
 const cancelWait=open(raceBinding,raceSession,canceled);const cancelDenied=assert.rejects(cancelWait,/canceled/);
 await waitForAssignmentLock();await admin.query("update clinical.call_assignment set status='canceled' where id=$1",[canceled]);await admin.query('commit');await cancelDenied;
 assert.equal((await admin.query('select report_id from clinical.call_assignment where id=$1',[canceled])).rows[0].report_id,null);
 // Device revocation wins before the opening obtains its registration lock.
 const revoked=await dispatch(raceUnit);await admin.query('begin');await admin.query('select id from app_identity.installation_registration where id=$1 for update',[raceBinding.installation.id]);
 const revokeWait=open(raceBinding,raceSession,revoked);const revokeDenied=assert.rejects(revokeWait,denied('calls.enrollmentRequired'));
 await new Promise(r=>setTimeout(r,150));await admin.query('update app_identity.installation_registration set revoked_at=clock_timestamp() where id=$1',[raceBinding.installation.id]);await admin.query('commit');await revokeDenied;
 assert.equal((await admin.query('select report_id from clinical.call_assignment where id=$1',[revoked])).rows[0].report_id,null);
 // Reassignment retires the old tab, new login has only the incoming unit's jobs.
 const moving=await pair(raceUnit),old=await login(moving.credential),code=await run(undefined,()=>enrollment.issue('admin',otherUnit));
 const moved=await run(moving.credential,()=>enrollment.consume({token:code.token,name:'Moved job browser',confirmInstallation:true,reassign:true},moving.credential,old.sessionToken));
 await assert.rejects(open(moving,old,revoked),/session has ended/);
 const fresh=await login(moved.credential);assert.ok((await state(moved,fresh)).assignedCalls.some(x=>x.id===otherAssignment));
 await assert.rejects(open(moved,fresh,revoked),/unavailable/);
 const child=randomUUID();await admin.query(`insert into app_identity.organization(id,name,parent_organization_id,deployment_timezone) values($1,'Job child agency',$2,'UTC')`,[child,agency]);
 await run(moved.credential,()=>sessions.switchAgency(fresh.sessionToken,child));scope=child;
 const mismatch=await state(moved,fresh);assert.equal(mismatch.productionAccess.state,'agency-mismatch');assert.equal(mismatch.assignedCalls.length,0);
 await assert.rejects(open(moved,fresh,otherAssignment),/not found/);
 assert.deepEqual((await admin.query('select organization_id,unit_id from app_identity.installation_registration where id=$1',[moved.installation.id])).rows[0],{organization_id:agency,unit_id:otherUnit});
 await run(moved.credential,()=>sessions.switchAgency(fresh.sessionToken,agency));scope=agency;
 // Demo dispatch follows the same paired-unit/schedule route as production.
 // Any authorized clinician can receive generated calls without a Demo role or personal unit roster.
 const receivingUnit=await unit(agency),outsideDemoUnit=await unit(agency);
 const receivingBinding=await pair(receivingUnit),outsideDemoBinding=await pair(outsideDemoUnit);
 const demoReceiver=randomUUID(),demoReceiverName=`demo-receiver-${demoReceiver}`;
 await admin.query("insert into app_identity.app_user(id,organization_id,display_name) values($1,$2,'Receiving Demo clinician')",[demoReceiver,agency]);
 await admin.query(`insert into app_identity.local_credential(user_id,username,password_verifier,must_change_password)
   values($1,$2,$3,false)`,[demoReceiver,demoReceiverName,await createPasswordVerifier(password)]);
 await admin.query(`insert into app_identity.user_role_assignment(organization_id,user_id,role_id)
   select $1,$2,id from app_identity.role where organization_id=$1 and system_key='demo'`,[agency,demoReceiver]);
 const receivingDemo=await run(receivingBinding.credential,()=>sessions.create({username:demoReceiverName,password}));
 const outsideDemo=await run(outsideDemoBinding.credential,()=>sessions.create({username:demoReceiverName,password}));
 const productionReceiver=await login(receivingBinding.credential);
 const generateFor=unitId=>run(binding.credential,()=>calls.generateSynthetic(demo.sessionToken,demo.session.csrfToken,unitId));
 const incomingDemo=await generateFor(receivingUnit),outsideDemoCall=await generateFor(outsideDemoUnit),incomingProduction=await dispatch(receivingUnit);
 assert.equal((await admin.query('select count(*)::int n from app_identity.unit_clinician where user_id=$1',[demoReceiver])).rows[0].n,0);
 assert.equal((await state(receivingBinding,receivingDemo)).productionAccess.state,'schedule-required');
 assert.equal((await state(receivingBinding,receivingDemo)).assignedCalls.length,0,'Demo calls also require the selected unit schedule');
 await blank(receivingUnit);await blank(outsideDemoUnit);
 const demoListing=await state(receivingBinding,receivingDemo),productionListing=await state(receivingBinding,productionReceiver);
 assert.equal(demoListing.productionAccess.unit.id,receivingUnit);
 assert.ok(demoListing.assignedCalls.some(call=>call.id===incomingDemo.assignment.id));
 assert.ok(demoListing.assignedCalls.some(call=>call.id===incomingProduction));
 assert.ok(!demoListing.assignedCalls.some(call=>call.id===outsideDemoCall.assignment.id));
 assert.ok(productionListing.assignedCalls.some(call=>call.id===incomingProduction));
 assert.ok(productionListing.assignedCalls.some(call=>call.id===incomingDemo.assignment.id),'ordinary clinical users receive generated calls for their paired unit');
 assert.ok(!productionReceiver.session.capabilities.includes('clinical:demo'));
 await assert.rejects(run(receivingBinding.credential,()=>calls.generateSynthetic(productionReceiver.sessionToken,productionReceiver.session.csrfToken,receivingUnit)),/capability/);
 await assert.rejects(open(outsideDemoBinding,outsideDemo,incomingDemo.assignment.id),/enrolled unit/);
 const received=await open(receivingBinding,productionReceiver,incomingDemo.assignment.id);
 assert.equal(received.report.documentingUserId,user);assert.equal(received.report.demoMutable,true);
 assert.equal((await admin.query('select synthetic_generated_by from clinical.report where id=$1',[received.report.id])).rows[0].synthetic_generated_by,SYNTHETIC_DEMO_FIXTURE.userId,'dispatch generator provenance is retained');
 assert.equal((await run(receivingBinding.credential,()=>reports.reopen(productionReceiver.sessionToken,received.report.id))).report.demoMutable,true);
 await assert.rejects(run(receivingBinding.credential,()=>reports.reopen(receivingDemo.sessionToken,received.report.id)),/not found/);
 const keys=new ProtectedReportKeyService(db,sessions),reportKey=Buffer.alloc(32,0x65).toString('base64');
 const keyEnvelope=await run(receivingBinding.credential,()=>keys.register(productionReceiver.sessionToken,received.report.id,{schemaVersion:1,recoveryHandle:randomUUID(),reportKeyBase64:reportKey},productionReceiver.session.csrfToken));
 // Valid login older than five minutes with no dedicated reauthentication can
 // create and consume recovery grants; proof and deadlines remain unchanged.
 await admin.query("update app_identity.app_session set personally_authenticated_at=clock_timestamp()-interval '30 minutes',reauthenticated_at=null,personal_authentication_purpose='login' where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(productionReceiver.sessionToken)]);
 const loginBeforeRecovery=(await admin.query("select personally_authenticated_at,reauthenticated_at,expires_at from app_identity.app_session where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(productionReceiver.sessionToken)])).rows[0];
 await run(receivingBinding.credential,()=>sessions.requireRecentReauthentication(productionReceiver.sessionToken));
 const beforeUnlinkGrant=await run(receivingBinding.credential,()=>keys.createRecoveryGrant(productionReceiver.sessionToken,received.report.id,{schemaVersion:1,envelopeVersion:1},productionReceiver.session.csrfToken));
 const pendingDemo=await generateFor(receivingUnit);
 assert.deepEqual(await run(undefined,()=>enrollment.revoke('admin',receivingUnit,receivingBinding.installation.id)),{revoked:true,sessionsRevoked:0});
 assert.equal((await run(receivingBinding.credential,()=>sessions.getAuthenticated(productionReceiver.sessionToken))).user.id,user);
 const recovered=await run(receivingBinding.credential,()=>keys.consumeRecoveryGrant(productionReceiver.sessionToken,received.report.id,{schemaVersion:1,envelopeVersion:1,grant:beforeUnlinkGrant.grant},productionReceiver.session.csrfToken));
 assert.equal(recovered.reportKeyBase64,reportKey,'unlinking cannot block release of an authorized own-report recovery grant');
 const afterUnlinkGrant=await run(receivingBinding.credential,()=>keys.createRecoveryGrant(productionReceiver.sessionToken,received.report.id,{schemaVersion:1,envelopeVersion:1},productionReceiver.session.csrfToken));
 assert.equal((await run(receivingBinding.credential,()=>keys.consumeRecoveryGrant(productionReceiver.sessionToken,received.report.id,{schemaVersion:1,envelopeVersion:1,grant:afterUnlinkGrant.grant},productionReceiver.session.csrfToken))).reportKeyBase64,reportKey);
 assert.deepEqual((await admin.query("select personally_authenticated_at,reauthenticated_at,expires_at from app_identity.app_session where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(productionReceiver.sessionToken)])).rows[0],loginBeforeRecovery);
 const invalidRecovery=await login(outsideDemoBinding.credential);
 await admin.query("update app_identity.app_session set revoked_at=clock_timestamp(),revocation_reason='logout' where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(invalidRecovery.sessionToken)]);
 await assert.rejects(run(outsideDemoBinding.credential,()=>keys.createRecoveryGrant(invalidRecovery.sessionToken,received.report.id,{schemaVersion:1,envelopeVersion:1},invalidRecovery.session.csrfToken)),error=>error.getStatus?.()===401);
 await assert.rejects(run(outsideDemoBinding.credential,()=>keys.createRecoveryGrant(outsideDemo.sessionToken,received.report.id,{schemaVersion:1,envelopeVersion:1},outsideDemo.session.csrfToken)),/unavailable/);
 assert.equal(new Date((await admin.query('select recovery_deadline from offline_recovery.report_key_envelope where report_id=$1',[received.report.id])).rows[0].recovery_deadline).toISOString(),keyEnvelope.recoveryDeadline,'pairing changes never renew the recovery deadline');
 assert.equal((await state(receivingBinding,productionReceiver)).productionAccess.state,'enrollment-required');
 assert.equal((await state(receivingBinding,productionReceiver)).assignedCalls.length,0);
 await assert.rejects(open(receivingBinding,productionReceiver,pendingDemo.assignment.id),denied('calls.enrollmentRequired'));
 assert.equal((await run(receivingBinding.credential,()=>reports.reopen(productionReceiver.sessionToken,received.report.id))).report.id,received.report.id,'unlinking preserves existing owned work');
 const additionalPatient={commandId:randomUUID(),reportId:randomUUID(),incidentId:(await admin.query('select incident_id from clinical.report where id=$1',[received.report.id])).rows[0].incident_id,patientId:randomUUID(),organizationId:agency,documentingUserId:user,patientIdentityState:'unknown'};
 await run(receivingBinding.credential,()=>reports.create(productionReceiver.sessionToken,additionalPatient));
 const syntheticFollow=(await admin.query('select synthetic,synthetic_generated_by,synthetic_source_assignment_id from clinical.report where id=$1',[additionalPatient.reportId])).rows[0];
 assert.deepEqual(syntheticFollow,{synthetic:true,synthetic_generated_by:SYNTHETIC_DEMO_FIXTURE.userId,synthetic_source_assignment_id:incomingDemo.assignment.id},'additional patients retain the original synthetic dispatch provenance');
 const unpairedReceiver=await run(receivingBinding.credential,()=>sessions.create({username,password}));
 assert.equal((await state(receivingBinding,unpairedReceiver)).productionAccess.state,'enrollment-required','a revoked cookie does not obstruct a fresh personal login');
 assert.ok((await state(outsideDemoBinding,outsideDemo)).assignedCalls.some(call=>call.id===outsideDemoCall.assignment.id),'other paired devices are unaffected');
 // Agency Demo defaults are personal routing, never a persisted browser pairing.
 const agencySettings=new AgencySettingsService(db,administrative);
 const updateDefault=async demoUnitId=>{
   const {authenticationPolicy,...current}=await agencySettings.get('admin');
   return agencySettings.update('admin',{...current,expectedRevision:current.revision,demoUnitId});
 };
 await updateDefault(null);
 const automaticUnit=await unit(agency),automaticAssignment=await dispatch(automaticUnit);
 const automaticDemo=await run(undefined,()=>sessions.create({username:demoReceiverName,password}));
 const priorSettings=await agencySettings.get('admin');
 await updateDefault(automaticUnit);
 assert.equal((await state(undefined,automaticDemo)).productionAccess.state,'schedule-required');
 await blank(automaticUnit);
 const automaticListing=await state(undefined,automaticDemo);
 assert.equal(automaticListing.productionAccess.unit.id,automaticUnit);
 assert.ok(automaticListing.assignedCalls.some(call=>call.id===automaticAssignment));
 assert.equal((await state(undefined,unpairedReceiver)).productionAccess.state,'enrollment-required','ordinary clinicians do not receive Demo defaults');
 assert.equal((await state(outsideDemoBinding,outsideDemo)).productionAccess.unit.id,outsideDemoUnit,'explicit pairing takes precedence');
 assert.equal((await state(receivingBinding,receivingDemo)).productionAccess.state,'enrollment-required','revoked explicit pairings cannot fall back to a Demo default');
 const autoOpened=await open(undefined,automaticDemo,automaticAssignment);
 assert.equal(autoOpened.report.documentingUserId,demoReceiver);
 assert.equal((await admin.query(`select installation_registration_id from app_identity.app_session where token_sha256=encode(sha256($1::bytea),'hex')`,[Buffer.from(automaticDemo.sessionToken)])).rows[0].installation_registration_id,null);
 const defaultAudit=(await admin.query('select old_demo_unit_id,new_demo_unit_id from app_identity.agency_settings_change_event where organization_id=$1 and revision=$2',[agency,priorSettings.revision+1])).rows[0];
 assert.deepEqual(defaultAudit,{old_demo_unit_id:null,new_demo_unit_id:automaticUnit});
 const foreignUnit=await unit(child);
 await assert.rejects(updateDefault(foreignUnit),/active unit in this agency/);
 await assert.rejects(admin.query('update app_identity.agency_settings set demo_unit_id=$2 where organization_id=$1',[agency,foreignUnit]),/foreign key/);
 await admin.query('update app_identity.operational_unit set active=false where id=$1',[automaticUnit]);
 assert.equal((await state(undefined,automaticDemo)).productionAccess.state,'enrollment-required');
 await updateDefault(null);
 await assert.rejects(updateDefault(automaticUnit),/active unit in this agency/);
 assert.equal((await state(undefined,automaticDemo)).productionAccess.state,'enrollment-required');
 await admin.query('update app_identity.operational_unit set active=true where id=$1',[automaticUnit]);
 await updateDefault(automaticUnit);
 // A stale Demo capability snapshot cannot retain automatic routing after role withdrawal.
 await admin.query(`update app_identity.user_role_assignment set ended_at=clock_timestamp(),ended_by=$2 where user_id=$1 and ended_at is null`,[demoReceiver,SYNTHETIC_DEMO_FIXTURE.userId]);
 await admin.query(`insert into app_identity.user_role_assignment(organization_id,user_id,role_id)
   select $1,$2,id from app_identity.role where organization_id=$1 and system_key='clinician'`,[agency,demoReceiver]);
 assert.equal((await state(undefined,automaticDemo)).productionAccess.state,'enrollment-required');
 assert.equal((await run(undefined,()=>reports.reopen(automaticDemo.sessionToken,autoOpened.report.id))).report.id,autoOpened.report.id);
 await updateDefault(null);
 // Live role withdrawal wins before a stale new-job command acquires authority.
 const roleBlocked=await dispatch(otherUnit);
 await admin.query('begin');
 await admin.query('select id from app_identity.user_role_assignment where user_id=$1 and ended_at is null for update',[user]);
 const roleWait=open(moved,fresh,roleBlocked);const roleDenied=assert.rejects(roleWait,/capability|workspace role/);
 await new Promise(r=>setTimeout(r,150));
 await admin.query(`update app_identity.user_role_assignment a set ended_at=clock_timestamp(),ended_by=$3 from app_identity.role r
 where a.role_id=r.id and a.user_id=$1 and a.organization_id=$2 and r.system_key in ('clinician','clinical-demo','demo') and a.ended_at is null`,[user,agency,SYNTHETIC_DEMO_FIXTURE.userId]);
 await admin.query(`insert into app_identity.user_role_assignment(organization_id,user_id,role_id) select $1,$2,id from app_identity.role where organization_id=$1 and system_key='reviewer'`,[agency,user]);
 await admin.query('commit');await roleDenied;
 assert.equal((await admin.query('select report_id from clinical.call_assignment where id=$1',[roleBlocked])).rows[0].report_id,null);
 const adminLogin=await login();assert.ok(adminLogin.session.capabilities.includes('review:all'));
 await assert.rejects(state(undefined,adminLogin),/capability/);
 }finally{await admin.query('rollback');await db.destroy();await admin.end();}
});
