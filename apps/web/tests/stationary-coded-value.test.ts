import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { readFile } from "node:fs/promises";
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
  configuredStationaryCodedField,
  editStationaryCodedValue,
  exceptionalSelection,
  repeatableExceptionalChoices,
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

test("report-pinned catalog choices replace generated labels, ordering, and availability", () => {
  const field = configuredStationaryCodedField("ePatient.25", {
    agencyRequired: false, minOccurs: 0, maxOccurs: 1, nillable: true,
    supportsNotValues: true, supportsPertinentNegatives: true,
    codeChoices: [
      { code: "9906003", codeSystem: "", label: "Configured unknown" },
      { code: "9906001", codeSystem: "", label: "Configured female" },
    ],
  });
  assert.deepEqual(field.options.map(({ code, label }) => ({ code, label })), [
    { code: "9906003", label: "Configured unknown" },
    { code: "9906001", label: "Configured female" },
  ]);
  assert.throws(() => validateStationaryCodedSelection(field, { kind: "coded", code: "9906005" }), /not in the exhaustive value set/);
});

test("bundled canonical options render as one label-only dropdown", () => {
  const external = requireNemsisDataElement("eHistory.06");
  const bundled = { ...external, valueSource: { kind: "bundled-list", exhaustive: false, bundledListIds: external.valueSource.kind === "external-code-system" ? external.valueSource.bundledListIds : [] } } as NemsisDataElement;
  const field = stationaryCodedField(bundled);
  assert.equal(field.controlKind, "combobox");
  assert.equal(field.exhaustive, false);
  assert.ok(field.options.length > 0);
  assert.doesNotThrow(() => validateStationaryCodedSelection(field, { kind: "coded", code: "valid-code-not-in-suggestions" }));
  const html = renderToStaticMarkup(createElement(StationaryCodedValueField, { field, onChange() {} }));
  assert.equal((html.match(/class="clinical-searchable-trigger"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /type="search"|>Display<|Apply coded value/);
  assert.ok(field.options.some(({ label }) => label === "Analgesic"));
});

test("a populated coded dropdown presents deletion as its first option", () => {
  const document = structuredClone(synthetic) as EncounterDocument;
  const value = targetValue(document, patientTarget);
  const html = renderToStaticMarkup(createElement(StationaryCodedValueField, {
    field: stationaryCodedField(patientTarget.elementId), value, onChange() {},
  }));
  assert.match(html, /clinical-searchable-trigger[^>]*>Unknown/);
});

test("external canonical options retain metadata behind one dropdown", () => {
  const field = stationaryCodedField("eScene.09");
  assert.equal(field.controlKind, "external-search");
  assert.equal(field.exhaustive, false);
  const option = field.options[0]!;
  const selection = codedSelectionFromOption(option);
  assert.deepEqual(selection, {
    kind: "coded", code: option.code, display: option.label,
    system: option.system, terminologyVersion: option.terminologyVersion,
  });
  const html = renderToStaticMarkup(createElement(StationaryCodedValueField, { field, onChange() {} }));
  assert.equal((html.match(/class="clinical-searchable-trigger"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Code system|>Display<|type="search"/);
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
  const airway = stationaryCodedField("eAirway.01");
  const html = renderToStaticMarkup(createElement(StationaryCodedValueField, { field: airway, onChange() {} }));
  assert.match(html, /Set unavailable or pertinent-negative value for/);
  assert.doesNotMatch(html, />Exceptional value</);
});

test("repeatable coded pickers offer each pertinent-negative value only once", () => {
  const field = stationaryCodedField("ePatient.14");
  const pertinentNegative = field.exceptionalChoices.find(({ kind }) => kind === "pertinent-negative")!;
  assert.ok("code" in pertinentNegative);
  const selected = { kind: "pertinent-negative" as const, occurrenceId: "pn-1", code: pertinentNegative.code };
  assert.equal(repeatableExceptionalChoices(field, [selected]).some(({ key }) => key === pertinentNegative.key), false);
  assert.equal(repeatableExceptionalChoices(field, [selected], selected).some(({ key }) => key === pertinentNegative.key), true);
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

test("removing the final coded or exceptional value drops its element and emits a tombstone", () => {
  const document = structuredClone(synthetic) as EncounterDocument;
  const persisted = encounterDocumentToDraftMutations(reportId, document);
  const exceptional = editStationaryCodedValue(
    document,
    patientTarget,
    exceptionalSelection(stationaryCodedField(patientTarget.elementId), "not-value:7701003")!,
  );
  const removed = editStationaryCodedValue(exceptional, patientTarget, undefined);

  const patient = removed.groups.find(({ id }) => id === patientTarget.groupId)!.instances
    .find(({ instanceId }) => instanceId === patientTarget.instanceId)!;
  assert.equal(patient.elements.find(({ id }) => id === patientTarget.elementId), undefined);
  assert.deepEqual(encounterDocumentDiagnostics(removed), []);

  const mutations = encounterDocumentToDraftMutations(reportId, removed, persisted);
  const original = persisted.occurrences.find(({ elementId }) => elementId === patientTarget.elementId)!;
  assert.deepEqual(mutations.occurrences.find(({ id }) => id === original.id), {
    id: original.id,
    elementId: original.elementId,
    groupInstanceId: original.groupInstanceId,
    ordinal: original.ordinal,
    tombstone: true,
  });
});

test("adding repeatable coded values appends instead of replacing an existing occurrence", () => {
  const document = structuredClone(synthetic) as EncounterDocument;
  const target = { groupId: "ePatientSection", instanceId: "synthetic-patient-1", elementId: "ePatient.14" } as const;
  const field = stationaryCodedField(target.elementId);
  const before = document.groups.find(({ id }) => id === target.groupId)!.instances[0]!.elements.find(({ id }) => id === target.elementId)?.values ?? [];
  const edited = editStationaryCodedValue(document, target, codedSelectionFromOption(field.options[1]!), () => "second-race");
  const after = edited.groups.find(({ id }) => id === target.groupId)!.instances[0]!.elements.find(({ id }) => id === target.elementId)!.values;
  assert.equal(after.length, before.length + 1);
  assert.deepEqual(after.slice(0, before.length), before);
  assert.equal(after.at(-1)?.occurrenceId, "second-race");
});

test("repeatable coded choices persist separately and reject duplicate or exceptional combinations", () => {
  const target = { groupId: "ePatientSection", instanceId: "synthetic-patient-1", elementId: "ePatient.14" } as const;
  const field = stationaryCodedField(target.elementId);
  const first = codedSelectionFromOption(field.options[0]!);
  const second = codedSelectionFromOption(field.options[1]!);
  const one = editStationaryCodedValue(structuredClone(synthetic) as EncounterDocument, target, first, () => "race-one");
  const two = editStationaryCodedValue(one, target, second, () => "race-two");
  const mutations = encounterDocumentToDraftMutations(reportId, two).occurrences.filter(({ elementId }) => elementId === target.elementId);
  assert.deepEqual(two.groups.find(({ id }) => id === target.groupId)!.instances[0]!.elements
    .find(({ id }) => id === target.elementId)!.values.map(({ occurrenceId }) => occurrenceId), ["race-one", "race-two"]);
  assert.deepEqual(mutations.map(({ value }) => value?.kind), ["coded", "coded"]);
  assert.throws(() => editStationaryCodedValue(two, target, first), /already has this choice/);
  const exceptional = field.exceptionalChoices.find(({ key }) => key.startsWith("not-value:") || key.startsWith("pertinent-negative:"));
  if (exceptional) assert.throws(() => editStationaryCodedValue(two, target, exceptionalSelection(field, exceptional.key)),
    /cannot combine exceptional/);
  const removed = editStationaryCodedValue(two, { ...target, occurrenceId: "race-one" }, undefined);
  assert.deepEqual(removed.groups.find(({ id }) => id === target.groupId)!.instances[0]!.elements
    .find(({ id }) => id === target.elementId)!.values.map(({ occurrenceId }) => occurrenceId), ["race-two"]);
});

test("coded metadata and exceptional variants survive the local-document and draft API representations", () => {
  const document = structuredClone(synthetic) as EncounterDocument;
  const external = stationaryCodedField(sceneTarget.elementId);
  const selection = codedSelectionFromOption(external.options[0]!);
  assert.equal(selection.kind, "coded");
  if (selection.kind !== "coded") throw new Error("expected coded selection");
  const { occurrenceId, ...newSceneTarget } = sceneTarget;
  const edited = editStationaryCodedValue(document, newSceneTarget, selection, () => occurrenceId);
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

test("a report reopens locally with an agency code from its pinned catalog", () => {
  const document = structuredClone(synthetic) as EncounterDocument;
  const patient = document.groups.find(({ id }) => id === "ePatientSection")!.instances[0]!;
  (patient.elements as Array<EncounterDocument["groups"][number]["instances"][number]["elements"][number]>).push({ id: "ePatient.14", values: [{
    kind: "coded", occurrenceId: "agency-race-1", code: "251414SE", system: "Agency", display: "Swedish",
  }] });
  const bytes = new Map<string, string>();
  const storage = {
    getItem: (key: string) => bytes.get(key) ?? null,
    setItem: (key: string, value: string) => { bytes.set(key, value); },
    removeItem: (key: string) => { bytes.delete(key); },
  };
  saveShellState(storage, { ...INITIAL_SHELL_STATE, encounter: { ...INITIAL_SHELL_STATE.encounter, document } }, reportId);

  const restored = loadShellStateResult(storage, undefined, reportId, {
    ...document.formProfile,
    catalogFields: { "ePatient.14": {
      agencyRequired: false, requirednessSeverity: null, minOccurs: 0, maxOccurs: null,
      nillable: true, supportsNotValues: true, supportsPertinentNegatives: false,
      codeChoices: [{ code: "251414SE", codeSystem: "Agency", label: "Swedish" }],
    } },
  });

  assert.equal(restored.status, "restored");
  if (restored.status !== "restored") throw new Error("expected agency-coded report to reopen");
  assert.equal(restored.state.encounter.document.groups.find(({ id }) => id === "ePatientSection")!
    .instances[0]!.elements.find(({ id }) => id === "ePatient.14")!.values[0]?.kind, "coded");
});

test("Swedish choice and absence text preserve the selected clinical codes", () => {
  const previous = globalThis.document;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: { lang: "sv" } } });
  try {
    const field = configuredStationaryCodedField("eProcedures.06", {
      agencyRequired: false, minOccurs: 0, maxOccurs: 1, nillable: true,
      supportsNotValues: true, supportsPertinentNegatives: false,
      codeChoices: [{ code: "9923003", codeSystem: "", label: "Yes",
        localization: { schemaVersion: 1, sv: { label: "Ja" } } }],
      exceptionalChoices: [{ key: "not-value:7701003", localization: { schemaVersion: 1,
        sv: { label: "Ej registrerat" } } }],
    });
    assert.equal(field.options[0]?.label, "Ja");
    assert.equal(codedSelectionFromOption(field.options[0]!).code, "9923003");
    assert.equal(field.exceptionalChoices.find(({ key }) => key === "not-value:7701003")?.label, "Ej registrerat");
    assert.equal(exceptionalSelection(field, "not-value:7701003")?.code, "7701003");
  } finally { Object.defineProperty(globalThis, "document", { configurable: true, value: previous }); }
});

test("coded picker distinguishes the same code in different systems", () => {
  const base = stationaryCodedField("ePatient.25");
  const field = { ...base, options: [
    { code: "SHARED", system: "urn:first", label: "First", suggested: true },
    { code: "SHARED", system: "urn:second", label: "Second", suggested: true },
  ] };
  assert.doesNotThrow(() => validateStationaryCodedSelection(field, { kind: "coded", code: "SHARED", system: "urn:second" }));
  assert.throws(() => validateStationaryCodedSelection(field, { kind: "coded", code: "SHARED", system: "urn:third" }), /exhaustive/);
  const html = renderToStaticMarkup(createElement(StationaryCodedValueField, { field, onChange() {} }));
  assert.deepEqual(field.options.map(({ label, system }) => [label, system]), [["First", "urn:first"], ["Second", "urn:second"]]);
  assert.match(html, /clinical-searchable-trigger/);
});


test("shipped Swedish choice seed appears in the clinical picker without changing coded values", async () => {
  const seed = JSON.parse(await readFile(new URL("../../../defines/localization/localization_sv.json", import.meta.url), "utf8"));
  const source = requireNemsisDataElement("eMedications.06");
  assert.equal(source.valueSource.kind, "inline-enumerated");
  if (source.valueSource.kind !== "inline-enumerated") return;
  const translated = ({ code: "3706021", ...seed.catalog.codeLists["inline:eMedications.06"].choices[""]["3706021"] });
  const original = source.valueSource.values.find(({ code }) => code === translated.code)!;
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: { lang: "sv" } } });
  try {
    const field = configuredStationaryCodedField(source, {
      agencyRequired: false, minOccurs: 0, maxOccurs: 1, nillable: true,
      supportsNotValues: false, supportsPertinentNegatives: false,
      codeChoices: [{ code: original.code, codeSystem: "", label: original.label,
        localization: { schemaVersion: 1, sv: { label: translated.label,
          reviewedSource: { label: original.label } } } }],
    });
    assert.equal(field.options[0]?.label, "Milligram (mg)");
    assert.equal(field.options[0]?.code, "3706021");
    const selection = codedSelectionFromOption(field.options[0]!);
    assert.equal(selection.code, "3706021");
    const html = renderToStaticMarkup(createElement(StationaryCodedValueField, { field, onChange() {} }));
    assert.match(html, /Välj ett värde/);
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("legacy defaults cannot populate a blank control or change configured order and recorded answers", () => {
  const configured = {
    agencyRequired: false, minOccurs: 0, maxOccurs: 1, nillable: true,
    supportsNotValues: true, supportsPertinentNegatives: true,
    codeChoices: [
      { code: "9906001", codeSystem: "", label: "First choice" },
      { code: "9906003", codeSystem: "", label: "Legacy default" },
    ],
    defaultValue: { code: "9906003", codeSystem: "" },
  };
  const original = structuredClone(configured);
  const field = configuredStationaryCodedField("ePatient.25", configured);
  assert.deepEqual(field.options.map(({ code }) => code), ["9906001", "9906003"]);
  const blank = renderToStaticMarkup(createElement(StationaryCodedValueField, { field, onChange: () => assert.fail("Opening cannot record") }));
  assert.match(blank, /clinical-searchable-trigger[^>]*>Choose a value/);
  const recorded: EncounterValue = { kind: "coded", occurrenceId: "recorded", code: "9906001", display: "Original answer" };
  const markup = renderToStaticMarkup(createElement(StationaryCodedValueField, { field, value: recorded, onChange: () => assert.fail("Rendering cannot change an answer") }));
  assert.match(markup, /clinical-searchable-trigger[^>]*>First choice/);
  assert.deepEqual(configured, original);
  assert.equal(recorded.display, "Original answer");
});
