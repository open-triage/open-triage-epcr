import { expect, test } from "@playwright/test";
import settings from "@open-triage/contracts/config/installation.production.json";

test("Review builder runs a coded case-mix starter with a scoped filter and D3 chart", async ({ page }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires server-backed mock API configuration.");
  const session = { csrfToken: "review-analysis-test", user: { id: "reviewer", displayName: "Reviewer" },
    organization: { id: "organization", name: "Example EMS" }, startedAt: "2026-10-02T08:00:00Z",
    expiresAt: "2099-10-02T20:00:00Z", capabilities: ["review:all"], workspaceAvailable: true };
  let definition: Record<string, unknown> | null = null;
  await page.addInitScript((stored) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/installation") return route.fulfill({ json: { settings } });
    if (path === "/api/sessions/current") return route.fulfill({ json: session });
    if (path === "/api/review/reports") return route.fulfill({ json: { dataset: "real", scope: "all",
      identifying: false, administrator: false, page: 1, pageSize: 25, total: 0,
      asOf: "2026-10-02T08:00:00Z", reports: [] } });
    if (path === "/api/review/analysis/fields") return route.fulfill({ json: [
      { id: "eSituation.09", label: "Primary Symptom", kind: "categorical", unit: null,
        operations: ["distribution"] },
      { id: "eSituation.11", label: "Primary Impression", kind: "categorical", unit: null,
        operations: ["distribution"] },
      { id: "eDisposition.30", label: "Transport Disposition", kind: "categorical", unit: null,
        operations: ["distribution"] },
    ] });
    if (path === "/api/review/analysis") {
      expect(route.request().headers()["x-csrf-token"]).toBe(session.csrfToken);
      definition = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({ json: {
        definition, field: { id: "eSituation.09", label: "Primary Symptom", kind: "categorical",
          unit: null, operations: ["distribution"] },
        population: { unit: "patient-report", scope: "all", organizationId: "organization", signedOnly: true },
        freshness: { observedAt: "2026-10-02T08:00:00Z", targetSeconds: 300, status: "current",
          oldestBacklogSeconds: null, replicaLagSeconds: null },
        groups: [{ group: null, denominator: 4, missing: 1, absent: 1, summary: null,
          values: [{ value: "pain", count: 2, percentage: 50 }] }],
      } });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Primary symptom" }).click();
  await page.getByLabel("Filter field").selectOption("eDisposition.30");
  await page.getByLabel("Code").fill("transported");
  await page.getByRole("button", { name: "Run analysis" }).click();
  await expect(page.getByText("Reports: 4", { exact: false })).toBeVisible();
  await expect(page.getByText("Missing: 1", { exact: false })).toBeVisible();
  await expect(page.getByText("Recorded absent: 1", { exact: false })).toBeVisible();
  await expect(page.getByRole("img", { name: "Distribution of coded values; exact values follow in the table" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "50.0%" })).toBeVisible();
  expect(definition).toMatchObject({ fieldId: "eSituation.09", operation: "distribution",
    filters: { dataset: "real", field: { id: "eDisposition.30", value: "transported" } } });
  await page.getByLabel("Dataset").selectOption("synthetic");
  await expect(page.getByRole("img", { name: "Distribution of coded values; exact values follow in the table" }))
    .toHaveCount(0);
});
