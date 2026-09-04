import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import demoAssignedCalls from "../public/demo-assigned-calls.json";
import demoOpenAssignment from "../public/demo-open-assignment.json";

const assignedCall = demoAssignedCalls.assignedCalls[0]!;
const reportId = demoOpenAssignment.report.id;

async function signIn(page: Page) {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("Date of Birth picker persists ordinary and exceptional states through offline close, reopen, and review", async ({ page, context }) => {
  let opened = false;
  let revision = demoOpenAssignment.report.revision;
  const savedCommands: Array<{ occurrences: Array<{ id: string; elementId: string; value?: { kind?: string; value?: string; absenceCode?: string } }> }> = [];
  await page.route("**/demo-assigned-calls.json", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ assignedCalls: opened ? [] : [assignedCall], canceledAssignmentIds: [], refreshedAt: new Date().toISOString() }),
  }));
  await page.route("**/demo-open-calls.json", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      openCalls: opened ? [{
        reportId,
        callNumber: assignedCall.callNumber,
        lastSavedAt: new Date().toISOString(),
        syncStatus: "saved",
        validationErrorCount: 0,
        revision,
        formVersionId: demoOpenAssignment.report.formVersionId,
        catalogReleaseId: demoOpenAssignment.report.catalogReleaseId,
      }] : [],
      completedReportIds: [],
      refreshedAt: new Date().toISOString(),
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
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: reportId, status: "draft", revision }) });
  });
  await page.route(`**/api/reports/${reportId}/reopen`, (route) => route.abort("internetdisconnected"));

  await signIn(page);
  await page.getByRole("group", { name: "Documentation presentation" }).getByRole("button", { name: "Stationary" }).click();
  await page.getByRole("button", { name: "Open call", exact: true }).click();

  const picker = page.locator('[data-element-id="ePatient.17"] .stationary-value-picker');
  await expect(picker).toBeVisible();
  await expect(picker.getByLabel("Date")).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await picker.getByLabel("Date").fill("1991-06-15");
  await expect(picker).toHaveAttribute("data-value-state", "ordinary");
  await expect(picker.getByText("1991-06-15", { exact: true })).toBeVisible();
  await expect(page.locator(".sync-status")).toHaveText("Saved", { timeout: 4_000 });
  const dateMutation = savedCommands.findLast(({ occurrences }) => occurrences.some(({ elementId, value }) =>
    elementId === "ePatient.17" && value?.kind === "date" && value.value === "1991-06-15"))!
    .occurrences.find(({ elementId }) => elementId === "ePatient.17")!;

  await picker.getByLabel("Exceptional value").selectOption({ label: "Refused" });
  await expect(picker).toHaveAttribute("data-value-state", "exceptional");
  await expect(picker.locator(".stationary-value-picker-state strong")).toHaveText("Refused");
  await expect(page.locator(".sync-status")).toHaveText("Saved", { timeout: 4_000 });
  const refusedMutation = savedCommands.findLast(({ occurrences }) => occurrences.some(({ elementId, value }) =>
    elementId === "ePatient.17" && value?.kind === "pertinent-negative"))!
    .occurrences.find(({ elementId }) => elementId === "ePatient.17")!;
  expect(refusedMutation.id).toBe(dateMutation.id);
  expect(refusedMutation.value?.absenceCode).toBe("8801019");

  const accessibility = await new AxeBuilder({ page }).include('[data-element-id="ePatient.17"] .stationary-value-picker')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(accessibility.violations.filter(({ impact }) => impact === "critical" || impact === "serious")).toEqual([]);

  await context.setOffline(true);
  await picker.getByLabel("Exceptional value").selectOption({ label: "Not Recorded" });
  await expect(page.locator(".sync-status")).toHaveText("Pending sync", { timeout: 4_000 });
  const localValue = await page.evaluate((id) => {
    const envelope = JSON.parse(localStorage.getItem(`open-triage:standard-encounter-v1:report:${id}`)!);
    return envelope.document.groups.find((group: { id: string }) => group.id === "ePatientSection").instances[0].elements
      .find((element: { id: string }) => element.id === "ePatient.17").values[0];
  }, reportId);
  expect(localValue).toEqual({
    kind: "null",
    occurrenceId: "synthetic-patient-dob",
    notValue: { code: "7701003", display: "Not Recorded" },
  });

  await page.getByRole("button", { name: "Save & close" }).click();
  await page.getByRole("button", { name: "Reopen call" }).click();
  const reopened = page.locator('[data-element-id="ePatient.17"] .stationary-value-picker');
  await expect(reopened.locator(".stationary-value-picker-state strong")).toHaveText("Not Recorded");
  await page.getByRole("button", { name: "Review & sign" }).click();
  await expect(page.getByRole("heading", { name: "Review and sign" })).toBeVisible();
  await expect(page.locator(".review-findings").getByText("ePatient.17", { exact: true })).toHaveCount(0);
});
