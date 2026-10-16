import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,randomBytes,createHmac} from 'node:crypto';
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
import {discoveryProvider} from './fixtures/oidc-discovery-provider.mjs';
const integration=process.env.DATABASE_URL?test:test.skip;
if(process.env.REQUIRE_DATABASE_INTEGRATION&&!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
integration('runtime provider rotation, restoration, namespace replacement and history survive failed drafts and concurrent writers through the real Admin browser',async()=>{
 const name=`rotation_${randomUUID().replaceAll('-','')}`,admin=new pg.Client({connectionString:process.env.DATABASE_URL});await admin.connect();await admin.query(`create database ${name}`);
 const url=new URL(process.env.DATABASE_URL);url.pathname=`/${name}`;const owner=new DataSource({type:'postgres',url:url.toString()});
 const keys=JSON.stringify({'1':randomBytes(32).toString('base64')}),previous=process.env.OIDC_CREDENTIAL_KEYS_JSON;process.env.OIDC_CREDENTIAL_KEYS_JSON=keys;
 const throttleKey=randomBytes(32),previousThrottle=process.env.AUTH_RATE_LIMIT_SECRET_BASE64;process.env.AUTH_RATE_LIMIT_SECRET_BASE64=throttleKey.toString('base64');
 let fixture,control,held;
 try{
  const migration=new pg.Client({connectionString:url.toString()});await migration.connect();try{await applyMigrations(migration,await readMigrations(fileURLToPath(new URL('../../../supabase/migrations',import.meta.url))),{info(){}});}finally{await migration.end();}
  await owner.initialize();fixture=await discoveryProvider();fixture.browserLogin=true;fixture.personalProofMode='fresh';
  const group=randomUUID(),provider=randomUUID(),password='Rotation fixture password 42!';
  await owner.query("insert into app_identity.organization(id,name,hostname,deployment_timezone) values($1,'Rotation group','rotation.localhost','UTC')",[group]);
  const accounts=new AccountService(owner);await accounts.bootstrapOwner({username:'owner',displayName:'Rotation recovery owner',temporaryPassword:password,operator:{operatorId:'fixture',osAccount:'fixture',host:'fixture'}});
  const medic=await accounts.provision({organizationId:group,username:'medic',displayName:'Rotation clinician',role:'clinician',temporaryPassword:password});
  await owner.query('update app_identity.local_credential set must_change_password=false,temporary_password_expires_at=null');
  const sessions=new ClinicianSessionService(owner),recovery=await sessions.create({username:'owner',password});await sessions.switchAgency(recovery.sessionToken,group);
  const ownerBucket=createHmac('sha256',throttleKey).update(`open-triage-auth-throttle-v1\0account\0${recovery.session.user.id}`).digest('hex');
  const issuer=`${fixture.origin}/adfs`,metadata={issuer,authorization_endpoint:`${fixture.origin}/authorize`,token_endpoint:`${fixture.origin}/token`,jwks_uri:`${fixture.origin}/jwks`,id_token_signing_alg_values_supported:['RS256'],pkceS256:true},config={name:'Working provider',issuer,discoveryUrl:'',clientId:'rotation-client',scopes:['openid'],mappings:{displayName:'name',email:'email'},clientAuthentication:'client_secret_post',privateOrigins:[fixture.origin],personalProof:{id:'controlled-rotation-contract',acr:'fixture:interactive-personal',requiredAmr:['fixture-personal']}};
  await owner.query("insert into app_identity.oidc_provider_version(group_id,revision,provider_id,configuration,encrypted_credential,created_by) values($1,1,$2,$3::jsonb,$4::jsonb,$5)",[group,provider,JSON.stringify(config),JSON.stringify(encryptCredential(fixture.clientSecret,group,provider)),recovery.session.user.id]);
  await owner.query('insert into app_identity.oidc_provider_state(group_id,draft_revision,active_revision,active_discovery) values($1,1,1,$2::jsonb)',[group,JSON.stringify(metadata)]);
  await owner.query("update app_identity.group_authentication_policy set mode='oidc' where group_id=$1",[group]);
  await owner.query("insert into app_identity.regional_identity_request(group_id,provider_id,first_revision,organization_id,issuer,subject,linked_user_id,linked_by,linked_at) values($1,$2,1,$1,$3,'fictional-provider-user',$4,$5,now())",[group,provider,issuer,medic.userId,recovery.session.user.id]);
  control=createServer((req,res)=>{let body='';req.on('data',p=>body+=p);req.on('end',async()=>{try{
   const cmd=JSON.parse(body||'{}'),answer={};
   if(cmd.secret)fixture.clientSecret=cmd.secret;
   if(cmd.metadata)fixture.metadataOverrides=cmd.metadata;
   if(cmd.token)fixture.tokenOverrides=cmd.token;
   if(cmd.rollKeys){fixture.tokenKid='key-next';fixture.keys=fixture.keys.filter(key=>key.kid==='key-next');}
   if(cmd.holdPolicy){held=owner.createQueryRunner();await held.connect();await held.startTransaction();await held.query('select group_id from app_identity.group_authentication_policy where group_id=$1 for update',[group]);}
   if(cmd.waiting){await owner.query('select pg_stat_clear_snapshot()');answer.waiting=(await owner.query("select count(*)::int count from pg_stat_activity where application_name='rotation-race' and cardinality(pg_blocking_pids(pid))>0"))[0].count;}
   if(cmd.prepareExpiry)await owner.query("update app_identity.app_session set personally_authenticated_at=clock_timestamp()-interval '5 minutes'+interval '1 second',reauthenticated_at=null where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(recovery.sessionToken)]);
   if(cmd.proofExpired)answer.expired=(await owner.query("select personally_authenticated_at<clock_timestamp()-interval '5 minutes' expired from app_identity.app_session where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(recovery.sessionToken)]))[0].expired;
   if(cmd.legacyDraft){const legacy=randomUUID();await owner.query("insert into app_identity.oidc_provider_version(group_id,revision,provider_id,configuration,encrypted_credential,created_by) select group_id,$2,$3,configuration,$4::jsonb,created_by from app_identity.oidc_provider_version where group_id=$1 and revision=1",[group,cmd.legacyDraft,legacy,JSON.stringify(encryptCredential(fixture.clientSecret,group,legacy))]);await owner.query('update app_identity.oidc_provider_state set draft_revision=$2 where group_id=$1',[group,cmd.legacyDraft]);}
   if(cmd.release){await held.commitTransaction();await held.release();held=undefined;}
   if(cmd.inspect){answer.state=(await owner.query('select draft_revision,active_revision from app_identity.oidc_provider_state where group_id=$1',[group]))[0];answer.audit=await owner.query("select actor_id,result,details from app_identity.authentication_event where details->>'kind' in('oidc','oidc_test')");answer.identities=await owner.query('select provider_id,issuer,linked_user_id from app_identity.regional_identity_request where group_id=$1',[group]);}
   if(cmd.proof)answer.recovery=(await owner.query("select offline_recovery.session_has_recovery_proof(s,clock_timestamp()) recovery from app_identity.app_session s where token_sha256=encode(sha256($1::bytea),'hex')",[Buffer.from(cmd.proof)]))[0].recovery;
   if(cmd.clearSnapshot)await owner.query('update app_identity.oidc_provider_state set active_discovery=null where group_id=$1',[group]);
   // Distinct maintenance scenarios share a disposable fixture account. Begin a
   // fresh attempt window before the final recovery scenario; throttling itself
   // remains covered by its dedicated real PostgreSQL/session regression suite.
   if(cmd.resetAuthenticationWindow)await owner.query("delete from app_identity.authentication_throttle where scope='account' and key_digest=$1",[ownerBucket]);
   res.setHeader('content-type','application/json');res.end(JSON.stringify(answer));
  }catch(error){res.writeHead(500).end(JSON.stringify({error:String(error)}));}});});control.listen(0,'127.0.0.1');await once(control,'listening');
  const runtime=new URL(url);runtime.searchParams.set('options','-c role=open_triage_api_runtime');
  const result=await promisify(execFile)(process.execPath,[fileURLToPath(new URL('./fixtures/oidc-rotation-browser.mjs',import.meta.url))],{cwd:fileURLToPath(new URL('../../../',import.meta.url)),env:{...process.env,DATABASE_URL:runtime.toString(),OIDC_CREDENTIAL_KEYS_JSON:keys,NODE_EXTRA_CA_CERTS:fixture.certificate,ROTATION_CONTROL_URL:`http://127.0.0.1:${control.address().port}`,ROTATION_OWNER_TOKEN:recovery.sessionToken,ROTATION_OWNER_CSRF:recovery.session.csrfToken,ROTATION_PASSWORD:password},timeout:180000,maxBuffer:1024*1024}).catch(error=>{throw Error(error.stderr||error.stdout||error.message);});
  assert.match(result.stdout,/"rotation":true/);
 }finally{
  if(held){await held.rollbackTransaction();await held.release();}
  if(previous===undefined)delete process.env.OIDC_CREDENTIAL_KEYS_JSON;else process.env.OIDC_CREDENTIAL_KEYS_JSON=previous;
  if(previousThrottle===undefined)delete process.env.AUTH_RATE_LIMIT_SECRET_BASE64;else process.env.AUTH_RATE_LIMIT_SECRET_BASE64=previousThrottle;
  if(control){control.closeAllConnections();await new Promise(r=>control.close(r));}await fixture?.close();if(owner.isInitialized)await owner.destroy();await admin.query(`drop database ${name} with(force)`);await admin.end();
 }
});
