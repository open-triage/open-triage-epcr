import {expect,test,type Locator} from '@playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
let script:string,css:string;
test.beforeAll(async()=>{
 css=await readFile(path.resolve(__dirname,'../app/styles.css'),'utf8');
 script=(await build({bundle:true,write:false,jsx:'automatic',format:'iife',platform:'browser',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {AdminShell} from './components/admin-shell';createRoot(document.getElementById('root')).render(<AdminShell language="en" session={{user:{id:'admin',displayName:'Admin'},organization:{id:'agency',name:'EMS'},startedAt:'2026-10-16T12:00:00Z',expiresAt:'2099-01-01T00:00:00Z',csrfToken:'csrf'}}/>);`}})).outputFiles[0]!.text;
});
const draft={revision:1,name:'Identity provider',issuer:'https://idp.example.org',discoveryUrl:'',clientId:'client',scopes:['openid'],mappings:{displayName:'name',email:''},credentialConfigured:true,requiredFields:[],discoveryHealth:'unchecked',discovery:null,discoveredAt:null};
async function inset(container:Locator,content:Locator){
 const outer=(await container.boundingBox())!,inner=(await content.boundingBox())!;
 expect(inner.x-outer.x).toBeGreaterThanOrEqual(12);
 expect(outer.x+outer.width-inner.x-inner.width).toBeGreaterThanOrEqual(12);
}
for(const width of [390,1440])test(`Admin panels keep consistent gutters and contain nested user fields at ${width}px`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:900});
 await page.route('**/__spacing',route=>route.fulfill({contentType:'text/html',body:`<html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="--green:#315ba8;--text-color:#202850"><div class="admin-shell" id="root"></div><script src="/__spacing.js"></script></body></html>`}));
 await page.route('**/__spacing.js',route=>route.fulfill({contentType:'text/javascript',body:script}));
 await page.route('**/api/admin/**',route=>{
  const pathname=new URL(route.request().url()).pathname;
  if(pathname.endsWith('/context'))return route.fulfill({json:{organization:{id:'agency',name:'EMS'},panels:['authentication','users','schedules'],capabilities:['settings:read','settings:write','users:read','users:write']}});
  if(pathname.endsWith('/authentication/oidc'))return route.fulfill({json:{groupId:'agency',draft,active:draft,registration:{hosts:[{origin:'https://agency.example.org',callbackUrl:'https://agency.example.org/api/sessions/oidc/callback',logoutCallbackUrl:'https://agency.example.org/api/sessions/oidc/logout-callback'}],requiredClaims:[]},history:[]}});
  if(pathname.endsWith('/users'))return route.fulfill({json:{items:[{id:'00000000-0000-4000-8000-000000000001',displayName:'Example clinician',username:'clinician',active:true,revision:1,roles:[]}],nextCursor:null}});
  return route.fulfill({json:{items:[],nextCursor:null}});
 });
 await page.goto('/__spacing');
 const gutters:number[]=[];
 for(const label of ['Authentication','Users','Shift schedules']){
  await page.getByRole('button',{name:label,exact:true}).click();
  const panel=page.locator('.admin-panel > div:not([hidden]) > section');
  const heading=panel.getByRole('heading',{name:label,exact:true});await expect(heading).toBeVisible();
  gutters.push((await heading.boundingBox())!.x-(await panel.boundingBox())!.x);
  if(label==='Authentication'){
   await expect(panel.getByLabel('Callback URL',{exact:true})).toBeVisible();
   await inset(panel,panel.getByRole('button',{name:'Copy active configuration to new draft'}));
   await inset(panel,panel.getByLabel('Callback URL',{exact:true}));
  }else if(label==='Users'){
   await page.getByRole('button',{name:'Manage',exact:true}).click();
   const editor=panel.locator('.admin-user-management');await expect(editor).toBeVisible();
   expect((await editor.boundingBox())!.y-(await panel.locator(':scope > .section-heading').boundingBox())!.y-(await panel.locator(':scope > .section-heading').boundingBox())!.height).toBeGreaterThanOrEqual(12);
   const roleGroup=editor.getByRole('group',{name:'Complete retained role set'});
   await inset(roleGroup,roleGroup.getByRole('textbox'));
   const table=panel.locator('.admin-table-scroll');
   await table.evaluate(el=>{el.scrollLeft=el.scrollWidth;});await inset(panel,table);
   await page.getByRole('button',{name:'Close',exact:true}).click();
  }else{
   const refresh=panel.getByRole('button',{name:'Refresh',exact:true}),table=panel.locator('.admin-table-scroll');
   const gap=(await table.boundingBox())!.y-(await refresh.boundingBox())!.y-(await refresh.boundingBox())!.height;
   expect(gap).toBeGreaterThanOrEqual(8);await inset(panel,table);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`${label.replaceAll(' ','-')}-${width}.png`),fullPage:true});
 }
 expect(Math.max(...gutters)-Math.min(...gutters)).toBeLessThanOrEqual(1);
});
