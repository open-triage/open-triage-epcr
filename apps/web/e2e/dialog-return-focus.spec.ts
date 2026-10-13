import {expect,test} from '@playwright/test';
import {build} from 'esbuild';
import path from 'node:path';
let script:string;
test.beforeAll(async()=>{
 const result=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`import React,{useRef,useState,useEffect} from 'react';import {createRoot} from 'react-dom/client';import {useReturnFocus} from './components/use-return-focus';function App(){const[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[replacement,setReplacement]=useState(false),[disabled,setDisabled]=useState(false);const trigger=useRef(null);useReturnFocus(open,busy,()=>trigger.current);useEffect(()=>{window.finishFocusSave=()=>setBusy(false);window.replaceFocusTrigger=()=>setReplacement(true);window.disableFocusTrigger=()=>setDisabled(true)},[]);return <><button key={String(replacement)} disabled={busy||disabled} onClick={e=>{trigger.current=e.currentTarget;setOpen(true)}}>{replacement?'Another account action':'Review identity'}</button>{open&&<dialog open aria-label="Identity review"><button onClick={()=>{setBusy(true);setOpen(false)}}>Save and close</button></dialog>}<p role="status">{busy?'Save pending':'Ready'}</p></>}createRoot(document.getElementById('root')).render(<App/>);`}});script=result.outputFiles[0]!.text;
});
for(const unavailable of ['none','disconnected','disabled'])test(`dialog return focus waits for committed save completion and handles a ${unavailable} trigger`,async({page})=>{
 await page.route('**/__return-focus',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div><script src="/__return-focus.js"></script>'}));
 await page.route('**/__return-focus.js',route=>route.fulfill({contentType:'text/javascript',body:script}));
 await page.goto('/__return-focus');const trigger=page.getByRole('button',{name:'Review identity',exact:true});await trigger.click();await page.getByRole('button',{name:'Save and close'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(trigger).toBeDisabled();await expect(page.getByRole('status')).toHaveText('Save pending');
 // Observe a completed animation frame while the real trigger is disabled.
 // The old queued-frame approach has already lost its one focus attempt here.
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));
 if(unavailable==='disconnected')await page.evaluate(()=> (window as unknown as {replaceFocusTrigger:()=>void}).replaceFocusTrigger());
 if(unavailable==='disabled')await page.evaluate(()=> (window as unknown as {disableFocusTrigger:()=>void}).disableFocusTrigger());
 await page.evaluate(()=> (window as unknown as {finishFocusSave:()=>void}).finishFocusSave());await expect(page.getByRole('status')).toHaveText('Ready');
 if(unavailable==='none'){await expect(trigger).toBeEnabled();await expect(trigger).toBeFocused();}
 else if(unavailable==='disconnected'){await expect(trigger).toHaveCount(0);await expect(page.getByRole('button',{name:'Another account action'})).not.toBeFocused();}
 else{await expect(trigger).toBeDisabled();await expect(trigger).not.toBeFocused();}
});
