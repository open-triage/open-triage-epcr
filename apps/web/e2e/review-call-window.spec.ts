import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import settings from "@open-triage/contracts/config/installation.production.json";

test("queue rows open the pinned form with findings, discussion history, closure and handoff", async ({ page, context }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires the server-backed mock API.");
  const reportId = "123e4567-e89b-42d3-a456-426614174111";
  const itemId = "123e4567-e89b-42d3-a456-426614174112";
  const reviewerId = "123e4567-e89b-42d3-a456-426614174114";
  const nextReviewer = "123e4567-e89b-42d3-a456-426614174115";
  const outcomeId = "123e4567-e89b-42d3-a456-426614174116";
  const now = new Date().toISOString();
  const session = { csrfToken: "window-csrf", user: { id: reviewerId, displayName: "Reviewer" },
    organization: { id: "organization", name: "Example EMS" }, startedAt: now,
    expiresAt: "2099-10-02T20:00:00Z", capabilities: ["review:all", "review:identifying"], workspaceAvailable: true };
  let version = 1, status = "in-review", assigneeId = reviewerId;
  const comments: Array<{ id: string; actorId: string; actorName: string; body: string; kind: string; itemVersion: number; recordedAt: string }> = [];
  const item = () => ({ id: itemId, reportId, reportNumber: "PCR-123", criterionId: outcomeId,
    criterionName: "Timeline", criterionDescription: "Confirm the time of arrival.", kind: "criterion", priority: "high",
    status, outcome: null, assigneeId, version, recoveryReason: null, firstMatchedAt: now, reportingDate: "2026-10-02",
    signedAt: now, findings: [], assignmentHistory: [], progressHistory: [], amendmentHistory: [], comments,
    commentsRestricted: false, canComment: true });
  await context.addInitScript((stored) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await context.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/installation") return route.fulfill({ json: { settings } });
    if (path === "/api/sessions/current") return route.fulfill({ json: session });
    if (path === "/api/review/attention") return route.fulfill({ json: { dataset: "real", asOf: now, assignments: 0, responses: 0, reopened: 0 } });
    if (path === "/api/review/queue") return route.fulfill({ json: { dataset: "real", page: 1, pageSize: 25, total: 1,
      assignmentCounts: { all: 1, mine: 1, unassigned: 0 }, asOf: now, items: [item()] } });
    if (path === "/api/review/reports") return route.fulfill({ json: { dataset: "real", identifying: true, reports: [], total: 0, page: 1, pageSize: 25, asOf: now } });
    if (path === `/api/review/items/${itemId}`) return route.fulfill({ json: item() });
    if (path === "/api/review/eligible-reviewers") return route.fulfill({ json: [{ id: nextReviewer, displayName: "Senior reviewer" }] });
    if (path === "/api/review/outcomes") return route.fulfill({ json: [{ id: outcomeId, revision: 1, label: "Reviewed", meaning: "Confirmed", active: true }] });
    if (path === `/api/review/reports/${reportId}`) return route.fulfill({ json: {
      id: reportId, reportingDate: "2026-10-02", signedAt: now, amendmentSequence: 0, identifying: true, groups: [], values: [], notes: [],
      clinicalForm: { definition: { sections: [{ key: "saved-layout", name: "Original form layout", fields: [
        { key: "pulse", source: { kind: "nemsis", elementId: "eVitals.06" } },
        { key: "custom-note", source: { kind: "custom", elementDefinitionId: "custom-note" } }] }] },
        catalogFields: {}, customFields: { "custom-note": { id: "custom-note", namespace: "test", slug: "Note", title: "Saved observation", datatype: "string", recurrence: "single", usage: "Optional", identifying: true, constraints: { maxLength: 120 } } } },
      document: { $schema: "https://opentriage.org/schemas/encounter-document/v1", documentType: "open-triage.encounter", modelVersion: "1",
        dataModel: { standard: "NEMSIS", version: "3.5.0", dataset: "EMSDataSet" }, formProfile: { id: "original-form", version: "1" },
        encounter: { id: reportId, createdAt: now, updatedAt: now }, groups: [
          { id: "eVitals.VitalGroup", instances: [{ instanceId: "vitals-instance", elements: [] }] },
          { id: "eVitals.BloodPressureGroup", instances: [{ instanceId: "bp-instance", parentInstanceId: "vitals-instance", elements: [{ id: "eVitals.06", values: [{ occurrenceId: "pulse", kind: "scalar", value: 90 }] }] }] },
          { id: "PatientCareReportGroup", instances: [{ instanceId: "custom-instance", elements: [{ id: "test.Note", values: [{ occurrenceId: "note", kind: "scalar", value: "Documented observation" }] }] }] }] },
    } });
    if (path === `/api/review/items/${itemId}/comments`) {
      const command = route.request().postDataJSON();
      expect(command.expectedVersion).toBe(version);
      expect(route.request().headers()["x-csrf-token"]).toBe("window-csrf");
      version++; comments.push({ id: String(version), actorId: reviewerId, actorName: "Reviewer", body: command.body,
        kind: command.kind, itemVersion: version, recordedAt: now });
      return route.fulfill({ json: item() });
    }
    if (path === `/api/review/items/${itemId}/progress`) {
      const command = route.request().postDataJSON(); expect(command.expectedVersion).toBe(version);
      expect(command.outcomeOptionId).toBe(outcomeId); status = command.status; version++;
      return route.fulfill({ json: item() });
    }
    if (path === `/api/review/items/${itemId}/forward`) {
      const command = route.request().postDataJSON(); expect(command.expectedVersion).toBe(version);
      expect(command.assigneeId).toBe(nextReviewer); assigneeId = nextReviewer; status = "new"; version++;
      return route.fulfill({ json: item() });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "All reviews 1", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toHaveCount(0);
  await expect(page.getByText(/Last checked|New assignments:|Clinician responses requested:|Reopened reviews:/)).toHaveCount(0);
  const row = page.getByRole("button", { name: "PCR-123", exact: true });
  await row.focus(); await expect(page.getByRole("tooltip")).toBeVisible();
  const popupPromise = context.waitForEvent("page");
  await row.click(); const popup = await popupPromise;
  await popup.waitForLoadState();
  await expect(popup).toHaveURL(/review-call\/\?report=/);
  await expect(popup.getByRole("heading", { name: "Original form layout", exact: true })).toBeVisible();
  await expect(popup.getByRole("textbox", { name: /Saved observation/ })).toBeDisabled();
  await expect(popup.getByRole("textbox", { name: /Saved observation/ })).toHaveValue("Documented observation");
  await popup.getByRole("button", { name: /^View .* row$/ }).first().click();
  const dialog = popup.getByRole("dialog");
  await expect(dialog.getByText("90", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(popup.getByRole("tab", { name: "Discussion", exact: true })).toHaveCount(0);
  await popup.getByLabel("Entry type").selectOption("finding");
  await popup.getByRole("textbox", { name: "Document findings", exact: true }).fill("Timeline confirmed.");
  await popup.getByRole("button", { name: "Save findings", exact: true }).click();
  await expect(popup.getByRole("textbox", { name: "Document findings", exact: true })).toHaveValue("");
  await popup.getByLabel("Entry type").selectOption("comment");
  await popup.getByRole("textbox", { name: "Comment", exact: true }).fill("Discussed with clinician.");
  await popup.getByRole("button", { name: "Send comment", exact: true }).click();
  await expect(popup.getByRole("textbox", { name: "Comment", exact: true })).toHaveValue("");
  await popup.getByRole("tab", { name: "History", exact: true }).click();
  await expect(popup.getByText("Timeline confirmed.", { exact: true })).toBeVisible();
  await expect(popup.getByText("Discussed with clinician.", { exact: true })).toBeVisible();
  await popup.getByRole("tab", { name: "Document findings", exact: true }).click();
  await popup.getByLabel("Send to reviewer").selectOption(nextReviewer);
  await popup.getByRole("button", { name: "Send for further review", exact: true }).click();
  await expect.poll(() => assigneeId).toBe(nextReviewer);
  await expect(popup.getByRole("button", { name: "Start review", exact: true })).toHaveCount(0);
  expect(comments.map((entry) => entry.kind)).toEqual(["finding", "comment"]);
  assigneeId = reviewerId; status = "in-review";
  await popup.reload();
  await popup.getByLabel("Outcome").selectOption(outcomeId);
  await popup.getByRole("button", { name: "Complete item", exact: true }).click();
  await expect.poll(() => status).toBe("completed");
  const results = await new AxeBuilder({ page: popup }).analyze();
  expect(results.violations.filter((violation) => ["critical", "serious"].includes(violation.impact ?? ""))).toEqual([]);
  await popup.close();
});
