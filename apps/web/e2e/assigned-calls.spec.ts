import { expect, test, type Page, type Route } from "@playwright/test";
import type { AssignedCall } from "@open-triage/contracts";
import syntheticEncounterDocument from "../app/data/synthetic-encounter-document.json";

const assignedCall = {
  id: "32000000-0000-4000-8000-000000000011",
  callNumber: "SYN-20260903-001",
  unit: { id: "32000000-0000-4000-8000-000000000010", callSign: "Medic 32" },
  dispatchedAt: "2026-09-03T12:00:00.000Z",
  dispatchReason: "Medical assistance requested",
  chiefComplaint: null,
  status: "assigned"
} as const;

const replacementCall = {
  ...assignedCall,
  id: "42000000-0000-4000-8000-000000000012",
  callNumber: "SYN-20260903-002",
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
    status: "draft",
    document: syntheticEncounterDocument,
  },
  replacementAssignment: replacementCall
} as const;

const openCalls = [{
  reportId: openedAssignment.report.id,
  callNumber: assignedCall.callNumber,
  lastSavedAt: "2026-09-03T14:05:00.000Z",
  syncStatus: "saved",
  validationErrorCount: 2,
  revision: 3,
  formVersionId: openedAssignment.report.formVersionId,
  catalogReleaseId: openedAssignment.report.catalogReleaseId
}, {
  reportId: "42000000-0000-4000-8000-000000000099",
  callNumber: "SYN-20260903-000",
  lastSavedAt: "2026-09-03T13:05:00.000Z",
  syncStatus: "saved",
  validationErrorCount: 0,
  revision: 1,
  formVersionId: "32000000-0000-4000-8000-000000000099",
  catalogReleaseId: openedAssignment.report.catalogReleaseId
}] as const;

async function signIn(page: Page) {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Sign in" }).click();
}

function fulfill(route: Route, assignedCalls: ReadonlyArray<AssignedCall> = [assignedCall], canceledAssignmentIds: string[] = []) {
  return route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ assignedCalls, canceledAssignmentIds, refreshedAt: new Date().toISOString() })
  });
}

test("the demo unit's assigned call shows its operational summary and manual cancellation refresh", async ({ page }) => {
  let canceled = false;
  await page.route("**/demo-assigned-calls.json", (route) => fulfill(route, canceled ? [] : [assignedCall], canceled ? [assignedCall.id] : []));
  await signIn(page);

  await expect(page.getByRole("heading", { name: "Timeline" })).toHaveCount(0);
  await expect(page.locator(".encounter-header")).toHaveCount(0);

  const section = page.getByRole("region", { name: "Assigned calls" });
  await expect(page.getByRole("region", { name: "Open calls" })).toBeVisible();
  const refresh = page.getByRole("button", { name: "Refresh calls" });
  await expect(refresh).toHaveCount(1);
  await expect(refresh).toHaveText("Refresh");
  await expect(page.locator(".session-bar > .call-list-refresh")).toHaveCount(1);
  const identityBox = await page.getByText("Signed in as Synthetic Clinician").boundingBox();
  expect(Math.abs((identityBox!.x + identityBox!.width / 2) - page.viewportSize()!.width / 2)).toBeLessThanOrEqual(1);
  expect(await page.locator(".authenticated-shell > div > section h1").allTextContents()).toEqual(["Assigned calls", "Open calls"]);
  const card = section.locator(".assigned-call-card");
  await expect(card).toContainText("SYN-20260903-001");
  await expect(card).toContainText("Medic 32");
  await expect(card).toContainText("Medical assistance requested");
  await expect(card).toContainText("Assigned", { ignoreCase: true });
  await expect(card.getByText("Sep 3", { exact: false })).toBeVisible();

  canceled = true;
  const refreshSize = await refresh.boundingBox();
  await refresh.click();
  await expect(card).toHaveCount(0);
  expect(await refresh.boundingBox()).toEqual(refreshSize);
  await expect(section.getByRole("status")).toHaveText("Call SYN-20260903-001 assignment canceled.");
});

test("an absent dispatch reason has a neutral label and never falls back to chief complaint", async ({ page }) => {
  const privacyLimitedCall = { ...assignedCall, dispatchReason: null, chiefComplaint: "PRIVATE CHIEF COMPLAINT" };
  await page.route("**/demo-assigned-calls.json", (route) => fulfill(route, [privacyLimitedCall]));
  await signIn(page);
  const card = page.getByRole("region", { name: "Assigned calls" }).locator(".assigned-call-card");
  await expect(card).toContainText("Dispatch reason not provided");
  await expect(card).not.toContainText("PRIVATE CHIEF COMPLAINT");
});

test("assignment polling runs every ten seconds only while visible and refreshes on foreground return", async ({ page }) => {
  let requests = 0;
  await page.clock.install();
  await page.route("**/demo-assigned-calls.json", async (route) => {
    requests += 1;
    await fulfill(route);
  });
  await signIn(page);
  await expect(page.getByText("SYN-20260903-001", { exact: true })).toBeVisible();
  const launchRequests = requests;

  await page.clock.fastForward(10_000);
  await expect.poll(() => requests).toBeGreaterThan(launchRequests);
  await expect(page.getByRole("button", { name: "Refresh calls" })).toHaveText("Refresh");
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

  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Assigned calls" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Open calls" })).toHaveCount(0);
  await expect(page.getByText(replacementCall.callNumber, { exact: true })).toBeHidden();
  await expect(page.getByText(`Documenting call ${assignedCall.callNumber} in its pinned form`, { exact: true })).toBeVisible();
  await expect(page.locator(".encounter-header")).toContainText("Incident SYN-20260418-113");
  await expect(page.locator(".encounter-header")).toContainText("Response 3-9-7-4-0");
  await expect(page.locator(".encounter-header")).toContainText("Unit AN");
  await expect(page.locator(".encounter-header")).toContainText("100 Example Avenue (fictional), Suite 3");
  await expect(page.locator(".encounter-header")).not.toContainText(assignedCall.dispatchReason);
  await expect(page.locator(".encounter-header")).not.toContainText("SYN-20260418-113 · 3-9-7-4-0");
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit patient information" })).toHaveCount(0);
  await expect(page.getByText("Rivera, Jordan", { exact: true })).toHaveCount(0);

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

test("encounter edits debounce through the revisioned draft API and Save & close awaits persistence", async ({ page }) => {
  const savedCommands: Array<Record<string, unknown>> = [];
  await page.route("**/demo-assigned-calls.json", (route) => fulfill(route));
  await page.route(`**/api/calls/${assignedCall.id}/open`, (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify(openedAssignment)
  }));
  await page.route(`**/api/reports/${openedAssignment.report.id}/draft-changes`, async (route) => {
    const command = route.request().postDataJSON() as Record<string, unknown>;
    savedCommands.push(command);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      id: openedAssignment.report.id, status: "draft", revision: Number(command.expectedRevision) + 1
    }) });
  });
  await signIn(page);
  await page.getByRole("button", { name: "Open call" }).click();

  await page.getByRole("button", { name: "Add clinical note" }).click();
  await page.getByLabel("Note summary").fill("Persist this without completing validation");
  await page.getByRole("button", { name: "Add to timeline" }).click();
  await expect(page.locator(".sync-status")).toHaveText("Saving");

  await page.getByRole("button", { name: "Save & close" }).click();
  await expect(page.locator(".active-report-notice")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Assigned calls" })).toBeVisible();
  expect(savedCommands).toHaveLength(1);
  expect(savedCommands[0]?.expectedRevision).toBe(0);
  expect(savedCommands[0]?.commandId).toMatch(/^[0-9a-f-]{36}$/);
  expect(JSON.stringify(savedCommands[0])).toContain("Persist this without completing validation");
});

test("Save & close carries the form's current validation error count onto the open call", async ({ page }) => {
  await page.route("**/demo-assigned-calls.json", (route) => fulfill(route));
  await page.route(`**/api/calls/${assignedCall.id}/open`, (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify(openedAssignment)
  }));
  await page.route(`**/api/reports/${openedAssignment.report.id}/draft-changes`, async (route) => {
    const command = route.request().postDataJSON() as { expectedRevision: number };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      id: openedAssignment.report.id, status: "draft", revision: command.expectedRevision + 1
    }) });
  });
  await signIn(page);
  await page.getByRole("button", { name: "Open call" }).click();

  await page.getByRole("button", { name: "Add clinical note" }).click();
  await page.getByRole("button", { name: "Add to timeline" }).click();
  await expect(page.getByRole("button", { name: /Checklist, 1 error, 1 warning/ })).toBeVisible();
  await page.getByRole("button", { name: "Save & close" }).click();

  const card = page.getByRole("region", { name: "Open calls" }).locator(".open-call-card").filter({ hasText: assignedCall.callNumber });
  await expect(card).toContainText("Validation errors1");
});

test("Sign record requires acknowledged validation and removes the report from Open calls", async ({ page }) => {
  await page.route("**/demo-assigned-calls.json", (route) => fulfill(route));
  await page.route(`**/api/calls/${assignedCall.id}/open`, (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify(openedAssignment)
  }));
  await page.route(`**/api/reports/${openedAssignment.report.id}/draft-changes`, async (route) => {
    const command = route.request().postDataJSON() as { expectedRevision: number };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      id: openedAssignment.report.id, status: "draft", revision: command.expectedRevision + 1
    }) });
  });
  await signIn(page);
  await page.getByRole("button", { name: "Open call" }).click();
  await expect(page.locator(".sync-status")).toHaveText("Saved", { timeout: 3_000 });

  await page.getByRole("button", { name: "Review & sign" }).click();
  await expect(page.getByRole("button", { name: "Sign record" })).toBeDisabled();
  await expect(page.getByText("At least one set of vital signs should be documented.")).toBeVisible();
  await page.getByLabel("I reviewed and acknowledge this warning").check();
  await page.getByRole("button", { name: "Sign record" }).click();

  await expect(page.getByRole("heading", { name: "Assigned calls" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Open calls" }).getByText(assignedCall.callNumber, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue editing" })).toHaveCount(0);
});

test("draft synchronization automatically retries a transient outage with one command identity", async ({ page }) => {
  const commandIds: string[] = [];
  let requests = 0;
  await page.route("**/demo-assigned-calls.json", (route) => fulfill(route));
  await page.route(`**/api/calls/${assignedCall.id}/open`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(openedAssignment) }));
  await page.route(`**/api/reports/${openedAssignment.report.id}/draft-changes`, async (route) => {
    requests += 1;
    const command = route.request().postDataJSON() as { commandId: string; expectedRevision: number };
    commandIds.push(command.commandId);
    if (requests === 1) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: openedAssignment.report.id, status: "draft", revision: 1 }) });
    if (requests === 2) return route.abort("internetdisconnected");
    return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ message: "Draft revision is stale" }) });
  });
  await signIn(page);
  await page.getByRole("button", { name: "Open call" }).click();
  await expect(page.locator(".sync-status")).toHaveText("Saving");
  await expect(page.locator(".sync-status")).toHaveText("Saved", { timeout: 3_000 });

  await page.getByRole("button", { name: "Add clinical note" }).click();
  await page.getByLabel("Note summary").fill("Offline draft");
  await page.getByRole("button", { name: "Add to timeline" }).click();
  await expect(page.locator(".sync-status")).toHaveText("Pending sync", { timeout: 3_000 });
  await expect(page.locator(".sync-status")).toHaveText("Conflict", { timeout: 5_000 });
  expect(commandIds[1]).toBe(commandIds[2]);

  await page.getByRole("button", { name: "Save & close" }).click();
  await expect(page.locator(".active-report-notice")).toHaveCount(0);
});

test("an ended API session preserves queued work and resumes it after sign-in", async ({ page }) => {
  let requests = 0;
  await page.route("**/demo-assigned-calls.json", (route) => fulfill(route));
  await page.route("**/demo-open-calls.json", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ openCalls: [], completedReportIds: [], refreshedAt: new Date().toISOString() }),
  }));
  await page.route(`**/api/calls/${assignedCall.id}/open`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(openedAssignment) }));
  await page.route(`**/api/reports/${openedAssignment.report.id}/reopen`, (route) => route.abort("internetdisconnected"));
  await page.route(`**/api/reports/${openedAssignment.report.id}/draft-changes`, (route) => {
    requests += 1;
    const command = route.request().postDataJSON() as { expectedRevision: number };
    if (requests === 2) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "Session ended" }) });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({
      id: openedAssignment.report.id, status: "draft", revision: command.expectedRevision + 1,
    }) });
  });

  await signIn(page);
  await page.getByRole("button", { name: "Open call" }).click();
  await expect.poll(() => requests).toBe(1);
  await expect(page.locator(".sync-status")).toHaveText("Saved", { timeout: 3_000 });
  await page.getByRole("button", { name: "Add clinical note" }).click();
  await page.getByLabel("Note summary").fill("Preserved across API restart");
  await page.getByRole("button", { name: "Add to timeline" }).click();

  await expect(page.getByRole("heading", { name: "Sign in for your shift" })).toBeVisible();
  await expect(page.getByText("Your shift session ended. Sign in again to sync your saved work.")).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("open-triage:offline-reports-v1")!)[0].queuedChanges)).toHaveLength(1);

  await page.getByRole("button", { name: "Sign in" }).click();
  const pendingCard = page.getByRole("region", { name: "Open calls" }).locator(".open-call-card").filter({ hasText: assignedCall.callNumber });
  await expect(pendingCard).toContainText("Saved", { timeout: 3_000 });
  await page.getByRole("region", { name: "Open calls" }).getByRole("button", { name: "Reopen call" }).click();
  await expect(page.getByText("Preserved across API restart", { exact: true })).toBeVisible();
  await expect(page.locator(".sync-status")).toHaveText("Saved", { timeout: 3_000 });
});

test("the requested SYN-20260903-005 stale queue is cleared against its saved server revision", async ({ page }) => {
  const reportId = "568e1a08-ed1e-4eb9-8dbf-3d5cbb56c386";
  const serverCall = {
    reportId,
    callNumber: "SYN-20260903-005",
    lastSavedAt: "2026-09-03T15:35:42.682Z",
    syncStatus: "saved",
    validationErrorCount: 0,
    revision: 43,
    formVersionId: openedAssignment.report.formVersionId,
    catalogReleaseId: openedAssignment.report.catalogReleaseId,
  } as const;
  await page.route("**/demo-assigned-calls.json", (route) => fulfill(route, []));
  await page.route("**/demo-open-calls.json", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ openCalls: [serverCall], completedReportIds: [], refreshedAt: new Date().toISOString() }),
  }));
  await signIn(page);
  await page.evaluate(({ call, userId }) => {
    localStorage.setItem("open-triage:offline-reports-v1", JSON.stringify([{
      report: { id: call.reportId, revision: 43, formVersionId: call.formVersionId, catalogReleaseId: call.catalogReleaseId, documentingUserId: userId, status: "draft" },
      ownerUserId: userId,
      callNumber: call.callNumber,
      workflowState: "open",
      syncStatus: "pending",
      lastSavedAt: call.lastSavedAt,
      validationErrorCount: 0,
      queuedChanges: [{ attempted: true, command: { commandId: "52000000-0000-4000-8000-000000000013", expectedRevision: 43, authorId: userId, deviceId: `web:${call.reportId}`, clientTime: new Date().toISOString(), groups: [], occurrences: [] } }],
    }]));
  }, { call: serverCall, userId: openedAssignment.report.documentingUserId });
  await page.reload();

  const card = page.getByRole("region", { name: "Open calls" }).locator(".open-call-card").filter({ hasText: serverCall.callNumber });
  await expect(card).toContainText("Saved");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("open-triage:offline-reports-v1")!)[0].queuedChanges)).toEqual([]);
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

test("open calls show workflow state newest first and reopen the existing pinned report", async ({ page }) => {
  await page.route("**/demo-assigned-calls.json", (route) => fulfill(route, []));
  await page.route("**/demo-open-calls.json", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ openCalls, completedReportIds: [], refreshedAt: "2026-09-03T14:06:00.000Z" })
  }));
  await page.route(`**/api/reports/${openedAssignment.report.id}/reopen`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      callNumber: assignedCall.callNumber,
      report: { ...openedAssignment.report, revision: 3, groups: [], occurrences: [] }
    })
  }));
  await signIn(page);

  const section = page.getByRole("region", { name: "Open calls" });
  const cards = section.locator(".open-call-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText(assignedCall.callNumber);
  await expect(cards.nth(0)).toContainText("Saved", { ignoreCase: true });
  await expect(cards.nth(0)).toContainText("Sep 3", { ignoreCase: true });
  await expect(cards.nth(0)).toContainText("Validation errors2");
  await expect(cards.nth(1)).toContainText("SYN-20260903-000");
  await expect(cards.nth(0)).toHaveAttribute("data-validation-status", "error");
  await expect(cards.nth(1)).toHaveAttribute("data-validation-status", "clear");
  const callNumberColors = await cards.locator(".assigned-call-title strong").evaluateAll((calls) => calls.map((call) => getComputedStyle(call).color));
  expect(callNumberColors[0]).not.toBe(callNumberColors[1]);

  await cards.nth(0).getByRole("button", { name: "Reopen call" }).click();
  const active = page.getByText(`Documenting call ${assignedCall.callNumber} in its pinned form`, { exact: true });
  await expect(active).toBeVisible();
  await expect(active).toHaveAttribute("data-report-id", openedAssignment.report.id);
  await expect(active).toHaveAttribute("data-form-version-id", openedAssignment.report.formVersionId);
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
});

test("a stationary-completed report disappears from Open calls and only its cache is purged", async ({ page }) => {
  let completed = false;
  await page.route("**/demo-assigned-calls.json", (route) => fulfill(route, []));
  await page.route("**/demo-open-calls.json", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      openCalls: completed ? openCalls.slice(1) : openCalls,
      completedReportIds: completed ? [openedAssignment.report.id] : [],
      refreshedAt: "2026-09-03T14:06:00.000Z"
    })
  }));
  await signIn(page);
  const section = page.getByRole("region", { name: "Open calls" });
  await expect(section.getByText(assignedCall.callNumber, { exact: true })).toBeVisible();
  await page.evaluate(({ completedId, openId }) => {
    localStorage.setItem(`open-triage:standard-encounter-v1:report:${completedId}`, "completed cache");
    localStorage.setItem(`open-triage:standard-encounter-v1:report:${openId}`, "open cache");
    localStorage.setItem("open-triage:unsynced-command:other", "unsynced");
  }, { completedId: openedAssignment.report.id, openId: openCalls[1].reportId });

  completed = true;
  await page.getByRole("button", { name: "Refresh calls" }).click();

  await expect(section.getByText(assignedCall.callNumber, { exact: true })).toHaveCount(0);
  await expect(section.getByRole("status")).toContainText("completed on the stationary interface");
  const cached = await page.evaluate(({ completedId, openId }) => ({
    completed: localStorage.getItem(`open-triage:standard-encounter-v1:report:${completedId}`),
    open: localStorage.getItem(`open-triage:standard-encounter-v1:report:${openId}`),
    unsynced: localStorage.getItem("open-triage:unsynced-command:other")
  }), { completedId: openedAssignment.report.id, openId: openCalls[1].reportId });
  expect(cached).toEqual({ completed: null, open: "open cache", unsynced: "unsynced" });
});

test("completion discovered while a form is active stops editing and returns to the call list", async ({ page }) => {
  let completed = false;
  await page.route("**/demo-assigned-calls.json", (route) => fulfill(route));
  await page.route("**/demo-open-calls.json", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      openCalls: completed ? [] : openCalls.slice(0, 1),
      completedReportIds: completed ? [openedAssignment.report.id] : [],
      refreshedAt: "2026-09-03T14:06:00.000Z"
    })
  }));
  await page.route(`**/api/calls/${assignedCall.id}/open`, (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify(openedAssignment)
  }));
  await signIn(page);
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();

  completed = true;
  await page.getByRole("button", { name: "Refresh calls" }).click();

  await expect(page.getByText("This report was completed on the stationary interface. Further edits have stopped.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Timeline" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Open calls" })).toBeVisible();
  await expect(page.locator(".active-report-notice")).toHaveCount(0);
});

test("an Android-sized browser closes and reopens an edited call offline, then syncs it on reconnect", async ({ page, context }) => {
  await page.setViewportSize({ width: 393, height: 851 });
  const commandIds: string[] = [];
  let offline = false;
  await page.route("**/demo-assigned-calls.json", (route) => fulfill(route));
  await page.route(`**/api/calls/${assignedCall.id}/open`, (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify(openedAssignment)
  }));
  await page.route(`**/api/reports/${openedAssignment.report.id}/draft-changes`, (route) => {
    if (offline) return route.abort("internetdisconnected");
    const command = route.request().postDataJSON() as { commandId: string; expectedRevision: number };
    commandIds.push(command.commandId);
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({
      id: openedAssignment.report.id, status: "draft", revision: command.expectedRevision + 1
    }) });
  });
  await signIn(page);
  await page.getByRole("button", { name: "Open call" }).click();
  await expect(page.locator(".sync-status")).toHaveText("Saving");
  await expect(page.locator(".sync-status")).toHaveText("Saved", { timeout: 3_000 });

  offline = true;
  await context.setOffline(true);
  await page.getByRole("button", { name: "Add clinical note" }).click();
  await page.getByLabel("Note summary").fill("Care documented beyond the dead zone");
  await page.getByRole("button", { name: "Add to timeline" }).click();
  await expect(page.locator(".sync-status")).toHaveText("Pending sync");
  await page.getByRole("button", { name: "Save & close" }).click();

  const cachedCard = page.getByRole("region", { name: "Open calls" }).locator(".open-call-card").filter({ hasText: assignedCall.callNumber });
  await expect(cachedCard).toContainText("Pending sync");
  await cachedCard.getByRole("button", { name: "Reopen call" }).click();
  await expect(page.getByText("Care documented beyond the dead zone", { exact: true })).toBeVisible();
  await expect(page.locator(".active-report-notice")).toHaveAttribute("data-form-version-id", openedAssignment.report.formVersionId);
  const cache = await page.evaluate(() => JSON.parse(localStorage.getItem("open-triage:offline-reports-v1")!)[0]);
  expect(cache.ownerUserId).toBe(openedAssignment.report.documentingUserId);
  expect(cache.report.revision).toBe(1);
  expect(cache.workflowState).toBe("open");
  expect(cache.queuedChanges).toHaveLength(1);

  offline = false;
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator(".sync-status")).toHaveText("Saved", { timeout: 3_000 });
  expect(commandIds).toHaveLength(2);
  expect(commandIds[1]).not.toBe(commandIds[0]);
});
