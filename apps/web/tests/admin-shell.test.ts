import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClinicianSession } from "@open-triage/contracts";
import { loadAdminContext, saveCatalogDraft } from "../app/admin-context";
import { AdminShell } from "../components/admin-shell";

const session: ClinicianSession = {
  csrfToken: "csrf",
  user: { id: "owner-id", displayName: "Installation Owner" },
  organization: { id: "organization-id", name: "Example EMS" },
  startedAt: "2026-09-06T12:00:00.000Z",
  expiresAt: "2026-09-06T20:00:00.000Z",
  capabilities: ["installation:administer", "clinical:document"]
};

test("every deferred Admin panel is labeled as a non-interactive unavailable placeholder", () => {
  const markup = renderToStaticMarkup(createElement(AdminShell, { session }));
  assert.match(markup, /aria-labelledby="admin-heading"/);
  assert.equal((markup.match(/Unavailable in this release\./g) ?? []).length, 11);
  assert.doesNotMatch(markup, /<(button|input|select|textarea)\b/);
});

test("Admin context reports direct authorization failures without trusting client claims", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response("Unauthorized", { status: 401 });
  await assert.rejects(loadAdminContext(), /not authorized/);
});

test("catalog saves send the current revision and CSRF proof", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const draft = { id: "draft-id", sourceReleaseId: "release-id", revision: 7,
    definitionSha256: "a".repeat(64), updatedAt: "2026-09-06T12:00:00.000Z",
    definition: { schemaVersion: 1 as const, sourceReleaseId: "release-id", elements: [] } };
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.method, "PUT");
    assert.equal((init?.headers as Record<string, string>)["x-csrf-token"], "csrf-proof");
    assert.deepEqual(JSON.parse(String(init?.body)), { expectedRevision: 7, definition: draft.definition });
    return Response.json({ ...draft, revision: 8 });
  };
  assert.equal((await saveCatalogDraft("csrf-proof", draft)).revision, 8);
});
