import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

let script: string;
let css: string;
test.beforeAll(async()=>{
  css=await readFile(path.resolve(__dirname,'../app/styles.css'),'utf8');
  const result=await build({bundle:true,write:false,jsx:'automatic',format:'iife',platform:'browser',
    define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},
    stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {AdminShell} from './components/admin-shell';
      createRoot(document.getElementById('root')).render(<AdminShell
        session={{user:{id:'admin',displayName:'Administrator'},organization:{id:'agency',name:'EMS'},
          startedAt:'2026-10-13T12:00:00Z',expiresAt:'2099-01-01T00:00:00Z',csrfToken:'csrf',capabilities:['settings:read','settings:write']}}
        language={new URLSearchParams(location.search).get('language')}/>);
    `}});script=result.outputFiles[0]!.text;
});
for(const language of ['en','sv']) {
  test(`${language} agency unit directory creates, edits and deactivates by keyboard on desktop and mobile`,async({page},testInfo)=>{
    const t=(en:string,sv:string)=>language==='sv'?sv:en;
    let rows:Array<{id:string;organizationId:string;name:string;callSign:string;active:boolean;revision:number;scheduleSelected?:boolean;enrolled?:boolean}>=[];
    let failRefresh=false;
    await page.route('**/__units-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
    await page.route('**/__units?*',route=>route.fulfill({contentType:'text/html',body:`<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/__units-script"></script></body></html>`}));
    await page.route('**/api/admin/context',route=>route.fulfill({json:{organization:{id:'agency',name:'EMS'},panels:['units'],capabilities:['settings:read','settings:write'],dashboard:null,activeConfiguration:null}}));
    await page.route('**/api/admin/units**',async route=>{
      const request=route.request();
      if(request.method()==='GET') return route.fulfill(failRefresh?{status:503,json:{message:'Unavailable'}}:{json:{items:rows,nextCursor:null}});
      expect(request.headers()['x-csrf-token']).toBe('csrf');
      const body=request.postDataJSON();
      if(request.method()==='POST') rows.push({id:'30000000-0000-4000-8000-000000000010',organizationId:'agency',revision:1,scheduleSelected:false,enrolled:false,...body});
      else {expect(body.expectedRevision).toBe(rows[0]!.revision);rows=[{...rows[0]!,...body,revision:rows[0]!.revision+1}];}
      return route.fulfill({json:rows[0]});
    });
    await page.goto(`/__units?language=${language}`);
    await expect(page.getByRole('heading',{name:t('Units','Enheter'),exact:true})).toBeVisible();
    for(const width of [1280,360]) {
      await page.setViewportSize({width,height:800});
      const create=page.getByRole('button',{name:t('Create unit','Skapa enhet'),exact:true});
      if(!rows.length){
        await create.focus();await create.press('Enter');
        const dialog=page.getByRole('dialog');
        await dialog.getByLabel(t('Name','Namn'),{exact:true}).fill('Medic 7');
        await dialog.getByLabel(t('Call sign','Anropssignal'),{exact:true}).fill('MEDIC-7');
        await dialog.getByRole('button',{name:t('Save','Spara'),exact:true}).focus();await page.keyboard.press('Enter');
        await expect(dialog).toHaveCount(0);await expect(create).toBeFocused();
      }
      if(rows[0]!.active){await expect(page.getByText(t('Select a shift schedule before ordinary work.','Välj ett arbetspasschema före ordinarie arbete.'))).toBeVisible();await expect(page.getByText(t('Enroll a device before ordinary work.','Registrera en enhet före ordinarie arbete.'))).toBeVisible();}
      const edit=page.getByRole('button',{name:`${t('Edit','Redigera')} Medic 7`,exact:true});
      await edit.focus();await edit.press('Enter');
      const dialog=page.getByRole('dialog');
      await dialog.getByLabel(t('Call sign','Anropssignal'),{exact:true}).fill(width===1280?'NEW-7':'FINAL-7');
      if(width===360) await dialog.getByLabel(t('Active','Aktiv'),{exact:true}).uncheck();
      const save=dialog.getByRole('button',{name:t('Save','Spara'),exact:true});
      await expect(save).toBeInViewport();
      await page.screenshot({path:testInfo.outputPath(`units-${language}-${width}.png`)});
      await save.focus();await save.press('Enter');
      await expect(dialog).toHaveCount(0);await expect(edit).toBeFocused();
      await expect(page.getByText(width===1280?'NEW-7':'FINAL-7',{exact:true})).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    await expect(page.getByRole('cell',{name:t('Inactive','Inaktiv'),exact:true})).toBeVisible();
    failRefresh=true;await page.getByRole('button',{name:t('Refresh','Uppdatera'),exact:true}).click();
    await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByText('FINAL-7',{exact:true})).toBeVisible();
  });
}
