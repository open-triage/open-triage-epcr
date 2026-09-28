import { expect, test, type Page, type Route } from "@playwright/test";
import type { AssignedCall, OpenAssignmentResponse, ReportPhotoNote } from "@open-triage/contracts";
import demoAssignedCalls from "../public/demo-assigned-calls.json";
import demoOpenAssignment from "../public/demo-open-assignment.json";

const assignedCall = demoAssignedCalls.assignedCalls[0] as AssignedCall;
const failedPhoto: ReportPhotoNote = {
  id: "f149e8ac-00cf-4a16-a104-c5fa9052192e",
  reportId: demoOpenAssignment.report.id,
  type: "photo",
  caption: "Medication label",
  capturedAt: "2026-09-24T12:00:00.000Z",
  capturedUtcOffsetMinutes: 120,
  author: { id: demoOpenAssignment.report.documentingUserId, displayName: "Alex Clinician" },
  serverReceivedAt: "2026-09-24T12:00:01.000Z",
  updatedAt: "2026-09-24T12:00:01.000Z",
  persistenceState: "failed",
  contentType: "image/jpeg",
  byteSize: 1024,
  sha256: "a".repeat(64),
  width: 640,
  height: 480,
};
const opened = { ...demoOpenAssignment,
  report: { ...demoOpenAssignment.report, notes: [failedPhoto] } } as OpenAssignmentResponse;

function assignedCalls(route: Route) {
  return route.fulfill({ contentType: "application/json", body: JSON.stringify({
    assignedCalls: [assignedCall], canceledAssignmentIds: [], refreshedAt: new Date().toISOString(),
  }) });
}

async function signInAndOpen(page: Page) {
  await page.route("**/demo-assigned-calls.json", assignedCalls);
  await page.route(`**/api/calls/${assignedCall.id}/open`, (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify(opened),
  }));
  await page.route("**/demo-open-assignment.json", (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify(opened),
  }));
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByLabel("Username").fill("demo");
  await page.getByLabel("Password").fill("opentriagedemo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Open call", exact: true }).click();
}

test("mobile checklist links failed media to retry and delete actions", async ({ page }) => {
  await signInAndOpen(page);
  await page.getByRole("button", { name: /^Checklist/ }).click();
  const readiness = page.getByRole("region", { name: "Note readiness" });
  await expect(readiness.getByText("Photo note is not ready")).toBeVisible();
  await expect(readiness.getByText(/Retry or delete/i)).toBeVisible();
  await readiness.getByRole("button").click();
  const dialog = page.getByRole("dialog", { name: "Photo note" });
  await expect(dialog.getByRole("button", { name: "Retry upload" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Remove" })).toBeVisible();
});

test("Stationary review separates note readiness and blocks signing", async ({ page }) => {
  await signInAndOpen(page);
  await page.getByRole("group", { name: "Documentation presentation" })
    .getByRole("button", { name: "Stationary" }).click();
  await page.getByRole("button", { name: "Review & sign" }).click();
  await expect(page.getByRole("region", { name: "Note readiness" }).getByText("Photo note is not ready")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign record" })).toBeDisabled();
});
