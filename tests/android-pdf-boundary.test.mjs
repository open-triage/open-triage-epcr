import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import {observeNativePdfCalls} from '../scripts/android/pdf-native-observer.mjs';
import {pdfDownloadFixture} from '../scripts/android/pdf-download-fixture.mjs';

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
