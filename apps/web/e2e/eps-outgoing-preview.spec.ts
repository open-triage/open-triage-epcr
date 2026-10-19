import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
for(const language of ['en','sv'])test(`outgoing checklist summary in ${language}`,async({page})=>{
 const script=(await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`
 import React,{useState}from'react';import{createRoot}from'react-dom/client';
 import{EpsSigningCheckbox}from'./components/eps-sign-export';import{EpsOutgoingPreview}from'./components/eps-outgoing-preview';
 function Fixture(){const[checked,setChecked]=useState(false);return <EpsSigningCheckbox language="${language}" checked={checked} disabled={false} onChange={setChecked} summary={<EpsOutgoingPreview reportId="report" binding="binding" language="${language}" disabled={false}/>}/>;}
 createRoot(document.getElementById('root')).render(<Fixture/>);`}})).outputFiles[0]!.text;
 const css=await readFile(path.resolve(__dirname,'../app/styles.css'),'utf8');
 let requests=0;
 await page.route('**/api/**',route=>{
  expect(route.request().method()).toBe('GET');expect(route.request().url()).toContain('/eps/outgoing?binding=binding');requests++;
  if(requests===1)return route.fulfill({status:500,json:{code:'reports.http500'}});
  return route.fulfill({json:{patientIdentifier:{system:'urn:fictional',value:'FICTIONAL'},findings:[],bundle:{entry:[{resource:{resourceType:'Patient',name:[{family:'Example',given:['Fictional']}],birthDate:'1980-02-29',gender:'female'}},{resource:{resourceType:'Composition',section:[{title:'Patient story',code:{coding:[{code:'81338-6'}]},text:{div:'<div><p>Saved narrative &lt;script&gt;window.injected=true&lt;/script&gt;</p></div>'}}]}}]}}});
 });
 await page.route('**/__outgoing',route=>route.fulfill({contentType:'text/html',body:`<style>${css}</style><div id="root"></div><script>${script}</script>`}));
 await page.goto('/__outgoing');
 const trigger=page.getByRole('button',{name:language==='en'?'Show summary':'Visa sammanfattning',exact:true});
 await trigger.click();
 const dialog=page.getByRole('dialog');await expect(dialog.getByRole('alert')).toContainText(language==='en'?'The summary could not be loaded':'Sammanfattningen kunde inte läsas in');
 await dialog.getByRole('button',{name:language==='en'?'Refresh results':'Uppdatera resultat',exact:true}).click();
 await expect(dialog).toContainText('Saved narrative');await expect(dialog).toContainText('Fictional Example');await expect(dialog).toContainText('1980-02-29');
 await expect(page.getByRole('checkbox')).not.toBeChecked();
 expect(await page.evaluate(()=>(window as unknown as {injected?:boolean}).injected)).toBeUndefined();
 for(const width of [1440,390]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:test.info().outputPath(`outgoing-${language}-${width}.png`)});}
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
 await trigger.click();await expect(page.getByRole('dialog')).toContainText('Saved narrative');expect(requests).toBe(3);
});
