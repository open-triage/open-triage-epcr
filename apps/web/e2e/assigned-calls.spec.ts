import { expect, test, type Page, type Route } from "@playwright/test";

const assignedCall = {
  id: "32000000-0000-4000-8000-000000000011",
  callNumber: "SYN-2026-0903-001",
  unit: { id: "32000000-0000-4000-8000-000000000010", callSign: "Medic 32" },
  dispatchedAt: "2026-09-03T12:00:00.000Z",
  dispatchReason: "Medical assistance requested",
  chiefComplaint: null,
  status: "assigned"
} as const;

const replacementCall = {
  ...assignedCall,
  id: "42000000-0000-4000-8000-000000000012",
  callNumber: "SYN-2026-0903-002",
  dispatchedAt: "2026-09-03T12:15:00.000Z"
} as const;

const openedAssignment = {
  assignmentId: assignedCall.id,
  report: {
    id: "42000000-0000-4000-8000-000000000013",
    documentingUserId: "32000000-0000-4000-8000-000000000003",
    formVersionId: "32000000-0000-4000-8000-000000000008",
    catalogReleaseId: "42000000-0000-4000-8000-000000000014",
    revision: 0,
    status: "draft"
  },
  replacementAssignment: replacementCall
} as const;

async function signIn(page: Page) {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Sign in" }).click();
}

function fulfill(route: Route, assignedCalls = [assignedCall], canceledAssignmentIds: string[] = []) {
  return route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ assignedCalls, canceledAssignmentIds, refreshedAt: new Date().toISOString() })
  });
}

test("the demo unit's assigned call shows its operational summary and manual cancellation refresh", async ({ page }) => {
  let canceled = false;
  await page.route("**/demo-assigned-calls.json", (route) => fulfill(route, canceled ? [] : [assignedCall], canceled ? [assignedCall.id] : []));
  await signIn(page);

  const section = page.getByRole("region", { name: "Assigned calls" });
  const card = section.locator(".assigned-call-card");
  await expect(card).toContainText("SYN-2026-0903-001");
  await expect(card).toContainText("Medic 32");
  await expect(card).toContainText("Medical assistance requested");
  await expect(card).toContainText("Assigned", { ignoreCase: true });
  await expect(card.getByText("Sep 3", { exact: false })).toBeVisible();

  canceled = true;
  await section.getByRole("button", { name: "Refresh" }).click();
  await expect(card).toHaveCount(0);
  await expect(section.getByRole("status")).toHaveText("Call SYN-2026-0903-001 assignment canceled.");
});

test("assignment polling runs every ten seconds only while visible and refreshes on foreground return", async ({ page }) => {
  let requests = 0;
  await page.clock.install();
  await page.route("**/demo-assigned-calls.json", async (route) => {
    requests += 1;
    await fulfill(route);
  });
  await signIn(page);
  await expect(page.getByText("SYN-2026-0903-001", { exact: true })).toBeVisible();
  const launchRequests = requests;

  await page.clock.fastForward(10_000);
  await expect.poll(() => requests).toBeGreaterThan(launchRequests);
  const visibleRequests = requests;

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(30_000);
  expect(requests).toBe(visibleRequests);

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => requests).toBeGreaterThan(visibleRequests);
});

test("opening an assignment enters documentation and a retry resolves to the same report", async ({ page }) => {
  let opens = 0;
  await page.route("**/demo-assigned-calls.json", (route) => fulfill(route));
  await page.route(`**/api/calls/${assignedCall.id}/open`, async (route) => {
    opens += 1;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(openedAssignment) });
  });
  await signIn(page);

  await page.getByRole("button", { name: "Open call" }).click();
  await expect(page.getByText(assignedCall.callNumber, { exact: true })).toHaveCount(0);
  await expect(page.getByText(replacementCall.callNumber, { exact: true })).toBeVisible();
  await expect(page.getByText("Documenting opened call", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();

  const retriedReportId = await page.evaluate(async ({ assignmentId }) => {
    const stored = JSON.parse(localStorage.getItem("open-triage.clinician-session.v1")!);
    const response = await fetch(`/api/calls/${assignmentId}/open`, {
      method: "POST",
      headers: { authorization: `Bearer ${stored.accessToken}` }
    });
    return (await response.json()).report.id;
  }, { assignmentId: assignedCall.id });
  expect(retriedReportId).toBe(openedAssignment.report.id);
  expect(opens).toBe(2);
});

test("a first open without connectivity leaves the assignment actionable and creates no browser report", async ({ page }) => {
  await page.route("**/demo-assigned-calls.json", (route) => fulfill(route));
  await page.route(`**/api/calls/${assignedCall.id}/open`, (route) => route.abort("internetdisconnected"));
  await signIn(page);

  await page.getByRole("button", { name: "Open call" }).click();
  await expect(page.getByText(assignedCall.callNumber, { exact: true })).toBeVisible();
  await expect(page.locator(".assignment-error")).toContainText("Check your connection");
  const phantom = await page.evaluate(() => Object.keys(localStorage).some((key) => key.includes("report")));
  expect(phantom).toBe(false);
});
