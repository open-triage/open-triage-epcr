import assert from "node:assert/strict";
import test from "node:test";
import type { CatalogDraftCustomTextElement } from "@open-triage/contracts";
import { customTextFindings, customTextIdentity, customTextValue, setCustomTextValue } from "../components/custom-text-fields";
import { syntheticEncounter } from "../app/standard-encounter";
import { loadEncounterDocument } from "../app/encounter-document";
import { encounterDocumentToDraftMutations } from "../app/draft-report";

const definition: CatalogDraftCustomTextElement = {
  id: "da77b0fc-a701-41b0-a387-18b07662ed71", namespace: "org.example.ems", slug: "LocalNote",
  title: "Local note", definition: "A locally requested clinical note.", datatype: "string",
  recurrence: "single", usage: "Required", constraints: { minLength: 2, maxLength: 100 }, identifying: false,
};

test("standalone custom text keeps its identity through document validation and draft projection", () => {
  const initial = syntheticEncounter.document;
  const next = setCustomTextValue(initial, definition, "Documented");
  assert.equal(customTextValue(next, definition), "Documented");
  assert.equal(customTextValue(loadEncounterDocument(next), definition), "Documented");
  assert.ok(encounterDocumentToDraftMutations("7ab167d8-c730-4f83-a5f6-9b965b9a25ce", next).occurrences
    .some(({ elementId, value }) => elementId === customTextIdentity(definition) && value?.kind === "text" && value.value === "Documented"));
  assert.equal(customTextValue(setCustomTextValue(next, definition, ""), definition), "");
});

test("custom text usage and constraints surface invalid values", () => {
  assert.ok(customTextFindings(definition, "").length);
  assert.ok(customTextFindings(definition, "x").length);
  assert.deepEqual(customTextFindings(definition, "Valid"), []);
});
