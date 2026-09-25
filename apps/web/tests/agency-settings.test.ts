import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { updateAgencyMediaSettings } from "../app/admin-context";
import { AgencySettingsPanel, showsStorageGrowthWarning } from "../components/agency-settings";

const appearance = {
  brandText: "County EMS", helperText: "Use your agency-issued credentials.", logoPngDataUrl: null,
  accentColor: "#00783a", accentDarkColor: "#006b34", browserThemeColor: "#00783a",
  pwaBackgroundColor: "#dfe5df", pwaName: "County EMS", pwaShortName: "EMS",
};
const demographics = { agencyUniqueStateId: "STATE-1", agencyNumber: "AGENCY-1", stateCode: "36",
  stateDisplay: "New York", stateCodeSystem: "ANSI-STATE", stateTerminologyVersion: null };

test("Agency Settings uses an explicit revisioned save with CSRF proof", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /\/api\/admin\/agency-settings$/);
    assert.equal(init?.method, "PUT");
    assert.equal((init?.headers as Record<string, string>)["x-csrf-token"], "csrf-proof");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      expectedRevision: 4,
      reportMediaAllowanceBytes: 80 * 1024 * 1024,
      imageMediaLimitBytes: 10 * 1024 * 1024,
      appearance,
      demographics,
    });
    return Response.json({
      organizationId: "organization-id", reportMediaAllowanceBytes: 80 * 1024 * 1024,
      imageMediaLimitBytes: 10 * 1024 * 1024,
      appearance, demographics: { ...demographics, versionId: "version-id", version: 2,
        catalogReleaseId: "catalog-id", effectiveFrom: "2026-09-24T10:00:00.000Z" },
      revision: 5, defaultReportMediaAllowanceBytes: 50 * 1024 * 1024,
      defaultImageMediaLimitBytes: 10 * 1024 * 1024,
      storageGrowthWarning: true, updatedAt: "2026-09-24T10:00:00.000Z",
    });
  };
  const result = await updateAgencyMediaSettings("csrf-proof", {
    expectedRevision: 4, reportMediaAllowanceBytes: 80 * 1024 * 1024,
    imageMediaLimitBytes: 10 * 1024 * 1024,
    appearance, demographics,
  });
  assert.equal(result.revision, 5);
  assert.equal(result.storageGrowthWarning, true);
});

test("the Postgres storage-growth warning starts above the 50 MB default", () => {
  assert.equal(showsStorageGrowthWarning(50 * 1024 * 1024), false);
  assert.equal(showsStorageGrowthWarning(51 * 1024 * 1024), true);
});

test("Agency Settings has a focused accessible loading panel", () => {
  const markup = renderToStaticMarkup(createElement(AgencySettingsPanel, {
    csrfToken: "csrf-proof", canWrite: true,
  }));
  assert.match(markup, /id="agency-settings-heading">Agency Settings/);
  assert.match(markup, /role="status">Loading Agency Settings/);
});
