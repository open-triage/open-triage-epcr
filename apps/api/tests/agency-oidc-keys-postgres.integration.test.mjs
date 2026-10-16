import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';
import {generateAgencyKey,encryptAgencyCredential,decryptAgencyCredential} from '../dist/authentication/agency-oidc-keys.js';
import {encryptCredential} from '../dist/authentication/oidc-credentials.js';
import {ProductionWorkflowService} from '../dist/authentication/production-workflow.service.js';
import {UnitsService} from '../dist/admin/units.service.js';
const integration=process.env.DATABASE_URL?test:test.skip;
if(process.env.REQUIRE_DATABASE_INTEGRATION&&!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
integration('agency keys isolate groups and authenticated contexts, preserve legacy and rotated envelopes, and never grant browser access',async()=>{
 const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();await db.query('begin');
 const previous=process.env.OIDC_CREDENTIAL_KEYS_JSON;
 try{
  process.env.OIDC_CREDENTIAL_KEYS_JSON=JSON.stringify({'1':randomBytes(32).toString('base64')});
  const query=async(sql,args)=>(await db.query(sql,args)).rows,manager={query};
  const [{id:actor}]=await query('select id from app_identity.app_user limit 1');
  const group=randomUUID(),other=randomUUID();
  for(const id of [group,other])await query("insert into app_identity.organization(id,name,deployment_timezone) values($1,'OIDC key test','UTC')",[id]);
  await db.query('set local role open_triage_api_runtime');
  const legacy=encryptCredential('legacy secret',group,'provider');
  assert.equal(await decryptAgencyCredential(manager,legacy,group,'provider'),'legacy secret');
  assert.equal(await generateAgencyKey(manager,group,actor),1);
  assert.equal(await generateAgencyKey(manager,other,actor),1);
  const envelopes=[];
  for(const context of ['provider','test:state','personal:state','csrf:session']){
   const envelope=await encryptAgencyCredential(manager,'context secret',group,context);envelopes.push([context,envelope]);
   assert.equal(envelope.keyScope,'agency');assert.equal(await decryptAgencyCredential(manager,envelope,group,context),'context secret');
   await assert.rejects(decryptAgencyCredential(manager,envelope,other,context));
   await assert.rejects(decryptAgencyCredential(manager,envelope,group,'wrong-context'));
   await assert.rejects(decryptAgencyCredential(manager,{...envelope,tag:randomBytes(16).toString('base64')},group,context));
  }
  await assert.rejects(generateAgencyKey(manager,group,actor,true,0),/version changed/);
  assert.equal(await generateAgencyKey(manager,group,actor,true,1),2);
  assert.equal((await encryptAgencyCredential(manager,'new secret',group,'provider')).version,'2');
  for(const [context,envelope] of envelopes)assert.equal(await decryptAgencyCredential(manager,envelope,group,context),'context secret');
  assert.equal(await decryptAgencyCredential(manager,legacy,group,'provider'),'legacy secret');
  const [rights]=await query("select has_table_privilege('anon','app_identity.oidc_credential_key','SELECT') anon,has_table_privilege('authenticated','app_identity.oidc_credential_key','SELECT') browser,has_table_privilege('open_triage_api_runtime','app_identity.oidc_credential_key','UPDATE') overwrite,has_table_privilege('open_triage_api_runtime','app_identity.oidc_credential_key','DELETE') retire");
  assert.deepEqual(rights,{anon:false,browser:false,overwrite:false,retire:false});
 }finally{if(previous===undefined)delete process.env.OIDC_CREDENTIAL_KEYS_JSON;else process.env.OIDC_CREDENTIAL_KEYS_JSON=previous;await db.query('rollback');await db.end();}
});
integration('workflow enables automatically only after live schedule and enrollment readiness, and remains enabled after withdrawal',async()=>{
 const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();await db.query('begin');
 try{
  const query=async(sql,args)=>(await db.query(sql,args)).rows,manager={query};
  const group=randomUUID(),unit=randomUUID(),schedule=randomUUID(),identity=randomUUID(),registration=randomUUID();
  const [{id:actor}]=await query('select id from app_identity.app_user limit 1');
  await query("insert into app_identity.organization(id,name,deployment_timezone) values($1,'Automatic readiness test','UTC')",[group]);
  await query("insert into app_identity.operational_unit(id,organization_id,name,call_sign) values($1,$2,'Medic','AUTO-1')",[unit,group]);
  const database={manager,query,transaction:async work=>work(manager)};
  const workflow=new ProductionWorkflowService(database,{});
  // Isolate the worker's scan to this transaction's test group.
  const scan=query;manager.query=async(sql,args)=>sql.includes('limit 50 for update skip locked')?[{group_id:group}]:scan(sql,args);
  const units=new UnitsService(database,{requireCapability:async()=>({organization:{id:group}})});
  assert.deepEqual((await units.list('token')).items.map(u=>[u.scheduleSelected,u.enrolled]),[[false,false]]);
  await workflow.automaticallyEnable();assert.equal((await query('select enabled_at from app_identity.production_workflow_rollout where group_id=$1',[group]))[0].enabled_at,null);
  await query("insert into app_identity.weekly_schedule(id,group_id,name) values($1,$2,'Shifts')",[schedule,group]);
  await query('insert into app_identity.unit_schedule_selection(organization_id,unit_id,revision,schedule_id,effective_at,actor_id) values($1,$2,1,$3,clock_timestamp(),$4)',[group,unit,schedule,actor]);
  await workflow.automaticallyEnable();assert.equal((await query('select enabled_at from app_identity.production_workflow_rollout where group_id=$1',[group]))[0].enabled_at,null);
  await query('insert into app_identity.installation_identity(id) values($1)',[identity]);
  await query("insert into app_identity.installation_registration(id,installation_identity_id,organization_id,unit_id,name,credential_sha256) values($1,$2,$3,$4,'Fictional device',$5)",[registration,identity,group,unit,randomBytes(32).toString('hex')]);
  assert.deepEqual((await units.list('token')).items.map(u=>[u.scheduleSelected,u.enrolled]),[[true,true]]);
  await query("update app_identity.group_authentication_policy set mode='oidc' where group_id=$1",[group]);
  await workflow.automaticallyEnable();assert.equal((await query('select enabled_at from app_identity.production_workflow_rollout where group_id=$1',[group]))[0].enabled_at,null);
  await query("update app_identity.group_authentication_policy set mode='local' where group_id=$1",[group]);
  await workflow.automaticallyEnable();const [enabled]=await query('select enabled_at,revision,enabled_by from app_identity.production_workflow_rollout where group_id=$1',[group]);assert(enabled.enabled_at);assert.equal(enabled.enabled_by,null);
  await query('update app_identity.installation_registration set revoked_at=clock_timestamp() where id=$1',[registration]);
  await query('insert into app_identity.unit_schedule_selection(organization_id,unit_id,revision,schedule_id,effective_at,actor_id) values($1,$2,2,null,clock_timestamp(),$3)',[group,unit,actor]);
  await workflow.automaticallyEnable();assert.deepEqual((await query('select enabled_at,revision,enabled_by from app_identity.production_workflow_rollout where group_id=$1',[group]))[0],enabled);
  assert.deepEqual((await units.list('token')).items.map(u=>[u.scheduleSelected,u.enrolled]),[[false,false]]);
 }finally{await db.query('rollback');await db.end();}
});
integration('managed proof changes invalidate sensitive-action proof while credential-only revisions retain it',async()=>{
 const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();await db.query('begin');
 try{
  const query=async(sql,args)=>(await db.query(sql,args)).rows;
  const group=randomUUID(),user=randomUUID(),provider=randomUUID(),identity=randomUUID();
  const [{id:actor}]=await query('select id from app_identity.app_user limit 1');
  await query("insert into app_identity.organization(id,name,deployment_timezone) values($1,'Managed proof test','UTC')",[group]);
  await query("insert into app_identity.app_user(id,organization_id,display_name) values($1,$2,'Ordinary test user')",[user,group]);
  const config={issuer:'https://provider.example.org',clientId:'reviewed-client',personalProof:{id:'managed-contract',acr:null,requiredAmr:['pwd']}};
  for(const [revision,requirements] of [[1,config.personalProof],[2,config.personalProof],[3,{...config.personalProof,requiredAmr:['otp','pwd']}]])await query('insert into app_identity.oidc_provider_version(group_id,revision,provider_id,configuration,created_by) values($1,$2,$3,$4::jsonb,$5)',[group,revision,provider,JSON.stringify({...config,personalProof:requirements}),actor]);
  await query('insert into app_identity.oidc_provider_state(group_id,draft_revision,active_revision) values($1,3,2)',[group]);
  await query("update app_identity.group_authentication_policy set mode='oidc' where group_id=$1",[group]);
  await query("insert into app_identity.regional_identity_request(id,group_id,provider_id,first_revision,organization_id,issuer,subject,linked_user_id,linked_by,linked_at) values($1,$2,$3,1,$2,$4,'fictional-subject',$5,$6,clock_timestamp())",[identity,group,provider,config.issuer,user,actor]);
  const candidate={user_id:user,organization_id:group,authentication_source:'oidc',personal_group_id:group,personal_revision:1,personal_identity_request_id:identity};
  const matches=async()=> (await query('select app_identity.session_proof_matches_policy(jsonb_populate_record(null::app_identity.app_session,$1::jsonb)) matches',[JSON.stringify(candidate)]))[0].matches;
  assert.equal(await matches(),true);
  await query('update app_identity.oidc_provider_state set active_revision=3 where group_id=$1',[group]);assert.equal(await matches(),false);
  candidate.personal_revision=3;assert.equal(await matches(),true);
 }finally{await db.query('rollback');await db.end();}
});
