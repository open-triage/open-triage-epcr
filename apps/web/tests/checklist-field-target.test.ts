import assert from "node:assert/strict";
import test from "node:test";
import type { ClinicalFormConfiguration } from "@open-triage/contracts";
import { checklistFieldTarget } from "../app/checklist-field-target";
import { syntheticEncounter } from "../app/standard-encounter";
import { validateStationaryRecord } from "../app/stationary-validation";
import { editScalarNotValue, editScalarOccurrence } from "../app/stationary-scalar";
import { encounterDocumentToDraftMutations } from "../app/draft-report";

const form: ClinicalFormConfiguration = {
  definition: { schemaVersion: 1, sections: [{ key: "patient", fields: [
    { key: "first-name", required: true, source: { kind: "nemsis", elementId: "ePatient.02" } },
    { key: "gender", source: { kind: "nemsis", elementId: "ePatient.13" } },
  ] }] },
  catalogFields: {},
};

test("only a uniquely targeted flagged configured field opens an inline control", () => {
  const document = { ...syntheticEncounter.document, groups: syntheticEncounter.document.groups.map((group) =>
    group.id !== "ePatient.PatientNameGroup" ? group : { ...group, instances: group.instances.map((instance) => ({
      ...instance, elements: instance.elements.filter(({ id }) => id !== "ePatient.02"),
    })) }) };
  const findings = validateStationaryRecord(document, form, "2026-09-29T00:00:00Z");
  const firstName = findings.find(({ target }) => target.fieldId === "ePatient.02")!;
  assert.equal(checklistFieldTarget(firstName, document, form)?.kind, "standard-scalar");
  assert.equal(findings.some(({ target }) => target.fieldId === "ePatient.13"), false,
    "unanswered optional fields do not create checklist entries");
  assert.equal(checklistFieldTarget({ ...firstName, target: { ...firstName.target, groupInstanceId: undefined } }, document, form), undefined);
  assert.equal(checklistFieldTarget({ ...firstName, target: { ...firstName.target, fieldId: undefined } }, document, form), undefined);
  assert.equal(checklistFieldTarget(firstName, document, undefined), undefined);
  const correction = editScalarOccurrence(document, { groupId: firstName.target.groupId,
    groupInstanceId: firstName.target.groupInstanceId!, elementId: "ePatient.02", input: "Mira" });
  assert.equal(correction.ok, true);
  assert.equal(validateStationaryRecord(correction.document, form, "2026-09-29T00:00:00Z")
    .some(({ target }) => target.fieldId === "ePatient.02"), false);
  const mutation = encounterDocumentToDraftMutations("455d8423-412f-4c96-9ad5-b485c6a9506b", correction.document);
  const persisted = mutation.occurrences.find(({ elementId }) => elementId === "ePatient.02");
  assert.equal(persisted?.value?.kind, "text");
  if (persisted?.value?.kind === "text") assert.equal(persisted.value.value, "Mira");
  const unavailable = editScalarNotValue(correction.document, { groupId: firstName.target.groupId,
    groupInstanceId: firstName.target.groupInstanceId!, elementId: "ePatient.02",
    occurrenceId: correction.occurrenceId, code: "7701003" });
  const unavailableValue = unavailable.groups.find(({ id }) => id === firstName.target.groupId)!.instances[0]!
    .elements.find(({ id }) => id === "ePatient.02")!.values[0]!;
  assert.equal(unavailableValue.kind, "null");
  assert.equal(unavailableValue.notValue?.code, "7701003");
  const restored = editScalarOccurrence(unavailable, { groupId: firstName.target.groupId,
    groupInstanceId: firstName.target.groupInstanceId!, elementId: "ePatient.02",
    occurrenceId: correction.occurrenceId, input: "Mira" });
  assert.equal(restored.ok, true);
  const restoredValue = restored.document.groups.find(({ id }) => id === firstName.target.groupId)!.instances[0]!
    .elements.find(({ id }) => id === "ePatient.02")!.values[0]!;
  assert.equal(restoredValue.kind, "scalar");
  assert.equal(restoredValue.notValue, undefined);
});
