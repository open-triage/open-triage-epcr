import { test, type Request } from '@playwright/test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { observeJsonResponse } from '../../api/tests/fixtures/response-observer.mjs';

test('a real aborted streamed body cannot hide the required completed current JSON and UI result',async({page})=>{
 let held:ServerResponse|undefined;
 const server=createServer((req,res)=>{
  if(req.url?.startsWith('/api/eps')){
   res.setHeader('Content-Type','application/json');
   if(req.url.includes('attempt=cancelled')){held=res;res.writeHead(200);res.flushHeaders();res.write('{"status":');return;}
   res.end(JSON.stringify({status:'no-match',context:{binding:'current'}}));return;
  }
  res.end('<html><body><output id="result"></output></body></html>');
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;await page.goto(origin);
  const observed=await observeJsonResponse(page,{label:'real aborted fixture',
   matchesRequest:(value:Request)=>value.method()==='GET'&&new URL(value.url()).pathname==='/api/eps'&&new URL(value.url()).origin===origin,
   scope:async()=> (value:Request)=>new URL(value.url()).searchParams.get('binding')==='current',
   verify:(body:unknown)=>{const value=body as {status?:unknown;context?:{binding?:unknown}};assert.equal(value.status,'no-match');assert.equal(value.context?.binding,'current');},timeout:10000,
   action:async()=>{
    const headers=page.waitForResponse(value=>value.url().includes('attempt=cancelled'));
    await page.evaluate(()=>{
     const state=window as Window & {fixtureAbort?:AbortController;fixtureWasAborted?:boolean};state.fixtureAbort=new AbortController();
     void fetch('/api/eps?binding=current&attempt=cancelled',{signal:state.fixtureAbort.signal}).then(value=>value.json()).catch(()=>{state.fixtureWasAborted=true;});
    });
    await headers;
    await page.evaluate(()=>{
     (window as Window & {fixtureAbort?:AbortController}).fixtureAbort!.abort();
     void fetch('/api/eps?binding=current&attempt=complete').then(value=>value.json()).then(value=>{document.getElementById('result')!.textContent=value.status;});
    });
   }});
  assert.equal(observed.diagnostics.completed,1);
  await page.waitForFunction(()=>(window as Window & {fixtureWasAborted?:boolean}).fixtureWasAborted&&document.getElementById('result')?.textContent==='no-match');
 }finally{held?.destroy();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
