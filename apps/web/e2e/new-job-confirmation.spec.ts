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
 script = (await build({ bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env': JSON.stringify({ NEXT_PUBLIC_API_URL: 'same-origin' }) }, stdin: { resolveDir: path.resolve(__dirname, '..'), loader: 'tsx', contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ClinicianSessionGate}from'./components/clinician-session-gate';import{openAssignedCall,createNewPatientReport}from'./app/assigned-calls';Object.assign(window,{runDelayedOpen:()=>openAssignedCall('csrf','10000000-0000-4000-8000-000000000001',async reminder=>{window.reminderFromDelayedRequest=reminder.clinicianName;return reminder.token}).catch(()=>{}).finally(()=>{window.delayedOpenSettled=true}),runDelayedCreate:session=>createNewPatientReport(session).then(()=>{window.createdReportAfterSwitch=true}).catch(()=>{}).finally(()=>{window.delayedOpenSettled=true})});createRoot(document.getElementById('root')).render(<ClinicianSessionGate><p>Protected editor</p></ClinicianSessionGate>);` } })).outputFiles[0]!.text;
});
const jobs = [1, 2].map(i => ({ ...assigned.assignedCalls[0], id: `10000000-0000-4000-8000-00000000000${i}`, callNumber: `GRACE-${i}` }));
for (const source of ['local', 'oidc'] as const) for (const language of ['en', 'sv'] as const) for (const width of [390, 1440]) test(`${source} per-attempt grace Continue, cancellation, changed context and safe Switch in ${language} at ${width}px`, async ({ page, context }) => {
 await page.setViewportSize({ width, height: 844 });
 const session = { authenticationSource: source, csrfToken: 'csrf', user: { id: 'clinician', displayName: 'Outgoing clinician' }, organization: { id: 'agency', name: 'Fictional agency' }, startedAt: '2026-10-13T06:44:00Z', personallyAuthenticatedAt: '2026-10-13T06:44:00Z', expiresAt: '2099-01-01T00:00:00Z', capabilities: ['clinical:document'], workspaceAvailable: true };
 let current: typeof session | null = session, tokens = 0, creations = 0, stale = true, sessionEnded = false;
 await context.addInitScript(session => localStorage.setItem('open-triage.clinician-session.v1', JSON.stringify(session)), session);
 await context.route('**/__grace-script', r => r.fulfill({ contentType: 'text/javascript', body: script }));
 await context.route('**/__grace', r => r.fulfill({ contentType: 'text/html', body: `<html lang="${language}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}:root{--green:#663399;--green-dark:#442266}</style></head><body><div id="root"></div><script src="/__grace-script"></script></body></html>` }));
 await context.route('**/api/installation', r => r.fulfill({ json: { settings: { ...settings, language }, appearance: { ...DEFAULT_AGENCY_APPEARANCE, accentColor: "#663399", accentDarkColor: "#442266" } } }));
 await context.route('**/api/sessions/authentication-options', r => r.fulfill({ json: { organization: source === 'oidc' } }));
 await context.route('**/api/sessions/current', r => { if (r.request().method() === 'DELETE') { current = null; sessionEnded = true; return r.fulfill({ json: { ended: true } }); } return current ? r.fulfill({ json: current }) : r.fulfill({ status: 401 }); });
 await context.route('**/api/reports/open', r => r.fulfill({ json: { openCalls: [], completedReportIds: [], refreshedAt: new Date().toISOString() } }));
 await context.route('**/api/calls/assigned', r => r.fulfill({ json: { assignedCalls: jobs, canceledAssignmentIds: [], refreshedAt: new Date().toISOString(), productionAccess: { state: 'identity-confirmation-required', unit: { id: 'unit', callSign: 'Enrolled 18', name: 'Unit', organizationId: 'agency' } } } }));
 await context.route('**/api/calls/new-job-confirmations', r => { if (r.request().method() === 'DELETE') return r.fulfill({ json: { canceled: true } }); tokens++; expect(r.request().postDataJSON().target).toBe(`assignment:${jobs[0]!.id}`); return r.fulfill({ json: { token: `attempt-${tokens}`, clinicianName: 'Outgoing clinician', unit: { id: 'unit', callSign: 'Enrolled 18', name: 'Unit', organizationId: 'agency' } } }); });
 await context.route(`**/api/calls/${jobs[0]!.id}/open`, r => {
  const token = r.request().headers()['x-job-confirmation'];
  if (!token || stale) { if (token) stale = false; return r.fulfill({ status: 403, json: { code: 'calls.identityConfirmationRequired' } }); }
  creations++; return r.fulfill({ status: 409, json: { code: 'calls.shiftReauthenticationRequired' } });
 });
 await context.route('**/api/sessions/oidc/login', r => { expect(r.request().postDataJSON().purpose).toBe('switch'); current = null; sessionEnded = true; return r.fulfill({ json: { authorizationUrl: 'https://grace-idp.fixture.test/authorize' } }); });
 await context.route('https://grace-idp.fixture.test/authorize', r => r.fulfill({ contentType: 'text/html', body: '<p>Personal provider authentication</p>' }));
 const other = await context.newPage(); await other.goto('/__grace');
 await page.goto('/__grace'); await expect(page.getByText('GRACE-1', { exact: true })).toBeVisible();
 const trigger = page.locator(`[data-assignment-id="${jobs[0]!.id}"]`).getByRole('button', { name: language === 'en' ? 'Open call' : 'Öppna uppdrag', exact: true });
 await trigger.focus(); await page.keyboard.press('Enter');
 const dialog = page.getByRole('dialog', { name: language === 'en' ? 'Confirm clinician and unit' : 'Bekräfta kliniker och enhet' });
 await expect(dialog).toContainText('Outgoing clinician'); await expect(dialog).toContainText('Enrolled 18');
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 await expect(dialog.getByRole("button", { name: language === "en" ? "Continue as Outgoing clinician" : "Fortsätt som Outgoing clinician" })).toHaveCSS("background-color", "rgb(102, 51, 153)");
 await page.screenshot({ path: `/tmp/auth018-reminder-${source}-${language}-${width}.png`, fullPage: true });
 await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); expect(creations).toBe(0);
 await expect(trigger).toBeFocused(); await trigger.click(); await expect.poll(() => tokens).toBe(2);
 const proceed = dialog.getByRole('button', { name: language === 'en' ? 'Continue as Outgoing clinician' : 'Fortsätt som Outgoing clinician' });
 await proceed.click(); await expect(dialog).toBeVisible(); await expect.poll(() => tokens).toBe(3); // Context changed while displayed: another reminder.
 await proceed.click(); await expect(dialog).not.toBeVisible(); expect(creations).toBe(1);
 expect(await page.evaluate(() => JSON.parse(localStorage.getItem('open-triage.clinician-session.v1')!).personallyAuthenticatedAt)).toBe(session.personallyAuthenticatedAt);
 await trigger.click(); await expect(dialog).toBeVisible(); await expect.poll(() => tokens).toBe(4);
 await dialog.getByRole('button', { name: language === 'en' ? 'Switch user' : 'Byt användare' }).click();
 if (source === 'oidc') await expect(page.getByText('Personal provider authentication')).toBeVisible();
 else await expect(page.getByLabel(language === 'en' ? 'Username' : 'Användarnamn')).toBeVisible();
 await expect.poll(() => sessionEnded).toBe(true); await expect.poll(() => other.evaluate(() => localStorage.getItem('open-triage.clinician-session.v1'))).toBeNull();
 await expect(other.getByText('Signed in as Outgoing clinician')).toHaveCount(0);
});

for (const bodyKind of ['reminder', 'created report', 'reopened report']) test(`a delayed ${bodyKind} JSON body cannot display outgoing identity after another tab switches`, async ({ page, context }) => {
 const session = { authenticationSource: 'local', csrfToken: 'csrf', user: { id: 'outgoing', displayName: 'Outgoing delayed clinician' }, organization: { id: 'agency', name: 'Agency' }, startedAt: '2026-10-13T06:44:00Z', expiresAt: '2099-01-01T00:00:00Z', capabilities: ['clinical:document'] };
 let ended = false, createdAfterSwitch = false, reopenedAfterSwitch = false;
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
 await context.route(`**/api/calls/${jobs[0]!.id}/open`, r => { if (r.request().headers()['x-job-confirmation']) { createdAfterSwitch = true; return r.fulfill({ json: { assignmentId: jobs[0]!.id } }); } return r.fulfill({ status: 403, json: { code: 'calls.identityConfirmationRequired' } }); });
 await context.route('**/api/calls/new-job-confirmations', r => r.fulfill({ json: { token: 'delayed-token', clinicianName: session.user.displayName, unit: { id: 'unit', callSign: 'Unit', name: 'Unit', organizationId: 'agency' } } }));
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
   if (bodyKind === 'reminder' ? url.includes('/calls/new-job-confirmations') : bodyKind === 'created report' ? url.endsWith('/api/reports') : url.includes('/created-report/reopen')) {
    const json = response.json.bind(response);
    response.json = async () => { state.reminderJsonPending = true; await new Promise<void>(resolve => { state.releaseReminderBody = resolve; }); return json(); };
   }
   return response;
  };
 }, bodyKind);
 await page.evaluate(({ bodyKind, session }) => {
  const state = window as unknown as { runDelayedOpen: () => Promise<void>; runDelayedCreate: (session: unknown) => Promise<void> };
  void (bodyKind === 'reminder' ? state.runDelayedOpen() : state.runDelayedCreate(session));
 }, { bodyKind, session });
 await expect.poll(() => page.evaluate(() => (window as unknown as { reminderJsonPending: boolean }).reminderJsonPending)).toBe(true);
 await other.getByRole('button', { name: 'Log out', exact: true }).click();
 await expect.poll(() => ended).toBe(true); await expect(page.getByLabel('Username')).toBeVisible();
 await page.evaluate(() => (window as unknown as { releaseReminderBody: () => void }).releaseReminderBody());
 await expect.poll(() => page.evaluate(() => (window as unknown as { delayedOpenSettled: boolean }).delayedOpenSettled)).toBe(true);
 expect(await page.evaluate(() => (window as unknown as { reminderFromDelayedRequest?: string }).reminderFromDelayedRequest)).toBeUndefined();
 expect(createdAfterSwitch).toBe(false);
 expect(reopenedAfterSwitch).toBe(false);
 expect(await page.evaluate(() => (window as unknown as { createdReportAfterSwitch?: boolean }).createdReportAfterSwitch)).toBeUndefined();
 await expect(page.getByRole('dialog', { name: 'Confirm clinician and unit' })).toHaveCount(0);
 await expect(page.getByText('Outgoing delayed clinician', { exact: false })).toHaveCount(0);
});

for(const target of ['assigned','standalone'] as const)for(const width of [390,1440])test(`${target} cancellation returns focus to its initiating button after delayed cleanup at ${width}px`,async({page,context})=>{
 await page.setViewportSize({width,height:844});
 const session={authenticationSource:'local',csrfToken:'csrf',user:{id:'clinician',displayName:'Outgoing clinician'},organization:{id:'agency',name:'Fictional agency'},startedAt:'2026-10-13T06:44:00Z',personallyAuthenticatedAt:'2026-10-13T06:44:00Z',expiresAt:'2099-01-01T00:00:00Z',capabilities:['clinical:document'],workspaceAvailable:true};
 await context.addInitScript(session=>localStorage.setItem('open-triage.clinician-session.v1',JSON.stringify(session)),session);
 await context.route('**/__grace-script',r=>r.fulfill({contentType:'text/javascript',body:script}));
 await context.route('**/__grace',r=>r.fulfill({contentType:'text/html',body:`<html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/__grace-script"></script></body></html>`}));
 await context.route('**/api/installation',r=>r.fulfill({json:{settings:{...settings,language:'en'},appearance:DEFAULT_AGENCY_APPEARANCE}}));
 await context.route('**/api/sessions/authentication-options',r=>r.fulfill({json:{organization:false}}));
 await context.route('**/api/sessions/current',r=>r.fulfill({json:session}));
 await context.route('**/api/reports/open',r=>r.fulfill({json:{openCalls:[],completedReportIds:[],refreshedAt:new Date().toISOString()}}));
 await context.route('**/api/calls/assigned',r=>r.fulfill({json:{assignedCalls:jobs,canceledAssignmentIds:[],refreshedAt:new Date().toISOString()}}));
 await context.route(`**/api/calls/${jobs[0]!.id}/open`,r=>r.fulfill({status:403,json:{code:'calls.identityConfirmationRequired'}}));
 await context.route('**/api/reports',r=>r.fulfill({status:403,json:{code:'calls.identityConfirmationRequired'}}));
 let releaseReminder!:()=>void,releaseCleanup!:()=>void,reminderRequested=false,cleanupRequested=false;
 const reminderReleased=new Promise<void>(resolve=>{releaseReminder=resolve;}),cleanupReleased=new Promise<void>(resolve=>{releaseCleanup=resolve;});
 await context.route('**/api/calls/new-job-confirmations',async r=>{
  if(r.request().method()==='DELETE'){cleanupRequested=true;await cleanupReleased;return r.fulfill({json:{canceled:true}});}
  reminderRequested=true;await reminderReleased;return r.fulfill({json:{token:'delayed-attempt',clinicianName:session.user.displayName,unit:{id:'unit',callSign:'Fictional unit',name:'Unit',organizationId:'agency'}}});
 });
 await page.goto('/__grace');const trigger=target==='assigned'?page.locator(`[data-assignment-id="${jobs[0]!.id}"] > button`).first():page.locator('.open-reports > .assigned-calls-heading > button');
 await expect(trigger).toHaveText(target==='assigned'?'Open call':'New patient');
 await trigger.focus();await page.keyboard.press('Enter');await expect.poll(()=>reminderRequested).toBe(true);await expect(trigger).toBeDisabled();
 // Focus can leave a disabled trigger while the reminder request is in flight.
 await page.evaluate(()=>{document.body.tabIndex=-1;document.body.focus();});releaseReminder();
 const dialog=page.getByRole('dialog',{name:'Confirm clinician and unit'});await expect(dialog).toBeVisible();await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect.poll(()=>cleanupRequested).toBe(true);
 await expect(trigger).toBeDisabled();await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));releaseCleanup();
 await expect(trigger).toBeEnabled();await expect(trigger).toBeFocused();
});
