export type NemsisReference = `e${string}`;
export type ConfiguredEventType = "vitals" | "medication" | "procedure" | "note";
export type QuickActionId = ConfiguredEventType | "patient";
export type ReviewSeverity = "error" | "warning";
export type ProcedureField = "procedure" | "time" | "attempts" | "success" | "outcome" | "complications";
export type VitalField = "systolic" | "diastolic" | "heartRate" | "spo2" | "respiratoryRate" | "gcs" | "pain";
export type VitalNullValue = string;

export type VitalFieldDefinition = {
  readonly id: VitalField;
  readonly label: string;
  readonly unit: string;
  readonly required: boolean;
  readonly reference: NemsisReference;
  readonly boundaries: { readonly min: number; readonly max: number; readonly warningLow: number; readonly warningHigh: number };
  readonly absenceStates: ReadonlyArray<{ readonly code: VitalNullValue; readonly kind: "NV" | "PN"; readonly label: string }>;
};

export type VitalGroupDefinition = {
  readonly quickAction: { readonly visible: boolean; readonly label: string };
  readonly labels: {
    readonly category: string; readonly timelineTitle: string; readonly newEyebrow: string; readonly editEyebrow: string;
    readonly editorTitle: string; readonly closeEditor: string; readonly time: string; readonly absenceHelp: string;
    readonly cancel: string; readonly add: string; readonly save: string; readonly absentSummary: string;
  };
  readonly references: { readonly group: NemsisReference; readonly time: NemsisReference };
  readonly validationMessages: { readonly invalidTime: string; readonly emptyGroup: string };
  readonly fields: ReadonlyArray<VitalFieldDefinition>;
  readonly summary: ReadonlyArray<{ readonly label: string; readonly fields: ReadonlyArray<VitalField>; readonly separator: string; readonly unit: string }>;
};

export type NoteEventDefinition = {
  readonly quickAction: { readonly visible: boolean; readonly label: string };
  readonly labels: {
    readonly category: string;
    readonly timelineTitle: string;
    readonly newEyebrow: string;
    readonly editEyebrow: string;
    readonly editorTitle: string;
    readonly closeEditor: string;
    readonly time: string;
    readonly timeHelp: string;
    readonly summary: string;
    readonly summaryPlaceholder: string;
    readonly cancel: string;
    readonly add: string;
    readonly save: string;
  };
  readonly required: { readonly time: boolean; readonly summary: boolean };
  readonly references: { readonly time: NemsisReference; readonly summary: NemsisReference };
  readonly validationMessages: { readonly invalidTime: string; readonly summaryRequired: string };
};

export type ProcedureEventDefinition = {
  readonly quickAction: { readonly visible: boolean; readonly label: string };
  readonly fieldOrder: ReadonlyArray<ProcedureField>;
  readonly labels: {
    readonly category: string; readonly newEyebrow: string; readonly editEyebrow: string; readonly editorTitle: string;
    readonly closeEditor: string; readonly search: string; readonly searchPlaceholder: string; readonly offlineCaption: string;
    readonly noResults: string; readonly change: string; readonly procedure: string; readonly time: string; readonly attempts: string;
    readonly success: string; readonly outcome: string; readonly complications: string; readonly select: string;
    readonly cancel: string; readonly add: string; readonly save: string; readonly warningPill: string;
  };
  readonly terminology: { readonly catalog: NemsisReference; readonly codeSystem: string };
  readonly required: Record<ProcedureField, boolean>;
  readonly references: Record<ProcedureField, NemsisReference>;
  readonly attempts: { readonly defaultValue: number; readonly min: number; readonly max: number };
  readonly successOptions: ReadonlyArray<{ readonly value: "yes" | "no"; readonly label: string }>;
  readonly outcomeOptions: ReadonlyArray<{ readonly value: "improved" | "unchanged" | "worse" | "not-applicable"; readonly code: string; readonly label: string }>;
  readonly complicationOptions: ReadonlyArray<{ readonly code: string; readonly label: string }>;
  readonly validationMessages: Record<"procedureRequired" | "labelMismatch" | "invalidTime" | "invalidAttempts" | "successRequired" | "complicationsRequired" | "outcomeRequired", string>;
  readonly warningBehavior: {
    readonly noneCode: string; readonly repeatedAttemptThreshold: number;
    readonly noneWithOtherMessage: string; readonly repeatedOrUnsuccessfulMessage: string;
  };
  readonly timeline: {
    readonly attemptSingular: string; readonly attemptPlural: string; readonly successful: string; readonly unsuccessful: string;
    readonly complicationLabel: string;
  };
};

export type MedicationFieldId = "medication" | "time" | "dose" | "unit" | "route" | "response";

export type MedicationEventDefinition = {
  readonly quickAction: { readonly visible: boolean; readonly label: string };
  readonly terminology: { readonly catalog: NemsisReference };
  readonly fields: ReadonlyArray<{
    readonly id: MedicationFieldId;
    readonly label: string;
    readonly required: boolean;
    readonly reference: NemsisReference;
    readonly placeholder?: string;
    readonly warnWhenMissing?: boolean;
  }>;
  readonly doseUnits: ReadonlyArray<string>;
  readonly routes: ReadonlyArray<string>;
  readonly labels: {
    readonly category: string;
    readonly newEyebrow: string;
    readonly editEyebrow: string;
    readonly editorTitle: string;
    readonly closeEditor: string;
    readonly searchResults: string;
    readonly availableOffline: string;
    readonly noMatches: string;
    readonly change: string;
    readonly select: string;
    readonly selectRoute: string;
    readonly cancel: string;
    readonly add: string;
    readonly save: string;
    readonly medicationMissing: string;
    readonly routeMissing: string;
    readonly responseMissing: string;
  };
  readonly validationMessages: {
    readonly invalidTime: string;
    readonly invalidMedication: string;
    readonly invalidDose: string;
    readonly invalidUnit: string;
    readonly invalidRoute: string;
    readonly responseMissing: string;
  };
};

export type EncounterDefinition = {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly version: number;
  readonly synthetic: true;
  readonly labels: {
    readonly incident: string; readonly patientDialogEyebrow: string; readonly patientDialogTitle: string;
    readonly savePatient: string;
  };
  readonly patient: {
    readonly quickAction: { readonly visible: boolean; readonly label: string; readonly title: string };
  };
  readonly composition: {
    readonly quickActionOrder: ReadonlyArray<QuickActionId>;
    readonly review: {
      readonly groups: ReadonlyArray<{ readonly severity: ReviewSeverity; readonly title: string; readonly empty: string }>;
      readonly eventTypeOrder: ReadonlyArray<ConfiguredEventType>;
    };
    readonly summary: { readonly eventTypeOrder: ReadonlyArray<ConfiguredEventType> };
  };
  readonly events: { readonly note: NoteEventDefinition; readonly procedure: ProcedureEventDefinition; readonly medication: MedicationEventDefinition; readonly vitals: VitalGroupDefinition };
};

export interface EncounterDefinitionProvider { get(id: string): EncounterDefinition }

export type ConfiguredQuickAction = { readonly id: QuickActionId; readonly label: string; readonly title: string };

export function configuredQuickActions(definition: EncounterDefinition): ReadonlyArray<ConfiguredQuickAction> {
  const actions: Record<QuickActionId, { readonly visible: boolean; readonly label: string; readonly title: string }> = {
    vitals: { ...definition.events.vitals.quickAction, title: definition.events.vitals.labels.timelineTitle },
    medication: { ...definition.events.medication.quickAction, title: definition.events.medication.labels.editorTitle },
    procedure: { ...definition.events.procedure.quickAction, title: definition.events.procedure.labels.editorTitle },
    note: { ...definition.events.note.quickAction, title: definition.events.note.labels.timelineTitle },
    patient: definition.patient.quickAction,
  };
  return definition.composition.quickActionOrder.flatMap((id) => actions[id].visible ? [{ id, label: actions[id].label, title: actions[id].title }] : []);
}

export class EncounterDefinitionError extends Error {
  constructor(readonly definitionId: string, readonly diagnostics: ReadonlyArray<string>) {
    super(`Invalid encounter definition "${definitionId}": ${diagnostics.join("; ")}`);
    this.name = "EncounterDefinitionError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

export function validateEncounterDefinition(value: unknown): EncounterDefinition {
  const diagnostics: string[] = [];
  const root = isRecord(value) ? value : {};
  const id = typeof root.id === "string" && root.id.trim() ? root.id : "unknown";
  if (!isRecord(value)) diagnostics.push("definition must be an object");
  if (root.schemaVersion !== 1) diagnostics.push("schemaVersion must be 1");
  if (typeof root.id !== "string" || !root.id.trim()) diagnostics.push("id is required");
  if (!Number.isInteger(root.version) || Number(root.version) < 1) diagnostics.push("version must be a positive integer");
  if (root.synthetic !== true) diagnostics.push("synthetic must be true for the bundled record");
  const requiredStrings = (candidate: unknown, path: string, keys: readonly string[]) => {
    if (!isRecord(candidate)) { diagnostics.push(`${path} must be an object`); return; }
    for (const key of keys) if (typeof candidate[key] !== "string" || !(candidate[key] as string).trim()) diagnostics.push(`${path}.${key} is required`);
  };
  const rejectUnsupportedKeys = (candidate: unknown, path: string, supported: readonly string[]) => {
    if (!isRecord(candidate)) return;
    for (const key of Object.keys(candidate)) {
      if (!supported.includes(key)) diagnostics.push(`${path ? `${path}.` : ""}${key} is not supported by schemaVersion 1`);
    }
  };
  rejectUnsupportedKeys(root, "", ["schemaVersion", "id", "version", "synthetic", "labels", "patient", "composition", "events"]);
  requiredStrings(root.labels, "labels", ["incident", "patientDialogEyebrow", "patientDialogTitle", "savePatient"]);
  const patient = isRecord(root.patient) ? root.patient : {};
  const patientQuickAction = isRecord(patient.quickAction) ? patient.quickAction : {};
  if (typeof patientQuickAction.visible !== "boolean") diagnostics.push("patient.quickAction.visible must be a boolean");
  requiredStrings(patientQuickAction, "patient.quickAction", ["label", "title"]);
  rejectUnsupportedKeys(patient, "patient", ["quickAction"]);
  const composition = isRecord(root.composition) ? root.composition : {};
  rejectUnsupportedKeys(composition, "composition", ["quickActionOrder", "review", "summary"]);
  const quickActionIds = ["vitals", "medication", "procedure", "note", "patient"] as const;
  if (!Array.isArray(composition.quickActionOrder)
    || composition.quickActionOrder.length !== quickActionIds.length
    || new Set(composition.quickActionOrder).size !== quickActionIds.length
    || composition.quickActionOrder.some((id) => !quickActionIds.includes(id as QuickActionId))) {
    diagnostics.push("composition.quickActionOrder must contain every supported quick action exactly once");
  }
  const review = isRecord(composition.review) ? composition.review : {};
  const severities = ["error", "warning"] as const;
  if (!Array.isArray(review.groups)
    || review.groups.length !== severities.length
    || new Set(review.groups.map((group) => isRecord(group) ? group.severity : undefined)).size !== severities.length) {
    diagnostics.push("composition.review.groups must contain error and warning exactly once");
  } else review.groups.forEach((group, index) => {
    const candidate = isRecord(group) ? group : {};
    if (!severities.includes(candidate.severity as ReviewSeverity)) diagnostics.push(`composition.review.groups[${index}].severity is not supported`);
    requiredStrings(candidate, `composition.review.groups[${index}]`, ["title", "empty"]);
  });
  const eventTypeIds = ["vitals", "medication", "procedure", "note"] as const;
  const validateEventTypeOrder = (candidate: unknown, path: string) => {
    if (!Array.isArray(candidate)
      || candidate.length !== eventTypeIds.length
      || new Set(candidate).size !== eventTypeIds.length
      || candidate.some((id) => !eventTypeIds.includes(id as ConfiguredEventType))) {
      diagnostics.push(`${path} must contain every supported event type exactly once`);
    }
  };
  validateEventTypeOrder(review.eventTypeOrder, "composition.review.eventTypeOrder");
  const summary = isRecord(composition.summary) ? composition.summary : {};
  validateEventTypeOrder(summary.eventTypeOrder, "composition.summary.eventTypeOrder");
  const events = isRecord(root.events) ? root.events : {};
  rejectUnsupportedKeys(events, "events", ["note", "procedure", "medication", "vitals"]);
  const note = isRecord(events.note) ? events.note : {};
  rejectUnsupportedKeys(note, "events.note", ["quickAction", "labels", "required", "references", "validationMessages"]);
  const quickAction = isRecord(note.quickAction) ? note.quickAction : {};
  if (typeof quickAction.visible !== "boolean") diagnostics.push("events.note.quickAction.visible must be a boolean");
  requiredStrings(quickAction, "events.note.quickAction", ["label"]);
  requiredStrings(note.labels, "events.note.labels", ["category", "timelineTitle", "newEyebrow", "editEyebrow", "editorTitle", "closeEditor", "time", "timeHelp", "summary", "summaryPlaceholder", "cancel", "add", "save"]);
  const required = isRecord(note.required) ? note.required : {};
  for (const field of ["time", "summary"] as const) if (typeof required[field] !== "boolean") diagnostics.push(`events.note.required.${field} must be a boolean`);
  requiredStrings(note.references, "events.note.references", ["time", "summary"]);
  requiredStrings(note.validationMessages, "events.note.validationMessages", ["invalidTime", "summaryRequired"]);
  const procedure = isRecord(events.procedure) ? events.procedure : {};
  rejectUnsupportedKeys(procedure, "events.procedure", ["quickAction", "fieldOrder", "labels", "terminology", "required", "references", "attempts", "successOptions", "outcomeOptions", "complicationOptions", "validationMessages", "warningBehavior", "timeline"]);
  const procedureQuickAction = isRecord(procedure.quickAction) ? procedure.quickAction : {};
  if (typeof procedureQuickAction.visible !== "boolean") diagnostics.push("events.procedure.quickAction.visible must be a boolean");
  requiredStrings(procedureQuickAction, "events.procedure.quickAction", ["label"]);
  const procedureFields = ["procedure", "time", "attempts", "success", "outcome", "complications"] as const;
  if (!Array.isArray(procedure.fieldOrder) || procedure.fieldOrder.length !== procedureFields.length || new Set(procedure.fieldOrder).size !== procedureFields.length || procedure.fieldOrder.some((field) => !procedureFields.includes(field as ProcedureField))) {
    diagnostics.push("events.procedure.fieldOrder must contain every procedure field exactly once");
  }
  requiredStrings(procedure.labels, "events.procedure.labels", ["category", "newEyebrow", "editEyebrow", "editorTitle", "closeEditor", "search", "searchPlaceholder", "offlineCaption", "noResults", "change", "procedure", "time", "attempts", "success", "outcome", "complications", "select", "cancel", "add", "save", "warningPill"]);
  requiredStrings(procedure.terminology, "events.procedure.terminology", ["catalog", "codeSystem"]);
  const procedureRequired = isRecord(procedure.required) ? procedure.required : {};
  for (const field of procedureFields) if (typeof procedureRequired[field] !== "boolean") diagnostics.push(`events.procedure.required.${field} must be a boolean`);
  requiredStrings(procedure.references, "events.procedure.references", procedureFields);
  const attempts = isRecord(procedure.attempts) ? procedure.attempts : {};
  for (const field of ["defaultValue", "min", "max"] as const) if (!Number.isInteger(attempts[field])) diagnostics.push(`events.procedure.attempts.${field} must be an integer`);
  for (const optionGroup of ["successOptions", "outcomeOptions", "complicationOptions"] as const) {
    if (!Array.isArray(procedure[optionGroup]) || procedure[optionGroup].length === 0) diagnostics.push(`events.procedure.${optionGroup} must contain options`);
  }
  requiredStrings(procedure.validationMessages, "events.procedure.validationMessages", ["procedureRequired", "labelMismatch", "invalidTime", "invalidAttempts", "successRequired", "complicationsRequired", "outcomeRequired"]);
  const warningBehavior = isRecord(procedure.warningBehavior) ? procedure.warningBehavior : {};
  requiredStrings(warningBehavior, "events.procedure.warningBehavior", ["noneCode", "noneWithOtherMessage", "repeatedOrUnsuccessfulMessage"]);
  if (!Number.isInteger(warningBehavior.repeatedAttemptThreshold)) diagnostics.push("events.procedure.warningBehavior.repeatedAttemptThreshold must be an integer");
  requiredStrings(procedure.timeline, "events.procedure.timeline", ["attemptSingular", "attemptPlural", "successful", "unsuccessful", "complicationLabel"]);
  const medication = isRecord(events.medication) ? events.medication : {};
  rejectUnsupportedKeys(medication, "events.medication", ["quickAction", "terminology", "fields", "doseUnits", "routes", "labels", "validationMessages"]);
  const medicationQuickAction = isRecord(medication.quickAction) ? medication.quickAction : {};
  if (typeof medicationQuickAction.visible !== "boolean") diagnostics.push("events.medication.quickAction.visible must be a boolean");
  requiredStrings(medicationQuickAction, "events.medication.quickAction", ["label"]);
  const terminology = isRecord(medication.terminology) ? medication.terminology : {};
  if (terminology.catalog !== "eMedications.03") diagnostics.push("events.medication.terminology.catalog must reference eMedications.03");
  const medicationFieldIds = ["medication", "time", "dose", "unit", "route", "response"] as const;
  if (!Array.isArray(medication.fields)) diagnostics.push("events.medication.fields must be an array");
  else {
    const seen = new Set<string>();
    medication.fields.forEach((field, index) => {
      requiredStrings(field, `events.medication.fields[${index}]`, ["id", "label", "reference"]);
      if (!isRecord(field)) return;
      rejectUnsupportedKeys(field, `events.medication.fields[${index}]`, ["id", "label", "required", "reference", "placeholder", "warnWhenMissing"]);
      if (!medicationFieldIds.includes(field.id as typeof medicationFieldIds[number])) diagnostics.push(`events.medication.fields[${index}].id is not supported`);
      if (seen.has(String(field.id))) diagnostics.push(`events.medication.fields contains duplicate id ${String(field.id)}`);
      seen.add(String(field.id));
      if (typeof field.required !== "boolean") diagnostics.push(`events.medication.fields[${index}].required must be a boolean`);
      if (field.warnWhenMissing !== undefined && typeof field.warnWhenMissing !== "boolean") diagnostics.push(`events.medication.fields[${index}].warnWhenMissing must be a boolean`);
    });
    for (const fieldId of medicationFieldIds) if (!seen.has(fieldId)) diagnostics.push(`events.medication.fields must include ${fieldId}`);
  }
  for (const list of ["doseUnits", "routes"] as const) {
    if (!Array.isArray(medication[list]) || medication[list].length === 0 || medication[list].some((item) => typeof item !== "string" || !item.trim())) diagnostics.push(`events.medication.${list} must contain strings`);
  }
  requiredStrings(medication.labels, "events.medication.labels", ["category", "newEyebrow", "editEyebrow", "editorTitle", "closeEditor", "searchResults", "availableOffline", "noMatches", "change", "select", "selectRoute", "cancel", "add", "save", "medicationMissing", "routeMissing", "responseMissing"]);
  requiredStrings(medication.validationMessages, "events.medication.validationMessages", ["invalidTime", "invalidMedication", "invalidDose", "invalidUnit", "invalidRoute", "responseMissing"]);
  const vitals = isRecord(events.vitals) ? events.vitals : {};
  rejectUnsupportedKeys(vitals, "events.vitals", ["quickAction", "labels", "references", "validationMessages", "fields", "summary"]);
  const vitalQuickAction = isRecord(vitals.quickAction) ? vitals.quickAction : {};
  if (typeof vitalQuickAction.visible !== "boolean") diagnostics.push("events.vitals.quickAction.visible must be a boolean");
  requiredStrings(vitalQuickAction, "events.vitals.quickAction", ["label"]);
  requiredStrings(vitals.labels, "events.vitals.labels", ["category", "timelineTitle", "newEyebrow", "editEyebrow", "editorTitle", "closeEditor", "time", "absenceHelp", "cancel", "add", "save", "absentSummary"]);
  requiredStrings(vitals.references, "events.vitals.references", ["group", "time"]);
  requiredStrings(vitals.validationMessages, "events.vitals.validationMessages", ["invalidTime", "emptyGroup"]);
  const vitalFieldIds = new Set<string>();
  if (!Array.isArray(vitals.fields) || vitals.fields.length === 0) diagnostics.push("events.vitals.fields must contain at least one field");
  else vitals.fields.forEach((candidate, index) => {
    const path = `events.vitals.fields[${index}]`;
    const field = isRecord(candidate) ? candidate : {};
    rejectUnsupportedKeys(field, path, ["id", "label", "unit", "required", "reference", "boundaries", "absenceStates"]);
    requiredStrings(field, path, ["id", "label", "unit", "reference"]);
    if (typeof field.id === "string") {
      if (!["systolic", "diastolic", "heartRate", "spo2", "respiratoryRate", "gcs", "pain"].includes(field.id)) diagnostics.push(`${path}.id is not a supported saved vital field`);
      if (vitalFieldIds.has(field.id)) diagnostics.push(`${path}.id must be unique`);
      vitalFieldIds.add(field.id);
    }
    if (typeof field.required !== "boolean") diagnostics.push(`${path}.required must be a boolean`);
    const boundaries = isRecord(field.boundaries) ? field.boundaries : {};
    for (const boundary of ["min", "max", "warningLow", "warningHigh"] as const) if (typeof boundaries[boundary] !== "number" || !Number.isFinite(boundaries[boundary])) diagnostics.push(`${path}.boundaries.${boundary} must be a finite number`);
    if (typeof boundaries.min === "number" && typeof boundaries.max === "number" && boundaries.min > boundaries.max) diagnostics.push(`${path}.boundaries.min must not exceed max`);
    if (!Array.isArray(field.absenceStates)) diagnostics.push(`${path}.absenceStates must be an array`);
    else field.absenceStates.forEach((candidateState, stateIndex) => {
      const statePath = `${path}.absenceStates[${stateIndex}]`;
      const absenceState = isRecord(candidateState) ? candidateState : {};
      requiredStrings(absenceState, statePath, ["code", "kind", "label"]);
      if (absenceState.kind !== "NV" && absenceState.kind !== "PN") diagnostics.push(`${statePath}.kind must be NV or PN`);
    });
  });
  if (!Array.isArray(vitals.summary) || vitals.summary.length === 0) diagnostics.push("events.vitals.summary must contain at least one item");
  else vitals.summary.forEach((candidate, index) => {
    const path = `events.vitals.summary[${index}]`;
    const item = isRecord(candidate) ? candidate : {};
    requiredStrings(item, path, ["label"]);
    for (const displayPart of ["separator", "unit"] as const) if (typeof item[displayPart] !== "string") diagnostics.push(`${path}.${displayPart} must be a string`);
    if (!Array.isArray(item.fields) || item.fields.length === 0) diagnostics.push(`${path}.fields must contain at least one field`);
    else item.fields.forEach((field) => { if (typeof field !== "string" || !vitalFieldIds.has(field)) diagnostics.push(`${path}.fields contains an unconfigured field`); });
  });
  if (diagnostics.length) throw new EncounterDefinitionError(id, diagnostics);
  return value as EncounterDefinition;
}

export function createBundledDefinitionProvider(definitions: ReadonlyArray<unknown>): EncounterDefinitionProvider {
  const validated = new Map<string, EncounterDefinition>();
  for (const definition of definitions) {
    const parsed = validateEncounterDefinition(definition);
    if (validated.has(parsed.id)) throw new EncounterDefinitionError(parsed.id, ["bundled definition id must be unique"]);
    validated.set(parsed.id, parsed);
  }
  return { get(id) { const definition = validated.get(id); if (!definition) throw new EncounterDefinitionError(id, ["definition was not found"]); return definition; } };
}
