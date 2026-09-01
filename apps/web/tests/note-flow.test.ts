import assert from "node:assert/strict";
import test from "node:test";
import { clearShellState, loadShellState, saveShellState, STORAGE_KEY, type LocalStoragePort } from "../app/local-persistence";
import { INITIAL_SHELL_STATE, transitionShell, type ShellState } from "../app/synthetic-encounter";

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
  assert.equal(state.encounter.events.length, 18);
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
  assert.equal(restored?.encounter.events.length, 17);

  let resumed = transitionShell(restored!, { type: "note-saved" });
  saveShellState(storage, resumed);
  resumed = loadShellState(storage)!;
  assert.equal(resumed.encounter.events.find((event) => event.id === "visitor-note-1")?.detail, "Draft before refresh");
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
  assert.strictEqual(reset, INITIAL_SHELL_STATE);
  assert.equal(reset.encounter.events.length, 17);
  assert.equal(reset.encounter.events.some((event) => event.visitorEntered), false);
});
