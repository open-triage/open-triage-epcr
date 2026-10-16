import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import demoOpened from '../public/demo-open-assignment.json';
import demoAssigned from '../public/demo-assigned-calls.json';
let script:string,css:string;
test.beforeAll(async()=>{
 css=await readFile(path.resolve(__dirname,'../app/styles.css'),'utf8');
 script=(await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`
 import React,{useState}from 'react';import{createRoot}from 'react-dom/client';
 import{AssignedCalls}from './components/assigned-calls';import{reopenOpenCall,fetchAssignedCalls,openAssignedCall}from './app/assigned-calls';
 import{transitionInstallation}from './app/installation-transition';
 const session={csrfToken:'csrf',user:{id:'production-user',displayName:'Production clinician'},organization:{id:'own-agency',name:'Own agency'},startedAt:new Date().toISOString(),expiresAt:'2099-01-01T00:00:00Z',capabilities:['clinical:document']};
 Object.assign(window,{move:()=>transitionInstallation(async()=>{}),list:()=>fetchAssignedCalls(),open:()=>openAssignedCall('csrf','production-assignment')});
 function App(){const[result,setResult]=useState('');return <main><AssignedCalls session={session} language={document.documentElement.lang==='sv'?'sv':'en'} onOpened={opened=>setResult(JSON.stringify({id:opened.report.id,documentingUserId:opened.report.documentingUserId,formVersionId:opened.report.formVersionId}))}/><button onClick={async()=>setResult(JSON.stringify((await reopenOpenCall('csrf','existing-report')).report))}>Continue existing report</button><output>{result}</output></main>}
 createRoot(document.getElementById('root')).render(<App/>);`}})).outputFiles[0]!.text;
});
const call={...demoAssigned.assignedCalls[0],id:'production-assignment',callNumber:'REAL-019',unit:{id:'enrolled-unit',callSign:'Enrolled 19'}};
const response={...demoOpened,assignmentId:call.id,report:{...demoOpened.report,id:'production-report',documentingUserId:'production-user',formVersionId:'agency-pinned-form'},replacementAssignment:null};

for(const language of ['en','sv'] as const)for(const width of [390,1440])test(`production readiness and preserved report continuation in ${language} at ${width}px`,async({context,page})=>{
 await page.setViewportSize({width,height:900});
 let state='enrollment-required',available=false,openAttempts=0;
 await context.route('**/__production-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
 await context.route('**/__production-jobs',route=>route.fulfill({contentType:'text/html',body:`<html lang="${language}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}output{display:block;overflow-wrap:anywhere}:root{--green:#663399;--green-dark:#442266}</style></head><body><div id="root"></div><script src="/__production-script"></script></body></html>`}));
 await context.route('**/api/calls/assigned',route=>route.fulfill({json:{assignedCalls:available?[call]:[],canceledAssignmentIds:[],refreshedAt:new Date().toISOString(),productionAccess:{state,...(state==='enrollment-required'?{}:{unit:{id:'enrolled-unit',callSign:'Enrolled 19',name:'Enrolled unit',organizationId:'own-agency'}})}}}));
 await context.route('**/api/calls/production-assignment/open',route=>{openAttempts++;return route.fulfill({json:response});});
 await context.route('**/api/reports/existing-report/reopen',route=>route.fulfill({json:{report:{id:'existing-report',documentingUserId:'original-author',organizationId:'original-agency',unitId:'original-unit',formVersionId:'original-pinned-form'}}}));
 await page.goto('/__production-jobs');
 await expect(page.locator('.assigned-calls [role="status"]')).toContainText(language==='en'?'Enroll this browser':'Registrera den här');
 await page.getByRole('button',{name:'Continue existing report'}).click();
 await expect(page.locator('output')).toContainText('original-pinned-form');await expect(page.locator('output')).toContainText('original-author');
 expect(openAttempts).toBe(0);
 for(const [next,en,sv] of [['schedule-required','no selected schedule','inget valt schema'],['handover-required','scheduled handovers','schemalagda skiftbyten'],['agency-mismatch','another agency','annan organisation']] as const){
  state=next;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.locator('.assigned-calls [role="status"]')).toContainText(language==='en'?en:sv);
  await expect(page.getByRole('button',{name:language==='en'?'Open call':'Öppna uppdrag',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(next==='schedule-required')await page.screenshot({path:`/tmp/auth-016-production-setup-${language}-${width}.png`,fullPage:true});
 }
 state='ready';available=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByText('REAL-019',{exact:true})).toBeVisible();await expect(page.locator('.assigned-calls [role="status"]')).toHaveCount(0);
 const button=page.getByRole('button',{name:language==='en'?'Open call':'Öppna uppdrag',exact:true});await button.focus();await page.keyboard.press('Enter');
 await expect(page.locator('output')).toContainText('agency-pinned-form');expect(openAttempts).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`/tmp/auth-016-production-${language}-${width}.png`,fullPage:true});
});

for(const operation of ['list','open'] as const)test(`a delayed ${operation} response cannot restore a job after another tab reassigns the installation`,async({context,page})=>{
 await context.route('**/__production-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
 await context.route('**/__production-jobs',route=>route.fulfill({contentType:'text/html',body:'<html lang="en"><body><div id="root"></div><script src="/__production-script"></script></body></html>'}));
 await context.route('**/api/calls/assigned',route=>route.fulfill({json:{assignedCalls:[],canceledAssignmentIds:[],refreshedAt:new Date().toISOString(),productionAccess:{state:'enrollment-required'}}}));
 await page.goto('/__production-jobs');await expect(page.locator('.assigned-calls [role="status"]')).toContainText('Enroll this browser');
 let started=false,release=()=>{};
 const url=operation==='list'?'**/api/calls/assigned':'**/api/calls/production-assignment/open';
 await page.route(url,async route=>{started=true;await new Promise<void>(resolve=>{release=resolve;});await route.fulfill({json:operation==='list'?{assignedCalls:[call],canceledAssignmentIds:[],refreshedAt:new Date().toISOString(),productionAccess:{state:'ready'}}:response});});
 type Harness={list:()=>Promise<unknown>;open:()=>Promise<unknown>;move:()=>Promise<void>};
 const delayed=page.evaluate(operation=>(window as unknown as Harness)[operation]().then(result=>({result}),error=>({error:String(error)})),operation);
 await expect.poll(()=>started).toBe(true);
 const other=await context.newPage();await other.goto('/__production-jobs');await other.evaluate(()=>(window as unknown as Harness).move());
 release();await expect(delayed).resolves.toHaveProperty('error',expect.stringContaining('Installation changed'));
 await expect(page.getByText('REAL-019',{exact:true})).toHaveCount(0);await expect(page.locator('output')).toBeEmpty();
});
