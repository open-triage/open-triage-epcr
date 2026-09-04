import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { EncounterDocument, EncounterValue } from "@open-triage/contracts";
import synthetic from "../app/data/synthetic-encounter-document.json";
import { encounterDocumentDiagnostics } from "../app/encounter-document";
import { encounterDocumentToDraftMutations } from "../app/draft-report";
import { loadShellStateResult, saveShellState } from "../app/local-persistence";
import { NEMSIS_DATA_MODEL, requireNemsisDataElement, type NemsisDataElement } from "../app/nemsis-data-model";
import { INITIAL_SHELL_STATE } from "../app/standard-encounter";
import {
  codedSelectionFromOption,
  editStationaryCodedValue,
  exceptionalSelection,
  stationaryCodedField,
  validateStationaryCodedSelection,
} from "../app/stationary-coded-value";
import { StationaryCodedValueField } from "../components/stationary-coded-field";

const reportId = "42000000-0000-4000-8000-000000000061";
const patientTarget = { groupId: "ePatientSection", instanceId: "synthetic-patient-1", elementId: "ePatient.25", occurrenceId: "synthetic-patient-sex" } as const;
const sceneTarget = { groupId: "eSceneSection", instanceId: "synthetic-scene-1", elementId: "eScene.09", occurrenceId: "synthetic-location-type" } as const;

function targetValue(document: EncounterDocument, target: typeof patientTarget | typeof sceneTarget): EncounterValue | undefined {
  return document.groups.find(({ id }) => id === target.groupId)?.instances
    .find(({ instanceId }) => instanceId === target.instanceId)?.elements
    .find(({ id }) => id === target.elementId)?.values.find(({ occurrenceId }) => occurrenceId === target.occurrenceId);
}

test("every pinned coded element compiles to the control required by its source kind", () => {
  const coded = NEMSIS_DATA_MODEL.elements.filter(({ valueSource }) => valueSource.kind !== "scalar");
  assert.ok(coded.length > 200);
  for (const element of coded) {
    const field = stationaryCodedField(element);
    assert.equal(field.controlKind, element.valueSource.kind === "inline-enumerated" ? "select" : element.valueSource.kind === "bundled-list" ? "combobox" : "external-search");
    assert.equal(field.exhaustive, element.valueSource.kind === "inline-enumerated");
    assert.deepEqual(field.exceptionalChoices.filter(({ kind }) => kind === "pertinent-negative").map((choice) => "code" in choice ? choice.code : undefined), element.permittedPertinentNegatives.map(({ code }) => code));
  }
});

test("inline controls expose only exhaustive catalog values and reject invented codes", () => {
  const element = requireNemsisDataElement("ePatient.25");
  const field = stationaryCodedField(element);
  assert.equal(field.controlKind, "select");
  assert.deepEqual(field.options.map(({ code, label }) => ({ code, label })), element.valueSource.kind === "inline-enumerated" ? element.valueSource.values : []);
  assert.throws(() => validateStationaryCodedSelection(field, { kind: "coded", code: "invented" }), /not in the exhaustive value set/);
});

test("bundled suggestions remain searchable and explicitly non-exhaustive", () => {
  const external = requireNemsisDataElement("eHistory.06");
  const bundled = { ...external, valueSource: { kind: "bundled-list", exhaustive: false, bundledListIds: external.valueSource.kind === "external-code-system" ? external.valueSource.bundledListIds : [] } } as NemsisDataElement;
  const field = stationaryCodedField(bundled);
  assert.equal(field.controlKind, "combobox");
  assert.equal(field.exhaustive, false);
  assert.ok(field.options.length > 0);
  assert.doesNotThrow(() => validateStationaryCodedSelection(field, { kind: "coded", code: "valid-code-not-in-suggestions" }));
  const html = renderToStaticMarkup(createElement(StationaryCodedValueField, { field, onChange() {} }));
  assert.match(html, /type="search"/);
  assert.match(html, /aria-autocomplete="list"/);
  assert.match(html, /Suggestions are not exhaustive/);
});

test("external suggestions retain code system, display, and terminology version", () => {
  const field = stationaryCodedField("eScene.09");
  assert.equal(field.controlKind, "external-search");
  assert.equal(field.exhaustive, false);
  const option = field.options[0]!;
  const selection = codedSelectionFromOption(option);
  assert.deepEqual(selection, {
    kind: "coded", code: option.code, display: option.label,
    system: option.system, terminologyVersion: option.terminologyVersion,
  });
  assert.match(renderToStaticMarkup(createElement(StationaryCodedValueField, { field, onChange() {} })), /Code system/);
  assert.throws(() => validateStationaryCodedSelection(field, { kind: "coded", code: "Y92.03" }), /requires a code system/);
  assert.throws(() => validateStationaryCodedSelection(field, { kind: "coded", code: "Y92.03", system: "invented" }), /not a supported code system/);
});

test("only catalog-permitted NV and PN choices are offered, including nillability", () => {
  const patient = stationaryCodedField("ePatient.25");
  assert.deepEqual(patient.exceptionalChoices.map(({ key }) => key), [
    "not-value:7701005", "not-value:7701003", "not-value:7701001",
    "pertinent-negative:8801023", "pertinent-negative:8801019",
  ]);
  const pregnancy = stationaryCodedField("eHistory.18");
  assert.equal(pregnancy.exceptionalChoices[0]?.key, "null");
  const nonNillable = stationaryCodedField("eAirway.09");
  assert.deepEqual(nonNillable.exceptionalChoices, []);
  assert.throws(() => exceptionalSelection(patient, "pertinent-negative:invented"), /not permitted/);
});

test("ordinary and exceptional selections replace one another without changing occurrence identity", () => {
  const document = structuredClone(synthetic) as EncounterDocument;
  const field = stationaryCodedField(patientTarget.elementId);
  const notRecorded = exceptionalSelection(field, "not-value:7701003")!;
  const exceptional = editStationaryCodedValue(document, patientTarget, notRecorded, () => "unused", new Date("2026-09-04T15:00:00.000Z"));
  assert.deepEqual(targetValue(exceptional, patientTarget), {
    kind: "null", occurrenceId: patientTarget.occurrenceId,
    notValue: { code: "7701003", display: "Not Recorded" },
  });
  const ordinary = editStationaryCodedValue(exceptional, patientTarget, codedSelectionFromOption(field.options[0]!), () => "unused");
  assert.equal(targetValue(ordinary, patientTarget)?.kind, "coded");
  assert.equal(targetValue(ordinary, patientTarget)?.occurrenceId, patientTarget.occurrenceId);
  assert.equal(encounterDocumentDiagnostics(ordinary).length, 0);
});

test("coded metadata and exceptional variants survive the local-document and draft API representations", () => {
  const document = structuredClone(synthetic) as EncounterDocument;
  const external = stationaryCodedField(sceneTarget.elementId);
  const selection = codedSelectionFromOption(external.options[0]!);
  assert.equal(selection.kind, "coded");
  if (selection.kind !== "coded") throw new Error("expected coded selection");
  const edited = editStationaryCodedValue(document, sceneTarget, selection, () => "unused");
  const bytes = new Map<string, string>();
  const storage = {
    getItem: (key: string) => bytes.get(key) ?? null,
    setItem: (key: string, value: string) => { bytes.set(key, value); },
    removeItem: (key: string) => { bytes.delete(key); },
  };
  saveShellState(storage, { ...INITIAL_SHELL_STATE, encounter: { ...INITIAL_SHELL_STATE.encounter, document: edited } }, reportId);
  const restored = loadShellStateResult(storage, undefined, reportId);
  assert.equal(restored.status, "restored");
  if (restored.status !== "restored") throw new Error("expected local report to reopen");
  const localRoundTrip = restored.state.encounter.document;
  assert.deepEqual(targetValue(localRoundTrip, sceneTarget), targetValue(edited, sceneTarget));
  const codedMutation = encounterDocumentToDraftMutations(reportId, localRoundTrip).occurrences.find(({ elementId }) => elementId === sceneTarget.elementId)!;
  assert.deepEqual(codedMutation.value, {
    kind: "coded", code: selection.code, codeSystem: selection.system,
    display: selection.display, terminologyVersion: selection.terminologyVersion,
  });

  const pn = editStationaryCodedValue(localRoundTrip, patientTarget, exceptionalSelection(stationaryCodedField(patientTarget.elementId), "pertinent-negative:8801019")!);
  const pnMutation = encounterDocumentToDraftMutations(reportId, pn).occurrences.find(({ elementId }) => elementId === patientTarget.elementId)!;
  assert.deepEqual(pnMutation.value, { kind: "pertinent-negative", absenceCode: "8801019", display: "Refused" });
});
