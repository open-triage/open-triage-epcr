import assert from "node:assert/strict";
import test from "node:test";
import { loadShellState, saveShellState, type LocalStoragePort } from "../app/local-persistence";
import { standardEncounterDefinition } from "../app/standard-encounter-definition";
import type { EncounterDefinition } from "../app/encounter-definition";
import { encounterEvents } from "../app/canonical-events";
import {
  PROCEDURES,
  PROCEDURE_MANIFEST,
  searchProcedures,
  validateProcedure,
  type ProcedureDraft,
} from "../app/procedure";
import { encounterEventDetail, encounterEventPresentation, INITIAL_SHELL_STATE, reviewEncounter, transitionShell, type ShellState } from "../app/standard-encounter";

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
  assert.match(PROCEDURE_MANIFEST.sourceUrl, /^https:\/\/nemsis\.org\//);
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
    id: "p1", date: "2026-04-18", time: "26:91", procedureCode: "made-up", procedureLabel: "Invalid", attempts: "0",
    success: "", outcome: "", complications: [], warningAcknowledged: false, isNew: true,
  };
  const invalid = validateProcedure(blank);
  assert.equal(invalid.errors.length, 6);
  assert.ok(invalid.errors.every((message) => /^eProcedures\./.test(message)));
  assert.equal(invalid.warnings.length, 0);

  const repeated = { ...blank, time: "08:04", procedureCode: "268400002", procedureLabel: "ECG, 12 lead", attempts: "2", success: "no" as const, outcome: "unchanged" as const, complications: ["3907033"] };
  const review = validateProcedure(repeated);
  assert.deepEqual(review.errors, []);
  assert.match(review.warnings[0]!, /Standard encounter warning/);
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
  assert.equal(encounterEvents(state.encounter.document, standardEncounterDefinition).filter((event) => event.kind === "procedure").length, 2);

  state = transitionShell(state, { type: "procedure-opened", id: "procedure-1" });
  state = transitionShell(state, { type: "procedure-draft-changed", field: "time", value: "08:38" });
  state = transitionShell(state, { type: "procedure-saved" });
  assert.equal(encounterEvents(state.encounter.document, standardEncounterDefinition).filter((event) => event.id === "procedure-1").length, 1);
  assert.equal(encounterEvents(state.encounter.document, standardEncounterDefinition).find((event) => event.id === "procedure-1")?.time, "08:38");
});

test("remove deletes the opened procedure group", () => {
  let state = transitionShell(completedProcedure("procedure-remove", "08:37"), { type: "procedure-saved" });
  state = transitionShell(state, { type: "procedure-opened", id: "procedure-remove" });
  state = transitionShell(state, { type: "procedure-removed" });
  assert.equal(state.procedureDraft, null);
  assert.equal(encounterEvents(state.encounter.document, standardEncounterDefinition).some((event) => event.id === "procedure-remove"), false);
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
  const loaded = loadShellState(storage)!;
  const record = encounterEvents(loaded.encounter.document, standardEncounterDefinition).find((event) => event.id === "procedure-warning")?.procedure;
  assert.equal(record?.code, "268400002");
  assert.equal(record?.warningAcknowledged, true);
});

test("configured procedure metadata drives capture, validation, warnings, review, and summary", () => {
  const base = standardEncounterDefinition.events.procedure;
  const procedure = {
    ...base,
    fieldOrder: ["procedure", "outcome", "success", "attempts", "time", "complications"] as const,
    labels: { ...base.labels, category: "Intervention", attempts: "Tries", warningPill: "Review intervention" },
    references: { ...base.references, attempts: "eProcedures.05" as const, complications: "eProcedures.07" as const },
    attempts: { defaultValue: 2, min: 1, max: 4 },
    validationMessages: { ...base.validationMessages, invalidAttempts: "Tries must be between 1 and 4." },
    warningBehavior: { ...base.warningBehavior, repeatedAttemptThreshold: 1, repeatedOrUnsuccessfulMessage: "Configured intervention warning." },
    timeline: { ...base.timeline, attemptSingular: "try", attemptPlural: "tries", complicationLabel: "Adverse event" },
  };
  const definition: EncounterDefinition = { ...standardEncounterDefinition, events: { ...standardEncounterDefinition.events, procedure } };

  let state = transitionShell(INITIAL_SHELL_STATE, { type: "procedure-started", id: "configured-procedure", time: "09:14" }, definition);
  assert.equal(state.procedureDraft?.attempts, "2");
  state = transitionShell(state, { type: "procedure-selected", code: "268400002" }, definition);
  assert.equal(state.procedureDraft?.procedureLabel, "ECG, 12 lead");
  state = transitionShell(state, { type: "procedure-draft-changed", field: "success", value: "no" }, definition);
  state = transitionShell(state, { type: "procedure-draft-changed", field: "outcome", value: "unchanged" }, definition);
  state = transitionShell(state, { type: "procedure-complication-toggled", code: "3907033" }, definition);
  state = transitionShell(state, { type: "procedure-saved" }, definition);

  const event = encounterEvents(state.encounter.document, definition).find((candidate) => candidate.id === "configured-procedure")!;
  assert.equal(encounterEventDetail(event, definition), "2 tries, unsuccessful · Unchanged · Adverse event: None");
  assert.equal(encounterEventPresentation(event, definition).reference, "eProcedures.03 · SNOMED CT 268400002");
  const warning = reviewEncounter(state, definition).find((finding) => finding.target.eventId === event.id)!;
  assert.equal(warning.category, "Intervention");
  assert.equal(warning.reference, "eProcedures.07");
  assert.equal(warning.message, "Configured intervention warning.");
  state = transitionShell(state, { type: "review-finding-selected", id: warning.id }, definition);
  assert.equal(state.procedureDraft?.id, event.id);
  state = transitionShell(state, { type: "procedure-warning-acknowledged", acknowledged: true }, definition);
  state = transitionShell(state, { type: "procedure-saved" }, definition);
  assert.equal(reviewEncounter(state, definition).find((finding) => finding.target.eventId === event.id)?.acknowledged, true);
});

test("configured requiredness and validation messages control incomplete capture", () => {
  const base = standardEncounterDefinition.events.procedure;
  const definition: EncounterDefinition = { ...standardEncounterDefinition, events: { ...standardEncounterDefinition.events, procedure: {
    ...base,
    required: { ...base.required, outcome: false, complications: false },
    attempts: { defaultValue: 1, min: 2, max: 3 },
    validationMessages: { ...base.validationMessages, invalidAttempts: "Use two or three attempts." },
  } } };
  const draft: ProcedureDraft = { id: "incomplete", date: "2026-04-18", time: "09:15", procedureCode: "268400002", procedureLabel: "ECG, 12 lead", attempts: "1", success: "yes", outcome: "", complications: [], warningAcknowledged: false, isNew: true };
  assert.deepEqual(validateProcedure(draft, definition.events.procedure).errors, ["eProcedures.05 (Required): Use two or three attempts."]);
});

test("saved procedure records remain readable with current configured presentation", () => {
  const storage = memoryStorage();
  let state = transitionShell(completedProcedure("legacy-procedure", "09:16"), { type: "procedure-saved" });
  saveShellState(storage, state);
  state = loadShellState(storage)!;
  const event = encounterEvents(state.encounter.document, standardEncounterDefinition).find((candidate) => candidate.id === "legacy-procedure")!;
  const base = standardEncounterDefinition.events.procedure;
  const definition: EncounterDefinition = { ...standardEncounterDefinition, events: { ...standardEncounterDefinition.events, procedure: { ...base, timeline: { ...base.timeline, attemptSingular: "configured attempt" } } } };
  assert.match(encounterEventDetail(event, definition), /^1 configured attempt,/);
  assert.equal(event.procedure?.code, "268400002");
});

test("Swedish procedure search retains English and code search with the same canonical code", () => {
  const definition = { ...standardEncounterDefinition.events.procedure,
    terminology: { ...standardEncounterDefinition.events.procedure.terminology, choices: [{
      code: "268400002", label: "EKG, 12 avledningar", sourceLabel: "12 lead electrocardiogram", category: "Kardiologi",
    }] } };
  assert.equal(searchProcedures("avledningar", 30, definition)[0]?.code, "268400002");
  assert.equal(searchProcedures("electrocardiogram", 30, definition)[0]?.code, "268400002");
  assert.equal(searchProcedures("268400002", 30, definition)[0]?.label, "EKG, 12 avledningar");
  const state = transitionShell(INITIAL_SHELL_STATE, { type: "procedure-started", id: "translated", time: "10:00" });
  const selected = transitionShell(state, { type: "procedure-selected", code: "268400002", label: "EKG, 12 avledningar" });
  assert.equal(selected.procedureDraft?.procedureCode, "268400002");
  assert.equal(selected.procedureDraft?.procedureLabel, "EKG, 12 avledningar");
});
