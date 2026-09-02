import type { EncounterDocument, EncounterElement, EncounterGroup, EncounterValue } from "@open-triage/contracts";
import { loadEncounterDocument } from "./encounter-document";
import { requireNemsisDataElement, resolveNemsisElementValues, type NemsisDataElement } from "./nemsis-data-model";

export type PatientFieldId = "identifier" | "lastName" | "firstName" | "age" | "sex" | "medicalHistory" | "currentMedications" | "allergies";
export type PatientScalarFieldId = "identifier" | "lastName" | "firstName" | "age";
export type PatientChoice = { readonly kind: "coded" | "null" | "pertinent-negative"; readonly code: string; readonly label: string; readonly system?: string };
export type PatientDraft = {
  readonly identifier: string;
  readonly lastName: string;
  readonly firstName: string;
  readonly age: number;
  readonly absence: Readonly<Partial<Record<PatientScalarFieldId, PatientChoice>>>;
  readonly sex: PatientChoice | null;
  readonly medicalHistory: ReadonlyArray<PatientChoice>;
  readonly currentMedications: ReadonlyArray<PatientChoice>;
  readonly allergies: ReadonlyArray<PatientChoice>;
};

type PatientFieldLocation = { readonly elementId: string; readonly groupId: string; readonly repeatingGroup?: true };

// This is presentation routing only. All meaning, validation, labels, choices, and null behavior come from the catalog.
export const PATIENT_FIELD_LOCATIONS: Readonly<Record<PatientFieldId, PatientFieldLocation>> = {
  identifier: { elementId: "ePatient.01", groupId: "ePatientSection" },
  lastName: { elementId: "ePatient.02", groupId: "ePatient.PatientNameGroup" },
  firstName: { elementId: "ePatient.03", groupId: "ePatient.PatientNameGroup" },
  age: { elementId: "ePatient.15", groupId: "ePatient.AgeGroup" },
  sex: { elementId: "ePatient.13", groupId: "ePatientSection" },
  medicalHistory: { elementId: "eHistory.08", groupId: "eHistorySection" },
  currentMedications: { elementId: "eHistory.12", groupId: "eHistory.CurrentMedsGroup", repeatingGroup: true },
  allergies: { elementId: "eHistory.06", groupId: "eHistorySection" },
};

export type PatientEditorField = {
  readonly id: PatientFieldId;
  readonly element: NemsisDataElement;
  readonly label: string;
  readonly datatype: NemsisDataElement["datatype"];
  readonly reference: string;
  readonly choices: ReadonlyArray<PatientChoice>;
};

export function patientEditorField(id: PatientFieldId): PatientEditorField {
  const location = PATIENT_FIELD_LOCATIONS[id];
  const element = requireNemsisDataElement(location.elementId);
  const resolved = resolveNemsisElementValues(element);
  return {
    id,
    element,
    label: element.name.replace(" (DEPRECATED)", ""),
    datatype: element.datatype,
    reference: element.id,
    choices: [
      ...resolved.permissibleValues.map((value) => ({ kind: "coded" as const, code: value.code, label: value.label.replace(" (DEPRECATED)", ""), ...("codeSystem" in value && value.codeSystem ? { system: value.codeSystem } : {}) })),
      ...resolved.notValues.map((value) => ({ kind: "null" as const, code: value.code, label: value.label })),
      ...resolved.pertinentNegatives.map((value) => ({ kind: "pertinent-negative" as const, code: value.code, label: value.label })),
    ],
  };
}

function valuesFor(document: EncounterDocument, fieldId: PatientFieldId): ReadonlyArray<EncounterValue> {
  const { groupId, elementId } = PATIENT_FIELD_LOCATIONS[fieldId];
  return document.groups.find((group) => group.id === groupId)?.instances.flatMap((instance) =>
    instance.elements.find((element) => element.id === elementId)?.values ?? [],
  ) ?? [];
}

function scalar(document: EncounterDocument, fieldId: PatientFieldId): string | number | boolean | undefined {
  const value = valuesFor(document, fieldId).find((candidate) => candidate.kind === "scalar");
  return value?.kind === "scalar" ? value.value : undefined;
}

function choiceFromValue(fieldId: PatientFieldId, value: EncounterValue): PatientChoice | null {
  if (value.kind !== "coded" && value.kind !== "null" && value.kind !== "pertinent-negative") return null;
  const code = value.kind === "null" ? value.notValue?.code : value.code;
  if (!code) return null;
  const catalogChoice = patientEditorField(fieldId).choices.find((choice) => choice.kind === value.kind && choice.code === code);
  const display = "display" in value && typeof value.display === "string" ? value.display : code;
  return catalogChoice ?? { kind: value.kind, code, label: display, ...(value.kind === "coded" && value.system ? { system: value.system } : {}) };
}

export function patientDraftFromDocument(document: EncounterDocument): PatientDraft {
  const selected = (id: "medicalHistory" | "currentMedications" | "allergies") => valuesFor(document, id).map((value) => choiceFromValue(id, value)).filter((value): value is PatientChoice => value !== null);
  const absence = (id: PatientScalarFieldId) => valuesFor(document, id).map((value) => choiceFromValue(id, value)).find((value) => value?.kind !== "coded");
  return {
    identifier: String(scalar(document, "identifier") ?? ""),
    lastName: String(scalar(document, "lastName") ?? ""),
    firstName: String(scalar(document, "firstName") ?? ""),
    age: Number(scalar(document, "age") ?? 0),
    absence: Object.fromEntries((["identifier", "lastName", "firstName", "age"] as const).flatMap((id) => {
      const value = absence(id);
      return value ? [[id, value]] : [];
    })),
    sex: valuesFor(document, "sex").map((value) => choiceFromValue("sex", value)).find((value) => value !== null) ?? null,
    medicalHistory: selected("medicalHistory"),
    currentMedications: selected("currentMedications"),
    allergies: selected("allergies"),
  };
}

export function patientSummary(document: EncounterDocument) {
  const patient = patientDraftFromDocument(document);
  const labels = (values: ReadonlyArray<PatientChoice>) => values.map(({ label }) => label);
  return {
    name: [patient.absence.lastName?.label ?? patient.lastName, patient.absence.firstName?.label ?? patient.firstName].filter(Boolean).join(", "),
    age: patient.absence.age?.label ?? patient.age,
    sex: patient.sex?.label ?? "Not documented",
    identifier: patient.identifier,
    medicalHistory: labels(patient.medicalHistory),
    currentMedications: labels(patient.currentMedications),
    allergies: labels(patient.allergies),
  };
}

function encounterValue(choice: PatientChoice, occurrenceId: string): EncounterValue {
  if (choice.kind === "null") return { kind: "null", occurrenceId, notValue: { code: choice.code, display: choice.label } };
  if (choice.kind === "pertinent-negative") return { kind: "pertinent-negative", occurrenceId, code: choice.code, display: choice.label };
  return { kind: "coded", occurrenceId, code: choice.code, display: choice.label, ...(choice.system ? { system: choice.system } : {}) };
}

export function updatePatientDocument(source: EncounterDocument, draft: PatientDraft, updatedAt = new Date().toISOString()): EncounterDocument {
  const patientGroupIds = new Set(Object.values(PATIENT_FIELD_LOCATIONS).map(({ groupId }) => groupId));
  const untouched = source.groups.filter((group) => !patientGroupIds.has(group.id));
  const choiceElement = (id: PatientFieldId, choices: ReadonlyArray<PatientChoice>): EncounterElement => ({
    id: PATIENT_FIELD_LOCATIONS[id].elementId,
    values: choices.map((choice, index) => encounterValue(choice, `${id}-${index + 1}`)),
  });
  const scalarElement = (id: PatientScalarFieldId, value: string | number): EncounterElement => draft.absence[id]
    ? choiceElement(id, [draft.absence[id]!])
    : { id: PATIENT_FIELD_LOCATIONS[id].elementId, values: typeof value === "string" && !value ? [] : [{ kind: "scalar", occurrenceId: `${id}-1`, value }] };
  const replaceSingleGroup = (groupId: string, instanceId: string, managedElementIds: ReadonlySet<string>, elements: ReadonlyArray<EncounterElement>): EncounterGroup => {
    const existingGroup = source.groups.find((group) => group.id === groupId);
    const existingInstance = existingGroup?.instances[0];
    return {
      ...existingGroup,
      id: groupId,
      instances: [{
        ...existingInstance,
        instanceId: existingInstance?.instanceId ?? instanceId,
        elements: [...elements.filter(({ values }) => values.length), ...(existingInstance?.elements.filter(({ id }) => !managedElementIds.has(id)) ?? [])],
      }],
    };
  };
  const existingMedications = source.groups.find(({ id }) => id === "eHistory.CurrentMedsGroup");
  const groups: EncounterGroup[] = [
    replaceSingleGroup("ePatientSection", "patient-1", new Set(["ePatient.01", "ePatient.13"]), [scalarElement("identifier", draft.identifier), choiceElement("sex", draft.sex ? [draft.sex] : [])]),
    replaceSingleGroup("ePatient.PatientNameGroup", "patient-name-1", new Set(["ePatient.02", "ePatient.03"]), [scalarElement("lastName", draft.lastName), scalarElement("firstName", draft.firstName)]),
    replaceSingleGroup("ePatient.AgeGroup", "patient-age-1", new Set(["ePatient.15", "ePatient.16"]), [scalarElement("age", draft.age), { id: "ePatient.16", values: [{ kind: "coded", occurrenceId: "age-units-1", code: "2516009", display: "Years" }] }]),
    replaceSingleGroup("eHistorySection", "history-1", new Set(["eHistory.08", "eHistory.06"]), [choiceElement("medicalHistory", draft.medicalHistory), choiceElement("allergies", draft.allergies)]),
    ...(draft.currentMedications.length ? [{
      ...existingMedications,
      id: "eHistory.CurrentMedsGroup",
      instances: draft.currentMedications.map((choice, index) => ({
        ...existingMedications?.instances[index],
        instanceId: existingMedications?.instances[index]?.instanceId ?? `current-medication-${index + 1}`,
        elements: [choiceElement("currentMedications", [choice]), ...(existingMedications?.instances[index]?.elements.filter(({ id }) => id !== "eHistory.12") ?? [])],
      })),
    } satisfies EncounterGroup] : []),
  ];
  const updated = { ...source, encounter: { ...source.encounter, updatedAt }, groups: [...groups, ...untouched] };
  return loadEncounterDocument(updated, { formProfiles: { [updated.formProfile.id]: [updated.formProfile.version] } });
}
