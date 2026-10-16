import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
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

integration('device-scoped revocation races, live authority, re-enrollment and immutable history under the runtime role',async()=>{
 const admin=new pg.Client({connectionString:process.env.DATABASE_URL});await admin.connect();
 const db=new DataSource({type:'postgres',url:process.env.DATABASE_URL,extra:{options:'-c role=open_triage_api_runtime',application_name:'missing-cookie-password-race'}});await db.initialize();
 const organizationId=SYNTHETIC_DEMO_FIXTURE.organizationId,unitId=randomUUID(),userId=randomUUID(),username=`device-${userId}`;
 const origin='https://device-revocation.example',password='Device regression password 42!';
 let originActive=true,scope=organizationId;
 const directory=new AgencyDirectoryService(db);
 const agencies={allowsOrigin:async value=>originActive&&value===origin,forLogin:async()=>({id:organizationId,name:'Fictional EMS',shift_session_duration_hours:12}),accessible:(...args)=>directory.accessible(...args)};
 const sessions=new ClinicianSessionService(db,agencies);
 const enrollment=new InstallationEnrollmentService(db,{requireCapability:async()=>({organization:{id:scope},user:{id:SYNTHETIC_DEMO_FIXTURE.userId}})},agencies);
 const run=(credential,work)=>agencyRequest.run({origin,organizationId,installationCredential:credential},work);
 const enroll=async (credential,existingSession)=>{const code=await run(undefined,()=>enrollment.issue('admin',unitId));return run(undefined,()=>enrollment.consume({token:code.token,name:'Fictional browser',confirmInstallation:true},credential??secret(),existingSession));};
 const login=credential=>run(credential,()=>sessions.create({username,password}));
 try {
 await admin.query(`insert into app_identity.operational_unit(id,organization_id,name,call_sign) values($1,$2,'Revocation fixture',$3)`,[unitId,organizationId,`REV-${unitId}`]);
 await admin.query(`insert into app_identity.app_user(id,organization_id,display_name,synthetic) values($1,$2,'Fictional device clinician',true)`,[userId,organizationId]);
 await admin.query(`insert into app_identity.local_credential(user_id,username,password_verifier,must_change_password) values($1,$2,$3,false)`,[userId,username,await createPasswordVerifier(password)]);
 await admin.query(`insert into app_identity.user_role_assignment(organization_id,user_id,role_id)
 select organization_id,$1,role_id from app_identity.user_role_assignment where user_id=$2 and ended_at is null`,[userId,SYNTHETIC_DEMO_FIXTURE.userId]);
 const first=await enroll(),second=await enroll();
 const [a,b,unpaired]=await Promise.all([login(first.credential),login(second.credential),login(secret())]);
 const associations=(await admin.query(`select installation_registration_id from app_identity.app_session where user_id=$1 order by created_at`,[userId])).rows;
 assert.equal(associations.filter(x=>x.installation_registration_id===first.installation.id).length,1);
 assert.equal(associations.filter(x=>x.installation_registration_id===second.installation.id).length,1);
 assert.equal(associations.filter(x=>x.installation_registration_id===null).length,1);
 assert.equal((await run(first.credential,()=>sessions.getAuthenticated(a.sessionToken))).user.id,userId);
 originActive=false;
 await assert.rejects(run(first.credential,()=>sessions.getAuthenticated(a.sessionToken)),/origin required/);
 await assert.rejects(login(first.credential),/origin required/);originActive=true;
 scope=randomUUID();await assert.rejects(run(undefined,()=>enrollment.revoke('admin',unitId,first.installation.id)),/not found/);scope=organizationId;
 const pairedAfterLogin=await enroll(undefined,unpaired.sessionToken);
 assert.equal((await admin.query(`select installation_registration_id from app_identity.app_session where token_sha256=$1`,[digest(unpaired.sessionToken)])).rows[0].installation_registration_id,pairedAfterLogin.installation.id);
 const ignoredBinding=await enroll(undefined,unpaired.sessionToken);
 assert.equal((await admin.query(`select installation_registration_id from app_identity.app_session where token_sha256=$1`,[digest(unpaired.sessionToken)])).rows[0].installation_registration_id,pairedAfterLogin.installation.id);
 await assert.rejects(db.query(`update app_identity.app_session set installation_registration_id=$2 where token_sha256=$1`,[digest(unpaired.sessionToken),ignoredBinding.installation.id]),error=>error.code==='23514');
 const raceRegistration=await enroll();
 // Lock registration as a concurrent revoker would. A verified login must wait,
 // then publish a personal session with no usable unit binding.
 await admin.query('begin');
 await admin.query(`select id from app_identity.installation_registration where id=$1 for update`,[raceRegistration.installation.id]);
 const waitingLogin=login(raceRegistration.credential);
 await new Promise(resolve=>setTimeout(resolve,200));
 await admin.query(`update app_identity.installation_registration set revoked_at=clock_timestamp() where id=$1`,[raceRegistration.installation.id]);
 await admin.query('commit');
 const racedLogin=await waitingLogin;
 assert.equal((await admin.query('select installation_registration_id from app_identity.app_session where token_sha256=$1',[digest(racedLogin.sessionToken)])).rows[0].installation_registration_id,null);
 await assert.rejects(db.query(`insert into app_identity.app_session(user_id,token_sha256,csrf_sha256,credential_version,expires_at,organization_id,installation_registration_id)
 values($1,$2,$3,1,now()+interval '1 hour',$4,$5)`,[userId,digest(secret()),digest(secret()),organizationId,raceRegistration.installation.id]),error=>error.code==='23514');
 const result=await run(undefined,()=>enrollment.revoke('admin',unitId,first.installation.id));
 assert.deepEqual(result,{revoked:true,sessionsRevoked:0});
 const afterRevocation=await login(first.credential);
 assert.equal((await run(first.credential,()=>sessions.getAuthenticated(afterRevocation.sessionToken))).user.id,userId);
 assert.equal((await run(first.credential,()=>sessions.getAuthenticated(a.sessionToken))).user.id,userId);
 assert.equal((await admin.query('select installation_registration_id from app_identity.app_session where token_sha256=$1',[digest(afterRevocation.sessionToken)])).rows[0].installation_registration_id,null);
 assert.equal((await run(second.credential,()=>sessions.getAuthenticated(b.sessionToken))).user.id,userId);
 assert.equal((await run(undefined,()=>sessions.getAuthenticated(unpaired.sessionToken))).user.id,userId);
 assert.deepEqual(await run(undefined,()=>enrollment.revoke('admin',unitId,first.installation.id)),{revoked:true,sessionsRevoked:0});
 const event=(await admin.query(`select details from app_identity.installation_event where installation_id=$1 and event_type='installation-revoked'`,[first.installation.id])).rows;
 assert.deepEqual(event,[{details:{scope:'installation-registration',sessionsRevoked:0}}]);
 const historyBefore=(await admin.query(`select id,organization_id,unit_id,installation_identity_id,credential_sha256,revoked_at from app_identity.installation_registration where id=$1`,[first.installation.id])).rows;
 const reenrolled=await enroll(first.credential,a.sessionToken);
 assert.equal(reenrolled.installation.installationId,first.installation.installationId);
 assert.notEqual(reenrolled.credential,first.credential);assert.notEqual(reenrolled.installation.id,first.installation.id);
 assert.deepEqual((await admin.query(`select id,organization_id,unit_id,installation_identity_id,credential_sha256,revoked_at from app_identity.installation_registration where id=$1`,[first.installation.id])).rows,historyBefore);
 assert.equal((await login(first.credential)).session.user.id,userId);
 // Removing only the installation cookie must not invert session→registration
 // locks during password replacement. A revoker already owns registration and
 // must be able to complete explicit personal-session revocation before proof proceeds.
 const absentCookie=await login(ignoredBinding.credential);
 const originalCredential=(await admin.query('select credential_version,password_verifier from app_identity.local_credential where user_id=$1',[userId])).rows[0];
 await admin.query('begin');
 await admin.query('select id from app_identity.installation_registration where id=$1 for update',[ignoredBinding.installation.id]);
 const missingCookiePassword=run(undefined,()=>sessions.changePassword(absentCookie.sessionToken,{currentPassword:password,newPassword:'Denied replacement password 99!',csrfToken:absentCookie.session.csrfToken}));
 const rejectedPassword=assert.rejects(missingCookiePassword,/session has ended|valid CSRF token/);
 rejectedPassword.catch(()=>{});
 let waiting=false;
 for(let attempt=0;attempt<100;attempt++){
  await admin.query('select pg_stat_clear_snapshot()');
  const blocked=(await admin.query("select count(*)::int count from pg_stat_activity where application_name='missing-cookie-password-race' and wait_event_type='Lock' and query like '%installation_registration%' and pg_backend_pid()=any(pg_blocking_pids(pid))" )).rows[0].count;
  if(blocked){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,20));
 }
 assert.equal(waiting,true,'Password replacement must first wait for session-associated registration without its cookie');
 await admin.query('update app_identity.installation_registration set revoked_at=clock_timestamp() where id=$1',[ignoredBinding.installation.id]);
 await admin.query("update app_identity.app_session set revoked_at=clock_timestamp(),revocation_reason='installation_revoked' where installation_registration_id=$1 and revoked_at is null",[ignoredBinding.installation.id]);
 await admin.query('commit');await rejectedPassword;
 assert.deepEqual((await admin.query('select credential_version,password_verifier from app_identity.local_credential where user_id=$1',[userId])).rows[0],originalCredential);
 await admin.query(`update app_identity.local_credential set must_change_password=true,temporary_password_expires_at=now()+interval '2 hours' where user_id=$1`,[userId]);
 const fresh=await login(reenrolled.credential);assert.equal(fresh.session.passwordChangeRequired,true);
 // Password completion must copy the server-owned association and preserve device scope.
 const replacement=await run(reenrolled.credential,()=>sessions.changePassword(fresh.sessionToken,{currentPassword:password,newPassword:'Device replacement password 84!',csrfToken:fresh.session.csrfToken}));
 assert.equal((await admin.query(`select installation_registration_id from app_identity.app_session where token_sha256=$1`,[digest(replacement.sessionToken)])).rows[0].installation_registration_id,reenrolled.installation.id);
 await admin.query(`update app_identity.operational_unit set active=false where id=$1`,[unitId]);
 assert.equal((await run(reenrolled.credential,()=>sessions.getAuthenticated(replacement.sessionToken))).user.id,userId);
 await assert.rejects(run(reenrolled.credential,()=>enrollment.current(reenrolled.credential)),/Enrollment required/);
 const noUnitReplacement=await run(reenrolled.credential,()=>sessions.changePassword(replacement.sessionToken,{currentPassword:'Device replacement password 84!',newPassword:'Device unpaired password 96!',csrfToken:replacement.session.csrfToken}));
 assert.equal((await admin.query('select installation_registration_id from app_identity.app_session where token_sha256=$1',[digest(noUnitReplacement.sessionToken)])).rows[0].installation_registration_id,null,'password completion must not copy an inactive pairing');
 assert.equal((await run(undefined,()=>enrollment.inventory('admin',unitId))).items.length,6);
 assert.equal((await admin.query(`select unit_id from app_identity.installation_registration where id=$1`,[first.installation.id])).rows[0].unit_id,unitId);
 assert.equal((await run(undefined,()=>enrollment.revoke('admin',unitId,reenrolled.installation.id))).sessionsRevoked,0);
 } finally {await admin.query('rollback');await db.destroy();await admin.end();}
});
