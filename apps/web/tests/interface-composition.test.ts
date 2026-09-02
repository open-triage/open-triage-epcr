import assert from "node:assert/strict";
import test from "node:test";
import { standardEncounterDefinition } from "../app/standard-encounter-definition";
import { configuredQuickActions, validateEncounterDefinition, type ConfiguredEventType, type QuickActionId } from "../app/encounter-definition";
import { completedSummaryEvents, EMPTY_VITALS, INITIAL_SHELL_STATE, reviewEncounter, type EncounterEvent } from "../app/standard-encounter";

type MutableCompositionDefinition = {
  composition: {
    quickActionOrder: QuickActionId[];
    review: { groups: Array<{ severity: "error" | "warning"; title: string; empty: string }>; eventTypeOrder: ConfiguredEventType[] };
    summary: { eventTypeOrder: ConfiguredEventType[] };
  };
  events: {
    note: { quickAction: { visible: boolean; label: string } };
    procedure: { quickAction: { visible: boolean; label: string } };
  };
};

function mutableDefinition(): MutableCompositionDefinition {
  return structuredClone(standardEncounterDefinition) as unknown as MutableCompositionDefinition;
}

test("configured quick actions control order, visibility, and accessible labels", () => {
  const candidate = mutableDefinition();
  candidate.composition.quickActionOrder = ["note", "patient", "procedure", "medication", "vitals"];
  candidate.events.note.quickAction.label = "Record observation";
  candidate.events.procedure.quickAction.visible = false;

  const actions = configuredQuickActions(validateEncounterDefinition(candidate));
  assert.deepEqual(actions.map(({ id }) => id), ["note", "patient", "medication", "vitals"]);
  assert.equal(actions[0]?.label, "Record observation");
  assert.equal(actions[1]?.label, "Edit patient information");
});

test("review and completed-summary event order are independently configurable", () => {
  const candidate = mutableDefinition();
  candidate.composition.review.eventTypeOrder = ["note", "vitals", "procedure", "medication"];
  candidate.composition.summary.eventTypeOrder = ["medication", "note", "procedure", "vitals"];
  const definition = validateEncounterDefinition(candidate);
  const note: EncounterEvent = { id: "note", time: "88:88", kind: "note", title: "Clinical note", detail: "", reference: "eNarrative.01" };
  const vital: EncounterEvent = { id: "vital", time: "88:88", kind: "care", title: "Vital signs", detail: "", reference: "eVitals.VitalGroup", vitals: EMPTY_VITALS };
  const medication: EncounterEvent = { id: "medication", time: "08:00", kind: "medication", title: "Medication", detail: "", reference: "eMedications.03", medication: { medicationCode: "1191", codeType: "RxNorm", label: "Aspirin", dose: "324", unit: "mg", route: "PO — Oral", response: "Improved", warningAcknowledged: false } };
  const procedure: EncounterEvent = { id: "procedure", time: "08:01", kind: "procedure", title: "Procedure", detail: "", reference: "eProcedures.03", procedure: { code: "268400002", label: "12 lead ECG", attempts: 1, success: "yes", outcome: "improved", complications: ["3907033"], warningAcknowledged: false } };
  const state = { ...INITIAL_SHELL_STATE, encounter: { ...INITIAL_SHELL_STATE.encounter, events: [vital, note] } };

  assert.deepEqual([...new Set(reviewEncounter(state, definition).map(({ eventType }) => eventType))], ["note", "vitals"]);
  assert.deepEqual(completedSummaryEvents([vital, procedure, note, medication], definition).map(({ id }) => id), ["medication", "note", "procedure", "vital"]);
});

test("invalid composition fails before rendering", () => {
  const candidate = mutableDefinition();
  candidate.composition.quickActionOrder = ["note", "note", "patient", "medication", "vitals"];
  candidate.composition.review.eventTypeOrder = ["note", "vitals"];

  assert.throws(() => validateEncounterDefinition(candidate), /composition.quickActionOrder must contain every supported quick action exactly once.*composition.review.eventTypeOrder must contain every supported event type exactly once/);
});
