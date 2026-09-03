import assert from "node:assert/strict";
import test from "node:test";
import { standardEncounterDefinition } from "../app/standard-encounter-definition";
import type { EncounterDefinition } from "../app/encounter-definition";
import { loadShellState, saveShellState, STORAGE_KEY, type LocalStoragePort } from "../app/local-persistence";
import { EMPTY_VITALS, INITIAL_SHELL_STATE, encounterEventDetail, encounterEventPresentation, reviewEncounter, bundledEncounterDefinition, transitionShell, vitalSummary, type ShellState, type VitalValues } from "../app/standard-encounter";
import { nullOptionsFor, validateVitals } from "../app/vital-validation";

const normal = { ...EMPTY_VITALS, systolic: "120", diastolic: "80", heartRate: "72", spo2: "98", respiratoryRate: "16", gcs: "15", pain: "2", nullValues: {} };
function started(id = "vital-1", time = "09:00"): ShellState { return transitionShell(INITIAL_SHELL_STATE, { type: "vitals-started", id, time }); }
function fill(state: ShellState, values = normal): ShellState {
  for (const { id: field } of bundledEncounterDefinition.events.vitals.fields) state = transitionShell(state, { type: "vitals-value-changed", field, value: values[field] });
  return state;
}
function memoryStorage(): LocalStoragePort { const values = new Map<string, string>(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } }; }

test("repeatable vital sets save as distinct chronological NEMSIS timeline events", () => {
  let state = transitionShell(fill(started("vital-1", "09:00")), { type: "vitals-saved" });
  state = transitionShell(state, { type: "vitals-started", id: "vital-2", time: "08:45" });
  state = transitionShell(fill(state, { ...normal, heartRate: "80" }), { type: "vitals-saved" });
  const entries = state.encounter.events.filter((event) => event.vitals && event.visitorEntered);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((event) => event.time), ["09:00", "08:45"]);
  assert.equal(entries[0]?.reference, "eVitals.VitalGroup");
  assert.match(entries[0]?.detail ?? "", /BP 120\/80 · HR 72 · SpO₂ 98%/);
});

test("editing a vital set corrects the canonical entry and its clinical time", () => {
  let state = transitionShell(fill(started()), { type: "vitals-saved" });
  state = transitionShell(state, { type: "vitals-opened", id: "vital-1" });
  state = transitionShell(state, { type: "vitals-value-changed", field: "systolic", value: "126" });
  state = transitionShell(state, { type: "vitals-time-changed", value: "08:25" });
  state = transitionShell(state, { type: "vitals-saved" });
  const matching = state.encounter.events.filter((event) => event.id === "vital-1");
  assert.equal(matching.length, 1); assert.equal(matching[0]?.time, "08:25"); assert.match(matching[0]?.detail ?? "", /BP 126\/80/);
});

test("remove deletes the opened vital group", () => {
  let state = transitionShell(fill(started("vital-remove")), { type: "vitals-saved" });
  state = transitionShell(state, { type: "vitals-opened", id: "vital-remove" });
  state = transitionShell(state, { type: "vitals-removed" });
  assert.equal(state.vitalDraft, null);
  assert.equal(state.encounter.events.some((event) => event.id === "vital-remove"), false);
});

test("NEMSIS ranges block errors while plausible-range warnings remain saveable", () => {
  assert.equal(validateVitals("25:00", normal).valid, false);
  const invalid = validateVitals("09:00", { ...normal, spo2: "101" });
  assert.match(invalid.errors.spo2 ?? "", /eVitals\.12/);
  const unusual = validateVitals("09:00", { ...normal, systolic: "60" });
  assert.equal(unusual.valid, true); assert.match(unusual.warnings.systolic ?? "", /Clinically unusual/);
});

test("curated fields accept allowed NV/PN and prohibit codes on the wrong element", () => {
  const withNv = { ...normal, systolic: "", nullValues: { systolic: "7701003" as const } };
  assert.equal(validateVitals("09:00", withNv).valid, true);
  const allowedPn = { ...normal, spo2: "", nullValues: { spo2: "8801005" as const } };
  assert.equal(validateVitals("09:00", allowedPn).valid, true);
  const prohibitedPn = { ...normal, pain: "", nullValues: { pain: "8801005" as const } };
  assert.match(validateVitals("09:00", prohibitedPn).errors.pain ?? "", /eVitals\.27.*does not permit/);
  const prohibitedNv = { ...normal, heartRate: "", nullValues: { heartRate: "7701005" as const } };
  assert.match(validateVitals("09:00", prohibitedNv).errors.heartRate ?? "", /eVitals\.10.*does not permit/);
});

test("in-progress and saved vital sets persist across refresh", () => {
  const storage = memoryStorage(); let state = fill(started()); saveShellState(storage, state);
  assert.equal(loadShellState(storage)?.vitalDraft?.values.heartRate, "72");
  state = transitionShell(loadShellState(storage)!, { type: "vitals-saved" }); saveShellState(storage, state);
  assert.equal(loadShellState(storage)?.encounter.events.some((event) => event.id === "vital-1"), true);
});

test("invalid quick captures save and remain blocking at review", () => {
  const state = transitionShell(started(), { type: "vitals-saved" });
  assert.equal(state.vitalDraft, null);
  assert.equal(state.encounter.events.some((event) => event.id === "vital-1"), true);
  assert.ok(reviewEncounter(state).some((finding) => finding.severity === "error"));
});

test("configured vital metadata drives order, validation, review navigation, timeline, and summary", () => {
  const base = standardEncounterDefinition.events.vitals;
  const systolic = base.fields.find(({ id }) => id === "systolic")!;
  const definition: EncounterDefinition = {
    ...standardEncounterDefinition,
    events: { ...standardEncounterDefinition.events, vitals: {
      ...base,
      labels: { ...base.labels, category: "Measurement", timelineTitle: "Configured observations", absentSummary: "unavailable" },
      references: { group: "eVitals.ConfiguredGroup", time: "eVitals.02" },
      fields: [
        { ...systolic, label: "Configured pressure", unit: "kPa", required: true, reference: "eVitals.99", boundaries: { min: 50, max: 250, warningLow: 80, warningHigh: 200 }, absenceStates: [{ code: "7701005", kind: "NV", label: "Device unavailable (NV)" }] },
        ...base.fields.filter(({ id }) => id !== "systolic"),
      ],
      summary: [{ label: "Pressure", fields: ["systolic"], separator: "", unit: " kPa" }, ...base.summary.filter(({ fields }) => !fields.some((field) => field === "systolic"))],
    } },
  };
  const configuredSystolic = definition.events.vitals.fields[0]!;
  assert.equal(configuredSystolic.id, "systolic");
  assert.equal(configuredSystolic.unit, "kPa");
  assert.deepEqual(nullOptionsFor(configuredSystolic).at(-1), { value: "7701005", label: "Device unavailable (NV)" });

  const invalid = validateVitals("09:00", { ...normal, systolic: "251" }, definition);
  assert.match(invalid.errors.systolic ?? "", /eVitals\.99.*50 to 250/);
  const unusual = validateVitals("09:00", { ...normal, systolic: "60" }, definition);
  assert.equal(unusual.valid, true);
  assert.match(unusual.warnings.systolic ?? "", /configured pressure/);
  const unavailable = validateVitals("09:00", { ...normal, systolic: "", nullValues: { systolic: "7701005" } }, definition);
  assert.equal(unavailable.valid, true);
  assert.match(vitalSummary({ ...normal, systolic: "", nullValues: { systolic: "7701005" } }, definition), /Pressure unavailable kPa/);

  let state = transitionShell(INITIAL_SHELL_STATE, { type: "vitals-started", id: "configured-vital", time: "09:00" }, definition);
  for (const [field, value] of Object.entries({ ...normal, systolic: "251", nullValues: undefined })) {
    if (field !== "nullValues") state = transitionShell(state, { type: "vitals-value-changed", field: field as keyof Omit<VitalValues, "nullValues">, value: value as string }, definition);
  }
  state = transitionShell(state, { type: "vitals-saved" }, definition);
  const saved = state.encounter.events.find(({ id }) => id === "configured-vital")!;
  assert.deepEqual(encounterEventPresentation(saved, definition), { title: "Configured observations", reference: "eVitals.ConfiguredGroup" });
  assert.match(saved.detail, /Pressure 251 kPa/);
  assert.match(encounterEventDetail({ ...saved, detail: "stale persisted summary" }, definition), /Pressure 251 kPa/);
  const finding = reviewEncounter(state, definition).find(({ target }) => target.eventId === saved.id)!;
  assert.equal(finding.category, "Measurement");
  assert.equal(finding.reference, "eVitals.99");
  assert.equal(finding.target.vitalField, "systolic");
  state = transitionShell(state, { type: "review-finding-selected", id: finding.id }, definition);
  assert.equal(state.vitalDraft?.id, saved.id);
});

test("legacy persisted vital entries without nullValues remain readable and editable", () => {
  const legacyValues = { systolic: "118", diastolic: "76", heartRate: "70", spo2: "97", respiratoryRate: "15", gcs: "15", pain: "1" } as VitalValues;
  const legacyEvent = { id: "legacy-vital", date: "2026-04-18", time: "08:10", kind: "care" as const, title: "Vital signs", detail: "legacy", reference: "eVitals.VitalGroup", vitals: legacyValues };
  const state = { ...INITIAL_SHELL_STATE, encounter: { ...INITIAL_SHELL_STATE.encounter, events: [legacyEvent, ...INITIAL_SHELL_STATE.encounter.events] } };
  assert.equal(reviewEncounter(state).some(({ target }) => target.eventId === legacyEvent.id), false);
  const opened = transitionShell(state, { type: "vitals-opened", id: legacyEvent.id });
  assert.equal(opened.vitalDraft?.values.heartRate, "70");
  assert.deepEqual(opened.vitalDraft?.values.nullValues, {});

  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify({ ...state, vitalDraft: { id: "legacy-draft", date: "2026-04-18", time: "08:12", values: legacyValues, isNew: true } }));
  assert.deepEqual(loadShellState(storage)?.vitalDraft?.values.nullValues, {});
});
