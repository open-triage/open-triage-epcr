import { openReviewCall } from "./helpers/review-window";
import { expect, test } from "@playwright/test";
import settings from "@open-triage/contracts/config/installation.production.json";

test("reviewer progresses one item and completes with an agency outcome", async ({ page }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires server-backed mock API configuration.");
  const itemId = "123e4567-e89b-42d3-a456-426614174111";
  const reportId = "123e4567-e89b-42d3-a456-426614174112";
  const optionId = "123e4567-e89b-42d3-a456-426614174113";
  const session = { csrfToken: "csrf", user: { id: "reviewer", displayName: "Reviewer" },
    organization: { id: "organization", name: "Example EMS" }, startedAt: "2026-10-02T08:00:00Z",
    expiresAt: "2099-10-02T20:00:00Z", capabilities: ["review:all", "review:admin"], workspaceAvailable: true };
  let version = 1;
  let status = "new";
  let outcome: { optionId: string; revision: number; label: string; meaning: string } | null = null;
  const progressHistory: Array<{ commandId: string; actorId: string; itemVersion: number;
    status: string; outcome: { optionId: string; revision: number; label: string; meaning: string } | null;
    recordedAt: string }> = [];
  const item = () => ({ id: itemId, reportId, criterionId: "123e4567-e89b-42d3-a456-426614174114",
    priority: "high", status, outcome, assigneeId: "reviewer", version,
    firstMatchedAt: "2026-10-01T08:00:00Z", reportingDate: "2026-10-02",
    signedAt: "2026-10-02T07:00:00Z", findings: [] });
  await page.addInitScript((stored) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await page.context().route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/installation") return route.fulfill({ json: { settings } });
    if (url.pathname === "/api/sessions/current") return route.fulfill({ json: session });
    if (url.pathname === "/api/review/queue") return route.fulfill({ json: { dataset: "real", page: 1,
      pageSize: 25, total: 1, asOf: new Date().toISOString(), items: [item()] } });
    if (url.pathname === "/api/review/backlog") return route.fulfill({ json: { work: [] } });
    if (url.pathname === "/api/review/outcomes") return route.fulfill({ json: [{ id: optionId,
      revision: 1, label: "Follow-up", meaning: "Clinician follow-up", active: true }] });
    if (url.pathname === `/api/review/items/${itemId}`) return route.fulfill({ json: {
      ...item(), assignmentHistory: [], progressHistory } });
    if (url.pathname === `/api/review/items/${itemId}/progress`) {
      expect(route.request().headers()["x-csrf-token"]).toBe("csrf");
      const command = route.request().postDataJSON() as { commandId: string; expectedVersion: number;
        status: string; outcomeOptionId?: string };
      expect(command.expectedVersion).toBe(version);
      if (command.status === "completed") expect(command.outcomeOptionId).toBe(optionId);
      version++; status = command.status;
      outcome = status === "completed" ? { optionId, revision: 1, label: "Follow-up",
        meaning: "Clinician follow-up" } : null;
      progressHistory.push({ commandId: command.commandId, actorId: "reviewer",
        itemVersion: version, status, outcome, recordedAt: new Date().toISOString() });
      return route.fulfill({ json: { ...item(), assignmentHistory: [], progressHistory } });
    }
    if (url.pathname === `/api/review/reports/${reportId}`) return route.fulfill({ json: { id: reportId,
      reportingDate: "2026-10-02", signedAt: "2026-10-02T07:00:00Z", amendmentSequence: 0,
      identifying: false, groups: [], values: [], notes: [],
      reviewItems: [{ id: itemId, criterionId: item().criterionId, status, outcome }] } });
    return route.fulfill({ status: 404 });
  });
  await page.goto("/");
  const call = await openReviewCall(page, page.getByRole("button", { name: `View Report ID · ${reportId.slice(0, 8).toUpperCase()}` }).first());
  await call.getByRole("button", { name: "Start review" }).click();
  await expect(call.getByText("Status: In review", { exact: true })).toBeVisible();
  await call.getByRole("button", { name: "Await clinician" }).click();
  await call.getByRole("button", { name: "Resume review" }).click();
  await call.getByRole("combobox", { name: "Outcome" }).last().selectOption(optionId);
  await call.getByRole("button", { name: "Complete item" }).click();
  await expect(call.getByText("Status: Completed", { exact: true })).toBeVisible();
  await expect(call.getByText("Follow-up — Clinician follow-up").last()).toBeVisible();
  expect(progressHistory.map((entry) => entry.status)).toEqual([
    "in-review", "awaiting-clinician", "in-review", "completed"]);
});
