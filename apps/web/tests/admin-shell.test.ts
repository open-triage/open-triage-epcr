import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClinicianSession } from "@open-triage/contracts";
import { activateStationaryForm, loadAdminContext, publishStationaryFormDraft, saveCatalogDraft, saveStationaryFormDraft, searchFormCatalog } from "../app/admin-context";
import { AdminShell } from "../components/admin-shell";
import { CatalogCodeListEditor, moveCodeValue } from "../components/catalog-authoring";
import { addFormElement, FormElementPicker, FormSectionElements, moveFormElement, removeFormElement } from "../components/form-authoring";
import { affectedFieldNames, formStructuralSummary, moveFormSection, removeFormSection, StationaryFormAuthoring, StationarySectionControls } from "../components/stationary-form-authoring";
import { configuredStationaryPreviewSections } from "../app/stationary-record";
import { syntheticEncounter } from "../app/standard-encounter";
import { createStationaryPreviewDocument, stationaryPreviewFindings, StationaryFormPreview } from "../components/stationary-form-preview";

const session: ClinicianSession = {
  csrfToken: "csrf",
  user: { id: "owner-id", displayName: "Installation Owner" },
  organization: { id: "organization-id", name: "Example EMS" },
  startedAt: "2026-09-06T12:00:00.000Z",
  expiresAt: "2026-09-06T20:00:00.000Z",
  capabilities: ["installation:administer", "clinical:document"]
};

test("Admin panels use one persistent side-tab navigator", () => {
  const markup = renderToStaticMarkup(createElement(AdminShell, { session }));
  assert.match(markup, /aria-labelledby="admin-heading"/);
  assert.match(markup, /class="admin-tabs"/);
  assert.match(markup, />Element catalog<\/button>/);
  assert.match(markup, />Stationary form<\/button>/);
  assert.match(markup, />Audit Log<\/button>/);
  assert.doesNotMatch(markup, /admin-placeholder-grid/);
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
  const draft = { id: "draft-id", displayName: "Agency Catalog", sourceReleaseId: "release-id", revision: 7,
    definitionSha256: "a".repeat(64), updatedAt: "2026-09-06T12:00:00.000Z",
    definition: { schemaVersion: 1 as const, sourceReleaseId: "release-id", elements: [], codeLists: [] } };
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.method, "PUT");
    assert.equal((init?.headers as Record<string, string>)["x-csrf-token"], "csrf-proof");
    assert.deepEqual(JSON.parse(String(init?.body)), { expectedRevision: 7, displayName: "Agency Catalog", definition: draft.definition });
    return Response.json({ ...draft, revision: 8 });
  };
  assert.equal((await saveCatalogDraft("csrf-proof", draft)).revision, 8);
});

const codeList = { listId: "activity", name: "Patient Activity", classification: "suggested" as const,
  elementIds: ["eSituation.01"], defaultValue: null, values: [
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
  { key: "patient", fields: [
    { key: "name", source: { kind: "nemsis" as const, elementId: "ePatient.02" } },
    { key: "age", source: { kind: "nemsis" as const, elementId: "ePatient.15" } }
  ] },
  { key: "assessment", fields: [{ key: "impression", source: { kind: "nemsis" as const, elementId: "eSituation.11" } }] }
] };
const catalogElement = { elementId: "ePatient.01", name: "Patient Care Report Number",
  description: "The patient care report number.", baseDatatype: "string", groupPath: ["ePatient"] };

test("section operations preserve canonical content while changing only section scope and sequence", () => {
  const moved = moveFormSection(formDefinition, 1, 0);
  assert.deepEqual(moved.sections.map(({ key }) => key), ["assessment", "patient"]);
  assert.deepEqual(moved.sections[0]?.fields, formDefinition.sections[1]?.fields);
  assert.deepEqual(affectedFieldNames(formDefinition.sections[0]!), ["name (ePatient.02)", "age (ePatient.15)"]);
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
  assert.match(controls, /2 affected fields/);
  assert.match(controls, /name \(ePatient\.02\)/);
  assert.match(controls, /Confirm removal/);
});

test("draft preview projects only configured sections and fields through Stationary groups", () => {
  const sections = configuredStationaryPreviewSections(formDefinition);
  assert.deepEqual(sections.map(({ label }) => label), ["patient", "assessment"]);
  assert.deepEqual(sections[0]!.blocks.flatMap(({ elementIds }) => elementIds), ["ePatient.02", "ePatient.15"]);
  assert.deepEqual(sections[1]!.blocks.flatMap(({ elementIds }) => elementIds), ["eSituation.11"]);
  const included = sections.flatMap(({ blocks }) => blocks.flatMap(({ elementIds }) => elementIds));
  assert.equal(included.includes("ePatient.01"), false);
});

test("Stationary preview is interactive, explicitly ephemeral, and leaves the fixture detached", () => {
  const baseline = structuredClone(syntheticEncounter.document);
  const previewDocument = createStationaryPreviewDocument();
  assert.notStrictEqual(previewDocument, syntheticEncounter.document);
  assert.deepEqual(syntheticEncounter.document, baseline);
  const draft = { id: "draft-id", displayName: "Night Shift Form", formId: "form-id", catalogReleaseId: "catalog-id", clonedFromId: "source-id",
    revision: 4, definitionSha256: "a".repeat(64), definition: formDefinition, diagnostics: [],
    catalogFields: { "eSituation.11": { agencyRequired: false, minOccurs: 0, maxOccurs: 1, nillable: true,
      supportsNotValues: true, supportsPertinentNegatives: false,
      codeChoices: [
        { code: "R10.0", codeSystem: "ICD-10-CM", label: "Acute pain" },
        { code: "AGENCY-1", codeSystem: "LOCAL", label: "Agency custom choice" }
      ] } },
    updatedAt: "2026-09-07T01:00:00.000Z" };
  const markup = renderToStaticMarkup(createElement(StationaryFormPreview, { draft, onReturn() {} }));
  assert.match(markup, /Interactive fictional data only/);
  assert.match(markup, /Return to form draft/);
  assert.match(markup, /aria-label="Complete stationary NEMSIS record"/);
  assert.match(markup, /data-element-id="ePatient\.02"/);
  assert.match(markup, /Acute pain/);
  assert.match(markup, /Agency custom choice/);
  assert.doesNotMatch(markup, /data-element-id="ePatient\.01"/);
});

test("preview validation is scoped to included fields and honors an explicit optional override", () => {
  const document = createStationaryPreviewDocument();
  const groups = document.groups.map((group) => ({ ...group, instances: group.instances.map((instance) => ({
    ...instance,
    elements: instance.elements.map((element) => element.id === "ePatient.15" ? { ...element, values: [] } : element),
  })) }));
  const draft = { id: "draft-id", displayName: "Night Shift Form", formId: "form-id", catalogReleaseId: "catalog-id", clonedFromId: "source-id",
    revision: 4, definitionSha256: "a".repeat(64), definition: { schemaVersion: 1 as const, sections: [{ key: "patient", fields: [
      { key: "age", source: { kind: "nemsis" as const, elementId: "ePatient.15" }, required: false }
    ] }] }, diagnostics: [], updatedAt: "2026-09-07T01:00:00.000Z" };
  assert.equal(stationaryPreviewFindings({ ...document, groups }, draft).some((finding) => finding.target.fieldId === "ePatient.15"), false);
});

test("form saves send section order with the current revision and CSRF proof", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const draft = { id: "draft-id", displayName: "Night Shift Form", formId: "form-id", catalogReleaseId: "catalog-id", clonedFromId: "source-id",
    revision: 4, definitionSha256: "a".repeat(64), definition: moveFormSection(formDefinition, 1, 0), diagnostics: [],
    updatedAt: "2026-09-07T01:00:00.000Z" };
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.method, "PUT");
    assert.equal((init?.headers as Record<string, string>)["x-csrf-token"], "csrf-proof");
    assert.deepEqual(JSON.parse(String(init?.body)), { expectedRevision: 4, displayName: "Night Shift Form", definition: draft.definition });
    return Response.json({ ...draft, revision: 5 });
  };
  assert.equal((await saveStationaryFormDraft("csrf-proof", draft)).revision, 5);
});

test("form review summarizes structure and publication stays separate from activation", async (t) => {
  assert.equal(formStructuralSummary(formDefinition), "2 sections and 3 elements");
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const paths: string[] = [];
  globalThis.fetch = async (input, init) => {
    paths.push(String(input));
    assert.equal((init?.headers as Record<string, string>)["x-csrf-token"], "csrf-proof");
    if (String(input).endsWith("/form-drafts/draft-id/publish")) {
      assert.deepEqual(JSON.parse(String(init?.body)), { expectedRevision: 4,
        definitionSha256: "a".repeat(64), displayName: "Night Shift Form", changeNote: "Reviewed" });
      return Response.json({ id: "draft-id", status: "published" });
    }
    assert.deepEqual(JSON.parse(String(init?.body)), { changeNote: "Deploy" });
    return Response.json({ formVersionId: "draft-id" });
  };
  const draft = { id: "draft-id", formId: "form-id", catalogReleaseId: "catalog-id", clonedFromId: "source-id",
    revision: 4, definitionSha256: "a".repeat(64), definition: formDefinition, diagnostics: [],
    updatedAt: "2026-09-07T01:00:00.000Z" };
  await publishStationaryFormDraft("csrf-proof", draft, "Night Shift Form", "Reviewed");
  assert.equal(paths.length, 1, "publication did not activate the form");
  await activateStationaryForm("csrf-proof", "draft-id", "Deploy");
  assert.match(paths[1]!, /form-versions\/draft-id\/activate$/);
});

test("form catalog picker is searchable, labels duplicates, and exposes an add control", () => {
  const markup = renderToStaticMarkup(createElement(FormElementPicker, { definition: formDefinition,
    results: [catalogElement, { ...catalogElement, elementId: "ePatient.02", name: "Last Name" }], query: "patient",
    targetSection: "patient", onQueryChange() {}, onSectionChange() {}, onAdd() {} }));
  assert.match(markup, /type="search"/);
  assert.match(markup, /aria-label="Add ePatient.01"/);
  assert.match(markup, /ePatient.02 is already in the form/);
  assert.match(markup, /Already added/);
});

test("form element helpers prevent duplicates and add, remove, and reorder immutably", () => {
  const original = structuredClone(formDefinition);
  const added = addFormElement(formDefinition, "patient", catalogElement);
  assert.deepEqual(added.sections[0]!.fields.map((field) => field.source.kind === "nemsis" && field.source.elementId),
    ["ePatient.02", "ePatient.15", "ePatient.01"]);
  assert.throws(() => addFormElement(added, "patient", catalogElement), /already in the form/);
  const moved = moveFormElement(added, "patient", 2, 0);
  assert.equal(moved.sections[0]!.fields[0]!.key, "ePatient.01");
  assert.deepEqual(removeFormElement(moved, "patient", "ePatient.01"), formDefinition);
  assert.deepEqual(formDefinition, original);
});

test("form element rows provide keyboard-operable move and confirmed remove controls", () => {
  const markup = renderToStaticMarkup(createElement(FormSectionElements, { definition: formDefinition, onChange() {} }));
  assert.match(markup, /aria-label="Move ePatient.02 up"/);
  assert.match(markup, /aria-label="Move ePatient.15 down"/);
  assert.match(markup, /aria-label="Remove ePatient.02"/);
  assert.match(markup, /aria-expanded="true"/);
  assert.match(markup, /<small>Last Name<\/small>/);
});

test("form search sends the searchable query without pagination", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input) => {
    assert.match(String(input), /catalog-elements\?query=patient%20name$/);
    return Response.json({ items: [], nextOffset: null });
  };
  await searchFormCatalog("csrf-proof", "draft-id", "patient name");
});
