import assert from 'node:assert/strict';
import { randomBytes,randomUUID,createHash } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { DataSource } from 'typeorm';
import { SYNTHETIC_DEMO_FIXTURE } from '@open-triage/contracts';
import { InstallationEnrollmentService } from '../dist/admin/installation-enrollment.service.js';
import { ClinicianSessionService } from '../dist/sessions/clinician-session.service.js';
import { AgencyDirectoryService } from '../dist/sessions/agency-directory.service.js';
import { createPasswordVerifier } from '../dist/identity/password.js';
import { agencyRequest } from '../dist/sessions/agency-context.js';
const integration=process.env.DATABASE_URL?test:test.skip;
if(process.env.REQUIRE_DATABASE_INTEGRATION&&!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
const secret=()=>randomBytes(32).toString('base64url');
const digest=value=>createHash('sha256').update(value).digest('hex');
integration('runtime PostgreSQL reassignment races rotate authority, demand fresh login and retain immutable history',async()=>{
 const admin=new pg.Client({connectionString:process.env.DATABASE_URL});await admin.connect();
 const db=new DataSource({type:'postgres',url:process.env.DATABASE_URL,extra:{options:'-c role=open_triage_api_runtime'}});await db.initialize();
 const organizationId=SYNTHETIC_DEMO_FIXTURE.organizationId,fromUnit=randomUUID(),toUnit=randomUUID(),userId=randomUUID(),username=`move-${userId}`,password='Reassignment regression password 42!';
 const origin='https://installation-reassignment.example';
 const directory=new AgencyDirectoryService(db);
 const agencies={allowsOrigin:async value=>value===origin,forLogin:async()=>({id:organizationId,name:'Fictional EMS',shift_session_duration_hours:12}),accessible:(...args)=>directory.accessible(...args)};
 const sessions=new ClinicianSessionService(db,agencies);
 const service=new InstallationEnrollmentService(db,{requireCapability:async()=>({organization:{id:organizationId},user:{id:SYNTHETIC_DEMO_FIXTURE.userId}})},agencies);
 const run=(credential,work)=>agencyRequest.run({origin,organizationId,installationCredential:credential},work);
 const issue=unit=>run(undefined,()=>service.issue('admin',unit));
 const body=(token,reassign=false)=>({token,name:'Reassigned browser',confirmInstallation:true,...(reassign?{reassign:true}:{})});
 const consume=(code,credential,reassign,session)=>run(credential,()=>service.consume(body(code.token,reassign),credential,session));
 const login=credential=>run(credential,()=>sessions.create({username,password}));
 try{
 for(const unit of [fromUnit,toUnit])await admin.query(`insert into app_identity.operational_unit(id,organization_id,name,call_sign) values($1,$2,'Reassignment test',$3)`,[unit,organizationId,`MOVE-${unit}`]);
 await admin.query(`insert into app_identity.app_user(id,organization_id,display_name,synthetic) values($1,$2,'Reassignment clinician',true)`,[userId,organizationId]);
 await admin.query(`insert into app_identity.local_credential(user_id,username,password_verifier,must_change_password) values($1,$2,$3,false)`,[userId,username,await createPasswordVerifier(password)]);
 await admin.query(`insert into app_identity.user_role_assignment(organization_id,user_id,role_id) select organization_id,$1,role_id from app_identity.user_role_assignment where user_id=$2 and ended_at is null`,[userId,SYNTHETIC_DEMO_FIXTURE.userId]);
 const enrolled=await consume(await issue(fromUnit),secret(),false);
 const other=await consume(await issue(fromUnit),secret(),false);
 const [oldSession,otherSession]=await Promise.all([login(enrolled.credential),login(other.credential)]);
 const reportsBefore=(await admin.query(`select id,organization_id,documenting_user_id,form_version_id,catalog_release_id from clinical.report where organization_id=$1 order by id`,[organizationId])).rows;
 assert.ok(reportsBefore.length,'historical reports seeded');
 const assignmentsBefore=(await admin.query(`select id,unit_id,report_id from clinical.call_assignment where organization_id=$1 order by id`,[organizationId])).rows;
 const original=(await admin.query(`select id,organization_id,unit_id,installation_identity_id,credential_sha256,enrolled_at from app_identity.installation_registration where id=$1`,[enrolled.installation.id])).rows;
 const plain=await issue(toUnit);await assert.rejects(consume(plain,enrolled.credential,false),/already enrolled/);
 const [one,two]=await Promise.all([issue(toUnit),issue(toUnit)]);
 const race=await Promise.allSettled([consume(one,enrolled.credential,true,oldSession.sessionToken),consume(two,enrolled.credential,true,oldSession.sessionToken)]);
 assert.equal(race.filter(result=>result.status==='fulfilled').length,1);
 assert.match(race.find(result=>result.status==='rejected').reason.message,/retired|replaced|unavailable/);
 const moved=race.find(result=>result.status==='fulfilled').value;
 assert.equal(moved.installation.installationId,enrolled.installation.installationId);assert.equal(moved.installation.unitId,toUnit);assert.notEqual(moved.credential,enrolled.credential);
 assert.equal(moved.reassigned,true);
 await assert.rejects(run(enrolled.credential,()=>service.current(enrolled.credential)),/Enrollment required/);
 await assert.rejects(run(moved.credential,()=>sessions.getAuthenticated(oldSession.sessionToken)),/session has ended/);
 const retiredLogin=await login(enrolled.credential);
 assert.equal((await run(enrolled.credential,()=>sessions.getAuthenticated(retiredLogin.sessionToken))).user.id,userId);
 assert.equal((await run(other.credential,()=>sessions.getAuthenticated(otherSession.sessionToken))).user.id,userId);
 assert.equal((await admin.query(`select count(*) n from app_identity.app_session where installation_registration_id=$1 and revoked_at is null`,[moved.installation.id])).rows[0].n,'0');
 const fresh=await login(moved.credential);assert.equal(fresh.session.user.id,userId);
 assert.equal((await admin.query(`select installation_registration_id from app_identity.app_session where token_sha256=$1`,[digest(fresh.sessionToken)])).rows[0].installation_registration_id,moved.installation.id);
 for(const reassign of [false,true])await assert.rejects(consume(await issue(fromUnit),enrolled.credential,reassign),/retired|replaced/);
 await assert.rejects(consume(one,secret(),true),/live installation/);
 assert.deepEqual((await admin.query(`select id,organization_id,unit_id,installation_identity_id,credential_sha256,enrolled_at from app_identity.installation_registration where id=$1`,[enrolled.installation.id])).rows,original);
 assert.deepEqual((await admin.query(`select id,organization_id,documenting_user_id,form_version_id,catalog_release_id from clinical.report where organization_id=$1 order by id`,[organizationId])).rows,reportsBefore);
 assert.deepEqual((await admin.query(`select id,unit_id,report_id from clinical.call_assignment where organization_id=$1 order by id`,[organizationId])).rows,assignmentsBefore);
 const event=(await admin.query(`select details from app_identity.installation_event where installation_id=$1 and event_type='installation-reassigned'`,[enrolled.installation.id])).rows;
 assert.deepEqual(event,[{details:{replacementRegistrationId:moved.installation.id,sessionsRevoked:1}}]);
 await assert.rejects(db.query(`update app_identity.installation_registration set unit_id=$2 where id=$1`,[enrolled.installation.id,toUnit]),error=>error.code==='23514');
 await assert.rejects(db.query(`update app_identity.installation_registration set revoked_at=null where id=$1`,[enrolled.installation.id]),error=>error.code==='23514');
 await assert.rejects(db.query(`update app_identity.installation_registration set credential_sha256=$2 where id=$1`,[moved.installation.id,digest(secret())]),error=>error.code==='23514');
 // Replays cannot restore a retired binding, even after the replacement is revoked.
 await run(undefined,()=>service.revoke('admin',toUnit,moved.installation.id));
 await assert.rejects(consume(await issue(fromUnit),enrolled.credential,false),/retired|replaced/);
 // Ordinary revoked-cookie re-enrollment shares the identity guard: stale retries
 // return a controlled conflict, rather than leaking the partial unique constraint.
 const restored=await consume(await issue(toUnit),moved.credential,false);
 await assert.rejects(consume(await issue(fromUnit),moved.credential,false),/replaced/);
 assert.equal(restored.installation.installationId,moved.installation.installationId);
 // The schedule/zone writer's ordered agency lock must precede every unit lock.
 // A paused writer can still lock its unit while reassignment waits for agency authority.
 const zoneCode=await issue(fromUnit);
 await admin.query('begin');await admin.query("set local lock_timeout='1s'");
 await admin.query(`select id from app_identity.organization where app_identity.organization_group(id)=app_identity.organization_group($1) order by id for update`,[organizationId]);
 const zoneWait=consume(zoneCode,restored.credential,true);zoneWait.catch(()=>{});
 await new Promise(resolve=>setTimeout(resolve,150));
 await admin.query(`select id from app_identity.operational_unit where id=$1 for update`,[fromUnit]);
 await admin.query('commit');
 const zoneMoved=await zoneWait;assert.equal(zoneMoved.installation.unitId,fromUnit);
 // One QR cannot be consumed by both a reassignment and another installation.
 const shared=await issue(toUnit);
 const mixed=await Promise.allSettled([consume(shared,zoneMoved.credential,true),consume(shared,secret(),false)]);
 assert.equal(mixed.filter(result=>result.status==='fulfilled').length,1);
 assert.match(mixed.find(result=>result.status==='rejected').reason.message,/expired|invalid|used/);
 const stillLive=await run(undefined,()=>service.current(zoneMoved.credential)).catch(()=>null);
 assert.equal(!!stillLive,mixed[1].status==='fulfilled');
 }finally{await admin.query('rollback');await db.destroy();await admin.end();}
});
