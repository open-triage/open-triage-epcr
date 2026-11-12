import {expect,test,type Page} from '@playwright/test';
import {build} from 'esbuild';
import path from 'node:path';
import settings from '@open-triage/contracts/config/installation.production.json';
import {DEFAULT_AGENCY_APPEARANCE} from '@open-triage/contracts';
import calls from '../public/demo-assigned-calls.json';

async function fixture(page:Page,extra:Record<string,unknown>={}) {
 const script=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin',NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION:'false'})},plugins:[{name:'native-authority',setup(b){
  b.onResolve({filter:/^@capacitor\/core$/},()=>({path:'core',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'js',contents:`
   export const Capacitor={isNativePlatform:()=>!window.fixture.web,getPlatform:()=> 'android'};
   export const registerPlugin=name=>name==='OpenTriageConnection'?{
    state:async()=>({...window.fixture.state}),addListener:async()=>({remove:async()=>{}}),
    finishAuthentication:async()=>{window.fixture.polls++;return{outcome:'idle'}},
    reconcileTransition:async({connectionContext,purpose})=>{const f=window.fixture;if(f.state.blocked||f.state.replacementPending||connectionContext!==f.state.connectionContext)throw Error('Native transition remains locked');f.reconciliations++;f.pendingOidc=false;if(purpose==='logout')f.personal=false;f.state.connectionContext='reconciled-context';return{...f.state}},
    request:async({path})=>{const f=window.fixture;f.requests.push(path);let value=path==='/api/installation'?window.installation:path==='/api/sessions/authentication-options'?{organization:false}:path==='/api/sessions/current'?{...f.session,csrfToken:undefined}:path==='/api/calls/assigned'?window.calls:path==='/api/reports/open'?{openCalls:[],completedReportIds:[],refreshedAt:new Date().toISOString()}:{};return{status:path==='/api/sessions/current'&&!f.personal?401:200,headers:{'content-type':'application/json'},bodyBase64:btoa(JSON.stringify(value))}}
   }:{state:async()=>({active:true}),addListener:async()=>({remove:async()=>{}})};
  `}));
 }}],stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:"import React from 'react';import{createRoot}from'react-dom/client';import Home from './app/page';import{transitionInstallation,resumeNativeInstallationTransition}from'./app/installation-transition';window.transition=transitionInstallation;window.resumeTransition=resumeNativeInstallationTransition;import{AndroidRuntimeGate}from'./components/android-runtime-gate';(async()=>{await window.seed();createRoot(document.getElementById('root')).render(<AndroidRuntimeGate><Home/></AndroidRuntimeGate>)})();"}});
 const session={csrfToken:'native-csrf',user:{id:'32000000-0000-4000-8000-000000000002',displayName:'Valid native clinician'},organization:{id:'32000000-0000-4000-8000-000000000001',name:'Synthetic agency'},capabilities:['clinical:document'],workspaceAvailable:true,startedAt:new Date().toISOString(),expiresAt:'2099-01-01T00:00:00Z'};
 const state={configured:true,origin:'https://original.example',storageScope:'A'.repeat(43),connectionContext:'native-context',replacementPending:false,...(extra.state as object??{})};
 await page.route('**/__resume-script',r=>r.fulfill({contentType:'text/javascript',body:script.outputFiles[0]!.text}));
 await page.route('**/__native-resume',r=>r.fulfill({contentType:'text/html',body:`<html lang="en"><body><div id="root"></div><script>
 window.calls=${JSON.stringify(calls)};window.installation=${JSON.stringify({settings,appearance:DEFAULT_AGENCY_APPEARANCE})};window.fixture=${JSON.stringify({session,personal:false,pendingOidc:true,polls:0,reconciliations:0,requests:[],...extra,state})};
 window.seed=async()=>{if(!localStorage.getItem('seeded')){localStorage.setItem('seeded','1');if(!window.fixture.noMarker){localStorage.setItem('open-triage.installation-transition.v1',window.fixture.purpose?window.fixture.purpose+':interrupted':'interrupted');localStorage.setItem('open-triage.installation-generation.v1',localStorage.getItem('open-triage.installation-transition.v1'));}localStorage.setItem('open-triage.clinician-session.v1',JSON.stringify({...window.fixture.session,user:{...window.fixture.session.user,displayName:'Stale cached user'},installationGeneration:'interrupted'}));if(window.fixture.purpose==='enrollment')localStorage.setItem('open-triage.installation-session-candidate.v1',JSON.stringify({generation:localStorage.getItem('open-triage.installation-generation.v1'),session:{...window.fixture.session,user:{...window.fixture.session.user,id:window.fixture.candidateUserId||window.fixture.session.user.id,displayName:'Stale cached user'}}}));await new Promise((resolve,reject)=>{const q=indexedDB.open('open-triage-protected-clinical-v1',1);q.onupgradeneeded=()=>q.result.createObjectStore('encrypted-reports',{keyPath:'localRecordId'});q.onerror=()=>reject(q.error);q.onsuccess=()=>{const db=q.result,tx=db.transaction('encrypted-reports','readwrite');tx.objectStore('encrypted-reports').put({localRecordId:'retained',nativeScope:'${'A'.repeat(43)}',recoveryDeadline:'2099-01-01T00:00:00Z',ciphertextRevision:7,synchronizedRevision:3,formVersionId:'pinned-form',catalogReleaseId:'pinned-catalog',validationVersionId:'pinned-validation',ciphertext:new Uint8Array([8,7,6,5]).buffer,nonce:new Uint8Array([4,3,2,1]).buffer});tx.oncomplete=()=>{db.close();resolve()}}})}if(window.fixture.hold){navigator.locks.request('open-triage.installation-clinical-context',{mode:'exclusive'},async()=>{window.lockHeld=true;await new Promise(resolve=>window.releaseLive=resolve)});while(!window.lockHeld)await new Promise(resolve=>setTimeout(resolve,10));}};
 window.retained=()=>new Promise(resolve=>{const q=indexedDB.open('open-triage-protected-clinical-v1',1);q.onsuccess=()=>{const db=q.result,x=db.transaction('encrypted-reports').objectStore('encrypted-reports').get('retained');x.onsuccess=()=>{const row=x.result;resolve({...row,ciphertext:Array.from(new Uint8Array(row.ciphertext)),nonce:Array.from(new Uint8Array(row.nonce))});db.close()}}});
 </script><script src="/__resume-script"></script></body></html>`}));
 if(extra.web)await page.route('**/api/**',r=>r.fulfill({status:r.request().url().endsWith('/sessions/current')?401:200,json:r.request().url().endsWith('/installation')?{settings,appearance:DEFAULT_AGENCY_APPEARANCE}:{organization:false}}));
 await page.goto('/__native-resume');
}
const marker=(page:Page)=>page.evaluate(()=>localStorage.getItem('open-triage.installation-transition.v1'));

test('orphaned confirmed transition reaches primary login after restart without reviving cached identity or changing encrypted work',async({page})=>{
 await fixture(page);await expect(page.locator('input[name=username]')).toBeVisible();
 expect(await marker(page)).toBeNull();expect(await page.evaluate(()=>localStorage.getItem('open-triage.clinician-session.v1'))).toBeNull();
 expect(await page.evaluate(()=>(window as unknown as{fixture:{reconciliations:number;pendingOidc:boolean}}).fixture.reconciliations)).toBe(1);
 expect(await page.evaluate(()=>(window as unknown as{fixture:{pendingOidc:boolean}}).fixture.pendingOidc)).toBe(false);
 const retained=await page.evaluate(()=>(window as unknown as{retained:()=>Promise<unknown>}).retained());
 expect(retained).toMatchObject({ciphertext:[8,7,6,5],nonce:[4,3,2,1],recoveryDeadline:'2099-01-01T00:00:00Z',ciphertextRevision:7,formVersionId:'pinned-form',catalogReleaseId:'pinned-catalog',validationVersionId:'pinned-validation'});
 await page.reload();await expect(page.locator('input[name=username]')).toBeVisible();expect(await page.evaluate(()=>(window as unknown as{retained:()=>Promise<unknown>}).retained())).toEqual(retained);
});

test('interruption before native confirmation continues the current valid login without another prompt',async({page})=>{
 await fixture(page,{personal:true,purpose:"enrollment"});await expect(page.locator('.session-identity')).toContainText('Valid native clinician');
 await expect(page.locator('input[name=username]')).toHaveCount(0);expect(await marker(page)).toBeNull();await expect(page.locator('body')).not.toContainText('Stale cached user');expect(await page.evaluate(()=>localStorage.getItem('open-triage.installation-session-candidate.v1'))).toBeNull();
});

test('a live cross-tab exclusive transition is never reconciled or cleared',async({page})=>{
 await fixture(page,{hold:true});await expect(page.locator('[role=status][aria-busy=true]')).toBeVisible();
 expect(await marker(page)).toBe('interrupted');expect(await page.evaluate(()=>(window as unknown as{fixture:{reconciliations:number;polls:number}}).fixture)).toMatchObject({reconciliations:0,polls:0});
 await page.evaluate(()=>(window as unknown as{releaseLive:()=>void}).releaseLive());await expect(page.locator('input[name=username]')).toBeVisible();expect(await marker(page)).toBeNull();
});

for(const kind of ['pending','managed'] as const)test(`${kind} native authority keeps its journal barrier and ciphertext locked`,async({page})=>{
 await fixture(page,{state:kind==='pending'?{configured:false,replacementPending:true,pendingOrigin:'https://original.example'}:{configured:false,blocked:true,managed:true,managedStatus:'missing'}});
 if(kind==='pending')await expect(page.locator('[data-pending-enrollment]')).toBeVisible();else await expect(page.locator('[role=alert]')).toBeVisible();
 expect(await marker(page)).toBe('interrupted');await expect(page.locator('input[name=username],.session-identity')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as unknown as{fixture:{reconciliations:number}}).fixture.reconciliations)).toBe(0);
 expect(await page.evaluate(()=>(window as unknown as{retained:()=>Promise<unknown>}).retained())).toMatchObject({ciphertext:[8,7,6,5],recoveryDeadline:'2099-01-01T00:00:00Z'});
});

for(const purpose of ['logout',undefined])test(`interrupted held logout or legacy ambiguous marker requires primary login (${purpose??'legacy'})`,async({page})=>{
 await fixture(page,{personal:true,purpose});await expect(page.locator('input[name=username]')).toBeVisible();expect(await marker(page)).toBeNull();expect(await page.evaluate(()=>(window as unknown as{fixture:{personal:boolean;pendingOidc:boolean}}).fixture)).toMatchObject({personal:false,pendingOidc:false});await expect(page.locator('.session-identity')).toHaveCount(0);
});

test('an older live owner cannot clear a newer queued transition marker and reconciliation cannot steal either lock',async({page})=>{
 await fixture(page);await expect(page.locator('input[name=username]')).toBeVisible();
 await page.evaluate(()=>{const w=window as unknown as{transition:(operation:()=>Promise<void>,purpose:string)=>Promise<void>;first:Promise<void>;second:Promise<void>;releaseFirst:()=>void;releaseSecond:()=>void;enteredFirst:boolean;enteredSecond:boolean};w.first=w.transition(()=>new Promise<void>(resolve=>{w.enteredFirst=true;w.releaseFirst=resolve;}),'enrollment');});
 await expect.poll(()=>page.evaluate(()=>(window as unknown as{enteredFirst:boolean}).enteredFirst)).toBe(true);
 await page.evaluate(()=>{const w=window as unknown as{transition:(operation:()=>Promise<void>,purpose:string)=>Promise<void>;second:Promise<void>;releaseSecond:()=>void;enteredSecond:boolean};w.second=w.transition(()=>new Promise<void>(resolve=>{w.enteredSecond=true;w.releaseSecond=resolve;}),'logout');});
 const newer=await marker(page);
 await page.evaluate(async()=>{const w=window as unknown as{releaseFirst:()=>void;first:Promise<void>};w.releaseFirst();await w.first;});
 await expect.poll(()=>page.evaluate(()=>(window as unknown as{enteredSecond:boolean}).enteredSecond)).toBe(true);expect(await marker(page)).toBe(newer);
 const result=await page.evaluate(async()=>{const w=window as unknown as{resumeTransition:(state:unknown,reconcile:()=>Promise<unknown>)=>Promise<unknown>;fixture:{state:unknown}};return w.resumeTransition(w.fixture.state,async()=>{throw Error('Cannot steal a live transition');});});expect(result).toBeNull();expect(await marker(page)).toBe(newer);
 await page.evaluate(async()=>{const w=window as unknown as{releaseSecond:()=>void;second:Promise<void>};w.releaseSecond();await w.second;});expect(await marker(page)).toBeNull();
});

for(const personal of [false,true])test(`a candidate cannot revive a confirmed or different native identity (${personal})`,async({page})=>{await fixture(page,{personal,purpose:'enrollment',candidateUserId:personal?'different-user':undefined});await expect(page.locator('input[name=username]')).toBeVisible();await expect(page.locator('.session-identity')).toHaveCount(0);expect(await marker(page)).toBeNull();expect(await page.evaluate(()=>localStorage.getItem('open-triage.clinician-session.v1'))).toBeNull();});

test('ordinary web logout completion never invokes native reconciliation or hides the login',async({page})=>{await fixture(page,{web:true,noMarker:true});await expect(page.locator('input[name=username]')).toBeVisible();await page.evaluate(async()=>{await (window as unknown as{transition:(op:()=>Promise<void>,purpose:string)=>Promise<void>}).transition(async()=>{},'logout');});await expect(page.locator('input[name=username]')).toBeVisible();expect(await page.evaluate(()=>(window as unknown as{fixture:{reconciliations:number}}).fixture.reconciliations)).toBe(0);});
