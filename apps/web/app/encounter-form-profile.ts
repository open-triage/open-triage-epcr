import standardProfileSource from "./data/standard-encounter-form.json";
import { createElementCatalog, type ElementCatalog } from "./custom-data-elements";
import { validateEncounterDefinition, type ConfiguredEventType, type EncounterDefinition, type ProcedureField, type QuickActionId, type ReviewSeverity } from "./encounter-definition";
import { standardEncounterDefinition as catalogBackedDefaults } from "./standard-encounter-definition";
import { medicationElementMetadata, procedureElementMetadata, vitalElementMetadata } from "./nemsis-form-profile";

type SectionId = QuickActionId;
type ProfileSection = { readonly id: SectionId; readonly visible: boolean; readonly quickActionLabel: string; readonly elements: ReadonlyArray<string> };
export type EncounterFormProfile = {
  readonly schemaVersion: 1; readonly id: string; readonly version: number;
  readonly sections: ReadonlyArray<ProfileSection>;
  readonly labels?: Readonly<Record<string, string>>;
  readonly helpText?: Readonly<Record<string, string>>;
  readonly review: { readonly groups: ReadonlyArray<{ readonly severity: ReviewSeverity; readonly title: string; readonly empty: string }>; readonly sectionOrder: ReadonlyArray<ConfiguredEventType> };
  readonly summary: { readonly sectionOrder: ReadonlyArray<ConfiguredEventType>; readonly vitalOrder: ReadonlyArray<string> };
};

export class EncounterFormProfileError extends Error {
  constructor(readonly diagnostics: ReadonlyArray<string>) {
    super(`Invalid encounter form profile: ${diagnostics.join("; ")}`);
    this.name = "EncounterFormProfileError";
  }
}

const sectionIds = ["vitals", "medication", "procedure", "note", "patient"] as const;
const eventIds = ["vitals", "medication", "procedure", "note"] as const;
const supported: Record<SectionId, ReadonlyArray<string>> = {
  vitals: catalogBackedDefaults.events.vitals.fields.map(({ reference }) => reference),
  medication: catalogBackedDefaults.events.medication.fields.map(({ reference }) => reference),
  procedure: Object.values(catalogBackedDefaults.events.procedure.references),
  note: [catalogBackedDefaults.events.note.references.summary], patient: [],
};
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function compileEncounterFormProfile(value: unknown, catalog: ElementCatalog = createElementCatalog()): EncounterDefinition {
  const errors: string[] = [];
  const root = isRecord(value) ? value : {};
  const allowedRoot = ["schemaVersion", "id", "version", "sections", "labels", "helpText", "review", "summary"];
  Object.keys(root).filter((key) => !allowedRoot.includes(key)).forEach((key) => errors.push(`$.${key}: illegal override; datatype, cardinality, coded values, NV and PN semantics are catalog-owned`));
  if (root.schemaVersion !== 1) errors.push("$.schemaVersion: must be 1");
  if (typeof root.id !== "string" || !root.id.trim()) errors.push("$.id: must be a non-empty string");
  if (!Number.isInteger(root.version) || Number(root.version) < 1) errors.push("$.version: must be a positive integer");

  const sections = Array.isArray(root.sections) ? root.sections : [];
  if (!Array.isArray(root.sections)) errors.push("$.sections: must be an array");
  const seenSections = new Set<string>();
  const parsedSections: ProfileSection[] = [];
  sections.forEach((candidate, sectionIndex) => {
    const path = `$.sections[${sectionIndex}]`;
    if (!isRecord(candidate)) { errors.push(`${path}: must be an object`); return; }
    Object.keys(candidate).filter((key) => !["id", "visible", "quickActionLabel", "elements"].includes(key)).forEach((key) => errors.push(`${path}.${key}: illegal override`));
    const id = candidate.id;
    if (typeof id !== "string" || !sectionIds.includes(id as SectionId)) { errors.push(`${path}.id: unsupported section ${String(id)}`); return; }
    if (seenSections.has(id)) errors.push(`${path}.id: duplicate section placement ${id}`);
    seenSections.add(id);
    if (typeof candidate.visible !== "boolean") errors.push(`${path}.visible: must be a boolean`);
    if (typeof candidate.quickActionLabel !== "string" || !candidate.quickActionLabel.trim()) errors.push(`${path}.quickActionLabel: must be a non-empty string`);
    const elements = Array.isArray(candidate.elements) ? candidate.elements : [];
    if (!Array.isArray(candidate.elements)) errors.push(`${path}.elements: must be an array`);
    const seenElements = new Set<string>();
    elements.forEach((element, elementIndex) => {
      const elementPath = `${path}.elements[${elementIndex}]`;
      if (typeof element !== "string") { errors.push(`${elementPath}: must be a stable element identifier`); return; }
      if (seenElements.has(element)) errors.push(`${elementPath}: duplicate placement of ${element}`);
      seenElements.add(element);
      const entry = catalog.get(element);
      if (!entry) errors.push(`${elementPath}: unknown standard or namespaced custom element ${element}`);
      else if (entry.provenance === "custom" && !element.startsWith(`${entry.namespace}.`)) errors.push(`${elementPath}: invalid custom-element namespace for ${element}`);
      if (!supported[id as SectionId].includes(element)) errors.push(`${elementPath}: ${element} is not supported in ${id}`);
    });
    parsedSections.push({ id: id as SectionId, visible: candidate.visible as boolean, quickActionLabel: candidate.quickActionLabel as string, elements: elements as string[] });
  });
  sectionIds.forEach((id) => { if (!seenSections.has(id)) errors.push(`$.sections: missing supported section ${id}`); });

  const validateElementText = (candidate: unknown, path: string) => {
    if (candidate === undefined) return;
    if (!isRecord(candidate)) { errors.push(`${path}: must be an object`); return; }
    Object.entries(candidate).forEach(([id, text]) => {
      if (!catalog.get(id)) errors.push(`${path}.${id}: unknown standard or namespaced custom element`);
      if (typeof text !== "string" || !text.trim()) errors.push(`${path}.${id}: must be a non-empty string`);
    });
  };
  validateElementText(root.labels, "$.labels"); validateElementText(root.helpText, "$.helpText");
  const review = isRecord(root.review) ? root.review : {};
  const summary = isRecord(root.summary) ? root.summary : {};
  const validateEventOrder = (candidate: unknown, path: string) => {
    if (!Array.isArray(candidate) || candidate.length !== eventIds.length || new Set(candidate).size !== eventIds.length || candidate.some((id) => !eventIds.includes(id as ConfiguredEventType))) errors.push(`${path}: must contain each clinical section exactly once`);
  };
  validateEventOrder(review.sectionOrder, "$.review.sectionOrder"); validateEventOrder(summary.sectionOrder, "$.summary.sectionOrder");
  if (!Array.isArray(review.groups) || review.groups.length !== 2 || new Set(review.groups.map((group) => isRecord(group) ? group.severity : undefined)).size !== 2) errors.push("$.review.groups: must contain error and warning exactly once");
  const vitalOrder = Array.isArray(summary.vitalOrder) ? summary.vitalOrder : [];
  const vitalSection = parsedSections.find(({ id }) => id === "vitals");
  vitalOrder.forEach((id, index) => { if (typeof id !== "string" || !vitalSection?.elements.includes(id)) errors.push(`$.summary.vitalOrder[${index}]: must reference a configured vital element`); });
  if (new Set(vitalOrder).size !== vitalOrder.length) errors.push("$.summary.vitalOrder: contains duplicate placements");
  if (errors.length) throw new EncounterFormProfileError(errors);

  const profile = value as EncounterFormProfile;
  const section = (id: SectionId) => profile.sections.find((candidate) => candidate.id === id)!;
  const labels = profile.labels ?? {};
  const vitalByReference = new Map<string, EncounterDefinition["events"]["vitals"]["fields"][number]>(catalogBackedDefaults.events.vitals.fields.map((field) => [field.reference, field]));
  const medicationByReference = new Map<string, EncounterDefinition["events"]["medication"]["fields"][number]>(catalogBackedDefaults.events.medication.fields.map((field) => [field.reference, field]));
  const procedureByReference = new Map<string, ProcedureField>(Object.entries(catalogBackedDefaults.events.procedure.references).map(([field, reference]) => [reference, field as ProcedureField]));
  const vitalSummaryByField = new Map(catalogBackedDefaults.events.vitals.summary.flatMap((item) => item.fields.map((field) => [field, item] as const)));
  const procedureReferences = catalogBackedDefaults.events.procedure.references;
  const procedureMetadata = procedureElementMetadata(procedureReferences);
  const medicationFields = section("medication").elements.map((reference) => {
    const base = medicationByReference.get(reference)!;
    return { ...base, label: labels[reference] ?? base.label };
  });
  const medicationMetadata = medicationElementMetadata(medicationFields.map(({ id, reference }) => ({ id, reference })));
  const definition: EncounterDefinition = {
    ...catalogBackedDefaults, id: profile.id, version: profile.version,
    composition: {
      quickActionOrder: profile.sections.map(({ id }) => id),
      review: { groups: profile.review.groups, eventTypeOrder: profile.review.sectionOrder },
      summary: { eventTypeOrder: profile.summary.sectionOrder },
    },
    patient: { quickAction: { ...catalogBackedDefaults.patient.quickAction, visible: section("patient").visible, label: section("patient").quickActionLabel } },
    events: {
      note: { ...catalogBackedDefaults.events.note, quickAction: { visible: section("note").visible, label: section("note").quickActionLabel }, labels: { ...catalogBackedDefaults.events.note.labels, timeHelp: profile.helpText?.["eNarrative.01"] ?? catalogBackedDefaults.events.note.labels.timeHelp } },
      procedure: { ...catalogBackedDefaults.events.procedure, quickAction: { visible: section("procedure").visible, label: section("procedure").quickActionLabel }, fieldOrder: section("procedure").elements.map((reference) => procedureByReference.get(reference)!), required: procedureMetadata.required, attempts: procedureMetadata.attempts, successOptions: procedureMetadata.successOptions, outcomeOptions: procedureMetadata.outcomeOptions, complicationOptions: procedureMetadata.complicationOptions },
      medication: { ...catalogBackedDefaults.events.medication, quickAction: { visible: section("medication").visible, label: section("medication").quickActionLabel }, fields: medicationFields, doseUnits: medicationMetadata.doseUnits, routes: medicationMetadata.routes },
      vitals: { ...catalogBackedDefaults.events.vitals, quickAction: { visible: section("vitals").visible, label: section("vitals").quickActionLabel }, labels: { ...catalogBackedDefaults.events.vitals.labels, absenceHelp: profile.helpText?.["eVitals.06"] ?? catalogBackedDefaults.events.vitals.labels.absenceHelp }, fields: section("vitals").elements.map((reference) => { const base = vitalByReference.get(reference)!; return { ...base, label: labels[reference] ?? base.label, ...vitalElementMetadata(reference as `e${string}`, base.boundaries.warningLow, base.boundaries.warningHigh) }; }), summary: profile.summary.vitalOrder.map((reference) => vitalSummaryByField.get(vitalByReference.get(reference)!.id)!).filter(Boolean) },
    },
  };
  return validateEncounterDefinition(definition);
}

export const standardEncounterFormProfile = standardProfileSource as EncounterFormProfile;
export const standardEncounterDefinition = compileEncounterFormProfile(standardEncounterFormProfile);
