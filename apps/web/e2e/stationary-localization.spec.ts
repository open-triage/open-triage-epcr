import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import demoAssignedCalls from "../public/demo-assigned-calls.json";
import demoOpenAssignment from "../public/demo-open-assignment.json";
import productionSettings from "@open-triage/contracts/config/installation.production.json";

const call = demoAssignedCalls.assignedCalls[0]!;
const reportId = demoOpenAssignment.report.id;
const userId = demoOpenAssignment.report.documentingUserId;

for (const language of ["en", "sv"] as const) {
  test(`${language} stationary navigation, groups, review and accessibility`, async ({ page }) => {
    test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires the server-backed mock API configuration.");
    await page.route("**/api/installation", (route) => route.fulfill({ json: { settings: { ...productionSettings, language } } }));
    await page.route("**/api/sessions", (route) => route.fulfill({ json: {
      csrfToken: "mobile-localization-csrf", user: { id: userId, displayName: "Synthetic Clinician" },
      organization: { id: "32000000-0000-4000-8000-000000000001", name: "Synthetic EMS" },
      startedAt: "2026-09-28T08:00:00Z", expiresAt: "2099-09-28T20:00:00Z",
      capabilities: ["clinical:document", "clinical:demo"], workspaceAvailable: true,
    } }));
    await page.route("**/api/calls/assigned", (route) => route.fulfill({ json: demoAssignedCalls }));
    await page.route("**/api/reports/open", (route) => route.fulfill({ json: { openCalls: [], completedReportIds: [], refreshedAt: new Date().toISOString() } }));
    await page.route("**/api/calls/synthetic-generation", (route) => route.fulfill({ json: { eligibleUnits: [call.unit], hasUnopenedCall: true } }));
    await page.route(`**/api/reports/${reportId}/active`, (route) => route.fulfill({ status: 304 }));
    await page.route(`**/api/reports/${reportId}/protected-key-envelope`, (route) => route.fulfill({ status: 201, json: {
      schemaVersion: 1, recoveryHandle: route.request().postDataJSON().recoveryHandle,
      recoveryDeadline: "2099-09-29T12:00:00Z", wrappingKeyVersion: 1,
    } }));
    await page.route(`**/api/reports/${reportId}/protected-ciphertext-receipt`, (route) => route.fulfill({ json: {
      schemaVersion: 1, recoveryDeadline: "2099-09-29T12:00:00Z",
    } }));
    await page.route(`**/api/reports/${reportId}/protected-ciphertext-checkpoint`, (route) => route.fulfill({ json: route.request().postDataJSON() }));
    const opened = { ...demoOpenAssignment, report: { ...demoOpenAssignment.report, clinicalForm: {
      definition: { schemaVersion: 1, sections: [] },
      catalogFields: { "eVitals.06": { name: "Systolic BP", agencyRequired: false, minOccurs: 0, maxOccurs: 1,
        nillable: true, supportsNotValues: true, supportsPertinentNegatives: true,
        localization: { sv: { label: "Systoliskt blodtryck" } } } },
    } } };
    await page.route(`**/api/calls/${call.id}/open`, (route) => route.fulfill({ json: opened }));
    await page.route(`**/api/reports/${reportId}/draft-changes`, (route) => route.fulfill({ json: { id: reportId, status: "draft", revision: 2 } }));

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.getByLabel(language === "sv" ? "Användarnamn" : "Username").fill("demo");
    await page.getByLabel(language === "sv" ? "Lösenord" : "Password").fill("opentriagedemo");
    await page.getByRole("button", { name: language === "sv" ? "Logga in" : "Sign in" }).click();
    await page.getByRole("group", { name: language === "sv" ? "Dokumentationsvy" : "Documentation presentation" })
      .getByRole("button", { name: language === "sv" ? "Stationär" : "Stationary" }).click();
    await page.getByRole("button", { name: language === "sv" ? "Öppna uppdrag" : "Open call" }).click();
    const rail = page.getByRole("navigation", { name: language === "sv" ? "Journalens avsnitt" : "Stationary record sections" });
    await expect(rail).toBeVisible();
    const patient = rail.getByRole("button", { name: language === "sv" ? /^Patient:/ : /^Patient:/ });
    await patient.click();
    await expect(page.locator("#stationary-section-ePatientSection-heading")).toBeFocused();
    const group = page.locator('[data-group-id="eScene.ResponderGroup"]');
    await group.getByRole("button", { name: language === "sv" ? /Lägg till Responder/ : /Add Responder/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog.getByRole("button", { name: language === "sv" ? "Avbryt" : "Cancel" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(group.getByRole("button", { name: language === "sv" ? /Lägg till Responder/ : /Add Responder/ })).toBeFocused();
    const firstName = page.locator('[data-element-id="ePatient.03"] input').first();
    await firstName.fill("TEST");
    await firstName.press("Tab");
    await page.getByRole("button", { name: language === "sv" ? "Granska och signera" : "Review & sign" }).click();
    await expect(page.getByRole("heading", { name: language === "sv" ? "Granska och signera" : "Review and sign" })).toBeVisible();
    await expect(page.getByRole("heading", { name: language === "sv" ? /Blockerande fel/ : /Blocking errors/ })).toBeVisible();
    await page.getByRole("button", { name: language === "sv" ? "Tillbaka till journalen" : "Return to record" }).click();
    await expect(rail).toBeVisible();
    await expect(firstName).toHaveValue("TEST");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(8);
    const violations = (await new AxeBuilder({ page }).include(".stationary-record-layout")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations
      .filter((violation) => violation.impact === "critical" || violation.impact === "serious");
    expect(violations, violations.map((violation) => violation.id + ": " + violation.help).join("\n")).toEqual([]);
  });
}
