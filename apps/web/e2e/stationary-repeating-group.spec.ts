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
