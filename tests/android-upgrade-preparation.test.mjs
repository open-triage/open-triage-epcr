import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import catalog from '@open-triage/contracts/config/android-releases.json' with {type:'json'};
import {upgradePreparationProfile} from '../scripts/android/upgrade-policy-fixture.mjs';
import {assertUpgradeHarnessSource} from '../scripts/android/upgrade-harness-source.mjs';
test('historical preparation binds the complete immutable published A1 descriptor',()=>{
 const a=structuredClone(catalog.releases.find(entry=>entry.descriptor.versionCode===1).descriptor);
 assert.equal(upgradePreparationProfile(a),'historical-a1-camera-v1');
 for(const field of ['sourceCommit','apkSha256','certificateSha256'])assert.throws(()=>upgradePreparationProfile({...a,[field]:'a'.repeat(64)}),/exact immutable/);
 assert.throws(()=>upgradePreparationProfile({...a,applicationId:'org.attacker.app'}),/exact immutable/);
 for(const versionCode of [2,3,99])assert.equal(upgradePreparationProfile({...a,versionCode}),'current');
});
test('separate harness provenance rejects all production and unknown path changes',()=>{
 const artifactSource='a'.repeat(40),testSource='b'.repeat(40);
 assertUpgradeHarnessSource({artifactSource,testSource:artifactSource,changedPaths:[]});
 const allowed=['scripts/android-release-upgrade.mjs','android/app/src/androidTest/java/org/opentriage/development/HistoricalUpgradePreparation.java'];
 assertUpgradeHarnessSource({artifactSource,testSource,changedPaths:allowed});
 for(const path of ['apps/api/src/admin/android-upgrade-policy.service.ts','apps/web/app/android-client-policy.ts','packages/contracts/android-client-protocol.mjs','android/app/src/main/java/org/opentriage/development/TrustedConnection.java','android/app/build.gradle','scripts/unknown.mjs']){
  assert.throws(()=>assertUpgradeHarnessSource({artifactSource,testSource,changedPaths:[...allowed,path]}),/explicit test-only paths/);
 }
 assert.throws(()=>assertUpgradeHarnessSource({artifactSource,testSource,changedPaths:[]}),/test-only/);
 assert.throws(()=>assertUpgradeHarnessSource({artifactSource,testSource:artifactSource,changedPaths:allowed}),/no differences/);
});
test('actual Java profile selector rejects every non-A1/current/production/prepare boundary',()=>{
 const folder=mkdtempSync(join(tmpdir(),'android-upgrade-profile-'));
 const source=`package org.opentriage.development;
 public class ProfileBoundaries {
  static void denied(String profile,String app,long code,String phase,boolean upgrade) {
   try {HistoricalUpgradePreparation.enabled(profile,app,code,phase,upgrade);throw new AssertionError("invalid profile accepted");}
   catch(IllegalArgumentException expected) {}
  }
  public static void main(String[]args) {
   if(!HistoricalUpgradePreparation.enabled("historical-a1-camera-v1","org.opentriage.android",1,"prepare",true))throw new AssertionError();
   for(long version:new long[]{1,2,3})if(HistoricalUpgradePreparation.enabled("current","org.opentriage.android",version,"prepare",true))throw new AssertionError();
   denied("unknown","org.opentriage.android",1,"prepare",true);
   denied("historical-a1-camera-v1","org.opentriage.development",1,"prepare",true);
   for(long version:new long[]{0,2,3})denied("historical-a1-camera-v1","org.opentriage.android",version,"prepare",true);
   for(String phase:new String[]{"offline","recover",null})denied("historical-a1-camera-v1","org.opentriage.android",1,phase,true);
   denied("historical-a1-camera-v1","org.opentriage.android",1,"prepare",false);
  }
 }`;
 try{
  const harness=join(folder,'ProfileBoundaries.java');writeFileSync(harness,source);
  const java=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name):name;
  for(const [command,args] of [[java('javac'),['-d',folder,resolve('android/app/src/androidTest/java/org/opentriage/development/HistoricalUpgradePreparation.java'),harness]],[java('java'),['-cp',folder,'org.opentriage.development.ProfileBoundaries']]]){
   const result=spawnSync(command,args,{encoding:'utf8',timeout:30000});assert.equal(result.error,undefined);assert.equal(result.status,0,result.stdout+result.stderr);
  }
 }finally{rmSync(folder,{recursive:true,force:true});}
});
