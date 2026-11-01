import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {clinicalFormConfiguration} from '../../dist/forms/clinical-form-configuration.js';

/** Real workspace polling consumes authoritative imports and drives the real
 * EPS availability/cache gate and source-lineage warning. No synthetic refresh. */
export async function epsHistoryBrowser({database,query,sessions,configuration,adminToken,token,actor,report,service,drafts,imports,binding,historyFieldId,entryIds}) {
 const {build}=await import('esbuild'),{chromium}=await import('@playwright/test');
 const web=path.resolve(new URL('../../../web/',import.meta.url).pathname);
 const opened={...report,...await drafts.get(token,report.id),document:(await drafts.active(token,report.id)).resource.document,clinicalForm:await clinicalFormConfiguration({query},report.formVersionId,report.catalogReleaseId)};
 const bundle=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:web,loader:'tsx',contents:`
 import React,{useReducer} from 'react';import {createRoot} from 'react-dom/client';
 import {useReportWorkspace} from './app/report-workspace';import {INITIAL_SHELL_STATE,transitionShell} from './app/standard-encounter';import {cacheOpenedReport} from './app/offline-reports';
 import {PatientSummaryButton} from './components/patient-summary';import {HospitalIntegrationsPanel} from './components/hospital-integrations';
 const report=${JSON.stringify(opened)},session=${JSON.stringify(actor)},noop=()=>{};
 cacheOpenedReport(localStorage,session,{assignmentId:'fixture',report,replacementAssignment:null},'EPS-HISTORY-WORKSPACE');
 function App(){const [shell,dispatch]=useReducer(transitionShell,INITIAL_SHELL_STATE);const workspace=useReportWorkspace({session,report,shell,dispatch,validationErrorCount:0,presentationMode:'mobile',online:true,onSessionEnded:noop,onReportCompleted:noop,onNotesChange:noop});
 const document=shell.encounter.document,values=document.groups.flatMap(g=>g.instances.flatMap(i=>i.elements));
 function change(value){const next=structuredClone(document);next.groups.flatMap(g=>g.instances.flatMap(i=>i.elements)).find(e=>e.id==='ePatient.01').values[0].value=value;dispatch({type:'document-opened',document:next});}
 return <><output aria-label="Identity">{values.find(e=>e.id==='ePatient.01')?.values[0]?.value}</output><output style={{display:"block",overflowWrap:"anywhere",maxHeight:100,overflow:"auto"}} aria-label="History">{JSON.stringify(values.filter(e=>e.id.startsWith('org.opentriage.epsfixture')))}</output><button onClick={()=>change('no-summary-id')}>Use unknown identity</button><button onClick={()=>change('')}>Clear identity</button><PatientSummaryButton csrfToken="fixture-csrf" onImported={workspace.refreshReport} reportId={report.id} organizationId={session.organization.id} userId={session.user.id} documentKey={JSON.stringify(document)} form={report.clinicalForm} ready={workspace.syncStatus==='Saved'} language={location.search.includes('sv')?'sv':'en'}/></>;
 }createRoot(document.getElementById('root')).render(location.search.includes('admin')?<HospitalIntegrationsPanel language="en" csrfToken="fixture" canWrite/>:<App/>);`}});
 const css=await readFile(path.join(web,'app/styles.css'),'utf8');let server,browser,page;const failures=[];
 try {
 server=createServer(async(req,res)=>{try {
  if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
  if(!req.url.startsWith('/api/')){res.setHeader('Content-Type','text/html');res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="--green:#315ba8;--green-dark:#17366d"><main class="app-shell" id="root"></main><script src="/bundle.js"></script></body></html>`);return;}
  let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):undefined,url=new URL(req.url,'http://fixture'),route=url.pathname;let result;
  if(route.endsWith('/active')){const active=await drafts.active(token,report.id,req.headers['if-none-match']);res.setHeader('ETag',active.etag);if(!active.resource){res.writeHead(304);res.end();return;}result=active.resource;}
  else if(route.endsWith('/draft-changes'))result=await drafts.save(token,report.id,body,actor.csrfToken);
  else if(route.endsWith('/imports/plan'))result=await imports.plan(token,report.id,body);
  else if(route.endsWith('/imports/apply'))result=await imports.apply(token,report.id,body);
  else if(route.endsWith('/imports/history'))result=await imports.history(token,report.id);
  else if(route.endsWith('/imports'))result=await imports.rows(token,report.id,url.searchParams.get('binding'));
  else if(route.endsWith('/context'))result=await service.context(token,report.id);
  else if(route.includes('/reports/')&&route.endsWith('/eps'))result=await service.lookup(token,report.id,url.searchParams.get('binding'));
  else if(route.endsWith('/inspect-mappings'))result=await configuration.inspectClinical(adminToken,body);
  else if(req.method==='PUT')result=await configuration.save(adminToken,body);
  else result=await configuration.get(adminToken);
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
 }catch(error){failures.push({route:req.url,error:error.message,response:error.getResponse?.()});res.writeHead(error.getStatus?.()??500,{'Content-Type':'application/json'});res.end(JSON.stringify(error.getResponse?.()??{}));}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch({headless:true});
 for(const [language,width,height] of [['en',1440,900],['sv',390,844]]) {
  await query('savepoint eps_history_browser');const context=await browser.newContext({viewport:{width,height}});page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const sv=language==='sv',button=page.getByRole('button',{name:sv?'Patientöversikt (EPS)':'Patient summary (EPS)',exact:true});
  try {
   await page.goto(`${origin}/?${language}`);await page.waitForFunction(()=>document.querySelector('.eps-control > button')?.disabled===false);
   await button.focus();await page.keyboard.press('Enter');await page.getByRole('dialog').waitFor();
   await page.getByText(sv?'Endast visning: källans enhet matchar inte exakt det konfigurerade systemet och koden.':'View only: the source unit does not exactly match the configured system and code.',{exact:true}).waitFor();
   const row=page.getByRole('row').filter({hasText:'Historical body weight'}).first();await row.getByRole('button').click();
   await page.getByRole('textbox',{name:sv?/^Källinformation/:/^Source information/}).waitFor();assert.match(await page.getByRole('dialog').locator('textarea').first().inputValue(),/2020-05-12/);
   await page.getByRole('button',{name:sv?'Importera':'Import',exact:true}).click();
   await page.getByLabel('History',{exact:true}).filter({hasText:'2020-05-12'}).waitFor({timeout:15000});
   // Reopen if a normal workspace poll remounted the dialog contents.
   if(!await page.getByRole('dialog').isVisible()){await page.waitForFunction(()=>document.querySelector('.eps-control > button')?.disabled===false);await button.click();}
   const rows=page.getByRole('row').filter({hasText:'Historical body weight'});await rows.nth(1).getByRole('button').click();
   await page.getByRole('button',{name:sv?'Lägg till bredvid befintlig anamnes':'Add alongside existing history',exact:true}).click();
   await page.getByLabel('History',{exact:true}).filter({hasText:'2021-08-15'}).waitFor({timeout:15000});
   if(!await page.getByRole('dialog').isVisible()){await page.waitForFunction(()=>document.querySelector('.eps-control > button')?.disabled===false);await button.click();}
   const patientRow=page.getByRole('row').filter({hasText:'different-current-identity'}).first();await patientRow.getByRole('button').click();
   const proposed=page.getByLabel(sv?'Exakt värde att spara':'Exact value to save',{exact:true});assert.equal(await proposed.inputValue(),'different-current-identity');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`/tmp/eps007-preview-${language}.png`});
   await page.getByRole('button',{name:sv?'Ersätt med vald källa':'Replace with selected source',exact:true}).click();
   await page.getByLabel('Identity',{exact:true}).filter({hasText:'different-current-identity'}).waitFor({timeout:15000});
   const warning=page.getByRole('alert').filter({hasText:sv?'Patientidentifieraren skiljer sig':'The patient identifier differs'});await warning.first().waitFor({timeout:15000});
   if(await page.getByRole('dialog').isVisible())await page.getByRole('button',{name:sv?'Stäng':'Close',exact:true}).click();
   const noMatch=page.waitForResponse(async response=>new URL(response.url()).pathname.endsWith('/eps')&&response.ok()&&(await response.json()).status==='no-match');
   await page.getByRole('button',{name:'Use unknown identity',exact:true}).click();await noMatch;assert.equal(await button.isDisabled(),true);await warning.first().waitFor();
   const missing=page.waitForResponse(async response=>new URL(response.url()).pathname.endsWith('/eps')&&response.ok()&&(await response.json()).status==='missing');
   await page.getByRole('button',{name:'Clear identity',exact:true}).click();await missing;assert.equal(await button.isDisabled(),true);await warning.first().waitFor();
   const lineage=await imports.history(token,report.id);assert.equal(lineage.inconsistent,true);assert.ok(lineage.items.some(item=>item.source.includes('2020-05-12')));assert.deepEqual(errors,[]);
   await page.screenshot({path:`/tmp/eps007-identity-${language}.png`});
  }catch(error){await page.screenshot({path:'/tmp/eps007-failure.png'});await writeFile('/tmp/eps007-failure.html',await page.content());throw error;}finally{await context.close();await query('rollback to savepoint eps_history_browser');await query('release savepoint eps_history_browser');}
 }
 // Exercise exact units and semantic destination through the actual admin panel.
 await query('savepoint eps_history_admin');const context=await browser.newContext({viewport:{width:1440,height:900}});page=await context.newPage();
 try {
  await page.goto(`${origin}/?admin`);await page.locator('.hospital-mapping-summary').filter({hasText:'29463-7'}).getByRole('button',{name:'Edit',exact:true}).click();await page.locator('.hospital-mapping-editor:visible').getByLabel('Unit code',{exact:true}).first().waitFor();assert.equal(await page.locator('.hospital-mapping-editor:visible').getByLabel('Unit code',{exact:true}).first().inputValue(),'kg');
  await page.getByRole('combobox',{name:/^Destination field/}).first().selectOption('eNarrative.01');await page.getByRole('button',{name:'Save EPS draft',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'A clinical mapping is incompatible with the pinned form.'}).waitFor();
  assert.equal((await configuration.get(adminToken)).draft.revision,2,'an incompatible draft is not persisted');
  await page.getByRole('combobox',{name:/^Destination field/}).first().selectOption(historyFieldId);
  await page.locator('.hospital-mapping-editor:visible').getByLabel('Unit code',{exact:true}).first().fill('g');
  await page.getByRole('button',{name:'Save EPS draft',exact:true}).click();await page.getByRole('status').filter({hasText:'3 compatible · 0 need attention'}).waitFor();
  await page.locator('.hospital-integration-status').getByText('Draft revision: 3',{exact:true}).waitFor();const exported=await configuration.export(adminToken,'3');assert.equal(exported.definition.clinicalMappings[0].expectedUnit.code,'g');assert.equal(exported.definition.clinicalMappings[1].semanticRole,'historical-procedure');await page.screenshot({path:'/tmp/eps007-admin.png'});
 }catch(error){await page.screenshot({path:'/tmp/eps007-failure.png'});await writeFile('/tmp/eps007-failure.html',await page.content());throw error;}finally{await context.close();await query('rollback to savepoint eps_history_admin');await query('release savepoint eps_history_admin');}
 }catch(error){if(page&&!page.isClosed()){await page.screenshot({path:'/tmp/eps007-failure.png'});await writeFile('/tmp/eps007-failure.html',await page.content());}await writeFile('/tmp/eps007-failures.json',JSON.stringify(failures,null,2));throw error;}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));}
}
