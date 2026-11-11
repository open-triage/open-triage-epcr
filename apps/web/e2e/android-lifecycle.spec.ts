import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import demoAssignedCalls from "../public/demo-assigned-calls.json";
import demoOpenAssignment from "../public/demo-open-assignment.json";
import productionSettings from "@open-triage/contracts/config/installation.production.json";

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
