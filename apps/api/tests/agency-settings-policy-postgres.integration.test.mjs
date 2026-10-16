import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {DataSource} from 'typeorm';
import {readMigrations,applyMigrations} from '../../../packages/database/scripts/migrate.mjs';
import {AccountService} from '../dist/identity/account.service.js';
import {ClinicianSessionService} from '../dist/sessions/clinician-session.service.js';
import {AgencySettingsService} from '../dist/admin/agency-settings.service.js';
import {validateUpdateAgencyMediaSettings} from '../dist/admin/agency-settings.validation.js';
import {localPolicy} from '../dist/authentication/local-policy.js';
const integration=process.env.DATABASE_URL?test:test.skip;
if(process.env.REQUIRE_DATABASE_INTEGRATION&&!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
integration('agency settings and inherited policy save atomically with login authority and preserve other groups',async()=>{
 const name=`settings_policy_${randomUUID().replaceAll('-','')}`,admin=new pg.Client({connectionString:process.env.DATABASE_URL});await admin.connect();await admin.query(`create database ${name}`);
 const url=new URL(process.env.DATABASE_URL);url.pathname=`/${name}`;
 const owner=new DataSource({type:'postgres',url:url.toString()}),db=new DataSource({type:'postgres',url:url.toString(),extra:{options:'-c role=open_triage_api_runtime'}}),migrate=new pg.Client({connectionString:url.toString()});
 try{
  await migrate.connect();await applyMigrations(migrate,await readMigrations(fileURLToPath(new URL('../../../supabase/migrations',import.meta.url))),{info(){}});await migrate.end();await owner.initialize();await db.initialize();
  const root=randomUUID(),child=randomUUID(),sibling=randomUUID(),foreign=randomUUID(),catalog=randomUUID();
  await owner.query("insert into app_identity.organization(id,name,deployment_timezone) values($1,'Root','UTC'),($2,'Other group','UTC')",[root,foreign]);
  await owner.query("insert into app_identity.organization(id,name,parent_organization_id,deployment_timezone) values($1,'Child',$3,'UTC'),($2,'Sibling',$3,'UTC')",[child,sibling,root]);
  const accounts=new AccountService(owner),password='Personal password 42!';
  await accounts.bootstrapOwner({username:'owner',displayName:'Fixture owner',temporaryPassword:password,operator:{operatorId:'test',osAccount:'test',host:'test'}});
  const actor=await accounts.provision({organizationId:root,username:'admin',displayName:'Administrator',role:'administrator',temporaryPassword:password});
  const medic=await accounts.provision({organizationId:root,username:'medic',displayName:'Clinician',role:'clinician',temporaryPassword:password});
  await owner.query('update app_identity.local_credential set must_change_password=false,temporary_password_expires_at=null');
  await owner.query("insert into catalog.release(id,standard,version,dataset,artifact_schema_version,artifact_sha256,provenance) values($1,'fixture','1','settings','1',$2,'{}')",[catalog,'a'.repeat(64)]);
  for(const agency of [root,child,sibling,foreign]){
   await owner.query('insert into app_identity.agency_settings(organization_id) values($1) on conflict do nothing',[agency]);
   await owner.query("insert into app_identity.agency_demographic_version(id,organization_id,catalog_release_id,version,dagency_01,dagency_02,dagency_04,definition_sha256,effective_from,created_by) values($1,$2,$3,1,'STATE-1','AGENCY-1','36',$4,now(),$5)",[randomUUID(),agency,catalog,'b'.repeat(64),actor.userId]);
  }
  const sessions=new ClinicianSessionService(db),service=new AgencySettingsService(db,sessions),signed=await sessions.create({username:'admin',password});await sessions.switchAgency(signed.sessionToken,child);
  await assert.rejects(sessions.requireRecentReauthentication(signed.sessionToken),error=>error.getStatus?.()===403);
  const initial=await service.get(signed.sessionToken),otherBefore=await localPolicy(db,foreign);
  const command=view=>validateUpdateAgencyMediaSettings({expectedRevision:view.revision,language:view.language,regionalFormat:view.regionalFormat,timeZone:view.timeZone,syntheticRetentionHours:view.syntheticRetentionHours,reportMediaAllowanceBytes:view.reportMediaAllowanceBytes,imageMediaLimitBytes:view.imageMediaLimitBytes,appearance:view.appearance,demographics:Object.fromEntries(['agencyUniqueStateId','agencyNumber','stateCode','stateDisplay','stateCodeSystem','stateTerminologyVersion'].map(key=>[key,view.demographics[key]])),authenticationPolicy:{expectedRevision:view.authenticationPolicy.revision,...Object.fromEntries(['maximumSessionHours','temporaryPasswordHours','accountAttemptsPer15Minutes','networkAttemptsPer5Minutes'].map(key=>[key,view.authenticationPolicy[key]]))}});
  const update=command(initial);update.appearance={...update.appearance,brandText:'Child changed'};update.authenticationPolicy.maximumSessionHours=8;
  const changed=await service.update(signed.sessionToken,update);assert.equal(changed.appearance.brandText,'Child changed');assert.equal(changed.authenticationPolicy.maximumSessionHours,8);
  assert.equal((await localPolicy(db,sibling)).maximumSessionHours,8);assert.deepEqual(await localPolicy(db,foreign),otherBefore);
  const beforeAudit=(await owner.query('select count(*)::int count from app_identity.authentication_event'))[0].count;
  const staleSettings=command(changed);staleSettings.expectedRevision=initial.revision;staleSettings.authenticationPolicy.maximumSessionHours=9;staleSettings.appearance={...staleSettings.appearance,brandText:'Must roll back'};
  await assert.rejects(service.update(signed.sessionToken,staleSettings),error=>error.getStatus?.()===409);
  assert.equal((await service.get(signed.sessionToken)).appearance.brandText,'Child changed');assert.equal((await localPolicy(db,child)).maximumSessionHours,8);
  assert.equal((await owner.query('select count(*)::int count from app_identity.authentication_event'))[0].count,beforeAudit);
  const stalePolicy=command(changed);stalePolicy.authenticationPolicy.expectedRevision=initial.authenticationPolicy.revision;stalePolicy.appearance={...stalePolicy.appearance,brandText:'Also roll back'};
  await assert.rejects(service.update(signed.sessionToken,stalePolicy),error=>error.getStatus?.()===409);
  assert.equal((await service.get(signed.sessionToken)).appearance.brandText,'Child changed');
  const noChanges=await service.update(signed.sessionToken,command(changed));assert.equal(noChanges.revision,changed.revision);assert.equal(noChanges.authenticationPolicy.revision,changed.authenticationPolicy.revision);
  const clinical=await sessions.create({username:'medic',password});await assert.rejects(service.update(clinical.sessionToken,command(changed)),error=>error.getStatus?.()===401||error.getStatus?.()===403);
 }finally{if(db.isInitialized)await db.destroy();if(owner.isInitialized)await owner.destroy();await migrate.end().catch(()=>{});await admin.query(`drop database ${name}`);await admin.end();}
});
