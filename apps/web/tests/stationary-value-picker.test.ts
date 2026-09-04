import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { EncounterDocument, EncounterValue } from "@open-triage/contracts";
import synthetic from "../app/data/synthetic-encounter-document.json";
import { encounterDocumentToDraftMutations } from "../app/draft-report";
import { deserializeEncounterDocument, serializeEncounterDocument } from "../app/encounter-document";
import { requireNemsisDataElement } from "../app/nemsis-data-model";
import {
  editNonRepeatingScalarSelection,
  STATIONARY_NON_REPEATING_GROUPS,
} from "../app/stationary-non-repeating";
import { scalarControlPresentation } from "../app/stationary-scalar";
import { validateStationaryRecord } from "../app/stationary-validation";
import {
  stationaryExceptionalChoices,
  stationaryExceptionalSelection,
} from "../app/stationary-value-picker";
import { StationaryDatePicker } from "../components/stationary-date-picker";
import { StationaryNonRepeatingRecord } from "../components/stationary-non-repeating-record";

const patientGroupId = "ePatientSection";
const patientInstanceId = "synthetic-patient-1";
const elementId = "ePatient.17";
const occurrenceId = "synthetic-patient-dob";
const catalog = requireNemsisDataElement(elementId);
const presentation = scalarControlPresentation(catalog);

function dateOfBirth(document: EncounterDocument): EncounterValue | undefined {
  return document.groups.find(({ id }) => id === patientGroupId)?.instances
    .find(({ instanceId }) => instanceId === patientInstanceId)?.elements
    .find(({ id }) => id === elementId)?.values[0];
}

function edit(document: EncounterDocument, selection: Parameters<typeof editNonRepeatingScalarSelection>[2]) {
  const result = editNonRepeatingScalarSelection(document, {
    groupId: patientGroupId,
    groupInstanceId: patientInstanceId,
    elementId,
    occurrenceId,
  }, selection, () => "must-not-replace-identity", new Date("2026-09-04T12:00:00.000Z"));
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected Date of Birth edit to succeed");
  return result.document;
}

test("Date of Birth uses the common picker in the live Patient section", () => {
  const document = structuredClone(synthetic) as EncounterDocument;
  const patient = STATIONARY_NON_REPEATING_GROUPS.find(({ id }) => id === patientGroupId)!;
  const html = renderToStaticMarkup(createElement(StationaryNonRepeatingRecord, {
    document,
    groups: [patient],
    onDocumentChange() {},
  }));
  const start = html.indexOf(`data-element-id="${elementId}"`);
  const end = html.indexOf(`data-element-id="ePatient.18"`, start);
  const renderedDateOfBirth = html.slice(start, end);
  const initialDate = String((dateOfBirth(document) as Extract<EncounterValue, { kind: "scalar" }>).value);
  assert.match(renderedDateOfBirth, /stationary-value-picker/);
  assert.match(renderedDateOfBirth, /type="date"/);
  assert.match(renderedDateOfBirth, /Current selection/);
  assert.ok(renderedDateOfBirth.includes(initialDate));
  for (const choice of stationaryExceptionalChoices(catalog)) assert.match(renderedDateOfBirth, new RegExp(choice.label));
  assert.match(renderedDateOfBirth, /Clear selection/);
});

test("the reusable shell exposes disabled, invalid, help, and exceptional state accessibly", () => {
  const exceptional: EncounterValue = {
    kind: "null",
    occurrenceId,
    notValue: { code: "7701003", display: "Not Recorded" },
  };
  const html = renderToStaticMarkup(createElement(StationaryDatePicker, {
    presentation,
    catalog,
    value: exceptional,
    disabled: true,
    findings: [{ elementId, occurrenceId, code: "datatype", message: "Date of Birth is invalid." }],
    onChange() {},
  }));
  assert.match(html, /disabled=""/);
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /aria-describedby=/);
  assert.match(html, /role="alert"/);
  assert.match(html, /data-value-state="exceptional"/);
  assert.match(html, /<strong>Not Recorded<\/strong>/);
  assert.match(html, /The patient&#x27;s date of birth\./);
});

test("ordinary, NV, PN, reopened, draft, validation, and clear paths preserve one canonical identity", () => {
  let document = structuredClone(synthetic) as EncounterDocument;
  document = edit(document, { kind: "scalar", input: "1991-06-15" });
  assert.deepEqual(dateOfBirth(document), { kind: "scalar", occurrenceId, value: "1991-06-15", precision: "day" });

  document = edit(document, stationaryExceptionalSelection(catalog, "not-value:7701003"));
  assert.deepEqual(dateOfBirth(document), {
    kind: "null", occurrenceId, notValue: { code: "7701003", display: "Not Recorded" },
  });
  const draft = encounterDocumentToDraftMutations("report-068", document).occurrences.find(({ elementId: id }) => id === elementId)!;
  assert.deepEqual(draft.value, { kind: "null", absenceCode: "7701003", display: "Not Recorded" });

  document = deserializeEncounterDocument(serializeEncounterDocument(document));
  assert.equal(dateOfBirth(document)?.occurrenceId, occurrenceId);
  document = edit(document, stationaryExceptionalSelection(catalog, "pertinent-negative:8801019"));
  assert.deepEqual(dateOfBirth(document), {
    kind: "pertinent-negative", occurrenceId, code: "8801019", display: "Refused",
  });
  assert.equal(validateStationaryRecord(document).some(({ target }) => target.fieldId === elementId), false);

  document = edit(document, { kind: "scalar", input: "2000-02-29" });
  assert.equal(dateOfBirth(document)?.occurrenceId, occurrenceId);
  document = edit(document, undefined);
  assert.equal(dateOfBirth(document), undefined);
});

test("Date of Birth rejects exceptional values not permitted by the pinned catalog", () => {
  assert.throws(() => stationaryExceptionalSelection(catalog, "pertinent-negative:invented"), /not permitted for ePatient\.17/);
  assert.deepEqual(stationaryExceptionalChoices(catalog).map(({ key }) => key), [
    "not-value:7701005",
    "not-value:7701003",
    "not-value:7701001",
    "pertinent-negative:8801023",
    "pertinent-negative:8801019",
  ]);
});
