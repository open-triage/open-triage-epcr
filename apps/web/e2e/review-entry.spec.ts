import { expect, test } from "@playwright/test";
import settings from "@open-triage/contracts/config/installation.production.json";

test("Review administrator configures routing and reassigns an item without validation authoring", async ({ page }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires the server-backed mock API configuration.");
  const itemId = "123e4567-e89b-42d3-a456-426614174131";
  const secondItemId = "123e4567-e89b-42d3-a456-426614174135";
  const reportId = "123e4567-e89b-42d3-a456-426614174132";
  const criterionId = "123e4567-e89b-42d3-a456-426614174133";
  const reviewerId = "123e4567-e89b-42d3-a456-426614174134";
  const session = { csrfToken: "review-admin-csrf", user: { id: "administrator", displayName: "Administrator" },
    organization: { id: "organization", name: "Example EMS" }, startedAt: "2026-10-02T08:00:00Z",
    expiresAt: "2099-10-02T20:00:00Z", capabilities: ["review:all", "review:admin"], workspaceAvailable: true };
  let route = { criterionId, name: "Narrative check", route: "unassigned", namedUserId: null as string | null,
    independentReview: false, version: 0, recoveryReason: null };
  let amendmentPolicy = { clearance: "confirm", version: 0 };
  let assigneeId: string | null = null;
  let version = 0;
  let history: Array<{ commandId: string; actorId: string; assigneeId: string | null;
    itemVersion: number; assignedAt: string; action: string }> = [];
  let queueReads = 0;
  let attentionReads = 0;
  const item = () => ({ id: itemId, reportId, criterionId, priority: "high", status: "new", assigneeId,
    version, firstMatchedAt: "2026-10-01T08:00:00Z", reportingDate: "2026-10-02",
    signedAt: "2026-10-02T07:00:00Z", findings: [] });
  const secondItem = () => ({ ...item(), id: secondItemId, version: 0, assigneeId: null });
  await page.addInitScript((stored) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await page.route("**/api/**", (request) => {
    const url = new URL(request.request().url());
    const path = url.pathname;
    if (path === "/api/installation") return request.fulfill({ json: { settings } });
    if (path === "/api/sessions/current") return request.fulfill({ json: session });
    if (path === "/api/review/routes" && request.request().method() === "GET")
      return request.fulfill({ json: [route] });
    if (path === "/api/review/amendment-policy" && request.request().method() === "GET")
      return request.fulfill({ json: amendmentPolicy });
    if (path === "/api/review/amendment-policy" && request.request().method() === "POST") {
      const body = request.request().postDataJSON() as { expectedVersion: number; clearance: "confirm" | "automatic" };
      expect(body.expectedVersion).toBe(amendmentPolicy.version);
      amendmentPolicy = { clearance: body.clearance, version: amendmentPolicy.version + 1 };
      return request.fulfill({ json: amendmentPolicy });
    }
    if (path === `/api/review/routes/${criterionId}`) {
      expect(request.request().headers()["x-csrf-token"]).toBe("review-admin-csrf");
      const body = request.request().postDataJSON() as { route: typeof route.route; namedUserId: string | null;
        independentReview: boolean; expectedVersion: number };
      expect(body.expectedVersion).toBe(route.version);
      route = { ...route, route: body.route, namedUserId: body.namedUserId,
        independentReview: body.independentReview, version: route.version + 1 };
      return request.fulfill({ json: route });
    }
    if (path === "/api/review/eligible-reviewers")
      return request.fulfill({ json: [{ id: reviewerId, displayName: "Morgan Reviewer" }] });
    if (path === "/api/review/queue") {
      queueReads++;
      return request.fulfill({ json: { dataset: "real", page: 1,
        pageSize: 25, total: 2, asOf: new Date().toISOString(), items: [item(), secondItem()] } });
    }
    if (path === "/api/review/attention") {
      attentionReads++;
      return request.fulfill({ json: { dataset: "real", asOf: new Date().toISOString(),
        assignments: 0, responses: 0, reopened: 0, unavailableAssignees: 0,
        unavailableRoutes: 0, processingFailures: 0 } });
    }
    if (path === "/api/review/items/bulk-assign") {
      expect(request.request().headers()["x-csrf-token"]).toBe("review-admin-csrf");
      const body = request.request().postDataJSON() as { assigneeId: string;
        selections: Array<{ itemId: string; expectedVersion: number; commandId: string }> };
      expect(body.assigneeId).toBe(reviewerId);
      expect(body.selections.map(({ itemId, expectedVersion }) => [itemId, expectedVersion]))
        .toEqual([[itemId, 1], [secondItemId, 0]]);
      expect(body.selections.every(({ commandId }) => !!commandId)).toBe(true);
      return request.fulfill({ json: { results: [
        { itemId, status: "failed", reason: "conflict" },
        { itemId: secondItemId, status: "succeeded", item: { ...secondItem(), assigneeId: reviewerId, version: 1 } },
      ] } });
    }
    if (path === `/api/review/items/${itemId}`) return request.fulfill({ json: { ...item(), assignmentHistory: history } });
    if (path === `/api/review/items/${itemId}/assign`) {
      const body = request.request().postDataJSON() as { commandId: string; assigneeId: string | null;
        expectedVersion: number };
      expect(body.expectedVersion).toBe(version);
      assigneeId = body.assigneeId; version++;
      history = [...history, { commandId: body.commandId, actorId: "administrator", assigneeId,
        itemVersion: version, assignedAt: "2026-10-02T08:00:00Z", action: "assigned" }];
      return request.fulfill({ json: { ...item(), assignmentHistory: history } });
    }
    if (path === "/api/review/reports") return request.fulfill({ json: { dataset: "real", scope: "all",
      identifying: false, administrator: true, page: 1, pageSize: 25, total: 0,
      asOf: new Date().toISOString(), reports: [] } });
    if (path === `/api/review/reports/${reportId}`) return request.fulfill({ json: { id: reportId,
      reportingDate: "2026-10-02", signedAt: "2026-10-02T07:00:00Z", amendmentSequence: 0,
      identifying: false, groups: [], values: [], notes: [] } });
    if (path === "/api/review/backlog") return request.fulfill({ json: { work: [] } });
    if (path === "/api/review/volume") return request.fulfill({ json: { definition: { measure: "signed-report-count",
      grouping: "day", filters: { from: "2026-10-01", to: "2026-10-02", dataset: "real" } },
      population: { unit: "patient-report", scope: "all", organizationId: "organization", signedOnly: true },
      freshness: { observedAt: new Date().toISOString(), targetSeconds: 300, status: "current",
        oldestBacklogSeconds: null, replicaLagSeconds: null }, total: 0, points: [] } });
    return request.fulfill({ status: 404 });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Criterion routing" })).toBeVisible();
  await page.getByLabel("When a criterion clears").selectOption("automatic");
  await page.getByRole("button", { name: "Save clearance policy" }).click();
  await expect(page.getByText("Clearance policy saved.")).toBeVisible();
  expect(amendmentPolicy.clearance).toBe("automatic");
  await page.getByLabel("Route to").selectOption("named");
  await page.getByRole("combobox", { name: "Reviewer" }).selectOption(reviewerId);
  await page.getByRole("button", { name: "Save route" }).click();
  await expect(page.getByText("Routing saved.")).toBeVisible();
  expect(route.route).toBe("named");
  expect(route.namedUserId).toBe(reviewerId);
  await page.getByLabel("Require independent review").check();
  await expect(page.getByText("Reports documented by this reviewer will remain unassigned for another reviewer.")).toBeVisible();
  await page.getByRole("button", { name: "Save route" }).click();
  expect(route.independentReview).toBe(true);
  await page.getByLabel("Route to").selectOption("author");
  await expect(page.getByText("Choose an unassigned queue or a named reviewer.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save route" })).toBeDisabled();
  await page.getByLabel("Route to").selectOption("named");
  await page.getByRole("combobox", { name: "Reviewer" }).selectOption(reviewerId);
  await page.getByRole("button", { name: reportId }).first().click();
  await page.getByLabel("Assign reviewer").selectOption(reviewerId);
  const readsBeforeAssignment = { queue: queueReads, attention: attentionReads };
  await page.getByRole("button", { name: "Save assignment" }).click();
  await expect(page.getByRole("cell", { name: reviewerId })).toBeVisible();
  await expect.poll(() => queueReads).toBeGreaterThan(readsBeforeAssignment.queue);
  await expect.poll(() => attentionReads).toBeGreaterThan(readsBeforeAssignment.attention);
  await expect(page.getByRole("heading", { name: "Assignment history" })).toBeVisible();
  await page.getByRole("button", { name: "Select this page" }).click();
  await page.getByRole("combobox", { name: "Assign to" }).selectOption(reviewerId);
  await page.getByRole("button", { name: "Assign selected" }).click();
  await expect(page.getByText("1 succeeded; 1 could not be changed.")).toBeVisible();
  await expect(page.getByText("Changed since selection; refresh and select again")).toBeVisible();
});

test("Review claim persists in the queue and item history, with recoverable stale state", async ({ page }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires the server-backed mock API configuration.");
  const itemId = "123e4567-e89b-42d3-a456-426614174111";
  const reportId = "123e4567-e89b-42d3-a456-426614174112";
  const session = { csrfToken: "review-csrf", user: { id: "reviewer", displayName: "Reviewer" },
    organization: { id: "organization", name: "Example EMS" }, startedAt: "2026-10-02T08:00:00Z",
    expiresAt: "2099-10-02T20:00:00Z", capabilities: ["review:all"], workspaceAvailable: true };
  let version = 0;
  let assigneeId: string | null = null;
  let attentionReads = 0;
  let history: Array<{ commandId: string; actorId: string; assigneeId: string; itemVersion: number; assignedAt: string }> = [];
  let stale = true;
  const item = () => ({ id: itemId, reportId, criterionId: "123e4567-e89b-42d3-a456-426614174113",
    priority: "high", status: "new", assigneeId, version, firstMatchedAt: "2026-10-01T08:00:00Z",
    reportingDate: "2026-10-02", signedAt: "2026-10-02T07:00:00Z", findings: [],
    reopened: version > 0, clearancePending: false });
  await page.addInitScript((stored) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/installation") return route.fulfill({ json: { settings } });
    if (url.pathname === "/api/sessions/current") return route.fulfill({ json: session });
    if (url.pathname === "/api/review/attention") {
      attentionReads++;
      return route.fulfill({ json: { dataset: "real", asOf: new Date().toISOString(),
        assignments: assigneeId === "reviewer" ? 1 : 0, responses: 0, reopened: 0 } });
    }
    if (url.pathname === "/api/review/reports") return route.fulfill({ json: { dataset: "real", scope: "all",
      identifying: false, administrator: false, page: 1, pageSize: 25, total: 0, asOf: new Date().toISOString(), reports: [] } });
    if (url.pathname === "/api/review/queue") return route.fulfill({ json: { dataset: "real", page: 1,
      pageSize: 25, total: 1, asOf: new Date().toISOString(), items: [item()] } });
    if (url.pathname === `/api/review/items/${itemId}`) return route.fulfill({ json: {
      ...item(), assignmentHistory: history,
      amendmentHistory: version > 0 ? [{ evaluationId: "evaluation-1", amendmentSequence: 1,
        validationVersionId: "rule-version-1", action: "reopened", findings: [],
        changes: [{ elementId: "eVitals.06", groupInstanceId: "vitals-1", change: "changed" }] }] : [],
    } });
    if (url.pathname === `/api/review/items/${itemId}/claim`) {
      expect(route.request().headers()["x-csrf-token"]).toBe("review-csrf");
      const command = route.request().postDataJSON() as { commandId: string; expectedVersion: number };
      if (stale) { stale = false; return route.fulfill({ status: 409, json: { message: "Changed" } }); }
      expect(command.expectedVersion).toBe(0);
      version = 1; assigneeId = "reviewer";
      history = [{ commandId: command.commandId, actorId: "reviewer", assigneeId: "reviewer",
        itemVersion: 1, assignedAt: "2026-10-02T08:00:00Z" }];
      return route.fulfill({ json: { ...item(), assignmentHistory: history } });
    }
    if (url.pathname === `/api/review/reports/${reportId}`) return route.fulfill({ json: { id: reportId,
      reportingDate: "2026-10-02", signedAt: "2026-10-02T07:00:00Z", amendmentSequence: 0,
      identifying: false, groups: [], values: [], notes: [] } });
    if (url.pathname === "/api/review/volume") return route.fulfill({ json: { definition: { measure: "signed-report-count", grouping: "day",
      filters: { from: "2026-10-01", to: "2026-10-02", dataset: "real" } },
      population: { unit: "patient-report", scope: "all", organizationId: "organization", signedOnly: true },
      freshness: { observedAt: new Date().toISOString(), targetSeconds: 300, status: "current",
        oldestBacklogSeconds: null, replicaLagSeconds: null }, total: 0, points: [] } });
    return route.fulfill({ status: 404 });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Claim", exact: true }).first().click();
  await expect(page.getByText("This item changed. Refresh and try again.")).toBeVisible();
  const readsBeforeClaim = attentionReads;
  await page.getByRole("button", { name: "Claim", exact: true }).first().click();
  await expect(page.getByRole("cell", { name: "Assigned to you" })).toBeVisible();
  await expect.poll(() => attentionReads).toBeGreaterThan(readsBeforeClaim);
  await expect(page.getByRole("button", { name: "New assignments: 1" })).toBeVisible();
  await page.getByRole("button", { name: reportId }).first().click();
  await expect(page.getByRole("heading", { name: "Assignment history" })).toBeVisible();
  await expect(page.getByText("Assigned to you").last()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Amendment evaluation history" })).toBeVisible();
  await expect(page.getByText("Returned for re-review after a relevant amendment").last()).toBeVisible();
  await expect(page.getByText("eVitals.06").last()).toBeVisible();
});

test("Review-only account enters its scoped signed-report list and keeps datasets separate", async ({ page, context }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires the server-backed mock API configuration.");
  const session = {
    csrfToken: "review-entry-test", user: { id: "reviewer-id", displayName: "Reviewer" },
    organization: { id: "organization-id", name: "Example EMS" },
    startedAt: "2026-10-02T08:00:00Z", expiresAt: "2099-10-02T20:00:00Z",
    capabilities: ["review:all"], workspaceAvailable: true,
  };
  const requestedDatasets: string[] = [];
  let staleVolume = false;
  const queueRequests: string[] = [];
  await page.addInitScript((stored) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/installation") return route.fulfill({ json: { settings } });
    if (url.pathname === "/api/sessions/current") return route.fulfill({ json: session });
    if (url.pathname === "/api/review/reports") {
      const dataset = url.searchParams.get("dataset")!;
      requestedDatasets.push(dataset);
      return route.fulfill({ json: {
        dataset, scope: "all", identifying: false, administrator: false,
        page: Number(url.searchParams.get("page")), pageSize: 25, total: 1,
        asOf: "2026-10-02T08:00:00Z",
        reports: [{ id: `${dataset}-report`, reportingDate: "2026-10-02", signedAt: "2026-10-02T07:00:00Z" }],
      } });
    }
    if (url.pathname === "/api/review/queue") {
      const dataset = url.searchParams.get("dataset")!;
      queueRequests.push(url.search);
      const items = dataset === "real" ? [{ id: "review-item", reportId: "real-report",
        criterionId: "123e4567-e89b-42d3-a456-426614174001", priority: "high", status: "new",
        assigneeId: null, firstMatchedAt: "2026-10-01T08:00:00Z", reportingDate: "2026-10-02",
        signedAt: "2026-10-02T07:00:00Z", findings: [{ message: "Review missing narrative",
          primaryTarget: { elementId: "eNarrative.01" } }] }] : [];
      return route.fulfill({ json: { dataset, page: 1, pageSize: 25, total: items.length,
        asOf: "2026-10-02T08:00:00Z", items } });
    }
    if (url.pathname === "/api/review/volume") {
      const dataset = url.searchParams.get("dataset")!;
      const from = url.searchParams.get("from")!;
      const to = url.searchParams.get("to")!;
      return route.fulfill({ json: {
        definition: { measure: "signed-report-count", grouping: "day", filters: { from, to, dataset } },
        population: { unit: "patient-report", scope: "all", organizationId: "organization-id", signedOnly: true },
        freshness: { observedAt: "2026-10-02T08:00:00Z", targetSeconds: 300,
          status: staleVolume ? "stale" : "current", oldestBacklogSeconds: staleVolume ? 301 : null,
          replicaLagSeconds: null },
        total: staleVolume ? null : dataset === "real" ? 2 : 1,
        points: staleVolume ? [] : [{ date: from, count: dataset === "real" ? 2 : 1 }, { date: to, count: 0 }],
      } });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Signed reports" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Admin" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mobile" })).toHaveCount(0);
  await expect(page.getByText("real-report").first()).toBeVisible();
  await expect(page.getByText("Review missing narrative")).toBeVisible();
  await expect(page.getByRole("cell", { name: "High" })).toBeVisible();
  await page.getByLabel("Priority").selectOption("high");
  await expect.poll(() => queueRequests.some((query) => query.includes("priority=high"))).toBe(true);
  await expect(page.getByRole("img", { name: /Daily signed patient report count trend/ })).toBeVisible();
  await expect(page.getByText("Signed patient reports in the selected period: 2", { exact: false })).toBeVisible();
  await page.getByLabel("Dataset").selectOption("synthetic");
  await expect(page.getByText("synthetic-report")).toBeVisible();
  await expect(page.getByText("No matching review items.")).toBeVisible();
  await expect(page.getByText("Signed patient reports in the selected period: 1", { exact: false })).toBeVisible();
  staleVolume = true;
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText("Report volume is withheld", { exact: false })).toBeVisible();
  await expect(page.getByRole("img", { name: /Daily signed patient report count trend/ })).toHaveCount(0);
  expect(requestedDatasets[0]).toBe("real");
  expect(requestedDatasets.at(-1)).toBe("synthetic");
  await page.reload();
  await expect(page.getByRole("button", { name: "Review" })).toHaveAttribute("aria-pressed", "true");
  await context.setOffline(true);
  await expect(page.getByText("Review requires a connection.", { exact: false })).toBeVisible();
});

test("Review opens effective grouped signed content without identifying text", async ({ page }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires the server-backed mock API configuration.");
  const id = "123e4567-e89b-42d3-a456-426614174000";
  const session = { csrfToken: "review-test", user: { id: "reviewer", displayName: "Reviewer" },
    organization: { id: "organization", name: "Example EMS" }, startedAt: "2026-10-02T08:00:00Z",
    expiresAt: "2099-10-02T20:00:00Z", capabilities: ["review:all"], workspaceAvailable: true };
  await page.addInitScript((stored) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/installation") return route.fulfill({ json: { settings } });
    if (path === "/api/sessions/current") return route.fulfill({ json: session });
    if (path === "/api/review/reports") return route.fulfill({ json: { dataset: "real", scope: "all",
      identifying: false, administrator: false, page: 1, pageSize: 25, total: 1,
      asOf: "2026-10-02T08:00:00Z", reports: [{ id, reportingDate: "2026-10-02", signedAt: "2026-10-02T07:00:00Z" }] } });
    if (path === `/api/review/reports/${id}`) return route.fulfill({ json: { id, reportingDate: "2026-10-02",
      signedAt: "2026-10-02T07:00:00Z", amendmentSequence: 1, identifying: false,
      groups: [{ id: "entry-1", parentGroupInstanceId: null, groupId: "custom.entry", label: "Assessment entry", ordinal: 1 }],
      values: [{ id: "score", elementId: "custom.score", label: "Score", groupInstanceId: "entry-1",
        ordinal: 0, valueKind: "integer", value: 4 }], notes: [] } });
    return route.fulfill({ status: 404 });
  });
  await page.goto("/");
  await page.getByRole("button", { name: id }).click();
  await expect(page.getByRole("heading", { name: "Assessment entry #2" })).toBeVisible();
  await expect(page.getByText("Score")).toBeVisible();
  await expect(page.getByText("4", { exact: true })).toBeVisible();
  await expect(page.getByText("1 signed amendments")).toBeVisible();
  await expect(page.getByText("Surname")).toHaveCount(0);
});
