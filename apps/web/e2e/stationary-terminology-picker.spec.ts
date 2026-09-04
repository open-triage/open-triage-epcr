import { expect, test } from "@playwright/test";
import demoAssignedCalls from "../public/demo-assigned-calls.json";
import demoOpenAssignment from "../public/demo-open-assignment.json";

const assignmentId = demoAssignedCalls.assignedCalls[0]!.id;

async function openStationaryRecord(page: import("@playwright/test").Page) {
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
}

test("compact terminology pickers search, expose exceptional state, and work in repeating dialogs", async ({ page }) => {
  await openStationaryRecord(page);

  const external = page.locator('[data-element-id="eScene.09"] .stationary-value-picker').first();
  await expect(external).toBeVisible();
  await expect(external.getByRole("combobox", { name: "Search by label or code" })).toHaveValue(/Apartment\/condo.*Y92\.03/);
  await expect(external.getByText("Advanced")).toBeVisible();
  await expect(external.getByLabel("Code system")).not.toBeVisible();
  await external.getByLabel("Exceptional value").selectOption({ label: "Not Recorded" });
  await expect(external).toHaveAttribute("data-value-state", "exceptional");
  await expect(external.getByRole("combobox", { name: "Search by label or code" })).toHaveValue("Not Recorded");
  await external.getByRole("button", { name: "Clear selection" }).click();
  await expect(external).toHaveAttribute("data-value-state", "unset");

  const bundled = page.locator('[data-element-id="eHistory.06"] .stationary-value-picker').first();
  const search = bundled.getByRole("combobox", { name: "Search by label or code" });
  await search.fill("antibiotic");
  const suggestion = bundled.getByRole("option").first();
  await expect(suggestion).toContainText(/antibiotic/i);
  await suggestion.click();
  await expect(bundled).toHaveAttribute("data-value-state", "ordinary");

  const medications = page.locator('[data-group-id="eMedications.MedicationGroup"]');
  await medications.getByRole("button", { name: "Add eMedications.MedicationGroup" }).click();
  const dialog = page.getByRole("dialog", { name: "Add eMedications.MedicationGroup" });
  const repeatingPicker = dialog.locator('[data-element-id="eMedications.03"] .stationary-value-picker');
  await expect(repeatingPicker.getByRole("combobox", { name: "Search by label or code" })).toBeVisible();
  await repeatingPicker.getByText("Advanced").click();
  await repeatingPicker.getByRole("textbox", { name: "Code", exact: true }).fill("custom-medication-code");
  await repeatingPicker.getByRole("textbox", { name: "Display", exact: true }).fill("Custom medication");
  await repeatingPicker.getByRole("button", { name: "Apply coded value" }).click();
  await expect(repeatingPicker.locator(".stationary-value-picker-state strong")).toHaveText("Custom medication (custom-medication-code)");
  await dialog.getByRole("button", { name: "Add row", exact: true }).click();
  await expect(medications.locator("tbody")).toContainText("Custom medication");
});
