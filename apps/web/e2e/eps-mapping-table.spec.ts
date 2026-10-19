import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

for(const language of ['en','sv']) test(`EPS mapping table edits and responsive layout in ${language}`,async({page})=>{
 const script=(await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';
 import{HospitalIntegrationsPanel}from'./components/hospital-integrations';
 createRoot(document.getElementById('root')).render(<HospitalIntegrationsPanel language="${language}" csrfToken="fixture" canWrite/>);`}})).outputFiles[0]!.text;
 const css=await readFile(path.resolve(__dirname,'../app/styles.css'),'utf8');
 const field={kind:'nemsis',elementId:'eHistory.06'};
 const mappings=['one','two'].map(id=>({id,resourceType:'AllergyIntolerance',system:'http://snomed.info/sct',code:id,destination:field,representation:'coded',crosswalk:{system:'urn:target',code:id,display:id,relationship:'equivalent',reference:'https://example.org'}}));
 const view={groupName:'Fixture',stateRevision:1,active:null,activeHealth:'untested',draftHealth:'untested',draft:{revision:1,endpoint:'https://example.org/fhir',credentialConfigured:true,mapping:{sha256:'fixture',definition:{patientIdentifier:{field,namespace:'urn:patient',aliases:[]},clinicalMappings:mappings,outputMappings:[{id:'out',source:{kind:'nemsis',elementId:'eNarrative.01'},section:'patientStory',representation:'signed-narrative'}]}}},options:[],clinicalOptions:['eNarrative.01','ePatient.02'].map(id=>({id,field:{kind:'nemsis',elementId:id},name:id})),tests:[],history:[],events:[]};
 let saved: {clinicalMappings: typeof mappings;outputMappings:{section:string;representation:string;source:{elementId:string}}[]} | undefined;
 await page.route('**/api/admin/hospital/eps',async route=>{
  if(route.request().method()==='PUT'){saved=route.request().postDataJSON();return route.fulfill({json:{...view,draft:{...view.draft,mapping:{...view.draft.mapping,definition:{...view.draft.mapping.definition,clinicalMappings:saved?.clinicalMappings}}}}});}
  return route.fulfill({json:view});
 });
 await page.route('**/__eps-mappings',route=>route.fulfill({contentType:'text/html',body:`<html lang="${language}"><head><style>${css}</style></head><body style="--green:#663399;--green-dark:#442266"><div id="root"></div><script>${script}</script></body></html>`}));
 await page.goto('/__eps-mappings');
 const table=page.locator('.hospital-mappings-table');
 await expect(table.getByRole('columnheader')).toHaveCount(6);
 const rows=table.locator('tbody tr');
 await expect(rows).toHaveCount(2);
 const target=rows.first().getByLabel(language==='en'?'Destination label':'Målets benämning',{exact:true});
 await target.fill('Edited target');
 await page.getByRole('button',{name:language==='en'?'History':'Historik',exact:true}).click();
 await page.getByRole('button',{name:'EPS',exact:true}).click();
 await expect(target).toHaveValue('Edited target');
 await rows.last().getByRole('button').click();
 await expect(rows).toHaveCount(1);
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});
  await table.scrollIntoViewIfNeeded();
  await page.locator('.hospital-mappings-scroll').evaluate(el=>{el.scrollLeft=0;});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const region=page.locator('.hospital-mappings-scroll');
  await expect(region).toHaveAttribute('tabindex','0');
  await page.screenshot({path:test.info().outputPath(`mappings-${width}.png`),fullPage:true});
 }
 await page.getByRole('combobox',{name:language==='en'?'EPS destination':'EPS-mål',exact:true}).selectOption('patientFamily');
 await expect(page.getByRole('combobox',{name:language==='en'?'Signed source field':'Signerat källfält',exact:true})).toHaveValue('ePatient.02');
 await page.getByRole('button',{name:language==='en'?'Save EPS draft':'Spara EPS-utkast',exact:true}).click();
 await expect.poll(()=>saved?.clinicalMappings?.[0]?.crosswalk?.display).toBe('Edited target');
 expect(saved?.clinicalMappings).toHaveLength(1);
 expect(saved?.outputMappings[0]).toMatchObject({section:'patientFamily',representation:'structured-patient',source:{elementId:'ePatient.02'}});
});
