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

export { parseInstallationSettings, type InstallationSettings } from "./installation-settings.js";

export interface CreateClinicianSessionCommand {
  username: string;
  password: string;
}

export interface ClinicianSession {
  /** Present only in the static, serverless demonstration build. */
  accessToken?: string;
  /** Non-secret token echoed on cookie-authenticated state changes. */
  csrfToken?: string;
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
  passwordChangeRequired?: boolean;
  capabilities?: string[];
}

export interface ChangePasswordCommand {
  currentPassword: string;
  newPassword: string;
  csrfToken: string;
}

export interface EndClinicianSessionResponse {
  ended: true;
}

export interface AdminContext {
  owner: ClinicianSession["user"];
  organization: ClinicianSession["organization"];
  activeConfiguration: {
    catalog: {
      id: string;
      standard: string;
      version: string;
    };
    stationaryForm: {
      id: string;
      formId: string;
      name: string;
      version: number;
    };
  } | null;
}

export interface CatalogDraftElement {
  elementId: string;
  identityId: string;
  baseDatatype: string;
  storageSemantics: {
    sourceDatatype: string;
    groupPath: string[];
    analyticalLocation: "wide" | "repeatable" | "unmapped";
    sqlType: string;
  };
  agencyRequired: boolean;
  constraints: {
    minOccurs: number;
    maxOccurs: number | null;
    nillable: boolean;
    supportsNotValues: boolean;
    supportsPertinentNegatives: boolean;
  };
}

export interface CatalogDraftCodeValue {
  code: string;
  codeSystem: string;
  label: string;
  sourceLabel: string;
  category: string | null;
  enabled: boolean;
}

export interface CatalogDraftCodeList {
  listId: string;
  name: string;
  classification: "suggested" | "agency";
  values: CatalogDraftCodeValue[];
  defaultValue: { code: string; codeSystem: string } | null;
}

export interface CatalogDraftDefinition {
  schemaVersion: 1;
  sourceReleaseId: string;
  elements: CatalogDraftElement[];
  codeLists: CatalogDraftCodeList[];
}

export interface CatalogDraft {
  id: string;
  sourceReleaseId: string;
  revision: number;
  definitionSha256: string;
  definition: CatalogDraftDefinition;
  updatedAt: string;
}

export interface CatalogValidationResult {
  valid: boolean;
  findings: string[];
  definitionSha256: string;
  projectionsVerified: boolean;
}

export interface PublishedCatalog {
  id: string;
  status: "published";
  version: string;
  definitionSha256: string;
  publishedAt: string;
  projectionsVerified: true;
}

export interface FormDraftRule {
  kind: "visibility" | "requiredness";
  expression: Record<string, unknown>;
}

export interface FormDraftField {
  key: string;
  source: { kind: "nemsis"; elementId: string } |
    { kind: "custom"; elementDefinitionId: string; groupDefinitionId?: string };
  required?: boolean;
  allowedAbsenceStates?: string[];
  configuration?: Record<string, unknown>;
  rules?: FormDraftRule[];
}

export interface FormDraftDefinition {
  schemaVersion: 1;
  sections: Array<{ key: string; presentation?: Record<string, unknown>; fields: FormDraftField[] }>;
  locales?: Array<{ locale: string; translations: Record<string, unknown> }>;
}

export interface FormCloneDiagnostic {
  code: "missing-reference" | "disabled-reference" | "incompatible-reference";
  path: string;
  message: string;
}

export interface StationaryFormDraft {
  id: string;
  formId: string;
  catalogReleaseId: string;
  clonedFromId: string;
  revision: number;
  definitionSha256: string;
  definition: FormDraftDefinition;
  diagnostics: FormCloneDiagnostic[];
  updatedAt: string;
}

export interface FormCatalogElement {
  elementId: string;
  name: string;
  description: string;
  baseDatatype: string;
  groupPath: string[];
}

export interface FormCatalogElementPage {
  items: FormCatalogElement[];
  nextOffset: number | null;
}

export type AssignmentStatus = "assigned";

export interface DispatchPriority {
  code: string;
  display: string;
}

export interface AssignedCall {
  id: string;
  callNumber: string;
  unit: {
    id: string;
    callSign: string;
  };
  dispatchedAt: string;
  dispatchReason: string | null;
  dispatchPriority: DispatchPriority | null;
  chiefComplaint: string | null;
  /** IANA zone used for operational-time presentation. */
  agencyTimeZone?: string;
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
    /** Complete server-authoritative encounter content, including fields hidden by the active form. */
    document: EncounterDocument;
    /** IANA zone used for operational-time presentation. */
    agencyTimeZone?: string;
    dispatchConflicts?: ReadonlyArray<DispatchConflict>;
    dispatchCancellation?: DispatchCancellation | null;
  };
  replacementAssignment: AssignedCall | null;
}

export interface DispatchCancellation {
  canceledAt: string;
  dispatchRevision: number;
  receiptId: string;
}

export type DispatchConflictDisposition = "keep" | "accept" | "acknowledge";

export interface DispatchConflict {
  id: string;
  occurrenceId: string;
  elementId: string;
  clinicianValue: EncounterValue | null;
  dispatchValue: EncounterValue | null;
  dispatchRevision: number;
  receiptId: string;
  disposition: DispatchConflictDisposition | null;
  createdAt: string;
  resolvedAt?: string | null;
}

export interface ResolveDispatchConflictCommand {
  commandId: string;
  disposition: DispatchConflictDisposition;
}

export type OpenCallSyncStatus = "saved" | "pending";

export interface OpenCall {
  reportId: string;
  callNumber: string;
  dispatchedAt?: string;
  dispatchReason?: string | null;
  dispatchPriority?: DispatchPriority | null;
  chiefComplaint?: string | null;
  unitCallSign?: string;
  agencyTimeZone?: string;
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
  dispatchedAt?: string;
  dispatchReason?: string | null;
  dispatchPriority?: DispatchPriority | null;
  chiefComplaint?: string | null;
  unitCallSign?: string;
  report: OpenAssignmentResponse["report"];
}

/** Conditional representation used while a clinician has a draft open. */
export interface ActiveReportResource {
  reportId: string;
  /** Clinical report revision, advanced by clinician saves and dispatch merges. */
  reportRevision: number;
  /** Latest complete dispatch snapshot revision applied to the assignment. */
  dispatchRevision: number;
  document: EncounterDocument;
  dispatchConflicts: ReadonlyArray<DispatchConflict>;
  dispatchCancellation: DispatchCancellation | null;
}

/**
 * Portable encounter data, deliberately independent of form and UI state.
 * Standard identities come from NEMSIS; custom identities are namespaced.
 */
export const ENCOUNTER_DOCUMENT_SCHEMA = "./encounter-document.schema-1.0.0.json" as const;
export const ENCOUNTER_DOCUMENT_TYPE = "open-triage.encounter" as const;
export const ENCOUNTER_MODEL_VERSION = "1.1.0" as const;

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
  /** Version of the terminology or bundled suggestion set used to choose the code. */
  readonly terminologyVersion?: string;
};

export type ScalarEncounterValue = EncounterValueBase & {
  readonly kind: "scalar";
  readonly value: string | number | boolean;
  /** Exact user-entered spelling for numeric and duration values. */
  readonly lexical?: string;
  /** Supported source precision (for example day, minute, second, or fractional digits). */
  readonly precision?: string;
  /** Original explicit UTC offset. This prevents offset-aware values changing on reopen. */
  readonly utcOffsetMinutes?: number;
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
  /** Stable identity of the containing group occurrence for nested NEMSIS groups. */
  readonly parentInstanceId?: string;
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
