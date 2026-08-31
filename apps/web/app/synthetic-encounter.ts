import { validateVitals } from "./vital-validation";

export type ShellView = "timeline" | "checklist";

export type ChecklistFieldId =
  | "primary-symptom"
  | "secondary-symptom"
  | "primary-impression"
  | "possible-injury"
  | "destination-condition"
  | "unit-disposition"
  | "narrative";

export type ChecklistField = {
  readonly id: ChecklistFieldId;
  readonly section: "Assessment" | "Disposition" | "Narrative";
  readonly label: string;
  readonly reference: string;
  readonly datatype: "Coded value" | "Text";
  readonly cardinality: "1..1" | "1..*";
  readonly usage: "Required";
  readonly exceptionalValues: ReadonlyArray<"NV" | "PN">;
  readonly control: "select" | "text" | "textarea";
  readonly options?: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  readonly placeholder?: string;
  readonly maxLength?: number;
};

const notAvailable = { value: "NV", label: "Not available / not recorded (NV)" };

export const checklistFields: ReadonlyArray<ChecklistField> = [
  {
    id: "primary-symptom", section: "Assessment", label: "Primary symptom", reference: "eSituation.09",
    datatype: "Coded value", cardinality: "1..1", usage: "Required", exceptionalValues: ["NV"], control: "select",
    options: [{ value: "R07.9", label: "R07.9 — Chest pain, unspecified" }, notAvailable],
  },
  {
    id: "primary-impression", section: "Assessment", label: "Primary impression", reference: "eSituation.11",
    datatype: "Coded value", cardinality: "1..1", usage: "Required", exceptionalValues: ["NV"], control: "select",
    options: [{ value: "I21.3", label: "I21.3 — ST-elevation myocardial infarction" }, notAvailable],
  },
  {
    id: "secondary-symptom", section: "Assessment", label: "Secondary symptom", reference: "eSituation.10",
    datatype: "Coded value", cardinality: "1..*", usage: "Required", exceptionalValues: ["NV", "PN"], control: "select",
    options: [{ value: "R61", label: "R61 — Diaphoresis" }, notAvailable, { value: "PN", label: "Symptom not present (PN)" }],
  },
  {
    id: "possible-injury", section: "Assessment", label: "Possible injury", reference: "eSituation.02",
    datatype: "Coded value", cardinality: "1..1", usage: "Required", exceptionalValues: ["NV"], control: "select",
    options: [{ value: "no", label: "No" }, { value: "yes", label: "Yes" }, notAvailable],
  },
  {
    id: "destination-condition", section: "Disposition", label: "Acuity upon EMS release", reference: "eDisposition.19",
    datatype: "Coded value", cardinality: "1..1", usage: "Required", exceptionalValues: ["NV"], control: "select",
    options: [
      { value: "4219001", label: "Critical (Red)" },
      { value: "4219003", label: "Emergent (Yellow)" },
      { value: "4219005", label: "Lower acuity (Green)" },
      { value: "4219009", label: "Non-acute / routine" },
      notAvailable,
    ],
  },
  {
    id: "unit-disposition", section: "Disposition", label: "Unit disposition", reference: "eDisposition.27",
    datatype: "Coded value", cardinality: "1..1", usage: "Required", exceptionalValues: [], control: "select",
    options: [
      { value: "4227001", label: "Patient contact made" },
      { value: "4227003", label: "Cancelled on scene" },
      { value: "4227005", label: "Cancelled prior to arrival" },
      { value: "4227007", label: "No patient contact" },
      { value: "4227009", label: "No patient found" },
    ],
  },
  {
    id: "narrative", section: "Narrative", label: "Clinical narrative review", reference: "eNarrative.01",
    datatype: "Text", cardinality: "1..1", usage: "Required", exceptionalValues: [], control: "textarea",
    placeholder: "Summarize assessment, care and response…", maxLength: 2000,
  },
];

export type ChecklistValues = Readonly<Record<ChecklistFieldId, string>>;
export const INITIAL_CHECKLIST_VALUES: ChecklistValues = {
  "primary-symptom": "R07.9",
  "secondary-symptom": "R61",
  "primary-impression": "I21.3",
  "possible-injury": "no",
  "destination-condition": "",
  "unit-disposition": "",
  narrative: "",
};

export type ValidationFinding = { readonly fieldId: ChecklistFieldId; readonly reference: string; readonly message: string };

export function validateChecklist(values: ChecklistValues): ReadonlyArray<ValidationFinding> {
  return checklistFields.flatMap((field) => {
    const value = values[field.id].trim();
    if (!value) return [{ fieldId: field.id, reference: field.reference, message: `${field.label} is required.` }];
    if (value === "NV" && !field.exceptionalValues.includes("NV")) {
      return [{ fieldId: field.id, reference: field.reference, message: "Not available (NV) is not permitted for this input." }];
    }
    if (value === "PN" && !field.exceptionalValues.includes("PN")) {
      return [{ fieldId: field.id, reference: field.reference, message: "Pertinent negative (PN) is not permitted for this input." }];
    }
    if (field.maxLength && value.length > field.maxLength) {
      return [{ fieldId: field.id, reference: field.reference, message: `Must be ${field.maxLength} characters or fewer.` }];
    }
    if (field.control === "select" && !field.options?.some((option) => option.value === value)) {
      return [{ fieldId: field.id, reference: field.reference, message: "Select a permitted value." }];
    }
    return [];
  });
}

export type EncounterEvent = {
  readonly id: string;
  readonly time: string;
  readonly kind: "care" | "transport" | "alert" | "note";
  readonly title: string;
  readonly detail: string;
  readonly reference: string;
  readonly visitorEntered?: true;
  readonly vitals?: VitalValues;
};

export type VitalField = "systolic" | "diastolic" | "heartRate" | "spo2" | "respiratoryRate" | "gcs" | "pain";
export type NullValue = "" | "7701001" | "7701003" | "7701005" | "8801005" | "8801019" | "8801023";
export type VitalValues = Record<VitalField, string> & { readonly nullValues: Partial<Record<VitalField, NullValue>> };
export type VitalDraft = { readonly id: string; readonly time: string; readonly values: VitalValues; readonly isNew: boolean };

export type Encounter = {
  readonly scenarioId: string;
  readonly synthetic: true;
  readonly currentTime: string;
  readonly crew: string;
  readonly requiredRemaining: number;
  readonly patient: { readonly name: string; readonly age: number; readonly sex: string; readonly identifier: string };
  readonly incident: { readonly number: string; readonly complaint: string; readonly address: string };
  readonly events: ReadonlyArray<EncounterEvent>;
  readonly checklist: ReadonlyArray<{ readonly title: string; readonly detail: string; readonly reference: string; readonly complete: boolean }>;
};

const baselineEvents: ReadonlyArray<Omit<EncounterEvent, "id">> = [
  { time: "08:34", kind: "transport", title: "Handover", detail: "Coronary care nurse — condition improved", reference: "eDisposition.27" },
  { time: "08:29", kind: "transport", title: "Arrived at destination", detail: "Karolinska University Hospital Solna", reference: "eTimes.12" },
  { time: "08:26", kind: "care", title: "Vital signs", detail: "BP 136/84 · HR 88 · SpO₂ 97% · RR 17 · GCS 15 · pain 3", reference: "eVitals.VitalGroup", vitals: { systolic: "136", diastolic: "84", heartRate: "88", spo2: "97", respiratoryRate: "17", gcs: "15", pain: "3", nullValues: {} } },
  { time: "08:14", kind: "transport", title: "Left scene", detail: "Priority 2, no lights or siren", reference: "eTimes.11" },
  { time: "08:11", kind: "care", title: "Oxygen 2 l/min", detail: "Nasal cannula — SpO₂ 94 → 96%", reference: "eMedications.03" },
  { time: "08:09", kind: "care", title: "Morphine 4 mg", detail: "IV · pain 8 → 4", reference: "eMedications.03" },
  { time: "08:05", kind: "alert", title: "PCI on-call contacted", detail: "Karolinska Solna — accepted straight to PCI lab", reference: "eNarrative.01" },
  { time: "08:04", kind: "alert", title: "Inferior STEMI", detail: "ST-elevation II, III, aVF — alert criteria met", reference: "eVitals.03" },
  { time: "08:03", kind: "care", title: "12-lead ECG", detail: "1 attempt, successful — interpreted on scene", reference: "eProcedures.03" },
  { time: "08:01", kind: "care", title: "Acetylsalicylic acid 300 mg", detail: "PO · per guideline 4.2", reference: "eMedications.03" },
  { time: "07:58", kind: "care", title: "IV access", detail: "Left antecubital, 18 G — 1 attempt, successful", reference: "eProcedures.03" },
  { time: "07:56", kind: "care", title: "Vital signs", detail: "BP 148/92 · HR 104 · SpO₂ 94% · RR 22 · GCS 15 · pain 8", reference: "eVitals.VitalGroup", vitals: { systolic: "148", diastolic: "92", heartRate: "104", spo2: "94", respiratoryRate: "22", gcs: "15", pain: "8", nullValues: {} } },
  { time: "07:53", kind: "transport", title: "Patient contact", detail: "Awake, oriented, pale and diaphoretic", reference: "eTimes.09" },
  { time: "07:51", kind: "transport", title: "Arrived on scene", detail: "Residence — stairwell access, no lift", reference: "eTimes.07" },
  { time: "07:44", kind: "transport", title: "Unit en route", detail: "Priority 1 response, lights and siren", reference: "eTimes.06" },
  { time: "07:42", kind: "transport", title: "Unit notified", detail: "3-9-7-4-0 · EMD with pre-arrival instructions", reference: "eTimes.03 · eDispatch.02" },
  { time: "07:40", kind: "transport", title: "Call received", detail: "Chest pain, priority 1", reference: "eTimes.01" },
];

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
  events: baselineEvents.map((event, index) => ({ ...event, id: `baseline-${index + 1}` })),
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

export type NoteDraft = { readonly id: string; readonly time: string; readonly summary: string; readonly isNew: boolean };
export type ShellState = {
  readonly view: ShellView;
  readonly encounter: Encounter;
  readonly noteDraft: NoteDraft | null;
  readonly vitalDraft: VitalDraft | null;
  readonly checklistValues: ChecklistValues;
  readonly focusedChecklistField: ChecklistFieldId | null;
};
export type ShellAction =
  | { readonly type: "view-selected"; readonly view: ShellView }
  | { readonly type: "note-started"; readonly id: string; readonly time: string }
  | { readonly type: "note-opened"; readonly id: string }
  | { readonly type: "note-draft-changed"; readonly field: "time" | "summary"; readonly value: string }
  | { readonly type: "note-cancelled" }
  | { readonly type: "note-saved" }
  | { readonly type: "checklist-field-changed"; readonly field: ChecklistFieldId; readonly value: string }
  | { readonly type: "validation-selected"; readonly field: ChecklistFieldId }
  | { readonly type: "validation-focus-cleared" }
  | { readonly type: "vitals-started"; readonly id: string; readonly time: string }
  | { readonly type: "vitals-opened"; readonly id: string }
  | { readonly type: "vitals-time-changed"; readonly value: string }
  | { readonly type: "vitals-value-changed"; readonly field: VitalField; readonly value: string }
  | { readonly type: "vitals-null-changed"; readonly field: VitalField; readonly value: NullValue }
  | { readonly type: "vitals-cancelled" }
  | { readonly type: "vitals-saved" }
  | { readonly type: "state-restored"; readonly state: ShellState }
  | { readonly type: "prototype-reset" };

export const EMPTY_VITALS: VitalValues = { systolic: "", diastolic: "", heartRate: "", spo2: "", respiratoryRate: "", gcs: "", pain: "", nullValues: {} };
export const INITIAL_SHELL_STATE: ShellState = {
  view: "timeline",
  encounter: syntheticEncounter,
  noteDraft: null,
  vitalDraft: null,
  checklistValues: INITIAL_CHECKLIST_VALUES,
  focusedChecklistField: null,
};

export function vitalSummary(values: VitalValues): string {
  const shown = (field: VitalField, label: string, suffix = "") => {
    const value = values[field];
    if (value) return `${label} ${value}${suffix}`;
    return values.nullValues[field] ? `${label} not recorded` : null;
  };
  return [values.systolic || values.diastolic ? `BP ${values.systolic || "—"}/${values.diastolic || "—"}` : null,
    shown("heartRate", "HR"), shown("spo2", "SpO₂", "%"), shown("respiratoryRate", "RR"), shown("gcs", "GCS"), shown("pain", "pain")]
    .filter(Boolean).join(" · ");
}

function newestFirst(events: ReadonlyArray<EncounterEvent>): ReadonlyArray<EncounterEvent> {
  return events.map((event, index) => ({ event, index })).sort((a, b) =>
    b.event.time.localeCompare(a.event.time) || a.index - b.index,
  ).map(({ event }) => event);
}

export function transitionShell(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case "view-selected":
      return { ...state, view: action.view, focusedChecklistField: null };
    case "checklist-field-changed":
      return { ...state, checklistValues: { ...state.checklistValues, [action.field]: action.value } };
    case "validation-selected":
      return { ...state, view: "checklist", focusedChecklistField: action.field };
    case "validation-focus-cleared":
      return { ...state, focusedChecklistField: null };
    case "note-started":
      return { ...state, noteDraft: { id: action.id, time: action.time, summary: "", isNew: true } };
    case "note-opened": {
      const event = state.encounter.events.find((candidate) => candidate.id === action.id && candidate.kind === "note");
      return event ? { ...state, noteDraft: { id: event.id, time: event.time, summary: event.detail, isNew: false } } : state;
    }
    case "note-draft-changed":
      return state.noteDraft ? { ...state, noteDraft: { ...state.noteDraft, [action.field]: action.value } } : state;
    case "note-cancelled":
      return { ...state, noteDraft: null };
    case "note-saved": {
      const draft = state.noteDraft;
      if (!draft || !draft.summary.trim() || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(draft.time)) return state;
      const note: EncounterEvent = {
        id: draft.id,
        time: draft.time.slice(0, 5),
        kind: "note",
        title: "Clinical note",
        detail: draft.summary.trim(),
        reference: "eNarrative.01",
        visitorEntered: true,
      };
      const withoutCurrent = state.encounter.events.filter((event) => event.id !== draft.id);
      return {
        ...state,
        view: "timeline",
        noteDraft: null,
        encounter: { ...state.encounter, events: newestFirst([...withoutCurrent, note]) },
      };
    }
    case "vitals-started":
      return { ...state, vitalDraft: { id: action.id, time: action.time, values: { ...EMPTY_VITALS, nullValues: {} }, isNew: true } };
    case "vitals-opened": {
      const event = state.encounter.events.find((candidate) => candidate.id === action.id && candidate.vitals);
      return event?.vitals ? { ...state, vitalDraft: { id: event.id, time: event.time, values: event.vitals, isNew: false } } : state;
    }
    case "vitals-time-changed":
      return state.vitalDraft ? { ...state, vitalDraft: { ...state.vitalDraft, time: action.value } } : state;
    case "vitals-value-changed":
      return state.vitalDraft ? { ...state, vitalDraft: { ...state.vitalDraft, values: { ...state.vitalDraft.values, [action.field]: action.value, nullValues: { ...state.vitalDraft.values.nullValues, [action.field]: "" } } } } : state;
    case "vitals-null-changed":
      return state.vitalDraft ? { ...state, vitalDraft: { ...state.vitalDraft, values: { ...state.vitalDraft.values, [action.field]: "", nullValues: { ...state.vitalDraft.values.nullValues, [action.field]: action.value } } } } : state;
    case "vitals-cancelled":
      return { ...state, vitalDraft: null };
    case "vitals-saved": {
      const draft = state.vitalDraft;
      if (!draft || !validateVitals(draft.time, draft.values).valid) return state;
      const event: EncounterEvent = { id: draft.id, time: draft.time, kind: "care", title: "Vital signs", detail: vitalSummary(draft.values), reference: "eVitals.VitalGroup", visitorEntered: true, vitals: draft.values };
      return { ...state, view: "timeline", vitalDraft: null, encounter: { ...state.encounter, events: newestFirst([...state.encounter.events.filter((candidate) => candidate.id !== draft.id), event]) } };
    }
    case "state-restored":
      return action.state;
    case "prototype-reset":
      return INITIAL_SHELL_STATE;
    default:
      return state;
  }
}
