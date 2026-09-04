import assert from "node:assert/strict";
import test from "node:test";
import { assignmentSummary, documentTimeline, INCIDENT_FIELD_LOCATIONS, incidentSummary } from "../app/incident-document";
import { RECOVERY_STORAGE_KEY, STORAGE_KEY, loadShellStateResult, saveShellState, type LocalStoragePort } from "../app/local-persistence";
import { getNemsisDataElement } from "../app/nemsis-data-model";
import { INITIAL_SHELL_STATE, transitionShell } from "../app/standard-encounter";
import { encounterEvents } from "../app/canonical-events";
import { standardEncounterDefinition } from "../app/standard-encounter-definition";

function memoryStorage(): LocalStoragePort & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

const legacyEvents = [
  { id: "baseline-1", time: "08:01", kind: "transport", title: "Arrived on scene", detail: "Legacy scene", reference: "eTimes.07" },
  { id: "baseline-2", time: "07:54", kind: "transport", title: "Unit en route", detail: "Routine response", reference: "eTimes.06" },
  { id: "baseline-3", time: "07:52", kind: "transport", title: "Unit notified", detail: "CAD-LEGACY", reference: "eTimes.03" },
  { id: "baseline-4", time: "07:50", kind: "transport", title: "Call received", detail: "Legacy complaint", reference: "eTimes.01" },
] as const;

function legacyVersionTwoState() {
  const state = structuredClone(INITIAL_SHELL_STATE) as unknown as { encounter: Record<string, unknown> } & Record<string, unknown>;
  const document = state.encounter.document as typeof INITIAL_SHELL_STATE.encounter.document;
  state.encounter.document = { ...document, groups: document.groups.filter(({ id }) => !["eResponseSection", "eDispatchSection", "eCrew.CrewGroup", "eSceneSection", "eTimesSection"].includes(id)) };
  state.encounter.currentTime = "08:01";
  state.encounter.crew = "ZX";
  state.encounter.incident = { number: "LEGACY-INCIDENT · CAD-LEGACY", complaint: "Legacy complaint", address: "9 Recovery Road" };
  state.encounter.events = [...legacyEvents, { id: "visitor-note", date: "2026-04-18", time: "08:02", kind: "note", title: "Clinical note", detail: "Keep me", reference: "eNarrative.01", visitorEntered: true }];
  return { persistenceVersion: 2, state };
}

test("response, dispatch, crew, scene, and timing values live at their catalog identities", () => {
  const document = INITIAL_SHELL_STATE.encounter.document;
  for (const { groupId, elementId } of Object.values(INCIDENT_FIELD_LOCATIONS)) {
    const element = getNemsisDataElement(elementId)!;
    assert.ok(element.groupPath.includes(groupId), `${elementId} must belong to ${groupId}`);
  }
  const timing = documentTimeline(document);
  assert.deepEqual(timing.map(({ reference }) => reference), ["eTimes.06", "eTimes.05", "eTimes.03"]);
  assert.deepEqual(timing.map(({ title }) => title), ["Unit Arrived on Scene", "Unit En Route", "Unit Notified by Dispatch"]);
  assert.deepEqual(incidentSummary(document), {
    incidentNumber: "SYN-20260418-113",
    responseNumber: "3-9-7-4-0",
    callSign: "AN",
    location: "100 Example Avenue (fictional), Suite 3",
  });
});

test("mobile projections expose only the configured operational subset", () => {
  const document = structuredClone(INITIAL_SHELL_STATE.encounter.document);
  const assignment = assignmentSummary(document);
  assert.deepEqual(assignment, {
    incidentNumber: "SYN-20260418-113",
    callSign: "AN",
    unitNotifiedAt: "2026-04-18T07:42:00-04:00",
    dispatchReason: "Medical assistance requested",
  });
  const serialized = JSON.stringify({ assignment, header: incidentSummary(document), timeline: documentTimeline(document) });
  for (const hidden of ["Rivera", "Jordan", "1985-08-14", "SYNTHETIC-VEHICLE", "555"]) {
    assert.doesNotMatch(serialized, new RegExp(hidden, "i"));
  }

  const withoutReason = { ...document, groups: document.groups.map((group) => group.id !== "eDispatchSection" ? group : {
    ...group,
    instances: group.instances.map((instance) => ({ ...instance, elements: instance.elements.filter(({ id }) => id !== "eDispatch.01") })),
  }) };
  assert.equal(assignmentSummary(withoutReason).dispatchReason, "Dispatch reason not provided");
});

test("operational timeline uses agency time and retains original offset lexicals", () => {
  const document = structuredClone(INITIAL_SHELL_STATE.encounter.document);
  const supported = ["eTimes.02", "eTimes.03", "eTimes.04", "eTimes.05", "eTimes.06", "eTimes.14", "eTimes.17"];
  const timeElements = [
    ...supported.map((id, index) => ({ id, values: [{
      kind: "scalar" as const,
      occurrenceId: `configured-${index}`,
      value: `2026-01-15T0${index + 1}:30:00+02:00`,
    }] })),
    { id: "eTimes.01", values: [{ kind: "scalar" as const, occurrenceId: "hidden-psap", value: "2026-01-15T00:30:00+02:00" }] },
    { id: "eTimes.07", values: [{ kind: "scalar" as const, occurrenceId: "hidden-patient", value: "2026-01-15T08:30:00+02:00" }] },
  ];
  const configured = { ...document, groups: document.groups.map((group) => group.id !== "eTimesSection" ? group : {
    ...group, instances: group.instances.map((instance) => ({ ...instance, elements: timeElements })),
  }) };
  const timeline = documentTimeline(configured, "America/New_York");
  assert.deepEqual(timeline.map(({ reference }) => reference), [...supported].reverse());
  assert.equal(timeline.at(-1)?.date, "2026-01-14");
  assert.equal(timeline.at(-1)?.time, "18:30");
  assert.equal(timeline.at(-1)?.dateTime, "2026-01-15T01:30:00+02:00");
  assert.equal(timeline.every(({ detail }) => detail === ""), true);
});

test("retained patient data, refresh recovery, and reset keep incident display on the canonical document", () => {
  const baselineDocument = INITIAL_SHELL_STATE.encounter.document;
  const before = { incident: incidentSummary(baselineDocument), timeline: documentTimeline(baselineDocument) };
  const editedDocument = { ...baselineDocument, groups: baselineDocument.groups.map((group) => group.id === "ePatient.PatientNameGroup" ? {
    ...group, instances: group.instances.map((instance) => ({ ...instance, elements: instance.elements.map((element) => element.id === "ePatient.02" ? {
      ...element, values: element.values.map((value) => value.kind === "scalar" ? { ...value, value: "Edited" } : value),
    } : element) })),
  } : group) };
  const state = { ...INITIAL_SHELL_STATE, encounter: { ...INITIAL_SHELL_STATE.encounter, document: editedDocument } };
  assert.deepEqual(incidentSummary(state.encounter.document), before.incident);
  assert.deepEqual(documentTimeline(state.encounter.document), before.timeline);

  const storage = memoryStorage();
  saveShellState(storage, state);
  const serialized = storage.getItem(STORAGE_KEY)!;
  assert.doesNotMatch(serialized, /"(?:currentTime|crew|incident)"\s*:/);
  assert.doesNotMatch(serialized, /"baseline-[1-4]"/);
  const restored = loadShellStateResult(storage);
  assert.equal(restored.status, "restored");
  if (restored.status !== "restored") return;
  assert.deepEqual(incidentSummary(restored.state.encounter.document), before.incident);
  assert.deepEqual(documentTimeline(restored.state.encounter.document), before.timeline);

  assert.deepEqual(INITIAL_SHELL_STATE.encounter.document, baselineDocument);
});

test("version two browser state upgrades deterministically and removes the parallel incident shape", () => {
  const serialized = JSON.stringify(legacyVersionTwoState());
  const restore = () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, serialized);
    return { storage, result: loadShellStateResult(storage) };
  };
  const first = restore();
  const second = restore();
  assert.equal(first.result.status, "restored");
  assert.equal(second.result.status, "restored");
  if (first.result.status !== "restored" || second.result.status !== "restored") return;
  assert.equal(first.result.migrated, true);
  assert.deepEqual(first.result.state.encounter.document, second.result.state.encounter.document);
  assert.deepEqual(incidentSummary(first.result.state.encounter.document), {
    incidentNumber: "LEGACY-INCIDENT", responseNumber: "CAD-LEGACY", callSign: "ZX", location: "9 Recovery Road",
  });
  assert.deepEqual(documentTimeline(first.result.state.encounter.document).map(({ reference, time }) => ({ reference, time })), [
    { reference: "eTimes.06", time: "08:01" },
    { reference: "eTimes.05", time: "07:54" },
    { reference: "eTimes.03", time: "07:52" },
    { reference: "eTimes.02", time: "07:50" },
  ]);
  assert.deepEqual(encounterEvents(first.result.state.encounter.document, standardEncounterDefinition).map(({ id }) => id), ["visitor-note"]);
  assert.equal("incident" in first.result.state.encounter, false);
  assert.equal("crew" in first.result.state.encounter, false);
  saveShellState(first.storage, first.result.state);
  assert.match(first.storage.getItem(STORAGE_KEY)!, /"persistenceVersion":5/);
  assert.doesNotMatch(first.storage.getItem(STORAGE_KEY)!, /"state":/);
});

test("malformed supported-version incident state is preserved and reported for recovery", () => {
  const storage = memoryStorage();
  const saved = legacyVersionTwoState();
  saved.state.encounter.crew = "";
  const original = JSON.stringify(saved);
  storage.setItem(STORAGE_KEY, original);
  const result = loadShellStateResult(storage);
  assert.deepEqual(result, {
    status: "invalid",
    reason: "saved incident data does not match the supported legacy shape",
    recoveryKey: RECOVERY_STORAGE_KEY,
  });
  assert.equal(storage.getItem(RECOVERY_STORAGE_KEY), original);
  assert.equal(storage.getItem(STORAGE_KEY), null);
});
