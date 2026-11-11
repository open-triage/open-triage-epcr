import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

for (const language of ['en', 'sv']) test(`TLS failure keeps the mounted clinical edit and clears after verified recovery in ${language}`, async ({ page }) => {
  const css = await readFile(path.resolve(__dirname, '../app/styles.css'), 'utf8');
  const bundled = await build({ bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    stdin: { resolveDir: path.resolve(__dirname, '..'), loader: 'tsx', contents: `
      import React,{useEffect,useState} from 'react';import{createRoot}from'react-dom/client';
      import{AndroidTlsNotice}from'./components/android-tls-notice';
      import{androidFetch}from'./app/android-runtime';
      function Workspace(){const[value,setValue]=useState('');useEffect(()=>{window.mounts=(window.mounts||0)+1},[]);return <label>Clinical edit<input value={value} onChange={event=>setValue(event.target.value)}/></label>}
      const transport=androidFetch(window.fetch,async()=>{if(window.bridgeError)throw window.bridgeError;return{status:200,headers:{},body:'{}'}},location.origin);
      window.tlsFailed=async error=>{window.bridgeError=error;try{await transport('/api/health')}catch{}};
      window.connectionRecovered=async()=>{window.bridgeError=null;await transport('/api/health')};
      createRoot(document.getElementById('root')).render(<><AndroidTlsNotice/><Workspace/></>);` } });
  await page.route('**/__tls-connection', route => route.fulfill({ contentType: 'text/html', body: `<html lang="${language}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${bundled.outputFiles[0]!.text}</script></body></html>` }));
  await page.goto('/__tls-connection');
  await page.getByLabel('Clinical edit').fill('SYNTHETIC-UNSYNCHRONIZED-EDIT');
  await page.evaluate(() => (window as unknown as { tlsFailed(error: unknown): void }).tlsFailed({ code: 'TLS_FAILED', message: 'PRIVATE-CERTIFICATE-DETAILS' }));
  await expect(page.getByRole('alert')).toContainText(language === 'sv' ? 'Säker anslutning misslyckades' : 'Secure connection failed');
  await expect(page.getByLabel('Clinical edit')).toHaveValue('SYNTHETIC-UNSYNCHRONIZED-EDIT');
  await expect(page.getByRole('alert')).not.toContainText('PRIVATE');
  expect(await page.evaluate(() => (window as unknown as { mounts: number }).mounts)).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`tls-notice-${language}.png`) });
  await page.evaluate(() => (window as unknown as { connectionRecovered(): void }).connectionRecovered());
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('Clinical edit')).toHaveValue('SYNTHETIC-UNSYNCHRONIZED-EDIT');
  expect(await page.evaluate(() => (window as unknown as { mounts: number }).mounts)).toBe(1);
});
