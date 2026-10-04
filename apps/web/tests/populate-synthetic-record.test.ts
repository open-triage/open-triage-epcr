import assert from "node:assert/strict";
import test from "node:test";
import { compileValidationRule, compiledValidationBundleSha256, type ClinicalFormConfiguration } from "@open-triage/contracts";
import { validationProblems } from "@open-triage/contracts/synthetic-record-generator";
import { populateSyntheticRecord } from "../app/populate-synthetic-record";
import { syntheticEncounter } from "../app/standard-encounter";
import { clearStationaryDemoData } from "../app/stationary-demo-data";
import { hasDemoProvenance } from "../app/demo-provenance";
import { encounterDocumentToDraftMutations, recoveryMutationBatches } from "../app/draft-report";

const now = new Date("2026-10-04T12:00:00Z");
function fixture(source = 'require equals("eVitals.10", 72)') {
  const document = structuredClone(syntheticEncounter.document);
  const rule = compileValidationRule({ id: "pulse-rule", name: "Pulse", enabled: true, severity: "error",
    executionTargets: ["live", "sign"], primaryTargetElementId: "eVitals.10", message: "Pulse must be 72", source },
    "version", new Set(["eVitals.10"]));
  assert.deepEqual(rule.diagnostics, []);
  const bundle = { schemaVersion: 1 as const, languageVersion: "1.0.0" as const, validationVersionId: "version",
    catalogReleaseId: "release", rules: [rule.compiled!] };
  const configuration: ClinicalFormConfiguration = {
    definition: { schemaVersion: 1, sections: [{ key: "vitals", fields: [
      { key: "pulse", source: { kind: "nemsis", elementId: "eVitals.10" } },
      { key: "time", source: { kind: "nemsis", elementId: "eVitals.01" } },
      { key: "method", source: { kind: "nemsis", elementId: "eVitals.11" }, choicePolicy: [{ kind: "code", code: "3311003", codeSystem: "" }] },
    ] }] },
    catalogFields: Object.fromEntries([
      ["eVitals.10", "integer"], ["eVitals.01", "dateTime"], ["eVitals.11", "string"],
    ].map(([id, base]) => [id, { agencyRequired: false, minOccurs: 0, maxOccurs: 1, nillable: false,
      supportsNotValues: false, supportsPertinentNegatives: false,
      codeChoices: id === "eVitals.11" ? ["3311001", "3311003"].map(code => ({ code, label: code, codeSystem: "" })) : [],
      generation: { id, base, path: ["eVitals.VitalGroup"], minimum: 0, maximum: 1,
        definition: { datatype: { constraints: base === "integer" ? { minInclusive: 20, maxInclusive: 250 } : {} },
          valueSource: { kind: id === "eVitals.11" ? "inline-enumerated" : "scalar" } } },
    }])),
    catalogGroups: { PatientCareReportGroup: { name: "Report", parentId: null },
      eVitalsSection: { name: "Vitals", parentId: "PatientCareReportGroup" },
      "eVitals.VitalGroup": { name: "Observation", parentId: "eVitalsSection" } },
    validation: { versionId: "version", bundle, compiledSha256: compiledValidationBundleSha256(bundle) },
  };
  // The draft's dispatch values remain; clinical observations start empty.
  return { document: { ...document, groups: document.groups.filter(group => !group.id.startsWith("eVitals")) }, configuration };
}

test("Populate uses pinned code choices and the CLI validator, preserves dispatch, and saves demo changes", () => {
  const { document, configuration } = fixture();
  const original = structuredClone(document);
  const populated = populateSyntheticRecord(document, configuration, now);
  assert.deepEqual(document, original, "generation must not mutate the current draft");
  const values = populated.groups.flatMap(group => group.instances.flatMap(instance => instance.elements));
  assert.equal(values.find(element => element.id === "eVitals.10")!.values[0]!.kind, "scalar");
  assert.equal((values.find(element => element.id === "eVitals.10")!.values[0] as { value: number }).value, 72);
  assert.equal((values.find(element => element.id === "eVitals.11")!.values[0] as { code: string }).code, "3311003");
  assert.deepEqual(validationProblems(configuration.validation!.bundle, populated, now.toISOString()), []);
  assert.deepEqual(populateSyntheticRecord(populated, configuration, now), populated);
  for (const group of original.groups) assert.deepEqual(populated.groups.find(item => item.id === group.id), group);
  const before = encounterDocumentToDraftMutations(document.encounter.id, document);
  const after = encounterDocumentToDraftMutations(document.encounter.id, populated, before);
  const batches = recoveryMutationBatches(after, before);
  assert.ok(batches.some(batch => batch.demoAction === "populate" && batch.occurrences.length));
  const cleared = clearStationaryDemoData(populated);
  for (const group of original.groups) assert.deepEqual(cleared.groups.find(item => item.id === group.id), group);
  assert.ok(!cleared.groups.some(group => group.instances.some(instance => instance.elements
    .some(element => element.values.some(value => hasDemoProvenance(value.attributes))))));
});

test("Populate keeps clinician values and fails without changing the draft when they contradict validation", () => {
  const { document, configuration } = fixture();
  document.groups.push({ id: "eVitals.VitalGroup", instances: [{ instanceId: "existing-vital", elements: [
    { id: "eVitals.10", values: [{ kind: "scalar", occurrenceId: "clinician-pulse", value: 90 }] },
  ] }] });
  const original = structuredClone(document);
  assert.throws(() => populateSyntheticRecord(document, configuration, now), /Could not satisfy active validation.*pulse-rule/);
  assert.deepEqual(document, original);
});

test("Populate uses pinned custom field constraints and parent groups", () => {
  const { document, configuration } = fixture();
  configuration.definition.sections[0]!.fields.push({ key: "score", source: { kind: "custom", elementDefinitionId: "custom-score" } });
  configuration.customFields = { "custom-score": { id: "custom-score", namespace: "local", slug: "score",
    title: "Score", definition: "Synthetic score", datatype: "number", usage: "Optional", recurrence: "single",
    constraints: { minimum: 6, maximum: 6 }, correlatesTo: "eVitals.VitalGroup" } as NonNullable<ClinicalFormConfiguration["customFields"]>[string] };
  const populated = populateSyntheticRecord(document, configuration, now);
  const score = populated.groups.find(group => group.id === "eVitals.VitalGroup")!.instances[0]!.elements
    .find(element => element.id === "local.score")!.values[0]!;
  assert.equal(score.kind === "scalar" && score.value, 6);
});

test("Populate rejects missing or corrupt pinned configuration", () => {
  const { document, configuration } = fixture();
  assert.throws(() => populateSyntheticRecord(document, { ...configuration, validation: undefined }, now), /pinned validation/);
  assert.throws(() => populateSyntheticRecord(document, { ...configuration,
    validation: { ...configuration.validation!, compiledSha256: "wrong" } }, now), /pinned validation/);
  delete configuration.catalogFields["eVitals.10"]!.generation;
  assert.throws(() => populateSyntheticRecord(document, configuration, now), /pinned catalog.*eVitals.10/);
});
