import assert from "node:assert/strict";
import test from "node:test";
import type { CatalogDraftCustomCodedElement } from "@open-triage/contracts";
import { customCodedChoices, customCodedValue, setCustomCodedValue } from "../components/custom-coded-fields";
import { syntheticEncounter } from "../app/standard-encounter";
import { loadEncounterDocument } from "../app/encounter-document";
import { encounterDocumentToDraftMutations } from "../app/draft-report";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomCodedFields } from "../components/custom-coded-fields";

const definition: CatalogDraftCustomCodedElement = {
  id: "d474249a-f946-4b96-8280-637782b2ef13", namespace: "org.example.ems", slug: "LocalFinding",
  title: "Local finding", definition: "Agency observation code.", datatype: "coded", recurrence: "single",
  usage: "Optional", identifying: false, codeSystem: "https://example.org/ems/finding",
  choices: [{ code: "A", label: "Alert", nemsisCode: "3326001" }], nemsisElement: "eVitals.26",
  permittedNotValues: ["7701003"], permittedPertinentNegatives: ["8801019"],
};

test("custom codes and exceptional attributes survive document and draft round trips", () => {
  const reportId = "7ab167d8-c730-4f83-a5f6-9b965b9a25ce";
  const initial = syntheticEncounter.document;
  const coded = setCustomCodedValue(initial, definition, { kind: "coded", occurrenceId: "local-choice",
    code: "A", system: definition.codeSystem, display: "Alert", notValue: { code: "7701003" },
    pertinentNegative: { code: "8801019" } });
  const reopened = loadEncounterDocument(coded);
  assert.deepEqual(customCodedValue(reopened, definition), customCodedValue(coded, definition));
  const mutation = encounterDocumentToDraftMutations(reportId, reopened, undefined, { [definition.id]: definition })
    .occurrences.find(({ elementId }) => elementId === "org.example.ems.LocalFinding");
  assert.equal(mutation?.value?.kind, "coded");
  if (mutation?.value?.kind === "coded") {
    assert.equal(mutation.value.code, "A");
    assert.equal(mutation.value.codeSystem, definition.codeSystem);
    assert.equal(mutation.value.notValue?.code, "7701003");
    assert.equal(mutation.value.pertinentNegative?.code, "8801019");
  }
  const negative = setCustomCodedValue(reopened, definition, { kind: "pertinent-negative", occurrenceId: "local-choice", code: "8801019" });
  assert.equal(customCodedValue(loadEncounterDocument(negative), definition)?.kind, "pertinent-negative");
});

test("custom codes create the root occurrence in a new patient report", () => {
  const blank = { ...syntheticEncounter.document, groups: [] };
  const next = setCustomCodedValue(blank, definition, { kind: "coded", occurrenceId: "local-choice",
    code: "A", system: definition.codeSystem, display: "Alert" });
  assert.equal(customCodedValue(next, definition)?.kind, "coded");
  assert.equal(next.groups[0]?.id, "PatientCareReportGroup");
  assert.equal(next.groups[0]?.instances.length, 1);
});

test("clinical picker shows the form's ordered codes and enabled exceptional values", () => {
  const field = { key: "finding", source: { kind: "custom" as const, elementDefinitionId: definition.id },
    choicePolicy: [{ kind: "not-value" as const, code: "7701003" },
      { kind: "code" as const, code: "A", codeSystem: definition.codeSystem }],
    allowedAbsenceStates: ["7701003", "8801019"] };
  const markup = renderToStaticMarkup(createElement(CustomCodedFields, {
    document: syntheticEncounter.document,
    fields: [field],
    definitions: { [definition.id]: definition }, onDocumentChange() {},
  }));
  assert.deepEqual(customCodedChoices(field, definition).map(({ label }) => label),
    ["NOT 7701003", "Alert", "PN 8801019"]);
  assert.match(markup, /clinical-searchable-trigger/);
  assert.match(markup, /org.example.ems.LocalFinding/);
});
