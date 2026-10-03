import { refreshOnFocus } from "./helpers/review-window";
import { expect, test } from "@playwright/test";
import settings from "@open-triage/contracts/config/installation.production.json";

test("Review badges update automatically and administration attention remains scoped", async ({ page }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires server-backed mock API configuration.");
  const self = "123e4567-e89b-42d3-a456-426614174151";
  const other = "123e4567-e89b-42d3-a456-426614174152";
  const reportId = "123e4567-e89b-42d3-a456-426614174153";
  const itemId = "123e4567-e89b-42d3-a456-426614174154";
  const criterionId = "123e4567-e89b-42d3-a456-426614174155";
  const sessionFor = (capabilities: string[]) => ({ csrfToken: "attention-csrf",
    user: { id: self, displayName: "Reviewer" }, organization: { id: "agency", name: "Example EMS" },
    startedAt: "2026-10-02T08:00:00Z", expiresAt: "2099-10-02T20:00:00Z",
    capabilities, workspaceAvailable: true });
  let session = sessionFor(["review:all", "review:admin", "review:identifying"]);
  let responded = false;
  let state = { status: "new", assigneeId: self as string | null, reopened: true,
    authorId: self, recoveryReason: null as string | null };
  const visible = () => session.capabilities.includes("review:all") || state.authorId === self;
  const counts = () => {
    const assignments = visible() && state.assigneeId === self && state.status === "new" ? 1 : 0;
    const responses = visible() && !responded && session.capabilities.includes("review:identifying") &&
      state.authorId === self && state.status === "awaiting-clinician" ? 1 : 0;
    const reopened = visible() && state.assigneeId === self && state.reopened && state.status !== "completed" ? 1 : 0;
    return { dataset: "real", asOf: new Date().toISOString(),
      total: assignments || responses || reopened ? 1 : 0, assignments, responses, reopened,
      ...(session.capabilities.includes("review:admin") ? { unavailableAssignees: state.recoveryReason ? 1 : 0,
        unavailableRoutes: 1, processingFailures: 1 } : {}) };
  };
  const item = () => ({ id: itemId, reportId, criterionId, priority: "high", ...state,
    kind: "criterion", version: 1, activeMatch: true, clearancePending: false, closureReason: null,
    firstMatchedAt: "2026-10-01T08:00:00Z", reportingDate: "2026-10-02",
    signedAt: "2026-10-02T07:00:00Z", findings: [], outcome: null });
  await page.addInitScript((stored) => {
    if (!localStorage.getItem("open-triage.clinician-session.v1"))
      localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored));
  }, session);
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/installation") return route.fulfill({ json: { settings } });
    if (url.pathname === "/api/sessions/current") return route.fulfill({ json: session });
    if (url.pathname === "/api/review/attention") return route.fulfill({ json: counts() });
    if (url.pathname === "/api/review/queue") {
      const kind = url.searchParams.get("attention");
      const matching = visible() && (!kind || (kind === "assignments" && counts().assignments) ||
        (kind === "responses" && counts().responses) || (kind === "reopened" && counts().reopened) ||
        (kind === "unavailable-assignees" && state.recoveryReason));
      return route.fulfill({ json: { dataset: "real", page: 1, pageSize: 25,
        assignmentCounts: { all: visible() ? 1 : 0, mine: visible() && state.assigneeId === self ? 1 : 0, unassigned: visible() && !state.assigneeId ? 1 : 0 },
        total: matching ? 1 : 0, asOf: new Date().toISOString(), items: matching ? [item()] : [] } });
    }
    if (url.pathname === "/api/review/routes") return route.fulfill({ json: [] });
    if (url.pathname === "/api/review/eligible-reviewers") return route.fulfill({ json: [] });
    if (url.pathname === "/api/review/backlog") return route.fulfill({ json: { dataset: "real",
      asOf: new Date().toISOString(), work: [{ id: itemId, reportId, state: "failed", attempts: 2,
        lastError: "Evaluation failed", createdAt: new Date().toISOString() }] } });
    return route.fulfill({ status: 404 });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Review (1)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "All reviews 1", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Assigned to me 1", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /New assignments:|Clinician responses requested:|Reopened reviews:/ })).toHaveCount(0);
  state = { ...state, status: "awaiting-clinician" };
  await page.reload();
  await expect(page.getByRole("button", { name: "Review (1)", exact: true })).toBeVisible();
  state = { ...state, status: "awaiting-clinician", assigneeId: other };
  await refreshOnFocus(page);
  await expect(page.getByRole("button", { name: "Review (1)", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Assigned to me 0", exact: true })).toBeVisible();
  responded = true;
  state = { ...state, status: "completed", reopened: false, assigneeId: null, recoveryReason: null };
  await refreshOnFocus(page);
  await expect(page.getByRole("button", { name: "Review", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unassigned 1", exact: true })).toBeVisible();

  state = { ...state, status: "new", authorId: other, recoveryReason: "assignee-ineligible" };
  await refreshOnFocus(page);
  await expect(page.getByRole("button", { name: "Unavailable assignees: 1" })).toBeVisible();
  await page.getByRole("button", { name: "Unavailable assignees: 1" }).click();
  await expect(page.getByText("Showing work returned to the unassigned queue.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Routing needs attention: 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Processing failures: 1" })).toBeVisible();

  session = sessionFor(["review:self"]);
  await page.evaluate((stored) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await page.reload();
  await expect(page.getByRole("button", { name: "Review", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unavailable assignees: 1" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Processing failures: 1" })).toHaveCount(0);
  await expect(page.getByText("1 review items")).toHaveCount(0);
});
