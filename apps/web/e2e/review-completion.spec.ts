import { openReviewCall } from "./helpers/review-window";
import { expect, test } from "@playwright/test";
import settings from "@open-triage/contracts/config/installation.production.json";

for (const width of [390, 1440]) test(`reviewer completes and administrator reopens by assigning at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires server-backed mock API configuration.");
  const itemId = "123e4567-e89b-42d3-a456-426614174111";
  const reportId = "123e4567-e89b-42d3-a456-426614174112";
  const optionId = "123e4567-e89b-42d3-a456-426614174113";
  const reviewerId = "123e4567-e89b-42d3-a456-426614174115";
  const session = { csrfToken: "csrf", user: { id: reviewerId, displayName: "Reviewer" },
    organization: { id: "organization", name: "Example EMS" }, startedAt: "2026-10-02T08:00:00Z",
    expiresAt: "2099-10-02T20:00:00Z", capabilities: ["review:all", "review:admin", "review:identifying"], workspaceAvailable: true };
  let version = 1;
  let status = "new";
  let reopened = false;
  const comments: Array<{ id: string; actorName: string; body: string; recordedAt: string }> = [];
  let outcome: { optionId: string; revision: number; label: string; meaning: string } | null = null;
  const progressHistory: Array<{ commandId: string; actorId: string; itemVersion: number;
    status: string; outcome: { optionId: string; revision: number; label: string; meaning: string } | null;
    recordedAt: string; reason?: string }> = [];
  const item = () => ({ id: itemId, reportId, criterionId: "123e4567-e89b-42d3-a456-426614174114",
    priority: "high", status, outcome, assigneeId: reviewerId, version, reopened, comments, canComment: true,
    firstMatchedAt: "2026-10-01T08:00:00Z", reportingDate: "2026-10-02",
    signedAt: "2026-10-02T07:00:00Z", findings: [] });
  await page.addInitScript((stored) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await page.context().route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/installation") return route.fulfill({ json: { settings } });
    if (url.pathname === "/api/sessions/current") return route.fulfill({ json: session });
    if (url.pathname === "/api/review/queue") return route.fulfill({ json: { dataset: "real", page: 1,
      pageSize: 25, total: 1, asOf: new Date().toISOString(), items: [item()] } });
    if (url.pathname === "/api/review/eligible-reviewers") return route.fulfill({ json: [{ id: reviewerId, displayName: "Reviewer", documentingClinician: true }] });
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
      progressHistory.push({ commandId: command.commandId, actorId: reviewerId,
        itemVersion: version, status, outcome, recordedAt: new Date().toISOString() });
      return route.fulfill({ json: { ...item(), assignmentHistory: [], progressHistory } });
    }
    if (url.pathname === `/api/review/items/${itemId}/comments`) {
      const command = route.request().postDataJSON(); expect(command.expectedVersion).toBe(version);
      if (["new", "awaiting-clinician"].includes(status)) {
        status = "in-review";
        progressHistory.push({ commandId: command.commandId, actorId: reviewerId,
          itemVersion: version + 1, status, outcome, recordedAt: new Date().toISOString() });
      }
      version++; comments.push({ id: command.commandId, actorName: "Reviewer", body: command.body, recordedAt: new Date().toISOString() });
      return route.fulfill({ json: { ...item(), assignmentHistory: [], progressHistory } });
    }
    if (url.pathname === `/api/review/items/${itemId}/assign`) {
      expect(route.request().headers()["x-csrf-token"]).toBe("csrf");
      const command = route.request().postDataJSON();
      expect(command.expectedVersion).toBe(version); expect(command.assigneeId).toBe(reviewerId);
      status = "in-review"; outcome = null; reopened = true; version++;
      progressHistory.push({ commandId: command.commandId, actorId: reviewerId, itemVersion: version,
        status, outcome, reason: "reopened-by-assignment", recordedAt: new Date().toISOString() });
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
  await expect(call.getByRole("combobox", { name: "Action", exact: true }).locator("option[value=start]")).toHaveCount(0);
  await expect(call.getByRole("combobox", { name: "Action", exact: true }).locator("option[value=complete]")).toHaveCount(1);
  const kind = width === 390 ? "comment" : "finding";
  await call.getByRole("combobox", { name: "Action", exact: true }).selectOption(kind);
  await call.getByRole("textbox", { name: kind === "comment" ? "Comment" : "Document findings", exact: true }).fill("Reviewing the timeline.");
  await call.getByRole("button", { name: kind === "comment" ? "Send comment" : "Save findings", exact: true }).click();
  await expect(call.locator(".review-report-items .status-in-review")).toHaveText("In review");
  await call.getByRole("combobox", { name: "Action", exact: true }).selectOption("await");
  await call.getByRole("button", { name: "Await clinician" }).click();
  await call.getByRole("combobox", { name: "Action", exact: true }).selectOption("resume");
  await call.getByRole("button", { name: "Resume review" }).click();
  await call.getByRole("combobox", { name: "Action", exact: true }).selectOption("complete");
  await call.getByRole("combobox", { name: "Outcome" }).last().selectOption(optionId);
  await call.getByRole("button", { name: "Complete item" }).click();
  await expect(call.locator(".review-report-items .status-completed")).toHaveText("Completed");
  await expect(call.getByRole("region", { name: "Review items on this report" }).getByText("Follow-up: Clinician follow-up")).toBeVisible();
  const actions = call.getByRole("tabpanel", { name: "Actions", exact: true });
  await expect(actions.getByRole("form", { name: "Review action", exact: true })).toBeVisible();
  await expect(actions.getByRole("heading")).toHaveCount(0);
  await expect(actions.getByRole("list")).toHaveCount(0);
  await expect(actions.getByText(/Assignee:|Status:|Outcome:|Criterion ID:/)).toHaveCount(0);
  await expect(actions.getByRole("combobox", { name: "Assign reviewer", exact: true })).toHaveCount(0);
  const action = call.getByRole("combobox", { name: "Action", exact: true });
  await action.selectOption("assign");
  await expect(actions.getByText("Assigning a reviewer reopens this item. The previous outcome remains in History.")).toBeVisible();
  const submit = actions.getByRole("button", { name: "Reopen and assign", exact: true });
  await expect(submit).toBeDisabled();
  await actions.getByRole("combobox", { name: "Reviewer", exact: true }).selectOption({ label: "Documenting clinician · Reviewer" });
  await actions.getByRole("textbox", { name: "Comment", exact: true }).fill("Please review the final outcome again.");
  await call.getByRole("tab", { name: "History", exact: true }).click();
  await call.getByRole("tab", { name: "Actions", exact: true }).click();
  await expect(action).toHaveValue("assign");
  await actions.screenshot({ path: test.info().outputPath("reopen-action.png") });
  await submit.click();
  await expect(call.locator(".review-report-items .status-in-review")).toHaveText("In review · Returned for re-review");
  await expect(action).toHaveValue("comment");
  expect(reopened).toBe(true); expect(comments).toHaveLength(2);
  await call.getByRole("tab", { name: "History", exact: true }).click();
  const history = call.getByRole("tabpanel", { name: "History", exact: true });
  await expect(history.getByText("Please review the final outcome again.", { exact: true })).toBeVisible();
  await expect(history.getByText("Follow-up: Clinician follow-up", { exact: false })).toBeVisible();
  await expect(history.getByText("Reopened by reviewer assignment", { exact: false })).toBeVisible();
  expect(progressHistory.map((entry) => entry.status)).toEqual([
    "in-review", "awaiting-clinician", "in-review", "completed", "in-review"]);
});
