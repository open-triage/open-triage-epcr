import { describeProcedure, PROCEDURES, validateProcedure, type ProcedureDraft, type ProcedureRecord } from "./procedure";
import { MEDICATIONS } from "./medication-catalog";
import { validateVitals, VITAL_RULES } from "./vital-validation";
import { adultChestPainDefinition } from "./adult-chest-pain-definition";
import { createBundledDefinitionProvider } from "./encounter-definition";
import type { EncounterDefinition, MedicationFieldId } from "./encounter-definition";

export type ShellView = "timeline" | "checklist" | "review" | "summary";

export type EncounterEvent = {
  readonly id: string;
  readonly date?: string;
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
export type VitalDraft = { readonly id: string; readonly date: string; readonly time: string; readonly values: VitalValues; readonly isNew: boolean };

export type Encounter = {
  readonly scenarioId: string;
  readonly synthetic: true;
  readonly currentTime: string;
  readonly crew: string;
  readonly patient: {
    readonly name: string;
    readonly age: number;
    readonly sex: string;
    readonly identifier: string;
    readonly medicalHistory: ReadonlyArray<string>;
    readonly currentMedications: ReadonlyArray<string>;
    readonly allergies: ReadonlyArray<string>;
  };
  readonly incident: { readonly number: string; readonly complaint: string; readonly address: string };
  readonly events: ReadonlyArray<EncounterEvent>;
};

export const encounterDefinitionProvider = createBundledDefinitionProvider([adultChestPainDefinition]);
export const syntheticEncounterDefinition = encounterDefinitionProvider.get("adult-chest-pain-v2");

// Fixed usability-test fixture. Everything here is fictional and loaded
// automatically; this module is never a destination for real patient data.
export const syntheticEncounter: Encounter = {
  scenarioId: syntheticEncounterDefinition.id,
  synthetic: true,
  currentTime: syntheticEncounterDefinition.dates.currentTime,
  crew: syntheticEncounterDefinition.dispatch.crew,
  patient: syntheticEncounterDefinition.patient.initial,
  incident: syntheticEncounterDefinition.dispatch.incident,
  events: syntheticEncounterDefinition.dispatch.events.map((event, index) => ({ ...event, kind: "transport", id: `baseline-${index + 1}` })),
};

export type NoteDraft = { readonly id: string; readonly date: string; readonly time: string; readonly summary: string; readonly isNew: boolean };
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
export type MedicationDraft = MedicationAdministration & { readonly id: string; readonly date: string; readonly time: string; readonly isNew: boolean };
export type MedicationField = keyof Pick<MedicationDraft, "date" | "time" | "medicationCode" | "codeType" | "label" | "dose" | "unit" | "route" | "response">;
export type ShellState = {
  readonly view: ShellView;
  readonly encounter: Encounter;
  readonly noteDraft: NoteDraft | null;
  readonly procedureDraft: ProcedureDraft | null;
  readonly vitalDraft: VitalDraft | null;
  readonly medicationDraft: MedicationDraft | null;
  readonly acknowledgedWarnings: ReadonlyArray<string>;
};
export type ShellAction =
  | { readonly type: "view-selected"; readonly view: ShellView }
  | { readonly type: "patient-updated"; readonly patient: Encounter["patient"] }
  | { readonly type: "note-started"; readonly id: string; readonly date?: string; readonly time: string }
  | { readonly type: "note-opened"; readonly id: string }
  | { readonly type: "note-draft-changed"; readonly field: "date" | "time" | "summary"; readonly value: string }
  | { readonly type: "note-cancelled" }
  | { readonly type: "note-saved" }
  | { readonly type: "review-opened" }
  | { readonly type: "review-finding-selected"; readonly id: string }
  | { readonly type: "review-warning-acknowledged"; readonly id: string; readonly acknowledged: boolean }
  | { readonly type: "review-finished" }
  | { readonly type: "summary-editing-continued" }
  | { readonly type: "procedure-started"; readonly id: string; readonly date?: string; readonly time: string }
  | { readonly type: "procedure-opened"; readonly id: string }
  | { readonly type: "procedure-selected"; readonly code: string }
  | { readonly type: "procedure-draft-changed"; readonly field: "date" | "time" | "attempts" | "success" | "outcome"; readonly value: string }
  | { readonly type: "procedure-complication-toggled"; readonly code: string }
  | { readonly type: "procedure-warning-acknowledged"; readonly acknowledged: boolean }
  | { readonly type: "procedure-cancelled" }
  | { readonly type: "procedure-saved" }
  | { readonly type: "medication-started"; readonly id: string; readonly date?: string; readonly time: string }
  | { readonly type: "medication-opened"; readonly id: string }
  | { readonly type: "medication-selected"; readonly code: string; readonly codeType: MedicationAdministration["codeType"]; readonly label: string }
  | { readonly type: "medication-draft-changed"; readonly field: Exclude<MedicationField, "codeType">; readonly value: string }
  | { readonly type: "medication-warning-acknowledged"; readonly acknowledged: boolean }
  | { readonly type: "medication-cancelled" }
  | { readonly type: "medication-saved" }
  | { readonly type: "vitals-started"; readonly id: string; readonly date?: string; readonly time: string }
  | { readonly type: "vitals-opened"; readonly id: string }
  | { readonly type: "vitals-time-changed"; readonly value: string }
  | { readonly type: "vitals-date-changed"; readonly value: string }
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
  acknowledgedWarnings: [],
};

export type MedicationValidationFinding = { readonly field: MedicationFieldId; readonly reference: string; readonly message: string };
export type MedicationValidation = {
  readonly errors: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly errorFindings: ReadonlyArray<MedicationValidationFinding>;
  readonly warningFindings: ReadonlyArray<MedicationValidationFinding>;
};

export function validateMedication(draft: MedicationDraft, definition: EncounterDefinition = syntheticEncounterDefinition): MedicationValidation {
  const medication = definition.events.medication;
  const field = (id: MedicationFieldId) => medication.fields.find((candidate) => candidate.id === id)!;
  const errorFindings: MedicationValidationFinding[] = [];
  const warningFindings: MedicationValidationFinding[] = [];
  const withReference = (message: string, reference: string) => `${message.replace(/[.\s]+$/, "")} (${reference}).`;
  const error = (id: MedicationFieldId, message: string) => errorFindings.push({ field: id, reference: field(id).reference, message: withReference(message, field(id).reference) });
  const warning = (id: MedicationFieldId, message: string) => warningFindings.push({ field: id, reference: field(id).reference, message: withReference(message, field(id).reference) });
  if ((field("time").required || draft.time) && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time)) error("time", medication.validationMessages.invalidTime);
  const catalogMedication = MEDICATIONS.find((item) => item.code === draft.medicationCode && item.codeType === draft.codeType && item.displayLabel === draft.label);
  if ((field("medication").required || draft.medicationCode) && !catalogMedication) error("medication", medication.validationMessages.invalidMedication);
  if ((field("dose").required || draft.dose) && (!draft.dose || !Number.isFinite(Number(draft.dose)) || Number(draft.dose) <= 0)) error("dose", medication.validationMessages.invalidDose);
  if ((field("unit").required || draft.unit) && !medication.doseUnits.includes(draft.unit)) error("unit", medication.validationMessages.invalidUnit);
  if ((field("route").required || draft.route) && !medication.routes.includes(draft.route)) error("route", medication.validationMessages.invalidRoute);
  if (!draft.response.trim() && field("response").warnWhenMissing) warning("response", medication.validationMessages.responseMissing);
  return { errors: errorFindings.map(({ message }) => message), warnings: warningFindings.map(({ message }) => message), errorFindings, warningFindings };
}

export type ReviewFinding = {
  readonly id: string;
  readonly severity: "error" | "warning";
  readonly category: string;
  readonly title: string;
  readonly reference: string;
  readonly message: string;
  readonly target: { readonly eventId: string; readonly vitalField?: VitalField };
  readonly acknowledged: boolean;
};

export function encounterEventPresentation(event: EncounterEvent, definition: EncounterDefinition = syntheticEncounterDefinition): Pick<EncounterEvent, "title" | "reference"> {
  if (event.kind === "note") return { title: definition.events.note.labels.timelineTitle, reference: definition.events.note.references.summary };
  if (event.medication) {
    const medication = definition.events.medication;
    return {
      title: `${event.medication.label || medication.labels.medicationMissing}${event.medication.dose ? ` ${event.medication.dose}` : ""}${event.medication.unit ? ` ${event.medication.unit}` : ""}`,
      reference: `${medication.fields.find((field) => field.id === "medication")!.reference} · ${event.medication.codeType} ${event.medication.medicationCode}`,
    };
  }
  return { title: event.title, reference: event.reference };
}

export function encounterEventDetail(event: EncounterEvent, definition: EncounterDefinition = syntheticEncounterDefinition): string {
  if (!event.medication) return event.detail;
  const medication = definition.events.medication;
  return `${event.medication.route || medication.labels.routeMissing}${event.medication.response ? ` · ${event.medication.response}` : ` · ${medication.labels.responseMissing}`}`;
}

export function validateNoteEvent(event: EncounterEvent, definition: EncounterDefinition = syntheticEncounterDefinition): ReadonlyArray<{ readonly reference: string; readonly message: string }> {
  if (event.kind !== "note") return [];
  const note = definition.events.note;
  const findings: Array<{ reference: string; message: string }> = [];
  if (note.required.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(event.time)) findings.push({ reference: note.references.time, message: note.validationMessages.invalidTime });
  if (note.required.summary && !event.detail.trim()) findings.push({ reference: note.references.summary, message: note.validationMessages.summaryRequired });
  return findings;
}

function eventFinding(
  state: ShellState,
  event: EncounterEvent,
  severity: ReviewFinding["severity"],
  category: ReviewFinding["category"],
  reference: string,
  message: string,
  index: number,
  recordAcknowledged = false,
  vitalField?: VitalField,
): ReviewFinding {
  const id = `${category.toLowerCase()}:${event.id}:${severity}:${index}:${message}`;
  return {
    id, severity, category, reference, message,
    title: `${event.time} · ${event.title}`,
    target: { eventId: event.id, ...(vitalField ? { vitalField } : {}) },
    acknowledged: severity === "warning" && (recordAcknowledged || state.acknowledgedWarnings.includes(id)),
  };
}

/** Consolidates validation for timeline entries before signing. */
export function reviewEncounter(state: ShellState, definition: EncounterDefinition = syntheticEncounterDefinition): ReadonlyArray<ReviewFinding> {
  const events = state.encounter.events.flatMap((event): ReadonlyArray<ReviewFinding> => {
    if (event.vitals) {
      const validation = validateVitals(event.time, event.vitals);
      const errors = Object.entries(validation.errors).map(([field, message], index) => {
        const vitalField = field === "time" || field === "group" ? undefined : field as VitalField;
        return eventFinding(state, event, "error", "Vital", vitalField ? VITAL_RULES[vitalField].reference : "eVitals.VitalGroup", message!, index, false, vitalField);
      });
      const warnings = Object.entries(validation.warnings).map(([field, message], index) =>
        eventFinding(state, event, "warning", "Vital", VITAL_RULES[field as VitalField].reference, message!, index, false, field as VitalField));
      return [...errors, ...warnings];
    }
    if (event.medication) {
      const validation = validateMedication({ id: event.id, date: event.date ?? "2026-04-18", time: event.time, ...event.medication, isNew: false }, definition);
      const presentation = encounterEventPresentation(event, definition);
      return [
        ...validation.errorFindings.map((finding, index) => eventFinding(state, { ...event, ...presentation, detail: encounterEventDetail(event, definition) }, "error", definition.events.medication.labels.category, finding.reference, finding.message, index)),
        ...validation.warningFindings.map((finding, index) => eventFinding(state, { ...event, ...presentation, detail: encounterEventDetail(event, definition) }, "warning", definition.events.medication.labels.category, finding.reference, finding.message, index, event.medication!.warningAcknowledged)),
      ];
    }
    if (event.procedure) {
      const validation = validateProcedure({
        id: event.id, date: event.date ?? "2026-04-18", time: event.time, procedureCode: event.procedure.code, procedureLabel: event.procedure.label,
        attempts: String(event.procedure.attempts), success: event.procedure.success, outcome: event.procedure.outcome,
        complications: event.procedure.complications, warningAcknowledged: event.procedure.warningAcknowledged, isNew: false,
      });
      return [
        ...validation.errors.map((message, index) => eventFinding(state, event, "error", "Procedure", "eProcedures", message, index)),
        ...validation.warnings.map((message, index) => eventFinding(state, event, "warning", "Procedure", "eProcedures", message, index, event.procedure!.warningAcknowledged)),
      ];
    }
    if (event.kind === "note") {
      const presentation = encounterEventPresentation(event, definition);
      return validateNoteEvent(event, definition).map((finding, index) => eventFinding(
        state, { ...event, ...presentation }, "error", definition.events.note.labels.category, finding.reference, finding.message, index,
      ));
    }
    return [];
  });

  return events;
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
    `${b.event.date ?? "2026-04-18"}T${b.event.time}`.localeCompare(`${a.event.date ?? "2026-04-18"}T${a.event.time}`) || a.index - b.index,
  ).map(({ event }) => event);
}

export function transitionShell(state: ShellState, action: ShellAction, definition: EncounterDefinition = syntheticEncounterDefinition): ShellState {
  switch (action.type) {
    case "view-selected":
      return { ...state, view: action.view };
    case "patient-updated":
      return { ...state, encounter: { ...state.encounter, patient: action.patient } };
    case "review-opened":
      return { ...state, view: "review", noteDraft: null, procedureDraft: null, medicationDraft: null, vitalDraft: null };
    case "review-finding-selected": {
      const finding = reviewEncounter(state, definition).find((candidate) => candidate.id === action.id);
      if (!finding) return state;
      const eventId = finding.target.eventId;
      const event = state.encounter.events.find((candidate) => candidate.id === eventId);
      if (!event) return state;
      const opened = event.vitals
        ? transitionShell(state, { type: "vitals-opened", id: event.id }, definition)
        : event.kind === "medication"
          ? transitionShell(state, { type: "medication-opened", id: event.id }, definition)
          : event.kind === "procedure"
            ? transitionShell(state, { type: "procedure-opened", id: event.id }, definition)
            : transitionShell(state, { type: "note-opened", id: event.id }, definition);
      return { ...opened, view: "timeline" };
    }
    case "review-warning-acknowledged":
      return {
        ...state,
        acknowledgedWarnings: action.acknowledged
          ? [...new Set([...state.acknowledgedWarnings, action.id])]
          : state.acknowledgedWarnings.filter((id) => id !== action.id),
      };
    case "review-finished": {
      const findings = reviewEncounter(state, definition);
      return findings.some((finding) => finding.severity === "error" || !finding.acknowledged)
        ? state
        : { ...state, view: "summary" };
    }
    case "summary-editing-continued":
      return { ...state, view: "timeline" };
    case "note-started":
      return { ...state, noteDraft: { id: action.id, date: action.date ?? "2026-04-18", time: action.time, summary: "", isNew: true } };
    case "note-opened": {
      const event = state.encounter.events.find((candidate) => candidate.id === action.id && candidate.kind === "note");
      return event ? { ...state, noteDraft: { id: event.id, date: event.date ?? "2026-04-18", time: event.time, summary: event.detail, isNew: false } } : state;
    }
    case "note-draft-changed":
      return state.noteDraft ? { ...state, noteDraft: { ...state.noteDraft, [action.field]: action.value } } : state;
    case "note-cancelled":
      return { ...state, noteDraft: null };
    case "note-saved": {
      const draft = state.noteDraft;
      if (!draft) return state;
      const note: EncounterEvent = {
        id: draft.id,
        date: draft.date,
        time: draft.time.slice(0, 5),
        kind: "note",
        title: definition.events.note.labels.timelineTitle,
        detail: draft.summary.trim(),
        reference: definition.events.note.references.summary,
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
          date: action.date ?? "2026-04-18",
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
          date: event.date ?? "2026-04-18",
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
      if (!draft) return state;
      const procedure: ProcedureRecord = {
        code: draft.procedureCode,
        label: draft.procedureLabel || "Procedure not selected",
        attempts: Number(draft.attempts) || 0,
        success: draft.success as ProcedureRecord["success"],
        outcome: draft.outcome as ProcedureRecord["outcome"],
        complications: draft.complications,
        warningAcknowledged: draft.warningAcknowledged,
      };
      const event: EncounterEvent = {
        id: draft.id,
        date: draft.date,
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
        medicationDraft: { id: action.id, date: action.date ?? "2026-04-18", time: action.time, medicationCode: "", codeType: "RxNorm", label: "", dose: "", unit: "", route: "", response: "", warningAcknowledged: false, isNew: true },
      };
    case "medication-opened": {
      const event = state.encounter.events.find((candidate) => candidate.id === action.id && candidate.kind === "medication" && candidate.medication);
      return event?.medication ? { ...state, medicationDraft: { id: event.id, date: event.date ?? "2026-04-18", time: event.time, ...event.medication, isNew: false } } : state;
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
      const administration: MedicationAdministration = {
        medicationCode: draft.medicationCode,
        codeType: draft.codeType,
        label: draft.label || definition.events.medication.labels.medicationMissing,
        dose: draft.dose.trim(),
        unit: draft.unit,
        route: draft.route,
        response: draft.response.trim(),
        warningAcknowledged: draft.warningAcknowledged,
      };
      const medicationEvent: EncounterEvent = {
        id: draft.id,
        date: draft.date,
        time: draft.time,
        kind: "medication",
        title: "",
        detail: "",
        reference: "",
        visitorEntered: true,
        medication: administration,
      };
      const presentedMedicationEvent = { ...medicationEvent, ...encounterEventPresentation(medicationEvent, definition), detail: encounterEventDetail(medicationEvent, definition) };
      const withoutCurrent = state.encounter.events.filter((event) => event.id !== draft.id);
      return { ...state, view: "timeline", medicationDraft: null, encounter: { ...state.encounter, events: newestFirst([...withoutCurrent, presentedMedicationEvent]) } };
    }
    case "vitals-started":
      return { ...state, vitalDraft: { id: action.id, date: action.date ?? "2026-04-18", time: action.time, values: { ...EMPTY_VITALS, nullValues: {} }, isNew: true } };
    case "vitals-opened": {
      const event = state.encounter.events.find((candidate) => candidate.id === action.id && candidate.vitals);
      return event?.vitals ? { ...state, vitalDraft: { id: event.id, date: event.date ?? "2026-04-18", time: event.time, values: event.vitals, isNew: false } } : state;
    }
    case "vitals-time-changed":
      return state.vitalDraft ? { ...state, vitalDraft: { ...state.vitalDraft, time: action.value } } : state;
    case "vitals-date-changed":
      return state.vitalDraft ? { ...state, vitalDraft: { ...state.vitalDraft, date: action.value } } : state;
    case "vitals-value-changed":
      return state.vitalDraft ? { ...state, vitalDraft: { ...state.vitalDraft, values: { ...state.vitalDraft.values, [action.field]: action.value, nullValues: { ...state.vitalDraft.values.nullValues, [action.field]: "" } } } } : state;
    case "vitals-null-changed":
      return state.vitalDraft ? { ...state, vitalDraft: { ...state.vitalDraft, values: { ...state.vitalDraft.values, [action.field]: "", nullValues: { ...state.vitalDraft.values.nullValues, [action.field]: action.value } } } } : state;
    case "vitals-cancelled":
      return { ...state, vitalDraft: null };
    case "vitals-saved": {
      const draft = state.vitalDraft;
      if (!draft) return state;
      const event: EncounterEvent = { id: draft.id, date: draft.date, time: draft.time, kind: "care", title: "Vital signs", detail: vitalSummary(draft.values), reference: "eVitals.VitalGroup", visitorEntered: true, vitals: draft.values };
      return { ...state, view: "timeline", vitalDraft: null, encounter: { ...state.encounter, events: newestFirst([...state.encounter.events.filter((candidate) => candidate.id !== draft.id), event]) } };
    }
    case "state-restored":
      return { ...action.state, noteDraft: action.state.noteDraft ?? null, procedureDraft: action.state.procedureDraft ?? null, medicationDraft: action.state.medicationDraft ?? null, vitalDraft: action.state.vitalDraft ?? null, acknowledgedWarnings: action.state.acknowledgedWarnings ?? [] };
    case "prototype-reset":
      return INITIAL_SHELL_STATE;
    default:
      return state;
  }
}

export function syntheticEncounterReducer(state: ShellState, action: ShellAction): ShellState {
  return transitionShell(state, action, syntheticEncounterDefinition);
}
