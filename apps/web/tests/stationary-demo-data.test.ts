import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compileValidationRule, compiledValidationBundleSha256, type ClinicalFormConfiguration } from "@open-triage/contracts";
import { encounterDocumentDiagnostics } from "../app/encounter-document";
import { encounterEvents } from "../app/canonical-events";
import { DEMO_PROVENANCE_ATTRIBUTE, DEMO_PROVENANCE_VALUE, hasDemoProvenance } from "../app/demo-provenance";
import { encounterDocumentToDraftMutations } from "../app/draft-report";
import { NEMSIS_DATA_MODEL } from "../app/nemsis-data-model";
import { bundledEncounterDefinition, INITIAL_SHELL_STATE, MISSING_VITALS_FINDING_ID, reviewEncounter, syntheticEncounter } from "../app/standard-encounter";
import { clearStationaryDemoData, populateStationaryDemoData } from "../app/stationary-demo-data";
import { COMPILED_STATIONARY_LAYOUT } from "../app/stationary-layout";
import { editScalarOccurrence } from "../app/stationary-scalar";
import { validateStationaryRecord } from "../app/stationary-validation";
import { stationaryDialogFindings } from "../components/stationary-repeating-groups";

const configuredVitalsForm: ClinicalFormConfiguration = {
  definition: { schemaVersion: 1, sections: [{ key: "vitals", fields: [
    { key: "respiratory-rate", source: { kind: "nemsis", elementId: "eVitals.14" } },
  ] }] },
  catalogFields: {
    "eVitals.14": { agencyRequired: false, minOccurs: 0, maxOccurs: 1, nillable: true,
      supportsNotValues: true, supportsPertinentNegatives: true },
  },
};

const editableGroups = new Set(COMPILED_STATIONARY_LAYOUT.groups.filter(({ mode }) => mode !== "read-only").map(({ id }) => id));
const editableElements = new Set(COMPILED_STATIONARY_LAYOUT.elements.filter(({ mode }) => mode !== "read-only").map(({ id }) => id));

test("Populate deterministically covers every editable element and repeating structure without replacing existing values", () => {
  const baseline = structuredClone(syntheticEncounter.document);
  const existingValues = new Map(baseline.groups.flatMap((group) => group.instances.flatMap((instance) => instance.elements.flatMap((element) =>
    element.values.map((value) => [value.occurrenceId, value] as const)))));
  const populated = populateStationaryDemoData(baseline);
  const etco2 = populated.groups.find(({ id }) => id === "eVitals.VitalGroup")?.instances[0]?.elements
    .find(({ id }) => id === "eVitals.16")?.values[0];
  assert.equal(etco2?.attributes?.ETCO2Type, "3340001", "demo ETCO2 has a matching measurement type");
  const vitalValues = new Map(populated.groups.filter(({ id }) => id.startsWith("eVitals"))
    .flatMap(({ instances }) => instances).flatMap(({ elements }) => elements)
    .map(({ id, values }) => [id, values[0]] as const));
  for (const [elementId, expected] of Object.entries({
    "eVitals.06": 120, "eVitals.07": 80, "eVitals.09": 93, "eVitals.10": 78,
    "eVitals.12": 98, "eVitals.14": 16, "eVitals.16": 35,
    "eVitals.23": 15,
    "eVitals.24": 37,
  })) {
    const value = vitalValues.get(elementId);
    assert.equal(value?.kind, "scalar", `${elementId} is a scalar vital`);
    if (value?.kind === "scalar") assert.equal(String(value.value), String(expected), elementId);
  }
  for (const [elementId, expected] of Object.entries({ "eVitals.19": "4", "eVitals.20": "5", "eVitals.21": "6" })) {
    const value = vitalValues.get(elementId);
    assert.equal(value?.kind === "coded" ? value.code : undefined, expected, elementId);
  }
  for (const [elementId, value] of vitalValues) if (value?.kind === "scalar") {
    assert.notEqual(String(value.value), "0", `${elementId} should not use a zero placeholder`);
  }
  assert.equal(stationaryDialogFindings(populated, configuredVitalsForm)
    .some(({ message }) => message?.includes("Clinically unusual respiratory rate")), false);

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
  assert.ok(encounterEvents(populated, bundledEncounterDefinition).some(({ vitals }) => vitals), "populated vital signs are reviewable");
  const review = reviewEncounter({ ...INITIAL_SHELL_STATE, encounter: { ...syntheticEncounter, document: populated } }, bundledEncounterDefinition);
  assert.equal(review.some(({ id }) => id === MISSING_VITALS_FINDING_ID), false);
  assert.equal(review.some(({ severity, reference }) => severity === "error" && ["eVitals.06", "eVitals.10", "eVitals.27"].includes(reference)), false);
});

test("the populated report satisfies all enabled canonical NEMSIS validation rules", () => {
  const catalog = JSON.parse(readFileSync(new URL("../../../defines/catalog/catalog_nemsis-3.5.1.json", import.meta.url), "utf8"));
  const validation = JSON.parse(readFileSync(new URL("../../../defines/validation/validation_nemsis-full.json", import.meta.url), "utf8"));
  const compileCatalog = {
    elements: catalog.elements.map((element: any) => ({ elementId: element.id, label: element.name,
      baseDatatype: element.datatype.base, groupPath: element.groupPath, intrinsicOccurrence: element.occurrence })),
    groups: catalog.groups.map((group: any) => ({ groupId: group.id, label: group.name, repeating: group.repeating,
      ...(group.parentId ? { parentGroupId: group.parentId } : {}), intrinsicOccurrence: group.occurrence })),
  };
  const rules = validation.rules.filter((rule: any) => rule.enabled).map((rule: any) => {
    const result = compileValidationRule(rule, "demo-validation", compileCatalog);
    assert.deepEqual(result.diagnostics, [], rule.name);
    return result.compiled!;
  });
  const bundle = { schemaVersion: 1 as const, languageVersion: "1.0.0" as const, validationVersionId: "demo-validation",
    catalogReleaseId: "nemsis-3.5.1", rules };
  const clinicalForm: ClinicalFormConfiguration = {
    definition: { schemaVersion: 1, sections: [{ key: "all", fields: catalog.elements
      .filter((element: any) => element.id.startsWith("e"))
      .map((element: any) => ({ key: element.id, source: { kind: "nemsis" as const, elementId: element.id } })) }] },
    catalogFields: {},
    validation: { versionId: bundle.validationVersionId, compiledSha256: compiledValidationBundleSha256(bundle), bundle },
  };
  const populated = populateStationaryDemoData(syntheticEncounter.document);
  assert.deepEqual(validateStationaryRecord(populated, clinicalForm, "2026-09-22T18:00:00.000Z"), []);

  const stale = structuredClone(populated);
  const injury = stale.groups.find(({ id }) => id === "eSituationSection")!.instances[0]!
    .elements.find(({ id }) => id === "eSituation.02")!.values[0]!;
  assert.equal(injury.kind, "coded");
  if (injury.kind === "coded") Object.assign(injury, { code: "9922001", display: "No" });
  const oldRespiratory = stale.groups.find(({ id }) => id === "eVitals.VitalGroup")!.instances[0]!
    .elements.find(({ id }) => id === "eVitals.14")!.values[0]!;
  if (oldRespiratory.kind === "scalar") Object.assign(oldRespiratory, { value: 0, lexical: "0" });
  const refreshed = populateStationaryDemoData(stale);
  const newRespiratory = refreshed.groups.find(({ id }) => id === "eVitals.VitalGroup")!.instances[0]!
    .elements.find(({ id }) => id === "eVitals.14")!.values[0]!;
  assert.equal(newRespiratory.kind === "scalar" ? newRespiratory.value : undefined, 16);
  assert.deepEqual(validateStationaryRecord(refreshed, clinicalForm, "2026-09-22T18:00:00.000Z"), []);
  assert.deepEqual(populateStationaryDemoData(refreshed), refreshed);

  const withoutDispatchTime = { ...syntheticEncounter.document, groups: syntheticEncounter.document.groups.map((group) =>
    group.id === "eTimesSection" ? { ...group, instances: group.instances.map((instance) => ({ ...instance,
      elements: instance.elements.filter(({ id }) => id !== "eTimes.03") })) } : group) };
  const generatedTimeline = populateStationaryDemoData(withoutDispatchTime);
  assert.deepEqual(populateStationaryDemoData(generatedTimeline), generatedTimeline,
    "a demo-generated dispatch time does not move the timeline on a second Populate");
  assert.deepEqual(validateStationaryRecord(generatedTimeline, clinicalForm, "2026-09-22T18:00:00.000Z"), []);
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

test("configured vital dialog warns for zero and clears after a corrected value loses focus", () => {
  const populated = populateStationaryDemoData(syntheticEncounter.document);
  const vital = populated.groups.find(({ id }) => id === "eVitals.VitalGroup")!.instances[0]!;
  const respiratory = vital.elements.find(({ id }) => id === "eVitals.14")!.values[0]!;
  const unusual = editScalarOccurrence(populated, {
    groupId: "eVitals.VitalGroup", groupInstanceId: vital.instanceId, elementId: "eVitals.14",
    occurrenceId: respiratory.occurrenceId, input: "0",
  });
  assert.equal(unusual.ok, true);
  assert.ok(stationaryDialogFindings(unusual.document, configuredVitalsForm)
    .some(({ message }) => message?.includes("Clinically unusual respiratory rate")));

  const corrected = editScalarOccurrence(unusual.document, {
    groupId: "eVitals.VitalGroup", groupInstanceId: vital.instanceId, elementId: "eVitals.14",
    occurrenceId: respiratory.occurrenceId, input: "16",
  });
  assert.equal(corrected.ok, true);
  const findings = stationaryDialogFindings(corrected.document, configuredVitalsForm);
  assert.equal(findings.some(({ message }) => message?.includes("Clinically unusual respiratory rate")), false);
  assert.equal(findings.some(({ severity, target }) => severity === "error" && ["eVitals.06", "eVitals.10", "eVitals.27"].includes(target.fieldId ?? target.elementId ?? "")), false);
});
