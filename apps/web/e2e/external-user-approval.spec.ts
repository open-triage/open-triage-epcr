import {expect,test,type Page} from '@playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
let script:string,css:string;
const requestId='92000000-0000-4000-8000-000000000001',ssoId='92000000-0000-4000-8000-000000000002',localId='92000000-0000-4000-8000-000000000003',roleId='92000000-0000-4000-8000-000000000004';
const role={id:roleId,displayName:'Fictional clinician',active:true,protected:true,assignmentMutable:true};
const identity={id:requestId,providerId:localId,revision:1,reviewRevision:1,deniedAt:null,issuer:'https://provider.example/ExactIssuer',subject:'ExactSubject',displayName:'Provider hint',email:'same@example.org',createdAt:new Date().toISOString(),status:'pending',linkedUserId:null,reviewProviders:[{source:'draft',revision:2},{source:'active',revision:1}]};
test.beforeAll(async()=>{
 css=await readFile(path.resolve(__dirname,'../app/styles.css'),'utf8');
 const result=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {UsersPanel} from './components/admin-directory';import {AdminLanguageContext} from './app/admin-localization';const language=document.documentElement.lang;createRoot(document.getElementById('root')).render(<AdminLanguageContext.Provider value={language}><UsersPanel canManage canReviewExternal canManageExternal canAssignRoles canViewSessions canRevokeSessions canResetCredentials csrfToken="csrf"/></AdminLanguageContext.Provider>);`}});script=result.outputFiles[0]!.text;
});
async function mount(page:Page,language:string,width:number){
 await page.setViewportSize({width,height:844});
 await page.route('**/__approval-*',route=>route.fulfill({contentType:'text/html',body:`<html lang="${language}"><head><style>${css}</style></head><body style="--green:#315ba8;--green-dark:#254582;--text-color:#202850"><div class="agency-settings" id="root"></div><script src="/__approval-script.js"></script></body></html>`}));
 await page.route('**/__approval-script.js',route=>route.fulfill({contentType:'text/javascript',body:script}));
 await page.route('**/api/admin/user-role-options',route=>route.fulfill({json:{items:[role,{...role,id:requestId,displayName:'Unavailable stronger role',assignmentMutable:false}]}}));
 page.on('dialog',dialog=>dialog.accept());
}
for(const [language,width] of [['en',1440],['sv',390]] as const){
 const sv=language==='sv',name=sv?'Ny SSO-kliniker':'New SSO clinician';
 test(`explicit external identity approval preserves role/profile choices on conflict and creates no password (${language}, ${width}px)`,async({page})=>{
  await mount(page,language,width);let conflict=true,authenticated=false,body:Record<string,unknown>|undefined;
  let approved=false;
  await page.route('**/api/admin/users?*',route=>route.fulfill({json:{items:approved?[{id:ssoId,displayName:name,username:null,active:true,revision:1,roles:[role]}]:[{id:requestId,displayName:identity.displayName,username:null,active:false,revision:1,roles:[],externalIdentity:identity}],nextCursor:null}}));
  await page.route('**/api/sessions/reauthenticate',route=>{authenticated=true;expect(route.request().headers()['x-csrf-token']).toBe('csrf');return route.fulfill({json:{reauthenticatedUntil:new Date(Date.now()+300000).toISOString()}});});
  await page.route(`**/api/admin/authentication/identities/${requestId}/approve`,route=>{
   expect(authenticated).toBe(false);body=route.request().postDataJSON();expect(body).toEqual({displayName:name,roleIds:[roleId],providerSource:'draft',expectedProviderRevision:2,expectedReviewRevision:1,note:''});expect(route.request().headers()['x-csrf-token']).toBe('csrf');
   if(!conflict)approved=true;
   return conflict?route.fulfill({status:409,json:{code:'admin.externalIdentityConflict'}}):route.fulfill({json:{...identity,status:'linked',linkedUserId:ssoId}});
  });
  await page.goto('/__approval-review');const review=page.getByRole('button',{name:sv?'Hantera':'Manage',exact:true});await review.focus();await page.keyboard.press('Enter');const dialog=page.locator('.admin-user-management');
  await dialog.getByRole('button',{name:sv?'Skapa SSO-användare':'Create an SSO user'}).click();
  await expect(dialog.getByLabel(sv?'Visningsnamn':'Display name',{exact:true})).toHaveValue(identity.displayName);
  await expect(dialog.getByRole('button',{name:sv?'Godkänn ny användare':'Approve new user',exact:true})).toBeEnabled();
  await dialog.getByLabel(sv?'Visningsnamn':'Display name',{exact:true}).fill(name);
  await dialog.getByLabel(sv?'Leverantörsunderlag att godkänna':'Provider evidence to approve').selectOption('draft');
  await expect(dialog.getByRole('option',{name:/Draft test|Utkasttest/})).toContainText(sv?'aktiverar inte organisationsinloggning':'does not enable organization sign-in');
  await dialog.getByLabel('Fictional clinician',{exact:true}).check();await expect(dialog.getByLabel('Unavailable stronger role')).toBeDisabled();

  await page.screenshot({path:`/tmp/auth008-approval-dialog-${language}.png`,fullPage:true});
  const submit=dialog.getByRole('button',{name:sv?'Godkänn ny användare':'Approve new user',exact:true});await submit.scrollIntoViewIfNeeded();

  await page.screenshot({path:`/tmp/auth008-approval-dialog-${language}.png`,fullPage:true});await submit.click();
  await expect(dialog.getByRole('alert')).toBeVisible();await expect(dialog.getByLabel(sv?'Visningsnamn':'Display name',{exact:true})).toHaveValue(name);await expect(dialog.getByLabel('Fictional clinician',{exact:true})).toBeChecked();
  conflict=false;await submit.click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('status')).toContainText(sv?'utan lokalt lösenord':'no local password');await expect(page.getByRole('heading',{name:sv?'Användare':'Users',exact:true})).toBeFocused();expect(body).toBeDefined();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:`/tmp/auth008-approval-${language}.png`,fullPage:true});
 });
 test(`local and SSO-only accounts share directory, roles, lifecycle and sessions (${language}, ${width}px)`,async({page})=>{
  await mount(page,language,width);
  const users=[{id:ssoId,displayName:'SSO clinician',username:null,ssoUsername:'alice.provider',active:true,revision:1,roles:[role]},{id:localId,displayName:'Local clinician',username:'local.medic',active:true,revision:1,roles:[role]}];
  const sessions=new Map(users.map(user=>[user.id,[{id:requestId,startedAt:new Date().toISOString(),lastActivityAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),deviceLabel:'Fictional browser',current:false,owner:false}]]));
  await page.route('**/api/admin/users**',async route=>{
   const url=new URL(route.request().url()),user=users.find(candidate=>url.pathname.includes(candidate.id));
   if(!user)return route.fulfill({json:{items:users,nextCursor:null,pageSize:50}});
   if(url.pathname.endsWith('/roles')){const command=route.request().postDataJSON();expect(command).toEqual({expectedRevision:user.revision,roleIds:[]});user.revision++;user.roles=[];return route.fulfill({json:{...user,addedRoles:[],removedRoles:[role]}});}
   if(url.pathname.includes('/sessions')){if(route.request().method()==='DELETE'){sessions.set(user.id,[]);return route.fulfill({json:{sessionId:requestId,revoked:true,alreadyRevoked:false,currentSessionRevoked:false}});}return route.fulfill({json:{userId:user.id,items:sessions.get(user.id)}});}
   if(route.request().method()==='PUT'){const command=route.request().postDataJSON();expect(command.username).toBe(user.username);expect(typeof command.active).toBe('boolean');user.revision++;user.active=command.active;user.displayName=command.displayName;return route.fulfill({json:{...user,restoredRoles:[],sessionsRevoked:0,freshLoginRequired:true}});}
   throw new Error(`Unexpected user request ${url.pathname}`);
  });
  await page.goto('/__approval-directory');await page.locator('.admin-directory-filters select[name="state"]').selectOption('all');await page.locator('.admin-directory-filters button[type="submit"]').click();await expect(page.getByRole('cell',{name:'alice.provider',exact:true})).toBeVisible();
  for(const user of users){
   const row=page.getByRole('row').filter({has:page.getByRole('rowheader',{name:user.displayName,exact:true})});await row.getByRole('button',{name:sv?'Hantera':'Manage',exact:true}).click();
   const editor=page.locator('.admin-user-management');await expect(editor.locator('input[autocomplete="current-password"]')).toHaveCount(0);await expect(editor.getByText('Fictional browser',{exact:true})).toBeVisible();
   if(user.username===null){await expect(editor.locator('input[name="username"]')).toHaveCount(0);await expect(editor.getByLabel(sv?'SSO-användarnamn':'SSO username',{exact:true})).toHaveValue('alice.provider');await expect(editor.getByLabel(sv?'SSO-användarnamn':'SSO username',{exact:true})).toHaveAttribute('readonly','');await expect(editor.locator('.admin-credential-reset')).toHaveCount(0);await expect(editor.getByText(sv?'Kontot använder organization SSO':'This account uses organization SSO',{exact:false})).toBeVisible();}
   else {await expect(editor.locator('input[name="username"]')).toHaveValue(user.username);await expect(editor.locator('.admin-credential-reset')).toBeVisible();}
   await page.screenshot({path:`/tmp/auth008-editor-${user.username===null?'sso':'local'}-${language}.png`,fullPage:true});
   await editor.getByRole('button',{name:sv?'Avsluta session':'Revoke session',exact:true}).click();await expect(editor.getByText('Fictional browser',{exact:true})).toHaveCount(0);
   await editor.getByLabel('Fictional clinician',{exact:true}).uncheck();await editor.getByRole('button',{name:sv?'Ersätt rolluppsättning':'Replace role set',exact:true}).click();
   await expect(editor.getByLabel('Fictional clinician',{exact:true})).not.toBeChecked();
   await editor.locator('input[name="displayName"]').fill('Renamed '+user.displayName);await editor.locator('select[name="active"]').selectOption('false');await editor.getByRole('button',{name:sv?'Spara användare':'Save user',exact:true}).click();await expect(editor).toHaveCount(0);
   const disabledRow=page.getByRole('row').filter({has:page.getByRole('rowheader',{name:user.displayName,exact:true})});await disabledRow.getByRole('button',{name:sv?'Hantera':'Manage',exact:true}).click();
   await editor.locator('select[name="active"]').selectOption('true');await expect(editor.locator(".admin-reactivation-review")).toBeVisible();await editor.getByRole('button',{name:sv?'Återaktivera användare':'Reactivate user',exact:true}).click();await expect(editor).toHaveCount(0);
  }
  expect(users.every(user=>user.active&&user.roles.length===0)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:`/tmp/auth008-directory-${language}.png`,fullPage:true});
 });
}
for(const [language,width] of [['en',1440],['sv',390]] as const)test(`unlinking SSO uses the current session, retains the editor on failure and refreshes after success (${language})`,async({page})=>{
 const sv=language==='sv';await mount(page,language,width);let linked=true,conflict=true,authenticated=false;
 const user={id:ssoId,displayName:'SSO clinician',username:null,active:true,revision:1,roles:[role]};
 await page.route('**/api/admin/users?*',route=>route.fulfill({json:{items:[{...user,ssoLinked:linked}],nextCursor:null,pageSize:50}}));
 await page.route(`**/api/admin/users/${ssoId}/sessions`,route=>route.fulfill({json:{userId:ssoId,items:[]}}));
 await page.route(`**/api/admin/users/${ssoId}/roles`,route=>{user.revision++;return route.fulfill({json:{...user,addedRoles:[],removedRoles:[]}});});
 await page.route('**/api/sessions/reauthenticate',route=>{expect(route.request().headers()['x-csrf-token']).toBe('csrf');authenticated=true;return route.fulfill({json:{reauthenticatedUntil:new Date(Date.now()+300000).toISOString()}});});
 await page.route(`**/api/admin/users/${ssoId}/sso/unlink`,route=>{
  expect(authenticated).toBe(false);expect(route.request().headers()['x-csrf-token']).toBe('csrf');expect(route.request().postDataJSON()).toEqual({expectedRevision:user.revision});authenticated=false;
  if(conflict)return route.fulfill({status:409,json:{code:'admin.externalIdentityConflict'}});
  linked=false;return route.fulfill({json:{userId:ssoId,unlinked:true,identitiesUnlinked:1,sessionsRevoked:2}});
 });
 await page.goto('/__approval-directory');await page.getByRole('button',{name:sv?'Hantera':'Manage',exact:true}).click();
 const editor=page.locator('.admin-user-management'),form=editor.locator('.admin-sso-unlink');
 await expect(form).toBeVisible();await editor.getByRole('button',{name:sv?'Ersätt rolluppsättning':'Replace role set',exact:true}).click();await expect(form).toBeVisible();

 const action=form.getByRole('button',{name:sv?'Koppla från SSO och avsluta sessioner':'Unlink SSO and revoke sessions',exact:true});
 await expect(action).toBeEnabled();
 await page.screenshot({path:`/tmp/sso-unlink-${language}-${width}.png`,fullPage:true});
 await action.click();await expect(form.getByRole('alert')).toBeVisible();await expect(editor).toBeVisible();await expect(editor.getByLabel('Fictional clinician',{exact:true})).toBeChecked();
 conflict=false;await action.click();await expect(editor).toHaveCount(0);
 await expect(page.getByRole('status')).toContainText(sv?'SSO har kopplats från':'SSO unlinked');
 await page.getByRole('button',{name:sv?'Hantera':'Manage',exact:true}).click();await expect(editor.locator('.admin-sso-unlink')).toHaveCount(0);
});
