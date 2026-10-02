import { expect, test } from "@playwright/test";
import settings from "@open-triage/contracts/config/installation.production.json";

test("reviewer inspects an overdue draft and administrator changes its deadline", async ({ page }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires server-backed mock API configuration.");
  const itemId = "123e4567-e89b-42d3-a456-426614174211";
  const reportId = "123e4567-e89b-42d3-a456-426614174212";
  const session = { csrfToken: "csrf", user: { id: "reviewer", displayName: "Reviewer" },
    organization: { id: "organization", name: "Example EMS" }, startedAt: "2026-10-02T08:00:00Z",
    expiresAt: "2099-10-02T20:00:00Z", capabilities: ["review:all", "review:admin"], workspaceAvailable: true };
  let deadlineHours = 24;
  let version = 0;
  let draftReads = 0;
  const item = { id: itemId, reportId, criterionId: "01200000-0000-4000-8000-000000000001",
    kind: "overdue-unsigned", priority: "medium", status: "new", outcome: null,
    assigneeId: null, version: 0, firstMatchedAt: "2026-10-02T08:00:00Z",
    reportingDate: null, signedAt: null, deadlineAt: "2026-10-02T08:00:00Z",
    deadlineSource: "call-completed", resolutionReason: null, findings: [] };
  await page.addInitScript((stored) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/installation") return route.fulfill({ json: { settings } });
    if (url.pathname === "/api/sessions/current") return route.fulfill({ json: session });
    if (url.pathname === "/api/review/reports") return route.fulfill({ json: { dataset: "real", scope: "all",
      identifying: false, administrator: true, page: 1, pageSize: 25, total: 0,
      asOf: new Date().toISOString(), reports: [] } });
    if (url.pathname === "/api/review/queue") return route.fulfill({ json: { dataset: "real", page: 1,
      pageSize: 25, total: 1, asOf: new Date().toISOString(), items: [item] } });
    if (url.pathname === "/api/review/overdue-policy") {
      if (route.request().method() === "POST") {
        expect(route.request().headers()["x-csrf-token"]).toBe("csrf");
        const command = route.request().postDataJSON() as { deadlineHours: number; expectedVersion: number };
        expect(command.expectedVersion).toBe(version);
        deadlineHours = command.deadlineHours; version++;
      }
      return route.fulfill({ json: { deadlineHours, version } });
    }
    if (url.pathname === `/api/review/items/${itemId}`) return route.fulfill({ json: {
      ...item, assignmentHistory: [], progressHistory: [], overdueHistory: [{ action: "detected",
        itemVersion: 0, recordedAt: "2026-10-02T08:00:00Z" }] } });
    if (url.pathname === `/api/review/items/${itemId}/draft`) {
      draftReads++;
      return route.fulfill({ json: { id: reportId, itemId, createdAt: "2026-10-01T07:00:00Z",
        deadlineAt: item.deadlineAt, deadlineSource: "call-completed", identifying: false,
        groups: [], values: [{ id: "value-1", elementId: "eSituation.09", label: "Primary Symptom",
          groupInstanceId: null, ordinal: 0, valueKind: "coded", value: "pain",
          codeDisplay: "Pain" }], notes: [] } });
    }
    if (url.pathname === `/api/review/reports/${reportId}`)
      throw new Error("Unsigned draft must never use the signed report endpoint");
    if (url.pathname === "/api/review/backlog") return route.fulfill({ json: { work: [] } });
    if (url.pathname === "/api/review/outcomes") return route.fulfill({ json: [] });
    return route.fulfill({ status: 404 });
  });
  await page.goto("/");
  await page.getByRole("button", { name: reportId }).click();
  await expect(page.getByRole("heading", { name: /Read-only overdue draft/ })).toBeVisible();
  await expect(page.getByText("Primary Symptom", { exact: true })).toBeVisible();
  await expect(page.getByText("Pain", { exact: true })).toBeVisible();
  expect(draftReads).toBeGreaterThan(0);
  await page.getByLabel("Hours after call completion").fill("48");
  await page.getByRole("button", { name: "Save deadline" }).click();
  await expect(page.getByLabel("Hours after call completion")).toHaveValue("48");
  expect(deadlineHours).toBe(48);
});

test("signing resolution remains visible in Review history", async ({ page }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires server-backed mock API configuration.");
  const itemId = "123e4567-e89b-42d3-a456-426614174221";
  const reportId = "123e4567-e89b-42d3-a456-426614174222";
  const session = { csrfToken: "csrf", user: { id: "reviewer", displayName: "Reviewer" },
    organization: { id: "organization", name: "Example EMS" }, startedAt: "2026-10-02T08:00:00Z",
    expiresAt: "2099-10-02T20:00:00Z", capabilities: ["review:all"], workspaceAvailable: true };
  let signedReads = 0;
  const item = { id: itemId, reportId, criterionId: "01200000-0000-4000-8000-000000000001",
    kind: "overdue-unsigned", priority: "medium", status: "completed", outcome: null,
    assigneeId: "reviewer", version: 2, firstMatchedAt: "2026-10-02T08:00:00Z",
    reportingDate: "2026-10-02", signedAt: "2026-10-02T09:00:00Z", findings: [],
    resolutionReason: "resolved-by-signing" };
  await page.addInitScript((stored) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/installation") return route.fulfill({ json: { settings } });
    if (url.pathname === "/api/sessions/current") return route.fulfill({ json: session });
    if (url.pathname === "/api/review/reports") return route.fulfill({ json: { dataset: "real", scope: "all",
      identifying: false, administrator: false, page: 1, pageSize: 25, total: 0,
      asOf: new Date().toISOString(), reports: [] } });
    if (url.pathname === "/api/review/queue") return route.fulfill({ json: { dataset: "real", page: 1,
      pageSize: 25, total: 1, asOf: new Date().toISOString(), items: [item] } });
    if (url.pathname === `/api/review/items/${itemId}`) return route.fulfill({ json: {
      ...item, assignmentHistory: [], progressHistory: [], overdueHistory: [
        { action: "detected", itemVersion: 0, recordedAt: "2026-10-02T08:00:00Z" },
        { action: "resolved-by-signing", itemVersion: 2, recordedAt: "2026-10-02T09:00:00Z" }] } });
    if (url.pathname === `/api/review/reports/${reportId}`) {
      signedReads++;
      return route.fulfill({ json: { id: reportId, reportingDate: "2026-10-02",
        signedAt: "2026-10-02T09:00:00Z", amendmentSequence: 0, identifying: false,
        groups: [], values: [], notes: [], reviewItems: [{ id: itemId,
          criterionId: item.criterionId, status: "completed", outcome: null }] } });
    }
    if (url.pathname === `/api/review/items/${itemId}/draft`)
      throw new Error("Signed report must not use draft inspection");
    if (url.pathname === "/api/review/outcomes") return route.fulfill({ json: [] });
    return route.fulfill({ status: 404 });
  });
  await page.goto("/");
  await page.getByRole("button", { name: reportId }).click();
  await expect(page.getByText("Resolved by signing").first()).toBeVisible();
  expect(signedReads).toBeGreaterThan(0);
});
