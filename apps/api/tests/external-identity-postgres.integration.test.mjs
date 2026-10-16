import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {DataSource} from 'typeorm';
import {readMigrations,applyMigrations} from '../../../packages/database/scripts/migrate.mjs';
import {AccountService} from '../dist/identity/account.service.js';
import {ClinicianSessionService} from '../dist/sessions/clinician-session.service.js';
import {ExternalIdentityService} from '../dist/authentication/external-identity.service.js';
const integration=process.env.DATABASE_URL?test:test.skip;
if(process.env.REQUIRE_DATABASE_INTEGRATION&&!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
integration('regional approval uses real runtime TypeORM, enforces identity scopes and races, and preserves existing user history',async()=>{
 const name=`identity_${randomUUID().replaceAll('-','')}`,admin=new pg.Client({connectionString:process.env.DATABASE_URL});await admin.connect();await admin.query(`create database ${name}`);
 const url=new URL(process.env.DATABASE_URL);url.pathname=`/${name}`;
 const ownerDb=new DataSource({type:'postgres',url:url.toString()}),db=new DataSource({type:'postgres',url:url.toString(),extra:{options:'-c role=open_triage_api_runtime',application_name:'regional-approval-regression'}});
 const migrate=new pg.Client({connectionString:url.toString()});
 try{
  await migrate.connect();await applyMigrations(migrate,await readMigrations(fileURLToPath(new URL('../../../supabase/migrations',import.meta.url))),{info(){}});await migrate.end();await ownerDb.initialize();await db.initialize();
  const root=randomUUID(),child=randomUUID(),foreign=randomUUID();
  await ownerDb.query("insert into app_identity.organization(id,name,deployment_timezone) values($1,'Regional','UTC'),($2,'Foreign','UTC')",[root,foreign]);
  await ownerDb.query("insert into app_identity.organization(id,name,parent_organization_id,deployment_timezone) values($1,'Child',$2,'UTC')",[child,root]);
  const accounts=new AccountService(ownerDb),password='Personal password 42!';
  const installation=await accounts.bootstrapOwner({username:'owner',displayName:'Recovery owner',temporaryPassword:password,operator:{operatorId:'test',osAccount:'test',host:'test'}});
  const actor=await accounts.provision({organizationId:root,username:'admin',displayName:'Admin',role:'administrator',temporaryPassword:password});
  const medic=await accounts.provision({organizationId:root,username:'medic',displayName:'Medic',role:'clinician',temporaryPassword:password});
  const sibling=await accounts.provision({organizationId:root,username:'sibling',displayName:'Second medic',role:'clinician',temporaryPassword:password});
  const other=await accounts.provision({organizationId:foreign,username:'foreign',displayName:'Foreign admin',role:'administrator',temporaryPassword:password});
  await ownerDb.query('update app_identity.local_credential set must_change_password=false,temporary_password_expires_at=null');
  const sessions=new ClinicianSessionService(db),service=new ExternalIdentityService(db,sessions),signed=await sessions.create({username:'admin',password}),foreignSession=await sessions.create({username:'foreign',password}),clinical=await sessions.create({username:'medic',password});
  const provider=randomUUID(),issuer='https://provider.example/Issuer';
  const version=async(group,providerId,revision,iss=issuer)=>{await ownerDb.query('insert into app_identity.oidc_provider_version(group_id,revision,provider_id,configuration,created_by) values($1,$2,$3,$4::jsonb,$5)',[group,revision,providerId,JSON.stringify({issuer:iss}),actor.userId]);await ownerDb.query('insert into app_identity.oidc_provider_state(group_id,draft_revision) values($1,$2) on conflict(group_id) do update set draft_revision=$2',[group,revision]);};
  await version(root,provider,1);await version(foreign,provider,1);
  const scope={groupId:root,providerId:provider,revision:1,organizationId:child},identity={issuer,subject:'CaseSensitive',displayName:'Medic',email:'same@example.org'};
  const record=(s=scope,i=identity)=>db.transaction(manager=>service.record(manager,s,i));
  // Real pre-existing report authorship and append-only clinical change history.
  const catalog=randomUUID(),demographics=randomUUID(),form=randomUUID(),formVersion=randomUUID(),incident=randomUUID(),patient=randomUUID(),report=randomUUID();
  await ownerDb.query("insert into catalog.release(id,standard,version,dataset,artifact_schema_version,artifact_sha256,provenance) values($1,'fixture','1','identity-review','1',$2,'{}')",[catalog,'a'.repeat(64)]);
  await ownerDb.query("insert into app_identity.agency_demographic_version(id,organization_id,catalog_release_id,version,dagency_01,dagency_02,dagency_04,definition_sha256,effective_from,created_by) values($1,$2,$3,1,'Fictional','Fictional','Fictional',$4,now(),$5)",[demographics,root,catalog,'b'.repeat(64),actor.userId]);
  await ownerDb.query("insert into forms.form(id,organization_id,slug,name) values($1,$2,'identity-history','Fictional historical form')",[form,root]);
  await ownerDb.query("insert into forms.form_version(id,form_id,catalog_release_id,version,canonical_definition,definition_sha256,created_by,status,published_at,published_by,change_note) values($1,$2,$3,1,'{\"schemaVersion\":1,\"sections\":[]}',$4,$5,'published',now(),$5,'Fictional historical publication')",[formVersion,form,catalog,'c'.repeat(64),actor.userId]);
  await ownerDb.query("insert into clinical.incident(id,organization_id) values($1,$2)",[incident,root]);
  await ownerDb.query("insert into clinical.patient(id,organization_id,identity_state,pseudonymous_key) values($1,$2,'unknown',$3)",[patient,root,'d'.repeat(64)]);
  await ownerDb.query('insert into clinical.report(id,organization_id,incident_id,patient_id,agency_demographic_version_id,form_version_id,catalog_release_id,documenting_user_id,revision) values($1,$2,$3,$4,$5,$6,$7,$8,1)',[report,root,incident,patient,demographics,formVersion,catalog,medic.userId]);
  await ownerDb.query("insert into clinical.report_change(report_id,revision,idempotency_key,author_id,changes) values($1,1,$2,$3,'[]')",[report,randomUUID(),medic.userId]);
  const beforeReports=await ownerDb.query('select * from clinical.report order by id'),beforeChanges=await ownerDb.query('select * from clinical.report_change order by id');
  const beforeUsers=await ownerDb.query('select id,display_name,active,revision from app_identity.app_user order by id'),beforeRoles=await ownerDb.query('select * from app_identity.user_role_assignment order by id'),beforeSessions=await ownerDb.query('select id,user_id from app_identity.app_session order by id'),beforeAudit=await ownerDb.query("select id,actor_id,target_user_id,action from app_identity.authentication_event order by id");
  const requests=await Promise.all(Array.from({length:12},()=>record()));assert.equal(new Set(requests.map(row=>row.requestId)).size,1);assert(requests.every(row=>row.status==='pending'&&row.ordinaryAccess===false));
  const requestId=requests[0].requestId;
  assert.deepEqual(await ownerDb.query('select id,user_id from app_identity.app_session order by id'),beforeSessions);
  await assert.rejects(service.list(clinical.sessionToken,{}));await assert.rejects(service.link(signed.sessionToken,requestId,{userId:medic.userId,providerSource:"draft",expectedProviderRevision:1}),/reauthentication/);
  assert.equal((await service.list(foreignSession.sessionToken,{})).items.length,0);
  await sessions.reauthenticate(signed.sessionToken,signed.session.csrfToken,password);
  await assert.rejects(service.link(signed.sessionToken,requestId,{userId:other.userId,providerSource:"draft",expectedProviderRevision:1}),error=>error.getStatus?.()===403);
  await assert.rejects(service.link(signed.sessionToken,requestId,{userId:installation.userId,providerSource:"draft",expectedProviderRevision:1}),error=>error.getStatus?.()===403);
  // Matching profile names/emails do not identify an application user.
  assert.equal((await service.list(signed.sessionToken,{})).items[0].linkedUserId,null);
  const competing=await Promise.allSettled([service.link(signed.sessionToken,requestId,{userId:medic.userId,providerSource:"draft",expectedProviderRevision:1}),service.link(signed.sessionToken,requestId,{userId:sibling.userId,providerSource:"draft",expectedProviderRevision:1})]);
  assert.equal(competing.filter(row=>row.status==='fulfilled').length,1);assert.equal(competing.filter(row=>row.status==='rejected'&&row.reason.getStatus?.()===409).length,1);
  const linked=competing.find(row=>row.status==='fulfilled').value;
  assert.equal((await record()).status,'linked');assert.deepEqual(await service.link(signed.sessionToken,requestId,{userId:linked.linkedUserId,providerSource:"draft",expectedProviderRevision:1}),linked);
  assert.deepEqual(await ownerDb.query('select id,display_name,active,revision from app_identity.app_user order by id'),beforeUsers);assert.deepEqual(await ownerDb.query('select * from app_identity.user_role_assignment order by id'),beforeRoles);
  assert.deepEqual(await ownerDb.query('select id,actor_id,target_user_id,action from app_identity.authentication_event where id=any($1::bigint[]) order by id',[beforeAudit.map(row=>row.id)]),beforeAudit);
  assert.deepEqual(await ownerDb.query('select * from clinical.report order by id'),beforeReports);assert.deepEqual(await ownerDb.query('select * from clinical.report_change order by id'),beforeChanges);
  const collision=await record(scope,{...identity,subject:'casesensitive'});assert.notEqual(collision.requestId,requestId);
  const otherGroup=await record({...scope,groupId:foreign,organizationId:foreign},identity);assert.notEqual(otherGroup.requestId,requestId);
  const newProvider=randomUUID();await version(root,newProvider,2,'https://provider.example/issuer');
  const changed=await record({...scope,providerId:newProvider,revision:2},{...identity,issuer:'https://provider.example/issuer'});assert.notEqual(changed.requestId,requestId);
  await ownerDb.query('update app_identity.oidc_provider_state set active_revision=1 where group_id=$1',[root]);
  const activePending=await record(scope,{...identity,subject:'active-while-unrelated-draft-is-edited'});
  const activeView=(await service.list(signed.sessionToken,{})).items.find(item=>item.id===activePending.requestId);assert.deepEqual(activeView.reviewProviders,[{source:'active',revision:1}]);
  await assert.rejects(service.link(signed.sessionToken,activePending.requestId,{userId:medic.userId,providerSource:'active',expectedProviderRevision:2}),error=>error.getStatus?.()===409);
  await assert.rejects(service.link(signed.sessionToken,activePending.requestId,{userId:medic.userId,providerSource:'draft',expectedProviderRevision:2}),error=>error.getStatus?.()===409);
  assert.equal((await service.link(signed.sessionToken,activePending.requestId,{userId:medic.userId,providerSource:'active',expectedProviderRevision:1})).linkedUserId,medic.userId);
  await assert.rejects(service.link(signed.sessionToken,collision.requestId,{userId:medic.userId,providerSource:"draft",expectedProviderRevision:2}),error=>error.getStatus?.()===409);
  assert.equal((await ownerDb.query('select issuer,subject,linked_user_id from app_identity.regional_identity_request where id=$1',[requestId]))[0].linked_user_id,linked.linkedUserId);
  await assert.rejects(db.query('update app_identity.regional_identity_request set subject=$2 where id=$1',[requestId,'reinterpreted']),/permission denied/);
  await assert.rejects(db.query('delete from app_identity.regional_identity_request where id=$1',[requestId]),/permission denied/);
  await assert.rejects(db.query('update app_identity.regional_identity_request set linked_user_id=$2 where id=$1',[requestId,other.userId]),/already linked/);
  await assert.rejects(record({...scope,providerId:newProvider,revision:2},identity),/scope is invalid/);
  await assert.rejects(ownerDb.transaction(manager=>manager.query('insert into app_identity.regional_identity_request(group_id,provider_id,first_revision,organization_id,issuer,subject,linked_user_id,linked_by,linked_at) values($1,$2,2,$1,$3,$4,$5,$6,now())',[root,newProvider,'https://provider.example/issuer','protected',installation.userId,actor.userId])),/ordinary active group user/);
  // Disablement commits while approval waits on the target row. Approval must
  // use the new eligibility after locking, not the earlier directory result.
  const blocker=await ownerDb.createQueryRunner();await blocker.connect();await blocker.startTransaction();
  await blocker.query('select id from app_identity.app_user where id=$1 for update',[sibling.userId]);
  const pending=service.link(signed.sessionToken,changed.requestId,{userId:sibling.userId,providerSource:"draft",expectedProviderRevision:2});
  await blocker.query('update app_identity.app_user set active=false where id=$1',[sibling.userId]);await blocker.commitTransaction();await blocker.release();
  await assert.rejects(pending,error=>error.getStatus?.()===403);
  await ownerDb.query('update app_identity.app_user set active=true where id=$1',[sibling.userId]);
  const custom=randomUUID(),roleV1=randomUUID(),roleV2=randomUUID();
  await ownerDb.transaction(async manager=>{
   await manager.query("insert into app_identity.role(id,organization_id,display_name,current_version_id,created_by) values($1,$2,'Fixture editable role',$3,$4)",[custom,root,roleV1,actor.userId]);
   await manager.query("insert into app_identity.role_version(id,organization_id,role_id,version,display_name,created_by) values($1,$2,$3,1,'Fixture editable role',$4)",[roleV1,root,custom,actor.userId]);
   await manager.query("insert into app_identity.role_version_capability(organization_id,role_id,role_version_id,capability_key) values($1,$2,$3,'clinical:document')",[root,custom,roleV1]);
   await manager.query('insert into app_identity.user_role_assignment(organization_id,user_id,role_id,assigned_by) values($1,$2,$3,$4)',[root,sibling.userId,custom,actor.userId]);
  });
  const limitedAccount=await accounts.provision({organizationId:root,username:'limited',displayName:'Limited identity reviewer',role:'clinician',temporaryPassword:password});
  await ownerDb.query('update app_identity.local_credential set must_change_password=false,temporary_password_expires_at=null where user_id=$1',[limitedAccount.userId]);
  const limitedRole=randomUUID(),limitedVersion=randomUUID();
  await ownerDb.transaction(async manager=>{
   await manager.query("insert into app_identity.role(id,organization_id,display_name,current_version_id,created_by) values($1,$2,'Limited identity review',$3,$4)",[limitedRole,root,limitedVersion,actor.userId]);
   await manager.query("insert into app_identity.role_version(id,organization_id,role_id,version,display_name,created_by) values($1,$2,$3,1,'Limited identity review',$4)",[limitedVersion,root,limitedRole,actor.userId]);
   await manager.query('insert into app_identity.role_version_capability(organization_id,role_id,role_version_id,capability_key) select $1,$2,$3,unnest($4::text[])',[root,limitedRole,limitedVersion,['users:read','users:write','settings:read','settings:write']]);
   await manager.query('insert into app_identity.user_role_assignment(organization_id,user_id,role_id,assigned_by) values($1,$2,$3,$4)',[root,limitedAccount.userId,limitedRole,actor.userId]);
  });
  const limitedSigned=await sessions.create({username:'limited',password});await sessions.reauthenticate(limitedSigned.sessionToken,limitedSigned.session.csrfToken,password);
  const roleBlocker=ownerDb.createQueryRunner();await roleBlocker.connect();await roleBlocker.startTransaction();
  await roleBlocker.query('select id from app_identity.role where id=$1 for update',[custom]);
  const roleRace=service.link(limitedSigned.sessionToken,changed.requestId,{userId:sibling.userId,providerSource:"draft",expectedProviderRevision:2}).then(value=>({value}),error=>({error}));
  let waiting=false;for(let attempt=0;attempt<100;attempt++){
   const [row]=await ownerDb.query("select exists(select 1 from pg_stat_activity where application_name='regional-approval-regression' and wait_event_type='Lock' and query like '%for share of r%') waiting");
   if(row.waiting){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
  }

  await roleBlocker.query("insert into app_identity.role_version(id,organization_id,role_id,version,display_name,created_by) values($1,$2,$3,2,'Fixture stronger role',$4)",[roleV2,root,custom,actor.userId]);
  await roleBlocker.query("insert into app_identity.role_version_capability(organization_id,role_id,role_version_id,capability_key) values($1,$2,$3,'clinical:document'),($1,$2,$3,'forms:read')",[root,custom,roleV2]);
  await roleBlocker.query("update app_identity.role set current_version_id=$2,display_name='Fixture stronger role' where id=$1",[custom,roleV2]);await roleBlocker.commitTransaction();await roleBlocker.release();
  assert(waiting,'approval must lock the assigned role against concurrent authoring');
  assert.equal((await roleRace).error?.getStatus?.(),403);
  assert.equal((await ownerDb.query('select linked_user_id from app_identity.regional_identity_request where id=$1',[changed.requestId]))[0].linked_user_id,null);
  // The reviewer can also lose a non-required administrative capability while
  // waiting. Use the post-lock authority, not the initially captured capability set.
  const rewriteRole=async(manager,roleId,versionId,version,name,capabilities)=>{
   await manager.query('insert into app_identity.role_version(id,organization_id,role_id,version,display_name,created_by) values($1,$2,$3,$4,$5,$6)',[versionId,root,roleId,version,name,actor.userId]);
   await manager.query('insert into app_identity.role_version_capability(organization_id,role_id,role_version_id,capability_key) select $1,$2,$3,unnest($4::text[])',[root,roleId,versionId,capabilities]);
   await manager.query('update app_identity.role set current_version_id=$2,display_name=$3 where id=$1',[roleId,versionId,name]);
  };
  const baseReview=['users:read','users:write','settings:read','settings:write'];
  await ownerDb.transaction(manager=>rewriteRole(manager,limitedRole,randomUUID(),2,'Limited identity review',[...baseReview,'forms:read']));
  const currentReviewer=await sessions.create({username:'limited',password});await sessions.reauthenticate(currentReviewer.sessionToken,currentReviewer.session.csrfToken,password);
  const actorRequest=await record({...scope,providerId:newProvider,revision:2},{...identity,issuer:'https://provider.example/issuer',subject:'actor-authority-race'});
  const actorBlocker=ownerDb.createQueryRunner();await actorBlocker.connect();await actorBlocker.startTransaction();await actorBlocker.query('select id from app_identity.role where id=$1 for update',[limitedRole]);
  const actorRace=service.link(currentReviewer.sessionToken,actorRequest.requestId,{userId:sibling.userId,providerSource:"draft",expectedProviderRevision:2}).then(value=>({value}),error=>({error}));
  let actorWaiting=false;for(let attempt=0;attempt<100;attempt++){const [row]=await ownerDb.query("select exists(select 1 from pg_stat_activity where application_name='regional-approval-regression' and wait_event_type='Lock' and query like '%for share of r%') waiting");if(row.waiting){actorWaiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
  await rewriteRole(actorBlocker,limitedRole,randomUUID(),3,'Limited identity review',baseReview);await actorBlocker.commitTransaction();await actorBlocker.release();
  assert(actorWaiting,'approval must lock reviewer roles against concurrent authoring');assert.equal((await actorRace).error?.getStatus?.(),403);
  assert.equal((await ownerDb.query('select linked_user_id from app_identity.regional_identity_request where id=$1',[actorRequest.requestId]))[0].linked_user_id,null);
  const audits=await ownerDb.query("select details,target_user_id from app_identity.authentication_event where details->>'kind'='regional_identity'");assert.equal(audits.length,2);assert(audits.some(event=>event.target_user_id===linked.linkedUserId));assert.doesNotMatch(JSON.stringify(audits),/CaseSensitive|same@example|provider.example/);
  await assert.rejects(db.query('insert into app_identity.regional_identity_request(group_id,provider_id,first_revision,organization_id,issuer,subject,linked_user_id,linked_by,linked_at) values($1,$2,2,$1,$3,$4,$5,$6,now())',[root,newProvider,'https://provider.example/issuer','prelinked',medic.userId,actor.userId]),/permission denied/);
  const privileges=(await ownerDb.query("select has_table_privilege('open_triage_api_runtime','app_identity.regional_identity_request','DELETE') deleted,has_column_privilege('open_triage_api_runtime','app_identity.regional_identity_request','subject','UPDATE') mutated,has_column_privilege('open_triage_api_runtime','app_identity.regional_identity_request','linked_user_id','UPDATE') linked"))[0];assert.deepEqual(privileges,{deleted:false,mutated:false,linked:true});
 }finally{if(db.isInitialized)await db.destroy();if(ownerDb.isInitialized)await ownerDb.destroy();await migrate.end().catch(()=>{});await admin.query(`drop database ${name}`);await admin.end();}
});
