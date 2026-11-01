import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import path from 'node:path';

test('confirmed EPS imports authenticate both commands and immediately reconcile the PCR',async({page})=>{
 const script=(await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':'{}'},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`
 import React,{useReducer}from'react';import{createRoot}from'react-dom/client';
 import{EpsImports}from'./components/eps-imports';import{useReportWorkspace}from'./app/report-workspace';
 import{INITIAL_SHELL_STATE,transitionShell}from'./app/standard-encounter';
 import{populateStationaryDemoData}from'./app/stationary-demo-data';import{cacheOpenedReport}from'./app/offline-reports';
 const document=populateStationaryDemoData(INITIAL_SHELL_STATE.encounter.document);
 const report={id:'42000000-0000-4000-8000-000000000013',revision:2,formVersionId:'form',catalogReleaseId:'catalog',documentingUserId:'32000000-0000-4000-8000-000000000002',status:'draft',document,demoMutable:true};
 const session={user:{id:report.documentingUserId},csrfToken:'fixture-csrf',capabilities:['clinical:demo']};
 window.fixture=document;cacheOpenedReport(localStorage,session,{assignmentId:'fixture',report,replacementAssignment:null},'PCR-FIXTURE');const noop=()=>{};
 function App(){const[shell,dispatch]=useReducer(transitionShell,INITIAL_SHELL_STATE);const workspace=useReportWorkspace({session,report,shell,dispatch,validationErrorCount:0,presentationMode:'stationary',online:true,onSessionEnded:noop,onReportCompleted:noop,onNotesChange:noop});
 return <><output aria-label="Current medications">{JSON.stringify(shell.encounter.document.groups.filter(g=>g.id==='eHistory.CurrentMedsGroup'))}</output><EpsImports reportId={report.id} binding="binding" csrfToken={session.csrfToken} language="en" ready={workspace.restored&&workspace.syncStatus==='Saved'} onImported={workspace.refreshReport}/></>;}
 createRoot(window.document.getElementById('root')).render(<App/>);`}})).outputFiles[0]!.text;
 let applied=false,afterReads=0,saves=0;
 await page.route('**/api/reports/*/active',async route=>{
  const document=await page.evaluate(()=>(window as unknown as {fixture:{groups:Array<{id:string;instances:Array<Record<string,unknown>>}>}}).fixture);
  if(applied){afterReads++;const group=document.groups.find(g=>g.id==='eHistory.CurrentMedsGroup')!;group.instances.push({instanceId:'imported-group',parentInstanceId:group.instances[0]!.parentInstanceId,elements:[{id:'eHistory.12',values:[{kind:'coded',occurrenceId:'imported-value',code:'4511',display:'Imported folic acid',system:'RxNorm'}]}]});}
  await route.fulfill({json:{reportId:'42000000-0000-4000-8000-000000000013',reportRevision:applied?3:2,dispatchRevision:0,document,dispatchConflicts:[],dispatchCancellation:null},headers:{etag:applied?'"3"':'"2"'}});
 });
 await page.route('**/api/reports/*/draft-changes',route=>{saves++;return route.fulfill({status:500});});
 await page.route('**/api/reports/*/eps/imports**',route=>{
  const url=route.request().url();
  if(route.request().method()==='POST')expect(route.request().headers()['x-csrf-token']).toBe('fixture-csrf');
  if(url.endsWith('/plan'))return route.fulfill({json:{id:'plan',destination:'Current Medications',incoming:'Folic acid',existing:[],conflict:false,alreadyImported:false,projection:'medication-identity'}});
  if(url.endsWith('/apply')){applied=true;return route.fulfill({json:{id:'saved',duplicate:false}});}
  return route.fulfill({json:{rows:[{entryId:'medication',label:'Folic acid',destination:'Current Medications',mappingId:'map',finding:null}],inconsistent:false}});
 });
 await page.route('**/__eps-import-refresh',route=>route.fulfill({contentType:'text/html',body:`<html><body><div id="root"></div><script>${script}</script></body></html>`}));
 await page.clock.install();await page.goto('/__eps-import-refresh');await page.clock.runFor(500);
 await page.getByRole('button',{name:'Preview import — Current Medications',exact:true}).click();
 await expect(page.locator('fieldset')).toContainText('History → Current Medications');
 await expect(page.getByLabel('Current medications')).not.toContainText('Imported folic acid');
 await page.getByRole('button',{name:'Import',exact:true}).click();
 // No 10-second polling tick: confirmation itself must trigger reconciliation.
 await expect(page.getByLabel('Current medications')).toContainText('Imported folic acid');
 expect(afterReads).toBeGreaterThan(0);expect(saves).toBe(0);
});

test('opening a revision-zero report preserves unchanged dispatch provenance',async({page})=>{
 const script=(await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':'{}'},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`
 import React,{useReducer}from'react';import{createRoot}from'react-dom/client';
 import{useReportWorkspace}from'./app/report-workspace';import{INITIAL_SHELL_STATE,transitionShell}from'./app/standard-encounter';import{cacheOpenedReport}from'./app/offline-reports';import opened from'./public/demo-open-assignment.json';
 const report={...opened.report,revision:0,demoMutable:true};const session={user:{id:report.documentingUserId},csrfToken:'fixture-csrf',capabilities:['clinical:document']};
 cacheOpenedReport(localStorage,session,{...opened,report},'PCR-REVISION-ZERO');const noop=()=>{};
 function App(){const[shell,dispatch]=useReducer(transitionShell,INITIAL_SHELL_STATE);const workspace=useReportWorkspace({session,report,shell,dispatch,validationErrorCount:0,presentationMode:'stationary',online:true,onSessionEnded:noop,onReportCompleted:noop,onNotesChange:noop});
 const elements=shell.encounter.document.groups.flatMap(g=>g.instances.flatMap(i=>i.elements));
 return <><output aria-label="Restored">{String(workspace.restored)}</output><output aria-label="Dispatch county">{JSON.stringify(elements.find(e=>e.id==='eScene.21'))}</output><button onClick={()=>{const document=structuredClone(shell.encounter.document);const address=document.groups.flatMap(g=>g.instances.flatMap(i=>i.elements)).find(e=>e.id==='eScene.15');address.values[0].value='Clinician corrected street';dispatch({type:'document-opened',document});}}>Correct street</button></>;}
 createRoot(window.document.getElementById('root')).render(<App/>);`}})).outputFiles[0]!.text;
 const commands:Array<{expectedRevision:number;occurrences:unknown[]}>=[];
 await page.route('**/api/reports/*/active',route=>route.fulfill({status:304}));
 await page.route('**/api/reports/*/draft-changes',route=>{const command=route.request().postDataJSON();commands.push(command);return route.fulfill({json:{id:'report',status:'draft',revision:command.expectedRevision+1}});});
 await page.route('**/__revision-zero',route=>route.fulfill({contentType:'text/html',body:`<html><body><div id="root"></div><script>${script}</script></body></html>`}));
 await page.clock.install();await page.goto('/__revision-zero');
 await expect(page.getByLabel('Restored',{exact:true})).toHaveText('true');await expect(page.getByLabel('Dispatch county')).toContainText('36061');
 await page.clock.runFor(15000);expect(commands).toEqual([]);
 await page.getByRole('button',{name:'Correct street'}).click();await page.clock.runFor(2000);
 await expect.poll(()=>commands.length).toBe(1);expect(commands[0]!.expectedRevision).toBe(0);expect(commands[0]!.occurrences).toHaveLength(1);
 expect(JSON.stringify(commands[0])).toContain('Clinician corrected street');expect(JSON.stringify(commands[0])).not.toContain('36061');expect(JSON.stringify(commands[0])).not.toContain('eScene.21');
});
