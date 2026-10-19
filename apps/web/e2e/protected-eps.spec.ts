import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
let script: string, css: string;
test.beforeAll(async () => {
  css = await readFile(path.resolve(__dirname, '../app/styles.css'), 'utf8');
  script = (await build({ bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env': JSON.stringify({ NEXT_PUBLIC_API_URL: 'same-origin' }) }, stdin: { resolveDir: path.resolve(__dirname, '..'), loader: 'tsx', contents: `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{PatientSummaryButton}from'./components/patient-summary';
import{prepareProtectedReport,flushProtectedReport,lockProtectedClinicalStorage,protectedEps,protectedEpsPatientMapping,updateProtectedReport,recoverProtectedReport,updateProtectedShellState,protectedShellState,applyProtectedAuthorityResponse}from'./app/protected-clinical-storage';
import{patientSummaryDocumentKey}from'./app/patient-summary-identity';
const form={definition:{sections:[{fields:[{source:{kind:'nemsis',elementId:'ePatient.01'}}]}]},catalogFields:{'ePatient.01':{generation:{base:'string',definition:{valueSource:{kind:'scalar'}}}}}};
const encounterDocument=(patient,other='')=>JSON.stringify({groups:[{instances:[{elements:[{id:'ePatient.01',values:[{kind:'scalar',value:patient}]},{id:'other',values:[{kind:'scalar',value:other}]}]}]}]});
function Fixture(){const [scope,setScope]=useState({reportId:'report',organizationId:'agency',userId:'clinician',documentKey:encounterDocument('patient-A')});
Object.assign(window,{prepare:()=>prepareProtectedReport('csrf','report'),prepareOther:()=>prepareProtectedReport('csrf','other-report'),lockReport:()=>applyProtectedAuthorityResponse('report',{status:403}),flush:()=>flushProtectedReport('report'),lock:lockProtectedClinicalStorage,shell:()=>protectedShellState('report'),pending:()=>{updateProtectedShellState('report',{marker:'pending'});updateProtectedReport('report',{report:{id:'report'},queuedChanges:[{command:{note:'pending'}}]});return flushProtectedReport('report');},recover:()=>recoverProtectedReport('csrf','report'),change:next=>setScope({...next,documentKey:encounterDocument(next.documentKey)}),edit:()=>setScope({...scope,documentKey:encounterDocument('patient-A','new unrelated vitals')}),cache:()=>protectedEps({...scope,documentKey:patientSummaryDocumentKey(scope.documentKey,protectedEpsPatientMapping(scope),form)})});
return <PatientSummaryButton {...scope} form={form} ready language={document.documentElement.lang}/>;}
createRoot(document.getElementById('root')).render(<Fixture/>);` } })).outputFiles[0]!.text;
});
const source = { title: 'Fictional patient summary', patient: 'PRIVATE ANDREA', source: 'Fictional source', authors: ['Fictional clinician'], date: '2026-01-02', findings: [], clinicalSections: [{ title: 'Allergies', content: 'PRIVATE ALLERGY' }], sections: [] };
const binding = { reportId: 'report', organizationId: 'agency', binding: 'patient-A-config-1', configurationRevision: 1, mappingId: 'map', mappingRevision: 1, mappingSha256: 'digest', patientIdentifier: { field: { kind: 'nemsis', elementId: 'ePatient.01' }, namespace: 'urn:fixture', aliases: [] } };
type Fixture = { prepare(): Promise<boolean>; prepareOther(): Promise<boolean>; lockReport(): void; flush(): Promise<void>; lock(): Promise<void>; pending(): Promise<void>; shell(): unknown; recover(): Promise<unknown>; cache(): unknown; edit(): void; change(scope: unknown): void };
for (const language of ['en', 'sv']) test(`protected EPS open, offline, refresh and expiry at ${language}`, async ({ page, context }) => {
  await page.clock.install();
  let count = 0, deny = false, unavailable = false;
  const deadline = new Date(Date.now() + 120_000).toISOString();
  await page.route('**/__eps-offline', route => route.fulfill({ contentType: 'text/html', body: `<html lang="${language}"><head><style>${css}</style></head><body><div id="root"></div><script src="/__eps-script"></script></body></html>` }));
  await page.route('**/__eps-script', route => route.fulfill({ contentType: 'text/javascript', body: script }));
  await page.route('**/api/reports/*/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/eps/imports/history')) return route.fulfill({ json: { items: [], inconsistent: false } });
    if (url.pathname.endsWith('/eps/imports')) return route.fulfill({ json: { rows: [], inconsistent: false } });
    if (url.pathname.endsWith('/eps/context')) return route.fulfill(deny ? { status: 403 } : { json: binding });
    if (url.pathname.endsWith('/eps')) { if (unavailable) return route.fulfill({ status: 503 }); count++; return route.fulfill({ json: { context: binding, status: 'available', summary: source, retrievedAt: `2026-10-19T10:00:0${count}Z`, documentId: 'document' } }); }
    if (url.pathname.endsWith('/protected-key-envelope')) return route.fulfill({ json: { schemaVersion: 1, recoveryHandle: route.request().postDataJSON().recoveryHandle, recoveryDeadline: deadline, wrappingKeyVersion: 1 } });
    return route.fulfill({ json: { schemaVersion: 1, recoveryDeadline: deadline } });
  });
  await page.goto('/__eps-offline'); await page.clock.runFor(800);
  expect(await page.evaluate(() => (window as unknown as Fixture).prepare())).toBe(true);
  const button = page.getByRole('button', { name: language === 'en' ? 'Patient summary (EPS)' : 'Patientöversikt (EPS)', exact: true });
  await expect(button).toBeEnabled();
  await button.click(); await expect(page.getByText('PRIVATE ANDREA')).toBeVisible();
  await page.evaluate(() => (window as unknown as Fixture).flush());
  const original = await page.evaluate(() => (window as unknown as Fixture).cache()); expect(original).not.toBeNull();
  const records = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('open-triage-protected-clinical-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    return new Promise<string[]>((resolve) => { const r = db.transaction('encrypted-reports').objectStore('encrypted-reports').getAll(); r.onsuccess = () => { resolve(r.result.map(value => JSON.stringify({ ...value, ciphertext: new TextDecoder().decode(value.ciphertext) }))); db.close(); }; });
  });
  expect(records.length).toBe(1); expect(records.join('')).not.toContain('PRIVATE'); expect(records.join('')).not.toContain('patient-A');
  await context.setOffline(true); await page.clock.runFor(400);
  await page.evaluate(() => (window as unknown as Fixture).edit());
  await page.clock.runFor(400);
  await expect(page.getByText('PRIVATE ANDREA')).toBeVisible();
  const refresh = page.getByRole('button', { name: language === 'en' ? 'Refresh summary' : 'Uppdatera sammanfattning' });
  await expect(refresh).toBeDisabled(); expect(count).toBe(1);
  await context.setOffline(false); await page.clock.runFor(400); expect(count).toBe(1);
  await refresh.click(); await page.clock.runFor(400); await expect(button).toBeEnabled(); await button.click();
  await expect(page.getByText('2026-10-19T10:00:02Z')).toBeVisible();
  expect((original as { retrievedAt: string }).retrievedAt).toBe('2026-10-19T10:00:01Z');
  unavailable = true; await refresh.click(); await page.clock.runFor(400); await expect(button).toBeEnabled(); await button.click();
  await expect(page.getByText('2026-10-19T10:00:02Z')).toBeVisible();
  await context.setOffline(true); await page.clock.runFor(121_000);
  await expect(page.getByText('PRIVATE ANDREA')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as Fixture).cache())).toBeNull();
  deny = true; await context.setOffline(false); await page.clock.runFor(400); await expect(button).toBeDisabled();
});

for (const transition of ['logout', 'user', 'agency', 'patient', 'revoked', 'configuration', 'recovery', 'pending-lock', 'quota', 'quota-unavailable', 'binding-race', 'refresh-race', 'retention-race', 'close-race', 'report-switch']) test(`protected EPS hides data after ${transition}`, async ({ page, context }) => {
  let denied = false, revision = 1, recoveryKey = '', recoveryHandle = '';
  let recoveryRequests = 0, heldResponse: Promise<void> | null = null, waiting = false;
  let release = () => {}, releaseContext = () => {}, releaseReceipt = () => {};
  let heldReceipt: Promise<void> | null = null, receiptWaiting = false;
  let heldContext: Promise<void> | null = null, contextWaiting = false, lookups = 0;
  await page.clock.install();
  await page.route('**/__eps-offline', route => route.fulfill({ contentType: 'text/html', body: '<html lang="en"><body><div id="root"></div><script src="/__eps-script"></script></body></html>' }));
  await page.route('**/__eps-script', route => route.fulfill({ contentType: 'text/javascript', body: script }));
  await page.route('**/api/reports/*/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/eps/imports/history')) return route.fulfill({ json: { items: [{ id: 'import', decision: 'import', destination: 'eHistory.06', source: 'PRIVATE IMPORT LINEAGE', documentId: 'source-document', documentVersion: '1' }], inconsistent: false } });
    if (url.pathname.endsWith('/eps/imports')) return route.fulfill({ json: { rows: [], inconsistent: false } });
    if (url.pathname.endsWith('/recovery-grants')) { recoveryRequests++; return route.fulfill({ json: { schemaVersion: 1, envelopeVersion: 1, recoveryHandle, grant: 'authorized', expiresAt: '2099-01-01', reportStatus: 'draft' } }); }
    if (url.pathname.endsWith('/recovery-grants/consume')) return route.fulfill({ json: { reportKeyBase64: recoveryKey, wrappingKeyVersion: 1 } });
    const selectedReport = url.pathname.split('/')[3]!;
    const current = { ...binding, reportId: selectedReport, binding: `${selectedReport}-patient-A-config-${revision}`, configurationRevision: revision };
    if (url.pathname.endsWith('/eps/context')) {
      if (heldContext) { const hold = heldContext; heldContext = null; contextWaiting = true; await hold; }
      return route.fulfill(denied ? { status: 403 } : { json: current });
    }
    if (url.pathname.endsWith('/eps') && heldResponse) { waiting = true; await heldResponse; }
    if (url.pathname.endsWith('/eps')) { lookups++; return revision > 1 && !['binding-race', 'retention-race'].includes(transition) ? route.abort('failed') : route.fulfill({ json: { context: current, status: 'available', summary: source, retrievedAt: `2026-10-19T10:00:0${lookups}Z` } }); }
    if (url.pathname.endsWith('/protected-key-envelope')) { const body = route.request().postDataJSON(); recoveryKey = body.reportKeyBase64; recoveryHandle = body.recoveryHandle; return route.fulfill({ json: { schemaVersion: 1, recoveryHandle, recoveryDeadline: '2099-01-01', wrappingKeyVersion: 1 } }); }
    if (url.pathname.endsWith('/protected-ciphertext-receipt') && heldReceipt) { const hold = heldReceipt; heldReceipt = null; receiptWaiting = true; await hold; }
    return route.fulfill({ json: { schemaVersion: 1, recoveryDeadline: '2099-01-01' } });
  });
  await page.goto('/__eps-offline'); await page.clock.runFor(800);
  await page.evaluate(() => (window as unknown as Fixture).prepare());
  if (transition.startsWith('quota')) await page.evaluate(failures => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function() {
      failures--;
      if (failures === 0) IDBObjectStore.prototype.put = original;
      void (window as unknown as Fixture).pending().catch(() => undefined);
      throw new DOMException('Simulated protected-storage pressure', 'QuotaExceededError');
    };
  }, transition === 'quota-unavailable' ? 2 : 1);
  if (transition === 'retention-race') heldReceipt = new Promise<void>(resolve => { releaseReceipt = resolve; });
  await page.getByRole('button', { name: 'Patient summary (EPS)', exact: true }).click();
  if (transition === 'retention-race') {
    await expect.poll(() => receiptWaiting).toBe(true);
    revision = 2; await page.clock.runFor(16000); await expect.poll(() => lookups).toBe(2);
    await page.getByRole('button', { name: 'Patient summary (EPS)', exact: true }).click();
    releaseReceipt(); await expect(page.getByText('2026-10-19T10:00:02Z')).toBeVisible();
    const cached = await page.evaluate(() => (window as unknown as Fixture).cache()) as { context: { configurationRevision: number }; retrievedAt: string };
    expect(cached.context.configurationRevision).toBe(2); expect(cached.retrievedAt).toBe('2026-10-19T10:00:02Z');
    return;
  }
  await expect(page.getByText('PRIVATE ANDREA')).toBeVisible();
  await expect(page.getByText('PRIVATE IMPORT LINEAGE')).toHaveCount(1);
  if (transition === 'report-switch') {
    await page.evaluate(() => (window as unknown as Fixture).prepareOther());
    await page.evaluate(() => (window as unknown as Fixture).lockReport());
    await expect(page.getByText('PRIVATE ANDREA')).toHaveCount(0);
    await expect(page.getByText('PRIVATE IMPORT LINEAGE')).toHaveCount(0);
    await page.evaluate(() => (window as unknown as Fixture).change({ reportId: 'other-report', organizationId: 'agency', userId: 'clinician', documentKey: 'patient-A' }));
    await page.clock.runFor(800);
    await page.getByRole('button', { name: 'Patient summary (EPS)', exact: true }).click();
    await expect(page.getByText('PRIVATE ANDREA')).toBeVisible();
    const cached = await page.evaluate(() => (window as unknown as Fixture).cache()) as { context: { reportId: string } };
    expect(cached.context.reportId).toBe('other-report'); return;
  }
  if (['binding-race', 'refresh-race', 'close-race'].includes(transition)) {
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    heldContext = new Promise<void>(resolve => { releaseContext = resolve; });
    const open = page.getByRole('button', { name: 'Patient summary (EPS)', exact: true });
    await open.click(); await expect.poll(() => contextWaiting).toBe(true);
    if (transition === 'binding-race') { revision = 2; await page.clock.runFor(16000); }
    else {
      // A second activation completes while the first context response is delayed.
      await open.click(); await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByRole('button', { name: transition === 'close-race' ? 'Close' : 'Refresh summary', exact: true }).click(); await page.clock.runFor(400);
    }
    const count = transition === 'close-race' ? 1 : 2;
    await expect.poll(() => lookups).toBe(count); await expect(open).toBeEnabled();
    releaseContext(); await page.clock.runFor(1000);
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await open.click(); await expect(page.getByText(`2026-10-19T10:00:0${count}Z`)).toBeVisible();
    const cached = await page.evaluate(() => (window as unknown as Fixture).cache()) as { context: { configurationRevision: number }; retrievedAt: string };
    expect(cached.retrievedAt).toBe(`2026-10-19T10:00:0${count}Z`);
    expect(cached.context.configurationRevision).toBe(transition === 'binding-race' ? 2 : 1);
    return;
  }
  if (transition.startsWith('quota')) {
    await expect(page.getByText('Online only: a protected offline copy is unavailable.')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as Fixture).cache())).toBeNull();
    await page.evaluate(() => (window as unknown as Fixture).flush());
    expect(await page.evaluate(() => (window as unknown as Fixture).shell())).toEqual({ marker: 'pending' });
    await page.evaluate(() => (window as unknown as Fixture).lock());
    const recovered = await page.evaluate(() => (window as unknown as Fixture).recover()) as { report: { queuedChanges: unknown[] }; eps?: unknown };
    expect(recovered.report.queuedChanges).toEqual([{ command: { note: 'pending' } }]);
    expect(recovered.eps).toBeUndefined();
    return;
  }
  if (transition === 'pending-lock') {
    heldResponse = new Promise<void>(resolve => { release = resolve; });
    await page.getByRole('button', { name: 'Refresh summary' }).click(); await page.clock.runFor(400);
    await expect.poll(() => waiting).toBe(true);
    await page.evaluate(() => (window as unknown as Fixture).lock());
    release(); await page.clock.runFor(16000);
    await expect(page.getByRole('button', { name: 'Patient summary (EPS)', exact: true })).toBeDisabled();
    await expect(page.getByText('PRIVATE ANDREA')).toHaveCount(0);
    await expect(page.getByText('PRIVATE IMPORT LINEAGE')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as Fixture).cache())).toBeNull();
    return;
  }
  if (transition === 'recovery') {
    await page.evaluate(() => (window as unknown as Fixture).pending());
    await page.evaluate(() => (window as unknown as Fixture).lock());
    expect(await page.evaluate(() => (window as unknown as Fixture).cache())).toBeNull();
    await page.evaluate(() => (window as unknown as Fixture).recover());
    expect(recoveryRequests).toBe(1);
    await context.setOffline(true); await page.clock.runFor(400);
    await page.getByRole('button', { name: 'Patient summary (EPS)', exact: true }).click();
    await expect(page.getByText('PRIVATE ANDREA')).toBeVisible();
    await expect(page.getByText('2026-10-19T10:00:01Z')).toBeVisible();
    return;
  }
  if (transition === 'revoked' || transition === 'configuration') { denied = transition === 'revoked'; revision = 2; await page.clock.runFor(16000); }
  else if (transition === 'logout') await page.evaluate(() => (window as unknown as Fixture).lock());
  else {
    await context.setOffline(true);
    await page.evaluate(kind => (window as unknown as Fixture).change({ reportId: 'report', organizationId: kind === 'agency' ? 'other' : 'agency', userId: kind === 'user' ? 'other' : 'clinician', documentKey: kind === 'patient' ? 'patient-B' : 'patient-A' }), transition);
    await page.clock.runFor(400);
  }
  await expect(page.getByText('PRIVATE ANDREA')).toHaveCount(0);
    if (transition !== 'configuration') await expect(page.getByText('PRIVATE IMPORT LINEAGE')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as Fixture).cache())).toBeNull();
});


test('first-time unavailable EPS is never fabricated or stored', async ({ page, context }) => {
  await page.route('**/__eps-offline', route => route.fulfill({ contentType: 'text/html', body: '<html lang="en"><body><div id="root"></div><script src="/__eps-script"></script></body></html>' }));
  await page.route('**/__eps-script', route => route.fulfill({ contentType: 'text/javascript', body: script }));
  await context.setOffline(true);
  await page.goto('/__eps-offline');
  await expect(page.getByRole('button', { name: 'Patient summary (EPS)' })).toBeDisabled();
  await expect(page.getByText('PRIVATE ANDREA')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as Fixture).cache())).toBeNull();
});
