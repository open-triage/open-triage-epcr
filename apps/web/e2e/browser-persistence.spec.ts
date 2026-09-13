import { chromium, expect, test, type BrowserContext, type Route } from "@playwright/test";

const baseURL = "http://127.0.0.1:3108";
const sessionKey = "open-triage.clinician-session.v1";
const offlineReportsKey = "open-triage:offline-reports-v1";
const reportId = "42000000-0000-4000-8000-000000000052";
const clinicianId = "32000000-0000-4000-8000-000000000003";
const formVersionId = "32000000-0000-4000-8000-000000000008";

const assignedCall = {
  id: "32000000-0000-4000-8000-000000000052",
  callNumber: "SYN-20260903-052",
  unit: { id: "32000000-0000-4000-8000-000000000010", callSign: "Medic 32" },
  dispatchedAt: "2026-09-03T12:00:00.000Z",
  dispatchReason: "Medical assistance requested",
  chiefComplaint: null,
  status: "assigned",
} as const;

const openedAssignment = {
  assignmentId: assignedCall.id,
  report: {
    id: reportId,
    documentingUserId: clinicianId,
    formVersionId,
    catalogReleaseId: "42000000-0000-4000-8000-000000000014",
    revision: 0,
    status: "draft",
  },
  replacementAssignment: null,
} as const;

async function installRoutes(context: BrowserContext, allowInitialSave: boolean) {
  await context.route("**/demo-assigned-calls.json", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ assignedCalls: [assignedCall], canceledAssignmentIds: [], refreshedAt: new Date().toISOString() }),
  }));
  await context.route("**/demo-open-calls.json", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ openCalls: [], completedReportIds: [], refreshedAt: new Date().toISOString() }),
  }));
  await context.route(`**/api/calls/${assignedCall.id}/open`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(openedAssignment),
  }));
  await context.route("**/demo-open-assignment.json", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(openedAssignment),
  }));
  await context.route(`**/api/reports/${reportId}/reopen`, (route) => route.abort("internetdisconnected"));
  await context.route(`**/api/reports/${reportId}/draft-changes`, async (route: Route) => {
    if (!allowInitialSave) return route.abort("internetdisconnected");
    const command = route.request().postDataJSON() as { expectedRevision: number };
    allowInitialSave = false;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ id: reportId, status: "draft", revision: command.expectedRevision + 1 }),
    });
  });
}

/*
 * This exercises simulated same-phone browser persistence by fully closing Chromium
 * and relaunching the same user-data directory. It is not proof of physical Android
 * process eviction behavior, which remains a device-level validation concern.
 */
test("a persistent browser profile recovers only its clinician's open work after a process restart", async ({}, testInfo) => {
  const userDataDir = testInfo.outputPath("same-phone-profile");
  let context = await chromium.launchPersistentContext(userDataDir, {
    baseURL,
    viewport: { width: 393, height: 851 },
  });

  try {
    await installRoutes(context, true);
    let page = context.pages()[0] ?? await context.newPage();
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByLabel("Username").fill("demo");
    await page.getByLabel("Password").fill("opentriagedemo");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "Open call", exact: true }).click();
    await expect(page.locator(".sync-status")).toHaveText("Saving");
    await expect(page.locator(".sync-status")).toHaveText("Saved", { timeout: 3_000 });

    await context.setOffline(true);
    await page.getByRole("button", { name: "Add clinical note" }).click();
    await page.getByLabel("Note summary").fill("Care retained across a complete browser restart");
    await page.getByRole("button", { name: "Add to timeline" }).click();
    await expect(page.locator(".sync-status")).toHaveText("Pending sync", { timeout: 3_000 });

    const beforeRestart = await page.evaluate(({ metadataKey, expectedReportId }) => {
      const session = JSON.parse(localStorage.getItem("open-triage.clinician-session.v1")!);
      const cached = JSON.parse(localStorage.getItem(metadataKey)!)[0];
      const document = localStorage.getItem(`open-triage:standard-encounter-v1:report:${expectedReportId}`);
      return { session, cached, document };
    }, { metadataKey: offlineReportsKey, expectedReportId: reportId });
    expect(beforeRestart.session.user.id).toBe(clinicianId);
    expect(beforeRestart.cached.ownerUserId).toBe(clinicianId);
    expect(beforeRestart.cached.report.documentingUserId).toBe(clinicianId);
    expect(beforeRestart.cached.report.formVersionId).toBe(formVersionId);
    expect(beforeRestart.cached.report.revision).toBe(1);
    expect(beforeRestart.cached.syncStatus).toBe("pending");
    expect(beforeRestart.cached.queuedChanges).toHaveLength(1);
    expect(beforeRestart.document).toContain("Care retained across a complete browser restart");

    // Closing a persistent context terminates its Chromium process. The next launch
    // uses the same on-disk browser profile rather than copying storage in test code.
    await context.close();
    context = await chromium.launchPersistentContext(userDataDir, {
      baseURL,
      viewport: { width: 393, height: 851 },
    });
    await installRoutes(context, false);
    page = context.pages()[0] ?? await context.newPage();
    await page.goto("/");

    await expect(page.getByText("Signed in as Synthetic Clinician")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Assigned calls" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Open calls" })).toBeVisible();
    await expect(page.locator(".active-report-notice")).toHaveCount(0);
    await expect(page.getByText("Care retained across a complete browser restart", { exact: true })).toHaveCount(0);
    const recoveredCard = page.getByRole("region", { name: "Open calls" }).locator(".open-call-card");
    await expect(recoveredCard).toContainText(assignedCall.callNumber);
    await expect(recoveredCard).toContainText("Pending sync");

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Open calls" })).toHaveCount(0);
    await expect(page.getByText(assignedCall.callNumber, { exact: true })).toHaveCount(0);
    const retainedAfterLogout = await page.evaluate(({ metadataKey, expectedReportId }) => ({
      session: localStorage.getItem("open-triage.clinician-session.v1"),
      metadata: localStorage.getItem(metadataKey),
      document: localStorage.getItem(`open-triage:standard-encounter-v1:report:${expectedReportId}`),
    }), { metadataKey: offlineReportsKey, expectedReportId: reportId });
    expect(retainedAfterLogout.session).toBeNull();
    expect(retainedAfterLogout.metadata).toContain(clinicianId);
    expect(retainedAfterLogout.document).toContain("Care retained across a complete browser restart");

    await page.evaluate(({ key }) => {
      localStorage.setItem(key, JSON.stringify({
        accessToken: "other-clinician-token",
        user: { id: "32000000-0000-4000-8000-000000000099", displayName: "Other Clinician" },
        organization: { id: "32000000-0000-4000-8000-000000000001", name: "OpenTriage Synthetic EMS" },
        startedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      }));
    }, { key: sessionKey });
    await page.reload();
    await expect(page.getByText("Signed in as Other Clinician")).toBeVisible();
    await expect(page.getByRole("region", { name: "Open calls" }).getByText("You have no open calls.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reopen call" })).toHaveCount(0);

    await page.getByRole("button", { name: "Log out" }).click();
    await page.getByLabel("Username").fill("demo");
    await page.getByLabel("Password").fill("opentriagedemo");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(recoveredCard).toContainText(assignedCall.callNumber);
    await recoveredCard.getByRole("button", { name: "Reopen call" }).click();
    await expect(page.locator(".active-report-notice")).toHaveAttribute("data-report-id", reportId);
    await expect(page.locator(".active-report-notice")).toHaveAttribute("data-form-version-id", formVersionId);
    await expect(page.getByText("Care retained across a complete browser restart", { exact: true })).toBeVisible();
    await expect(page.locator(".sync-status")).toHaveText("Pending sync");
  } finally {
    await context.close();
  }
});
