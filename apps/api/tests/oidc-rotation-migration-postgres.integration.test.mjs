import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {readMigrations,applyMigrations} from '../../../packages/database/scripts/migrate.mjs';
const integration=process.env.DATABASE_URL?test:test.skip;
if(process.env.REQUIRE_DATABASE_INTEGRATION&&!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
integration('active discovery migration adopts activation-era tested metadata and rejects ambiguous or post-activation diagnostics without rewriting identity/configuration',async()=>{
 const name=`rotation_migration_${randomUUID().replaceAll('-','')}`,admin=new pg.Client({connectionString:process.env.DATABASE_URL});await admin.connect();await admin.query(`create database ${name}`);
 const url=new URL(process.env.DATABASE_URL);url.pathname=`/${name}`;const db=new pg.Client({connectionString:url.toString()});
 try{
  await db.connect();const migrations=await readMigrations(fileURLToPath(new URL('../../../supabase/migrations',import.meta.url)));
  const target=migrations.find(m=>m.name==='bind_sensitive_proof_to_active_provider_integration');assert(target);
  await applyMigrations(db,migrations.filter(m=>m.version!==target.version),{info(){}});
  const actor=randomUUID(),groups=Array.from({length:5},()=>randomUUID()),provider=randomUUID();
  for(const [index,group] of groups.entries())await db.query('insert into app_identity.organization(id,name,deployment_timezone) values($1,$2,\'UTC\')',[group,`Migration group ${index}`]);
  await db.query("insert into app_identity.app_user(id,organization_id,display_name) values($1,$2,'Preserved migration actor')",[actor,groups[0]]);
  const metadata={issuer:'https://controlled-migration.example',authorization_endpoint:'https://controlled-migration.example/authorize',token_endpoint:'https://controlled-migration.example/token',jwks_uri:'https://controlled-migration.example/jwks',pkceS256:true};
  const activated=new Date(Date.now()-60000),tested=new Date(activated.getTime()-10000),later=new Date(activated.getTime()+10000);
  for(const [index,group] of groups.entries()){
   const current=index===1?{...metadata,token_endpoint:'https://controlled-migration.example/untested'}:metadata;
   await db.query("insert into app_identity.oidc_provider_version(group_id,revision,provider_id,configuration,encrypted_credential,discovery,discovery_health,created_by) values($1,1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7)",[group,provider,JSON.stringify({name:'Preserved version',issuer:metadata.issuer,clientId:'fixture-client'}),JSON.stringify({fixture:'preserved-envelope'}),JSON.stringify(current),index===4?'failed':'healthy',actor]);
   await db.query('insert into app_identity.oidc_provider_state(group_id,draft_revision,active_revision) values($1,1,1)',[group]);
   await db.query("update app_identity.group_authentication_policy set mode='oidc' where group_id=$1",[group]);
   await db.query("insert into app_identity.oidc_test_transaction(state_sha256,correlation_sha256,group_id,revision,organization_id,actor_id,origin,action,return_path,encrypted_binding,expires_at,result,completed_at,pkce_s256,tested_discovery) values($1,$2,$3,1,$3,$4,'https://agency.fixture.example','draft_test','/','{}',clock_timestamp()+interval '5 minutes','succeeded',$5,true,$6::jsonb)",[randomBytes(32).toString('hex'),randomBytes(32).toString('hex'),group,actor,index===3?later:tested,JSON.stringify(metadata)]);
   if(index!==2)await db.query("insert into app_identity.authentication_event(organization_id,actor_id,action,result,details,occurred_at) values($1,$2,'authentication.policy_update','succeeded','{\"kind\":\"oidc\",\"operation\":\"activate\",\"revision\":1}',$3)",[group,actor,activated]);
  }
  const before=(await db.query('select group_id,revision,provider_id,configuration,encrypted_credential,created_by from app_identity.oidc_provider_version order by group_id')).rows;
  await applyMigrations(db,migrations,{info(){}});
  const states=(await db.query('select group_id,active_revision,active_discovery from app_identity.oidc_provider_state')).rows;
  for(const [index,group] of groups.entries()){const state=states.find(s=>s.group_id===group);assert.equal(state.active_revision,'1');assert.deepEqual(state.active_discovery,index===0||index===4?metadata:null);}
  assert.deepEqual((await db.query('select group_id,revision,provider_id,configuration,encrypted_credential,created_by from app_identity.oidc_provider_version order by group_id')).rows,before);
  assert.equal((await db.query('select display_name from app_identity.app_user where id=$1',[actor])).rows[0].display_name,'Preserved migration actor');
  assert.equal((await db.query("select has_function_privilege('public','app_identity.session_proof_matches_policy(app_identity.app_session)','EXECUTE') allowed")).rows[0].allowed,false);
 }finally{await db.end();await admin.query(`drop database ${name} with(force)`);await admin.end();}
});
