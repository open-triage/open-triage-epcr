import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_VITALS,
  INITIAL_SHELL_STATE,
  reviewEncounter,
  transitionShell,
  type EncounterEvent,
  type ShellState,
} from "../app/synthetic-encounter";

function completeChecklist(state: ShellState): ShellState {
  return ([
    ["destination-condition", "4219003"],
    ["unit-disposition", "4227001"],
    ["narrative", "Inferior STEMI treated on scene; pain improved before handover."],
  ] as const).reduce((current, [field, value]) => transitionShell(current, { type: "checklist-field-changed", field, value }), state);
}

function withEvent(state: ShellState, event: EncounterEvent): ShellState {
  return { ...state, encounter: { ...state.encounter, events: [event, ...state.encounter.events] } };
}

test("consolidates vital, medication, procedure, note, checklist, disposition, and narrative errors", () => {
  const invalidEvents: EncounterEvent[] = [
    { id: "bad-vital", time: "28:00", kind: "care", title: "Vital signs", detail: "Invalid", reference: "eVitals.VitalGroup", vitals: { ...EMPTY_VITALS, systolic: "501", nullValues: {} } },
    { id: "bad-med", time: "08:20", kind: "medication", title: "Unknown medication", detail: "Invalid", reference: "eMedications.03", medication: { medicationCode: "bad", codeType: "RxNorm", label: "Bad", dose: "0", unit: "bad", route: "bad", response: "", warningAcknowledged: false } },
    { id: "bad-procedure", time: "08:21", kind: "procedure", title: "Unknown procedure", detail: "Invalid", reference: "eProcedures.03", procedure: { code: "bad", label: "Bad", attempts: 0, success: "no", outcome: "unchanged", complications: [], warningAcknowledged: false } },
    { id: "bad-note", time: "88:88", kind: "note", title: "Clinical note", detail: " ", reference: "eNarrative.01" },
  ];
  let state = invalidEvents.reduce(withEvent, INITIAL_SHELL_STATE);
  state = transitionShell(state, { type: "checklist-field-changed", field: "primary-symptom", value: "bad" });
  const findings = reviewEncounter(state);
  for (const category of ["Vital", "Medication", "Procedure", "Note", "Checklist", "Disposition", "Narrative"] as const) {
    assert.ok(findings.some((finding) => finding.category === category && finding.severity === "error"), `missing ${category}`);
  }
});

test("a finding opens its exact canonical event or checklist field", () => {
  const badNote: EncounterEvent = { id: "bad-note", time: "88:88", kind: "note", title: "Clinical note", detail: "Needs a valid time", reference: "eNarrative.01" };
  let state = withEvent(INITIAL_SHELL_STATE, badNote);
  let finding = reviewEncounter(state).find((candidate) => candidate.target.kind === "event" && candidate.target.eventId === "bad-note")!;
  state = transitionShell(state, { type: "review-finding-selected", id: finding.id });
  assert.equal(state.view, "timeline");
  assert.equal(state.noteDraft?.id, "bad-note");

  finding = reviewEncounter(INITIAL_SHELL_STATE).find((candidate) => candidate.category === "Disposition")!;
  state = transitionShell(INITIAL_SHELL_STATE, { type: "review-finding-selected", id: finding.id });
  assert.equal(state.view, "checklist");
  assert.equal(state.focusedChecklistField, "destination-condition");
});

test("errors block finish and valid completion produces a reversible read-only state", () => {
  assert.strictEqual(transitionShell(INITIAL_SHELL_STATE, { type: "review-finished" }), INITIAL_SHELL_STATE);
  let complete = completeChecklist(INITIAL_SHELL_STATE);
  for (const warning of reviewEncounter(complete).filter((finding) => finding.severity === "warning")) {
    complete = transitionShell(complete, { type: "review-warning-acknowledged", id: warning.id, acknowledged: true });
  }
  const summary = transitionShell(complete, { type: "review-finished" });
  assert.equal(summary.view, "summary");
  const editing = transitionShell(summary, { type: "summary-editing-continued" });
  assert.equal(editing.view, "timeline");
  assert.strictEqual(editing.encounter, complete.encounter);
  assert.deepEqual(editing.checklistValues, complete.checklistValues);
});

test("boundary-valid data can finish while unusual vital warnings require explicit acknowledgement", () => {
  let state = completeChecklist(INITIAL_SHELL_STATE);
  state = transitionShell(state, { type: "vitals-started", id: "warning-vital", time: "23:59" });
  const values = { systolic: "0", diastolic: "500", heartRate: "40", spo2: "100", respiratoryRate: "8", gcs: "15", pain: "10" } as const;
  for (const [field, value] of Object.entries(values)) state = transitionShell(state, { type: "vitals-value-changed", field: field as keyof typeof values, value });
  state = transitionShell(state, { type: "vitals-saved" });
  const warnings = reviewEncounter(state).filter((finding) => finding.severity === "warning");
  assert.ok(warnings.length >= 1);
  assert.notEqual(transitionShell(state, { type: "review-finished" }).view, "summary");
  for (const warning of warnings) state = transitionShell(state, { type: "review-warning-acknowledged", id: warning.id, acknowledged: true });
  assert.ok(reviewEncounter(state).filter((finding) => finding.severity === "warning").every((finding) => finding.acknowledged));
  assert.equal(transitionShell(state, { type: "review-finished" }).view, "summary");
});

test("missing and over-limit narrative values remain blocking findings", () => {
  let state = completeChecklist(INITIAL_SHELL_STATE);
  state = transitionShell(state, { type: "checklist-field-changed", field: "narrative", value: "x".repeat(2001) });
  assert.match(reviewEncounter(state).find((finding) => finding.category === "Narrative")?.message ?? "", /2000/);
  state = transitionShell(state, { type: "checklist-field-changed", field: "narrative", value: "" });
  assert.match(reviewEncounter(state).find((finding) => finding.category === "Narrative")?.message ?? "", /required/);
});
