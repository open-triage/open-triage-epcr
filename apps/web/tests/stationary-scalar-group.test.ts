import assert from "node:assert/strict";
import test from "node:test";
import type { EncounterDocument } from "@open-triage/contracts";
import synthetic from "../app/data/synthetic-encounter-document.json";
import {
  editStationaryScalarValue,
  STATIONARY_SCALAR_FIELDS,
  stationaryScalarValues,
} from "../app/stationary-scalar-group";
import { encounterDocumentToDraftMutations } from "../app/draft-report";

const reportId = "42000000-0000-4000-8000-000000000059";

test("the configured stationary scalar group edits the canonical occurrence in place", () => {
  const document = structuredClone(synthetic) as EncounterDocument;
  const group = document.groups.find(({ id }) => id === "ePatient.PatientNameGroup")!;
  const beforeInstanceId = group.instances[0]!.instanceId;
  const beforeOccurrenceId = group.instances[0]!.elements.find(({ id }) => id === "ePatient.03")!.values[0]!.occurrenceId;

  const edited = editStationaryScalarValue(document, "ePatient.03", "STATIONARY", () => "unused", new Date("2026-09-04T12:00:00.000Z"));
  const editedGroup = edited.groups.find(({ id }) => id === "ePatient.PatientNameGroup")!;
  const editedValue = editedGroup.instances[0]!.elements.find(({ id }) => id === "ePatient.03")!.values[0]!;

  assert.equal(stationaryScalarValues(edited)["ePatient.03"], "STATIONARY");
  assert.equal(editedGroup.instances[0]!.instanceId, beforeInstanceId);
  assert.equal(editedValue.occurrenceId, beforeOccurrenceId);
  assert.equal(edited.encounter.updatedAt, "2026-09-04T12:00:00.000Z");
  const mutation = encounterDocumentToDraftMutations(reportId, edited).occurrences.find(({ elementId }) => elementId === "ePatient.03")!;
  assert.deepEqual(mutation.value, { kind: "text", value: "STATIONARY" });
});

test("the first stationary slice is sourced from the compiled editable layout", () => {
  assert.deepEqual(STATIONARY_SCALAR_FIELDS.map(({ id }) => id), ["ePatient.02", "ePatient.03", "ePatient.04"]);
  assert.deepEqual(STATIONARY_SCALAR_FIELDS.map(({ label }) => label), ["Last Name", "First Name", "Middle Initial/Name"]);
});
