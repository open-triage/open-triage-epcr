import assert from "node:assert/strict";
import test from "node:test";
import { assignmentSummary, documentTimeline, INCIDENT_FIELD_LOCATIONS, incidentSummary } from "../app/incident-document";
import { RECOVERY_STORAGE_KEY, STORAGE_KEY, loadShellStateResult, saveShellState, type LocalStoragePort } from "../app/local-persistence";
import { getNemsisDataElement } from "../app/nemsis-data-model";
import { INITIAL_SHELL_STATE } from "../app/standard-encounter";
import { encounterEvents } from "../app/canonical-events";
import { standardEncounterDefinition } from "../app/standard-encounter-definition";
import demoAssignedCalls from "../public/demo-assigned-calls.json";

function memoryStorage(): LocalStoragePort & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

test("response, dispatch, crew, scene, and timing values live at their catalog identities", () => {
  const document = INITIAL_SHELL_STATE.encounter.document;
  for (const { groupId, elementId } of Object.values(INCIDENT_FIELD_LOCATIONS)) {
    const element = getNemsisDataElement(elementId)!;
    assert.ok(element.groupPath.includes(groupId), `${elementId} must belong to ${groupId}`);
  }
  const timing = documentTimeline(document);
  assert.deepEqual(timing.map(({ reference }) => reference), ["eTimes.03", "eTimes.02"]);
  assert.deepEqual(timing.map(({ title }) => title), ["Unit Notified by Dispatch", "Dispatch Notified"]);
  assert.equal(incidentSummary(document).incidentNumber, demoAssignedCalls.assignedCalls[0]!.callNumber);
  assert.equal(incidentSummary(document).callSign, demoAssignedCalls.assignedCalls[0]!.unit.callSign);
  assert.ok(incidentSummary(document).responseNumber);
  assert.ok(incidentSummary(document).location);
});

test("mobile projections expose only the configured operational subset", () => {
  const document = structuredClone(INITIAL_SHELL_STATE.encounter.document);
  const assignment = assignmentSummary(document);
  const generated = demoAssignedCalls.assignedCalls[0]!;
  assert.deepEqual(assignment, {
    incidentNumber: generated.callNumber,
    callSign: generated.unit.callSign,
    unitNotifiedAt: generated.dispatchedAt,
    dispatchReason: generated.dispatchReason,
    dispatchPriority: generated.dispatchPriority?.display,
  });
  const serialized = JSON.stringify({ assignment, header: incidentSummary(document), timeline: documentTimeline(document) });
  const hiddenIds = new Set(["eResponse.13", "ePatient.01", "ePatient.02", "ePatient.03", "ePatient.17", "ePatient.18", "ePatient.25"]);
  const hiddenValues = document.groups.flatMap(({ instances }) => instances).flatMap(({ elements }) => elements)
    .filter(({ id }) => hiddenIds.has(id)).flatMap(({ values }) => values)
    .flatMap((value) => value.kind === "scalar" ? [String(value.value)] : value.kind === "coded" ? [value.code, value.display ?? ""] : []);
  for (const hidden of hiddenValues.filter(Boolean)) {
    assert.equal(serialized.includes(JSON.stringify(hidden)), false);
  }

  const withoutReason = { ...document, groups: document.groups.map((group) => group.id !== "eDispatchSection" ? group : {
    ...group,
    instances: group.instances.map((instance) => ({ ...instance, elements: instance.elements.filter(({ id }) => id !== "eDispatch.01") })),
  }) };
  assert.equal(assignmentSummary(withoutReason).dispatchReason, "Dispatch reason not provided");
});

test("operational timeline uses browser local time and retains original offset lexicals", () => {
  const previousTimeZone = process.env.TZ;
  process.env.TZ = "Europe/Stockholm";
  try {
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
  const timeline = documentTimeline(configured);
  assert.deepEqual(timeline.map(({ reference }) => reference), [...supported].reverse());
  assert.equal(timeline.at(-1)?.date, "2026-01-15");
  assert.equal(timeline.at(-1)?.time, "00:30");
  assert.equal(timeline.at(-1)?.dateTime, "2026-01-15T01:30:00+02:00");
  assert.equal(timeline.every(({ detail }) => detail === ""), true);
  } finally {
    if (previousTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimeZone;
  }
});

test("an invalid operational timestamp cannot crash the encounter workspace", () => {
  const document = { ...INITIAL_SHELL_STATE.encounter.document, groups: INITIAL_SHELL_STATE.encounter.document.groups.map((group) =>
    group.id !== "eTimesSection" ? group : { ...group, instances: group.instances.map((instance) => ({
      ...instance, elements: instance.elements.map((element) => element.id !== "eTimes.02" ? element : {
        ...element, values: [{
          kind: "scalar" as const, occurrenceId: "malformed-generated-time", value: "2026-09-13T03:52:33.520Z-04:00",
        }],
      }),
    })) }) };

  assert.doesNotThrow(() => documentTimeline(document));
  assert.equal(documentTimeline(document).some(({ dateTime }) => dateTime?.includes("Z-04:00")), false);
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

test("a current draft reopens when an optional canonical incident group is absent", () => {
  const storage = memoryStorage();
  const withoutCrew = {
    ...INITIAL_SHELL_STATE,
    encounter: {
      ...INITIAL_SHELL_STATE.encounter,
      document: {
        ...INITIAL_SHELL_STATE.encounter.document,
        groups: INITIAL_SHELL_STATE.encounter.document.groups.filter(({ id }) => id !== "eCrew.CrewGroup"),
      },
    },
  };
  saveShellState(storage, withoutCrew);

  const restored = loadShellStateResult(storage);
  assert.equal(restored.status, "restored");
  if (restored.status !== "restored") return;
  assert.equal(restored.state.encounter.document.groups.some(({ id }) => id === "eCrew.CrewGroup"), false);
});

test("unsupported persistence versions are preserved byte-for-byte for explicit recovery", () => {
  for (const persistenceVersion of [undefined, 2, 3, 6]) {
    const storage = memoryStorage();
    const versionMember = persistenceVersion === undefined ? "" : `"persistenceVersion": ${persistenceVersion}, `;
    const original = ` { ${versionMember}"state": { "clinicalDraft": "retain exactly" } }\n`;
    storage.setItem(STORAGE_KEY, original);
    assert.deepEqual(loadShellStateResult(storage), {
      status: "invalid",
      reason: `saved persistence version ${persistenceVersion} is not supported`,
      recoveryKey: RECOVERY_STORAGE_KEY,
    });
    assert.equal(storage.getItem(RECOVERY_STORAGE_KEY), original);
    assert.equal(storage.getItem(STORAGE_KEY), null);
  }
});
