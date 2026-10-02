import { expect, test } from "@playwright/test";
import settings from "@open-triage/contracts/config/installation.production.json";

test("administrator previews historical work and resumes a bounded run", async ({ page }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires server-backed mock API configuration.");
  const criterionId = "123e4567-e89b-42d3-a456-426614174133";
  const versionId = "123e4567-e89b-42d3-a456-426614174134";
  const reportId = "123e4567-e89b-42d3-a456-426614174135";
  const runId = "123e4567-e89b-42d3-a456-426614174136";
  const session = { csrfToken: "retro-csrf", user: { id: "administrator", displayName: "Administrator" },
    organization: { id: "organization", name: "Example EMS" }, startedAt: "2026-10-02T08:00:00Z",
    expiresAt: "2099-10-02T20:00:00Z", capabilities: ["review:all", "review:admin"], workspaceAvailable: true };
  const definition = { criterionId, validationVersionId: versionId, from: "2026-09-01",
    to: "2026-09-02", dataset: "real" as const };
  const preview = { definition, scope: { organizationId: "organization", reports: "all" },
    revision: "a".repeat(64), sourceRevision: "b".repeat(64), total: 1, matches: 1,
    newItems: 1, existingItems: 0, failed: 0, incompatible: 0,
    reports: [{ reportId, reportingDate: "2026-09-01", outcome: "match", existing: false,
      findingCount: 1, failureCode: null }] };
  let run: Record<string, unknown> | null = null;
  let previewRequests = 0;
  await page.addInitScript((stored) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await page.route("**/api/**", (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/installation") return route.fulfill({ json: { settings } });
    if (pathname === "/api/sessions/current") return route.fulfill({ json: session });
    if (pathname === "/api/review/reports") return route.fulfill({ json: { dataset: "real", scope: "all",
      identifying: false, administrator: true, page: 1, pageSize: 25, total: 0,
      asOf: new Date().toISOString(), reports: [] } });
    if (pathname === "/api/review/queue") return route.fulfill({ json: { dataset: "real", page: 1,
      pageSize: 25, total: 0, asOf: new Date().toISOString(), items: [] } });
    if (pathname === "/api/review/backlog") return route.fulfill({ json: { work: [] } });
    if (pathname === "/api/review/retrospective/versions") return route.fulfill({ json: [{ criterionId,
      validationVersionId: versionId, name: "Narrative check", version: 2,
      catalogReleaseId: "catalog", publishedAt: "2026-09-01T00:00:00Z" }] });
    if (pathname === "/api/review/retrospective/runs" && route.request().method() === "GET")
      return route.fulfill({ json: run ? [run] : [] });
    if (pathname === "/api/review/retrospective/preview") {
      previewRequests++;
      expect(route.request().postDataJSON()).toEqual(definition);
      return route.fulfill({ json: preview });
    }
    if (pathname === "/api/review/retrospective/runs") {
      expect(route.request().headers()["x-csrf-token"]).toBe("retro-csrf");
      const command = route.request().postDataJSON() as { expectedRevision: string; definition: typeof definition };
      expect(command.expectedRevision).toBe(preview.revision);
      expect(command.definition).toEqual(definition);
      run = { id: runId, definition, createdAt: new Date().toISOString(), total: 1,
        complete: 0, pending: 1, failed: 0, incompatible: 0, matches: 1, existingItems: 0, newItems: 1 };
      return route.fulfill({ json: run });
    }
    if (pathname === `/api/review/retrospective/runs/${runId}/advance`) {
      expect(route.request().headers()["x-csrf-token"]).toBe("retro-csrf");
      expect(route.request().postDataJSON()).toEqual({ batchSize: 25 });
      run = { ...run, complete: 1, pending: 0 };
      return route.fulfill({ json: run });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto("/");
  await page.getByLabel("Published criterion version").selectOption(versionId);
  await page.getByRole("region", { name: "Retrospective Review" }).getByLabel("From").fill("2026-09-01");
  await page.getByRole("region", { name: "Retrospective Review" }).getByLabel("To").fill("2026-09-02");
  await page.getByRole("button", { name: "Preview period" }).click();
  await expect(page.getByText("1 reports: 1 matches, 1 expected new items, 0 existing items, 0 evaluation failures, 0 incompatible reports.")).toBeVisible();
  expect(previewRequests).toBe(1);
  expect(run).toBeNull();
  await page.getByRole("button", { name: "Start historical run" }).click();
  await page.getByRole("button", { name: "Process next 25" }).click();
  await expect(page.getByText("1/1 complete, 0 pending, 0 failed, 0 incompatible")).toBeVisible();
});
