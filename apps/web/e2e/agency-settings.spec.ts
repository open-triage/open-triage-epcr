import { expect, test } from '@playwright/test';
import { DEFAULT_AGENCY_APPEARANCE } from '@open-triage/contracts';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

let script:string,css:string;
test.beforeAll(async()=>{
  css=await readFile(path.resolve(__dirname,'../app/styles.css'),'utf8');
  const result=await build({bundle:true,write:false,jsx:'automatic',format:'iife',platform:'browser',
    define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},
    stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`
      import React from 'react';import{createRoot}from'react-dom/client';
      import{AgencySettingsPanel}from'./components/agency-settings';
      const params=new URLSearchParams(location.search);
      createRoot(document.getElementById('root')).render(<AgencySettingsPanel csrfToken="csrf" canWrite={params.get('readonly')!=='1'} language={params.get('language')}/>);
    `}});script=result.outputFiles[0]!.text;
});
for(const language of ['en','sv'])test(`${language} Demo unit selection saves, clears and survives a failed unit refresh on mobile`,async({page},testInfo)=>{
  const t=(en:string,sv:string)=>language==='sv'?sv:en;
  let settings={organizationId:'agency',revision:1,language:'en',regionalFormat:null,timeZone:'UTC',demoUnitId:null as string|null,
    syntheticRetentionHours:24,reportMediaAllowanceBytes:52428800,imageMediaLimitBytes:10485760,
    defaultReportMediaAllowanceBytes:52428800,defaultImageMediaLimitBytes:10485760,appearance:DEFAULT_AGENCY_APPEARANCE,
    demographics:{versionId:'version',version:1,catalogReleaseId:'catalog',agencyUniqueStateId:'EMS',agencyNumber:'123',stateCode:'00',stateDisplay:null,stateCodeSystem:'ANSI-STATE',stateTerminologyVersion:null,effectiveFrom:'2026-10-17T00:00:00Z'},storageGrowthWarning:false,updatedAt:'2026-10-17T00:00:00Z'};
  let failUnits=true,saves=0;
  await page.route('**/__settings-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
  await page.route('**/__settings?*',route=>route.fulfill({contentType:'text/html',body:`<html lang="${language}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/__settings-script"></script></body></html>`}));
  await page.route('**/api/admin/agency-settings',route=>{
    if(route.request().method()==='PUT'){
      expect(route.request().headers()['x-csrf-token']).toBe('csrf');
      const command=route.request().postDataJSON();expect(command.expectedRevision).toBe(settings.revision);
      settings={...settings,...command,revision:settings.revision+1};saves++;
    }
    return route.fulfill({json:settings});
  });
  await page.route('**/api/admin/units**',route=>{
    if(failUnits)return route.fulfill({status:503,json:{message:'Unavailable'}});
    const next=new URL(route.request().url()).searchParams.has('cursor');
    return route.fulfill({json:{items:next?[{id:'unit-b',name:'Demo vehicle',callSign:'D2',active:true}]:[{id:'unit-a',name:'Inactive',callSign:'OLD',active:false}],nextCursor:next?null:'unit-a'}});
  });
  await page.goto(`/__settings?language=${language}`);
  const select=page.getByLabel(t('Default unit for Demo users','Standardenhet för Demo-användare'),{exact:true});
  await expect(select).toBeDisabled();
  failUnits=false;await page.getByRole('button',{name:t('Retry loading units','Försök hämta enheter igen')}).click();
  await expect(select).toBeEnabled();
  await expect(select.locator('option')).toHaveCount(2);
  await select.selectOption('unit-b');expect(saves).toBe(0);
  const save=page.getByRole('button',{name:t('Save','Spara'),exact:true});
  await save.click();await expect.poll(()=>saves).toBe(1);await expect(save).toBeDisabled();
  await page.reload();await expect(select).toHaveValue('unit-b');
  await select.scrollIntoViewIfNeeded();await expect(select).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`demo-default-${language}-mobile.png`)});
  await select.selectOption('');await save.click();await expect.poll(()=>saves).toBe(2);
  expect(settings.demoUnitId).toBeNull();
  await page.goto(`/__settings?language=${language}&readonly=1`);await expect(select).toBeDisabled();
});
