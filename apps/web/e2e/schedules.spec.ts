import { expect,test } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
let script:string,css:string;
test.beforeAll(async()=>{
 css=await readFile(path.resolve(__dirname,'../app/styles.css'),'utf8');
 const result=await build({bundle:true,write:false,jsx:'automatic',format:'iife',platform:'browser',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},
  stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {AdminShell} from './components/admin-shell';createRoot(document.getElementById('root')).render(<AdminShell language={new URLSearchParams(location.search).get('language')} session={{user:{id:'admin',displayName:'Admin'},organization:{id:'agency',name:'EMS'},startedAt:'2026-10-13T12:00:00Z',expiresAt:'2099-01-01T00:00:00Z',csrfToken:'csrf',capabilities:['settings:read','settings:write']}}/>);`}});
 script=result.outputFiles[0]!.text;
});
for(const language of ['en','sv'])test(`${language} schedules author blank/weekly drafts and unit server previews on desktop/mobile`,async({page},testInfo)=>{
 const t=(en:string,sv:string)=>language==='sv'?sv:en;
 // Preview copy also occurs in explanatory prose. Require the live status so
 // asynchronous responses cannot pass early or become ambiguous in Swedish.
 const effectivePreview=page.getByRole('status').filter({hasText:t('Will become effective at','Börjar gälla')});
 const scheduleId='40000000-0000-4000-8000-000000000001',unitId='30000000-0000-4000-8000-000000000001';
 let schedules:Array<{id:string;name:string;groupId:string;revision:number;versions:Array<{revision:number;effectiveAt:string;breakpoints:Array<{weekday:number;time:string;graceMinutes:number}>}>}>=[];
 let fail=false;
 let preview={unitId,timeZone:'Europe/Stockholm',evaluatedAt:'2026-10-13T04:00:00Z',selectionRevision:0,scheduleId:null as string|null,scheduleName:null as string|null,effectiveAt:null as string|null,pending:null,state:'missing',activeCheckpoint:null,nextCheckpoint:null as {at:string;graceStartsAt:string;revision:number}|null,graceCheckpoints:[]};
 await page.route('**/__schedule-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
 await page.route('**/__schedules?*',route=>route.fulfill({contentType:'text/html',body:`<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="--green:#663399;--green-dark:#442266"><div id="root"></div><script src="/__schedule-script"></script></body></html>`}));
 await page.route('**/api/admin/context',route=>route.fulfill({json:{organization:{id:'agency',name:'EMS'},panels:['schedules','units'],capabilities:['settings:read','settings:write'],dashboard:null,activeConfiguration:null}}));
 await page.route('**/api/admin/schedules**',async route=>{
  if(route.request().method()==='GET')return route.fulfill(fail?{status:503,json:{message:'Unavailable'}}:{json:{items:schedules}});
  expect(route.request().headers()['x-csrf-token']).toBe('csrf');const body=route.request().postDataJSON();
  if(route.request().url().endsWith('/preview'))return route.fulfill({json:{effectiveAt:'2026-10-14T05:00:00Z',evaluatedAt:preview.evaluatedAt,previewToken:'schedule-preview'}});
  expect(body.previewToken).toBe('schedule-preview');
  const revision=schedules.length?schedules[0]!.revision+1:1;
  if(revision>1)expect(body.expectedRevision).toBe(revision-1);
  schedules=[{id:scheduleId,groupId:'agency',name:body.name,revision,versions:[...(schedules[0]?.versions??[]),{revision,effectiveAt:'2026-10-14T05:00:00Z',breakpoints:body.breakpoints}]}];
  return route.fulfill({json:schedules[0]});
 });
 await page.route('**/api/admin/units',route=>route.fulfill({json:{items:[{id:unitId,organizationId:'agency',name:'Medic 7',callSign:'MEDIC-7',active:true,revision:1}],nextCursor:null}}));
 await page.route(`**/api/admin/units/${unitId}/schedule/preview`,route=>route.fulfill({json:{effectiveAt:preview.evaluatedAt,evaluatedAt:preview.evaluatedAt,previewToken:'unit-preview'}}));
 await page.route(`**/api/admin/units/${unitId}/schedule`,route=>{
  if(route.request().method()==='PUT'){
   expect(route.request().headers()['x-csrf-token']).toBe('csrf');const body=route.request().postDataJSON();expect(body.previewToken).toBe('unit-preview');expect(body.expectedRevision).toBe(preview.selectionRevision);
   const blank=!schedules[0]!.versions.at(-1)!.breakpoints.length;
   preview={...preview,selectionRevision:preview.selectionRevision+1,scheduleId:body.scheduleId,scheduleName:schedules[0]!.name,effectiveAt:preview.evaluatedAt,state:blank?'blank':'scheduled',nextCheckpoint:blank?null:{at:'2026-10-14T05:00:00Z',graceStartsAt:'2026-10-14T04:45:00Z',revision:2}};
  }
  return route.fulfill({json:preview});
 });
 await page.goto(`/__schedules?language=${language}`);
 await page.getByRole('button',{name:t('Shift schedules','Passcheman'),exact:true}).click();
 const create=page.getByRole('button',{name:t('Create schedule','Skapa schema'),exact:true});await create.focus();await create.press('Enter');
 await page.getByLabel(t('Schedule name','Schemanamn'),{exact:true}).fill('No handovers');
 await page.getByRole('button',{name:t('Preview effective time','Förhandsvisa ikraftträdande'),exact:true}).click();
 await expect(effectivePreview).toBeVisible();
 await expect(page.locator('section:visible time')).toHaveAttribute('datetime','2026-10-14T05:00:00Z');
 await page.getByRole('button',{name:t('Save','Spara'),exact:true}).click();await expect(create).toBeFocused();
 await expect(page.getByRole('cell',{name:t('Blank schedule','Tomt schema'),exact:true})).toBeVisible();
 const units=page.getByRole('button',{name:t('Units','Enheter'),exact:true});await units.click();
 const scheduleButton=page.getByRole('button',{name:t('Schedule Medic 7','Schema Medic 7'),exact:true});await scheduleButton.click();
 await expect(page.getByRole('status').first()).toContainText(t('No schedule selected','Inget schema valt'));
 await page.getByLabel(t('Selected schedule','Valt schema'),{exact:true}).selectOption(scheduleId);await page.getByRole('button',{name:t('Preview effective time','Förhandsvisa ikraftträdande')}).click();await expect(effectivePreview).toBeVisible();await page.getByRole('button',{name:t('Save selection','Spara val')}).click();
 await expect(page.getByRole('status').first()).toContainText(t('Blank schedule','Tomt schema'));
 await page.getByRole('button',{name:t('Back to units','Tillbaka till enheter')}).click();await expect(scheduleButton).toBeFocused();
 await page.getByRole('button',{name:t('Shift schedules','Passcheman'),exact:true}).click();
 await page.getByRole('button',{name:t('Edit No handovers','Redigera No handovers'),exact:true}).click();
 await page.getByLabel(t('Schedule name','Schemanamn'),{exact:true}).fill('Morning');await page.getByRole('button',{name:t('Add breakpoint','Lägg till brytpunkt')}).click();
 const time=page.getByLabel(t('Time 1','Tid 1'),{exact:true});await expect(time).toHaveValue('');await time.fill('07:00');
 await page.getByLabel(t('Grace (minutes) 1','Frist (minuter) 1'),{exact:true}).fill('15');
 await units.click();await page.getByRole('button',{name:t('Shift schedules','Passcheman'),exact:true}).click();await expect(time).toHaveValue('07:00');
 for(const width of [1280,360]){
  await page.setViewportSize({width,height:800});await page.getByRole('button',{name:t('Preview effective time','Förhandsvisa ikraftträdande'),exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath(`schedules-${language}-${width}.png`)});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await page.getByRole('button',{name:t('Preview effective time','Förhandsvisa ikraftträdande'),exact:true}).click();
 await expect(effectivePreview).toBeVisible();
 await expect(page.locator('section:visible time')).toHaveAttribute('datetime','2026-10-14T05:00:00Z');
 await page.getByRole('button',{name:t('Save','Spara'),exact:true}).click();await expect(page.getByRole('cell',{name:'Morning',exact:true})).toBeVisible();
 await units.click();await scheduleButton.click();await page.getByLabel(t('Selected schedule','Valt schema'),{exact:true}).selectOption('');await page.getByLabel(t('Selected schedule','Valt schema'),{exact:true}).selectOption(scheduleId);
 await page.getByRole('button',{name:t('Preview effective time','Förhandsvisa ikraftträdande')}).click();await expect(effectivePreview).toBeVisible();await page.getByRole('button',{name:t('Save selection','Spara val')}).click();
 await expect(page.getByText(t('Next handover','Nästa överlämning'),{exact:true})).toBeVisible();await expect(page.locator('section:visible time[datetime="2026-10-14T05:00:00Z"]')).toContainText('07:00');
 await page.getByRole('button',{name:t('Back to units','Tillbaka till enheter')}).click();await page.getByRole('button',{name:t('Shift schedules','Passcheman'),exact:true}).click();
 fail=true;await page.getByRole('button',{name:t('Refresh','Uppdatera'),exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('cell',{name:'Morning',exact:true})).toBeVisible();
});
