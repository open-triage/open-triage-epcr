import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { EncounterDocument, EncounterValue } from "@open-triage/contracts";
import synthetic from "../app/data/synthetic-encounter-document.json";
import { encounterDocumentToDraftMutations } from "../app/draft-report";
import { deserializeEncounterDocument, serializeEncounterDocument } from "../app/encounter-document";
import { requireNemsisDataElement } from "../app/nemsis-data-model";
import { editNonRepeatingScalarSelection, STATIONARY_NON_REPEATING_GROUPS } from "../app/stationary-non-repeating";
import { editScalarSelection, scalarControlPresentation, validateScalarInput } from "../app/stationary-scalar";
import { stationaryExceptionalChoices, stationaryExceptionalSelection } from "../app/stationary-value-picker";
import { StationaryNonRepeatingRecord } from "../components/stationary-non-repeating-record";
import { StationaryNumericPicker } from "../components/stationary-numeric-picker";

function valueAt(document: EncounterDocument, groupId: string, instanceId: string, elementId: string): EncounterValue | undefined {
  return document.groups.find(({ id }) => id === groupId)?.instances.find(({ instanceId: id }) => id === instanceId)
    ?.elements.find(({ id }) => id === elementId)?.values[0];
}

test("numeric picker renders catalog constraints, state, and exactly the catalog exceptional choices", () => {
  const catalog = requireNemsisDataElement("eExam.01");
  const presentation = scalarControlPresentation(catalog);
  const html = renderToStaticMarkup(createElement(StationaryNumericPicker, {
    presentation,
    catalog,
    value: { kind: "scalar", occurrenceId: "weight-1", value: 72.5, lexical: "72.5" },
    onChange() {},
  }));
  assert.match(html, /stationary-value-picker/);
  assert.match(html, /data-value-state="ordinary"/);
  assert.match(html, /type="number"/);
  assert.match(html, /min="0.1"/);
  assert.match(html, /max="999.9"/);
  assert.match(html, /step="0.1"/);
  for (const choice of stationaryExceptionalChoices(catalog)) assert.match(html, new RegExp(choice.label));
  assert.equal((html.match(/<option /g) ?? []).length, stationaryExceptionalChoices(catalog).length + 1);
});

test("editable inline integer and decimal fields use the common picker in the live record", () => {
  const document = structuredClone(synthetic) as EncounterDocument;
  const groups = STATIONARY_NON_REPEATING_GROUPS.filter(({ id }) => ["eExamSection", "ePatient.AgeGroup"].includes(id));
  const html = renderToStaticMarkup(createElement(StationaryNonRepeatingRecord, { document, groups, onDocumentChange() {} }));
  for (const elementId of ["eExam.01", "ePatient.15"]) {
    const start = html.indexOf(`data-element-id="${elementId}"`);
    assert.notEqual(start, -1);
    assert.match(html.slice(start, start + 5000), /stationary-value-picker/);
    assert.match(html.slice(start, start + 5000), /type="number"/);
  }
});

test("numeric ordinary and exceptional edits preserve occurrence identity across persistence formats", () => {
  let document = structuredClone(synthetic) as EncounterDocument;
  const groupId = "eExamSection";
  const elementId = "eExam.01";
  const first = editNonRepeatingScalarSelection(document, { groupId, elementId }, { kind: "scalar", input: "82.5" },
    () => "numeric-identity", new Date("2026-09-04T12:00:00.000Z"));
  assert.equal(first.ok, true);
  if (!first.ok) throw new Error("ordinary weight edit failed");
  document = first.document;
  const instanceId = document.groups.find(({ id }) => id === groupId)!.instances[0]!.instanceId;
  assert.deepEqual(valueAt(document, groupId, instanceId, elementId), {
    kind: "scalar", occurrenceId: "numeric-identity", value: "82.5", lexical: "82.5",
  });

  const exceptional = editScalarSelection(document, { groupId, groupInstanceId: instanceId, elementId, occurrenceId: "numeric-identity",
    selection: stationaryExceptionalSelection(elementId, "pertinent-negative:8801023") },
  () => "must-not-replace", new Date("2026-09-04T12:01:00.000Z"));
  assert.equal(exceptional.ok, true);
  if (!exceptional.ok) throw new Error("exceptional weight edit failed");
  document = deserializeEncounterDocument(serializeEncounterDocument(exceptional.document));
  assert.deepEqual(valueAt(document, groupId, instanceId, elementId), {
    kind: "pertinent-negative", occurrenceId: "numeric-identity", code: "8801023", display: "Unable to Complete",
  });
  const draft = encounterDocumentToDraftMutations("report-070", document).occurrences.find(({ elementId: id }) => id === elementId)!;
  assert.deepEqual(draft.value, { kind: "pertinent-negative", absenceCode: "8801023", display: "Unable to Complete" });
});

test("numeric validation retains required, integer, range, precision, and step rules", () => {
  const age = requireNemsisDataElement("ePatient.15");
  const weight = requireNemsisDataElement("eExam.01");
  assert.deepEqual(validateScalarInput(age, "1.5").map(({ code }) => code), ["datatype"]);
  assert.deepEqual(validateScalarInput(age, "121").map(({ code }) => code), ["maximum"]);
  assert.deepEqual(validateScalarInput(age, "").map(({ code }) => code), ["required"]);
  assert.deepEqual(validateScalarInput(weight, "82.55").map(({ code }) => code), ["datatype"]);

  const html = renderToStaticMarkup(createElement(StationaryNumericPicker, {
    presentation: scalarControlPresentation(age), catalog: age, onChange() {},
  }));
  assert.match(html, /required=""/);
  assert.match(html, /step="1"/);
});
