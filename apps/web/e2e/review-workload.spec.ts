import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import settings from "@open-triage/contracts/config/installation.production.json";

test("workload uses item counts while clinical Review filters retain signed report counts", async ({ page }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires server-backed mock API configuration.");
  const criterionId = "123e4567-e89b-42d3-a456-426614174301";
  const outcomeId = "123e4567-e89b-42d3-a456-426614174302";
  const session = { csrfToken: "csrf", user: { id: "reviewer", displayName: "Reviewer" },
    organization: { id: "organization", name: "Example EMS" }, startedAt: "2026-10-02T08:00:00Z",
    expiresAt: "2099-10-02T20:00:00Z", capabilities: ["review:all"], workspaceAvailable: true };
  let clinicalDefinition: { filters: { review?: { criterionId?: string; outcomeOptionId?: string } } } | null = null;
  let workloadDefinition: { groupBy: string; filters: { dataset: string } } | null = null;
  await page.addInitScript((stored) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/installation") return route.fulfill({ json: { settings } });
    if (path === "/api/sessions/current") return route.fulfill({ json: session });
    if (path === "/api/review/reports") return route.fulfill({ json: { dataset: "real", scope: "all",
      identifying: false, administrator: false, page: 1, pageSize: 25, total: 0,
      asOf: "2026-10-02T08:00:00Z", reports: [] } });
    if (path === "/api/review/analysis/fields") return route.fulfill({ json: [{ id: "eSituation.09",
      label: "Primary Symptom", kind: "categorical", unit: null, operations: ["distribution"] }] });
    if (path === "/api/review/analysis/review-filters") return route.fulfill({ json: {
      criteria: [{ id: criterionId, label: criterionId }],
      outcomes: [{ id: outcomeId, label: "Historical disposition" }] } });
    if (path === "/api/review/analysis") {
      clinicalDefinition = route.request().postDataJSON() as typeof clinicalDefinition;
      return route.fulfill({ json: { definition: clinicalDefinition,
        field: { id: "eSituation.09", label: "Primary Symptom", kind: "categorical",
          unit: null, operations: ["distribution"] },
        population: { unit: "patient-report", scope: "all", organizationId: "organization", signedOnly: true },
        freshness: { observedAt: "2026-10-02T08:00:00Z", targetSeconds: 300, status: "current",
          oldestBacklogSeconds: null, replicaLagSeconds: null },
        groups: [{ group: null, denominator: 1, missing: 0, absent: 0, summary: null,
          values: [{ value: "pain", count: 1, percentage: 100 }] }] } });
    }
    if (path === "/api/review/workload") {
      expect(route.request().headers()["x-csrf-token"]).toBe("csrf");
      workloadDefinition = route.request().postDataJSON() as typeof workloadDefinition;
      return route.fulfill({ json: { exportRevision: "workload-v1", definition: workloadDefinition,
        population: { unit: "review-item", scope: "all", organizationId: "organization",
          includesUnsigned: true }, freshness: { source: "operational-primary",
          observedAt: "2026-10-02T08:00:00Z" }, totalItems: 4, reopenedItems: 1,
        unsignedItems: 1, exceptionallyClosedItems: 1,
        groups: [{ key: "completed", count: 3 }, { key: "new", count: 1 }] } });
    }
    if (path === "/api/review/workload/export") {
      const request = route.request().postDataJSON() as { expectedRevision: string;
        displayedObservedAt: string; definition: { groupBy: string; filters: { dataset: string } } };
      expect(request.expectedRevision).toBe("workload-v1");
      expect(request.displayedObservedAt).toBe("2026-10-02T08:00:00Z");
      expect(request.definition.groupBy).toBe("status");
      expect(request.definition.filters.dataset).toBe("real");
      return route.fulfill({ status: 200, headers: { "content-type": "text/csv; charset=utf-8" },
        body: '"population_unit","review-item"\r\n"completed","3"\r\n' });
    }
    if (path === "/api/review/workload/records/export") {
      expect((route.request().postDataJSON() as { expectedRevision: string }).expectedRevision)
        .toBe("workload-v1");
      return route.fulfill({ status: 200, headers: { "content-type": "text/csv; charset=utf-8" },
        body: '"report_id","review_items_json"\r\n"report-a","[]"\r\n' });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto("/");
  await page.getByRole("tab", { name: "Analysis", exact: true }).click();
  await page.getByRole("tab", { name: "Review workload", exact: true }).click();
  const workload = page.locator('section[aria-labelledby="review-workload-heading"]');
  await workload.getByRole("button", { name: "Analyze workload" }).click();
  await expect(workload.getByText("Review items: 4", { exact: false })).toBeVisible();
  await expect(workload.getByRole("img", { name: "Review item counts by group" })).toBeVisible();
  await expect(workload.getByRole("cell", { name: "3", exact: true })).toBeVisible();
  expect(workloadDefinition).toMatchObject({ groupBy: "status", filters: { dataset: "real" } });
  const download = page.waitForEvent("download");
  await workload.getByRole("button", { name: "Download aggregate CSV" }).click();
  expect(await readFile(await (await download).path(), "utf8")).toContain('"review-item"');
  const recordsDownload = page.waitForEvent("download");
  await workload.getByRole("button", { name: "Download underlying records CSV" }).click();
  expect(await readFile(await (await recordsDownload).path(), "utf8")).toContain("report-a");
  const clinical = page.locator('section[aria-labelledby="review-analysis-heading"]');
  await page.getByRole("tab", { name: "Clinical analysis", exact: true }).click();
  await clinical.getByLabel("Matching Review criterion").selectOption(criterionId);
  await clinical.getByLabel("Recorded Review outcome").selectOption(outcomeId);
  await clinical.getByRole("button", { name: "Run analysis" }).click();
  await expect(clinical.getByText("Reports: 1", { exact: false })).toBeVisible();
  expect(clinicalDefinition).toMatchObject({ filters: { review: { criterionId,
    outcomeOptionId: outcomeId } } });
});
