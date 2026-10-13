import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,randomBytes} from 'node:crypto';
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
if(process.env.REQUIRE_DATABASE_INTEGRATION&&!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
integration('tested SSO activation preserves sessions, requires current draft and governs local/OIDC next proof and independent recovery through runtime browser cookies',async()=>{
 const name=`activation_${randomUUID().replaceAll('-','')}`,admin=new pg.Client({connectionString:process.env.DATABASE_URL});await admin.connect();await admin.query(`create database ${name}`);
 const url=new URL(process.env.DATABASE_URL);url.pathname=`/${name}`;const owner=new DataSource({type:'postgres',url:url.toString()});
 const migration=new pg.Client({connectionString:url.toString()});let fixture,control;const keys=JSON.stringify({'1':randomBytes(32).toString('base64')});
 const previousKeys=process.env.OIDC_CREDENTIAL_KEYS_JSON;process.env.OIDC_CREDENTIAL_KEYS_JSON=keys;
 try{
  await migration.connect();await applyMigrations(migration,await readMigrations(fileURLToPath(new URL('../../../supabase/migrations',import.meta.url))),{info(){}});await migration.end();await owner.initialize();
  fixture=await discoveryProvider();fixture.browserLogin=true;fixture.personalProofMode='fresh';
  const group=randomUUID(),child=randomUUID(),other=randomUUID(),provider=randomUUID();
  await owner.query("insert into app_identity.organization(id,name,hostname,deployment_timezone) values($1,'Activation group','group.localhost','UTC'),($2,'Independent group','other.localhost','UTC')",[group,other]);
  await owner.query("insert into app_identity.organization(id,name,parent_organization_id,hostname,deployment_timezone) values($1,'Activation child',$2,'child.localhost','UTC')",[child,group]);
  const accounts=new AccountService(owner),password='Fixture personal password 42!';
  await accounts.bootstrapOwner({username:'owner',displayName:'Recovery owner',temporaryPassword:password,operator:{operatorId:'test',osAccount:'test',host:'test'}});
  await accounts.createSuperadmin({username:'superadmin',displayName:'Independent superadmin',temporaryPassword:password,operator:{operatorId:'test',osAccount:'test',host:'test'}});
  const reviewer=await accounts.provision({organizationId:group,username:'reviewer',displayName:'Transition administrator',role:'administrator',temporaryPassword:password});
  const medic=await accounts.provision({organizationId:group,username:'medic',displayName:'Transition clinician',role:'clinician',temporaryPassword:password});
  await accounts.provision({organizationId:other,username:'other',displayName:'Independent clinician',role:'clinician',temporaryPassword:password});
  const temporary=await accounts.provision({organizationId:group,username:'temporary',displayName:'Existing temporary clinician',role:'clinician',temporaryPassword:password});
  const synthetic=await accounts.provision({organizationId:group,username:'synthetic',displayName:'Synthetic ordinary clinician',role:'clinician',temporaryPassword:password});
  await owner.query('update app_identity.app_user set synthetic=true where id=$1',[synthetic.userId]);
  await owner.query('update app_identity.local_credential set must_change_password=false,temporary_password_expires_at=null');
  await owner.query("update app_identity.local_credential set must_change_password=true,temporary_password_expires_at=clock_timestamp()+interval '1 hour' where user_id=$1",[temporary.userId]);
  const demoGroup='32000000-0000-4000-8000-000000000001',demoUser='32000000-0000-4000-8000-000000000002';
  await owner.query("insert into app_identity.organization(id,name,hostname,deployment_timezone) values($1,'Exact demo tenant','demo.localhost','UTC')",[demoGroup]);
  await owner.query("insert into app_identity.app_user(id,organization_id,display_name) values($1,$2,'Exact demonstration fixture')",[demoUser,demoGroup]);
  await owner.query("insert into app_identity.local_credential(user_id,username,password_verifier,must_change_password) select $1,'demo',password_verifier,false from app_identity.local_credential where user_id=$2",[demoUser,medic.userId]);
  await owner.query("insert into app_identity.user_role_assignment(organization_id,user_id,role_id,assigned_by) select $1,$2,id,$2 from app_identity.role where organization_id=$1 and system_key='demo'",[demoGroup,demoUser]);
  await owner.query("update app_identity.group_authentication_policy set mode='oidc' where group_id=$1",[demoGroup]);

  await seedProtectedRecoveryReports(owner,child,medic.userId,reviewer.userId);
  const issuer=`${fixture.origin}/adfs`,configuration={name:'Controlled activation provider',issuer,discoveryUrl:'',clientId:'fictional-client',scopes:['openid'],mappings:{displayName:'name',email:'email'},clientAuthentication:'client_secret_post'};
  const metadata={issuer,authorization_endpoint:`${fixture.origin}/authorize`,token_endpoint:`${fixture.origin}/token`,jwks_uri:`${fixture.origin}/jwks`,id_token_signing_alg_values_supported:['RS256'],pkceS256:true};
  await owner.query("insert into app_identity.oidc_provider_version(group_id,revision,provider_id,configuration,encrypted_credential,discovery,discovery_health,created_by) values($1,1,$2,$3::jsonb,$4::jsonb,$5::jsonb,'healthy',$6)",[group,provider,JSON.stringify(configuration),JSON.stringify(encryptCredential('fresh-provider-secret',group,provider)),JSON.stringify(metadata),reviewer.userId]);
  await owner.query('insert into app_identity.oidc_provider_state(group_id,draft_revision) values($1,1)',[group]);
  for(const [user,subject] of [[reviewer.userId,'activation-reviewer'],[medic.userId,'activation-medic'],[temporary.userId,'activation-temporary']])await owner.query('insert into app_identity.regional_identity_request(group_id,provider_id,first_revision,organization_id,issuer,subject,linked_user_id,linked_by,linked_at) values($1,$2,1,$3,$4,$5,$6,$7,now())',[group,provider,child,issuer,subject,user,reviewer.userId]);
  const sessions=new ClinicianSessionService(owner);const recovery=await sessions.create({username:'owner',password});
  // Independent owner receives an ordinary agency context, never a regional identity.
  await sessions.switchAgency(recovery.sessionToken,child);
  let held;
  control=createServer((req,res)=>{let text='';req.on('data',p=>text+=p);req.on('end',async()=>{try{const cmd=JSON.parse(text||'{}'),answer={};
   if(cmd.holdPolicy || cmd.holdAuthority){held=owner.createQueryRunner();await held.connect();await held.startTransaction();if(cmd.holdPolicy)await held.query('select group_id from app_identity.group_authentication_policy where group_id=$1 for update',[group]);else await held.query('select id from app_identity.user_role_assignment where user_id=$1 and ended_at is null for update',[reviewer.userId]);}
   if(cmd.waiting)answer.waiting=(await owner.query("select count(*)::int count from pg_stat_activity where application_name='activation-race' and wait_event_type='Lock'"))[0].count;
   if(cmd.releasePolicy){if(cmd.editDraft){await held.query("insert into app_identity.oidc_provider_version(group_id,revision,provider_id,configuration,encrypted_credential,discovery,discovery_health,created_by) select group_id,2,provider_id,configuration,encrypted_credential,discovery,discovery_health,created_by from app_identity.oidc_provider_version where group_id=$1 and revision=1",[group]);await held.query('update app_identity.oidc_provider_state set draft_revision=2 where group_id=$1',[group]);}await held.commitTransaction();await held.release();held=undefined;}
   if(cmd.resetDraft){await owner.query('update app_identity.oidc_provider_state set draft_revision=1 where group_id=$1',[group]);await owner.query('delete from app_identity.oidc_provider_version where group_id=$1 and revision=2',[group]);}
   if(cmd.withdrawAuthority){await held.query("update app_identity.user_role_assignment set ended_at=clock_timestamp(),ended_by=$1,note='Activation authority race' where user_id=$1 and ended_at is null",[reviewer.userId]);await held.commitTransaction();await held.release();held=undefined;}
   if(cmd.restoreAuthority)await owner.query('insert into app_identity.user_role_assignment(organization_id,user_id,role_id,assigned_by) select $1,$2,id,$2 from app_identity.role where organization_id=$1 and system_key=\'administrator\'',[group,reviewer.userId]);
   if(cmd.extendDemo)await owner.query("insert into app_identity.user_role_assignment(organization_id,user_id,role_id,assigned_by) select $1,$2,id,$2 from app_identity.role where organization_id=$1 and system_key='administrator'",[demoGroup,demoUser]);
   if(cmd.subject)fixture.tokenOverrides={sub:cmd.subject};
   if(cmd.outage!==undefined)fixture.personalProofMode=cmd.outage?'silent':'fresh';
   if(cmd.mode)await owner.query('update app_identity.group_authentication_policy set mode=$2 where group_id=$1',[group,cmd.mode]);
   if(cmd.health)await owner.query('update app_identity.oidc_provider_version set discovery_health=$2 where group_id=$1 and revision=1',[group,cmd.health]);
   if(cmd.changeDiscovery)await owner.query("update app_identity.oidc_provider_version set discovery=discovery||'{\"signingKeyIds\":[\"changed-key\"]}'::jsonb where group_id=$1 and revision=1",[group]);
   if(cmd.restoreDiscovery)await owner.query('update app_identity.oidc_provider_version set discovery=$2::jsonb where group_id=$1 and revision=1',[group,JSON.stringify(metadata)]);
   if(cmd.ageProof)await owner.query("update app_identity.app_session set personally_authenticated_at=clock_timestamp()-interval '6 minutes',reauthenticated_at=null where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(cmd.ageProof)]);
   if(cmd.expire)await owner.query("update app_identity.app_session set expires_at=created_at+interval '1 microsecond' where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(cmd.expire)]);
   if(cmd.inspect){answer.policy=(await owner.query('select mode from app_identity.group_authentication_policy where group_id=$1',[group]))[0];answer.state=(await owner.query('select draft_revision,active_revision from app_identity.oidc_provider_state where group_id=$1',[group]))[0];answer.audit=await owner.query("select result,details from app_identity.authentication_event where details->>'operation'='activate'");}
   if(cmd.proof){answer.proof=(await owner.query("select offline_recovery.session_has_recovery_proof(s,clock_timestamp()) proof from app_identity.app_session s where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(cmd.proof)]))[0]?.proof;}
   res.setHeader('content-type','application/json');res.end(JSON.stringify(answer));
  }catch(e){res.writeHead(500).end(JSON.stringify({error:String(e)}));}});});control.listen(0,'127.0.0.1');await once(control,'listening');
  const runtime=new URL(url);runtime.searchParams.set('options','-c role=open_triage_api_runtime');
  const policy={id:'controlled-activation-contract',groupId:group,providerId:provider,issuer,clientId:'fictional-client',acr:'fixture:interactive-personal',requiredAmr:['fixture-personal']};
  const result=await promisify(execFile)(process.execPath,[fileURLToPath(new URL('./fixtures/oidc-activation-browser.mjs',import.meta.url))],{cwd:fileURLToPath(new URL('../../../',import.meta.url)),env:{...process.env,DATABASE_URL:runtime.toString(),OIDC_CREDENTIAL_KEYS_JSON:keys,OIDC_PERSONAL_PROOF_POLICIES_JSON:JSON.stringify([policy]),OIDC_PRIVATE_ORIGINS_JSON:JSON.stringify([fixture.origin]),NODE_EXTRA_CA_CERTS:fixture.certificate,ACTIVATION_CONTROL_URL:`http://127.0.0.1:${control.address().port}`,ACTIVATION_OWNER_TOKEN:recovery.sessionToken,ACTIVATION_OWNER_CSRF:recovery.session.csrfToken,ACTIVATION_PASSWORD:password},timeout:120000,maxBuffer:1024*1024}).catch(e=>{throw Error(e.stderr||e.stdout||e.message);});assert.match(result.stdout,/"activation":true/);
 }finally{if(previousKeys===undefined)delete process.env.OIDC_CREDENTIAL_KEYS_JSON;else process.env.OIDC_CREDENTIAL_KEYS_JSON=previousKeys;if(control){control.closeAllConnections();await new Promise(resolve=>control.close(resolve));}await fixture?.close();if(owner.isInitialized)await owner.destroy();await admin.query(`drop database ${name} with (force)`);await admin.end();}
});
