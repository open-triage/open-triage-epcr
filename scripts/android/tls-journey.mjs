import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { setFixtureTls, observeFixtureTls } from './tls-fixture-control.mjs';
import { runReportRecoveryJourney } from './report-journey.mjs';
import { captureAndroidFailure, redactAndroidDiagnostics } from './diagnostics.mjs';
import { startLiveInstrumentation } from './live-instrumentation.mjs';
import { stopFixtureChild } from './fixture-processes.mjs';

/** One generic APK, one API/database and real retained clinical work across TLS changes. */
export async function runTlsJourney({ root, fixture, material, child, adb, serial, run, api }) {
  assert(child, 'TLS acceptance requires a harness-owned API with host-only IPC control.');
  const originalCaPath=fixture.caPath;
  let ownsManagement=false;
  let finalAdminHeaders,issueCurrent;
  let livePending;
  const argumentsFor=(phase,extra={})=>{
    const args=['-s',serial,'shell','am','instrument','-w','-r','-e','class','org.opentriage.development.TlsRotationJourneyTest','-e','tlsPhase',phase];
    for(const [key,value] of Object.entries(extra))args.push('-e',key,String(value));
    args.push('org.opentriage.development.test/androidx.test.runner.AndroidJUnitRunner');
    return args;
  };
  const sanitize=(output,extra)=>redactAndroidDiagnostics(String(output),Object.entries(extra).filter(([key])=>/artifact/i.test(key)).map(([,value])=>value));
  const instrument=(phase,extra={})=>{
    const args=argumentsFor(phase,extra);
    const result=spawnSync(adb,args,{cwd:root,encoding:'utf8',timeout:600000});
    const output=redactAndroidDiagnostics(String(result.stdout??'')+'\n'+String(result.stderr??''),Object.entries(extra).filter(([key])=>/artifact/i.test(key)).map(([,value])=>value));
    console.log(output);assert.equal(result.status,0,`Actual TLS phase ${phase} child failed (${result.signal??'nonzero exit'})`);
    assert.match(output,/OK \(1 test\)/,`Actual TLS phase ${phase}`);
    return output;
  };
  const stop=()=>run(adb,['-s',serial,'shell','am','force-stop','org.opentriage.development']);
  const radios=value=>{for(const radio of ['wifi','data'])run(adb,['-s',serial,'shell','svc',radio,value]);};
  try {
    await setFixtureTls(child,'first');fixture.caPath=material.first.caPath;
    await runReportRecoveryJourney({root,fixture,adb,serial,run,api,audio:true,unsavedAudio:true,hooks:{
      prepareArguments:{tlsChecks:'1'},
      beforeProcessKill:async()=>{
        await setFixtureTls(child,'renewed');
        console.log('PASS host TLS renewal: changed server leaf under unchanged approved CA; live native process and encrypted work retained');
      },
      beforeSessionWithdrawal:async()=>{
        radios('enable');
        try {instrument('renewal-proof');}
        finally {radios('disable');}
        console.log('PASS native same-CA renewal: original valid personal login and installation cookie work without sign-in, re-pairing or trust edits');
      },
      beforeReconnect:async({retainedSha256,adminHeaders,setHostCa,db})=>{
        finalAdminHeaders=adminHeaders;
        stop();radios('enable');
        for(const variant of ['wrong-host','expired','replacement']) {
          const before=await setFixtureTls(child,variant);
          instrument('failure',{retainedSha256});stop();
          const after=await observeFixtureTls(child);
          assert.equal(after.acceptedRequests,before.acceptedRequests,`${variant}: failed TLS must accept zero application requests`);
          console.log(`PASS native ${variant}: verified transport rejection, zero accepted API requests and exact retained encrypted work`);
        }
        // Simulate an already-expired saved public CA using only test instrumentation.
        // Production has no setter or expiry bypass: import still rejects this CA.
        instrument('expired-trust',{expiredCaBase64:Buffer.from(material.expiredTrustCa).toString('base64')});stop();
        const expiredBefore=await observeFixtureTls(child);instrument('failure',{retainedSha256});stop();
        assert.equal((await observeFixtureTls(child)).acceptedRequests,expiredBefore.acceptedRequests,'Expired saved trust cannot send a request');
        const newCa=Buffer.from(material.replacement.ca);fixture.caPath=material.replacement.caPath;setHostCa(newCa);
        const issue=async caPem=>{
          const response=await api(fixture,await readFile(fixture.caPath),`admin/units/${fixture.unitId}/enrollment`,'POST',{},adminHeaders);
          assert.equal(response.status,201);
          return {version:1,...response.body,caPem};
        };
        issueCurrent=issue;
        const manual=await issue(material.replacement.ca);
        const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64');
        instrument('preview',{artifactBase64:encode(manual),retainedSha256});stop();
        instrument('failure',{retainedSha256});stop();
        instrument('replace',{artifactBase64:encode(manual),retainedSha256});stop();
        console.log('PASS explicit manual CA replacement: expired prior trust, interrupted preview, confirmed new trust and exact retained work');

        const pendingTransition=async(from,to,managed=false)=>{
          const original=await issue(material[from].ca);
          const armed=await api(fixture,await readFile(fixture.caPath),'__android-enrollment-drop-arm','POST',{},adminHeaders);assert.equal(armed.body.armed,true);
          const extra={artifactBase64:encode(original),retainedSha256};
          livePending=startLiveInstrumentation(adb,argumentsFor('pending-live',extra),{cwd:root,checkpoint:'opentriage_phase=pending-confirmation-ready',redact:output=>sanitize(output,extra)});
          const prepared=await livePending.ready;console.log(prepared);
          const tokenHash=/pending_token_sha256=([a-f0-9]{64})/.exec(prepared)?.[1],intent=/pending_intent_sha256=([a-f0-9]{64})/.exec(prepared)?.[1];assert(tokenHash&&intent);
          const pid=execFileSync(adb,['-s',serial,'shell','pidof','org.opentriage.development'],{encoding:'utf8'}).trim();assert(pid,'Ambiguous confirmation must leave a live process before host termination');stop();
          let closeTimer;
          try {await Promise.race([livePending.closed,new Promise((_,reject)=>{closeTimer=setTimeout(()=>reject(new Error('Pending instrumentation did not close after host process kill')),30000);})]);}
          finally {clearTimeout(closeTimer);}
          livePending=null;
          assert.equal(spawnSync(adb,['-s',serial,'shell','pidof','org.opentriage.development'],{encoding:'utf8'}).stdout.trim(),'');
          assert.equal((await api(fixture,await readFile(fixture.caPath),'__android-enrollment-drop-release','POST',{},adminHeaders)).body.released,true);
          const aged=await db.query(`update app_identity.unit_enrollment set issued_at=clock_timestamp()-interval '30 minutes',expires_at=clock_timestamp()-interval '25 minutes',consumed_at=clock_timestamp()-interval '27 minutes'
            where token_sha256=$1 and consumed_at is not null returning installation_id`,[tokenHash]);assert.equal(aged.rowCount,1);
          const rowsBefore=(await db.query('select count(*) n from app_identity.installation_registration where unit_id=$1',[fixture.unitId])).rows[0].n;
          await setFixtureTls(child,to);fixture.caPath=material[to].caPath;setHostCa(Buffer.from(material[to].ca));
          const freshTrust=await issue(material[to].ca),args={artifactBase64:encode(freshTrust),retainedSha256,pendingIntentSha256:intent};
          if(managed){instrument('pending-policy',args);stop();}
          const before=await observeFixtureTls(child);instrument('pending-blocked',args);stop();
          assert.equal((await observeFixtureTls(child)).acceptedRequests,before.acceptedRequests,'Old pending trust cannot send an accepted request');
          instrument('pending-trust',args);stop();instrument('pending-retry',args);stop();
          assert.equal((await db.query('select count(*) n from app_identity.installation_registration where unit_id=$1',[fixture.unitId])).rows[0].n,rowsBefore,'Derived live-result proof creates no registration or second rotation');
          assert.equal((await db.query('select consumed_at<clock_timestamp()-interval \'15 minutes\' old from app_identity.unit_enrollment where token_sha256=$1',[tokenHash])).rows[0].old,true);
          console.log(`PASS ${managed?'managed':'manual'} ambiguous confirmation: committed reply loss, actual process kill, expired POST retry, explicit CA-only journal update, immutable intent and derived live-result proof without issuance`);
          return freshTrust;
        };
        const currentManual=await pendingTransition('replacement','first');

        run(adb,['-s',serial,'shell','dpm','set-device-owner','org.opentriage.managementtest/.AdminReceiver']);ownsManagement=true;
        instrument('managed-establish',{artifactBase64:encode(currentManual),retainedSha256});stop();
        await setFixtureTls(child,'replacement');fixture.caPath=material.replacement.caPath;setHostCa(Buffer.from(material.replacement.ca));
        const overlap=await issue(material.replacement.ca+material.first.ca);
        const blockedBefore=await observeFixtureTls(child);
        instrument('managed-conflict',{artifactBase64:encode(overlap),oldArtifactBase64:encode(currentManual),retainedSha256});stop();
        assert.equal((await observeFixtureTls(child)).acceptedRequests,blockedBefore.acceptedRequests,'Managed mismatch must reject before accepting API traffic');
        instrument('managed-replace',{artifactBase64:encode(overlap),oldArtifactBase64:encode(currentManual),retainedSha256});stop();
        const newOnly=await issue(material.replacement.ca);
        instrument('managed-replace',{artifactBase64:encode(newOnly),oldArtifactBase64:encode(overlap),retainedSha256});stop();
        console.log('PASS managed CA replacement: old endpoint trust gone, authoritative overlap then new-only roots, manual mismatch denied and exact ciphertext retained');
        await pendingTransition('replacement','first',true);
        await pendingTransition('first','replacement',true);

        const uncommitted=await issue(material.replacement.ca),countBefore=(await db.query('select count(*) n from app_identity.installation_registration where unit_id=$1',[fixture.unitId])).rows[0].n;
        const offline=instrument('pending-offline',{artifactBase64:encode(uncommitted),retainedSha256});stop();radios('enable');
        const uncommittedHash=/pending_token_sha256=([a-f0-9]{64})/.exec(offline)?.[1],uncommittedIntent=/pending_intent_sha256=([a-f0-9]{64})/.exec(offline)?.[1];assert(uncommittedHash&&uncommittedIntent);
        const expired=await db.query(`update app_identity.unit_enrollment set issued_at=clock_timestamp()-interval '10 minutes',expires_at=clock_timestamp()-interval '5 minutes' where token_sha256=$1 and consumed_at is null returning id`,[uncommittedHash]);assert.equal(expired.rowCount,1);
        const check={retainedSha256,pendingIntentSha256:uncommittedIntent};await setFixtureTls(child,'replacement-outcome-missing');
        instrument('pending-unavailable',check);stop();assert.equal((await db.query('select count(*) n from app_identity.installation_registration where unit_id=$1',[fixture.unitId])).rows[0].n,countBefore);
        await setFixtureTls(child,'replacement');instrument('pending-not-committed',check);stop();
        assert.equal((await db.query('select count(*) n from app_identity.installation_registration where unit_id=$1',[fixture.unitId])).rows[0].n,countBefore);
        console.log('PASS pending outcome: missing endpoint keeps immutable journal locked; only proved expired/unconsumed code permits explicit new-code flow, without losing ciphertext');
      },
    }});
    console.log('PASS complete same-APK TLS lifecycle: renewal, rejected invalid TLS, manual/managed replacement, original authorized recovery/sync and unchanged pin/deadline rules');
    const ca=await readFile(fixture.caPath),before=await api(fixture,ca,`admin/units/${fixture.unitId}/installations`,'GET',undefined,finalAdminHeaders);assert.equal(before.status,200);
    const ids=new Set(before.body.items.map(value=>value.id)),revokedArtifact=await issueCurrent(material.replacement.ca);
    assert.equal((await api(fixture,ca,'__android-enrollment-drop-arm','POST',{},finalAdminHeaders)).body.armed,true);
    const revokedPending=instrument('pending',{artifactBase64:Buffer.from(JSON.stringify(revokedArtifact)).toString('base64')});stop();
    assert.equal((await api(fixture,ca,'__android-enrollment-drop-release','POST',{},finalAdminHeaders)).body.released,true);
    const retained=/retained_sha256=([a-f0-9]{64})/.exec(revokedPending)?.[1],intent=/pending_intent_sha256=([a-f0-9]{64})/.exec(revokedPending)?.[1];assert(retained&&intent);
    const after=await api(fixture,ca,`admin/units/${fixture.unitId}/installations`,'GET',undefined,finalAdminHeaders),added=after.body.items.filter(value=>!ids.has(value.id));assert.equal(added.length,1);
    assert.equal((await api(fixture,ca,`admin/units/${fixture.unitId}/installations/${added[0].id}/revoke`,'POST',{},finalAdminHeaders)).body.revoked,true);
    instrument('pending-unavailable',{retainedSha256:retained,pendingIntentSha256:intent});stop();
    console.log('PASS revoked ambiguous result remains blocked recovery material with its exact retained ciphertext and immutable journal; no silent reset');
  } catch(error) {
    try { await captureAndroidFailure({root,adb,serial,secrets:[fixture.administratorPassword,fixture.clinicianPassword]}); }
    catch { console.error('Android TLS failure diagnostics unavailable'); }
    throw error;
  } finally {
    stop();radios('enable');
    if(livePending)await stopFixtureChild(livePending.child);
    if(ownsManagement) {
      spawnSync(adb,['-s',serial,'shell','am','broadcast','--include-stopped-packages','-a','org.opentriage.managementtest.SET_CONFIGURATION','-n','org.opentriage.managementtest/.ConfigurationReceiver','--es','configurationBase64',Buffer.from('{}').toString('base64')],{stdio:'inherit'});
      spawnSync(adb,['-s',serial,'shell','dpm','remove-active-admin','org.opentriage.managementtest/.AdminReceiver'],{stdio:'inherit'});
    }
    fixture.caPath=originalCaPath;await setFixtureTls(child,'baseline');
  }
}
