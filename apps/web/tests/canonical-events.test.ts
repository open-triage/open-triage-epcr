import assert from "node:assert/strict";
import test from "node:test";
import { encounterEvents, removeCanonicalEvent, repairRecreatedCanonicalEvents, saveCanonicalEvent } from "../app/canonical-events";
import { draftMutationDelta, encounterDocumentToDraftMutations, recoveryMutationBatches, shellStateToDraftMutations } from "../app/draft-report";
import { ENCOUNTER_EXTENSION_KEY, saveShellState, type LocalStoragePort } from "../app/local-persistence";
import { populateStationaryDemoData } from "../app/stationary-demo-data";
import { EMPTY_VITALS, INITIAL_SHELL_STATE, bundledEncounterDefinition, transitionShell, type EncounterEvent } from "../app/standard-encounter";

function patientGroups(document = INITIAL_SHELL_STATE.encounter.document) {
  return document.groups.filter(({ id }) => id.startsWith("ePatient") || id.startsWith("eHistory"));
}

test("editing a populated medication retains stored identities, extra fields, and other doses", () => {
  let document = populateStationaryDemoData(INITIAL_SHELL_STATE.encounter.document);
  const event = encounterEvents(document, bundledEncounterDefinition).find(({ medication }) => medication)!;
  const doseGroup = document.groups.find(({ id }) => id === "eMedications.DosageGroup")!;
  const dose = doseGroup.instances.find(({ parentInstanceId }) => parentInstanceId === event.id)!;
  const otherDose = { ...dose, instanceId: "another-dose", elements: dose.elements.map((element) => ({ ...element,
    values: element.values.map((value) => ({ ...value, occurrenceId: `another-${value.occurrenceId}` })) })) };
  document = { ...document, groups: document.groups.map((group) => group === doseGroup
    ? { ...group, instances: [otherDose, ...group.instances] } : group) };
  const baseline = encounterDocumentToDraftMutations("report-1", document);
  const edited = saveCanonicalEvent(document, { ...event,
    medication: { ...event.medication!, medicationCode: "7052", label: "Morphine" } }, bundledEncounterDefinition);
  const projected = encounterDocumentToDraftMutations("report-1", edited, baseline);
  assert.deepEqual(projected.groups.map(({ id }) => id), baseline.groups.map(({ id }) => id));
  assert.deepEqual(projected.occurrences.map(({ id }) => id), baseline.occurrences.map(({ id }) => id));
  const before = document.groups.find(({ id }) => id === "eMedications.MedicationGroup")!.instances[0]!;
  const after = edited.groups.find(({ id }) => id === "eMedications.MedicationGroup")!.instances[0]!;
  for (const id of ["eMedications.02", "eMedications.08", "eMedications.09"])
    assert.deepEqual(after.elements.find((element) => element.id === id), before.elements.find((element) => element.id === id));
  assert.deepEqual(edited.groups.find(({ id }) => id === doseGroup.id)!.instances[0], otherDose);
  assert.equal(encounterEvents(edited, bundledEncounterDefinition).find(({ id }) => id === event.id)!.medication!.medicationCode, "7052");
  const batches = recoveryMutationBatches(draftMutationDelta(projected, baseline), baseline);
  assert.equal(batches.length, 1);
  assert.equal(batches[0]!.demoAction, undefined);
  assert.ok(batches[0]!.occurrences.every((occurrence) => !occurrence.tombstone && !occurrence.provenanceKind));
});

test("retry repairs a medication edit queued by the old dialog without losing the selection", () => {
  let document = populateStationaryDemoData(INITIAL_SHELL_STATE.encounter.document);
  const event = encounterEvents(document, bundledEncounterDefinition).find(({ medication }) => medication)!;
  document = saveCanonicalEvent(document, { ...event, id: "other-medication" }, bundledEncounterDefinition);
  const editedEvent = { ...event, medication: { ...event.medication!, medicationCode: "7052", label: "Morphine" } };
  // The old dialog removed the subtree before regenerating its values and dose group.
  const legacy = saveCanonicalEvent(removeCanonicalEvent(document, event.id), editedEvent, bundledEncounterDefinition);
  const repaired = repairRecreatedCanonicalEvents(legacy, document, bundledEncounterDefinition);
  const expected = saveCanonicalEvent(document, editedEvent, bundledEncounterDefinition);
  const baseline = encounterDocumentToDraftMutations("report-1", document);
  const actualMutations = encounterDocumentToDraftMutations("report-1", repaired, baseline);
  const expectedMutations = encounterDocumentToDraftMutations("report-1", expected, baseline);
  const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
  assert.deepEqual(actualMutations.groups.toSorted(byId), expectedMutations.groups.toSorted(byId));
  assert.deepEqual(actualMutations.occurrences.toSorted(byId), expectedMutations.occurrences.toSorted(byId));
  assert.strictEqual(repairRecreatedCanonicalEvents(document, document, bundledEncounterDefinition), document);
});

for (const kind of ["vitals", "procedure"] as const) {
  test(`editing populated ${kind} preserves source identities and documentation outside the projection`, () => {
    let document = populateStationaryDemoData(INITIAL_SHELL_STATE.encounter.document);
    const event = encounterEvents(document, bundledEncounterDefinition).find((candidate) => candidate[kind])!;
    const rootGroup = document.groups.find(({ instances }) => instances.some(({ instanceId }) => instanceId === event.id))!;
    const root = rootGroup.instances.find(({ instanceId }) => instanceId === event.id)!;
    const extra = { id: "extension-field", values: [{ kind: "scalar" as const, occurrenceId: "extension-value", value: "Keep me" }] };
    const child = { id: "extension-group", instances: [{ instanceId: "extension-child", parentInstanceId: root.instanceId,
      elements: [extra] }] };
    document = { ...document, groups: [...document.groups.map((group) => group !== rootGroup ? group : { ...group,
      instances: group.instances.map((instance) => instance !== root ? instance : { ...instance,
        attributes: { ...instance.attributes, externalAnnotation: "Keep me" }, elements: [...instance.elements, extra] }) }), child] };
    const editedEvent = kind === "vitals"
      ? { ...event, vitals: { ...event.vitals!, heartRate: "83", systolic: "122" } }
      : { ...event, procedure: { ...event.procedure!, attempts: 3 } };
    const baseline = encounterDocumentToDraftMutations("report-1", document);
    const edited = saveCanonicalEvent(document, editedEvent, bundledEncounterDefinition);
    assert.strictEqual(repairRecreatedCanonicalEvents(edited, document, bundledEncounterDefinition), edited);
    const projected = encounterDocumentToDraftMutations("report-1", edited, baseline);
    assert.deepEqual(projected.groups.map(({ id }) => id), baseline.groups.map(({ id }) => id));
    assert.deepEqual(projected.occurrences.map(({ id }) => id), baseline.occurrences.map(({ id }) => id));
    const savedRoot = edited.groups.find(({ id }) => id === rootGroup.id)!.instances.find(({ instanceId }) => instanceId === event.id)!;
    assert.deepEqual(savedRoot.elements.find(({ id }) => id === extra.id), extra);
    assert.equal(savedRoot.attributes?.externalAnnotation, "Keep me");
    assert.deepEqual(edited.groups.find(({ id }) => id === child.id), child);
    const savedEvent = encounterEvents(edited, bundledEncounterDefinition).find(({ id }) => id === event.id)!;
    if (kind === "vitals") {
      assert.equal(savedEvent.vitals!.heartRate, "83");
      assert.equal(savedEvent.vitals!.systolic, "122");
    } else assert.equal(savedEvent.procedure!.attempts, 3);

    // Simulate a legacy queued edit that recreated the entire subtree.
    const legacy = saveCanonicalEvent(removeCanonicalEvent(document, event.id), editedEvent, bundledEncounterDefinition);
    const repaired = repairRecreatedCanonicalEvents(legacy, document, bundledEncounterDefinition);
    const byGroup = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
    assert.deepEqual(repaired.groups.toSorted(byGroup), edited.groups.toSorted(byGroup));
    assert.strictEqual(repairRecreatedCanonicalEvents(document, document, bundledEncounterDefinition), document);
  });
}

test("clearing projected nested values preserves their group and unrelated values", () => {
  const document = populateStationaryDemoData(INITIAL_SHELL_STATE.encounter.document);
  const event = encounterEvents(document, bundledEncounterDefinition).find(({ vitals }) => vitals)!;
  const cleared = saveCanonicalEvent(document, { ...event, vitals: { ...EMPTY_VITALS, nullValues: {} } }, bundledEncounterDefinition);
  assert.deepEqual(cleared.groups.map((group) => [group.id, group.instances.map(({ instanceId }) => instanceId)]),
    document.groups.map((group) => [group.id, group.instances.map(({ instanceId }) => instanceId)]));
  assert.deepEqual(encounterEvents(cleared, bundledEncounterDefinition).find(({ id }) => id === event.id)!.vitals,
    { ...EMPTY_VITALS, nullValues: {} });
});

test("reordering and removing projected selections retains identities of surviving values", () => {
  const populated = populateStationaryDemoData(INITIAL_SHELL_STATE.encounter.document);
  const event = encounterEvents(populated, bundledEncounterDefinition).find(({ procedure }) => procedure)!;
  let document = saveCanonicalEvent(populated, { ...event, procedure: { ...event.procedure!, complications: ["a", "b", "c"] } }, bundledEncounterDefinition);
  const hidden = { kind: "null" as const, occurrenceId: "unprojected-selection", notValue: { code: "7701003" } };
  document = { ...document, groups: document.groups.map((group) => ({ ...group, instances: group.instances.map((instance) =>
    instance.instanceId !== event.id ? instance : { ...instance, elements: instance.elements.map((element) =>
      element.values.some((value) => value.kind === "coded" && value.code === "a")
        ? { ...element, values: [hidden, ...element.values] } : element) }) })) };
  const values = document.groups.flatMap(({ instances }) => instances).find(({ instanceId }) => instanceId === event.id)!
    .elements.flatMap(({ values }) => values).filter((value) => value.kind === "coded" && ["a", "b", "c"].includes(value.code));
  const editedEvent = encounterEvents(document, bundledEncounterDefinition).find(({ id }) => id === event.id)!;
  document = saveCanonicalEvent(document, { ...editedEvent, procedure: { ...editedEvent.procedure!, complications: ["c", "a", "d"] } }, bundledEncounterDefinition);
  const retained = document.groups.flatMap(({ instances }) => instances).find(({ instanceId }) => instanceId === event.id)!
    .elements.flatMap(({ values }) => values).filter((value) => value.kind === "coded" && ["a", "b", "c", "d"].includes(value.code));
  assert.deepEqual(retained.slice(0, 2).map(({ occurrenceId }) => occurrenceId), [values[2]!.occurrenceId, values[0]!.occurrenceId]);
  const ids = document.groups.flatMap(({ instances }) => instances.flatMap(({ elements }) => elements.flatMap(({ values }) => values.map(({ occurrenceId }) => occurrenceId))));
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(document.groups.flatMap(({ instances }) => instances.flatMap(({ elements }) => elements.flatMap(({ values }) => values)))
    .find(({ occurrenceId }) => occurrenceId === hidden.occurrenceId), hidden);
});

test("quick capture preserves invalid times for correction rather than normalizing or rejecting the entry", () => {
  const event: EncounterEvent = { id: "invalid-clock", date: "2026-09-24", time: "99:99", kind: "care",
    title: "Vital signs", detail: "", reference: "eVitals.VitalGroup", vitals: EMPTY_VITALS };
  const saved = saveCanonicalEvent(INITIAL_SHELL_STATE.encounter.document, event, bundledEncounterDefinition);
  assert.equal(encounterEvents(saved, bundledEncounterDefinition).find(({ id }) => id === event.id)?.time, "99:99");
});

test("mobile event times round-trip the local clock, retaining instants during DST and edits", () => {
  const prior = process.env.TZ;
  process.env.TZ = "Europe/Stockholm";
  try {
    const event: EncounterEvent = { id: "local-vital", date: "2026-09-24", time: "10:30", kind: "care", title: "Vitals",
      detail: "", reference: "eVitals.VitalGroup", visitorEntered: true, vitals: { ...EMPTY_VITALS, heartRate: "72", nullValues: {} } };
    let document = saveCanonicalEvent(INITIAL_SHELL_STATE.encounter.document, event, bundledEncounterDefinition);
    let observed = encounterEvents(document, bundledEncounterDefinition).find(({ id }) => id === event.id)!;
    assert.equal(observed.time, "10:30");
    assert.equal(Date.parse(observed.dateTime!), Date.parse("2026-09-24T08:30:00Z"));
    document = saveCanonicalEvent(document, { ...observed, date: "2026-12-15" }, bundledEncounterDefinition);
    observed = encounterEvents(document, bundledEncounterDefinition).find(({ id }) => id === event.id)!;
    assert.equal(Date.parse(observed.dateTime!), Date.parse("2026-12-15T09:30:00Z"));

    // A server/stationary edit is authoritative over the older documentedTime attribute.
    const ambiguous = "2026-10-25T01:30:45.123Z";
    document = { ...document, groups: document.groups.map((group) => ({ ...group, instances: group.instances.map((instance) =>
      instance.instanceId !== event.id ? instance : { ...instance, elements: instance.elements.map((element) =>
        element.id !== "eVitals.01" ? element : { ...element, values: [{ kind: "scalar", occurrenceId: "local-time", value: ambiguous }] }) }) })) };
    observed = encounterEvents(document, bundledEncounterDefinition).find(({ id }) => id === event.id)!;
    assert.equal(observed.time, "02:30");
    assert.equal(observed.dateTime, ambiguous);
    document = saveCanonicalEvent(document, { ...observed, dateTime: undefined, vitals: { ...observed.vitals!, heartRate: "80" } }, bundledEncounterDefinition);
    assert.equal(encounterEvents(document, bundledEncounterDefinition).find(({ id }) => id === event.id)!.dateTime, ambiguous);
  } finally {
    if (prior === undefined) delete process.env.TZ;
    else process.env.TZ = prior;
  }
});

test("legacy note reducer actions cannot change the canonical document", () => {
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

  assert.equal(encounterEvents(state.encounter.document, bundledEncounterDefinition).some(({ id }) => id === "stable-note"), false);
  assert.deepEqual(state.encounter.document.groups.find(({ id }) => id === "eVitals.VitalGroup")!.instances.slice(0, inboundVitals.length), inboundVitals);
  assert.deepEqual(patientGroups(state.encounter.document), retainedPatient);

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
