import { expect, test } from "@playwright/test";
import { compileValidationRule, compiledValidationBundleSha256, type CompiledValidationBundle } from "@open-triage/contracts";
import settings from "@open-triage/contracts/config/installation.production.json";
import calls from "../public/demo-assigned-calls.json";
import opened from "../public/demo-open-assignment.json";

test("main report shows required inline fields before their singleton groups exist and clears them after editing", async ({ page }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== "true", "Requires server-backed mock API configuration.");
  await page.setViewportSize({ width: 1440, height: 1000 });
  const versionId = "51000000-0000-4000-8000-000000000088";
  const fields = [
    { id: "eResponse.03", message: "Record the incident number." },
    { id: "ePatient.15", message: "Record the patient age." },
  ];
  const rules = fields.map(({ id, message }) => compileValidationRule({ id, name: message, enabled: true, severity: "error",
    executionTargets: ["live", "sign"], primaryTargetElementId: id, message,
    source: `for each("PatientCareReportGroup")\nrequire minimum("${id}", 1)`,
  }, versionId, new Set(fields.map(({ id }) => id))).compiled!);
  const bundle: CompiledValidationBundle = { schemaVersion: 1, languageVersion: "1.0.0", validationVersionId: versionId,
    catalogReleaseId: opened.report.catalogReleaseId, rules };
  const hash = compiledValidationBundleSha256(bundle);
  const report = { ...opened.report, validationVersionId: versionId, validationCompiledSha256: hash,
    document: { ...opened.report.document, groups: opened.report.document.groups.filter(({ id }) =>
      ["EMSDataSet", "HeaderGroup", "PatientCareReportGroup"].includes(id)) },
    clinicalForm: { definition: { schemaVersion: 1, sections: [{ key: "report", name: "Report", fields: fields.map(({ id }) => ({
      key: id, source: { kind: "nemsis", elementId: id },
    })) }] }, catalogFields: {}, validation: { versionId, compiledSha256: hash, bundle } },
  };
  const session = { csrfToken: "inline-validation-test", user: { id: report.documentingUserId, displayName: "Validation Test Clinician" },
    organization: { id: "32000000-0000-4000-8000-000000000001", name: "Synthetic EMS" },
    startedAt: "2026-10-03T08:00:00Z", expiresAt: "2099-10-03T20:00:00Z", capabilities: ["clinical:document"], workspaceAvailable: true };
  await page.addInitScript((stored) => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(stored)), session);
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/installation") return route.fulfill({ json: { settings } });
    if (path === "/api/sessions/current") return route.fulfill({ json: session });
    if (path === "/api/calls/assigned") return route.fulfill({ json: calls });
    if (path === "/api/reports/open") return route.fulfill({ json: { openCalls: [], completedReportIds: [] } });
    if (path.endsWith("/open")) return route.fulfill({ json: { ...opened, report } });
    if (path.endsWith("/active")) return route.fulfill({ status: 304 });
    if (path.endsWith("/protected-key-envelope")) return route.fulfill({ status: 201, json: {
      schemaVersion: 1, recoveryHandle: route.request().postDataJSON().recoveryHandle,
      recoveryDeadline: "2099-10-04T12:00:00Z", wrappingKeyVersion: 1,
    } });
    if (path.endsWith("/protected-ciphertext-receipt")) return route.fulfill({ json: { schemaVersion: 1, recoveryDeadline: "2099-10-04T12:00:00Z" } });
    if (path.endsWith("/protected-ciphertext-checkpoint")) return route.fulfill({ json: route.request().postDataJSON() });
    if (path.endsWith("/draft-changes")) return route.fulfill({ json: { id: report.id, status: "draft",
      revision: route.request().postDataJSON().expectedRevision + 1 } });
    return route.fulfill({ status: 404 });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open call", exact: true }).first().click();
  await page.getByRole("button", { name: "Stationary", exact: true }).click();
  const main = page.locator(".stationary-record-page");
  await expect(main.getByText("Record the incident number.", { exact: false })).toBeVisible();
  await expect(main.getByText("Record the patient age.", { exact: false })).toBeVisible();
  await expect(main.locator(".stationary-field-shell.stationary-validation-state.error")).toHaveCount(2);
  await main.locator('[data-element-id="eResponse.03"] input').first().fill("INCIDENT-E2E");
  await main.locator('[data-element-id="eResponse.03"] input').first().press("Tab");
  await expect(main.getByText("Record the incident number.", { exact: false })).toHaveCount(0);
  await expect(main.getByText("Record the patient age.", { exact: false })).toBeVisible();
  await main.locator('[data-element-id="ePatient.15"] input').first().fill("35");
  await main.locator('[data-element-id="ePatient.15"] input').first().press("Tab");
  await expect(main.locator(".stationary-validation-message.error")).toHaveCount(0);
});
