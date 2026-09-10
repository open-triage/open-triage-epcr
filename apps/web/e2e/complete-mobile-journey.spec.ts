import { chromium, expect, test, type BrowserContext, type Route } from "@playwright/test";

const baseURL = "http://127.0.0.1:3108";
const clinicianId = "32000000-0000-4000-8000-000000000003";
const formVersionId = "32000000-0000-4000-8000-000000000008";
const reportId = "42000000-0000-4000-8000-000000000056";
const supportedViewports: Record<string, { width: number; height: number }> = {
  "android-360x800": { width: 360, height: 800 },
  "android-390x844": { width: 390, height: 844 },
};

const assignedCall = {
  id: "32000000-0000-4000-8000-000000000056",
  callNumber: "SYN-20260903-056",
  unit: { id: "32000000-0000-4000-8000-000000000010", callSign: "Medic 32" },
  dispatchedAt: "2026-09-03T12:00:00.000Z",
  dispatchReason: "Synthetic mobile workflow validation",
  chiefComplaint: null,
  status: "assigned",
} as const;

const replacementCall = {
  ...assignedCall,
  id: "32000000-0000-4000-8000-000000000057",
  callNumber: "SYN-20260903-057",
  dispatchedAt: "2026-09-03T12:10:00.000Z",
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
  replacementAssignment: replacementCall,
} as const;

interface JourneyState {
  backendOnline: boolean;
  assignmentOpened: boolean;
  completed: boolean;
  openRequests: number;
  revision: number;
  savedCommandIds: string[];
  commandRevisions: Map<string, number>;
}

async function installJourneyRoutes(context: BrowserContext, state: JourneyState) {
  const openAssignment = (route: Route) => {
    if (!state.backendOnline) return route.abort("internetdisconnected");
    state.assignmentOpened = true;
    state.openRequests += 1;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(openedAssignment) });
  };
  await context.route("**/demo-assigned-calls.json", (route) => {
    if (!state.backendOnline) return route.abort("internetdisconnected");
    const assignedCalls = state.assignmentOpened ? [replacementCall] : [assignedCall];
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ assignedCalls, canceledAssignmentIds: [], refreshedAt: new Date().toISOString() }),
    });
  });
  await context.route("**/demo-open-calls.json", (route) => {
    if (!state.backendOnline) return route.abort("internetdisconnected");
    const openCalls = state.assignmentOpened && !state.completed ? [{
      reportId,
      callNumber: assignedCall.callNumber,
      lastSavedAt: "2026-09-03T14:05:00.000Z",
      syncStatus: "saved",
      validationErrorCount: 1,
      revision: state.revision,
      formVersionId,
      catalogReleaseId: openedAssignment.report.catalogReleaseId,
    }] : [];
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        openCalls,
        completedReportIds: state.completed ? [reportId] : [],
        refreshedAt: new Date().toISOString(),
      }),
    });
  });
  await context.route("**/demo-open-assignment.json", openAssignment);
  await context.route(`**/api/calls/${assignedCall.id}/open`, openAssignment);
  await context.route(`**/api/reports/${reportId}/reopen`, (route) => {
    if (!state.backendOnline) return route.abort("internetdisconnected");
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ callNumber: assignedCall.callNumber, report: { ...openedAssignment.report, revision: state.revision, groups: [], occurrences: [] } }),
    });
  });
  await context.route(`**/api/reports/${reportId}/draft-changes`, async (route: Route) => {
    if (!state.backendOnline) return route.abort("internetdisconnected");
    const command = route.request().postDataJSON() as { commandId: string; expectedRevision: number };
    const acceptedRevision = state.commandRevisions.get(command.commandId);
    if (acceptedRevision !== undefined) return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ id: reportId, status: "draft", revision: acceptedRevision }),
    });
    expect(command.expectedRevision).toBe(state.revision);
    state.savedCommandIds.push(command.commandId);
    state.revision += 1;
    state.commandRevisions.set(command.commandId, state.revision);
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ id: reportId, status: "draft", revision: state.revision }),
    });
  });
}

/*
 * The configured Playwright projects execute this journey at both supported
 * Android-sized viewports. A persistent context is closed and relaunched so the
 * recovery assertion exercises Chromium's on-disk profile, not copied test state.
 */
test("the complete synthetic mobile call journey survives offline work, restart, sync, and stationary completion", async ({}, testInfo) => {
  const viewport = supportedViewports[testInfo.project.name];
  expect(viewport, `unsupported journey project ${testInfo.project.name}`).toBeTruthy();
  const userDataDir = testInfo.outputPath("complete-mobile-journey-profile");
  const state: JourneyState = {
    backendOnline: true,
    assignmentOpened: false,
    completed: false,
    openRequests: 0,
    revision: 0,
    savedCommandIds: [],
    commandRevisions: new Map(),
  };
  let context = await chromium.launchPersistentContext(userDataDir, { baseURL, viewport });

  try {
    await installJourneyRoutes(context, state);
    let page = context.pages()[0] ?? await context.newPage();
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await expect(page.getByLabel("Username")).toHaveValue("demo.clinician");
    await expect(page.getByLabel("Password")).toHaveValue("open-triage-demo");
    const signedInAt = Date.now();
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(assignedCall.callNumber, { exact: true })).toBeVisible({ timeout: 10_000 });
    expect(Date.now() - signedInAt).toBeLessThanOrEqual(10_000);
    await expect(page.getByRole("note", { name: "Prototype safety notice" })).toContainText("Synthetic data only");

    await page.getByRole("button", { name: "Open call", exact: true }).click();
    await expect(page.getByText(replacementCall.callNumber, { exact: true })).toBeHidden();
    await expect(page.locator(".active-report-notice")).toHaveAttribute("data-report-id", reportId);
    await expect(page.locator(".active-report-notice")).toHaveAttribute("data-form-version-id", formVersionId);
    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();

    const retryReportId = await page.evaluate(async ({ assignmentId }) => {
      const session = JSON.parse(localStorage.getItem("open-triage.clinician-session.v1")!);
      const response = await fetch(`/api/calls/${assignmentId}/open`, {
        method: "POST",
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      return (await response.json()).report.id;
    }, { assignmentId: assignedCall.id });
    expect(retryReportId).toBe(reportId);
    expect(state.openRequests).toBe(2);

    await expect(page.locator(".sync-status")).toHaveText("Saved", { timeout: 4_000 });
    await page.getByRole("button", { name: "Add clinical note" }).click();
    await page.getByLabel("Note summary").fill("Synthetic care documented on the Android-sized workflow");
    await page.getByRole("button", { name: "Add to timeline" }).click();
    await expect(page.getByRole("button", { name: /Edit Clinical note.*Synthetic care documented on the Android-sized workflow/ })).toBeVisible();
    await expect(page.locator(".sync-status")).toHaveText("Saved", { timeout: 4_000 });

    state.backendOnline = false;
    await context.setOffline(true);
    await page.getByRole("button", { name: "Add clinical note" }).click();
    await page.getByRole("button", { name: "Add to timeline" }).click();
    await expect(page.locator(".sync-status")).toHaveText("Pending sync", { timeout: 3_000 });
    await page.getByRole("button", { name: /^Checklist,/ }).click();
    await expect(page.locator(".checklist-findings li.error")).toHaveCount(0);
    await page.getByRole("button", { name: "Save & close" }).click();
    await expect(page.getByText(replacementCall.callNumber, { exact: true })).toBeVisible();
    const pendingCard = page.getByRole("region", { name: "Open calls" }).locator(".open-call-card").filter({ hasText: assignedCall.callNumber });
    await expect(pendingCard).toContainText("Pending sync");
    const queuedBeforeRestart = await page.evaluate(({ expectedReportId }) => {
      const reports = JSON.parse(localStorage.getItem("open-triage:offline-reports-v1")!);
      return reports.find((entry: { report: { id: string } }) => entry.report.id === expectedReportId).queuedChanges[0].command.commandId as string;
    }, { expectedReportId: reportId });

    await context.close();
    context = await chromium.launchPersistentContext(userDataDir, { baseURL, viewport });
    await installJourneyRoutes(context, state);
    page = context.pages()[0] ?? await context.newPage();
    await page.goto("/");
    await expect(page.getByText("Signed in as Synthetic Clinician")).toBeVisible();
    const recoveredCard = page.getByRole("region", { name: "Open calls" }).locator(".open-call-card").filter({ hasText: assignedCall.callNumber });
    await expect(recoveredCard).toContainText("Pending sync");
    await expect(page.locator(".active-report-notice")).toHaveCount(0);

    await context.setOffline(true);
    await recoveredCard.getByRole("button", { name: "Reopen call" }).click();
    await page.getByRole("button", { name: /^Timeline/ }).click();
    await expect(page.locator(".timeline-list button").filter({ hasText: "Synthetic care documented on the Android-sized workflow" })).toBeVisible();
    await expect(page.locator(".active-report-notice")).toHaveAttribute("data-form-version-id", formVersionId);
    await page.getByRole("button", { name: /^Checklist,/ }).click();
    await expect(page.locator(".checklist-findings li.error")).toHaveCount(0);
    await expect(page.locator(".checklist-findings li.warning")).toHaveCount(1);

    state.backendOnline = true;
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator(".sync-status")).toHaveText("Saved", { timeout: 4_000 });
    expect(state.savedCommandIds).toContain(queuedBeforeRestart);

    state.completed = true;
    await page.getByRole("button", { name: "Refresh calls" }).click();
    await expect(page.locator(".assignment-notice")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Timeline" })).toHaveCount(0);
    await expect(page.locator(".active-report-notice")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Open calls" }).getByText(assignedCall.callNumber, { exact: true })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
