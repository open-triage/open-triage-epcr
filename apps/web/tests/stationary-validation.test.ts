import assert from "node:assert/strict";
import test from "node:test";
import { compiledValidationBundleSha256, type CompiledValidationBundle } from "@open-triage/contracts";
import { populateStationaryDemoData } from "../app/stationary-demo-data";
import { editScalarOccurrence } from "../app/stationary-scalar";
import { validateStationaryRecord } from "../app/stationary-validation";

const evaluationTimestamp = "2026-01-01T00:00:00.000Z";
import { syntheticEncounter } from "../app/standard-encounter";

function withGroupInstances(document: typeof syntheticEncounter.document, groupId: string,
  instances: Array<{ instanceId: string; parentInstanceId?: string; elements: Array<{ id: string; values: [] }> }>) {
  return { ...document, groups: [...document.groups.filter(({ id }) => id !== groupId), { id: groupId, instances }] };
}

test("complete-record validation associates required findings with stable navigable targets", () => {
  const findings = validateStationaryRecord(syntheticEncounter.document, undefined, evaluationTimestamp);
  const patient = findings.find(({ target }) => target.fieldId === "ePatient.07");
  assert.ok(patient);
  assert.equal(patient.target.sectionId, "ePatientSection");
  assert.equal(patient.target.groupId, "ePatientSection");
  assert.equal(patient.target.groupInstanceId, "synthetic-patient-1");
  assert.equal(patient.target.fieldId, "ePatient.07");
  assert.equal(patient.severity, "error");
  assert.match(patient.id, /^stationary:field\.minimum:/);
});

test("Populate produces a catalog-valid complete stationary record", () => {
  const populated = populateStationaryDemoData(syntheticEncounter.document);
  assert.deepEqual(validateStationaryRecord(populated, undefined, evaluationTimestamp), []);
});

test("invalid scalar findings retain group, occurrence, and field identity", () => {
  const populated = populateStationaryDemoData(syntheticEncounter.document);
  const patient = populated.groups.find(({ id }) => id === "ePatient.AgeGroup")!.instances[0]!;
  const occurrence = patient.elements.find(({ id }) => id === "ePatient.15")!.values[0]!;
  const result = editScalarOccurrence(populated, {
    groupId: "ePatient.AgeGroup", groupInstanceId: patient.instanceId,
    elementId: "ePatient.15", occurrenceId: occurrence.occurrenceId, input: "not-a-valid-age",
  });
  assert.equal(result.ok, false, "the editor rejects an invalid scalar before it enters the canonical record");

  const malformed = structuredClone(populated);
  const malformedPatient = malformed.groups.find(({ id }) => id === "ePatient.AgeGroup")!.instances[0]!;
  const malformedOccurrence = malformedPatient.elements.find(({ id }) => id === "ePatient.15")!.values[0]!;
  Object.assign(malformedOccurrence, { kind: "scalar", value: "not-a-valid-age", lexical: "not-a-valid-age" });
  const finding = validateStationaryRecord(malformed, undefined, evaluationTimestamp).find(({ target }) => target.occurrenceId === occurrence.occurrenceId);
  assert.ok(finding);
  assert.deepEqual(finding.target, {
    sectionId: "ePatientSection", groupId: "ePatient.AgeGroup", groupInstanceId: patient.instanceId,
    occurrenceId: occurrence.occurrenceId, fieldId: "ePatient.15", instanceId: patient.instanceId, elementId: "ePatient.15",
  });
});

test("report-pinned form requiredness and configured choices define clinical validation", () => {
  const document = structuredClone(syntheticEncounter.document);
  const patient = document.groups.find(({ id }) => id === "ePatientSection")!.instances[0]!;
  Object.assign(patient, { elements: patient.elements.filter(({ id }) => id !== "ePatient.25") });
  const clinicalForm = {
    definition: { schemaVersion: 1 as const, sections: [{ key: "patient", fields: [
      { key: "sex", source: { kind: "nemsis" as const, elementId: "ePatient.25" }, required: true },
    ] }] },
    catalogFields: { "ePatient.25": {
      agencyRequired: false, minOccurs: 0, maxOccurs: 1, nillable: true,
      supportsNotValues: true, supportsPertinentNegatives: true,
      codeChoices: [{ code: "9906001", codeSystem: "", label: "Configured female" }],
    } },
  };
  const missing = validateStationaryRecord(document, clinicalForm, evaluationTimestamp);
  assert.deepEqual(missing.filter(({ target }) => target.fieldId === "ePatient.25").map(({ id }) => id.split(":")[1]), ["field.minimum"]);
  assert.equal(missing.some(({ target }) => target.fieldId && target.fieldId !== "ePatient.25"), false,
    "fields removed from the form do not block completion");
});

test("a pinned Validation bundle is the sole owner of requiredness policy", () => {
  const document = structuredClone(syntheticEncounter.document);
  const patient = document.groups.find(({ id }) => id === "ePatientSection")!.instances[0]!;
  Object.assign(patient, { elements: patient.elements.filter(({ id }) => id !== "ePatient.25") });
  const bundle: CompiledValidationBundle = { schemaVersion: 1, languageVersion: "1.0.0",
    validationVersionId: "validation-version", catalogReleaseId: "catalog", rules: [] };
  const clinicalForm = {
    definition: { schemaVersion: 1 as const, sections: [{ key: "patient", fields: [
      { key: "sex", source: { kind: "nemsis" as const, elementId: "ePatient.25" }, required: true },
    ] }] },
    catalogFields: { "ePatient.25": { agencyRequired: true, requirednessSeverity: "error" as const,
      minOccurs: 1, maxOccurs: 1, nillable: true, supportsNotValues: true, supportsPertinentNegatives: true } },
    validation: { versionId: "validation-version", compiledSha256: compiledValidationBundleSha256(bundle), bundle },
  };
  assert.deepEqual(validateStationaryRecord(document, clinicalForm, evaluationTimestamp), [],
    "an element omitted from authored rules can be skipped even when legacy projections marked it required");
});

test("absent optional repeating records do not promote child minima to report-level findings", () => {
  const findings = validateStationaryRecord(syntheticEncounter.document, undefined, evaluationTimestamp);
  for (const groupId of ["eVitals.VitalGroup", "eMedications.MedicationGroup", "eProcedures.ProcedureGroup"]) {
    assert.equal(findings.some(({ target }) => target.groupId === groupId), false, `${groupId} remains optional while absent`);
  }
});

test("an existing repeating occurrence activates its required child fields", () => {
  const document = withGroupInstances(syntheticEncounter.document, "eMedications.MedicationGroup", [
    { instanceId: "medication-one", elements: [] },
  ]);
  const findings = validateStationaryRecord(document, undefined, evaluationTimestamp).filter(({ target }) => target.groupId === "eMedications.MedicationGroup");
  assert.ok(findings.some(({ target, id }) => target.groupInstanceId === "medication-one"
    && target.fieldId === "eMedications.03" && id.includes("field.minimum")));
  assert.ok(findings.every(({ target }) => target.groupInstanceId === "medication-one"),
    "child findings stay scoped to the occurrence that exists");
});

test("a pinned form can explicitly require an otherwise optional repeating record", () => {
  const clinicalForm = {
    definition: { schemaVersion: 1 as const, sections: [{ key: "medications", fields: [
      { key: "medication", source: { kind: "nemsis" as const, elementId: "eMedications.03" }, required: true },
    ] }] },
    catalogFields: { "eMedications.03": {
      agencyRequired: false, minOccurs: 1, maxOccurs: 1, nillable: true,
      supportsNotValues: true, supportsPertinentNegatives: true,
    } },
  };
  const findings = validateStationaryRecord(syntheticEncounter.document, clinicalForm, evaluationTimestamp);
  const missingRecord = findings.filter(({ target }) => target.groupId === "eMedications.MedicationGroup");
  assert.equal(missingRecord.length, 1);
  assert.match(missingRecord[0]!.id, /group\.minimum/);
  assert.equal(missingRecord[0]!.target.fieldId, undefined,
    "the missing record is reported once instead of once for every required child");
});

test("nested validation is isolated across multiple repeating parent occurrences", () => {
  let document = withGroupInstances(syntheticEncounter.document, "eVitals.VitalGroup", [
    { instanceId: "vital-one", elements: [] },
    { instanceId: "vital-two", elements: [] },
  ]);
  document = withGroupInstances(document, "eVitals.BloodPressureGroup", [
    { instanceId: "pressure-one", parentInstanceId: "vital-one", elements: [] },
  ]);
  const findings = validateStationaryRecord(document, undefined, evaluationTimestamp).filter(({ target }) => target.groupId === "eVitals.BloodPressureGroup");
  assert.ok(findings.some(({ target, id }) => target.groupInstanceId === "pressure-one"
    && target.fieldId === "eVitals.06" && id.includes("field.minimum")));
  assert.ok(findings.some(({ target, id }) => target.parentGroupInstanceId === "vital-two"
    && target.groupInstanceId === undefined && id.includes("group.minimum")));
  assert.equal(findings.some(({ target }) => target.groupInstanceId === "pressure-one"
    && target.parentGroupInstanceId === "vital-two"), false,
    "child-field findings do not leak from one repeating parent occurrence to another");
});

test("authored repeated-group findings retain the exact row and occurrence used by stationary navigation", () => {
  const base = structuredClone(syntheticEncounter.document);
  const document = { ...base, groups: [...base.groups,
    { id: "eVitals.VitalGroup", instances: [{ instanceId: "vital-authored", elements: [] }] },
    { id: "eVitals.BloodPressureGroup", instances: [{ instanceId: "pressure-authored",
    parentInstanceId: "vital-authored", elements: [{ id: "eVitals.06", values: [
      { kind: "scalar" as const, occurrenceId: "systolic-authored", value: 120 },
    ] }] }] },
  ] };
  const bundle: CompiledValidationBundle = {
    schemaVersion: 1, languageVersion: "1.0.0", validationVersionId: "validation-version", catalogReleaseId: "catalog",
    rules: [{ schemaVersion: 1, languageVersion: "1.0.0", ruleId: "systolic-rule",
      validationVersionId: "validation-version", name: "Unusual systolic", enabled: true, severity: "warning",
      executionTargets: ["live"], primaryTarget: { elementId: "eVitals.06" },
      scope: { groupId: "eVitals.VitalGroup", iteration: "each" }, message: "Review systolic",
      assertion: { operator: "equals", elementId: "eVitals.06", value: 999 },
      references: { elementIds: ["eVitals.06"], codes: [] } }],
  };
  const clinicalForm = { definition: { schemaVersion: 1 as const, sections: [{ key: "vitals", fields: [
    { key: "systolic", source: { kind: "nemsis" as const, elementId: "eVitals.06" } },
  ] }] }, catalogFields: { "eVitals.06": { agencyRequired: false, minOccurs: 0, maxOccurs: 1, nillable: true,
    supportsNotValues: true, supportsPertinentNegatives: true } }, validation: { versionId: "validation-version",
      compiledSha256: compiledValidationBundleSha256(bundle), bundle } };
  const authored = validateStationaryRecord(document, clinicalForm, evaluationTimestamp).find(({ id }) => id.includes("systolic-rule"));
  assert.ok(authored);
  assert.deepEqual({ groupInstanceId: authored.target.groupInstanceId, occurrenceId: authored.target.occurrenceId,
    fieldId: authored.target.fieldId }, {
    groupInstanceId: "pressure-authored", occurrenceId: "systolic-authored", fieldId: "eVitals.06",
  });
});

test("a broken live rule reports an attributable engine error while the form remains evaluable", () => {
  const brokenBundle: CompiledValidationBundle = { schemaVersion: 1, languageVersion: "1.0.0",
    validationVersionId: "validation-version", catalogReleaseId: "catalog", rules: [{
      schemaVersion: 1, languageVersion: "1.0.0", ruleId: "broken-live-rule", validationVersionId: "validation-version",
      name: "Broken", enabled: true, severity: "error", executionTargets: ["live"],
      primaryTarget: { elementId: "ePatient.02" }, message: "Broken", assertion: { operator: "future" } as never,
      references: { elementIds: ["ePatient.02"], codes: [] },
    }] };
  const clinicalForm = { definition: { schemaVersion: 1 as const, sections: [] }, catalogFields: {},
    validation: { versionId: "validation-version", compiledSha256: compiledValidationBundleSha256(brokenBundle),
      bundle: brokenBundle } };
  const findings = validateStationaryRecord(syntheticEncounter.document, clinicalForm, evaluationTimestamp);
  assert.ok(findings.some(({ title, message }) => title === "Rule engine" && message.includes("broken-live-rule")));
});

test("tampered cached live rules produce an integrity error instead of silently passing", () => {
  const bundle: CompiledValidationBundle = { schemaVersion: 1, languageVersion: "1.0.0",
    validationVersionId: "validation-version", catalogReleaseId: "catalog", rules: [] };
  const clinicalForm = { definition: { schemaVersion: 1 as const, sections: [] }, catalogFields: {},
    validation: { versionId: "validation-version", compiledSha256: compiledValidationBundleSha256(bundle),
      bundle: { ...bundle, catalogReleaseId: "tampered" } } };
  const findings = validateStationaryRecord(syntheticEncounter.document, clinicalForm, evaluationTimestamp);
  assert.ok(findings.some(({ id, title }) => id.includes("validation.integrity") && title === "Rule engine"));
});
