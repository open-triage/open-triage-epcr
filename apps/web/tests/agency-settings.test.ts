import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { updateAgencyMediaSettings } from "../app/admin-context";
import { AgencySettingsPanel, showsStorageGrowthWarning } from "../components/agency-settings";

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
    });
    return Response.json({
      organizationId: "organization-id", reportMediaAllowanceBytes: 80 * 1024 * 1024,
      revision: 5, defaultReportMediaAllowanceBytes: 50 * 1024 * 1024,
      storageGrowthWarning: true, updatedAt: "2026-09-24T10:00:00.000Z",
    });
  };
  const result = await updateAgencyMediaSettings("csrf-proof", {
    expectedRevision: 4, reportMediaAllowanceBytes: 80 * 1024 * 1024,
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
