import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import settings from "@open-triage/contracts/config/installation.production.json";

test.skip(true, "Analysis navigation is temporarily hidden.");

test("Review CSV refreshes changed volume and exports the displayed aggregates", async ({ page }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires server-backed mock API configuration.");
  const session = { csrfToken: "csv-test", user: { id: "reviewer", displayName: "Reviewer" },
    organization: { id: "organization", name: "Example EMS" }, startedAt: "2026-10-02T08:00:00Z",
    expiresAt: "2099-10-02T20:00:00Z", capabilities: ["review:all"], workspaceAvailable: true };
  const population = { unit: "patient-report", scope: "all", organizationId: "organization", signedOnly: true };
  const freshness = { observedAt: "2026-10-02T08:00:00Z", targetSeconds: 300, status: "current",
    oldestBacklogSeconds: null, replicaLagSeconds: null };
  let volumeExports = 0;
  let denyAnalysis = false;
  const analysis = { exportRevision: "analysis-v1",
    definition: { fieldId: "eSituation.09", operation: "distribution",
      filters: { from: "2026-10-01", to: "2026-10-02", dataset: "real" } },
    field: { id: "eSituation.09", label: "Primary Symptom", kind: "categorical", unit: null,
      operations: ["distribution"] }, population, freshness,
    groups: [{ group: null, denominator: 4, missing: 1, absent: 1, summary: null,
      values: [{ value: "pain", count: 2, percentage: 50 }] }] };
  await page.addInitScript((stored) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/installation") return route.fulfill({ json: { settings } });
    if (path === "/api/sessions/current") return route.fulfill({ json: session });
    if (path === "/api/review/volume") {
      const from = url.searchParams.get("from")!;
      const to = url.searchParams.get("to")!;
      return route.fulfill({ json: { exportRevision: "volume-v1",
        definition: { measure: "signed-report-count", grouping: "day", filters: { from, to, dataset: "real" } },
        population, freshness, total: 2, points: [{ date: from, count: 2 }] } });
    }
    if (path === "/api/review/volume/export") {
      expect(route.request().headers()["x-csrf-token"]).toBe(session.csrfToken);
      const request = route.request().postDataJSON() as { expectedRevision: string;
        definition: { filters: { from: string; dataset: string } } };
      expect(request.definition.filters.dataset).toBe("real");
      volumeExports++;
      if (volumeExports === 1) {
        expect(request.expectedRevision).toBe("volume-v1");
        return route.fulfill({ status: 409, json: { result: { exportRevision: "volume-v2",
          definition: request.definition, population, freshness, total: 3,
          points: [{ date: request.definition.filters.from, count: 3 }] } } });
      }
      expect(request.expectedRevision).toBe("volume-v2");
      return route.fulfill({ status: 200,
        headers: { "content-type": "text/csv; charset=utf-8",
          "content-disposition": "attachment; filename=review-volume.csv" },
        body: `"date","count"\r\n"${request.definition.filters.from}","3"\r\n` });
    }
    if (path === "/api/review/volume/records/export") {
      expect((route.request().postDataJSON() as { expectedRevision: string }).expectedRevision).toBe("volume-v2");
      return route.fulfill({ status: 200, headers: { "content-type": "text/csv; charset=utf-8" },
        body: '"report_id","reporting_date","dataset"\r\n"report-a","2026-10-01","real"\r\n' });
    }
    if (path === "/api/review/analysis/fields") return route.fulfill({ json: [analysis.field] });
    if (path === "/api/review/analysis") return route.fulfill({ json: analysis });
    if (path === "/api/review/analysis/export") {
      expect(route.request().headers()["x-csrf-token"]).toBe(session.csrfToken);
      expect((route.request().postDataJSON() as { expectedRevision: string }).expectedRevision).toBe("analysis-v1");
      if (denyAnalysis) return route.fulfill({ status: 403, json: { message: "Forbidden" } });
      return route.fulfill({ status: 200,
        headers: { "content-type": "text/csv; charset=utf-8",
          "content-disposition": "attachment; filename=review-analysis.csv" },
        body: '"group","denominator","value","count","percentage"\r\n"","4","pain","2","50"\r\n' });
    }
    if (path === "/api/review/analysis/records/export") {
      expect((route.request().postDataJSON() as { expectedRevision: string }).expectedRevision).toBe("analysis-v1");
      return route.fulfill({ status: 200, headers: { "content-type": "text/csv; charset=utf-8" },
        body: '"report_id","group_values_json"\r\n"report-a","[]"\r\n' });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto("/");
  await page.getByRole("tab", { name: "Analysis", exact: true }).click();
  const volumeSection = page.locator('section[aria-labelledby="review-volume-heading"]');
  const analysisSection = page.locator('section[aria-labelledby="review-analysis-heading"]');
  await expect(volumeSection.getByText("Signed patient reports in the selected period: 2", { exact: false })).toBeVisible();
  await volumeSection.getByRole("button", { name: "Download aggregate CSV" }).click();
  await expect(page.getByText("The source changed. The chart now shows the refreshed result", { exact: false })).toBeVisible();
  await expect(volumeSection.getByText("Signed patient reports in the selected period: 3", { exact: false })).toBeVisible();
  const volumeDownload = page.waitForEvent("download");
  await volumeSection.getByRole("button", { name: "Download aggregate CSV" }).click();
  expect(await readFile(await (await volumeDownload).path(), "utf8")).toContain('"3"');
  const volumeRecords = page.waitForEvent("download");
  await volumeSection.getByRole("button", { name: "Download underlying records CSV" }).click();
  expect(await readFile(await (await volumeRecords).path(), "utf8")).toContain("report-a");
  await page.getByRole("tab", { name: "Clinical analysis", exact: true }).click();
  await analysisSection.getByRole("button", { name: "Run analysis" }).click();
  await expect(analysisSection.getByRole("cell", { name: "50.0%" })).toBeVisible();
  const analysisDownload = page.waitForEvent("download");
  await analysisSection.getByRole("button", { name: "Download aggregate CSV" }).click();
  expect(await readFile(await (await analysisDownload).path(), "utf8")).toContain('"pain","2","50"');
  const analysisRecords = page.waitForEvent("download");
  await analysisSection.getByRole("button", { name: "Download underlying records CSV" }).click();
  expect(await readFile(await (await analysisRecords).path(), "utf8")).toContain("report-a");
  denyAnalysis = true;
  await analysisSection.getByRole("button", { name: "Download aggregate CSV" }).click();
  await expect(page.getByText("Your Review access changed.", { exact: false })).toBeVisible();
  await expect(analysisSection.getByRole("button", { name: "Download aggregate CSV" })).toHaveCount(0);
});
