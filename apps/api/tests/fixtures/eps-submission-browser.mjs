import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
export async function epsSubmissionBrowser({service,token,reportId,snapshotId,amendmentSequence,csrfToken}){
 const web=path.resolve(new URL('../../../web/',import.meta.url).pathname),css=await readFile(path.join(web,'app/styles.css'),'utf8');
 const props={reportId,snapshotId,amendmentSequence,dataset:'synthetic',language:'en',csrfToken};
 const bundled=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:web,loader:'tsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {EpsSubmissionPanel} from './components/eps-submission';const root=createRoot(document.getElementById('root'));const original=${JSON.stringify(props)};window.setEpsScope=overrides=>root.render(<EpsSubmissionPanel {...original} {...overrides}/>);window.setEpsScope({});`}});
 let forcedStatus=0,nextHold=null;const holds=new Set();
 function hold(kind){let seen,release;const handle={kind,seen:new Promise(resolve=>{seen=resolve;}),gate:new Promise(resolve=>{release=resolve;}),markSeen:()=>seen(),release:()=>{release();holds.delete(handle);}};nextHold=handle;holds.add(handle);return handle;}
 const server=createServer(async(req,res)=>{try{
  if(req.url==='/'){res.setHeader('content-type','text/html');res.end(`<html lang="en"><style>${css}</style><body style="--green:#315ba8;--text-color:#112233"><div id="root"></div><script src="/app.js"></script></body></html>`);return;}
  if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');res.end(bundled.outputFiles[0].text);return;}
  if(forcedStatus){res.writeHead(forcedStatus,{'content-type':'application/json'});res.end(JSON.stringify({code:'fixture.denied-or-unavailable'}));return;}
  const kind=req.method==='POST'?(req.url.endsWith('/preview')?'preview':'submit'):'history';let input='';for await(const chunk of req)input+=chunk;const body=input?JSON.parse(input):{};let result;
  if(req.method==='POST'){assert.equal(req.headers['x-csrf-token'],csrfToken);result=kind==='preview'?await service.preview(token,reportId,body,req.headers['x-csrf-token']):await service.submit(token,reportId,body,req.headers['x-csrf-token']);}else result=await service.history(token,reportId,'synthetic');
  if(nextHold?.kind===kind){const delayed=nextHold;nextHold=null;delayed.markSeen();await delayed.gate;}
  res.setHeader('content-type','application/json');res.end(JSON.stringify(result));
 }catch(error){res.statusCode=error.getStatus?.()??500;res.setHeader('content-type','application/json');res.end(JSON.stringify({code:'failed'}));}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{browser=await chromium.launch({headless:true});const page=await browser.newPage();await mkdir('/tmp/hospital-009-preview',{recursive:true});
 const settle=async()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const noPrivate=async()=>{assert.equal(await page.getByText('Patient identifier in this preview:',{exact:false}).count(),0);assert.equal(await page.getByLabel('Submission history').count(),0);assert.equal(await page.locator('.eps-submission-narrative').count(),0);assert.equal(await page.getByRole('checkbox').count(),0);assert.equal(await page.getByText('Service results:',{exact:false}).count(),0);assert.equal(await page.getByRole('button',{name:'Submit to public hackathon service',exact:true}).count(),0);};
 async function selectLoaded(){await page.getByLabel('Submission history').waitFor();const choice=await page.getByLabel('Submission history').locator('option').nth(1).getAttribute('value');await page.getByLabel('Submission history').selectOption(choice);await page.getByText('Patient identifier in this preview:',{exact:false}).waitFor();}
 for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  await page.setViewportSize(viewport);await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('button',{name:'Submit EPS',exact:true}).click();await page.getByLabel('Submission history').waitFor();
  await page.getByRole('button',{name:'Build and validate preview',exact:true}).click();await page.getByRole('button',{name:'Submit to public hackathon service',exact:true}).waitFor();await page.getByText('Processing…',{exact:true}).waitFor({state:'hidden'});
  assert.equal(await page.getByRole('button',{name:'Submit to public hackathon service',exact:true}).isDisabled(),true,'explicit fictional publication confirmation is required');
  assert.equal(await page.locator('script').count(),1,'signed narrative is rendered as text');assert.equal(await page.evaluate(()=>window.epsUnsafe),undefined);
  const dialog=page.getByRole('dialog');const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=viewport.width+1);await page.screenshot({path:`/tmp/hospital-009-preview/submission-${viewport.width}.png`,fullPage:true});
  // Revalidation can deny access while another authorized preview response is still in flight.
  for(const status of [401,403,404,410]){
   const delayed=hold('preview'),response=page.waitForResponse(r=>r.url().endsWith('/preview')&&r.request().method()==='POST');await page.getByRole('button',{name:'Build and validate preview',exact:true}).click();await delayed.seen;
   forcedStatus=status;await page.getByRole('button',{name:'Refresh results',exact:true}).click();await page.getByRole('alert').filter({hasText:'Report access is no longer available'}).waitFor();await noPrivate();
   delayed.release();await(await response).finished();await settle();await noPrivate();
   forcedStatus=0;await page.getByRole('button',{name:'Refresh results',exact:true}).click();await selectLoaded();
  }
  // Every response path shares the denial boundary, including a completed publication acknowledgement.
  for(const kind of ['history','submit']){
   if(kind==='submit'){await page.getByRole('button',{name:'Build and validate preview',exact:true}).click();await page.getByText('Processing…',{exact:true}).waitFor({state:'hidden'});await page.getByRole('checkbox').check();}
   const delayed=hold(kind),response=page.waitForResponse(r=>kind==='history'?r.url().includes('/eps/submissions?'):r.url().endsWith('/submit'));
   await page.getByRole('button',{name:kind==='history'?'Refresh results':'Submit to public hackathon service',exact:true}).click();await delayed.seen;
   forcedStatus=403;await page.getByRole('button',{name:'Refresh results',exact:true}).click();await page.getByRole('alert').filter({hasText:'Report access is no longer available'}).waitFor();await noPrivate();
   delayed.release();await(await response).finished();await settle();await noPrivate();forcedStatus=0;await page.getByRole('button',{name:'Refresh results',exact:true}).click();await selectLoaded();
  }
  forcedStatus=503;await page.getByRole('button',{name:'Refresh results',exact:true}).click();await page.getByRole('alert').filter({hasText:'The request failed'}).waitFor();assert.equal(await page.getByText('Patient identifier in this preview:',{exact:false}).count(),1);assert.equal(await page.locator('.eps-submission-narrative').count(),1);assert.equal(await page.getByLabel('Submission history').count(),1);forcedStatus=0;
  await page.getByRole('button',{name:'Close',exact:true}).click();assert.equal(await page.getByRole('dialog').count(),0);
 }
 // All identity bindings remount the complete private view and invalidate older callbacks.
 for(const override of [{reportId:randomUUID()},{snapshotId:randomUUID()},{amendmentSequence:amendmentSequence+1},{dataset:'real'},{csrfToken:'another-authorized-user-binding'}]){
  await page.evaluate(()=>window.setEpsScope({}));await page.getByRole('button',{name:'Submit EPS',exact:true}).click();await selectLoaded();
  const delayed=hold('history'),response=page.waitForResponse(r=>r.url().includes('/eps/submissions?'));await page.getByRole('button',{name:'Refresh results',exact:true}).click();await delayed.seen;
  await page.evaluate(overrides=>window.setEpsScope(overrides),override);await page.getByRole('dialog').waitFor({state:'detached'});await noPrivate();delayed.release();await(await response).finished();await settle();assert.equal(await page.getByRole('dialog').count(),0);await noPrivate();
 }
 }finally{for(const pending of holds)pending.release();await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
