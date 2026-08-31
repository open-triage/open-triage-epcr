import assert from "node:assert/strict";
import test from "node:test";
import { loadShellState, saveShellState, type LocalStoragePort } from "../app/local-persistence";
import { EMPTY_VITALS, INITIAL_SHELL_STATE, transitionShell, type ShellState, type VitalField } from "../app/synthetic-encounter";
import { validateVitals, VITAL_RULES } from "../app/vital-validation";

const normal = { ...EMPTY_VITALS, systolic: "120", diastolic: "80", heartRate: "72", spo2: "98", respiratoryRate: "16", gcs: "15", pain: "2", nullValues: {} };
function started(id = "vital-1", time = "09:00"): ShellState { return transitionShell(INITIAL_SHELL_STATE, { type: "vitals-started", id, time }); }
function fill(state: ShellState, values = normal): ShellState {
  for (const field of Object.keys(VITAL_RULES) as VitalField[]) state = transitionShell(state, { type: "vitals-value-changed", field, value: values[field] });
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

test("invalid drafts cannot enter a valid saved state", () => {
  const state = transitionShell(started(), { type: "vitals-saved" });
  assert.notEqual(state.vitalDraft, null); assert.equal(state.encounter.events.some((event) => event.id === "vital-1"), false);
});
