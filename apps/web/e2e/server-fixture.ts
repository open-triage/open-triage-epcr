import { test as base, type Page, type BrowserContext, type Response } from "@playwright/test";
import productionSettings from "@open-triage/contracts/config/installation.production.json";
import demoAssignedCalls from "../public/demo-assigned-calls.json";
import demoOpenAssignment from "../public/demo-open-assignment.json";
import type { CachedOpenReport } from "../app/offline-reports";

export * from "@playwright/test";
const sessionKey = "open-triage.clinician-session.v1";
export const demoSession = {
  csrfToken: "browser-test-csrf",
  user: { id: demoOpenAssignment.report.documentingUserId, displayName: "Synthetic Clinician" },
  organization: { id: "32000000-0000-4000-8000-000000000001", name: "OpenTriage Synthetic EMS" },
  startedAt: new Date().toISOString(), expiresAt: "2099-09-24T18:00:00.000Z",
  capabilities: ["clinical:demo", "clinical:document"], workspaceAvailable: true,
};
type Envelope = { recoveryHandle: string; reportKeyBase64: string };
export type MockRecovery = Map<string, Envelope>;
const pageRecovery = new WeakMap<Page, MockRecovery>();

/** Test-owned API defaults. Individual scenarios override any route they exercise. */
export async function installServerFixture(target: Page | BrowserContext, recovery: MockRecovery = new Map()) {
  const reports = new Map<string, typeof demoOpenAssignment.report & { demoMutable?: boolean }>();
  const pendingResponses = new Set<Promise<void>>();
  // Observe scenario-specific open/sign routes too, so the authoritative list
  // cannot accidentally evict an active report from the browser's cache.
  target.on("response", (response: Response) => {
    const path = new URL(response.url()).pathname;
    if (!response.ok()) return;
    if (/\/api\/calls\/[^/]+\/open$/.test(path)) {
      const pending = response.json().catch(() => null).then(body => {
        if (body?.report) reports.set(body.report.id, body.report);
      });
      pendingResponses.add(pending);
      void pending.finally(() => pendingResponses.delete(pending));
    } else if (/\/api\/reports\/[^/]+\/draft-changes$/.test(path)) {
      // A navigation may cancel the response body; only completed replies
      // advance mock server state, and never leave a rejected event promise.
      const pending = response.json().catch(() => null).then(body => {
        const report = body && reports.get(body.id);
        if (report) reports.set(body.id, { ...report, revision: body.revision });
      });
      pendingResponses.add(pending);
      void pending.finally(() => pendingResponses.delete(pending));
    } else if (/\/api\/reports\/[^/]+\/sign$/.test(path)) {
      reports.delete(path.split("/")[3]!);
    }
  });
  await target.addInitScript(() => {
    Object.defineProperties(navigator.storage, {
      persisted: { configurable: true, value: async () => true },
      persist: { configurable: true, value: async () => true },
    });
  });
  await target.route("**/api/installation", route => route.fulfill({ json: { settings: productionSettings } }));
  await target.route("**/api/sessions", route => route.fulfill({ json: demoSession }));
  await target.route("**/api/sessions/current", async route => {
    if (route.request().method() === "DELETE") return route.fulfill({ status: 204 });
    // Tests that deliberately seed a session also seed the mock server identity.
    // Authentication/authorization scenarios install their own explicit routes.
    const stored = await route.request().frame().evaluate(key => localStorage.getItem(key), sessionKey);
    return route.fulfill({ json: stored ? JSON.parse(stored) : demoSession });
  });
  await target.route("**/api/sessions/reauthenticate", route => route.fulfill({ json: { reauthenticatedUntil: "2099-09-24T18:00:00.000Z" } }));
  await target.route("**/api/calls/assigned", route => route.fulfill({ json: demoAssignedCalls }));
  await target.route("**/api/calls/synthetic-generation", route => route.fulfill({ json: {
    eligibleUnits: [demoAssignedCalls.assignedCalls[0]!.unit], hasUnopenedCall: true,
  } }));
  await target.route("**/api/reports/open", async route => {
    await Promise.all(pendingResponses);
    return route.fulfill({ json: {
      openCalls: [...reports.values()].map(report => ({
        reportId: report.id, callNumber: demoAssignedCalls.assignedCalls[0]!.callNumber,
        demoMutable: report.demoMutable,
        revision: report.revision, formVersionId: report.formVersionId, catalogReleaseId: report.catalogReleaseId,
        lastSavedAt: new Date().toISOString(), syncStatus: "saved", validationErrorCount: 0,
      })), completedReportIds: [], refreshedAt: new Date().toISOString(),
    } });
  });
  await target.route("**/api/reports/*/reopen", async route => {
    if (!await route.request().frame().evaluate(() => navigator.onLine)) return route.abort("internetdisconnected");
    await Promise.all(pendingResponses);
    const report = reports.get(new URL(route.request().url()).pathname.split("/")[3]!);
    return route.fulfill({ status: report ? 200 : 404, json: { report, callNumber: demoAssignedCalls.assignedCalls[0]!.callNumber } });
  });
  await target.route("**/api/calls/*/open", route => route.fulfill({ json: {
    ...demoOpenAssignment, report: { ...demoOpenAssignment.report, demoMutable: true },
  } }));
  await target.route("**/api/reports/*/active", route => route.fulfill({ status: 304 }));
  await target.route("**/api/reports/*/draft-changes", route => {
    const command = route.request().postDataJSON();
    const id = new URL(route.request().url()).pathname.split("/")[3];
    return route.fulfill({ json: { id, status: "draft", revision: command.expectedRevision + 1 } });
  });
  await target.route("**/api/reports/*/protected-key-envelope", route => {
    const command = route.request().postDataJSON() as Envelope;
    const id = new URL(route.request().url()).pathname.split("/")[3]!;
    if (recovery.has(id)) return route.fulfill({ status: 409 });
    recovery.set(id, command);
    return route.fulfill({ status: 201, json: {
      schemaVersion: 1, recoveryHandle: command.recoveryHandle,
      recoveryDeadline: "2099-09-25T18:00:00.000Z", wrappingKeyVersion: 1,
    } });
  });
  await target.route("**/api/reports/*/protected-ciphertext-checkpoint", route => route.fulfill({ json: route.request().postDataJSON() }));
  await target.route("**/api/reports/*/protected-ciphertext-receipt", route => route.fulfill({ json: {
    schemaVersion: 1, recoveryDeadline: "2099-09-25T18:00:00.000Z",
  } }));
  await target.route("**/api/reports/*/recovery-grants", route => {
    const envelope = recovery.get(new URL(route.request().url()).pathname.split("/")[3]!);
    return route.fulfill({ status: envelope ? 201 : 404, json: {
      schemaVersion: 1, envelopeVersion: 1, recoveryHandle: envelope?.recoveryHandle,
      grant: "synthetic-recovery-grant", expiresAt: "2099-09-25T18:00:00.000Z", reportStatus: "draft",
    } });
  });
  await target.route("**/api/reports/*/recovery-grants/consume", route => {
    const envelope = recovery.get(new URL(route.request().url()).pathname.split("/")[3]!);
    return route.fulfill({ status: envelope ? 200 : 404, json: {
      schemaVersion: 1, envelopeVersion: 1, wrappingKeyVersion: 1, reportKeyBase64: envelope?.reportKeyBase64,
    } });
  });
  if ("goto" in target) pageRecovery.set(target, recovery);
  return recovery;
}

/** Inspect real encrypted IndexedDB records with keys held only by the mock server. */
export async function cachedReports(page: Page, recovery = pageRecovery.get(page)!): Promise<CachedOpenReport[]> {
  return page.evaluate(async envelopes => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("open-triage-protected-clinical-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!database.objectStoreNames.contains("encrypted-reports")) return [];
      const records = await new Promise<Array<{ recoveryHandle: string; schemaVersion: number; ciphertextRevision: number; nonce: ArrayBuffer; ciphertext: ArrayBuffer }>>((resolve, reject) => {
        const request = database.transaction("encrypted-reports").objectStore("encrypted-reports").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const reports = [];
      for (const record of records) {
        const envelope = envelopes.find(item => item.recoveryHandle === record.recoveryHandle);
        if (!envelope) continue;
        const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(envelope.reportKeyBase64), c => c.charCodeAt(0)), "AES-GCM", false, ["decrypt"]);
        const additionalData = new TextEncoder().encode(JSON.stringify({ schemaVersion: record.schemaVersion, recoveryHandle: record.recoveryHandle, ciphertextRevision: record.ciphertextRevision }));
        const decoded = await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.nonce, additionalData }, key, record.ciphertext);
        const payload = JSON.parse(new TextDecoder().decode(decoded));
        if (payload.report) reports.push(payload.report);
      }
      return reports;
    } finally { database.close(); }
  }, [...recovery.values()]);
}

export const test = base.extend({
  page: async ({ page }, runTest) => {
    if (process.env.OPEN_TRIAGE_E2E_SERVER_MODE === "true") await installServerFixture(page);
    await runTest(page);
  },
});

/** Create a deterministic clinical warning instead of relying on demo defaults. */
export async function addRespiratoryWarning(page: Page) {
  await page.locator('[data-group-id="eVitals.VitalGroup"]').getByRole("button", { name: /Edit Vital/ }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('[data-element-id="eVitals.14"] input').fill("0");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await base.expect(dialog).toHaveCount(0);
  await base.expect(page.locator(".sync-status")).toHaveText("Saved");
}
