import {expect,test} from '@playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import productionSettings from '@open-triage/contracts/config/installation.production.json';
import {DEFAULT_AGENCY_APPEARANCE} from '@open-triage/contracts';
let script:string,css:string;
test.beforeAll(async()=>{
 css=await readFile(path.resolve(__dirname,'../app/styles.css'),'utf8');
 script=(await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ClinicianSessionGate} from './components/clinician-session-gate';createRoot(document.getElementById('root')).render(<ClinicianSessionGate><p>Clinical editor</p></ClinicianSessionGate>);`}})).outputFiles[0]!.text;
});
const session=(source:'local'|'oidc',incoming=false)=>({authenticationSource:source,csrfToken:incoming?'new-csrf':'old-csrf',user:{id:incoming?'new-person':'old-person',displayName:incoming?'Incoming clinician':'Outgoing clinician'},organization:{id:'agency',name:'Fictional agency'},startedAt:'2026-10-13T08:00:00Z',expiresAt:'2099-10-13T20:00:00Z',capabilities:['clinical:document'],workspaceAvailable:true});
for(const source of ['local','oidc'] as const)test(`${source} logout settles its cookie response before another personal login, including the other tab`,async({page,context,baseURL})=>{
 let current:ReturnType<typeof session>|null=session(source),started=false,release=()=>{},loginCount=0;
 await context.addInitScript(value=>localStorage.setItem('open-triage.clinician-session.v1',JSON.stringify(value)),current);
 await context.addCookies([{name:'open_triage_session',value:'outgoing-cookie',domain:new URL(baseURL!).hostname,path:'/api',httpOnly:true,sameSite:'Strict'}]);
 await context.route('**/__personal*',route=>route.fulfill({contentType:'text/html',body:`<html lang="en"><head><style>${css}</style></head><body><div id="root"></div><script src="/__fixture-script"></script></body></html>`}));
 await context.route('**/__fixture-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
 await context.route('**/api/installation',route=>route.fulfill({json:{settings:productionSettings,appearance:DEFAULT_AGENCY_APPEARANCE}}));
 await context.route('**/api/sessions/authentication-options',route=>route.fulfill({json:{regional:source==='oidc'}}));
 await context.route('**/api/calls/assigned',route=>route.fulfill({json:{assignedCalls:[],canceledAssignmentIds:[],refreshedAt:new Date().toISOString()}}));
 await context.route('**/api/reports/open',route=>route.fulfill({json:{openCalls:[],completedReportIds:[],refreshedAt:new Date().toISOString()}}));
 await context.route('**/api/sessions/current',async route=>{
  if(route.request().method()==='DELETE'){
   expect(route.request().headers()['x-csrf-token']).toBe('old-csrf');started=true;await new Promise<void>(resolve=>{release=resolve;});current=null;
   return route.fulfill({json:{ended:true},headers:{'set-cookie':'open_triage_session=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0'}});
  }
  return current?route.fulfill({json:current}):route.fulfill({status:401});
 });
 await context.route('**/api/sessions',route=>{loginCount++;current=session('local',true);return route.fulfill({json:current,headers:{'set-cookie':'open_triage_session=incoming-cookie; Path=/api; HttpOnly; SameSite=Strict'}});});
 await context.route('**/api/sessions/oidc/login',route=>{expect(route.request().postDataJSON()).toEqual({purpose:'login'});expect(route.request().headers()['x-personal-authentication']).toBe('1');loginCount++;return route.fulfill({json:{authorizationUrl:'https://idp.fixture.test/authorize'}});});
 await context.route('https://idp.fixture.test/authorize',route=>route.fulfill({contentType:'text/html',body:'<p>Personal provider authentication</p>'}));
 await page.goto('/__personal');const other=await context.newPage();await other.goto('/__personal');await expect(page.getByText('Signed in as Outgoing clinician')).toBeVisible();await expect(other.getByText('Signed in as Outgoing clinician')).toBeVisible();
 await page.getByRole('button',{name:'Log out',exact:true}).click();await expect.poll(()=>started).toBe(true);
 const login=page.getByRole('button',{name:source==='oidc'?'Sign in with regional identity':'Sign in',exact:true});await expect(login).toBeDisabled();await expect(other.getByText('Signed in as Outgoing clinician')).toHaveCount(0);
 expect(await page.evaluate(()=>localStorage.getItem('open-triage.clinician-session.v1'))).toBeNull();expect(loginCount).toBe(0);
 release();await expect(login).toBeEnabled();expect((await context.cookies()).some(cookie=>cookie.name==='open_triage_session')).toBe(false);
 if(source==='local'){await page.getByLabel('Username').fill('incoming');await page.getByLabel('Password',{exact:true}).fill('Fictional personal password 42!');await login.click();await expect(page.getByText('Signed in as Incoming clinician')).toBeVisible();expect((await context.cookies()).find(cookie=>cookie.name==='open_triage_session')?.value).toBe('incoming-cookie');}
 else{await expect(page.getByLabel('Password',{exact:true})).toHaveCount(0);await login.click();await expect(page.getByText('Personal provider authentication')).toBeVisible();}
 expect(loginCount).toBe(1);await other.close();
});

test('a failed or stalled application logout locks local state and finishes within its bounded timeout',async({page,context})=>{
 const current=session('oidc');await page.addInitScript(value=>localStorage.setItem('open-triage.clinician-session.v1',JSON.stringify(value)),current);
 await page.route('**/__personal',route=>route.fulfill({contentType:'text/html',body:`<html><body><div id="root"></div><script src="/__fixture-script"></script></body></html>`}));await page.route('**/__fixture-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
 await page.route('**/api/installation',route=>route.fulfill({json:{settings:productionSettings,appearance:DEFAULT_AGENCY_APPEARANCE}}));await page.route('**/api/sessions/authentication-options',route=>route.fulfill({json:{regional:true}}));
 await page.route('**/api/calls/assigned',route=>route.fulfill({json:{assignedCalls:[],canceledAssignmentIds:[]}}));await page.route('**/api/reports/open',route=>route.fulfill({json:{openCalls:[],completedReportIds:[]}}));
 await page.route('**/api/sessions/current',async route=>{if(route.request().method()==='DELETE')return;return route.fulfill({json:current});});
 await page.goto('/__personal');await page.getByRole('button',{name:'Log out'}).click();const login=page.getByRole('button',{name:'Sign in with regional identity'});await expect(login).toBeDisabled();await expect(login).toBeEnabled({timeout:7000});
 expect(await page.evaluate(()=>localStorage.getItem('open-triage.clinician-session.v1'))).toBeNull();expect(await page.evaluate(()=>localStorage.getItem('open-triage.installation-transition.v1'))).toBeNull();await context.unrouteAll({behavior:'ignoreErrors'});
});
