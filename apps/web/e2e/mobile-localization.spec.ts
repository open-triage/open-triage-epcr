import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import demoAssignedCalls from "../public/demo-assigned-calls.json";
import demoOpenAssignment from "../public/demo-open-assignment.json";
import productionSettings from "@open-triage/contracts/config/installation.production.json";

const call = demoAssignedCalls.assignedCalls[0]!;
const reportId = demoOpenAssignment.report.id;
const userId = demoOpenAssignment.report.documentingUserId;

for (const language of ["en", "sv"] as const) {
  test(`${language} mobile dispatch and encounter keep values, focus and accessible layout`, async ({ page }) => {
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

    await page.goto("/");
    await page.getByLabel(language === "sv" ? "Användarnamn" : "Username").fill("demo");
    await page.getByLabel(language === "sv" ? "Lösenord" : "Password").fill("opentriagedemo");
    await page.getByRole("button", { name: language === "sv" ? "Logga in" : "Sign in" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await expect(page.getByRole("heading", { name: language === "sv" ? "Tilldelade uppdrag" : "Assigned calls" })).toBeVisible();
    await page.getByRole("button", { name: language === "sv" ? "Öppna uppdrag" : "Open call" }).click();
    await expect(page.getByRole("heading", { name: language === "sv" ? "Tidslinje" : "Timeline" })).toBeVisible();
    const addVitals = page.getByRole("button", { name: language === "sv" ? "Lägg till vitalparametrar" : "Add vital signs" });
    await addVitals.click();
    const dialog = page.getByRole("dialog", { name: "Vital signs" }); // Authored clinical label falls back to English.
    await expect(dialog).toBeVisible();
    const systolicLabel = language === "sv" ? /Systoliskt blodtryck/ : /Systolic BP/;
    const systolic = dialog.getByRole("textbox", { name: systolicLabel });
    await systolic.fill("120");
    await page.keyboard.press("Tab");
    await expect(systolic).toHaveValue("120");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Add vital set" }).click();
    await page.getByRole("button", { name: new RegExp(language === "sv" ? "Checklista" : "Checklist") }).click();
    await page.getByRole("button", { name: new RegExp(language === "sv" ? "Tidslinje" : "Timeline") }).click();
    await page.locator(".timeline-event-button").filter({ hasText: /Vital signs/ }).first().click();
    await expect(page.getByRole("dialog", { name: "Vital signs" }).getByRole("textbox", { name: systolicLabel })).toHaveValue("120");
    await page.keyboard.press("Escape");
    await expect(page.locator(".timeline-event-button").filter({ hasText: /Vital signs/ }).first().getByRole("button")).toBeFocused();
    await page.getByRole("button", { name: language === "sv" ? "Textanteckning" : "Text note" }).click();
    const noteDialog = page.getByRole("dialog", { name: language === "sv" ? "Textanteckning" : "Text note" });
    const noteText = noteDialog.getByRole("textbox");
    await noteText.fill("Åke observerade förbättring");
    await expect(noteText).toHaveValue("Åke observerade förbättring");
    await expect(noteDialog.locator("#report-text-note-count")).toContainText(language === "sv" ? "tecken" : "characters");
    await page.keyboard.press("Tab");
    await expect(noteText).toHaveValue("Åke observerade förbättring");
    await noteDialog.getByRole("button", { name: language === "sv" ? "Avbryt" : "Cancel" }).click();

    await page.getByRole("button", { name: language === "sv" ? "Lägg till fotoanteckning" : "Add photo note" }).click();
    const photoDialog = page.getByRole("dialog", { name: language === "sv" ? "Fotoanteckning" : "Photo note" });
    await expect(photoDialog).toBeVisible();
    await expect(photoDialog.getByRole("button", { name: language === "sv" ? "Byt kamera" : "Cycle camera" })).toBeVisible();
    await photoDialog.getByRole("button", { name: language === "sv" ? "Avbryt" : "Cancel" }).click();

    await page.getByRole("button", { name: language === "sv" ? "Lägg till ljudanteckning" : "Add audio note" }).click();
    const audioDialog = page.getByRole("dialog", { name: language === "sv" ? "Ljudanteckning" : "Audio note" });
    await expect(audioDialog).toBeVisible();
    await expect(audioDialog.getByRole("button", { name: language === "sv" ? "Håll intryckt för att spela in" : "Hold to record" })).toBeVisible();
    await audioDialog.getByRole("button", { name: language === "sv" ? "Avbryt" : "Cancel" }).click();
    const violations = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations
      .filter((violation) => violation.impact === "critical" || violation.impact === "serious");
    expect(violations, violations.map((violation) => `${violation.id}: ${violation.help}`).join("\n")).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
