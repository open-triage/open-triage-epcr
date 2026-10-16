import {expect,test} from '@playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {DEFAULT_AGENCY_APPEARANCE} from '@open-triage/contracts';
let script:string,css:string;
test.beforeAll(async()=>{
 css=await readFile(path.resolve(__dirname,'../app/styles.css'),'utf8');
 script=(await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {AgencySettingsPanel} from './components/agency-settings';import {AuthenticationPolicyPanel} from './components/authentication-policy';const q=new URLSearchParams(location.search);createRoot(document.getElementById('root')).render(q.has('providers')?<AuthenticationPolicyPanel language="en" csrfToken="csrf" canWrite/>:<AgencySettingsPanel language={q.get('language')||'en'} csrfToken="csrf" canWrite={!q.has('readonly')}/>);`}})).outputFiles[0]!.text;
});
const policy={groupId:'root',revision:1,maximumSessionHours:12,temporaryPasswordHours:72,accountAttemptsPer15Minutes:20,networkAttemptsPer5Minutes:60};
const initial={organizationId:'child',language:'en',regionalFormat:null,timeZone:'UTC',revision:1,syntheticRetentionHours:24,authenticationLimits:{accountAttemptsPer15Minutes:20,networkAttemptsPer5Minutes:60},authenticationPolicy:policy,reportMediaAllowanceBytes:50*1024*1024,imageMediaLimitBytes:10*1024*1024,defaultReportMediaAllowanceBytes:50*1024*1024,defaultImageMediaLimitBytes:10*1024*1024,storageGrowthWarning:false,updatedAt:new Date().toISOString(),appearance:DEFAULT_AGENCY_APPEARANCE,demographics:{agencyUniqueStateId:'STATE-1',agencyNumber:'AGENCY-1',stateCode:'36',stateDisplay:'New York',stateCodeSystem:'ANSI-STATE',stateTerminologyVersion:null,versionId:'version',version:1,catalogReleaseId:'catalog',effectiveFrom:new Date().toISOString()}};
for(const [language,width] of [['en',1440],['sv',390]] as const)test(`Agency Settings saves inherited policy with its single bottom Save button (${language})`,async({page})=>{
 const sv=language==='sv';await page.setViewportSize({width,height:900});let value=structuredClone(initial),fail=true;
 await page.route('**/__authentication*',route=>route.fulfill({contentType:'text/html',body:`<html lang="${language}"><head><style>${css}</style></head><body><div id="root"></div><script src="/__auth-script"></script></body></html>`}));
 await page.route('**/__auth-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
 await page.route('**/api/sessions/reauthenticate',()=>{throw Error('Admin saves must not request reauthentication');});
 await page.route('**/api/admin/agency-settings',route=>{
  if(route.request().method()==='PUT'){
   expect(route.request().headers()['x-csrf-token']).toBe('csrf');const command=route.request().postDataJSON();
   expect(command.authenticationPolicy).toEqual({expectedRevision:1,maximumSessionHours:8,temporaryPasswordHours:72,accountAttemptsPer15Minutes:20,networkAttemptsPer5Minutes:60});
   if(fail)return route.fulfill({status:409,json:{code:'admin.authenticationPolicyStale'}});
   value={...value,...command,revision:2,authenticationPolicy:{...policy,revision:2,maximumSessionHours:8}};
  }return route.fulfill({json:value});
 });
 await page.goto(`/__authentication?language=${language}`);
 const sessionHours=page.getByLabel(sv?'Maximal sessionslängd (timmar)':'Maximum session duration (hours)');await sessionHours.fill('8');
 const form=page.locator('form');await expect(form).toHaveCount(1);await expect(page.locator('input[autocomplete="current-password"]')).toHaveCount(0);
 const save=page.getByRole('button',{name:sv?'Spara':'Save',exact:true});await expect(form.locator('button[type="submit"]')).toHaveCount(1);
 await save.scrollIntoViewIfNeeded();const policyBox=await page.getByRole('group',{name:sv?'Effektiv gruppolicy':'Effective group policy',exact:true}).boundingBox();const saveBox=await save.boundingBox();expect(saveBox).not.toBeNull();expect(policyBox!.y+policyBox!.height).toBeLessThanOrEqual(saveBox!.y);
 // The policy fields and the Save button belong to the same form, with Save after them.
 expect(await sessionHours.evaluate(input=>Boolean(input.closest('form')?.querySelector('button[type="submit"]')))).toBe(true);
 expect(policyBox).not.toBeNull();await save.click();await expect(page.getByRole('alert')).toBeVisible();await expect(sessionHours).toHaveValue('8');
 fail=false;await save.click();await expect(page.getByRole('status')).toContainText(sv?'sparats':'saved');await expect(save).toBeDisabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`/tmp/agency-settings-policy-${language}-${width}.png`,fullPage:true});
});
test('inherited policy is read-only with read-only Agency Settings',async({page})=>{
 await page.route('**/__authentication*',route=>route.fulfill({contentType:'text/html',body:'<html lang="en"><body><div id="root"></div><script src="/__auth-script"></script></body></html>'}));await page.route('**/__auth-script',route=>route.fulfill({contentType:'text/javascript',body:script}));await page.route('**/api/admin/agency-settings',route=>route.fulfill({json:initial}));
 await page.goto('/__authentication?readonly=1');await expect(page.getByLabel('Maximum session duration (hours)')).toBeDisabled();await expect(page.getByRole('button',{name:'Save',exact:true})).toHaveCount(0);
});

test("Authentication keeps provider controls without group policy or rollout controls", async ({page}) => {
  await page.route("**/__authentication?*", route => route.fulfill({contentType:"text/html", body:`<html lang="en"><head><style>${css}</style></head><body><div id="root"></div><script src="/__auth-script"></script></body></html>`}));
  await page.route("**/__auth-script", route => route.fulfill({contentType:"text/javascript",body:script}));
  await page.route("**/api/admin/authentication/oidc", route => route.fulfill({json:{groupId:"root",draft:null,active:null,registration:{hosts:[],requiredClaims:["sub"]},history:[]}}));
  await page.route("**/api/admin/authentication/workflow?*", route => route.fulfill({json:{groupId:"root",state:"enabled",revision:2,canEnable:false,providerReady:true,totalUnits:0,offset:0,missingSchedules:0,unenrolledUnits:0,units:[]}}));
  await page.goto("/__authentication?providers=1");
  await expect(page.getByRole("heading", {name:"Authentication",exact:true})).toBeVisible();
  await expect(page.getByRole("heading", {name:"OIDC provider draft",exact:true})).toBeVisible();
  await expect(page.locator(".production-workflow")).toHaveCount(0);
  await expect(page.getByRole("group", {name:"Effective group policy",exact:true})).toHaveCount(0);
  await expect(page.getByLabel("Maximum session duration (hours)")).toHaveCount(0);
});
