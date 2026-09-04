import assert from "node:assert/strict";
import test from "node:test";
import { encounterDocumentDiagnostics } from "../app/encounter-document";
import { DEMO_PROVENANCE_ATTRIBUTE, DEMO_PROVENANCE_VALUE, hasDemoProvenance } from "../app/demo-provenance";
import { encounterDocumentToDraftMutations } from "../app/draft-report";
import { NEMSIS_DATA_MODEL } from "../app/nemsis-data-model";
import { bundledEncounterDefinition, syntheticEncounter } from "../app/standard-encounter";
import { clearStationaryDemoData, populateStationaryDemoData } from "../app/stationary-demo-data";
import { COMPILED_STATIONARY_LAYOUT } from "../app/stationary-layout";
import { editScalarOccurrence } from "../app/stationary-scalar";

const editableGroups = new Set(COMPILED_STATIONARY_LAYOUT.groups.filter(({ mode }) => mode !== "read-only").map(({ id }) => id));
const editableElements = new Set(COMPILED_STATIONARY_LAYOUT.elements.filter(({ mode }) => mode !== "read-only").map(({ id }) => id));

test("Populate deterministically covers every editable element and repeating structure without replacing existing values", () => {
  const baseline = structuredClone(syntheticEncounter.document);
  const existingValues = new Map(baseline.groups.flatMap((group) => group.instances.flatMap((instance) => instance.elements.flatMap((element) =>
    element.values.map((value) => [value.occurrenceId, value] as const)))));
  const populated = populateStationaryDemoData(baseline);

  assert.deepEqual(populateStationaryDemoData(populated), populated, "a repeated Populate is idempotent");
  for (const [occurrenceId, original] of existingValues) {
    const current = populated.groups.flatMap(({ instances }) => instances).flatMap(({ elements }) => elements)
      .flatMap(({ values }) => values).find((value) => value.occurrenceId === occurrenceId);
    assert.deepEqual(current, original, `existing occurrence ${occurrenceId} is preserved`);
  }

  for (const group of NEMSIS_DATA_MODEL.groups.filter(({ id }) => editableGroups.has(id))) {
    const occurrences = populated.groups.find(({ id }) => id === group.id)?.instances ?? [];
    assert.ok(occurrences.length > 0, `${group.id} has a representative occurrence`);
    if (group.parentId) for (const parent of populated.groups.find(({ id }) => id === group.parentId)?.instances ?? []) {
      assert.ok(occurrences.some(({ parentInstanceId }) => parentInstanceId === parent.instanceId), `${group.id} is represented beneath ${parent.instanceId}`);
    }
  }
  for (const element of NEMSIS_DATA_MODEL.elements.filter(({ id }) => editableElements.has(id))) {
    const groupId = element.groupPath.at(-1)!;
    for (const instance of populated.groups.find(({ id }) => id === groupId)?.instances ?? []) {
      assert.ok(instance.elements.find(({ id }) => id === element.id)?.values.length, `${element.id} is populated in ${instance.instanceId}`);
    }
  }
  assert.deepEqual(encounterDocumentDiagnostics(populated, {
    formProfiles: { [bundledEncounterDefinition.id]: [String(bundledEncounterDefinition.version)] },
  }), []);
});

test("Clear removes only explicitly provenanced demo values and group instances", () => {
  const baseline = structuredClone(syntheticEncounter.document);
  const populated = populateStationaryDemoData(baseline);
  const generatedValues = populated.groups.flatMap(({ instances }) => instances).flatMap(({ elements }) => elements)
    .flatMap(({ values }) => values).filter((value) => hasDemoProvenance(value.attributes));
  const generatedGroups = populated.groups.flatMap(({ instances }) => instances).filter((instance) => hasDemoProvenance(instance.attributes));
  assert.ok(generatedValues.length > 400);
  assert.ok(generatedGroups.length > 50);

  const cleared = clearStationaryDemoData(populated);
  assert.deepEqual(cleared.groups, baseline.groups);
  assert.deepEqual(clearStationaryDemoData(cleared).groups, baseline.groups, "a repeated Clear is idempotent");
});

test("ordinary draft mutations carry explicit, durable demo provenance", () => {
  const reportId = syntheticEncounter.document.encounter.id;
  const populated = populateStationaryDemoData(syntheticEncounter.document);
  const mutations = encounterDocumentToDraftMutations(reportId, populated);
  const demoOccurrences = mutations.occurrences.filter(({ provenanceKind }) => provenanceKind === "demo");
  const demoGroups = mutations.groups.filter(({ correlationId }) => correlationId?.startsWith("demo:stationary-populate-v1:"));
  assert.ok(demoOccurrences.length > 400);
  assert.ok(demoGroups.length > 50);
  assert.ok(demoOccurrences.every(({ provenanceDetail, sourceAttributes }) => provenanceDetail?.generator === DEMO_PROVENANCE_VALUE
    && sourceAttributes?.[DEMO_PROVENANCE_ATTRIBUTE] === DEMO_PROVENANCE_VALUE));

  const cleared = clearStationaryDemoData(populated);
  const cleanup = encounterDocumentToDraftMutations(reportId, cleared, mutations);
  assert.equal(cleanup.occurrences.filter(({ tombstone }) => tombstone).length, demoOccurrences.length);
  assert.equal(cleanup.groups.filter(({ tombstone }) => tombstone).length, demoGroups.length);
});

test("editing a generated value transfers ownership to the clinician before Clear", () => {
  const populated = populateStationaryDemoData(syntheticEncounter.document);
  const narrative = populated.groups.find(({ id }) => id === "eNarrativeSection")!.instances[0]!;
  const occurrence = narrative.elements.find(({ id }) => id === "eNarrative.01")!.values[0]!;
  const edited = editScalarOccurrence(populated, {
    groupId: "eNarrativeSection", groupInstanceId: narrative.instanceId,
    elementId: "eNarrative.01", occurrenceId: occurrence.occurrenceId,
    input: "Clinician-entered narrative",
  });
  assert.equal(edited.ok, true);
  const cleared = clearStationaryDemoData(edited.document);
  const retained = cleared.groups.find(({ id }) => id === "eNarrativeSection")!.instances
    .find(({ instanceId }) => instanceId === narrative.instanceId)!;
  assert.equal(retained.elements.find(({ id }) => id === "eNarrative.01")!.values[0]!.kind, "scalar");
  assert.equal((retained.elements.find(({ id }) => id === "eNarrative.01")!.values[0] as { value: unknown }).value, "Clinician-entered narrative");
  assert.equal(hasDemoProvenance(retained.attributes), false);
});
