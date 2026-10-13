import {expect,test} from '@playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import demoAssigned from '../public/demo-assigned-calls.json';
import demoOpened from '../public/demo-open-assignment.json';
let script:string,css:string;
test.beforeAll(async()=>{
 css=await readFile(path.resolve(__dirname,'../app/styles.css'),'utf8');
 script=(await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`import React,{useState}from 'react';import{createRoot}from'react-dom/client';import{AssignedCalls}from'./components/assigned-calls';import{reopenOpenCall}from'./app/assigned-calls';import{PersonalAuthenticationContext}from'./components/personal-authentication';
 const source=document.body.dataset.source;const session={authenticationSource:source,csrfToken:'csrf',user:{id:document.body.dataset.user||'shift-user',displayName:'Clinician'},organization:{id:'agency',name:'Agency'},startedAt:'2026-10-13T06:44:00Z',expiresAt:'2099-01-01T00:00:00Z',capabilities:['clinical:document']};
 function App(){const[result,setResult]=useState('');return <PersonalAuthenticationContext.Provider value={source}><main><AssignedCalls session={session} language={document.documentElement.lang==='sv'?'sv':'en'} onOpened={r=>setResult(r.report.id)}/><button onClick={async()=>setResult((await reopenOpenCall('csrf','existing-report')).report.id)}>Continue existing report</button><output>{result}</output></main></PersonalAuthenticationContext.Provider>};createRoot(document.getElementById('root')).render(<App/>);`}})).outputFiles[0]!.text;
});
const call={...demoAssigned.assignedCalls[0],id:'shift-assignment',callNumber:'SHIFT-017'};
const response={...demoOpened,assignmentId:call.id,report:{...demoOpened.report,id:'shift-report',documentingUserId:'shift-user'},replacementAssignment:null};
for(const source of ['local','oidc'] as const)for(const language of ['en','sv'] as const)test(`${source} shift authentication, outage, redirect resume and checkpoint reassessment in ${language}`,async({context,page,baseURL})=>{
 let state='reauthentication-required',opened=0,outage=true,crossing=true,confirmed=0;
 await page.setViewportSize({width:390,height:844});
 await context.route('**/__shift-script',r=>r.fulfill({contentType:'text/javascript',body:script}));
 await context.route(/\/__shift(?:\?.*)?$/,r=>r.fulfill({contentType:'text/html',body:`<html lang="${language}"><head><style>${css}</style></head><body data-source="${source}"><div id="root"></div><script src="/__shift-script"></script></body></html>`}));
 await context.route('**/api/calls/assigned',r=>r.fulfill({json:{assignedCalls:state==='ready'?[call]:[],canceledAssignmentIds:[],refreshedAt:new Date().toISOString(),productionAccess:{state,unit:{id:'unit',callSign:'Shift unit',name:'Unit',organizationId:'agency'}}}}));
 await context.route('**/api/calls/shift-assignment/open',r=>{opened++;if(crossing)return r.fulfill({status:403,json:{code:'calls.shiftReauthenticationRequired'}});return r.fulfill({json:response});});
 await context.route('**/api/sessions/reauthenticate',r=>{
  expect(r.request().postDataJSON().forcePersonalAuthentication).toBe(true);
  confirmed++;if(outage)return r.fulfill({status:503,json:{code:'login.personalProofRequired'}});
  if(source==='local'){state='ready';return r.fulfill({json:{reauthenticatedUntil:'2099-01-01T00:00:00Z'}});}
  return r.fulfill({json:{authorizationUrl:'https://shift-idp.fixture.test/authorize'}});
 });
 await context.route('https://shift-idp.fixture.test/authorize',r=>r.fulfill({contentType:'text/html',body:`<a href="${baseURL}/__shift?authentication=completed">Complete personal authentication</a>`}));
 await context.route('**/api/reports/existing-report/reopen',r=>r.fulfill({json:{report:{id:'existing-report',documentingUserId:'shift-user',organizationId:'agency'}}}));
 await page.goto('/__shift');
 const authenticate=()=>page.getByRole('button',{name:language==='en'?'Authenticate for this shift':'Autentisera för det här skiftet',exact:true});
 if(source==='local')await page.getByLabel(language==='en'?'Current password':'Nuvarande lösenord').fill('Personal password 42!');
 else await expect(page.locator('input[type=password]')).toHaveCount(0);
 await authenticate().click();await expect(page.getByRole('alert')).toBeVisible();expect(opened).toBe(0);
 await page.getByRole('button',{name:'Continue existing report'}).click();await expect(page.locator('output')).toHaveText('existing-report');
 outage=false;
 if(source==='local')await page.getByLabel(language==='en'?'Current password':'Nuvarande lösenord').fill('Personal password 42!');
 await authenticate().click();
 if(source==='oidc'){await expect(page.getByRole('link',{name:'Complete personal authentication'})).toBeVisible();state='ready';await page.getByRole('link').click();}
 await page.getByRole('button',{name:language==='en'?'Open call':'Öppna uppdrag',exact:true}).click();
 await expect(authenticate()).toBeVisible();expect(opened).toBe(1); // Checkpoint crossed after listing.
 crossing=false;
 if(source==='local')await page.getByLabel(language==='en'?'Current password':'Nuvarande lösenord').fill('Personal password 42!');
 await authenticate().click();
 if(source==='oidc'){
  await expect(page.getByRole('link',{name:'Complete personal authentication'})).toBeVisible();
  expect(await page.evaluate(()=>sessionStorage.getItem('open-triage.new-job-intent.v1'))).toBeNull(); // The provider has another origin.
  await page.getByRole('link').click();
 }
 await expect(page.locator('output')).toHaveText('shift-report');expect(opened).toBe(2);expect(confirmed).toBe(3);
 expect(await page.evaluate(()=>sessionStorage.getItem('open-triage.new-job-intent.v1'))).toBeNull();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`/tmp/auth017-shift-${source}-${language}.png`,fullPage:true});
 state='identity-confirmation-required';await page.reload();
 await expect(page.locator('.assigned-calls [role=status]')).toContainText(language==='en'?'Confirm the clinician':'Bekräfta kliniker');
 await expect(authenticate()).toHaveCount(0);await expect(page.getByText('SHIFT-017',{exact:true})).toHaveCount(0);
});

for(const invalidation of ['identity','unit','schedule','canceled','expired'] as const)test(`regional redirect intent is discarded after ${invalidation} changes`,async({context,page})=>{
 let attempts=0;
 const intent={assignmentId:call.id,userId:'shift-user',organizationId:'agency',createdAt:Date.now()-(invalidation==='expired'?600001:0)};
 await page.addInitScript(intent=>sessionStorage.setItem('open-triage.new-job-intent.v1',JSON.stringify(intent)),intent);
 await context.route('**/__shift-script',r=>r.fulfill({contentType:'text/javascript',body:script}));
 await context.route(/\/__shift(?:\?.*)?$/,r=>r.fulfill({contentType:'text/html',body:`<html lang="en"><body data-source="oidc" data-user="${invalidation==='identity'?'different-person':'shift-user'}"><div id="root"></div><script src="/__shift-script"></script></body></html>`}));
 const state=invalidation==='unit'?'enrollment-required':invalidation==='schedule'?'identity-confirmation-required':'ready';
 await context.route('**/api/calls/assigned',r=>r.fulfill({json:{assignedCalls:['identity','expired'].includes(invalidation)?[call]:[],canceledAssignmentIds:invalidation==='canceled'?[call.id]:[],refreshedAt:new Date().toISOString(),productionAccess:{state}}}));
 await context.route('**/api/calls/shift-assignment/open',r=>{attempts++;return r.fulfill({json:response});});
 await page.goto('/__shift?authentication=completed');
 await expect.poll(()=>page.evaluate(()=>sessionStorage.getItem('open-triage.new-job-intent.v1'))).toBeNull();
 expect(attempts).toBe(0);await expect(page.locator('output')).toBeEmpty();
});
