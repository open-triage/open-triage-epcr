import assert from "node:assert/strict";
import test from "node:test";
import { compileValidationRule, compiledValidationBundleSha256, NEMSIS_351_EMS_MESSAGE_REPAIRS, type ClinicalFormConfiguration, type CompiledValidationBundle } from "@open-triage/contracts";
import { populateStationaryDemoData } from "../app/stationary-demo-data";
import { editScalarOccurrence } from "../app/stationary-scalar";
import { displayValidationRuleMessage, validateStationaryRecord } from "../app/stationary-validation";

const evaluationTimestamp = "2026-01-01T00:00:00.000Z";
import { syntheticEncounter } from "../app/standard-encounter";
import { stationaryDialogFindings } from "../components/stationary-repeating-groups";

test("report validation does not require fields from agency demographics", () => {
  const document = { ...syntheticEncounter.document, groups: [
    ...syntheticEncounter.document.groups,
    { id: "DemographicGroup", instances: [{ instanceId: "demographic-1", elements: [] }] },
  ] } as never;
  const findings = validateStationaryRecord(document, undefined, evaluationTimestamp);
  assert.equal(findings.some(({ target }) => target.fieldId?.startsWith("dAgency.")
    || target.groupId === "DemographicGroup"), false);
});

test("legacy time-order warnings name both involved fields", () => {
  const message = displayValidationRuleMessage("should not be earlier than .", "eTimes.03", ["eTimes.01", "eTimes.03"]);
  assert.match(message, /Date\/Time/);
  assert.doesNotMatch(message, /^should not be earlier than/);
  assert.match(message, /should not be earlier than/);
});

test("legacy ETCO2 type warnings identify the documented measurement", () => {
  assert.equal(displayValidationRuleMessage("ETCO2 Type should be recorded when is recorded.", "eVitals.16", ["eVitals.16"]),
    "ETCO2 Type should be recorded when End Tidal Carbon Dioxide (ETCO2) is recorded.");
});

test("legacy scene warnings name the field and Yes condition", () => {
  assert.equal(displayValidationRuleMessage('should be "Multiple" when is "Yes".', "eScene.06", ["eScene.06", "eScene.07"]),
    'Number of Patients at Scene should be "Multiple" when Mass Casualty Incident is "Yes".');
});

test("every pinned NEMSIS message with lost value-of labels is repaired", () => {
  assert.ok(Object.keys(NEMSIS_351_EMS_MESSAGE_REPAIRS).length > 100);
  for (const [key, expected] of Object.entries(NEMSIS_351_EMS_MESSAGE_REPAIRS)) {
    const [primary, original, references] = key.split("\u0000");
    assert.equal(displayValidationRuleMessage(original!, primary!, references!.split(",")), expected, key);
  }
});

test("an ETCO2 type warning targets the vital field and clears after selecting its type", () => {
  const compiled = compileValidationRule({ id: "etco2-type", name: "ETCO2 type", enabled: true, severity: "warning",
    executionTargets: ["live", "sign"], primaryTargetElementId: "eVitals.16",
    message: "ETCO2 Type should be recorded when is recorded.",
    source: 'for each("eVitals.VitalGroup")\nwhen present("eVitals.16")\nrequire attribute("eVitals.16", "ETCO2Type")',
  }, "validation-version", new Set(["eVitals.16"]));
  assert.deepEqual(compiled.diagnostics, []);
  const bundle: CompiledValidationBundle = { schemaVersion: 1, languageVersion: "1.0.0",
    validationVersionId: "validation-version", catalogReleaseId: "catalog", rules: [compiled.compiled!] };
  const clinicalForm = { definition: { schemaVersion: 1 as const, sections: [{ key: "vitals", fields: [
    { key: "etco2", source: { kind: "nemsis" as const, elementId: "eVitals.16" } },
  ] }] }, catalogFields: {}, validation: { versionId: "validation-version",
    compiledSha256: compiledValidationBundleSha256(bundle), bundle } };
  const document = populateStationaryDemoData(syntheticEncounter.document);
  const vital = document.groups.find(({ id }) => id === "eVitals.VitalGroup")!.instances[0]!;
  const etco2 = vital.elements.find(({ id }) => id === "eVitals.16")!.values[0]!;
  const withoutType = structuredClone(document);
  const oldValue = withoutType.groups.find(({ id }) => id === "eVitals.VitalGroup")!.instances[0]!
    .elements.find(({ id }) => id === "eVitals.16")!.values[0]!;
  const { ETCO2Type: _type, ...attributesWithoutType } = oldValue.attributes ?? {};
  Object.assign(oldValue, { attributes: attributesWithoutType });
  const warning = stationaryDialogFindings(withoutType, clinicalForm).find(({ message }) => message?.includes("ETCO2 Type"));
  assert.equal(warning?.target.fieldId, "eVitals.16");
  assert.equal(warning?.target.groupInstanceId, vital.instanceId);
  assert.equal(warning?.message, "ETCO2 Type should be recorded when End Tidal Carbon Dioxide (ETCO2) is recorded.");
  const corrected = editScalarOccurrence(withoutType, { groupId: "eVitals.VitalGroup", groupInstanceId: vital.instanceId,
    elementId: "eVitals.16", occurrenceId: etco2.occurrenceId, input: String(etco2.value),
    attributes: { ETCO2Type: "3340001" } });
  assert.equal(corrected.ok, true);
  assert.equal(stationaryDialogFindings(corrected.document, clinicalForm).some(({ message }) => message?.includes("ETCO2 Type")), false);
});

test("open medication and procedure code systems accept documented values beyond catalog suggestions", () => {
  for (const [groupId, elementId] of [
    ["eMedications.MedicationGroup", "eMedications.03"],
    ["eProcedures.ProcedureGroup", "eProcedures.03"],
  ] as const) {
    const document = withGroupInstances(syntheticEncounter.document, groupId, [{ instanceId: `row-${elementId}`,
      elements: [{ id: elementId, values: [{ kind: "coded", occurrenceId: `value-${elementId}`,
        code: "external-code", system: "SNOMED-CT" }] }] }] as never);
    const clinicalForm = { definition: { schemaVersion: 1 as const, sections: [{ key: "interventions", fields: [
      { key: elementId, source: { kind: "nemsis" as const, elementId } },
    ] }] }, catalogFields: { [elementId]: { agencyRequired: false, minOccurs: 0, maxOccurs: 1,
      nillable: true, supportsNotValues: true, supportsPertinentNegatives: true,
      codeChoices: [{ code: "suggested-code", codeSystem: "SNOMED-CT", label: "Suggested" }] } } };
    assert.equal(validateStationaryRecord(document, clinicalForm, evaluationTimestamp)
      .some((finding) => finding.target.fieldId === elementId && finding.id.includes("value.code")), false);
  }
});

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

test("custom completion is scoped to its pinned form and accepts documented exceptional values", () => {
  const definition = { namespace: "agency", slug: "response", title: "Response", usage: "Optional",
    datatype: "coded", codeSystem: "agency", choices: [{ code: "A", label: "A" }],
    permittedNotValues: ["NV"], permittedPertinentNegatives: [] };
  const field = { key: "response", source: { kind: "custom" as const, elementDefinitionId: "custom-id" }, required: true,
    allowedAbsenceStates: ["NV"] };
  const form = { definition: { schemaVersion: 1 as const, sections: [{ key: "care", fields: [field] }] },
    catalogFields: {}, customFields: { "custom-id": definition } } as unknown as ClinicalFormConfiguration;
  const optional = { ...form, definition: { ...form.definition, sections: [{ key: "care", fields: [{ ...field, required: false }] }] } };
  const document = structuredClone(syntheticEncounter.document);
  assert.equal(validateStationaryRecord(document, form, evaluationTimestamp)
    .some(({ target }) => target.fieldId === "agency.response"), true);
  assert.equal(validateStationaryRecord(document, optional, evaluationTimestamp)
    .some(({ target }) => target.fieldId === "agency.response"), false);
  const complete = { ...document, groups: document.groups.map((group) => group.id !== "PatientCareReportGroup" ? group : {
    ...group, instances: group.instances.map((instance, index) => index ? instance : { ...instance,
      elements: [...instance.elements, { id: "agency.response", values: [{ kind: "null" as const,
        occurrenceId: "custom-not", notValue: { code: "NV" } }] }] }),
  }) };
  assert.equal(validateStationaryRecord(complete, form, evaluationTimestamp)
    .some(({ target }) => target.fieldId === "agency.response"), false);
});

test("a pinned Validation bundle preserves a stronger form completion requirement", () => {
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
  assert.equal(validateStationaryRecord(document, clinicalForm, evaluationTimestamp)
    .some(({ id, target }) => id.includes("field.minimum") && target.fieldId === "ePatient.25"), true);
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
      executionTargets: ["live", "sign"], primaryTarget: { elementId: "eVitals.06" },
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
  assert.deepEqual(authored.acknowledgement, { validationVersionId: "validation-version", ruleId: "systolic-rule",
    targetElementId: "eVitals.06", targetGroupInstanceId: "pressure-authored",
    targetOccurrenceId: "systolic-authored", inputFingerprint: authored.acknowledgement?.inputFingerprint });
  const changed = structuredClone(document);
  const changedValue = changed.groups.find(({ id }) => id === "eVitals.BloodPressureGroup")!.instances[0]!
    .elements.find(({ id }) => id === "eVitals.06")!.values[0]!;
  Object.assign(changedValue, { value: 121 });
  const changedFinding = validateStationaryRecord(changed, clinicalForm, evaluationTimestamp)
    .find(({ id }) => id.includes("systolic-rule"));
  assert.ok(changedFinding);
  assert.notEqual(changedFinding.id, authored.id, "the relevant-input fingerprint invalidates the acknowledged instance");
});

test("sign-only informational findings are visible but never require acknowledgement", () => {
  const bundle: CompiledValidationBundle = { schemaVersion: 1, languageVersion: "1.0.0",
    validationVersionId: "validation-version", catalogReleaseId: "catalog", rules: [{
      schemaVersion: 1, languageVersion: "1.0.0", ruleId: "information-rule", validationVersionId: "validation-version",
      name: "Information", enabled: true, severity: "information", executionTargets: ["sign"],
      primaryTarget: { elementId: "ePatient.02" }, message: "For awareness",
      assertion: { operator: "present", elementId: "element-that-is-not-present" },
      references: { elementIds: ["element-that-is-not-present"], codes: [] },
    }] };
  const clinicalForm = { definition: { schemaVersion: 1 as const, sections: [] }, catalogFields: {},
    validation: { versionId: "validation-version", compiledSha256: compiledValidationBundleSha256(bundle), bundle } };
  const finding = validateStationaryRecord(syntheticEncounter.document, clinicalForm, evaluationTimestamp)
    .find(({ id }) => id.includes("information-rule"));
  assert.equal(finding?.severity, "information");
  assert.equal(finding?.acknowledged, false);
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
