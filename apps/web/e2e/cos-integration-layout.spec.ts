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
 const view={groupName:'Fixture',stateRevision:1,active:null,activeHealth:'untested',draftHealth:'untested',draft:{revision:1,endpoint:'https://example.org',credentialConfigured:true,settings:{live:{baseUrl:'https://example.org/',tokenUrl:'https://example.org/token',clientId:'fixture',pdfKeyword:'pdf',versionMarkerLinkId:'123456789',acceptedProfiles:[]},mode:'simulator',authentication:'api-key',template:'fixture',encounterNamespace:'urn:encounter',organizationHsaId:'fixture',defaultAmbulanceCareUnit:'fixture'},mapping:{sha256:'fixture',definition:{pdfLinkId:'371530004',patientIdentifier:{field,namespace:'urn:patient',aliases:[]},vitalMappings:[{id:'bp',vital:'bloodPressure',unit:'mm[Hg]',source:{kind:'nemsis',elementId:'eVitals.06'},companionSource:{kind:'nemsis',elementId:'eVitals.07'},linkId:'75367002'}],medicationMappings:[{id:'meds',groupId:'eMedications.MedicationGroup'}],clinicalMappings:[{id:'mapping',source:field,linkId:'narrative',answerType:'string'}]}}},options:[{id:field.elementId,field,name:'Narrative'}],clinicalOptions:[{id:field.elementId,field,name:'Narrative'}],tests:[],history:[],events:[]};
 let savedBody:Record<string,unknown>|undefined;
 await page.route('**/api/admin/hospital/cos',route=>{if(route.request().method()==='PUT'){savedBody=route.request().postDataJSON();view.draft.settings=savedBody!.settings as typeof view.draft.settings;}return route.fulfill({json:view});});
 await page.route('**/api/admin/destinations?*',route=>route.fulfill({json:{items:[],nextCursor:null}}));
 await page.route('**/api/admin/hospital/eps',route=>route.fulfill({json:{...view,draft:null}}));
 await page.route('**/__cos-layout',route=>route.fulfill({contentType:'text/html',body:`<html lang="${language}"><head><style>${css}</style></head><body style="--green:#663399;--green-dark:#442266"><div id="root"></div><script>${script}</script></body></html>`}));
 await page.goto('/__cos-layout');
 const panel=page.locator('.cos-integrations');
 const workspace=panel.locator('.cos-integration-workspace');
 await expect(workspace.locator('.cos-mappings-table tbody tr')).toHaveCount(2);
 const messages=JSON.parse(await readFile(path.resolve(__dirname,`../messages/${language}.json`),'utf8'));
 const label=(key:string)=>messages[`hospital.cos.${key}`];
 const clinical=panel.getByRole('table',{name:label('clinicalMappings'),exact:true});
 const vitals=panel.getByRole('table',{name:label('vitalMappings'),exact:true});
 await expect(clinical.getByRole('columnheader')).toHaveText([label('source'),label('linkId'),label('actions')]);
 await expect(vitals.getByRole('columnheader')).toHaveText([label('vital'),label('source'),label('companionSource'),label('linkId'),label('actions')]);
 await panel.getByRole('button',{name:label('addVitalMapping'),exact:true}).click();
 await expect(vitals.locator('tbody tr')).toHaveCount(2);
 await expect(vitals.locator('tbody tr').nth(1).locator('td')).toHaveCount(5);
 await vitals.locator('tbody tr').nth(1).getByRole('button',{name:label('remove')}).click();
 await clinical.getByLabel(label('linkId'),{exact:true}).fill('updated-narrative');
 await panel.getByLabel(label('pdfLinkId'),{exact:true}).fill('');
 await panel.getByRole('button',{name:label('save'),exact:true}).click();
 await expect.poll(()=>savedBody?.pdfLinkId).toBe('');
 expect(savedBody?.clinicalMappings).toEqual([expect.objectContaining({linkId:'updated-narrative'})]);
 expect(savedBody?.settings).not.toHaveProperty('staff');
 expect(savedBody?.settings).not.toHaveProperty('careUnits');
 await expect(panel.getByRole('button',{name:/Add staff|Add care unit|Lägg till personal|Lägg till vårdenhet/})).toHaveCount(0);
 await panel.getByLabel(label('mode')).selectOption('live');
 await panel.getByRole('combobox',{name:label('authentication'),exact:true}).selectOption('oauth-client-credentials');
 const readBack=panel.getByRole('checkbox',{name:label('readBackVerification'),exact:true});
 const delay=panel.getByRole('spinbutton',{name:label('initialVerificationDelaySeconds'),exact:true});
 await expect(delay).toHaveValue('20');
 await expect(readBack).toBeChecked();await readBack.uncheck();await expect(delay).toBeDisabled();await readBack.check();
 await delay.fill('241');expect(await delay.evaluate((el:HTMLInputElement)=>el.checkValidity())).toBe(false);
 await delay.fill('45');
 await panel.getByRole('button',{name:label('save'),exact:true}).click();
 await expect.poll(()=> (savedBody?.settings as {live?:{initialVerificationDelaySeconds?:number}})?.live?.initialVerificationDelaySeconds).toBe(45);
 await expect(delay).toHaveValue('45');
 await page.reload();
 await expect(delay).toHaveValue('45');
 await expect(panel.getByLabel(label('clientSecret'),{exact:true})).toHaveAttribute('type','password');
 await expect(panel.getByLabel(label('subscriptionKey'),{exact:true})).toHaveAttribute('type','password');
 await expect(panel.getByLabel(label('companionSource'),{exact:true})).toHaveValue('eVitals.07');
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});
  const heading=await panel.locator(':scope > h3').boundingBox();
  const form=await workspace.locator(':scope > form').boundingBox();
  await expect(workspace.locator(':scope > fieldset')).toHaveCount(0);
  await expect(panel.locator('input[type=file]')).toHaveCount(0);
  expect(heading!.x).toBe(form!.x);

  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  for(const row of await workspace.locator('.cos-mappings-table tbody tr').all()){
   expect(await row.evaluate(el=>getComputedStyle(el).marginTop)).toBe('0px');
   for(const control of await row.locator('input,select,button').all()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({path:test.info().outputPath(`cos-${width}.png`),fullPage:true});
 }
});
