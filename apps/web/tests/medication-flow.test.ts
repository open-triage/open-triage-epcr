import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MEDICATIONS, MEDICATION_CATALOG_PROVENANCE, MEDICATION_DOSE_UNITS, MEDICATION_ROUTES, searchMedications } from "../app/medication-catalog";
import { standardEncounterDefinition } from "../app/standard-encounter-definition";
import type { EncounterDefinition } from "../app/encounter-definition";
import { loadShellState, saveShellState, type LocalStoragePort } from "../app/local-persistence";
import { encounterEventDetail, encounterEventPresentation, INITIAL_SHELL_STATE, reviewEncounter, transitionShell, validateMedication, type EncounterEvent, type ShellState } from "../app/standard-encounter";
import { encounterEvents } from "../app/canonical-events";

function memoryStorage(): LocalStoragePort {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } };
}

const milligrams = MEDICATION_DOSE_UNITS.find((label) => label === "Milligrams (mg)")!;
const intravenous = MEDICATION_ROUTES.find((label) => label === "Intravenous (IV)")!;

function completeMedication(state: ShellState, id: string, time: string, label: string, code: string): ShellState {
  let next = transitionShell(state, { type: "medication-started", id, time });
  next = transitionShell(next, { type: "medication-selected", code, codeType: "RxNorm", label });
  next = transitionShell(next, { type: "medication-draft-changed", field: "dose", value: "4" });
  next = transitionShell(next, { type: "medication-draft-changed", field: "unit", value: milligrams });
  next = transitionShell(next, { type: "medication-draft-changed", field: "route", value: intravenous });
  next = transitionShell(next, { type: "medication-draft-changed", field: "response", value: "Pain 8 → 4" });
  return transitionShell(next, { type: "medication-saved" });
}

test("bundles the complete pinned NEMSIS list with verifiable provenance", () => {
  const assetPath = fileURLToPath(new URL("../app/data/nemsis-3.5.1-sources/lists/Medication.json", import.meta.url));
  const checksum = createHash("sha256").update(readFileSync(assetPath)).digest("hex");
  assert.equal(MEDICATIONS.length, 70);
  assert.equal(checksum, MEDICATION_CATALOG_PROVENANCE.sha256);
  assert.equal(MEDICATION_CATALOG_PROVENANCE.release, "3.5.1");
  assert.equal(MEDICATION_CATALOG_PROVENANCE.listDate, "2025-01-14");
  assert.match(MEDICATION_CATALOG_PROVENANCE.sourceUrl, /nemsis_v3/);
  assert.match(MEDICATION_CATALOG_PROVENANCE.displayLabelProvenance, /SuggestedLabel/);
  assert.ok(MEDICATIONS.every((item) => item.code && item.displayLabel && item.sourceLabel));
});

test("searches labels, aliases, and canonical codes", () => {
  assert.equal(searchMedications("morphine")[0]?.code, "7052");
  assert.match(searchMedications("narcan")[0]?.displayLabel ?? "", /Naloxone/);
  assert.equal(searchMedications("116865006")[0]?.codeType, "SNOMED-CT");
});

test("quick capture saves errors and warnings for review without acknowledgement", () => {
  let state = transitionShell(INITIAL_SHELL_STATE, { type: "medication-started", id: "med-1", time: "99:99" });
  let validation = validateMedication(state.medicationDraft!);
  assert.equal(validation.errors.length, 5);
  assert.ok(validation.errors.every((error) => /eMedications\./.test(error)));
  let saved = transitionShell(state, { type: "medication-saved" });
  assert.equal(encounterEvents(saved.encounter.document, standardEncounterDefinition).length, 1);
  assert.equal(saved.medicationDraft, null);
  assert.ok(reviewEncounter(saved).some((finding) => finding.severity === "error"));

  state = transitionShell(INITIAL_SHELL_STATE, { type: "medication-started", id: "med-2", time: "08:33" });
  state = transitionShell(state, { type: "medication-selected", code: "7052", codeType: "RxNorm", label: "Morphine" });
  state = transitionShell(state, { type: "medication-draft-changed", field: "dose", value: "4" });
  state = transitionShell(state, { type: "medication-draft-changed", field: "unit", value: milligrams });
  state = transitionShell(state, { type: "medication-draft-changed", field: "route", value: intravenous });
  validation = validateMedication(state.medicationDraft!);
  assert.equal(validation.errors.length, 0);
  assert.equal(validation.warnings.length, 1);
  saved = transitionShell(state, { type: "medication-saved" });
  assert.equal(encounterEvents(saved.encounter.document, standardEncounterDefinition).length, 1);
  assert.equal(saved.medicationDraft, null);
  assert.ok(reviewEncounter(saved).some((finding) => finding.severity === "warning"));
});

test("rejects included values outside the pinned medication and configured route sets", () => {
  let state = transitionShell(INITIAL_SHELL_STATE, { type: "medication-started", id: "med-invalid", time: "08:33" });
  state = transitionShell(state, { type: "medication-selected", code: "made-up", codeType: "RxNorm", label: "Unknown" });
  state = transitionShell(state, { type: "medication-draft-changed", field: "dose", value: "4" });
  state = transitionShell(state, { type: "medication-draft-changed", field: "unit", value: "handful" });
  state = transitionShell(state, { type: "medication-draft-changed", field: "route", value: "telepathy" });
  const validation = validateMedication(state.medicationDraft!);
  assert.ok(validation.errors.some((error) => error.includes("eMedications.03")));
  assert.ok(validation.errors.some((error) => error.includes("eMedications.06")));
  assert.ok(validation.errors.some((error) => error.includes("eMedications.04")));
});

test("multiple administrations persist distinctly and reopen for canonical editing", () => {
  let state = completeMedication(INITIAL_SHELL_STATE, "med-1", "08:35", "Morphine", "7052");
  state = completeMedication(state, "med-2", "08:36", "Aspirin", "1191");
  assert.equal(encounterEvents(state.encounter.document, standardEncounterDefinition).filter((event) => event.kind === "medication").length, 2);
  state = transitionShell(state, { type: "medication-opened", id: "med-1" });
  assert.equal(state.medicationDraft?.medicationCode, "7052");
  state = transitionShell(state, { type: "medication-draft-changed", field: "dose", value: "2" });
  state = transitionShell(state, { type: "medication-saved" });
  assert.equal(encounterEvents(state.encounter.document, standardEncounterDefinition).filter((event) => event.id === "med-1").length, 1);
  assert.match(encounterEvents(state.encounter.document, standardEncounterDefinition).find((event) => event.id === "med-1")?.title ?? "", /2 Milligrams \(mg\)/);

  const storage = memoryStorage();
  saveShellState(storage, state);
  const loaded = loadShellState(storage)!;
  assert.equal(encounterEvents(loaded.encounter.document, standardEncounterDefinition).find((event) => event.id === "med-2")?.medication?.medicationCode, "1191");
});

test("remove deletes the opened medication group", () => {
  let state = completeMedication(INITIAL_SHELL_STATE, "med-remove", "08:35", "Morphine", "7052");
  state = transitionShell(state, { type: "medication-opened", id: "med-remove" });
  state = transitionShell(state, { type: "medication-removed" });
  assert.equal(state.medicationDraft, null);
  assert.equal(encounterEvents(state.encounter.document, standardEncounterDefinition).some((event) => event.id === "med-remove"), false);
});

test("configured medication metadata drives validation, warnings, review, and restored presentation", () => {
  const base = standardEncounterDefinition.events.medication;
  const definition: EncounterDefinition = {
    ...standardEncounterDefinition,
    events: {
      ...standardEncounterDefinition.events,
      medication: {
        ...base,
        fields: [
          { ...base.fields[0]!, label: "Choose treatment" },
          { ...base.fields[2]!, required: false },
          { ...base.fields[3]!, required: true },
          { ...base.fields[4]!, reference: "eMedications.04" },
          { ...base.fields[5]!, label: "Observed effect", warnWhenMissing: true },
          base.fields[1]!,
        ],
        doseUnits: ["configured-unit"],
        routes: ["Configured route"],
        labels: { ...base.labels, category: "Treatment", routeMissing: "Configured route missing", responseMissing: "Configured effect missing" },
        validationMessages: { ...base.validationMessages, invalidUnit: "Choose the configured unit", responseMissing: "Record the configured effect" },
      },
    },
  };
  assert.deepEqual(definition.events.medication.fields.map((field) => field.id), ["medication", "dose", "unit", "route", "response", "time"]);

  let state = transitionShell(INITIAL_SHELL_STATE, { type: "medication-started", id: "configured-med", time: "08:40" }, definition);
  state = transitionShell(state, { type: "medication-selected", code: "7052", codeType: "RxNorm", label: "Morphine" }, definition);
  state = transitionShell(state, { type: "medication-draft-changed", field: "unit", value: "configured-unit" }, definition);
  state = transitionShell(state, { type: "medication-draft-changed", field: "route", value: "Configured route" }, definition);
  assert.equal(validateMedication(state.medicationDraft!, definition).errors.length, 0, "configured optional dose is accepted");
  state = transitionShell(state, { type: "medication-warning-acknowledged", acknowledged: true }, definition);
  state = transitionShell(state, { type: "medication-saved" }, definition);

  const saved = encounterEvents(state.encounter.document, definition).find((event) => event.id === "configured-med")!;
  const warning = reviewEncounter(state, definition).find((finding) => finding.target.eventId === saved.id)!;
  assert.equal(warning.category, "Treatment");
  assert.equal(warning.reference, "eMedications.07");
  assert.match(warning.message, /Record the configured effect/);
  assert.equal(warning.acknowledged, true);
  assert.equal(encounterEventDetail(saved, definition), "Configured route · Configured effect missing");

  const legacySaved: EncounterEvent = { ...saved, title: "Old title", detail: "Old detail", reference: "old reference" };
  assert.deepEqual(encounterEventPresentation(legacySaved, definition), { title: "Morphine configured-unit", reference: "eMedications.03 · RxNorm 7052" });
  assert.equal(encounterEventDetail(legacySaved, definition), "Configured route · Configured effect missing");

  state = transitionShell(state, { type: "medication-opened", id: saved.id }, definition);
  state = transitionShell(state, { type: "medication-draft-changed", field: "response", value: "Pain improved" }, definition);
  assert.equal(state.medicationDraft?.warningAcknowledged, false, "correcting the warning resets acknowledgement");
  state = transitionShell(state, { type: "medication-saved" }, definition);
  assert.equal(reviewEncounter(state, definition).some((finding) => finding.target.eventId === saved.id), false);
  assert.equal(encounterEventDetail(encounterEvents(state.encounter.document, definition).find((event) => event.id === saved.id)!, definition), "Configured route · Pain improved");
});
