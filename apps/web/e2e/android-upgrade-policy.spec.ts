import {expect,test} from '@playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
let script:string,css:string;
test.beforeAll(async()=>{
 css=await readFile(path.resolve(__dirname,'../app/styles.css'),'utf8')+await readFile(path.resolve(__dirname,'../app/review-workspace.css'),'utf8');
 const result=await build({bundle:true,write:false,jsx:'automatic',format:'iife',platform:'browser',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import{SuperAdminWorkspace}from'./components/super-admin-workspace';import{UnsavedChangesContext}from'./components/unsaved-changes';
 const language=new URLSearchParams(location.search).get('language')??'en';
 const session={user:{id:'owner',displayName:'Owner'},csrfToken:'csrf',installationOwner:true,installationSuperadmin:true};
 createRoot(document.getElementById('root')).render(<UnsavedChangesContext.Provider value={new Set()}><SuperAdminWorkspace session={session} language={language} onOpenAgency={async()=>{}}/></UnsavedChangesContext.Provider>);
 `}});script=result.outputFiles[0]!.text;
});
for(const language of ['en','sv'])test(`Super-admin previews and persists installation-wide grace while preserving drafts (${language})`,async({page},testInfo)=>{
 const text=(en:string,sv:string)=>language==='sv'?sv:en;
 let days=90,revision=1,denied=false,stale=false,mutations=0,previews=0;
 const evaluated=(grace:number)=>[{versionCode:1,serverTime:'2026-03-31T00:00:00.000Z',status:grace>=90?'approaching-upgrade':'upgrade-required',reason:'retired',deadline:new Date(Date.parse('2026-01-01T00:00:00.000Z')+grace*86400000).toISOString(),replacement:null},{versionCode:2,serverTime:'2026-03-31T00:00:00.000Z',status:'compatible',reason:'supported',deadline:null,replacement:null},{versionCode:3,serverTime:'2026-03-31T00:00:00.000Z',status:'upgrade-required',reason:'unsupported',deadline:null,replacement:null}];
 const view=()=>({policy:{graceDays:days,revision,updatedAt:'2026-03-31T00:00:00.000Z'},serverTime:'2026-03-31T00:00:00.000Z',clients:evaluated(days)});
 await page.route('**/__android-policy-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
 await page.route('**/__android-policy?*',route=>route.fulfill({contentType:'text/html',body:`<html lang="${language}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}:root{--green:rgb(86,45,150);--green-dark:rgb(61,25,110)}</style></head><body><div id="root"></div><script src="/__android-policy-script"></script></body></html>`}));
 await page.route('**/api/super-admin/**',async route=>{
  const request=route.request();
  if(request.url().endsWith('/agencies'))return route.fulfill({json:{agencies:[],catalogs:[],forms:[],validations:[],activeConfigurations:[],hostnameSuffix:null}});
  if(denied)return route.fulfill({status:401,json:{code:'auth.sessionRequired'}});
  if(request.method()==='GET')return route.fulfill({json:view()});
  expect(request.headers()['x-csrf-token']).toBe('csrf');const body=request.postDataJSON();
  if(request.method()==='POST'){
   previews++;if(body.graceDays===120)return route.fulfill({status:400,json:{code:'android.policyInvalid'}});
   return route.fulfill({json:{...view(),proposedGraceDays:body.graceDays,previewToken:'a'.repeat(64),proposedClients:evaluated(body.graceDays)}});
  }
  if(stale)return route.fulfill({status:409,json:{code:'android.policyChanged'}});
  expect(body.expectedRevision).toBe(revision);expect(body.previewToken).toBe('a'.repeat(64));days=body.graceDays;revision++;mutations++;return route.fulfill({json:view()});
 });
 await page.goto(`/__android-policy?language=${language}`);
 const androidTab=page.getByRole('tab',{name:text('APK upgrades','APK-uppgraderingar')});await androidTab.click();
 const field=page.getByLabel(text('Upgrade grace (days)','Frist för uppgradering (dagar)'),{exact:true});
 const preview=page.getByRole('button',{name:text('Preview change','Förhandsgranska ändring'),exact:true});const save=page.getByRole('button',{name:text('Save','Spara'),exact:true});
 await expect(field).toHaveValue('90');await page.getByText(text('Upgrade grace (days)','Frist för uppgradering (dagar)'),{exact:true}).focus();await expect(page.getByRole('tooltip')).toContainText('0–365');await page.keyboard.press('Escape');await expect(page.getByRole('tooltip')).toHaveCount(0);await expect(save).toHaveCount(0);await field.fill('100');
 await page.getByRole('tab',{name:text('Agencies','Organisationer')}).click();await androidTab.click();await expect(field).toHaveValue('100');
 await preview.click();const impact=page.getByRole('region',{name:text('Preview change','Förhandsgranska ändring')});await expect(impact).toBeVisible();await expect(impact).toContainText(text('Apply 100 days to every agency','Tillämpa 100 dagar för alla organisationer'));await expect(impact).toContainText(text('Unsupported format or capability','Format eller funktion som inte stöds'));
 await expect(impact.locator('tbody tr').first()).toContainText('11');await expect(save).toBeEnabled();
 for(const width of [390,1200]){
  await page.setViewportSize({width,height:844});await save.scrollIntoViewIfNeeded();await expect(save).toBeInViewport();await page.screenshot({path:testInfo.outputPath(`upgrade-policy-${language}-${width}.png`)});
  const overflow=await page.evaluate(()=>Array.from(document.querySelectorAll('*')).filter(el=>el.getBoundingClientRect().right>innerWidth+1).map(el=>({tag:el.tagName,cls:el.className,width:el.getBoundingClientRect().width,right:el.getBoundingClientRect().right,min:getComputedStyle(el).minWidth})));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),JSON.stringify(overflow)).toBe(true);
  await save.focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');await expect(save).toBeFocused();expect(await save.evaluate(el=>getComputedStyle(el).outlineStyle)).not.toBe('none');expect(await save.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(86, 45, 150)');
  await page.screenshot({path:testInfo.outputPath(`upgrade-policy-${language}-${width}.png`)});
 }
 await save.click();await expect(page.getByRole('status')).toContainText(text('Upgrade policy saved.','Uppgraderingspolicyn har sparats.'));expect(mutations).toBe(1);
 await page.reload();await page.getByRole('tab',{name:text('APK upgrades','APK-uppgraderingar')}).click();await expect(field).toHaveValue('100');
 await field.fill('366');await expect(preview).toBeDisabled();await expect(save).toHaveCount(0);
 await field.fill('120');await preview.click();await expect(page.getByRole('alert')).toContainText(text('Enter a whole number of days from 0 to 365.','Ange ett helt antal dagar från 0 till 365.'));await expect(field).toHaveValue('120');await expect(save).toHaveCount(0);
 await field.fill('80');await preview.click();await expect(save).toBeVisible();stale=true;await save.click();await expect(page.getByRole('alert')).toContainText(text('Policy or release availability changed','Policyn eller tillgängligheten ändrades'));await expect(field).toHaveValue('80');await expect(save).toHaveCount(0);expect(mutations).toBe(1);
 await page.getByRole('button',{name:text('Cancel','Avbryt'),exact:true}).click();await expect(field).toHaveValue('100');
 expect(previews).toBe(3);await expect(page.locator('input[type=password]')).toHaveCount(0);
 denied=true;await page.reload();await page.getByRole('tab',{name:text('APK upgrades','APK-uppgraderingar')}).click();await expect(field).toHaveCount(0);await expect(page.getByRole('alert')).toBeVisible();
});
