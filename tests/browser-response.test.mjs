import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { observeJsonResponse } from '../apps/api/tests/fixtures/response-observer.mjs';

class Page extends EventEmitter {}
const frame={isDetached:()=>false};
const request=(binding='current',failure=null)=>({method:()=> 'GET',url:()=>`http://fixture/api/eps?binding=${binding}`,frame:()=>frame,failure:()=>failure});
function response(value,body,{status=200,cancelled=false}={}){
 return {request:()=>value,status:()=>status,finished:async()=>cancelled?new Error('net::ERR_ABORTED'):null,
  json:async()=>{if(typeof body==='function')return body();return body;}};
}
const matchesRequest=value=>value.method()==='GET'&&new URL(value.url()).pathname==='/api/eps';
const scope=async()=>value=>new URL(value.url()).searchParams.get('binding')==='current';
const verify=body=>{assert.equal(body.status,'no-match');assert.equal(body.context.binding,'current');};

test('JSON observer excludes prior requests and wrong bindings, then requires a real completed current body',async()=>{
 const page=new Page(),before=request();page.emit('request',before);let cancelledReads=0,oldReads=0;
 const result=await observeJsonResponse(page,{label:'correlated fixture',matchesRequest,scope,verify,timeout:1000,action:async()=>{
  page.emit('response',response(before,()=>{oldReads++;throw Error('prior body unavailable');}));
  const old=request('old');page.emit('request',old);page.emit('response',response(old,()=>{oldReads++;throw Error('old body unavailable');}));
  const aborted=request('current',{errorText:'net::ERR_ABORTED'});page.emit('request',aborted);page.emit('response',response(aborted,()=>{cancelledReads++;throw Error('aborted body unavailable');},{cancelled:true}));
  const current=request();page.emit('request',current);page.emit('response',response(current,{status:'no-match',context:{binding:'current'}}));
 }});
 assert.equal(oldReads,0);assert.equal(cancelledReads,0);assert.equal(result.diagnostics.beforePhase,1);assert.equal(result.diagnostics.otherScope,1);assert.equal(result.diagnostics.cancelled,1);assert.equal(result.diagnostics.completed,1);
});

test('JSON observer times out if every matching request is aborted and cannot count a missing success',async()=>{
 const page=new Page();
 await assert.rejects(observeJsonResponse(page,{label:'all aborted fixture',matchesRequest,scope,verify,timeout:35,action:async()=>{
  const aborted=request('current',{errorText:'net::ERR_ABORTED'});page.emit('request',aborted);page.emit('response',response(aborted,{}, {cancelled:true}));
 }}),/timed out.*"cancelled":1.*"completed":0/);
 for(const event of ['request','response','close','framenavigated'])assert.equal(page.listenerCount(event),0);
});

test('malformed JSON, incorrect status and unavailable noncancelled target bodies fail before later successful retries',async()=>{
 for(const bad of [()=>{throw new SyntaxError('invalid JSON');},()=>{throw new Error('Protocol error: body unavailable');},{status:'available',context:{binding:'current'}},{status:'no-match',context:{binding:'wrong'}}]){
  const page=new Page();let checked=0;
  await assert.rejects(observeJsonResponse(page,{label:'invalid current fixture',matchesRequest,scope,verify:body=>{checked++;verify(body);},timeout:1000,action:async()=>{
   const first=request();page.emit('request',first);page.emit('response',response(first,bad));
   const later=request();page.emit('request',later);page.emit('response',response(later,{status:'no-match',context:{binding:'current'}}));
  }}));
  assert(checked<=1,'A later successful retry must not hide the invalid current response');
 }
});

test('same-URL navigation is a proven stale-body boundary rather than a malformed-current exemption',async()=>{
 const page=new Page();let oldReads=0;
 const result=await observeJsonResponse(page,{label:'navigation fixture',matchesRequest,scope,verify,timeout:1000,action:async()=>{
  const old=request();page.emit('request',old);page.emit('response',response(old,()=>{oldReads++;throw Error('disposed realm');}));
  page.emit('framenavigated',frame);
  const current=request();page.emit('request',current);page.emit('response',response(current,{status:'no-match',context:{binding:'current'}}));
 }});
 assert.equal(oldReads,0);assert.equal(result.diagnostics.navigated,1);assert.equal(result.diagnostics.completed,1);
});

test('a failed current HTTP response cannot pass by containing successful JSON or by a later retry',async()=>{
 const page=new Page();let verified=0;
 await assert.rejects(observeJsonResponse(page,{label:'failed HTTP fixture',matchesRequest,scope,verify:body=>{verified++;verify(body);},timeout:1000,action:async()=>{
  const failed=request();page.emit('request',failed);page.emit('response',response(failed,{status:'no-match',context:{binding:'current'}},{status:503}));
  const later=request();page.emit('request',later);page.emit('response',response(later,{status:'no-match',context:{binding:'current'}}));
 }}),/HTTP 503/);
 assert.equal(verified,0);
});

