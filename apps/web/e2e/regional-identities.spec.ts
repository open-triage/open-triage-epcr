import {expect,test} from '@playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
let script:string,css:string;
test.beforeAll(async()=>{
 css=await readFile(path.resolve(__dirname,'../app/styles.css'),'utf8');
 const result=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {RegionalIdentitiesPanel} from './components/regional-identities';createRoot(document.getElementById('root')).render(<RegionalIdentitiesPanel language={document.documentElement.lang} csrfToken="csrf" canLink={!location.search.includes('readonly')}/>);`}});script=result.outputFiles[0]!.text;
});
const id='91000000-0000-4000-8000-000000000001',userId='91000000-0000-4000-8000-000000000002';
const item={id,providerId:'91000000-0000-4000-8000-000000000003',revision:1,issuer:'https://provider.example/Issuer',subject:'ExactCaseSubject',displayName:'<img src=x onerror=alert(1)>',email:'same@example.org',createdAt:new Date().toISOString(),status:'pending',linkedUserId:null};
for(const width of [390,1440])test(`explicit identity review escapes profile hints, handles conflicts and preserves immutable user selection at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.route('**/__identities*',route=>route.fulfill({contentType:'text/html',body:`<html lang="en"><head><style>${css}</style></head><body style="--green:#315ba8;--text-color:#202850"><div class="agency-settings" id="root"></div><script src="/__identity-script"></script></body></html>`}));
 await page.route('**/__identity-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
 let refreshFails=false,conflict=true,reauthenticated=false;
 const rows=Array.from({length:25},(_,index)=>({...item,id:index===0?id:`91000000-0000-4000-8000-${String(index+10).padStart(12,'0')}`,subject:index===0?item.subject:`subject-${index}`,displayName:index===0?item.displayName:`Fictional staff ${index}`}));
 await page.route('**/api/admin/authentication/identities',route=>refreshFails?route.fulfill({status:503,json:{code:'admin.http503'}}):route.fulfill({json:{items:rows,nextCursor:rows.at(-1)!.id}}));
 await page.route('**/api/admin/users?*',route=>{expect(route.request().url()).toContain('state=active');return route.fulfill({json:{items:[{id:userId,displayName:'Existing clinician',username:'medic',owner:false,superadmin:false},{id:'91000000-0000-4000-8000-000000000004',displayName:'Protected owner',username:'owner',owner:true,superadmin:true}],nextCursor:null}});});
 await page.route('**/api/sessions/reauthenticate',route=>{expect(route.request().headers()['x-csrf-token']).toBe('csrf');reauthenticated=true;return route.fulfill({json:{reauthenticatedUntil:new Date(Date.now()+300000).toISOString()}});});
 await page.route(`**/api/admin/authentication/identities/${id}/link`,route=>{
  expect(reauthenticated).toBe(true);expect(route.request().headers()['x-csrf-token']).toBe('csrf');expect(route.request().postDataJSON()).toEqual({userId});
  return conflict?route.fulfill({status:409,json:{code:'admin.regionalIdentityConflict'}}):route.fulfill({json:{...item,status:'linked',linkedUserId:userId}});
 });
 await page.goto('/__identities');await expect(page.getByRole('cell',{name:item.email,exact:false}).first()).toBeVisible();
 await expect(page.locator('img')).toHaveCount(0);await expect(page.getByText('Profile names and emails are untrusted hints',{exact:false})).toBeVisible();
 if(width===1440){const box=await page.locator('.admin-table-scroll').boundingBox();expect(box!.height).toBeLessThan(650);await expect(page.getByRole('button',{name:'Next page',exact:true})).toBeInViewport();}
 refreshFails=true;await page.getByRole('button',{name:'Refresh requests'}).click();await expect(page.getByRole('alert')).toContainText('Previously loaded results are retained');await expect(page.locator('tbody tr')).toHaveCount(25);
 const review=page.getByRole('button',{name:`Review ${item.displayName}`,exact:true});await review.focus();await page.keyboard.press('Enter');
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await expect(dialog.getByLabel('Existing application user')).toHaveValue('');await expect(dialog.getByRole('option',{name:/Protected owner/})).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:'Link existing user'})).toBeDisabled();
 await dialog.getByLabel('Existing application user').selectOption(userId);await dialog.getByLabel('Your password to link identity').fill('Personal password 42!');await dialog.getByRole('button',{name:'Link existing user'}).click();
 await expect(dialog.getByRole('alert')).toContainText('already linked or its provider changed');await expect(dialog.getByLabel('Existing application user')).toHaveValue(userId);await expect(dialog.getByLabel('Your password to link identity')).toHaveValue('');
 conflict=false;await dialog.getByLabel('Your password to link identity').fill('Personal password 42!');await dialog.getByRole('button',{name:'Link existing user'}).click();await expect(dialog).toHaveCount(0);
 await expect(page.getByRole('status')).toContainText('User roles and history are preserved');await expect(page.locator('tbody tr').first()).toContainText('Linked');await expect(review).toBeFocused();
 await review.click();await expect(page.getByRole('dialog')).toContainText(`Linked to existing user: ${userId}`);await expect(page.getByRole('dialog').getByRole('button',{name:'Link existing user'})).toHaveCount(0);await page.getByRole('button',{name:'Close review'}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:`/tmp/auth007-identities-${width}.png`,fullPage:true});
});
test('Swedish read-only identity review is bounded and does not expose linking controls',async({page})=>{
 await page.route('**/__identities*',route=>route.fulfill({contentType:'text/html',body:`<html lang="sv"><head><style>${css}</style></head><body><div class="agency-settings" id="root"></div><script src="/__identity-script"></script></body></html>`}));
 await page.route('**/__identity-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
 await page.route('**/api/admin/authentication/identities',route=>route.fulfill({json:{items:[item],nextCursor:null}}));await page.route('**/api/admin/users?*',route=>route.fulfill({json:{items:[],nextCursor:null}}));
 await page.goto('/__identities?readonly');await expect(page.getByRole('heading',{name:'Regionala identitetsförfrågningar'})).toBeVisible();await expect(page.getByRole('cell',{name:'Väntande',exact:true})).toBeVisible();await page.getByRole('button',{name:`Granska ${item.displayName}`}).click();
 await expect(page.getByRole('dialog')).toContainText('Skrivbehörighet för användare och autentisering krävs');await expect(page.locator('input[type="password"]')).toHaveCount(0);await page.getByRole('button',{name:'Stäng granskning'}).click();
});
