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
  const add = responder.getByRole("button", { name: "Add Responder" });
  await expect(add).toBeEnabled();
  await add.click();
  const dialog = page.getByRole("dialog", { name: "Add Responder" });
  const agency = dialog.getByLabel(/Other EMS or Public Safety Agencies at Scene/);
  await expect(agency).toBeFocused();
  await agency.fill("Mutual Aid 7");
  await dialog.getByRole("button", { name: "Add row" }).click();

  const row = responder.locator("tbody tr");
  await expect(row).toHaveCount(1);
  await expect(row.locator('[data-element-id="eScene.02"]')).toHaveText("Mutual Aid 7");
  const instanceId = await row.getAttribute("data-group-instance-id");
  const occurrenceId = await row.locator('[data-element-id="eScene.02"] span').getAttribute("data-occurrence-id");
  expect(instanceId).toBeTruthy();
  expect(occurrenceId).toBeTruthy();

  const edit = row.getByRole("button", { name: "Edit Responder row" });
  await edit.click();
  await expect(page.getByRole("dialog", { name: "Edit Responder" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(edit).toBeFocused();

  await edit.click();
  await expect(page.getByRole("dialog", { name: "Edit Responder" })).toBeVisible();
  await page.locator(".dialog-backdrop").dispatchEvent("mousedown");
  await expect(page.getByRole("dialog", { name: "Edit Responder" })).toHaveCount(0);
  await expect(edit).toBeFocused();

  await page.setViewportSize({ width: 360, height: 800 });
  await expect(responder.getByRole("region", { name: "Responder Group table" })).toBeVisible();
  await edit.click();
  const narrowDialog = page.getByRole("dialog", { name: "Edit Responder" });
  await expect(narrowDialog).toBeVisible();
  await expect.poll(async () => (await narrowDialog.boundingBox())?.height).toBe(800);
  expect(await row.getAttribute("data-group-instance-id")).toBe(instanceId);
  expect(await row.locator('[data-element-id="eScene.02"] span').getAttribute("data-occurrence-id")).toBe(occurrenceId);
  await narrowDialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(edit).toBeFocused();
});

test("single-occurrence nested groups are flattened into their parent dialog", async ({ page }) => {
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

  await page.locator('[data-group-id="eVitals.VitalGroup"]').getByRole("button", { name: "Add Vital" }).click();
  const dialog = page.getByRole("dialog", { name: "Add Vital" });
  const heartRate = dialog.locator('[data-group-id="eVitals.HeartRateGroup"]');
  await expect(heartRate).toHaveCount(1);
  await expect(heartRate.locator(":scope > .section-heading")).toHaveCount(0);
  await expect(heartRate.locator('fieldset[data-element-id="eVitals.10"]')).toBeVisible();
  await expect(dialog.locator('[data-group-id="eVitals.CardiacRhythmGroup"] fieldset[data-element-id="eVitals.03"]')).toBeVisible();

  const etco2 = dialog.getByLabel("End Tidal Carbon Dioxide (ETCO2)");
  await etco2.focus();
  await etco2.blur();
  await expect(dialog.getByText("End Tidal Carbon Dioxide (ETCO2) is required.")).toHaveCount(0);
  await etco2.fill("35");
  await etco2.blur();
  await expect(etco2).toHaveValue("35");
});

test("removing the final required table row removes it and leaves scoped inline validation", async ({ page }) => {
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

  const procedures = page.locator('[data-group-id="eProcedures.ProcedureGroup"]');
  await procedures.getByRole("button", { name: "Add Procedure" }).click();
  await page.getByRole("dialog", { name: "Add Procedure" }).getByRole("button", { name: "Add row" }).click();
  await expect(procedures.locator("tbody tr")).toHaveCount(1);
  await procedures.getByRole("button", { name: "Remove Procedure row" }).click();
  await expect(procedures.locator("tbody tr")).toHaveCount(0);
  await expect(procedures).toHaveClass(/stationary-validation-state error/);
  const message = procedures.getByText(/ProcedureGroup requires at least 1 occurrence/);
  await expect(message).toBeVisible();
  await expect(procedures.locator(".stationary-validation-messages")).toContainText("ProcedureGroup requires at least 1 occurrence");
  await expect(procedures.locator(".stationary-table-scroll ~ .stationary-validation-messages")).toHaveCount(1);
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

  await labs.getByRole("button", { name: "Add Lab" }).click();
  let parentDialog = page.getByRole("dialog", { name: "Add Lab" });
  const firstNested = parentDialog.locator('[data-group-id="eLabs.LabResultGroup"]');
  const firstChildAdd = firstNested.getByRole("button", { name: "Add Lab Result" });
  await firstChildAdd.click();
  const childDialog = page.getByRole("dialog", { name: "Add Lab Result" });
  await childDialog.getByRole("button", { name: "Add row" }).click();
  await expect(firstChildAdd).toBeFocused();
  await expect(firstNested.locator("tbody tr")).toHaveCount(1);
  await parentDialog.getByRole("button", { name: "Add row", exact: true }).click();

  await labs.getByRole("button", { name: "Add Lab" }).click();
  parentDialog = page.getByRole("dialog", { name: "Add Lab" });
  const secondNested = parentDialog.locator('[data-group-id="eLabs.LabResultGroup"]');
  await expect(secondNested.locator("tbody tr")).toHaveCount(0);
  await secondNested.getByRole("button", { name: "Add Lab Result" }).click();
  await page.getByRole("dialog", { name: "Add Lab Result" }).getByRole("button", { name: "Add row" }).click();
  await parentDialog.getByRole("button", { name: "Add row", exact: true }).click();

  const parentRows = labs.locator("tbody > tr");
  await expect(parentRows).toHaveCount(2);
  const firstParentId = await parentRows.nth(0).getAttribute("data-group-instance-id");
  const secondParentId = await parentRows.nth(1).getAttribute("data-group-instance-id");
  expect(firstParentId).toBeTruthy();
  expect(secondParentId).toBeTruthy();
  expect(firstParentId).not.toBe(secondParentId);

  const firstEdit = parentRows.nth(0).getByRole("button", { name: "Edit Lab row" });
  await firstEdit.click();
  const reopened = page.getByRole("dialog", { name: "Edit Lab" });
  const reopenedNested = reopened.locator('[data-group-id="eLabs.LabResultGroup"]');
  await expect(reopenedNested).toHaveAttribute("data-parent-instance-id", firstParentId!);
  await expect(reopenedNested.locator("tbody tr")).toHaveCount(1);
  await reopened.getByRole("button", { name: "Close dialog" }).click();
  await expect(firstEdit).toBeFocused();
});
