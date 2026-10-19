import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
export async function epsSubmissionBrowser({service,token,reportId,snapshotId,amendmentSequence,csrfToken}){
 const web=path.resolve(new URL('../../../web/',import.meta.url).pathname),css=await readFile(path.join(web,'app/styles.css'),'utf8');
 const bundled=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:web,loader:'tsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {EpsSubmissionPanel} from './components/eps-submission';createRoot(document.getElementById('root')).render(<EpsSubmissionPanel reportId="${reportId}" snapshotId="${snapshotId}" amendmentSequence={${amendmentSequence}} dataset="synthetic" language="en" csrfToken="${csrfToken}"/>);`}});
 const server=createServer(async(req,res)=>{try{
  if(req.url==='/'){res.setHeader('content-type','text/html');res.end(`<html lang="en"><style>${css}</style><body style="--green:#315ba8;--text-color:#112233"><div id="root"></div><script src="/app.js"></script></body></html>`);return;}
  if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');res.end(bundled.outputFiles[0].text);return;}
  let input='';for await(const chunk of req)input+=chunk;const body=input?JSON.parse(input):{};let result;
  if(req.method==='POST'){assert.equal(req.headers['x-csrf-token'],csrfToken);result=req.url.endsWith('/preview')?await service.preview(token,reportId,body,req.headers['x-csrf-token']):await service.submit(token,reportId,body,req.headers['x-csrf-token']);}else result=await service.history(token,reportId,'synthetic');
  res.setHeader('content-type','application/json');res.end(JSON.stringify(result));
 }catch(error){res.statusCode=error.getStatus?.()??500;res.setHeader('content-type','application/json');res.end(JSON.stringify({code:'failed'}));}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{browser=await chromium.launch({headless:true});const page=await browser.newPage();await mkdir('/tmp/hospital-009-preview',{recursive:true});
 for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  await page.setViewportSize(viewport);await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('button',{name:'Submit EPS',exact:true}).click();await page.getByLabel('Submission history').waitFor();
  await page.getByRole('button',{name:'Build and validate preview',exact:true}).click();await page.getByRole('button',{name:'Submit to public hackathon service',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Submit to public hackathon service',exact:true}).isDisabled(),true,'explicit fictional publication confirmation is required');
  assert.equal(await page.locator('script').count(),1,'signed narrative is rendered as text');assert.equal(await page.evaluate(()=>window.epsUnsafe),undefined);
  const dialog=page.getByRole('dialog');const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=viewport.width+1);await page.screenshot({path:`/tmp/hospital-009-preview/submission-${viewport.width}.png`,fullPage:true});
  await page.getByRole('button',{name:'Close',exact:true}).click();assert.equal(await page.getByRole('dialog').count(),0);
 }
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
