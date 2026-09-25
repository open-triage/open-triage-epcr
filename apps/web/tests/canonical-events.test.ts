import assert from "node:assert/strict";
import test from "node:test";
import { encounterEvents, saveCanonicalEvent } from "../app/canonical-events";
import { shellStateToDraftMutations } from "../app/draft-report";
import { ENCOUNTER_EXTENSION_KEY, saveShellState, type LocalStoragePort } from "../app/local-persistence";
import { populateStationaryDemoData } from "../app/stationary-demo-data";
import { EMPTY_VITALS, INITIAL_SHELL_STATE, bundledEncounterDefinition, transitionShell, type EncounterEvent } from "../app/standard-encounter";

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

test("mobile clinical events keep canonical section ancestry and Populate does not duplicate them", () => {
  const mobileEvents: ReadonlyArray<EncounterEvent> = [
    { id: "mobile-vital", date: "2026-09-24", time: "09:00", kind: "care", title: "Vital signs", detail: "", reference: "eVitals.VitalGroup", visitorEntered: true,
      vitals: { ...EMPTY_VITALS, systolic: "121", diastolic: "81", heartRate: "73", spo2: "97", respiratoryRate: "17", gcs: "15", pain: "2", nullValues: {} } },
    { id: "mobile-procedure", date: "2026-09-24", time: "09:05", kind: "procedure", title: "Procedure", detail: "", reference: "eProcedures.03", visitorEntered: true,
      procedure: { code: "392230005", label: "Procedure", attempts: 1, success: "yes", outcome: "improved", complications: [], warningAcknowledged: false } },
    { id: "mobile-medication", date: "2026-09-24", time: "09:10", kind: "medication", title: "Medication", detail: "", reference: "eMedications.03", visitorEntered: true,
      medication: { medicationCode: "123", codeType: "RxNorm", label: "Medication", dose: "1", unit: "", route: "", response: "", warningAcknowledged: false } },
  ];
  let document = INITIAL_SHELL_STATE.encounter.document;
  for (const event of mobileEvents) document = saveCanonicalEvent(document, event, bundledEncounterDefinition);

  for (const [sectionId, groupId, eventId] of [
    ["eVitalsSection", "eVitals.VitalGroup", "mobile-vital"],
    ["eProceduresSection", "eProcedures.ProcedureGroup", "mobile-procedure"],
    ["eMedicationsSection", "eMedications.MedicationGroup", "mobile-medication"],
  ] as const) {
    const section = document.groups.find(({ id }) => id === sectionId)!.instances[0]!;
    const event = document.groups.find(({ id }) => id === groupId)!.instances.find(({ instanceId }) => instanceId === eventId)!;
    assert.equal(event.parentInstanceId, section.instanceId, `${groupId} is attached to ${sectionId}`);
  }

  const populatedEvents = encounterEvents(populateStationaryDemoData(document), bundledEncounterDefinition);
  assert.deepEqual(populatedEvents.filter(({ vitals }) => vitals).map(({ id }) => id), ["mobile-vital"]);
  assert.deepEqual(populatedEvents.filter(({ procedure }) => procedure).map(({ id }) => id), ["mobile-procedure"]);
  assert.deepEqual(populatedEvents.filter(({ medication }) => medication).map(({ id }) => id), ["mobile-medication"]);

  const legacyOrphan = {
    ...document,
    groups: document.groups.filter(({ id }) => !["eVitalsSection", "eProceduresSection", "eMedicationsSection"].includes(id)).map((group) => ({
      ...group,
      instances: group.instances.map((instance) => mobileEvents.some(({ id }) => id === instance.instanceId)
        ? (({ parentInstanceId: _parent, ...orphan }) => orphan)(instance)
        : instance),
    })),
  };
  const repaired = populateStationaryDemoData(legacyOrphan);
  const repairedEvents = encounterEvents(repaired, bundledEncounterDefinition);
  assert.deepEqual(repairedEvents.filter(({ vitals }) => vitals).map(({ id }) => id), ["mobile-vital"]);
  assert.deepEqual(repairedEvents.filter(({ procedure }) => procedure).map(({ id }) => id), ["mobile-procedure"]);
  assert.deepEqual(repairedEvents.filter(({ medication }) => medication).map(({ id }) => id), ["mobile-medication"]);
});
