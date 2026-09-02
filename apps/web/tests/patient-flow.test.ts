import assert from "node:assert/strict";
import test from "node:test";
import {
  RECOVERY_STORAGE_KEY,
  STORAGE_KEY,
  loadShellStateResult,
  saveShellState,
  type LocalStoragePort,
} from "../app/local-persistence";
import {
  patientDraftFromDocument,
  patientEditorField,
  patientSummary,
  updatePatientDocument,
} from "../app/patient-document";
import { INITIAL_SHELL_STATE, transitionShell } from "../app/standard-encounter";
import { requireNemsisDataElement, resolveNemsisElementValues } from "../app/nemsis-data-model";

function memoryStorage(): LocalStoragePort & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

test("the synthetic patient is stored only under its catalog group and element identities", () => {
  const document = INITIAL_SHELL_STATE.encounter.document;
  assert.deepEqual(document.groups.slice(0, 5).map(({ id }) => id), [
    "ePatient.PatientNameGroup",
    "ePatientSection",
    "ePatient.AgeGroup",
    "eHistorySection",
    "eHistory.CurrentMedsGroup",
  ]);
  assert.deepEqual(patientSummary(document), {
    name: "Rivera, Jordan",
    age: 54,
    sex: "Unknown (Unable to Determine)",
    identifier: "SYNTHETIC-0001",
    medicalHistory: ["None Reported"],
    currentMedications: ["None Reported"],
    allergies: ["No Known Drug Allergy"],
  });
  assert.equal("patient" in INITIAL_SHELL_STATE.encounter, false);
});

test("patient editor metadata, choices, null behavior, and references resolve from the catalog", () => {
  for (const id of ["identifier", "lastName", "firstName", "age", "sex", "medicalHistory", "currentMedications", "allergies"] as const) {
    const field = patientEditorField(id);
    const catalog = requireNemsisDataElement(field.reference);
    assert.equal(field.label, catalog.name.replace(" (DEPRECATED)", ""));
    assert.equal(field.datatype, catalog.datatype);
    assert.deepEqual(field.choices.filter(({ kind }) => kind === "null").map(({ code }) => code), resolveNemsisElementValues(catalog).notValues.map(({ code }) => code));
  }
  assert.ok(patientEditorField("sex").choices.some(({ code, label }) => code === "9906001" && label === "Female"));
  assert.ok(patientEditorField("medicalHistory").choices.some(({ code, system }) => code === "I10" && system === "ICD-10-CM"));
  assert.ok(patientEditorField("allergies").choices.some(({ kind, code }) => kind === "pertinent-negative" && code === "8801013"));
});

test("editing, refresh recovery, and reset use the same canonical document", () => {
  const baseline = INITIAL_SHELL_STATE.encounter.document;
  const original = structuredClone(baseline);
  const history = original.groups.find(({ id }) => id === "eHistorySection")!.instances[0] as unknown as { elements: Array<{ id: string; values: Array<{ kind: "scalar"; occurrenceId: string; value: string }> }> };
  history.elements.push({
    id: "org.example.ems:patient-extension",
    values: [{ kind: "scalar", occurrenceId: "patient-extension-1", value: "preserve me" }],
  });
  const draft = patientDraftFromDocument(original);
  const hypertension = patientEditorField("medicalHistory").choices.find(({ code }) => code === "I10")!;
  const female = patientEditorField("sex").choices.find(({ code }) => code === "9906001")!;
  const updated = updatePatientDocument(original, { ...draft, lastName: "Sample", age: 55, sex: female, medicalHistory: [hypertension] });
  let state = transitionShell(INITIAL_SHELL_STATE, { type: "patient-updated", document: updated });
  assert.deepEqual(patientSummary(state.encounter.document).medicalHistory, ["Hypertension"]);
  assert.equal(patientSummary(state.encounter.document).name, "Sample, Jordan");
  assert.equal(state.encounter.document.groups.find(({ id }) => id === "eHistorySection")?.instances[0]?.elements.some(({ id }) => id === "org.example.ems:patient-extension"), true);

  const storage = memoryStorage();
  saveShellState(storage, state);
  assert.doesNotMatch(storage.getItem(STORAGE_KEY)!, /"patient"\s*:/);
  const restored = loadShellStateResult(storage);
  assert.equal(restored.status, "restored");
  if (restored.status !== "restored") return;
  assert.equal(patientSummary(restored.state.encounter.document).age, 55);

  const notRecorded = patientEditorField("age").choices.find(({ kind, code }) => kind === "null" && code === "7701003")!;
  const unavailable = updatePatientDocument(restored.state.encounter.document, {
    ...patientDraftFromDocument(restored.state.encounter.document),
    absence: { age: notRecorded },
  });
  assert.equal(patientSummary(unavailable).age, "Not Recorded");
  assert.equal(unavailable.groups.find(({ id }) => id === "ePatient.AgeGroup")?.instances[0]?.elements.find(({ id }) => id === "ePatient.15")?.values[0]?.kind, "null");
  assert.throws(() => updatePatientDocument(original, { ...draft, age: 0 }), /must be at least 1/);

  state = transitionShell(restored.state, { type: "prototype-reset" });
  assert.deepEqual(state.encounter.document, baseline);
  assert.equal(patientSummary(state.encounter.document).name, "Rivera, Jordan");
});

test("the supported legacy patient shape upgrades deterministically without retaining legacy state", () => {
  const storage = memoryStorage();
  const legacy = structuredClone(INITIAL_SHELL_STATE) as unknown as { encounter: Record<string, unknown> };
  delete legacy.encounter.document;
  legacy.encounter.currentTime = "07:51";
  legacy.encounter.crew = "AN";
  legacy.encounter.incident = { number: "SYN-2026-0418-113 · 3-9-7-4-0", complaint: "Medical assistance requested", address: "100 Example Avenue, Unit 3 (fictional)" };
  legacy.encounter.events = [
    { id: "baseline-1", time: "07:51", kind: "transport", title: "Arrived on scene", detail: "Fictional residence — standard access", reference: "eTimes.07" },
    { id: "baseline-2", time: "07:44", kind: "transport", title: "Unit en route", detail: "Routine response", reference: "eTimes.06" },
    { id: "baseline-3", time: "07:42", kind: "transport", title: "Unit notified", detail: "3-9-7-4-0 · fictional dispatch notification", reference: "eTimes.03 · eDispatch.02 · eDispatch.06" },
    { id: "baseline-4", time: "07:40", kind: "transport", title: "Call received", detail: "Medical assistance requested", reference: "eTimes.01 · eDispatch.01 · eDispatch.05" },
  ];
  legacy.encounter.patient = {
    name: "Legacy, Person",
    age: 42,
    sex: "F",
    identifier: "SYNTHETIC-LEGACY",
    medicalHistory: ["Hypertension"],
    currentMedications: ["No current medications"],
    allergies: ["Penicillin"],
  };
  const serializedLegacy = JSON.stringify(legacy);
  storage.setItem(STORAGE_KEY, serializedLegacy);

  const result = loadShellStateResult(storage);
  assert.equal(result.status, "restored");
  if (result.status !== "restored") return;
  assert.equal(result.migrated, true);
  assert.deepEqual(patientSummary(result.state.encounter.document), {
    name: "Legacy, Person",
    age: 42,
    sex: "Female",
    identifier: "SYNTHETIC-LEGACY",
    medicalHistory: ["Hypertension"],
    currentMedications: ["None Reported"],
    allergies: ["Penicillin"],
  });
  assert.equal("patient" in result.state.encounter, false);
  const secondStorage = memoryStorage();
  secondStorage.setItem(STORAGE_KEY, serializedLegacy);
  const secondResult = loadShellStateResult(secondStorage);
  assert.equal(secondResult.status, "restored");
  if (secondResult.status === "restored") assert.deepEqual(secondResult.state.encounter.document, result.state.encounter.document);
  saveShellState(storage, result.state);
  assert.doesNotMatch(storage.getItem(STORAGE_KEY)!, /"patient"\s*:/);
});

test("invalid browser state is preserved byte-for-byte for clearly reported recovery", () => {
  const storage = memoryStorage();
  const original = "{not valid JSON";
  storage.setItem(STORAGE_KEY, original);
  assert.deepEqual(loadShellStateResult(storage), {
    status: "invalid",
    reason: "saved state is not valid JSON",
    recoveryKey: RECOVERY_STORAGE_KEY,
  });
  assert.equal(storage.getItem(RECOVERY_STORAGE_KEY), original);
  assert.equal(storage.getItem(STORAGE_KEY), null);
});
