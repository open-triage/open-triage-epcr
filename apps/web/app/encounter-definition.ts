export type NemsisReference = `e${string}`;
export type PatientChoiceGroup = "medicalHistory" | "currentMedications" | "allergies";

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

export type EncounterDefinition = {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly version: number;
  readonly synthetic: true;
  readonly dates: { readonly clinicalDate: string; readonly currentTime: string };
  readonly labels: {
    readonly prototypeStatus: string; readonly incident: string; readonly patientDialogEyebrow: string; readonly patientDialogTitle: string;
    readonly patientName: string; readonly age: string; readonly sex: string; readonly medicalHistory: string;
    readonly currentMedications: string; readonly allergies: string; readonly savePatient: string;
  };
  readonly patient: {
    readonly initial: { readonly name: string; readonly age: number; readonly sex: string; readonly identifier: string; readonly medicalHistory: ReadonlyArray<string>; readonly currentMedications: ReadonlyArray<string>; readonly allergies: ReadonlyArray<string> };
    readonly references: { readonly name: NemsisReference; readonly age: NemsisReference; readonly sex: NemsisReference; readonly identifier: NemsisReference };
    readonly choices: Record<PatientChoiceGroup, ReadonlyArray<{ readonly label: string; readonly reference: NemsisReference }>>;
  };
  readonly dispatch: {
    readonly crew: string;
    readonly incident: { readonly number: string; readonly complaint: string; readonly address: string };
    readonly references: { readonly incidentNumber: NemsisReference; readonly complaint: NemsisReference; readonly address: NemsisReference };
    readonly events: ReadonlyArray<{ readonly time: string; readonly title: string; readonly detail: string; readonly reference: string }>;
  };
  readonly events: { readonly note: NoteEventDefinition };
};

export interface EncounterDefinitionProvider { get(id: string): EncounterDefinition }

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
  if (root.synthetic !== true) diagnostics.push("synthetic must be true for the bundled prototype");
  const requiredStrings = (candidate: unknown, path: string, keys: readonly string[]) => {
    if (!isRecord(candidate)) { diagnostics.push(`${path} must be an object`); return; }
    for (const key of keys) if (typeof candidate[key] !== "string" || !(candidate[key] as string).trim()) diagnostics.push(`${path}.${key} is required`);
  };
  requiredStrings(root.dates, "dates", ["clinicalDate", "currentTime"]);
  requiredStrings(root.labels, "labels", ["prototypeStatus", "incident", "patientDialogEyebrow", "patientDialogTitle", "patientName", "age", "sex", "medicalHistory", "currentMedications", "allergies", "savePatient"]);
  const patient = isRecord(root.patient) ? root.patient : {};
  requiredStrings(patient.initial, "patient.initial", ["name", "sex", "identifier"]);
  if (!isRecord(patient.initial) || typeof patient.initial.age !== "number" || patient.initial.age < 0) diagnostics.push("patient.initial.age must be a non-negative number");
  for (const group of ["medicalHistory", "currentMedications", "allergies"] as const) if (!isRecord(patient.initial) || !Array.isArray(patient.initial[group])) diagnostics.push(`patient.initial.${group} must be an array`);
  requiredStrings(patient.references, "patient.references", ["name", "age", "sex", "identifier"]);
  const choices = isRecord(patient.choices) ? patient.choices : {};
  for (const group of ["medicalHistory", "currentMedications", "allergies"] as const) {
    if (!Array.isArray(choices[group])) diagnostics.push(`patient.choices.${group} must be an array`);
    else choices[group].forEach((choice, index) => requiredStrings(choice, `patient.choices.${group}[${index}]`, ["label", "reference"]));
  }
  const dispatch = isRecord(root.dispatch) ? root.dispatch : {};
  requiredStrings(dispatch, "dispatch", ["crew"]);
  requiredStrings(dispatch.incident, "dispatch.incident", ["number", "complaint", "address"]);
  requiredStrings(dispatch.references, "dispatch.references", ["incidentNumber", "complaint", "address"]);
  if (!Array.isArray(dispatch.events) || dispatch.events.length === 0) diagnostics.push("dispatch.events must contain at least one event");
  else dispatch.events.forEach((event, index) => requiredStrings(event, `dispatch.events[${index}]`, ["time", "title", "detail", "reference"]));
  const events = isRecord(root.events) ? root.events : {};
  const note = isRecord(events.note) ? events.note : {};
  const quickAction = isRecord(note.quickAction) ? note.quickAction : {};
  if (typeof quickAction.visible !== "boolean") diagnostics.push("events.note.quickAction.visible must be a boolean");
  requiredStrings(quickAction, "events.note.quickAction", ["label"]);
  requiredStrings(note.labels, "events.note.labels", ["category", "timelineTitle", "newEyebrow", "editEyebrow", "editorTitle", "closeEditor", "time", "timeHelp", "summary", "summaryPlaceholder", "cancel", "add", "save"]);
  const required = isRecord(note.required) ? note.required : {};
  for (const field of ["time", "summary"] as const) if (typeof required[field] !== "boolean") diagnostics.push(`events.note.required.${field} must be a boolean`);
  requiredStrings(note.references, "events.note.references", ["time", "summary"]);
  requiredStrings(note.validationMessages, "events.note.validationMessages", ["invalidTime", "summaryRequired"]);
  if (diagnostics.length) throw new EncounterDefinitionError(id, diagnostics);
  return value as EncounterDefinition;
}

export function createBundledDefinitionProvider(definitions: ReadonlyArray<unknown>): EncounterDefinitionProvider {
  const validated = new Map(definitions.map((definition) => { const parsed = validateEncounterDefinition(definition); return [parsed.id, parsed] as const; }));
  return { get(id) { const definition = validated.get(id); if (!definition) throw new EncounterDefinitionError(id, ["definition was not found"]); return definition; } };
}
