import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
export async function epsBrowser({service,token,reportId,organizationId,userId,change,setBroken}){
 const {build}=await import('esbuild'),{chromium}=await import('@playwright/test');
 const web=path.resolve(new URL('../../../web/',import.meta.url).pathname);
 const bundled=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:web,loader:'tsx',contents:`import React,{useState,useEffect} from 'react';import {createRoot} from 'react-dom/client';import {PatientSummaryButton} from './components/patient-summary';function Fixture(){const [revision,setRevision]=useState('initial');useEffect(()=>{const change=e=>setRevision(String(e.detail));window.addEventListener('eps-fixture',change);return()=>window.removeEventListener('eps-fixture',change);},[]);return <PatientSummaryButton csrfToken="fixture-csrf" reportId="${reportId}" organizationId="${organizationId}" userId="${userId}" documentKey={revision} ready language={location.search.includes('sv')?'sv':'en'}/>;}createRoot(document.getElementById('root')).render(<Fixture/>);`}});
 const css=await readFile(path.join(web,'app/styles.css'),'utf8');
 let server,browser,delayed;
 try{
  server=createServer(async(req,res)=>{
   try{
    if(req.url.startsWith('/api/reports/')){assert.equal(req.headers.cookie,'eps-session=authorized');const url=new URL(req.url,'http://local');const result=url.pathname.endsWith('/imports/history')?{inconsistent:false}:url.pathname.endsWith('/imports')?{rows:[],inconsistent:false}:url.pathname.endsWith('/context')?await service.context(token,reportId):await service.lookup(token,reportId,url.searchParams.get('binding'));if(!url.pathname.includes('/imports')&&!url.pathname.endsWith('/context')&&delayed){const hold=delayed;delayed=null;hold.seen();await hold.gate;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;}
    if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundled.outputFiles[0].text);return;}
    res.setHeader('Content-Type','text/html');res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="--green:#315ba8;--green-dark:#17366d"><main class="app-shell"><header class="encounter-header"><div class="draft-actions" id="root"></div></header></main><script src="/bundle.js"></script></body></html>`);
   }catch(error){res.writeHead(error.getStatus?.()??500,{'Content-Type':'application/json'});res.end(JSON.stringify({code:'eps.failed'}));}
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true});
  for(const [language,width,height] of [['en',1440,900],['sv',390,844]]){
   await change('200207252388');
   const context=await browser.newContext({viewport:{width,height}});await context.addCookies([{name:'eps-session',value:'authorized',url:origin}]);const page=await context.newPage();const external=[];page.on('request',request=>{if(request.url().includes('example.invalid'))external.push(request.url());});
   const button=page.getByRole('button',{name:language==='en'?'Patient summary (EPS)':'Patientöversikt (EPS)',exact:true});
   await page.goto(`${origin}/?${language}`);await page.waitForFunction(()=>document.querySelector('.eps-control > button')?.disabled===false);
   await button.focus();await page.keyboard.press('Enter');await page.getByRole('dialog').waitFor();
   assert.match(await page.getByRole('dialog').innerText(),/Andrea/);
   assert.equal(await page.evaluate(()=>window.epsUnsafe),undefined);assert.deepEqual(external,[]);await page.getByText(language==='en'?'Unresolved references (no external content was fetched)':'Olösta referenser (inget externt innehåll har hämtats)',{exact:true}).waitFor();
   assert.equal(await page.getByRole('dialog').locator('script,img,iframe,a').count(),0,'source markup and references never become active nodes');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.equal(await page.getByRole('dialog').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight),true);
   const close=page.getByRole('button',{name:language==='en'?'Close':'Stäng',exact:true});assert.equal(await close.evaluate(el=>el===document.activeElement),true);
   await page.screenshot({path:`/tmp/eps004-${language}.png`});
   await page.keyboard.press('Escape');assert.equal(await button.evaluate(el=>el===document.activeElement),true);
   let releaseIdentity,identitySeen;const identityStarted=new Promise(resolve=>identitySeen=resolve);
   delayed={gate:new Promise(resolve=>releaseIdentity=resolve),seen:identitySeen};
   try {
    await change('194302096997');await page.evaluate(()=>window.dispatchEvent(new CustomEvent('eps-fixture',{detail:'arne'})));
    await identityStarted;
    assert.equal(await button.isDisabled(),true,'identity change invalidates availability before the replacement response');
   } finally {releaseIdentity();}
   await page.waitForFunction(()=>document.querySelector('.eps-control > button')?.disabled===false);await button.click();await page.getByRole('dialog').waitFor();assert.match(await page.getByRole('dialog').innerText(),/Arne/);await close.click();
   setBroken(true);await page.evaluate(()=>window.dispatchEvent(new CustomEvent('eps-fixture',{detail:'failure'})));await page.getByRole('button',{name:language==='en'?'Retry':'Försök igen',exact:true}).waitFor();assert.equal(await button.isDisabled(),true);
   setBroken(false);await page.getByRole('button',{name:language==='en'?'Retry':'Försök igen',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.eps-control > button')?.disabled===false);
   // Deliver a previous patient's response after the new patient has completed.
   let release,seen;const started=new Promise(resolve=>seen=resolve);delayed={gate:new Promise(resolve=>release=resolve),seen};
   await change('200207252388');await page.evaluate(()=>window.dispatchEvent(new CustomEvent('eps-fixture',{detail:'delayed-andrea'})));await started;
   await change('194302096997');await page.evaluate(()=>window.dispatchEvent(new CustomEvent('eps-fixture',{detail:'current-arne'})));await page.waitForFunction(()=>document.querySelector('.eps-control > button')?.disabled===false);release();
   await button.click();await page.getByRole('dialog').waitFor();assert.match(await page.getByRole('dialog').innerText(),/Arne/);assert.doesNotMatch(await page.getByRole('dialog').innerText(),/Andrea/);await close.click();
   const noMatch=page.waitForResponse(async response=>new URL(response.url()).pathname.endsWith('/eps')&&response.ok()&&(await response.json()).status==='no-match');
   await change('unknown');await page.evaluate(()=>window.dispatchEvent(new CustomEvent('eps-fixture',{detail:'unknown'})));await noMatch;assert.equal(await button.isDisabled(),true);
   await context.close();
  }
 }finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));}
}
