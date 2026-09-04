import { expect, test, type Page, type Route } from "@playwright/test";
import type { AssignedCall } from "@open-triage/contracts";
import demoAssignedCalls from "../public/demo-assigned-calls.json";
import demoOpenAssignment from "../public/demo-open-assignment.json";

const assignedCall = demoAssignedCalls.assignedCalls[0] as AssignedCall;

function assignedCalls(route: Route) {
  return route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ assignedCalls: [assignedCall], canceledAssignmentIds: [], refreshedAt: new Date().toISOString() }),
  });
}

async function signIn(page: Page) {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("explicit workflow mode survives reload and viewport changes without changing visible calls", async ({ page }) => {
  await page.route("**/demo-assigned-calls.json", assignedCalls);
  await signIn(page);

  const selector = page.getByRole("group", { name: "Documentation presentation" });
  const mobile = selector.getByRole("button", { name: "Mobile" });
  const stationary = selector.getByRole("button", { name: "Stationary" });
  const visibleCall = page.getByText(assignedCall.callNumber, { exact: true });

  await expect(mobile).toHaveAttribute("aria-pressed", "true");
  await stationary.click();
  await expect(stationary).toHaveAttribute("aria-pressed", "true");

  for (const viewport of [{ width: 360, height: 800 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    await expect(stationary).toHaveAttribute("aria-pressed", "true");
    await expect(visibleCall).toBeVisible();
  }

  await page.reload();
  await expect(stationary).toHaveAttribute("aria-pressed", "true");
  await expect(visibleCall).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(stationary).toHaveAttribute("aria-pressed", "true");
});

test("mobile reports retain Save and close without review or signing actions", async ({ page }) => {
  await page.route("**/demo-assigned-calls.json", assignedCalls);
  await page.route(`**/api/calls/${assignedCall.id}/open`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(demoOpenAssignment),
  }));
  await signIn(page);

  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-presentation-mode", "mobile");
  await expect(page.getByRole("button", { name: "Save & close" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review & sign" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign record" })).toHaveCount(0);

  await page.getByRole("group", { name: "Documentation presentation" }).getByRole("button", { name: "Stationary" }).click();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-presentation-mode", "stationary");
  await expect(page.getByRole("button", { name: "Review & sign" })).toBeVisible();
});

test("a mobile report reopens offline for stationary scalar editing through the same queued workspace", async ({ page, context }) => {
  const reportId = demoOpenAssignment.report.id;
  let opened = false;
  let revision = demoOpenAssignment.report.revision;
  const savedCommands: Array<{ deviceId: string; occurrences: Array<{ id: string; elementId: string; value?: { value?: string } }> }> = [];
  await page.route("**/demo-assigned-calls.json", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ assignedCalls: opened ? [] : [assignedCall], canceledAssignmentIds: [], refreshedAt: new Date().toISOString() }),
  }));
  await page.route("**/demo-open-calls.json", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      openCalls: opened ? [{
        reportId, callNumber: assignedCall.callNumber, lastSavedAt: new Date().toISOString(), syncStatus: "saved",
        validationErrorCount: 0, revision, formVersionId: demoOpenAssignment.report.formVersionId,
        catalogReleaseId: demoOpenAssignment.report.catalogReleaseId,
      }] : [],
      completedReportIds: [], refreshedAt: new Date().toISOString(),
    }),
  }));
  await page.route(`**/api/calls/${assignedCall.id}/open`, (route) => {
    opened = true;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(demoOpenAssignment) });
  });
  await page.route(`**/api/reports/${reportId}/draft-changes`, async (route) => {
    const command = route.request().postDataJSON() as typeof savedCommands[number] & { expectedRevision: number };
    savedCommands.push(command);
    revision += 1;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: reportId, status: "draft", revision }) });
  });
  await page.route(`**/api/reports/${reportId}/reopen`, (route) => route.abort("internetdisconnected"));

  await signIn(page);
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await expect(page.locator(".sync-status")).toHaveText("Saved", { timeout: 4_000 });
  const originalIdentity = await page.evaluate(({ expectedReportId }) => {
    const envelope = JSON.parse(localStorage.getItem(`open-triage:standard-encounter-v1:report:${expectedReportId}`)!);
    const group = envelope.document.groups.find((candidate: { id: string }) => candidate.id === "ePatient.PatientNameGroup");
    const value = group.instances[0].elements.find((candidate: { id: string }) => candidate.id === "ePatient.03").values[0];
    return { groupId: group.instances[0].instanceId, occurrenceId: value.occurrenceId };
  }, { expectedReportId: reportId });
  await page.getByRole("button", { name: "Add clinical note" }).click();
  await page.getByLabel("Note summary").fill("Started on mobile");
  await page.getByRole("button", { name: "Add to timeline" }).click();
  await expect(page.locator(".sync-status")).toHaveText("Saved", { timeout: 4_000 });
  await page.getByRole("button", { name: "Save & close" }).click();

  await page.getByRole("group", { name: "Documentation presentation" }).getByRole("button", { name: "Stationary" }).click();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Reopen call" }).click();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-presentation-mode", "stationary");
  await expect(page.getByText("Started on mobile", { exact: true })).toBeVisible();
  await page.getByLabel(/^First Name/).fill("STATIONARY");
  await expect(page.locator(".sync-status")).toHaveText("Pending sync", { timeout: 3_000 });

  const offlineIdentity = await page.evaluate(({ expectedReportId }) => {
    const envelope = JSON.parse(localStorage.getItem(`open-triage:standard-encounter-v1:report:${expectedReportId}`)!);
    const group = envelope.document.groups.find((candidate: { id: string }) => candidate.id === "ePatient.PatientNameGroup");
    const value = group.instances[0].elements.find((candidate: { id: string }) => candidate.id === "ePatient.03").values[0];
    return { groupId: group.instances[0].instanceId, occurrenceId: value.occurrenceId, value: value.value };
  }, { expectedReportId: reportId });
  expect(offlineIdentity).toEqual({ ...originalIdentity, value: "STATIONARY" });

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator(".sync-status")).toHaveText("Saved", { timeout: 4_000 });
  const stationaryCommand = savedCommands.findLast(({ deviceId, occurrences }) => deviceId.includes(":stationary:")
    && occurrences.some(({ elementId, value }) => elementId === "ePatient.03" && value?.value === "STATIONARY"));
  expect(stationaryCommand).toBeTruthy();
});
