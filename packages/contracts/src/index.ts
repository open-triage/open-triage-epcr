export type FieldType = "text" | "date" | "time" | "select" | "multiselect" | "number";

export interface OptionDefinition {
  value: string;
  label: string;
  system?: string;
}

export interface FieldDefinition {
  id: string;
  source?: { standard: "NEMSIS"; version: "3.5.1"; element: string };
  label: string;
  type: FieldType;
  required: boolean;
  options?: OptionDefinition[];
}

export interface SectionDefinition {
  id: string;
  title: string;
  fields: FieldDefinition[];
}

export interface FormDefinition {
  id: string;
  version: string;
  locale: string;
  sections: SectionDefinition[];
}

export interface HealthResponse {
  status: "ok";
  service: "open-triage-api";
}

export interface CreateClinicianSessionCommand {
  username: string;
  password: string;
}

export interface ClinicianSession {
  accessToken: string;
  user: {
    id: string;
    displayName: string;
  };
  organization: {
    id: string;
    name: string;
  };
  startedAt: string;
  expiresAt: string;
}

export interface EndClinicianSessionResponse {
  ended: true;
}

export type AssignmentStatus = "assigned";

export interface AssignedCall {
  id: string;
  callNumber: string;
  unit: {
    id: string;
    callSign: string;
  };
  dispatchedAt: string;
  dispatchReason: string | null;
  chiefComplaint: string | null;
  status: AssignmentStatus;
}

export interface AssignedCallsResponse {
  assignedCalls: AssignedCall[];
  canceledAssignmentIds: string[];
  refreshedAt: string;
}

export interface OpenAssignmentResponse {
  assignmentId: string;
  report: {
    id: string;
    documentingUserId: string;
    formVersionId: string;
    catalogReleaseId: string;
    revision: number;
    status: "draft";
  };
  replacementAssignment: AssignedCall | null;
}

export type OpenCallSyncStatus = "saved";

export interface OpenCall {
  reportId: string;
  callNumber: string;
  lastSavedAt: string;
  syncStatus: OpenCallSyncStatus;
  validationErrorCount: number;
  revision: number;
  formVersionId: string;
  catalogReleaseId: string;
}

export interface OpenCallsResponse {
  openCalls: OpenCall[];
  completedReportIds: string[];
  refreshedAt: string;
}

export interface ReopenOpenCallResponse {
  callNumber: string;
  report: OpenAssignmentResponse["report"] & {
    groups: ReadonlyArray<Record<string, unknown>>;
    occurrences: ReadonlyArray<Record<string, unknown>>;
  };
}

/**
 * Portable encounter data, deliberately independent of form and UI state.
 * Standard identities come from NEMSIS; custom identities are namespaced.
 */
export const ENCOUNTER_DOCUMENT_SCHEMA = "./encounter-document.schema-1.0.0.json" as const;
export const ENCOUNTER_DOCUMENT_TYPE = "open-triage.encounter" as const;
export const ENCOUNTER_MODEL_VERSION = "1.0.0" as const;

export type EncounterIdentity = string;
export type EncounterAttributeValue = string | number | boolean | null;
export type EncounterAttributes = Readonly<Record<string, EncounterAttributeValue>>;

type EncounterValueBase = {
  /** Stable identity for this occurrence when the element repeats. */
  readonly occurrenceId: string;
  /** XML-style NEMSIS attributes and compatible extension attributes. */
  readonly attributes?: EncounterAttributes;
  readonly [extension: string]: unknown;
};

/** Explicitly records that collection was attempted but no value is present. */
export type AbsentEncounterValue = EncounterValueBase & { readonly kind: "absent" };

/** A genuine null value, optionally carrying the NEMSIS NV code that explains it. */
export type NullEncounterValue = EncounterValueBase & {
  readonly kind: "null";
  readonly notValue?: { readonly code: string; readonly display?: string; readonly [extension: string]: unknown };
};

export type PertinentNegativeEncounterValue = EncounterValueBase & {
  readonly kind: "pertinent-negative";
  readonly code: string;
  readonly display?: string;
};

export type CodedEncounterValue = EncounterValueBase & {
  readonly kind: "coded";
  readonly code: string;
  readonly system?: string;
  readonly display?: string;
};

export type ScalarEncounterValue = EncounterValueBase & {
  readonly kind: "scalar";
  readonly value: string | number | boolean;
};

export type EncounterValue =
  | AbsentEncounterValue
  | NullEncounterValue
  | PertinentNegativeEncounterValue
  | CodedEncounterValue
  | ScalarEncounterValue;

export type EncounterElement = {
  /** Stable NEMSIS element id (e.g. eVitals.06) or namespaced custom id. */
  readonly id: EncounterIdentity;
  /** One entry per element occurrence; never sentinel strings. */
  readonly values: ReadonlyArray<EncounterValue>;
  readonly [extension: string]: unknown;
};

export type EncounterGroupInstance = {
  /** Stable identity for this occurrence when the group repeats. */
  readonly instanceId: string;
  readonly attributes?: EncounterAttributes;
  readonly elements: ReadonlyArray<EncounterElement>;
  readonly [extension: string]: unknown;
};

export type EncounterGroup = {
  /** Stable NEMSIS group id or namespaced custom group id. */
  readonly id: EncounterIdentity;
  /** One entry per group occurrence. */
  readonly instances: ReadonlyArray<EncounterGroupInstance>;
  readonly [extension: string]: unknown;
};

export type EncounterDocument = {
  readonly $schema: typeof ENCOUNTER_DOCUMENT_SCHEMA;
  readonly documentType: typeof ENCOUNTER_DOCUMENT_TYPE;
  readonly modelVersion: typeof ENCOUNTER_MODEL_VERSION;
  readonly dataModel: { readonly standard: "NEMSIS"; readonly version: string; readonly dataset: "EMSDataSet"; readonly [extension: string]: unknown };
  readonly formProfile: { readonly id: string; readonly version: string; readonly [extension: string]: unknown };
  readonly encounter: { readonly id: string; readonly createdAt: string; readonly updatedAt: string; readonly [extension: string]: unknown };
  readonly groups: ReadonlyArray<EncounterGroup>;
  /** Compatible document-level extensions are retained on load and save. */
  readonly [extension: string]: unknown;
};
