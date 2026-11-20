import { applyDestinationSelection } from "../app/destination-selection";
import assert from "node:assert/strict";
import test from "node:test";
import { compileValidationRule, compiledValidationBundleSha256, type ClinicalFormConfiguration } from "@open-triage/contracts";
import { shippedWestDefinition } from "../../../defines/decision_support/west-localization.mjs";
import { finalizeSyntheticVitals, validationProblems } from "@open-triage/contracts/synthetic-record-generator";
import { populateSyntheticRecord } from "../app/populate-synthetic-record";
import { syntheticEncounter } from "../app/standard-encounter";
import { clearStationaryDemoData } from "../app/stationary-demo-data";
import { hasDemoProvenance } from "../app/demo-provenance";
import { encounterDocumentToDraftMutations, recoveryMutationBatches, stableDraftId } from "../app/draft-report";
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

function repeatedVitalsFixture() {
  const { document, configuration } = fixture();
  const root = document.groups.find(group => group.id === "PatientCareReportGroup")!.instances[0]!;
  document.groups.push({ id: "eVitalsSection", instances: [{ instanceId: "vitals-section", parentInstanceId: root.instanceId, elements: [] }] },
    { id: "eVitals.VitalGroup", instances: [1, 2, 3].map(index => ({ instanceId: `vitals-${index}`, parentInstanceId: "vitals-section", elements: [] })) },
    { id: "eVitals.HeartRateGroup", instances: [
      { instanceId: "pulse-1", parentInstanceId: "vitals-1", elements: [{ id: "eVitals.10", values: [
        { kind: "scalar", occurrenceId: "generated-pulse", value: 90, attributes: { "x-open-triage-demo": "stationary-populate-v1" } },
      ] }] },
      { instanceId: "pulse-2", parentInstanceId: "vitals-2", elements: [{ id: "eVitals.10", values: [
        { kind: "scalar", occurrenceId: "clinician-pulse", value: 72 },
      ] }] },
    ] },
    { id: "eVitals.BloodPressureGroup", instances: [
      { instanceId: "pressure-2", parentInstanceId: "vitals-2", elements: [] },
    ] });
  configuration.catalogGroups!["eVitals.HeartRateGroup"] = { name: "Pulse", parentId: "eVitals.VitalGroup" };
  configuration.catalogGroups!["eVitals.BloodPressureGroup"] = { name: "Pressure", parentId: "eVitals.VitalGroup" };
  configuration.catalogFields["eVitals.10"]!.generation!.path = ["eVitals.HeartRateGroup"];
  for (const [id, path] of [["eVitals.12", "eVitals.VitalGroup"], ["eVitals.06", "eVitals.BloodPressureGroup"], ["eVitals.14", "eVitals.VitalGroup"]]) {
    configuration.definition.sections[0]!.fields.push({ key: id!, source: { kind: "nemsis", elementId: id! } });
    configuration.catalogFields[id!] = { ...configuration.catalogFields["eVitals.10"]!, generation: {
      ...configuration.catalogFields["eVitals.10"]!.generation!, id: id!, path: [path!],
    } };
    configuration.validation!.bundle.rules.push({ ...configuration.validation!.bundle.rules[0]!, ruleId: `required-${id}`,
      primaryTarget: { elementId: id! }, scope: { groupId: "eVitals.VitalGroup", iteration: "each" },
      assertion: { operator: "minimum-occurrences", elementId: id!, count: 1 }, references: { elementIds: [id!], codes: [] } });
  }
  Object.assign(configuration.validation!.bundle.rules[0]!, { scope: { groupId: "eVitals.VitalGroup", iteration: "each" } });
  const second = document.groups.find(group => group.id === "eVitals.VitalGroup")!.instances[1]!;
  Object.assign(second, { elements: [...second.elements, { id: "eVitals.12", values: [{ kind: "scalar", occurrenceId: "clinician-saturation", value: 98 }] }] });
  configuration.validation!.compiledSha256 = compiledValidationBundleSha256(configuration.validation!.bundle);
  return { document, configuration };
}

test("Populate repairs every vital set and its nested groups while preserving clinician values in sibling sets", () => {
  const { document, configuration } = repeatedVitalsFixture();
  const original = structuredClone(document);
  const populated = populateSyntheticRecord(document, configuration, now);
  assert.deepEqual(document, original);
  assert.deepEqual(validationProblems(configuration.validation!.bundle, populated, now.toISOString()), []);
  const hearts = populated.groups.find(group => group.id === "eVitals.HeartRateGroup")!.instances;
  for (const index of [1, 2, 3]) {
    const heart = hearts.find(instance => instance.parentInstanceId === `vitals-${index}`)!;
    assert.ok(heart, `pulse group belongs to vital set ${index}`);
    assert.equal((heart.elements.find(element => element.id === "eVitals.10")!.values[0] as { value: number }).value, 72);
    assert.ok(populated.groups.find(group => group.id === "eVitals.BloodPressureGroup")!.instances
      .find(instance => instance.parentInstanceId === `vitals-${index}`)!.elements.some(element => element.id === "eVitals.06"));
    assert.ok(populated.groups.find(group => group.id === "eVitals.VitalGroup")!.instances[index - 1]!.elements.some(element => element.id === "eVitals.12"));
  }
  for (const id of ["clinician-pulse", "clinician-saturation"]) {
    const occurrence = (value: Parameters<typeof populateSyntheticRecord>[0]) => value.groups.flatMap(group => group.instances.flatMap(instance => instance.elements.flatMap(element => element.values)))
      .find(value => value.occurrenceId === id);
    assert.deepEqual(occurrence(populated), occurrence(original));
  }
  assert.deepEqual(populateSyntheticRecord(populated, configuration, now), populated);
});

function westConfiguration() {
  const definition = shippedWestDefinition();
  const fields = Object.fromEntries(Object.keys(definition.assessment.elements).map(key => [key, {
    id: key, namespace: "west.opentriage.org", slug: key, choices: [], codeSystem: "urn:demo:" + key,
    datatype: key === "physiologyScore" ? "number" : key === "noWarningCriteria" ? "boolean" : "coded",
    correlatesTo: "eVitals.VitalGroup", constraints: {},
  }])) as unknown as NonNullable<ClinicalFormConfiguration["decisionSupport"]>["fields"];
  return { definition, fields };
}

test("Populate fills finalized vital sets from their own readings and Clear restores their previous WEST results", () => {
  const { document, configuration } = repeatedVitalsFixture();
  configuration.decisionSupport = westConfiguration();
  const west = configuration.decisionSupport;
  const ids = ["eVitals.06", "eVitals.07", "eVitals.10", "eVitals.12", "eVitals.14", "eVitals.24"];
  for (const [id, original] of [["eVitals.07", "eVitals.06"], ["eVitals.24", "eVitals.14"]] as const) {
    configuration.catalogFields[id] = structuredClone(configuration.catalogFields[original]!);
    configuration.catalogFields[id]!.generation!.id = id;
    configuration.definition.sections[0]!.fields.push({ key: id, source: { kind: "nemsis", elementId: id } });
  }
  configuration.validation!.bundle.rules[0]!.assertion = { operator: "minimum-occurrences", elementId: "eVitals.10", count: 1 };
  configuration.validation!.compiledSha256 = compiledValidationBundleSha256(configuration.validation!.bundle);
  const roots = document.groups.find(group => group.id === "eVitals.VitalGroup")!.instances;
  for (const root of roots.slice(1)) {
    const time = { id: "eVitals.01", values: [{ kind: "scalar" as const, occurrenceId: root.instanceId + "-time",
      value: now.toISOString(), utcOffsetMinutes: 0, attributes: { "decisionSupportObservation:oxygen": "air", "decisionSupportObservation:consciousness": "A" } }] };
    const coded = (key: "newsScale" | "criteria" | "categories", code: string) => ({ id: "west.opentriage.org." + key,
      values: [{ kind: "coded" as const, occurrenceId: root.instanceId + key, code, system: "urn:demo:" + key }] });
    Object.assign(root, { decisionSupportCalculation: { systemKey: west.definition.key, version: west.definition.version },
      elements: [...root.elements, time, coded("newsScale", "standard"), coded("criteria", "chest-pain.05"), coded("categories", "chest-pain")] });
  }
  const placeholder = { kind: "null" as const, occurrenceId: "generated-absence", notValue: { code: "7701003" },
    attributes: { "x-open-triage-demo": "stationary-populate-v1" } };
  const unavailable = { kind: "null" as const, occurrenceId: "manual-absence", notValue: { code: "7701003" } };
  Object.assign(roots[1]!, { elements: [...roots[1]!.elements, { id: "eVitals.14", values: [placeholder] }] });
  Object.assign(roots[2]!, { elements: [...roots[2]!.elements, { id: "eVitals.14", values: [unavailable] }] });
  const saved = finalizeSyntheticVitals(document, configuration, key => key);
  const populated = populateSyntheticRecord(saved, configuration, now);
  assert.deepEqual(validationProblems(configuration.validation!.bundle, populated, now.toISOString()), []);
  const observedRoots = populated.groups.find(group => group.id === "eVitals.VitalGroup")!.instances.slice(1);
  for (const root of observedRoots) {
    const rows = [root, ...populated.groups.flatMap(group => group.instances.filter(row => row.parentInstanceId === root.instanceId))];
    for (const id of ids) {
      const value = rows.flatMap(row => row.elements).find(element => element.id === id)!.values[0]!;
      if (root.instanceId === "vitals-3" && id === "eVitals.14") { assert.deepEqual(value, unavailable); continue; }
      assert.equal(value.kind, "scalar", id);
      if (root.instanceId === "vitals-2" && id === "eVitals.14") assert.equal(value.occurrenceId, placeholder.occurrenceId);
    }
  }
  const score = observedRoots[0]!.decisionSupportCalculation!.physiology!.total;
  assert.equal(typeof score, "number");
  assert.equal(observedRoots[0]!.elements.find(e => e.id === "west.opentriage.org.physiologyScore")!.values[0]!.kind, "scalar");
  assert.equal(observedRoots[1]!.decisionSupportCalculation!.physiology!.total, null);
  const again = populateSyntheticRecord(populated, configuration, now);
  assert.deepEqual(again, populated);
  const cleared = clearStationaryDemoData(populated, configuration);
  const savedRoots = saved.groups.find(g => g.id === "eVitals.VitalGroup")!.instances;
  for (const row of cleared.groups.find(g => g.id === "eVitals.VitalGroup")!.instances.slice(1)) {
    assert.deepEqual(row.decisionSupportCalculation, savedRoots.find(original => original.instanceId === row.instanceId)!.decisionSupportCalculation);
  }
});

test("Populate fails without changing any set when a clinician value contradicts a scoped rule", () => {
  const { document, configuration } = repeatedVitalsFixture();
  const value = document.groups.find(group => group.id === "eVitals.HeartRateGroup")!.instances[1]!.elements[0]!.values[0]!;
  assert.equal(value.kind, "scalar");
  if (value.kind === "scalar") Object.assign(value, { value: 90 });
  const original = structuredClone(document);
  assert.throws(() => populateSyntheticRecord(document, configuration, now), /Could not satisfy active validation.*pulse-rule/);
  assert.deepEqual(document, original);
});

test("document-wide attribute repairs preserve clinician values in other instances", () => {
  const { document, configuration } = repeatedVitalsFixture();
  const protectedHeart = structuredClone(document.groups.find(group => group.id === "eVitals.HeartRateGroup")!.instances[1]!);
  Object.assign(configuration.validation!.bundle, { rules: [{ ...configuration.validation!.bundle.rules[0]!, scope: undefined,
    assertion: { operator: "attribute", elementId: "eVitals.10", name: "SyntheticTest", value: "yes" } }] });
  configuration.validation!.compiledSha256 = compiledValidationBundleSha256(configuration.validation!.bundle);
  const populated = populateSyntheticRecord(document, configuration, now);
  assert.deepEqual(validationProblems(configuration.validation!.bundle, populated, now.toISOString()), []);
  assert.deepEqual(populated.groups.find(group => group.id === "eVitals.HeartRateGroup")!.instances[1], protectedHeart);
});

test("Populate uses the validator's effective scope for pinned legacy requirements", () => {
  for (const scope of [undefined, { groupId: "eVitals.BloodPressureGroup", iteration: "each" as const }]) {
    const { document, configuration } = repeatedVitalsFixture();
    const rule = configuration.validation!.bundle.rules.find(rule => rule.ruleId === "required-eVitals.06")!;
    Object.assign(rule, { name: "SBP (Systolic Blood Pressure) form required",
      message: "SBP (Systolic Blood Pressure) is required by the form", scope });
    configuration.validation!.compiledSha256 = compiledValidationBundleSha256(configuration.validation!.bundle);
    const populated = populateSyntheticRecord(document, configuration, now);
    assert.deepEqual(validationProblems(configuration.validation!.bundle, populated, now.toISOString()), []);
    assert.equal(populated.groups.find(group => group.id === "eVitals.BloodPressureGroup")!.instances.length, 3);
  }
});

test("scoped removal affects only the failing vital set", () => {
  const { document, configuration } = repeatedVitalsFixture();
  const first = document.groups.find(group => group.id === "eVitals.HeartRateGroup")!.instances[0]!.elements[0]!;
  Object.assign(first, { values: [{ kind: "scalar", occurrenceId: "first-clinician-pulse", value: 90 }] });
  Object.assign(configuration.validation!.bundle, { rules: [{ ...configuration.validation!.bundle.rules[0]!,
    primaryTarget: { elementId: "eVitals.12" },
    applicability: { operator: "equals", elementId: "eVitals.10", value: 90 },
    assertion: { operator: "undocumented", elementId: "eVitals.12" }, references: { elementIds: ["eVitals.10", "eVitals.12"], codes: [] } }] });
  configuration.validation!.compiledSha256 = compiledValidationBundleSha256(configuration.validation!.bundle);
  const populated = populateSyntheticRecord(document, configuration, now);
  const sets = populated.groups.find(group => group.id === "eVitals.VitalGroup")!.instances;
  assert.ok(!sets[0]!.elements.some(element => element.id === "eVitals.12"));
  assert.equal((sets[1]!.elements.find(element => element.id === "eVitals.12")!.values[0] as { value: number }).value, 98);
  assert.deepEqual(validationProblems(configuration.validation!.bundle, populated, now.toISOString()), []);
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

test("Populate replaces a disallowed dispatch county with the pinned absence choice", () => {
  const { document, configuration } = fixture();
  const policy = [{ kind: "not-value" as const, code: "7701003" }];
  configuration.definition.sections.push({ key: "scene", fields: [
    { key: "county", source: { kind: "nemsis", elementId: "eScene.21" }, choicePolicy: policy },
  ] });
  configuration.catalogFields["eScene.21"] = {
    agencyRequired: false, minOccurs: 0, maxOccurs: 1, nillable: true,
    supportsNotValues: true, supportsPertinentNegatives: false, codeChoices: [], choiceOrder: policy,
    generation: { id: "eScene.21", base: "string", path: ["eSceneSection"], minimum: 0, maximum: 1,
      definition: { datatype: { constraints: { pattern: "[0-9]{5}" } },
        valueSource: { kind: "external-code-system" }, permittedNotValues: [{ code: "7701003" }] } },
  };
  configuration.catalogGroups!["eSceneSection"] = { name: "Scene", parentId: "PatientCareReportGroup" };
  const scene = document.groups.find(group => group.id === "eSceneSection")!.instances[0]!;
  Object.assign(scene, { attributes: { "x-open-triage-owner": "dispatch" } });
  assert.ok(validateStationaryRecord(document, configuration, now.toISOString())
    .some(finding => finding.message === "36061 is not permitted for eScene.21."));
  const populated = populateSyntheticRecord(document, configuration, now);
  const county = populated.groups.find(group => group.id === "eSceneSection")!.instances[0]!.elements
    .find(element => element.id === "eScene.21")!.values[0]!;
  assert.equal(county.kind, "null");
  assert.equal(county.notValue?.code, "7701003");
  assert.ok(hasDemoProvenance(county.attributes));
  assert.deepEqual(validateStationaryRecord(populated, configuration, now.toISOString()), []);
});

test("Populate leaves COS destination unanswered, removes old demo values, and preserves explicit choices", () => {
 const {document,configuration} = fixture();
 const groupId = "eDisposition.DestinationGroup";
 const empty = {...document,groups:document.groups.filter(group=>group.id!==groupId)};
 configuration.catalogGroups![groupId]={name:"Destination",parentId:"PatientCareReportGroup"};
 for(const id of ["eDisposition.01","eDisposition.02"]) {
  configuration.definition.sections[0]!.fields.push({key:id,source:{kind:"nemsis",elementId:id}});
  configuration.catalogFields[id]={agencyRequired:false,minOccurs:0,maxOccurs:1,nillable:true,supportsNotValues:true,supportsPertinentNegatives:false,
   generation:{id,base:"string",path:[groupId],minimum:0,maximum:1,definition:{datatype:{constraints:{minLength:2,maxLength:100}},valueSource:{kind:"scalar"}}}};
 }
 const legacy = populateSyntheticRecord(empty,configuration,now);
 configuration.catalogFields["eDisposition.01"]!.recommendations={source:"destination-directory",items:[]};
 const pair = (doc: typeof syntheticEncounter.document) => doc.groups.flatMap(group=>group.instances.flatMap(instance=>instance.elements))
  .filter(element=>["eDisposition.01","eDisposition.02"].includes(element.id)).flatMap(element=>element.values);
 for(const source of [empty,legacy]) {
  assert.deepEqual(pair(populateSyntheticRecord(source,configuration,now)),[]);
 }
 const entry={id:"destination",groupId:"group",revision:1,displayName:"Chosen hospital",localCode:"ED",hsaId:null,active:true};
 for(const choice of [entry,"none"] as const) {
  const chosen=applyDestinationSelection(empty,choice,groupId);
  assert.deepEqual(pair(populateSyntheticRecord(chosen,configuration,now)),pair(chosen));
 }
});


test("Populate and recovery finalize generator-owned WEST sets with the same stable demo mutations", () => {
  const { document, configuration } = fixture();
  const { definition, fields } = westConfiguration();
  const legacy = populateSyntheticRecord(document, configuration, now);
  configuration.decisionSupport = { definition, fields };
  const populated = populateSyntheticRecord(document, configuration, now);
  const restored = finalizeSyntheticVitals(legacy, configuration, key => stableDraftId(document.encounter.id, "synthetic-populate:" + key));
  assert.deepEqual(restored, populated);
  const row = populated.groups.find(group => group.id === "eVitals.VitalGroup")!.instances[0]!;
  assert.equal(row.decisionSupportCalculation?.version, definition.version);
  assert.equal(row.decisionSupportCalculation?.colour, "orange");
  assert.equal(row.decisionSupportCalculation?.physiology?.points.heartRate, 0);
  assert.deepEqual(populateSyntheticRecord(populated, configuration, now), populated);
  const saved = encounterDocumentToDraftMutations(document.encounter.id, populated);
  const root = saved.groups.find(group => group.groupId === "eVitals.VitalGroup")!;
  assert.ok(root.documentedTime && root.decisionSupportCalculation);
  assert.ok(saved.occurrences.filter(value => value.elementId.startsWith("west.opentriage.org."))
    .every(value => value.provenanceKind === "demo" && value.groupInstanceId === root.id));
});
