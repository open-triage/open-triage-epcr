import assert from "node:assert/strict";
import test from "node:test";
import type { EncounterDocument } from "@open-triage/contracts";
import synthetic from "../app/data/synthetic-encounter-document.json";
import { encounterDocumentToDraftMutations } from "../app/draft-report";
import { requireNemsisDataElement, type NemsisDataElement } from "../app/nemsis-data-model";
import {
  editScalarOccurrence,
  moveScalarOccurrence,
  removeScalarOccurrence,
  scalarControlPresentation,
  scalarEncounterValue,
  scalarOccurrences,
  STATIONARY_SCALAR_PRESENTATIONS,
  validateScalarInput,
} from "../app/stationary-scalar";

const reportId = "42000000-0000-4000-8000-000000000060";
const patientGroupId = "ePatientSection";
const patientInstanceId = "synthetic-patient-1";

function definition(base: string, constraints: Readonly<Record<string, string | number>> = {}): NemsisDataElement {
  return {
    ...requireNemsisDataElement("ePatient.02"),
    id: `test.${base}`,
    name: `${base} value`,
    datatype: { base, xsdBase: base, typeChain: [base], constraints },
    occurrence: { min: 0, max: 1 },
  };
}

test("the pinned stationary catalog generates a usable control for every represented scalar family", () => {
  assert.deepEqual(new Set(STATIONARY_SCALAR_PRESENTATIONS.map(({ family }) => family)), new Set(["text", "numeric", "integer", "date", "datetime", "binary"]));
  assert.equal(STATIONARY_SCALAR_PRESENTATIONS.find(({ elementId }) => elementId === "ePatient.17")?.inputType, "date");
  assert.equal(STATIONARY_SCALAR_PRESENTATIONS.find(({ elementId }) => elementId === "eVitals.16")?.step, "0.1");
  assert.equal(STATIONARY_SCALAR_PRESENTATIONS.find(({ elementId }) => elementId === "eOther.11")?.inputType, "file");

  assert.equal(scalarControlPresentation(definition("boolean")).inputType, "checkbox");
  assert.equal(scalarControlPresentation(definition("time")).family, "time");
  assert.equal(scalarControlPresentation(definition("anyURI")).inputType, "url");
  assert.equal(scalarControlPresentation(definition("duration")).family, "duration");
});

test("all scalar datatype families reject unsupported input with element-associated feedback", () => {
  const invalid: ReadonlyArray<[NemsisDataElement, string | boolean]> = [
    [definition("string", { pattern: "[A-Z]+" }), "lower"],
    [definition("decimal", { fractionDigits: 2 }), "12.345"],
    [definition("integer"), "1.5"],
    [definition("boolean"), "yes"],
    [definition("date"), "2026-02-30"],
    [definition("dateTime"), "2026-09-04T12:30"],
    [definition("time"), "noon"],
    [definition("anyURI"), "not a uri"],
    [definition("duration"), "90 minutes"],
    [definition("binary"), "%%%"],
  ];
  for (const [element, input] of invalid) {
    const findings = validateScalarInput(element, input, "occurrence-1");
    assert.ok(findings.length, `${element.datatype.base} should be rejected`);
    assert.ok(findings.every(({ elementId, occurrenceId }) => elementId === element.id && occurrenceId === "occurrence-1"));
  }
});

test("typed values retain lexical, precision, offset, and source attribute metadata", () => {
  assert.deepEqual(scalarEncounterValue(definition("decimal"), "001.20", "numeric"), {
    kind: "scalar", occurrenceId: "numeric", value: "001.20", lexical: "001.20",
  });
  assert.deepEqual(scalarEncounterValue(definition("dateTime"), "2026-09-04T12:30:45.120-04:00", "datetime", { source: "monitor" }), {
    kind: "scalar", occurrenceId: "datetime", value: "2026-09-04T12:30:45.120-04:00",
    attributes: { source: "monitor" }, precision: "fractional-3", utcOffsetMinutes: -240,
  });
  assert.deepEqual(scalarEncounterValue(definition("boolean"), false, "boolean"), {
    kind: "scalar", occurrenceId: "boolean", value: false,
  });
});

test("repeatable scalar occurrences add, edit, order, remove, and project stable draft identities", () => {
  let document = structuredClone(synthetic) as EncounterDocument;
  const original = scalarOccurrences(document, patientGroupId, patientInstanceId, "ePatient.18");
  assert.deepEqual(original.map(({ occurrenceId }) => occurrenceId), ["synthetic-phone-home", "synthetic-phone-mobile"]);

  const added = editScalarOccurrence(document, {
    groupId: patientGroupId, groupInstanceId: patientInstanceId, elementId: "ePatient.18",
    input: "+12125550103", attributes: { PhoneNumberType: "9913007" },
  }, () => "stable-office", new Date("2026-09-04T12:00:00Z"));
  assert.equal(added.ok, true);
  if (!added.ok) return;
  document = added.document;
  assert.equal(added.occurrenceId, "stable-office");

  const edited = editScalarOccurrence(document, {
    groupId: patientGroupId, groupInstanceId: patientInstanceId, elementId: "ePatient.18",
    occurrenceId: "stable-office", input: "+12125550104",
  });
  assert.equal(edited.ok, true);
  if (!edited.ok) return;
  document = edited.document;
  assert.deepEqual(scalarOccurrences(document, patientGroupId, patientInstanceId, "ePatient.18").at(-1), {
    kind: "scalar", occurrenceId: "stable-office", value: "+12125550104", attributes: { PhoneNumberType: "9913007" },
  });

  const moved = moveScalarOccurrence(document, patientGroupId, patientInstanceId, "ePatient.18", "stable-office", 0);
  assert.equal(moved.ok, true);
  if (!moved.ok) return;
  document = moved.document;
  assert.deepEqual(scalarOccurrences(document, patientGroupId, patientInstanceId, "ePatient.18").map(({ occurrenceId }) => occurrenceId), ["stable-office", "synthetic-phone-home", "synthetic-phone-mobile"]);

  const draft = encounterDocumentToDraftMutations(reportId, document).occurrences.filter(({ elementId }) => elementId === "ePatient.18");
  assert.deepEqual(draft.map(({ ordinal }) => ordinal), [0, 1, 2]);
  assert.deepEqual(draft[0]?.sourceAttributes, { PhoneNumberType: "9913007" });
  const stableDraftId = draft[0]?.id;

  const removed = removeScalarOccurrence(document, patientGroupId, patientInstanceId, "ePatient.18", "synthetic-phone-home");
  assert.equal(removed.ok, true);
  if (!removed.ok) return;
  const reopenedDraft = encounterDocumentToDraftMutations(reportId, removed.document).occurrences.find(({ elementId, ordinal }) => elementId === "ePatient.18" && ordinal === 0);
  assert.equal(reopenedDraft?.id, stableDraftId);
});

test("invalid edits leave the canonical document untouched", () => {
  const document = structuredClone(synthetic) as EncounterDocument;
  const result = editScalarOccurrence(document, {
    groupId: patientGroupId, groupInstanceId: patientInstanceId, elementId: "ePatient.17",
    occurrenceId: "synthetic-patient-dob", input: "not-a-date",
  });
  assert.equal(result.ok, false);
  assert.equal(result.document, document);
  if (!result.ok) assert.deepEqual(result.findings.map(({ elementId }) => elementId), ["ePatient.17"]);
});
