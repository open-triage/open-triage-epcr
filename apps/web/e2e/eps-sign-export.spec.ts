import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
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
