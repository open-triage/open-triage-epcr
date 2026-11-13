import {expect, test} from '@playwright/test';
import {build} from 'esbuild';
import path from 'node:path';

async function bundle(contents: string, native = false) {
  return (await build({bundle:true,write:false,format:'iife',jsx:'automatic',platform:'browser',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},
    ...(native ? {plugins:[{name:'native',setup(builder){builder.onResolve({filter:/^@capacitor\/core$/},()=>({path:'core',namespace:'native'}));builder.onLoad({filter:/.*/,namespace:'native'},()=>({loader:'js',contents:`
      export const Capacitor={isNativePlatform:()=>true,getPlatform:()=> 'android'};
      export const registerPlugin=name=>name==='OpenTriageConnection'?{
      refreshInstallation:async()=>{window.fixture.checks=(window.fixture.checks||0)+1;if(window.fixture.unavailable)throw Error('Offline');if(window.fixture.revoked)window.fixture.state={configured:false,connectionContext:'revoked'};return window.fixture.state},
      state:async()=>window.fixture.state,addListener:async()=>({remove:async()=>{}}),
      beginReplacement:async()=>{window.fixture.begun++;if(window.fixture.holdReplacement)await new Promise(resolve=>{window.fixture.releaseReplacement=()=>{window.fixture.holdReplacement=false;resolve()}});return window.fixture.state={configured:false,origin:'https://original.example',storageScope:'A'.repeat(43),connectionContext:'replacement'}},
      preview:async()=>({origin:'https://original.example',organizationName:'Agency',unitName:'New unit',callSign:'NEW',installationName:'Admin tablet'}),
      confirm:async()=>{window.fixture.state={...window.fixture.state,replacementPending:true,...window.fixture.uncommitted?{pendingOutcome:'not-committed'}:{}};throw Error('Response lost')},
      abandonUncommittedEnrollment:async()=>{window.fixture.abandons=(window.fixture.abandons||0)+1;return window.fixture.state={...window.fixture.state,replacementPending:false,configured:false,connectionContext:'abandoned'}},
      resumeEnrollment:async()=>window.fixture.state={configured:true,origin:'https://original.example',storageScope:'A'.repeat(43),connectionContext:'promoted'},cancel:async()=>{window.fixture.state={configured:true,origin:'https://original.example',storageScope:'A'.repeat(43),connectionContext:'cancelled'}}
      }:{addListener:async()=>({remove:async()=>{}}),state:async()=>({active:true})};
    `}));}}]} : {}),stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents}})).outputFiles[0]!.text;
}

// A fixture-only trigger covers transitions from older APKs; current UI has no replacement control.
test('legacy native replacement settles current identity and resumes only the already confirmed journal after reply loss',async({page})=>{
  const script=await bundle(`import React from 'react';import{createRoot}from'react-dom/client';import{AndroidRuntimeGate}from'./components/android-runtime-gate';import{ANDROID_REPLACE_INSTALLATION}from'./app/android-installation-events'; const LegacyReplacement=()=> <button onClick={()=>window.dispatchEvent(new Event(ANDROID_REPLACE_INSTALLATION))}>Simulate legacy replacement</button>;
    localStorage.setItem('open-triage.clinician-session.v1','old personal identity');
    createRoot(document.getElementById('root')!).render(<AndroidRuntimeGate><main data-clinical>Current workspace<LegacyReplacement/></main></AndroidRuntimeGate>);`,true);
  await page.route('**/__native-reassignment-script',r=>r.fulfill({contentType:'text/javascript',body:script}));
  await page.route('**/__native-reassignment',r=>r.fulfill({contentType:'text/html',body:'<html><body><div id="root"></div><script>window.fixture={begun:0,state:{configured:true,origin:"https://original.example",storageScope:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",connectionContext:"original"}}</script><script src="/__native-reassignment-script"></script></body></html>'}));
  await page.goto('/__native-reassignment');
  await page.evaluate(()=>{(window as unknown as {fixture:{holdReplacement:boolean}}).fixture.holdReplacement=true;});
  await page.getByRole('button',{name:'Simulate legacy replacement'}).click();
  await expect(page.locator('[data-clinical]')).toHaveCount(0);
  // Appearance is not readiness: native replacement and encrypted locking are still settling.
  await expect(page.locator('input[type=file]')).toBeDisabled();
  expect(await page.evaluate(()=>localStorage.getItem('open-triage.clinician-session.v1'))).toBe('old personal identity');
  await page.evaluate(()=>{(window as unknown as {fixture:{releaseReplacement:()=>void}}).fixture.releaseReplacement();});
  await expect(page.locator('input[type=file]')).toBeEnabled();
  await page.getByRole('button',{name:'Return to current installation'}).click();
  await expect(page.locator('[data-clinical]')).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('open-triage.clinician-session.v1'))).toBe('old personal identity');
  await page.getByRole('button',{name:'Simulate legacy replacement'}).click();
  const artifact={version:1,origin:'https://original.example',token:'A'.repeat(43),caPem:'',expiresAt:new Date(Date.now()+240000).toISOString()};
  await page.locator('input[type=file]').setInputFiles({name:'pairing.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(artifact))});
  await expect(page.getByRole('textbox')).toHaveValue('Admin tablet');await expect(page.getByRole('textbox')).not.toBeEditable();await page.getByRole('checkbox').check();await page.locator('button[type=submit]').click();
  await expect(page.getByRole('button',{name:'Retry confirmed pairing'})).toBeVisible();
  await expect(page.locator('input[type=checkbox],[data-clinical]')).toHaveCount(0);
  await expect(page.getByLabel('Update pending server trust')).toBeVisible();
  await page.getByRole('button',{name:'Retry confirmed pairing'}).click();
  await expect(page.locator('[data-clinical]')).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('open-triage.clinician-session.v1'))).toBeNull();
});

test('proved abandonment in the same live gate removes the stale confirmed preview before accepting a new code',async({page})=>{
  const script=await bundle(`import React from 'react';import{createRoot}from'react-dom/client';import{AndroidRuntimeGate}from'./components/android-runtime-gate';import{ANDROID_REPLACE_INSTALLATION}from'./app/android-installation-events'; const LegacyReplacement=()=> <button onClick={()=>window.dispatchEvent(new Event(ANDROID_REPLACE_INSTALLATION))}>Simulate legacy replacement</button>;
    createRoot(document.getElementById('root')!).render(<AndroidRuntimeGate><main data-clinical>Current workspace<LegacyReplacement/></main></AndroidRuntimeGate>);`,true);
  await page.route('**/__live-abandon-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
  await page.route('**/__live-abandon',route=>route.fulfill({contentType:'text/html',body:'<html><body><div id="root"></div><script>window.fixture={begun:0,uncommitted:true,state:{configured:true,origin:"https://original.example",storageScope:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",connectionContext:"original"}}</script><script src="/__live-abandon-script"></script></body></html>'}));
  await page.goto('/__live-abandon');await page.getByRole('button',{name:'Simulate legacy replacement'}).click();
  const artifact={version:1,origin:'https://original.example',token:'A'.repeat(43),caPem:'',expiresAt:new Date(Date.now()+240000).toISOString()};
  await page.getByLabel('Import vehicle pairing file').setInputFiles({name:'pairing.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(artifact))});
  await expect(page.getByRole('textbox')).toHaveValue('Admin tablet');await page.getByRole('checkbox').check();await page.locator('button[type=submit]').click();
  await expect(page.locator('[data-pending-enrollment]')).toBeVisible();await page.getByRole('button',{name:'Use a new pairing code'}).click();
  await expect(page.locator('[data-pending-enrollment]')).toHaveCount(0);
  await expect(page.getByLabel('Import vehicle pairing file')).toBeEnabled();
  await expect(page.getByRole('checkbox')).toHaveCount(0);await expect(page.getByRole('textbox')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as unknown as {fixture:{abandons:number}}).fixture.abandons)).toBe(1);
});

test('native pending recovery handles stay in their original server scope while ciphertext is retained',async({page})=>{
  const script=await bundle(`import{setNativeStorageScope}from'./app/native-storage-context';import{prepareProtectedReport,updateProtectedReport,flushProtectedReport,lockProtectedClinicalStorage,pendingProtectedRecoveryHandles}from'./app/protected-clinical-storage';
    Object.defineProperty(navigator.storage,'persisted',{value:async()=>true});Object.defineProperty(navigator.storage,'persist',{value:async()=>true});
    Object.assign(window,{scope:setNativeStorageScope,prepare:async()=>{await prepareProtectedReport('csrf','report-a');updateProtectedReport('report-a',{report:{id:'report-a'},queuedChanges:[{command:{private:'retained'},attempted:false}]});await flushProtectedReport('report-a');await lockProtectedClinicalStorage();},handles:async()=>[...await pendingProtectedRecoveryHandles()]});`);
  let handle='';
  await page.route('**/api/reports/report-a/**',route=>{
    const url=route.request().url();const body=route.request().postDataJSON();
    if(url.endsWith('/protected-key-envelope')){handle=body.recoveryHandle;return route.fulfill({json:{schemaVersion:1,recoveryHandle:handle,recoveryDeadline:'2099-01-01T00:00:00Z',wrappingKeyVersion:1}});}
    if(url.endsWith('/protected-ciphertext-receipt'))return route.fulfill({json:{schemaVersion:1,recoveryDeadline:'2099-01-01T00:00:00Z'}});
    return route.fulfill({json:body});
  });
  await page.route('**/__native-scope-script',r=>r.fulfill({contentType:'text/javascript',body:script}));
  await page.route('**/__native-scope',r=>r.fulfill({contentType:'text/html',body:'<html><body><script src="/__native-scope-script"></script></body></html>'}));
  await page.goto('/__native-scope');
  type Fixture={scope:(origin:string,legacy?:string)=>void;prepare:()=>Promise<void>;handles:()=>Promise<string[]>};
  await page.evaluate(async()=>{const f=window as unknown as Fixture;f.scope('A'.repeat(43));await f.prepare();});
  expect(await page.evaluate(()=>(window as unknown as Fixture).handles())).toEqual([handle]);
  await page.evaluate(()=>(window as unknown as Fixture).scope('B'.repeat(43)));
  expect(await page.evaluate(()=>(window as unknown as Fixture).handles())).toEqual([]);
  await page.evaluate(()=>(window as unknown as Fixture).scope('A'.repeat(43)));
  expect(await page.evaluate(()=>(window as unknown as Fixture).handles())).toEqual([handle]);
  // Prior APKs stored no scope. Only authenticated old-vault provenance can expose their handles automatically.
  await page.evaluate(()=>new Promise<void>(resolve=>{const request=indexedDB.open('open-triage-protected-clinical-v1');request.onsuccess=()=>{const db=request.result;const transaction=db.transaction('encrypted-reports','readwrite');const store=transaction.objectStore('encrypted-reports');const query=store.getAll();query.onsuccess=()=>{for(const record of query.result){delete record.nativeScope;store.put(record);}};transaction.oncomplete=()=>{db.close();resolve();};};}));
  expect(await page.evaluate(()=>(window as unknown as Fixture).handles())).toEqual([]);
  await page.evaluate(()=>(window as unknown as Fixture).scope('B'.repeat(43),'A'.repeat(43)));
  expect(await page.evaluate(()=>(window as unknown as Fixture).handles())).toEqual([]);
  await page.evaluate(()=>(window as unknown as Fixture).scope('A'.repeat(43),'A'.repeat(43)));
  expect(await page.evaluate(()=>(window as unknown as Fixture).handles())).toEqual([handle]);
});

type RevocationFixture = {fixture: {state: {configured: boolean}; unavailable: boolean; revoked: boolean}};

for (const trigger of ['polling', 'reconnection']) test(`native revocation returns to initial pairing on ${trigger} and stays there after restart`, async ({page}) => {
  await page.clock.install();
  const script = await bundle(`import React from 'react';import{createRoot}from'react-dom/client';import{AndroidRuntimeGate}from'./components/android-runtime-gate';
    createRoot(document.getElementById('root')!).render(<AndroidRuntimeGate><main data-clinical>Current workspace</main></AndroidRuntimeGate>);`, true);
  await page.route('**/__revoked-script', r => r.fulfill({contentType:'text/javascript',body:script}));
  await page.route('**/__revoked', r => r.fulfill({contentType:'text/html',body:`<html><body><div id="root"></div><script>
    window.fixture={state:JSON.parse(localStorage.getItem('fixture.native')||'null')||{configured:true,origin:'https://original.example',storageScope:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',connectionContext:'original'}};
    </script><script src="/__revoked-script"></script></body></html>`}));
  await page.goto('/__revoked');
  await expect(page.locator('[data-clinical]')).toBeVisible();
  const ciphertext = () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve,reject) => {
      const request = indexedDB.open('open-triage-protected-clinical-v1',1);
      request.onupgradeneeded = () => request.result.createObjectStore('encrypted-reports',{keyPath:'localRecordId'});
      request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error);
    });
    const tx = db.transaction('encrypted-reports','readwrite'), store = tx.objectStore('encrypted-reports');
    const records = await new Promise<unknown[]>((resolve,reject) => {
      const request = store.getAll();request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error);
    });
    if (!records.length) store.put({localRecordId:'pending',schemaVersion:1,algorithm:'AES-256-GCM',
      recoveryHandle:'opaque',recoveryDeadline:'2099-01-01T00:00:00Z',ciphertextRevision:2,synchronizedRevision:1,
      updatedAt:'2026-10-13T10:00:00Z',nonce:new Uint8Array(12).buffer,ciphertext:new Uint8Array([1,2,3]).buffer});
    await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
    db.close();return records;
  });
  await ciphertext();const retained = await ciphertext();expect(retained).toHaveLength(1);

  await page.evaluate(() => {
    localStorage.setItem('open-triage.clinician-session.v1','old personal identity');
    (window as unknown as RevocationFixture).fixture.unavailable=true;
  });
  await page.clock.runFor(10_100);
  await expect(page.locator('[data-clinical]')).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('open-triage.clinician-session.v1'))).toBe('old personal identity');
  await page.evaluate(() => { (window as unknown as RevocationFixture).fixture.unavailable=false;(window as unknown as RevocationFixture).fixture.revoked=true; });
  if (trigger === 'reconnection') {
    await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,value:false});window.dispatchEvent(new Event('offline'));});
    await page.clock.runFor(10_100);
    await expect(page.locator('[data-clinical]')).toBeVisible();
    await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,value:true});window.dispatchEvent(new Event('online'));});
  } else await page.clock.runFor(10_100);
  await expect(page.getByLabel('Import vehicle pairing file')).toBeEnabled();
  await expect(page.locator('[data-clinical]')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Return to current installation'})).toHaveCount(0);
  expect(await page.evaluate(()=>localStorage.getItem('open-triage.clinician-session.v1'))).toBeNull();
  expect(await ciphertext()).toEqual(retained);
  await page.evaluate(()=>localStorage.setItem('fixture.native',JSON.stringify((window as unknown as RevocationFixture).fixture.state)));
  await page.reload();
  await expect(page.getByLabel('Import vehicle pairing file')).toBeEnabled();
  await expect(page.locator('[data-clinical]')).toHaveCount(0);
});
