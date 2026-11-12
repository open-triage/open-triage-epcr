import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {androidTestScope} from '../scripts/android/test-scope.mjs';
import {observeNativePdfCalls} from '../scripts/android/pdf-native-observer.mjs';
import {pdfDownloadFixture,pdfMediaHoldFixture} from '../scripts/android/pdf-download-fixture.mjs';

test('default Android acceptance retains every stage and focused clinical diagnosis has an explicit non-combinable scope',()=>{
 const full=androidTestScope(['--skip-build']);assert.equal(full.focusedPdfClinical,false);
 for(const[key,enabled]of Object.entries(full))if(key!=='focusedPdfClinical')assert.equal(enabled,true,key);
 const focused=androidTestScope(['--skip-build','--pdf-clinical-only']);assert.equal(focused.focusedPdfClinical,true);
 for(const[key,enabled]of Object.entries(focused))if(key!=='focusedPdfClinical')assert.equal(enabled,false,key);
 for(const mode of ['--tls-only','--oidc-only','--agency-only','--report-only','--external-apis','--skip-oidc'])assert.throws(()=>androidTestScope(['--pdf-clinical-only',mode]),/cannot be combined/);
 const runner=readFileSync(new URL('../scripts/android-emulator-test.mjs',import.meta.url),'utf8');
 assert.match(runner,/if\(scope.startupAndComponents\)\{[\s\S]*?LegacyConnectionVaultTest[\s\S]*?nativeStartupArguments[\s\S]*?runNativePdfJourney[\s\S]*?\n  \}/);
 assert.match(runner,/if \(scope.pairing &&[^\n]*for \(const fixture of fixtures\)/);
 assert.match(runner,/else if \(!tlsOnly[^\n]*\{\n    await runReportRecoveryJourney\([^\n]*audio: true, signReview: true/);
 assert.match(runner,/if\(scope.managed\) await runManagedJourneys/);
 assert.match(runner,/if\(scope.tls\)\{\n[^\n]*await runTlsJourney/);
 assert.match(runner,/if \(scope.agencyAndOidc && !tlsOnly\) \{[\s\S]*?runAgencyHandoffJourney[\s\S]*?runOidcJourney/);
});

test('observer sees actual Capacitor registerPlugin dispatch and preserves original promise/results without retaining options',async()=>{
 const before={Capacitor:globalThis.Capacitor,androidBridge:globalThis.androidBridge};const reply={opened:false,status:503,code:'pdf.unavailable',private:'do-not-record'};const originalPromise=Promise.resolve(reply);const invocations=[];
 const original=function(...args){invocations.push({receiver:this,args});return originalPromise;};
 globalThis.androidBridge={};globalThis.Capacitor={nativePromise:original,PluginHeaders:[{name:'OpenTriageConnection',methods:[{name:'openPdf',rtype:'promise'},{name:'closePdf',rtype:'promise'}]}]};
 try{
  const{Capacitor,registerPlugin}=await import('@capacitor/core');const observation=observeNativePdfCalls(Capacitor),plugin=registerPlugin('OpenTriageConnection');
  const options={path:'PRIVATE_PATH',headers:{'x-csrf-token':'PRIVATE_CSRF'},body:'PRIVATE_BODY'};
  assert.equal(await plugin.openPdf(options),reply);assert.equal(observation.total,1);assert.equal(invocations.length,1);assert.equal(invocations[0].receiver,Capacitor);assert.equal(invocations[0].args[2],options);
  assert.equal(Capacitor.nativePromise('OpenTriageConnection','openPdf',options),originalPromise);await originalPromise;
  assert.equal(await plugin.closePdf({operationId:'PRIVATE_ID'}),reply);assert.equal(observation.closes,1);
  assert.deepEqual(observation.calls[0],{settled:true,opened:false,status:503,code:'pdf.unavailable'});assert.doesNotMatch(JSON.stringify(observation),/PRIVATE_|do-not-record/);
  observation.restore();assert.equal(Capacitor.nativePromise,original);
 }finally{if(before.Capacitor===undefined)delete globalThis.Capacitor;else globalThis.Capacitor=before.Capacitor;if(before.androidBridge===undefined)delete globalThis.androidBridge;else globalThis.androidBridge=before.androidBridge;}
});
test('native rejection remains the identical rejection and exposes only an approved machine code',async()=>{
 const error=Object.assign(new Error('PRIVATE_MESSAGE'),{code:'CONNECTION_FAILED',cookie:'PRIVATE_COOKIE'}),promise=Promise.reject(error),cap={nativePromise:()=>promise};const observation=observeNativePdfCalls(cap);
 assert.equal(cap.nativePromise('OpenTriageConnection','openPdf',{private:'PRIVATE_OPTIONS'}),promise);await assert.rejects(promise,value=>value===error);await Promise.resolve();
 assert.deepEqual(observation.calls,[{settled:true,errorCode:'CONNECTION_FAILED'}]);assert.doesNotMatch(JSON.stringify(observation),/PRIVATE_/);observation.restore();
});
test('fixture proves the exact one-shot PDF503 was consumed and records the subsequent real response without altering other reports',()=>{
 const middleware=pdfDownloadFixture(),id='11111111-1111-4111-8111-111111111111',snapshot='22222222-2222-4222-8222-222222222222',path=`/api/review/reports/${id}/snapshots/${snapshot}/pdf`;
 const request=(method,url,backendStatus=200)=>{const response=new EventEmitter();response.statusCode=200;response.status=code=>{response.statusCode=code;return response;};response.set=()=>response;response.json=value=>{response.body=value;response.emit('finish');return response;};middleware({method,url},response,()=>{response.statusCode=backendStatus;response.body={ordinary:true};response.emit('finish');});return response;};
 assert.equal(request('POST',`/api/__android-pdf-download-fail?reportId=${id}`).body.armed,true);
 assert.equal(request('GET',path).statusCode,503);let state=request('GET',`/api/__android-pdf-download-fail?reportId=${id}`).body;assert.deepEqual(state,{armed:false,requests:1,failures:1,statuses:[503]});
 assert.equal(request('GET',path,404).statusCode,404);state=request('GET',`/api/__android-pdf-download-fail?reportId=${id}`).body;assert.deepEqual(state.statuses,[503,404]);assert.equal(state.requests,2);assert.equal(state.failures,1);
 assert.equal(request('GET',path.replace(id,'33333333-3333-4333-8333-333333333333')).body.ordinary,true);
 assert.equal(request('POST','/api/__android-pdf-download-fail?reportId=invalid').statusCode,400);
});
test('media hold proves a real failed request before release and keeps the explicit subsequent successful upload separate',()=>{
 const middleware=pdfMediaHoldFixture(),id='11111111-1111-4111-8111-111111111111',control=`/api/__android-pdf-media-hold?reportId=${id}`,path=`/api/reports/${id}/photos`;
 const request=(method,url,backendStatus=201)=>{const response=new EventEmitter();response.statusCode=200;response.status=code=>{response.statusCode=code;return response;};response.set=()=>response;response.json=value=>{response.body=value;response.emit('finish');return response;};middleware({method,url},response,()=>{response.statusCode=backendStatus;response.body={ordinary:true};response.emit('finish');});return response;};
 assert.equal(request('POST',control+'&hold=1').body.held,true);
 assert.deepEqual(request('GET',control).body,{held:true,requests:0,failures:0,statuses:[]},'Pending UI alone is not evidence of an actual server failure');
 assert.equal(request('POST',path).statusCode,503);
 assert.deepEqual(request('GET',control).body,{held:true,requests:1,failures:1,statuses:[503]});
 assert.equal(request('POST',control+'&hold=0').body.held,false);assert.equal(request('POST',path).statusCode,201);
 assert.deepEqual(request('GET',control).body,{held:false,requests:2,failures:1,statuses:[503,201]});
 assert.equal(request('POST',path.replace(id,'33333333-3333-4333-8333-333333333333')).body.ordinary,true);
 assert.equal(request('POST',control+'&hold=invalid').statusCode,400);assert.equal(request('GET',control+'&hold=0').statusCode,400);
 const java=readFileSync(new URL('../android/app/src/androidTest/java/org/opentriage/development/ReportRecoveryJourneyTest.java',import.meta.url),'utf8');
 const failed=java.indexOf('waitFor("document.querySelector(\'.note-readiness\')?.textContent.includes(\'retry\')")'),receipt=java.indexOf('The actual photo POST must receive503'),release=java.indexOf("&hold=0"),retry=java.indexOf('click("Retry upload")',release);
 assert(failed>0&&receipt>failed&&release>receipt&&retry>release,'Observe failed client and actual503 receipt BEFORE releasing hold, then invoke the real explicit upload Retry');
});
