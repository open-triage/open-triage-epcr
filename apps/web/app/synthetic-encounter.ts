import { describeProcedure, PROCEDURES, validateProcedure, type ProcedureDraft, type ProcedureRecord } from "./procedure";
import { MEDICATION_DOSE_UNITS, MEDICATION_ROUTES, MEDICATIONS } from "./medication-catalog";
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
  readonly kind: "care" | "transport" | "alert" | "note" | "procedure" | "medication";
  readonly title: string;
  readonly detail: string;
  readonly reference: string;
  readonly visitorEntered?: true;
  readonly procedure?: ProcedureRecord;
  readonly medication?: MedicationAdministration;
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
export type MedicationAdministration = {
  readonly medicationCode: string;
  readonly codeType: "RxNorm" | "SNOMED-CT";
  readonly label: string;
  readonly dose: string;
  readonly unit: string;
  readonly route: string;
  readonly response: string;
  readonly warningAcknowledged: boolean;
};
export type MedicationDraft = MedicationAdministration & { readonly id: string; readonly time: string; readonly isNew: boolean };
export type MedicationField = keyof Pick<MedicationDraft, "time" | "medicationCode" | "codeType" | "label" | "dose" | "unit" | "route" | "response">;
export type ShellState = {
  readonly view: ShellView;
  readonly encounter: Encounter;
  readonly noteDraft: NoteDraft | null;
  readonly procedureDraft: ProcedureDraft | null;
  readonly vitalDraft: VitalDraft | null;
  readonly medicationDraft: MedicationDraft | null;
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
  | { readonly type: "procedure-started"; readonly id: string; readonly time: string }
  | { readonly type: "procedure-opened"; readonly id: string }
  | { readonly type: "procedure-selected"; readonly code: string }
  | { readonly type: "procedure-draft-changed"; readonly field: "time" | "attempts" | "success" | "outcome"; readonly value: string }
  | { readonly type: "procedure-complication-toggled"; readonly code: string }
  | { readonly type: "procedure-warning-acknowledged"; readonly acknowledged: boolean }
  | { readonly type: "procedure-cancelled" }
  | { readonly type: "procedure-saved" }
  | { readonly type: "medication-started"; readonly id: string; readonly time: string }
  | { readonly type: "medication-opened"; readonly id: string }
  | { readonly type: "medication-selected"; readonly code: string; readonly codeType: MedicationAdministration["codeType"]; readonly label: string }
  | { readonly type: "medication-draft-changed"; readonly field: Exclude<MedicationField, "codeType">; readonly value: string }
  | { readonly type: "medication-warning-acknowledged"; readonly acknowledged: boolean }
  | { readonly type: "medication-cancelled" }
  | { readonly type: "medication-saved" }
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
  procedureDraft: null,
  vitalDraft: null,
  medicationDraft: null,
  checklistValues: INITIAL_CHECKLIST_VALUES,
  focusedChecklistField: null,
};

export type MedicationValidation = { readonly errors: ReadonlyArray<string>; readonly warnings: ReadonlyArray<string> };

export function validateMedication(draft: MedicationDraft): MedicationValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time)) errors.push("Enter a valid 24-hour time (eMedications.01).");
  const catalogMedication = MEDICATIONS.find((item) => item.code === draft.medicationCode && item.codeType === draft.codeType && item.displayLabel === draft.label);
  if (!catalogMedication) errors.push("Select a medication from the NEMSIS recommended list (eMedications.03).");
  if (!draft.dose || !Number.isFinite(Number(draft.dose)) || Number(draft.dose) <= 0) errors.push("Dose must be a number greater than zero (eMedications.05).");
  if (!(MEDICATION_DOSE_UNITS as readonly string[]).includes(draft.unit)) errors.push("Select a valid configured dose unit (eMedications.06).");
  if (!(MEDICATION_ROUTES as readonly string[]).includes(draft.route)) errors.push("Select a valid configured administration route (eMedications.04).");
  if (!draft.response.trim()) warnings.push("Medication response is not documented (eMedications.07). You can acknowledge this warning and add it later.");
  return { errors, warnings };
}

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
    case "procedure-started":
      return {
        ...state,
        procedureDraft: {
          id: action.id,
          time: action.time,
          procedureCode: "",
          procedureLabel: "",
          attempts: "1",
          success: "",
          outcome: "",
          complications: [],
          warningAcknowledged: false,
          isNew: true,
        },
      };
    case "procedure-opened": {
      const event = state.encounter.events.find((candidate) => candidate.id === action.id && candidate.kind === "procedure");
      if (!event?.procedure) return state;
      return {
        ...state,
        procedureDraft: {
          id: event.id,
          time: event.time,
          procedureCode: event.procedure.code,
          procedureLabel: event.procedure.label,
          attempts: String(event.procedure.attempts),
          success: event.procedure.success,
          outcome: event.procedure.outcome,
          complications: event.procedure.complications,
          warningAcknowledged: event.procedure.warningAcknowledged,
          isNew: false,
        },
      };
    }
    case "procedure-selected": {
      const selected = PROCEDURES.find((procedure) => procedure.code === action.code);
      return state.procedureDraft && (selected || action.code === "") ? {
        ...state,
        procedureDraft: {
          ...state.procedureDraft,
          procedureCode: selected?.code ?? "",
          procedureLabel: selected?.label ?? "",
        },
      } : state;
    }
    case "procedure-draft-changed":
      return state.procedureDraft ? {
        ...state,
        procedureDraft: { ...state.procedureDraft, [action.field]: action.value, warningAcknowledged: false } as ProcedureDraft,
      } : state;
    case "procedure-complication-toggled": {
      if (!state.procedureDraft) return state;
      const selected = state.procedureDraft.complications.includes(action.code);
      return {
        ...state,
        procedureDraft: {
          ...state.procedureDraft,
          complications: selected
            ? state.procedureDraft.complications.filter((code) => code !== action.code)
            : [...state.procedureDraft.complications, action.code],
          warningAcknowledged: false,
        },
      };
    }
    case "procedure-warning-acknowledged":
      return state.procedureDraft ? {
        ...state,
        procedureDraft: { ...state.procedureDraft, warningAcknowledged: action.acknowledged },
      } : state;
    case "procedure-cancelled":
      return { ...state, procedureDraft: null };
    case "procedure-saved": {
      const draft = state.procedureDraft;
      if (!draft || validateProcedure(draft).errors.length) return state;
      const procedure: ProcedureRecord = {
        code: draft.procedureCode,
        label: draft.procedureLabel,
        attempts: Number(draft.attempts),
        success: draft.success as ProcedureRecord["success"],
        outcome: draft.outcome as ProcedureRecord["outcome"],
        complications: draft.complications,
        warningAcknowledged: draft.warningAcknowledged,
      };
      const event: EncounterEvent = {
        id: draft.id,
        time: draft.time,
        kind: "procedure",
        title: procedure.label,
        detail: describeProcedure(procedure),
        reference: `eProcedures.03 · SNOMED CT ${procedure.code}`,
        visitorEntered: true,
        procedure,
      };
      const withoutCurrent = state.encounter.events.filter((candidate) => candidate.id !== draft.id);
      return {
        ...state,
        view: "timeline",
        procedureDraft: null,
        encounter: { ...state.encounter, events: newestFirst([...withoutCurrent, event]) },
      };
    }
    case "medication-started":
      return {
        ...state,
        medicationDraft: { id: action.id, time: action.time, medicationCode: "", codeType: "RxNorm", label: "", dose: "", unit: "", route: "", response: "", warningAcknowledged: false, isNew: true },
      };
    case "medication-opened": {
      const event = state.encounter.events.find((candidate) => candidate.id === action.id && candidate.kind === "medication" && candidate.medication);
      return event?.medication ? { ...state, medicationDraft: { id: event.id, time: event.time, ...event.medication, isNew: false } } : state;
    }
    case "medication-selected":
      return state.medicationDraft ? { ...state, medicationDraft: { ...state.medicationDraft, medicationCode: action.code, codeType: action.codeType, label: action.label } } : state;
    case "medication-draft-changed":
      return state.medicationDraft ? { ...state, medicationDraft: { ...state.medicationDraft, [action.field]: action.value, warningAcknowledged: action.field === "response" ? false : state.medicationDraft.warningAcknowledged } } : state;
    case "medication-warning-acknowledged":
      return state.medicationDraft ? { ...state, medicationDraft: { ...state.medicationDraft, warningAcknowledged: action.acknowledged } } : state;
    case "medication-cancelled":
      return { ...state, medicationDraft: null };
    case "medication-saved": {
      const draft = state.medicationDraft;
      if (!draft) return state;
      const validation = validateMedication(draft);
      if (validation.errors.length || (validation.warnings.length && !draft.warningAcknowledged)) return state;
      const administration: MedicationAdministration = {
        medicationCode: draft.medicationCode,
        codeType: draft.codeType,
        label: draft.label,
        dose: draft.dose.trim(),
        unit: draft.unit,
        route: draft.route,
        response: draft.response.trim(),
        warningAcknowledged: draft.warningAcknowledged,
      };
      const medicationEvent: EncounterEvent = {
        id: draft.id,
        time: draft.time,
        kind: "medication",
        title: `${draft.label} ${administration.dose} ${administration.unit}`,
        detail: `${administration.route}${administration.response ? ` · ${administration.response}` : " · Response not documented"}`,
        reference: `eMedications.03 · ${administration.codeType} ${administration.medicationCode}`,
        visitorEntered: true,
        medication: administration,
      };
      const withoutCurrent = state.encounter.events.filter((event) => event.id !== draft.id);
      return { ...state, view: "timeline", medicationDraft: null, encounter: { ...state.encounter, events: newestFirst([...withoutCurrent, medicationEvent]) } };
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
      return { ...action.state, noteDraft: action.state.noteDraft ?? null, procedureDraft: action.state.procedureDraft ?? null, medicationDraft: action.state.medicationDraft ?? null, vitalDraft: action.state.vitalDraft ?? null };
    case "prototype-reset":
      return INITIAL_SHELL_STATE;
    default:
      return state;
  }
}
