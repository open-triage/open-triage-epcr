import { openReviewCall } from "./helpers/review-window";
import { expect, test } from "@playwright/test";
import settings from "@open-triage/contracts/config/installation.production.json";

test("review administrator closes an overdue unsigned follow-up with a coded reason", async ({ page }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires server-backed mock API configuration.");
  const itemId = "123e4567-e89b-42d3-a456-426614174231";
  const reportId = "123e4567-e89b-42d3-a456-426614174232";
  const session = { csrfToken: "csrf", user: { id: "reviewer", displayName: "Reviewer" },
    organization: { id: "organization", name: "Example EMS" }, startedAt: "2026-10-02T08:00:00Z",
    expiresAt: "2099-10-02T20:00:00Z", capabilities: ["review:all", "review:admin"], workspaceAvailable: true };
  let closed = false;
  let signedReads = 0;
  const item = () => ({ id: itemId, reportId, criterionId: "01200000-0000-4000-8000-000000000001",
    kind: "overdue-unsigned", priority: "medium", status: closed ? "completed" : "new", outcome: null,
    assigneeId: null, version: closed ? 1 : 0, firstMatchedAt: "2026-10-02T08:00:00Z",
    reportingDate: null, signedAt: null, deadlineAt: "2026-10-02T08:00:00Z",
    deadlineSource: "report-created", resolutionReason: closed ? "closed-exceptionally" : null,
    exceptionCode: closed ? "report-not-required" : null, findings: [] });
  await page.addInitScript((stored) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await page.context().route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/installation") return route.fulfill({ json: { settings } });
    if (url.pathname === "/api/sessions/current") return route.fulfill({ json: session });
    if (url.pathname === "/api/review/queue") return route.fulfill({ json: { dataset: "real", page: 1,
      pageSize: 25, total: 1, asOf: new Date().toISOString(), items: [item()] } });
    if (url.pathname === `/api/review/items/${itemId}/close-exceptionally`) {
      expect(route.request().headers()["x-csrf-token"]).toBe("csrf");
      const command = route.request().postDataJSON() as { expectedVersion: number; reasonCode: string };
      expect(command.expectedVersion).toBe(0);
      expect(command.reasonCode).toBe("report-not-required");
      closed = true;
      return route.fulfill({ json: { ...item(), assignmentHistory: [], progressHistory: [],
        overdueHistory: [{ action: "detected", itemVersion: 0, recordedAt: "2026-10-02T08:00:00Z" },
          { action: "closed-exceptionally", reasonCode: "report-not-required", actorId: "reviewer",
            itemVersion: 1, recordedAt: "2026-10-02T08:10:00Z" }] } });
    }
    if (url.pathname === `/api/review/items/${itemId}`) return route.fulfill({ json: {
      ...item(), assignmentHistory: [], progressHistory: [], overdueHistory: [
        { action: "detected", itemVersion: 0, recordedAt: "2026-10-02T08:00:00Z" },
        ...(closed ? [{ action: "closed-exceptionally", reasonCode: "report-not-required", actorId: "reviewer",
          itemVersion: 1, recordedAt: "2026-10-02T08:10:00Z" }] : [])] } });
    if (url.pathname === `/api/review/items/${itemId}/draft`) return route.fulfill({ json: {
      id: reportId, itemId, createdAt: "2026-10-01T08:00:00Z", deadlineAt: item().deadlineAt,
      deadlineSource: "report-created", identifying: false, groups: [], values: [], notes: [] } });
    if (url.pathname === `/api/review/reports/${reportId}`) {
      signedReads++;
      return route.fulfill({ status: 404 });
    }
    if (url.pathname === "/api/review/backlog") return route.fulfill({ json: { work: [] } });
    if (url.pathname === "/api/review/outcomes") return route.fulfill({ json: [] });
    if (url.pathname === "/api/review/overdue-policy") return route.fulfill({ json: { deadlineHours: 24, version: 0 } });
    return route.fulfill({ status: 404 });
  });
  await page.goto("/");
  const call = await openReviewCall(page, page.getByRole("button", { name: `View Report ID · ${reportId.slice(0, 8).toUpperCase()}` }));
  await expect(call.getByRole("heading", { name: /Read-only overdue draft/ })).toBeVisible();
  await call.getByRole("combobox", { name: "Action", exact: true }).selectOption("exception");
  await expect(call.getByRole("button", { name: "Close unsigned follow-up exceptionally" })).toBeDisabled();
  await call.getByRole("combobox", { name: /^Exception reason/ }).selectOption("report-not-required");
  await call.getByRole("button", { name: "Close unsigned follow-up exceptionally" }).click();
  await expect(call.getByText("Action saved.", { exact: true })).toBeVisible();
  await call.getByRole("tab", { name: "History", exact: true }).click();
  await expect(call.getByText("Closed exceptionally while unsigned").first()).toBeVisible();
  await expect(call.getByText("Report not required").first()).toBeVisible();
  await expect(call.getByRole("heading", { name: /Read-only overdue draft/ })).toBeVisible();
  expect(signedReads).toBe(0);
});
