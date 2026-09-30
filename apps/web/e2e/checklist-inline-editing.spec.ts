import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import demoOpenAssignment from "../public/demo-open-assignment.json";

test("flagged scalar and choice fields edit in both checklists and persist in the normal form", async ({ page }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE === "true", "Uses the local demonstration report fixture.");
  const opened = structuredClone(demoOpenAssignment);
  const reportId = randomUUID();
  opened.report.id = reportId;
  opened.report.document.encounter.id = reportId;
  const nameGroup = opened.report.document.groups.find(({ id }) => id === "ePatient.PatientNameGroup")!;
  nameGroup.instances[0]!.elements = nameGroup.instances[0]!.elements.filter(({ id }) => id !== "ePatient.02");
  Object.assign(opened.report, { clinicalForm: {
    definition: { schemaVersion: 1, sections: [{ key: "patient", fields: [
      { key: "first-name", required: true, source: { kind: "nemsis", elementId: "ePatient.02" } },
      { key: "gender", required: true, source: { kind: "nemsis", elementId: "ePatient.13" } },
      { key: "optional-address", source: { kind: "nemsis", elementId: "ePatient.17" } },
    ] }] },
    catalogFields: { "ePatient.13": { agencyRequired: false, minOccurs: 0, maxOccurs: 1, nillable: true,
      supportsNotValues: true, supportsPertinentNegatives: false,
      codeChoices: [{ code: "9906001", codeSystem: "", label: "Female" },
        { code: "9906003", codeSystem: "", label: "Male" }] } },
  } });
  await page.route("**/demo-open-assignment.json", (route) => route.fulfill({ json: opened }));
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByLabel("Username").fill("demo");
  await page.getByLabel("Password").fill("opentriagedemo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Open call", exact: true }).click();

  await page.getByRole("button", { name: /^Checklist/ }).click();
  const mobile = page.locator(".checklist-panel");
  const firstName = mobile.locator("li").filter({ has: page.locator('[data-element-id="ePatient.02"]') }).first();
  await expect(firstName.getByRole("textbox", { name: /last name/i })).toBeVisible();
  const mobileAccessibility = await new AxeBuilder({ page }).include(".checklist-panel")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(mobileAccessibility.violations.filter(({ impact }) => impact === "critical" || impact === "serious")).toEqual([]);
  await firstName.getByRole("textbox", { name: /last name/i }).fill("Mira");
  await firstName.getByRole("textbox", { name: /last name/i }).blur();
  await expect(mobile.locator("li").filter({ has: page.locator('[data-element-id="ePatient.02"]') })).toHaveCount(0);
  await expect(mobile.locator("li").filter({ hasText: "ePatient.17" })).toHaveCount(0);

  await page.getByRole("group", { name: "Documentation presentation" }).getByRole("button", { name: "Stationary" }).click();
  await expect(page.locator('[data-element-id="ePatient.02"] input').first()).toHaveValue("Mira");
  await page.getByRole("button", { name: "Review & sign" }).click();
  const stationary = page.locator(".review-panel");
  const gender = stationary.locator("li").filter({ hasText: "ePatient.13" }).first();
  await expect(gender.locator(".clinical-searchable-trigger")).toBeVisible();
  const stationaryAccessibility = await new AxeBuilder({ page }).include(".review-panel")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(stationaryAccessibility.violations.filter(({ impact }) => impact === "critical" || impact === "serious")).toEqual([]);
  await gender.locator(".clinical-searchable-trigger").click();
  const search = page.getByRole("combobox", { name: /Search/ });
  await expect(search).toBeFocused();
  await search.fill("Fem");
  await expect(page.locator(".clinical-searchable-popup [role='option']")).toHaveCount(1);
  await search.press("Escape");
  await expect(gender.locator(".clinical-searchable-trigger")).toHaveText("Choose a value");
  await gender.locator(".clinical-searchable-trigger").click();
  await page.locator(".clinical-searchable-popup [role='option']").filter({ hasText: "Female" }).click();
  await expect(stationary.locator("li").filter({ hasText: "ePatient.13" })).toHaveCount(0);
  await page.getByRole("button", { name: "Return to record" }).click();
  await expect(page.locator('fieldset[data-element-id="ePatient.13"] .clinical-searchable-trigger').first()).toHaveText("Female");
});
