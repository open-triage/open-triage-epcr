import { expect, test } from "@playwright/test";
import demoAssignedCalls from "../public/demo-assigned-calls.json";
import demoOpenAssignment from "../public/demo-open-assignment.json";
import { incidentSummary } from "../app/incident-document";
import type { EncounterDocument } from "@open-triage/contracts";

const assignedCall = demoAssignedCalls.assignedCalls[0]!;
const summary = incidentSummary(demoOpenAssignment.report.document as EncounterDocument);

test("a clinician signs in, opens the assigned call, and captures a clinical note", async ({ page }) => {
  await page.route(`**/api/calls/${assignedCall.id}/open`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(demoOpenAssignment),
  }));

  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByLabel("Username").fill("demo");
  await page.getByLabel("Password").fill("opentriagedemo");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText(assignedCall.callNumber, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await expect(page.locator(".encounter-header")).toContainText(`Incident ${summary.incidentNumber}`);
  await expect(page.locator(".timeline-list").getByText("Unit Notified by Dispatch", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add clinical note" }).click();
  await page.getByLabel("Note summary").fill("Critical browser journey note");
  await page.getByRole("button", { name: "Add to timeline" }).click();
  await expect(page.getByText("Critical browser journey note")).toBeVisible();
});
