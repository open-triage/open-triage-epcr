import assert from "node:assert/strict";
import test from "node:test";
import type { CatalogDraftCustomCodedElement, CatalogDraftCustomTextElement, EncounterDocument } from "@open-triage/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { syntheticEncounter } from "../app/standard-encounter";
import { loadEncounterDocument } from "../app/encounter-document";
import { encounterDocumentToDraftMutations } from "../app/draft-report";
import { RepeatedCustomFields, customValues, setCustomOccurrence } from "../components/repeated-custom-fields";

const reportId = "7ab167d8-c730-4f83-a5f6-9b965b9a25ce";
const text: CatalogDraftCustomTextElement = {
  id: "da77b0fc-a701-41b0-a387-18b07662ed71", namespace: "org.example.ems", slug: "ResponseNote",
  title: "Response note", definition: "Local medication response.", datatype: "string", recurrence: "multiple",
  correlatesTo: "eMedications.MedicationGroup", usage: "Optional", constraints: {}, identifying: false,
};
const coded: CatalogDraftCustomCodedElement = {
  ...text, id: "d474249a-f946-4b96-8280-637782b2ef13", slug: "ResponseCode", datatype: "coded",
  codeSystem: "https://example.org/ems/response", choices: [{ code: "A", label: "Improved" }],
  permittedNotValues: ["7701003"], permittedPertinentNegatives: ["8801019"],
};
const groupId = "eMedications.MedicationGroup";
const firstId = "med-entry-first";
const secondId = "med-entry-second";
const document: EncounterDocument = { ...syntheticEncounter.document, groups: [
  ...syntheticEncounter.document.groups.filter((group) => group.id !== groupId),
  { id: groupId, instances: [{ instanceId: firstId, elements: [] }, { instanceId: secondId, elements: [] }] },
] };

function target(doc: EncounterDocument, id: string) {
  return doc.groups.find((group) => group.id === groupId)!.instances.find((instance) => instance.instanceId === id)!;
}

test("repeated values bind to stable medication entries through reload and draft projection", () => {
  assert.throws(() => setCustomOccurrence(document, text, "missing", { kind: "scalar", occurrenceId: "bad", value: "Bad" }),
    /Missing custom correlation target/);
  const one = setCustomOccurrence(document, text, firstId, { kind: "scalar", occurrenceId: "one", value: "Better" });
  const two = setCustomOccurrence(one, text, secondId, { kind: "scalar", occurrenceId: "two", value: "No change" });
  const three = setCustomOccurrence(two, text, firstId, { kind: "scalar", occurrenceId: "three", value: "Reassessed" });
  const reopened = loadEncounterDocument(three);
  assert.deepEqual(customValues(target(reopened, firstId), text).map((value) => value.occurrenceId), ["one", "three"]);
  assert.deepEqual(customValues(target(reopened, secondId), text).map((value) => value.occurrenceId), ["two"]);
  const projected = encounterDocumentToDraftMutations(reportId, reopened, undefined, { [text.id]: text });
  const groups = new Map(projected.groups.map((group) => [group.id, group.groupId]));
  const occurrences = projected.occurrences.filter((item) => item.elementId === "org.example.ems.ResponseNote");
  assert.equal(occurrences.length, 3);
  assert.ok(occurrences.every((item) => groups.get(item.groupInstanceId) === groupId));
  const byValue = new Map(occurrences.map((item) => [item.value?.kind === "text" ? item.value.value : "", item.groupInstanceId]));
  assert.equal(byValue.get("Better"), byValue.get("Reassessed"));
  assert.notEqual(byValue.get("Better"), byValue.get("No change"));
});

test("coded and exceptional values survive separate repeated targets", () => {
  const one = setCustomOccurrence(document, coded, firstId, { kind: "coded", occurrenceId: "coded-one", code: "A",
    system: coded.codeSystem, notValue: { code: "7701003" }, pertinentNegative: { code: "8801019" } });
  const two = setCustomOccurrence(one, coded, secondId, { kind: "pertinent-negative", occurrenceId: "coded-two", code: "8801019" });
  const projected = encounterDocumentToDraftMutations(reportId, loadEncounterDocument(two), undefined, { [coded.id]: coded });
  const choices = projected.occurrences.filter((item) => item.elementId === "org.example.ems.ResponseCode");
  assert.equal(choices.length, 2);
  assert.equal(choices[0]?.value?.kind, "coded");
  assert.equal(choices[1]?.value?.kind, "pertinent-negative");
  assert.notEqual(choices[0]?.groupInstanceId, choices[1]?.groupInstanceId);
});

test("section placement does not change rendered target identities", () => {
  const withValue = setCustomOccurrence(document, text, secondId, { kind: "scalar", occurrenceId: "two", value: "Observed" });
  const field = { key: "response", source: { kind: "custom" as const, elementDefinitionId: text.id } };
  const render = (sectionKey: string) => renderToStaticMarkup(createElement(RepeatedCustomFields, {
    document: withValue, fields: [{ ...field, key: sectionKey }], definitions: { [text.id]: text }, onDocumentChange() {},
  }));
  for (const section of ["history", "treatment"]) {
    const markup = render(section);
    assert.match(markup, /data-custom-target-id="med-entry-first"/);
    assert.match(markup, /data-custom-target-id="med-entry-second"/);
    assert.match(markup, /data-custom-occurrence-id="two"/);
  }
});
