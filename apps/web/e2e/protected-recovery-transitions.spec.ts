import {expect,test} from '@playwright/test';
import {build} from 'esbuild';
import path from 'node:path';

type Harness={prepare:()=>Promise<unknown>;recover:()=>Promise<unknown>;lock:()=>Promise<void>;edit:()=>void;flush:()=>Promise<void>;active:()=>boolean};
for(const operation of ['prepare','recover','conflict','deferred-lock'] as const)test(`a delayed ${operation} response cannot restore protected keys after a session transition`,async({page,context})=>{
 if(operation==='deferred-lock')await page.addInitScript(()=>{const original=navigator.locks.request.bind(navigator.locks);let first=true;(navigator.locks as unknown as {request:(...args:unknown[])=>unknown}).request=(...args:unknown[])=>{if(!first)return (original as unknown as (...args:unknown[])=>unknown)(...args);first=false;return new Promise<void>(resolve=>{Object.assign(window,{deferredStarted:true,releaseDeferred:resolve});}).then(()=>(original as unknown as (...args:unknown[])=>unknown)(...args));};});
 const bundle=await build({bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'ts',contents:`
 import{prepareProtectedReport,recoverProtectedReport,lockProtectedClinicalStorage,protectedStorageActive,updateProtectedReport,flushProtectedReport}from './app/protected-clinical-storage';
 Object.defineProperty(navigator.storage,'persisted',{value:async()=>true});Object.defineProperty(navigator.storage,'persist',{value:async()=>true});
 Object.assign(window,{prepare:()=>prepareProtectedReport('csrf','protected-report'),recover:()=>recoverProtectedReport('csrf','protected-report'),lock:()=>lockProtectedClinicalStorage(),active:()=>protectedStorageActive('protected-report'),edit:()=>updateProtectedReport('protected-report',{queuedChanges:[{command:{private:'PRIVATE PENDING WORK'},attempted:false}]}),flush:()=>flushProtectedReport('protected-report')});`}});
 await context.route('**/__recovery-script',route=>route.fulfill({contentType:'text/javascript',body:bundle.outputFiles[0]!.text}));
 await context.route('**/__recovery',route=>route.fulfill({contentType:'text/html',body:'<html><body><script src="/__recovery-script"></script></body></html>'}));
 const deadline='2099-01-01T00:00:00Z';let key='',handle='',hold=false,started=false,grants=0,release=()=>{};
 await context.route('**/api/reports/protected-report/**',async route=>{
  const url=route.request().url();
  if(url.endsWith('/protected-key-envelope')){const body=route.request().postDataJSON();key=body.reportKeyBase64;handle=body.recoveryHandle;
   if(hold&&['prepare','conflict'].includes(operation)){started=true;await new Promise<void>(resolve=>{release=resolve;});}
   if(hold&&operation==='conflict'){await route.fulfill({status:409});return;}
   await route.fulfill({json:{schemaVersion:1,recoveryHandle:handle,recoveryDeadline:deadline,wrappingKeyVersion:1}});return;
  }
  if(url.endsWith('/protected-ciphertext-checkpoint'))return route.fulfill({json:route.request().postDataJSON()});
  if(url.endsWith('/protected-ciphertext-receipt'))return route.fulfill({json:{schemaVersion:1,recoveryDeadline:deadline}});
  if(url.endsWith('/recovery-grants')){grants++;return route.fulfill({json:{schemaVersion:1,envelopeVersion:1,recoveryHandle:handle,grant:'one-use',expiresAt:deadline,reportStatus:'draft'}});}
  started=true;await new Promise<void>(resolve=>{release=resolve;});await route.fulfill({json:{reportKeyBase64:key,wrappingKeyVersion:1}});
 });
 await page.goto('/__recovery');
 if(operation==='recover'){
  await page.evaluate(()=> (window as unknown as Harness).prepare());await page.evaluate(()=>{(window as unknown as Harness).edit();});await page.evaluate(()=> (window as unknown as Harness).flush());await page.evaluate(()=> (window as unknown as Harness).lock());
 }
 hold=true;
 const delayed=page.evaluate(operation=>(window as unknown as Harness)[operation==='recover'?'recover':'prepare']().then(result=>({result}),error=>({error:String(error)})),operation);
 if(operation==='deferred-lock')await expect.poll(()=>page.evaluate(()=>(window as unknown as {deferredStarted:boolean}).deferredStarted)).toBe(true);else await expect.poll(()=>started).toBe(true);await page.evaluate(()=> (window as unknown as Harness).lock());
 expect(await page.evaluate(()=> (window as unknown as Harness).active())).toBe(false);
 if(operation==='deferred-lock')await page.evaluate(()=>(window as unknown as {releaseDeferred:()=>void}).releaseDeferred());else release();await delayed;
 expect(await page.evaluate(()=> (window as unknown as Harness).active())).toBe(false);
 await expect.poll(()=>page.evaluate(async()=> (await navigator.locks.query()).held?.some(lock=>lock.name==='open-triage:report:protected-report'))).toBe(false);
 if(operation==='conflict')expect(grants).toBe(0);
 const nextTab=await context.newPage();await nextTab.goto('/__recovery');expect(await nextTab.evaluate(()=>navigator.locks.request('open-triage:report:protected-report',{ifAvailable:true},lock=>Boolean(lock)))).toBe(true);await nextTab.close();
 if(operation==='recover'){
  const records=await page.evaluate(()=>new Promise<Array<{recoveryDeadline:string;ciphertext:string}>>(resolve=>{const request=indexedDB.open('open-triage-protected-clinical-v1');request.onsuccess=()=>{const db=request.result,query=db.transaction('encrypted-reports').objectStore('encrypted-reports').getAll();query.onsuccess=()=>{resolve(query.result.map(row=>({...row,ciphertext:new TextDecoder().decode(row.ciphertext)})));db.close();};};}));
  expect(records).toHaveLength(1);expect(records[0]!.recoveryDeadline).toBe(deadline);expect(records[0]!.ciphertext).not.toContain('PRIVATE PENDING WORK');
 }
});

test('protected recovery cannot start during concurrent transition write settlement',async({page,context})=>{
 const bundle=await build({bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'ts',contents:`
 import{prepareProtectedReport,recoverProtectedReport,lockProtectedClinicalStorage,protectedStorageActive,updateProtectedReport}from './app/protected-clinical-storage';
 Object.defineProperty(navigator.storage,'persisted',{value:async()=>true});Object.defineProperty(navigator.storage,'persist',{value:async()=>true});
 Object.assign(window,{prepare:()=>prepareProtectedReport('csrf','writer-report'),edit:()=>updateProtectedReport('writer-report',{note:'Checkpoint snapshot'}),queuePending:()=>updateProtectedReport('writer-report',{queuedChanges:[{command:{note:'PRIVATE SETTLEMENT WORK'},attempted:false}]}),lock:()=>lockProtectedClinicalStorage(),recoverOther:()=>recoverProtectedReport('csrf','second-report'),prepareOther:()=>prepareProtectedReport('csrf','second-report'),active:()=>protectedStorageActive('second-report')});`}});
 await context.route('**/__settlement-script',route=>route.fulfill({contentType:'text/javascript',body:bundle.outputFiles[0]!.text}));await context.route('**/__settlement',route=>route.fulfill({contentType:'text/html',body:'<html><body><script src="/__settlement-script"></script></body></html>'}));
 let checkpointStarted=false,release=()=>{},otherRequests=0;
 await context.route('**/api/reports/**',async route=>{const url=route.request().url();if(url.includes('second-report')){otherRequests++;return route.fulfill({status:404});}if(url.endsWith('/protected-key-envelope'))return route.fulfill({json:{schemaVersion:1,recoveryHandle:route.request().postDataJSON().recoveryHandle,recoveryDeadline:'2099-01-01T00:00:00Z',wrappingKeyVersion:1}});if(url.endsWith('/protected-ciphertext-checkpoint')){checkpointStarted=true;await new Promise<void>(resolve=>{release=resolve;});return route.fulfill({json:route.request().postDataJSON()});}return route.fulfill({json:{schemaVersion:1,recoveryDeadline:'2099-01-01T00:00:00Z'}});});
 await page.goto('/__settlement');await page.evaluate(()=> (window as unknown as Harness).prepare());await page.evaluate(()=> (window as unknown as Harness).edit());await expect.poll(()=>checkpointStarted).toBe(true);await page.evaluate(()=> (window as unknown as {queuePending:()=>void}).queuePending());
 const settling=page.evaluate(()=>Promise.all([(window as unknown as Harness).lock(),(window as unknown as Harness).lock()]));
 await expect.poll(()=>page.evaluate(()=> (window as unknown as {prepareOther:()=>Promise<boolean>}).prepareOther())).toBe(false);
 expect(await page.evaluate(()=> (window as unknown as {recoverOther:()=>Promise<unknown>}).recoverOther())).toBeNull();expect(otherRequests).toBe(0);
 release();await settling;expect(await page.evaluate(()=> (window as unknown as Harness).active())).toBe(false);
 expect(await page.evaluate(()=>navigator.locks.request('open-triage:report:second-report',{ifAvailable:true},lock=>Boolean(lock)))).toBe(true);
});
