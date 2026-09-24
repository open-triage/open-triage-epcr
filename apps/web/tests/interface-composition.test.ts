import assert from "node:assert/strict";
import test from "node:test";
import { standardEncounterDefinition } from "../app/standard-encounter-definition";
import { configuredQuickActions, validateEncounterDefinition, type ConfiguredEventType, type QuickActionId } from "../app/encounter-definition";
import { EMPTY_VITALS, INITIAL_SHELL_STATE, reviewEncounter, type EncounterEvent } from "../app/standard-encounter";
import { saveCanonicalEvent } from "../app/canonical-events";

type MutableCompositionDefinition = {
  composition: {
    quickActionOrder: QuickActionId[];
    review: { groups: Array<{ severity: "error" | "warning"; title: string; empty: string }>; eventTypeOrder: ConfiguredEventType[] };
  };
  events: {
    note: { quickAction: { visible: boolean; label: string } };
    procedure: { quickAction: { visible: boolean; label: string } };
  };
};

function mutableDefinition(): MutableCompositionDefinition {
  return structuredClone(standardEncounterDefinition) as unknown as MutableCompositionDefinition;
}

test("configured structured quick actions remain configurable while Text note stays fixed", () => {
  const candidate = mutableDefinition();
  candidate.composition.quickActionOrder = ["note", "procedure", "medication", "vitals"];
  candidate.events.note.quickAction.label = "Record observation";
  candidate.events.procedure.quickAction.visible = false;

  const actions = configuredQuickActions(validateEncounterDefinition(candidate));
  assert.deepEqual(actions.map(({ id }) => id), ["medication", "vitals", "note"]);
  assert.deepEqual(actions.at(-1), { id: "note", label: "Text note", title: "Text note" });
});

test("review event order is independently configurable", () => {
  const candidate = mutableDefinition();
  candidate.composition.review.eventTypeOrder = ["note", "vitals", "procedure", "medication"];
  const definition = validateEncounterDefinition(candidate);
  const vital: EncounterEvent = { id: "vital", time: "88:88", kind: "care", title: "Vital signs", detail: "", reference: "eVitals.VitalGroup", vitals: EMPTY_VITALS };
  const document = saveCanonicalEvent(INITIAL_SHELL_STATE.encounter.document, vital, definition);
  const state = { ...INITIAL_SHELL_STATE, encounter: { ...INITIAL_SHELL_STATE.encounter, document } };

  assert.deepEqual([...new Set(reviewEncounter(state, definition).map(({ eventType }) => eventType))], ["vitals"]);
});

test("invalid composition fails before rendering", () => {
  const candidate = mutableDefinition();
  candidate.composition.quickActionOrder = ["note", "note", "medication", "vitals"];
  candidate.composition.review.eventTypeOrder = ["note", "vitals"];

  assert.throws(() => validateEncounterDefinition(candidate), /composition.quickActionOrder must contain every supported quick action exactly once.*composition.review.eventTypeOrder must contain every supported event type exactly once/);
});
