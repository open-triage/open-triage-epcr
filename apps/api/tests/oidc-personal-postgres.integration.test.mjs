import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import pg from 'pg';
import {DataSource} from 'typeorm';
import {readMigrations,applyMigrations} from '../../../packages/database/scripts/migrate.mjs';
import {AccountService} from '../dist/identity/account.service.js';
import {ClinicianSessionService} from '../dist/sessions/clinician-session.service.js';
import {encryptCredential} from '../dist/authentication/oidc-credentials.js';
import {seedProtectedRecoveryReports} from './fixtures/protected-recovery-seed.mjs';
import {discoveryProvider} from './fixtures/oidc-discovery-provider.mjs';
const integration=process.env.DATABASE_URL?test:test.skip;
if(process.env.REQUIRE_DATABASE_INTEGRATION&&!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
integration('personal OIDC enters common runtime sessions and clinical/admin UI through real proxy cookies, enforcing purpose, freshness, switching and live authority',async()=>{
 const name=`personal_${randomUUID().replaceAll('-','')}`,admin=new pg.Client({connectionString:process.env.DATABASE_URL});await admin.connect();await admin.query(`create database ${name}`);
 const url=new URL(process.env.DATABASE_URL);url.pathname=`/${name}`;
 const owner=new DataSource({type:'postgres',url:url.toString()}),runtimeUrl=new URL(url);runtimeUrl.searchParams.set('options','-c role=open_triage_api_runtime');
 const migrate=new pg.Client({connectionString:url.toString()});let fixture,control;
 const oldKeys=process.env.OIDC_CREDENTIAL_KEYS_JSON;
 try{
  await migrate.connect();await applyMigrations(migrate,await readMigrations(fileURLToPath(new URL('../../../supabase/migrations',import.meta.url))),{info(){}});await migrate.end();await owner.initialize();
  const keys=JSON.stringify({'1':randomBytes(32).toString('base64')});process.env.OIDC_CREDENTIAL_KEYS_JSON=keys;
  fixture=await discoveryProvider();fixture.browserLogin=true;
  const group=randomUUID(),child=randomUUID(),other=randomUUID(),provider=randomUUID();
  await owner.query("insert into app_identity.organization(id,name,hostname,deployment_timezone) values($1,'Regional group','group.localhost','UTC'),($2,'Other group','other.localhost','UTC')",[group,other]);
  await owner.query("insert into app_identity.organization(id,name,parent_organization_id,hostname,deployment_timezone) values($1,'Child agency',$2,'child.localhost','UTC')",[child,group]);
  const accounts=new AccountService(owner),password='Personal password 42!';
  await accounts.bootstrapOwner({username:'owner',displayName:'Installation recovery owner',temporaryPassword:password,operator:{operatorId:'test',osAccount:'test',host:'test'}});
  const reviewer=await accounts.provision({organizationId:group,username:'reviewer',displayName:'Local reviewer',role:'administrator',temporaryPassword:password});
  await owner.query('update app_identity.local_credential set must_change_password=false,temporary_password_expires_at=null');
  const clinicianRole=(await owner.query("select id from app_identity.role where organization_id=$1 and system_key='clinician'",[group]))[0].id;
  const adminRole=(await owner.query("select id from app_identity.role where organization_id=$1 and system_key='administrator'",[group]))[0].id;
  const alpha=randomUUID(),beta=randomUUID(),empty=randomUUID();
  for(const [id,label,role] of [[alpha,'Regional Alpha',adminRole],[beta,'Regional Beta',clinicianRole],[empty,'Regional Empty',null]]){
   await owner.query('insert into app_identity.app_user(id,organization_id,display_name) values($1,$2,$3)',[id,group,label]);
   if(id===alpha)await owner.query('insert into app_identity.user_role_assignment(organization_id,user_id,role_id,assigned_by) values($1,$2,$3,$4)',[group,id,clinicianRole,reviewer.userId]);
   if(role)await owner.query('insert into app_identity.user_role_assignment(organization_id,user_id,role_id,assigned_by) values($1,$2,$3,$4)',[group,id,role,reviewer.userId]);
  }
  await seedProtectedRecoveryReports(owner,child,alpha,reviewer.userId);
  const issuer=`${fixture.origin}/adfs`,configuration={name:'Fictional provider',issuer,discoveryUrl:'',clientId:'fictional-client',scopes:['openid'],mappings:{displayName:'name',email:'email'},clientAuthentication:'client_secret_post',privateOrigins:[fixture.origin],personalProof:{id:'controlled-interactive-contract-v1',acr:'fixture:interactive-personal',requiredAmr:['fixture-personal']}};
  const metadata={issuer,authorization_endpoint:`${fixture.origin}/authorize`,token_endpoint:`${fixture.origin}/token`,jwks_uri:`${fixture.origin}/jwks`,id_token_signing_alg_values_supported:['RS256'],pkceS256:true};
  await owner.query("insert into app_identity.oidc_provider_version(group_id,revision,provider_id,configuration,encrypted_credential,discovery,discovery_health,created_by) values($1,1,$2,$3::jsonb,$4::jsonb,$5::jsonb,'healthy',$6),($1,2,$2,$3::jsonb,$4::jsonb,$5::jsonb,'healthy',$6)",[group,provider,JSON.stringify(configuration),JSON.stringify(encryptCredential('fresh-provider-secret',group,provider)),JSON.stringify(metadata),reviewer.userId]);
  await owner.query('insert into app_identity.oidc_provider_state(group_id,draft_revision,active_revision,active_discovery) values($1,2,1,$2::jsonb)',[group,JSON.stringify(metadata)]);
  await owner.query("update app_identity.group_authentication_policy set mode='oidc' where group_id=$1",[group]);
  for(const [id,subject] of [[alpha,'fictional-alpha'],[beta,'fictional-beta'],[empty,'fictional-empty']])await owner.query('insert into app_identity.regional_identity_request(group_id,provider_id,first_revision,organization_id,issuer,subject,linked_user_id,linked_by,linked_at) values($1,$2,1,$3,$4,$5,$6,$7,now())',[group,provider,child,issuer,subject,id,reviewer.userId]);
  await owner.query("insert into app_identity.regional_identity_request(group_id,provider_id,first_revision,organization_id,issuer,subject,denied_at,denied_by,review_revision) values($1,$2,1,$3,$4,'fictional-denied',clock_timestamp(),$5,2)",[group,provider,child,issuer,reviewer.userId]);
  let beforeRevision=false,disable=false,withdrawOrigin=false,expired=false,reassign=false;
  fixture.beforeToken=async()=>{
   if(beforeRevision)await owner.query('update app_identity.oidc_provider_state set active_revision=2 where group_id=$1',[group]);
   if(disable)await owner.query('update app_identity.app_user set active=false where id=$1',[alpha]);
   if(withdrawOrigin)await owner.query("update app_identity.organization set hostname='withdrawn.localhost' where id=$1",[child]);
   if(expired)await owner.query("update app_identity.oidc_personal_transaction set expires_at=created_at+interval '1 microsecond' where completed_at is null");
   if(reassign)await owner.query('update app_identity.installation_registration set revoked_at=clock_timestamp() where revoked_at is null');
  };
  control=createServer((req,res)=>{let text='';req.on('data',part=>text+=part);req.on('end',async()=>{try{
   const command=JSON.parse(text||'{}');
   if(command.proofAvailable!==undefined)await owner.query("update app_identity.oidc_provider_version set configuration=jsonb_set(configuration,'{personalProof}',$2::jsonb) where group_id=$1",[group,JSON.stringify(command.proofAvailable?configuration.personalProof:null)]);
   if(command.token!==undefined)fixture.tokenOverrides=command.token;
   if(command.fresh){fixture.tokenOverrides={...fixture.tokenOverrides,auth_time:Math.floor(Date.now()/1000)};}
   if(command.claimsMode!==undefined)fixture.personalProofMode=command.claimsMode;
   if(command.groupMode)await owner.query("update app_identity.group_authentication_policy set mode=$2 where group_id=$1",[group,command.groupMode]);
   if(command.revision!==undefined){await owner.query('update app_identity.oidc_provider_state set active_revision=$2 where group_id=$1',[group,command.revision]);}
   if(command.disabled!==undefined){await owner.query('update app_identity.app_user set active=$2 where id=$1',[alpha,!command.disabled]);if(command.disabled)await owner.query("update app_identity.app_session set revoked_at=clock_timestamp(),revocation_reason='account_disabled' where user_id=$1 and revoked_at is null",[alpha]);}
   if(command.beforeRevision!==undefined)beforeRevision=command.beforeRevision;
   if(command.disableOnToken!==undefined)disable=command.disableOnToken;
   if(command.expireOnToken!==undefined)expired=command.expireOnToken;
   if(command.withdrawOrigin!==undefined)withdrawOrigin=command.withdrawOrigin;
   if(command.reassignOnToken!==undefined)reassign=command.reassignOnToken;
   if(command.restoreOrigin)await owner.query("update app_identity.organization set hostname='child.localhost' where id=$1",[child]);
   if(command.expireSession){await owner.query("update app_identity.app_session set expires_at=created_at+interval '1 microsecond' where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(command.expireSession)]);}
   if(command.expireRecent){await owner.query("update app_identity.app_session set personally_authenticated_at=created_at,reauthenticated_at=null,personal_authentication_purpose='login' where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(command.expireRecent)]);}
   const answer={};
   if(command.recoveryDeadline){answer.deadline=(await owner.query('select recovery_deadline from offline_recovery.report_key_envelope where report_id=$1',[command.recoveryDeadline]))[0]?.recovery_deadline;}
   if(command.expireRecovery){await owner.query("update offline_recovery.report_key_envelope set recovery_deadline=clock_timestamp()-interval '1 second' where report_id=$1",[command.expireRecovery]);}
   if(command.ageRecoveryProof){await owner.query("update app_identity.app_session set personally_authenticated_at=clock_timestamp()-interval '6 minutes',reauthenticated_at=null where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(command.ageRecoveryProof)]);}

   if(command.waiting){answer.waiting=(await owner.query("select count(*)::int count from pg_stat_activity where application_name='personal-session-race' and wait_event_type='Lock' and query like '%app_identity.app_user%'"))[0].count;}
   if(command.ageSession){
    const hashed=createHash('sha256').update(command.ageSession.newToken).digest('hex');
    const envelope=encryptCredential('race-csrf',group,`csrf:${hashed}`);
    await owner.query(`insert into app_identity.app_session select (jsonb_populate_record(null::app_identity.app_session,to_jsonb(s)||jsonb_build_object(
      'id',gen_random_uuid(),'token_sha256',$2::text,'csrf_sha256',encode(sha256('race-csrf'::bytea),'hex'),
      'created_at',now()-interval '2 hours','last_activity_at',now()-interval '2 minutes','expires_at',now()+interval '2 hours',
      'encrypted_csrf',$3::jsonb))).* from app_identity.app_session s where token_sha256=encode(sha256($1::bytea),'hex')`,[Buffer.from(command.ageSession.token),hashed,JSON.stringify(envelope)]);
   }
   if(command.pairForRace){
    const unit=randomUUID(),identity=randomUUID(),registration=randomUUID(),credential=randomBytes(32).toString('base64url');
    await owner.query("insert into app_identity.operational_unit(id,organization_id,call_sign,name) values($1,$2,'RACE-009','Fictional race unit')",[unit,child]);
    await owner.query('insert into app_identity.installation_identity(id) values($1)',[identity]);
    await owner.query("insert into app_identity.installation_registration(id,installation_identity_id,organization_id,unit_id,name,credential_sha256) values($1,$2,$3,$4,'Fictional paired browser',encode(sha256($5::bytea),'hex'))",[registration,identity,child,unit,Buffer.from(credential)]);
    await owner.query("insert into app_identity.unit_enrollment(id,organization_id,unit_id,issued_by,token_sha256,origin,consumed_at,installation_id) values($1,$2,$3,$4,encode(sha256($5::bytea),'hex'),$6,clock_timestamp(),$7)",[randomUUID(),child,unit,reviewer.userId,randomBytes(32),command.pairForRace.origin,registration]);
    await owner.query("update app_identity.app_session set installation_registration_id=$2 where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(command.pairForRace.token),registration]);
    Object.assign(answer,{registration,credential});
   }
   res.setHeader('content-type','application/json');res.end(JSON.stringify(answer));
  }catch{res.writeHead(500).end('{}');}});});control.listen(0,'127.0.0.1');await once(control,'listening');
  const result=await promisify(execFile)(process.execPath,[fileURLToPath(new URL('./fixtures/oidc-personal-browser.mjs',import.meta.url))],{cwd:fileURLToPath(new URL('../../../',import.meta.url)),env:{...process.env,DATABASE_URL:runtimeUrl.toString(),OIDC_CREDENTIAL_KEYS_JSON:keys,NODE_EXTRA_CA_CERTS:fixture.certificate,OIDC_CONTROL_URL:`http://127.0.0.1:${control.address().port}`,OIDC_ALPHA:alpha,OIDC_BETA:beta,OIDC_LOCAL_USER:reviewer.userId,OIDC_LOCAL_PASSWORD:password,OIDC_OTHER:other,OIDC_GROUP:group,OIDC_CHILD:child},timeout:180000,maxBuffer:1024*1024}).catch(error=>{throw new Error(error.stderr||error.stdout||error.message);});
  assert.match(result.stdout,/"sharedSessions":true/);assert.match(result.stdout,/"sensitiveActionCompleted":true/);assert.match(result.stdout,/"outgoingAuthorityDenied":true/);
  const [credentials]=await owner.query('select count(*)::int count from app_identity.local_credential where user_id=any($1::uuid[])',[[alpha,beta,empty]]);assert.equal(credentials.count,0);
  const audit=await owner.query("select details from app_identity.authentication_event where details->>'kind'='oidc_personal'");assert(audit.length>5);assert.doesNotMatch(JSON.stringify(audit),/fictional-alpha|fictional-beta|fictional-access-token|fresh-provider-secret|code_verifier|ciphertext|nonce/);
  const runtime=new DataSource({type:'postgres',url:runtimeUrl.toString()});await runtime.initialize();
  try{const sessions=new ClinicianSessionService(runtime);const local=await sessions.create({username:'owner',password});assert.equal(local.session.installationOwner,true,'independent recovery stays local despite regional proof configuration');await assert.rejects(sessions.create({username:'Regional Alpha',password}));}finally{await runtime.destroy();}
 }finally{
  if(oldKeys===undefined)delete process.env.OIDC_CREDENTIAL_KEYS_JSON;else process.env.OIDC_CREDENTIAL_KEYS_JSON=oldKeys;
  if(control){control.closeAllConnections();await new Promise(resolve=>control.close(resolve));}await fixture?.close();if(owner.isInitialized)await owner.destroy();await migrate.end().catch(()=>{});await admin.query(`drop database ${name}`);await admin.end();
 }
});
