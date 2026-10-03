import { expect, test } from "@playwright/test";
import settings from "@open-triage/contracts/config/installation.production.json";

for (const width of [390, 1440]) test(`Incomplete queue filter preserves state at ${width}px`, async ({ page }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires server-backed mock API configuration.");
  await page.setViewportSize({ width, height: 900 });
  const session = { csrfToken: "csrf", user: { id: "reviewer", displayName: "Reviewer" },
    organization: { id: "organization", name: "Example EMS" }, startedAt: "2026-10-02T08:00:00Z",
    expiresAt: "2099-10-02T20:00:00Z", capabilities: ["review:all"], workspaceAvailable: true };
  const statuses = ["new", "in-review", "awaiting-clinician", "completed"];
  const items = statuses.map((status, index) => ({ id: `123e4567-e89b-42d3-a456-42661417400${index}`,
    reportId: `123e4567-e89b-42d3-a456-42661417401${index}`, reportNumber: `PCR-${index}`,
    criterionId: "criterion-1", criterionName: "Clinical assessment", priority: "high", status,
    assigneeId: null, version: 0, firstMatchedAt: new Date().toISOString(), reportingDate: "2026-10-02", findings: [] }));
  const searches: URLSearchParams[] = [];
  await page.addInitScript((stored) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await page.context().route("**/api/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/installation") return route.fulfill({ json: { settings } });
    if (url.pathname === "/api/sessions/current") return route.fulfill({ json: session });
    if (url.pathname === "/api/review/queue") {
      searches.push(url.searchParams);
      const status = url.searchParams.get("status");
      const filtered = items.filter(item => !status || (status === "incomplete" ? item.status !== "completed" : item.status === status));
      const currentPage = Number(url.searchParams.get("page") ?? 1);
      return route.fulfill({ json: { dataset: "real", page: currentPage, pageSize: 2, total: filtered.length,
        assignmentCounts: { all: filtered.length, mine: 0, unassigned: filtered.length },
        asOf: new Date().toISOString(), items: filtered.slice((currentPage - 1) * 2, currentPage * 2) } });
    }
    const item = items.find(item => url.pathname === `/api/review/items/${item.id}`);
    if (item) return route.fulfill({ json: { ...item, assignmentHistory: [], progressHistory: [], comments: [], commentsRestricted: true } });
    const report = items.find(item => url.pathname === `/api/review/reports/${item.reportId}`);
    if (report) return route.fulfill({ json: { id: report.reportId, reportingDate: report.reportingDate,
      signedAt: new Date().toISOString(), amendmentSequence: 0, groups: [], values: [], notes: [] } });
    return route.fulfill({ status: 404 });
  });
  await page.goto("/");
  const table = page.getByRole("table", { name: "Review queue", exact: true });
  await expect(table.locator("tbody tr")).toHaveCount(2);
  const pagination = page.getByRole("navigation", { name: "Review queue pages" });
  await pagination.getByRole("button", { name: "Next", exact: true }).click();
  await expect(table.getByText("Completed", { exact: true })).toBeVisible();
  const status = page.getByRole("combobox", { name: "Status", exact: true });
  await status.selectOption("incomplete");
  await expect.poll(() => searches.at(-1)?.get("status")).toBe("incomplete");
  await expect.poll(() => searches.at(-1)?.get("page")).toBe("1");
  await expect(page.getByRole("button", { name: "All reviews 3", exact: true })).toBeVisible();
  await expect(table.getByText("New", { exact: true })).toBeVisible();
  await expect(table.getByText("In review", { exact: true })).toBeVisible();
  await pagination.getByRole("button", { name: "Next", exact: true }).click();
  await expect(table.getByText("Awaiting clinician", { exact: true })).toBeVisible();
  await expect(table.getByText("Completed", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("tablist", { name: "Review workspace", exact: true })).toHaveCount(0);
  await expect(status).toHaveValue("incomplete");
  await expect(table.getByText("Awaiting clinician", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View PCR-2", exact: true }).click();
  await page.getByRole("button", { name: "Close full report", exact: true }).click();
  await expect(status).toHaveValue("incomplete");
  await expect(pagination.getByText("Page 2", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/review-incomplete-${width}.png`, fullPage: true });
  await status.selectOption("completed");
  await expect(table.getByText("Completed", { exact: true })).toBeVisible();
  await status.selectOption("");
  await expect(page.getByRole("button", { name: "All reviews 4", exact: true })).toBeVisible();
});
