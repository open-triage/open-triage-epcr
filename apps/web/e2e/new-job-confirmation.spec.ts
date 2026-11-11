import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import settings from '@open-triage/contracts/config/installation.production.json';
import { DEFAULT_AGENCY_APPEARANCE } from '@open-triage/contracts';
import assigned from '../public/demo-assigned-calls.json';
let script: string, css: string;
test.beforeAll(async () => {
 css = await readFile(path.resolve(__dirname, '../app/styles.css'), 'utf8');
 script = (await build({ bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env': JSON.stringify({ NEXT_PUBLIC_API_URL: 'same-origin' }) }, stdin: { resolveDir: path.resolve(__dirname, '..'), loader: 'tsx', contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ClinicianSessionGate}from'./components/clinician-session-gate';import{openAssignedCall,createNewPatientReport}from'./app/assigned-calls';Object.assign(window,{runDelayedOpen:()=>openAssignedCall('csrf','10000000-0000-4000-8000-000000000001').then(()=>{window.createdReportAfterSwitch=true}).catch(()=>{}).finally(()=>{window.delayedOpenSettled=true}),runDelayedCreate:session=>createNewPatientReport(session).then(()=>{window.createdReportAfterSwitch=true}).catch(()=>{}).finally(()=>{window.delayedOpenSettled=true})});createRoot(document.getElementById('root')).render(<ClinicianSessionGate><p>Protected editor</p></ClinicianSessionGate>);` } })).outputFiles[0]!.text;
});
const jobs = [1, 2].map(i => ({ ...assigned.assignedCalls[0], id: `10000000-0000-4000-8000-00000000000${i}`, callNumber: `GRACE-${i}` }));
for (const bodyKind of ['assignment', 'created report', 'reopened report']) test(`a delayed ${bodyKind} JSON body cannot display outgoing identity after another tab switches`, async ({ page, context }) => {
 const session = { authenticationSource: 'local', csrfToken: 'csrf', user: { id: 'outgoing', displayName: 'Outgoing delayed clinician' }, organization: { id: 'agency', name: 'Agency' }, startedAt: '2026-10-13T06:44:00Z', expiresAt: '2099-01-01T00:00:00Z', capabilities: ['clinical:document'] };
 let ended = false, reopenedAfterSwitch = false;
 await context.addInitScript(session => localStorage.setItem('open-triage.clinician-session.v1', JSON.stringify(session)), session);
 await context.route('**/__grace-script', r => r.fulfill({ contentType: 'text/javascript', body: script }));
 await context.route('**/__grace', r => r.fulfill({ contentType: 'text/html', body: '<html lang="en"><body><div id="root"></div><script src="/__grace-script"></script></body></html>' }));
 await context.route('**/api/installation', r => r.fulfill({ json: { settings, appearance: DEFAULT_AGENCY_APPEARANCE } }));
 await context.route('**/api/sessions/authentication-options', r => r.fulfill({ json: { organization: false } }));
 await context.route('**/api/sessions/current', r => {
  if (r.request().method() === 'DELETE') { ended = true; return r.fulfill({ json: { ended: true } }); }
  return ended ? r.fulfill({ status: 401 }) : r.fulfill({ json: session });
 });
 await context.route('**/api/reports/open', r => r.fulfill({ json: { openCalls: [], completedReportIds: [], refreshedAt: new Date().toISOString() } }));
 await context.route('**/api/calls/assigned', r => r.fulfill({ json: { assignedCalls: [jobs[0]], canceledAssignmentIds: [], refreshedAt: new Date().toISOString() } }));
 await context.route(`**/api/calls/${jobs[0]!.id}/open`, r => r.fulfill({ json: { assignmentId: jobs[0]!.id, report: { id: 'created-report' } } }));
 await context.route('**/api/reports', r => r.fulfill({ status: 201, json: { id: 'created-report' } }));
 await context.route('**/api/reports/created-report/reopen', r => { reopenedAfterSwitch ||= ended; return r.fulfill({ json: { report: { id: 'created-report', documentingUserId: session.user.id } } }); });
 await page.goto('/__grace'); const other = await context.newPage(); await other.goto('/__grace');
 await expect(page.getByText('GRACE-1', { exact: true })).toBeVisible();
 await page.evaluate(bodyKind => {
  const state = window as unknown as { reminderJsonPending: boolean; releaseReminderBody: () => void };
  const original = window.fetch;
  window.fetch = async (...args) => {
   const response = await original(...args);
   const url = String(args[0]);
   if (bodyKind === 'assignment' ? url.includes('/calls/') && url.endsWith('/open') : bodyKind === 'created report' ? url.endsWith('/api/reports') : url.includes('/created-report/reopen')) {
    const json = response.json.bind(response);
    response.json = async () => { state.reminderJsonPending = true; await new Promise<void>(resolve => { state.releaseReminderBody = resolve; }); return json(); };
   }
   return response;
  };
 }, bodyKind);
 await page.evaluate(({ bodyKind, session }) => {
  const state = window as unknown as { runDelayedOpen: () => Promise<void>; runDelayedCreate: (session: unknown) => Promise<void> };
  void (bodyKind === 'assignment' ? state.runDelayedOpen() : state.runDelayedCreate(session));
 }, { bodyKind, session });
 await expect.poll(() => page.evaluate(() => (window as unknown as { reminderJsonPending: boolean }).reminderJsonPending)).toBe(true);
 await other.getByRole('button', { name: 'Log out', exact: true }).click();
 await expect.poll(() => ended).toBe(true); await expect(page.getByLabel('Username')).toBeVisible();
 await page.evaluate(() => (window as unknown as { releaseReminderBody: () => void }).releaseReminderBody());
 await expect.poll(() => page.evaluate(() => (window as unknown as { delayedOpenSettled: boolean }).delayedOpenSettled)).toBe(true);
 expect(await page.evaluate(() => (window as unknown as { reminderFromDelayedRequest?: string }).reminderFromDelayedRequest)).toBeUndefined();
 expect(reopenedAfterSwitch).toBe(false);
 expect(await page.evaluate(() => (window as unknown as { createdReportAfterSwitch?: boolean }).createdReportAfterSwitch)).toBeUndefined();
 await expect(page.getByRole('dialog', { name: 'Confirm clinician and unit' })).toHaveCount(0);
 await expect(page.getByText('Outgoing delayed clinician', { exact: false })).toHaveCount(0);
});
