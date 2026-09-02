import assert from "node:assert/strict";
import test from "node:test";
import { standardEncounterDefinition } from "../app/standard-encounter-definition";
import { configuredQuickActions, validateEncounterDefinition, type EncounterDefinition } from "../app/encounter-definition";
import { loadShellState, loadShellStateResult, RECOVERY_STORAGE_KEY, saveShellState, type LocalStoragePort } from "../app/local-persistence";
import {
  EMPTY_VITALS,
  completedSummaryEvents,
  createInitialShellState,
  encounterDefinitionProvider,
  reviewEncounter,
  transitionShell,
  vitalSummary,
} from "../app/standard-encounter";
import { validateVitals } from "../app/vital-validation";

function alternateDefinition(): EncounterDefinition {
  const pain = standardEncounterDefinition.events.vitals.fields.find(({ id }) => id === "pain")!;
  const otherVitals = standardEncounterDefinition.events.vitals.fields.filter(({ id }) => id !== "pain");
  return validateEncounterDefinition({
    ...structuredClone(standardEncounterDefinition),
    id: "test-only-community-response",
    version: 7,
    composition: {
      ...structuredClone(standardEncounterDefinition.composition),
      quickActionOrder: ["patient", "vitals", "medication", "procedure", "note"],
      summary: { eventTypeOrder: ["vitals", "note", "medication", "procedure"] },
    },
    events: {
      ...structuredClone(standardEncounterDefinition.events),
      note: {
        ...structuredClone(standardEncounterDefinition.events.note),
        quickAction: { visible: false, label: "Record narrative" },
      },
      vitals: {
        ...structuredClone(standardEncounterDefinition.events.vitals),
        quickAction: { visible: true, label: "Record field observations" },
        labels: {
          ...structuredClone(standardEncounterDefinition.events.vitals.labels),
          category: "Field observations",
          timelineTitle: "Community observations",
          editorTitle: "Community observations",
        },
        fields: [
          { ...structuredClone(pain), label: "Discomfort score", required: true },
          ...structuredClone(otherVitals).map((field) => ({ ...field, required: false })),
        ],
        summary: [
          { label: "Discomfort", fields: ["pain"], separator: "", unit: "" },
          ...structuredClone(standardEncounterDefinition.events.vitals.summary).filter(({ fields }) => !fields.some((field) => field === "pain")),
        ],
      },
    },
  });
}

function memoryStorage(): LocalStoragePort {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

test("a test-only definition changes capture, validation, review, and summary through configuration", () => {
  const definition = alternateDefinition();
  assert.deepEqual(definition.events.vitals.fields.slice(0, 2).map(({ id, label }) => ({ id, label })), [
    { id: "pain", label: "Discomfort score" },
    { id: "systolic", label: "Systolic BP" },
  ]);
  assert.deepEqual(configuredQuickActions(definition).map(({ id }) => id), ["patient", "vitals", "medication", "procedure"]);
  assert.equal(configuredQuickActions(definition)[1]?.label, "Record field observations");

  const missingRequired = validateVitals("09:00", EMPTY_VITALS, definition);
  assert.match(missingRequired.errors.pain!, /eVitals\.27 requires a value/);
  assert.equal(missingRequired.errors.systolic, undefined);

  let state = createInitialShellState(definition);
  state = transitionShell(state, { type: "vitals-started", id: "alternate-vital", date: "2026-04-18", time: "09:00" }, definition);
  state = transitionShell(state, { type: "vitals-value-changed", field: "pain", value: "9" }, definition);
  state = transitionShell(state, { type: "vitals-saved" }, definition);
  const captured = state.encounter.events.find(({ id }) => id === "alternate-vital")!;
  assert.equal(captured.title, "Community observations");
  assert.equal(captured.vitals?.pain, "9");

  const findings = reviewEncounter(state, definition).filter(({ target }) => target.eventId === captured.id);
  assert.equal(findings[0]?.category, "Field observations");
  assert.match(findings[0]?.message ?? "", /unusual discomfort score/);
  assert.equal(vitalSummary(captured.vitals!, definition), "Discomfort 9");
  assert.equal(completedSummaryEvents([captured], definition)[0]?.id, captured.id);
});

test("saved state retains definition identity and restores only for an exact compatible version", () => {
  const definition = alternateDefinition();
  const state = createInitialShellState(definition);
  const storage = memoryStorage();
  saveShellState(storage, state);

  const compatible = loadShellStateResult(storage, definition);
  assert.equal(compatible.status, "restored");
  assert.equal(loadShellState(storage, definition)?.encounter.definitionId, definition.id);
  assert.equal(loadShellState(storage, definition)?.encounter.definitionVersion, definition.version);

  const nextVersion = validateEncounterDefinition({ ...structuredClone(definition), version: definition.version + 1 });
  assert.deepEqual(loadShellStateResult(storage, nextVersion), {
    status: "incompatible",
    savedDefinition: { id: definition.id, version: definition.version },
    expectedDefinition: { id: nextVersion.id, version: nextVersion.version },
    recoveryKey: RECOVERY_STORAGE_KEY,
  });
  assert.ok(storage.getItem(RECOVERY_STORAGE_KEY)?.includes(definition.id));
  assert.equal(loadShellState(storage, nextVersion), null);
  assert.strictEqual(transitionShell(createInitialShellState(nextVersion), { type: "state-restored", state }, nextVersion).encounter.definitionVersion, nextVersion.version);
});

test("the production provider does not bundle the test-only alternate definition", () => {
  assert.throws(() => encounterDefinitionProvider.get(alternateDefinition().id), /definition was not found/);
  assert.equal(encounterDefinitionProvider.get(standardEncounterDefinition.id).id, standardEncounterDefinition.id);
});
