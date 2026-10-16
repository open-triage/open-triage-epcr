import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,createHash,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {DataSource} from 'typeorm';
import {readMigrations,applyMigrations} from '../../../packages/database/scripts/migrate.mjs';
import {AccountService} from '../dist/identity/account.service.js';
import {ClinicianSessionService} from '../dist/sessions/clinician-session.service.js';
import {AuthenticationPolicyService} from '../dist/authentication/authentication-policy.service.js';
import {ExternalIdentityService} from '../dist/authentication/external-identity.service.js';
import {UserRoleReadService} from '../dist/admin/user-role-read.service.js';
import {UserRoleAssignmentService} from '../dist/admin/user-role-assignment.service.js';
import {UserLifecycleService} from '../dist/admin/user-lifecycle.service.js';
import {UserProvisioningService} from '../dist/admin/user-provisioning.service.js';
import {SessionAdministrationService} from '../dist/admin/session-administration.service.js';
import {encryptCredential} from '../dist/authentication/oidc-credentials.js';
const integration=process.env.DATABASE_URL?test:test.skip;
if(process.env.REQUIRE_DATABASE_INTEGRATION&&!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
const hash=value=>createHash('sha256').update(value).digest('hex');
integration('runtime regional approval is atomic, source-bound, password-free and shares local user administration across agencies',async()=>{
 const previousKeys=process.env.OIDC_CREDENTIAL_KEYS_JSON;process.env.OIDC_CREDENTIAL_KEYS_JSON=JSON.stringify({'1':randomBytes(32).toString('base64')});
 const name=`approval_${randomUUID().replaceAll('-','')}`,admin=new pg.Client({connectionString:process.env.DATABASE_URL});await admin.connect();await admin.query(`create database ${name}`);
 const url=new URL(process.env.DATABASE_URL);url.pathname=`/${name}`;
 const ownerDb=new DataSource({type:'postgres',url:url.toString()}),db=new DataSource({type:'postgres',url:url.toString(),extra:{options:'-c role=open_triage_api_runtime',application_name:'new-regional-user-regression'}});
 const migrate=new pg.Client({connectionString:url.toString()});
 try{
  await migrate.connect();await applyMigrations(migrate,await readMigrations(fileURLToPath(new URL('../../../supabase/migrations',import.meta.url))),{info(){}});await migrate.end();await ownerDb.initialize();await db.initialize();
  const root=randomUUID(),child=randomUUID(),foreign=randomUUID(),provider=randomUUID(),issuer='https://provider.example/ExactIssuer';
  await ownerDb.query("insert into app_identity.organization(id,name,deployment_timezone) values($1,'Group','UTC'),($2,'Foreign','UTC')",[root,foreign]);
  await ownerDb.query("insert into app_identity.organization(id,name,parent_organization_id,deployment_timezone) values($1,'Child agency',$2,'UTC')",[child,root]);
  const accounts=new AccountService(ownerDb),password='Personal password 42!';
  await accounts.bootstrapOwner({username:'owner',displayName:'Recovery owner',temporaryPassword:password,operator:{operatorId:'test',osAccount:'test',host:'test'}});
  const actor=await accounts.provision({organizationId:root,username:'admin',displayName:'Reviewer',role:'administrator',temporaryPassword:password});
  const foreignActor=await accounts.provision({organizationId:foreign,username:'foreign',displayName:'Foreign reviewer',role:'administrator',temporaryPassword:password});
  await ownerDb.query('update app_identity.local_credential set must_change_password=false,temporary_password_expires_at=null');
  const sessions=new ClinicianSessionService(db),identities=new ExternalIdentityService(db,sessions),reads=new UserRoleReadService(db,sessions),roles=new UserRoleAssignmentService(db,sessions),lifecycle=new UserLifecycleService(db,sessions),security=new SessionAdministrationService(db,sessions);
  const signed=await sessions.create({username:'admin',password}),foreignSession=await sessions.create({username:'foreign',password});
  await sessions.switchAgency(signed.sessionToken,child);
  const token=signed.sessionToken;
  await ownerDb.query('insert into app_identity.oidc_provider_version(group_id,revision,provider_id,configuration,created_by) values($1,1,$2,$3::jsonb,$4),($1,2,$2,$3::jsonb,$4)',[root,provider,JSON.stringify({issuer}),actor.userId]);
  await ownerDb.query('insert into app_identity.oidc_provider_state(group_id,draft_revision,active_revision) values($1,2,1)',[root]);
  const clinician=(await ownerDb.query("select id from app_identity.role where organization_id=$1 and system_key='clinician'",[root]))[0].id;
  const protectedRole=(await ownerDb.query("select id from app_identity.role where organization_id=$1 and system_key='administrator'",[root]))[0].id;
  const record=(subject,username)=>db.transaction(manager=>identities.record(manager,{groupId:root,providerId:provider,revision:1,organizationId:child},{issuer,subject,displayName:'Untrusted matching name',email:'same@example.org',username}));
  const command={displayName:'New regional clinician',roleIds:[clinician],providerSource:'draft',expectedProviderRevision:2};
  // Requests share bounded search/pagination with accounts but remain non-accounts.
  const reviewRequest=await record('Literal%_ExactSubject','alice.provider');
  const pendingRows=await reads.users(token,{state:'pending',search:'literal%_',limit:'1'});
  assert.equal(pendingRows.items.length,1);assert.equal(pendingRows.items[0].id,reviewRequest.requestId);
  assert.equal(pendingRows.items[0].externalIdentity.username,'alice.provider');
  assert.equal((await reads.users(token,{state:'pending',search:'alice.provider'})).items[0].id,reviewRequest.requestId);
  assert.equal(pendingRows.items[0].externalIdentity.reviewRevision,1);assert.equal(pendingRows.items[0].active,false);
  assert.equal((await reads.users(foreignSession.sessionToken,{state:'all',search:'Literal%_'})).items.length,0);
  assert.equal((await reads.users(token,{state:'all',roleId:clinician})).items.some(row=>row.externalIdentity),false);
  assert.equal((await reads.users(token,{state:'active',search:'Literal%_'})).items.length,0);
  for(const bad of [{},{expectedReviewRevision:0},{expectedReviewRevision:1,note:'x'.repeat(1001)},{expectedReviewRevision:1,userId:actor.userId}])
   await assert.rejects(identities.deny(token,reviewRequest.requestId,bad),error=>error.getStatus?.()===400);
  await assert.rejects(identities.deny(foreignSession.sessionToken,reviewRequest.requestId,{expectedReviewRevision:1}),error=>[403,404].includes(error.getStatus?.()));
  const unprovenReviewer=await sessions.create({username:'admin',password});
  const beforeDenial=(await ownerDb.query('select count(*)::int count from app_identity.app_user'))[0].count;
  const denied=await identities.deny(unprovenReviewer.sessionToken,reviewRequest.requestId,{expectedReviewRevision:1,note:'Fictional review decision'});
  assert.equal(denied.status,'denied');assert.equal(denied.reviewRevision,2);assert(denied.deniedAt);
  assert.equal((await record('Literal%_ExactSubject')).status,'denied','repeat validated sign-in cannot undo a denial');
  assert.equal((await ownerDb.query('select count(*)::int count from app_identity.app_user'))[0].count,beforeDenial);
  assert.equal((await reads.users(token,{state:'pending',search:'Literal%_'})).items.length,0);
  assert.equal((await reads.users(token,{state:'denied',search:'Literal%_'})).items[0].externalIdentity.status,'denied');
  for(const input of [command,{...command,expectedReviewRevision:1}])await assert.rejects(identities.approve(token,reviewRequest.requestId,input),error=>error.getStatus?.()===409);
  await assert.rejects(identities.deny(token,reviewRequest.requestId,{expectedReviewRevision:1}),error=>error.getStatus?.()===409);
  const reconsidered=await identities.approve(token,reviewRequest.requestId,{...command,expectedReviewRevision:2,displayName:'Reconsidered clinician'});
  assert.equal(reconsidered.status,'linked');assert.equal(reconsidered.reviewRevision,3);assert.equal(reconsidered.deniedAt,null);
  await assert.rejects(identities.deny(token,reviewRequest.requestId,{expectedReviewRevision:3}),error=>error.getStatus?.()===409);
  const reconsideredRows=(await reads.users(token,{state:'all',search:'reconsidered'})).items;
  assert.equal(reconsideredRows.length,1);assert.equal(reconsideredRows[0].id,reconsidered.linkedUserId);assert.equal(reconsideredRows[0].externalIdentity,undefined);
  assert.equal(reconsideredRows[0].ssoUsername,'alice.provider');assert.equal(reconsideredRows[0].username,null);
  assert.equal((await reads.users(token,{state:'active',search:'alice.provider'})).items[0].id,reconsidered.linkedUserId);
  const [denialAudit]=await ownerDb.query("select actor_id,note from app_identity.authentication_event where details->>'operation'='denied' and details->>'requestId'=$1",[reviewRequest.requestId]);
  assert.equal(denialAudit.actor_id,actor.userId);assert.equal(denialAudit.note,'Fictional review decision');
  // Shared audit action names do not make identity decisions policy revisions.
  const policyService=new AuthenticationPolicyService(db,sessions),baselinePolicy=await policyService.get(token);
  assert.equal(baselinePolicy.history.length,0,'denial is audited but is not a blank policy change');
  const policyCommand=Object.fromEntries(['maximumSessionHours','temporaryPasswordHours','accountAttemptsPer15Minutes','networkAttemptsPer5Minutes'].map(key=>[key,baselinePolicy[key]]));
  const policyUpdated=await policyService.update(token,{...policyCommand,maximumSessionHours:baselinePolicy.maximumSessionHours+1,expectedRevision:baselinePolicy.revision});
  assert.equal(policyUpdated.history.length,1);assert.equal(policyUpdated.history[0].details.policy.revision,baselinePolicy.revision+1);
  for(const kind of ['regional_identity','oidc','production-workflow-enabled','future-audit-operation'])for(let index=0;index<6;index++)
   await ownerDb.query("insert into app_identity.authentication_event(organization_id,actor_id,action,result,details) values($1,$2,'authentication.policy_update','succeeded',$3::jsonb)",[root,actor.userId,JSON.stringify({kind,prior:null,policy:'not a policy revision'})]);
  assert.equal((await policyService.get(token)).history.length,1,'unrelated events cannot displace valid policy history within its limit');
  const conflictRequest=await record('DenialApprovalRace');
  const competing=await Promise.allSettled([identities.deny(token,conflictRequest.requestId,{expectedReviewRevision:1}),identities.approve(token,conflictRequest.requestId,{...command,expectedReviewRevision:1,displayName:'Race clinician'})]);
  assert.equal(competing.filter(result=>result.status==='fulfilled').length,1);assert.equal(competing.filter(result=>result.status==='rejected'&&result.reason.getStatus?.()===409).length,1);
  // Kind is a tie breaker: identifiers may coincide across the two source tables.
  const collision=randomUUID();
  await ownerDb.query("insert into app_identity.app_user(id,organization_id,display_name,active) values($1,$2,'Pagination collision',false)",[collision,root]);
  await ownerDb.query("insert into app_identity.regional_identity_request(id,group_id,provider_id,first_revision,organization_id,issuer,subject,display_name) values($1,$2,$3,1,$4,$5,'Pagination collision','Pagination collision')",[collision,root,provider,child,issuer]);
  const firstMixed=await reads.users(token,{state:'all',search:'Pagination collision',limit:'1'});assert.equal(firstMixed.items.length,1);assert(firstMixed.nextCursor);
  const secondMixed=await reads.users(token,{state:'all',search:'Pagination collision',limit:'1',cursor:firstMixed.nextCursor});assert.equal(secondMixed.items.length,1);assert.equal(secondMixed.nextCursor,null);
  assert.equal(!!firstMixed.items[0].externalIdentity,!secondMixed.items[0].externalIdentity);
  // Users-read alone cannot expose regional issuer, subject or profile hints.
  const usersOnly=new UserRoleReadService(db,{requireCapability:async()=>({organization:{id:child},user:{id:actor.userId},capabilities:['users:read']})});
  assert.equal((await usersOnly.users('fixture',{state:'all',search:'Pagination collision'})).items.length,1);
  assert.equal((await usersOnly.users('fixture',{state:'pending'})).items.length,0);
  const request=await record('NewExactSubject','new.clinician.provider');
  assert.equal(request.ordinaryAccess,false);
  const directory=await identities.list(token,{});assert.deepEqual(directory.items[0].reviewProviders,[{source:'draft',revision:2},{source:'active',revision:1}]);
  for(const input of [{...command,temporaryPassword:password},{...command,note:7},{...command,providerSource:['draft']},{...command,roleIds:[clinician,clinician]}])await assert.rejects(identities.approve(token,request.requestId,input),error=>error.getStatus?.()===400);
  await assert.rejects(identities.approve(foreignSession.sessionToken,request.requestId,command),error=>[403,404].includes(error.getStatus?.()));
  await assert.rejects(identities.approve(token,request.requestId,{...command,providerSource:'active',expectedProviderRevision:2}),error=>error.getStatus?.()===409);
  const usersBefore=(await ownerDb.query('select count(*)::int count from app_identity.app_user'))[0].count;
  await assert.rejects(identities.approve(token,request.requestId,{...command,roleIds:[protectedRole]}),error=>error.getStatus?.()===403);
  assert.equal((await ownerDb.query('select count(*)::int count from app_identity.app_user'))[0].count,usersBefore,'failed role grants roll back user creation');
  const results=await Promise.allSettled(Array.from({length:8},()=>identities.approve(token,request.requestId,command)));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.filter(result=>result.status==='rejected'&&result.reason.getStatus?.()===409).length,7);
  const approved=results.find(result=>result.status==='fulfilled').value,userId=approved.linkedUserId;assert.equal(approved.ordinaryAccess,false);
  assert.equal((await ownerDb.query('select count(*)::int count from app_identity.app_user'))[0].count,usersBefore+1);
  assert.equal((await ownerDb.query('select count(*)::int count from app_identity.local_credential where user_id=$1',[userId]))[0].count,0);
  assert.equal((await ownerDb.query('select count(*)::int count from app_identity.app_session where user_id=$1',[userId]))[0].count,0);
  assert.equal((await ownerDb.query('select organization_id from app_identity.app_user where id=$1',[userId]))[0].organization_id,root);
  assert.equal((await record('NewExactSubject')).requestId,request.requestId);
  const noRoles=await identities.approve(token,(await record('NoRoleSubject')).requestId,{...command,displayName:'No workspace',roleIds:[],providerSource:'active',expectedProviderRevision:1});
  assert.equal((await ownerDb.query("select exists(select 1 from app_identity.capability c where app_identity.user_has_capability($1,$2,c.key)) allowed",[noRoles.linkedUserId,child]))[0].allowed,false,'group membership supplies no workspace capabilities without a usable role');
  assert.equal((await ownerDb.query('select count(*)::int count from app_identity.app_session where user_id=$1',[noRoles.linkedUserId]))[0].count,0);
  const local=await new UserProvisioningService(db,sessions).provision(token,{username:'local.child',displayName:'Local child clinician',temporaryPassword:password,roleIds:[clinician]});
  await ownerDb.query('update app_identity.local_credential set must_change_password=false,temporary_password_expires_at=null where user_id=$1',[local.userId]);
  for(const [id,username,search] of [[userId,null,'new.clinician.provider'],[local.userId,'local.child','local.child']]){
   const page=await reads.users(token,{search,roleId:clinician,state:'all'});assert.equal(page.items.length,1);assert.equal(page.items[0].id,id);assert.equal(page.items[0].username,username);assert.deepEqual(page.items[0].roles.map(role=>role.id),[clinician]);
   if(username===null)assert.equal(page.items[0].ssoUsername,'new.clinician.provider');
   assert.equal((await reads.users(foreignSession.sessionToken,{search})).items.length,0);
   const replaced=await roles.replace(token,id,{expectedRevision:page.items[0].revision,roleIds:[]});assert.equal(replaced.username,username);
   const restored=await roles.replace(token,id,{expectedRevision:replaced.revision,roleIds:[clinician]});assert.equal(restored.roles[0].id,clinician);
   // Trusted issuance provenance makes password-free sessions visible through the shared boundary.
   const live=randomUUID(),expired=randomUUID(),revoked=randomUUID(),stale=randomUUID();
   for(const [sessionId,expiry,revoke,version] of [[live,'1 hour',null,1],[expired,'-1 hour',null,1],[revoked,'1 hour',new Date(),1],[stale,'1 hour',null,2]]){
    if(username===null&&sessionId!==stale)await ownerDb.query(`insert into app_identity.app_session(id,user_id,organization_id,token_sha256,csrf_sha256,credential_version,created_at,last_activity_at,expires_at,device_label,revoked_at,revocation_reason,
      authentication_source,authentication_purpose,personally_authenticated_at,personal_authentication_purpose,oidc_identity_request_id,oidc_group_id,oidc_revision,personal_proof_policy_sha256,encrypted_csrf,personal_identity_request_id,personal_group_id,personal_revision,latest_personal_proof_policy_sha256)
      values($1,$2,$3,$4,$4,null,now()-interval '2 hours',now()-interval '1 hour',now()+$5::interval,'Fictional browser',$6,case when $6::timestamptz is null then null else 'fixture_revoked' end,
      'oidc','login',now()-interval '2 hours','login',$7,$8,1,$9,$10::jsonb,$7,$8,1,$9)`,[sessionId,id,child,hash(sessionId),expiry,revoke,request.requestId,root,hash('fixture-approved-proof'),JSON.stringify(encryptCredential('fixture-csrf',root,`csrf:${hash(sessionId)}`))]);
    else await ownerDb.query(`insert into app_identity.app_session(id,user_id,organization_id,token_sha256,csrf_sha256,credential_version,created_at,last_activity_at,expires_at,device_label,revoked_at,revocation_reason) values($1,$2,$3,$4,$4,$5,now()-interval '2 hours',now()-interval '1 hour',now()+$6::interval,'Fictional browser',$7,case when $7::timestamptz is null then null else 'fixture_revoked' end)`,[sessionId,id,child,hash(sessionId),version,expiry,revoke]);
   }
   const listed=await security.list(token,id);assert(listed.items.some(session=>session.id===live));assert(!listed.items.some(session=>session.id===expired||session.id===revoked));assert(!listed.items.some(session=>session.id===stale));
   await assert.rejects(security.list(foreignSession.sessionToken,id),error=>error.getStatus?.()===404);
   await security.revoke(token,id,live,{});assert(!(await security.list(token,id)).items.some(session=>session.id===live));
   if(username===null){await assert.rejects(security.resetCredential(token,id,{expectedRevision:restored.revision,temporaryPassword:password}),error=>error.getStatus?.()===404);await assert.rejects(sessions.getAuthenticated(stale),error=>error.getStatus?.()===401);}
   const disabled=await lifecycle.update(token,id,{expectedRevision:restored.revision,username,displayName:'Renamed '+search,active:false});assert.equal(disabled.username,username);assert.equal(disabled.active,false);assert.equal((await security.list(token,id)).items.length,0);
   assert((await reads.users(token,{state:'disabled',search:'renamed'})).items.some(user=>user.id===id));
   const enabled=await lifecycle.update(token,id,{expectedRevision:disabled.revision,username,displayName:'Renamed '+search,active:true});assert.equal(enabled.freshLoginRequired,true);assert.equal(enabled.restoredRoles[0].id,clinician);
   assert.equal((await security.list(token,id)).items.length,0,'reactivation never restores revoked sessions');
  }
  assert.equal((await ownerDb.query('select issuer,subject from app_identity.regional_identity_request where id=$1',[request.requestId]))[0].subject,'NewExactSubject');
  const raceRequest=(await record('CompetingLinkApproval')).requestId;
  const countBeforeRace=(await ownerDb.query('select count(*)::int count from app_identity.app_user'))[0].count;
  const race=await Promise.allSettled([identities.link(token,raceRequest,{userId:local.userId,providerSource:"draft",expectedProviderRevision:2}),identities.approve(token,raceRequest,command)]);assert.equal(race.filter(result=>result.status==='fulfilled').length,1);
  const winner=race.find(result=>result.status==='fulfilled').value;assert.equal((await ownerDb.query('select count(*)::int count from app_identity.app_user'))[0].count,countBeforeRace+(winner.linkedUserId===local.userId?0:1));
  // Reviewer role authoring commits while approval waits for the shared role lock.
  const limited=await accounts.provision({organizationId:root,username:'limited',displayName:'Limited reviewer',role:'clinician',temporaryPassword:password});await ownerDb.query('update app_identity.local_credential set must_change_password=false,temporary_password_expires_at=null where user_id=$1',[limited.userId]);
  const roleId=randomUUID(),versionId=randomUUID(),caps=['users:read','users:write','settings:read','settings:write','roles:assign','roles:read','clinical:document'];
  const writeRole=async(manager,revision,id,capabilities)=>{
   if(revision===1)await manager.query("insert into app_identity.role(id,organization_id,display_name,current_version_id,created_by) values($1,$2,'Approval reviewer',$3,$4)",[roleId,root,id,actor.userId]);
   await manager.query("insert into app_identity.role_version(id,organization_id,role_id,version,display_name,created_by) values($1,$2,$3,$4,'Approval reviewer',$5)",[id,root,roleId,revision,actor.userId]);
   await manager.query('insert into app_identity.role_version_capability(organization_id,role_id,role_version_id,capability_key) select $1,$2,$3,unnest($4::text[])',[root,roleId,id,capabilities]);
   await manager.query('update app_identity.role set current_version_id=$2 where id=$1',[roleId,id]);
  };
  await ownerDb.transaction(async manager=>{await writeRole(manager,1,versionId,caps);await manager.query('insert into app_identity.user_role_assignment(organization_id,user_id,role_id,assigned_by) values($1,$2,$3,$4)',[root,limited.userId,roleId,actor.userId]);});
  const limitedSession=await sessions.create({username:'limited',password});await sessions.switchAgency(limitedSession.sessionToken,child);await sessions.reauthenticate(limitedSession.sessionToken,limitedSession.session.csrfToken,password);
  const pausedRequest=(await record('ReviewerAuthorityRace')).requestId,countBeforePaused=(await ownerDb.query('select count(*)::int count from app_identity.app_user'))[0].count;
  const blocker=ownerDb.createQueryRunner();await blocker.connect();await blocker.startTransaction();await blocker.query('select id from app_identity.role where id=$1 for update',[roleId]);
  const pending=identities.approve(limitedSession.sessionToken,pausedRequest,command).then(value=>({value}),error=>({error}));
  let waiting=false;for(let attempt=0;attempt<100;attempt++){const [row]=await ownerDb.query("select exists(select 1 from pg_stat_activity where application_name='new-regional-user-regression' and wait_event_type='Lock' and query like '%for share of r%') waiting");if(row.waiting){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
  await writeRole(blocker,2,randomUUID(),caps.filter(capability=>capability!=='roles:assign'));await blocker.commitTransaction();await blocker.release();assert(waiting,'approval holds reviewer roles through final authority check');assert([401,403].includes((await pending).error?.getStatus?.()),"withdrawn reviewer authority denies approval");
  assert.equal((await ownerDb.query('select count(*)::int count from app_identity.app_user'))[0].count,countBeforePaused);assert.equal((await ownerDb.query('select linked_user_id from app_identity.regional_identity_request where id=$1',[pausedRequest]))[0].linked_user_id,null);
  // An unassigned desired role can gain administrative permissions while an
  // approval/provision/replace operation waits. Read its new definition only
  // after acquiring the row lock, then deny grants the reviewer cannot make.
  await ownerDb.transaction(manager=>writeRole(manager,3,randomUUID(),caps));
  const reviewer=await sessions.create({username:'limited',password});await sessions.reauthenticate(reviewer.sessionToken,reviewer.session.csrfToken,password);
  const desiredRole=randomUUID();let desiredRevision=0;
  const writeDesired=async(manager,capabilities)=>{
   const definitionId=randomUUID();desiredRevision++;
   if(desiredRevision===1)await manager.query("insert into app_identity.role(id,organization_id,display_name,current_version_id,created_by) values($1,$2,'Desired onboarding role',$3,$4)",[desiredRole,root,definitionId,actor.userId]);
   await manager.query("insert into app_identity.role_version(id,organization_id,role_id,version,display_name,created_by) values($1,$2,$3,$4,'Desired onboarding role',$5)",[definitionId,root,desiredRole,desiredRevision,actor.userId]);
   await manager.query('insert into app_identity.role_version_capability(organization_id,role_id,role_version_id,capability_key) select $1,$2,$3,unnest($4::text[])',[root,desiredRole,definitionId,capabilities]);
   await manager.query('update app_identity.role set current_version_id=$2 where id=$1',[desiredRole,definitionId]);
  };
  for(const operation of ['regional approval','local provisioning','existing role replacement']){
   await ownerDb.transaction(manager=>writeDesired(manager,['clinical:document']));
   const approvalRequest=(await record('DesiredRoleRace-'+operation)).requestId;
   const existing=(await reads.users(token,{search:'renamed local.child',state:'all'})).items[0];
   assert.equal(existing.id,local.userId);
   const before=await ownerDb.query('select id,revision from app_identity.app_user order by id'),beforeCredentials=await ownerDb.query('select user_id,username from app_identity.local_credential order by user_id'),beforeAssignments=await ownerDb.query('select * from app_identity.user_role_assignment order by id');
   const roleWriter=ownerDb.createQueryRunner();await roleWriter.connect();await roleWriter.startTransaction();await roleWriter.query('select id from app_identity.role where id=$1 for update',[desiredRole]);
   const change=operation==='regional approval'?identities.approve(reviewer.sessionToken,approvalRequest,{...command,roleIds:[desiredRole]}):operation==='local provisioning'?new UserProvisioningService(db,sessions).provision(reviewer.sessionToken,{username:'desired.role.race',displayName:'Local role race',temporaryPassword:password,roleIds:[desiredRole]}):roles.replace(reviewer.sessionToken,existing.id,{expectedRevision:existing.revision,roleIds:[desiredRole]});
   const paused=change.then(value=>({value}),error=>({error}));let desiredWaiting=false;
   for(let attempt=0;attempt<100;attempt++){const [row]=await ownerDb.query("select exists(select 1 from pg_stat_activity where application_name='new-regional-user-regression' and wait_event_type='Lock' and query like '%for share of role%') waiting");if(row.waiting){desiredWaiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
   await writeDesired(roleWriter,['clinical:document','forms:read']);await roleWriter.commitTransaction();await roleWriter.release();assert(desiredWaiting,operation+' must lock desired role definitions');assert.equal((await paused).error?.getStatus?.(),403,operation+' must evaluate the newly committed stronger permissions');
   assert.deepEqual(await ownerDb.query('select id,revision from app_identity.app_user order by id'),before,operation+' must leave no orphan/partial user');assert.deepEqual(await ownerDb.query('select user_id,username from app_identity.local_credential order by user_id'),beforeCredentials);assert.deepEqual(await ownerDb.query('select * from app_identity.user_role_assignment order by id'),beforeAssignments);assert.equal((await ownerDb.query('select linked_user_id from app_identity.regional_identity_request where id=$1',[approvalRequest]))[0].linked_user_id,null);
  }
  // Unlink contains every session and every provider link while retaining the
  // application user, role assignments, credentials and immutable identity keys.
  const unlinkTarget=await accounts.provision({organizationId:root,username:'unlink.clinician',displayName:'Unlink clinician',role:'clinician',temporaryPassword:password});
  await ownerDb.query('update app_identity.local_credential set must_change_password=false,temporary_password_expires_at=null where user_id=$1',[unlinkTarget.userId]);
  const requestsToUnlink=await Promise.all([record('UnlinkFirst'),record('UnlinkSecond')]);
  for(const identity of requestsToUnlink)await identities.link(token,identity.requestId,{userId:unlinkTarget.userId,providerSource:'active',expectedProviderRevision:1,expectedReviewRevision:1});
  const localSessions=await Promise.all([sessions.create({username:'unlink.clinician',password}),sessions.create({username:'unlink.clinician',password})]);
  const externalToken=randomUUID();
  await ownerDb.query(`insert into app_identity.app_session(id,user_id,organization_id,token_sha256,csrf_sha256,credential_version,created_at,last_activity_at,expires_at,device_label,
    authentication_source,authentication_purpose,personally_authenticated_at,personal_authentication_purpose,oidc_identity_request_id,oidc_group_id,oidc_revision,personal_proof_policy_sha256,encrypted_csrf,personal_identity_request_id,personal_group_id,personal_revision,latest_personal_proof_policy_sha256)
    values($1,$2,$3,$4,$4,null,now(),now(),now()+interval '1 hour','SSO unlink fixture','oidc','login',now(),'login',$5,$6,1,$7,$8::jsonb,$5,$6,1,$7)`,
    [randomUUID(),unlinkTarget.userId,child,hash(externalToken),requestsToUnlink[0].requestId,root,hash('fixture-approved-proof'),JSON.stringify(encryptCredential('fixture-csrf',root,`csrf:${hash(externalToken)}`))]);
  const targetBefore=(await reads.users(token,{state:'active',search:'unlink.clinician'})).items[0];assert.equal(targetBefore.ssoLinked,true);
  const retainedUser=await ownerDb.query('select id,display_name,active from app_identity.app_user where id=$1',[unlinkTarget.userId]);
  const retainedCredentials=await ownerDb.query('select * from app_identity.local_credential where user_id=$1',[unlinkTarget.userId]);
  const retainedAssignments=await ownerDb.query('select * from app_identity.user_role_assignment where user_id=$1',[unlinkTarget.userId]);
  await assert.rejects(db.query(`update app_identity.regional_identity_request set linked_user_id=null,linked_by=null,linked_at=null,denied_at=now(),denied_by=$2,review_revision=review_revision+1 where id=$1`,[requestsToUnlink[0].requestId,actor.userId]),/already linked/);
  await assert.rejects(identities.unlinkUser(foreignSession.sessionToken,unlinkTarget.userId,{expectedRevision:targetBefore.revision}),error=>error.getStatus?.()===403);
  await assert.rejects(identities.unlinkUser(token,actor.userId,{expectedRevision:1}),error=>error.getStatus?.()===403);
  await assert.rejects(identities.unlinkUser(token,unlinkTarget.userId,{expectedRevision:999}),error=>error.getStatus?.()===409);
  const notReauthenticated=await sessions.create({username:'admin',password});
  const limitedUnlink=new ExternalIdentityService(db,{requireCapability:async()=>({organization:{id:child},user:{id:actor.userId},capabilities:['users:read','users:write','settings:read','settings:write']}),requireRecentReauthentication:async()=>{}});
  await assert.rejects(limitedUnlink.unlinkUser('fixture',unlinkTarget.userId,{expectedRevision:targetBefore.revision}),error=>error.getStatus?.()===403);
  assert.equal((await security.list(token,unlinkTarget.userId)).items.length,3);
  // A callback holds the user before locking its identity evidence. Unlink
  // must wait at the user, allowing that callback to finish without a deadlock.
  const callbackWriter=ownerDb.createQueryRunner();await callbackWriter.connect();await callbackWriter.startTransaction();
  let unlinkPromise;
  try{
   await callbackWriter.query('select id from app_identity.app_user where id=$1 for share',[unlinkTarget.userId]);
   unlinkPromise=identities.unlinkUser(notReauthenticated.sessionToken,unlinkTarget.userId,{expectedRevision:targetBefore.revision});
   let waiting=false;
   for(let attempt=0;attempt<100;attempt++){
    const [row]=await ownerDb.query("select exists(select 1 from pg_stat_activity where application_name='new-regional-user-regression' and wait_event_type='Lock' and query like '%for update of u%') waiting");
    if(row.waiting){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
   }
   assert(waiting,'unlink must wait for an in-flight callback user lock');
   await callbackWriter.query("set local lock_timeout='1s'");
   await callbackWriter.query('select id from app_identity.regional_identity_request where id=$1 for update',[requestsToUnlink[0].requestId]);
   await callbackWriter.commitTransaction();
  }finally{if(callbackWriter.isTransactionActive)await callbackWriter.rollbackTransaction();await callbackWriter.release();}
  const unlinked=await unlinkPromise;
  assert.deepEqual(unlinked,{userId:unlinkTarget.userId,unlinked:true,identitiesUnlinked:2,sessionsRevoked:3});
  for(const created of localSessions)await assert.rejects(sessions.getAuthenticated(created.sessionToken),error=>error.getStatus?.()===401);
  await assert.rejects(sessions.getAuthenticated(externalToken),error=>error.getStatus?.()===401);
  assert.equal((await security.list(token,unlinkTarget.userId)).items.length,0);
  for(const subject of ['UnlinkFirst','UnlinkSecond'])assert.equal((await record(subject)).status,'denied');
  const targetAfter=(await reads.users(token,{state:'active',search:'unlink.clinician'})).items[0];assert.equal(targetAfter.ssoLinked,false);assert.equal(targetAfter.revision,targetBefore.revision+1);
  assert.deepEqual(await ownerDb.query('select id,display_name,active from app_identity.app_user where id=$1',[unlinkTarget.userId]),retainedUser);
  assert.deepEqual(await ownerDb.query('select * from app_identity.local_credential where user_id=$1',[unlinkTarget.userId]),retainedCredentials);
  assert.deepEqual(await ownerDb.query('select * from app_identity.user_role_assignment where user_id=$1',[unlinkTarget.userId]),retainedAssignments);
  await assert.rejects(identities.link(token,requestsToUnlink[0].requestId,{userId:unlinkTarget.userId,providerSource:'active',expectedProviderRevision:1,expectedReviewRevision:2}),error=>error.getStatus?.()===409);
  await identities.link(token,requestsToUnlink[0].requestId,{userId:unlinkTarget.userId,providerSource:'active',expectedProviderRevision:1,expectedReviewRevision:3});
  await assert.rejects(sessions.getAuthenticated(externalToken),error=>error.getStatus?.()===401);
  const unlinkAudit=await ownerDb.query("select details from app_identity.authentication_event where target_user_id=$1 and details->>'operation'='unlinked'",[unlinkTarget.userId]);
  assert.equal(unlinkAudit.length,1);assert.equal(unlinkAudit[0].details.sessionsRevoked,3);assert.doesNotMatch(JSON.stringify(unlinkAudit),/UnlinkFirst|UnlinkSecond|provider.example/);
  const audit=await ownerDb.query("select details from app_identity.authentication_event where target_user_id=$1 and action='account.provision'",[userId]);assert.equal(audit.length,1);assert.doesNotMatch(JSON.stringify(audit),/NewExactSubject|same@example|provider.example|password/i);
 }finally{if(previousKeys===undefined)delete process.env.OIDC_CREDENTIAL_KEYS_JSON;else process.env.OIDC_CREDENTIAL_KEYS_JSON=previousKeys;if(db.isInitialized)await db.destroy();if(ownerDb.isInitialized)await ownerDb.destroy();await migrate.end().catch(()=>{});await admin.query(`drop database ${name}`);await admin.end();}
});
