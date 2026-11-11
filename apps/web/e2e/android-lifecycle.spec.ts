import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import demoAssignedCalls from "../public/demo-assigned-calls.json";
import demoOpenAssignment from "../public/demo-open-assignment.json";
import productionSettings from "@open-triage/contracts/config/installation.production.json";
import { createHash } from "node:crypto";

for (const kind of ['audio', 'photo'] as const) for (const interruption of ['stream', 'radio'] as const) test(`${kind} verification interrupted by ${interruption} loss retries without permanently failing the saved note`, async ({ page }) => {
  const reportId = demoOpenAssignment.report.id, noteId = '92000000-0000-4000-8000-000000000001';
  const bytes = Buffer.from('synthetic canonical transport fixture'), sha256 = createHash('sha256').update(bytes).digest('hex');
  const capturedAt = new Date().toISOString(), contentType = kind === 'audio' ? 'audio/mp4' : 'image/jpeg';
  const session = { csrfToken: 'synthetic-csrf', user: { id: demoOpenAssignment.report.documentingUserId, displayName: 'Synthetic clinician' }, organization: { id: '32000000-0000-4000-8000-000000000001', name: 'Synthetic agency' }, capabilities: ['clinical:document'], workspaceAvailable: true, startedAt: capturedAt, expiresAt: '2099-01-01T00:00:00Z' };
  const note = { id: noteId, reportId, type: kind, caption: 'SYNTHETIC-TRANSPORT', capturedAt, capturedUtcOffsetMinutes: 0, author: session.user, serverReceivedAt: capturedAt, updatedAt: capturedAt, persistenceState: 'saved-on-device', contentType, byteSize: bytes.length, sha256, durationMilliseconds: 1000, width: 1, height: 1 };
  const command = { commandId: '93000000-0000-4000-8000-000000000001', expectedRevision: demoOpenAssignment.report.revision, noteId, capturedAt, capturedUtcOffsetMinutes: 0, caption: note.caption, sourceContentType: 'audio/webm', sourceBase64: bytes.toString('base64'), canonicalBase64: bytes.toString('base64'), contentType, sha256, width: 1, height: 1, settingsRevision: 1, effectiveAllowanceBytes: 1000000, effectiveImageLimitBytes: 1000000 };
  const bundle = await build({ bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env': JSON.stringify({ NEXT_PUBLIC_API_URL: 'same-origin' }) }, stdin: { resolveDir: path.resolve(__dirname, '..'), loader: 'tsx', contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import Home from './app/page';
    import {stageProtectedAudio,stageProtectedPhoto,protectedAudioEntries,protectedPhotoEntries} from './app/protected-clinical-storage';
    window.stageMedia=()=>${kind === 'audio' ? 'stageProtectedAudio' : 'stageProtectedPhoto'}(${JSON.stringify(reportId)},${JSON.stringify({note,command})});
    window.mediaState=()=>${kind === 'audio' ? 'protectedAudioEntries' : 'protectedPhotoEntries'}(${JSON.stringify(reportId)})[0]?.note.persistenceState;
    const originalFetch=window.fetch.bind(window);let interrupt=true;window.fetch=async(...args)=>{const response=await originalFetch(...args);if(interrupt&&/\\/(content|image)$/.test(String(args[0]))){interrupt=false;if(${JSON.stringify(interruption)}==='radio'){Object.defineProperty(navigator,'onLine',{configurable:true,value:false});window.dispatchEvent(new Event('offline'));Object.defineProperty(navigator,'onLine',{configurable:true,value:true});window.dispatchEvent(new Event('online'));throw new TypeError('Interrupted native response')}return new Response(new ReadableStream({start(controller){controller.error(new TypeError('Interrupted response stream'))}}),{status:response.status,headers:response.headers})}return response};
    createRoot(document.getElementById('root')).render(<Home/>);` } });
  await page.addInitScript(stored => localStorage.setItem('open-triage.clinician-session.v1', JSON.stringify(stored)), session);
  await page.route('**/__media-radio-loss', route => route.fulfill({contentType:'text/html',body:`<html><body><div id="root"></div><script>${bundle.outputFiles[0]!.text}</script></body></html>`}));
  let reads = 0, uploads = 0;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()).pathname;
    if (url === '/api/installation') return route.fulfill({json:{settings:productionSettings}});
    if (url === '/api/sessions/current') return route.fulfill({json:session});
    if (url === '/api/calls/assigned') return route.fulfill({json:demoAssignedCalls});
    if (url === '/api/reports/open') return route.fulfill({json:{openCalls:[{...demoOpenAssignment.report,reportId,callNumber:'SYNTHETIC-MEDIA',lastSavedAt:capturedAt,syncStatus:'saved',validationErrorCount:0}],completedReportIds:[],refreshedAt:capturedAt}});
    if (/\/calls\/[^/]+\/open$/.test(url)) { return route.fulfill({json:demoOpenAssignment}); }
    if (url.endsWith('/protected-key-envelope')) return route.fulfill({json:{schemaVersion:1,recoveryHandle:route.request().postDataJSON().recoveryHandle,recoveryDeadline:'2099-01-01T00:00:00Z',wrappingKeyVersion:1}});
    if (url.endsWith('/protected-ciphertext-receipt')) return route.fulfill({json:{schemaVersion:1,recoveryDeadline:'2099-01-01T00:00:00Z'}});
    if (url.endsWith('/protected-ciphertext-checkpoint')) return route.fulfill({json:route.request().postDataJSON()});
    if (url.endsWith(kind === 'audio' ? '/audio' : '/photos')) { uploads++; return route.fulfill({json:{reportId,revision:2,note:{...note,persistenceState:'ready'}}}); }
    if (url.endsWith(kind === 'audio' ? '/content' : '/image')) {
      reads++;
      return route.fulfill({contentType,body:bytes});
    }
    if (url.endsWith('/active')) return route.fulfill({status:304});
    return route.fulfill({status:404,json:{}});
  });
  await page.goto('/__media-radio-loss');
  await page.getByRole('button',{name:'Open call',exact:true}).first().click();
  await expect(page.locator('.sync-status')).toHaveText('Saved');
  await page.evaluate(() => (window as unknown as {stageMedia:()=>Promise<void>}).stageMedia());
  await expect.poll(() => page.evaluate(() => (window as unknown as {mediaState:()=>string}).mediaState())).toBe('ready');
  expect(reads).toBeGreaterThanOrEqual(2);
  expect(uploads).toBe(1);
});

test("native pause stops visible polling and resume refreshes once without overlapping requests", async ({ page }) => {
  const bundled = await build({ bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {useVisiblePolling} from './components/use-visible-polling';
      import {setNativeForeground} from './app/application-foreground';
      function Poller(){useVisiblePolling(()=>fetch('/foreground-refresh').then(()=>{}),1000);return <>
        <button onClick={()=>setNativeForeground(false)}>Pause native activity</button>
        <button onClick={()=>setNativeForeground(true)}>Resume native activity</button></>;}
      createRoot(document.getElementById('root')).render(<Poller/>);` } });
  await page.route("**/__native-lifecycle", route => route.fulfill({ contentType: "text/html", body: `<html><body><div id="root"></div><script>${bundled.outputFiles[0]!.text}</script></body></html>` }));
  let requests = 0;
  await page.route("**/foreground-refresh", route => { requests++; return route.fulfill({ body: "ok" }); });
  await page.clock.install();
  await page.goto("/__native-lifecycle");
  await expect.poll(() => requests).toBe(1);
  await page.getByRole("button", { name: "Pause native activity" }).click();
  await page.clock.fastForward(10000);
  expect(requests).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect(requests).toBe(1);
  await page.getByRole("button", { name: "Resume native activity" }).click();
  await expect.poll(() => requests).toBe(2);
  await page.clock.fastForward(1000);
  await expect.poll(() => requests).toBe(3);
});

test("offline native resume locks an expired readable report even when suspended timers did not fire", async ({ page, context }) => {
  const now = Date.now(), expires = now + 60000, reportId = demoOpenAssignment.report.id;
  const session = { csrfToken: "synthetic-csrf", user: { id: demoOpenAssignment.report.documentingUserId, displayName: "Synthetic clinician" },
    organization: { id: "32000000-0000-4000-8000-000000000001", name: "Synthetic agency" },
    capabilities: ["clinical:document"], workspaceAvailable: true, startedAt: new Date(now).toISOString(), expiresAt: new Date(expires).toISOString() };
  let opened = false;
  const bundled = await build({ bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env": JSON.stringify({ NEXT_PUBLIC_API_URL: "same-origin" }) },
    stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {ClinicianSessionGate} from './components/clinician-session-gate';
      import {setNativeForeground} from './app/application-foreground';
      import {protectedStorageActive} from './app/protected-clinical-storage';
      window.protectedActive=()=>protectedStorageActive(${JSON.stringify(reportId)});
      createRoot(document.getElementById('root')).render(<>
        <button onClick={()=>setNativeForeground(false)}>Pause native activity</button>
        <button onClick={()=>setNativeForeground(true)}>Resume native activity</button>
        <ClinicianSessionGate><p>SYNTHETIC-READABLE-WORKSPACE</p></ClinicianSessionGate></>);` } });
  await page.addInitScript(stored => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await page.route("**/__native-expiry", route => route.fulfill({ contentType: "text/html", body: `<html><body><div id="root"></div><script>${bundled.outputFiles[0]!.text}</script></body></html>` }));
  await page.route("**/api/**", route => route.fulfill({ status: 404, json: {} }));
  await page.route("**/api/installation", route => route.fulfill({ json: { settings: productionSettings } }));
  await page.route("**/api/sessions/current", route => route.fulfill({ json: session }));
  await page.route("**/api/calls/assigned", route => route.fulfill({ json: demoAssignedCalls }));
  await page.route("**/api/reports/open", route => route.fulfill({ json: { openCalls: opened ? [{
    reportId, callNumber: demoAssignedCalls.assignedCalls[0]!.callNumber, lastSavedAt: new Date().toISOString(), syncStatus: "saved", validationErrorCount: 0,
    revision: demoOpenAssignment.report.revision, formVersionId: demoOpenAssignment.report.formVersionId, catalogReleaseId: demoOpenAssignment.report.catalogReleaseId,
  }] : [], completedReportIds: [], refreshedAt: new Date().toISOString() } }));
  await page.route("**/api/calls/*/open", route => { opened = true; return route.fulfill({ json: demoOpenAssignment }); });
  await page.route(`**/api/reports/${reportId}/protected-key-envelope`, route => route.fulfill({ json: {
    schemaVersion: 1, recoveryHandle: route.request().postDataJSON().recoveryHandle, recoveryDeadline: "2099-01-01T00:00:00Z", wrappingKeyVersion: 1,
  } }));
  await page.route(`**/api/reports/${reportId}/protected-ciphertext-receipt`, route => route.fulfill({ json: { schemaVersion: 1, recoveryDeadline: "2099-01-01T00:00:00Z" } }));
  await page.route(`**/api/reports/${reportId}/protected-ciphertext-checkpoint`, route => route.fulfill({ json: route.request().postDataJSON() }));
  await page.clock.install({ time: now });
  await page.goto("/__native-expiry");
  await page.getByRole("button", { name: "Open call", exact: true }).first().click();
  await expect(page.getByText("SYNTHETIC-READABLE-WORKSPACE", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { protectedActive: () => boolean }).protectedActive())).toBe(true);
  await page.getByRole("button", { name: "Pause native activity" }).click();
  await context.setOffline(true);
  // A clock jump leaves timers untouched, matching a suspended WebView resuming after its deadline.
  await page.clock.setSystemTime(expires + 1000);
  await expect(page.getByText("SYNTHETIC-READABLE-WORKSPACE", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resume native activity" }).click();
  await expect(page.getByText("SYNTHETIC-READABLE-WORKSPACE", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { protectedActive: () => boolean }).protectedActive())).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem("open-triage.clinician-session.v1"))).toBeNull();
});

test("a clinical gate mounted while native-paused defers startup API requests until resume", async ({ page }) => {
  const bundled = await build({ bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env": JSON.stringify({ NEXT_PUBLIC_API_URL: "same-origin", NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION: "false" }) },
    stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {ClinicianSessionGate} from './components/clinician-session-gate';
      import {setNativeForeground} from './app/application-foreground';
      setNativeForeground(false);
      createRoot(document.getElementById('root')).render(<><button onClick={()=>setNativeForeground(true)}>Resume native activity</button>
        <ClinicianSessionGate><p>Shared clinical application</p></ClinicianSessionGate></>);` } });
  await page.route("**/__native-gate", route => route.fulfill({ contentType: "text/html", body: `<html><body><div id="root"></div><script>${bundled.outputFiles[0]!.text}</script></body></html>` }));
  let requests = 0;
  await page.route("**/api/**", route => { requests++; return route.fulfill({ status: 503, json: {} }); });
  await page.clock.install();
  await page.goto("/__native-gate");
  await expect(page.getByRole("button", { name: "Resume native activity" })).toBeVisible();
  await page.clock.fastForward(10000);
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "Resume native activity" }).click();
  await expect.poll(() => requests).toBeGreaterThan(0);
});

test("photo camera releases on native pause, resumes, and stops a late permission result after cancellation", async ({ page }) => {
  const bundled = await build({ bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env": JSON.stringify({ NEXT_PUBLIC_API_URL: "same-origin" }) },
    stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {PhotoNoteDialog} from './components/photo-note';
      import {setNativeForeground} from './app/application-foreground';
      window.requests=0;window.stopped=0;window.resolveCamera=null;window.deferCamera=false;
      navigator.mediaDevices.getUserMedia=async()=>{window.requests++;if(window.deferCamera)return new Promise((resolve,reject)=>{window.resolveCamera=resolve;window.rejectCamera=reject});return stream()};
      navigator.mediaDevices.enumerateDevices=async()=>[{kind:'videoinput',deviceId:'synthetic-camera'}];
      function stream(){const canvas=document.createElement('canvas');canvas.width=64;canvas.height=48;const result=canvas.captureStream(5);for(const track of result.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{window.stopped++;stop()}}return result}
      window.finishCamera=()=>window.resolveCamera(stream());
      function App(){const[open,setOpen]=React.useState(true);return <>
        <button onClick={()=>setNativeForeground(false)}>Pause native activity</button>
        <button onClick={()=>setNativeForeground(true)}>Resume native activity</button>
        <button onClick={()=>setOpen(true)}>Open camera</button>
        {open&&<PhotoNoteDialog dialogRef={{current:null}} reportId="synthetic" note={null} csrfToken="synthetic" revision={1}
        mediaPolicy={{settingsRevision:1,imageMediaLimitBytes:10485760,reportMediaAllowanceBytes:104857600}}
        author={{userId:'synthetic',displayName:'Synthetic'}} onClose={()=>setOpen(false)} onSaved={()=>{}} onQueued={()=>{}} onDeleted={()=>{}} onSessionEnded={()=>{}}/>}</>}
      createRoot(document.getElementById('root')).render(<App/>);` } });
  await page.route("**/__photo-lifecycle", route => route.fulfill({ contentType: "text/html", body: `<html><body><div id="root"></div><script>${bundled.outputFiles[0]!.text}</script></body></html>` }));
  await page.goto("/__photo-lifecycle");
  await expect.poll(() => page.evaluate(() => (window as any).requests)).toBe(1);
  await expect.poll(() => page.evaluate(() => document.querySelector('video')?.srcObject && (document.querySelector('video')!.srcObject as MediaStream).getTracks()[0]?.readyState)).toBe('live');
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('open-triage.foreground-changed')); });
  await expect.poll(() => page.evaluate(() => (window as any).requests)).toBe(1);
  expect(await page.evaluate(() => (document.querySelector('video')!.srcObject as MediaStream).getTracks()[0]!.readyState)).toBe('live');
  expect(await page.evaluate(() => (window as any).stopped)).toBe(0);
  await page.getByRole('button', { name: 'Pause native activity' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).stopped)).toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: 'Resume native activity' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).requests)).toBe(2);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => { (window as any).deferCamera = true; });
  await page.getByRole('button', { name: 'Open camera' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).requests)).toBe(3);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const previous = await page.evaluate(() => (window as any).stopped);
  await page.evaluate(() => (window as any).finishCamera());
  await expect.poll(() => page.evaluate(() => (window as any).stopped)).toBe(previous + 1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open camera' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).requests)).toBe(4);
  await page.getByRole('button', { name: 'Pause native activity' }).click();
  await page.getByRole('button', { name: 'Resume native activity' }).click();
  await page.evaluate(() => (window as any).rejectCamera(new DOMException('Denied', 'NotAllowedError')));
  await expect(page.getByRole('alert')).toContainText('Camera access is blocked');
  expect(await page.evaluate(() => (window as any).requests)).toBe(4);
});

test("signing, review attention and EPS readers wait through paused reconnect and each restart once on resume", async ({ page }) => {
  const now = Date.now();
  const session = { csrfToken: "synthetic-csrf", user: { id: demoOpenAssignment.report.documentingUserId, displayName: "Synthetic clinician" },
    organization: { id: "32000000-0000-4000-8000-000000000001", name: "Synthetic agency" },
    capabilities: ["clinical:document", "review:self"], workspaceAvailable: true, startedAt: new Date(now).toISOString(), expiresAt: "2099-01-01T00:00:00Z" };
  const bundled = await build({ bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env": JSON.stringify({ NEXT_PUBLIC_API_URL: "same-origin" }) },
    stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';import Home from './app/page';
      import {setNativeForeground} from './app/application-foreground';
      createRoot(document.getElementById('root')).render(<>
        <button onClick={()=>setNativeForeground(false)}>Pause native activity</button>
        <button onClick={()=>setNativeForeground(true)}>Resume native activity</button><Home/></>);` } });
  await page.addInitScript(stored => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await page.route("**/__native-readers", route => route.fulfill({ contentType: "text/html", body: `<html><body><div id="root"></div><script>${bundled.outputFiles[0]!.text}</script></body></html>` }));
  const reads = { signing: 0, attention: 0, eps: 0 };
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/installation") return route.fulfill({ json: { settings: productionSettings } });
    if (path === "/api/sessions/current") return route.fulfill({ json: session });
    if (path === "/api/calls/assigned") return route.fulfill({ json: demoAssignedCalls });
    if (path === "/api/reports/open") return route.fulfill({ json: { openCalls: [], completedReportIds: [], refreshedAt: new Date().toISOString() } });
    if (/\/calls\/[^/]+\/open$/.test(path)) return route.fulfill({ json: demoOpenAssignment });
    if (path.endsWith("/protected-key-envelope")) return route.fulfill({ json: { schemaVersion: 1, recoveryHandle: route.request().postDataJSON().recoveryHandle, recoveryDeadline: "2099-01-01T00:00:00Z", wrappingKeyVersion: 1 } });
    if (path.endsWith("/protected-ciphertext-receipt")) return route.fulfill({ json: { schemaVersion: 1, recoveryDeadline: "2099-01-01T00:00:00Z" } });
    if (path.endsWith("/protected-ciphertext-checkpoint")) return route.fulfill({ json: route.request().postDataJSON() });
    if (path.endsWith("/signing-status")) { reads.signing++; return route.fulfill({ json: { status: "draft" } }); }
    if (path === "/api/review/attention") { reads.attention++; return route.fulfill({ json: { dataset: "real", asOf: new Date().toISOString(), total: 0 } }); }
    if (path.endsWith("/eps/context")) { reads.eps++; return route.fulfill({ json: null }); }
    if (path.endsWith("/cos/context")) return route.fulfill({ json: null });
    if (path.endsWith("/active")) return route.fulfill({ status: 304 });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.clock.install();
  await page.goto("/__native-readers");
  await page.getByRole("button", { name: "Open call", exact: true }).first().click();
  await expect(page.locator('.sync-status')).toHaveText('Saved');
  await expect.poll(() => reads.eps).toBeGreaterThanOrEqual(2);
  await expect.poll(() => reads.signing).toBeGreaterThanOrEqual(1);
  await expect.poll(() => reads.attention).toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: 'Pause native activity' }).click();
  const before = { ...reads };
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }); window.dispatchEvent(new Event('offline')); Object.defineProperty(navigator, 'onLine', { configurable: true, value: true }); window.dispatchEvent(new Event('online')); });
  await page.clock.fastForward(60000);
  expect(reads).toEqual(before);
  await page.getByRole('button', { name: 'Resume native activity' }).click();
  await page.clock.fastForward(350);
  await expect.poll(() => reads).toEqual({ signing: before.signing + 1, attention: before.attention + 1, eps: before.eps + 2 });
});
