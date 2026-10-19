import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

for(const language of ['en','sv']) test(`COS spacing and responsive fields in ${language}`,async({page})=>{
 const script=(await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';
 import{HospitalIntegrationsPanel}from'./components/hospital-integrations';
 createRoot(document.getElementById('root')).render(<HospitalIntegrationsPanel language="${language}" csrfToken="fixture" initialTab="cos" canWrite/>);`}})).outputFiles[0]!.text;
 const css=await readFile(path.resolve(__dirname,'../app/styles.css'),'utf8');
 const field={kind:'nemsis',elementId:'eNarrative.01'};
 const view={groupName:'Fixture',stateRevision:1,active:null,activeHealth:'untested',draftHealth:'untested',draft:{revision:1,endpoint:'https://example.org',credentialConfigured:true,settings:{mode:'simulator',authentication:'api-key',template:'fixture',encounterNamespace:'urn:encounter',organizationHsaId:'fixture',defaultAmbulanceCareUnit:'fixture',staff:[{userId:'user',hsaId:'staff'}],careUnits:[{hospital:'Hospital',localCareUnit:'Unit',hsaId:'unit'}]},mapping:{sha256:'fixture',definition:{patientIdentifier:{field,namespace:'urn:patient',aliases:[]},clinicalMappings:[{id:'mapping',source:field,linkId:'narrative',answerType:'string'}]}}},options:[{id:field.elementId,field,name:'Narrative'}],clinicalOptions:[{id:field.elementId,field,name:'Narrative'}],staffOptions:[{id:'user',name:'Fixture user'}],tests:[],history:[],events:[]};
 await page.route('**/api/admin/hospital/cos',route=>route.fulfill({json:view}));
 await page.route('**/api/admin/hospital/eps',route=>route.fulfill({json:{...view,draft:null}}));
 await page.route('**/__cos-layout',route=>route.fulfill({contentType:'text/html',body:`<html lang="${language}"><head><style>${css}</style></head><body style="--green:#663399;--green-dark:#442266"><div id="root"></div><script>${script}</script></body></html>`}));
 await page.goto('/__cos-layout');
 const panel=page.locator('.cos-integrations');
 const workspace=panel.locator('.cos-integration-workspace');
 await expect(workspace.locator('.hospital-mapping-row')).toHaveCount(3);
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});
  const heading=await panel.locator('h3').boundingBox();
  const form=await workspace.locator('form').boundingBox();
  await expect(workspace.locator(':scope > fieldset')).toHaveCount(0);
  await expect(panel.locator('input[type=file]')).toHaveCount(0);
  expect(heading!.x).toBe(form!.x);

  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  for(const row of await workspace.locator('.hospital-mapping-row').all()){
   expect(await row.evaluate(el=>getComputedStyle(el).marginTop)).toBe('0px');
   for(const control of await row.locator('input,select,button').all()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({path:test.info().outputPath(`cos-${width}.png`),fullPage:true});
 }
});
