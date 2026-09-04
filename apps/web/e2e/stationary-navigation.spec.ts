import AxeBuilder from "@axe-core/playwright";
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

test("stationary rail supports section jumps, direct hashes, focus, scroll tracking, and tablet layout", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await openStationaryRecord(page);

  const rail = page.getByRole("navigation", { name: "Stationary record sections" });
  await expect(rail).toBeVisible();
  await expect(rail.getByRole("link")).toHaveCount(27);
  const accessibility = await new AxeBuilder({ page }).include(".stationary-record-layout")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(accessibility.violations.filter(({ impact }) => impact === "critical" || impact === "serious")).toEqual([]);
  const patientLink = rail.getByRole("link", { name: /^ePatient:/ });
  await patientLink.click();
  await expect(page).toHaveURL(/#stationary-section-ePatientSection$/);
  const patientHeading = page.locator("#stationary-section-ePatientSection-heading");
  await expect(patientHeading).toBeFocused();
  await expect(patientLink).toHaveAttribute("aria-current", "location");

  await page.evaluate(() => { window.location.hash = "stationary-section-eNarrativeSection"; });
  const narrativeHeading = page.locator("#stationary-section-eNarrativeSection-heading");
  await expect(narrativeHeading).toBeFocused();
  await expect(rail.getByRole("link", { name: /^eNarrative:/ })).toHaveAttribute("aria-current", "location");

  await page.locator("#stationary-section-eDispositionSection").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
  await expect(rail.getByRole("link", { name: /^eDisposition:/ })).toHaveAttribute("aria-current", "location");

  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(rail).toBeVisible();
  await expect(page.locator("#stationary-section-eDispositionSection")).toBeVisible();
});

test("complete-record findings open and focus their stable editable target", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await openStationaryRecord(page);
  await page.getByRole("button", { name: "Review & sign" }).click();

  const finding = page.locator(".review-findings li").filter({ hasText: "ePatient.07" }).first();
  await expect(finding).toContainText("Complete record");
  await finding.getByRole("button").click();

  await expect(page).toHaveURL(/#stationary-section-ePatientSection$/);
  await expect(page.locator('[data-element-id="ePatient.07"] input').first()).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "Opened ePatient.07 for correction." })).toHaveCount(1);
  const accessibility = await new AxeBuilder({ page }).include("#stationary-section-ePatientSection")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(accessibility.violations.filter(({ impact }) => impact === "critical" || impact === "serious")).toEqual([]);
});
