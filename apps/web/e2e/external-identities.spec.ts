import {expect,test} from '@playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
let script:string,css:string;
test.beforeAll(async()=>{
 css=await readFile(path.resolve(__dirname,'../app/styles.css'),'utf8');
 const result=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {UsersPanel} from './components/admin-directory';import {AdminLanguageContext} from './app/admin-localization';createRoot(document.getElementById('root')).render(<AdminLanguageContext.Provider value={document.documentElement.lang}><UsersPanel canReviewExternal canManageExternal={!location.search.includes('readonly')} csrfToken="csrf"/></AdminLanguageContext.Provider>);`}});script=result.outputFiles[0]!.text;
});
const id='91000000-0000-4000-8000-000000000001',userId='91000000-0000-4000-8000-000000000002';
const identity={id,providerId:'91000000-0000-4000-8000-000000000003',revision:1,reviewRevision:1,deniedAt:null,issuer:'https://provider.example/Issuer',subject:'ExactCaseSubject',displayName:'<img src=x onerror=alert(1)>',email:'same@example.org',createdAt:new Date().toISOString(),status:'pending',reviewProviders:[{source:'draft',revision:1}],linkedUserId:null};
const pending={id,displayName:identity.displayName,username:null,active:false,revision:1,roles:[],externalIdentity:identity};
async function mount(page:import('@playwright/test').Page,language='en'){
 await page.route('**/__identities*',route=>route.fulfill({contentType:'text/html',body:`<html lang="${language}"><head><style>${css}</style></head><body style="--green:#315ba8;--text-color:#202850"><div class="agency-settings" id="root"></div><script src="/__identity-script"></script></body></html>`}));
 await page.route('**/__identity-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
 await page.route('**/api/admin/user-role-options',route=>route.fulfill({json:{items:[]}}));
 page.on('dialog',dialog=>dialog.accept());
 await page.route('**/api/sessions/reauthenticate',route=>{expect(route.request().headers()['x-csrf-token']).toBe('csrf');return route.fulfill({json:{reauthenticatedUntil:new Date(Date.now()+300000).toISOString()}});});
}
for(const width of [390,1440])test(`Users Manage links an explicitly selected account and retains choices after a conflict at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await mount(page);let linked=false,conflict=true;
 await page.route('**/api/admin/users?*',route=>{
  const params=new URL(route.request().url()).searchParams,state=params.get('state');
  if(state==='active'){
   expect(params.has('search')).toBe(false);
   return route.fulfill({json:params.has('cursor')?{items:[{id:userId,displayName:'Existing clinician',username:'medic',owner:false,superadmin:false}],nextCursor:null}:{items:[{id:'91000000-0000-4000-8000-000000000004',displayName:'Protected owner',username:'owner',owner:true,superadmin:true}],nextCursor:'next-users'}});
  }
  return route.fulfill({json:{items:linked?[{id:userId,displayName:'Existing clinician',username:'medic',active:true,revision:1,roles:[]}]:[pending],nextCursor:null}});
 });
 await page.route(`**/api/admin/authentication/identities/${id}/link`,route=>{
  expect(route.request().headers()['x-csrf-token']).toBe('csrf');expect(route.request().postDataJSON()).toEqual({userId,providerSource:'draft',expectedProviderRevision:1,expectedReviewRevision:1});
  if(!conflict)linked=true;return conflict?route.fulfill({status:409,json:{code:'admin.externalIdentityConflict'}}):route.fulfill({json:{...identity,status:'linked',linkedUserId:userId,reviewRevision:2}});
 });
 await page.goto('/__identities');await expect(page.getByRole('cell',{name:identity.email,exact:false})).toBeVisible();await expect(page.locator('img')).toHaveCount(0);
 const manage=page.getByRole('button',{name:'Manage',exact:true});await manage.focus();await page.keyboard.press('Enter');const editor=page.locator('.admin-user-management');await expect(editor.locator('input[autocomplete="current-password"]')).toHaveCount(0);
 await expect(editor.getByText('Profile names and emails are untrusted hints',{exact:false})).toBeVisible();
 await editor.getByRole('button',{name:'Link to an existing user',exact:true}).click();await expect(editor.getByLabel('Existing application user')).toHaveValue('');await expect(editor.getByRole('option',{name:/Protected owner/})).toHaveCount(0);
 await expect(editor.getByRole('searchbox')).toHaveCount(0);await expect(editor.getByRole('button',{name:/^(Search users|More users)$/})).toHaveCount(0);
 await expect(editor.getByRole('option',{name:'Existing clinician (medic)',exact:true})).toHaveCount(1);
 await page.screenshot({path:`/tmp/user-identity-dropdown-${width}.png`,fullPage:true});
 await expect(editor.getByRole('button',{name:'Link existing user',exact:true})).toBeDisabled();
 await editor.getByLabel('Existing application user').selectOption(userId);const submit=editor.getByRole('button',{name:'Link existing user',exact:true});await submit.click();
 await expect(editor.getByRole('alert')).toContainText('already linked or its provider changed');await expect(editor.getByLabel('Existing application user')).toHaveValue(userId);
 conflict=false;await editor.getByRole('button',{name:'Link existing user',exact:true}).click();await expect(editor).toHaveCount(0);
 await expect(page.getByRole('status')).toContainText('User roles and history are preserved');await expect(page.locator('tbody tr')).toHaveCount(1);await expect(page.locator('tbody tr')).toContainText('Existing clinician');await expect(page.getByRole('heading',{name:'Users',exact:true})).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:`/tmp/user-identity-manage-${width}.png`,fullPage:true});
});
for(const width of [390,1440])test(`Users Manage denies a request with an explicit review revision and supports the Denied filter at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await mount(page);let denied=false;
 await page.route('**/api/admin/users?*',route=>{const state=new URL(route.request().url()).searchParams.get('state');return route.fulfill({json:{items:state==='pending'&&denied?[]:[{...pending,externalIdentity:{...identity,status:denied?'denied':'pending',reviewRevision:denied?2:1,deniedAt:denied?new Date().toISOString():null}}],nextCursor:null}});});
 await page.route(`**/api/admin/authentication/identities/${id}/deny`,route=>{expect(route.request().postDataJSON()).toEqual({expectedReviewRevision:1,note:'Not an approved staff member'});denied=true;return route.fulfill({json:{...identity,status:'denied',reviewRevision:2}});});
 await page.goto('/__identities');await page.getByRole('button',{name:'Manage',exact:true}).click();const editor=page.locator('.admin-user-management');await expect(editor.locator('input[autocomplete="current-password"]')).toHaveCount(0);await editor.getByRole('button',{name:'Deny request',exact:true}).first().click();
 await editor.getByLabel('Note (optional)').fill('Not an approved staff member');const submit=editor.getByRole('button',{name:'Deny request',exact:true}).last();await submit.click();await expect(editor).toHaveCount(0);
 await expect(page.getByRole('cell',{name:'Denied',exact:true})).toBeVisible();await expect(page.getByRole('status')).toContainText('No user or application session was created');
 await page.locator('select[name="state"]').selectOption('pending');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await expect(page.locator('tbody tr')).toHaveCount(0);
 await page.locator('select[name="state"]').selectOption('denied');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await page.getByRole('button',{name:'Manage',exact:true}).click();await expect(editor).toContainText('A new sign-in does not undo the decision');await expect(editor.getByRole('button',{name:'Deny request',exact:true})).toBeDisabled();
});
test('Swedish read-only Users Manage shows the identity without mutation or password controls',async({page})=>{
 await mount(page,'sv');await page.route('**/api/admin/users?*',route=>route.fulfill({json:{items:[pending],nextCursor:null}}));
 await page.goto('/__identities?readonly');await expect(page.getByRole('heading',{name:'Användare',exact:true})).toBeVisible();await expect(page.getByRole('cell',{name:'Väntande',exact:true})).toBeVisible();await page.getByRole('button',{name:'Hantera',exact:true}).click();
 await expect(page.locator('.admin-user-management')).toContainText('Skrivbehörighet för användare och autentisering krävs');await expect(page.locator('input[type="password"]')).toHaveCount(0);await page.getByRole('button',{name:'Stäng',exact:true}).click();await expect(page.locator('.admin-user-management')).toHaveCount(0);
});
for(const changed of [false,true])test(`identity review completion ${changed?'is ignored after an installation change':'updates Users in the current installation'}`,async({page})=>{
 await mount(page);await page.route('**/api/admin/users?*',route=>route.fulfill({json:{items:[pending],nextCursor:null}}));
 await page.addInitScript(()=>{const original=window.fetch;window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).endsWith('/deny')){const json=response.json.bind(response);response.json=async()=>{(window as unknown as {reviewJsonWaiting?:boolean;releaseReviewJson?:()=>void}).reviewJsonWaiting=true;await new Promise<void>(resolve=>(window as unknown as {reviewJsonWaiting?:boolean;releaseReviewJson?:()=>void}).releaseReviewJson=resolve);return json();};}return response;};});
 await page.route(`**/api/admin/authentication/identities/${id}/deny`,route=>route.fulfill({json:{...identity,status:'denied',reviewRevision:2}}));
 await page.goto('/__identities');await page.getByRole('button',{name:'Manage',exact:true}).click();const editor=page.locator('.admin-user-management');await expect(editor.locator('input[autocomplete="current-password"]')).toHaveCount(0);await editor.getByRole('button',{name:'Deny request',exact:true}).first().click();await editor.getByRole('button',{name:'Deny request',exact:true}).last().click();
 await page.waitForFunction(()=>(window as unknown as {reviewJsonWaiting?:boolean;releaseReviewJson?:()=>void}).reviewJsonWaiting);await expect(editor.getByRole('button',{name:'Close',exact:true})).toBeDisabled();
 await page.evaluate(changed=>{if(changed)localStorage.setItem('open-triage.installation-generation.v1','new-installation');(window as unknown as {reviewJsonWaiting?:boolean;releaseReviewJson?:()=>void}).releaseReviewJson!();},changed);
 if(changed){await expect(editor).toBeVisible();await expect(page.getByText('External identity request denied.',{exact:false})).toHaveCount(0);}
 else {await expect(editor).toHaveCount(0);await expect(page.getByRole('status')).toContainText('External identity request denied.');}
});
