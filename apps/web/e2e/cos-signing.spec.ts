import productionSettings from '@open-triage/contracts/config/installation.production.json';
import {test,expect,type Page} from '@playwright/test';
import {build} from 'esbuild';
import path from 'node:path';
import assigned from '../public/demo-assigned-calls.json';
import opened from '../public/demo-open-assignment.json';
import synthetic from '../app/data/synthetic-encounter-document.json';
async function installClinicalRoutes(page:Page,report:typeof opened.report){
 const session={csrfToken:'cos-checklist-csrf',user:{id:report.documentingUserId,displayName:'COS clinician'},
  organization:{id:'32000000-0000-4000-8000-000000000001',name:'COS fixture'},startedAt:new Date().toISOString(),expiresAt:'2099-01-01T00:00:00Z',capabilities:['clinical:document'],workspaceAvailable:true};
 await page.route('**/api/**',route=>{
  const url=new URL(route.request().url()).pathname;
  if(url==='/api/installation')return route.fulfill({json:{settings:{...productionSettings,language:'en'}}});
  if(url==='/api/sessions'||url==='/api/sessions/current')return route.fulfill({json:session});
  if(url==='/api/calls/assigned')return route.fulfill({json:assigned});
  if(url==='/api/reports/open')return route.fulfill({json:{openCalls:[{reportId:report.id,callNumber:'COS fixture',lastSavedAt:new Date().toISOString(),syncStatus:'saved',validationErrorCount:0,revision:report.revision,formVersionId:report.formVersionId,catalogReleaseId:report.catalogReleaseId}],completedReportIds:[]}});
  if(url.endsWith('/protected-key-envelope'))return route.fulfill({json:{schemaVersion:1,recoveryHandle:route.request().postDataJSON().recoveryHandle,recoveryDeadline:'2099-01-01T00:00:00Z',wrappingKeyVersion:1}});
  if(url.endsWith('/protected-ciphertext-checkpoint'))return route.fulfill({json:route.request().postDataJSON()});
  if(url.endsWith('/protected-ciphertext-receipt'))return route.fulfill({json:{...route.request().postDataJSON(),schemaVersion:1,recoveryDeadline:'2099-01-01T00:00:00Z'}});
  return route.fulfill({status:404});
 });
}

for(const width of [390,1440])test(`COS signing preserves unsigned status without delivery details or skipping at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});
 const script=(await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':'{}'},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`
 import React,{useState}from'react';import{createRoot}from'react-dom/client';import{CosSigningStatus}from'./components/cos-signing-status';
 function App(){const[busy,setBusy]=useState(true);const[finding,setFinding]=useState(null);const[result,setResult]=useState('');
 return <><button onClick={()=>{setBusy(false);setFinding('reconciliationUnresolved');}}>Complete check</button><button onClick={()=>setFinding('clinicalProjectionIncomplete')}>Coverage warning</button>
 <CosSigningStatus language="en" status={{status:'awaiting-cos',deliveryState:busy?'pending':'uncertain',finding}} busy={busy} onAcknowledge={()=>setResult('acknowledged')}/><output>{result}</output></>;}
 createRoot(document.getElementById('root')).render(<App/>);`}})).outputFiles[0]!.text;
 await page.route('**/__cos-signing',route=>route.fulfill({contentType:'text/html',body:`<html><body><div id="root"></div><script>${script}</script></body></html>`}));
 await page.goto('/__cos-signing');
 await expect(page.getByRole('status').first()).toContainText('not signed yet');
 await expect(page.getByText('Delivery details',{exact:true})).toHaveCount(0);
 await expect(page.getByText('Skip COS and sign',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Complete check'}).click();
 await expect(page.getByRole('status').first()).toContainText('remains unsigned');
 await expect(page.getByRole('alert')).toContainText('could not be verified');
 await expect(page.locator('details')).toHaveCount(0);
 await expect(page.getByRole('textbox')).toHaveCount(0);
 await page.getByRole('button',{name:'Coverage warning'}).click();
 await expect(page.getByRole('button',{name:'Send anyway',exact:true})).toBeDisabled();
 await page.getByRole('checkbox',{name:'I acknowledge this warning and want to send anyway.'}).check();
 await page.getByRole('button',{name:'Send anyway',exact:true}).click();
 await expect(page.locator('output')).toHaveText('acknowledged');
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('patient conflict offers one inline copy action and routes other corrections',async({page})=>{
 const script=(await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':'{}'},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`
 import React,{useState}from'react';import{createRoot}from'react-dom/client';import{CosSigningStatus}from'./components/cos-signing-status';
 const comparison={reportId:'report',revision:3,deliveryId:'delivery',identifier:'test identity',displayName:'COS Patient',canApply:true,changes:[],local:{firstName:'Local',lastName:'Name'},cos:{firstName:'COS',lastName:'Patient'}};
 function App(){const[result,setResult]=useState('');const[key,setKey]=useState(0);const[allowed,setAllowed]=useState(true);
 return <><button onClick={()=>setKey(key+1)}>Edit draft</button><button onClick={()=>setAllowed(false)}>Remove permission</button>
 <CosSigningStatus language="en" status={{status:'awaiting-cos',revision:3,deliveryId:'delivery',deliveryState:'waiting',finding:'patientIdentityConflict',issues:[{code:'rakel'},{code:'clinicalValue',elementId:'eVitals.06'},{code:'outcomeUnknown'}]}}
 busy={false} canCompare={key===0} documentKey={String(key)} canConfigure={allowed?['units']:[]} onConfigure={setResult}
 onEdit={issue=>setResult(issue.elementId??issue.code)} onRetry={()=>setResult('retry')}
 onCompare={async()=>{await new Promise(resolve=>setTimeout(resolve,150));return comparison;}} onApply={value=>setResult('applied:'+value.displayName)}
 onAcknowledge={()=>{}}/><output>{result}</output></>;}
 createRoot(document.getElementById('root')).render(<App/>);`}})).outputFiles[0]!.text;
 await page.route('**/__cos-actions',route=>route.fulfill({contentType:'text/html',body:`<html><body><div id="root"></div><script>${script}</script></body></html>`}));
 await page.goto('/__cos-actions');
 await expect(page.getByRole('button',{name:'Compare COS patient',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Edit patient details',exact:true})).toHaveCount(0);
 const apply=page.getByRole('button',{name:'Use COS data (COS Patient)',exact:true});
 await expect(apply).toBeVisible();
 const conflict=page.getByRole('listitem').filter({hasText:'COS patient demographics conflict'});
 await expect(conflict.getByRole('button')).toHaveCount(1);
 await expect(conflict.getByRole('button',{name:'Use COS data (COS Patient)',exact:true})).toBeVisible();
 await expect(page.getByRole('table')).toHaveCount(0);
 await apply.click();await expect(page.locator('output')).toHaveText('applied:COS Patient');
 await page.getByRole('button',{name:'Edit draft',exact:true}).click();await expect(apply).toHaveCount(0);await expect(page.getByRole('button',{name:'Use COS data',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Configure unit Rakel identifier'}).click();await expect(page.locator('output')).toHaveText('units');
 await page.getByRole('button',{name:'Edit clinical data'}).click();await expect(page.locator('output')).toHaveText('eVitals.06');
 await page.getByRole('button',{name:'Check delivery again'}).click();await expect(page.locator('output')).toHaveText('retry');
 await page.getByRole('button',{name:'Remove permission'}).click();await expect(page.getByRole('button',{name:'Configure unit Rakel identifier'})).toHaveCount(0);
 await expect(page.getByText('An administrator must update this configuration.')).toBeVisible();
 await page.reload();
 await page.getByRole('button',{name:'Edit draft',exact:true}).click();
 await expect(page.getByRole('button',{name:'Use COS data',exact:true})).toBeDisabled();
 await page.waitForTimeout(200);
 await expect(page.getByRole('button',{name:'Use COS data (COS Patient)',exact:true})).toHaveCount(0);

});

for (const mode of ['Mobile','Stationary'] as const) test(`real ${mode} checklist exposes the COS demographic action`,async({page})=>{
 await page.setViewportSize({width:mode==='Mobile'?390:1440,height:900});
 const report=opened.report;
 await installClinicalRoutes(page,report);
 await page.route(`**/api/calls/${assigned.assignedCalls[0]!.id}/open`,route=>route.fulfill({json:opened}));
 await page.route('**/api/reports/*/active',route=>route.fulfill({json:{reportId:report.id,reportRevision:report.revision,dispatchRevision:0,document:report.document,dispatchConflicts:[],dispatchCancellation:null}}));
 await page.route('**/api/reports/*/signing-status',route=>route.fulfill({json:{status:'awaiting-cos',revision:report.revision,deliveryId:'delivery',deliveryState:'uncertain',
  finding:'reconciliationUnresolved',findings:['patientIdentityConflict'],issues:[{code:'patientIdentityConflict',artifact:'patient',mappingId:'patient'},{code:'nonNrsPain',artifact:'context',coverage:'note-pdf-only',mappingId:'painNrs'}]}}));
 let reads=0;
 await page.route('**/api/reports/*/signing-patient-comparison',route=>{reads++;return route.fulfill({json:{reportId:report.id,revision:report.revision,deliveryId:'delivery',
  identifier:'fictional',displayName:'COS Patient',canApply:true,changes:[],local:{firstName:'Local',lastName:'Name'},cos:{firstName:'COS',lastName:'Patient'}}});});
 await page.goto('/');
 await page.getByLabel('Username').fill('demo');await page.getByLabel('Password').fill('opentriagedemo');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('group',{name:'Documentation presentation'}).getByRole('button',{name:mode,exact:true}).click();
 await page.getByRole('button',{name:'Open call',exact:true}).click();
 await page.getByRole('button',{name:mode==='Mobile'?/Checklist/:/^Review & sign$/}).click();
 await expect(page.getByRole('button',{name:'Use COS data (COS Patient)',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Use COS data (COS Patient)',exact:true})).toBeEnabled();
 const integrations=page.getByRole('region',{name:'Integrations',exact:true});
 await expect(integrations.getByRole('button',{name:'Use COS data (COS Patient)',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:/Dispatch differences/})).toHaveCount(0);
 await page.getByRole('heading',{name:'Integrations',exact:true}).evaluate(heading=>heading.scrollIntoView({block:'center'}));
 await page.screenshot({path:test.info().outputPath('signing-integrations.png')});

 const action=page.getByRole('button',{name:'Use COS data (COS Patient)',exact:true});
 await action.click({trial:true});
 const issue=page.getByRole('listitem').filter({hasText:'COS patient demographics conflict'});
 const actionBox=await action.boundingBox(),issueBox=await issue.boundingBox();
 expect(actionBox!.y).toBeGreaterThanOrEqual(issueBox!.y);
 expect(actionBox!.y+actionBox!.height).toBeLessThanOrEqual(issueBox!.y+issueBox!.height);
 const warning=page.getByRole('listitem').filter({hasText:'Pain scale is not numeric rating scale'});
 await expect(warning).toHaveClass('warning');
 await expect(warning).toHaveCSS('background-color','rgb(255, 249, 223)');
 await warning.getByRole('checkbox').check();
 await expect(warning.getByRole('checkbox')).toBeChecked();
 await expect(issue.getByRole('checkbox')).toHaveCount(0);

 expect(reads).toBeGreaterThan(0);
 await expect(page.getByRole('button',{name:'Edit patient details',exact:true})).toHaveCount(0);
});

for (const mode of ['Mobile','Stationary'] as const) test(`${mode} checklist clears corrected COS demographics despite stale delivery findings`,async({page})=>{
 const fixture={...opened,report:{...opened.report,document:synthetic,clinicalForm:{
  definition:{schemaVersion:1,sections:[{key:'patient',fields:['ePatient.02','ePatient.03'].map(elementId=>({key:elementId,source:{kind:'nemsis',elementId}}))}]},
  catalogFields:{'ePatient.02':{name:'Last name',maxOccurs:1},'ePatient.03':{name:'First name',maxOccurs:1}}
 }}};

 let revision=opened.report.revision,copied=false,submission:Record<string,unknown>|undefined;
 const reportId=opened.report.id;
 await installClinicalRoutes(page,opened.report);
 await page.route('**/demo-open-assignment.json',route=>route.fulfill({json:fixture}));
 const warning={code:'clinicalValue',artifact:'context',coverage:'partial',elementId:'ePatient.03'};
 const status=()=>({status:'awaiting-cos',deliveryId:'delivery',revision,deliveryState:submission?'confirmed':'uncertain',
  finding:submission?'clinicalProjectionIncomplete':'reconciliationUnresolved',issues:submission?[warning]:[warning,{code:'patientIdentityConflict',artifact:'patient'}]});
 await page.route(`**/api/calls/${assigned.assignedCalls[0]!.id}/open`,route=>route.fulfill({json:fixture}));
 await page.route('**/api/reports/*/active',route=>route.fulfill({status:304}));
 await page.route('**/api/reports/*/signing-status',route=>route.fulfill({json:status()}));
 await page.route('**/api/reports/*/draft-changes',route=>{
  const command=route.request().postDataJSON();
  copied ||= command.occurrences.some((o:{elementId:string;value?:{value?:string}})=>o.elementId==='ePatient.03'&&o.value?.value==='COS');
  revision=command.expectedRevision+1;
  return route.fulfill({json:{id:reportId,status:'draft',revision}});
 });
 await page.route('**/api/reports/*/signing-patient-comparison',route=>route.fulfill({json:{reportId,revision,deliveryId:'delivery',identifier:'fictional',
  displayName:'COS Patient',matches:copied,canApply:!copied,changes:copied?[]:[{elementId:'ePatient.03',kind:'text',value:'COS'}],local:{firstName:'Local'},cos:{firstName:'COS',lastName:'Patient'}}}));
 await page.route('**/api/reports/*/sign',route=>{submission=route.request().postDataJSON();return route.fulfill({json:{status:'awaiting-cos',deliveryId:'delivery',revision,deliveryState:'uncertain',finding:'inFlight'}});});
 await page.goto('/');
 await page.getByLabel('Username').fill('demo');await page.getByLabel('Password').fill('opentriagedemo');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:mode,exact:true}).click();
 await page.getByRole('button',{name:'Open call',exact:true}).click();
 await expect(page.locator('.sync-status')).toHaveText('Saved');
 await page.getByRole('button',{name:mode==='Mobile'?/Checklist/:/^Review & sign$/}).click();
 if(mode==='Stationary'){
  await page.getByRole('button',{name:'Edit clinical data',exact:true}).click();
  await expect(page.locator('.cos-signing-status')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>document.activeElement?.closest('[data-element-id]')?.getAttribute('data-element-id'))).toBe('ePatient.03');
  await page.getByRole('button',{name:'Review & sign',exact:true}).click();
 }
 const checkbox=page.getByRole('checkbox',{name:'I acknowledge this warning and want to send anyway.'});
 await checkbox.check();
 await page.getByRole('button',{name:'Use COS data (COS Patient)',exact:true}).click();
 await expect.poll(()=>copied).toBe(true);
 await expect(page.locator('.sync-status')).toHaveText('Saved');
 // Editing demographics invalidates the old acknowledgement; review it for the new draft.
 await expect(page.getByRole('listitem').filter({hasText:'COS patient demographics conflict'})).toHaveCount(0);
 await expect(page.getByRole('listitem').filter({hasText:'Stored evidence could not be verified'})).toHaveCount(0);
 await expect(checkbox).not.toBeChecked();
 await checkbox.check();
 for(const acknowledgement of await page.getByLabel('I reviewed and acknowledge this warning',{exact:true}).all())await acknowledgement.check();
 await expect(checkbox).toBeChecked();
 if(mode==='Mobile')return; // Signing is available in stationary review; both checklists share correction state.
 await page.getByRole('button',{name:'Sign record',exact:true}).click();
 await expect.poll(()=>submission?.warningAcknowledgements).toMatchObject({'cos:clinicalProjectionIncomplete':true});
 expect(submission?.expectedRevision).toBe(revision);
 await expect(checkbox).toBeChecked();
});

test('resolved demographics never dismiss delivery failures and become errors again after edits',async({page})=>{
 const script=(await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':'{}'},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`
 import React,{useState}from'react';import{createRoot}from'react-dom/client';import{CosSigningStatus}from'./components/cos-signing-status';
 function App(){const[key,setKey]=useState('corrected');const[saved,setSaved]=useState(true);const[busy,setBusy]=useState(false);const[revision,setRevision]=useState(3);
 return <><button onClick={()=>{setKey('corrected-after-save');setSaved(false)}}>Autosave corrected draft</button><button onClick={()=>setSaved(!saved)}>Toggle sync</button><button onClick={()=>setRevision(revision+1)}>Poll revision</button><button onClick={()=>setBusy(!busy)}>Toggle signing</button><button onClick={()=>{setKey('changed');setSaved(false)}}>Change patient</button><button onClick={()=>setSaved(true)}>Save changes</button>
 <CosSigningStatus language="en" status={{status:'awaiting-cos',revision,deliveryId:'delivery',context:{unitName:'Demo Unit',callSign:'DEMO-1'},finding:'reconciliationUnresolved',issues:[{code:'patientIdentityConflict',artifact:'patient'},{code:'pdfNoteNotFound',artifact:'pdf'}]}}
 busy={busy} canCompare={saved} documentKey={key} onCompare={async()=>({matches:key.startsWith('corrected'),canApply:false,changes:[],displayName:'COS Patient'})} onApply={()=>{}} onAcknowledge={()=>{}}/></>;}
 createRoot(document.getElementById('root')).render(<App/>);`}})).outputFiles[0]!.text;
 await page.route('**/__cos-resolution',route=>route.fulfill({contentType:'text/html',body:`<html><body><div id="root"></div><script>${script}</script></body></html>`}));
 await page.goto('/__cos-resolution');
 const conflict=page.getByRole('listitem').filter({hasText:'COS patient demographics conflict'});
 await expect(conflict).toHaveCount(0);
 await expect(page.getByText('Exact-version journal note not found',{exact:true})).toBeVisible();
 await expect(page.getByText('Stored evidence could not be verified. Resend remains blocked.',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Toggle signing',exact:true}).click();
 await expect(conflict).toHaveCount(0);
 await expect(page.getByText('Exact-version journal note not found',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Toggle signing',exact:true}).click();
 await expect(conflict).toHaveCount(0);
 await expect(page.getByText('Unit: Demo Unit DEMO-1',{exact:true})).toHaveCount(0);
 await page.evaluate(()=>{(window as any).flashed=false;new MutationObserver(()=>{if(document.body.textContent?.includes('COS patient demographics conflict'))(window as any).flashed=true;}).observe(document.body,{childList:true,subtree:true,characterData:true});});
 await page.getByRole('button',{name:'Toggle sync',exact:true}).click();
 await expect(conflict).toHaveCount(0);
 await page.getByRole('button',{name:'Poll revision',exact:true}).click();
 await expect(conflict).toHaveCount(0);
 await page.getByRole('button',{name:'Toggle sync',exact:true}).click();
 await expect(conflict).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).flashed)).toBe(false);
 await page.getByRole('button',{name:'Autosave corrected draft',exact:true}).click();
 await expect(conflict).toHaveCount(0);
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(conflict).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).flashed)).toBe(false);
 await page.getByRole('button',{name:'Change patient',exact:true}).click();
 await expect(conflict).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).flashed)).toBe(false);
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(conflict).toHaveCount(1);
});

for(const width of [390,1440])test(`delivery verification shows specific failures and one check action at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});
 const script=(await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':'{}'},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`
 import React,{useState}from'react';import{createRoot}from'react-dom/client';import{CosSigningStatus}from'./components/cos-signing-status';
 function App(){const[specific,setSpecific]=useState(true);const[busy,setBusy]=useState(false);
 return <><button onClick={()=>setSpecific(false)}>Only warning</button>
 <CosSigningStatus language="en" status={{status:'awaiting-cos',finding:'reconciliationUnresolved',issues:[{code:'clinicalProjectionIncomplete'},...(specific?[{code:'pdfNoteNotFound'},{code:'pdfDocumentMissing'}]:[])]}}
 busy={busy} onRetry={()=>setBusy(true)} onAcknowledge={()=>{}}/></>;}
 createRoot(document.getElementById('root')).render(<App/>);`}})).outputFiles[0]!.text;
 await page.route('**/__cos-verification',route=>route.fulfill({contentType:'text/html',body:`<html><body><div id="root"></div><script>${script}</script></body></html>`}));
 await page.goto('/__cos-verification');
 const generic=page.getByText('Stored evidence could not be verified. Resend remains blocked.',{exact:true});
 const check=page.getByRole('button',{name:'Check delivery again',exact:true});
 await expect(generic).toHaveCount(0);
 await expect(page.getByText('Exact-version journal note not found',{exact:true})).toBeVisible();
 await expect(page.locator('.review-findings > li.error')).toHaveCount(2);
 await expect(check).toHaveCount(1);
 await expect(check).toBeEnabled();
 await page.getByRole('button',{name:'Only warning'}).click();
 await expect(generic).toBeVisible();
 await expect(check).toHaveCount(1);
 await check.click();
 await expect(check).toBeDisabled();
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for(const language of ['en','sv'] as const)test(`COS rejection shows receiver reason and HTTP status in ${language}`,async({page})=>{
 const script=(await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':'{}'},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import{CosSigningStatus}from'./components/cos-signing-status';
 createRoot(document.getElementById('root')).render(<CosSigningStatus language="${language}" status={{status:'awaiting-cos',deliveryState:'uncertain',finding:'reconciliationUnresolved',issues:[{code:'receiverRejected',artifact:'encounter',receiverError:{httpStatus:400,reason:'revisionId must be non-null and non-empty <img src=x onerror=alert(1)>'}}]}} busy={false} onAcknowledge={()=>{}} onRetry={()=>{}}/>);`}})).outputFiles[0]!.text;
 await page.route('**/__cos-receiver-error',route=>route.fulfill({contentType:'text/html',body:`<html><body><div id="root"></div><script>${script}</script></body></html>`}));
 await page.goto('/__cos-receiver-error');
 await expect(page.getByRole('alert')).toContainText(language==='en'?'COS rejected Contact (HTTP 400)':'COS avvisade Vårdkontakt (HTTP 400)');
 await expect(page.getByRole('alert')).toContainText('revisionId must be non-null and non-empty');
 await expect(page.locator('img')).toHaveCount(0);
 await expect(page.getByText('Stored evidence could not be verified. Resend remains blocked.',{exact:true})).toHaveCount(0);
});
