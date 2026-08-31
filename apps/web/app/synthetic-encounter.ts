export type ShellView = "timeline" | "checklist";

export type Encounter = {
  readonly scenarioId: string;
  readonly synthetic: true;
  readonly currentTime: string;
  readonly crew: string;
  readonly requiredRemaining: number;
  readonly patient: { readonly name: string; readonly age: number; readonly sex: string; readonly identifier: string };
  readonly incident: { readonly number: string; readonly complaint: string; readonly address: string };
  readonly events: ReadonlyArray<{ readonly time: string; readonly kind: "care" | "transport" | "alert"; readonly title: string; readonly detail: string; readonly reference: string }>;
  readonly checklist: ReadonlyArray<{ readonly title: string; readonly detail: string; readonly reference: string; readonly complete: boolean }>;
};

// Fixed usability-test fixture. Everything here is fictional and loaded
// automatically; this module is never a destination for real patient data.
export const syntheticEncounter: Encounter = {
  scenarioId: "adult-chest-pain-v1",
  synthetic: true,
  currentTime: "08:34",
  crew: "AN",
  requiredRemaining: 3,
  patient: { name: "Lindqvist, Margareta", age: 73, sex: "F", identifier: "19530418-XXXX" },
  incident: {
    number: "2026-0418-113 · 3-9-7-4-0",
    complaint: "Central chest pain radiating to left arm",
    address: "Sveavägen 112, 3 tr, Stockholm (fictional)",
  },
  events: [
    { time: "08:34", kind: "transport", title: "Handover", detail: "Coronary care nurse — condition improved", reference: "eDisposition.27" },
    { time: "08:29", kind: "transport", title: "Arrived at destination", detail: "Karolinska University Hospital Solna", reference: "eTimes.12" },
    { time: "08:26", kind: "care", title: "Vital signs", detail: "BP 136/84 · HR 88 · SpO₂ 97% · RR 17 · GCS 15 · pain 3", reference: "eVitals.VitalGroup" },
    { time: "08:14", kind: "transport", title: "Left scene", detail: "Priority 2, no lights or siren", reference: "eTimes.11" },
    { time: "08:11", kind: "care", title: "Oxygen 2 l/min", detail: "Nasal cannula — SpO₂ 94 → 96%", reference: "eMedications.03" },
    { time: "08:09", kind: "care", title: "Morphine 4 mg", detail: "IV · pain 8 → 4", reference: "eMedications.03" },
    { time: "08:05", kind: "alert", title: "PCI on-call contacted", detail: "Karolinska Solna — accepted straight to PCI lab", reference: "eNarrative.01" },
    { time: "08:04", kind: "alert", title: "Inferior STEMI", detail: "ST-elevation II, III, aVF — alert criteria met", reference: "eVitals.03" },
    { time: "08:03", kind: "care", title: "12-lead ECG", detail: "1 attempt, successful — interpreted on scene", reference: "eProcedures.03" },
    { time: "08:01", kind: "care", title: "Acetylsalicylic acid 300 mg", detail: "PO · per guideline 4.2", reference: "eMedications.03" },
    { time: "07:58", kind: "care", title: "IV access", detail: "Left antecubital, 18 G — 1 attempt, successful", reference: "eProcedures.03" },
    { time: "07:56", kind: "care", title: "Vital signs", detail: "BP 148/92 · HR 104 · SpO₂ 94% · RR 22 · GCS 15 · pain 8", reference: "eVitals.VitalGroup" },
    { time: "07:53", kind: "transport", title: "Patient contact", detail: "Awake, oriented, pale and diaphoretic", reference: "eTimes.09" },
    { time: "07:51", kind: "transport", title: "Arrived on scene", detail: "Residence — stairwell access, no lift", reference: "eTimes.07" },
    { time: "07:44", kind: "transport", title: "Unit en route", detail: "Priority 1 response, lights and siren", reference: "eTimes.06" },
    { time: "07:42", kind: "transport", title: "Unit notified", detail: "3-9-7-4-0 · EMD with pre-arrival instructions", reference: "eTimes.03 · eDispatch.02" },
    { time: "07:40", kind: "transport", title: "Call received", detail: "Chest pain, priority 1", reference: "eTimes.01" },
  ],
  checklist: [
    { title: "Response & scene", detail: "Incident, crew, address and scene details", reference: "eResponse · eScene", complete: true },
    { title: "Patient", detail: "Fictional identity and demographics", reference: "ePatient", complete: true },
    { title: "Situation & assessment", detail: "Chest pain, exam, ECG and vital signs", reference: "eSituation · eExam · eVitals", complete: true },
    { title: "Treatment", detail: "Medication and procedure events", reference: "eMedications · eProcedures", complete: true },
    { title: "Patient condition at destination", detail: "Not yet recorded", reference: "eDisposition.19", complete: false },
    { title: "Receiving acknowledgement", detail: "Not yet captured", reference: "eDisposition.27", complete: false },
    { title: "Narrative review", detail: "Not yet confirmed", reference: "eNarrative.01", complete: false },
  ],
};

export type ShellState = { readonly view: ShellView; readonly encounter: Encounter };
export type ShellAction = { readonly type: "view-selected"; readonly view: ShellView };

export const INITIAL_SHELL_STATE: ShellState = { view: "timeline", encounter: syntheticEncounter };

export function transitionShell(state: ShellState, action: ShellAction): ShellState {
  if (action.type === "view-selected") return { ...state, view: action.view };
  return state;
}
