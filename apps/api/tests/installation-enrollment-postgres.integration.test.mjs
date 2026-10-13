import assert from 'node:assert/strict';
import { randomBytes,randomUUID,createHash } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { DataSource } from 'typeorm';
import { SYNTHETIC_DEMO_FIXTURE } from '@open-triage/contracts';
import { InstallationEnrollmentService } from '../dist/admin/installation-enrollment.service.js';
import { agencyRequest } from '../dist/sessions/agency-context.js';
const integration=process.env.DATABASE_URL?test:test.skip;
if(process.env.REQUIRE_DATABASE_INTEGRATION&&!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
const secret=()=>randomBytes(32).toString('base64url');
integration('real PostgreSQL enrollment races, replay, expiry, scopes, audit and independent installations',async()=>{
 const db=new DataSource({type:'postgres',url:process.env.DATABASE_URL});await db.initialize();
 const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
 const organizationId=SYNTHETIC_DEMO_FIXTURE.organizationId,userId=SYNTHETIC_DEMO_FIXTURE.userId,unitId=randomUUID();
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
 await client.query(`insert into app_identity.operational_unit(id,organization_id,name,call_sign,active) values($1,$2,'Enrollment test',$3,true)`,[unitId,organizationId,`ENR-${unitId}`]);
 denied=true;await assert.rejects(run(()=>service.issue('session',unitId)),/Not authorized/);denied=false;
 scope=randomUUID();await assert.rejects(run(()=>service.issue('session',unitId)),/Active unit/);await assert.rejects(run(()=>service.inventory('session',unitId)),/not found/);scope=organizationId;
 const code=await run(()=>service.issue('session',unitId));
 originActive=false;
 await assert.rejects(run(()=>service.preview({token:code.token})),/origin required/);
 await assert.rejects(run(()=>service.consume(input(code.token),secret())),/origin required/);
 await assert.rejects(run(()=>service.current(secret())),/origin required/);
 originActive=true;
 const countsBefore=await client.query(`select (select count(*) from app_identity.app_session) sessions,(select count(*) from app_identity.user_role_assignment) roles`);
 const expiry=await client.query(`select extract(epoch from(expires_at-issued_at)) seconds from app_identity.unit_enrollment where token_sha256=$1`,[createHash('sha256').update(code.token).digest('hex')]);
 assert.ok(Math.abs(Number(expiry.rows[0].seconds)-300)<1);
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
 await assert.rejects(run(()=>service.inventory('session',unitId)),/Active unit/);
 await assert.rejects(run(()=>service.current(enrolled.credential)),/Enrollment required/);
 await client.query(`update app_identity.operational_unit set active=true where id=$1`,[unitId]);
 await assert.rejects(run(()=>service.current()),/Enrollment required/);
 const inventory=await run(()=>service.inventory('session',unitId));assert.equal(inventory.items.length,4);
 assert.equal(inventory.items.some(x=>x.credential||x.credential_sha256),false);
 const events=await client.query(`select * from app_identity.installation_event where unit_id=$1`,[unitId]);
 assert.equal(events.rows.filter(x=>x.event_type==='installation-enrolled').length,4);
 for(const c of [code,...codes,expired])assert.equal(JSON.stringify(events.rows).includes(c.token),false);
 const countsAfter=await client.query(`select (select count(*) from app_identity.app_session) sessions,(select count(*) from app_identity.user_role_assignment) roles`);
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
