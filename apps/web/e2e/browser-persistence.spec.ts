import { expect, test, type Page, type Route } from "@playwright/test";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import path from "node:path";
import { readFile } from "node:fs/promises";
import productionSettings from "@open-triage/contracts/config/installation.production.json";
import demoAssignedCalls from "../public/demo-assigned-calls.json";
import demoOpenAssignment from "../public/demo-open-assignment.json";
import { shippedWestDefinition } from "../../../defines/decision_support/west-localization.mjs";
import type { ClinicalDecisionSupportConfiguration, ClinicalFormConfiguration, EncounterDocument, EncounterGroupInstance, FinalizedDecisionSupportCalculation, TriageColour } from "@open-triage/contracts";

const westDefinition = shippedWestDefinition();

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
}, clinicalForm?: ClinicalFormConfiguration, reportSnapshot?: () => { document: EncounterDocument; revision: number }) {
  let opened = Boolean(existing);
  let restarted = false;
  let recoveryHandle = existing?.recoveryHandle ?? "";
  let reportKeyBase64 = existing?.reportKeyBase64 ?? "";
  let grantConsumed = false;
  let reauthenticationRequests = 0;
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
  await page.route("**/api/sessions/reauthenticate", (route) => {
    reauthenticationRequests += 1;
    return route.fulfill({ status: 500 });
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
    return route.fulfill({ json: clinicalForm
      ? { ...openedAssignment, report: { ...openedAssignment.report, clinicalForm, ...reportSnapshot?.() } }
      : openedAssignment });
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
    const command = route.request().postDataJSON() as { expectedRevision: number };
    revision = command.expectedRevision + 1;
    await route.fulfill({ json: { id: reportId, status: "draft", revision } });
  });
  await page.route(`**/api/reports/${reportId}/active`, (route) => route.fulfill({ status: 304 }));
  // This fixture has no active EPS integration; probing it must not reach the real API.
  await page.route(`**/api/reports/${reportId}/eps/context`, (route) => route.fulfill({ json: null }));
  return {
    restart: () => { restarted = true; },
    recovery: () => ({ recoveryHandle, reportKeyBase64 }),
    reauthenticationRequests: () => reauthenticationRequests,
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

for (const unavailableStatus of [404, 410]) {
  for (const entry of ["assigned", "reopen"] as const) {
    test(`${entry} opens online and saves when offline keys return ${unavailableStatus}`, async ({ page }) => {
      test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
      await installRoutes(page, true, entry === "reopen"
        ? { recoveryHandle: "expired-handle", reportKeyBase64: Buffer.alloc(32).toString("base64") }
        : undefined);
      await page.route(`**/api/reports/${reportId}/recovery-grants`, route => route.fulfill({ status: unavailableStatus }));
      await page.route(`**/api/reports/${reportId}/protected-key-envelope`, route => route.fulfill({ status: unavailableStatus }));
      let saves = 0;
      await page.route(`**/api/reports/${reportId}/draft-changes`, route => {
        saves++;
        const command = route.request().postDataJSON() as { expectedRevision: number };
        return route.fulfill({ json: { id: reportId, status: "draft", revision: command.expectedRevision + 1 } });
      });
      await page.goto("/");
      await page.getByRole("button", { name: "Stationary", exact: true }).click();
      await page.getByRole("button", { name: entry === "reopen" ? "Reopen report" : "Open call", exact: true }).click();
      await expect(page.locator(".active-report-notice")).toHaveAttribute("data-report-id", reportId);
      await expect(page.locator(".safety-notice")).toContainText("Offline storage unavailable");
      await expect(page.locator(".safety-notice")).toContainText("online editing and server saves remain available");
      const firstName = page.getByRole("textbox", { name: "First Name", exact: true });
      await firstName.fill("ONLINE EDIT");
      await firstName.press("Tab");
      await expect.poll(() => saves).toBeGreaterThan(0);
      expect(await encryptedRecords(page)).toHaveLength(0);
      expect(await page.evaluate(() => localStorage.getItem("open-triage:offline-reports-v1"))).toBeNull();
    });
  }
}

for (const deniedStatus of [401, 403]) {
  test(`reopen keeps a ${deniedStatus} preparation failure visible through polling and permits retry`, async ({ page }) => {
    test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
    await installRoutes(page, true, { recoveryHandle: "unavailable-handle", reportKeyBase64: Buffer.alloc(32).toString("base64") });
    await page.route(`**/api/reports/${reportId}/recovery-grants`, route => route.fulfill({ status: 404 }));
    let status = deniedStatus;
    await page.route(`**/api/reports/${reportId}/protected-key-envelope`, route => route.fulfill({ status }));
    let directoryReads = 0;
    page.on("response", response => { if (response.url().endsWith("/api/reports/open")) directoryReads++; });
    await page.goto("/");
    await page.getByRole("button", { name: "Reopen report", exact: true }).click();
    const failure = page.getByRole("alert").filter({ hasText: deniedStatus === 401
      ? "Your shift session has ended." : "Protected offline storage could not be prepared." });
    await expect(failure).toBeVisible();
    await expect(page.locator(".active-report-notice")).toHaveCount(0);
    const previousReads = directoryReads;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect.poll(() => directoryReads).toBeGreaterThan(previousReads);
    await expect(failure).toBeVisible();
    status = 404;
    await page.getByRole("button", { name: "Reopen report", exact: true }).click();
    await expect(page.locator(".active-report-notice")).toHaveAttribute("data-report-id", reportId);
    await expect(failure).toHaveCount(0);
  });
}

test("protected checkpoints stay ordered while a newer draft is saved", async ({ page }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await installRoutes(page);
  let releaseFirst!: () => void;
  const firstHeld = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let firstStarted!: () => void;
  const started = new Promise<void>((resolve) => { firstStarted = resolve; });
  const checkpoints: number[] = [];
  const receipts: number[] = [];
  let holdNext = false;
  let latestReceipt = 0;
  let synchronizedRevision = 0;
  await page.route(`**/api/reports/${reportId}/protected-ciphertext-receipt`, async (route) => {
    const { ciphertextRevision } = route.request().postDataJSON() as { ciphertextRevision: number };
    receipts.push(ciphertextRevision);
    latestReceipt = ciphertextRevision;
    await route.fulfill({ json: { schemaVersion: 1, recoveryDeadline: "2099-09-18T12:00:00.000Z" } });
  });
  await page.route(`**/api/reports/${reportId}/protected-ciphertext-checkpoint`, async (route) => {
    const { ciphertextRevision } = route.request().postDataJSON() as { ciphertextRevision: number };
    checkpoints.push(ciphertextRevision);
    if (holdNext) { holdNext = false; firstStarted(); await firstHeld; }
    if (ciphertextRevision < synchronizedRevision || ciphertextRevision !== latestReceipt)
      return route.fulfill({ status: 409 });
    synchronizedRevision = ciphertextRevision;
    return route.fulfill({ json: { ciphertextRevision } });
  });
  try {
    await page.goto("/");
    await page.getByRole("group", { name: "Documentation presentation" })
      .getByRole("button", { name: "Stationary" }).click();
    await page.getByRole("button", { name: "Open call", exact: true }).click();
    const firstName = page.getByRole("textbox", { name: "First Name", exact: true });
    await firstName.waitFor();
    holdNext = true;
    await firstName.fill("FIRST EDIT");
    await firstName.press("Tab");
    await started;
    const firstRevision = checkpoints.at(-1)!;
    const receiptsWhileHeld = [...receipts];
    await firstName.fill("STILL EDITABLE");
    await firstName.press("Tab");
    await expect(firstName).toHaveValue("STILL EDITABLE");
    expect(checkpoints.at(-1), "a newer checkpoint must wait for the first response").toBe(firstRevision);
    expect(receipts, "a newer receipt must wait for the first checkpoint").toEqual(receiptsWhileHeld);
    releaseFirst();
    await expect.poll(() => checkpoints.at(-1)).toBeGreaterThan(firstRevision);
    expect(receipts.some((revision) => revision > firstRevision)).toBe(true);
    expect(checkpoints).toEqual([...checkpoints].sort((a, b) => a - b));
    await expect(page.getByText("Saved data needs recovery")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "First Name", exact: true })).toBeEnabled();
  } finally { releaseFirst(); }
});

async function installAudioRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class TestMediaRecorder extends EventTarget {
      static isTypeSupported(type: string) { return type.startsWith("audio/webm"); }
      state: RecordingState = "inactive";
      mimeType = "audio/webm;codecs=opus";
      constructor(_stream: MediaStream, _options?: MediaRecorderOptions) { super(); }
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        this.dispatchEvent(new BlobEvent("dataavailable", { data: new Blob(["private-offline-voice"], { type: this.mimeType }) }));
        this.dispatchEvent(new Event("stop"));
      }
      pause() {} resume() {} requestData() {}
      ondataavailable = null; onerror = null; onpause = null; onresume = null; onstart = null; onstop = null;
      audioBitsPerSecond = 64_000; videoBitsPerSecond = 0;
      stream = {} as MediaStream; videoKeyFrameIntervalCount = undefined; videoKeyFrameIntervalDuration = undefined;
    }
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: TestMediaRecorder });
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const destination = context.createMediaStreamDestination();
      oscillator.connect(destination); oscillator.start();
      return destination.stream;
    };
  });
}

test("idle refreshes reuse protected ciphertext and do not repeat completed-report recovery grants", async ({ page }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await installRoutes(page);
  const completedId = "finished-without-local-ciphertext";
  const expiredGrantId = "finished-with-expired-grant";
  let receipts = 0;
  let recoveryChecks = 0;
  let expiredGrantChecks = 0;
  let activePolls = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/protected-ciphertext-receipt")) receipts += 1;
  });
  await page.route(`**/api/calls/${assignedCall.id}/open`, (route) => route.fulfill({ json: {
    ...openedAssignment, report: { ...openedAssignment.report, revision: 50 },
  } }));
  await page.route("**/api/reports/open", (route) => route.fulfill({ json: {
    openCalls: [{ reportId, callNumber: assignedCall.callNumber,
      lastSavedAt: "2026-09-17T10:00:00.000Z", syncStatus: "saved", validationErrorCount: 0,
      revision: 50, formVersionId: openedAssignment.report.formVersionId,
      catalogReleaseId: openedAssignment.report.catalogReleaseId, demoMutable: false }],
    completedReportIds: [completedId, expiredGrantId], refreshedAt: new Date().toISOString(),
  } }));
  await page.route(`**/api/reports/${completedId}/recovery-grants`, (route) => {
    recoveryChecks += 1;
    return route.fulfill({ json: {
      schemaVersion: 1, envelopeVersion: 1, recoveryHandle: "absent-completed-report",
      grant: "one-use-recovery-grant", expiresAt: "2099-09-18T12:00:00.000Z", reportStatus: "signed",
    } });
  });
  await page.route(`**/api/reports/${expiredGrantId}/recovery-grants`, (route) => {
    expiredGrantChecks += 1;
    return route.fulfill({ json: {
      schemaVersion: 1, envelopeVersion: 1, recoveryHandle: "absent-after-grant-retry",
      grant: "short-lived-grant", reportStatus: "signed",
      expiresAt: expiredGrantChecks === 1 ? "2000-01-01T00:00:00.000Z" : "2099-09-18T12:00:00.000Z",
    } });
  });
  // Even a server/proxy returning an identical body rather than 304 should
  // leave the rendered form and protected snapshot alone after reconciliation.
  await page.route(`**/api/reports/${reportId}/active`, (route) => {
    activePolls += 1;
    return route.fulfill({ json: {
      reportId, reportRevision: 50, dispatchRevision: 0,
      document: openedAssignment.report.document, dispatchConflicts: [], dispatchCancellation: null,
      mediaPolicy: { settingsRevision: 1, reportMediaAllowanceBytes: 10_485_760, imageMediaLimitBytes: 1_048_576 },
    } });
  });
  const refresh = async () => {
    await Promise.all([
      page.waitForResponse("**/api/reports/open"),
      page.waitForResponse(`**/api/reports/${reportId}/active`),
      page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))),
    ]);
    // Let IndexedDB writes and their receipt/checkpoint requests drain.
    await page.waitForTimeout(350);
  };
  await page.goto("/");
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await expect(page.locator(".sync-status")).toHaveText("Saved");
  await expect.poll(async () => (await encryptedRecords(page)).length).toBe(1);
  await refresh();
  const original = (await encryptedRecords(page))[0]!;
  const initialReceipts = receipts;
  expect(initialReceipts).toBeGreaterThan(0);
  for (let poll = 0; poll < 3; poll += 1) await refresh();
  expect(receipts).toBe(initialReceipts);
  expect((await encryptedRecords(page))[0]!.ciphertextRevision).toBe(original.ciphertextRevision);
  expect(recoveryChecks).toBe(0);
  expect(expiredGrantChecks).toBe(0);
  expect(activePolls).toBeGreaterThanOrEqual(4);
});

test("denied persistence falls back to encrypted best-effort IndexedDB", async ({ page, context }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await installRoutes(page, false);
  await page.goto("/");
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await expect(page.locator(".safety-notice")).toContainText("Best-effort offline storage");
  await expect.poll(async () => (await encryptedRecords(page)).length).toBe(1);

  await page.getByRole("button", { name: "Stationary", exact: true }).click();
  const before = Number((await encryptedRecords(page))[0]?.ciphertextRevision);
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.getByRole("textbox", { name: "First Name", exact: true }).fill("BEST-EFFORT-OFFLINE");
  await page.getByRole("textbox", { name: "First Name", exact: true }).press("Tab");
  await expect(page.locator(".sync-status")).toHaveText("Pending sync");
  await expect.poll(async () => Number((await encryptedRecords(page))[0]?.ciphertextRevision)).toBeGreaterThan(before);
});

const westOverrideField = { id: "cb884a4d-10ba-56d4-b1d4-8d5e8ea2af2c", namespace: "west.opentriage.org", slug: "FixtureOverrideColour",
  datatype: "coded", codeSystem: "https://opentriage.org/codes/west-a-2025/overrideColour",
  choices: westDefinition.assessment.result.overrideAllowed.map((code) => ({ code, label: code })),
};
const westFixtureCoded = (name: string) => ({
  namespace: "west.opentriage.org", slug: `Fixture${name}`, datatype: "coded",
  codeSystem: `https://opentriage.org/codes/west-a-2025/${name}`, choices: [],
});
const westDecisionSupport = {
  definition: westDefinition, fields: {
    overrideColour: westOverrideField,
    categories: westFixtureCoded("Categories"),
    criteria: westFixtureCoded("Criteria"),
    noWarningCriteria: { ...westFixtureCoded("NoWarningCriteria"), datatype: "boolean" },
    newsScale: { ...westFixtureCoded("NewsScale"), choices: Object.entries(westDefinition.assessment.elements.newsScale.values)
      .map(([code, scale]) => ({ code, label: scale.label.en })) },
    physiologyScore: { ...westFixtureCoded("PhysiologyScore"), datatype: "number", integer: true },
  },
} as unknown as ClinicalDecisionSupportConfiguration;

test("Mobile Vitals keeps an unsupported WEST draft and syncs a finalized manual downgrade", async ({ page, context }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await installRoutes(page, true, undefined, {
    definition: { schemaVersion: 1, sections: [] }, catalogFields: {}, decisionSupport: westDecisionSupport,
  });
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await expect(page.locator(".sync-status")).toHaveText("Saved");
  await expect.poll(async () => (await encryptedRecords(page)).length).toBe(1);

  const commands: Array<{ expectedRevision: number; groups: Array<Record<string, unknown>>;
    occurrences: Array<Record<string, unknown>> }> = [];
  await page.route(`**/api/reports/${reportId}/draft-changes`, async (route) => {
    const command = route.request().postDataJSON() as typeof commands[number];
    commands.push(command);
    await route.fulfill({ json: { id: reportId, status: "draft", revision: command.expectedRevision + 1 } });
  });
  const before = Number((await encryptedRecords(page))[0]?.ciphertextRevision);
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.getByRole("button", { name: "Add vital signs" }).click();
  const dialog = page.getByRole("dialog", { name: "Vital signs" });
  const systolic = dialog.getByRole("textbox", { name: /Systolic BP/ });
  const override = dialog.getByRole("combobox", { name: "WEST override" });
  await expect(dialog.getByRole("status").and(dialog.locator(".vital-decision-support-result"))).toHaveText("Unassessed");
  await systolic.fill("118");
  await dialog.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await expect(override).toBeInViewport();
  await dialog.getByRole("button", { name: "Add vital set" }).click();
  await expect(override).toBeFocused();
  await expect(dialog.getByRole("alert")).toContainText("choose a WEST color");
  await expect(systolic).toHaveValue("118");
  await expect.poll(async () => Number((await encryptedRecords(page))[0]?.ciphertextRevision)).toBeGreaterThan(before);
  expect(commands).toHaveLength(0);

  await override.selectOption("red");
  await expect(dialog.getByRole("status").and(dialog.locator(".vital-decision-support-result"))).toContainText("Red · Manual");
  await override.selectOption("");
  await expect(dialog.getByRole("status").and(dialog.locator(".vital-decision-support-result"))).toHaveText("Unassessed");
  await override.selectOption("red");
  await override.selectOption("green");
  await expect(dialog.getByRole("status").and(dialog.locator(".vital-decision-support-result"))).toContainText("Green · Manual");
  await expect(dialog.getByRole("status").and(dialog.locator(".vital-decision-support-result"))).toContainText("Calculated: Unassessed");
  await dialog.getByRole("button", { name: "Add vital set" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".sync-status")).toHaveText("Pending sync");
  await page.locator(".timeline-event-button").filter({ hasText: "Vital signs" }).first().click();
  await expect(override).toHaveValue("green");
  await expect(systolic).toHaveValue("118");
  await page.keyboard.press("Escape");

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator(".sync-status")).toHaveText("Saved");
  expect(commands).toHaveLength(1);
  const group = commands[0]!.groups.find(({ groupId }) => groupId === "eVitals.VitalGroup");
  expect(group).toMatchObject({ documentedTime: expect.any(String), decisionSupportCalculation: {
    status: "unassessed", colour: null, systemKey: westDefinition.key, version: westDefinition.version,
  } });
  expect(commands[0]!.occurrences.filter(({ elementId }) => elementId === "west.opentriage.org.FixtureOverrideColour"))
    .toEqual([expect.objectContaining({
      groupInstanceId: group?.id,
      sourceAttributes: { enteredBy: session.user.id, enteredAt: expect.any(String), calculatedColourWhenSelected: null },
      value: expect.objectContaining({ kind: "coded", code: "green", codeSystem: westOverrideField.codeSystem }),
    })]);
});

for (const labels of [
  { language: "en", openCall: "Open call", addVitals: "Add vital signs", category: "WEST category",
    finding: "Choose finding", longCriterion: /Head trauma with GCS ≤14/, documented: "Documented WEST findings" },
  { language: "sv", openCall: "Öppna uppdrag", addVitals: "Lägg till vitalparametrar", category: "WEST-kategori",
    finding: "Välj fynd", longCriterion: /Skalltrauma.*GCS 14/, documented: "Dokumenterade WEST-fynd" },
]) {
  test(`WEST criteria list fits the screen and wraps long findings in ${labels.language}`, async ({ page }) => {
    test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
    await page.setViewportSize({ width: 320, height: 568 });
    await installRoutes(page, true, undefined, {
      definition: { schemaVersion: 1, sections: [] }, catalogFields: {}, decisionSupport: westDecisionSupport,
    });
    await page.route("**/api/installation", (route) => route.fulfill({ json: { settings: { ...productionSettings, language: labels.language } } }));
    await page.goto("/");
    await page.getByRole("button", { name: labels.openCall, exact: true }).click();
    await page.getByRole("button", { name: labels.addVitals, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: labels.category }).selectOption("trauma-injuries");
    await dialog.getByLabel(labels.finding, { exact: true }).tap();
    const list = page.getByRole("listbox", { name: labels.finding });
    await expect(list).toBeInViewport({ ratio: 1 });
    expect(await list.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const longFinding = list.getByRole("option", { name: labels.longCriterion });
    await longFinding.scrollIntoViewIfNeeded();
    const layout = await longFinding.evaluate((row) => {
      const text = document.createRange();
      text.selectNodeContents(row);
      const bounds = row.getBoundingClientRect();
      const lines = [...text.getClientRects()];
      return { lines: lines.length, fits: lines.every(line => line.left >= bounds.left && line.right <= bounds.right) };
    });
    expect(layout.lines).toBeGreaterThan(1);
    expect(layout.fits).toBe(true);
    expect(await list.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await longFinding.tap();
    const recorded = dialog.getByRole("list", { name: labels.documented });
    await expect(recorded).toContainText(labels.longCriterion);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
}

async function selectWestFinding(page: Page, name: string | RegExp) {
  await page.getByRole("button", { name: "Choose finding", exact: true }).click();
  await page.getByRole("listbox", { name: "Choose finding" }).getByRole("option", { name, exact: true }).click();
}

test("Mobile WEST documents multiple findings and keeps the calculated level visible under an override", async ({ page }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await page.setViewportSize({ width: 320, height: 740 });
  await installRoutes(page, true, undefined, {
    definition: { schemaVersion: 1, sections: [] }, catalogFields: {}, decisionSupport: westDecisionSupport,
    customFields: Object.fromEntries(Object.entries(westDecisionSupport.fields)),
  });
  await page.route("**/api/installation", (route) =>
    route.fulfill({ json: { settings: { ...productionSettings, timeZone: "Europe/Stockholm" } } }));
  await page.clock.setFixedTime(new Date("2026-10-20T04:59:00Z"));
  await page.goto("/");
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await expect(page.locator(".sync-status")).toHaveText("Saved");
  const commands: Array<{ expectedRevision: number; groups: Array<Record<string, unknown>>;
    occurrences: Array<{ elementId: string; value: Record<string, unknown> }> }> = [];
  await page.route(`**/api/reports/${reportId}/draft-changes`, async (route) => {
    const command = route.request().postDataJSON() as typeof commands[number];
    commands.push(command);
    await route.fulfill({ json: { id: reportId, status: "draft", revision: command.expectedRevision + 1 } });
  });
  await page.getByRole("button", { name: "Add vital signs" }).click();
  const dialog = page.getByRole("dialog", { name: "Vital signs" });
  const category = dialog.getByRole("combobox", { name: "WEST category" });
  const documented = dialog.getByRole("list", { name: "Documented WEST findings" });
  const status = dialog.getByRole("status").and(dialog.locator(".vital-decision-support-result"));
  const choose = dialog.getByRole("button", { name: "Choose finding" });
  const options = dialog.getByRole("listbox", { name: "Choose finding" });
  const override = dialog.getByRole("combobox", { name: "WEST override" });
  await expect(category.locator('option[value^="gynaecology."]')).toHaveCount(6);
  await expect(category.getByRole("option", { name: "Trauma/injuries", exact: true })).toHaveCount(1);
  await category.selectOption("trauma-injuries");
  await choose.click();
  await expect(options.getByRole("option").first()).toHaveText("No criteria met");
  await expect(options.getByRole("option", { name: "Red · Ventilatory support needed · Level 1", exact: true })).toHaveCount(1);
  await expect(options.getByRole("option", { name: /Respiratory compromise/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(choose).toBeFocused();
  await expect(documented).toHaveCount(0);

  await category.selectOption("gynaecology.01");
  const referral = options.getByRole("option", { name: /Referral from a gynecologist for suspected ectopic pregnancy/ });
  await choose.click();
  await expect(referral).toHaveCount(0);
  await page.keyboard.press("Escape");
  await dialog.locator(".time-picker-trigger").click();
  const timePicker = page.getByRole("dialog", { name: "Select clinical time" });
  // Minute and hour wrap independently in the time wheel.
  await timePicker.getByRole("spinbutton", { name: "Minute" }).press("ArrowUp");
  await timePicker.getByRole("spinbutton", { name: "Hour" }).press("ArrowUp");
  await timePicker.getByRole("button", { name: "Use date & time" }).click();
  await choose.click();
  await expect(referral).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(documented).toHaveCount(0);

  await category.selectOption("gynaecology.04");
  await selectWestFinding(page, "Postoperative infection. See infection.");
  await expect(category).toHaveValue("infection");
  await expect(documented).toHaveCount(0);
  await selectWestFinding(page, "No criteria met");
  await expect(choose).toHaveText("Choose finding");
  await expect(status).toHaveText("Unassessed");
  await expect(documented).toContainText("No criteria met");

  await category.selectOption("bleeding");
  await choose.click();
  const firstFinding = options.getByRole("option").nth(1);
  await expect(firstFinding).toHaveText(/^Red · /);
  await expect(firstFinding).toHaveAttribute("data-colour", "red");
  const heavyBleeding = /Heavy vaginal bleeding soaking through several overnight pads per hour/;
  await options.getByRole("option", { name: heavyBleeding }).click();
  await expect(status).toContainText("Orange · Provisional");
  await expect(status).toContainText("Heavy vaginal bleeding soaking through several overnight pads per hour");
  await selectWestFinding(page, "No criteria met");
  await expect(status).toHaveText("Unassessed");
  await selectWestFinding(page, heavyBleeding);
  await expect(status).toContainText("Orange · Provisional");
  await expect(dialog.getByRole("checkbox", { name: "No warning criteria" })).toHaveCount(0);
  await override.selectOption("green");
  await expect(status).toContainText("Green · Manual");

  await category.selectOption("gynaecology.03");
  await selectWestFinding(page, heavyBleeding);
  await expect(status).toContainText("Calculated: Orange · Provisional");
  await category.selectOption("pregnancy-postpartum");
  await selectWestFinding(page, /Heavy vaginal bleeding in pregnancy/);
  await expect(status).toContainText("Calculated: Red");
  await expect(status).toContainText("Calculation changed since override");
  await expect(documented.getByRole("button", { name: /^Remove Heavy vaginal bleeding soaking/ })).toHaveCount(2);
  await override.selectOption("");
  await expect(status).toContainText("Red");
  await expect(status).not.toContainText("Provisional");

  await dialog.getByRole("button", { name: "Add vital set" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".sync-status")).toHaveText("Saved");
  expect(commands).toHaveLength(1);
  expect(commands[0]!.groups).toContainEqual(expect.objectContaining({ groupId: "eVitals.VitalGroup",
    decisionSupportCalculation: expect.objectContaining({ status: "definitive", colour: "red", criterionCode: "pregnancy-postpartum.01" }) }));
  const storedCodes = (field: string) => commands[0]!.occurrences.filter(({ elementId }) => elementId.endsWith(field))
    .map(({ value }) => value.code);
  expect(commands[0]!.occurrences.find(({ elementId }) => elementId === "eVitals.01")?.value)
    .toMatchObject({ kind: "datetime", utcOffsetMinutes: 120 });
  expect(storedCodes("FixtureCriteria")).toEqual(["infection.none", "bleeding.07", "gynaecology.03.04", "pregnancy-postpartum.01"]);
  expect(storedCodes("FixtureCategories")).toEqual(expect.arrayContaining(["infection", "bleeding", "gynaecology.03", "pregnancy-postpartum"]));
  await page.locator(".timeline-event-button").filter({ hasText: "Vital signs" }).first().click();
  await expect(documented).toContainText("No criteria met");
  await expect(status).toContainText("Red");
  await documented.getByRole("button", { name: /^Remove Heavy vaginal bleeding in pregnancy/ }).click();
  await expect(status).toContainText("Orange · Provisional");
});

test("Swedish WEST uses the installation language for offline choices, documented findings and their calculated result", async ({ page, context }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await installRoutes(page, true, undefined, {
    definition: { schemaVersion: 1, sections: [] }, catalogFields: {}, decisionSupport: westDecisionSupport,
  });
  await page.route("**/api/installation", (route) => route.fulfill({ json: { settings: { ...productionSettings, language: "sv" } } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Öppna uppdrag", exact: true }).click();
  await expect.poll(async () => (await encryptedRecords(page)).length).toBe(1);
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.getByRole("button", { name: "Lägg till vitalparametrar" }).click();
  const dialog = page.getByRole("dialog");
  const category = dialog.getByRole("combobox", { name: "WEST-kategori" });
  await category.selectOption({ label: "Trauma/skador" });
  await dialog.getByRole("button", { name: "Välj fynd" }).click();
  const finding = dialog.getByRole("listbox", { name: "Välj fynd" });
  await expect(finding.getByRole("option").first()).toHaveText("Inga kriterier uppfyllda");
  await finding.getByRole("option", { name: "Röd · Behov av ventilationsstöd · Nivå 1", exact: true }).click();
  await expect(dialog.getByRole("list", { name: "Dokumenterade WEST-fynd" })).toContainText("Trauma/skador");
  await expect(dialog.getByRole("button", { name: "Ta bort Behov av ventilationsstöd · Nivå 1" })).toBeVisible();
  await expect(dialog.locator(".vital-decision-support-result")).toContainText("Behov av ventilationsstöd · Nivå 1");
  const total = dialog.getByRole("status", { name: "Totalt NEWS2" });
  await expect(total).toHaveText("0 · Ofullständig");
  const oxygen = dialog.getByRole("combobox", { name: "Syrgas", exact: true });
  await oxygen.selectOption("supplemental");
  await expect(oxygen).toHaveAccessibleDescription("2 poäng");
  await expect(total).toHaveText("2 · Ofullständig");
  await expect(dialog.getByRole("combobox", { name: "NEWS-skala" }).getByRole("option", { name: "KOL" })).toHaveCount(1);
});

test("Mobile WEST scores the selected NEWS scale and syncs only a complete integer total", async ({ page, context }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await page.setViewportSize({ width: 320, height: 740 });
  await installRoutes(page, true, undefined, {
    definition: { schemaVersion: 1, sections: [] }, catalogFields: {}, decisionSupport: westDecisionSupport,
    customFields: Object.fromEntries(Object.entries(westDecisionSupport.fields)),
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await expect(page.locator(".sync-status")).toHaveText("Saved");
  await expect.poll(async () => (await encryptedRecords(page)).length).toBe(1);
  const commands: Array<{ expectedRevision: number; groups: Array<Record<string, unknown>>;
    occurrences: Array<Record<string, unknown>> }> = [];
  await page.route(`**/api/reports/${reportId}/draft-changes`, async (route) => {
    const command = route.request().postDataJSON() as typeof commands[number];
    commands.push(command);
    await route.fulfill({ json: { id: reportId, status: "draft", revision: command.expectedRevision + 1 } });
  });
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.getByRole("button", { name: "Add vital signs" }).click();
  const dialog = page.getByRole("dialog", { name: "Vital signs" });
  const scale = dialog.getByRole("combobox", { name: "NEWS scale" });
  const output = dialog.locator("output");
  const result = dialog.locator(".vital-decision-support-result");
  const respiratoryRate = dialog.getByRole("textbox", { name: /Respiratory rate/i });
  const pulse = dialog.getByRole("textbox", { name: /Pulse rate/ });
  const heartRate = dialog.getByRole("textbox", { name: /Heart rate/i });
  const temperature = dialog.getByRole("textbox", { name: /Temperature/i });
  await expect(scale).toHaveValue("standard");
  const oxygenPicker = dialog.getByRole("combobox", { name: "Oxygen", exact: true });
  const [scaleBox, oxygenBox] = await Promise.all([scale.boundingBox(), oxygenPicker.boundingBox()]);
  expect(oxygenBox!.x).toBeGreaterThan(scaleBox!.x + scaleBox!.width);
  expect(oxygenBox!.y).toBeCloseTo(scaleBox!.y);
  for (const field of [/Pulse rate/, /Temperature/i, /Systolic BP/]) {
    await expect(dialog.locator(".vital-grid .vital-field .vital-inputs").getByRole("textbox", { name: field })).toHaveCount(1);
  }
  await expect(output).toHaveText("0 · Incomplete");
  await expect(respiratoryRate).toHaveAccessibleDescription(/— pts/);
  await expect(oxygenPicker).toHaveAccessibleDescription("— pts");
  await respiratoryRate.fill("8");
  await expect(respiratoryRate).toHaveAccessibleDescription(/3 pts/);
  await expect(output).toHaveText("3 · Incomplete");
  await expect(result).toContainText("Yellow · Provisional");
  await respiratoryRate.fill("15");
  await expect(respiratoryRate).toHaveAccessibleDescription(/0 pts/);
  await dialog.getByRole("textbox", { name: /Systolic BP/ }).fill("120");
  await dialog.getByRole("textbox", { name: /Oxygen saturation|SpO[₂2]/i }).fill("97");
  await pulse.fill("70");
  await expect(pulse).toHaveAccessibleDescription("0 pts");
  await heartRate.fill("120");
  await expect(heartRate).toHaveAccessibleDescription(/2 pts/);
  await expect(pulse).toHaveAccessibleDescription("");
  await heartRate.clear();
  await expect(pulse).toHaveAccessibleDescription("0 pts");
  await temperature.fill("37,9");
  await dialog.getByRole("combobox", { name: "Oxygen", exact: true }).selectOption("air");
  await dialog.getByRole("combobox", { name: "Consciousness", exact: true }).selectOption("A");
  await expect(output).toHaveText("0");
  await expect(output).toHaveAccessibleName("NEWS2 total");
  await expect(result).toHaveText("Unassessed");
  await dialog.getByRole("combobox", { name: "WEST category" }).selectOption("infection");
  await selectWestFinding(page, "No criteria met");
  await expect(result).toContainText("Green");
  await scale.selectOption("obstetric");
  await expect(output).toHaveText("0 · Incomplete");
  const diastolic = dialog.getByRole("textbox", { name: /Diastolic BP/ });
  await diastolic.fill("90");
  await expect(diastolic).toHaveAccessibleDescription(/1 pt\b/);
  await expect(output).toHaveAccessibleName("ONEWS2 total");
  await expect(output).toHaveText("1");
  await scale.selectOption("copd");
  await expect(output).toHaveAccessibleName("NEWS2 total");
  await expect(diastolic).not.toHaveAccessibleDescription(/\bpts?\b/);
  await expect(output).toHaveText("0");
  await dialog.getByRole("combobox", { name: "Oxygen", exact: true }).selectOption("supplemental");
  await expect(output).toHaveText("5");
  await expect(oxygenPicker).toHaveAccessibleDescription("2 pts");
  await expect(dialog.getByRole("textbox", { name: /Oxygen saturation|SpO[₂2]/i })).toHaveAccessibleDescription(/3 pts/);
  await expect(result).toContainText("Orange");
  await expect(result).toContainText("Oxygen saturation");
  await temperature.fill("invalid");
  await expect(temperature).toHaveAccessibleDescription("— pts");
  await expect(output).toHaveText("5 · Incomplete");
  await expect(result).toContainText("Orange · Provisional");
  await temperature.fill("37.0");
  await dialog.getByRole("button", { name: "Add vital set" }).click();
  await expect(page.locator(".sync-status")).toHaveText("Pending sync");
  await page.locator(".timeline-event-button").filter({ hasText: "Vital signs" }).first().click();
  await expect(scale).toHaveValue("copd");
  await expect(output).toHaveText("5");
  await page.keyboard.press("Escape");
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator(".sync-status")).toHaveText("Saved");
  expect(commands).toHaveLength(1);
  const group = commands[0]!.groups.find(({ groupId }) => groupId === "eVitals.VitalGroup");
  expect(group?.decisionSupportCalculation).toMatchObject({ status: "definitive", colour: "orange",
    physiology: { total: 5, colour: "orange", points: { oxygen: 2, spo2: 3 } } });
  expect(commands[0]!.occurrences).toEqual(expect.arrayContaining([
    expect.objectContaining({ groupInstanceId: group?.id, elementId: "west.opentriage.org.FixtureNewsScale",
      value: expect.objectContaining({ kind: "coded", code: "copd" }) }),
    expect.objectContaining({ groupInstanceId: group?.id, elementId: "west.opentriage.org.FixturePhysiologyScore",
      value: expect.objectContaining({ kind: "integer", value: 5 }) }),
    expect.objectContaining({ elementId: "eVitals.24", value: expect.objectContaining({ kind: "numeric", value: 37 }) }),
  ]));
});

test("Mobile WEST repeat vitals preserve offline decisions and start fresh measurements", async ({ page, context }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await page.setViewportSize({ width: 320, height: 740 });
  await installRoutes(page, true, undefined, {
    definition: { schemaVersion: 1, sections: [] }, catalogFields: {}, decisionSupport: westDecisionSupport,
    customFields: Object.fromEntries(Object.entries(westDecisionSupport.fields)),
  });
  await page.clock.setFixedTime(new Date("2026-10-20T08:00:00Z"));
  await page.goto("/");
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await expect(page.locator(".sync-status")).toHaveText("Saved");
  await expect.poll(async () => (await encryptedRecords(page)).length).toBe(1);
  const commands: Array<{ commandId: string; expectedRevision: number; groups: Array<{ id: string; groupId: string }>;
    occurrences: Array<{ elementId: string; value?: { code?: string }; sourceAttributes?: Record<string, unknown> }> }> = [];
  await page.route(`**/api/reports/${reportId}/draft-changes`, async (route) => {
    const command = route.request().postDataJSON() as typeof commands[number];
    commands.push(command);
    await route.fulfill({ json: { id: reportId, status: "draft", revision: command.expectedRevision + 1 } });
  });

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  const dialog = page.getByRole("dialog", { name: "Vital signs" });
  const add = page.getByRole("button", { name: "Add vital signs" });
  const save = dialog.getByRole("button", { name: "Add vital set" });
  const scale = dialog.getByRole("combobox", { name: "NEWS scale" });
  const override = dialog.getByRole("combobox", { name: "WEST override" });
  const systolic = dialog.getByRole("textbox", { name: /Systolic BP/ });
  const oxygen = dialog.getByRole("combobox", { name: "Oxygen", exact: true });
  const consciousness = dialog.getByRole("combobox", { name: "Consciousness", exact: true });
  await add.click();
  await scale.selectOption("copd");
  await systolic.fill("120");
  await oxygen.selectOption("air");
  await consciousness.selectOption("A");
  await dialog.getByRole("combobox", { name: "WEST category" }).selectOption("infection");
  await selectWestFinding(page, "No criteria met");
  await override.selectOption("red");
  await save.click();
  await expect(dialog).toHaveCount(0);

  await page.clock.setFixedTime(new Date("2026-10-20T08:15:00Z"));
  await add.click();
  await expect(scale).toHaveValue("copd");
  await expect(override).toHaveValue("red");
  await expect(dialog.getByRole("list", { name: "Documented WEST findings" })).toContainText("No criteria met");
  await expect(systolic).toHaveValue("");
  await expect(oxygen).toHaveValue("");
  await expect(consciousness).toHaveValue("");
  await expect(dialog.locator("output")).toHaveText("0 · Incomplete");
  await save.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".sync-status")).toHaveText("Pending sync");
  await page.getByRole("button", { name: "Save & close" }).click();
  await expect(page.getByRole("heading", { name: "Open reports" })).toBeVisible();
  await page.getByRole("button", { name: "Reopen report" }).click();
  const rows = page.locator(".timeline-event-button").filter({ hasText: "Vital signs" });
  await rows.first().click();
  await expect(override).toHaveValue("red");
  await expect(systolic).toHaveValue("");
  await page.keyboard.press("Escape");
  await add.click();
  await override.selectOption("");
  await save.click();
  await expect(override).toBeFocused();
  await expect(dialog.getByRole("alert")).toContainText("choose a WEST color");
  await page.keyboard.press("Escape");

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator(".sync-status")).toHaveText("Saved");
  expect(commands).toHaveLength(2);
  expect(commands[1]!.commandId).not.toBe(commands[0]!.commandId);
  expect(commands[1]!.expectedRevision).toBe(commands[0]!.expectedRevision + 1);
  const sourceId = commands[0]!.groups.find(({ groupId }) => groupId === "eVitals.VitalGroup")?.id;
  const selection = (index: number) => commands[index]!.occurrences.find(({ elementId }) =>
    elementId === "west.opentriage.org.FixtureOverrideColour");
  expect(selection(1)).toMatchObject({ value: { code: "red" }, sourceAttributes: {
    ...selection(0)?.sourceAttributes, inheritedFromMeasurement: sourceId,
  } });
  expect(commands[1]!.occurrences.some(({ elementId }) => elementId === "eVitals.06")).toBe(false);
  expect(commands.flatMap(({ occurrences }) => occurrences)
    .some(({ elementId }) => elementId === "west.opentriage.org.FixturePhysiologyScore")).toBe(false);
});

test("Stationary Vitals uses the same WEST finalization rule while retaining its field editor", async ({ page }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await installRoutes(page, true, undefined, {
    definition: { schemaVersion: 1, sections: [{ key: "vitals", name: "Vitals", fields: [
      { key: "measured", source: { kind: "nemsis", elementId: "eVitals.01" } },
      { key: "pain", source: { kind: "nemsis", elementId: "eVitals.27" } },
    ] }] }, catalogFields: {}, decisionSupport: westDecisionSupport,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await page.getByRole("button", { name: "Stationary", exact: true }).click();
  await page.locator('[data-group-id="eVitals.VitalGroup"]').getByRole("button", { name: /Add/ }).click();
  const dialog = page.getByRole("dialog", { name: /Add Vital/ });
  const save = dialog.getByRole("button", { name: "Add row" });
  const override = dialog.getByRole("combobox", { name: "WEST override" });
  await save.click();
  await expect(override).toBeFocused();
  await expect(dialog.getByRole("alert")).toContainText("choose a WEST color");
  await override.selectOption("yellow");
  const synced = page.waitForRequest(`**/api/reports/${reportId}/draft-changes`);
  await save.click();
  await expect(dialog).toHaveCount(0);
  const command = (await synced).postDataJSON();
  expect(command.groups.find(({ groupId }: { groupId: string }) => groupId === "eVitals.VitalGroup"))
    .toMatchObject({ documentedTime: expect.any(String), decisionSupportCalculation: {
      status: "unassessed", colour: null, systemKey: westDefinition.key, version: westDefinition.version,
    } });
  expect(command.occurrences.find(({ elementId }: { elementId: string }) =>
    elementId === "west.opentriage.org.FixtureOverrideColour").value.code).toBe("yellow");
});

for (const persistentStorage of [true, false]) {
  test(`an acknowledged online save preserves newly queued offline edits with persistent storage=${persistentStorage}`, async ({ page, context }) => {
    test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
    await installRoutes(page, persistentStorage);
    await page.goto("/");
    await page.getByRole("button", { name: "Open call", exact: true }).click();
    await page.getByRole("button", { name: "Stationary", exact: true }).click();
    await expect(page.locator(".sync-status")).toHaveText("Saved");
    await expect.poll(async () => (await encryptedRecords(page)).length).toBe(1);
    let acknowledge!: () => void;
    let started!: () => void;
    const held = new Promise<void>(resolve => { acknowledge = resolve; });
    const requested = new Promise<void>(resolve => { started = resolve; });
    let saves = 0;
    await page.route(`**/api/reports/${reportId}/draft-changes`, async route => {
      saves += 1;
      const command = route.request().postDataJSON() as { expectedRevision: number };
      started();
      await held;
      await route.fulfill({ json: { id: reportId, status: "draft", revision: command.expectedRevision + 1 } });
    });
    const name = page.getByRole("textbox", { name: "First Name", exact: true });
    await name.fill("ONLINE-AWAITING-ACK");
    await name.press("Tab");
    await requested;
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    const before = Number((await encryptedRecords(page))[0]?.ciphertextRevision);
    await name.fill("OFFLINE-AFTER-REQUEST");
    await name.press("Tab");
    await expect(page.locator(".sync-status")).toHaveText("Pending sync");
    await expect.poll(async () => Number((await encryptedRecords(page))[0]?.ciphertextRevision)).toBeGreaterThan(before);
    const response = page.waitForResponse(`**/api/reports/${reportId}/draft-changes`);
    acknowledge();
    await (await response).finished();
    await expect(name).toHaveValue("OFFLINE-AFTER-REQUEST");
    await expect(page.locator(".sync-status")).toHaveText("Pending sync");
    expect(saves).toBe(1);
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator(".sync-status")).toHaveText("Saved");
    expect(saves).toBe(2);
    await expect(name).toHaveValue("OFFLINE-AFTER-REQUEST");
  });
}

test("WEST history distinguishes each saved level and another browser converges after offline sync", async ({ page, context, browser }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  const clinicalForm = {
    definition: { schemaVersion: 1 as const, sections: [] }, catalogFields: {}, decisionSupport: westDecisionSupport,
  };
  const redId = "42000000-0000-4000-8000-000000000020";
  const legacyId = "42000000-0000-4000-8000-000000000021";
  const vital = (instanceId: string, time: string): EncounterGroupInstance => ({
    instanceId, attributes: { "x-open-triage-owner": "clinician", documentedTime: time },
    elements: [{ id: "eVitals.01", values: [{ occurrenceId: `${instanceId}:time`, kind: "scalar", value: time }] }],
  });
  const red: EncounterGroupInstance = {
    ...vital(redId, "2025-03-02T08:00:00Z"),
    decisionSupportCalculation: {
      systemKey: westDecisionSupport.definition.key, version: westDefinition.version, status: "definitive", colour: "red",
    },
  };
  const legacy = vital(legacyId, "2025-03-02T10:00:00Z");
  let instances = [legacy, red];
  let revision = openedAssignment.report.revision;
  const baseDocument = openedAssignment.report.document as EncounterDocument;
  const reportSnapshot = () => ({
    revision,
    document: { ...baseDocument, groups: [...baseDocument.groups.filter(({ id }) => id !== "eVitals.VitalGroup"),
      { id: "eVitals.VitalGroup", instances }] },
  });
  await installRoutes(page, true, undefined, clinicalForm, reportSnapshot);
  await page.route(`**/api/reports/${reportId}/draft-changes`, async (route) => {
    const command = route.request().postDataJSON() as { expectedRevision: number;
      groups: { groupId: string; id: string; documentedTime: string; decisionSupportCalculation: FinalizedDecisionSupportCalculation }[];
      occurrences: { elementId: string; id: string; groupInstanceId: string; value: { code: string }; sourceAttributes: Record<string, string | null> }[];
    };
    const override = command.occurrences.find(({ elementId }) => elementId === "west.opentriage.org.FixtureOverrideColour")!;
    const group = command.groups.find(({ id }) => id === override.groupInstanceId)!;
    expect(group).toMatchObject({ groupId: "eVitals.VitalGroup", documentedTime: expect.any(String), decisionSupportCalculation: {
      systemKey: westDecisionSupport.definition.key, version: westDefinition.version,
    } });
    const finalized = vital(group.id, group.documentedTime);
    // Return the older red and unlabeled legacy records before the synced entry.
    instances = [red, legacy, { ...finalized, decisionSupportCalculation: group.decisionSupportCalculation,
      elements: [...finalized.elements, { id: override.elementId, values: [{
        occurrenceId: override.id, kind: "coded", code: override.value.code, attributes: override.sourceAttributes,
      }] }],
    }];
    revision = command.expectedRevision + 1;
    await route.fulfill({ json: { id: reportId, status: "draft", revision } });
  });

  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await expect.poll(async () => (await encryptedRecords(page)).length).toBe(1);
  const reportLevel = page.locator(".encounter-west-level");
  const timeline = page.getByRole("region", { name: "Timeline", exact: true });
  await expect(reportLevel).toHaveText("Latest WEST level · Red");
  await expect(timeline.locator(".west-level")).toHaveCount(1);
  const redRow = timeline.locator("li").filter({ hasText: "WEST · Red" });
  await expect(redRow.getByRole("button", { name: /Vital signs/ })).toHaveAccessibleDescription("WEST · Red");
  await expect(redRow.getByRole("img", { name: /Validation/ })).toBeVisible();

  await expect.poll(async () => Number((await encryptedRecords(page))[0]?.synchronizedRevision)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Add vital signs" }).click();
  const dialog = page.getByRole("dialog", { name: "Vital signs" });
  await expect(dialog.getByRole("status").and(dialog.locator(".vital-decision-support-result"))).toHaveText("Unassessed");
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.locator("main[data-editing-blocked]")).toHaveCount(0);
  await expect(reportLevel).toHaveText("Latest WEST level · Red");
  await expect(timeline.locator(".west-level")).toHaveCount(1);
  await dialog.getByRole("combobox", { name: "WEST override" }).selectOption("green");
  await dialog.getByRole("button", { name: "Add vital set" }).click();
  await expect(reportLevel).toHaveText("Latest WEST level · Green · Manual");
  await expect(timeline.locator(".west-level")).toHaveText(["WEST · Green · Manual", "WEST · Red"]);
  await expect(page.locator(".sync-status")).toHaveText("Pending sync");

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator(".sync-status")).toHaveText("Saved");
  expect(instances).toHaveLength(3);

  const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-US" });
  try {
    const second = await secondContext.newPage();
    await installRoutes(second, true, undefined, clinicalForm, reportSnapshot);
    await second.goto(page.url());
    await second.getByRole("button", { name: "Open call", exact: true }).click();
    await expect(second.locator(".encounter-west-level")).toHaveText("Latest WEST level · Green · Manual");
    await expect(second.getByRole("region", { name: "Timeline", exact: true }).locator(".west-level"))
      .toHaveText(["WEST · Green · Manual", "WEST · Red"]);
  } finally {
    await secondContext.close();
  }
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
    await expect(second.locator("input[type=password]")).toHaveCount(0);
    await expect(second.locator(".active-report-notice")).toHaveAttribute("data-report-id", reportId);
    await expect.poll(async () => (await encryptedRecords(second)).length).toBe(1);
    const adopted = (await encryptedRecords(second))[0]!;
    expect(adopted.checkpointScope).toBe("browser");
    expect(adopted.localRecordId).not.toBe(original.localRecordId);
    expect(browserScopedReceipts).toBeGreaterThan(0);
    await second.getByRole("button", { name: "Stationary", exact: true }).click();
    await otherContext.setOffline(true);
    await second.evaluate(() => window.dispatchEvent(new Event("offline")));
    await second.getByRole("textbox", { name: "First Name", exact: true }).fill("Second-browser-offline");
    await second.getByRole("textbox", { name: "First Name", exact: true }).press("Tab");
    await expect(second.locator(".sync-status")).toHaveText("Pending sync");
    await expect.poll(async () => Number((await encryptedRecords(second))[0]?.ciphertextRevision))
      .toBeGreaterThan(Number(adopted.ciphertextRevision));
    expect((await encryptedRecords(page))[0]!.localRecordId).toBe(original.localRecordId);
  } finally {
    await otherContext.close();
  }
});

for (const restartedBrowser of [false, true]) {
  test(`opening an assigned call adopts an existing browser's key${restartedBrowser ? " after restart using the current login" : ""}`, async ({ page, browser }) => {
    test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
    const first = await installRoutes(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Open call", exact: true }).click();
    await expect.poll(async () => (await encryptedRecords(page)).length).toBe(1);
    const original = (await encryptedRecords(page))[0]!;
    const otherContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const second = await otherContext.newPage();
      const routes = await installRoutes(second, true, first.recovery());
      if (restartedBrowser) routes.restart();
      let registrations = 0;
      await second.route(`**/api/reports/${reportId}/protected-key-envelope`, route => {
        registrations += 1;
        return route.fulfill({ status: 409 });
      });
      // Opening consumes the assignment. Polling must not remove the card that
      // is still preparing the protected report using its current login.
      await second.route("**/api/calls/assigned", route => route.fulfill({ json: {
        assignedCalls: registrations === 0 ? [assignedCall] : [], canceledAssignmentIds: [],
      } }));
      await second.goto(page.url());
      await second.getByRole("button", { name: "Open call", exact: true }).click();
      await expect(second.locator('input[type=password]')).toHaveCount(0);
      expect(routes.reauthenticationRequests()).toBe(0);
      await expect(second.locator(".active-report-notice")).toHaveAttribute("data-report-id", reportId);
      await expect(second.getByText("Offline storage unavailable", { exact: true })).toHaveCount(0);
      await expect.poll(async () => (await encryptedRecords(second)).length).toBe(1);
      const adopted = (await encryptedRecords(second))[0]!;
      expect(adopted.checkpointScope).toBe("browser");
      expect(adopted.localRecordId).not.toBe(original.localRecordId);
      expect(adopted.recoveryHandle).toBe(original.recoveryHandle);
      expect(registrations).toBe(1);
      expect((await encryptedRecords(page))[0]!.localRecordId).toBe(original.localRecordId);
    } finally { await otherContext.close(); }
  });
}

test("hundreds of completed reports do not delay the directory or trigger recovery in a fresh browser", async ({ page }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await installRoutes(page, true, { recoveryHandle: "unused", reportKeyBase64: Buffer.alloc(32).toString("base64") });
  let checks = 0;
  await page.route("**/api/reports/open", route => route.fulfill({ json: {
    openCalls: [{ reportId, callNumber: "OPEN-NOW", lastSavedAt: new Date().toISOString(), syncStatus: "saved",
      validationErrorCount: 0, revision: 1, formVersionId: openedAssignment.report.formVersionId,
      catalogReleaseId: openedAssignment.report.catalogReleaseId }],
    completedReportIds: Array.from({ length: 450 }, (_, index) => `completed-${index}`),
  } }));
  await page.route("**/api/reports/*/recovery-grants", route => { checks++; return route.fulfill({ status: 404 }); });
  await page.goto("/");
  await expect(page.getByText("OPEN-NOW", { exact: true })).toBeVisible();
  await expect(page.getByText("Loading open reports…", { exact: true })).toHaveCount(0);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(300);
  expect(checks).toBe(0);
});

test("a stalled completed-report recovery leaves open reports usable and preserves pending ciphertext", async ({ page }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await installRoutes(page, true, { recoveryHandle: "unused", reportKeyBase64: Buffer.alloc(32).toString("base64") });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Reopen report" })).toBeVisible();
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("open-triage-protected-clinical-v1", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction("encrypted-reports", "readwrite");
        transaction.objectStore("encrypted-reports").put({ localRecordId: "pending-opaque-record", schemaVersion: 1,
          algorithm: "AES-256-GCM", recoveryHandle: "pending-opaque-handle", recoveryDeadline: "2099-01-01T00:00:00Z",
          ciphertextRevision: 2, synchronizedRevision: 1, updatedAt: new Date().toISOString(),
          nonce: new ArrayBuffer(12), ciphertext: new ArrayBuffer(16) });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { database.close(); }
  });
  let checks = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/reports/open", route => route.fulfill({ json: {
    openCalls: [{ reportId, callNumber: "VISIBLE-DURING-RECOVERY", lastSavedAt: new Date().toISOString(),
      syncStatus: "saved", validationErrorCount: 0, revision: 1, formVersionId: openedAssignment.report.formVersionId,
      catalogReleaseId: openedAssignment.report.catalogReleaseId }], completedReportIds: ["finished-with-pending-work"],
  } }));
  await page.route("**/api/reports/finished-with-pending-work/recovery-grants", async route => {
    checks++; await held; await route.fulfill({ status: 404 });
  });
  try {
    await page.reload();
    await expect.poll(() => checks).toBe(1);
    await expect(page.getByText("VISIBLE-DURING-RECOVERY", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reopen report" })).toBeEnabled();
    expect((await encryptedRecords(page))[0]!.localRecordId).toBe("pending-opaque-record");
  } finally { release(); }
});

test("completed-report recovery still submits retained pending work after the directory is displayed", async ({ page }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await installRoutes(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Open reports" })).toBeVisible();
  const command = { commandId: "60000000-0000-4000-8000-000000000099", expectedRevision: 1, groups: [], occurrences: [] };
  const key = await page.evaluate(async ({ report, user, callNumber, command }) => {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt"]);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const payload = { schemaVersion: 1, report: { report, ownerUserId: user, callNumber,
      workflowState: "open", syncStatus: "pending", lastSavedAt: new Date().toISOString(), validationErrorCount: 0,
      queuedChanges: [{ command, attempted: false }] } };
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128,
      additionalData: new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, recoveryHandle: "retained-handle", ciphertextRevision: 2 })) },
    key, new TextEncoder().encode(JSON.stringify(payload)));
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("open-triage-protected-clinical-v1", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction("encrypted-reports", "readwrite");
        transaction.objectStore("encrypted-reports").put({ localRecordId: "retained-record", schemaVersion: 1,
          algorithm: "AES-256-GCM", recoveryHandle: "retained-handle", recoveryDeadline: "2099-01-01T00:00:00Z",
          ciphertextRevision: 2, synchronizedRevision: 1, updatedAt: new Date().toISOString(), nonce: nonce.buffer, ciphertext });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { database.close(); }
    return btoa(String.fromCharCode(...raw));
  }, { report: openedAssignment.report, user: session.user.id, callNumber: assignedCall.callNumber, command });
  await page.route("**/api/reports/open", route => route.fulfill({ json: { openCalls: [],
    completedReportIds: [reportId, "unnecessary-historical-check"] } }));
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let checks = 0;
  await page.route("**/api/reports/*/recovery-grants", async route => {
    checks++;
    await held;
    await route.fulfill({ json: { schemaVersion: 1, envelopeVersion: 1, recoveryHandle: "retained-handle",
      grant: "single-use", expiresAt: "2099-01-01T00:00:00Z", reportStatus: "signed" } });
  });
  await page.route(`**/api/reports/${reportId}/recovery-grants/consume`, route => route.fulfill({ json: {
    reportKeyBase64: key, wrappingKeyVersion: 1,
  } }));
  let submitted = false;
  await page.route(`**/api/reports/${reportId}/draft-changes`, route => {
    expect(route.request().postDataJSON()).toEqual(command);
    submitted = true;
    return route.fulfill({ json: { id: reportId, status: "signed", revision: 2 } });
  });
  try {
    await page.reload();
    await expect.poll(() => checks).toBe(1);
    await expect(page.getByText("Loading open reports…", { exact: true })).toHaveCount(0);
    expect(submitted).toBe(false);
    release();
    await expect.poll(() => submitted).toBe(true);
    await expect.poll(async () => (await encryptedRecords(page)).length).toBe(0);
    expect(checks).toBe(1);
  } finally { release(); }
});

test("switching presentations preserves a queued draft save", async ({ page }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await installRoutes(page);
  let draftSaves = 0;
  page.on("request", (request) => {
    if (request.url().endsWith(`/api/reports/${reportId}/draft-changes`)) draftSaves += 1;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await page.getByRole("button", { name: "Stationary", exact: true }).click();
  await page.getByRole("textbox", { name: "First Name", exact: true }).fill("PRESENTATION-SWITCH");
  await page.getByRole("textbox", { name: "First Name", exact: true }).press("Tab");
  await expect(page.locator(".sync-status")).toHaveText("Saving");
  await page.getByRole("group", { name: "Documentation presentation" })
    .getByRole("button", { name: "Mobile" }).click();
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
  await page.getByRole("button", { name: "Stationary", exact: true }).click();
  await page.getByRole("textbox", { name: "First Name", exact: true }).fill("ENCRYPTED-OFFLINE-RECOVERY");
  await page.getByRole("textbox", { name: "First Name", exact: true }).press("Tab");
  await expect(page.locator(".sync-status")).toHaveText("Pending sync");
  await expect.poll(async () => Number((await encryptedRecords(page))[0]?.ciphertextRevision)).toBeGreaterThan(Number(before.ciphertextRevision));
  const after = (await encryptedRecords(page))[0]!;
  expect(Buffer.from(after.ciphertext as number[]).equals(Buffer.from(before.ciphertext as number[]))).toBe(false);
  expect(JSON.stringify(after)).not.toContain("ENCRYPTED-OFFLINE-RECOVERY");

  await page.getByRole("button", { name: "Save & close" }).click();
  await expect(page.getByRole("heading", { name: "Open reports" })).toBeVisible();
  await page.getByRole("button", { name: "Reopen report" }).click();
  await expect(page.getByRole("textbox", { name: "First Name", exact: true })).toHaveValue("ENCRYPTED-OFFLINE-RECOVERY");

  await page.getByRole("button", { name: "Save & close" }).click();
  await context.setOffline(false);
  controls.restart();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("main", { name: "Opening OpenTriage" })).toBeVisible();
  await expect(page.getByText("Reconnect to continue.", { exact: true })).toHaveCount(0);
  await expect(page.getByText(assignedCall.callNumber, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Open reports" })).toBeVisible();
  await page.getByRole("button", { name: "Reopen report" }).click();
  await expect(page.locator("input[type=password]")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "First Name", exact: true })).toHaveValue("ENCRYPTED-OFFLINE-RECOVERY");
  await expect(page.locator(".sync-status")).toHaveText("Saved", { timeout: 5_000 });
  expect(controls.reauthenticationRequests()).toBe(0);
});

test("an offline audio note survives close and resumes one verified upload after reconnect", async ({ page, context }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await installRoutes(page);
  await installAudioRecorder(page);
  const canonical = Buffer.from("verified-canonical-audio");
  const sha256 = createHash("sha256").update(canonical).digest("hex");
  let uploads = 0;
  await page.route(`**/api/reports/${reportId}/audio`, async (route) => {
    uploads += 1;
    const command = route.request().postDataJSON() as { noteId: string; expectedRevision: number; capturedAt: string;
      capturedUtcOffsetMinutes: number; caption: string | null };
    await route.fulfill({ json: { reportId, revision: command.expectedRevision + 1, note: {
      id: command.noteId, reportId, type: "audio", caption: command.caption, capturedAt: command.capturedAt,
      capturedUtcOffsetMinutes: command.capturedUtcOffsetMinutes, author: session.user,
      serverReceivedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), persistenceState: "ready",
      contentType: "audio/mp4", byteSize: canonical.length, sha256, durationMilliseconds: 300,
    } } });
  });
  await page.route(`**/api/reports/${reportId}/audio/*/content`, (route) => route.fulfill({
    contentType: "audio/mp4", body: canonical,
  }));

  await page.goto("/");
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await expect.poll(async () => (await encryptedRecords(page)).length).toBe(1);
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.getByRole("button", { name: "Add audio note" }).click();
  const dialog = page.getByRole("dialog", { name: "Audio note" });
  const holdButton = dialog.getByRole("button", { name: "Hold to record" });
  await holdButton.dispatchEvent("pointerdown", { button: 0, pointerId: 1 });
  await page.waitForTimeout(300);
  await dialog.getByRole("button", { name: "Recording — release to stop" }).dispatchEvent("pointerup", { button: 0, pointerId: 1 });
  await dialog.getByRole("button", { name: "Use recording" }).click();
  await expect(page.getByRole("img", { name: "Audio note Saved on this device" })).toBeVisible();
  const ciphertext = JSON.stringify((await encryptedRecords(page))[0]);
  expect(ciphertext).not.toContain("private-offline-voice");

  page.once("dialog", (confirmation) => void confirmation.accept());
  await page.getByRole("button", { name: "Save & close" }).click();
  await page.getByRole("button", { name: "Reopen report" }).click();
  await expect(page.getByRole("img", { name: "Audio note Saved on this device" })).toBeVisible();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("img", { name: "Audio note Ready" })).toBeVisible({ timeout: 10_000 });
  expect(uploads).toBe(1);
});

async function captureMedia(page: Page, kind: "photo" | "audio") {
  await page.getByRole("button", { name: `Add ${kind} note` }).click();
  const dialog = page.getByRole("dialog", { name: kind === "photo" ? "Photo note" : "Audio note" });
  if (kind === "photo") {
    await expect.poll(() => dialog.locator("video").evaluate((video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
    await dialog.getByRole("button", { name: "Take photo", exact: true }).click();
    await dialog.getByRole("button", { name: "Use photo", exact: true }).click();
  } else {
    await dialog.getByRole("button", { name: "Hold to record" }).dispatchEvent("pointerdown", { button: 0, pointerId: 1 });
    const recording = dialog.getByRole("button", { name: "Recording — release to stop" });
    await expect(recording).toBeVisible();
    await page.waitForTimeout(350);
    await recording.dispatchEvent("pointerup", { button: 0, pointerId: 1 });
    await dialog.getByRole("button", { name: "Use recording" }).click();
  }
}

async function installPhotoCamera(page: Page) {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640; canvas.height = 480;
      canvas.getContext("2d")!.fillRect(0, 0, 640, 480);
      return canvas.captureStream(5);
    };
    navigator.mediaDevices.enumerateDevices = async () => [];
  });
}

for (const kind of ["photo", "audio"] as const) {
  test(`a rejected ${kind} upload can be deleted without uploading it again`, async ({ page }) => {
    test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
    await installRoutes(page);
    await (kind === "photo" ? installPhotoCamera(page) : installAudioRecorder(page));
    const resource = kind === "photo" ? "photos" : "audio";
    let uploads = 0;
    let deletes = 0;
    await page.route(`**/api/reports/${reportId}/${resource}`, (route) => {
      uploads += 1;
      return route.fulfill({ status: 422, json: { message: "Rejected media" } });
    });
    await page.route(`**/api/reports/${reportId}/${resource}/*`, (route) => {
      expect(route.request().method()).toBe("DELETE");
      deletes += 1;
      const command = route.request().postDataJSON();
      return route.fulfill({ json: { deleted: true, reportId, revision: command.expectedRevision + 1 } });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Open call", exact: true }).click();
    await expect(page.locator(".sync-status")).toHaveText("Saved");
    await captureMedia(page, kind);
    await page.getByRole("button", { name: /^Checklist/ }).click();
    const readiness = page.getByRole("region", { name: "Note readiness" });
    await expect(readiness).toContainText(`${kind === "photo" ? "Photo" : "Audio"} note is failed`);
    await readiness.getByRole("button").click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: `Delete ${kind}`, exact: true }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(readiness.getByRole("button")).toHaveCount(0);
    expect(uploads).toBe(1);
    expect(deletes).toBe(1);
  });
}

test("a queued photo retries with its original command and caches the verified server bytes", async ({ page }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await installRoutes(page);
  await installPhotoCamera(page);
  let uploads = 0;
  let originalCommand: unknown;
  let canonical: Buffer;
  await page.route(`**/api/reports/${reportId}/photos`, (route) => {
    const command = route.request().postDataJSON();
    uploads += 1;
    if (uploads === 1) {
      originalCommand = command;
      return route.fulfill({ status: 422, json: { message: "Encoder metadata rejected" } });
    }
    expect(command).toEqual(originalCommand);
    return route.fulfill({ json: { reportId, revision: command.expectedRevision + 1, note: {
      id: command.noteId, reportId, type: "photo", caption: command.caption, capturedAt: command.capturedAt,
      capturedUtcOffsetMinutes: command.capturedUtcOffsetMinutes, author: session.user,
      serverReceivedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), persistenceState: "ready",
      contentType: "image/jpeg", byteSize: canonical.length, sha256: createHash("sha256").update(canonical).digest("hex"),
      width: 640, height: 480,
    } } });
  });
  await page.route(`**/api/reports/${reportId}/photos/*/image`, (route) => route.fulfill({ contentType: "image/jpeg", body: canonical }));
  await page.goto("/");
  canonical = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640; canvas.height = 480;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#275d38"; context.fillRect(0, 0, 640, 480);
    return canvas.toDataURL("image/jpeg").split(",")[1]!;
  }), "base64");
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await expect(page.locator(".sync-status")).toHaveText("Saved");
  await captureMedia(page, "photo");
  await page.getByRole("button", { name: /^Checklist/ }).click();
  const readiness = page.getByRole("region", { name: "Note readiness" });
  await expect(readiness).toContainText("Photo note is failed");
  await readiness.getByRole("button").click();
  await page.getByRole("button", { name: "Retry upload" }).click();
  await expect(readiness.getByRole("button")).toHaveCount(0);
  await page.getByRole("button", { name: /^Timeline/ }).click();
  await page.getByRole("button", { name: /^Open photo note/ }).click();
  const image = page.getByRole("dialog").locator("img");
  await expect(image).toBeVisible();
  const displayed = await image.evaluate(async (element: HTMLImageElement) =>
    [...new Uint8Array(await (await fetch(element.src)).arrayBuffer())]);
  expect(Buffer.from(displayed)).toEqual(canonical);
  expect(uploads).toBe(2);
});

test("logout locks pending ciphertext, reveals nothing to another user, and lets only the original user recover it", async ({ page, context }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await installRoutes(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await expect.poll(async () => (await encryptedRecords(page)).length).toBe(1);

  await page.getByRole("button", { name: "Stationary", exact: true }).click();
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.getByRole("textbox", { name: "First Name", exact: true }).fill("Retained-original");
  await page.getByRole("textbox", { name: "First Name", exact: true }).press("Tab");
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
  await expect(page.getByRole("banner")).toContainText("Signed in as Different Clinician");
  await expect(page.getByText(assignedCall.callNumber, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reopen report" })).toHaveCount(0);
  await expect(page.getByText(/recover/i)).toHaveCount(0);

  await page.getByRole("button", { name: "Log out" }).click();
  await page.getByLabel("Username").fill("original");
  await page.getByLabel("Password").fill("irrelevant-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Reopen report" }).click();
  await expect(page.getByRole("textbox", { name: "First Name", exact: true })).toHaveValue("Retained-original");
});


test("stationary editing locks after offline storage failure and preserves the prior pending ciphertext", async ({ page, context }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await installRoutes(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Stationary", exact: true }).click();
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  const firstName = page.getByRole("textbox", { name: "First Name", exact: true });
  await expect(firstName).toBeEnabled();
  await context.setOffline(true);
  await firstName.fill("RETAINED PENDING");
  await firstName.press("Tab");
  await expect.poll(async () => {
    const [record] = await encryptedRecords(page);
    return Boolean(record && Number(record.ciphertextRevision) > Number(record.synchronizedRevision));
  }).toBe(true);
  const before = await encryptedRecords(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) {
      if (this.name === "encrypted-reports") throw new DOMException("Synthetic disk failure", "UnknownError");
      return put.apply(this, args);
    };
  });
  await firstName.fill("UNSAVED FAILURE");
  await firstName.press("Tab");
  await expect(page.locator(".safety-notice")).toContainText("Protected storage failed while offline");
  await expect(firstName).toBeDisabled();
  expect(await encryptedRecords(page)).toEqual(before);
});

for (const staleOnline of [false, true]) test(`connection loss during a ciphertext receipt preserves storage with stale online ${staleOnline}`, async ({ page, context }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await installRoutes(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Stationary", exact: true }).click();
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  const firstName = page.getByRole("textbox", { name: "First Name", exact: true });
  await expect(firstName).toBeEnabled();
  let waiting = false, release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/reports/${reportId}/protected-ciphertext-receipt`, async route => {
    waiting = true; await held; await route.abort("internetdisconnected");
  });
  await firstName.fill("RECEIPT IN FLIGHT"); await firstName.press("Tab");
  await expect.poll(() => waiting).toBe(true);
  if (staleOnline) {
    const failed = page.waitForEvent("requestfailed", request => request.url().endsWith("/protected-ciphertext-receipt"));
    release(); await failed;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    await expect(page.locator(".safety-notice").filter({ hasText: "This browser cannot preserve offline changes" })).toHaveCount(0);
    await context.setOffline(true);
  } else { await context.setOffline(true); release(); }
  await expect(page.locator(".safety-notice").filter({ hasText: "Protected storage failed while offline" })).toHaveCount(0);
  await firstName.fill("CONTINUED OFFLINE"); await firstName.press("Tab");
  await expect.poll(async () => {
    const [record] = await encryptedRecords(page);
    return Boolean(record && Number(record.ciphertextRevision) > Number(record.synchronizedRevision));
  }).toBe(true);
  await expect(firstName).toBeEnabled();
  await expect(firstName).toHaveValue("CONTINUED OFFLINE");
});

for (const bodyResult of ["disconnect", "malformed"] as const) test(`ciphertext receipt body ${bodyResult} preserves its storage and authority boundary`, async ({ page, context }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await installRoutes(page);
  // Include baseline checkpoints deliberately. Only the intercepted receipt's
  // revision is forbidden; an earlier successful receipt may settle while the
  // form becomes editable and must not be miscounted as failed-body authority.
  const checkpoints: number[] = [];
  let baselineHeld = false, holdNext = false, releaseBaseline!: () => void;
  const baseline = new Promise<void>(resolve => { releaseBaseline = resolve; });
  page.once("close", () => releaseBaseline());
  await page.route(`**/api/reports/${reportId}/protected-ciphertext-checkpoint`, async route => {
    if (holdNext) { holdNext = false; baselineHeld = true; await baseline; }
    checkpoints.push(Number(route.request().postDataJSON().ciphertextRevision));
    return route.fulfill({ json: route.request().postDataJSON() });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Stationary", exact: true }).click();
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  const firstName = page.getByRole("textbox", { name: "First Name", exact: true });
  await expect(firstName).toBeEnabled();
  holdNext = true;
  await firstName.fill("VALID EARLIER RECEIPT"); await firstName.press("Tab");
  await expect.poll(() => baselineHeld).toBe(true);
  await page.evaluate(() => {
    const original = window.fetch;
    (window as unknown as { receiptBody?: ReadableStreamDefaultController<Uint8Array> }).receiptBody = undefined;
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.href;
      if (!url.endsWith("/protected-ciphertext-receipt")) return original(input, init);
      (window as unknown as { receiptRevision: number }).receiptRevision = Number(JSON.parse(String(init?.body)).ciphertextRevision);
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) {
        (window as unknown as { receiptBody: ReadableStreamDefaultController<Uint8Array> }).receiptBody = controller;
        controller.enqueue(new TextEncoder().encode('{"schemaVersion":1'));
      } }), { status: 201, headers: { "content-type": "application/json" } }));
    };
  });
  await firstName.fill("STREAMED RECEIPT"); await firstName.press("Tab");
  releaseBaseline();
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { receiptBody?: unknown }).receiptBody))).toBe(true);
  const receiptRevision = await page.evaluate(() => (window as unknown as {receiptRevision: number}).receiptRevision);
  expect(receiptRevision).toBeGreaterThan(0);
  await context.setOffline(true);
  await page.evaluate(result => {
    const controller = (window as unknown as { receiptBody: ReadableStreamDefaultController<Uint8Array> }).receiptBody;
    if (result === "disconnect") controller.error(new TypeError("Synthetic response connection terminated"));
    else controller.close();
  }, bodyResult);
  if (bodyResult === "malformed") {
    await expect(page.locator(".safety-notice")).toContainText("Protected storage failed while offline");
    await expect(firstName).toBeDisabled();
  } else {
    await expect(firstName).toBeEnabled();
    await firstName.fill("CONTINUED STREAM LOSS"); await firstName.press("Tab");
    await expect.poll(async () => { const [record] = await encryptedRecords(page); return Boolean(record && Number(record.ciphertextRevision) > Number(record.synchronizedRevision)); }).toBe(true);
    await expect(page.locator(".safety-notice").filter({ hasText: "Protected storage failed while offline" })).toHaveCount(0);
  }
  expect(checkpoints.some(revision => revision < receiptRevision)).toBe(true);
  expect(checkpoints.filter(revision => revision >= receiptRevision)).toEqual([]);
});

for (const status of [401, 403]) test(`reopening cannot use a cached report after authoritative HTTP ${status}`, async ({ page }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await installRoutes(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await expect(page.locator(".active-report-notice")).toHaveAttribute("data-report-id", reportId);
  await page.getByRole("button", { name: "Save & close" }).click();
  await expect(page.getByRole("button", { name: "Reopen report" })).toBeVisible();
  await page.route(`**/api/reports/${reportId}/reopen`, route => route.fulfill({ status, json: { message: "Clinical access was withdrawn" } }));
  await page.getByRole("button", { name: "Reopen report" }).click();
  if (status === 401) await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
  else await expect(page.locator(".open-reports .assignment-error")).toBeVisible();
  await expect(page.locator(".encounter-header")).toHaveCount(0);
  await expect(page.locator(".report-reauthentication")).toHaveCount(0);
});

for (const navigation of ["button", "android-back"] as const) test(`${navigation} awaits the protected IndexedDB completion before unmounting offline work`, async ({ page, context }, testInfo) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await installRoutes(page);
  if (navigation === "android-back") {
    const css = await readFile(path.resolve(__dirname, "../app/styles.css"), "utf8") + await readFile(path.resolve(__dirname, "../app/session-layout.css"), "utf8");
    const bundled = await build({ bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
      define: { "process.env": JSON.stringify({ NEXT_PUBLIC_API_URL: "same-origin", NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION: "false" }) },
      stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Home from './app/page';import {handleAndroidBack} from './app/android-navigation';window.androidBack=()=>handleAndroidBack(async()=>{window.didBackground=true});createRoot(document.getElementById('root')).render(<Home/>);` } });
    await page.route("**/__android-back", route => route.fulfill({ contentType: "text/html", body: `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${bundled.outputFiles[0]!.text}</script></body></html>` }));
  }
  await page.goto(navigation === "button" ? "/" : "/__android-back");
  await page.getByRole("button", { name: "Stationary", exact: true }).click();
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  const firstName = page.getByRole("textbox", { name: "First Name", exact: true });
  await expect(firstName).toBeEnabled();
  await expect.poll(async () => (await encryptedRecords(page)).length).toBe(1);
  await context.setOffline(true);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put; let hold = true;
    const gates = new WeakMap<IDBTransaction, { held: boolean; listener: IDBTransaction["oncomplete"] }>();
    IDBObjectStore.prototype.put = function(...args) {
      if (this.name === "encrypted-reports" && hold) {
        const incoming = args[0] as { localRecordId: string; ciphertextRevision: number };
        const transaction = this.transaction;
        // Read before this put in the same transaction: receipt/deadline writes
        // keep the stored revision and must not impersonate a new encrypted edit.
        const previous = this.get(incoming.localRecordId);
        let gate = gates.get(transaction);
        if (!gate) {
          gate = { held: false, listener: transaction.oncomplete }; gates.set(transaction, gate);
          const state = gate; transaction.oncomplete = null;
          Object.defineProperty(transaction, "oncomplete", { configurable: true, get: () => state.listener,
            set: listener => { state.listener = listener; } });
          transaction.addEventListener("complete", event => {
            const listener = state.listener;
            if (state.held) Object.assign(window, { protectedWriteHeld: true, releaseProtectedWrite: () => listener?.call(transaction, event) });
            else listener?.call(transaction, event);
          });
        }
        const state = gate;
        previous.addEventListener("success", () => {
          if (hold && incoming.ciphertextRevision > (previous.result?.ciphertextRevision ?? 0)) { hold = false; state.held = true; }
        });
      }
      return put.apply(this, args);
    };
  });
  await firstName.fill("CLOSE DURABILITY"); await firstName.press("Tab");
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { protectedWriteHeld?: boolean }).protectedWriteHeld))).toBe(true);
  if (navigation === "button") await page.getByRole("button", { name: "Save & close", exact: true }).click();
  else await page.evaluate(() => {
    const back = (window as unknown as { androidBack(): void }).androidBack;
    void back(); void back();
  });
  await expect(page.locator(".encounter-header")).toBeVisible();
  await page.evaluate(() => (window as unknown as { releaseProtectedWrite(): void }).releaseProtectedWrite());
  await expect(page.locator(".encounter-header")).toHaveCount(0);
  await page.getByRole("button", { name: "Reopen report", exact: true }).click();
  await expect(firstName).toHaveValue("CLOSE DURABILITY");
  if (navigation === "android-back") {
    await page.setViewportSize({ width: 320, height: 616 });
    await page.addStyleTag({ content: ":root{--text-caption:18px;--text-body:21px;--text-control:24px;--text-heading:36px}" });
    await expect(page.locator(".session-bar [data-change-installation]")).toHaveCount(0);
    // Identity stays readable without an installation-change action taking header space.
    await expect(page.locator(".session-account")).toBeVisible();
    expect(await page.locator(".session-bar").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.locator(".session-bar").evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(616 * .6);
    await page.keyboard.press("Tab");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath("native-session-header-large-text.png") });
    await firstName.evaluate(element => element.scrollIntoView({block: "end", behavior: "instant"}));
    await page.screenshot({ path: testInfo.outputPath("native-session-large-text.png") });
    expect(await firstName.evaluate(element => { const r = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); })).toBe(true);
    await page.setViewportSize({ width: 320, height: 440 });
    await page.addStyleTag({ content: ":root{--text-caption:18px;--text-body:21px;--text-control:24px;--text-heading:36px}" });
    const close = page.getByRole("button", { name: "Save & close", exact: true });
    await close.scrollIntoViewIfNeeded();
    await expect(close).toBeInViewport({ ratio: 1 });
    expect(await page.locator(".draft-actions button").evaluateAll(buttons => buttons.every(button => button.scrollWidth <= button.clientWidth + 1))).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("clinical-short-large-text.png") });
    expect(await close.evaluate(element => { const r = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); })).toBe(true);
    await page.getByRole("button", { name: "Mobile", exact: true }).click();
    await page.getByRole("button", { name: "Text note", exact: true }).click();
    const summary = page.getByLabel("Note text", { exact: true });
    await summary.fill("UNSAVED NAVIGATION NOTE");
    page.once("dialog", dialog => dialog.dismiss());
    await page.evaluate(() => (window as unknown as { androidBack(): Promise<void> }).androidBack());
    await expect(summary).toHaveValue("UNSAVED NAVIGATION NOTE");
    page.once("dialog", dialog => dialog.accept());
    await page.evaluate(() => (window as unknown as { androidBack(): Promise<void> }).androidBack());
    await expect(summary).toHaveCount(0);
    await page.getByRole("button", { name: "Stationary", exact: true }).click();
    await expect(firstName).toHaveValue("CLOSE DURABILITY");
  }
});

test("Save and close retries a failed receipt without requiring another clinical edit", async ({ page }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await installRoutes(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Stationary", exact: true }).click();
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  const firstName = page.getByRole("textbox", { name: "First Name", exact: true });
  await expect(firstName).toBeEnabled();
  let fail = true, attempts = 0;
  await page.route(`**/api/reports/${reportId}/protected-ciphertext-receipt`, route => {
    attempts++;
    return fail ? route.abort("failed") : route.fulfill({ json: { schemaVersion: 1, recoveryDeadline: "2099-09-18T12:00:00.000Z" } });
  });
  await firstName.fill("RETRY CLOSE"); await firstName.press("Tab");
  await expect.poll(() => attempts).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Save & close", exact: true }).click();
  await expect(page.getByText("Protected storage could not finish. Keep the report open and retry.", { exact: true })).toBeVisible();
  await expect(page.locator(".encounter-header")).toBeVisible();
  await expect(firstName).toBeEnabled();
  fail = false;
  await page.getByRole("button", { name: "Save & close", exact: true }).click();
  await expect(page.locator(".encounter-header")).toHaveCount(0);
});

test("the initial stale server poll cannot reverse a recovered queued edit already present in its cached document", async ({ page, context }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  const controls = await installRoutes(page);
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "Stationary", exact: true }).click();
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  const firstName = page.getByRole("textbox", { name: "First Name", exact: true });
  await expect(firstName).toBeEnabled();
  let connected = false;
  await page.route("**/api/**", route => connected ? route.fallback() : route.abort("internetdisconnected"));
  await context.setOffline(true);
  await firstName.fill("RECOVERED DURABLE"); await firstName.press("Tab");
  await expect(page.locator(".sync-status")).toHaveText("Pending sync");
  await page.getByRole("button", { name: "Save & close", exact: true }).click();
  await expect(page.locator(".encounter-header")).toHaveCount(0);
  const [pendingRecord] = await encryptedRecords(page);
  expect(Number(pendingRecord!.ciphertextRevision)).toBeGreaterThan(Number(pendingRecord!.synchronizedRevision));
  let pollStarted = false, saveStarted = false, staleDelivered = false;
  let releasePoll!: () => void, releaseSave!: () => void;
  const heldPoll = new Promise<void>(resolve => { releasePoll = resolve; });
  const heldSave = new Promise<void>(resolve => { releaseSave = resolve; });
  const writes: boolean[] = [];
  await page.route(`**/api/reports/${reportId}/active`, async route => {
    if (!connected) return route.abort("internetdisconnected");
    if (staleDelivered) return route.fulfill({ status: 304 });
    pollStarted = true; await heldPoll; staleDelivered = true;
    return route.fulfill({ json: { reportId, reportRevision: openedAssignment.report.revision, dispatchRevision: 0,
      document: openedAssignment.report.document, dispatchConflicts: [], dispatchCancellation: null,
      mediaPolicy: { settingsRevision: 1, reportMediaAllowanceBytes: 10485760, imageMediaLimitBytes: 1048576 } } });
  });
  await page.route(`**/api/reports/${reportId}/draft-changes`, async route => {
    if (!connected) return route.abort("internetdisconnected");
    const command = route.request().postDataJSON() as { expectedRevision: number };
    writes.push(JSON.stringify(command).includes("RECOVERED DURABLE")); saveStarted = true;
    if (writes.length === 1) await heldSave;
    return route.fulfill({ json: { id: reportId, status: "draft", revision: command.expectedRevision + 1 } });
  });
  controls.restart();
  // Destroy the old runtime before restoring the shell's network; API routes stay unreachable.
  await page.goto("about:blank");
  await context.setOffline(false);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".session-loading [role=alert]")).toBeVisible();
  connected = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("button", { name: "Reopen report", exact: true })).toBeVisible();
  try {
    await page.getByRole("button", { name: "Reopen report", exact: true }).click();
    await expect.poll(() => ({ pollStarted, saveStarted })).toEqual({ pollStarted: true, saveStarted: true });
    const received = page.waitForResponse(response => response.url().endsWith(`/reports/${reportId}/active`) && response.status() === 200);
    releasePoll(); await (await received).finished();
    // Let the fetched resource and its React render settle, with the real save still held.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(firstName).toHaveValue("RECOVERED DURABLE");
    releaseSave();
    await expect(page.locator(".sync-status")).toHaveText("Saved");
    await page.clock.runFor(2000);
    await expect(firstName).toHaveValue("RECOVERED DURABLE");
    expect(writes, "acknowledging recovered work must not enqueue an old-shell reverse edit").toEqual([true]);
  } finally { releasePoll(); releaseSave(); }
});

for (const { width, language, openCall, addVitals, overrideLabel, cancelLabel, unassessed, latest, manual,
  olderLevel, useDateTime, checklist, timeline } of [
  { width: 320, language: "en", openCall: "Open call", addVitals: "Add vital signs", overrideLabel: "WEST override",
    cancelLabel: "Cancel", unassessed: "Unassessed", latest: "Latest WEST level · Red", manual: "Orange · Manual",
    olderLevel: "WEST · Yellow", useDateTime: "Use date & time", checklist: "Checklist", timeline: "Timeline" },
  { width: 390, language: "sv", openCall: "Öppna uppdrag", addVitals: "Lägg till vitalparametrar", overrideLabel: "Manuell WEST-färg",
    cancelLabel: "Avbryt", unassessed: "Ej bedömd", latest: "Senaste WEST-nivå · Röd", manual: "Orange · Manuell",
    olderLevel: "WEST · Gul", useDateTime: "Använd datum och tid", checklist: "Checklista", timeline: "Tidslinje" },
]) {
  test(`mobile WEST frame follows the current assessment while scrolling at ${width}px`, async ({ page }) => {
    test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
    await page.setViewportSize({ width, height: 620 });
    await page.clock.setFixedTime(new Date("2026-10-20T08:00:00Z"));
    const vital = (instanceId: string, measuredAt: string, colour: TriageColour): EncounterGroupInstance => ({
      instanceId,
      attributes: { "x-open-triage-owner": "clinician", documentedTime: measuredAt },
      elements: [{ id: "eVitals.01", values: [{ occurrenceId: `${instanceId}:time`, kind: "scalar", value: measuredAt }] }],
      decisionSupportCalculation: {
        systemKey: westDecisionSupport.definition.key, version: westDefinition.version, status: "definitive", colour,
      },
    });
    const earlierVital = vital("42000000-0000-4000-8000-000000000021", "2026-10-18T08:00:00Z", "yellow");
    const latestVital = vital("42000000-0000-4000-8000-000000000020", "2026-10-19T08:00:00Z", "red");
    const baseDocument = openedAssignment.report.document as EncounterDocument;
    const encounterDocument = { ...baseDocument, groups: [...baseDocument.groups.filter(({ id }) => id !== "eVitals.VitalGroup"),
      { id: "eVitals.VitalGroup", instances: [earlierVital, latestVital] }] };
    await installRoutes(page, true, undefined,
      { definition: { schemaVersion: 1, sections: [] }, catalogFields: {}, decisionSupport: westDecisionSupport },
      () => ({ document: encounterDocument, revision: openedAssignment.report.revision }));
    await page.route("**/api/installation", (route) => route.fulfill({ json: {
      settings: { ...productionSettings, language, timeZone: "Europe/Stockholm" },
    } }));
    await page.goto("/");
    await page.getByRole("button", { name: openCall, exact: true }).click();

    const frame = page.locator(".west-encounter-frame");
    const reportLevel = page.locator(".encounter-west-level").getByRole("status");
    const expectFrame = async (colour: string, cssColour: string) => {
      await expect(frame).toHaveAttribute("data-colour", colour);
      await expect(frame).toHaveCSS("position", "fixed");
      await expect(frame).toHaveCSS("pointer-events", "none");
      for (const edge of ["top", "right", "bottom", "left"]) {
        await expect(frame).toHaveCSS(`border-${edge}-width`, "2px");
        await expect(frame).toHaveCSS(`border-${edge}-color`, cssColour);
      }
      await expect.poll(() => frame.evaluate((element) => {
        const { top, right, bottom, left } = element.getBoundingClientRect();
        const root = element.ownerDocument.documentElement;
        return [top, right - root.clientWidth, bottom - root.clientHeight, left];
      })).toEqual([0, 0, 0, 0]);
    };
    await expect(reportLevel).toHaveText(latest);
    await expectFrame("red", "rgb(193, 43, 54)");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await expectFrame("red", "rgb(193, 43, 54)");

    const trigger = page.getByRole("button", { name: addVitals, exact: true });
    await trigger.click();
    const dialog = page.locator(".vital-dialog");
    const override = dialog.getByRole("combobox", { name: overrideLabel });
    const liveResult = dialog.getByRole("status").and(dialog.locator(".vital-decision-support-result"));
    await expect(liveResult).toHaveText(unassessed);
    await expectFrame("gray", "rgb(112, 119, 121)");
    await override.selectOption("orange");
    await expect(liveResult).toContainText(manual);
    await expect(reportLevel).toHaveText(latest);
    await dialog.evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await expect.poll(() => dialog.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(override).toBeInViewport();
    await expectFrame("orange", "rgb(201, 98, 18)");

    await dialog.locator(".time-picker-trigger").click();
    const calendar = dialog.locator(".time-picker-popover");
    await calendar.locator(".date-wheel").press("ArrowDown");
    await calendar.locator(".date-wheel").press("ArrowDown");
    await calendar.getByRole("button", { name: useDateTime }).click();
    await expect(liveResult).toContainText(manual);
    await expectFrame("red", "rgb(193, 43, 54)");
    await dialog.getByRole("button", { name: cancelLabel, exact: true }).click();
    await expect(trigger).toBeFocused();
    await expectFrame("red", "rgb(193, 43, 54)");

    const earlierRowAction = page.getByRole("region", { name: timeline, exact: true })
      .locator("li").filter({ hasText: olderLevel }).getByRole("button");
    await earlierRowAction.click();
    await override.selectOption("orange");
    await expect(liveResult).toContainText(manual);
    await expect(reportLevel).toHaveText(latest);
    await expectFrame("red", "rgb(193, 43, 54)");
    await dialog.getByRole("button", { name: cancelLabel, exact: true }).click();
    await expect(earlierRowAction).toBeFocused();

    const navigation = page.locator(".view-switcher");
    await navigation.getByRole("button", { name: new RegExp(checklist) }).click();
    await expect(page.getByRole("heading", { name: checklist, exact: true })).toBeVisible();
    await expectFrame("red", "rgb(193, 43, 54)");
    await navigation.getByRole("button", { name: timeline, exact: true }).click();
    await expect(page.getByRole("region", { name: timeline, exact: true })).toBeVisible();
    await expect(reportLevel).toHaveText(latest);
    await expectFrame("red", "rgb(193, 43, 54)");
  });
}

test("ordinary Mobile Vitals without WEST has no assessment frame", async ({ page }) => {
  test.skip(!serverBacked, "requires OPEN_TRIAGE_E2E_SERVER_MODE=true");
  await installRoutes(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await page.getByRole("button", { name: "Add vital signs", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Vital signs", exact: true })).toBeVisible();
  await expect(page.locator(".west-encounter-frame")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "WEST override" })).toHaveCount(0);
});
