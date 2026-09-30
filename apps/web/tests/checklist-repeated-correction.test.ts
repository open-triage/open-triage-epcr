import assert from "node:assert/strict";
import test from "node:test";
import { compileValidationRule, evaluateValidationBundle, type CatalogDraftCustomGroup, type CatalogDraftCustomTextElement,
  type ClinicalFormConfiguration, type EncounterDocument } from "@open-triage/contracts";
import { syntheticEncounter } from "../app/standard-encounter";
import { validateStationaryRecord } from "../app/stationary-validation";
import { checklistFieldTarget } from "../app/checklist-field-target";
import { addCustomGroupInstance } from "../components/custom-group-fields";
import { setCustomOccurrence } from "../components/repeated-custom-fields";
import { encounterDocumentToDraftMutations } from "../app/draft-report";
import { deserializeEncounterDocument, serializeEncounterDocument } from "../app/encounter-document";
import { editStationaryCodedValue, configuredStationaryCodedField } from "../app/stationary-coded-value";

const medicationGroup = "eMedications.MedicationGroup";
const group: CatalogDraftCustomGroup = { id: "f064177e-d9aa-487e-b9d3-ad581e117b87", namespace: "org.example.ems",
  slug: "MedicationResponse", title: "Medication response", recurrence: "multiple", correlatesTo: medicationGroup };
const field: CatalogDraftCustomTextElement = { id: "d1519097-23a4-40e7-b097-631c8a134478", namespace: group.namespace,
  slug: "ResponseNote", title: "Response note", definition: "Response", datatype: "string", recurrence: "multiple",
  groupDefinitionId: group.id, correlatesTo: group.correlatesTo, usage: "Optional", constraints: { maxLength: 3 }, identifying: false };
const customGroupId = `${group.namespace}.${group.slug}`;
const customElementId = `${field.namespace}.${field.slug}`;
const form: ClinicalFormConfiguration = { definition: { schemaVersion: 1, sections: [{ key: "treatment", fields: [
  { key: "response", source: { kind: "custom", elementDefinitionId: field.id, groupDefinitionId: group.id } },
  { key: "complication", source: { kind: "nemsis", elementId: "eMedications.08" } },
] }] }, catalogFields: {}, customFields: { [field.id]: field }, customGroups: { [group.id]: group } };

function encounter(): EncounterDocument {
  let document: EncounterDocument = { ...syntheticEncounter.document, groups: [
    ...syntheticEncounter.document.groups.filter(({ id }) => id !== medicationGroup),
    { id: medicationGroup, instances: [
      { instanceId: "med-a", elements: [{ id: "eMedications.08", values: [
        { kind: "coded", occurrenceId: "comp-a", code: "invalid-a" }] }] },
      { instanceId: "med-b", elements: [{ id: "eMedications.08", values: [
        { kind: "coded", occurrenceId: "comp-b", code: "invalid-b" }] }] },
    ] },
  ] };
  document = addCustomGroupInstance(document, group, "med-a", "group-a");
  document = addCustomGroupInstance(document, group, "med-b", "group-b");
  document = setCustomOccurrence(document, field, "group-a", { kind: "scalar", occurrenceId: "value-a", value: "Too long A" }, undefined, customGroupId);
  return setCustomOccurrence(document, field, "group-b", { kind: "scalar", occurrenceId: "value-b", value: "Too long B" }, undefined, customGroupId);
}

test("two repeated findings identify their own medication, group, and value without guessing", () => {
  const document = encounter();
  const findings = validateStationaryRecord(document, form, "2026-09-30T00:00:00Z");
  const custom = findings.filter(({ target }) => target.fieldId === customElementId);
  assert.equal(custom.length, 2);
  assert.deepEqual(custom.map(({ target }) => [target.groupId, target.groupInstanceId, target.occurrenceId]), [
    [customGroupId, "group-a", "value-a"], [customGroupId, "group-b", "value-b"],
  ]);
  const a = checklistFieldTarget(custom[0]!, document, form)!;
  const b = checklistFieldTarget(custom[1]!, document, form)!;
  assert.notEqual(a.context, b.context);
  assert.match(a.context, /Medication/);
  assert.equal(checklistFieldTarget({ ...custom[0]!, target: { ...custom[0]!.target, occurrenceId: "missing" } }, document, form), undefined);
  assert.equal(checklistFieldTarget({ ...custom[0]!, target: { ...custom[0]!.target, groupInstanceId: undefined } }, document, form), undefined);
  assert.equal(checklistFieldTarget({ ...custom[0]!, target: { ...custom[0]!.target, groupId: medicationGroup } }, document, form), undefined);
  const corrected = setCustomOccurrence(document, field, a.instanceId,
    { kind: "scalar", occurrenceId: a.value!.occurrenceId, value: "Yes" }, a.value!.occurrenceId, a.groupId);
  const remaining = validateStationaryRecord(corrected, form, "2026-09-30T00:00:00Z")
    .filter(({ target }) => target.fieldId === customElementId);
  assert.deepEqual(remaining.map(({ target }) => target.occurrenceId), ["value-b"]);
  const mutations = encounterDocumentToDraftMutations(syntheticEncounter.document.encounter.id, corrected, undefined,
    form.customFields, form.customGroups);
  const projectedGroups = mutations.groups.filter(({ customGroupDefinitionId }) => customGroupDefinitionId === group.id);
  assert.equal(projectedGroups.length, 2);
  assert.notEqual(projectedGroups[0]!.id, projectedGroups[1]!.id);
  assert.notEqual(projectedGroups[0]!.parentGroupInstanceId, projectedGroups[1]!.parentGroupInstanceId);
  const projectedValues = mutations.occurrences.filter(({ elementId }) => elementId === customElementId);
  assert.deepEqual(projectedValues.map(({ groupInstanceId, value }) =>
    [groupInstanceId, value?.kind === "text" ? value.value : null]), [
      [projectedGroups[0]!.id, "Yes"], [projectedGroups[1]!.id, "Too long B"],
    ]);
  assert.notEqual(projectedValues[0]!.id, projectedValues[1]!.id);
  const validMedications = ["med-a", "med-b"].reduce((current, instanceId, index) =>
    editStationaryCodedValue(current, { groupId: medicationGroup, instanceId, elementId: "eMedications.08",
      occurrenceId: index === 0 ? "comp-a" : "comp-b", codedField: configuredStationaryCodedField("eMedications.08") },
    { kind: "coded", code: index === 0 ? "3708001" : "3708003" }), corrected);
  const recovered = deserializeEncounterDocument(serializeEncounterDocument(validMedications));
  assert.deepEqual(encounterDocumentToDraftMutations(syntheticEncounter.document.encounter.id,
    recovered, undefined, form.customFields, form.customGroups), encounterDocumentToDraftMutations(
      syntheticEncounter.document.encounter.id, validMedications, undefined, form.customFields, form.customGroups));
});

test("standard repeated entries correct only the flagged occurrence and preserve exceptional rules", () => {
  const document = encounter();
  const findings = validateStationaryRecord(document, form, "2026-09-30T00:00:00Z")
    .filter(({ target }) => target.fieldId === "eMedications.08" && target.occurrenceId);
  assert.deepEqual(findings.map(({ target }) => target.occurrenceId), ["comp-a", "comp-b"]);
  const target = checklistFieldTarget(findings[0]!, document, form)!;
  assert.equal(target.kind, "standard-coded");
  const corrected = editStationaryCodedValue(document, { groupId: target.groupId, instanceId: target.instanceId,
    elementId: target.elementId, occurrenceId: target.value!.occurrenceId,
    codedField: configuredStationaryCodedField(target.elementId) }, { kind: "coded", code: "3708001" });
  assert.deepEqual(validateStationaryRecord(corrected, form, "2026-09-30T00:00:00Z")
    .filter(({ target }) => target.fieldId === "eMedications.08" && target.occurrenceId)
    .map(({ target }) => target.occurrenceId), ["comp-b"]);
  assert.throws(() => editStationaryCodedValue(corrected, { groupId: medicationGroup, instanceId: "med-a",
    elementId: "eMedications.08", codedField: configuredStationaryCodedField("eMedications.08") },
  { kind: "null", code: "7701003" }), /cannot combine exceptional/);
});

test("an unscoped authored rule does not assign one of several matching occurrences", () => {
  const rule = compileValidationRule({ id: "9e76818e-0d60-4e0f-8038-faa07c5e27e3", name: "Third complication",
    enabled: true, severity: "error", executionTargets: ["live"], primaryTargetElementId: "eMedications.08",
    message: "Record three complications", source: 'require minimum("eMedications.08", 3)' },
  "42de526f-5d75-4394-9274-99d3af2501cc", new Set(["eMedications.08"]));
  assert.deepEqual(rule.diagnostics, []);
  const evaluated = evaluateValidationBundle({ schemaVersion: 1, languageVersion: "1.0.0",
    validationVersionId: "42de526f-5d75-4394-9274-99d3af2501cc", catalogReleaseId: "catalog", rules: [rule.compiled!] },
  encounter(), "live", { timestamp: "2026-09-30T00:00:00Z" });
  assert.equal(evaluated.length, 1);
  assert.deepEqual(evaluated[0]!.primaryTarget, { elementId: "eMedications.08" });
});
