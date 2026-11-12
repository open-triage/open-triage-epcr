import 'reflect-metadata';
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {DataSource} from 'typeorm';
import {runInstrumentation} from './instrumentation.mjs';
import {captureAndroidFailure} from './diagnostics.mjs';
import {assertNativeAuthenticationOutcome} from './authentication-outcome.mjs';
import {oidcReportContext} from './oidc-report-context.mjs';

/** Actual external-browser trust is installed independently through the test-only DPC. */
export async function runOidcJourney({root,fixture,adb,serial,api}) {
  const {discoveryProvider}=await import('../../apps/api/tests/fixtures/oidc-discovery-provider.mjs');
  const ca=await readFile(fixture.caPath),db=new DataSource({type:'postgres',url:fixture.databaseUrl});await db.initialize();
  let provider,ownsManagement=false;
  const runAdb=args=>execFileSync(adb,args,{cwd:root,timeout:30000,stdio:'inherit'});
  const certificate=remove=>{
    const output=execFileSync(adb,['-s',serial,'shell','am','broadcast','--include-stopped-packages','-a','org.opentriage.managementtest.SET_CONFIGURATION','-n','org.opentriage.managementtest/.ConfigurationReceiver','--es','caCertificateBase64',ca.toString('base64'),...(remove?['--ez','removeCertificate','true']:[])],{encoding:'utf8',timeout:15000});
    assert.match(output,/result=0/,'The separate DPC must install/remove actual browser CA trust');
  };
  const instrumentArgs=(phase,extra={})=>{
    const args=['-s',serial,'shell','am','instrument','-w','-r','-e','class','org.opentriage.development.OidcJourneyTest#systemBrowserAuthentication'];
    for(const [key,value] of Object.entries({phase,apiOrigin:fixture.origin,...extra}))args.push('-e',key,String(value));
    args.push('org.opentriage.development.test/androidx.test.runner.AndroidJUnitRunner');return args;
  };
  const instrument=async(phase,extra={})=>{
    const output=await runInstrumentation(adb,instrumentArgs(phase,extra),{cwd:root});console.log(output);assert.match(output,/OK \(1 test\)/,`Actual OIDC ${phase} journey`);
    if(['login','resume'].includes(phase)){
      const [transaction]=await db.query('select result,native_delivered_at is not null delivered from app_identity.oidc_personal_transaction order by created_at desc limit 1');
      const status=/oidc_session_status=(\d+)/.exec(output)?.[1],user=/oidc_session_user=([^\r\n]+)/.exec(output)?.[1];
      assertNativeAuthenticationOutcome({expected:extra.expected??'succeeded',result:transaction?.result,delivered:transaction?.delivered,
        sessionStatus:Number(status),userId:user?JSON.parse(user):undefined,expectedUserId:extra.userId});
    }
    return output;
  };
  try {
    const administrator=await api(fixture,ca,'sessions','POST',{username:fixture.administrator.username,password:fixture.administratorPassword});assert.equal(administrator.status,201);
    const cookie=administrator.headers['set-cookie'].map(value=>value.split(';')[0]).join('; ');
    const issued=await api(fixture,ca,`admin/units/${fixture.unitId}/enrollment`,'POST',{}, {Cookie:cookie,'x-csrf-token':administrator.body.csrfToken,'x-organization-id':fixture.organizationId});assert.equal(issued.status,201);
    const artifact={version:1,...issued.body,caPem:ca.toString('utf8')};
    provider=await discoveryProvider({port:9444,listenAddress:'0.0.0.0',keyPath:fixture.keyPath,certPath:fixture.certPath,caPath:fixture.caPath,browserOrigin:'https://10.0.2.2:9444'});
    provider.browserLogin=true;provider.personalProofMode='fresh';provider.tokenOverrides={sub:'android-unknown',name:'Synthetic external clinician',email:'android@example.test'};
    const group=fixture.organizationId,providerId=randomUUID(),issuer=`${provider.origin}/adfs`;
    const browserOrigin='https://10.0.2.2:9444';
    const configuration={name:'Synthetic Android provider',issuer,discoveryUrl:'',clientId:'android-fixture-client',scopes:['openid'],mappings:{displayName:'name',email:'email'},clientAuthentication:'client_secret_post',privateOrigins:[provider.origin,browserOrigin],personalProof:{id:'android-controlled-login-v1',acr:'fixture:interactive-personal',requiredAmr:['fixture-personal']}};
    const metadata={issuer,authorization_endpoint:`${browserOrigin}/authorize`,token_endpoint:`${provider.origin}/token`,jwks_uri:`${provider.origin}/jwks`,id_token_signing_alg_values_supported:['RS256'],pkceS256:true};
    const {encryptCredential}=await import('../../apps/api/dist/authentication/oidc-credentials.js');
    const previousKeys=process.env.OIDC_CREDENTIAL_KEYS_JSON;
    process.env.OIDC_CREDENTIAL_KEYS_JSON=JSON.stringify({'1':Buffer.alloc(32,44).toString('base64')});
    let envelope;try{envelope=encryptCredential('fresh-provider-secret',group,providerId);}finally{if(previousKeys===undefined)delete process.env.OIDC_CREDENTIAL_KEYS_JSON;else process.env.OIDC_CREDENTIAL_KEYS_JSON=previousKeys;}
    await db.query("insert into app_identity.oidc_provider_version(group_id,revision,provider_id,configuration,encrypted_credential,discovery,discovery_health,created_by) values($1,1,$2,$3::jsonb,$4::jsonb,$5::jsonb,'healthy',$6)",[group,providerId,JSON.stringify(configuration),JSON.stringify(envelope),JSON.stringify(metadata),fixture.administrator.userId]);
    await db.query('insert into app_identity.oidc_provider_state(group_id,draft_revision,active_revision,active_discovery) values($1,1,1,$2::jsonb)',[group,JSON.stringify(metadata)]);
    await db.query("update app_identity.group_authentication_policy set mode='oidc' where group_id=$1",[group]);
    runAdb(['-s',serial,'install','-t','-r',join(root,'android/management-test-controller/build/outputs/apk/debug/management-test-controller-debug.apk')]);
    runAdb(['-s',serial,'shell','dpm','set-device-owner','org.opentriage.managementtest/.AdminReceiver']);ownsManagement=true;certificate(false);
    runAdb(['-s',serial,'shell','pm','clear','org.opentriage.development']);
    await instrument('login',{expected:'pending',artifactBase64:Buffer.from(JSON.stringify(artifact)).toString('base64')});
    const [pendingDelivery]=await db.query("select count(*)::int count from app_identity.oidc_personal_transaction where result='pending' and native_delivered_at is not null");assert.equal(pendingDelivery.count,1,'Unknown identity return must actually settle its native transaction');
    const [pending]=await db.query("select id from app_identity.regional_identity_request where group_id=$1 and subject='android-unknown'",[group]);assert(pending,'Unknown identity must await ordinary approval');
    await db.query('update app_identity.regional_identity_request set linked_user_id=$2,linked_by=$3,linked_at=clock_timestamp() where id=$1',[pending.id,fixture.clinician.userId,fixture.administrator.userId]);
    const callNumber=`ANDROID-OFFLINE-${fixture.index}`;
    const reportContext=oidcReportContext(await db.query('select assignment.call_number,assignment.report_id,report.documenting_user_id,report.revision from clinical.call_assignment assignment left join clinical.report report on report.id=assignment.report_id where assignment.organization_id=$1 and assignment.call_number=$2',[fixture.organizationId,callNumber]),{callNumber,userId:fixture.clinician.userId});
    const protectedOutput=await instrument('login',{userId:fixture.clinician.userId,protected:'create',openAction:reportContext.openAction,callNumber});
    let retainedSha256=/retained_sha256=([a-f0-9]{64})/.exec(protectedOutput)?.[1];assert(retainedSha256,'The native OIDC session must retain actual encrypted clinical work');
    // Age current login proof without expiring the session. Native recovery uses
    // the unchanged login, never a five-minute proof or another provider round-trip.
    await db.query("update app_identity.app_session set personally_authenticated_at=clock_timestamp()-interval '6 minutes' where user_id=$1 and revoked_at is null",[fixture.clinician.userId]);
    const [report]=await db.query('select report.id,report.revision from clinical.report report join clinical.call_assignment assignment on assignment.report_id=report.id where report.documenting_user_id=$1 and assignment.call_number=$2',[fixture.clinician.userId,callNumber]);
    assert(report,'The native OIDC clinical journey must use its real seeded report');
    assert.equal(JSON.parse(/oidc_report_id=([^\r\n]+)/.exec(protectedOutput)?.[1]??'null'),report.id,'The actual rendered report must be the fixture report acknowledged by the API');
    if(reportContext.reportId)assert.equal(report.id,reportContext.reportId,'Default acceptance reuses the same report rather than creating a substitute');
    const firstName=async()=> (await db.query("select value_text from clinical.element_occurrence where report_id=$1 and element_id='ePatient.03' and tombstoned_at is null",[report.id]))[0]?.value_text;
    for(let i=0;i<150&&await firstName()!=='ANDROID-OIDC-PROTECTED';i++)await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(await firstName(),'ANDROID-OIDC-PROTECTED','The online setup edit must be actually acknowledged before testing pending work');
    const [acknowledged]=await db.query('select revision from clinical.report where id=$1',[report.id]);
    if(reportContext.baselineRevision!==null)assert(Number(acknowledged.revision)>reportContext.baselineRevision,'The OIDC marker must advance the existing report from its actual baseline');
    const [before]=await db.query('select recovery_deadline from offline_recovery.report_key_envelope where report_id=$1',[report.id]);
    await instrument('recovery',{reportId:report.id});
    const [after]=await db.query('select recovery_deadline from offline_recovery.report_key_envelope where report_id=$1',[report.id]);assert.equal(after.recovery_deadline.toISOString(),before.recovery_deadline.toISOString());
    const [pins]=await db.query('select form_version_id,catalog_release_id,validation_version_id from clinical.report where id=$1',[report.id]);
    const pendingOutput=await instrument('pending',{reportId:report.id});
    retainedSha256=/retained_sha256=([a-f0-9]{64})/.exec(pendingOutput)?.[1];assert(retainedSha256);assert.match(pendingOutput,/retained_pending=true/);
    // The ordinary installation-owner recovery flow remains available even
    // under OIDC. Complete its genuine initial password replacement if needed.
    let owner=await api(fixture,ca,'sessions','POST',{username:'fixture.owner',password:'AndroidFixtureOwner123!'});assert.equal(owner.status,201);assert.equal(owner.body.installationOwner,true);
    let ownerCookie=owner.headers['set-cookie'].map(value=>value.split(';')[0]).join('; ');
    if(owner.body.passwordChangeRequired){
      owner=await api(fixture,ca,'sessions/password','POST',{currentPassword:'AndroidFixtureOwner123!',newPassword:'AndroidFixtureOwnerRecovery123!',csrfToken:owner.body.csrfToken},{Cookie:ownerCookie,'x-csrf-token':owner.body.csrfToken});
      assert.equal(owner.status,200);ownerCookie=owner.headers['set-cookie'].map(value=>value.split(';')[0]).join('; ');
    }
    const ownerHeaders={Cookie:ownerCookie,'x-csrf-token':owner.body.csrfToken,'x-organization-id':fixture.organizationId};
    const liveSessions=await api(fixture,ca,`admin/users/${fixture.clinician.userId}/sessions`,'GET',undefined,ownerHeaders);assert.equal(liveSessions.status,200);assert(liveSessions.body.items.length>0);
    for(const session of liveSessions.body.items){const revoked=await api(fixture,ca,`admin/users/${fixture.clinician.userId}/sessions/${session.id}`,'DELETE',{},ownerHeaders);assert.equal(revoked.status,200);assert.equal(revoked.body.revoked,true);}
    runAdb(['-s',serial,'shell','am','force-stop','org.opentriage.development']);
    assert.equal(spawnSync(adb,['-s',serial,'shell','pidof','org.opentriage.development'],{encoding:'utf8',timeout:10000}).stdout.trim(),'');
    // Revocation is the server authority barrier; capture only after it has
    // returned and the still-offline application process is demonstrably gone.
    const [pendingAuthority]=await db.query('select recovery_deadline,ciphertext_revision from offline_recovery.report_key_envelope where report_id=$1',[report.id]);
    runAdb(['-s',serial,'shell','svc','wifi','enable']);runAdb(['-s',serial,'shell','svc','data','enable']);
    assert.equal(await firstName(),'ANDROID-OIDC-PROTECTED','Offline pending work must not reach the server under revoked outgoing authority');
    await db.query('insert into app_identity.regional_identity_request(group_id,provider_id,first_revision,organization_id,issuer,subject,linked_user_id,linked_by,linked_at) values($1,$2,1,$1,$3,$4,$5,$6,clock_timestamp())',[group,providerId,issuer,'android-beta',fixture.administrator.userId,fixture.administrator.userId]);
    provider.tokenOverrides={sub:'android-beta',name:'Synthetic second external clinician',email:'beta@example.test'};
    await instrument('login',{userId:fixture.administrator.userId,protected:'isolate',retainedSha256,reportId:report.id});
    assert.equal(await firstName(),'ANDROID-OIDC-PROTECTED','Another OIDC user cannot flush retained work');
    const [isolated]=await db.query('select recovery_deadline,ciphertext_revision from offline_recovery.report_key_envelope where report_id=$1',[report.id]);assert.deepEqual(isolated,pendingAuthority,'Revocation and another user cannot create a receipt or renew the frozen pending-work deadline');
    provider.personalProofMode='outage';await instrument('login',{expected:'failed'});provider.personalProofMode='fresh';
    await instrument('cancel');
    provider.tokenOverrides={sub:'android-unknown',name:'Synthetic external clinician',email:'android@example.test'};
    // Leave the provider page open while terminating the live clinical process.
    const child=spawn(adb,instrumentArgs('prepare'),{cwd:root,stdio:['ignore','pipe','pipe']});let output='';
    await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{child.kill();reject(new Error('OIDC did not reach its live process-loss checkpoint'));},180000);const collect=chunk=>{output+=chunk;process.stdout.write(chunk);if(output.includes('opentriage_phase=oidc-ready-for-process-kill')){clearTimeout(timeout);resolve();}};child.stdout.on('data',collect);child.stderr.on('data',collect);child.once('error',reject);child.once('exit',code=>{if(!output.includes('opentriage_phase=oidc-ready-for-process-kill')){clearTimeout(timeout);reject(new Error(`OIDC preparation exited early ${code}`));}});});
    assert(execFileSync(adb,['-s',serial,'shell','pidof','org.opentriage.development'],{encoding:'utf8',timeout:10000}).trim());
    runAdb(['-s',serial,'shell','am','force-stop','org.opentriage.development']);
    assert.equal(spawnSync(adb,['-s',serial,'shell','pidof','org.opentriage.development'],{encoding:'utf8',timeout:10000}).stdout.trim(),'');
    await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});
    await instrument('resume',{userId:fixture.clinician.userId,protected:'recover'});
    assert.equal(await firstName(),'ANDROID-OIDC-PENDING','Original OIDC login must actually synchronize the retained pending edit');
    const [afterPins]=await db.query('select form_version_id,catalog_release_id,validation_version_id from clinical.report where id=$1',[report.id]);assert.deepEqual(afterPins,pins);
    console.log('PASS actual native OIDC: independently trusted system browser, unknown/approved identity, shared-device user switching, native session cookie isolation, >5-minute current-login recovery/deadline and abrupt process-loss return');
  } catch(error) {
    try { await captureAndroidFailure({root,adb,serial,secrets:[fixture.administratorPassword,fixture.clinicianPassword]});error.androidFailureCaptured=true; }
    catch { console.error('OIDC native diagnostics unavailable; original failure retained'); }
    const states=await db.query(`select purpose,result,native_started_at is not null started,completed_at is not null completed,
      native_delivered_at is not null delivered from app_identity.oidc_personal_transaction order by created_at`);
    console.log('Synthetic OIDC failure',JSON.stringify({name:error?.name,message:error?.code==='ERR_ASSERTION'?error.message:'Fixture operation failed'}));
    console.log('Synthetic OIDC diagnostics',JSON.stringify({authorizationCount:provider?.authorizationCount,tokenCount:provider?.tokenCount,states}));
    if(process.env.ANDROID_OIDC_DEBUG_PAUSE==='1'){
      const debug='/tmp/android-006-oidc-debug.json',release='/tmp/android-006-oidc-debug.release';
      await rm(release,{force:true});
      await writeFile(debug,JSON.stringify({databaseUrl:fixture.databaseUrl,caPath:fixture.caPath,apiOrigin:fixture.origin,providerOrigin:provider?.origin}),{mode:0o600});
      console.log('Synthetic OIDC fixtures held for at most 180 seconds; inspect local debug file and create its release file to resume cleanup.');
      for(let i=0;i<180;i++){try{await readFile(release);break;}catch{}await new Promise(resolve=>setTimeout(resolve,1000));}
      await rm(debug,{force:true});await rm(release,{force:true});
    }
    throw error;
  } finally {
    for(const radio of ['wifi','data'])spawnSync(adb,['-s',serial,'shell','svc',radio,'enable'],{stdio:'inherit',timeout:15000});
    if(ownsManagement){try{certificate(true);}finally{spawnSync(adb,['-s',serial,'shell','dpm','remove-active-admin','org.opentriage.managementtest/.AdminReceiver'],{stdio:'inherit',timeout:15000});}}
    await provider?.close();await db.query("update app_identity.group_authentication_policy set mode='local' where group_id=$1",[fixture.organizationId]).catch(()=>{});await db.destroy();
  }
}
