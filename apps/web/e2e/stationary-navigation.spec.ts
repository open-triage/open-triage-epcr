import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import demoAssignedCalls from "../public/demo-assigned-calls.json";
import demoOpenAssignment from "../public/demo-open-assignment.json";

const assignmentId = demoAssignedCalls.assignedCalls[0]!.id;

async function openStationaryRecord(page: import("@playwright/test").Page, assignment = demoOpenAssignment) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/demo-open-assignment.json", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(assignment),
  }));
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("group", { name: "Documentation presentation" }).getByRole("button", { name: "Stationary" }).click();
  await page.getByRole("button", { name: "Open call", exact: true }).click();
}

test("stationary rail supports section jumps, direct hashes, focus, and scroll tracking", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await openStationaryRecord(page);

  const rail = page.getByRole("navigation", { name: "Stationary record sections" });
  await expect(rail).toBeVisible();
  await expect(rail.getByRole("link")).toHaveCount(25);
  await expect(rail.getByRole("link", { name: /Demographic/ })).toHaveCount(0);
  await expect(rail.getByRole("link", { name: /Custom Configuration/ })).toHaveCount(0);
  const accessibility = await new AxeBuilder({ page }).include(".stationary-record-layout")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(accessibility.violations.filter(({ impact }) => impact === "critical" || impact === "serious")).toEqual([]);
  const patientLink = rail.getByRole("link", { name: /^Patient:/ });
  await patientLink.click();
  await expect(page).toHaveURL(/#stationary-section-ePatientSection$/);
  const patientHeading = page.locator("#stationary-section-ePatientSection-heading");
  await expect(patientHeading).toBeFocused();
  await expect(patientLink).toHaveAttribute("aria-current", "location");
  const stickyHeading = patientHeading.locator("xpath=..");
  await expect(stickyHeading).toHaveCSS("position", "sticky");
  const stickyTop = (await stickyHeading.boundingBox())!.y;
  await page.evaluate(() => window.scrollBy(0, 240));
  const pinnedTop = Math.round((await stickyHeading.boundingBox())!.y);
  expect(pinnedTop).toBeLessThanOrEqual(Math.round(stickyTop));
  await page.evaluate(() => window.scrollBy(0, 120));
  await expect.poll(async () => Math.round((await stickyHeading.boundingBox())!.y)).toBe(pinnedTop);

  await page.evaluate(() => { window.location.hash = "stationary-section-eNarrativeSection"; });
  const narrativeHeading = page.locator("#stationary-section-eNarrativeSection-heading");
  await expect(narrativeHeading).toBeFocused();
  await expect(rail.getByRole("link", { name: /^Narrative:/ })).toHaveAttribute("aria-current", "location");

  await page.locator("#stationary-section-eDispositionSection").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
  await expect(rail.getByRole("link", { name: /^Disposition:/ })).toHaveAttribute("aria-current", "location");

});

test("complete-record findings open and focus their stable editable target", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await openStationaryRecord(page);
  await page.getByRole("button", { name: "Review & sign" }).click();

  const finding = page.locator(".review-findings li").filter({ hasText: "ePatient.07" }).first();
  await expect(finding).toContainText("Complete record");
  await finding.getByRole("button").click();

  await expect(page).toHaveURL(/#stationary-section-ePatientSection$/);
  await expect(page.locator('[data-element-id="ePatient.07"] select').first()).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "Opened ePatient.07 for correction." })).toHaveCount(1);
  const accessibility = await new AxeBuilder({ page }).include("#stationary-section-ePatientSection")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(accessibility.violations.filter(({ impact }) => impact === "critical" || impact === "serious")).toEqual([]);
});

test("nested findings open their row dialog and highlight only the affected picker", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  const configured = structuredClone(demoOpenAssignment);
  Object.assign(configured.report, { clinicalForm: {
    definition: { schemaVersion: 1, sections: [{ key: "vitals", presentation: { title: "Vitals" }, fields: [
      { key: "respiratory-rate", source: { kind: "nemsis", elementId: "eVitals.14" } },
    ] }] },
    catalogFields: {
      "eVitals.14": { agencyRequired: false, minOccurs: 0, maxOccurs: 1, nillable: true,
        supportsNotValues: true, supportsPertinentNegatives: true },
    },
  } });
  await openStationaryRecord(page, configured);
  await page.getByRole("button", { name: "Populate" }).click();
  const vitals = page.locator('[data-group-id="eVitals.VitalGroup"]');
  await vitals.getByRole("button", { name: /Edit Vital/ }).first().click();
  const initialDialog = page.getByRole("dialog");
  await initialDialog.locator('.stationary-dialog-field[data-element-id="eVitals.14"] input').fill("0");
  await initialDialog.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("button", { name: "Review & sign" }).click();

  await page.locator(".review-findings li").filter({ hasText: "Clinically unusual respiratory rate" }).first().getByRole("button").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveClass(/stationary-validation-state/);
  const affected = dialog.locator('.stationary-dialog-field[data-element-id="eVitals.14"]');
  await expect(affected).toHaveClass(/stationary-validation-state warning/);
  await expect(affected.locator("input")).toBeFocused();
  await expect(dialog.locator('.stationary-dialog-field[data-element-id="eVitals.01"]')).not.toHaveClass(/stationary-validation-state/);
});

test("an opened report uses its pinned form and catalog without changing Mobile", async ({ page }) => {
  const configured = structuredClone(demoOpenAssignment);
  let revision = configured.report.revision;
  Object.assign(configured.report, { clinicalForm: {
    definition: { schemaVersion: 1, sections: [{
      key: "patient", presentation: { title: "Configured patient" }, fields: [
        { key: "sex", source: { kind: "nemsis", elementId: "ePatient.25" } },
        { key: "first-name", source: { kind: "nemsis", elementId: "ePatient.02" } },
      ],
    }, {
      key: "scene", presentation: { title: "Configured scene" }, fields: [
        { key: "address", source: { kind: "nemsis", elementId: "eScene.15" } },
      ],
    }] },
    catalogFields: {
      "ePatient.25": { agencyRequired: true, minOccurs: 0, maxOccurs: 1, nillable: true,
        supportsNotValues: true, supportsPertinentNegatives: true,
        codeChoices: [{ code: "9919005", codeSystem: "", label: "Configured unknown" }] },
      "ePatient.02": { agencyRequired: false, minOccurs: 0, maxOccurs: 1, nillable: true,
        supportsNotValues: true, supportsPertinentNegatives: false },
      "eScene.15": { agencyRequired: false, minOccurs: 0, maxOccurs: 1, nillable: true,
        supportsNotValues: true, supportsPertinentNegatives: false },
    },
  } });
  await page.route("**/demo-open-assignment.json", (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify(configured),
  }));
  await page.route("**/draft-changes", async (route) => {
    revision += 1;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: configured.report.id, status: "draft", revision }) });
  });
  await page.route(`**/api/reports/${configured.report.id}/sign`, (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify({ id: configured.report.id, status: "signed", revision: revision + 1 }),
  }));
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Open call", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Quick documentation" })).toBeVisible();
  await page.getByRole("group", { name: "Documentation presentation" }).getByRole("button", { name: "Stationary" }).click();

  const rail = page.getByRole("navigation", { name: "Stationary record sections" });
  await expect(rail.getByRole("link")).toHaveText([/Configured patient/, /Configured scene/]);
  const configuredPatient = page.locator('[data-stationary-section="draft-0-patient"]');
  await expect(configuredPatient.locator('[data-element-id="ePatient.25"] select')).toContainText("Configured unknown");
  await expect(page.locator('[data-element-id="eVitals.06"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Save & close" }).click();
  await page.getByRole("button", { name: "Reopen call" }).click();
  await expect(page.locator(".sync-status")).toHaveText("Saved", { timeout: 4_000 });
  await page.getByRole("button", { name: "Review & sign" }).click();
  await expect(page.getByText("0 errors · 0 warnings")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign record" })).toBeEnabled();
  const accessibility = await new AxeBuilder({ page }).include(".review-panel")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(accessibility.violations.filter(({ impact }) => impact === "critical" || impact === "serious")).toEqual([]);
  await page.getByRole("button", { name: "Sign record" }).click();
  await expect(page.getByRole("status").filter({ hasText: "was signed and removed from active calls" })).toBeVisible();
});
