import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_VITALS,
  INITIAL_SHELL_STATE,
  reviewEncounter,
  transitionShell,
  type EncounterEvent,
  type ShellState,
} from "../app/standard-encounter";
import { saveCanonicalEvent } from "../app/canonical-events";
import { standardEncounterDefinition } from "../app/standard-encounter-definition";

function withEvent(state: ShellState, event: EncounterEvent): ShellState {
  return { ...state, encounter: { ...state.encounter, document: saveCanonicalEvent(state.encounter.document, event, standardEncounterDefinition) } };
}

test("consolidates timeline-entry errors and warnings", () => {
  const invalidEvents: EncounterEvent[] = [
    { id: "bad-vital", time: "28:00", kind: "care", title: "Vital signs", detail: "Invalid", reference: "eVitals.VitalGroup", vitals: { ...EMPTY_VITALS, systolic: "501", nullValues: {} } },
    { id: "bad-med", time: "08:20", kind: "medication", title: "Unknown medication", detail: "Invalid", reference: "eMedications.03", medication: { medicationCode: "bad", codeType: "RxNorm", label: "Bad", dose: "0", unit: "bad", route: "bad", response: "", warningAcknowledged: false } },
    { id: "bad-procedure", time: "08:21", kind: "procedure", title: "Unknown procedure", detail: "Invalid", reference: "eProcedures.03", procedure: { code: "bad", label: "Bad", attempts: 0, success: "no", outcome: "unchanged", complications: [], warningAcknowledged: false } },
  ];
  const state = invalidEvents.reduce(withEvent, INITIAL_SHELL_STATE);
  const findings = reviewEncounter(state);
  for (const category of ["Vital", "Medication", "Procedure"] as const) {
    assert.ok(findings.some((finding) => finding.category === category && finding.severity === "error"), `missing ${category}`);
  }
  const systolicFinding = findings.find((finding) => finding.category === "Vital" && finding.reference === "eVitals.06");
  assert.equal(systolicFinding?.target.vitalField, "systolic");
});

test("a finding opens its exact canonical timeline event", () => {
  const badVital: EncounterEvent = { id: "bad-vital", time: "09:00", kind: "care", title: "Vital signs", detail: "", reference: "eVitals.VitalGroup", vitals: { ...EMPTY_VITALS, systolic: "501", nullValues: {} } };
  let state = withEvent(INITIAL_SHELL_STATE, badVital);
  const finding = reviewEncounter(state).find((candidate) => candidate.target.eventId === "bad-vital")!;
  state = transitionShell(state, { type: "review-finding-selected", id: finding.id });
  assert.equal(state.view, "timeline");
  assert.equal(state.vitalDraft?.id, "bad-vital");

});

test("review can be opened directly from capture views", () => {
  assert.equal(transitionShell(INITIAL_SHELL_STATE, { type: "review-opened" }).view, "review");
});

test("errors and unacknowledged warnings block signing", () => {
  const badVital: EncounterEvent = { id: "bad-vital", time: "09:00", kind: "care", title: "Vital signs", detail: "", reference: "eVitals.VitalGroup", vitals: { ...EMPTY_VITALS, systolic: "501", nullValues: {} } };
  assert.ok(reviewEncounter(withEvent(INITIAL_SHELL_STATE, badVital)).some((finding) => finding.severity === "error"));
  let complete = INITIAL_SHELL_STATE;
  assert.ok(reviewEncounter(complete).some((finding) => finding.severity === "warning" && !finding.acknowledged));
  for (const warning of reviewEncounter(complete).filter((finding) => finding.severity === "warning")) {
    complete = transitionShell(complete, { type: "review-warning-acknowledged", id: warning.id, acknowledged: true });
  }
  assert.ok(reviewEncounter(complete).every((finding) => finding.severity !== "error" && finding.acknowledged));
});

test("boundary-valid data can finish while unusual vital warnings require explicit acknowledgement", () => {
  let state = INITIAL_SHELL_STATE;
  state = transitionShell(state, { type: "vitals-started", id: "warning-vital", time: "23:59" });
  const values = { systolic: "0", diastolic: "500", heartRate: "40", spo2: "100", respiratoryRate: "8", gcs: "15", pain: "10" } as const;
  for (const [field, value] of Object.entries(values)) state = transitionShell(state, { type: "vitals-value-changed", field: field as keyof typeof values, value });
  state = transitionShell(state, { type: "vitals-saved" });
  const warnings = reviewEncounter(state).filter((finding) => finding.severity === "warning");
  assert.ok(warnings.length >= 1);
  assert.ok(warnings.some((finding) => !finding.acknowledged));
  for (const warning of warnings) state = transitionShell(state, { type: "review-warning-acknowledged", id: warning.id, acknowledged: true });
  assert.ok(reviewEncounter(state).filter((finding) => finding.severity === "warning").every((finding) => finding.acknowledged));
  assert.ok(reviewEncounter(state).every((finding) => finding.severity !== "error" && finding.acknowledged));
});

test("app-native text notes are not validated as NEMSIS signing findings", () => {
  let state = transitionShell(INITIAL_SHELL_STATE, { type: "note-started", id: "empty-note", time: "09:00" });
  state = transitionShell(state, { type: "note-saved" });
  assert.equal(reviewEncounter(state).some((finding) => finding.category === "Note"), false);
});
