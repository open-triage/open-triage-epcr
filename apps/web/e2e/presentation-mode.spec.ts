import { cachedReports, expect, test, type Page, type Route } from "./server-fixture";
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
  await page.getByLabel("Username").fill("demo");
  await page.getByLabel("Password").fill("opentriagedemo");
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("explicit workflow mode survives reload and viewport changes without changing visible calls", async ({ page }) => {
  await page.route("**/api/calls/assigned", assignedCalls);
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
  await page.getByLabel("Username").fill("demo");
  await page.getByLabel("Password").fill("opentriagedemo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(stationary).toHaveAttribute("aria-pressed", "true");
});

test("mobile reports retain Save and close without review or signing actions", async ({ page }) => {
  await page.route("**/api/calls/assigned", assignedCalls);
  await page.route(`**/api/calls/${assignedCall.id}/open`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ ...demoOpenAssignment, report: { ...demoOpenAssignment.report, demoMutable: true } }),
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
  await expect(page.getByRole("navigation", { name: "Encounter views" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Quick documentation" })).toHaveCount(0);
  await expect(page.locator(".encounter-header")).toHaveCSS("position", "sticky");
  await expect(page.locator(".encounter-header")).not.toContainText("Incident");
  await expect(page.getByText("NEMSIS section", { exact: true })).toHaveCount(0);
  const reviewBox = await page.getByRole("button", { name: "Review & sign" }).boundingBox();
  const saveBox = await page.getByRole("button", { name: "Save & close" }).boundingBox();
  expect(reviewBox!.y).toBeLessThan(saveBox!.y);
  await expect(page.locator('[data-element-id="eResponse.22"] .stationary-element-tooltip')).toHaveCount(1);
  await expect(page.locator('[data-element-id="eResponse.22"] .stationary-field-control')).toHaveCount(1);
  await expect(page.locator('[data-element-id="eResponse.23"] .stationary-field-control')).toHaveCount(1);
});

test("stationary pickers use through-border labels, multi-value controls, and label-only help", async ({ page }) => {
  await page.route("**/api/calls/assigned", assignedCalls);
  await page.route(`**/api/calls/${assignedCall.id}/open`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ ...demoOpenAssignment, report: { ...demoOpenAssignment.report, demoMutable: true } }),
  }));
  await signIn(page);
  await page.getByRole("group", { name: "Documentation presentation" }).getByRole("button", { name: "Stationary" }).click();
  await page.getByRole("button", { name: "Open call", exact: true }).click();

  for (const elementId of ["ePatient.14", "ePatient.18", "ePatient.19", "ePatient.24"]) {
    const picker = page.locator(`fieldset.stationary-multiple-picker[data-element-id="${elementId}"]`);
    await expect(picker).toHaveCount(1);
    await expect(picker.locator(":scope > legend.stationary-picker-label")).toHaveCount(1);
  }
  await expect(page.locator('fieldset[data-element-id="ePatient.18"] input[type="tel"]')).toHaveCount(3);
  await expect(page.locator('fieldset[data-element-id="ePatient.19"] input[type="email"]')).toHaveCount(1);

  const phonePicker = page.locator('fieldset[data-element-id="ePatient.18"]');
  const tooltip = phonePicker.locator(".stationary-element-tooltip");
  await phonePicker.locator("input").first().hover();
  await expect(tooltip).toBeHidden();
  await phonePicker.locator("legend").hover();
  await expect(tooltip).toBeVisible();

  const racePicker = page.locator('fieldset[data-element-id="ePatient.14"]');
  const languagePicker = page.locator('fieldset[data-element-id="ePatient.24"]');
  const raceBox = (await racePicker.boundingBox())!;
  const languageBox = (await languagePicker.boundingBox())!;
  const raceControl = (await racePicker.locator("select").first().boundingBox())!;
  const languageControl = (await languagePicker.locator("select").first().boundingBox())!;
  expect(Math.abs((raceControl.y - raceBox.y) - (languageControl.y - languageBox.y))).toBeLessThanOrEqual(1);

  const conditionCode = page.locator('fieldset[data-element-id="ePayment.51"]');
  await expect(conditionCode.locator("select")).toHaveCount(1);
  await expect(conditionCode.locator('input[type="search"], input[type="text"]')).toHaveCount(0);

  const emptyTimestamp = page.getByRole("button", { name: /not recorded\. Set date and time/ }).first();
  await expect(emptyTimestamp).toContainText("Not recorded");
  await emptyTimestamp.click();
  await expect(page.getByRole("dialog", { name: "Select clinical time" })).toBeVisible();
});

test("stationary scalar fields retain typing and validate only after blur", async ({ page }) => {
  await page.route("**/api/calls/assigned", assignedCalls);
  await page.route(`**/api/calls/${assignedCall.id}/open`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ ...demoOpenAssignment, report: { ...demoOpenAssignment.report, demoMutable: true } }),
  }));
  await signIn(page);
  await page.getByRole("group", { name: "Documentation presentation" }).getByRole("button", { name: "Stationary" }).click();
  await page.getByRole("button", { name: "Open call", exact: true }).click();

  const agency = page.getByRole("textbox", { name: "EMS Agency Name" });
  const agencyPicker = agency.locator("xpath=ancestor::fieldset");
  await agency.fill("A");
  await expect(agency).toHaveValue("A");
  await expect(agencyPicker.getByRole("alert")).toHaveCount(0);
  await agency.press("Tab");
  await expect(agencyPicker.getByRole("alert")).toContainText("at least 2 characters");
  await agency.fill("Example EMS");
  await expect(agencyPicker.getByRole("alert")).toHaveCount(0);
  await agency.press("Tab");
  await expect(agencyPicker.getByRole("alert")).toHaveCount(0);

  const supplies = page.locator('[data-group-id="ePayment.SupplyItemGroup"]');
  await supplies.getByRole("button", { name: "Add Supply Item" }).click();
  const dialog = page.getByRole("dialog", { name: "Add Supply Item" });
  const supplyName = dialog.getByRole("textbox", { name: "Supply Item Used Name" });
  const supplyPicker = supplyName.locator("xpath=ancestor::fieldset");
  await supplyName.fill("I");
  await expect(supplyName).toHaveValue("I");
  await expect(supplyPicker.getByRole("alert")).toHaveCount(0);
  await supplyName.press("Tab");
  await expect(supplyPicker.getByRole("alert")).toContainText("at least 2 characters");
  await supplyName.fill("IV start kit");
  await expect(supplyPicker.getByRole("alert")).toHaveCount(0);
  await supplyName.press("Tab");
  await expect(supplyPicker.getByRole("alert")).toHaveCount(0);
});

test("a mobile report reopens offline for stationary scalar editing through the same queued workspace", async ({ page, context }) => {
  const reportId = demoOpenAssignment.report.id;
  let opened = false;
  let revision = demoOpenAssignment.report.revision;
  const savedCommands: Array<{ deviceId: string; occurrences: Array<{ id: string; elementId: string; value?: { value?: string } }> }> = [];
  await page.route("**/api/calls/assigned", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ assignedCalls: opened ? [] : [assignedCall], canceledAssignmentIds: [], refreshedAt: new Date().toISOString() }),
  }));
  await page.route("**/api/reports/open", (route) => route.fulfill({
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
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...demoOpenAssignment, report: { ...demoOpenAssignment.report, demoMutable: true } }) });
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
  await expect.poll(async () => (await cachedReports(page)).length).toBe(1);
  const originalDocument = (await cachedReports(page))[0]!.report.document!;
  const originalGroup = originalDocument.groups.find(candidate => candidate.id === "ePatient.PatientNameGroup")!.instances[0]!;
  const originalValue = originalGroup.elements.find(candidate => candidate.id === "ePatient.03")!.values[0]!;
  const originalIdentity = { groupId: originalGroup.instanceId, occurrenceId: originalValue.occurrenceId };
  await page.getByRole("button", { name: "Add clinical note" }).click();
  await page.getByLabel("Note summary").fill("Started on mobile");
  await page.getByRole("button", { name: "Add to timeline" }).click();
  await expect(page.locator(".sync-status")).toHaveText("Saved", { timeout: 4_000 });
  await page.getByRole("button", { name: "Save & close" }).click();

  await page.getByRole("group", { name: "Documentation presentation" }).getByRole("button", { name: "Stationary" }).click();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Reopen report" }).click();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-presentation-mode", "stationary");
  await expect(page.locator('[data-element-id="eNarrative.01"] textarea')).toHaveValue(/^Started on mobile\n\d{4}-\d{2}-\d{2}T/);
  await page.getByRole("textbox", { name: "First Name", exact: true }).fill("STATIONARY");
  await page.getByRole("textbox", { name: "First Name", exact: true }).press("Tab");
  await expect(page.locator(".sync-status")).toHaveText("Pending sync", { timeout: 3_000 });

  await expect.poll(async () => {
    const document = (await cachedReports(page))[0]!.report.document!;
    const group = document.groups.find(candidate => candidate.id === "ePatient.PatientNameGroup")!.instances[0]!;
    const value = group.elements.find(candidate => candidate.id === "ePatient.03")!.values[0]!;
    return { groupId: group.instanceId, occurrenceId: value.occurrenceId, value: value.value };
  }).toEqual({ ...originalIdentity, value: "STATIONARY" });

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator(".sync-status")).toHaveText("Saved", { timeout: 4_000 });
  const stationaryCommand = savedCommands.findLast(({ deviceId, occurrences }) => deviceId === `web:${reportId}`
    && occurrences.some(({ elementId, value }) => elementId === "ePatient.03" && value?.value === "STATIONARY"));
  expect(stationaryCommand).toBeTruthy();
});
