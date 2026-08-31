import { describeProcedure, PROCEDURES, validateProcedure, type ProcedureDraft, type ProcedureRecord } from "./procedure";

export type ShellView = "timeline" | "checklist";

export type EncounterEvent = {
  readonly id: string;
  readonly time: string;
  readonly kind: "care" | "transport" | "alert" | "note" | "procedure";
  readonly title: string;
  readonly detail: string;
  readonly reference: string;
  readonly visitorEntered?: true;
  readonly procedure?: ProcedureRecord;
};

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
  readonly procedureDraft: ProcedureDraft | null;
};
export type ShellAction =
  | { readonly type: "view-selected"; readonly view: ShellView }
  | { readonly type: "note-started"; readonly id: string; readonly time: string }
  | { readonly type: "note-opened"; readonly id: string }
  | { readonly type: "note-draft-changed"; readonly field: "time" | "summary"; readonly value: string }
  | { readonly type: "note-cancelled" }
  | { readonly type: "note-saved" }
  | { readonly type: "procedure-started"; readonly id: string; readonly time: string }
  | { readonly type: "procedure-opened"; readonly id: string }
  | { readonly type: "procedure-selected"; readonly code: string }
  | { readonly type: "procedure-draft-changed"; readonly field: "time" | "attempts" | "success" | "outcome"; readonly value: string }
  | { readonly type: "procedure-complication-toggled"; readonly code: string }
  | { readonly type: "procedure-warning-acknowledged"; readonly acknowledged: boolean }
  | { readonly type: "procedure-cancelled" }
  | { readonly type: "procedure-saved" }
  | { readonly type: "state-restored"; readonly state: ShellState }
  | { readonly type: "prototype-reset" };

export const INITIAL_SHELL_STATE: ShellState = { view: "timeline", encounter: syntheticEncounter, noteDraft: null, procedureDraft: null };

function newestFirst(events: ReadonlyArray<EncounterEvent>): ReadonlyArray<EncounterEvent> {
  return events.map((event, index) => ({ event, index })).sort((a, b) =>
    b.event.time.localeCompare(a.event.time) || a.index - b.index,
  ).map(({ event }) => event);
}

export function transitionShell(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case "view-selected":
      return { ...state, view: action.view };
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
    case "state-restored":
      return action.state;
    case "prototype-reset":
      return INITIAL_SHELL_STATE;
    default:
      return state;
  }
}
