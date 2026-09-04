import assert from "node:assert/strict";
import test from "node:test";
import { encounterEvents } from "../app/canonical-events";
import { shellStateToDraftMutations } from "../app/draft-report";
import { ENCOUNTER_EXTENSION_KEY, saveShellState, type LocalStoragePort } from "../app/local-persistence";
import { INITIAL_SHELL_STATE, bundledEncounterDefinition, transitionShell } from "../app/standard-encounter";

function patientGroups(document = INITIAL_SHELL_STATE.encounter.document) {
  return document.groups.filter(({ id }) => id.startsWith("ePatient") || id.startsWith("eHistory"));
}

test("canonical editor mutations preserve unrelated inbound and patient data", () => {
  const inboundVitals = [{ instanceId: "inbound-vitals", elements: [{ id: "eVitals.06", values: [{ kind: "scalar" as const, occurrenceId: "inbound-systolic", value: 118 }] }] }];
  const initial = { ...INITIAL_SHELL_STATE, encounter: { ...INITIAL_SHELL_STATE.encounter, document: {
    ...INITIAL_SHELL_STATE.encounter.document,
    groups: [...INITIAL_SHELL_STATE.encounter.document.groups, { id: "eVitals.VitalGroup", instances: inboundVitals }],
  } } };
  const retainedPatient = structuredClone(patientGroups());
  let state = transitionShell(initial, { type: "note-started", id: "stable-note", date: "2026-04-18", time: "09:01" });
  state = transitionShell(state, { type: "note-draft-changed", field: "summary", value: "First version" });
  state = transitionShell(state, { type: "note-saved" });
  state = transitionShell(state, { type: "note-opened", id: "stable-note" });
  state = transitionShell(state, { type: "note-draft-changed", field: "summary", value: "Corrected version" });
  state = transitionShell(state, { type: "note-saved" });

  assert.equal(encounterEvents(state.encounter.document, bundledEncounterDefinition).find(({ id }) => id === "stable-note")?.detail, "Corrected version");
  assert.deepEqual(state.encounter.document.groups.find(({ id }) => id === "eVitals.VitalGroup")!.instances.slice(0, inboundVitals.length), inboundVitals);
  assert.deepEqual(patientGroups(state.encounter.document), retainedPatient);

  state = transitionShell(state, { type: "note-opened", id: "stable-note" });
  state = transitionShell(state, { type: "note-removed" });
  assert.equal(encounterEvents(state.encounter.document, bundledEncounterDefinition).some(({ id }) => id === "stable-note"), false);
  assert.deepEqual(patientGroups(state.encounter.document), retainedPatient);
  assert.ok(shellStateToDraftMutations("report-1", state).occurrences.some(({ elementId }) => elementId === "ePatient.02"));
});

test("browser persistence stores the canonical document without a parallel events collection", () => {
  const values = new Map<string, string>();
  const storage: LocalStoragePort = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } };
  saveShellState(storage, INITIAL_SHELL_STATE);
  const envelope = JSON.parse(values.values().next().value!) as { document: Record<string, unknown> };
  assert.equal("events" in (envelope.document[ENCOUNTER_EXTENSION_KEY] as Record<string, unknown>), false);
});
