import {enableProductionWorkflowForTesting} from './fixtures/production-workflow-rollout.mjs';
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
import {encryptCredential} from '../dist/authentication/oidc-credentials.js';
import {seedShiftConfiguration} from './fixtures/current-shift-clinical-seed.mjs';
import {discoveryProvider} from './fixtures/oidc-discovery-provider.mjs';
process.env.PATIENT_KEY_INSTALLATION_ID ??= '91000000-0000-4000-8000-000000000001';
process.env.PATIENT_KEY_VERSION ??= '1';
process.env.PATIENT_KEY_SECRET_BASE64 ??= Buffer.alloc(32,0x31).toString('base64');
const integration=process.env.DATABASE_URL?test:test.skip;
if(process.env.REQUIRE_DATABASE_INTEGRATION&&!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
integration('current-shift gates use conservative signed OIDC proof through real browser redirects and this device session',async()=>{
 const name=`shift_${randomUUID().replaceAll('-','')}`,admin=new pg.Client({connectionString:process.env.DATABASE_URL});await admin.connect();await admin.query(`create database ${name}`);
 const url=new URL(process.env.DATABASE_URL);url.pathname=`/${name}`;
 const owner=new DataSource({type:'postgres',url:url.toString()}),runtimeUrl=new URL(url);runtimeUrl.searchParams.set('options','-c role=open_triage_api_runtime');
 const migration=new pg.Client({connectionString:url.toString()});let fixture,control;
 const previousKeys=process.env.OIDC_CREDENTIAL_KEYS_JSON;
 try{
  await migration.connect();await applyMigrations(migration,await readMigrations(fileURLToPath(new URL('../../../supabase/migrations',import.meta.url))),{info(){}});await migration.end();await owner.initialize();
  const keys=JSON.stringify({'1':randomBytes(32).toString('base64')});process.env.OIDC_CREDENTIAL_KEYS_JSON=keys;
  fixture=await discoveryProvider();fixture.browserLogin=true;fixture.personalProofMode='fresh';fixture.tokenOverrides={sub:'shift-clinician'};
  const group=randomUUID(),child=randomUUID(),provider=randomUUID(),user=randomUUID(),unit=randomUUID(),schedule=randomUUID();
  await owner.query("insert into app_identity.organization(id,name,hostname,deployment_timezone) values($1,'Shift group','group.localhost','UTC')",[group]);
  await owner.query("insert into app_identity.organization(id,name,parent_organization_id,hostname,deployment_timezone) values($1,'Shift child',$2,'child.localhost','UTC')",[child,group]);
  const accounts=new AccountService(owner);await accounts.bootstrapOwner({username:'owner',displayName:'Fixture owner',temporaryPassword:'Fixture owner password 42!',operator:{operatorId:'test',osAccount:'test',host:'test'}});
  const reviewer=await accounts.provision({organizationId:group,username:'reviewer',displayName:'Fixture admin',role:'administrator',temporaryPassword:'Fixture admin password 42!'});
  await owner.query("insert into app_identity.app_user(id,organization_id,display_name) values($1,$2,'Shift regional clinician')",[user,group]);
  await owner.query("insert into app_identity.user_role_assignment(organization_id,user_id,role_id,assigned_by) select $1,$2,id,$3 from app_identity.role where organization_id=$1 and system_key='clinician'",[group,user,reviewer.userId]);
  const childAdmin=await accounts.provision({organizationId:child,username:'child-admin',displayName:'Child fixture admin',role:'administrator',temporaryPassword:'Fixture child password 42!'});
  await seedShiftConfiguration(owner,child,childAdmin.userId);
  const issuer=`${fixture.origin}/adfs`,configuration={name:'Controlled shift provider',issuer,discoveryUrl:'',clientId:'fictional-client',scopes:['openid'],mappings:{displayName:'name',email:'email'},clientAuthentication:'client_secret_post'};
  const metadata={issuer,authorization_endpoint:`${fixture.origin}/authorize`,token_endpoint:`${fixture.origin}/token`,jwks_uri:`${fixture.origin}/jwks`,id_token_signing_alg_values_supported:['RS256'],pkceS256:true};
  await owner.query("insert into app_identity.oidc_provider_version(group_id,revision,provider_id,configuration,encrypted_credential,discovery,discovery_health,created_by) values($1,1,$2,$3::jsonb,$4::jsonb,$5::jsonb,'healthy',$6)",[group,provider,JSON.stringify(configuration),JSON.stringify(encryptCredential('fresh-provider-secret',group,provider)),JSON.stringify(metadata),reviewer.userId]);
  await owner.query('insert into app_identity.oidc_provider_state(group_id,draft_revision,active_revision,active_discovery) values($1,1,1,$2::jsonb)',[group,JSON.stringify(metadata)]);
  await owner.query("update app_identity.group_authentication_policy set mode='oidc' where group_id=$1",[group]);
  await owner.query("insert into app_identity.regional_identity_request(group_id,provider_id,first_revision,organization_id,issuer,subject,linked_user_id,linked_by,linked_at) values($1,$2,1,$3,$4,'shift-clinician',$5,$6,now())",[group,provider,child,issuer,user,reviewer.userId]);
  const incomingRegional=randomUUID();
  await owner.query("insert into app_identity.app_user(id,organization_id,display_name) values($1,$2,'Incoming regional clinician')",[incomingRegional,group]);
  await owner.query("insert into app_identity.user_role_assignment(organization_id,user_id,role_id,assigned_by) select $1,$2,id,$3 from app_identity.role where organization_id=$1 and system_key='clinician'",[group,incomingRegional,reviewer.userId]);
  await owner.query("insert into app_identity.regional_identity_request(group_id,provider_id,first_revision,organization_id,issuer,subject,linked_user_id,linked_by,linked_at) values($1,$2,1,$3,$4,'incoming-shift-clinician',$5,$6,now())",[group,provider,child,issuer,incomingRegional,reviewer.userId]);
  await owner.query("insert into app_identity.operational_unit(id,organization_id,name,call_sign) values($1,$2,'Shift fixture','SHIFT-017')",[unit,child]);
  const checkpoint=new Date(Math.floor(Date.now()/60000)*60000),incoming=new Date(checkpoint.getTime()+120000),points=Array.from({length:7},(_,i)=>[checkpoint,incoming].map(at=>({weekday:i+1,time:at.toISOString().slice(11,16),graceMinutes:0}))).flat();
  await owner.query("insert into app_identity.weekly_schedule(id,group_id,name) values($1,$2,'Zero grace controlled fixture')",[schedule,group]);
  await owner.query('insert into app_identity.weekly_schedule_version(schedule_id,revision,effective_at,breakpoints,actor_id) values($1,1,$2,$3::jsonb,$4)',[schedule,new Date(checkpoint.getTime()-7*86400000),JSON.stringify(points),reviewer.userId]);
  await owner.query('insert into app_identity.unit_schedule_selection(organization_id,unit_id,revision,schedule_id,effective_at,actor_id) values($1,$2,1,$3,$4,$5)',[child,unit,schedule,new Date(checkpoint.getTime()-7*86400000),reviewer.userId]);
  const localAgency=randomUUID(),localUnit=randomUUID(),localSchedule=randomUUID();
  await owner.query("insert into app_identity.organization(id,name,hostname,deployment_timezone) values($1,'Local shift agency','localshift.localhost','UTC')",[localAgency]);
  const localClinician=await accounts.provision({organizationId:localAgency,username:'local-shift-clinician',displayName:'Local shift clinician',role:'clinician',temporaryPassword:'Local shift password 42!'});
  const localAdmin=await accounts.provision({organizationId:localAgency,username:'local-shift-admin',displayName:'Local shift admin',role:'administrator',temporaryPassword:'Local shift admin password 42!'});
  const incomingLocal=await accounts.provision({organizationId:localAgency,username:'incoming-local-clinician',displayName:'Incoming local clinician',role:'clinician',temporaryPassword:'Local shift password 42!'});
  await owner.query('update app_identity.local_credential set must_change_password=false,temporary_password_expires_at=null where user_id=any($1::uuid[])',[[localClinician.userId,incomingLocal.userId]]);
  await seedShiftConfiguration(owner,localAgency,localAdmin.userId);
  await owner.query("insert into app_identity.operational_unit(id,organization_id,name,call_sign) values($1,$2,'Local shift fixture','LOCAL-017')",[localUnit,localAgency]);
  await owner.query("insert into app_identity.weekly_schedule(id,group_id,name) values($1,$2,'Local zero grace')",[localSchedule,localAgency]);
  await owner.query('insert into app_identity.weekly_schedule_version(schedule_id,revision,effective_at,breakpoints,actor_id) values($1,1,$2,$3::jsonb,$4)',[localSchedule,new Date(checkpoint.getTime()-7*86400000),JSON.stringify(points.filter(p=>p.time===checkpoint.toISOString().slice(11,16))),localAdmin.userId]);
  await owner.query('insert into app_identity.unit_schedule_selection(organization_id,unit_id,revision,schedule_id,effective_at,actor_id) values($1,$2,1,$3,$4,$5)',[localAgency,localUnit,localSchedule,new Date(checkpoint.getTime()-7*86400000),localAdmin.userId]);
  await enableProductionWorkflowForTesting(owner,group,reviewer.userId);
  await enableProductionWorkflowForTesting(owner,localAgency,localAdmin.userId);
  control=createServer((req,res)=>{let body='';req.on('data',p=>body+=p);req.on('end',async()=>{try{
   const command=JSON.parse(body||'{}');let answer={};
   if(command.mode)fixture.personalProofMode=command.mode;
   if(command.subject)fixture.tokenOverrides={...fixture.tokenOverrides,sub:command.subject};
   if(command.inspect){const [session]=await owner.query("select user_id,personally_authenticated_at,reauthenticated_at,expires_at,revoked_at from app_identity.app_session where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(command.inspect)]);answer={session};}
   if(command.grace){
    const selectedAgency=command.local?localAgency:child,selectedUnit=command.local?localUnit:unit,selectedActor=command.local?localAdmin.userId:reviewer.userId,newSchedule=randomUUID();
    const now=Date.now(),first=new Date(now+120*60000),second=new Date(now+180*60000);
    const breakpoints=Array.from({length:7},(_,i)=>[first,second].map((at,j)=>({weekday:i+1,time:at.toISOString().slice(11,16),graceMinutes:j?240:180}))).flat();
    await owner.query("insert into app_identity.weekly_schedule(id,group_id,name) values($1,$2,'Overlapping grace browser fixture')",[newSchedule,command.local?localAgency:group]);
    await owner.query('insert into app_identity.weekly_schedule_version(schedule_id,revision,effective_at,breakpoints,actor_id) values($1,1,$2,$3::jsonb,$4)',[newSchedule,new Date(now-86400000),JSON.stringify(breakpoints),selectedActor]);
    await owner.query('insert into app_identity.unit_schedule_selection(organization_id,unit_id,revision,schedule_id,effective_at,actor_id) values($1,$2,2,$3,$4,$5)',[selectedAgency,selectedUnit,newSchedule,new Date(now-1000),selectedActor]);
   }
   if(command.origin){const boundAgency=command.local?localAgency:child,boundUnit=command.local?localUnit:unit,actor=command.local?localAdmin.userId:reviewer.userId;const identity=randomUUID(),registration=randomUUID(),credential=randomBytes(32).toString('base64url');
    await owner.query('insert into app_identity.installation_identity(id) values($1)',[identity]);
    await owner.query("insert into app_identity.installation_registration(id,installation_identity_id,organization_id,unit_id,name,credential_sha256) values($1,$2,$3,$4,'Shift browser',encode(sha256($5::bytea),'hex'))",[registration,identity,boundAgency,boundUnit,Buffer.from(credential)]);
    await owner.query('insert into app_identity.unit_enrollment(id,organization_id,unit_id,issued_by,token_sha256,origin,consumed_at,installation_id) values($1,$2,$3,$4,encode(sha256($5::bytea),\'hex\'),$6,clock_timestamp(),$7)',[randomUUID(),boundAgency,boundUnit,actor,randomBytes(32),command.origin,registration]);answer={credential};}
   if(command.age)await owner.query("update app_identity.app_session set personally_authenticated_at=$2 where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(command.age),new Date(checkpoint.getTime()-1)]);
   res.setHeader('content-type','application/json');res.end(JSON.stringify(answer));
  }catch(error){res.writeHead(500).end(JSON.stringify({error:String(error)}));}});});control.listen(0,'127.0.0.1');await once(control,'listening');
  const policy={id:'controlled-shift-contract',groupId:group,providerId:provider,issuer,clientId:'fictional-client',acr:'fixture:interactive-personal',requiredAmr:['fixture-personal']};
  const result=await promisify(execFile)(process.execPath,[fileURLToPath(new URL('./fixtures/current-shift-oidc-browser.mjs',import.meta.url))],{cwd:fileURLToPath(new URL('../../../',import.meta.url)),env:{...process.env,DATABASE_URL:runtimeUrl.toString(),OIDC_CREDENTIAL_KEYS_JSON:keys,OIDC_PERSONAL_PROOF_POLICIES_JSON:JSON.stringify([policy]),OIDC_PRIVATE_ORIGINS_JSON:JSON.stringify([fixture.origin]),NODE_EXTRA_CA_CERTS:fixture.certificate,SHIFT_CONTROL_URL:`http://127.0.0.1:${control.address().port}`,SHIFT_CHECKPOINT:checkpoint.toISOString(),SHIFT_INCOMING:incoming.toISOString()},timeout:180000,maxBuffer:1024*1024}).catch(e=>{throw Error(e.stderr||e.stdout||e.message);});
  assert.match(result.stdout,/"shiftOidc":true/);assert.match(result.stdout,/"crossing":true/);assert.match(result.stdout,/"graceContinue":true/);assert.match(result.stdout,/"graceSwitch":true/);
 }finally{
  if(previousKeys===undefined)delete process.env.OIDC_CREDENTIAL_KEYS_JSON;else process.env.OIDC_CREDENTIAL_KEYS_JSON=previousKeys;
  if(control){control.closeAllConnections();await new Promise(resolve=>control.close(resolve));}await fixture?.close();if(owner.isInitialized)await owner.destroy();
  await admin.query(`drop database ${name} with (force)`);await admin.end();
 }
});
