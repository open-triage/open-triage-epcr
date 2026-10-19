import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
test('Review EPS submission requires active integration and closes when deactivated',async({page})=>{
 const script=(await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import{EpsSubmissionPanel}from'./components/eps-submission';
 createRoot(document.getElementById('root')).render(<EpsSubmissionPanel reportId="report" snapshotId="snapshot" amendmentSequence={0} dataset="synthetic" language="en" csrfToken="csrf"/>);`}})).outputFiles[0]!.text;
 await page.clock.install();let active=false,historyReads=0;
 await page.route('**/__submission',route=>route.fulfill({contentType:'text/html',body:`<div id="root"></div><script>${script}</script>`}));
 await page.route('**/api/reports/report/eps/submissions**',route=>{
  if(new URL(route.request().url()).pathname.endsWith('/availability'))return route.fulfill({json:{active}});
  historyReads++;return route.fulfill({json:[]});
 });
 await page.goto('/__submission');
 await expect(page.getByRole('button')).toHaveCount(0);expect(historyReads).toBe(0);
 active=true;await page.clock.runFor(16000);
 await page.getByRole('button').click();await expect(page.getByRole('dialog')).toBeVisible();
 active=false;await page.clock.runFor(16000);
 await expect(page.getByRole('button')).toHaveCount(0);await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('manual EPS submission accepts pending receiver validation only after confirmation',async({page})=>{
 const script=(await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import{EpsSubmissionPanel}from'./components/eps-submission';
 createRoot(document.getElementById('root')).render(<EpsSubmissionPanel reportId="report" snapshotId="snapshot" amendmentSequence={0} dataset="synthetic" language="en" csrfToken="csrf"/>);`}})).outputFiles[0]!.text;
 const css=await readFile(path.resolve(__dirname,'../app/styles.css'),'utf8');
 let publications=0;
 const prepared={id:'preview',amendmentSequence:0,configurationRevision:8,mappingRevision:1,mappingId:'mapping',mappingSha256:'digest',state:'prepared',validation:{findings:[],profile:{state:'pending',issues:[]}},bundle:{entry:[{resource:{resourceType:'Composition',section:[...['Problems','Allergies','Medications','Procedures','Devices'].map(title=>({title,emptyReason:{coding:[{code:'unavailable'}]},text:{div:'<div>Information unavailable</div>'}})),{title:'Patient story',text:{div:'<div><p>Fictional patient narrative.</p></div>'}}]}},{resource:{resourceType:"Patient",name:[{family:"Example",given:["Fictional"]}],birthDate:"1980-02-29",gender:"female"}}]},result:null};
 await page.route('**/__receiver',route=>route.fulfill({contentType:'text/html',body:`<style>${css}</style><div id="root"></div><script>${script}</script>`}));
 await page.route('**/api/reports/report/eps/submissions**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/availability'))return route.fulfill({json:{active:true}});
  if(path.endsWith('/preview'))return route.fulfill({json:prepared});
  if(path.endsWith('/submit')){publications++;expect(route.request().postDataJSON().confirmPublicFictional).toBe(true);return route.fulfill({json:{...prepared,state:'rejected',result:{headers:{'x-pass':'false'},issues:[]}}});}
  return route.fulfill({json:[]});
 });
 await page.goto('/__receiver');await page.getByRole('button',{name:'Submit EPS',exact:true}).click();
 await page.getByRole('button',{name:'Build preview',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('Profile validation runs at the receiving service when submitted');
 await expect(page.getByRole('dialog')).toContainText('Fictional Example');await expect(page.getByRole('dialog')).toContainText('1980-02-29');
 const narrative=page.locator('.eps-submission-narrative');
 await expect(narrative.locator('section').first()).toContainText('Patient story');
 await expect(narrative).toContainText('Fictional patient narrative.');
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});
  await narrative.locator('section').first().scrollIntoViewIfNeeded();
  await expect(narrative.locator('section').first()).toBeInViewport();
  expect(await narrative.evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath(`eps-story-${width}.png`)});
 }
 const submit=page.getByRole('button',{name:'Submit to public hackathon service',exact:true});await expect(submit).toBeDisabled();expect(publications).toBe(0);
 await page.getByRole('checkbox').check();await submit.click();expect(publications).toBe(1);
});
