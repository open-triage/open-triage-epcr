import assert from "node:assert/strict";
import test from "node:test";
import { loadShellState, saveShellState, type LocalStoragePort } from "../app/local-persistence";
import {
  PROCEDURES,
  PROCEDURE_MANIFEST,
  searchProcedures,
  validateProcedure,
  type ProcedureDraft,
} from "../app/procedure";
import { INITIAL_SHELL_STATE, transitionShell, type ShellState } from "../app/synthetic-encounter";

function memoryStorage(): LocalStoragePort {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

function completedProcedure(id: string, time: string, code = "268400002"): ShellState {
  let state = transitionShell(INITIAL_SHELL_STATE, { type: "procedure-started", id, time });
  state = transitionShell(state, { type: "procedure-selected", code });
  state = transitionShell(state, { type: "procedure-draft-changed", field: "attempts", value: "1" });
  state = transitionShell(state, { type: "procedure-draft-changed", field: "success", value: "yes" });
  state = transitionShell(state, { type: "procedure-draft-changed", field: "outcome", value: "unchanged" });
  state = transitionShell(state, { type: "procedure-complication-toggled", code: "3907033" });
  return state;
}

test("the full pinned NEMSIS 3.5.1 procedure list includes auditable provenance", () => {
  assert.equal(PROCEDURES.length, 115);
  assert.equal(PROCEDURE_MANIFEST.release, "NEMSIS 3.5.1");
  assert.equal(PROCEDURE_MANIFEST.element, "eProcedures.03");
  assert.match(PROCEDURE_MANIFEST.sourceUrl, /^https:\/\/git\.nemsis\.org\//);
  assert.match(PROCEDURE_MANIFEST.sourceSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(PROCEDURES.find((entry) => entry.code === "268400002"), {
    code: "268400002",
    label: "ECG, 12 lead",
    sourceLabel: "12 lead electrocardiogram",
    category: "Assessment, Cardiac",
  });
});

test("local search covers label, clinical source term, category, and code without network access", () => {
  const priorFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("runtime network access is forbidden"); }) as typeof fetch;
  try {
    assert.equal(searchProcedures("12 lead")[0]?.code, "268400002");
    assert.ok(searchProcedures("vascular catheterization").some((entry) => entry.code === "392230005"));
    assert.equal(searchProcedures("268400002")[0]?.label, "ECG, 12 lead");
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test("NEMSIS-required procedure values produce direct errors and configured warnings stay distinct", () => {
  const blank: ProcedureDraft = {
    id: "p1", time: "26:91", procedureCode: "made-up", procedureLabel: "Invalid", attempts: "0",
    success: "", outcome: "", complications: [], warningAcknowledged: false, isNew: true,
  };
  const invalid = validateProcedure(blank);
  assert.equal(invalid.errors.length, 6);
  assert.ok(invalid.errors.every((message) => /^eProcedures\./.test(message)));
  assert.equal(invalid.warnings.length, 0);

  const repeated = { ...blank, time: "08:04", procedureCode: "268400002", procedureLabel: "ECG, 12 lead", attempts: "2", success: "no" as const, outcome: "unchanged" as const, complications: ["3907033"] };
  const review = validateProcedure(repeated);
  assert.deepEqual(review.errors, []);
  assert.match(review.warnings[0]!, /Chest-pain form warning/);
});

test("multiple procedures persist as distinct events and reopen for canonical editing", () => {
  const firstSaved = transitionShell(completedProcedure("procedure-1", "08:37"), { type: "procedure-saved" });
  let state = transitionShell(firstSaved, { type: "procedure-started", id: "procedure-2", time: "08:39" });
  state = transitionShell(state, { type: "procedure-selected", code: "392230005" });
  state = transitionShell(state, { type: "procedure-draft-changed", field: "attempts", value: "1" });
  state = transitionShell(state, { type: "procedure-draft-changed", field: "success", value: "yes" });
  state = transitionShell(state, { type: "procedure-draft-changed", field: "outcome", value: "improved" });
  state = transitionShell(state, { type: "procedure-complication-toggled", code: "3907033" });
  state = transitionShell(state, { type: "procedure-saved" });
  assert.equal(state.encounter.events.filter((event) => event.kind === "procedure").length, 2);

  state = transitionShell(state, { type: "procedure-opened", id: "procedure-1" });
  state = transitionShell(state, { type: "procedure-draft-changed", field: "time", value: "08:38" });
  state = transitionShell(state, { type: "procedure-saved" });
  assert.equal(state.encounter.events.filter((event) => event.id === "procedure-1").length, 1);
  assert.equal(state.encounter.events.find((event) => event.id === "procedure-1")?.time, "08:38");
});

test("drafts, coded records, and warning acknowledgements survive refresh", () => {
  const storage = memoryStorage();
  let state = completedProcedure("procedure-warning", "08:40");
  state = transitionShell(state, { type: "procedure-draft-changed", field: "attempts", value: "2" });
  state = transitionShell(state, { type: "procedure-warning-acknowledged", acknowledged: true });
  saveShellState(storage, state);
  let restored = loadShellState(storage)!;
  assert.equal(restored.procedureDraft?.warningAcknowledged, true);
  restored = transitionShell(restored, { type: "procedure-saved" });
  saveShellState(storage, restored);
  const record = loadShellState(storage)!.encounter.events.find((event) => event.id === "procedure-warning")?.procedure;
  assert.equal(record?.code, "268400002");
  assert.equal(record?.warningAcknowledged, true);
});
