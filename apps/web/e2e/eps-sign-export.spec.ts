import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
for(const scenario of ['accepted','network-failure','invalid','deactivated','unmount'])test(`automatic signed EPS export: ${scenario}`,async({page})=>{
 const script=(await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`
 import React,{useState}from'react';import{createRoot}from'react-dom/client';import{EpsSignedExport}from'./components/eps-sign-export';
 function Fixture(){const [open,setOpen]=useState(true);window.unmountExport=()=>setOpen(false);return open?<EpsSignedExport reportId="report" snapshotId="signed-snapshot" language="en" csrfToken="csrf" onClose={()=>{window.exportFinished=true;setOpen(false);}}/>:null;}
 createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`}})).outputFiles[0]!.text;
 const css=await readFile(path.resolve(__dirname,'../app/styles.css'),'utf8');
 let previews=0;const submissions:Record<string,unknown>[]=[];let release=()=>{};
 const held=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/reports/report/eps/submissions/**',async route=>{
  expect(route.request().headers()['x-csrf-token']).toBe('csrf');
  if(route.request().url().endsWith('/preview')){
   previews++;expect(route.request().postDataJSON()).toMatchObject({snapshotId:'signed-snapshot',amendmentSequence:0,dataset:'synthetic'});
   if(scenario==='unmount')await held;
   if(scenario==='deactivated')return route.fulfill({status:409,json:{code:'epsSubmission.disabled'}});
   return route.fulfill({json:{id:'prepared',state:'prepared',validation:{profile:{state:scenario==='invalid'?'failed':'pending'},findings:[]}}});
  }
  submissions.push(route.request().postDataJSON());
  if(scenario==='network-failure'&&submissions.length===1)return route.abort();
  return route.fulfill({json:{id:'prepared',state:'accepted'}});
 });
 await page.route('**/__export',route=>route.fulfill({contentType:'text/html',body:`<style>${css}</style><div id="root"></div><script>${script}</script>`}));
 await page.goto('/__export');
 if(scenario==='unmount'){
  await expect.poll(()=>previews).toBe(1);
  await page.evaluate(()=>(window as unknown as {unmountExport:()=>void}).unmountExport());release();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.waitForTimeout(100);expect(submissions).toHaveLength(0);return;
 }
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {exportFinished?:boolean}).exportFinished)).toBe(true);
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Retry export'})).toHaveCount(0);
 expect(previews).toBe(1);
 expect(submissions).toHaveLength(['accepted','network-failure'].includes(scenario)?1:0);
 if(submissions[0])expect(submissions[0]).toMatchObject({submissionId:'prepared',confirmPublicFictional:true});

});

test('signing checkbox is opt-in and only offered when EPS is active',async({page})=>{
 const script=(await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`
 import React,{useState}from'react';import{createRoot}from'react-dom/client';import{EpsSigningCheckbox,useEpsSigningActivation}from'./components/eps-sign-export';
 function Fixture(){const binding=useEpsSigningActivation('report','csrf');const [selected,setSelected]=useState(null);return binding?<EpsSigningCheckbox language="en" checked={selected===binding} disabled={false} onChange={checked=>setSelected(checked?binding:null)}/>:null;}
 createRoot(document.getElementById('root')).render(<Fixture/>);`}})).outputFiles[0]!.text;
 const css=await readFile(path.resolve(__dirname,'../app/styles.css'),'utf8');
 let active=false;await page.clock.install();
 await page.route('**/api/reports/report/eps/context',route=>route.fulfill({json:active?{binding:'active'}:null}));
 await page.route('**/__checkbox',route=>route.fulfill({contentType:'text/html',body:`<style>${css}</style><div id="root"></div><script>${script}</script>`}));
 await page.goto('/__checkbox');await expect(page.getByRole('checkbox')).toHaveCount(0);
 active=true;await page.clock.runFor(16000);
 await expect(page.getByRole('checkbox')).not.toBeChecked();await page.getByRole('checkbox').check();
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath(`checkbox-${width}.png`)});
 }
 active=false;await page.clock.runFor(16000);await expect(page.getByRole('checkbox')).toHaveCount(0);
});
