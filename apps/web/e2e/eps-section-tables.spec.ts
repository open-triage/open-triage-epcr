import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

for(const language of ['en','sv']) test(`EPS section tables and mapped row imports in ${language}`,async({page,context})=>{
 const script=(await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';
 import{EpsImports}from'./components/eps-imports';import{EpsSectionTables}from'./components/eps-section-tables';
 const summary={clinicalSections:[{title:'Allergies',content:'Original narrative',tables:[{headers:['Allergen','Reaction','Date'],rows:[{identity:'allergy',cells:['Penicillin','Anaphylaxis','2026-01-02']},{identity:'unmapped',cells:['Unmapped allergy','Source details','']}]}],entries:[{identity:'allergy',label:'Penicillin',content:'Anaphylaxis; confirmed'},{identity:'unmapped',label:'Unmapped allergy',content:'Source details'}]},{title:'Conditions',content:'',entries:[{identity:'blocked',label:'Historical condition',content:'Inactive'}]},{title:'Empty section',content:'Information unavailable'}]};
 createRoot(document.getElementById('root')).render(<div className="eps-content"><EpsImports csrfToken="fixture-csrf" reportId="report" binding="binding" language="${language}" ready>{(rows,action)=><EpsSectionTables summary={summary} language="${language}" rows={rows} action={action}/>}</EpsImports></div>);`}})).outputFiles[0]!.text;
 const css=await readFile(path.resolve(__dirname,'../app/styles.css'),'utf8');
 let applied=0;
 await page.route('**/api/reports/report/eps/imports**',async route=>{
  const pathname=new URL(route.request().url()).pathname;
  if(route.request().method()==='POST')expect(route.request().headers()['x-csrf-token']).toBe('fixture-csrf');
  if(pathname.endsWith('/plan')){expect(route.request().postDataJSON()).toEqual({binding:'binding',entryId:'allergy'});return route.fulfill({json:{id:'plan',destination:'Allergies',incoming:'Penicillin',existing:[],conflict:false,alreadyImported:false}});}
  if(pathname.endsWith('/apply')){expect(route.request().postDataJSON().decision).toBe('import');applied++;return route.fulfill({json:{}});}
  return route.fulfill({json:{rows:[{entryId:'allergy',label:'Penicillin',destination:'Allergies',mappingId:'map',finding:null},{entryId:'unmapped',label:'Unmapped allergy',destination:null,mappingId:null,finding:'unmapped'},{entryId:'blocked',label:'Historical condition',destination:'History',mappingId:'blocked',finding:'cardinality'}],inconsistent:false}});
 });
 await page.route('**/__eps-tables',route=>route.fulfill({contentType:'text/html',body:`<html lang="${language}"><head><style>${css}</style></head><body><div id="root"></div><script>${script}</script></body></html>`}));
 await page.goto('/__eps-tables');
 const allergies=page.getByRole('table',{name:'Allergies',exact:true});
 const importName=language==='en'?'Import':'Importera';
 const eligible=allergies.getByRole('row').filter({hasText:'Penicillin'}).getByRole('button',{name:importName,exact:true});
 await expect(eligible).toBeEnabled();
 await expect(allergies.getByRole('columnheader',{name:'Reaction',exact:true})).toHaveCount(1);
 await expect(allergies.getByRole('cell',{name:/Anaphylaxis/})).toBeVisible();
 await expect(allergies.getByRole('cell',{name:/2026-01-02/})).toBeVisible();
 await expect(allergies.getByRole('row').filter({hasText:'Unmapped allergy'}).getByRole('button',{name:importName,exact:true})).toHaveCount(0);
 await expect(page.getByRole('table',{name:'Conditions',exact:true}).getByRole('button',{name:importName,exact:true})).toHaveCount(0);
 await expect(page.getByRole('table',{name:'Empty section'})).toContainText('Information unavailable');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:test.info().outputPath('section-tables.png'),fullPage:true});
 for(const title of ['Penicillin','Unmapped allergy','Historical condition','Information unavailable']){
  const row=page.locator('tbody tr').filter({hasText:title}).first();
  await row.locator('th,td').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(row).toBeFocused();
 }
 await allergies.locator('tbody tr').first().focus();
 await page.keyboard.press('Enter');
 await expect(page.getByRole('dialog')).toContainText('Anaphylaxis; confirmed');
 await page.getByRole('dialog').getByRole('button').click();
 await page.keyboard.press('Space');
 await expect(page.getByRole('dialog')).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.getByRole('button',{name:/^(Details|Detaljer)/})).toHaveCount(0);
 await context.setOffline(true);await expect(eligible).toBeDisabled();await context.setOffline(false);await expect(eligible).toBeEnabled();
 await eligible.click();await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.locator('fieldset')).toBeVisible();expect(applied).toBe(0);
 await page.locator('fieldset').getByRole('button',{name:language==='en'?'Import':'Importera',exact:true}).click();
 await expect(page.locator('fieldset')).toHaveCount(0);expect(applied).toBe(1);
});
