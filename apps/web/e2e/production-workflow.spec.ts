import {expect,test} from '@playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
let script:string,css:string;
test.beforeAll(async()=>{
 css=await readFile(path.resolve(__dirname,'../app/styles.css'),'utf8');
 script=(await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{ProductionWorkflowPanel}from'./components/production-workflow';function App(){const[visible,setVisible]=useState(true);return <><button onClick={()=>{localStorage.setItem('open-triage.installation-generation.v1','incoming-user');setVisible(false);}}>Switch fixture user</button>{visible?<ProductionWorkflowPanel language={document.documentElement.lang} csrfToken='csrf' canWrite={!location.search.includes('readonly')}/>:<p>Incoming fixture workspace</p>}</>};createRoot(document.getElementById('root')).render(<App/>);`}})).outputFiles[0]!.text;
});
const readiness={groupId:'group',revision:1,state:'preparation',enabledAt:null,canEnable:false,providerReady:true,totalUnits:51,offset:0,missingSchedules:1,unenrolledUnits:1,
 units:Array.from({length:50},(_,i)=>({id:`unit-${i}`,organizationId:'child',agencyName:'Child agency',callSign:`UNIT-${i}`,scheduleSelected:i!==0,enrolled:i!==0}))};
for(const language of ['en','sv'])for(const width of [390,1440])test(`explicit readiness, pagination and authenticated enable at ${width}px in ${language}`,async({page})=>{
 await page.setViewportSize({width,height:844});
 await page.route('**/__rollout*',r=>r.fulfill({contentType:'text/html',body:`<html lang='${language}'><head><style>${css}</style></head><body style='--green:#315ba8;--text-color:#202850'><div class='admin-configuration agency-settings' id='root'></div><script src='/__rollout-script'></script></body></html>`}));
 await page.route('**/__rollout-script',r=>r.fulfill({contentType:'text/javascript',body:script}));
 let prepared=false,authenticated=false;
 await page.route('**/api/admin/authentication/workflow?*',r=>{
  const offset=Number(new URL(r.request().url()).searchParams.get('offset'));const units=offset? [{...readiness.units[0]!,id:'unit-50',callSign:'LAST-UNIT',scheduleSelected:prepared,enrolled:prepared}]:readiness.units;
  if(r.request().method()==='PUT'){
   expect(authenticated).toBe(true);expect(r.request().headers()['x-csrf-token']).toBe('csrf');expect(r.request().postDataJSON()).toEqual({expectedRevision:1,confirm:true});
   return r.fulfill({json:{...readiness,state:'enabled',revision:2,canEnable:false,units}});
  }
  return r.fulfill({json:{...readiness,offset,units,canEnable:prepared,missingSchedules:prepared?0:1,unenrolledUnits:prepared?0:1}});
 });
 await page.route('**/api/sessions/reauthenticate',r=>{authenticated=true;expect(r.request().postDataJSON().currentPassword).toBe('Personal password 42!');return r.fulfill({json:{reauthenticatedUntil:'2099-01-01T00:00:00Z'}});});
 await page.goto('/__rollout');const enable=page.getByRole('button',{name:language==='en'?'Enable production requirements':'Aktivera produktionskrav'});
 await expect(enable).toBeDisabled();await expect(page.getByRole('table')).toContainText(language==='en'?'Select a schedule':'Välj ett schema');
 await page.getByRole('button',{name:language==='en'?'Next units':'Nästa enheter'}).click();await expect(page.getByRole('table')).toContainText('LAST-UNIT');
 prepared=true;await page.getByRole('button',{name:language==='en'?'Refresh readiness':'Uppdatera beredskap'}).click();
 await page.getByLabel(language==='en'?'Your current password is required to save':'Ditt nuvarande lösenord krävs för att spara').fill('Personal password 42!');
 await expect(enable).toBeEnabled();await enable.click();await expect(page.getByText(language==='en'?'Enabled: new production jobs':'Aktiverat: nya produktionsuppdrag',{exact:false})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`/tmp/auth019-rollout-${language}-${width}.png`});
});

test('late enable response after user switch cannot publish an outgoing rollout event',async({page})=>{
 await page.route('**/__rollout',r=>r.fulfill({contentType:'text/html',body:`<html lang='en'><body><div id='root'></div><script src='/__rollout-script'></script></body></html>`}));
 await page.route('**/__rollout-script',r=>r.fulfill({contentType:'text/javascript',body:script}));
 let release:()=>void=()=>{};
 await page.route('**/api/admin/authentication/workflow?*',async r=>{
  if(r.request().method()==='PUT')await new Promise<void>(resolve=>{release=resolve;});
  return r.fulfill({json:{...readiness,canEnable:true,...(r.request().method()==='PUT'?{state:'enabled'}:{})}});
 });
 await page.route('**/api/sessions/reauthenticate',r=>r.fulfill({json:{reauthenticatedUntil:'2099-01-01T00:00:00Z'}}));
 await page.goto('/__rollout');await page.evaluate(()=>{
  const state=window as unknown as {rolloutEvents:number;rolloutJsonFinished:boolean};state.rolloutEvents=0;state.rolloutJsonFinished=false;
  window.addEventListener('open-triage.production-workflow-changed',()=>{state.rolloutEvents++;});
  const fetch=window.fetch.bind(window);window.fetch=async(...args)=>{
    const response=await fetch(...args);
    if(String(args[0]).includes('/authentication/workflow')&&args[1]?.method==='PUT'){
      const json=response.json.bind(response);response.json=async()=>{const value=await json();state.rolloutJsonFinished=true;return value;};
    }
    return response;
  };
 });
 await page.getByLabel('Your current password is required to save').fill('Personal password 42!');
 const pending=page.waitForRequest(r=>r.url().includes('/authentication/workflow')&&r.method()==='PUT');
 await page.getByRole('button',{name:'Enable production requirements'}).click();await pending;
 await page.getByRole('button',{name:'Switch fixture user'}).click();
 const response=page.waitForResponse(r=>r.url().includes('/authentication/workflow')&&r.request().method()==='PUT');release();await(await response).finished();
 await page.waitForFunction(()=>(window as unknown as {rolloutJsonFinished:boolean}).rolloutJsonFinished);
 // Next browser task runs after the application's awaited JSON continuation.
 await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
 await expect(page.getByText('Incoming fixture workspace')).toBeVisible();
 expect(await page.evaluate(()=>(window as unknown as {rolloutEvents:number}).rolloutEvents)).toBe(0);
});
