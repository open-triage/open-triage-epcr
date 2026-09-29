import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import assigned from "../public/demo-assigned-calls.json";
import openedFixture from "../public/demo-open-assignment.json";
import production from "@open-triage/contracts/config/installation.production.json";

let script: string;
test.beforeAll(async () => {
  const result = await build({ bundle: true, write: false, format: "iife", platform: "browser", define: { "process.env": "{}" },
    stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {ClinicianSessionGate} from './components/clinician-session-gate';
      createRoot(document.getElementById('root')).render(<ClinicianSessionGate>{()=>
        <main className="encounter-header">Editor ready</main>}</ClinicianSessionGate>);`
    } });
  script = result.outputFiles[0]!.text;
});
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
async function setup(page: Page, failFirst = false) {
  const open = deferred(), envelope = deferred(), receipt = deferred(), stalePoll = deferred();
  let opens = 0, polls = 0, keyRequests = 0, receipts = 0;
  const session = { csrfToken: "test-csrf", user: { id: "demo", displayName: "Demo" },
    organization: { id: "org", name: "Test EMS" }, startedAt: new Date().toISOString(), expiresAt: "2099-01-01T00:00:00Z",
    capabilities: ["clinical:document"], workspaceAvailable: true };
  const opened = { ...openedFixture, assignmentId: assigned.assignedCalls[0]!.id,
    report: { ...openedFixture.report, expiresAt: "2099-01-01T00:00:00Z" } };
  await page.addInitScript((value) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(value)), session);
  await page.route("**/__opening", (route) => route.fulfill({ contentType: "text/html", body: '<html lang="en"><div id="root"></div><script src="/__opening-script"></script></html>' }));
  await page.route("**/__opening-script", (route) => route.fulfill({ contentType: "text/javascript", body: script }));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()).pathname;
    if (url.endsWith("/installation")) return route.fulfill({ json: { settings: { ...production, language: "en" } } });
    if (url.endsWith("/sessions/current")) return route.fulfill({ json: session });
    if (url.endsWith("/calls/assigned")) {
      polls++;
      if (polls > 1) { await stalePoll.promise; return route.fulfill({ json: { ...assigned, assignedCalls: [] } }); }
      return route.fulfill({ json: assigned });
    }
    if (url.endsWith("/reports/open")) return route.fulfill({ json: { openCalls: [], completedReportIds: [] } });
    if (url.includes("/calls/") && url.endsWith("/open")) {
      opens++;
      if (failFirst && opens === 1) return route.fulfill({ status: 500, json: { code: "calls.http500" } });
      await open.promise;
      return route.fulfill({ json: opened });
    }
    if (url.endsWith("/protected-key-envelope")) {
      keyRequests++; await envelope.promise;
      return route.fulfill({ json: { schemaVersion: 1, recoveryHandle: route.request().postDataJSON().recoveryHandle,
        recoveryDeadline: "2099-01-01T00:00:00Z", wrappingKeyVersion: 1 } });
    }
    if (url.endsWith("/protected-ciphertext-receipt")) {
      receipts++; await receipt.promise;
      return route.fulfill({ json: { schemaVersion: 1, recoveryDeadline: "2099-01-01T00:00:00Z" } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("/__opening");
  await expect(page.getByRole("button", { name: "Open call", exact: true })).toBeVisible();
  return { open, envelope, receipt, stalePoll, counts: () => ({ opens, polls, keyRequests, receipts }) };
}

test("slow opening stays stable through stale polling, key preparation and persistence", async ({ page }) => {
  const state = await setup(page);
  // Leave a refresh in flight before opening, then let it return an empty queue.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => state.counts().polls).toBeGreaterThan(1);
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  const heading = page.getByRole("heading", { name: `Opening call ${assigned.assignedCalls[0]!.callNumber}` });
  await expect(heading).toBeFocused();
  state.stalePoll.resolve();
  await expect(page.getByRole("heading", { name: "Open reports", exact: true })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Assigned calls", exact: true })).toBeHidden();
  await expect(page.getByText("Preparing your report. The editor will open automatically.")).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  state.open.resolve();
  await expect.poll(() => state.counts().keyRequests).toBe(1);
  await expect(heading).toBeVisible();
  state.envelope.resolve();
  await expect.poll(() => state.counts().receipts).toBe(1);
  await expect(heading).toBeVisible();
  await expect(page.getByText("Editor ready", { exact: true })).toHaveCount(0);
  state.receipt.resolve();
  await expect(page.getByText("Editor ready", { exact: true })).toBeVisible();
  await expect(heading).toHaveCount(0);
  expect(state.counts().opens).toBe(1);
});

test("failed opening restores the selected call and allows one successful retry", async ({ page }) => {
  const state = await setup(page, true);
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await expect(page.locator(".assignment-error")).toBeVisible();
  const retry = page.getByRole("button", { name: "Open call", exact: true });
  await expect(retry).toBeEnabled();
  state.open.resolve(); state.envelope.resolve(); state.receipt.resolve();
  await retry.click();
  await expect(page.getByText("Editor ready", { exact: true })).toBeVisible();
  expect(state.counts().opens).toBe(2);
});
