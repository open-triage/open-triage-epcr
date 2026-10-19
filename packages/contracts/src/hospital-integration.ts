import type { ClinicalFormConfiguration, EncounterDocument, FormDraftField } from './index.js';

/** Portable field identity; never a form control key or localized label. */
export type HospitalField = FormDraftField['source'];
export const DEFAULT_HOSPITAL_PATIENT_FIELD: HospitalField = { kind: 'nemsis', elementId: 'ePatient.01' };
export type HospitalIdentifier = { field: HospitalField; namespace: string; aliases: string[] };
export type HospitalMappingDefinition = {
  schemaVersion: 1;
  id: string;
  revision: number;
  authoredAt: string;
  author: string;
  profile: { package: 'hl7.fhir.eu.eps'; version: '1.0.0-ballot'; fhirVersion: '4.0.1' };
  patientIdentifier: HospitalIdentifier;
  clinicalMappings?: EpsClinicalMapping[];
  outputMappings?: EpsOutputMapping[];
};
export type HospitalIdentifierFinding = 'unavailable' | 'incompatible' | 'missing' | 'ambiguous';
export type HospitalIdentifierResult = { identifier: { system: string; value: string }; finding: null } |
  { identifier: null; finding: HospitalIdentifierFinding };
export function hospitalFieldId(field: HospitalField): string {
  return field.kind === 'nemsis' ? field.elementId : field.elementDefinitionId;
}
/** The caller supplies the authorized draft or effective signed version and its pinned form.
 * This pure resolver grants no report access and does not consult current agency defaults. */
export function resolveHospitalIdentifier(configuration: HospitalIdentifier, document: EncounterDocument,
  form: ClinicalFormConfiguration): HospitalIdentifierResult {
  const fail = (finding: HospitalIdentifierFinding): HospitalIdentifierResult => ({ identifier: null, finding });
  const id = hospitalFieldId(configuration.field);
  const fields = form.definition.sections.flatMap(section => section.fields).filter(field =>
    field.source.kind === configuration.field.kind && hospitalFieldId(field.source) === id);
  if (!fields.length) return fail('unavailable');
  const custom = configuration.field.kind === 'custom' ? form.customFields?.[id] : undefined;
  const standard = configuration.field.kind === 'nemsis' ? form.catalogFields[id] : undefined;
  if (!custom && !standard || custom?.retired) return fail('unavailable');
  if (custom ? custom.datatype !== 'string' : standard?.generation?.base !== 'string' ||
      standard.generation.definition.valueSource?.kind !== 'scalar') return fail('incompatible');
  const values = document.groups.flatMap(group => group.instances.flatMap(instance => instance.elements))
    .filter(element => element.id === (custom ? `${custom.namespace}.${custom.slug}` : id)).flatMap(element => element.values);
  if (!values.length) return fail('missing');
  if (values.length !== 1) return fail('ambiguous');
  const value = values[0]!;
  if (value.notValue || value.pertinentNegative || value.kind === 'absent' || value.kind === 'null') return fail('missing');
  if (value.kind !== 'scalar' || typeof value.value !== 'string') return fail('incompatible');
  // Do not coerce numbers or discard meaningful separators/leading zeroes.
  if (!value.value.trim()) return fail('missing');
  return { identifier: { system: configuration.namespace, value: value.value }, finding: null };
}
export function hospitalIdentifiersMatch(configuration: HospitalIdentifier, local: { system: string; value: string }, remote: { system: string; value: string }): boolean {
  const systems = new Set([configuration.namespace, ...configuration.aliases]);
  return systems.has(local.system) && systems.has(remote.system) && local.value === remote.value;
}

/** COS portable mappings exclude endpoints, credentials and local identity assignments. */
export type CosMappingDefinition = Omit<HospitalMappingDefinition, 'profile' | 'clinicalMappings'> & {
  profile: { package: 'cambio.cos.prehospital'; version: '2.0.0'; fhirVersion: '4.0.1';
    bundle: 'https://fhir.cambio.se/StructureDefinition/BundlePrehospitalNote/v2';
    questionnaire: 'https://fhir.cambio.se/StructureDefinition/QuestionnaireResponsePreHospitalNote/v2' };
  pdfLinkId?: string;
  clinicalMappings: { id: string; source: HospitalField; linkId: string; answerType: 'string' | 'decimal' | 'boolean' | 'dateTime' }[];
};
export type CosConnectionSettings = {
  mode: 'simulator' | 'live'; authentication: 'api-key' | 'bearer-token';
  template: string; encounterNamespace: string; organizationHsaId: string;
  defaultAmbulanceCareUnit: string;
  staff: { userId: string; hsaId: string }[];
  careUnits: { hospital: string; localCareUnit: string; hsaId: string }[];
};

/** Exact source coding; text preserves the source facts, coded never translates terminology. */
export type EpsClinicalMapping = {
  id: string;
  resourceType: 'AllergyIntolerance' | 'Condition' | 'MedicationStatement' | 'Observation' | 'Procedure' | 'Patient';
  semanticRole?: 'medication-history' | 'historical-observation' | 'historical-procedure' | 'patient-identifier';
  expectedUnit?: { system: string; code: string };
  system: string;
  code: string;
  destination: HospitalField;
  representation: 'text' | 'coded';
};
export type EpsImportRow = {
  entryId: string; label: string; destination: string | null;
  finding: string | null; mappingId: string | null;
};
export type EpsImportPlan = {
  id: string; revision: number; destination: string; incoming: string;
  proposedValue?: string; existing: string[]; conflict: boolean; alreadyImported: boolean; canAppend?: boolean;
};

/** Explicit narrative projection; no inferred code translations or current-treatment assertions. */
export type EpsOutputMapping = { id: string; source: HospitalField; section: 'problems' | 'allergies' | 'medications' | 'procedures' | 'devices' | 'patientStory' | 'patientHistory'; representation: 'signed-narrative' };
