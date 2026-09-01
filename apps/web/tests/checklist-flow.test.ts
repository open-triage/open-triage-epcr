import assert from "node:assert/strict";
import test from "node:test";
import { loadShellState, saveShellState, type LocalStoragePort } from "../app/local-persistence";
import {
  checklistFields,
  INITIAL_SHELL_STATE,
  transitionShell,
  validateChecklist,
  type ShellState,
} from "../app/synthetic-encounter";

function memoryStorage(): LocalStoragePort {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

function completeChecklist(state: ShellState): ShellState {
  const changes = [
    ["primary-symptom", "R07.9"],
    ["secondary-symptom", "R61"],
    ["primary-impression", "I21.3"],
    ["possible-injury", "no"],
    ["destination-condition", "4219003"],
    ["unit-disposition", "4227001"],
    ["narrative", "Inferior STEMI treated on scene; pain improved before handover."],
  ] as const;
  return changes.reduce(
    (current, [field, value]) => transitionShell(current, { type: "checklist-field-changed", field, value }),
    state,
  );
}

test("legacy assessment values are not pre-seeded", () => {
  const findings = validateChecklist(INITIAL_SHELL_STATE.checklistValues);
  assert.equal(checklistFields.length, 7);
  assert.equal(findings.length, 7);
});

test("assessment, disposition, and narrative use only permitted values", () => {
  let state = completeChecklist(INITIAL_SHELL_STATE);
  assert.deepEqual(validateChecklist(state.checklistValues), []);

  state = transitionShell(state, { type: "checklist-field-changed", field: "secondary-symptom", value: "PN" });
  assert.equal(validateChecklist(state.checklistValues).some((finding) => finding.fieldId === "secondary-symptom"), false);

  state = transitionShell(state, { type: "checklist-field-changed", field: "primary-symptom", value: "invented-code" });
  state = transitionShell(state, { type: "checklist-field-changed", field: "narrative", value: "NV" });
  const findings = validateChecklist(state.checklistValues);
  assert.match(findings.find((finding) => finding.fieldId === "primary-symptom")?.message ?? "", /permitted value/);
  assert.match(findings.find((finding) => finding.fieldId === "narrative")?.message ?? "", /NV.*not permitted/);
});

test("checklist values survive view changes and refresh", () => {
  const storage = memoryStorage();
  let state = completeChecklist(INITIAL_SHELL_STATE);
  state = transitionShell(state, { type: "view-selected", view: "timeline" });
  state = transitionShell(state, { type: "view-selected", view: "checklist" });
  saveShellState(storage, state);

  const restored = loadShellState(storage);
  assert.equal(restored?.checklistValues["destination-condition"], "4219003");
  assert.equal(restored?.checklistValues["unit-disposition"], "4227001");
  assert.match(restored?.checklistValues.narrative ?? "", /Inferior STEMI/);
  assert.deepEqual(validateChecklist(restored!.checklistValues), []);
});

test("selecting a validation finding opens the checklist and identifies its focus target", () => {
  const state = transitionShell(INITIAL_SHELL_STATE, { type: "validation-selected", field: "destination-condition" });
  assert.equal(state.view, "checklist");
  assert.equal(state.focusedChecklistField, "destination-condition");
});
