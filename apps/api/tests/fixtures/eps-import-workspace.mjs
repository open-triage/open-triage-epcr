import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import path from 'node:path';
import {clinicalFormConfiguration} from '../../dist/forms/clinical-form-configuration.js';
import {SignReportService} from '../../dist/reports/sign-report.service.js';

// The real workspace polls an import performed by the EPS service. A later
// ordinary editor save and signature must retain that server-owned occurrence.
export async function epsImportWorkspace({database,query,sessions,drafts,imports,token,actor,report,binding}) {
 const {build}=await import('esbuild'),{chromium}=await import('@playwright/test');
 await query('savepoint eps_workspace');let server,browser;
 try {
  const opened={...report,...await drafts.get(token,report.id),document:(await drafts.active(token,report.id)).resource.document,
   clinicalForm:await clinicalFormConfiguration({query},report.formVersionId,report.catalogReleaseId)};
  const bundle=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(new URL('../../../web/',import.meta.url).pathname),loader:'tsx',contents:`
   import React,{useReducer,useState} from 'react';import {createRoot} from 'react-dom/client';
   import {useReportWorkspace} from './app/report-workspace';
   import {INITIAL_SHELL_STATE,transitionShell} from './app/standard-encounter';
   import {cacheOpenedReport} from './app/offline-reports';
   import {EpsImports} from './components/eps-imports';
   const report=${JSON.stringify(opened)},session=${JSON.stringify(actor)},noop=()=>{};
   cacheOpenedReport(localStorage,session,{assignmentId:'fixture',report,replacementAssignment:null},'EPS-WORKSPACE');
   function App(){const [shell,dispatch]=useReducer(transitionShell,INITIAL_SHELL_STATE),[signed,setSigned]=useState(false);
    const workspace=useReportWorkspace({session,report,shell,dispatch,validationErrorCount:0,presentationMode:'mobile',online:true,onSessionEnded:noop,onReportCompleted:noop,onNotesChange:noop});
    const values=shell.encounter.document.groups.flatMap(g=>g.instances.flatMap(i=>i.elements));
    function edit(){const document=structuredClone(shell.encounter.document),patient=document.groups.find(g=>g.id==='ePatientSection').instances[0];patient.elements.push({id:'ePatient.05',values:[{occurrenceId:crypto.randomUUID(),kind:'scalar',value:'Workspace followup'}]});dispatch({type:'document-opened',document});}
    async function sign(){await workspace.flushSave();const result=await fetch('/api/sign',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({commandId:crypto.randomUUID(),expectedRevision:workspace.revision.current,signerId:session.user.id,attestation:{accepted:true}})});if(!result.ok)throw new Error('Signing failed');setSigned(true);}
    return <><output aria-label="Sync status">{workspace.syncStatus}</output><output aria-label="Imported narrative">{values.find(e=>e.id==='eNarrative.01')?.values.map(v=>v.value).join('')}</output>
     <button disabled={!workspace.restored} onClick={edit}>Edit patient name</button><button onClick={sign}>Sign report</button>{signed&&<p>Signed</p>}
     <EpsImports reportId={report.id} binding="${binding}" language="en" ready/></>;
   }createRoot(document.getElementById('root')).render(<App/>);`}});
  let importedRevision=null,savedCommand=null,signedSnapshotId=null,polledImport=false;
  server=createServer(async(req,res)=>{try {
   if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
   if(!req.url.startsWith('/api/')){res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script src="/bundle.js"></script>');return;}
   let raw='';for await(const part of req)raw+=part;const body=raw?JSON.parse(raw):undefined,route=new URL(req.url,'http://fixture').pathname;let result;
   if(route.endsWith('/active')){const active=await drafts.active(token,report.id,req.headers['if-none-match']);res.setHeader('ETag',active.etag);if(!active.resource){res.writeHead(304);res.end();return;}result=active.resource;if(importedRevision===result.reportRevision)polledImport=true;}
   else if(route.endsWith('/draft-changes')){savedCommand=body;result=await drafts.save(token,report.id,body,actor.csrfToken);}
   else if(route.endsWith('/imports/plan'))result=await imports.plan(token,report.id,body);
   else if(route.endsWith('/imports/apply')){result=await imports.apply(token,report.id,body);importedRevision=(await drafts.get(token,report.id)).revision;}
   else if(route.endsWith('/imports'))result=await imports.rows(token,report.id,binding);
   else if(route==='/api/sign'){result=await new SignReportService(database,sessions).sign(token,report.id,body);signedSnapshotId=result.signedSnapshotId;}
   else throw new Error(`Unexpected route ${req.url}`);
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
  }catch(error){res.writeHead(error.getStatus?.()??500,{'Content-Type':'application/json'});res.end(JSON.stringify(error.getResponse?.()??{message:error.message}));}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('button',{name:'Edit patient name'}).waitFor();
  await page.getByRole('button',{name:/^Preview import/}).first().click();await page.getByRole('button',{name:'Import selected item',exact:true}).click();
  await page.getByLabel('Imported narrative').filter({hasText:'Penicillin'}).waitFor({timeout:15000});assert.equal(polledImport,true,'workspace consumed the imported server revision');
  await Promise.all([page.waitForResponse(response=>response.url().endsWith('/draft-changes')&&response.ok()),page.getByRole('button',{name:'Edit patient name'}).click()]);
  assert.equal(savedCommand.expectedRevision,importedRevision);assert.ok(savedCommand.occurrences.some(o=>o.elementId==='ePatient.05'));assert.ok(savedCommand.occurrences.every(o=>o.elementId!=='eNarrative.01'),'unrelated edits do not rewrite imported provenance');
  await page.getByRole('button',{name:'Sign report',exact:true}).click();await page.getByText('Signed',{exact:true}).waitFor();
  const [snapshot]=await query('select integrity_manifest from clinical.signed_snapshot where id=$1',[signedSnapshotId]);assert.match(JSON.stringify(snapshot.integrity_manifest),/epsImport/);assert.match(JSON.stringify(snapshot.integrity_manifest),/Penicillin/);assert.match(JSON.stringify(snapshot.integrity_manifest),/Workspace followup/);assert.deepEqual(errors,[]);
 } finally {await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await query('rollback to savepoint eps_workspace');await query('release savepoint eps_workspace');}
}
