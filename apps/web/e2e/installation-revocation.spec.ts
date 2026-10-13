import { expect,test } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import productionSettings from '@open-triage/contracts/config/installation.production.json';
let inventoryScript:string,gateScript:string,css:string;
const session={csrfToken:'csrf',user:{id:'clinician',displayName:'Fictional clinician'},organization:{id:'agency',name:'Fictional EMS'},startedAt:'2026-10-13T10:00:00Z',expiresAt:'2099-10-13T22:00:00Z',capabilities:['clinical:document'],workspaceAvailable:true};
test.beforeAll(async()=>{
 css=await readFile(path.resolve(__dirname,'../app/styles.css'),'utf8');
 async function bundle(contents:string){const result=await build({bundle:true,write:false,jsx:'automatic',format:'iife',platform:'browser',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents}});return result.outputFiles[0]!.text;}
 inventoryScript=await bundle(`import React from 'react';import{createRoot}from'react-dom/client';import{UnitInstallations}from'./components/unit-installations';createRoot(document.getElementById('root')).render(<UnitInstallations unitId='unit' unitName='Medic 7' csrfToken='csrf' language={new URLSearchParams(location.search).get('language')??'en'}/>);`);
 gateScript=await bundle(`import React from 'react';import{createRoot}from'react-dom/client';import{ClinicianSessionGate}from'./components/clinician-session-gate';createRoot(document.getElementById('root')).render(<ClinicianSessionGate>{()=>null}</ClinicianSessionGate>);`);
});
async function harness(page:import('@playwright/test').Page,script:string){
 await page.route('**/__device-script',r=>r.fulfill({contentType:'text/javascript',body:script}));
 await page.route('**/__device?*',r=>r.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="--green:#593c91;--green-dark:#30205a;--destructive:#92212e"><div id="root"></div><script src="/__device-script"></script></body></html>`}));
}
for(const language of ['en','sv'])test(`${language} administrator confirms device scope and understands offline revocation`,async({page},info)=>{
 const t=(en:string,sv:string)=>language==='sv'?sv:en;
 await harness(page,inventoryScript);let revoked=false;
 await page.route('**/api/admin/units/unit/installations',r=>r.fulfill({json:{items:[{id:'lost',name:'Lost browser',revokedAt:revoked?'2026-10-13':null},{id:'other',name:'Other clinician device',revokedAt:null}],nextCursor:null}}));
 await page.route('**/api/admin/units/unit/installations/lost/revoke',r=>{expect(r.request().headers()['x-csrf-token']).toBe('csrf');expect(r.request().method()).toBe('POST');revoked=true;return r.fulfill({json:{revoked:true,sessionsRevoked:1}});});
 await page.goto(`/__device?language=${language}`);
 const trigger=page.getByRole('button',{name:`${t('Installations','Installationer')} Medic 7`,exact:true});await trigger.focus();await trigger.press('Enter');
 const dialog=page.getByRole('dialog');await expect(dialog).toContainText(t('This is not remote erasure','Detta är ingen fjärradering'));
 const lost=dialog.getByRole('button',{name:`${t('Revoke','Återkalla')} Lost browser`,exact:true});await lost.focus();await lost.press('Enter');
 const confirm=dialog.getByRole('button',{name:t('Confirm revocation','Bekräfta återkallelse'),exact:true});await expect(confirm).toBeVisible();expect(revoked).toBe(false);
 await page.setViewportSize({width:360,height:800});await confirm.scrollIntoViewIfNeeded();await expect(confirm).toBeInViewport();await confirm.focus();await confirm.press('Enter');
 await expect(lost).toBeDisabled();await expect(dialog.getByRole('button',{name:`${t('Revoke','Återkalla')} Other clinician device`,exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`revocation-${language}-mobile.png`)});
 await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
});

for(const transition of ['reconnection','connected polling'])test(`${transition} locks authority while retaining pending ciphertext and its deadline`,async({page})=>{
 await page.clock.install();
 await harness(page,gateScript);let revoked=false,assessments=0;
 await page.addInitScript(stored=>localStorage.setItem('open-triage.clinician-session.v1',JSON.stringify(stored)),session);
 await page.route('**/api/installation',r=>r.fulfill({json:{settings:productionSettings}}));
 await page.route('**/api/sessions/current',r=>{assessments++;return r.fulfill(revoked?{status:401,json:{message:'Revoked installation'}}:{json:session});});
 await page.route('**/api/calls/assigned',r=>r.fulfill({json:{assignedCalls:[],canceledAssignmentIds:[],refreshedAt:new Date().toISOString()}}));
 await page.route('**/api/reports/open',r=>r.fulfill({json:{openCalls:[],completedReportIds:[],refreshedAt:new Date().toISOString()}}));
 await page.goto('/__device?clinical=1');await expect(page.getByRole('heading',{name:'Assigned calls',exact:true})).toBeVisible();
 const snapshot=async()=>page.evaluate(async()=>{
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('open-triage-protected-clinical-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('encrypted-reports',{keyPath:'localRecordId'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const tx=db.transaction('encrypted-reports','readwrite'),store=tx.objectStore('encrypted-reports');
 const all=await new Promise<any[]>((resolve,reject)=>{const r=store.getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 if(!all.length)store.put({localRecordId:'pending',schemaVersion:1,algorithm:'AES-256-GCM',recoveryHandle:'opaque-pending',recoveryDeadline:'2099-10-14T10:00:00Z',ciphertextRevision:3,synchronizedRevision:2,updatedAt:'2026-10-13T10:00:00Z',nonce:new Uint8Array(12).buffer,ciphertext:new Uint8Array([1,2,3,4]).buffer});
 await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();return all.map(r=>({...r,nonce:Array.from(new Uint8Array(r.nonce)),ciphertext:Array.from(new Uint8Array(r.ciphertext))}));
 });
 await snapshot();const before=await snapshot();expect(before).toHaveLength(1);
 if(transition==='reconnection'){
 await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,value:false});window.dispatchEvent(new Event('offline'));});
 revoked=true;const prior=assessments;
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 expect(assessments).toBe(prior);await expect(page.getByRole('heading',{name:'Assigned calls',exact:true})).toBeVisible();
 await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,value:true});window.dispatchEvent(new Event('online'));});
 }else{revoked=true;await page.clock.runFor(30_100);}
 await expect(page.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>localStorage.getItem('open-triage.clinician-session.v1'))).toBeNull();
 expect(await snapshot()).toEqual(before);
});
