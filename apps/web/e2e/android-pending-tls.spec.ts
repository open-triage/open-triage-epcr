import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

let script: string, css: string;
test.beforeAll(async () => {
  css=await readFile(path.resolve(__dirname,'../app/styles.css'),'utf8');
  script=(await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NEXT_PUBLIC_API_URL:'same-origin'})},plugins:[{name:'pending-native',setup(builder){
    builder.onResolve({filter:/^@capacitor\/core$/},()=>({path:'core',namespace:'pending-native'}));
    builder.onLoad({filter:/.*/,namespace:'pending-native'},()=>({loader:'js',contents:`
      export const Capacitor={isNativePlatform:()=>true,getPlatform:()=> 'android'};
      export const registerPlugin=()=>({
        state:async()=>({...window.fixture.state}),
        previewPendingTrust:async({artifact})=>{const f=window.fixture,value=JSON.parse(artifact);f.previews++;if(value.origin!==f.state.pendingOrigin)throw{code:'CONNECTION_FAILED'};const result={origin:value.origin,trustFingerprint:'public-trust-digest'};if(f.holdPreview)return new Promise(resolve=>f.releasePreview=()=>resolve(result));return result},
        confirmPendingTrust:async value=>{const f=window.fixture;if(value.confirmTrust!==true)throw Error('confirmation');f.confirms++;f.state={...f.state,connectionContext:'new-approved-trust'};return f.state},
        resumeEnrollment:async()=>{const f=window.fixture;f.state={...f.state,pendingOutcome:f.outcome};throw{code:f.outcome==='not-committed'?'ENROLLMENT_NOT_COMMITTED':'ENROLLMENT_UNAVAILABLE'}},
        abandonUncommittedEnrollment:async value=>{const f=window.fixture;if(f.outcome!=='not-committed'||value.confirmAbandon!==true)throw{code:'ENROLLMENT_UNAVAILABLE'};f.abandoned++;return f.state={...f.state,replacementPending:false}}
      });` }));
  }}],stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AndroidPendingEnrollment}from'./components/android-pending-enrollment';
      function Fixture(){const[state,setState]=useState(window.fixture.state);window.emitPending=setState;return state.replacementPending?<AndroidPendingEnrollment key={state.connectionContext+':'+state.managedContext} state={state} language={document.documentElement.lang} onState={setState}/>:<p data-new-code>New code allowed</p>};createRoot(document.getElementById('root')).render(<Fixture/>);`}})).outputFiles[0]!.text;
});
async function start(page:Page,language='en',extra:Record<string,unknown>={}) {
  await page.route('**/__pending-script',route=>route.fulfill({contentType:'text/javascript',body:script}));
  await page.route('**/__pending-tls',route=>route.fulfill({contentType:'text/html',body:`<html lang="${language}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main id="root" class="admin-directory installation-enrollment"></main><script>window.fixture=${JSON.stringify({state:{configured:false,replacementPending:true,pendingOrigin:'https://original.example',connectionContext:'pending'},intent:{token:'immutable-original-token',attempt:'immutable-native-secret',originalCookie:'immutable-original-cookie',createdAt:123},ciphertext:'opaque-retained-ciphertext',previews:0,confirms:0,abandoned:0,outcome:'unavailable',...extra})}</script><script src="/__pending-script"></script></body></html>`}));
  await page.goto('/__pending-tls');
}
const artifact=(origin='https://original.example')=>({name:'trust.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,origin,token:'A'.repeat(43),expiresAt:new Date(Date.now()+240000).toISOString(),caPem:''}))});
for(const language of ['en','sv'])test(`pending trust update requires confirmation and keeps its original intent in ${language}`,async({page})=>{
  await start(page,language);
  const before=await page.evaluate(()=>JSON.stringify((window as unknown as {fixture:{intent:unknown}}).fixture.intent));
  await page.locator('input[type=file]').setInputFiles(artifact('https://other.example'));
  await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.locator('input[type=file]').setInputFiles(artifact());
  await expect(page.getByRole('checkbox')).toBeVisible();await expect(page.locator('button[type=submit]')).toBeDisabled();
  await page.screenshot({path:test.info().outputPath(`pending-trust-${language}.png`)});
  await page.getByRole('checkbox').check();await page.locator('button[type=submit]').click();
  await expect(page.getByRole('checkbox')).toHaveCount(0);await expect(page.locator('input[type=file]')).toBeVisible();
  expect(await page.evaluate(()=>JSON.stringify((window as unknown as {fixture:{intent:unknown}}).fixture.intent))).toBe(before);
  expect(await page.evaluate(()=>(window as unknown as {fixture:{confirms:number}}).fixture.confirms)).toBe(1);
  await expect(page.locator('[data-new-code]')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('unavailable and missing-server outcomes cannot discard a journal; only a proved uncommitted intent enables a new code',async({page})=>{
  await start(page);
  await page.getByRole('button',{name:'Retry confirmed pairing'}).click();
  await expect(page.getByRole('button',{name:'Use a new pairing code'})).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('cannot be verified');
  await page.evaluate(()=>(window as unknown as {fixture:{outcome:string}}).fixture.outcome='not-committed');
  await page.getByRole('button',{name:'Retry confirmed pairing'}).click();
  await expect(page.getByRole('button',{name:'Use a new pairing code'})).toBeEnabled();
  await page.getByRole('button',{name:'Use a new pairing code'}).click();await expect(page.locator('[data-new-code]')).toBeVisible();
  expect(await page.evaluate(()=>(window as unknown as {fixture:{ciphertext:string}}).fixture.ciphertext)).toBe('opaque-retained-ciphertext');
});
test('a stale trust preview cannot survive a managed policy change or bypass missing settings',async({page})=>{
  await start(page,'en',{holdPreview:true});await page.locator('input[type=file]').setInputFiles(artifact());
  await expect.poll(()=>page.evaluate(()=>Boolean((window as unknown as {fixture:{releasePreview?:()=>void}}).fixture.releasePreview))).toBe(true);
  await page.evaluate(()=>{const f=window as unknown as {fixture:{state:Record<string,unknown>;releasePreview:()=>void};emitPending(state:Record<string,unknown>):void};f.emitPending({...f.fixture.state,connectionContext:'policy-changed',managedContext:'new-policy',blocked:true,managedStatus:'missing'});});
  await expect(page.locator('input[type=file]')).toBeDisabled();await page.evaluate(()=>(window as unknown as {fixture:{releasePreview:()=>void}}).fixture.releasePreview());
  await expect(page.getByRole('checkbox')).toHaveCount(0);await expect(page.getByRole('button',{name:'Retry confirmed pairing'})).toBeDisabled();
});
