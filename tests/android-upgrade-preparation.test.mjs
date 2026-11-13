import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import catalog from '@open-triage/contracts/config/android-releases.json' with {type:'json'};
import {upgradePreparationProfile,upgradePreparationReceipt,decodeUpgradePreparationReceipt,upgradeProbeCallNumber} from '../scripts/android/upgrade-policy-fixture.mjs';
import {assertUpgradeHarnessSource,assertFreshUpgradeTarget} from '../scripts/android/upgrade-harness-source.mjs';
test('historical preparation binds the complete immutable published A1 descriptor',()=>{
 const a=structuredClone(catalog.releases.find(entry=>entry.descriptor.versionCode===1).descriptor);
 assert.equal(upgradePreparationProfile(a),'historical-a1-text-v1');
 for(const field of ['sourceCommit','apkSha256','certificateSha256'])assert.throws(()=>upgradePreparationProfile({...a,[field]:'a'.repeat(64)}),/exact immutable/);
 assert.throws(()=>upgradePreparationProfile({...a,applicationId:'org.attacker.app'}),/exact immutable/);
 for(const versionCode of [2,3,99])assert.equal(upgradePreparationProfile({...a,versionCode}),'current');
});
test('historical receipt survives the actual adb-shell argument parsing category without shell syntax',()=>{
 const a=catalog.releases.find(entry=>entry.descriptor.versionCode===1).descriptor;
 const b={...catalog.releases.find(entry=>entry.descriptor.versionCode===2).descriptor,versionCode:3};
 const value=upgradePreparationReceipt(a,b);
 assert.match(value,/^[A-Za-z0-9_-]+$/,'Receipt must use only safe bare shell argument characters');
 const result=spawnSync('/bin/sh',['-c',`printf '%s' ${value}`],{encoding:'utf8'});
 assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,value);
 const fields=decodeUpgradePreparationReceipt(value);assert.equal(fields.length,8);
 for(const invalid of [value+'=',value+'|sh','a/b',Buffer.from('{}').toString('base64url'),Buffer.from(JSON.stringify(fields)+' ').toString('base64url')])assert.throws(()=>decodeUpgradePreparationReceipt(invalid));
 for(let index=0;index<8;index++){const changed=[...fields];changed[index]='invalid';assert.throws(()=>decodeUpgradePreparationReceipt(Buffer.from(JSON.stringify(changed)).toString('base64url')));}
});
test('public new-work probe identifiers stay independent of private retained call identifiers',()=>{
 const id='12000000-0000-4000-8000-000000000001',retained='ANDROID-RECOVERY-13000000-0000-4000-8000-000000000001';
 assert.equal((retained+'-UPGRADE').includes(retained),true,'Original fixture collision reproduces the privacy assertion failure');
 const probe=upgradeProbeCallNumber(id,retained);assert.equal(probe.includes(retained),false);assert(probe.includes(id));
 assert.throws(()=>upgradeProbeCallNumber(id,'UPGRADE-PROBE'),/Independent probe/);
 assert.throws(()=>upgradeProbeCallNumber('invalid',retained));
});
test('upgrade driver refuses existing or unknown production state before any fixture mutation',()=>{
 assertFreshUpgradeTarget({status:1,stdout:'',stderr:''});
 assert.throws(()=>assertFreshUpgradeTarget({status:0,stdout:'package:/data/app/org.opentriage.android/base.apk\n',stderr:''}),/Refusing/);
 for(const invalid of [{status:0,stdout:'',stderr:''},{status:2,stdout:'',stderr:''},{status:1,stdout:'',stderr:'device offline'},{status:null,signal:'SIGTERM',stdout:'',stderr:''},{status:1,error:new Error('spawn failed'),stdout:'',stderr:''}])assert.throws(()=>assertFreshUpgradeTarget(invalid));
});
test('separate harness provenance rejects all production and unknown path changes',()=>{
 const artifactSource='a'.repeat(40),testSource='b'.repeat(40);
 assertUpgradeHarnessSource({artifactSource,testSource:artifactSource,changedPaths:[]});
 const allowed=['scripts/android-release-upgrade.mjs','android/app/src/androidTest/java/org/opentriage/development/HistoricalUpgradePreparation.java','scripts/android/journey-cleanup.mjs','tests/android-journey-cleanup.test.mjs'];
 assertUpgradeHarnessSource({artifactSource,testSource,changedPaths:allowed});
 for(const path of ['apps/api/src/admin/android-upgrade-policy.service.ts','apps/web/app/android-client-policy.ts','packages/contracts/android-client-protocol.mjs','android/app/src/main/java/org/opentriage/development/TrustedConnection.java','android/app/build.gradle','scripts/unknown.mjs']){
  assert.throws(()=>assertUpgradeHarnessSource({artifactSource,testSource,changedPaths:[...allowed,path]}),/explicit test-only paths/);
 }
 assert.throws(()=>assertUpgradeHarnessSource({artifactSource,testSource,changedPaths:[]}),/test-only/);
 assert.throws(()=>assertUpgradeHarnessSource({artifactSource,testSource:artifactSource,changedPaths:allowed}),/no differences/);
});
test('actual Java profile selector rejects every non-A1/current/production/prepare boundary',()=>{
 const folder=mkdtempSync(join(tmpdir(),'android-upgrade-profile-'));
 const origin=catalog.releases.find(entry=>entry.descriptor.versionCode===1).descriptor;
 const replacement={...catalog.releases.find(entry=>entry.descriptor.versionCode===2).descriptor,versionCode:3,sourceCommit:'c1e426a12d9dcc8541ec2090fb787fa6972b9dd1'};
 const receipt=upgradePreparationReceipt(origin,replacement);
 const receiptFields=decodeUpgradePreparationReceipt(receipt),invalidReceipts=receiptFields.map((_,index)=>{const changed=[...receiptFields];changed[index]='invalid';return Buffer.from(JSON.stringify(changed)).toString('base64url');});
 invalidReceipts.push(receipt+'=',receipt+'|sh','a/b',Buffer.from('{}').toString('base64url'),Buffer.from(JSON.stringify(receiptFields)+' ').toString('base64url'));
 const invalidJava=invalidReceipts.map(value=>JSON.stringify(value)).join(',');
 const source=`package org.opentriage.development;
 public class ProfileBoundaries {
  static void denied(String profile,String app,long code,String phase,boolean upgrade) {
   try {HistoricalUpgradePreparation.enabled(profile,app,code,phase,upgrade);throw new AssertionError("invalid profile accepted");}
   catch(IllegalArgumentException expected) {}
  }
  public static void main(String[]args) throws Exception {
   if(!HistoricalUpgradePreparation.enabled("historical-a1-text-v1","org.opentriage.android",1,"prepare",true))throw new AssertionError();
   for(long version:new long[]{1,2,3})if(HistoricalUpgradePreparation.enabled("current","org.opentriage.android",version,"prepare",true))throw new AssertionError();
   denied("unknown","org.opentriage.android",1,"prepare",true);
   denied("historical-a1-text-v1","org.opentriage.development",1,"prepare",true);
   for(long version:new long[]{0,2,3})denied("historical-a1-text-v1","org.opentriage.android",version,"prepare",true);
   for(String phase:new String[]{"offline","recover",null})denied("historical-a1-text-v1","org.opentriage.android",1,phase,true);
   denied("historical-a1-text-v1","org.opentriage.android",1,"prepare",false);
   String receipt=${JSON.stringify(receipt)};
   if(!HistoricalUpgradePreparation.prepareReceipt("historical-a1-text-v1",receipt,"org.opentriage.android",1,"prepare",true).equals(receipt))throw new AssertionError();
   if(!HistoricalUpgradePreparation.recovered("historical-a1-text-v1",receipt,receipt,"org.opentriage.android",3,"recover",true))throw new AssertionError();
   if(!HistoricalUpgradePreparation.recovered("historical-a1-text-v1",receipt,receipt,"org.opentriage.android",3,"post-upgrade-photo",true))throw new AssertionError();
   if(HistoricalUpgradePreparation.recovered("current","","","org.opentriage.development",1,"recover",false))throw new AssertionError();
   for(String bad:new String[]{${invalidJava}})expectDenied(()->HistoricalUpgradePreparation.recovered("historical-a1-text-v1",bad,bad,"org.opentriage.android",3,"recover",true));
   expectDenied(()->HistoricalUpgradePreparation.prepareReceipt("current",receipt,"org.opentriage.android",1,"prepare",true));
   expectDenied(()->HistoricalUpgradePreparation.recovered("historical-a1-text-v1","",receipt,"org.opentriage.android",3,"recover",true));
   expectDenied(()->HistoricalUpgradePreparation.recovered("historical-a1-text-v1",receipt,receipt,"org.opentriage.android",1,"recover",true));
   expectDenied(()->HistoricalUpgradePreparation.recovered("historical-a1-text-v1",receipt,receipt,"org.opentriage.android",4,"recover",true));
   expectDenied(()->HistoricalUpgradePreparation.recovered("historical-a1-text-v1",receipt,receipt,"org.opentriage.development",3,"recover",true));
   expectDenied(()->HistoricalUpgradePreparation.recovered("historical-a1-text-v1",receipt,receipt,"org.opentriage.android",3,"offline",true));
   expectDenied(()->HistoricalUpgradePreparation.recovered("historical-a1-text-v1",receipt,receipt,"org.opentriage.android",3,"recover",false));
   expectDenied(()->HistoricalUpgradePreparation.recovered("current",receipt,receipt,"org.opentriage.android",3,"recover",true));
   String hash=UpgradeSessionProof.cookieHash("synthetic-cookie",101,"https://fixture.test"),csrf="a".repeat(43),oidc="b".repeat(43);
   if(!csrf.equals(UpgradeSessionProof.csrf(null,csrf,"user","user","org","org",hash,hash,101,101)))throw new AssertionError("local original CSRF lost");
   if(!oidc.equals(UpgradeSessionProof.csrf(oidc,csrf,"user","user","org","org",hash,hash,101,101)))throw new AssertionError("OIDC current CSRF lost");
   expectDenied(()->UpgradeSessionProof.csrf(null,csrf,"other","user","org","org",hash,hash,101,101));
   expectDenied(()->UpgradeSessionProof.csrf(null,csrf,"user","user","other","org",hash,hash,101,101));
   expectDenied(()->UpgradeSessionProof.csrf(null,csrf,"user","user","org","org",hash,"0".repeat(64),101,101));
   expectDenied(()->UpgradeSessionProof.csrf(oidc,csrf,"user","user","org","org",hash,"0".repeat(64),101,101));
   expectDenied(()->UpgradeSessionProof.csrf(null,csrf,"user","user","org","org",hash,hash,102,101));
   expectDenied(()->UpgradeSessionProof.csrf(null,null,"user","user","org","org",hash,hash,101,101));
   expectDenied(()->UpgradeSessionProof.csrf("invalid",csrf,"user","user","org","org",hash,hash,101,101));

  }
  static void expectDenied(Runnable action) {try {action.run();throw new AssertionError("invalid receipt accepted");}catch(IllegalArgumentException expected){}}
 }`;
 try{
  const harness=join(folder,'ProfileBoundaries.java');writeFileSync(harness,source);
  const java=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name):name;
  for(const [command,args] of [[java('javac'),['-d',folder,resolve('android/app/src/androidTest/java/org/opentriage/development/HistoricalUpgradePreparation.java'),resolve('android/app/src/androidTest/java/org/opentriage/development/UpgradeSessionProof.java'),harness]],[java('java'),['-cp',folder,'org.opentriage.development.ProfileBoundaries']]]){
   const result=spawnSync(command,args,{encoding:'utf8',timeout:30000});assert.equal(result.error,undefined);assert.equal(result.status,0,result.stdout+result.stderr);
  }
 }finally{rmSync(folder,{recursive:true,force:true});}
});

test('upgrade snapshot accepts cached and bundled local UI while rejecting remote origins',()=>{
 const java=readFileSync('android/app/src/androidTest/java/org/opentriage/development/ReportRecoveryJourneyTest.java','utf8');
 const snapshot=java.split('private void snapshotUpgrade()')[1].split('private void ')[0];
 const expression=/assertEquals\("true", evaluate\("(location\.origin[^"\n]+)"\)\);/.exec(snapshot)?.[1];
 assert(expression,'Execute the actual native upgrade-origin assertion');
 for(const controller of [null,{scriptURL:'https://localhost/sw.js'}]){
  for(const origin of ['https://localhost','https://remote.example.test','http://localhost']){
   const actual=runInNewContext(expression,{location:{origin},navigator:{serviceWorker:{controller}}});
   assert.equal(actual,origin==='https://localhost',`Origin ${origin}, worker ${Boolean(controller)}`);
  }
 }
});

test('native recovery waits for usable sign-in rather than the intermediate logout form',()=>{
 const java=readFileSync('android/app/src/androidTest/java/org/opentriage/development/ReportRecoveryJourneyTest.java','utf8');
 const expression=/LOGIN_READY = "([^"\n]+)"/.exec(java)?.[1];assert(expression);
 for(const [input,button,disabled,ready]of [[false,false,false,false],[true,false,false,false],[true,true,true,false],[true,true,false,true]]){
  const document={querySelector:selector=>selector.startsWith('input')?(input?{}:null):(button?{disabled}:null)};
  assert.equal(Boolean(runInNewContext(expression,{document})),ready);
 }
 const login=java.split('private void signIn(')[1].split('private void ')[0];assert(login.includes('waitFor(LOGIN_READY)'));
 const other=java.split('private void differentClinician()')[1].split('private void ')[0];
 assert(other.includes('click("Log out"); waitFor(LOGIN_READY)'));
 assert(other.includes('vault.personalContinuation()'));assert(other.includes('loggedOutCookies'));
});
