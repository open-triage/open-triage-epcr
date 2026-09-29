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

test("custom scalar values preserve type through document and draft round trips", () => {
  const reportId = "7ab167d8-c730-4f83-a5f6-9b965b9a25ce";
  const fields = {
    number: { ...definition, id: "bbe549cc-a1cd-4f81-87a3-2024a8e65f13", slug: "Dose", datatype: "number" as const,
      constraints: { minimum: 0, maximum: 100 } },
    dateTime: { ...definition, id: "daaf39a1-46e5-4f90-8ea1-52a51e559419", slug: "ObservedAt", datatype: "dateTime" as const,
      constraints: {} },
    boolean: { ...definition, id: "77fb11fa-098a-4869-a29c-bf099c41ef16", slug: "Confirmed", datatype: "boolean" as const,
      constraints: {} },
  };
  const definitions = Object.fromEntries(Object.values(fields).map((field) => [field.id, field]));
  let document = syntheticEncounter.document;
  document = setCustomTextValue(document, fields.number, 2.5);
  document = setCustomTextValue(document, fields.dateTime, "2026-09-29T10:30:00+02:00");
  document = setCustomTextValue(document, fields.boolean, false);
  const reopened = loadEncounterDocument(document);
  assert.equal(customTextValue(reopened, fields.number), "2.5");
  assert.equal(customTextValue(reopened, fields.dateTime), "2026-09-29T10:30:00+02:00");
  assert.equal(customTextValue(reopened, fields.boolean), "false");
  const values = encounterDocumentToDraftMutations(reportId, reopened, undefined, definitions).occurrences;
  assert.ok(values.some(({ elementId, value }) => elementId === customTextIdentity(fields.number) && value?.kind === "numeric" && value.value === 2.5));
  assert.ok(values.some(({ elementId, value }) => elementId === customTextIdentity(fields.dateTime) && value?.kind === "datetime" && value.value === "2026-09-29T10:30:00+02:00"));
  assert.ok(values.some(({ elementId, value }) => elementId === customTextIdentity(fields.boolean) && value?.kind === "boolean" && value.value === false));
  assert.equal(customTextValue(setCustomTextValue(reopened, fields.boolean, null), fields.boolean), "");
  assert.deepEqual(customTextFindings(fields.boolean, false), []);
  assert.ok(customTextFindings(fields.boolean, null).length);
  assert.ok(customTextFindings(fields.number, 101).length);
  assert.ok(customTextFindings(fields.dateTime, "2026-09-29T10:30").length);
});
