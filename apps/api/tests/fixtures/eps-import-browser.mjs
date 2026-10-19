import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
export async function epsImportBrowser({imports,configuration,query,token,adminToken,reportId,binding}) {
 const {build}=await import('esbuild'),{chromium}=await import('@playwright/test');
 const web=path.resolve(new URL('../../../web/',import.meta.url).pathname);
 const output=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:web,loader:'tsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {EpsImports} from './components/eps-imports';import {HospitalIntegrationsPanel} from './components/hospital-integrations';const language=location.search.includes('sv')?'sv':'en';createRoot(document.getElementById('root')).render(location.search.includes('admin')?<HospitalIntegrationsPanel language={language} csrfToken="fixture" canWrite/>:<EpsImports reportId="${reportId}" binding="${binding}" language={language} ready/>);`}});
 const css=await readFile(path.join(web,'app/styles.css'),'utf8');let server,browser;
 try{
  server=createServer(async(req,res)=>{try{
   if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(output.outputFiles[0].text);return;}
   if(req.url.startsWith('/api/')){
    assert.equal(req.headers.cookie,'eps-import-session=authorized');let raw='';for await(const part of req)raw+=part;const body=raw?JSON.parse(raw):undefined;
    const route=new URL(req.url,'http://fixture').pathname;
    const result=route.endsWith('/imports/plan')?await imports.plan(token,reportId,body):route.endsWith('/imports/apply')?await imports.apply(token,reportId,body):route.endsWith('/imports')?await imports.rows(token,reportId,binding):route.endsWith('/inspect-mappings')?await configuration.inspectClinical(adminToken,body):req.method==='PUT'?await configuration.save(adminToken,body):await configuration.get(adminToken);
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
   }
   res.setHeader('Content-Type','text/html');res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="--green:#315ba8;--green-dark:#17366d"><main class="app-shell"><section class="eps-dialog" style="position:static;width:auto;max-height:none"><div class="eps-content" id="root"></div></section></main><script src="/bundle.js"></script></body></html>`);
  }catch(error){res.writeHead(error.getStatus?.()??500,{'Content-Type':'application/json'});res.end(JSON.stringify(error.getResponse?.()??{code:'eps.failed'}));}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch({headless:true});
  for(const [lang,width,height] of [['en',1440,900],['en',390,844],['sv',1440,900],['sv',390,844]]){
   await query('savepoint eps_import_browser');
   const context=await browser.newContext({viewport:{width,height}});await context.addCookies([{name:'eps-import-session',value:'authorized',url:origin}]);const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   try {
    await page.goto(`${origin}/?${lang}`);const preview=page.getByRole('button',{name:lang==='en'?/^Preview import/:/^Förhandsgranska import/});await preview.first().waitFor();
    await preview.first().focus();await page.keyboard.press('Enter');await page.getByRole('button',{name:lang==='en'?'Import selected item':'Importera vald uppgift',exact:true}).click();await page.getByRole('status').getByText(lang==='en'?'Decision saved. The report will refresh.':'Beslutet är sparat. Journalen uppdateras.',{exact:true}).waitFor();
    await preview.nth(1).click();await page.getByRole('button',{name:lang==='en'?'Keep existing documentation':'Behåll befintlig dokumentation'}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await page.locator('.eps-import-preview textarea').first().evaluate(el=>{const r=el.getBoundingClientRect(),p=el.parentElement.getBoundingClientRect();return r.width>=p.width-2&&r.top>=p.top+18;}),true,'preview fields stack their labels and use the available width');
    await page.screenshot({path:`/tmp/eps005-import-${lang}-${width}.png`});
    await page.getByRole('button',{name:lang==='en'?'Keep existing documentation':'Behåll befintlig dokumentation'}).click();
    await page.getByRole('status').getByText(lang==='en'?'Decision saved. The report will refresh.':'Beslutet är sparat. Journalen uppdateras.',{exact:true}).waitFor();
    await page.reload();await preview.first().click();await page.getByText(lang==='en'?'This source item has already been handled.':'Källuppgiften har redan hanterats.',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);
   }catch(error){await page.screenshot({path:'/tmp/eps005-failure.png'});await import('node:fs/promises').then(async fs=>fs.writeFile('/tmp/eps005-failure.html',await page.content()));throw error;}finally{await context.close();await query('rollback to savepoint eps_import_browser');await query('release savepoint eps_import_browser');}
  }
  const oldRoot=process.env.OPENTRIAGE_DEFINITIONS_ROOT,folder=await mkdtemp('/tmp/eps-import-browser-');process.env.OPENTRIAGE_DEFINITIONS_ROOT=folder;
  await query('savepoint eps_mapping_browser');
  const context=await browser.newContext({viewport:{width:1440,height:900}});await context.addCookies([{name:'eps-import-session',value:'authorized',url:origin}]);const page=await context.newPage();
  try{
   assert.ok((await configuration.get(adminToken)).clinicalOptions.some(o=>o.id==='eNarrative.01'));
   await page.goto(`${origin}/?admin`);await page.getByRole('button',{name:'Add clinical mapping',exact:true}).click();
   await page.getByLabel('Source code system',{exact:true}).last().fill('http://example.org/clinical-codes');await page.getByLabel('Source code',{exact:true}).last().fill('explicit-unknown');await page.getByLabel('Destination field').last().selectOption('eNarrative.01');
   await page.getByRole('button',{name:'Check mappings',exact:true}).click();await page.getByText('The exact source code is unavailable in this field',{exact:false}).waitFor();
   await page.getByLabel('Representation').last().selectOption('text');await page.getByRole('button',{name:'Check mappings',exact:true}).click();await page.waitForFunction(()=>[...document.querySelectorAll('[role=status]')].filter(e=>e.textContent.includes('Compatible')).length===3);
   await page.getByRole('button',{name:'Save EPS draft',exact:true}).click();await page.getByText('Active revision: 2 — Draft revision: 3',{exact:false}).waitFor();
   const exported=await configuration.export(adminToken,'3');assert.equal(exported.definition.clinicalMappings.length,3);assert.equal(exported.definition.clinicalMappings[2].code,'explicit-unknown');
   const state=await configuration.get(adminToken);await configuration.save(adminToken,{expectedRevision:3,endpoint:state.defaultEndpoint,authentication:'team-token',mapping:JSON.parse(JSON.stringify(exported))});assert.equal((await configuration.export(adminToken,'4')).sha256,exported.sha256);
   await page.screenshot({path:'/tmp/eps005-admin.png'});
  }catch(error){await page.screenshot({path:'/tmp/eps005-failure.png'});await import('node:fs/promises').then(async fs=>fs.writeFile('/tmp/eps005-failure.html',await page.content()));throw error;}finally{await context.close();await query('rollback to savepoint eps_mapping_browser');await query('release savepoint eps_mapping_browser');process.env.OPENTRIAGE_DEFINITIONS_ROOT=oldRoot;await rm(folder,{recursive:true,force:true});}
 }finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));}
}
