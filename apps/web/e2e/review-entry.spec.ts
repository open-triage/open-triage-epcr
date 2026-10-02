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
    return route.fulfill({ status: 404 });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Signed reports" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Admin" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mobile" })).toHaveCount(0);
  await expect(page.getByText("real-report")).toBeVisible();
  await page.getByLabel("Dataset").selectOption("synthetic");
  await expect(page.getByText("synthetic-report")).toBeVisible();
  expect(requestedDatasets[0]).toBe("real");
  expect(requestedDatasets.at(-1)).toBe("synthetic");
  await page.reload();
  await expect(page.getByRole("button", { name: "Review" })).toHaveAttribute("aria-pressed", "true");
  await context.setOffline(true);
  await expect(page.getByText("Review requires a connection.", { exact: false })).toBeVisible();
});
