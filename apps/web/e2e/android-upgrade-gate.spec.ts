import {expect,test,type Page} from '@playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import demoAssignedCalls from '../public/demo-assigned-calls.json';
import demoOpenAssignment from '../public/demo-open-assignment.json';
import productionSettings from '@open-triage/contracts/config/installation.production.json';
let script:string,css:string;
const call=demoAssignedCalls.assignedCalls[0]!,opened={...demoOpenAssignment,assignmentId:call.id},reportId=opened.report.id;
const session={csrfToken:'upgrade-csrf',user:{id:opened.report.documentingUserId,displayName:'Fictional Upgrade Clinician'},organization:{id:'32000000-0000-4000-8000-000000000001',name:'Fictional Upgrade Agency'},capabilities:['clinical:document'],workspaceAvailable:true,startedAt:'2026-01-01T00:00:00Z',expiresAt:'2099-01-01T00:00:00Z'};
test.beforeAll(async()=>{
 css=await readFile(path.resolve(__dirname,'../app/styles.css'),'utf8')+await readFile(path.resolve(__dirname,'../app/session-layout.css'),'utf8');
 const result=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin',NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION:'false'})},plugins:[{name:'installed-version-boundary',setup(builder){
  // The policy hook and package-version bridge are the only mocked leaves;
  // Home, session gate, documentation and encrypted IndexedDB are real.
  builder.onResolve({filter:/android-runtime$/},args=>/use-android-upgrade-policy|android-client-policy/.test(args.importer)?{path:'version',namespace:'installed-version'}:undefined);
  builder.onLoad({filter:/.*/,namespace:'installed-version'},()=>({loader:'js',contents:'export const isAndroidRuntime=()=>true;export const AndroidConnection={version:async()=>({versionCode:1})};'}));
 }}],stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:"import React from 'react';import {createRoot} from 'react-dom/client';import Home from './app/page';createRoot(document.getElementById('root')).render(<Home/>);"}});script=result.outputFiles[0]!.text;
});
async function cipher(page:Page){return page.evaluate(async()=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('open-triage-protected-clinical-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{return await new Promise<unknown[]>((resolve,reject)=>{const r=db.transaction('encrypted-reports').objectStore('encrypted-reports').getAll();r.onsuccess=()=>resolve(r.result.map(v=>({revision:v.ciphertextRevision,nonce:[...new Uint8Array(v.nonce)],ciphertext:[...new Uint8Array(v.ciphertext)]})));r.onerror=()=>reject(r.error);});}finally{db.close();}});}
for(const language of ['en','sv'])test(`Android retirement gates new work without replacing active documentation (${language})`,async({page},testInfo)=>{
 let status='compatible',policyReads=0,saves=0,reauth=0,isOpen=false,recoveryHandle='',reportKeyBase64='',consumed=0,createdKeys=0,ended=false,holdPolicy=false,policyHeld=false,releasePolicy=()=>{};
 const pageErrors:string[]=[];page.on('pageerror',error=>pageErrors.push(error.message));
 await page.setViewportSize({width:390,height:844});
 await page.addInitScript(value=>localStorage.setItem('open-triage.clinician-session.v1',JSON.stringify(value)),session);
 await page.route('**/__upgrade-gate',route=>route.fulfill({contentType:'text/html',body:`<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${script}</script></body></html>`}));
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/installation')return route.fulfill({json:{settings:{...productionSettings,language}}});
  if(url.pathname==='/api/sessions/current'){if(route.request().method()==='DELETE'){ended=true;return route.fulfill({status:204});}return ended?route.fulfill({status:401,json:{code:'auth.sessionRequired'}}):route.fulfill({json:session});}
  if(url.pathname.includes('reauthenticate')){reauth++;return route.fulfill({status:500,json:{}});}
  if(url.pathname==='/api/android/compatibility'){
   policyReads++;expect(url.searchParams.get('versionCode')).toBe('1');
   if(holdPolicy){policyHeld=true;await new Promise<void>(resolve=>{releasePolicy=resolve;});}
   return route.fulfill({json:{versionCode:1,status,reason:status==='compatible'?'supported':'retired',serverTime:'2026-11-01T00:00:00.000Z',deadline:status==='compatible'?null:'2026-11-02T00:00:00.000Z',replacement:status==='compatible'?null:{versionCode:2,versionName:'0.1.0-rc.2',tag:'android-candidate-2-0.1.0-rc.2',downloadUrl:'https://github.com/open-triage/open-triage-epcr/releases/download/android-candidate-2-0.1.0-rc.2/opentriage-update.apk',apkSha256:'a'.repeat(64)},policyRevision:1,graceDays:90}});
  }
  if(url.pathname==='/api/calls/assigned')return route.fulfill({json:demoAssignedCalls});
  if(url.pathname==='/api/reports/open')return route.fulfill({json:{openCalls:isOpen?[{reportId,callNumber:call.callNumber,lastSavedAt:new Date().toISOString(),syncStatus:'saved',validationErrorCount:0,revision:opened.report.revision,formVersionId:opened.report.formVersionId,catalogReleaseId:opened.report.catalogReleaseId}]:[],completedReportIds:[],refreshedAt:new Date().toISOString()}});
  if(url.pathname===`/api/calls/${call.id}/open`){isOpen=true;return route.fulfill({json:opened});}
  if(url.pathname.endsWith('/protected-key-envelope')){createdKeys++;recoveryHandle=route.request().postDataJSON().recoveryHandle;reportKeyBase64=route.request().postDataJSON().reportKeyBase64;return route.fulfill({json:{schemaVersion:1,recoveryHandle,recoveryDeadline:'2099-01-01T00:00:00Z',wrappingKeyVersion:1}});}
  if(url.pathname.endsWith('/protected-ciphertext-receipt'))return route.fulfill({json:{schemaVersion:1,recoveryDeadline:'2099-01-01T00:00:00Z'}});
  if(url.pathname.endsWith('/protected-ciphertext-checkpoint'))return route.fulfill({json:route.request().postDataJSON()});
  if(url.pathname.endsWith('/recovery-grants'))return route.fulfill({status:201,json:{schemaVersion:1,envelopeVersion:1,recoveryHandle,grant:'YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE',expiresAt:'2099-01-01T00:00:00Z',reportStatus:'draft'}});
  if(url.pathname.endsWith('/recovery-grants/consume')){consumed++;return route.fulfill({json:{schemaVersion:1,envelopeVersion:1,wrappingKeyVersion:1,reportKeyBase64}});}
  if(url.pathname.endsWith('/reopen'))return route.fulfill({json:{callNumber:call.callNumber,dispatchedAt:call.dispatchedAt,dispatchReason:call.dispatchReason,unitCallSign:call.unit.callSign,report:opened.report}});
  if(url.pathname.endsWith('/draft-changes')){saves++;return route.fulfill({json:{id:reportId,status:'draft',revision:route.request().postDataJSON().expectedRevision+1}});}
  if(url.pathname.endsWith('/active'))return route.fulfill({status:304});
  return route.fulfill({status:404,json:{}});
 });
 await page.goto('/__upgrade-gate');
 const open=page.getByRole('button',{name:language==='sv'?'Öppna uppdrag':'Open call',exact:true}).first();
 await expect(open).toBeEnabled();expect(policyReads).toBeGreaterThan(0);
 if(language==='sv'){
  status='upgrade-required';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(open).toBeDisabled();await expect(page.getByRole('button',{name:'Ny patient',exact:true})).toBeDisabled();await expect(page.getByRole('status').filter({hasText:'Uppdatera Android-appen innan'})).toBeVisible();
  await expect(page.getByRole('link',{name:'Hämta 0.1.0-rc.2'})).toHaveAttribute('href',/github.com\/open-triage/);
 }else{
  await page.getByRole('group',{name:'Documentation presentation'}).getByRole('button',{name:'Stationary',exact:true}).click();
  await open.click();const firstName=page.getByRole('textbox',{name:'First Name',exact:true});await expect(firstName).toBeEnabled();
  await firstName.fill('RETAINED THROUGH RETIREMENT');await firstName.press('Tab');await expect.poll(()=>saves).toBeGreaterThan(0);
  await expect.poll(async()=> (await cipher(page)).length).toBeGreaterThan(0);
  await firstName.evaluate(element=>element.setAttribute('data-original-mounted-node','yes'));
  const before=await cipher(page);
  status='approaching-upgrade';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('status').filter({hasText:'Update the Android app before Nov 2, 2026'})).toBeVisible();
  status='upgrade-required';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('status').filter({hasText:'Update the Android app before starting new work'})).toBeVisible();
  await expect(firstName).toHaveAttribute('data-original-mounted-node','yes');await expect(firstName).toHaveValue('RETAINED THROUGH RETIREMENT');
  expect(await cipher(page)).toEqual(before);await expect(page.locator(".encounter-header")).toBeVisible();
  const saved=saves;await firstName.fill('CONTINUE EXISTING WORK');await firstName.press('Tab');await expect.poll(()=>saves).toBeGreaterThan(saved);
  await expect(page.getByRole('link',{name:'Download 0.1.0-rc.2'})).toBeVisible();
  // A future-format encrypted record must remain explicit recovery material,
  // never be consumed/replaced by the newly installed runtime's key setup.
  await page.evaluate(async()=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('open-triage-protected-clinical-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('encrypted-reports','readwrite'),store=tx.objectStore('encrypted-reports'),read=store.getAll();read.onsuccess=()=>{for(const row of read.result)store.put({...row,schemaVersion:99});};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}finally{db.close();}});
  const incompatible=await cipher(page),keyCount=createdKeys;await page.reload();
  await expect(page.getByRole('button',{name:'New patient',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Reopen report',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'This retained draft uses an incompatible format'})).toBeVisible();
  expect(await cipher(page)).toEqual(incompatible);expect(consumed).toBe(0);expect(createdKeys).toBe(keyCount);
  // Also cover a valid supported envelope containing an authenticated future
  // payload: key restoration must not turn it into an empty current payload.
  await page.evaluate(async raw=>{
    const key=await crypto.subtle.importKey('raw',Uint8Array.from(atob(raw),c=>c.charCodeAt(0)),{name:'AES-GCM'},false,['encrypt']);
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('open-triage-protected-clinical-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    try{
      const row=await new Promise<{recoveryHandle:string;ciphertextRevision:number;[key:string]:unknown}>((resolve,reject)=>{const r=db.transaction('encrypted-reports').objectStore('encrypted-reports').getAll();r.onsuccess=()=>resolve(r.result[0]);r.onerror=()=>reject(r.error);});
      const ciphertextRevision=Number(row.ciphertextRevision)+1,nonce=crypto.getRandomValues(new Uint8Array(12)),ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:new TextEncoder().encode(JSON.stringify({schemaVersion:1,recoveryHandle:row.recoveryHandle,ciphertextRevision}))},key,new TextEncoder().encode(JSON.stringify({schemaVersion:99})));
      await new Promise<void>((resolve,reject)=>{const tx=db.transaction('encrypted-reports','readwrite');tx.objectStore('encrypted-reports').put({...row,schemaVersion:1,ciphertextRevision,nonce:nonce.buffer,ciphertext});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
    }finally{db.close();}
  },reportKeyBase64);
  const futurePayload=await cipher(page);await page.reload();await page.getByRole('button',{name:'Reopen report',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'This retained draft uses an incompatible format'})).toBeVisible();
  expect(await cipher(page)).toEqual(futurePayload);expect(consumed).toBe(1);expect(createdKeys).toBe(keyCount);
  // A held native policy response must not crash the session-transition render
  // or restore an outgoing session after the authentication generation changes.
  holdPolicy=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect.poll(()=>policyHeld).toBe(true);
  await page.getByRole('button',{name:'Log out',exact:true}).click();
  const confirmation=page.getByRole('button',{name:'Log out and lock work',exact:true});if(await confirmation.isVisible())await confirmation.click();
  await expect(page.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();
  releasePolicy();await expect(page.getByLabel('Username',{exact:true})).toBeVisible();
  expect(await cipher(page)).toEqual(futurePayload);



 }
 expect(pageErrors).toEqual([]);expect(reauth).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath(`upgrade-gate-${language}.png`)});
});

type PolicyRaceFixture = {start():void;pause():void;abort():void;changeContext():void;releaseVersion?():void;finished?:boolean;dispatches?:number};
for(const action of ['pause','abort','context'] as const)test(`held native version cannot dispatch policy HTTP after ${action}`,async({page})=>{
 const result=await build({bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},plugins:[{name:'held-native-version',setup(builder){
  builder.onResolve({filter:/android-runtime$/},()=>({path:'held-version',namespace:'held-version'}));
  builder.onLoad({filter:/.*/,namespace:'held-version'},()=>({loader:'js',contents:'export const isAndroidRuntime=()=>false;export const AndroidConnection={version:()=>new Promise(resolve=>{window.releaseVersion=()=>resolve({versionCode:1})})};'}));
 }}],stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'ts',contents:`
  import{loadAndroidClientPolicy}from'./app/android-client-policy';import{setNativeForeground}from'./app/application-foreground';
  const controller=new AbortController();let current=true;const originalFetch=window.fetch.bind(window);window.dispatches=0;
  window.fetch=(...args)=>{window.dispatches++;return originalFetch(...args)};
  Object.assign(window,{pause:()=>setNativeForeground(false),abort:()=>controller.abort(),changeContext:()=>{current=false},start:()=>{
    void loadAndroidClientPolicy(controller.signal,()=>current).then(()=>window.finished=true,()=>window.finished=true);
  }});`}});
 await page.route('**/__upgrade-policy-race',route=>route.fulfill({contentType:'text/html',body:`<html><body><script>${result.outputFiles[0]!.text}</script></body></html>`}));
 let reads=0;await page.route('**/api/android/compatibility?*',route=>{reads++;return route.fulfill({status:503,json:{}});});
 await page.goto('/__upgrade-policy-race');await page.evaluate(()=>(window as unknown as PolicyRaceFixture).start());
 await expect.poll(()=>page.evaluate(()=>typeof (window as unknown as PolicyRaceFixture).releaseVersion)).toBe('function');
 await page.evaluate(action=>{const fixture=window as unknown as PolicyRaceFixture;if(action==='pause')fixture.pause();else if(action==='abort')fixture.abort();else fixture.changeContext();fixture.releaseVersion?.();},action);
 await expect.poll(()=>page.evaluate(()=>(window as unknown as PolicyRaceFixture).finished)).toBe(true);
 expect(reads,'No new policy HTTP request may begin after the native lifecycle or installation boundary changed').toBe(0);
 expect(await page.evaluate(()=>(window as unknown as PolicyRaceFixture).dispatches),'Even an already-aborted fetch must not be newly scheduled after the boundary changed').toBe(0);
});
