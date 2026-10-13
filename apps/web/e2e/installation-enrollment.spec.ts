import { expect,test } from '@playwright/test';
import { build } from 'esbuild';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
let script:string,css:string;
test.beforeAll(async()=>{
 css=await readFile(path.resolve(__dirname,'../app/styles.css'),'utf8');
 const result=await build({bundle:true,write:false,jsx:'automatic',format:'iife',platform:'browser',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import{InstallationEnrollment}from './components/installation-enrollment';import{UnitInstallations}from './components/unit-installations';createRoot(document.getElementById('root')).render(new URLSearchParams(location.search).get('admin')?<UnitInstallations unitId='unit' unitName='Medic 7' csrfToken='csrf' language={new URLSearchParams(location.search).get('language')??'en'}/>:<InstallationEnrollment/>);`}});
 script=result.outputFiles[0]!.text;
});
for(const language of ['en','sv'])test(`${language} intended installation confirmation, multiple contexts, logout and cleared data`,async({page,context},testInfo)=>{
 const t=(en:string,sv:string)=>language==='sv'?sv:en;
 let inventory:string[]=[],consumed=0;
 const code='A'.repeat(43);
 await context.route('**/__enroll-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
 await context.route('**/__enroll?*',route=>route.fulfill({contentType:'text/html',body:`<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/__enroll-script"></script></body></html>`}));
 await context.route('**/api/installations/**',async route=>{
 const request=route.request(),cookie=request.headers().cookie??'';
 if(request.url().endsWith('/current')) {
 const name=/open_triage_installation=([^;]+)/.exec(cookie)?.[1];
 return route.fulfill({json:name?{enrolled:true,installation:{id:name,name}}:{enrolled:false}});
 }
 expect(request.headers()['x-installation-enrollment']).toBe('1');
 const body=request.postDataJSON();expect(body.token).toBe(code);
 if(request.url().endsWith('/preview'))return route.fulfill({json:{unitName:'Medic 7',callSign:'M7'}});
 consumed++;expect(body.confirmInstallation).toBe(true);
 inventory.push(body.name);
 return route.fulfill({headers:{'set-cookie':`open_triage_installation=${body.name}; Path=/api; HttpOnly; SameSite=Strict`},json:{id:body.name,name:body.name}});
 });
 await context.addCookies([{name:'open_triage_session',value:'expired-clinician-cookie',url:'http://127.0.0.1:3109/api'}]);
 await page.goto(`/__enroll?language=${language}#code=${code}`);
 await expect(page.getByText('Medic 7 — M7')).toBeVisible();
 expect(consumed).toBe(0);expect(page.url()).not.toContain(code);
 await page.getByRole('button',{name:t('Copy enrollment link for the intended installation','Kopiera kopplingslänk för avsedd installation')}).click();
 await expect(page.getByLabel(t('Copy this link, then open it in the intended browser or PWA','Kopiera länken och öppna den i avsedd webbläsare eller PWA'))).toHaveValue(`http://127.0.0.1:3109/__enroll?language=${language}#code=${code}`);
 expect(page.url()).not.toContain(code);expect(consumed).toBe(0);
 const button=page.getByRole('button',{name:t('Pair this installation','Koppla denna installation'),exact:true});
 await expect(button).toBeDisabled();
 await page.getByLabel(t('Installation name','Installationsnamn'),{exact:true}).fill('Cab-browser');
 await expect(button).toBeDisabled();
 await page.getByLabel(t('I confirm this is the intended browser or PWA installation.','Jag bekräftar att detta är avsedd webbläsare eller PWA-installation.')).check();
 await page.setViewportSize({width:360,height:800});await button.scrollIntoViewIfNeeded();await expect(button).toBeInViewport();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath(`enrollment-${language}-mobile.png`)});
 await button.focus();await button.press('Enter');await expect(page.getByRole('status')).toContainText('Cab-browser');expect(consumed).toBe(1);
 expect(await page.evaluate(()=>document.cookie)).not.toContain('open_triage_installation');
 // Normal clinician logout clears clinician state only; the independent cookie persists.
 await context.clearCookies({name:'open_triage_session'});
 await page.evaluate(()=>localStorage.removeItem('open-triage.clinician-session.v1'));
 await page.goto(`/__enroll?language=${language}`);await expect(page.getByRole('status')).toContainText('Cab-browser');
 // Scanner opening another storage context cannot silently consume any code.
 await context.clearCookies();
 await page.goto(`/__enroll?language=${language}#code=${code}`);
 await expect(page.getByText('Medic 7 — M7')).toBeVisible();expect(consumed).toBe(1);
 await expect(button).toBeDisabled();
 await page.getByLabel(t('Installation name','Installationsnamn'),{exact:true}).fill('New-browser');
 await page.getByRole('checkbox').check();await button.click();
 await expect(page.getByRole('status')).toContainText('New-browser');expect(inventory).toEqual(['Cab-browser','New-browser']);
});

for(const language of ['en','sv'])test(`${language} administrator inventory and actual QR issuance on mobile`,async({page},testInfo)=>{
 const t=(en:string,sv:string)=>language==='sv'?sv:en;
 await page.route('**/__enroll-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
 await page.route('**/__enroll?*',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="--green:#593c91;--green-dark:#30205a"><div id="root"></div><script src="/__enroll-script"></script></body></html>`}));
 await page.route('**/api/admin/units/unit/installations',route=>route.fulfill({json:{items:[{id:'1',name:'Cab browser'},{id:'2',name:'Rear PWA'}],nextCursor:null}}));
 await page.route('**/api/admin/units/unit/enrollment',route=>{
 expect(route.request().headers()['x-csrf-token']).toBe('csrf');
 return route.fulfill({json:{token:'A'.repeat(43),origin:'http://127.0.0.1:3109',expiresAt:'2026-10-13T17:00:00Z'}});
 });
 await page.goto(`/__enroll?admin=1&language=${language}`);
 const trigger=page.getByRole('button',{name:`${t('Installations','Installationer')} Medic 7`,exact:true});
 await trigger.focus();await trigger.press('Enter');
 const dialog=page.getByRole('dialog');await expect(dialog.getByText('Rear PWA',{exact:true})).toBeVisible();
 const issue=dialog.getByRole('button',{name:t('Issue five-minute QR code','Utfärda femminuters QR-kod'),exact:true});
 await page.setViewportSize({width:360,height:800});
 await issue.focus();await issue.press('Enter');
 await expect(dialog.getByRole('img')).toBeVisible();
 expect(await dialog.getByRole('img').getAttribute('src')).toMatch(/^data:image\/png;base64,/);
 await expect(dialog.getByRole('textbox')).toHaveValue('http://127.0.0.1:3109/enroll/#code='+'A'.repeat(43));
 await dialog.getByRole('button',{name:t('Close','Stäng'),exact:true}).scrollIntoViewIfNeeded();
 await expect(dialog.getByRole('button',{name:t('Close','Stäng'),exact:true})).toBeInViewport();
 await page.screenshot({path:testInfo.outputPath(`inventory-${language}-mobile.png`)});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(trigger).toBeFocused();
});

test('concurrent tabs bootstrap one HttpOnly installation authority; a separate browser context stays independent',async({context,browser})=>{
 const compiled=await build({bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'ts',contents:`import {installationRequest} from './app/installation-enrollment';(window as any).bootstrap=()=>installationRequest('current');`}});
 let issued=0;
 async function setup(target:import('@playwright/test').BrowserContext){
 await target.route('**/__bootstrap-script',route=>route.fulfill({contentType:'text/javascript',body:compiled.outputFiles[0]!.text}));
 await target.route('**/__bootstrap',route=>route.fulfill({contentType:'text/html',body:'<html><body><script src="/__bootstrap-script"></script></body></html>'}));
 await target.route('**/api/installations/current',async route=>{
 let credential=/open_triage_installation=([^;]+)/.exec(route.request().headers().cookie??'')?.[1];
 if(!credential){credential=`context-${++issued}`;await new Promise(resolve=>setTimeout(resolve,75));}
 await route.fulfill({headers:{'set-cookie':`open_triage_installation=${credential}; Path=/api; HttpOnly; SameSite=Strict`},json:{enrolled:false,context:credential}});
 });
 }
 await setup(context);
 const one=await context.newPage(),two=await context.newPage();
 await Promise.all([one.goto('/__bootstrap'),two.goto('/__bootstrap')]);
 const results=await Promise.all([one.evaluate(()=> (window as unknown as {bootstrap:()=>Promise<{context:string}>}).bootstrap()),two.evaluate(()=> (window as unknown as {bootstrap:()=>Promise<{context:string}>}).bootstrap())]);
 expect(results[0]!.context).toBe(results[1]!.context);expect(issued).toBe(1);
 const other=await browser.newContext({baseURL:'http://127.0.0.1:3109'});
 try {await setup(other);const page=await other.newPage();await page.goto('/__bootstrap');
 const result=await page.evaluate(()=> (window as unknown as {bootstrap:()=>Promise<{context:string}>}).bootstrap());
 expect(result.context).not.toBe(results[0]!.context);expect(issued).toBe(2);
 expect(await page.evaluate(()=>document.cookie)).not.toContain('open_triage_installation');
 }finally{await other.close();}
});

for(const language of ['en','sv'])test(`${language} confirmed reassignment settles all tabs before replacing the binding and clears old clinician context`,async({context,page})=>{
 const t=(en:string,sv:string)=>language==='sv'?sv:en;
 const participant=await build({bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'ts',contents:`import{participateInInstallationTransition}from './app/installation-transition';import{lockProtectedClinicalStorage}from './app/protected-clinical-storage';(window as any).settled=false;(window as any).release=()=>{};(window as any).dispose=participateInInstallationTransition(async()=>{(window as any).ending=true;await new Promise<void>(resolve=>{(window as any).release=resolve});await lockProtectedClinicalStorage();(window as any).settled=true;});`}});
 let replaced=0;
 await context.route('**/__enroll-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
 await context.route('**/__stale-script',route=>route.fulfill({contentType:'text/javascript',body:participant.outputFiles[0]!.text}));
 await context.route('**/__stale',route=>route.fulfill({contentType:'text/html',body:'<html><body><script src="/__stale-script"></script></body></html>'}));
 await context.route('**/__enroll?*',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/__enroll-script"></script></body></html>`}));
 await context.route('**/api/installations/**',async route=>{
 if(route.request().url().endsWith('/current'))return route.fulfill({json:{enrolled:true,installation:{id:'old',name:'Cab browser'}}});
 if(route.request().url().endsWith('/preview'))return route.fulfill({json:{unitName:'Medic 8',callSign:'M8'}});
 expect(route.request().postDataJSON()).toEqual({token:'A'.repeat(43),name:'Cab browser',confirmInstallation:true,reassign:true});
 replaced++;
 return route.fulfill({json:{id:'new',name:'Cab browser'}});
 });
 const stale=await context.newPage();await stale.goto('/__stale');
 await expect.poll(()=>stale.evaluate(async()=> (await navigator.locks.query()).held?.some(lock=>lock.name==='open-triage.installation-clinical-context'))).toBe(true);
 await page.goto(`/__enroll?language=${language}#code=${'A'.repeat(43)}`);
 await expect(page.getByText('Medic 8 — M8')).toBeVisible();
 await expect(page.getByRole('alert')).toContainText(t('Reassignment signs out every clinician tab.','Omplacering loggar ut alla klinikerflikar.'));
 const submit=page.getByRole('button',{name:t('Reassign and sign out','Omplacera och logga ut')});await expect(submit).toBeDisabled();
 await page.evaluate(()=>localStorage.setItem('open-triage.clinician-session.v1','old clinician'));
 await page.getByRole('checkbox').check();await submit.click();
 await expect.poll(()=>page.evaluate(()=>!!localStorage.getItem('open-triage.installation-transition.v1'))).toBe(true);
 expect(replaced).toBe(0);
 // React teardown/refresh must retain the barrier until pending writes settle.
 await stale.evaluate(()=> (window as unknown as {dispose:()=>void}).dispose());
 expect(replaced).toBe(0);
 await expect.poll(()=>stale.evaluate(()=> (window as unknown as {ending:boolean}).ending)).toBe(true);
 await stale.evaluate(()=> (window as unknown as {release:()=>void}).release());
 await expect(page.getByRole('status')).toContainText('Cab browser');expect(replaced).toBe(1);
 expect(await stale.evaluate(()=> (window as unknown as {settled:boolean}).settled)).toBe(true);
 expect(await page.evaluate(()=>localStorage.getItem('open-triage.clinician-session.v1'))).toBeNull();
 expect(await page.evaluate(()=>localStorage.getItem('open-triage.installation-transition.v1'))).toBeNull();
});
