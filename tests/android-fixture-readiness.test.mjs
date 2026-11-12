import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {enrollmentBoundaryFixture} from '../scripts/android/enrollment-boundary-fixture.mjs';

test('enrollment fixture records bounded real HTTP completion statuses using only fixed route labels',()=>{
 const fixture=enrollmentBoundaryFixture();
 const request=(method,url,status)=>{const response=new EventEmitter();response.statusCode=status;let next=0;fixture.middleware({method,url,headers:{cookie:'PRIVATE_COOKIE'},body:{token:'PRIVATE_TOKEN'}},response,()=>next++);assert.equal(next,1);response.emit('finish');};
 request('GET','/api/health?private=PRIVATE_QUERY',200);request('GET','/api/installations/current',200);request('POST','/api/installations/preview',401);request('POST','/api/sessions',503);
 assert.deepEqual(fixture.snapshot(),{health:{count:1,statuses:[200]},current:{count:1,statuses:[200]},preview:{count:1,statuses:[401]}});
 for(let i=0;i<100;i++)request('POST','/api/installations/preview',201);
 const value=fixture.snapshot();assert.equal(value.preview.count,101);assert.equal(value.preview.statuses.length,32);assert.doesNotMatch(JSON.stringify(value),/PRIVATE_|https?:|cookie|token|\/api\//);
 value.preview.statuses.push(599);assert.equal(fixture.snapshot().preview.statuses.length,32);
});

test('initial preparation and resumed pairing prove actual transport readiness before a single UI pairing attempt; persistent failure is bounded',()=>{
 const java=readFileSync(new URL('../android/app/src/androidTest/java/org/opentriage/development/ReportRecoveryJourneyTest.java',import.meta.url),'utf8');
 assert.match(java,/phase\.equals\("prepare"\) \|\| phase\.equals\("reassign"\) \|\| phase\.equals\("resume-reassignment"\)/);
 const method=java.slice(java.indexOf('@Test public void realProcessRecovery'));
 assert(method.indexOf('AndroidFixtureNetwork.await')<method.indexOf('ActivityScenario.launch'));
 const prepare=java.slice(java.indexOf('private void prepare()'),java.indexOf('private void prepare()')+4000);
 assert(prepare.indexOf("(window.Capacitor,'preview')")<prepare.indexOf('AndroidUiInput.importPairing'));
 const directory=mkdtempSync(join(tmpdir(),'android-fixture-ready-')),binary=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name):name;
 try {
  const source=join(directory,'Readiness.java');writeFileSync(source,`package org.opentriage.development;
  public class Readiness {
   static void check(boolean value){if(!value)throw new AssertionError("Readiness boundary failed");}
   public static void main(String[]args)throws Exception{
    long[]time={0};int[]probes={0};
    TransportReadiness.await(true,timeout->new TransportReadiness.Sample(null,true,++probes[0]>=3,"network",null,null),()->time[0],millis->time[0]+=millis,1000);
    check(probes[0]==3&&time[0]==200);
    time[0]=0;probes[0]=0;boolean denied=false;
    try{TransportReadiness.await(true,timeout->{probes[0]++;time[0]+=timeout;return new TransportReadiness.Sample(null,true,false,"network","ConnectException","unreachable");},()->time[0],millis->time[0]+=millis,1000);}catch(AssertionError failure){denied=true;check(failure.getMessage().contains("reachable=false"));}
    check(denied&&time[0]==1000&&probes[0]>0);
   }
  }`);
  const compiled=spawnSync(binary('javac'),['-d',directory,resolve('android/app/src/testSupport/java/org/opentriage/development/TransportReadiness.java'),source],{encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
  const ran=spawnSync(binary('java'),['-cp',directory,'org.opentriage.development.Readiness'],{encoding:'utf8',timeout:30000});assert.equal(ran.status,0,ran.stderr);
 } finally {rmSync(directory,{recursive:true,force:true});}
});
