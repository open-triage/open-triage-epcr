import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import catalog from '@open-triage/contracts/config/android-releases.json';
import { DEFAULT_AGENCY_APPEARANCE } from '@open-triage/contracts';

let script:string, css:string;
const bytes=Buffer.from('synthetic immutable browser download bytes');
const sha=createHash('sha256').update(bytes).digest('hex');
const descriptor={...catalog.releases[0]!.descriptor,apkSha256:sha,apkBytes:bytes.length,
  artifact:`opentriage-0.1.0-rc.2-2-${sha}.apk`};
const url=`https://github.com/open-triage/open-triage-epcr/releases/download/android-candidate-2-0.1.0-rc.2/${descriptor.artifact}`;
const available={status:'available',tag:'android-candidate-2-0.1.0-rc.2',downloadUrl:url,descriptor};
test.beforeAll(async()=>{
 css=await readFile(path.resolve(__dirname,'../app/styles.css'),'utf8');
 const result=await build({bundle:true,write:false,jsx:'automatic',format:'iife',platform:'browser',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`
  import React from 'react';import{createRoot}from'react-dom/client';import{AgencySettingsPanel}from'./components/agency-settings';import{AdminLanguageContext}from'./app/admin-localization';
  const params=new URLSearchParams(location.search);createRoot(document.getElementById('root')).render(<AdminLanguageContext.Provider value={params.get('language')??'en'}><AgencySettingsPanel csrfToken="csrf" language={params.get('language')??'en'} canWrite={params.get('readonly')!=='1'}/></AdminLanguageContext.Provider>);
 `}});script=result.outputFiles[0]!.text;
});

for(const language of ['en','sv'])test(`${language} read-only Admin downloads immutable APK with version and digest on mobile and desktop`,async({page,context},testInfo)=>{
 const t=(en:string,sv:string)=>language==='sv'?sv:en;
 let state:unknown=available, denied=false, mutations=0;
 const settings={organizationId:'agency',revision:1,language,regionalFormat:null,timeZone:'UTC',demoUnitId:null,syntheticRetentionHours:24,
  reportMediaAllowanceBytes:52428800,imageMediaLimitBytes:10485760,defaultReportMediaAllowanceBytes:52428800,defaultImageMediaLimitBytes:10485760,
  appearance:{...DEFAULT_AGENCY_APPEARANCE,accentColor:'#562d96',accentDarkColor:'#40216f'},demographics:{versionId:'v',version:1,catalogReleaseId:'c',agencyUniqueStateId:'EMS',agencyNumber:'123',stateCode:'00',stateDisplay:null,stateCodeSystem:'ANSI-STATE',stateTerminologyVersion:null,effectiveFrom:'2026-11-11T00:00:00Z'},storageGrowthWarning:false,updatedAt:''};
 await context.route('**/__android-release-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
 await context.route('**/__android-release?*',route=>route.fulfill({contentType:'text/html',body:`<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/__android-release-script"></script></body></html>`}));
 await context.route('**/api/admin/**',route=>{
  const request=route.request();if(request.method()!=='GET')mutations++;
  if(request.url().endsWith('/android/release'))return route.fulfill({status:denied?401:200,json:denied?{code:'auth.sessionRequired'}:state});
  if(request.url().endsWith('/agency-settings'))return route.fulfill({json:settings});
  if(request.url().includes('/units'))return route.fulfill({json:{items:[],nextCursor:null}});
  return route.fulfill({status:404,json:{}});
 });
 await context.route(url,route=>route.fulfill({contentType:'application/vnd.android.package-archive',headers:{'content-disposition':`attachment; filename="${descriptor.artifact}"`},body:bytes}));
 await page.goto(`/__android-release?language=${language}&readonly=1`);
 const section=page.getByRole('region',{name:t('Android application','Android-applikation')});
 const link=section.getByRole('link',{name:t('Download APK','Hämta APK')});
 await expect(link).toHaveAttribute('href',url);await expect(section).toContainText('0.1.0-rc.2 (2)');await expect(section).toContainText(sha);
 await expect(page.getByRole('button',{name:t('Save','Spara'),exact:true})).toHaveCount(0);
 await expect(page.getByLabel(t('Brand text','Varumärkestext'),{exact:true})).toBeDisabled();
 for(const width of [390,1200]){
  await page.setViewportSize({width,height:844});await link.scrollIntoViewIfNeeded();await expect(link).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await link.focus();expect(await link.evaluate(element=>getComputedStyle(element).outlineStyle)).not.toBe('none');
  expect(await link.evaluate(element=>getComputedStyle(element).backgroundColor)).toBe('rgb(86, 45, 150)');
  await page.screenshot({path:testInfo.outputPath(`android-release-${language}-${width}.png`)});
 }
 const downloadPromise=new Promise<import('@playwright/test').Download>(resolve=>{page.once('download',resolve);context.once('page',popup=>popup.once('download',resolve));});
 await link.click();const download=await downloadPromise;
 const file=await download.path();expect(file).not.toBeNull();expect(createHash('sha256').update(await readFile(file!)).digest('hex')).toBe(sha);
 await expect(page).toHaveURL(/__android-release\?/);expect(mutations).toBe(0);
 // A failed verification or withdrawn permission removes the usable download.
 const refresh=section.getByRole('button',{name:t('Refresh release','Uppdatera version')});
 for(const reason of ['not-selected','unverified','incompatible','unavailable']){
  state={status:'unavailable',reason};await refresh.click();await expect(link).toHaveCount(0);await expect(section.getByRole('status')).toBeVisible();
 }
 state=available;await refresh.click();await expect(link).toBeVisible();denied=true;await refresh.click();await expect(link).toHaveCount(0);
});

test('release refresh preserves agency draft and rejects server-supplied foreign artifact locations',async({page})=>{
 let value:unknown=available;
 await page.route('**/__android-release-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
 await page.route('**/__android-release?*',route=>route.fulfill({contentType:'text/html',body:`<html lang="en"><head><style>${css}</style></head><body><div id="root"></div><script src="/__android-release-script"></script></body></html>`}));
 await page.route('**/api/admin/**',route=>{
  if(route.request().url().endsWith('/android/release'))return route.fulfill({json:value});
  if(route.request().url().includes('/units'))return route.fulfill({json:{items:[],nextCursor:null}});
  return route.fulfill({json:{organizationId:'agency',revision:1,language:'en',timeZone:'UTC',syntheticRetentionHours:24,reportMediaAllowanceBytes:52428800,imageMediaLimitBytes:10485760,defaultReportMediaAllowanceBytes:52428800,defaultImageMediaLimitBytes:10485760,appearance:DEFAULT_AGENCY_APPEARANCE,demographics:{versionId:'v',version:1,catalogReleaseId:'c',agencyUniqueStateId:'EMS',agencyNumber:'123',stateCode:'00'},storageGrowthWarning:false}});
 });
 await page.goto('/__android-release?language=en');const brand=page.getByLabel('Brand text',{exact:true});await brand.fill('Unsaved agency draft');
 const section=page.getByRole('region',{name:'Android application'});await expect(section.getByRole('link',{name:'Download APK'})).toBeVisible();
 value={...available,downloadUrl:'https://attacker.invalid/private.apk'};await section.getByRole('button',{name:'Refresh release'}).click();
 await expect(section.getByRole('link',{name:'Download APK'})).toHaveCount(0);await expect(brand).toHaveValue('Unsaved agency draft');
 await expect(page.locator('a[href*="attacker.invalid"]')).toHaveCount(0);await expect(page.locator('input[type="password"]')).toHaveCount(0);
});
