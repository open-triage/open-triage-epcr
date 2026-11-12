import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';

type State = { revision: number; sha256: string; deadline: string; plaintext: boolean };
type Harness = { prepare: () => Promise<boolean>; report: (value: string) => Promise<void>; audio: () => Promise<void>;
  pause: () => void; resume: () => void; active: () => boolean; record: () => Promise<State>; change: () => Promise<boolean>; hold: () => Promise<void> };

async function harness(page: Page, { holdReceipt = false, holdCheckpoint = false, denyReceipt = false } = {}) {
  const bundle = await build({ bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env': JSON.stringify({ NEXT_PUBLIC_API_URL: 'same-origin' }) }, stdin: { resolveDir: path.resolve(__dirname, '..'), loader: 'ts', contents: `
    import {prepareProtectedReport,updateProtectedReport,flushProtectedReport,holdProtectedReportForCompletion,startProtectedAudioPreview,stageProtectedAudioChunk,protectedStorageActive,lockProtectedClinicalStorage} from './app/protected-clinical-storage';
    import {setNativeForeground} from './app/application-foreground';
    const reportId='synthetic-metadata';
    window.metadata={hold:async()=>{const release=await holdProtectedReportForCompletion(reportId);release()},prepare:()=>prepareProtectedReport('synthetic-csrf',reportId),report:async value=>{updateProtectedReport(reportId,{value});await flushProtectedReport(reportId)},audio:async()=>{await startProtectedAudioPreview(reportId,{captureId:crypto.randomUUID(),recorderContentType:'audio/webm',sourceContentType:'audio/webm',capturedAt:new Date().toISOString(),capturedUtcOffsetMinutes:0,durationMilliseconds:0,caption:'',interrupted:true,complete:false});await stageProtectedAudioChunk(reportId,{sequence:0,sourceBase64:btoa('SYNTHETIC-PRIVATE-AUDIO')},1000)},pause:()=>setNativeForeground(false),resume:()=>setNativeForeground(true),active:()=>protectedStorageActive(reportId),change:async()=>{await lockProtectedClinicalStorage();return prepareProtectedReport('replacement-csrf',reportId)},record:()=>new Promise((resolve,reject)=>{const open=indexedDB.open('open-triage-protected-clinical-v1');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,transaction=db.transaction('encrypted-reports','readonly'),request=transaction.objectStore('encrypted-reports').getAll();request.onsuccess=async()=>{const record=request.result[0];if(!record){resolve(null);return}const hash=await crypto.subtle.digest('SHA-256',record.ciphertext);resolve({revision:record.ciphertextRevision,sha256:[...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join(''),deadline:record.recoveryDeadline,plaintext:new TextDecoder().decode(record.ciphertext).includes('SYNTHETIC-PRIVATE')})};transaction.oncomplete=()=>db.close();}})};
    ` } });
  await page.route('**/__protected-metadata', route => route.fulfill({contentType:'text/html',body:`<html><body><script>${bundle.outputFiles[0]!.text}</script></body></html>`}));
  const calls = { receipt: [] as Array<{ciphertextRevision:number;ciphertextSha256:string;recoveryHandle:string;csrf:string}>, checkpoint: [] as Array<{ciphertextRevision:number;ciphertextSha256:string;recoveryHandle:string}> };
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  page.once('close', () => release());
  await page.route('**/api/**', async route => {
    const endpoint = new URL(route.request().url()).pathname;
    if (endpoint.endsWith('/protected-key-envelope')) return route.fulfill({json:{schemaVersion:1,recoveryHandle:route.request().postDataJSON().recoveryHandle,recoveryDeadline:'2099-01-01T00:00:00Z',wrappingKeyVersion:1}});
    if (endpoint.endsWith('/protected-ciphertext-receipt')) {
      calls.receipt.push({...route.request().postDataJSON(),csrf:route.request().headers()['x-csrf-token']});
      if (holdReceipt && calls.receipt.length === 1) await gate;
      return route.fulfill(denyReceipt ? {status:401,json:{}} : {json:{schemaVersion:1,recoveryDeadline:'2099-01-02T00:00:00Z'}}).catch(() => undefined);
    }
    if (endpoint.endsWith('/protected-ciphertext-checkpoint')) { calls.checkpoint.push(route.request().postDataJSON()); if(holdCheckpoint&&calls.checkpoint.length===1)await gate; return route.fulfill({json:route.request().postDataJSON()}).catch(()=>undefined); }
    return route.fulfill({status:404,json:{}});
  });
  await page.goto('/__protected-metadata');
  expect(await page.evaluate(() => (window as unknown as {metadata:Harness}).metadata.prepare())).toBe(true);
  return { calls, release };
}

for (const kind of ['report', 'audio'] as const) test(`native pause preserves durable encrypted ${kind} writes without starting metadata requests until resume`, async ({page}) => {
  const { calls } = await harness(page);
  await page.evaluate(() => (window as unknown as {metadata:Harness}).metadata.pause());
  await page.evaluate(kind => kind === 'audio' ? (window as unknown as {metadata:Harness}).metadata.audio() : (window as unknown as {metadata:Harness}).metadata.report('SYNTHETIC-PRIVATE-REPORT'),kind);
  const before = await page.evaluate(() => (window as unknown as {metadata:Harness}).metadata.record());
  expect(before.revision).toBeGreaterThan(0); expect(before.plaintext).toBe(false);
  expect(calls.receipt).toHaveLength(0); expect(calls.checkpoint).toHaveLength(0);
  await page.evaluate(() => (window as unknown as {metadata:Harness}).metadata.resume());
  await expect.poll(() => calls.receipt.length).toBe(1);
  await expect.poll(() => calls.checkpoint.length).toBe(kind === 'report' ? 1 : 0);
  expect(calls.receipt[0]).toMatchObject({ciphertextRevision:before.revision,ciphertextSha256:before.sha256});
  const after = await page.evaluate(() => (window as unknown as {metadata:Harness}).metadata.record());
  expect(after).toEqual({...before,deadline:'2099-01-02T00:00:00Z'});
  await page.evaluate(() => {const h=(window as unknown as {metadata:Harness}).metadata;h.pause();h.resume();window.dispatchEvent(new Event('online'));});
  await page.waitForTimeout(150);
  expect(calls.receipt).toHaveLength(1); expect(calls.checkpoint).toHaveLength(kind === 'report' ? 1 : 0);
});

test('a pre-pause receipt may settle while paused but cannot start its checkpoint until resume', async ({page}) => {
  const { calls, release } = await harness(page,{holdReceipt:true});
  await page.evaluate(() => {void (window as unknown as {metadata:Harness}).metadata.report('SYNTHETIC-PRIVATE-REPORT');});
  await expect.poll(() => calls.receipt.length).toBe(1);
  await page.evaluate(() => {const h=(window as unknown as {metadata:Harness}).metadata;h.pause();h.resume();h.pause();h.resume();h.pause();});
  expect(calls.receipt).toHaveLength(1);expect(calls.checkpoint).toHaveLength(0);release();
  await page.waitForTimeout(150); expect(calls.checkpoint).toHaveLength(0);
  const before=await page.evaluate(() => (window as unknown as {metadata:Harness}).metadata.record());
  await page.evaluate(() => (window as unknown as {metadata:Harness}).metadata.resume());
  await expect.poll(() => calls.checkpoint.length).toBe(1);
  expect(calls.receipt).toHaveLength(1);
  expect(await page.evaluate(() => (window as unknown as {metadata:Harness}).metadata.record())).toEqual(before);
});

test('a held pre-pause receipt cannot block newer local encrypted durability or overwrite its deferred revision', async ({page}) => {
  const { calls, release }=await harness(page,{holdReceipt:true});
  await page.evaluate(() => {void (window as unknown as {metadata:Harness}).metadata.report('SYNTHETIC-PRIVATE-OLD');});
  await expect.poll(() => calls.receipt.length).toBe(1);
  await page.evaluate(() => {const h=(window as unknown as {metadata:Harness}).metadata;h.pause();(window as unknown as {durable?:boolean}).durable=false;void h.report('SYNTHETIC-PRIVATE-NEW').then(() => {(window as unknown as {durable:boolean}).durable=true;});});
  await expect.poll(() => page.evaluate(() => (window as unknown as {durable:boolean}).durable)).toBe(true);
  const before=await page.evaluate(() => (window as unknown as {metadata:Harness}).metadata.record());
  expect(before.revision).toBeGreaterThan(calls.receipt[0]!.ciphertextRevision);
  release(); await page.waitForTimeout(150); expect(calls.receipt).toHaveLength(1); expect(calls.checkpoint).toHaveLength(0);
  await page.evaluate(() => (window as unknown as {metadata:Harness}).metadata.resume());
  await expect.poll(() => calls.receipt.length).toBe(2); await expect.poll(() => calls.checkpoint.length).toBe(1);
  expect(calls.receipt[1]).toMatchObject({ciphertextRevision:before.revision,ciphertextSha256:before.sha256});
  expect(calls.checkpoint[0]).toMatchObject({ciphertextRevision:before.revision,ciphertextSha256:before.sha256});
});

test('an old in-flight checkpoint cannot clear or acknowledge a newer paused revision', async ({page}) => {
  const {calls,release}=await harness(page,{holdCheckpoint:true});
  await page.evaluate(()=>{void (window as unknown as {metadata:Harness}).metadata.report('SYNTHETIC-PRIVATE-OLD');});
  await expect.poll(()=>calls.checkpoint.length).toBe(1);
  await page.evaluate(async()=>{const h=(window as unknown as {metadata:Harness}).metadata;h.pause();await h.report('SYNTHETIC-PRIVATE-NEW');});
  const before=await page.evaluate(()=>(window as unknown as {metadata:Harness}).metadata.record());
  release();await page.waitForTimeout(150);expect(calls.receipt).toHaveLength(1);expect(calls.checkpoint).toHaveLength(1);
  await page.evaluate(()=>(window as unknown as {metadata:Harness}).metadata.resume());
  await expect.poll(()=>calls.receipt.length).toBe(2);await expect.poll(()=>calls.checkpoint.length).toBe(2);
  expect(calls.receipt[1]).toMatchObject({ciphertextRevision:before.revision,ciphertextSha256:before.sha256});
  expect(calls.checkpoint[1]).toMatchObject({ciphertextRevision:before.revision,ciphertextSha256:before.sha256});
});

test('a replacement context never drains a previous context task or accepts its late acknowledgement', async ({page}) => {
  const {calls,release}=await harness(page,{holdReceipt:true});
  await page.evaluate(()=>{void (window as unknown as {metadata:Harness}).metadata.report('SYNTHETIC-PRIVATE-OLD').catch(()=>undefined);});
  await expect.poll(()=>calls.receipt.length).toBe(1);
  await page.evaluate(async()=>{const h=(window as unknown as {metadata:Harness}).metadata;h.pause();await h.change();});
  release();
  await page.evaluate(async()=>{const h=(window as unknown as {metadata:Harness}).metadata;h.resume();await h.report('SYNTHETIC-PRIVATE-NEW');});
  await expect.poll(()=>calls.receipt.length).toBe(2);await expect.poll(()=>calls.checkpoint.length).toBe(1);
  expect(calls.receipt[0]!.csrf).toBe('synthetic-csrf');expect(calls.receipt[1]!.csrf).toBe('replacement-csrf');
  expect(calls.receipt[0]!.recoveryHandle).not.toBe(calls.receipt[1]!.recoveryHandle);
  expect(calls.checkpoint[0]!.recoveryHandle).toBe(calls.receipt[1]!.recoveryHandle);
});

test('resume does not register an expired pending encrypted write', async ({page}) => {
  await page.clock.install({time:new Date('2026-11-11T10:00:00Z')});
  const {calls}=await harness(page);
  await page.evaluate(async()=>{const h=(window as unknown as {metadata:Harness}).metadata;h.pause();await h.report('SYNTHETIC-PRIVATE-EXPIRED');});
  await page.clock.setSystemTime(new Date('2100-01-01T00:00:00Z'));
  await page.evaluate(() => (window as unknown as {metadata:Harness}).metadata.resume());
  expect(await page.evaluate(() => (window as unknown as {metadata:Harness}).metadata.active())).toBe(false);
  expect(calls.receipt).toHaveLength(0); expect(calls.checkpoint).toHaveLength(0);
});

test('a resumed authorization denial locks retained work without issuing a checkpoint', async ({page}) => {
  const {calls}=await harness(page,{denyReceipt:true});
  await page.evaluate(async()=>{const h=(window as unknown as {metadata:Harness}).metadata;h.pause();await h.report('SYNTHETIC-PRIVATE-DENIED');});
  const before=await page.evaluate(() => (window as unknown as {metadata:Harness}).metadata.record());
  expect(calls.receipt).toHaveLength(0);
  await page.evaluate(() => (window as unknown as {metadata:Harness}).metadata.resume());
  await expect.poll(() => calls.receipt.length).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as unknown as {metadata:Harness}).metadata.active())).toBe(false);
  expect(calls.checkpoint).toHaveLength(0);
  expect(await page.evaluate(() => (window as unknown as {metadata:Harness}).metadata.record())).toEqual(before);
});

test('completion cannot pass a deferred receipt while paused, and a failed hold does not block local durability', async ({page}) => {
  const {calls}=await harness(page);
  const denied=await page.evaluate(async()=>{const h=(window as unknown as {metadata:Harness}).metadata;h.pause();await h.report('SYNTHETIC-PRIVATE-FIRST');try{await h.hold();return false}catch{return true}});
  expect(denied).toBe(true);expect(calls.receipt).toHaveLength(0);
  await page.evaluate(()=>(window as unknown as {metadata:Harness}).metadata.report('SYNTHETIC-PRIVATE-SECOND'));
  const before=await page.evaluate(()=>(window as unknown as {metadata:Harness}).metadata.record());
  await page.evaluate(async()=>{const h=(window as unknown as {metadata:Harness}).metadata;h.resume();await h.hold();});
  expect(calls.receipt).toHaveLength(1);expect(calls.checkpoint).toHaveLength(1);
  expect(calls.receipt[0]).toMatchObject({ciphertextRevision:before.revision,ciphertextSha256:before.sha256});
});
