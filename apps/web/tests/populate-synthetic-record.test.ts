import assert from "node:assert/strict";
import test from "node:test";
import { compileValidationRule, compiledValidationBundleSha256, type ClinicalFormConfiguration } from "@open-triage/contracts";
import { validationProblems } from "@open-triage/contracts/synthetic-record-generator";
import { populateSyntheticRecord } from "../app/populate-synthetic-record";
import { syntheticEncounter } from "../app/standard-encounter";
import { clearStationaryDemoData } from "../app/stationary-demo-data";
import { hasDemoProvenance } from "../app/demo-provenance";
import { encounterDocumentToDraftMutations, recoveryMutationBatches } from "../app/draft-report";
import { validateStationaryRecord } from "../app/stationary-validation";

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

function locationFixture() {
  const { document, configuration } = fixture();
  const codeChoices = [{ code: "Y92.0", codeSystem: "ICD-10-CM", label: "Private residence" }];
  configuration.definition.sections.push({ key: "scene", fields: [{ key: "location", source: { kind: "nemsis", elementId: "eScene.09" },
    choicePolicy: codeChoices.map(({ code, codeSystem }) => ({ kind: "code", code, codeSystem })) }] });
  configuration.catalogFields["eScene.09"] = {
    agencyRequired: false, minOccurs: 1, maxOccurs: 1, nillable: true, supportsNotValues: true, supportsPertinentNegatives: false,
    codeChoices, choiceOrder: codeChoices.map(({ code, codeSystem }) => ({ kind: "code", code, codeSystem })),
    generation: { id: "eScene.09", base: "string", path: ["eSceneSection"], minimum: 1, maximum: 1,
      definition: { datatype: { constraints: { pattern: "Y92\\.[0-9]{1,3}" } }, valueSource: { kind: "external-code-system" } } },
  };
  configuration.catalogGroups!["eSceneSection"] = { name: "Scene", parentId: "PatientCareReportGroup" };
  const scene = document.groups.find(group => group.id === "eSceneSection")!.instances[0]!;
  Object.assign(scene, { attributes: { "x-open-triage-owner": "dispatch" } });
  // Older open reports can still contain the location from the former dispatch fixture.
  const location = { id: "eScene.09", values: [{ kind: "coded" as const, occurrenceId: "legacy-dispatch-location",
    code: "Y92.03", system: "ICD-10-CM", display: "Apartment/condo" }] };
  Object.assign(scene, { elements: [...scene.elements, location] });
  return { document, configuration, scene, location };
}

test("Populate supplies the missing Incident Location Type from the report's pinned choices", () => {
  const { document, configuration, scene } = locationFixture();
  Object.assign(scene, { elements: scene.elements.filter(element => element.id !== "eScene.09") });
  const populated = populateSyntheticRecord(document, configuration, now);
  const selected = populated.groups.find(group => group.id === "eSceneSection")!.instances[0]!.elements
    .find(element => element.id === "eScene.09")!.values[0]!;
  assert.equal(selected.kind === "coded" && selected.code, "Y92.0");
  assert.ok(hasDemoProvenance(selected.attributes));
  assert.deepEqual(validateStationaryRecord(populated, configuration, now.toISOString()), []);
});

test("Populate replaces a disallowed dispatch location with a pinned choice and saves it as demo data", () => {
  const { document, configuration, location } = locationFixture();
  const original = structuredClone(document);
  assert.ok(validateStationaryRecord(document, configuration, now.toISOString())
    .some(finding => finding.message === "Y92.03 is not permitted for eScene.09."));
  const populated = populateSyntheticRecord(document, configuration, now);
  const selected = populated.groups.find(group => group.id === "eSceneSection")!.instances[0]!.elements
    .find(element => element.id === "eScene.09")!.values[0]!;
  assert.equal(selected.kind === "coded" && selected.code, "Y92.0");
  assert.equal(selected.occurrenceId, location.values[0]!.occurrenceId);
  assert.ok(hasDemoProvenance(selected.attributes));
  assert.deepEqual(validateStationaryRecord(populated, configuration, now.toISOString()), []);
  assert.deepEqual(document, original);
  const previous = encounterDocumentToDraftMutations(document.encounter.id, document);
  const batches = recoveryMutationBatches(encounterDocumentToDraftMutations(document.encounter.id, populated, previous), previous);
  assert.ok(batches.some(batch => batch.demoAction === "populate" && batch.occurrences.some(occurrence =>
    occurrence.elementId === "eScene.09" && occurrence.value?.kind === "coded" && occurrence.value.code === "Y92.0")));
});

test("Populate preserves permitted dispatch choices and all clinician-owned location values", () => {
  for (const owner of ["dispatch", "clinician", undefined]) {
    const { document, configuration, scene, location } = locationFixture();
    Object.assign(scene, { attributes: owner ? { "x-open-triage-owner": owner } : undefined });
    if (owner === "dispatch") Object.assign(location, { values: [{ kind: "coded", occurrenceId: "location", code: "Y92.0", system: "ICD-10-CM" }] });
    const original = structuredClone(location);
    const populated = populateSyntheticRecord(document, configuration, now);
    assert.deepEqual(populated.groups.find(group => group.id === "eSceneSection")!.instances[0]!.elements
      .find(element => element.id === "eScene.09"), original, owner ?? "unknown ownership");
  }
});

test("Populate repairs a dispatch code-system mismatch using the pinned code-system identity", () => {
  const { document, configuration, location } = locationFixture();
  const choice = { code: "Y92.03", codeSystem: "ICD-10-CM", label: "Apartment/condo" };
  const policy = [{ kind: "code" as const, code: choice.code, codeSystem: choice.codeSystem }];
  configuration.catalogFields["eScene.09"] = { ...configuration.catalogFields["eScene.09"]!, codeChoices: [choice], choiceOrder: policy };
  configuration.definition.sections.at(-1)!.fields[0]!.choicePolicy = policy;
  Object.assign(location.values[0]!, { system: "https://www.cdc.gov/nchs/icd/icd-10-cm/" });
  assert.ok(validateStationaryRecord(document, configuration, now.toISOString())
    .some(finding => finding.message === "Y92.03 is not permitted for eScene.09."));
  const populated = populateSyntheticRecord(document, configuration, now);
  const selected = populated.groups.find(group => group.id === "eSceneSection")!.instances[0]!.elements
    .find(element => element.id === "eScene.09")!.values[0]!;
  assert.equal(selected.kind === "coded" && selected.code, "Y92.03");
  assert.equal(selected.kind === "coded" && selected.system, "ICD-10-CM");
  assert.deepEqual(validateStationaryRecord(populated, configuration, now.toISOString()), []);
});
