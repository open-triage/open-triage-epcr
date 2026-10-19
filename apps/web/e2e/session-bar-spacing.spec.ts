import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

test('session bar leaves no gap after delayed mount, resize, or shell replacement',async({page})=>{
 const script=(await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`
 import React,{useRef,useState}from'react';import{createRoot}from'react-dom/client';
 import{useMeasuredParentHeight}from'./components/use-measured-parent-height';
 function Fixture(){
 const [mounted,setMounted]=useState(false),[version,setVersion]=useState(0),[height,setHeight]=useState(54);
 const ref=useRef(null);const measure=useMeasuredParentHeight(ref,'--session-bar-height');
 return <><button onClick={()=>setMounted(!mounted)}>Mount</button><button onClick={()=>setVersion(version+1)}>Replace</button><button onClick={()=>setHeight(112)}>Resize</button>
 {mounted&&<div key={version} className="authenticated-shell desktop-shell"><header ref={measure} className="session-bar" style={{height}}>Navigation</header><aside className="safety-notice clinical-demo-banner">Demo</aside><main style={{height:1500}}>Encounter</main></div>}</>;
 }createRoot(document.getElementById('root')).render(<Fixture/>);`}})).outputFiles[0]!.text;
 const css=(await Promise.all(['styles.css','session-layout.css'].map(file=>readFile(path.resolve(__dirname,'../app',file),'utf8')))).join('\n');
 await page.route('**/__bar',route=>route.fulfill({contentType:'text/html',body:`<style>${css}</style><div id="root"></div><script>${script}</script>`}));
 await page.goto('/__bar');
 const check=async()=>{
  await expect.poll(async()=>{
   const bar=await page.locator('.session-bar').boundingBox();
   const banner=await page.locator('.clinical-demo-banner').boundingBox();
   return Math.abs(banner!.y-(bar!.y+bar!.height));
  }).toBeLessThan(1);
 };
 await page.getByText('Mount',{exact:true}).click();await check();
 await page.getByText('Replace',{exact:true}).click();await check();
 await page.getByText('Resize',{exact:true}).click();await check();
 await page.evaluate(()=>window.scrollTo(0,300));await check();
 await page.screenshot({path:test.info().outputPath('no-header-gap.png')});
});
