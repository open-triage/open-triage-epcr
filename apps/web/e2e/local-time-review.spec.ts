import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import demoAssignedCalls from "../public/demo-assigned-calls.json";
import demoOpenAssignment from "../public/demo-open-assignment.json";
import productionSettings from "@open-triage/contracts/config/installation.production.json";

test.use({ timezoneId: "Europe/Stockholm" });

test("local timestamps agree across note dialog, timeline and stationary record; complete review can sign", async ({ page }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires the server-backed mock API configuration.");
  const call = demoAssignedCalls.assignedCalls[0]!;
  const reportId = demoOpenAssignment.report.id;
  const capturedAt = "2026-09-28T08:42:00.000Z";
  const note = { id: "10000000-0000-4000-8000-000000000094", reportId, type: "text", content: "Local-time audit note",
    capturedAt, capturedUtcOffsetMinutes: -240, author: { id: demoOpenAssignment.report.documentingUserId, displayName: "Demo" },
    serverReceivedAt: capturedAt, updatedAt: capturedAt, persistenceState: "ready" };
  const opened = { ...demoOpenAssignment, report: { ...demoOpenAssignment.report, demoMutable: true, agencyTimeZone: "UTC", notes: [note] } };
  await page.route("**/api/installation", (route) => route.fulfill({ json: { settings: productionSettings } }));
  await page.route("**/api/sessions", (route) => route.fulfill({ json: {
    csrfToken: "local-time-review-csrf",
    user: { id: opened.report.documentingUserId, displayName: "Synthetic Clinician" },
    organization: { id: "32000000-0000-4000-8000-000000000001", name: "Synthetic EMS" },
    startedAt: "2026-09-28T08:00:00Z", expiresAt: "2099-09-28T20:00:00Z",
    capabilities: ["clinical:document", "clinical:demo"], workspaceAvailable: true,
  } }));
  await page.route("**/api/calls/assigned", (route) => route.fulfill({ json: demoAssignedCalls }));
  await page.route("**/api/reports/open", (route) => route.fulfill({ json: {
    openCalls: [], completedReportIds: [], refreshedAt: capturedAt,
  } }));
  await page.route("**/api/calls/synthetic-generation", (route) => route.fulfill({ json: {
    eligibleUnits: [call.unit], hasUnopenedCall: true,
  } }));
  await page.route(`**/api/reports/${reportId}/active`, (route) => route.fulfill({ status: 304 }));
  await page.route(`**/api/reports/${reportId}/protected-key-envelope`, (route) => route.fulfill({ status: 201, json: {
    schemaVersion: 1, recoveryHandle: route.request().postDataJSON().recoveryHandle,
    recoveryDeadline: "2099-09-29T12:00:00Z", wrappingKeyVersion: 1,
  } }));
  await page.route(`**/api/reports/${reportId}/protected-ciphertext-receipt`, (route) => route.fulfill({ json: {
    schemaVersion: 1, recoveryDeadline: "2099-09-29T12:00:00Z",
  } }));
  await page.route(`**/api/reports/${reportId}/protected-ciphertext-checkpoint`, (route) => route.fulfill({ json: route.request().postDataJSON() }));
  await page.route("**/demo-assigned-calls.json", (route) => route.fulfill({ json: demoAssignedCalls }));
  await page.route(`**/api/calls/${call.id}/open`, (route) => route.fulfill({ json: opened }));
  await page.route("**/demo-open-assignment.json", (route) => route.fulfill({ json: opened }));
  let revision = Number(opened.report.revision);
  await page.route(`**/api/reports/${reportId}/draft-changes`, (route) => route.fulfill({ json: { id: reportId, status: "draft", revision: ++revision } }));
  await page.route(`**/api/reports/${reportId}/sign`, (route) => route.fulfill({ status: 201, json: { id: reportId, status: "signed", signedRevision: revision } }));
  await page.goto("/");
  await page.getByLabel("Username").fill("demo");
  await page.getByLabel("Password", { exact: true }).fill("opentriagedemo");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Open call", exact: true }).first().click();
  const noteButton = page.getByRole("button", { name: /Open text note at 10:42.*Local-time audit note/ });
  await expect(noteButton).toBeVisible();
  await noteButton.click();
  await expect(page.getByRole("dialog")).toContainText("10:42");
  await expect(page.getByRole("dialog")).toContainText("local time");
  await page.keyboard.press("Escape");
  const summary = await page.locator(".complete-record-summary").innerText();
  const errorCount = Number(/Complete record: (\d+)/.exec(summary)![1]);
  await page.getByRole("button", { name: "Stationary", exact: true }).click();
  await expect(page.locator('[data-element-id="eTimes.03"] .time-picker-trigger').first()).toContainText("15:14");
  await page.getByRole("textbox", { name: "First Name", exact: true }).fill("LOCAL TIME TEST");
  await page.getByRole("textbox", { name: "First Name", exact: true }).press("Tab");
  await expect.poll(() => revision).toBeGreaterThan(opened.report.revision);
  await expect(page.locator(".sync-status")).toHaveText("Saved");
  await page.getByRole("button", { name: "Review & sign", exact: true }).click();
  await expect(page.locator(".review-panel > .section-heading")).toContainText(`${errorCount} errors`);
  if (errorCount) {
    await expect(page.getByRole("button", { name: "Fix next error →", exact: true })).toBeVisible();
    await expect(page.locator(".review-section summary").first()).toBeVisible();
    await page.getByRole("button", { name: "Fix next error →", exact: true }).click();
    await expect(page.getByRole("button", { name: "Review & sign", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Review & sign", exact: true }).click();
  }
  await page.getByRole("button", { name: "Populate", exact: true }).click();
  await expect(page.locator(".sync-status")).toHaveText("Saved", { timeout: 10000 });
  for (const checkbox of await page.getByLabel("I reviewed and acknowledge this warning").all()) await checkbox.check();
  const accessibility = await new AxeBuilder({ page }).include(".review-panel").analyze();
  expect(accessibility.violations.filter(({ impact }) => impact === "critical" || impact === "serious")).toEqual([]);
  await expect(page.getByRole("button", { name: "Sign record", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Sign record", exact: true }).click();
  await expect(page.getByText(/was signed and removed from active calls/)).toBeVisible();
});
