import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { updateAgencyMediaSettings } from "../app/admin-context";
import { AgencySettingsPanel, newAgencySettings, showsStorageGrowthWarning } from "../components/agency-settings";

import { timeZoneOptions } from "../components/time-zone-select";

const appearance = {
  brandText: "County EMS", helperText: "Use your agency-issued credentials.", logoPngDataUrl: null,
  accentColor: "#00783a", accentDarkColor: "#006b34", browserThemeColor: "#00783a",
  destructiveColor: "#9f241d",
  inactiveButtonColor: "#f2f5f3", textColor: "#202520",
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
      expectedRevision: 4, language: "sv", syntheticRetentionHours: null,
      reportMediaAllowanceBytes: 80 * 1024 * 1024,
      imageMediaLimitBytes: 10 * 1024 * 1024,
      appearance,
      demographics,
    });
    return Response.json({
      organizationId: "organization-id", language: "sv", syntheticRetentionHours: null, reportMediaAllowanceBytes: 80 * 1024 * 1024,
      imageMediaLimitBytes: 10 * 1024 * 1024,
      appearance, demographics: { ...demographics, versionId: "version-id", version: 2,
        catalogReleaseId: "catalog-id", effectiveFrom: "2026-09-24T10:00:00.000Z" },
      revision: 5, defaultReportMediaAllowanceBytes: 50 * 1024 * 1024,
      defaultImageMediaLimitBytes: 10 * 1024 * 1024,
      storageGrowthWarning: true, updatedAt: "2026-09-24T10:00:00.000Z",
    });
  };
  const result = await updateAgencyMediaSettings("csrf-proof", {
    expectedRevision: 4, language: "sv", syntheticRetentionHours: null, reportMediaAllowanceBytes: 80 * 1024 * 1024,
    imageMediaLimitBytes: 10 * 1024 * 1024,
    appearance, demographics,
  });
  assert.equal(result.revision, 5);
  assert.equal(result.syntheticRetentionHours, null);
  assert.equal(result.language, "sv");
  assert.equal(result.storageGrowthWarning, true);
  assert.equal(result.appearance.destructiveColor, appearance.destructiveColor);
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

test("timezone choices include UTC, canonical zones and an existing supported alias", () => {
  const zones = timeZoneOptions("US/Eastern");
  assert.ok(zones.includes("UTC"));
  assert.ok(zones.includes("Europe/Stockholm"));
  assert.ok(zones.includes("US/Eastern"));
  assert.equal(new Set(zones).size, zones.length);
});

test("new agencies use the same complete settings editor without claiming an existing revision", () => {
  const settings = newAgencySettings();
  assert.equal(settings.demographics.agencyNumber, "");
  const markup = renderToStaticMarkup(createElement(AgencySettingsPanel, {
    csrfToken: "csrf-proof", canWrite: true,
    creation: { fields: createElement("input", { name: "hostname" }), onSubmit: async () => {}, onCancel() {}, onChange() {} },
  }));
  assert.match(markup, /id="new-agency-time-zone"/);
  assert.match(markup, /<select id="new-agency-time-zone"/);
  assert.match(markup, /name="hostname"/);
  assert.match(markup, /dAgency.01/);
  assert.match(markup, /name="reportMediaAllowanceMib"/);
  assert.doesNotMatch(markup, /id="agency-time-zone"/);
});

test("new-agency headings and demographic labels use the selected language", () => {
  const markup = renderToStaticMarkup(createElement(AgencySettingsPanel, {
    csrfToken: "csrf-proof", canWrite: true, language: "sv",
    creation: { fields: null, onSubmit: async () => {}, onCancel() {}, onChange() {} },
  }));
  assert.match(markup, /Ny organisation/);
  assert.match(markup, /Organisationens unika delstats-ID/);
  assert.match(markup, /ANSI-delstatskod/);
  assert.match(markup, /Avbryt/);
  assert.doesNotMatch(markup, /New agency|EMS Agency Unique State ID/);
});
