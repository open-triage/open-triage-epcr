import { expect, test } from "@playwright/test";
import demoAssignedCalls from "../public/demo-assigned-calls.json";
import demoOpenAssignment from "../public/demo-open-assignment.json";

const assignmentId = demoAssignedCalls.assignedCalls[0]!.id;

test("stationary repeating rows retain focus, identity, and narrow-layout access", async ({ page }) => {
  await page.route(`**/api/calls/${assignmentId}/open`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(demoOpenAssignment),
  }));
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("group", { name: "Documentation presentation" }).getByRole("button", { name: "Stationary" }).click();
  await page.getByRole("button", { name: "Open call", exact: true }).click();

  const responder = page.locator('[data-group-id="eScene.ResponderGroup"]');
  const add = responder.getByRole("button", { name: "Add eScene.ResponderGroup" });
  await expect(add).toBeEnabled();
  await add.click();
  const dialog = page.getByRole("dialog", { name: "Add eScene.ResponderGroup" });
  const agencyPicker = dialog.locator('[data-element-id="eScene.02"] .stationary-value-picker');
  await expect(agencyPicker).toBeVisible();
  await expect(agencyPicker).toHaveAttribute("data-value-state", "unset");
  const agency = dialog.getByLabel(/Other EMS or Public Safety Agencies at Scene/);
  await expect(agency).toBeFocused();
  await agency.fill("Mutual Aid 7");
  await expect(agencyPicker).toHaveAttribute("data-value-state", "ordinary");
  await dialog.getByRole("button", { name: "Add row" }).click();

  const row = responder.locator("tbody tr");
  await expect(row).toHaveCount(1);
  await expect(row.locator('[data-element-id="eScene.02"]')).toHaveText("Mutual Aid 7");
  const instanceId = await row.getAttribute("data-group-instance-id");
  const occurrenceId = await row.locator('[data-element-id="eScene.02"] span').getAttribute("data-occurrence-id");
  expect(instanceId).toBeTruthy();
  expect(occurrenceId).toBeTruthy();

  const edit = row.getByRole("button", { name: "Edit" });
  await edit.click();
  await expect(page.getByRole("dialog", { name: "Edit eScene.ResponderGroup" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(edit).toBeFocused();

  await page.setViewportSize({ width: 360, height: 800 });
  await expect(responder.getByRole("region", { name: "eScene.ResponderGroup table" })).toBeVisible();
  await edit.click();
  await expect(page.getByRole("dialog", { name: "Edit eScene.ResponderGroup" })).toBeVisible();
  expect(await row.getAttribute("data-group-instance-id")).toBe(instanceId);
  expect(await row.locator('[data-element-id="eScene.02"] span').getAttribute("data-occurrence-id")).toBe(occurrenceId);
});

test("nested repeating rows remain scoped to their originating parent workflow", async ({ page }) => {
  await page.route(`**/api/calls/${assignmentId}/open`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(demoOpenAssignment),
  }));
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("group", { name: "Documentation presentation" }).getByRole("button", { name: "Stationary" }).click();
  await page.getByRole("button", { name: "Open call", exact: true }).click();

  const labs = page.locator('[data-group-id="eLabs.LabGroup"]');
  await expect(labs).toHaveCount(1);
  await expect(page.locator('[data-group-id="eLabs.LabResultGroup"]')).toHaveCount(0);

  await labs.getByRole("button", { name: "Add eLabs.LabGroup" }).click();
  let parentDialog = page.getByRole("dialog", { name: "Add eLabs.LabGroup" });
  const firstNested = parentDialog.locator('[data-group-id="eLabs.LabResultGroup"]');
  const firstChildAdd = firstNested.getByRole("button", { name: "Add eLabs.LabResultGroup" });
  await firstChildAdd.click();
  const childDialog = page.getByRole("dialog", { name: "Add eLabs.LabResultGroup" });
  await childDialog.getByRole("button", { name: "Add row" }).click();
  await expect(firstChildAdd).toBeFocused();
  await expect(firstNested.locator("tbody tr")).toHaveCount(1);
  await parentDialog.getByRole("button", { name: "Add row", exact: true }).click();

  await labs.getByRole("button", { name: "Add eLabs.LabGroup" }).click();
  parentDialog = page.getByRole("dialog", { name: "Add eLabs.LabGroup" });
  const secondNested = parentDialog.locator('[data-group-id="eLabs.LabResultGroup"]');
  await expect(secondNested.locator("tbody tr")).toHaveCount(0);
  await secondNested.getByRole("button", { name: "Add eLabs.LabResultGroup" }).click();
  await page.getByRole("dialog", { name: "Add eLabs.LabResultGroup" }).getByRole("button", { name: "Add row" }).click();
  await parentDialog.getByRole("button", { name: "Add row", exact: true }).click();

  const parentRows = labs.locator("tbody > tr");
  await expect(parentRows).toHaveCount(2);
  const firstParentId = await parentRows.nth(0).getAttribute("data-group-instance-id");
  const secondParentId = await parentRows.nth(1).getAttribute("data-group-instance-id");
  expect(firstParentId).toBeTruthy();
  expect(secondParentId).toBeTruthy();
  expect(firstParentId).not.toBe(secondParentId);

  const firstEdit = parentRows.nth(0).getByRole("button", { name: "Edit" });
  await firstEdit.click();
  const reopened = page.getByRole("dialog", { name: "Edit eLabs.LabGroup" });
  const reopenedNested = reopened.locator('[data-group-id="eLabs.LabResultGroup"]');
  await expect(reopenedNested).toHaveAttribute("data-parent-instance-id", firstParentId!);
  await expect(reopenedNested.locator("tbody tr")).toHaveCount(1);
  await reopened.getByRole("button", { name: "Close" }).click();
  await expect(firstEdit).toBeFocused();
});

test("common numeric pickers edit inline and repeating-dialog values with visible exceptional state", async ({ page }) => {
  await page.route(`**/api/calls/${assignmentId}/open`, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(demoOpenAssignment),
  }));
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("group", { name: "Documentation presentation" }).getByRole("button", { name: "Stationary" }).click();
  await page.getByRole("button", { name: "Open call", exact: true }).click();

  const weight = page.locator('[data-element-id="eExam.01"] .stationary-value-picker');
  await weight.getByLabel("Decimal number").fill("82.5");
  await expect(weight).toHaveAttribute("data-value-state", "ordinary");
  await expect(weight.locator(".stationary-value-picker-state strong")).toHaveText("82.5");
  await weight.getByLabel("Exceptional value").selectOption({ label: "Unable to Complete" });
  await expect(weight).toHaveAttribute("data-value-state", "exceptional");
  await expect(weight.locator(".stationary-value-picker-state strong")).toHaveText("Unable to Complete");

  const vitals = page.locator('[data-group-id="eVitals.VitalGroup"]');
  await vitals.getByRole("button", { name: "Add eVitals.VitalGroup" }).click();
  const vitalDialog = page.getByRole("dialog", { name: "Add eVitals.VitalGroup" });
  await vitalDialog.locator('[data-group-id="eVitals.BloodPressureGroup"]').getByRole("button", { name: "Add eVitals.BloodPressureGroup" }).click();
  const systolic = vitalDialog.locator('[data-element-id="eVitals.06"] .stationary-value-picker');
  await systolic.getByLabel("Whole number").fill("118");
  await expect(systolic).toHaveAttribute("data-value-state", "ordinary");
  const occurrenceId = await systolic.getAttribute("data-occurrence-id");
  await systolic.getByLabel("Exceptional value").selectOption({ label: "Refused" });
  await expect(systolic.locator(".stationary-value-picker-state strong")).toHaveText("Refused");
  expect(await systolic.getAttribute("data-occurrence-id")).toBe(occurrenceId);
  await vitalDialog.getByRole("button", { name: "Add row", exact: true }).click();

  await vitals.locator("tbody > tr").getByRole("button", { name: "Edit" }).click();
  const reopened = page.getByRole("dialog", { name: "Edit eVitals.VitalGroup" });
  const reopenedSystolic = reopened.locator('[data-element-id="eVitals.06"] .stationary-value-picker');
  await expect(reopenedSystolic.locator(".stationary-value-picker-state strong")).toHaveText("Refused");
  expect(await reopenedSystolic.getAttribute("data-occurrence-id")).toBe(occurrenceId);
});
