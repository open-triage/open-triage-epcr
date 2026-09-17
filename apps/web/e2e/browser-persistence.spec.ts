import { expect, test, type Page, type Route } from "@playwright/test";
import productionSettings from "@open-triage/contracts/config/installation.production.json";
import demoAssignedCalls from "../public/demo-assigned-calls.json";
import demoOpenAssignment from "../public/demo-open-assignment.json";

const serverBacked = process.env.OPEN_TRIAGE_E2E_SERVER_MODE === "true";
const assignedCall = demoAssignedCalls.assignedCalls[0]!;
const openedAssignment = { ...demoOpenAssignment, assignmentId: assignedCall.id };
const reportId = openedAssignment.report.id;
const session = {
  csrfToken: "protected-storage-csrf",
  user: { id: openedAssignment.report.documentingUserId, displayName: "Protected Storage Clinician" },
  organization: { id: "32000000-0000-4000-8000-000000000001", name: "Protected Storage EMS" },
  startedAt: "2026-09-17T10:00:00.000Z",
  expiresAt: "2099-09-17T20:00:00.000Z",
  capabilities: ["clinical:document"],
  workspaceAvailable: true,
};

async function installRoutes(page: Page) {
  let opened = false;
  await page.addInitScript((stored) => {
    Object.defineProperties(navigator.storage, {
      persisted: { configurable: true, value: async () => true },
      persist: { configurable: true, value: async () => true },
    });
    localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored));
    localStorage.setItem("open-triage:offline-reports-v1", "LEGACY CLINICAL PLAINTEXT");
    localStorage.setItem("open-triage:standard-encounter-v1:report:legacy", "LEGACY PATIENT");
  }, session);
  await page.route("**/api/installation", (route) => route.fulfill({ json: { settings: productionSettings } }));
  await page.route("**/api/calls/assigned", (route) => route.fulfill({ json: {
    assignedCalls: [assignedCall], canceledAssignmentIds: [], refreshedAt: new Date().toISOString(),
  } }));
  await page.route("**/api/reports/open", (route) => route.fulfill({ json: {
    openCalls: opened ? [{
      reportId,
      callNumber: assignedCall.callNumber,
      lastSavedAt: new Date().toISOString(),
      syncStatus: "saved",
      validationErrorCount: 0,
      revision: openedAssignment.report.revision,
      formVersionId: openedAssignment.report.formVersionId,
      catalogReleaseId: openedAssignment.report.catalogReleaseId,
      demoMutable: false,
    }] : [],
    completedReportIds: [], refreshedAt: new Date().toISOString(),
  } }));
  await page.route(`**/api/calls/${assignedCall.id}/open`, (route) => {
    opened = true;
    return route.fulfill({ json: openedAssignment });
  });
  await page.route(`**/api/reports/${reportId}/protected-key-envelope`, async (route) => {
    const command = route.request().postDataJSON() as { schemaVersion: number; recoveryHandle: string; reportKeyBase64: string };
    expect(command.schemaVersion).toBe(1);
    expect(atob(command.reportKeyBase64)).toHaveLength(32);
    await route.fulfill({ status: 201, headers: { "cache-control": "no-store, private" }, json: {
      schemaVersion: 1,
      recoveryHandle: command.recoveryHandle,
      recoveryDeadline: "2099-09-18T12:00:00.000Z",
      wrappingKeyVersion: 1,
    } });
  });
  await page.route(`**/api/reports/${reportId}/protected-ciphertext-checkpoint`, async (route) => {
    const command = route.request().postDataJSON() as { ciphertextRevision: number; ciphertextSha256: string };
    expect(command.ciphertextRevision).toBeGreaterThan(0);
    expect(command.ciphertextSha256).toMatch(/^[a-f0-9]{64}$/);
    await route.fulfill({ json: command });
  });
  let revision = openedAssignment.report.revision;
  await page.route(`**/api/reports/${reportId}/draft-changes`, async (route: Route) => {
    const command = route.request().postDataJSON() as { expectedRevision: number };
    revision = command.expectedRevision + 1;
    await route.fulfill({ json: { id: reportId, status: "draft", revision } });
  });
  await page.route(`**/api/reports/${reportId}/active`, (route) => route.fulfill({ status: 304 }));
}

async function encryptedRecords(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(async ({ databaseName, storeName }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        const request = database.transaction(storeName).objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result.map((record) => ({
          ...record,
          nonce: [...new Uint8Array(record.nonce)],
          ciphertext: [...new Uint8Array(record.ciphertext)],
        })));
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }, { databaseName: "open-triage-protected-clinical-v1", storeName: "encrypted-reports" });
}

test("one online-opened report remains editable through connection loss using only authenticated IndexedDB ciphertext", async ({ page, context }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await installRoutes(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await expect(page.locator(".active-report-notice")).toHaveAttribute("data-report-id", reportId);
  await expect.poll(async () => (await encryptedRecords(page)).length).toBe(1);

  const before = (await encryptedRecords(page))[0]!;
  expect(before.schemaVersion).toBe(1);
  expect(before.algorithm).toBe("AES-256-GCM");
  expect(before.nonce as number[]).toHaveLength(12);
  expect((before.ciphertext as number[]).length).toBeGreaterThan(16);
  expect(JSON.stringify(before)).not.toContain(reportId);
  expect(JSON.stringify(before)).not.toContain(assignedCall.callNumber);
  const plaintextStorage = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(plaintextStorage).not.toContain(reportId);
  expect(plaintextStorage).not.toContain(assignedCall.callNumber);
  expect(plaintextStorage).not.toContain("LEGACY CLINICAL PLAINTEXT");
  expect(plaintextStorage).not.toContain("LEGACY PATIENT");

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.getByRole("button", { name: "Add clinical note" }).click();
  await page.getByLabel("Note summary").fill("Encrypted field care while disconnected");
  await page.getByRole("button", { name: "Add to timeline" }).click();
  await expect(page.locator(".sync-status")).toHaveText("Pending sync");
  await expect.poll(async () => Number((await encryptedRecords(page))[0]?.ciphertextRevision)).toBeGreaterThan(Number(before.ciphertextRevision));
  const after = (await encryptedRecords(page))[0]!;
  expect(Buffer.from(after.ciphertext as number[]).equals(Buffer.from(before.ciphertext as number[]))).toBe(false);
  expect(JSON.stringify(after)).not.toContain("Encrypted field care while disconnected");

  await page.getByRole("button", { name: "Save & close" }).click();
  await expect(page.getByRole("heading", { name: "Open reports" })).toBeVisible();
  await page.getByRole("button", { name: "Reopen report" }).click();
  await expect(page.getByText("Encrypted field care while disconnected", { exact: true })).toBeVisible();
});
