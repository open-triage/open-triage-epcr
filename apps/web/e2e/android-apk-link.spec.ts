import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';
let script: string;
const url='https://github.com/open-triage/open-triage-epcr/releases/download/android-v2-1.0.0/opentriage-1.0.0-2-'+ 'a'.repeat(64)+'.apk';
test.beforeAll(async()=>{
 const result=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'runtime',setup(builder){
  builder.onResolve({filter:/android-runtime$/},()=>({path:'runtime',namespace:'fixture'}));
  builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:"export const isAndroidRuntime=()=>new URLSearchParams(location.search).get('native')==='1';",loader:'js'}));
 }}],stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import{AndroidApkLink}from'./components/android-apk-link';import en from'./messages/en.json';import sv from'./messages/sv.json';const messages=new URLSearchParams(location.search).get('language')==='sv'?sv:en;createRoot(document.getElementById('root')).render(<AndroidApkLink verifiedUrl=${JSON.stringify(url)} unavailableMessage={messages["android.apkDownloadUnavailable"]}>Download</AndroidApkLink>);`}});
 script=result.outputFiles[0]!.text;
});
for(const language of ['en','sv'])for(const native of [false,true])test(`APK anchor preserves browser navigation and native failure feedback (${language}, native=${native})`,async({page})=>{
 await page.route('**/__apk-link?*',route=>route.fulfill({contentType:'text/html',body:`<div id="root"></div><script>${script}</script>`}));
 await page.goto(`/__apk-link?native=${native?1:0}&language=${language}`);
 const link=page.getByRole('link',{name:'Download'});
 await expect(link).toHaveAttribute('href',url);await expect(link).toHaveAttribute('rel','noopener noreferrer');await expect(link).toHaveAttribute('referrerpolicy','no-referrer');
 if(native)await expect(link).not.toHaveAttribute('target');else await expect(link).toHaveAttribute('target','_blank');
 const failure=(value:string)=>page.evaluate(url=>window.dispatchEvent(new CustomEvent('open-triage.apk-download-failed',{detail:{url}})),value);
 await failure(url);await expect(page.getByRole('alert')).toHaveCount(0);
 // Keep the actual React click while preventing remote navigation in the fixture.
 await link.evaluate(node=>node.addEventListener('click',event=>event.preventDefault()));await link.click();
 await failure('https://attacker.invalid/private.apk');await expect(page.getByRole('alert')).toHaveCount(0);
 await failure(url);
 if(native){await expect(page.getByRole('alert')).toHaveText(language==='sv'?'Nedladdningen kan inte öppnas. Be din administratör att installera uppdateringen.':'Cannot open the download. Ask your administrator to install the update.');await link.click();await expect(page.getByRole('alert')).toHaveCount(0);}
 else await expect(page.getByRole('alert')).toHaveCount(0);
});
