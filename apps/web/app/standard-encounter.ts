import { describeProcedure, PROCEDURES, validateProcedure, type ProcedureDraft, type ProcedureRecord } from "./procedure";
import { MEDICATIONS } from "./medication-catalog";
import { validateVitals } from "./vital-validation";
import { standardEncounterDefinition } from "./encounter-form-profile";
import { createBundledDefinitionProvider } from "./encounter-definition";
import type { ConfiguredEventType, EncounterDefinition, MedicationFieldId, VitalField as ConfiguredVitalField, VitalNullValue } from "./encounter-definition";
import type { CustomDataSet } from "./custom-data-elements";
import type { EncounterDocument } from "@open-triage/contracts";
import syntheticEncounterDocument from "./data/synthetic-encounter-document.json";
import { loadEncounterDocument } from "./encounter-document";

export type ShellView = "timeline" | "checklist" | "review";

export type EncounterEvent = {
  readonly id: string;
  readonly date?: string;
  readonly time: string;
  /** Original offset-aware lexical timestamp when projected from the canonical document. */
  readonly dateTime?: string;
  readonly kind: "care" | "transport" | "alert" | "note" | "procedure" | "medication" | "document";
  readonly title: string;
  readonly detail: string;
  readonly reference: string;
  readonly visitorEntered?: true;
  readonly procedure?: ProcedureRecord;
  readonly medication?: MedicationAdministration;
  readonly vitals?: VitalValues;
};

export type VitalField = ConfiguredVitalField;
export type NullValue = "" | VitalNullValue;
export type VitalValues = Record<VitalField, string> & { readonly nullValues: Partial<Record<VitalField, NullValue>> };
export type VitalDraft = { readonly id: string; readonly date: string; readonly time: string; readonly values: VitalValues; readonly isNew: boolean };

export type Encounter = {
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly synthetic: true;
  readonly document: EncounterDocument;
  readonly events: ReadonlyArray<EncounterEvent>;
  /** Namespaced NEMSIS custom results. Unknown compatible entries are deliberately retained by persistence. */
  readonly customData?: CustomDataSet;
};

export const encounterDefinitionProvider = createBundledDefinitionProvider([standardEncounterDefinition]);
export const bundledEncounterDefinition = encounterDefinitionProvider.get("standard-encounter-v1");

// Fixed usability-test fixture. Everything here is fictional and loaded
// automatically; this module is never a destination for real patient data.
export function createSyntheticEncounter(definition: EncounterDefinition): Encounter {
  const document = loadEncounterDocument({
    ...structuredClone(syntheticEncounterDocument),
    formProfile: { id: definition.id, version: String(definition.version) },
  }, { formProfiles: { [definition.id]: [String(definition.version)] } });
  return {
    definitionId: definition.id,
    definitionVersion: definition.version,
    synthetic: true,
    document,
    events: [],
  };
}

export const syntheticEncounter: Encounter = createSyntheticEncounter(bundledEncounterDefinition);

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
  | { readonly type: "document-opened"; readonly document: EncounterDocument }
  | { readonly type: "patient-updated"; readonly document: EncounterDocument }
  | { readonly type: "note-started"; readonly id: string; readonly date?: string; readonly time: string }
  | { readonly type: "note-opened"; readonly id: string }
  | { readonly type: "note-draft-changed"; readonly field: "date" | "time" | "summary"; readonly value: string }
  | { readonly type: "note-cancelled" }
  | { readonly type: "note-removed" }
  | { readonly type: "note-saved" }
  | { readonly type: "review-opened" }
  | { readonly type: "review-finding-selected"; readonly id: string }
  | { readonly type: "review-warning-acknowledged"; readonly id: string; readonly acknowledged: boolean }
  | { readonly type: "procedure-started"; readonly id: string; readonly date?: string; readonly time: string }
  | { readonly type: "procedure-opened"; readonly id: string }
  | { readonly type: "procedure-selected"; readonly code: string }
  | { readonly type: "procedure-draft-changed"; readonly field: "date" | "time" | "attempts" | "success" | "outcome"; readonly value: string }
  | { readonly type: "procedure-complication-toggled"; readonly code: string }
  | { readonly type: "procedure-warning-acknowledged"; readonly acknowledged: boolean }
  | { readonly type: "procedure-cancelled" }
  | { readonly type: "procedure-removed" }
  | { readonly type: "procedure-saved" }
  | { readonly type: "medication-started"; readonly id: string; readonly date?: string; readonly time: string }
  | { readonly type: "medication-opened"; readonly id: string }
  | { readonly type: "medication-selected"; readonly code: string; readonly codeType: MedicationAdministration["codeType"]; readonly label: string }
  | { readonly type: "medication-draft-changed"; readonly field: Exclude<MedicationField, "codeType">; readonly value: string }
  | { readonly type: "medication-warning-acknowledged"; readonly acknowledged: boolean }
  | { readonly type: "medication-cancelled" }
  | { readonly type: "medication-removed" }
  | { readonly type: "medication-saved" }
  | { readonly type: "vitals-started"; readonly id: string; readonly date?: string; readonly time: string }
  | { readonly type: "vitals-opened"; readonly id: string }
  | { readonly type: "vitals-time-changed"; readonly value: string }
  | { readonly type: "vitals-date-changed"; readonly value: string }
  | { readonly type: "vitals-value-changed"; readonly field: VitalField; readonly value: string }
  | { readonly type: "vitals-null-changed"; readonly field: VitalField; readonly value: NullValue }
  | { readonly type: "vitals-cancelled" }
  | { readonly type: "vitals-removed" }
  | { readonly type: "vitals-saved" }
  | { readonly type: "state-restored"; readonly state: ShellState };

export const EMPTY_VITALS: VitalValues = { systolic: "", diastolic: "", heartRate: "", spo2: "", respiratoryRate: "", gcs: "", pain: "", nullValues: {} };
export function createInitialShellState(definition: EncounterDefinition): ShellState {
  return {
    view: "timeline",
    encounter: createSyntheticEncounter(definition),
    noteDraft: null,
    procedureDraft: null,
    vitalDraft: null,
    medicationDraft: null,
    acknowledgedWarnings: [],
  };
}

export const INITIAL_SHELL_STATE: ShellState = { ...createInitialShellState(bundledEncounterDefinition), encounter: syntheticEncounter };

export type MedicationValidationFinding = { readonly field: MedicationFieldId; readonly reference: string; readonly message: string };
export type MedicationValidation = {
  readonly errors: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly errorFindings: ReadonlyArray<MedicationValidationFinding>;
  readonly warningFindings: ReadonlyArray<MedicationValidationFinding>;
};

export function validateMedication(draft: MedicationDraft, definition: EncounterDefinition = bundledEncounterDefinition): MedicationValidation {
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
  readonly eventType: ConfiguredEventType;
  readonly category: string;
  readonly title: string;
  readonly reference: string;
  readonly message: string;
  readonly target: {
    readonly eventId: string;
    /** Canonical location used by review navigation and audit output. */
    readonly groupId: string;
    readonly instanceId: string;
    readonly elementId: string;
    readonly vitalField?: VitalField;
  };
  readonly acknowledged: boolean;
};

export const MISSING_VITALS_FINDING_ID = "vital:missing-set:warning";

export function encounterEventPresentation(event: EncounterEvent, definition: EncounterDefinition = bundledEncounterDefinition): Pick<EncounterEvent, "title" | "reference"> {
  if (event.kind === "note") return { title: definition.events.note.labels.timelineTitle, reference: definition.events.note.references.summary };
  if (event.kind === "procedure" && event.procedure) return {
    title: event.procedure.label,
    reference: `${definition.events.procedure.references.procedure} · ${definition.events.procedure.terminology.codeSystem} ${event.procedure.code}`,
  };
  if (event.medication) {
    const medication = definition.events.medication;
    return {
      title: `${event.medication.label || medication.labels.medicationMissing}${event.medication.dose ? ` ${event.medication.dose}` : ""}${event.medication.unit ? ` ${event.medication.unit}` : ""}`,
      reference: `${medication.fields.find((field) => field.id === "medication")!.reference} · ${event.medication.codeType} ${event.medication.medicationCode}`,
    };
  }
  if (event.vitals) return { title: definition.events.vitals.labels.timelineTitle, reference: definition.events.vitals.references.group };
  return { title: event.title, reference: event.reference };
}

export function encounterEventDetail(event: EncounterEvent, definition: EncounterDefinition = bundledEncounterDefinition): string {
  if (event.procedure) return describeProcedure(event.procedure, definition.events.procedure);
  if (event.medication) {
    const medication = definition.events.medication;
    return `${event.medication.route || medication.labels.routeMissing}${event.medication.response ? ` · ${event.medication.response}` : ` · ${medication.labels.responseMissing}`}`;
  }
  return event.vitals ? vitalSummary(event.vitals, definition) : event.detail;
}

export function validateNoteEvent(event: EncounterEvent, definition: EncounterDefinition = bundledEncounterDefinition): ReadonlyArray<{ readonly reference: string; readonly message: string }> {
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
  eventType: ConfiguredEventType,
  severity: ReviewFinding["severity"],
  category: ReviewFinding["category"],
  reference: string,
  message: string,
  index: number,
  recordAcknowledged = false,
  vitalField?: VitalField,
): ReviewFinding {
  const id = `${category.toLowerCase()}:${event.id}:${severity}:${index}:${message}`;
  const canonicalTarget = eventType === "vitals"
    ? { groupId: definitionGroup("vitals"), instanceId: event.id, elementId: reference }
    : eventType === "medication"
      ? { groupId: definitionGroup("medication"), instanceId: event.id, elementId: reference }
      : eventType === "procedure"
        ? { groupId: definitionGroup("procedure"), instanceId: event.id, elementId: reference }
        : { groupId: definitionGroup("note"), instanceId: event.id, elementId: reference };
  return {
    id, severity, eventType, category, reference, message,
    title: `${event.time} · ${event.title}`,
    target: { eventId: event.id, ...canonicalTarget, ...(vitalField ? { vitalField } : {}) },
    acknowledged: severity === "warning" && (recordAcknowledged || state.acknowledgedWarnings.includes(id)),
  };
}

function definitionGroup(eventType: ConfiguredEventType): string {
  if (eventType === "vitals") return "eVitals.VitalGroup";
  if (eventType === "medication") return "eMedications.MedicationGroup";
  if (eventType === "procedure") return "eProcedures.ProcedureGroup";
  return "eNarrativeSection";
}

/** Consolidates validation for timeline entries before signing. */
export function reviewEncounter(state: ShellState, definition: EncounterDefinition = bundledEncounterDefinition): ReadonlyArray<ReviewFinding> {
  const events = state.encounter.events.flatMap((event): ReadonlyArray<ReviewFinding> => {
    if (event.vitals) {
      const vitalDefinition = definition.events.vitals;
      const validation = validateVitals(event.time, event.vitals, definition);
      const presentedEvent = { ...event, ...encounterEventPresentation(event, definition), detail: encounterEventDetail(event, definition) };
      const errors = Object.entries(validation.errors).map(([field, message], index) => {
        const vitalField = field === "time" || field === "group" ? undefined : field as VitalField;
        const reference = vitalField ? vitalDefinition.fields.find(({ id }) => id === vitalField)?.reference : field === "time" ? vitalDefinition.references.time : vitalDefinition.references.group;
        return eventFinding(state, presentedEvent, "vitals", "error", vitalDefinition.labels.category, reference ?? vitalDefinition.references.group, message!, index, false, vitalField);
      });
      const warnings = Object.entries(validation.warnings).map(([field, message], index) =>
        eventFinding(state, presentedEvent, "vitals", "warning", vitalDefinition.labels.category, vitalDefinition.fields.find(({ id }) => id === field)?.reference ?? vitalDefinition.references.group, message!, index, false, field as VitalField));
      return [...errors, ...warnings];
    }
    if (event.medication) {
      const validation = validateMedication({ id: event.id, date: event.date ?? "2026-04-18", time: event.time, ...event.medication, isNew: false }, definition);
      const presentation = encounterEventPresentation(event, definition);
      return [
        ...validation.errorFindings.map((finding, index) => eventFinding(state, { ...event, ...presentation, detail: encounterEventDetail(event, definition) }, "medication", "error", definition.events.medication.labels.category, finding.reference, finding.message, index)),
        ...validation.warningFindings.map((finding, index) => eventFinding(state, { ...event, ...presentation, detail: encounterEventDetail(event, definition) }, "medication", "warning", definition.events.medication.labels.category, finding.reference, finding.message, index, event.medication!.warningAcknowledged)),
      ];
    }
    if (event.procedure) {
      const procedureDefinition = definition.events.procedure;
      const validation = validateProcedure({
        id: event.id, date: event.date ?? "2026-04-18", time: event.time, procedureCode: event.procedure.code, procedureLabel: event.procedure.label,
        attempts: String(event.procedure.attempts), success: event.procedure.success, outcome: event.procedure.outcome,
        complications: event.procedure.complications, warningAcknowledged: event.procedure.warningAcknowledged, isNew: false,
      }, procedureDefinition);
      const presentation = encounterEventPresentation(event, definition);
      const referenceFor = (message: string) => Object.values(procedureDefinition.references).find((reference) => message.startsWith(reference)) ?? procedureDefinition.references.complications;
      return [
        ...validation.errors.map((message, index) => eventFinding(state, { ...event, ...presentation }, "procedure", "error", procedureDefinition.labels.category, referenceFor(message), message, index)),
        ...validation.warnings.map((message, index) => eventFinding(state, { ...event, ...presentation }, "procedure", "warning", procedureDefinition.labels.category, procedureDefinition.references.complications, message, index, event.procedure!.warningAcknowledged)),
      ];
    }
    if (event.kind === "note") {
      const presentation = encounterEventPresentation(event, definition);
      return validateNoteEvent(event, definition).map((finding, index) => eventFinding(
        state, { ...event, ...presentation }, "note", "error", definition.events.note.labels.category, finding.reference, finding.message, index,
      ));
    }
    return [];
  });

  const missingVitals: ReadonlyArray<ReviewFinding> = state.encounter.events.some((event) => event.vitals)
    ? []
    : [{
        id: MISSING_VITALS_FINDING_ID,
        severity: "warning",
        eventType: "vitals",
        category: definition.events.vitals.labels.category,
        reference: definition.events.vitals.references.group,
        message: "At least one set of vital signs should be documented.",
        title: "No vital signs documented",
        target: {
          eventId: MISSING_VITALS_FINDING_ID,
          groupId: definition.events.vitals.references.group,
          instanceId: MISSING_VITALS_FINDING_ID,
          elementId: definition.events.vitals.references.group,
        },
        acknowledged: state.acknowledgedWarnings.includes(MISSING_VITALS_FINDING_ID),
      }];
  const findings = [...events, ...missingVitals];
  const typeOrder = new Map(definition.composition.review.eventTypeOrder.map((type, index) => [type, index]));
  return findings.map((finding, index) => ({ finding, index })).sort((a, b) =>
    (typeOrder.get(a.finding.eventType) ?? Number.MAX_SAFE_INTEGER) - (typeOrder.get(b.finding.eventType) ?? Number.MAX_SAFE_INTEGER) || a.index - b.index,
  ).map(({ finding }) => finding);
}

export function configuredEventType(event: EncounterEvent): ConfiguredEventType | null {
  if (event.vitals) return "vitals";
  if (event.medication) return "medication";
  if (event.procedure) return "procedure";
  if (event.kind === "note") return "note";
  return null;
}

/** Orders configurable clinical event types for the completed summary, preserving order within each type. */
export function completedSummaryEvents(events: ReadonlyArray<EncounterEvent>, definition: EncounterDefinition = bundledEncounterDefinition): ReadonlyArray<EncounterEvent> {
  const typeOrder = new Map(definition.composition.summary.eventTypeOrder.map((type, index) => [type, index]));
  return events.map((event, index) => ({ event, index })).sort((a, b) => {
    const aType = configuredEventType(a.event);
    const bType = configuredEventType(b.event);
    const aOrder = aType ? typeOrder.get(aType) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    const bOrder = bType ? typeOrder.get(bType) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder || a.index - b.index;
  }).map(({ event }) => event);
}

export function vitalSummary(values: VitalValues, definition: EncounterDefinition = bundledEncounterDefinition): string {
  const config = definition.events.vitals;
  return config.summary.map((item) => {
    const hasDocumentedField = item.fields.some((field) => values[field] || values.nullValues?.[field]);
    if (!hasDocumentedField) return null;
    const rendered = item.fields.map((field) => values[field] || (values.nullValues?.[field] ? config.labels.absentSummary : "—"));
    return `${item.label} ${rendered.join(item.separator)}${item.unit}`;
  }).filter(Boolean).join(" · ");
}

function newestFirst(events: ReadonlyArray<EncounterEvent>): ReadonlyArray<EncounterEvent> {
  return events.map((event, index) => ({ event, index })).sort((a, b) =>
    `${b.event.date ?? "2026-04-18"}T${b.event.time}`.localeCompare(`${a.event.date ?? "2026-04-18"}T${a.event.time}`) || a.index - b.index,
  ).map(({ event }) => event);
}

export function transitionShell(state: ShellState, action: ShellAction, definition: EncounterDefinition = bundledEncounterDefinition): ShellState {
  switch (action.type) {
    case "document-opened":
      return { ...state, encounter: { ...state.encounter, document: action.document, events: [] } };
    case "view-selected":
      return { ...state, view: action.view };
    case "patient-updated":
      return { ...state, encounter: { ...state.encounter, document: action.document } };
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
    case "note-removed":
      return state.noteDraft ? { ...state, noteDraft: null, encounter: { ...state.encounter, events: state.encounter.events.filter((event) => event.id !== state.noteDraft!.id) } } : state;
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
          attempts: String(definition.events.procedure.attempts.defaultValue),
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
      const selected = definition.events.procedure.terminology.catalog === "eProcedures.03" ? PROCEDURES.find((procedure) => procedure.code === action.code) : undefined;
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
    case "procedure-removed":
      return state.procedureDraft ? { ...state, procedureDraft: null, encounter: { ...state.encounter, events: state.encounter.events.filter((event) => event.id !== state.procedureDraft!.id) } } : state;
    case "procedure-saved": {
      const draft = state.procedureDraft;
      if (!draft) return state;
      const procedure: ProcedureRecord = {
        code: draft.procedureCode,
        label: draft.procedureLabel || definition.events.procedure.labels.procedure,
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
        detail: describeProcedure(procedure, definition.events.procedure),
        reference: `${definition.events.procedure.references.procedure} · ${definition.events.procedure.terminology.codeSystem} ${procedure.code}`,
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
    case "medication-removed":
      return state.medicationDraft ? { ...state, medicationDraft: null, encounter: { ...state.encounter, events: state.encounter.events.filter((event) => event.id !== state.medicationDraft!.id) } } : state;
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
      return event?.vitals ? { ...state, vitalDraft: { id: event.id, date: event.date ?? "2026-04-18", time: event.time, values: { ...EMPTY_VITALS, ...event.vitals, nullValues: event.vitals.nullValues ?? {} }, isNew: false } } : state;
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
    case "vitals-removed":
      return state.vitalDraft ? { ...state, vitalDraft: null, encounter: { ...state.encounter, events: state.encounter.events.filter((event) => event.id !== state.vitalDraft!.id) } } : state;
    case "vitals-saved": {
      const draft = state.vitalDraft;
      if (!draft) return state;
      const vitalDefinition = definition.events.vitals;
      const event: EncounterEvent = { id: draft.id, date: draft.date, time: draft.time, kind: "care", title: vitalDefinition.labels.timelineTitle, detail: vitalSummary(draft.values, definition), reference: vitalDefinition.references.group, visitorEntered: true, vitals: draft.values };
      return { ...state, view: "timeline", vitalDraft: null, encounter: { ...state.encounter, events: newestFirst([...state.encounter.events.filter((candidate) => candidate.id !== draft.id), event]) } };
    }
    case "state-restored":
      return action.state.encounter.definitionId === definition.id && action.state.encounter.definitionVersion === definition.version
        ? { ...action.state, noteDraft: action.state.noteDraft ?? null, procedureDraft: action.state.procedureDraft ?? null, medicationDraft: action.state.medicationDraft ?? null, vitalDraft: action.state.vitalDraft ?? null, acknowledgedWarnings: action.state.acknowledgedWarnings ?? [] }
        : state;
    default:
      return state;
  }
}

export function standardEncounterReducer(state: ShellState, action: ShellAction): ShellState {
  return transitionShell(state, action, bundledEncounterDefinition);
}
