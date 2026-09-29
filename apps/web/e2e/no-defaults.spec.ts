import { expect, test } from "@playwright/test";
import productionSettings from "@open-triage/contracts/config/installation.production.json";
import demoAssignedCalls from "../public/demo-assigned-calls.json";
import demoOpenAssignment from "../public/demo-open-assignment.json";

const call = demoAssignedCalls.assignedCalls[0]!;

test.beforeEach(async ({ page }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires the server-backed mock API configuration.");
  await page.route("**/api/installation", (route) => route.fulfill({ json: { settings: productionSettings } }));
  await page.route("**/api/sessions", (route) => route.fulfill({ json: {
    csrfToken: "no-defaults-csrf", user: { id: demoOpenAssignment.report.documentingUserId, displayName: "Synthetic Clinician" },
    organization: { id: "32000000-0000-4000-8000-000000000001", name: "Synthetic EMS" },
    startedAt: "2026-09-28T08:00:00Z", expiresAt: "2099-09-28T20:00:00Z",
    capabilities: ["clinical:document", "clinical:demo"], workspaceAvailable: true,
  } }));
  await page.route("**/api/calls/assigned", (route) => route.fulfill({ json: demoAssignedCalls }));
  await page.route("**/api/reports/open", (route) => route.fulfill({ json: { openCalls: [], completedReportIds: [], refreshedAt: new Date().toISOString() } }));
  await page.route("**/api/calls/synthetic-generation", (route) => route.fulfill({ json: { eligibleUnits: [call.unit], hasUnopenedCall: true } }));
  await page.route("**/api/reports/*/active", (route) => route.fulfill({ status: 304 }));
  await page.route("**/api/reports/*/protected-key-envelope", (route) => route.fulfill({ status: 201, json: {
    schemaVersion: 1, recoveryHandle: route.request().postDataJSON().recoveryHandle,
    recoveryDeadline: "2099-09-29T12:00:00Z", wrappingKeyVersion: 1,
  } }));
  await page.route("**/api/reports/*/protected-ciphertext-receipt", (route) => route.fulfill({ json: {
    schemaVersion: 1, recoveryDeadline: "2099-09-29T12:00:00Z",
  } }));
  await page.route("**/api/reports/*/protected-ciphertext-checkpoint", (route) => route.fulfill({ json: route.request().postDataJSON() }));
  await page.route("**/api/reports/*/draft-changes", (route) => route.fulfill({ json: { id: demoOpenAssignment.report.id, status: "draft", revision: 2 } }));
  const opened = structuredClone(demoOpenAssignment);
  // The second option remains inert legacy metadata; it must not move first.
  const clinicalForm = {
    definition: { schemaVersion: 1, sections: [{ key: "patient", fields: [
      { key: "gender", source: { kind: "nemsis", elementId: "ePatient.13" } },
    ] }] },
    catalogFields: { "ePatient.13": {
      name: "Gender", agencyRequired: false, minOccurs: 0, maxOccurs: 1,
      nillable: true, supportsNotValues: true, supportsPertinentNegatives: false,
      codeChoices: [
        { code: "9906001", codeSystem: "", label: "Female" },
        { code: "9906003", codeSystem: "", label: "Male" },
      ], defaultValue: { code: "9906003", codeSystem: "" },
    } },
  };
  // Start with an unanswered field in an otherwise unchanged historical document.
  for (const group of opened.report.document.groups) {
    for (const instance of group.instances) {
      instance.elements = instance.elements.filter((element) => element.id !== "ePatient.13");
    }
  }
  await page.route(`**/api/calls/${call.id}/open`, (route) => route.fulfill({
    json: { ...opened, report: { ...opened.report, clinicalForm } },
  }));
  await page.goto("/");
  await page.getByLabel("Username").fill("demo");
  await page.getByLabel("Password").fill("opentriagedemo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Open call", exact: true }).click();
});

test("mobile procedure capture waits for deliberate selection and leaves attempts blank", async ({ page }) => {
  await page.getByRole("button", { name: "Add procedure", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const search = dialog.locator('input[type="search"]');
  await search.fill("ECG");
  await expect(dialog.locator(".selected-catalog-item")).toHaveCount(0);
  await dialog.locator(".catalog-results button").first().click();
  await expect(dialog.getByLabel("Attempts", { exact: true })).toHaveValue("");
  await dialog.getByLabel("Attempts", { exact: true }).fill("2");
  await expect(dialog.getByLabel("Attempts", { exact: true })).toHaveValue("2");
  await expect(dialog.locator("select").first()).toHaveValue("");
  await expect(dialog.getByRole("button", { name: /default/i })).toHaveCount(0);
});

test("stationary legacy default neither selects nor reorders choices and explicit answers survive view changes", async ({ page }) => {
  const presentation = page.getByRole("group", { name: "Documentation presentation" });
  await presentation.getByRole("button", { name: "Stationary", exact: true }).click();
  const gender = page.locator('fieldset[data-element-id="ePatient.13"] select');
  await expect(gender).toHaveValue("");
  await expect(gender.locator("option")).toHaveText(["Choose a value", "Female", "Male"]);
  await gender.click();
  await page.keyboard.press("Escape");
  await expect(gender).toHaveValue("");
  await gender.selectOption({ label: "Female" });
  await presentation.getByRole("button", { name: "Mobile", exact: true }).click();
  await presentation.getByRole("button", { name: "Stationary", exact: true }).click();
  await expect(gender).toHaveValue("0");
  await expect(page.getByRole("button", { name: /apply.*default/i })).toHaveCount(0);
});
