import assert from "node:assert/strict";
import test from "node:test";
import { populateStationaryDemoData } from "../app/stationary-demo-data";
import { editScalarOccurrence } from "../app/stationary-scalar";
import { validateStationaryRecord } from "../app/stationary-validation";
import { syntheticEncounter } from "../app/standard-encounter";

function withGroupInstances(document: typeof syntheticEncounter.document, groupId: string,
  instances: Array<{ instanceId: string; parentInstanceId?: string; elements: Array<{ id: string; values: [] }> }>) {
  return { ...document, groups: [...document.groups.filter(({ id }) => id !== groupId), { id: groupId, instances }] };
}

test("complete-record validation associates required findings with stable navigable targets", () => {
  const findings = validateStationaryRecord(syntheticEncounter.document);
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
  assert.deepEqual(validateStationaryRecord(populated), []);
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
  const finding = validateStationaryRecord(malformed).find(({ target }) => target.occurrenceId === occurrence.occurrenceId);
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
  const missing = validateStationaryRecord(document, clinicalForm);
  assert.deepEqual(missing.filter(({ target }) => target.fieldId === "ePatient.25").map(({ id }) => id.split(":")[1]), ["field.minimum"]);
  assert.equal(missing.some(({ target }) => target.fieldId && target.fieldId !== "ePatient.25"), false,
    "fields removed from the form do not block completion");
});

test("absent optional repeating records do not promote child minima to report-level findings", () => {
  const findings = validateStationaryRecord(syntheticEncounter.document);
  for (const groupId of ["eVitals.VitalGroup", "eMedications.MedicationGroup", "eProcedures.ProcedureGroup"]) {
    assert.equal(findings.some(({ target }) => target.groupId === groupId), false, `${groupId} remains optional while absent`);
  }
});

test("an existing repeating occurrence activates its required child fields", () => {
  const document = withGroupInstances(syntheticEncounter.document, "eMedications.MedicationGroup", [
    { instanceId: "medication-one", elements: [] },
  ]);
  const findings = validateStationaryRecord(document).filter(({ target }) => target.groupId === "eMedications.MedicationGroup");
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
  const findings = validateStationaryRecord(syntheticEncounter.document, clinicalForm);
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
  const findings = validateStationaryRecord(document).filter(({ target }) => target.groupId === "eVitals.BloodPressureGroup");
  assert.ok(findings.some(({ target, id }) => target.groupInstanceId === "pressure-one"
    && target.fieldId === "eVitals.06" && id.includes("field.minimum")));
  assert.ok(findings.some(({ target, id }) => target.parentGroupInstanceId === "vital-two"
    && target.groupInstanceId === undefined && id.includes("group.minimum")));
  assert.equal(findings.some(({ target }) => target.groupInstanceId === "pressure-one"
    && target.parentGroupInstanceId === "vital-two"), false,
    "child-field findings do not leak from one repeating parent occurrence to another");
});
