import { expect,test } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';

test('reassignment retains pending ciphertext, locks stale tabs, and allows original-author recovery only after fresh login',async({context,page})=>{
 const compiled=await build({bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'ts',contents:`
 import{participateInInstallationTransition,transitionInstallation}from './app/installation-transition';
 import{createClinicianSession,storeClinicianSession,clearClinicianSession}from './app/clinician-session';
 import{prepareProtectedReport,updateProtectedReport,protectedStorageActive,lockProtectedClinicalStorage,recoverProtectedReport}from './app/protected-clinical-storage';
 const report='original-report';
 Object.defineProperty(navigator.storage,'persisted',{value:async()=>true});
 Object.defineProperty(navigator.storage,'persist',{value:async()=>true});
 Object.assign(window,{
 start:async()=>{await prepareProtectedReport('old-csrf',report);participateInInstallationTransition(async()=>{await lockProtectedClinicalStorage();clearClinicianSession(localStorage);});},
 edit:()=>updateProtectedReport(report,{report:{id:report,documentingUserId:'original-author',organizationId:'original-agency',unitId:'original-unit',formVersionId:'pinned-form'},queuedChanges:[{command:{note:'private unsynchronized work'},attempted:false}]}),
 active:()=>protectedStorageActive(report),
 move:()=>transitionInstallation(async()=>{const result=await fetch('/api/installations/enroll',{method:'POST'});if(!result.ok)throw Error('failed');}),
 login:async(username:string)=>{const session=await createClinicianSession({username,password:'personal-password'});storeClinicianSession(localStorage,session);},
 recover:()=>recoverProtectedReport('fresh-csrf',report)
 });`}});
 let key='',handle='',fresh=false,currentUser='',moves=0,loginCount=0;
 const deadline='2099-01-01T00:00:00Z';
 await context.route('**/__transition-script',route=>route.fulfill({contentType:'text/javascript',body:compiled.outputFiles[0]!.text}));
 await context.route('**/__transition',route=>route.fulfill({contentType:'text/html',body:'<html><body><script src="/__transition-script"></script></body></html>'}));
 await context.route('**/api/reports/original-report/**',route=>{
 const url=route.request().url();
 if(url.endsWith('/protected-key-envelope')){const body=route.request().postDataJSON();key=body.reportKeyBase64;handle=body.recoveryHandle;return route.fulfill({json:{schemaVersion:1,recoveryHandle:handle,recoveryDeadline:deadline,wrappingKeyVersion:1}});}
 if(url.endsWith('/protected-ciphertext-checkpoint'))return route.fulfill({json:route.request().postDataJSON()});
 if(url.endsWith('/protected-ciphertext-receipt'))return route.fulfill({json:{schemaVersion:1,recoveryDeadline:deadline}});
 if(!fresh||currentUser!=='original-author')return route.fulfill({status:404});
 if(url.endsWith('/recovery-grants'))return route.fulfill({json:{schemaVersion:1,envelopeVersion:1,recoveryHandle:handle,grant:'one-use-grant',expiresAt:deadline,reportStatus:'draft'}});
 return route.fulfill({json:{schemaVersion:1,envelopeVersion:1,wrappingKeyVersion:1,reportKeyBase64:key}});
 });
 await context.route('**/api/installations/enroll',route=>{moves++;fresh=false;return route.fulfill({json:{id:'new-binding'}});});
 await context.route('**/api/sessions',route=>{
 loginCount++;currentUser=route.request().postDataJSON().username;fresh=true;
 return route.fulfill({json:{csrfToken:'fresh-csrf',user:{id:currentUser,displayName:currentUser},organization:{id:'incoming-agency',name:'Incoming agency'},startedAt:new Date().toISOString(),expiresAt:deadline,capabilities:['clinical:document'],workspaceAvailable:true}});
 });
 await page.goto('/__transition');
 type Harness={start:()=>Promise<void>;edit:()=>void;active:()=>boolean;move:()=>Promise<void>;login:(username:string)=>Promise<void>;recover:()=>Promise<unknown>};
 await page.evaluate(()=> (window as unknown as Harness).start());
 await expect.poll(()=>page.evaluate(async()=> (await navigator.locks.query()).held?.some(lock=>lock.name==='open-triage.installation-clinical-context'))).toBe(true);
 await page.evaluate(()=> (window as unknown as Harness).edit());
 const enrollment=await context.newPage();await enrollment.goto('/__transition');
 await enrollment.evaluate(()=> (window as unknown as Harness).move());expect(moves).toBe(1);expect(loginCount).toBe(0);
 expect(await page.evaluate(()=> (window as unknown as Harness).active())).toBe(false);
 const records=await page.evaluate(()=>new Promise<Array<{recoveryDeadline:string;ciphertextRevision:number;synchronizedRevision:number;ciphertext:ArrayBuffer}>>(resolve=>{
 const request=indexedDB.open('open-triage-protected-clinical-v1');request.onsuccess=()=>{const db=request.result;const query=db.transaction('encrypted-reports').objectStore('encrypted-reports').getAll();query.onsuccess=()=>{resolve(query.result);db.close();};};
 }));
 expect(records).toHaveLength(1);expect(records[0]!.recoveryDeadline).toBe(deadline);
 expect(records[0]!.ciphertextRevision).toBeGreaterThan(records[0]!.synchronizedRevision);
 expect(await page.evaluate(()=> (window as unknown as Harness).recover())).toBeNull();
 await page.evaluate(()=> (window as unknown as Harness).login('other-author'));
 expect(await page.evaluate(()=> (window as unknown as Harness).recover())).toBeNull();
 await page.evaluate(()=> (window as unknown as Harness).login('original-author'));
 const recovered=await page.evaluate(()=> (window as unknown as Harness).recover());
 expect(recovered).toEqual({schemaVersion:1,report:{report:{id:'original-report',documentingUserId:'original-author',organizationId:'original-agency',unitId:'original-unit',formVersionId:'pinned-form'},queuedChanges:[{command:{note:'private unsynchronized work'},attempted:false}]}});
 expect(loginCount).toBe(2);
 const retainedDeadline=await page.evaluate(()=>new Promise<string>(resolve=>{const request=indexedDB.open('open-triage-protected-clinical-v1');request.onsuccess=()=>{const db=request.result;const query=db.transaction('encrypted-reports').objectStore('encrypted-reports').getAll();query.onsuccess=()=>{resolve(query.result[0].recoveryDeadline);db.close();};};}));
 expect(retainedDeadline).toBe(deadline);
});

for(const operation of ['login','password','restart'] as const)test(`delayed ${operation} response cannot restore cached clinician evidence after completed reassignment`,async({context,page})=>{
 const compiled=await build({bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'ts',contents:`
 import{transitionInstallation}from './app/installation-transition';
 import{createClinicianSession,changeClinicianPassword,authenticateRestartedClinicianSession,storeClinicianSession}from './app/clinician-session';
 const stored={csrfToken:'old-csrf',user:{id:'old-user'},organization:{id:'old-agency'},expiresAt:'2099-01-01T00:00:00Z'} as any;
 Object.assign(window,{move:()=>transitionInstallation(async()=>{}),authenticate:async(operation:string)=>{
 const result=operation==='login'?await createClinicianSession({username:'person',password:'password'}):operation==='password'?await changeClinicianPassword('old','new','old-csrf'):await authenticateRestartedClinicianSession(stored);
 if(result)storeClinicianSession(localStorage,result);return result;
 }});`}});
 await context.route('**/__generation-script',route=>route.fulfill({contentType:'text/javascript',body:compiled.outputFiles[0]!.text}));
 await context.route('**/__generation',route=>route.fulfill({contentType:'text/html',body:'<html><body><script src="/__generation-script"></script></body></html>'}));
 let started=false,release=()=>{};
 await context.route('**/api/sessions**',async route=>{
 started=true;await new Promise<void>(resolve=>{release=resolve;});
 await route.fulfill({json:{csrfToken:'old-csrf',user:{id:'old-user',displayName:'Old user'},organization:{id:'old-agency',name:'Old agency'},expiresAt:'2099-01-01T00:00:00Z',startedAt:new Date().toISOString(),capabilities:['clinical:document'],workspaceAvailable:true}});
 });
 await page.goto('/__generation');
 type Harness={move:()=>Promise<void>;authenticate:(operation:string)=>Promise<unknown>};
 const delayed=page.evaluate(operation=>(window as unknown as Harness).authenticate(operation).then(result=>({result}),error=>({error:String(error)})),operation);
 await expect.poll(()=>started).toBe(true);
 const enrollment=await context.newPage();await enrollment.goto('/__generation');
 await enrollment.evaluate(()=> (window as unknown as Harness).move());
 release();const result=await delayed;
 if(operation==='restart')expect(result).toEqual({result:null});else expect(result).toHaveProperty('error',expect.stringContaining('Installation changed'));
 expect(await page.evaluate(()=>localStorage.getItem('open-triage.clinician-session.v1'))).toBeNull();
});

test('StrictMode participant replay settles its barrier without ending personal authentication',async({page,context})=>{
 const compiled=await build({bundle:true,write:false,jsx:'automatic',format:'iife',platform:'browser',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`
 import React,{useEffect}from'react';import{createRoot}from'react-dom/client';
 import{participateInInstallationTransition,transitionInstallation}from './app/installation-transition';import{clearClinicianSession}from './app/clinician-session';
 let ended=0;localStorage.setItem('open-triage.clinician-session.v1','personal session');
 function Participant(){useEffect(()=>participateInInstallationTransition(async()=>{ended++;clearClinicianSession(localStorage);}),[]);return <p>Personal authentication remains active</p>;}
 createRoot(document.getElementById('root')!).render(<React.StrictMode><Participant/></React.StrictMode>);
 Object.assign(window,{ended:()=>ended,move:()=>transitionInstallation(async()=>{})});`}});
 await context.route('**/__replay-script',route=>route.fulfill({contentType:'text/javascript',body:compiled.outputFiles[0]!.text}));
 await context.route('**/__replay',route=>route.fulfill({contentType:'text/html',body:'<html><body><div id="root"></div><script src="/__replay-script"></script></body></html>'}));
 await page.goto('/__replay');
 await expect(page.getByText('Personal authentication remains active')).toBeVisible();
 await expect.poll(()=>page.evaluate(async()=> (await navigator.locks.query()).held?.filter(lock=>lock.name==='open-triage.installation-clinical-context').length)).toBe(1);
 expect(await page.evaluate(()=> (window as unknown as {ended:()=>number}).ended())).toBe(0);
 expect(await page.evaluate(()=>localStorage.getItem('open-triage.clinician-session.v1'))).toBe('personal session');
 await page.evaluate(()=> (window as unknown as {move:()=>Promise<void>}).move());
 expect(await page.evaluate(()=> (window as unknown as {ended:()=>number}).ended())).toBe(1);
 expect(await page.evaluate(()=>localStorage.getItem('open-triage.clinician-session.v1'))).toBeNull();
});
