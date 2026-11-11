import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {DataSource} from 'typeorm';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {readMigrations,applyMigrations} from '../../../packages/database/scripts/migrate.mjs';
import {AccountService} from '../dist/identity/account.service.js';
import {ClinicianSessionService} from '../dist/sessions/clinician-session.service.js';
import {AndroidUpgradePolicyService} from '../dist/admin/android-upgrade-policy.service.js';
import {AndroidUpgradePolicyController} from '../dist/admin/android-upgrade-policy.controller.js';
import {AndroidReleaseService} from '../dist/admin/android-release.service.js';
import {InstallationEnrollmentService} from '../dist/admin/installation-enrollment.service.js';
import {CsrfGuard} from '../dist/sessions/csrf.guard.js';
import {agencyRequest} from '../dist/sessions/agency-context.js';
import catalog from '@open-triage/contracts/config/android-releases.json' with {type:'json'};
const integration=process.env.DATABASE_URL?test:test.skip;
if(process.env.REQUIRE_DATABASE_INTEGRATION&&!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
const status=code=>error=>error.getStatus?.()===code;

integration('installation upgrade policy persists once across agencies with live Super-admin authority, preview fencing and fixed server deadlines',async()=>{
 const name=`android_policy_${randomUUID().replaceAll('-','')}`,admin=new pg.Client({connectionString:process.env.DATABASE_URL});await admin.connect();await admin.query(`create database ${name}`);
 const url=new URL(process.env.DATABASE_URL);url.pathname=`/${name}`;
 const owner=new DataSource({type:'postgres',url:url.toString()}),db=new DataSource({type:'postgres',url:url.toString(),extra:{options:'-c role=open_triage_api_runtime'}}),migrate=new pg.Client({connectionString:url.toString()});
 const previous=process.env.ANDROID_APPROVED_RELEASE;let app,lock,blockedOutcome;
 try{
  await migrate.connect();await applyMigrations(migrate,await readMigrations(fileURLToPath(new URL('../../../supabase/migrations',import.meta.url))),{info(){}});await migrate.end();await owner.initialize();await db.initialize();
  const a=randomUUID(),b=randomUUID(),unit=randomUUID();
  await owner.query("insert into app_identity.organization(id,name,deployment_timezone) values($1,'Agency A','UTC'),($2,'Agency B','UTC')",[a,b]);
  const accounts=new AccountService(owner),password='Android policy fixture 42!',operator={operatorId:'fixture',osAccount:'fixture',host:'fixture'};
  const custodian=await accounts.bootstrapOwner({username:'owner',displayName:'Installation owner',temporaryPassword:password,operator});
  await accounts.createSuperadmin({username:'superadmin',displayName:'Installation superadmin',temporaryPassword:password,operator});
  const agencyAdmin=await accounts.provision({organizationId:a,username:'agencyadmin',displayName:'Agency administrator',role:'administrator',temporaryPassword:password});
  await accounts.provision({organizationId:a,username:'clinician-a',displayName:'Clinician A',role:'clinician',temporaryPassword:password});
  await accounts.provision({organizationId:b,username:'clinician-b',displayName:'Clinician B',role:'clinician',temporaryPassword:password});
  await owner.query('update app_identity.local_credential set must_change_password=false,temporary_password_expires_at=null');
  const sessions=new ClinicianSessionService(db),sign=async username=>sessions.create({username,password});
  const ownerSession=await sign('owner'),superSession=await sign('superadmin'),ordinary=await sign('agencyadmin'),clinicalA=await sign('clinician-a'),clinicalB=await sign('clinician-b');
  const payload=Buffer.from('synthetic approved replacement APK'),approved=structuredClone(catalog),digest=createHash('sha256').update(payload).digest('hex');
  const current=approved.releases[0];current.descriptor.apkSha256=digest;current.descriptor.apkBytes=payload.length;current.descriptor.artifact=`opentriage-${current.descriptor.versionName}-${current.descriptor.versionCode}-${digest}.apk`;current.downloadUrl=`https://github.com/open-triage/open-triage-epcr/releases/download/${current.tag}/${current.descriptor.artifact}`;
  process.env.ANDROID_APPROVED_RELEASE=current.tag;
  const release=new AndroidReleaseService(sessions,async()=>new Response(payload),approved);
  const lifecycle={schemaVersion:1,retirements:[{versionCode:1,supersededAt:'2026-01-01T00:00:00.000Z',replacementTag:current.tag}]};
  const enrollment=new InstallationEnrollmentService(db,sessions,{allowsOrigin:async()=>true});
  const service=new AndroidUpgradePolicyService(db,sessions,release,enrollment,approved,lifecycle);
  const initial=await service.read(ownerSession.sessionToken);assert.equal(initial.policy.graceDays,90);assert.equal(initial.policy.revision,1);assert.equal(initial.clients.find(c=>c.versionCode===1).deadline,'2026-04-01T00:00:00.000Z');
  assert.deepEqual((await service.read(superSession.sessionToken)).policy,initial.policy);
  for(const token of [ordinary.sessionToken,clinicalA.sessionToken,clinicalB.sessionToken]){
   await assert.rejects(service.read(token),status(403));await assert.rejects(service.preview(token,{graceDays:10,expectedRevision:1}),status(403));
   await assert.rejects(service.update(token,{graceDays:10,expectedRevision:1,previewToken:'a'.repeat(64)}),status(403));
  }
  for(const graceDays of [-1,366,1.5,'90',null])await assert.rejects(service.preview(ownerSession.sessionToken,{graceDays,expectedRevision:1}),status(400));
  const preview=await service.preview(ownerSession.sessionToken,{graceDays:100,expectedRevision:1});assert.equal(preview.proposedClients.find(c=>c.versionCode===1).deadline,'2026-04-11T00:00:00.000Z');
  // Changed lifecycle or artifact availability invalidates a previously reviewed proposal.
  lifecycle.retirements[0].supersededAt='2026-01-02T00:00:00.000Z';await assert.rejects(service.update(ownerSession.sessionToken,{graceDays:100,expectedRevision:1,previewToken:preview.previewToken}),status(409));lifecycle.retirements[0].supersededAt='2026-01-01T00:00:00.000Z';
  delete process.env.ANDROID_APPROVED_RELEASE;await assert.rejects(service.update(ownerSession.sessionToken,{graceDays:100,expectedRevision:1,previewToken:preview.previewToken}),status(409));process.env.ANDROID_APPROVED_RELEASE=current.tag;
  const saved=await service.update(superSession.sessionToken,{graceDays:100,expectedRevision:1,previewToken:preview.previewToken});assert.equal(saved.policy.revision,2);assert.equal(saved.policy.graceDays,100);
  await assert.rejects(service.update(ownerSession.sessionToken,{graceDays:100,expectedRevision:1,previewToken:preview.previewToken}),status(409));
  const recreated=new AndroidUpgradePolicyService(db,sessions,release,enrollment,approved,lifecycle);assert.deepEqual((await recreated.read(ownerSession.sessionToken)).policy,saved.policy);
  const aPolicy=await service.client(clinicalA.sessionToken,undefined,1),bPolicy=await service.client(clinicalB.sessionToken,undefined,1);assert.equal(aPolicy.deadline,bPolicy.deadline);assert.equal(aPolicy.policyRevision,2);assert.equal(aPolicy.deadline,'2026-04-11T00:00:00.000Z');
  assert.equal('actorId' in aPolicy,false);assert.equal('updatedBy' in aPolicy,false);assert.equal('clients' in aPolicy,false);
  const unchangedPreview=await service.preview(superSession.sessionToken,{graceDays:100,expectedRevision:2});
  assert.equal((await service.update(superSession.sessionToken,{graceDays:100,expectedRevision:2,previewToken:unchangedPreview.previewToken})).policy.revision,2);
  delete process.env.ANDROID_APPROVED_RELEASE;
  const outage=await service.client(clinicalA.sessionToken,undefined,1);assert.equal(outage.reason,'replacement-unavailable');assert.equal(outage.deadline,null);
  process.env.ANDROID_APPROVED_RELEASE=current.tag;
  assert.equal((await service.client(clinicalA.sessionToken,undefined,1)).deadline,aPolicy.deadline,'Replacement outage must never restart the retirement clock');
  const oldRelease=approved.releases.find(entry=>entry.descriptor.versionCode===1);
  oldRelease.descriptor.compatibility.requiredCapabilities=['unimplemented-test-v1'];
  const unsupported=await service.preview(superSession.sessionToken,{graceDays:365,expectedRevision:2});
  assert.equal(unsupported.proposedClients.find(entry=>entry.versionCode===1).reason,'unsupported');assert.equal(unsupported.proposedClients.find(entry=>entry.versionCode===1).deadline,null);
  assert.equal((await service.client(clinicalA.sessionToken,undefined,1)).status,'upgrade-required');delete oldRelease.descriptor.compatibility.requiredCapabilities;
  const audit=await owner.query('select * from app_identity.android_upgrade_policy_event');assert.equal(audit.length,1);assert.equal(audit[0].before_policy.graceDays,90);assert.equal(audit[0].after_policy.graceDays,100);
  await assert.rejects(owner.query('update app_identity.android_upgrade_policy_event set action=action'),/append-only/);
  await assert.rejects(db.query('update app_identity.android_upgrade_policy set grace_days=4,updated_by=$1',[agencyAdmin.userId]),error=>error.code==='42501');
  for(const table of ['android_upgrade_policy','android_upgrade_policy_event'])assert.equal((await owner.query("select relrowsecurity from pg_class where oid=$1::regclass",[`app_identity.${table}`]))[0].relrowsecurity,true);
  assert.equal((await owner.query("select has_table_privilege('open_triage_api_runtime','app_identity.android_upgrade_policy','DELETE') allowed"))[0].allowed,false);
  // Waiting for another writer cannot turn a revoked login into mutation authority.
  const heldPreview=await service.preview(ownerSession.sessionToken,{graceDays:80,expectedRevision:2});
  lock=new pg.Client({connectionString:url.toString()});await lock.connect();await lock.query('begin');await lock.query('select * from app_identity.android_upgrade_policy for update');
  const blocked=service.update(ownerSession.sessionToken,{graceDays:80,expectedRevision:2,previewToken:heldPreview.previewToken});
  let settled;blockedOutcome=blocked.then(value=>{settled={value};return settled;},error=>{settled={error};return settled;});
  let waiting=false;
  for(let i=0;i<100;i++){
   const rows=await owner.query("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'select grace_days%for update') waiting");
   if(rows[0].waiting){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
  }
  if(!waiting && settled?.error) throw settled.error;
  assert.equal(waiting,true,'Exact policy writer must reach the held row lock');
  await owner.query("update app_identity.app_session set revoked_at=clock_timestamp(),revocation_reason='administrator_revoke' where token_sha256=$1",[createHash('sha256').update(ownerSession.sessionToken).digest('hex')]);
  await lock.query('rollback');await lock.end();lock=null;const blockedResult=await blockedOutcome;assert.equal(blockedResult.error?.getStatus?.(),401);
  assert.equal((await service.read(superSession.sessionToken)).policy.revision,2);assert.equal((await owner.query('select count(*)::int n from app_identity.android_upgrade_policy_event'))[0].n,1);
  // The read-only enrolled client path works without a clinician login and cannot mint one.
  const credential=randomBytes(32).toString('base64url'),registration=randomUUID(),identity=randomUUID(),enrollmentId=randomUUID();
  await owner.query("insert into app_identity.operational_unit(id,organization_id,name,call_sign,active) values($1,$2,'Policy unit','POLICY',true)",[unit,a]);
  await owner.query('insert into app_identity.installation_identity(id) values($1)',[identity]);
  await owner.query("insert into app_identity.installation_registration(id,installation_identity_id,organization_id,unit_id,name,credential_sha256) values($1,$2,$3,$4,'Policy device',$5)",[registration,identity,a,unit,createHash('sha256').update(credential).digest('hex')]);
  const origin='https://policy.example.test';
  await owner.query("insert into app_identity.unit_enrollment(id,organization_id,unit_id,issued_by,token_sha256,origin,consumed_at,installation_id) values($1,$2,$3,$4,$5,$6,clock_timestamp(),$7)",[enrollmentId,a,unit,custodian.userId,'a'.repeat(64),origin,registration]);
  class HttpModule{};Module({controllers:[AndroidUpgradePolicyController],providers:[{provide:AndroidUpgradePolicyService,useValue:service}]})(HttpModule);
  app=await NestFactory.create(HttpModule,{logger:false});app.setGlobalPrefix('api');app.use((req,res,next)=>agencyRequest.run({origin},next));app.useGlobalGuards(new CsrfGuard(sessions));await app.listen(0,'127.0.0.1');const endpoint=await app.getUrl();
  const sessionsBeforeNative=(await owner.query('select count(*)::int n from app_identity.app_session'))[0].n;
  const native=await fetch(`${endpoint}/api/android/compatibility?versionCode=1`,{headers:{cookie:`open_triage_installation=${credential}`}});assert.equal(native.status,200);assert.equal((await native.json()).deadline,aPolicy.deadline);assert.match(native.headers.get('cache-control'),/no-store/);assert.equal((await owner.query('select count(*)::int n from app_identity.app_session'))[0].n,sessionsBeforeNative);
  assert.equal((await fetch(`${endpoint}/api/android/compatibility?versionCode=1`)).status,401);
  assert.equal((await fetch(`${endpoint}/api/android/compatibility?versionCode=1&versionCode=2`,{headers:{cookie:`open_triage_installation=${credential}`}})).status,400);
  const cookie=`open_triage_session=${superSession.sessionToken}`;
  const noCsrf=await fetch(`${endpoint}/api/super-admin/android/upgrade-policy/preview`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({graceDays:60,expectedRevision:2})});assert.equal(noCsrf.status,401);
  const withCsrf=await fetch(`${endpoint}/api/super-admin/android/upgrade-policy/preview`,{method:'POST',headers:{cookie,'content-type':'application/json','x-csrf-token':superSession.session.csrfToken},body:JSON.stringify({graceDays:60,expectedRevision:2})});assert.equal(withCsrf.status,200);
  await owner.query('update app_identity.installation_registration set revoked_at=clock_timestamp() where id=$1',[registration]);assert.equal((await fetch(`${endpoint}/api/android/compatibility?versionCode=1`,{headers:{cookie:`open_triage_installation=${credential}`}})).status,401);
 }finally{
  if(previous===undefined)delete process.env.ANDROID_APPROVED_RELEASE;else process.env.ANDROID_APPROVED_RELEASE=previous;
  if(app)await app.close();if(lock){await lock.query('rollback').catch(()=>{});await lock.end();}if(blockedOutcome)await blockedOutcome;if(db.isInitialized)await db.destroy();if(owner.isInitialized)await owner.destroy();await migrate.end().catch(()=>{});await admin.query(`drop database ${name}`);await admin.end();
 }
});
