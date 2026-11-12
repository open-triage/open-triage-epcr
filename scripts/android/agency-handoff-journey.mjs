import assert from 'node:assert/strict';
import {execFileSync,fork,spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {DataSource} from 'typeorm';
import {runInstrumentation} from './instrumentation.mjs';
import {startLiveInstrumentation} from './live-instrumentation.mjs';
import {stopFixtureChild} from './fixture-processes.mjs';
import {agencyRetainedSnapshotSql,verifyAgencySourceReturn} from './agency-return-evidence.mjs';
import {scopedAndroidReverse} from './scoped-reverse.mjs';
import {seedReportFixture} from './report-fixture.mjs';

/** Two real trusted origins; only an explicit test-only reverse reaches localhost:443. */
export async function runAgencyHandoffJourney({root,directory,fixture,adb,serial,run,api}){
 const db=new DataSource({type:'postgres',url:fixture.databaseUrl});await db.initialize();
 const ca=await readFile(fixture.caPath),targetOrigin='https://127.0.0.1',targetAgency=randomUUID();
 let targetApi,ownsManagement=false,reportId,live,restoreReverse,failure;
 const targetFixture={...fixture,origin:targetOrigin,port:9444};
 const startTarget=async overrides=>{
  if(targetApi)await stopFixtureChild(targetApi);
  const path=join(directory,'agency-target.json');await writeFile(path,JSON.stringify({...targetFixture,...overrides}));
  targetApi=fork(fileURLToPath(new URL('./fixture-api.mjs',import.meta.url)),[path],{cwd:root,env:{...process.env,NODE_EXTRA_CA_CERTS:fixture.caPath},stdio:['ignore','inherit','inherit','ipc']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Agency target API startup timeout')),45000);targetApi.once('message',()=>{clearTimeout(timer);resolve();});targetApi.once('exit',()=>{clearTimeout(timer);reject(Error('Agency target API exited before ready'));});});
 };
 const argumentsFor=(phase,extra={})=>{
  const args=['-s',serial,'shell','am','instrument','-w','-r','-e','class','org.opentriage.development.AgencyHandoffJourneyTest'];
  for(const [key,value]of Object.entries({phase,apiOrigin:fixture.origin,sourceAgency:fixture.organizationId,targetAgency,...extra}))args.push('-e',key,String(value));
  args.push('org.opentriage.development.test/androidx.test.runner.AndroidJUnitRunner');return args;
 };
 const instrument=async(phase,extra={})=>{let output;try{output=await runInstrumentation(adb,argumentsFor(phase,extra),{cwd:root});}catch{throw Error(`Actual agency ${phase} instrumentation failed`);}console.log(output);assert.match(output,/OK \(1 test\)/,`Actual agency ${phase}`);return output;};
 const rawArgs=args=>{const i=args.indexOf('shell');return[...args.slice(0,i+1),args.slice(i+1).map(v=>"'"+v.replaceAll("'","'\"'\"'")+"'").join(' ')];};
 try{
  const [configuration]=await db.query('select form_version_id from app_identity.active_configuration_bundle where organization_id=$1',[fixture.organizationId]);
  if(!configuration)await seedReportFixture(root,fixture,run);
  const {AccountService}=await import('../../apps/api/dist/identity/account.service.js');
  const superuserPassword='AndroidFixtureAgencySuperuser123!';
  const superuser=await new AccountService(db).createSuperadmin({username:'android.agency.superuser',displayName:'Synthetic agency superuser',temporaryPassword:superuserPassword,operator:{operatorId:'android-test',osAccount:'synthetic',host:'disposable'}});
  await db.query('update app_identity.local_credential set must_change_password=false,temporary_password_expires_at=null,password_changed_at=clock_timestamp() where user_id=$1',[superuser.userId]);
  await db.query("insert into app_identity.organization(id,name,hostname,deployment_timezone) values($1,'Android agency target','127.0.0.1','UTC')",[targetAgency]);
  const incident=randomUUID(),assignment=randomUUID(),callNumber='ANDROID-AGENCY-HANDOFF';
  await db.query("insert into clinical.incident(id,organization_id,operational_state,synthetic) values($1,$2,'assigned',true)",[incident,fixture.organizationId]);
  await db.query("insert into clinical.call_assignment(id,organization_id,unit_id,incident_id,call_number,dispatched_at,dispatch_reason,status,synthetic) values($1,$2,$3,$4,$5,clock_timestamp(),'Synthetic agency pending-work handoff','assigned',true)",[assignment,fixture.organizationId,fixture.unitId,incident,callNumber]);
  const administrator=await api(fixture,ca,'sessions','POST',{username:fixture.administrator.username,password:fixture.administratorPassword});assert.equal(administrator.status,201);
  const cookie=administrator.headers['set-cookie'].map(value=>value.split(';')[0]).join('; '),headers={Cookie:cookie,'x-csrf-token':administrator.body.csrfToken,'x-organization-id':fixture.organizationId};
  const issue=async()=>{const result=await api(fixture,ca,`admin/units/${fixture.unitId}/enrollment`,'POST',{},headers);assert.equal(result.status,201);return Buffer.from(JSON.stringify({version:1,...result.body,caPem:ca.toString('utf8')})).toString('base64');};
  restoreReverse=scopedAndroidReverse({adb,serial});
  const wrongKey=join(directory,'agency-untrusted.key'),wrongCert=join(directory,'agency-untrusted.pem');
  run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',wrongKey,'-out',wrongCert,'-days','2','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1']);
  await startTarget({keyPath:wrongKey,certPath:wrongCert});
  run(adb,['-s',serial,'shell','pm','clear','org.opentriage.development']);
  const identity={username:fixture.clinician.username,password:fixture.clinicianPassword,superuser:superuser.username,superuserPassword,superuserId:superuser.userId};
  const setup=await instrument('setup',{...identity,artifactBase64:await issue(),callNumber});
  reportId=/agency_report_id=([a-f0-9-]{36})/.exec(setup)?.[1];const retainedSha256=/retained_sha256=([a-f0-9]{64})/.exec(setup)?.[1],sourceCookieSha256=/source_cookie_sha256=([a-f0-9]{64})/.exec(setup)?.[1];assert(reportId&&retainedSha256&&sourceCookieSha256);
  const snapshot=async()=>{
   const [row]=await db.query(agencyRetainedSnapshotSql,[reportId]);return row;
  };
  const before=await snapshot();assert.equal(before.documenting_user_id,fixture.clinician.userId);assert.equal(before.first_name,'ANDROID-AGENCY-ORIGINAL');
  await instrument('bad-ca',{retainedSha256});
  assert.equal((await db.query('select count(*)::int n from app_identity.agency_session_handoff where issued_at is not null'))[0].n,0,'Untrusted target must fail before source issuance');
  await startTarget();
  live=startLiveInstrumentation(adb,rawArgs(argumentsFor('prepare-interrupted')),{cwd:root,checkpoint:'INSTRUMENTATION_STATUS: agency_handoff_live=1'});
  const checkpoint=await live.ready;assert.match(checkpoint,new RegExp('retained_sha256='+retainedSha256));
  assert(execFileSync(adb,['-s',serial,'shell','pidof','org.opentriage.development'],{encoding:'utf8'}).trim(),'Actual prepared handoff Activity must still be alive');
  run(adb,['-s',serial,'shell','am','force-stop','org.opentriage.development']);assert.equal(spawnSync(adb,['-s',serial,'shell','pidof','org.opentriage.development'],{encoding:'utf8'}).stdout.trim(),'');await live.closed;live=null;
  await instrument('cancel-interrupted',{retainedSha256,sourceCookieSha256});
  assert.deepEqual(await snapshot(),before,'Interruption/cancellation cannot mutate old clinical authority or deadline');
  assert.equal((await api(targetFixture,ca,'__android-agency-consume-hold','POST',{})).status,200);
  live=startLiveInstrumentation(adb,rawArgs(argumentsFor('consume-interrupted')),{cwd:root,checkpoint:'INSTRUMENTATION_STATUS: agency_handoff_live=1'});
  const interruptedConsume=await live.ready;assert.match(interruptedConsume,new RegExp('retained_sha256='+retainedSha256));
  const sourceExpiresAt=/source_expires_at=([^\r\n]+)/.exec(interruptedConsume)?.[1];assert(sourceExpiresAt);
  assert(execFileSync(adb,['-s',serial,'shell','pidof','org.opentriage.development'],{encoding:'utf8'}).trim(),'Actual ambiguous consume must remain live at checkpoint');
  run(adb,['-s',serial,'shell','am','force-stop','org.opentriage.development']);assert.equal(spawnSync(adb,['-s',serial,'shell','pidof','org.opentriage.development'],{encoding:'utf8'}).stdout.trim(),'');await live.closed;live=null;
  await instrument('finish-completed',{retainedSha256,sourceCookieSha256,sourceExpiresAt});
  assert.deepEqual(await snapshot(),before,'Lost consume body and completion recovery preserve original clinical authority/deadline');
  const afterAmbiguous=await api(targetFixture,ca,'__android-agency-observations');
  assert.equal(afterAmbiguous.body.requests.filter(row=>row.stage==='consume').length,1,'Ambiguous one-use consume is never replayed during recovery');
  await instrument('return-source-superuser',{...identity,artifactBase64:await issue(),retainedSha256});
  live=startLiveInstrumentation(adb,rawArgs(argumentsFor('prepare-completed')),{cwd:root,checkpoint:'INSTRUMENTATION_STATUS: agency_handoff_live=1'});
  assert.match(await live.ready,new RegExp('retained_sha256='+retainedSha256));
  assert(execFileSync(adb,['-s',serial,'shell','pidof','org.opentriage.development'],{encoding:'utf8'}).trim(),'Actual promoted handoff must remain live before JavaScript delivery');
  run(adb,['-s',serial,'shell','am','force-stop','org.opentriage.development']);assert.equal(spawnSync(adb,['-s',serial,'shell','pidof','org.opentriage.development'],{encoding:'utf8'}).stdout.trim(),'');await live.closed;live=null;
  await instrument('finish-completed',{retainedSha256,sourceCookieSha256});
  assert.deepEqual(await snapshot(),before,'Cross-agency handoff cannot retag/synchronize old pending work or extend its deadline');
  run(adb,['-s',serial,'shell','am','force-stop','org.opentriage.development']);await instrument('restart-target',{retainedSha256});
  const observed=await api(targetFixture,ca,'__android-agency-observations');assert.equal(observed.status,200);
  assert(observed.body.requests.some(row=>row.stage==='challenge'&&!row.personal&&!row.installation&&!row.challenge));
  assert(observed.body.requests.some(row=>row.stage==='consume'&&!row.personal&&!row.installation&&row.challenge));
  assert(observed.body.requests.filter(row=>['challenge','consume'].includes(row.stage)).every(row=>!row.installation&&!row.personal),'No source credential may be transferred to target bootstrap');
  assert(observed.body.requests.filter(row=>row.stage==='current').every(row=>row.personal&&!row.installation&&!row.challenge),'Recovery uses only the target-issued personal cookie');
  assert.deepEqual(await snapshot(),before,'Bundled target restart cannot renew the original retained envelope');
  const released=await api(fixture,ca,'__android-agency-write-outage','POST',{reportId,enabled:false});assert.equal(released.status,200);
  await verifyAgencySourceReturn({before,snapshot,
   returnSource:async()=>instrument('return-source',{...identity,artifactBase64:await issue(),retainedSha256}),
   recoverSource:async()=>instrument('recover-source',identity)});
  run(adb,['-s',serial,'install','-t','-r',join(root,'android/management-test-controller/build/outputs/apk/debug/management-test-controller-debug.apk')]);
  run(adb,['-s',serial,'shell','dpm','set-device-owner','org.opentriage.managementtest/.AdminReceiver']);ownsManagement=true;
  const count=observed.body.requests.length;
  run(adb,['-s',serial,'shell','am','broadcast','--include-stopped-packages','-a','org.opentriage.managementtest.SET_CONFIGURATION','-n','org.opentriage.managementtest/.ConfigurationReceiver','--es','configurationBase64',Buffer.from(JSON.stringify({configurationVersion:1,serverOrigin:fixture.origin,publicCaPem:ca.toString('utf8')})).toString('base64')]);
  await instrument('managed-denied');
  assert.equal((await api(targetFixture,ca,'__android-agency-observations')).body.requests.length,count,'Managed conflict is rejected before contacting the target');
  console.log('PASS native agency handoff: strict private CA, no source credentials on target, real pending clinical bytes/deadline/author/unit isolation, live process-loss cancellation without sign-in, bundled restart, explicit original pairing/recovery and managed denial');
 }catch(error){failure=error;throw error;}finally{
  const cleanupErrors=[];
  const cleanup=async(label,operation)=>{try{await operation();}catch(error){cleanupErrors.push(new Error(label,{cause:error}));}};
  await cleanup('Live agency instrumentation cleanup failed',async()=>{
   if(live){run(adb,['-s',serial,'shell','am','force-stop','org.opentriage.development']);await stopFixtureChild(live.child);await live.closed;}
  });
  await cleanup('Agency test management removal failed',async()=>{
   if(ownsManagement){
    run(adb,['-s',serial,'shell','am','broadcast','--include-stopped-packages','-a','org.opentriage.managementtest.SET_CONFIGURATION','-n','org.opentriage.managementtest/.ConfigurationReceiver','--es','configurationBase64',Buffer.from('{}').toString('base64')]);
    run(adb,['-s',serial,'shell','dpm','remove-active-admin','org.opentriage.managementtest/.AdminReceiver']);
   }
  });
  await cleanup('Agency target API cleanup failed',()=>stopFixtureChild(targetApi??{}));
  await cleanup('Agency fixture reverse restoration failed',async()=>restoreReverse?.());
  await cleanup('Agency fixture database connection cleanup failed',()=>db.destroy());
  if(cleanupErrors.length)throw new AggregateError(failure?[failure,...cleanupErrors]:cleanupErrors,'Agency journey or cleanup failed');
 }
}
