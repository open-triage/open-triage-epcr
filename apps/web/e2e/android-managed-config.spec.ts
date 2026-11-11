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
      builder.onResolve({filter: /android-runtime$/}, () => ({path: 'native-fixture', namespace: 'managed-fixture'}));
      builder.onLoad({filter: /.*/, namespace: 'managed-fixture'}, () => ({loader: 'js', contents: `
        export const isAndroidRuntime=()=>true;
        export const installAndroidTransport=()=>{};
        export const AndroidConnection={
          state:async()=>window.managedFixture.state,
          addListener:async(_event,listener)=>{window.managedFixture.emit=state=>{window.managedFixture.state=state;listener(state)};return{remove:async()=>{}}},
          preview:async()=>{throw Object.assign(new Error('Managed conflict'),{code:'MANAGED_CONFLICT'})},cancel:async()=>{}
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
