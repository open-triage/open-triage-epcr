import {expect, test} from '@playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

let script: string, css: string;
test.beforeAll(async () => {
  css = await readFile(path.resolve(__dirname, '../app/styles.css'), 'utf8');
  const bundled = await build({bundle: true, write: false, jsx: 'automatic', format: 'iife', platform: 'browser',
    define: {'process.env': JSON.stringify({NEXT_PUBLIC_API_URL: 'same-origin'})},
    plugins: [{name: 'managed-native-fixture', setup(builder) {
      builder.onResolve({filter: /^@capacitor\/core$/}, () => ({path: 'capacitor-fixture', namespace: 'managed-capacitor'}));
      builder.onLoad({filter: /.*/, namespace: 'managed-capacitor'}, () => ({loader: 'js', contents: `
        export const registerPlugin=name=>name==='OpenTriageScanner'?{scan:async()=>{const f=window.managedFixture,result={cancelled:false,artifact:f.artifact};return f.holdScan?new Promise(resolve=>{f.releaseScan=()=>resolve(result)}):result}}:{addListener:async()=>({remove:async()=>{}}),state:async()=>({active:true})};
      `}));
      builder.onResolve({filter: /android-runtime$/}, () => ({path: 'native-fixture', namespace: 'managed-fixture'}));
      builder.onLoad({filter: /.*/, namespace: 'managed-fixture'}, () => ({loader: 'js', contents: `
        export const isAndroidRuntime=()=>true;
        export const installAndroidTransport=()=>{};
        export const configureNativeConnection=()=>{};
        export const AndroidConnection={
          state:async()=>{const f=window.managedFixture;f.stateCalls=(f.stateCalls||0)+1;return f.holdState?new Promise(resolve=>{f.releaseState=resolve}):f.state},
          addListener:async(_event,listener)=>{window.managedFixture.emit=state=>{window.managedFixture.state=state;listener(state)};return{remove:async()=>{}}},
          preview:async()=>{const f=window.managedFixture;f.previewCalls=(f.previewCalls||0)+1;if(f.previewError)throw Object.assign(new Error('Managed blocked'),{code:f.previewError});if(!f.previewMode)throw Object.assign(new Error('Managed conflict'),{code:'MANAGED_CONFLICT'});const result={organizationName:'Synthetic agency',unitName:'Synthetic unit',callSign:'SYNTHETIC-1',origin:'https://ambulance.example'};return f.previewMode==='held'?new Promise(resolve=>{f.releasePreview=()=>resolve(result)}):result},
          confirm:async()=>{const f=window.managedFixture;f.confirmCalls=(f.confirmCalls||0)+1;if(f.confirmError)throw Object.assign(new Error('Managed blocked'),{code:f.confirmError});if(f.holdConfirm)return new Promise(resolve=>{f.releaseConfirm=()=>resolve({configured:true})});f.state={...f.state,configured:true};return{configured:true}},
          cancel:async()=>{}
        };
      `}));
    }}], stdin: {resolveDir: path.resolve(__dirname, '..'), loader: 'tsx', contents: `import React from 'react';import{createRoot}from'react-dom/client';import{AndroidRuntimeGate}from'./components/android-runtime-gate';createRoot(document.getElementById('root')).render(<AndroidRuntimeGate><main data-clinical>Shared clinical workspace</main></AndroidRuntimeGate>);`}});
  script = bundled.outputFiles[0]!.text;
});

for (const language of ['en', 'sv']) test(`${language} managed connection is locked, compact and blocks stale clinical context`, async ({page, context}, testInfo) => {
  await context.route('**/__managed-script', route => route.fulfill({contentType: 'text/javascript', body: script}));
  await context.route('**/__managed', route => route.fulfill({contentType: 'text/html', body: `<html lang="${language}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>window.managedFixture={state:{configured:false,managed:true,managedStatus:'valid',managedOrigin:'https://ambulance.example',managedContext:'context-a'}};Object.defineProperty(navigator,'language',{value:'${language}'});</script><script src="/__managed-script"></script></body></html>`}));
  await page.goto('/__managed');
  const t = (en: string, sv: string) => language === 'sv' ? sv : en;
  await expect(page.getByRole('status')).toContainText(t('Connection managed by your organization', 'Anslutningen hanteras av din organisation'));
  await expect(page.getByRole('status')).toContainText('https://ambulance.example');
  await expect(page.locator('input[type=url]')).toHaveCount(0);
  await page.setViewportSize({width: Math.min(testInfo.project.use.viewport?.width ?? 360, 390), height: 640});
  await page.evaluate(() => {
    for (const [name, value] of Object.entries({'--text-body': '18px', '--text-caption': '16px', '--text-heading': '28px', '--text-control': '20px'})) document.documentElement.style.setProperty(name, value);
  });
  const artifact = {version: 1, origin: 'https://different.example', token: 'A'.repeat(43), expiresAt: new Date(Date.now() + 240000).toISOString(), caPem: ''};
  await page.evaluate(artifact => { (window as unknown as {managedFixture: {artifact: string}}).managedFixture.artifact = JSON.stringify(artifact); }, artifact);
  await page.locator('[data-pairing-scan]').click();
  await expect(page.getByRole('alert')).toHaveText(t('Pairing conflicts with the managed connection.', 'Kopplingen stämmer inte med den hanterade anslutningen.'));
  await page.locator('input[type=file]').setInputFiles({name: 'pairing.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(artifact))});
  await expect(page.getByRole('alert')).toHaveText(t('Pairing conflicts with the managed connection.', 'Kopplingen stämmer inte med den hanterade anslutningen.'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: testInfo.outputPath(`managed-${language}-mobile.png`)});
  await page.evaluate(() => (window as unknown as {managedFixture: {emit: (value: unknown) => void}}).managedFixture.emit({configured: true, managed: true, managedStatus: 'valid', managedContext: 'context-a'}));
  await expect(page.locator('[data-clinical]')).toBeVisible();
  await page.evaluate(() => (window as unknown as {managedFixture: {emit: (value: unknown) => void}}).managedFixture.emit({configured: false, managed: true, managedStatus: 'missing', blocked: true}));
  await expect(page.locator('[data-clinical]')).toHaveCount(0);
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveText(t('Managed settings are missing. Contact IT.', 'Hanterade inställningar saknas. Kontakta IT.'));
});


type ManagedFixture = {
  state: Record<string, unknown>; emit(value: Record<string, unknown>): void;
  holdState?: boolean; releaseState?(value: unknown): void; stateCalls?: number;
  previewMode?: string; releasePreview?(): void; previewCalls?: number;
  holdConfirm?: boolean; releaseConfirm?(): void; confirmCalls?: number;
  holdScan?: boolean; releaseScan?(): void;
};
const validState = {configured: false, managed: true, managedStatus: 'valid', managedOrigin: 'https://ambulance.example', managedContext: 'context-a'};
const blockedState = {...validState, blocked: true, managedStatus: 'pending'};
const settleCallbacks = (page: import('@playwright/test').Page) => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const pairing = () => JSON.stringify({version: 1, origin: 'https://ambulance.example', token: 'A'.repeat(43), expiresAt: new Date(Date.now()+240000).toISOString(), caPem: ''});
async function startFixture(page: import('@playwright/test').Page, options: Record<string, unknown> = {}) {
  await page.route('**/__managed-script', route => route.fulfill({contentType: 'text/javascript', body: script}));
  await page.route('**/__managed-race', route => route.fulfill({contentType: 'text/html', body: `<html><body><div id="root"></div><script>window.managedFixture=${JSON.stringify({state: validState, artifact: pairing(), ...options})}</script><script src="/__managed-script"></script></body></html>`}));
  await page.goto('/__managed-race');
}

test('a late startup state cannot replace a newer managed block', async ({page}) => {
  await startFixture(page, {holdState: true});
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as {managedFixture: ManagedFixture}).managedFixture.releaseState))).toBe(true);
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  await page.evaluate(state => (window as unknown as {managedFixture: ManagedFixture}).managedFixture.emit(state), blockedState);
  await page.evaluate(state => (window as unknown as {managedFixture: ManagedFixture}).managedFixture.releaseState?.({...state, configured: true}), validState);
  await settleCallbacks(page);
  await expect(page.locator('[data-managed-status]')).toHaveAttribute('data-managed-status', 'pending');
  await expect(page.locator('[data-clinical],input[type=file]')).toHaveCount(0);
});

for (const operation of ['preview', 'confirm'] as const) test(`late ${operation} cannot reopen a changed managed context`, async ({page}) => {
  await startFixture(page, {previewMode: operation === 'preview' ? 'held' : 'success', holdConfirm: operation === 'confirm'});
  await page.locator('[data-pairing-scan]').click();
  if (operation === 'confirm') {
    await page.getByRole('textbox').fill('Synthetic ambulance');
    await page.getByRole('checkbox').check();
    await page.locator('button[type=submit]').click();
  }
  await expect.poll(() => page.evaluate(operation => Boolean((window as unknown as {managedFixture: ManagedFixture}).managedFixture[operation === 'preview' ? 'releasePreview' : 'releaseConfirm']), operation)).toBe(true);
  await page.evaluate(state => (window as unknown as {managedFixture: ManagedFixture}).managedFixture.emit(state), blockedState);
  await page.evaluate(operation => (window as unknown as {managedFixture: ManagedFixture}).managedFixture[operation === 'preview' ? 'releasePreview' : 'releaseConfirm']?.(), operation);
  await settleCallbacks(page);
  await expect(page.locator('[data-managed-status]')).toHaveAttribute('data-managed-status', 'pending');
  await expect(page.locator('[data-clinical],form,input[type=file]')).toHaveCount(0);
  // Restoring authority must not resurrect a stale preview from the old operation.
  await page.evaluate(state => (window as unknown as {managedFixture: ManagedFixture}).managedFixture.emit(state), {...validState, managedContext:'context-b'});
  await expect(page.locator('[data-pairing-scan]')).toBeVisible();
  await expect(page.locator('form,[data-clinical]')).toHaveCount(0);
});

test('unchanged resume preserves an in-flight scanned preview and confirmation', async ({page}) => {
  await startFixture(page, {previewMode: 'held', holdConfirm: true});
  await page.locator('[data-pairing-scan]').click();
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as {managedFixture: ManagedFixture}).managedFixture.releasePreview))).toBe(true);
  await page.evaluate(state => {const f=(window as unknown as {managedFixture: ManagedFixture}).managedFixture;f.emit(state);f.releasePreview?.();}, validState);
  await page.getByRole('textbox').fill('Synthetic ambulance');
  await page.getByRole('checkbox').check();
  await page.locator('button[type=submit]').click();
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as {managedFixture: ManagedFixture}).managedFixture.releaseConfirm))).toBe(true);
  await page.evaluate(state => {const f=(window as unknown as {managedFixture: ManagedFixture}).managedFixture;f.emit(state);f.state={...state,configured:true};f.releaseConfirm?.();}, validState);
  await expect(page.locator('[data-clinical]')).toBeVisible();
});


test('a delayed scanner result cannot preview after policy changed and was restored', async ({page}) => {
  await startFixture(page, {holdScan: true, previewMode: 'success'});
  await page.locator('[data-pairing-scan]').click();
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as {managedFixture: ManagedFixture}).managedFixture.releaseScan))).toBe(true);
  await page.evaluate(({blocked,valid}) => {const f=(window as unknown as {managedFixture: ManagedFixture}).managedFixture;f.emit(blocked);f.emit(valid);f.releaseScan?.();}, {blocked:blockedState,valid:validState});
  await settleCallbacks(page);
  await expect(page.locator('[data-pairing-scan]')).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as {managedFixture: ManagedFixture}).managedFixture.previewCalls ?? 0)).toBe(0);
  await expect(page.locator('form,[data-clinical]')).toHaveCount(0);
});


for (const operation of ['scan', 'import', 'confirm'] as const) test(`managed-blocked ${operation} rejection is localized before its policy event arrives`, async ({page}) => {
  await startFixture(page, operation === 'confirm' ? {previewMode:'success',confirmError:'MANAGED_BLOCKED'} : {previewError:'MANAGED_BLOCKED'});
  if (operation === 'import') await page.locator('input[type=file]').setInputFiles({name:'pairing.json',mimeType:'application/json',buffer:Buffer.from(pairing())});
  else {
    await page.locator('[data-pairing-scan]').click();
    if (operation === 'confirm') {await page.getByRole('textbox').fill('Synthetic ambulance');await page.getByRole('checkbox').check();await page.locator('button[type=submit]').click();}
  }
  await expect(page.getByRole('alert')).toHaveText('Managed settings are unavailable. Contact IT.');
  await expect(page.locator('[data-clinical]')).toHaveCount(0);
});
