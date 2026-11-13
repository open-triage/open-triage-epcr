import assert from 'node:assert/strict';
import { randomBytes,randomUUID,createHash } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import { DataSource } from 'typeorm';
import { SYNTHETIC_DEMO_FIXTURE } from '@open-triage/contracts';
import { InstallationEnrollmentService } from '../dist/admin/installation-enrollment.service.js';
import { enrollmentAttemptBinding,enrollmentAttemptCredential } from '../dist/admin/enrollment-attempt.js';
import { agencyRequest } from '../dist/sessions/agency-context.js';
const integration=process.env.DATABASE_URL?test:test.skip;
if(process.env.REQUIRE_DATABASE_INTEGRATION&&!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
const secret=()=>randomBytes(32).toString('base64url');
integration('real PostgreSQL enrollment races, replay, expiry, scopes, audit and independent installations',async()=>{
 const db=new DataSource({type:'postgres',url:process.env.DATABASE_URL});await db.initialize();
 const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
 const organizationId=SYNTHETIC_DEMO_FIXTURE.organizationId,userId=randomUUID(),unitId=randomUUID();
 let scope=organizationId,denied=false,originActive=true;
 const sessions={requireCapability:async(_token,capability,manager)=>{
 assert.equal(capability,'settings:write');if(denied)throw new Error('Not authorized');
 if(manager)assert.ok(manager.query);
 return {organization:{id:scope},user:{id:userId}};
 }};
 const service=new InstallationEnrollmentService(db,sessions,{allowsOrigin:async origin=>originActive&&origin==='https://enrollment.example'});
 const at=(origin,work)=>agencyRequest.run({origin},work);
 const run=work=>at('https://enrollment.example',work);
 const input=token=>({token,name:'Ambulance browser',confirmInstallation:true});
 try {
 for(const [table,canUpdate] of [['installation_identity',false],['installation_registration',true],['unit_enrollment',true],['installation_event',false],['group_authentication_policy',true],['operational_unit_event',false]]) {
 const name=`app_identity.${table}`;
 const privileges=await client.query(`select has_table_privilege('open_triage_api_runtime',$1,'SELECT') reading,
 has_table_privilege('open_triage_api_runtime',$1,'INSERT') inserting,has_table_privilege('open_triage_api_runtime',$1,'UPDATE') updating,
 has_table_privilege('open_triage_api_runtime',$1,'DELETE,TRUNCATE,REFERENCES,TRIGGER') excessive`,[name]);
 assert.deepEqual(privileges.rows[0],{reading:true,inserting:true,updating:canUpdate,excessive:false},name);
 const publicPrivileges=await client.query(`select exists(select 1 from pg_class c, lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid=$1::regclass and a.grantee=0) exposed`,[name]);
 assert.equal(publicPrivileges.rows[0].exposed,false,name);
 const publicRoles=await client.query(`select rolname from pg_roles where rolname in ('anon','authenticated')`);
 for(const role of publicRoles.rows)assert.equal((await client.query(`select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') exposed`,[role.rolname,name])).rows[0].exposed,false,name);
 }
 await client.query(`insert into app_identity.app_user(id,organization_id,display_name,synthetic) values($1,$2,'Fictional enrollment administrator',true)`,[userId,organizationId]);
 await client.query(`insert into app_identity.operational_unit(id,organization_id,name,call_sign,active) values($1,$2,'Enrollment test',$3,true)`,[unitId,organizationId,`ENR-${unitId}`]);
 denied=true;await assert.rejects(run(()=>service.issue('session',unitId)),/Not authorized/);denied=false;
 scope=randomUUID();await assert.rejects(run(()=>service.issue('session',unitId)),/Active unit/);await assert.rejects(run(()=>service.inventory('session',unitId)),/not found/);scope=organizationId;
 for(const minutes of [undefined,1,90,1440]){
 const issued=await run(()=>service.issue('session',unitId,minutes===undefined?undefined:{expiresInMinutes:minutes}));
 const {rows:[stored]}=await client.query(`select extract(epoch from (expires_at-issued_at))/60 as lifetime from app_identity.unit_enrollment where token_sha256=$1`,[createHash('sha256').update(issued.token).digest('hex')]);
 assert.ok(Math.abs(Number(stored.lifetime)-(minutes??30))<0.01);
 await run(()=>service.preview({token:issued.token}));
 }
 const code=await run(()=>service.issue('session',unitId));
 originActive=false;
 await assert.rejects(run(()=>service.preview({token:code.token})),/origin required/);
 await assert.rejects(run(()=>service.consume(input(code.token),secret())),/origin required/);
 await assert.rejects(run(()=>service.current(secret())),/origin required/);
 originActive=true;
 const countsBefore=await client.query(`select (select count(*) from app_identity.app_session where user_id=$1) sessions,(select count(*) from app_identity.user_role_assignment where user_id=$1) roles`,[userId]);
 const expiry=await client.query(`select extract(epoch from(expires_at-issued_at)) seconds from app_identity.unit_enrollment where token_sha256=$1`,[createHash('sha256').update(code.token).digest('hex')]);
 assert.ok(Math.abs(Number(expiry.rows[0].seconds)-1800)<1);
 await assert.rejects(at('https://other-group.example',()=>service.consume(input(code.token),secret())),/origin required/);
 await assert.rejects(run(()=>service.consume(input(secret()),secret())),/invalid/);
 const runtimeDb=new DataSource({type:'postgres',url:process.env.DATABASE_URL,extra:{options:'-c role=open_triage_api_runtime'}});
 await runtimeDb.initialize();
 const runtimeService=new InstallationEnrollmentService(runtimeDb,sessions,{allowsOrigin:async()=>originActive});
 const runtimeCode=await run(()=>runtimeService.issue('session',unitId));
 const runtimeEnrollment=await run(()=>runtimeService.consume(input(runtimeCode.token),secret()));
 assert.equal((await run(()=>runtimeService.current(runtimeEnrollment.credential))).id,runtimeEnrollment.installation.id);
 await assert.rejects(runtimeDb.query(`insert into app_identity.installation_registration(id,installation_identity_id,organization_id,unit_id,name,credential_sha256) values($1,$2,$3,$4,'Duplicate live binding',$5)`,[randomUUID(),runtimeEnrollment.installation.installationId,organizationId,unitId,createHash('sha256').update(secret()).digest('hex')]),error=>error.code==='23505');
 await runtimeDb.destroy();
 const attempts=await run(()=>Promise.allSettled(Array.from({length:8},()=>service.consume(input(code.token),secret()))));
 assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
 const enrolled=attempts.find(x=>x.status==='fulfilled').value;
 assert.equal(enrolled.installation.unitId,unitId);
 assert.equal((await run(()=>service.current(enrolled.credential))).id,enrolled.installation.id);
 assert.equal((await run(()=>service.current(enrolled.credential))).unitName,'Enrollment test');
 await assert.rejects(run(()=>service.consume(input(code.token),secret())),/invalid/);
 const codes=await run(()=>Promise.all([service.issue('session',unitId),service.issue('session',unitId)]));
 const sameContext=secret();
 const race=await run(()=>Promise.allSettled(codes.map(c=>service.consume(input(c.token),sameContext))));
 assert.equal(race.filter(x=>x.status==='fulfilled').length,1);
 assert.match(race.find(x=>x.status==='rejected').reason.message,/already enrolled/);
 const unused=codes[race.findIndex(x=>x.status==='rejected')];
 const third=await run(()=>service.consume(input(unused.token),secret()));assert.notEqual(third.installation.id,enrolled.installation.id);
 const waiting=await run(()=>service.issue('session',unitId));
 const waitingHash=createHash('sha256').update(waiting.token).digest('hex');
 await client.query('begin');
 await client.query(`update app_identity.unit_enrollment set expires_at=clock_timestamp()+interval '200 milliseconds' where token_sha256=$1`,[waitingHash]);
 const blocked=run(()=>service.consume(input(waiting.token),secret()));
 // Attach the rejection handler before releasing the lock.
 const rejected=assert.rejects(blocked,/expired/);
 await new Promise(resolve=>setTimeout(resolve,300));await client.query('commit');await rejected;
 const expired=await run(()=>service.issue('session',unitId));
 await client.query(`update app_identity.unit_enrollment set issued_at=clock_timestamp()-interval '10 minutes',expires_at=clock_timestamp()-interval '1 minute' where token_sha256=$1`,[createHash('sha256').update(expired.token).digest('hex')]);
 await assert.rejects(run(()=>service.consume(input(expired.token),secret())),/expired/);
 await client.query(`update app_identity.operational_unit set active=false where id=$1`,[unitId]);
 await assert.rejects(run(()=>service.issue('session',unitId)),/Active unit/);
 assert.ok((await run(()=>service.inventory('session',unitId))).items.length);
 await assert.rejects(run(()=>service.current(enrolled.credential)),/Enrollment required/);
 await client.query(`update app_identity.operational_unit set active=true where id=$1`,[unitId]);
 await assert.rejects(run(()=>service.current()),/Enrollment required/);
 const inventory=await run(()=>service.inventory('session',unitId));assert.equal(inventory.items.length,4);
 assert.equal(inventory.items.some(x=>x.credential||x.credential_sha256),false);
 const events=await client.query(`select * from app_identity.installation_event where unit_id=$1`,[unitId]);
 assert.equal(events.rows.filter(x=>x.event_type==='installation-enrolled').length,4);
 for(const c of [code,...codes,expired])assert.equal(JSON.stringify(events.rows).includes(c.token),false);
 const countsAfter=await client.query(`select (select count(*) from app_identity.app_session where user_id=$1) sessions,(select count(*) from app_identity.user_role_assignment where user_id=$1) roles`,[userId]);
 assert.deepEqual(countsAfter.rows,countsBefore.rows);
 // Runtime role exercises grants and private schema access against the actual tables.
 await client.query('begin');await client.query('set local role open_triage_api_runtime');
 assert.equal((await client.query('select count(*) n from app_identity.installation_registration where unit_id=$1',[unitId])).rows[0].n,'4');
 await assert.rejects(client.query('delete from app_identity.installation_registration where unit_id=$1',[unitId]),/permission denied/);
 await client.query('rollback');
 } finally {
 // Immutable audit remains; fixtures use fresh UUIDs and do not mutate ordinary accounts/history.
 await client.end();await db.destroy();
 }
});

integration('native outcome never confuses expired uncommitted intent with committed, revoked or competing results',async()=>{
 const db=new DataSource({type:'postgres',url:process.env.DATABASE_URL});await db.initialize();
 const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
 const organizationId=SYNTHETIC_DEMO_FIXTURE.organizationId,userId=randomUUID(),unitId=randomUUID(),origin='https://outcome.example';
 const sessions={requireCapability:async()=>({organization:{id:organizationId},user:{id:userId}})};
 const service=new InstallationEnrollmentService(db,sessions,{allowsOrigin:async value=>value===origin});
 const run=work=>agencyRequest.run({origin},work),hash=value=>createHash('sha256').update(value).digest('hex');
 const input=(token,attempt=secret(),reassign=false)=>({token,attempt,name:'Native outcome fixture',confirmInstallation:true,...(reassign?{reassign:true}:{})});
 let transaction=false;
 try {
  await client.query(`insert into app_identity.app_user(id,organization_id,display_name,synthetic) values($1,$2,'Synthetic outcome administrator',true)`,[userId,organizationId]);
  await client.query(`insert into app_identity.operational_unit(id,organization_id,name,call_sign,active,synthetic) values($1,$2,'Outcome fixture',$3,true,true)`,[unitId,organizationId,`OUT-${unitId}`]);
  const fresh=await run(()=>service.issue('session',unitId)),freshBody=input(fresh.token),original=secret();
  assert.deepEqual(await run(()=>service.outcome(freshBody,original)),{status:'pending'});
  const count=async()=>Number((await client.query('select count(*) n from app_identity.installation_registration where unit_id=$1',[unitId])).rows[0].n);
  await client.query('begin');transaction=true;
  await client.query(`update app_identity.unit_enrollment set expires_at=clock_timestamp()+interval '100 milliseconds' where token_sha256=$1`,[hash(fresh.token)]);
  const waiting=run(()=>service.outcome(freshBody,original));
  await new Promise(resolve=>setTimeout(resolve,200));await client.query('commit');transaction=false;
  assert.deepEqual(await waiting,{status:'not-committed'});assert.equal(await count(),0);
  await assert.rejects(run(()=>service.consume(freshBody,original)),/expired/);assert.equal(await count(),0);

  const initial=await run(()=>service.issue('session',unitId)),old=secret();
  await run(()=>service.consume({token:initial.token,name:'Before outcome',confirmInstallation:true},old));
  const replacement=await run(()=>service.issue('session',unitId)),body=input(replacement.token,secret(),true);
  const committed=await run(()=>service.consume(body,old));assert.equal(await count(),2);
  await client.query(`update app_identity.unit_enrollment set issued_at=clock_timestamp()-interval '30 minutes',expires_at=clock_timestamp()-interval '25 minutes',consumed_at=clock_timestamp()-interval '27 minutes' where token_sha256=$1`,[hash(replacement.token)]);
  await assert.rejects(run(()=>service.consume(body,old)),/unavailable/);
  const derived=enrollmentAttemptCredential(body.attempt,enrollmentAttemptBinding(origin,body.token,body.name,true,old));
  assert.equal(derived,committed.credential);
  assert.equal((await run(()=>service.current(derived))).id,committed.installation.id);
  await assert.rejects(run(()=>service.current(secret())),/Enrollment required/);
  assert.deepEqual(await run(()=>service.outcome(body,old)),{status:'result-unavailable'});
  for(const [candidate,cookie] of [[{...body,name:'Wrong'},old],[{...body,attempt:secret()},old],[body,secret()]])await assert.rejects(run(()=>service.outcome(candidate,cookie)),/unavailable/);
  await assert.rejects(agencyRequest.run({origin:'https://wrong.example'},()=>service.outcome(body,old)),/origin required/);
  await run(()=>service.revoke('session',unitId,committed.installation.id));
  await assert.rejects(run(()=>service.current(derived)),/Enrollment required/);
  assert.deepEqual(await run(()=>service.outcome(body,old)),{status:'result-unavailable'});assert.equal(await count(),2);
  assert.deepEqual(await run(()=>service.outcome(input(secret()),secret())),{status:'unavailable'});

  // Another cookie can consume the same code while this original authority waits.
  // No stale unconsumed read may turn that competing commit into a reset signal.
  const raceCode=await run(()=>service.issue('session',unitId)),cookieA=secret(),cookieB=secret(),intentA=input(raceCode.token),intentB=input(raceCode.token);
  await client.query('begin');transaction=true;await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[hash(cookieA)]);
  const race=run(()=>service.outcome(intentA,cookieA));const rejected=assert.rejects(race,/unavailable/);
  await run(()=>service.consume(intentB,cookieB));await client.query('commit');transaction=false;await rejected;
  assert.equal(await count(),3);
 } finally {if(transaction)await client.query('rollback');await client.end();await db.destroy();}
});

integration('administrator-assigned pairing name survives phone overrides on real PostgreSQL',async()=>{
 const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
 const organizationId=SYNTHETIC_DEMO_FIXTURE.organizationId,userId=randomUUID(),unitId=randomUUID();
 try {
 await client.query('begin');
 const {rows:[column]}=await client.query("select 1 from information_schema.columns where table_schema='app_identity' and table_name='unit_enrollment' and column_name='installation_name'");
 if(!column)await client.query(await readFile(new URL('../../../supabase/migrations/20261113102148_admin_assigned_installation_name.sql',import.meta.url),'utf8'));
 await client.query(`insert into app_identity.app_user(id,organization_id,display_name,synthetic) values($1,$2,'Fictional pairing administrator',true)`,[userId,organizationId]);
 await client.query(`insert into app_identity.operational_unit(id,organization_id,name,call_sign,active) values($1,$2,'Pairing name test',$3,true)`,[unitId,organizationId,`NAME-${unitId}`]);
 const manager={query:async(sql,parameters)=>(await client.query(sql,parameters)).rows};
 const database={transaction:work=>work(manager)};
 const service=new InstallationEnrollmentService(database,{requireCapability:async()=>({organization:{id:organizationId},user:{id:userId}})},{allowsOrigin:async()=>true});
 await agencyRequest.run({origin:'https://enrollment.example'},async()=>{
 const issued=await service.issue('admin',unitId,{name:'  Admin cab tablet  ',expiresInMinutes:30});
 assert.equal((await service.preview({token:issued.token})).installationName,'Admin cab tablet');
 const result=await service.consume({token:issued.token,name:'Phone override',confirmInstallation:true},secret());
 assert.equal(result.installation.name,'Admin cab tablet');
 const fallback=await service.issue('older-admin',unitId);
 assert.equal((await service.preview({token:fallback.token})).installationName,'Pairing name test');
 });
 }finally{await client.query('rollback');await client.end();}
});
