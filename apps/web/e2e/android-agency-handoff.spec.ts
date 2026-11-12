import {expect,test} from '@playwright/test';
import {build} from 'esbuild';
import path from 'node:path';

const session={csrfToken:'old-csrf',installationSuperadmin:true,user:{id:'10000000-0000-4000-8000-000000000001',displayName:'Synthetic administrator'},organization:{id:'20000000-0000-4000-8000-000000000001',name:'Original agency'},startedAt:'2026-01-01T00:00:00Z',expiresAt:'2099-01-01T00:00:00Z'};
async function bundle(contents:string){return(await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},plugins:[{name:'native-handoff',setup(builder){
 builder.onResolve({filter:/^@capacitor\/core$/},()=>({path:'core',namespace:'native-handoff'}));
 builder.onLoad({filter:/.*/,namespace:'native-handoff'},()=>({loader:'js',contents:`
 export const Capacitor={isNativePlatform:()=>true,getPlatform:()=> 'android'};
 export const registerPlugin=name=>name==='OpenTriageConnection'?{
  prepareAgencyHandoff:async()=>{if(window.fixture.denied)throw Error('Managed origin conflict');if(window.fixture.holdPrepare)return new Promise(resolve=>{window.fixture.releasePrepare=()=>resolve({crossHost:true})});return{crossHost:true}},
  confirmAgencyHandoff:async()=>{window.fixture.started=true;return new Promise(resolve=>{window.fixture.finish=()=>resolve(window.fixture.completion={configured:false,handoffPending:true,handoffComplete:true,origin:'https://target.example',storageScope:'B'.repeat(43),connectionContext:'target',session:{...window.fixture.session,csrfToken:'new-csrf',organization:{id:'20000000-0000-4000-8000-000000000002',name:'Target agency'}}})})},
  finishAuthentication:async()=>({outcome:'idle'}),state:async()=>window.fixture.state,addListener:async()=>({remove:async()=>{}}),
  acknowledgeAgencyHandoff:async()=>{if(localStorage.getItem('open-triage.installation-transition.v1'))throw Error('Marker must clear before native ACK');if(JSON.parse(localStorage.getItem('open-triage.clinician-session.v1')||'null')?.csrfToken!==window.fixture.completion.session.csrfToken)throw Error('Session metadata must persist before ACK');localStorage.setItem('handoff-resolved','1');localStorage.setItem('handoff-acknowledged','1');return{...window.fixture.completion,configured:true,handoffPending:false,handoffComplete:false}},
  resumeAgencyHandoff:async()=>window.fixture.completion={...window.fixture.state,session:window.fixture.session},
  cancelAgencyHandoff:async()=>{return window.fixture.completion={configured:false,handoffPending:true,handoffComplete:true,origin:'https://original.example',storageScope:'A'.repeat(43),connectionContext:'cancelled',session:window.fixture.session}}
 }:{addListener:async()=>({remove:async()=>{}}),state:async()=>({active:true})};` }));
}}],stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents}})).outputFiles[0]!.text;}

test('native handoff locks pending work before confirmation, keeps exact encrypted bytes in the old scope, and stays bundled',async({page})=>{
 const script=await bundle(`import{startAgencyHandoff}from'./app/agency-handoff';import{configureNativeConnection}from'./app/android-runtime';import{prepareProtectedReport,updateProtectedReport,flushProtectedReport,protectedStorageActive,pendingProtectedRecoveryHandles}from'./app/protected-clinical-storage';
 Object.defineProperty(navigator.storage,'persisted',{value:async()=>true});Object.defineProperty(navigator.storage,'persist',{value:async()=>true});
 const stored=JSON.parse(localStorage.getItem('open-triage.clinician-session.v1')||'null');configureNativeConnection({configured:true,origin:stored?.csrfToken==='new-csrf'?'https://target.example':'https://original.example',storageScope:(stored?.csrfToken==='new-csrf'?'B':'A').repeat(43),connectionContext:'fixture'});
 Object.assign(window,{prepare:async()=>{localStorage.setItem('open-triage:installation-configuration-v1','old-agency-config');localStorage.setItem('open-triage.clinician-session.v1',JSON.stringify(window.fixture.session));await prepareProtectedReport('old-csrf','report-agency');updateProtectedReport('report-agency',{report:{id:'report-agency'},queuedChanges:[{command:{private:'old agency pending work'},attempted:false}]});await flushProtectedReport('report-agency')},readable:()=>protectedStorageActive('report-agency'),handles:async()=>[...await pendingProtectedRecoveryHandles()],start:()=>startAgencyHandoff('20000000-0000-4000-8000-000000000002','old-csrf')});`);
 await page.route('**/api/reports/report-agency/**',route=>{
  const body=route.request().postDataJSON();return route.fulfill({json:route.request().url().endsWith('/protected-key-envelope')?{schemaVersion:1,recoveryHandle:body.recoveryHandle,recoveryDeadline:'2099-01-01T00:00:00Z',wrappingKeyVersion:1}:route.request().url().endsWith('/protected-ciphertext-receipt')?{schemaVersion:1,recoveryDeadline:'2099-01-01T00:00:00Z'}:body});
 });
 await page.route('**/agency-script',r=>r.fulfill({contentType:'text/javascript',body:script}));
 const html=`<html><body><script>window.fixture={session:${JSON.stringify(session)}}</script><script src="/agency-script"></script></body></html>`;
 await page.route('**/__agency',r=>r.fulfill({contentType:'text/html',body:html}));await page.route('**/',r=>r.fulfill({contentType:'text/html',body:html}));await page.goto('/__agency');
 type F=typeof window&{prepare():Promise<void>;start():Promise<void>;readable():boolean;handles():Promise<string[]>;fixture:{started:boolean;denied:boolean;finish():void}};
 await page.evaluate(()=>(window as F).prepare());
 const records=()=>page.evaluate(()=>new Promise<unknown[]>(resolve=>{const r=indexedDB.open('open-triage-protected-clinical-v1');r.onsuccess=()=>{const db=r.result;const q=db.transaction('encrypted-reports').objectStore('encrypted-reports').getAll();q.onsuccess=()=>{resolve(q.result.map(x=>({...x,ciphertext:Array.from(new Uint8Array(x.ciphertext)),nonce:Array.from(new Uint8Array(x.nonce))})));db.close();};};}));
 const before=await records();expect(before).toHaveLength(1);expect(await page.evaluate(()=>(window as F).readable())).toBe(true);
 await page.evaluate(()=>{(window as F).fixture.denied=true;});
 expect(await page.evaluate(()=>(window as F).start().then(()=>false,()=>true))).toBe(true);
 expect(await page.evaluate(()=>(window as F).readable())).toBe(true);expect(await records()).toEqual(before);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('open-triage.clinician-session.v1')!).csrfToken)).toBe('old-csrf');expect(await page.evaluate(()=>localStorage.getItem('open-triage:installation-configuration-v1'))).toBe('old-agency-config');
 await page.evaluate(()=>{(window as F).fixture.denied=false;void(window as F).start();});
 await expect.poll(()=>page.evaluate(()=>Boolean((window as F).fixture.started))).toBe(true);
 expect(await page.evaluate(()=>(window as F).readable())).toBe(false);expect(await page.evaluate(()=>localStorage.getItem('open-triage.clinician-session.v1'))).toBeNull();expect(await records()).toEqual(before);
 await Promise.all([page.waitForEvent('domcontentloaded'),page.evaluate(()=>(window as F).fixture.finish())]);
 expect(new URL(page.url()).origin).not.toBe('https://target.example');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('open-triage.clinician-session.v1')!).csrfToken)).toBe('new-csrf');expect(await page.evaluate(()=>localStorage.getItem('open-triage:installation-configuration-v1'))).toBeNull();
 expect(await page.evaluate(()=>(window as F).handles())).toEqual([]);expect(await records()).toEqual(before);
});

for(const complete of [false,true])for(const language of ['en','sv'])test(`${language} ${complete?'completed':'interrupted'} native handoff keeps work locked until metadata and marker settle before acknowledgement`,async({page})=>{
 const script=await bundle(`import React from'react';import{createRoot}from'react-dom/client';import{AndroidRuntimeGate}from'./components/android-runtime-gate';createRoot(document.getElementById('root')).render(<AndroidRuntimeGate><p data-clinical>Shared workspace</p></AndroidRuntimeGate>);`);
 await page.route('**/agency-script',r=>r.fulfill({contentType:'text/javascript',body:script}));
 const html=`<html lang="${language}"><body><div id="root"></div><script>Object.defineProperty(navigator,'language',{value:'${language}'});localStorage.setItem('open-triage.installation-transition.v1','handoff:orphaned');window.fixture={session:{"csrfToken": "old-csrf", "user": {"id": "10000000-0000-4000-8000-000000000001"}, "organization": {"id": "20000000-0000-4000-8000-000000000001"}, "expiresAt": "2099-01-01T00:00:00Z"},state:localStorage.getItem('handoff-resolved')?{configured:true,origin:'https://original.example',storageScope:'A'.repeat(43),connectionContext:'cancelled'}:{configured:false,handoffPending:true,handoffComplete:${complete},origin:'https://original.example',storageScope:'A'.repeat(43),connectionContext:'interrupted'}};</script><script src="/agency-script"></script></body></html>`;
 await page.route('**/__agency-interrupted',r=>r.fulfill({contentType:'text/html',body:html}));await page.route('**/',r=>r.fulfill({contentType:'text/html',body:html}));await page.goto('/__agency-interrupted');
 await expect(page.getByRole('alert')).toContainText(complete?(language==='en'?'agency switch is ready':'Organisationsbytet är redo'):(language==='en'?'agency switch was interrupted':'Bytet av organisation avbröts'));
 await expect(page.locator('[data-clinical],input[type=file],input[type=password]')).toHaveCount(0);
 await Promise.all([page.waitForEvent('domcontentloaded'),page.getByRole('button',{name:complete?(language==='en'?'Finish agency switch':'Slutför organisationsbyte'):(language==='en'?'Return to original installation':'Återgå till ursprunglig installation'),exact:true}).click()]);await expect(page.locator('[data-clinical]')).toBeVisible();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('open-triage.clinician-session.v1')!).csrfToken)).toBe('old-csrf');expect(await page.evaluate(()=>localStorage.getItem('handoff-acknowledged'))).toBe('1');
});


test('late native preparation cannot confirm, restore metadata or reload a newer installation',async({page})=>{
 const script=await bundle(`import{startAgencyHandoff}from'./app/agency-handoff';import{configureNativeConnection}from'./app/android-runtime';
 configureNativeConnection({configured:true,origin:'https://original.example',storageScope:'A'.repeat(43),connectionContext:'original'});
 Object.assign(window,{begin:()=>startAgencyHandoff('20000000-0000-4000-8000-000000000002','old-csrf',window.fixture.session),newContext:()=>{configureNativeConnection({configured:true,origin:'https://newer.example',storageScope:'C'.repeat(43),connectionContext:'newer'});localStorage.setItem('open-triage.installation-generation.v1','newer');localStorage.setItem('open-triage.clinician-session.v1',JSON.stringify({...window.fixture.session,csrfToken:'newer-csrf'}))}});`);
 await page.route('**/agency-script',r=>r.fulfill({contentType:'text/javascript',body:script}));await page.route('**/__agency-stale',r=>r.fulfill({contentType:'text/html',body:`<html><script>window.fixture={holdPrepare:true,session:${JSON.stringify(session)}}</script><script src="/agency-script"></script></html>`}));await page.goto('/__agency-stale');
 type F=typeof window&{begin():Promise<boolean>;newContext():void;failure?:string;fixture:{releasePrepare():void;started?:boolean}};
 const time=await page.evaluate(()=>performance.timeOrigin);await page.evaluate(()=>{void(window as F).begin().catch(e=>{(window as F).failure=e.message;});});
 await expect.poll(()=>page.evaluate(()=>Boolean((window as F).fixture.releasePrepare))).toBe(true);
 await page.evaluate(()=>{(window as F).newContext();(window as F).fixture.releasePrepare();});await expect.poll(()=>page.evaluate(()=>(window as F).failure)).toBeTruthy();
 expect(await page.evaluate(()=>Boolean((window as F).fixture.started))).toBe(false);expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('open-triage.clinician-session.v1')!).csrfToken)).toBe('newer-csrf');expect(await page.evaluate(()=>performance.timeOrigin)).toBe(time);
});

test('an older handoff finally cannot clear a newer installation marker or session metadata',async({page})=>{
 const script=await bundle(`import{transitionInstallation}from'./app/installation-transition';window.run=()=>transitionInstallation(()=>new Promise(resolve=>{window.release=()=>resolve(true)}),'handoff');window.completed=0;addEventListener('open-triage:installation-transition-complete',()=>window.completed++);`);
 await page.route('**/agency-script',r=>r.fulfill({contentType:'text/javascript',body:script}));await page.route('**/__agency-generation',r=>r.fulfill({contentType:'text/html',body:'<html><script>window.fixture={}</script><script src="/agency-script"></script></html>'}));await page.goto('/__agency-generation');
 type F=typeof window&{run():Promise<void>;release():void;settled:boolean;completed:number};
 await page.evaluate(()=>{void(window as F).run().then(()=>{(window as F).settled=true;});});
 await expect.poll(()=>page.evaluate(()=>typeof(window as F).release)).toBe('function');
 expect(await page.evaluate(()=>localStorage.getItem('open-triage.installation-transition.v1'))).toMatch(/^handoff:/);
 await page.evaluate(()=>{localStorage.setItem('open-triage.installation-transition.v1','enrollment:newer');localStorage.setItem('open-triage.installation-generation.v1','enrollment:newer');localStorage.setItem('open-triage.clinician-session.v1','newer-metadata');(window as F).release();});
 await expect.poll(()=>page.evaluate(()=>(window as F).settled)).toBe(true);
 expect(await page.evaluate(()=>localStorage.getItem('open-triage.installation-transition.v1'))).toBe('enrollment:newer');expect(await page.evaluate(()=>localStorage.getItem('open-triage.clinician-session.v1'))).toBe('newer-metadata');expect(await page.evaluate(()=>(window as F).completed)).toBe(0);
});

test('a queued handoff cannot transfer credentials after a newer logout takes ownership',async({page})=>{
 const script=await bundle(`import{transitionInstallation}from'./app/installation-transition';window.operations=[];window.settled=0;window.hold=()=>navigator.locks.request('open-triage.installation-clinical-context',{mode:'exclusive'},()=>new Promise(resolve=>{window.release=resolve}));window.begin=purpose=>transitionInstallation(async()=>{window.operations.push(purpose);if(purpose==='logout')localStorage.setItem('open-triage.clinician-session.v1','newer-session-metadata')},purpose).catch(()=>{}).finally(()=>window.settled++);`);
 await page.route('**/agency-script',r=>r.fulfill({contentType:'text/javascript',body:script}));await page.route('**/__agency-queued',r=>r.fulfill({contentType:'text/html',body:'<html><script>window.fixture={}</script><script src="/agency-script"></script></html>'}));await page.goto('/__agency-queued');
 type F=typeof window&{hold():Promise<void>;release():void;begin(purpose:string):Promise<void>;operations:string[];settled:number};
 await page.evaluate(()=>{void(window as F).hold();});await expect.poll(()=>page.evaluate(()=>typeof(window as F).release)).toBe('function');
 await page.evaluate(()=>{void(window as F).begin('handoff');});await expect.poll(()=>page.evaluate(()=>localStorage.getItem('open-triage.installation-transition.v1'))).toMatch(/^handoff:/);
 await page.evaluate(()=>{void(window as F).begin('logout');});await expect.poll(()=>page.evaluate(()=>localStorage.getItem('open-triage.installation-transition.v1'))).toMatch(/^logout:/);
 await page.evaluate(()=>(window as F).release());await expect.poll(()=>page.evaluate(()=>(window as F).settled)).toBe(2);
 expect(await page.evaluate(()=>(window as F).operations)).toEqual(['logout']);expect(await page.evaluate(()=>localStorage.getItem('open-triage.installation-transition.v1'))).toBeNull();expect(await page.evaluate(()=>localStorage.getItem('open-triage.clinician-session.v1'))).toBe('newer-session-metadata');
});
