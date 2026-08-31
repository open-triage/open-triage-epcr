import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MEDICATIONS, MEDICATION_CATALOG_PROVENANCE, searchMedications } from "../app/medication-catalog";
import { loadShellState, saveShellState, type LocalStoragePort } from "../app/local-persistence";
import { INITIAL_SHELL_STATE, transitionShell, validateMedication, type ShellState } from "../app/synthetic-encounter";

function memoryStorage(): LocalStoragePort {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } };
}

function completeMedication(state: ShellState, id: string, time: string, label: string, code: string): ShellState {
  let next = transitionShell(state, { type: "medication-started", id, time });
  next = transitionShell(next, { type: "medication-selected", code, codeType: "RxNorm", label });
  next = transitionShell(next, { type: "medication-draft-changed", field: "dose", value: "4" });
  next = transitionShell(next, { type: "medication-draft-changed", field: "unit", value: "mg" });
  next = transitionShell(next, { type: "medication-draft-changed", field: "route", value: "IV — Intravenous" });
  next = transitionShell(next, { type: "medication-draft-changed", field: "response", value: "Pain 8 → 4" });
  return transitionShell(next, { type: "medication-saved" });
}

test("bundles the complete pinned NEMSIS list with verifiable provenance", () => {
  const assetPath = fileURLToPath(new URL("../app/medications.nemsis-3.5.1.json", import.meta.url));
  const checksum = createHash("sha256").update(readFileSync(assetPath)).digest("hex");
  assert.equal(MEDICATIONS.length, 70);
  assert.equal(checksum, MEDICATION_CATALOG_PROVENANCE.sha256);
  assert.equal(MEDICATION_CATALOG_PROVENANCE.release, "3.5.1");
  assert.equal(MEDICATION_CATALOG_PROVENANCE.listDate, "2025-01-14");
  assert.match(MEDICATION_CATALOG_PROVENANCE.sourceUrl, /nemsis_public/);
  assert.match(MEDICATION_CATALOG_PROVENANCE.displayLabelProvenance, /SuggestedLabel/);
  assert.ok(MEDICATIONS.every((item) => item.code && item.displayLabel && item.sourceLabel));
});

test("searches labels, aliases, and canonical codes", () => {
  assert.equal(searchMedications("morphine")[0]?.code, "7052");
  assert.match(searchMedications("narcan")[0]?.displayLabel ?? "", /Naloxone/);
  assert.equal(searchMedications("116865006")[0]?.codeType, "SNOMED-CT");
});

test("NEMSIS-referenced errors block save and response warning requires acknowledgement", () => {
  let state = transitionShell(INITIAL_SHELL_STATE, { type: "medication-started", id: "med-1", time: "99:99" });
  let validation = validateMedication(state.medicationDraft!);
  assert.equal(validation.errors.length, 5);
  assert.ok(validation.errors.every((error) => /eMedications\./.test(error)));
  assert.equal(transitionShell(state, { type: "medication-saved" }).encounter.events.length, 17);

  state = transitionShell(state, { type: "medication-draft-changed", field: "time", value: "08:33" });
  state = transitionShell(state, { type: "medication-selected", code: "7052", codeType: "RxNorm", label: "Morphine" });
  state = transitionShell(state, { type: "medication-draft-changed", field: "dose", value: "4" });
  state = transitionShell(state, { type: "medication-draft-changed", field: "unit", value: "mg" });
  state = transitionShell(state, { type: "medication-draft-changed", field: "route", value: "IV — Intravenous" });
  validation = validateMedication(state.medicationDraft!);
  assert.equal(validation.errors.length, 0);
  assert.equal(validation.warnings.length, 1);
  assert.equal(transitionShell(state, { type: "medication-saved" }).medicationDraft?.id, "med-1");
  state = transitionShell(state, { type: "medication-warning-acknowledged", acknowledged: true });
  assert.equal(transitionShell(state, { type: "medication-saved" }).encounter.events.length, 18);
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
  assert.equal(state.encounter.events.filter((event) => event.kind === "medication").length, 2);
  state = transitionShell(state, { type: "medication-opened", id: "med-1" });
  assert.equal(state.medicationDraft?.medicationCode, "7052");
  state = transitionShell(state, { type: "medication-draft-changed", field: "dose", value: "2" });
  state = transitionShell(state, { type: "medication-saved" });
  assert.equal(state.encounter.events.filter((event) => event.id === "med-1").length, 1);
  assert.match(state.encounter.events.find((event) => event.id === "med-1")?.title ?? "", /2 mg/);

  const storage = memoryStorage();
  saveShellState(storage, state);
  assert.equal(loadShellState(storage)?.encounter.events.find((event) => event.id === "med-2")?.medication?.medicationCode, "1191");
});
