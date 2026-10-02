import { expect, test } from "@playwright/test";
import settings from "@open-triage/contracts/config/installation.production.json";

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
  await expect(page.getByText("real-report")).toBeVisible();
  await expect(page.getByRole("img", { name: /Daily signed patient report count trend/ })).toBeVisible();
  await expect(page.getByText("Signed patient reports in the selected period: 2", { exact: false })).toBeVisible();
  await page.getByLabel("Dataset").selectOption("synthetic");
  await expect(page.getByText("synthetic-report")).toBeVisible();
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
