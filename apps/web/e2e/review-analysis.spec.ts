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
      { id: "eMedications.03", label: "Medication Administered", kind: "categorical",
        unit: null, repeating: true, operations: ["distribution"] },
      { id: "eVitals.06", label: "Systolic Blood Pressure", kind: "numeric",
        unit: "mm[Hg]", repeating: true, operations: ["mean", "median", "minimum", "maximum"] },
      { id: "review.duration.response", label: "Response time", source: "operational-time", kind: "numeric",
        unit: "min", interval: { start: "eTimes.03", end: "eTimes.06", eligibility: "signed-patient-reports" },
        operations: ["mean", "median", "minimum", "maximum"] },
      { id: "review.duration.scene", label: "Scene time", source: "operational-time", kind: "numeric",
        unit: "min", interval: { start: "eTimes.06", end: "eTimes.09", eligibility: "signed-patient-reports" },
        operations: ["mean", "median", "minimum", "maximum"] },
      { id: "review.duration.transport", label: "Transport time", source: "operational-time", kind: "numeric",
        unit: "min", interval: { start: "eTimes.09", end: "eTimes.11", eligibility: "signed-patient-reports" },
        operations: ["mean", "median", "minimum", "maximum"] },
      { id: "33333333-3333-4333-8333-333333333333", label: "Custom dose", source: "custom",
        kind: "numeric", unit: null, operations: ["mean", "median", "minimum", "maximum"] },
      { id: "55555555-5555-4555-8555-555555555555", label: "Grouped dose", source: "custom",
        kind: "numeric", repeating: true, unit: null,
        operations: ["mean", "median", "minimum", "maximum"] },
      { id: "66666666-6666-4666-8666-666666666666", label: "Grouped route", source: "custom",
        kind: "categorical", repeating: true, unit: null, operations: ["distribution"] },
      { id: "44444444-4444-4444-8444-444444444444", label: "Opaque custom note", source: "custom",
        kind: "categorical", unit: null, operations: [], unsupportedReason: "opaque" },
    ] });
    if (path === "/api/review/analysis") {
      expect(route.request().headers()["x-csrf-token"]).toBe(session.csrfToken);
      definition = route.request().postDataJSON() as Record<string, unknown>;
      const repeated = definition.fieldId === "eVitals.06";
      const custom = definition.fieldId === "33333333-3333-4333-8333-333333333333";
      const operational = definition.fieldId === "review.duration.response";
      const grouped = definition.fieldId === "55555555-5555-4555-8555-555555555555";
      return route.fulfill({ json: {
        definition, field: repeated
          ? { id: "eVitals.06", label: "Systolic Blood Pressure", kind: "numeric",
            unit: "mm[Hg]", repeating: true, operations: ["mean", "median", "minimum", "maximum"] }
          : custom || grouped
          ? { id: definition.fieldId, label: grouped ? "Grouped dose" : "Custom dose",
            source: "custom", kind: "numeric", repeating: grouped,
            unit: null, operations: ["mean", "median", "minimum", "maximum"] }
          : operational
          ? { id: "review.duration.response", label: "Response time", source: "operational-time",
            kind: "numeric", unit: "min", interval: { start: "eTimes.03", end: "eTimes.06",
              eligibility: "signed-patient-reports" }, operations: ["mean", "median", "minimum", "maximum"] }
          : { id: "eSituation.09", label: "Primary Symptom", kind: "categorical",
            unit: null, operations: ["distribution"] },
        population: { unit: "patient-report", scope: "all", organizationId: "organization", signedOnly: true },
        freshness: { observedAt: "2026-10-02T08:00:00Z", targetSeconds: 300, status: "current",
          oldestBacklogSeconds: null, replicaLagSeconds: null },
        groups: grouped ? [{ group: "A", denominator: 2, missing: 0, absent: 0,
          summary: 15, values: [] }] : [{ group: null, denominator: 4, missing: 1, absent: 1,
          ...(operational ? { invalid: 1 } : {}),
          summary: repeated ? 120 : custom ? 2.5 : operational ? 12.5 : null,
          values: repeated || custom || operational ? [] : [{ value: "pain", count: 2, percentage: 50 }] }],
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
  await page.getByRole("combobox", { name: "Field", exact: true }).selectOption("eVitals.06");
  await expect(page.getByRole("button", { name: "Run analysis" })).toBeDisabled();
  await page.getByLabel("Per-report value").selectOption("first");
  await page.getByRole("button", { name: "Run analysis" }).click();
  await expect(page.getByText("Per-report reduction: First.")).toBeVisible();
  await expect(page.getByText("Mean: 120 mm[Hg]")).toBeVisible();
  expect(definition).toMatchObject({ fieldId: "eVitals.06", operation: "mean", reducer: "first" });
  await page.getByRole("combobox", { name: "Field", exact: true }).selectOption("44444444-4444-4444-8444-444444444444");
  await expect(page.getByText("This custom field has no supported chart operation", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run analysis" })).toBeDisabled();
  await page.getByRole("combobox", { name: "Field", exact: true }).selectOption("33333333-3333-4333-8333-333333333333");
  await expect(page.getByRole("button", { name: "Run analysis" })).toBeEnabled();
  await page.getByRole("button", { name: "Run analysis" }).click();
  await expect(page.getByText("Mean: 2.5", { exact: false })).toBeVisible();
  expect(definition).toMatchObject({ fieldId: "33333333-3333-4333-8333-333333333333",
    operation: "mean", filters: { dataset: "real" } });
  await page.getByRole("button", { name: "Response time" }).click();
  await expect(page.getByText("eTimes.03 → eTimes.06; elapsed min", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Run analysis" }).click();
  await expect(page.getByText("Mean: 12.5 min")).toBeVisible();
  await expect(page.getByText("Reversed interval: 1", { exact: false })).toBeVisible();
  expect(definition).toMatchObject({ fieldId: "review.duration.response", operation: "mean" });
  await page.getByRole("button", { name: "Scene time" }).click();
  await expect(page.getByText("eTimes.06 → eTimes.09; elapsed min", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Transport time" }).click();
  await expect(page.getByText("eTimes.09 → eTimes.11; elapsed min", { exact: false })).toBeVisible();
  await page.getByRole("combobox", { name: "Field", exact: true }).selectOption("55555555-5555-4555-8555-555555555555");
  await page.getByLabel("Per-report value").selectOption("first");
  await page.getByLabel("Group by").selectOption("66666666-6666-4666-8666-666666666666");
  await page.getByLabel("Filter field").selectOption("66666666-6666-4666-8666-666666666666");
  await page.getByLabel("Code").fill("A");
  await page.getByRole("button", { name: "Run analysis" }).click();
  await expect(page.getByRole("heading", { name: "A", exact: true })).toBeVisible();
  await expect(page.getByText("Mean: 15", { exact: false })).toBeVisible();
  expect(definition).toMatchObject({ fieldId: "55555555-5555-4555-8555-555555555555",
    operation: "mean", reducer: "first", groupBy: "66666666-6666-4666-8666-666666666666",
    filters: { field: { id: "66666666-6666-4666-8666-666666666666", value: "A" } } });
  await page.getByLabel("Dataset").selectOption("synthetic");
  await expect(page.getByRole("img", { name: "Distribution of coded values; exact values follow in the table" }))
    .toHaveCount(0);
});
