import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {routeDispatchAssignment} from '../dist/dispatch/dispatch-assignment.projection.js';
import pg from 'pg';
import {DataSource} from 'typeorm';
import {readMigrations,applyMigrations} from '../../../packages/database/scripts/migrate.mjs';
import {authenticationRolloutPreflight} from '../../../packages/database/scripts/authentication-rollout-preflight.mjs';
import {createPasswordVerifier} from '../dist/identity/password.js';
import {encryptCredential} from '../dist/authentication/oidc-credentials.js';
import {RoleAuthoringService} from '../dist/admin/role-authoring.service.js';
import {AccountService} from '../dist/identity/account.service.js';
import {ClinicianSessionService} from '../dist/sessions/clinician-session.service.js';
import {AgencyDirectoryService} from '../dist/sessions/agency-directory.service.js';
import {ProductionWorkflowService} from '../dist/authentication/production-workflow.service.js';
import {InstallationEnrollmentService} from '../dist/admin/installation-enrollment.service.js';
import {AssignedCallsService} from '../dist/calls/assigned-calls.service.js';
import {DraftReportService} from '../dist/reports/draft-report.service.js';
import {SchedulesService} from '../dist/schedules/schedules.service.js';
import {agencyRequest} from '../dist/sessions/agency-context.js';
import {seedShiftConfiguration} from './fixtures/current-shift-clinical-seed.mjs';
const integration=process.env.DATABASE_URL?test:test.skip;
if(process.env.REQUIRE_DATABASE_INTEGRATION&&!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
process.env.PATIENT_KEY_INSTALLATION_ID??='91000000-0000-4000-8000-000000000001';
process.env.PATIENT_KEY_VERSION??='1';process.env.PATIENT_KEY_SECRET_BASE64??=Buffer.alloc(32,0x31).toString('base64');
const denied=code=>error=>error.getResponse?.().code===code;

integration('upgrade inventories conflicts read-only and explicit rollout preserves identity, recovery, legacy scope and mutation races',async()=>{
 const name=`rollout_${randomUUID().replaceAll('-','')}`,admin=new pg.Client({connectionString:process.env.DATABASE_URL});await admin.connect();await admin.query(`create database ${name}`);
 const url=new URL(process.env.DATABASE_URL);url.pathname=`/${name}`;
 const savedKeys=process.env.OIDC_CREDENTIAL_KEYS_JSON;
 let blockingConnected=false;
 const blocking=new pg.Client({connectionString:url.toString()});
 const migration=new pg.Client({connectionString:url.toString()}),owner=new DataSource({type:'postgres',url:url.toString()}),db=new DataSource({type:'postgres',url:url.toString(),extra:{options:'-c role=open_triage_api_runtime',max:6}});
 try{
  await migration.connect();const migrations=await readMigrations(fileURLToPath(new URL('../../../supabase/migrations',import.meta.url)));
  await applyMigrations(migration,migrations.filter(m=>m.version<'20261013115819'),{info(){}});
  const group=randomUUID(),child=randomUUID(),other=randomUUID(),unit=randomUUID(),secondUnit=randomUUID(),otherUnit=randomUUID();
  await migration.query("insert into app_identity.organization(id,name,hostname,deployment_timezone) values($1,'Legacy root','rollout.localhost','UTC')",[group]);
  await migration.query("insert into app_identity.organization(id,name,parent_organization_id,shift_session_duration_hours,deployment_timezone) values($1,'Legacy child',$2,24,'UTC')",[child,group]);
  const before=(await migration.query('select id,parent_organization_id,shift_session_duration_hours from app_identity.organization order by id')).rows;
  await migration.query('begin read only');const inventory=await authenticationRolloutPreflight(migration);await migration.query('rollback');
  assert.equal(inventory.ready,false);assert.deepEqual(inventory.conflicts.map(x=>x.groupId),[group]);assert.equal(inventory.conflicts[0].members.length,2);
  await assert.rejects(applyMigrations(migration,migrations,{info(){}}),error=>/Conflicting legacy authentication settings/.test(error.cause?.message));
  assert.deepEqual((await migration.query('select id,parent_organization_id,shift_session_duration_hours from app_identity.organization order by id')).rows,before);
  assert.equal((await migration.query("select to_regclass('app_identity.group_authentication_policy') policy")).rows[0].policy,null);
  // Explicit test operator decision, never selected by the migration or CLI.
  await migration.query('update app_identity.organization set shift_session_duration_hours=24 where id=$1',[group]);
  await owner.initialize();
  const accounts=new AccountService(owner),password='Rollout regression password 42!',actor={userId:randomUUID()};
  await accounts.bootstrapOwner({username:'owner',displayName:'Upgrade owner',temporaryPassword:password,operator:{operatorId:'fixture',osAccount:'fixture',host:'fixture'}});
  // Ordinary pre-feature identity and roles, without calling new policy services.
  await owner.query("insert into app_identity.app_user(id,organization_id,display_name) values($1,$2,'Existing clinician')",[actor.userId,group]);
  await owner.query("insert into app_identity.local_credential(user_id,username,password_verifier,must_change_password) values($1,'rollout-clinician',$2,false)",[actor.userId,await createPasswordVerifier(password)]);
  await owner.query("insert into app_identity.user_role_assignment(organization_id,user_id,role_id) select $1,$2,id from app_identity.role where organization_id=$1 and system_key='clinician'",[group,actor.userId]);
  const roleService=new RoleAuthoringService(owner,{requireCapability:async()=>({user:{id:actor.userId},organization:{id:group},capabilities:['admin-dashboard:read','settings:read','settings:write']})});
  const administrator=await roleService.create('fixture',{displayName:'Rollout operator',description:null,capabilityKeys:['admin-dashboard:read','settings:read','settings:write'],note:'Existing migration fixture'});
  await owner.query('insert into app_identity.user_role_assignment(organization_id,user_id,role_id) values($1,$2,$3)',[group,actor.userId,administrator.id]);
  await owner.query("insert into app_identity.authentication_event(organization_id,actor_id,action,result) values($1,$2,'account.provision','succeeded')",[group,actor.userId]);
  await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../../../packages/database/scripts/load-nemsis-catalog.mjs',import.meta.url))],{env:{...process.env,DATABASE_URL:url.toString()},maxBuffer:4*1024*1024});
  const [catalog]=await owner.query("select id from catalog.release where standard='NEMSIS' and sealed limit 1");
  assert.ok(catalog,'Full dispatch catalog must be available');
  await seedShiftConfiguration(owner,group,actor.userId,{catalogReleaseId:catalog.id});
  await owner.query("insert into app_identity.operational_unit(id,organization_id,name,call_sign) values($1,$2,'Existing unit','LEGACY-019'),($3,$2,'Unassigned unit','OTHER-019')",[unit,group,secondUnit]);
  await owner.query('insert into app_identity.unit_clinician(organization_id,unit_id,user_id) values($1,$2,$3)',[group,unit,actor.userId]);
  // Persist existing report and attributable audit before adding rollout state.
  const config=(await owner.query('select * from app_identity.active_configuration_bundle where organization_id=$1',[group]))[0],report=randomUUID(),patient=randomUUID(),incident=randomUUID();
  const demographic=(await owner.query('select id from app_identity.agency_demographic_version where organization_id=$1',[group]))[0];
  await owner.query("insert into clinical.patient(id,organization_id,identity_state,pseudonymous_key,pseudonymous_key_version) values($1,$2,'unknown',$3,1)",[patient,group,'a'.repeat(64)]);
  await owner.query('insert into clinical.incident(id,organization_id,synthetic) values($1,$2,false)',[incident,group]);
  await owner.query(`insert into clinical.report(id,organization_id,incident_id,patient_id,documenting_user_id,agency_demographic_version_id,form_version_id,catalog_release_id,validation_version_id,form_definition_sha256,catalog_artifact_sha256,validation_compiled_sha256,synthetic)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false)`,[report,group,incident,patient,actor.userId,demographic.id,config.form_version_id,config.catalog_release_id,config.validation_version_id,config.form_definition_sha256,config.catalog_artifact_sha256,config.validation_compiled_sha256]);
  const historicalAssignment=randomUUID(),historicalReceipt=randomUUID(),historicalMessage=randomUUID();
  const historicalPayload={messageId:historicalMessage,sourceRecordId:historicalAssignment,revision:1,groups:[]};
  await owner.query(`insert into clinical.dispatch_receipt(id,organization_id,source_id,message_id,source_record_id,source_revision,source_bytes,source_payload,status)
    values($1,$2,'legacy-upgrade',$3,$4,1,$5,$6::jsonb,'applied')`,[historicalReceipt,group,historicalMessage,historicalAssignment,Buffer.from(JSON.stringify(historicalPayload)),JSON.stringify(historicalPayload)]);
  await owner.query(`insert into clinical.call_assignment(id,organization_id,unit_id,incident_id,call_number,dispatched_at,dispatch_source_id,dispatch_source_record_id,dispatch_revision,response_number,vehicle_number,dispatch_receipt_id,status,report_id,synthetic)
    values($1,$2,$3,$4,'LEGACY-REPORT',now(),'legacy-upgrade',$5,1,'legacy-response','legacy-unit',$6,'opened',$7,false)`,[historicalAssignment,group,unit,incident,historicalAssignment,historicalReceipt,report]);
  const fixtureUser=randomUUID(),fixtureVerifier=await createPasswordVerifier('Unchanged synthetic fixture password 42!');
  await owner.query("insert into app_identity.app_user(id,organization_id,display_name,synthetic) values($1,$2,'Existing synthetic fixture',true)",[fixtureUser,group]);
  await owner.query("insert into app_identity.local_credential(user_id,username,password_verifier,must_change_password) values($1,'existing-synthetic-fixture',$2,false)",[fixtureUser,fixtureVerifier]);
  await owner.query(`insert into offline_recovery.report_key_envelope(report_id,organization_id,owner_user_id,recovery_handle,wrapping_key_version,wrapping_nonce,wrapped_data_key,recovery_deadline)
    values($1,$2,$3,$4,1,$5,$6,clock_timestamp()+interval '24 hours')`,[report,group,actor.userId,randomUUID(),Buffer.alloc(12),Buffer.alloc(48)]);
  const snapshot=async()=>({user:(await owner.query('select id,organization_id from app_identity.app_user where id=$1',[actor.userId]))[0],
    assignment:await owner.query('select id,organization_id,unit_id,incident_id,report_id,synthetic from clinical.call_assignment where id=$1',[historicalAssignment]),
    synthetic:await owner.query('select u.id,u.organization_id,u.synthetic,c.username,c.password_verifier,c.credential_version from app_identity.app_user u join app_identity.local_credential c on c.user_id=u.id where u.id=$1',[fixtureUser]),
    roster:await owner.query('select * from app_identity.unit_clinician where user_id=$1',[actor.userId]),
    units:await owner.query('select id,organization_id from app_identity.operational_unit where organization_id=$1 order by id',[group]),
    report:(await owner.query('select id,organization_id,incident_id,patient_id,documenting_user_id,form_version_id,catalog_release_id,validation_version_id,form_definition_sha256,catalog_artifact_sha256,validation_compiled_sha256,synthetic,expires_at,revision,status from clinical.report where id=$1',[report]))[0],
    recovery:await owner.query('select * from offline_recovery.report_key_envelope where report_id=$1',[report]),
    audit:await owner.query('select * from app_identity.authentication_event where actor_id=$1 order by id',[actor.userId])});
  const original=await snapshot();await applyMigrations(migration,migrations,{info(){}});
  const upgraded=await snapshot();
  // Later audit migrations add public UUIDs while retaining every original evidence field.
  assert.ok(upgraded.audit.length>0);
  for(const event of upgraded.audit)assert.match(event.audit_id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(new Set(upgraded.audit.map(event=>event.audit_id)).size,upgraded.audit.length);
  assert.deepEqual({...upgraded,audit:upgraded.audit.map(({audit_id,...evidence})=>evidence)},original);
  await db.initialize();const origin='https://rollout.example',directory=new AgencyDirectoryService(db);
  const agencies={allowsOrigin:async candidate=>candidate===origin,forLogin:async()=>({id:group,name:'Legacy root'}),accessible:(...args)=>directory.accessible(...args)};
  const sessions=new ClinicianSessionService(db,agencies),schedules=new SchedulesService(db,sessions),workflow=new ProductionWorkflowService(db,sessions),calls=new AssignedCallsService(db,sessions,schedules),reports=new DraftReportService(db,sessions,schedules),enrollment=new InstallationEnrollmentService(db,sessions,agencies);
  const run=(work,credential)=>agencyRequest.run({origin,organizationId:group,installationCredential:credential},work);
  const login=credential=>run(()=>sessions.create({username:'rollout-clinician',password}),credential);
  const unpaired=await login(),token=unpaired.sessionToken;
  const command=()=>({commandId:randomUUID(),reportId:randomUUID(),incidentId:randomUUID(),patientId:randomUUID(),organizationId:group,documentingUserId:actor.userId,patientIdentityState:'unknown'});
  const template=JSON.parse(await readFile(new URL('../../../packages/contracts/examples/dispatch/synthetic-assignment-01.json',import.meta.url),'utf8'));
  const assignment=async(target)=>{
    const payload=structuredClone(template),record=randomUUID();payload.messageId=randomUUID();payload.sourceRecordId=record;
    const elements=payload.groups.flatMap(x=>x.instances).flatMap(x=>x.elements);
    const set=(id,value)=>{elements.find(x=>x.id===id).values[0].value=value;};
    const [bound]=await owner.query('select call_sign from app_identity.operational_unit where id=$1',[target]);
    set('eResponse.03',record);set('eResponse.04',record);set('eResponse.14',bound.call_sign);
    return (await owner.transaction(manager=>routeDispatchAssignment(manager,{organizationId:group,sourceId:'rollout-regression',sourceBytes:Buffer.from(JSON.stringify(payload)),canonical:payload,validationStatus:'applied',findings:[]}))).assignmentId;
  };
  const first=await assignment(unit),foreign=await assignment(secondUnit);
  assert.equal(unpaired.session.productionWorkflow.state,'preparation');
  const legacy=await run(()=>calls.list(token));assert.equal(legacy.productionAccess.state,'preparation');assert.deepEqual(legacy.assignedCalls.map(x=>x.id),[first]);
  await assert.rejects(run(()=>calls.open(token,foreign)),/assigned unit/);
  assert.equal(await run(()=>calls.prepareConfirmation(token,unpaired.session.csrfToken,`assignment:${first}`)),null);
  const standalone=await run(()=>reports.create(token,command()));assert.equal(standalone.documentingUserId,actor.userId);
  const opened=await run(()=>calls.open(token,first));assert.equal(opened.report.documentingUserId,actor.userId);
  await blocking.connect();blockingConnected=true;
  const wait=async(pattern)=>{for(let i=0;i<250;i++){const [row]=await owner.query("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like $1) ready",[`%${pattern}%`]);if(row.ready)return;await new Promise(r=>setTimeout(r,20));}throw new Error('Expected lock wait: '+pattern);};
  // Preparation still denies fixed session expiry at both new-job boundaries.
  for (const kind of ['assignment','standalone']) {
    const expiring=await login(),attempt=command(),job=kind==='assignment'?await assignment(unit):null;
    await owner.query("update app_identity.app_session set expires_at=clock_timestamp()+interval '500 milliseconds' where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(expiring.sessionToken)]);
    await blocking.query('begin');
    if(job)await blocking.query('select id from clinical.call_assignment where id=$1 for update',[job]);
    else await blocking.query('select pg_advisory_xact_lock(hashtext($1))',[attempt.commandId]);
    const creation=run(()=>job?calls.open(expiring.sessionToken,job):reports.create(expiring.sessionToken,attempt));
    const rejection=assert.rejects(creation,job?denied('calls.sessionExpired'):error=>error.getStatus?.()===401);
    await wait(job?'clinical.call_assignment':'pg_advisory_xact_lock');
    for(;;){const [row]=await owner.query("select expires_at<=clock_timestamp() expired from app_identity.app_session where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(expiring.sessionToken)]);if(row.expired)break;await new Promise(resolve=>setTimeout(resolve,20));}
    await blocking.query('commit');await rejection;
    assert.equal((await owner.query('select count(*)::integer n from clinical.report where id=$1',[attempt.reportId]))[0].n,0);
    if(job)assert.equal((await owner.query('select report_id from clinical.call_assignment where id=$1',[job]))[0].report_id,null);
  }
  assert.equal((await run(()=>workflow.get(token))).canEnable,false);
  await assert.rejects(run(()=>workflow.enable(token,{expectedRevision:1,confirm:true})),denied('admin.workflowPreparationRequired'));
  const blank=await run(()=>schedules.save(token,null,{name:'Explicit blank',breakpoints:[]}));
  for(const target of [unit,secondUnit]){await run(()=>schedules.select(token,target,{scheduleId:blank.id,expectedRevision:0}));const code=await run(()=>enrollment.issue(token,target));await run(()=>enrollment.consume({token:code.token,name:'Prepared browser',confirmInstallation:true},randomBytes(32).toString('base64url')));}
  assert.equal((await run(()=>workflow.get(token))).canEnable,true);
  const immutable=(await owner.query("select user_id,created_at,expires_at,personally_authenticated_at from app_identity.app_session where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(token)]))[0];
  // Hold a legacy mutation after authority but before creation, then enable from
  // the same token. The rollout lock serializes them without a session deadlock.
  const held=await assignment(unit);await blocking.query('begin');await blocking.query('select id from clinical.call_assignment where id=$1 for update',[held]);
  const oldCreate=run(()=>calls.open(token,held));await wait('clinical.call_assignment');
  const enabling=Promise.allSettled([run(()=>workflow.enable(token,{expectedRevision:1,confirm:true})),run(()=>workflow.enable(token,{expectedRevision:1,confirm:true}))]);await wait('production_workflow_rollout');
  await blocking.query('commit');assert.ok((await oldCreate).report.id);
  const enabled=await enabling;assert.equal(enabled.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(enabled.find(x=>x.status==='fulfilled').value.state,'enabled');assert.equal(enabled.find(x=>x.status==='rejected').reason.getResponse().code,'admin.workflowStale');
  assert.equal((await owner.query("select count(*)::integer n from app_identity.authentication_event where organization_id=$1 and details->>'kind'='production-workflow-enabled'",[group]))[0].n,1);
  await blocking.end();
  const live=await run(()=>sessions.get(token));assert.equal(live.productionWorkflow.state,'enabled');
  assert.equal(live.expiresAt,unpaired.session.expiresAt);assert.deepEqual((await owner.query("select user_id,created_at,expires_at,personally_authenticated_at from app_identity.app_session where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(token)]))[0],immutable);
  await assert.rejects(run(()=>reports.create(token,command())),denied('calls.enrollmentRequired'));
  assert.equal((await run(()=>calls.open(token,first))).report.id,opened.report.id);
  assert.equal((await run(()=>workflow.get(token))).missingSchedules,0);
  await owner.query("insert into app_identity.organization(id,name,deployment_timezone) values($1,'Independent group','UTC')",[other]);
  await owner.query("insert into app_identity.operational_unit(id,organization_id,name,call_sign) values($1,$2,'Independent unit','INDEPENDENT')",[otherUnit,other]);
  assert.equal((await owner.query('select enabled_at from app_identity.production_workflow_rollout where group_id=$1',[other]))[0].enabled_at,null);
  // Independent sessions in a second group serialize the same one-way step.
  await owner.query('update app_identity.operational_unit set active=false where id=$1',[otherUnit]);
  const secondActor=await accounts.provision({organizationId:other,username:'independent-rollout-admin',displayName:'Independent admin',role:'administrator',temporaryPassword:password});
  await owner.query('update app_identity.local_credential set must_change_password=false,temporary_password_expires_at=null where user_id=$1',[secondActor.userId]);
  const otherAgencies={...agencies,forLogin:async()=>({id:other,name:'Independent group'})};
  const otherSessions=new ClinicianSessionService(db,otherAgencies),otherWorkflow=new ProductionWorkflowService(db,otherSessions);
  const runOther=work=>agencyRequest.run({origin,organizationId:other},work);
  const contenders=await Promise.all([runOther(()=>otherSessions.create({username:'independent-rollout-admin',password})),runOther(()=>otherSessions.create({username:'independent-rollout-admin',password}))]);
  for(const contender of contenders)await runOther(()=>otherSessions.reauthenticate(contender.sessionToken,contender.session.csrfToken,password));
  const competition=await Promise.allSettled(contenders.map(contender=>runOther(()=>otherWorkflow.enable(contender.sessionToken,{expectedRevision:1,confirm:true}))));
  assert.equal(competition.filter(x=>x.status==='fulfilled').length,1);assert.equal(competition.find(x=>x.status==='rejected').reason.getResponse().code,'admin.workflowStale');
  assert.equal((await owner.query("select count(*)::integer n from app_identity.authentication_event where organization_id=$1 and details->>'kind'='production-workflow-enabled'",[other]))[0].n,1);
  // Readiness uses the same approved active integration as real OIDC login.
  const provider=randomUUID(),issuer='https://controlled-rollout-provider.example',clientId='controlled-rollout-client';
  const configuration={issuer,clientId},metadata={issuer,pkceS256:true};
  process.env.OIDC_CREDENTIAL_KEYS_JSON=JSON.stringify({'1':randomBytes(32).toString('base64')});
  await owner.query("insert into app_identity.oidc_provider_version(group_id,revision,provider_id,configuration,encrypted_credential,discovery,discovery_health,created_by) values($1,1,$2,$3::jsonb,$4::jsonb,$5::jsonb,'healthy',$6)",[other,provider,JSON.stringify(configuration),JSON.stringify(encryptCredential('fictional readiness credential',other,provider)),JSON.stringify(metadata),secondActor.userId]);
  await owner.query('insert into app_identity.oidc_provider_state(group_id,draft_revision,active_revision,active_discovery) values($1,1,1,$2::jsonb)',[other,JSON.stringify(metadata)]);
  await owner.query("update app_identity.group_authentication_policy set mode='oidc' where group_id=$1",[other]);
  const readOther=()=>runOther(()=>otherWorkflow.get(contenders[0].sessionToken));
  assert.equal((await readOther()).providerReady,false,'Discovery alone never approves personal authentication');
  await owner.query("update app_identity.oidc_provider_version set configuration=jsonb_set(configuration,'{personalProof}',$2::jsonb) where group_id=$1",[other,JSON.stringify({id:'Controlled fixture contract',acr:'fixture',requiredAmr:['pwd']})]);
  assert.equal((await readOther()).providerReady,true);
  const keys=process.env.OIDC_CREDENTIAL_KEYS_JSON;process.env.OIDC_CREDENTIAL_KEYS_JSON='{}';assert.equal((await readOther()).providerReady,false);process.env.OIDC_CREDENTIAL_KEYS_JSON=keys;
  await owner.query('update app_identity.oidc_provider_state set active_discovery=null where group_id=$1',[other]);
  assert.equal((await readOther()).providerReady,false,'Mutable version discovery cannot repair an unapproved active snapshot');
  // All-group counts prevent a paginated first page from incorrectly enabling.
  const many=Array.from({length:51},()=>randomUUID());for(const id of many)await owner.query("insert into app_identity.operational_unit(id,organization_id,name,call_sign) values($1::uuid,$2,'Later preparation',$1::text)",[id,group]);
  const page=await run(()=>workflow.get(token));assert.equal(page.units.length,50);assert.equal(page.totalUnits,53);assert.equal(page.missingSchedules,51);assert.equal(page.unenrolledUnits,51);
  assert.equal((await run(()=>workflow.get(token,50))).units.length,3);
 }catch(error){console.error(error);throw error;}finally{if(savedKeys===undefined)delete process.env.OIDC_CREDENTIAL_KEYS_JSON;else process.env.OIDC_CREDENTIAL_KEYS_JSON=savedKeys;if(blockingConnected){await blocking.query('rollback').catch(()=>{});await blocking.end().catch(()=>{});}await migration.end();if(db.isInitialized)await db.destroy();if(owner.isInitialized)await owner.destroy();await admin.query(`drop database ${name} with(force)`);await admin.end();}
});
