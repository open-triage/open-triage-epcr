import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import catalog from '@open-triage/contracts/config/android-releases.json' with {type:'json'};
import {ANDROID_CLIENT_REQUIRED_CAPABILITIES} from '@open-triage/contracts/android-client-protocol';
import {verifyAndroidArtifact} from '@open-triage/contracts/android-artifact';
import {upgradePolicyFixture} from '../scripts/android/upgrade-policy-fixture.mjs';
async function fixture(work){
 const directory=await mkdtemp(join(tmpdir(),'android-upgrade-fixture-'));
 try{
  const bytes=Buffer.from('Synthetic APK byte-verifier fixture'),hash=createHash('sha256').update(bytes).digest('hex'),apkBPath=join(directory,'candidate.apk');await writeFile(apkBPath,bytes);
  const a=structuredClone(catalog.releases.find(entry=>entry.descriptor.versionCode===1).descriptor);
  const b={...structuredClone(catalog.releases.find(entry=>entry.descriptor.versionCode===2).descriptor),versionCode:3,versionName:'0.1.0-rc.3',apkSha256:hash,apkBytes:bytes.length,artifact:`opentriage-0.1.0-rc.3-3-${hash}.apk`};
  b.compatibility.requiredCapabilities=[...ANDROID_CLIENT_REQUIRED_CAPABILITIES];
  return await work({releaseA:a,releaseB:b,apkBPath},bytes);
 }finally{await rm(directory,{recursive:true,force:true});}
}
test('upgrade fixture registers exact new B without rewriting immutable A and verifies real supplied bytes through the production verifier',()=>fixture(async(input)=>{
 const original=JSON.stringify(catalog),f=await upgradePolicyFixture(input),entry=f.approved.releases.find(entry=>entry.descriptor.versionCode===3);
 assert.deepEqual(f.approved.releases.find(entry=>entry.descriptor.versionCode===1).descriptor,input.releaseA);
 assert.deepEqual(entry.descriptor,input.releaseB);assert.equal(JSON.stringify(catalog),original);
 await verifyAndroidArtifact(entry.downloadUrl,input.releaseB.apkBytes,input.releaseB.apkSha256,f.fetcher);
 assert.deepEqual(f.lifecycle,{schemaVersion:1,retirements:[]});f.retire();f.retire();assert.equal(f.lifecycle.retirements.length,1);assert.equal(f.lifecycle.retirements[0].versionCode,1);
 await assert.rejects(f.fetcher('https://attacker.invalid/test'),/exact approved replacement/);
}));
test('upgrade fixture rejects descriptor changes, missing gate support and any byte/identity mismatch',()=>fixture(async(input)=>{
 for(const change of [value=>value.releaseA.apkSha256='a'.repeat(64),value=>value.releaseB.certificateSha256='b'.repeat(64),value=>value.releaseB.compatibility.requiredCapabilities=[],value=>value.releaseB.apkBytes++,value=>value.releaseB.apkSha256='c'.repeat(64)]){
  const changed=structuredClone(input);change(changed);await assert.rejects(upgradePolicyFixture(changed));
 }
}));
test('new gate acceptance uses the deployed policy service, original recovery assertions and actual Package Installer abandonment',async()=>{
 const api=await readFile(new URL('../scripts/android/fixture-api.mjs',import.meta.url),'utf8'),runner=await readFile(new URL('../scripts/android-release-upgrade.mjs',import.meta.url),'utf8');
 assert.match(api,/ANDROID_RELEASE_CATALOG,useValue:upgradeAcceptance.approved/);
 assert.match(api,/ANDROID_RELEASE_LIFECYCLE,useValue:upgradeAcceptance.lifecycle/);
 assert.match(api,/ANDROID_RELEASE_FETCH,useValue:upgradeAcceptance.fetcher/);
 assert.match(runner,/policyInstrument\(a.versionCode,426,true\)/);assert.match(runner,/policyInstrument\(b.versionCode,200\)/);
 assert.match(runner,/'install-create'/);assert.match(runner,/'install-write'/);assert.match(runner,/'install-abandon'/);
 assert.match(runner,/requiredUpgradeGateAssertions/);assert.match(runner,/runReportRecoveryJourney/);
});
