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
const otherSession = {
  ...session,
  csrfToken: "other-user-csrf",
  user: { id: "42000000-0000-4000-8000-000000000099", displayName: "Different Clinician" },
};

async function installRoutes(page: Page, persistentStorage = true, existing?: {
  readonly recoveryHandle: string;
  readonly reportKeyBase64: string;
}) {
  let opened = Boolean(existing);
  let restarted = false;
  let recoveryHandle = existing?.recoveryHandle ?? "";
  let reportKeyBase64 = existing?.reportKeyBase64 ?? "";
  let grantConsumed = false;
  let reauthenticated = false;
  let currentSession = session;
  await page.addInitScript(({ stored, persistentStorage }) => {
    Object.defineProperties(navigator.storage, {
      persisted: { configurable: true, value: async () => persistentStorage },
      persist: { configurable: true, value: async () => persistentStorage },
    });
    localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored));
    localStorage.setItem("open-triage:offline-reports-v1", "LEGACY CLINICAL PLAINTEXT");
    localStorage.setItem("open-triage:standard-encounter-v1:report:legacy", "LEGACY PATIENT");
  }, { stored: session, persistentStorage });
  await page.route("**/api/installation", (route) => route.fulfill({ json: { settings: productionSettings } }));
  await page.route("**/api/sessions/current", async (route) => {
    if (route.request().method() === "DELETE") return route.fulfill({ status: 204 });
    if (restarted) await new Promise((resolve) => setTimeout(resolve, 750));
    return route.fulfill({ headers: { "cache-control": "no-store, private" }, json: currentSession });
  });
  await page.route("**/api/sessions", async (route) => {
    const command = route.request().postDataJSON() as { username?: string };
    currentSession = command.username === "other" ? otherSession : session;
    return route.fulfill({ headers: { "cache-control": "no-store, private" }, json: currentSession });
  });
  await page.route("**/api/sessions/reauthenticate", async (route) => {
    const command = route.request().postDataJSON() as { currentPassword?: string };
    if (!command.currentPassword) return route.fulfill({ status: 401 });
    reauthenticated = true;
    return route.fulfill({ json: { reauthenticatedUntil: "2099-09-17T12:05:00.000Z" } });
  });
  await page.route("**/api/calls/assigned", (route) => route.fulfill({ json: {
    assignedCalls: currentSession.user.id === session.user.id ? [assignedCall] : [],
    canceledAssignmentIds: [], refreshedAt: new Date().toISOString(),
  } }));
  await page.route("**/api/reports/open", (route) => route.fulfill({ json: {
    openCalls: opened && currentSession.user.id === session.user.id ? [{
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
    recoveryHandle = command.recoveryHandle;
    reportKeyBase64 = command.reportKeyBase64;
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
  await page.route(`**/api/reports/${reportId}/protected-ciphertext-receipt`, async (route) => {
    const command = route.request().postDataJSON() as {
      schemaVersion: number; recoveryHandle: string; ciphertextRevision: number; ciphertextSha256: string;
    };
    expect(command.schemaVersion).toBe(1);
    expect(command.ciphertextRevision).toBeGreaterThan(0);
    expect(command.ciphertextSha256).toMatch(/^[a-f0-9]{64}$/);
    await route.fulfill({ status: 200, json: {
      schemaVersion: 1, recoveryDeadline: "2099-09-18T12:00:00.000Z",
    } });
  });
  await page.route(`**/api/reports/${reportId}/reopen`, (route) => route.fulfill({ json: {
    callNumber: assignedCall.callNumber,
    dispatchedAt: assignedCall.dispatchedAt,
    dispatchReason: assignedCall.dispatchReason,
    dispatchPriority: assignedCall.dispatchPriority,
    chiefComplaint: assignedCall.chiefComplaint,
    unitCallSign: assignedCall.unit.callSign,
    report: openedAssignment.report,
  } }));
  await page.route(`**/api/reports/${reportId}/recovery-grants`, (route) => {
    if (restarted && !reauthenticated) return route.fulfill({ status: 428 });
    return route.fulfill({
      status: 201,
      headers: { "cache-control": "no-store, private", pragma: "no-cache" },
      json: {
        schemaVersion: 1, envelopeVersion: 1, recoveryHandle,
        grant: "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE",
        expiresAt: "2099-09-18T12:00:00.000Z",
        reportStatus: "draft",
      },
    });
  });
  await page.route(`**/api/reports/${reportId}/recovery-grants/consume`, (route) => {
    if (grantConsumed) return route.fulfill({ status: 404, json: { message: "Protected report recovery is unavailable" } });
    grantConsumed = true;
    return route.fulfill({
      headers: { "cache-control": "no-store, private", pragma: "no-cache" },
      json: { schemaVersion: 1, envelopeVersion: 1, wrappingKeyVersion: 1, reportKeyBase64 },
    });
  });
  let revision = openedAssignment.report.revision;
  await page.route(`**/api/reports/${reportId}/draft-changes`, async (route: Route) => {
    // Fulfilled Playwright routes bypass context.setOffline(). An autosave
    // already in flight may try to drain more queued changes after disconnect.
    if (!await page.evaluate(() => navigator.onLine)) return route.abort("internetdisconnected");
    const command = route.request().postDataJSON() as { expectedRevision: number };
    revision = command.expectedRevision + 1;
    await route.fulfill({ json: { id: reportId, status: "draft", revision } });
  });
  await page.route(`**/api/reports/${reportId}/active`, (route) => route.fulfill({ status: 304 }));
  return {
    restart: () => { restarted = true; },
    recovery: () => ({ recoveryHandle, reportKeyBase64 }),
  };
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

test("denied persistence falls back to encrypted best-effort IndexedDB", async ({ page, context }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await installRoutes(page, false);
  await page.goto("/");
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await expect(page.locator(".safety-notice")).toContainText("Best-effort offline storage");
  await expect.poll(async () => (await encryptedRecords(page)).length).toBe(1);

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.getByRole("button", { name: "Add clinical note" }).click();
  await page.getByLabel("Note summary").fill("Best-effort encrypted offline note");
  await page.getByRole("button", { name: "Add to timeline" }).click();
  await expect(page.locator(".sync-status")).toHaveText("Pending sync");
  await expect.poll(async () => Number((await encryptedRecords(page))[0]?.ciphertextRevision)).toBeGreaterThan(0);
});

test("a second browser recovers its own offline copy without replacing the first", async ({ page, browser }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  const first = await installRoutes(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await expect.poll(async () => (await encryptedRecords(page)).length).toBe(1);
  const original = (await encryptedRecords(page))[0]!;
  await page.getByRole("button", { name: "Save & close" }).click();

  const otherContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-US" });
  try {
    const second = await otherContext.newPage();
    const secondRoutes = await installRoutes(second, true, first.recovery());
    secondRoutes.restart();
    await second.route(`**/api/reports/${reportId}/protected-key-envelope`, (route) => route.fulfill({ status: 409 }));
    let browserScopedReceipts = 0;
    await second.route(`**/api/reports/${reportId}/protected-ciphertext-receipt`, (route) => {
      const command = route.request().postDataJSON() as { localRecordId?: string };
      expect(command.localRecordId).toMatch(/^[0-9a-f-]{36}$/);
      browserScopedReceipts += 1;
      return route.fulfill({ json: { schemaVersion: 1, recoveryDeadline: "2099-09-18T12:00:00.000Z" } });
    });
    await second.goto(page.url());
    await expect(second.getByRole("heading", { name: "Open reports" })).toBeVisible();
    await second.getByRole("button", { name: "Reopen report" }).click();
    await expect(second.getByText("Confirm your password to recover protected work from this browser.")).toBeVisible();
    await second.getByLabel("Current password").fill("current-password");
    await second.getByRole("button", { name: "Confirm and recover" }).click();
    await expect(second.locator(".active-report-notice")).toHaveAttribute("data-report-id", reportId);
    await expect.poll(async () => (await encryptedRecords(second)).length).toBe(1);
    const adopted = (await encryptedRecords(second))[0]!;
    expect(adopted.checkpointScope).toBe("browser");
    expect(adopted.localRecordId).not.toBe(original.localRecordId);
    expect(browserScopedReceipts).toBeGreaterThan(0);
    await otherContext.setOffline(true);
    await second.evaluate(() => window.dispatchEvent(new Event("offline")));
    // Verify the mocked transport cannot acknowledge an offline save, even if
    // a save loop started while recovery was still online.
    await expect(second.evaluate(async (id) => {
      try {
        await fetch(`/api/reports/${id}/draft-changes`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedRevision: 0 }),
        });
        return false;
      } catch {
        return true;
      }
    }, reportId)).resolves.toBe(true);
    await second.getByRole("button", { name: "Add clinical note" }).click();
    await second.getByLabel("Note summary").fill("Second browser offline copy");
    await second.getByRole("button", { name: "Add to timeline" }).click();
    await expect(second.locator(".sync-status")).toHaveText("Pending sync");
    await expect.poll(async () => Number((await encryptedRecords(second))[0]?.ciphertextRevision))
      .toBeGreaterThan(Number(adopted.ciphertextRevision));
    expect((await encryptedRecords(page))[0]!.localRecordId).toBe(original.localRecordId);
  } finally {
    await otherContext.close();
  }
});

test("switching to Stationary preserves a queued draft save", async ({ page }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await installRoutes(page);
  let draftSaves = 0;
  page.on("request", (request) => {
    if (request.url().endsWith(`/api/reports/${reportId}/draft-changes`)) draftSaves += 1;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await page.getByRole("button", { name: "Add clinical note" }).click();
  await page.getByLabel("Note summary").fill("Save during presentation switch");
  await page.getByRole("button", { name: "Add to timeline" }).click();
  await expect(page.locator(".sync-status")).toHaveText("Saving");
  await page.getByRole("group", { name: "Documentation presentation" })
    .getByRole("button", { name: "Stationary" }).click();
  await expect(page.locator(".sync-status")).toHaveText("Saved", { timeout: 10_000 });
  expect(draftSaves).toBeGreaterThan(0);
});

test("one online-opened report remains editable through connection loss using only authenticated IndexedDB ciphertext", async ({ page, context }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  const controls = await installRoutes(page);
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

  await page.getByRole("button", { name: "Stationary", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stationary", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(JSON.stringify((await encryptedRecords(page))[0])).not.toContain(reportId);
  await page.getByRole("button", { name: "Mobile", exact: true }).click();

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

  await page.getByRole("button", { name: "Save & close" }).click();
  await context.setOffline(false);
  controls.restart();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("main", { name: "Reconnecting securely" })).toBeVisible();
  await expect(page.getByText(assignedCall.callNumber, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Open reports" })).toBeVisible();
  await page.getByRole("button", { name: "Reopen report" }).click();
  await expect(page.getByText("Confirm your password to recover protected work from this browser.")).toBeVisible();
  await page.getByLabel("Current password").fill("current-password");
  await page.getByRole("button", { name: "Confirm and recover" }).click();
  await expect(page.getByText("Encrypted field care while disconnected", { exact: true })).toBeVisible();
  await expect(page.locator(".sync-status")).toHaveText("Saved", { timeout: 5_000 });
});

test("logout locks pending ciphertext, reveals nothing to another user, and lets only the original user recover it", async ({ page, context }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await installRoutes(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await expect.poll(async () => (await encryptedRecords(page)).length).toBe(1);

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.getByRole("button", { name: "Add clinical note" }).click();
  await page.getByLabel("Note summary").fill("Retained only for the original clinician");
  await page.getByRole("button", { name: "Add to timeline" }).click();
  await expect(page.locator(".sync-status")).toHaveText("Pending sync");

  await page.getByRole("button", { name: "Log out" }).click();
  const warning = page.getByRole("alertdialog", { name: "Log out and lock this work?" });
  await expect(warning).toContainText("One report has unsynchronized changes");
  await expect(warning).toContainText("Sep 18, 2099");
  await warning.getByRole("button", { name: "Log out and lock work" }).click();
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  expect(await encryptedRecords(page)).toHaveLength(1);

  await context.setOffline(false);
  await page.getByLabel("Username").fill("other");
  await page.getByLabel("Password").fill("irrelevant-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Different Clinician", { exact: true })).toBeVisible();
  await expect(page.getByText(assignedCall.callNumber, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reopen report" })).toHaveCount(0);
  await expect(page.getByText(/recover/i)).toHaveCount(0);

  await page.getByRole("button", { name: "Log out" }).click();
  await page.getByLabel("Username").fill("original");
  await page.getByLabel("Password").fill("irrelevant-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Reopen report" }).click();
  await expect(page.getByText("Retained only for the original clinician", { exact: true })).toBeVisible();
});
