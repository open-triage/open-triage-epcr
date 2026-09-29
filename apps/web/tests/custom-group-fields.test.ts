import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CatalogDraftCustomGroup, CatalogDraftCustomTextElement, EncounterDocument } from "@open-triage/contracts";
import { syntheticEncounter } from "../app/standard-encounter";
import { encounterDocumentToDraftMutations } from "../app/draft-report";
import { addCustomGroupInstance, CustomGroupFields, removeCustomGroupInstance } from "../components/custom-group-fields";
import { setCustomOccurrence } from "../components/repeated-custom-fields";

const group: CatalogDraftCustomGroup = { id: "f064177e-d9aa-487e-b9d3-ad581e117b87", namespace: "org.example.ems",
  slug: "MedicationResponse", title: "Medication response", recurrence: "multiple", correlatesTo: "eMedications.MedicationGroup" };
const text: CatalogDraftCustomTextElement = { id: "d1519097-23a4-40e7-b097-631c8a134478", namespace: group.namespace,
  slug: "ResponseNote", title: "Response note", definition: "Response", datatype: "string", recurrence: "multiple",
  groupDefinitionId: group.id, correlatesTo: group.correlatesTo, usage: "Optional", constraints: {}, identifying: false };
const medId = "eMedications.MedicationGroup";
const groupId = `${group.namespace}.${group.slug}`;
const reportId = "52f691e6-1af7-425c-803f-e740b97176ba";
const base: EncounterDocument = { ...syntheticEncounter.document, groups: [
  ...syntheticEncounter.document.groups.filter((entry) => entry.id !== medId),
  { id: medId, instances: [{ instanceId: "med-a", elements: [] }, { instanceId: "med-b", elements: [] }] },
] };
const fields = [{ key: "response", source: { kind: "custom" as const, elementDefinitionId: text.id, groupDefinitionId: group.id } }];

test("grouped values keep their element, group, occurrence, and medication identities through projection", () => {
  assert.throws(() => addCustomGroupInstance(base, group, "missing", "bad"), /Missing custom group parent/);
  let document = addCustomGroupInstance(base, group, "med-a", "group-a");
  document = addCustomGroupInstance(document, group, "med-b", "group-b");
  document = setCustomOccurrence(document, text, "group-a", { kind: "scalar", occurrenceId: "value-a", value: "Better" }, undefined, groupId);
  document = setCustomOccurrence(document, text, "group-b", { kind: "scalar", occurrenceId: "value-b", value: "Worse" }, undefined, groupId);
  const projected = encounterDocumentToDraftMutations(reportId, JSON.parse(JSON.stringify(document)), undefined,
    { [text.id]: text }, { [group.id]: group });
  const groups = projected.groups.filter((entry) => entry.customGroupDefinitionId === group.id);
  assert.equal(groups.length, 2);
  assert.notEqual(groups[0]?.parentGroupInstanceId, groups[1]?.parentGroupInstanceId);
  const values = projected.occurrences.filter((entry) => entry.elementId === `${text.namespace}.${text.slug}`);
  assert.deepEqual(values.map((entry) => entry.value?.kind === "text" ? entry.value.value : ""), ["Better", "Worse"]);
  assert.deepEqual(values.map((entry) => entry.groupInstanceId), groups.map((entry) => entry.id));
  assert.deepEqual(encounterDocumentToDraftMutations(reportId, removeCustomGroupInstance(document, group, "group-a"), projected,
    { [text.id]: text }, { [group.id]: group }).groups.find((entry) => entry.id === groups[0]?.id)?.tombstone, true);
});

test("single group enforces one occurrence per parent and visual relocation preserves stable IDs", () => {
  const single = { ...group, recurrence: "single" as const };
  const document = addCustomGroupInstance(base, single, "med-a", "group-a");
  assert.throws(() => addCustomGroupInstance(document, single, "med-a", "other"), /one entry per target/);
  const render = (key: string) => renderToStaticMarkup(createElement(CustomGroupFields, {
    document, fields: fields.map((field) => ({ ...field, key })), definitions: { [text.id]: text },
    groups: { [group.id]: single }, onDocumentChange() {},
  }));
  for (const section of ["history", "treatment"]) {
    assert.match(render(section), /data-custom-group-instance-id="group-a"/);
    assert.match(render(section), /data-custom-group-parent-id="med-a"/);
    assert.match(render(section), /data-custom-group-parent-id="med-b"/);
  }
});
