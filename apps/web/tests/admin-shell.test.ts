import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClinicianSession } from "@open-triage/contracts";
import { loadAdminContext, saveCatalogDraft, saveStationaryFormDraft } from "../app/admin-context";
import { AdminShell } from "../components/admin-shell";
import { CatalogCodeListEditor, moveCodeValue } from "../components/catalog-authoring";
import { affectedFieldNames, moveFormSection, removeFormSection, StationaryFormAuthoring, StationarySectionControls } from "../components/stationary-form-authoring";

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
    definition: { schemaVersion: 1 as const, sourceReleaseId: "release-id", elements: [], codeLists: [] } };
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.method, "PUT");
    assert.equal((init?.headers as Record<string, string>)["x-csrf-token"], "csrf-proof");
    assert.deepEqual(JSON.parse(String(init?.body)), { expectedRevision: 7, definition: draft.definition });
    return Response.json({ ...draft, revision: 8 });
  };
  assert.equal((await saveCatalogDraft("csrf-proof", draft)).revision, 8);
});

const codeList = { listId: "activity", name: "Patient Activity", classification: "suggested" as const,
  defaultValue: null, values: [
    { code: "ONE", codeSystem: "LOCAL", label: "First", sourceLabel: "First", category: null, enabled: true },
    { code: "TWO", codeSystem: "LOCAL", label: "Second", sourceLabel: "Second", category: null, enabled: true }
  ] };

test("code-list controls expose labeled editing, state, default, and keyboard-operable ordering", () => {
  const markup = renderToStaticMarkup(createElement(CatalogCodeListEditor, { list: codeList, onChange: () => {} }));
  assert.match(markup, /<legend>Add value<\/legend>/);
  assert.match(markup, /aria-label="Move First up"/);
  assert.match(markup, /aria-label="Move Second down"/);
  assert.equal((markup.match(/Enabled<\/label>/g) ?? []).length, 2);
  assert.equal((markup.match(/Default<\/label>/g) ?? []).length, 2);
});

test("accessible move controls reorder values without changing code identity", () => {
  const moved = moveCodeValue(codeList, 1, 0);
  assert.deepEqual(moved.values.map(({ code }) => code), ["TWO", "ONE"]);
  assert.equal(moveCodeValue(codeList, 0, -1), codeList);
});

const formDefinition = { schemaVersion: 1 as const, sections: [
  { key: "patient", fields: [{ key: "name", source: { kind: "nemsis" as const, elementId: "ePatient.02" } }] },
  { key: "assessment", fields: [{ key: "impression", source: { kind: "nemsis" as const, elementId: "eSituation.11" } }] }
] };

test("section operations preserve canonical content while changing only section scope and sequence", () => {
  const moved = moveFormSection(formDefinition, 1, 0);
  assert.deepEqual(moved.sections.map(({ key }) => key), ["assessment", "patient"]);
  assert.deepEqual(moved.sections[0]?.fields, formDefinition.sections[1]?.fields);
  assert.deepEqual(affectedFieldNames(formDefinition.sections[0]!), ["name (ePatient.02)"]);
  const removed = removeFormSection(formDefinition, 0);
  assert.deepEqual(removed.sections.map(({ key }) => key), ["assessment"]);
  assert.throws(() => removeFormSection(removed, 0), /at least one section/);
});

test("Stationary section controls are named, keyboard-operable buttons with affected-field confirmation", () => {
  const markup = renderToStaticMarkup(createElement(StationaryFormAuthoring, { csrfToken: "csrf", catalogReleaseId: "catalog-id" }));
  assert.match(markup, /Loading Stationary form draft/);
  const controls = renderToStaticMarkup(createElement(StationarySectionControls, { definition: formDefinition, pendingRemoval: 0,
    onMove: () => {}, onRequestRemoval: () => {}, onConfirmRemoval: () => {}, onCancelRemoval: () => {} }));
  assert.match(controls, /aria-label="Move patient down"/);
  assert.match(controls, /aria-label="Move assessment up"/);
  assert.match(controls, /role="alertdialog"/);
  assert.match(controls, /1 affected field/);
  assert.match(controls, /name \(ePatient\.02\)/);
  assert.match(controls, /Confirm removal/);
});

test("form saves send section order with the current revision and CSRF proof", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const draft = { id: "draft-id", formId: "form-id", catalogReleaseId: "catalog-id", clonedFromId: "source-id",
    revision: 4, definitionSha256: "a".repeat(64), definition: moveFormSection(formDefinition, 1, 0), diagnostics: [],
    updatedAt: "2026-09-07T01:00:00.000Z" };
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.method, "PUT");
    assert.equal((init?.headers as Record<string, string>)["x-csrf-token"], "csrf-proof");
    assert.deepEqual(JSON.parse(String(init?.body)), { expectedRevision: 4, definition: draft.definition });
    return Response.json({ ...draft, revision: 5 });
  };
  assert.equal((await saveStationaryFormDraft("csrf-proof", draft)).revision, 5);
});
