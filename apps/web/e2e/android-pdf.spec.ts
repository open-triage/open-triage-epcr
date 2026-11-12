import {expect,test,type Page} from '@playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const report='11111111-1111-4111-8111-111111111111',snapshot='22222222-2222-4222-8222-222222222222',agency='33333333-3333-4333-8333-333333333333';
type PdfRequest={path:string;headers:Record<string,string>;connectionContext:string;action:'view'|'save';language:string;operationId:string};
async function mount(page:Page,{native=true,language='en',mode='ready',legacyModal=false}={}) {
  if(legacyModal)await page.addInitScript(()=>{
    const original=HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal=function(){
      if(this.open)throw new DOMException("The element already has an 'open' attribute, and therefore cannot be opened modally.",'InvalidStateError');
      (window as any).__modalOpenCalls=((window as any).__modalOpenCalls??0)+1;
      return original.call(this);
    };
  });
  const cwd=process.cwd();
  const script=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{SignedReportPdfPreview}from'./components/signed-report-pdf-preview';import{configureNativeConnection}from'./app/android-runtime';import{bindBrowserOrganization}from'./app/browser-api';
  bindBrowserOrganization('${agency}');configureNativeConnection({configured:true,origin:'https://private.example',storageScope:'A'.repeat(43),connectionContext:'native-context'});
  const root=createRoot(document.getElementById('root'));const props={reportId:'${report}',snapshotId:'${snapshot}',amendmentSequence:2,dataset:'synthetic',language:'${language}'};
  window.__pdfFixture.changeContext=()=>configureNativeConnection({configured:true,origin:'https://new.example',storageScope:'B'.repeat(43),connectionContext:'new-context'});
  window.__pdfFixture.disable=()=>root.render(React.createElement(SignedReportPdfPreview,{...props,disabled:true}));root.render(React.createElement(SignedReportPdfPreview,props));`,resolveDir:cwd,loader:'tsx'},bundle:true,write:false,platform:'browser',define:{'process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION':'"false"','process.env.NEXT_PUBLIC_API_URL':'"same-origin"','process.env.NEXT_PUBLIC_BASE_PATH':'""','process.env.NEXT_PUBLIC_ROUTE_DEMO_MUTATIONS_TO_API':'"false"'},plugins:[{name:'native-fixture',setup(builder){builder.onResolve({filter:/^@capacitor\/core$/},()=>({path:'capacitor',namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export const Capacitor={isNativePlatform:()=>window.__pdfFixture.native,getPlatform:()=>window.__pdfFixture.native?'android':'web'};export const registerPlugin=()=>({openPdf:async options=>{const fixture=window.__pdfFixture;fixture.calls.push(options);if(fixture.mode==='held')return new Promise(resolve=>fixture.release=resolve);if(fixture.mode==='denied')return{opened:false,status:422,code:'pdf.media-unavailable'};if(fixture.mode==='unsafe-error')throw Error('PRIVATE SERVER DETAILS');return{opened:true,status:200}},closePdf:async options=>{window.__pdfFixture.closed.push(options.operationId)}});`,loader:'js'}));}}]});
  const css=await readFile(path.join(cwd,'app/styles.css'),'utf8');
  await page.route('**/__native-pdf',route=>route.fulfill({contentType:'text/html',body:`<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>window.__pdfFixture={native:${native},mode:'${mode}',calls:[],closed:[],blobs:0};const realBlob=URL.createObjectURL.bind(URL);URL.createObjectURL=(blob)=>{window.__pdfFixture.blobs++;return realBlob(blob)};</script><script>${script.outputFiles[0]!.text}</script></body></html>`}));
  await page.goto('/__native-pdf');
}

for(const language of ['en','sv'])test(`native PDF uses scoped platform controls without a blob iframe (${language})`,async({page})=>{
  await page.setViewportSize({width:390,height:844});await mount(page,{language});
  await page.getByRole('button',{name:language==='en'?'Inspect signed PDF':'Granska signerad PDF',exact:true}).click();
  await expect(page.locator('[data-native-pdf-controls]')).toBeVisible();
  const request=await page.evaluate('window.__pdfFixture.calls[0]') as PdfRequest;
  expect(request.path).toContain(`/api/review/reports/${report}/snapshots/${snapshot}/pdf?`);expect(request.path).toContain('amendmentSequence=2');expect(request.path).toContain('dataset=synthetic');
  expect(request.headers).toEqual({'x-organization-id':agency});expect(request.connectionContext).toBe('native-context');expect(request.action).toBe('view');expect(request.language).toBe(language);expect(request.operationId).toMatch(/^[a-f0-9-]{36}$/);
  await expect(page.locator('iframe,a[download]')).toHaveCount(0);expect(await page.evaluate('window.__pdfFixture.blobs')).toBe(0);
  await page.getByRole('button',{name:language==='en'?'Download PDF':'Hämta PDF',exact:true}).click();
  await expect.poll(()=>page.evaluate('window.__pdfFixture.calls.length')).toBe(2);expect(await page.evaluate('window.__pdfFixture.calls[1].action')).toBe('save');
  await page.getByRole('button',{name:language==='en'?'Close':'Stäng',exact:true}).click();
  await expect.poll(()=>page.evaluate('window.__pdfFixture.closed.length')).toBeGreaterThanOrEqual(2);
});
test('native PDF findings retain localized retry and never display raw bridge/server prose',async({page})=>{
  await mount(page,{mode:'denied'});await page.getByRole('button',{name:'Inspect signed PDF',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('original media');await page.evaluate('window.__pdfFixture.mode="unsafe-error"');await page.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.getByRole('alert')).not.toContainText('PRIVATE SERVER DETAILS');
  await page.evaluate('window.__pdfFixture.mode="ready"');await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(page.locator('[data-native-pdf-controls]')).toBeVisible();
});
test('programmatic native PDF Retry keeps the same modal and starts a fresh native operation',async({page})=>{
  await mount(page,{mode:'denied'});await page.getByRole('button',{name:'Inspect signed PDF',exact:true}).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.evaluate(()=>{
    (window as any).__pdfFixture.mode='ready';
    const retry=Array.from(document.querySelectorAll('button')).find(button=>button.offsetParent!==null&&button.textContent.trim()==='Retry');
    if(!retry)throw Error('Expected the visible PDF Retry');
    retry.click();
  });
  await expect(page.locator('.signed-report-pdf-dialog')).toBeVisible();
  await expect(page.locator('[data-native-pdf-controls]')).toBeVisible();
  await expect.poll(()=>page.evaluate('window.__pdfFixture.calls.length')).toBe(2);
  expect(await page.evaluate('window.__pdfFixture.calls[0].operationId!==window.__pdfFixture.calls[1].operationId')).toBe(true);
});
for(const native of [true,false])test(`PDF Retry retains the open dialog under Chromium109 showModal semantics (native=${native})`,async({page})=>{
  // Chromium109 rejects *any* showModal() on an open element, even an
  // already-modal dialog. New desktop Chromium permits that repeated call.
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.name));
  let fail=true,reads=0;
  await page.route('**/api/review/reports/**/pdf?**',route=>{reads++;return fail?route.fulfill({status:503,json:{code:'pdf.unavailable'}}):route.fulfill({contentType:'application/pdf',body:'%PDF-1.4\nsynthetic bounded retry fixture'});});
  await mount(page,{native,mode:'denied',legacyModal:true});
  await page.getByRole('button',{name:'Inspect signed PDF',exact:true}).click();
  await expect(page.getByRole('alert')).toBeVisible();
  fail=false;await page.evaluate('window.__pdfFixture.mode="ready"');
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.locator('.signed-report-pdf-dialog')).toBeVisible({timeout:3000});
  if(native){await expect(page.locator('[data-native-pdf-controls]')).toBeVisible();expect(await page.evaluate('window.__pdfFixture.calls.length')).toBe(2);}
  else{await expect(page.locator('iframe')).toHaveAttribute('src',/^blob:/);expect(reads).toBe(2);}
  expect(await page.evaluate('window.__modalOpenCalls')).toBe(1);expect(errors).toEqual([]);
});
for(const boundary of ['close','disabled','context'])test(`late native PDF cannot reopen after ${boundary}`,async({page})=>{
  await mount(page,{mode:'held'});await page.getByRole('button',{name:'Inspect signed PDF',exact:true}).click();await expect.poll(()=>page.evaluate('window.__pdfFixture.calls.length')).toBe(1);
  if(boundary==='close')await page.getByRole('button',{name:'Close',exact:true}).click();
  else await page.evaluate(boundary==='disabled'?'window.__pdfFixture.disable()':'window.__pdfFixture.changeContext()');
  await page.evaluate('window.__pdfFixture.release({opened:true,status:200})');
  await expect.poll(()=>page.evaluate('window.__pdfFixture.closed.length')).toBeGreaterThan(0);await expect(page.locator('[data-native-pdf-controls],iframe,a[download]')).toHaveCount(0);
});
