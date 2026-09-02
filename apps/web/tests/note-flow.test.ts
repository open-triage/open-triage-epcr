import assert from "node:assert/strict";
import test from "node:test";
import { clearShellState, ENCOUNTER_EXTENSION_KEY, ENCOUNTER_EXTENSION_VERSION, LEGACY_STORAGE_KEYS, loadShellState, loadShellStateResult, PERSISTENCE_VERSION, RECOVERY_STORAGE_KEY, saveShellState, STORAGE_KEY, type LocalStoragePort } from "../app/local-persistence";
import { standardEncounterDefinition } from "../app/standard-encounter-definition";
import type { EncounterDefinition } from "../app/encounter-definition";
import { encounterEventPresentation, INITIAL_SHELL_STATE, reviewEncounter, transitionShell, type EncounterEvent, type ShellState } from "../app/standard-encounter";

function beginNote(time = "09:02"): ShellState {
  return transitionShell(INITIAL_SHELL_STATE, { type: "note-started", id: "visitor-note-1", time });
}

function memoryStorage(): LocalStoragePort & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

test("a quick-action note is timestamped and inserted newest first", () => {
  let state = beginNote();
  state = transitionShell(state, { type: "note-draft-changed", field: "summary", value: "Pain remains 3/10 at handover" });
  state = transitionShell(state, { type: "note-saved" });

  assert.equal(state.noteDraft, null);
  assert.equal(state.encounter.events.length, 1);
  assert.deepEqual(state.encounter.events[0], {
    id: "visitor-note-1",
    date: "2026-04-18",
    time: "09:02",
    kind: "note",
    title: "Clinical note",
    detail: "Pain remains 3/10 at handover",
    reference: "eNarrative.01",
    visitorEntered: true,
  });
});

test("opening and revising a note updates the canonical event without duplication", () => {
  let state = beginNote("08:35");
  state = transitionShell(state, { type: "note-draft-changed", field: "summary", value: "Initial note" });
  state = transitionShell(state, { type: "note-saved" });
  state = transitionShell(state, { type: "note-opened", id: "visitor-note-1" });
  state = transitionShell(state, { type: "note-draft-changed", field: "summary", value: "Corrected note" });
  state = transitionShell(state, { type: "note-draft-changed", field: "time", value: "08:31" });
  state = transitionShell(state, { type: "note-saved" });

  const matching = state.encounter.events.filter((event) => event.id === "visitor-note-1");
  assert.equal(matching.length, 1);
  assert.equal(matching[0]?.detail, "Corrected note");
  assert.equal(matching[0]?.time, "08:31");
});

test("the phone flow survives refresh with an in-progress draft and saved encounter", () => {
  const storage = memoryStorage();
  let state = beginNote("08:36");
  state = transitionShell(state, { type: "note-draft-changed", field: "summary", value: "Draft before refresh" });
  saveShellState(storage, state);

  const restored = loadShellState(storage);
  assert.equal(restored?.noteDraft?.summary, "Draft before refresh");
  assert.equal(restored?.noteDraft?.time, "08:36");
  assert.equal(restored?.encounter.events.length, 0);

  let resumed = transitionShell(restored!, { type: "note-saved" });
  saveShellState(storage, resumed);
  resumed = loadShellState(storage)!;
  assert.equal(resumed.encounter.events.find((event) => event.id === "visitor-note-1")?.detail, "Draft before refresh");
});

test("browser persistence stores one versioned canonical document and preserves compatible extensions", () => {
  const storage = memoryStorage();
  const state = {
    ...beginNote(),
    encounter: {
      ...beginNote().encounter,
      document: { ...beginNote().encounter.document, "x-agency:unknown": { retained: true } },
    },
  };
  saveShellState(storage, state);
  const envelope = JSON.parse(storage.getItem(STORAGE_KEY)!);
  assert.equal(envelope.persistenceVersion, PERSISTENCE_VERSION);
  assert.equal(envelope.state, undefined);
  assert.equal(envelope.document.modelVersion, "1.0.0");
  assert.equal(envelope.document.dataModel.version, "3.5.1");
  assert.deepEqual(envelope.document.formProfile, { id: "standard-encounter-v1", version: "1" });
  assert.equal(envelope.document[ENCOUNTER_EXTENSION_KEY].version, ENCOUNTER_EXTENSION_VERSION);
  assert.equal(envelope.document["x-agency:unknown"].retained, true);
  assert.equal(loadShellState(storage)?.encounter.document["x-agency:unknown"] && (loadShellState(storage)!.encounter.document["x-agency:unknown"] as { retained: boolean }).retained, true);
});

test("an incompatible canonical extension is preserved with an explicit diagnostic", () => {
  const storage = memoryStorage();
  saveShellState(storage, INITIAL_SHELL_STATE);
  const envelope = JSON.parse(storage.getItem(STORAGE_KEY)!);
  envelope.document[ENCOUNTER_EXTENSION_KEY].version = "99.0.0";
  const original = JSON.stringify(envelope);
  storage.setItem(STORAGE_KEY, original);
  const result = loadShellStateResult(storage);
  assert.equal(result.status, "invalid");
  if (result.status === "invalid") assert.match(result.reason, /extension version 99\.0\.0 is not supported/);
  assert.equal(storage.getItem(RECOVERY_STORAGE_KEY), original);
});

test("reset clears local progress and restores the version-controlled baseline", () => {
  const storage = memoryStorage();
  let state = beginNote();
  state = transitionShell(state, { type: "note-draft-changed", field: "summary", value: "Visitor documentation" });
  state = transitionShell(state, { type: "note-saved" });
  saveShellState(storage, state);

  clearShellState(storage);
  const reset = transitionShell(state, { type: "prototype-reset" });

  assert.equal(storage.values.has(STORAGE_KEY), false);
  assert.deepEqual(reset, INITIAL_SHELL_STATE);
  assert.equal(reset.encounter.events.length, 0);
  assert.equal(reset.encounter.events.some((event) => event.visitorEntered), false);
});

test("category-named browser state is preserved for recovery instead of reinterpreted as the standard encounter", () => {
  const storage = memoryStorage();
  const legacyKey = LEGACY_STORAGE_KEYS[0];
  const original = JSON.stringify({ ...INITIAL_SHELL_STATE, encounter: { ...INITIAL_SHELL_STATE.encounter, definitionId: "adult-chest-pain-v2" } });
  storage.setItem(legacyKey, original);

  assert.deepEqual(loadShellStateResult(storage), {
    status: "incompatible",
    savedDefinition: { id: "adult-chest-pain-v2", version: 1 },
    expectedDefinition: { id: "standard-encounter-v1", version: 1 },
    recoveryKey: RECOVERY_STORAGE_KEY,
  });
  assert.equal(storage.values.has(legacyKey), false);
  assert.equal(storage.getItem(RECOVERY_STORAGE_KEY), original);
  assert.equal(loadShellState(storage), null);
  assert.equal(storage.values.has(STORAGE_KEY), false);
});

test("configured note metadata drives capture, validation, review navigation, and summary presentation", () => {
  const base = standardEncounterDefinition.events.note;
  const definition: EncounterDefinition = { ...standardEncounterDefinition, events: { ...standardEncounterDefinition.events, note: {
    ...base,
    quickAction: { visible: false, label: "Record observation" },
    labels: { ...base.labels, category: "Observation", timelineTitle: "Field observation" },
    references: { ...base.references, summary: "eNarrative.02" },
    validationMessages: { ...base.validationMessages, summaryRequired: "Record the observation before finishing." },
  } } };

  let state = transitionShell(INITIAL_SHELL_STATE, { type: "note-started", id: "configured-note", time: "09:10" }, definition);
  state = transitionShell(state, { type: "note-saved" }, definition);
  const saved = state.encounter.events.find((event) => event.id === "configured-note")!;
  assert.equal(saved.title, "Field observation");
  assert.equal(saved.reference, "eNarrative.02");

  const finding = reviewEncounter(state, definition).find((candidate) => candidate.target.eventId === "configured-note")!;
  assert.equal(finding.category, "Observation");
  assert.equal(finding.title, "09:10 · Field observation");
  assert.equal(finding.reference, "eNarrative.02");
  assert.deepEqual(finding.target, { eventId: "configured-note", groupId: "eNarrativeSection", instanceId: "configured-note", elementId: "eNarrative.02" });
  assert.equal(finding.message, "Record the observation before finishing.");

  state = transitionShell(state, { type: "review-finding-selected", id: finding.id }, definition);
  assert.equal(state.noteDraft?.id, "configured-note");
  assert.deepEqual(encounterEventPresentation(saved, definition), { title: "Field observation", reference: "eNarrative.02" });
});

test("configured note requiredness can permit an empty summary", () => {
  const base = standardEncounterDefinition.events.note;
  const definition: EncounterDefinition = { ...standardEncounterDefinition, events: { ...standardEncounterDefinition.events, note: { ...base, required: { ...base.required, summary: false } } } };
  const note: EncounterEvent = { id: "optional-note", time: "09:11", kind: "note", title: "Legacy title", detail: "", reference: "legacy" };
  const state = { ...INITIAL_SHELL_STATE, encounter: { ...INITIAL_SHELL_STATE.encounter, events: [note, ...INITIAL_SHELL_STATE.encounter.events] } };

  assert.equal(reviewEncounter(state, definition).some((finding) => finding.target.eventId === note.id), false);
});

test("restored note events resolve current definition metadata instead of persisted labels", () => {
  const storage = memoryStorage();
  let state = beginNote();
  state = transitionShell(state, { type: "note-draft-changed", field: "summary", value: "Persisted observation" });
  state = transitionShell(state, { type: "note-saved" });
  saveShellState(storage, state);
  const restoredEvent = loadShellState(storage)!.encounter.events.find((event) => event.id === "visitor-note-1")!;
  const base = standardEncounterDefinition.events.note;
  const definition: EncounterDefinition = { ...standardEncounterDefinition, events: { ...standardEncounterDefinition.events, note: {
    ...base,
    labels: { ...base.labels, timelineTitle: "Configured summary label" },
    references: { ...base.references, summary: "eNarrative.02" },
  } } };

  assert.deepEqual(encounterEventPresentation(restoredEvent, definition), { title: "Configured summary label", reference: "eNarrative.02" });
});
