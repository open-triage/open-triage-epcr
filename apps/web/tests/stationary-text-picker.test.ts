import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { EncounterDocument, EncounterValue } from "@open-triage/contracts";
import synthetic from "../app/data/synthetic-encounter-document.json";
import { deserializeEncounterDocument, serializeEncounterDocument } from "../app/encounter-document";
import { requireNemsisDataElement } from "../app/nemsis-data-model";
import { STATIONARY_NON_REPEATING_GROUPS } from "../app/stationary-non-repeating";
import {
  editScalarSelection,
  moveScalarOccurrence,
  scalarControlPresentation,
  scalarElementValues,
} from "../app/stationary-scalar";
import { stationaryExceptionalChoices, stationaryExceptionalSelection } from "../app/stationary-value-picker";
import { StationaryNonRepeatingRecord } from "../components/stationary-non-repeating-record";
import { StationaryTextPicker } from "../components/stationary-text-picker";

const patientNameGroupId = "ePatient.PatientNameGroup";
const patientNameInstanceId = "synthetic-patient-name-1";
const lastNameId = "ePatient.02";
const lastNameOccurrenceId = "synthetic-patient-last-name";
const lastNameCatalog = requireNemsisDataElement(lastNameId);

function lastName(document: EncounterDocument): EncounterValue | undefined {
  return scalarElementValues(document, patientNameGroupId, patientNameInstanceId, lastNameId)[0];
}

function editLastName(document: EncounterDocument, selection: Parameters<typeof editScalarSelection>[1]["selection"]): EncounterDocument {
  const result = editScalarSelection(document, {
    groupId: patientNameGroupId,
    groupInstanceId: patientNameInstanceId,
    elementId: lastNameId,
    occurrenceId: lastNameOccurrenceId,
    ...(selection ? { selection } : {}),
  }, () => "must-not-replace-identity", new Date("2026-09-04T12:00:00.000Z"));
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected text edit to succeed");
  return result.document;
}

test("patient identity text fields use the common picker in the live stationary record", () => {
  const patientNames = STATIONARY_NON_REPEATING_GROUPS.find(({ id }) => id === patientNameGroupId)!;
  const html = renderToStaticMarkup(createElement(StationaryNonRepeatingRecord, {
    document: structuredClone(synthetic) as EncounterDocument,
    groups: [patientNames],
    onDocumentChange() {},
  }));
  assert.ok((html.match(/stationary-value-picker/g) ?? []).length >= 3);
  for (const id of ["ePatient.02", "ePatient.03", "ePatient.04"]) {
    assert.ok(html.includes(`data-element-id="${id}"`));
  }
  assert.match(html, /Current selection/);
  assert.match(html, /Clear selection/);
  for (const choice of stationaryExceptionalChoices(lastNameCatalog)) assert.match(html, new RegExp(choice.label));
});

test("text constraints and accessible state are retained by the common picker", () => {
  const value = lastName(structuredClone(synthetic) as EncounterDocument);
  const html = renderToStaticMarkup(createElement(StationaryTextPicker, {
    presentation: scalarControlPresentation(lastNameCatalog),
    catalog: lastNameCatalog,
    value,
    findings: [{ elementId: lastNameId, occurrenceId: lastNameOccurrenceId, code: "length", message: "Last name is too long." }],
    onChange() {},
  }));
  assert.match(html, /minLength="1"/);
  assert.match(html, /maxLength="60"/);
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /data-value-state="ordinary"/);
  assert.match(html, /SYNTHETIC-01/);
  assert.match(html, /role="alert"/);
});

test("text ordinary, NV, PN, reopened, and clear transitions preserve canonical identity", () => {
  let document = structuredClone(synthetic) as EncounterDocument;
  document = editLastName(document, { kind: "scalar", input: "Rivera" });
  assert.deepEqual(lastName(document), { kind: "scalar", occurrenceId: lastNameOccurrenceId, value: "Rivera" });
  document = editLastName(document, stationaryExceptionalSelection(lastNameCatalog, "not-value:7701003"));
  assert.deepEqual(lastName(document), { kind: "null", occurrenceId: lastNameOccurrenceId, notValue: { code: "7701003", display: "Not Recorded" } });
  document = deserializeEncounterDocument(serializeEncounterDocument(document));
  document = editLastName(document, stationaryExceptionalSelection(lastNameCatalog, "pertinent-negative:8801019"));
  assert.deepEqual(lastName(document), { kind: "pertinent-negative", occurrenceId: lastNameOccurrenceId, code: "8801019", display: "Refused" });
  document = editLastName(document, undefined);
  assert.equal(lastName(document), undefined);
});

test("repeatable text ordering includes exceptional occurrences", () => {
  const document = structuredClone(synthetic) as EncounterDocument;
  const patient = document.groups.find(({ id }) => id === "ePatientSection")!.instances[0]!;
  const phoneId = "ePatient.18";
  const catalog = requireNemsisDataElement(phoneId);
  const before = scalarElementValues(document, "ePatientSection", patient.instanceId, phoneId);
  const added = editScalarSelection(document, {
    groupId: "ePatientSection", groupInstanceId: patient.instanceId, elementId: phoneId,
    selection: stationaryExceptionalSelection(catalog, "pertinent-negative:8801023"),
  }, () => "phone-exception");
  assert.equal(added.ok, true);
  if (!added.ok) return;
  const moved = moveScalarOccurrence(added.document, "ePatientSection", patient.instanceId, phoneId, "phone-exception", 0);
  assert.equal(moved.ok, true);
  if (!moved.ok) return;
  assert.deepEqual(scalarElementValues(moved.document, "ePatientSection", patient.instanceId, phoneId).map(({ occurrenceId }) => occurrenceId), [
    "phone-exception", ...before.map(({ occurrenceId }) => occurrenceId),
  ]);
});
