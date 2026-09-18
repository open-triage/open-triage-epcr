export interface HealthResponse {
  status: "ok";
  service: "open-triage-api";
}

export {
  VALIDATION_COMPILED_SCHEMA_VERSION,
  VALIDATION_LANGUAGE_VERSION,
  compileValidationRule,
  evaluateValidationBundle,
  explainValidationRule,
  formatRequiredElementSource,
  formatValidationSource,
  type CompiledValidationBundle,
  type CompiledValidationExpression,
  type CompiledValidationRule,
  type ValidationCatalog,
  type ValidationCatalogCode,
  type ValidationCatalogElement,
  type ValidationDiagnostic,
  type ValidationExecutionTarget,
  type ValidationFinding,
  type ValidationRuleSource,
  type ValidationSeverity,
} from "./validation-rules.js";

export type FeedbackSubmissionType = "bug" | "feature";

export type FeedbackDiagnosticMode = "mobile" | "stationary" | "admin";
export type FeedbackDiagnosticScreen = "calls" | "encounter" | "admin";
export type FeedbackBrowserFamily = "chromium" | "firefox" | "safari" | "other";
export type FeedbackStructuralKind =
  | "main" | "header" | "footer" | "nav" | "section" | "article" | "aside"
  | "form" | "fieldset" | "table" | "list" | "button" | "dialog" | "alert" | "status";
export type FeedbackInteractionName =
  | "feedback.opened" | "feedback.cancelled" | "feedback.type.bug.selected"
  | "feedback.type.feature.selected" | "feedback.submit.attempted"
  | "session.refresh.requested" | "session.logout.requested"
  | "presentation.mobile.selected" | "presentation.stationary.selected" | "presentation.admin.selected"
  | "draft-sync.server-conflict" | "draft-sync.validation-rejected"
  | "draft-sync.recovered" | "draft-sync.retry-exhausted";

export interface FeedbackRequestFailure {
  timestamp: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  endpointPattern: string;
  status: number;
  durationMs: number;
}

export interface FeedbackDiagnosticContext {
  schemaVersion: 1;
  appVersion: string;
  buildVersion: string;
  mode: FeedbackDiagnosticMode;
  screen: FeedbackDiagnosticScreen;
  browserFamily: FeedbackBrowserFamily;
  viewport: { width: number; height: number; category: "narrow" | "standard" | "wide" };
  connectivity: "online" | "offline";
}

export interface FeedbackDiagnosticPayload extends FeedbackDiagnosticContext {
  structure?: {
    nodes: Array<{ kind: FeedbackStructuralKind; depth: number }>;
    truncated: boolean;
  };
  interactions?: FeedbackInteractionName[];
  requestFailures?: FeedbackRequestFailure[];
}

export type FeedbackDiagnostics =
  | { status: "available"; payload: FeedbackDiagnosticPayload }
  | { status: "unavailable"; schemaVersion: 1; reason: "capture-failed" | "serialization-failed" };

export interface CreateFeedbackCommand {
  idempotencyKey: string;
  type: FeedbackSubmissionType;
  description: string;
  diagnostics: FeedbackDiagnostics;
}

export interface CreateFeedbackResponse {
  accepted: true;
  referenceCode: string;
}

export { parseInstallationSettings, type InstallationSettings } from "./installation-settings.js";
export {
  SYNTHETIC_DEMO_FIXTURE,
  type PublicInstallationConfiguration,
} from "./synthetic-demo.js";

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
  /** False when authentication succeeded but no active role opens a workspace. */
  workspaceAvailable?: boolean;
}

export interface ChangePasswordCommand {
  currentPassword: string;
  newPassword: string;
  csrfToken: string;
}

export interface EndClinicianSessionResponse {
  ended: true;
}

export interface DeleteDraftReportResponse {
  deleted: true;
  reportId: string;
}

export interface RegisterProtectedReportKeyCommand {
  schemaVersion: 1;
  recoveryHandle: string;
  reportKeyBase64: string;
}

export interface ProtectedReportKeyEnvelope {
  schemaVersion: 1;
  recoveryHandle: string;
  recoveryDeadline: string;
  wrappingKeyVersion: number;
}

export interface CheckpointProtectedReportCommand {
  schemaVersion: 1;
  recoveryHandle: string;
  ciphertextRevision: number;
  ciphertextSha256: string;
}

export type RecordProtectedCiphertextCommand = CheckpointProtectedReportCommand;

export interface ProtectedReportCheckpoint {
  ciphertextRevision: number;
  ciphertextSha256: string;
}

export interface ProtectedCiphertextReceipt {
  schemaVersion: 1;
  recoveryDeadline: string;
}

export interface CreateProtectedReportRecoveryGrantCommand {
  schemaVersion: 1;
  envelopeVersion: 1;
}

export interface ProtectedReportRecoveryGrant {
  schemaVersion: 1;
  envelopeVersion: 1;
  recoveryHandle: string;
  grant: string;
  expiresAt: string;
  /** Signed is returned only when authenticated queued late work remains. */
  reportStatus: "draft" | "signed";
}

export interface ConsumeProtectedReportRecoveryGrantCommand {
  schemaVersion: 1;
  envelopeVersion: 1;
  grant: string;
}

export interface RecoveredProtectedReportKey {
  schemaVersion: 1;
  envelopeVersion: 1;
  wrappingKeyVersion: number;
  reportKeyBase64: string;
}

export interface AdminContext {
  owner: ClinicianSession["user"];
  organization: ClinicianSession["organization"];
  /** Server-resolved current authority; Admin controls must not trust cached session claims. */
  capabilities: string[];
  activeConfiguration: {
    catalog: {
      id: string;
      name: string;
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
  panels: AdminPanelKey[];
  dashboard: {
    availableCalls: number;
    ongoingReports: number;
    signedReports: number;
    signedLast24Hours: number;
    reportsWithErrors: number;
    activeUsers: number;
    activeUnits: number;
    databaseSizeBytes: number;
    databaseConnections: number;
    maxDatabaseConnections: number;
    generatedAt: string;
  } | null;
}

export type OwnershipTransferStatus = "pending" | "accepted" | "cancelled" | "expired" | "ineligible";

export interface OwnershipTransferSummary {
  id: string;
  status: OwnershipTransferStatus;
  initiatedAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  resolutionReason: string | null;
  nominatedBy: ClinicianSession["user"];
  nominee: ClinicianSession["user"];
}

export interface OwnershipTransferState {
  owner: ClinicianSession["user"];
  currentUserIsOwner: boolean;
  currentUserIsNominee: boolean;
  transfer: OwnershipTransferSummary | null;
  eligibleNominees: ClinicianSession["user"][];
}

export interface InitiateOwnershipTransferCommand {
  nomineeUserId: string;
  note?: string;
}

export interface CancelOwnershipTransferCommand {
  note?: string;
}

export type AdminPanelKey = "dashboard" | "users" | "roles" | "catalog" | "forms" | "validation";

export interface AdminRoleSummary {
  id: string;
  displayName: string;
  active: boolean;
  protected: boolean;
}

export interface AdminAssignableRoleSummary extends AdminRoleSummary {
  /** Administrator and Demo assignments are reserved to the installation owner. */
  assignmentRestricted: boolean;
  /** Whether the current actor may add or remove this role. */
  assignmentMutable: boolean;
}

export interface AdminUserSummary {
  id: string;
  displayName: string;
  username: string;
  active: boolean;
  revision: number;
  /** True only for the installation's current accountable owner. */
  owner?: boolean;
  roles: AdminRoleSummary[];
}

export interface AdminUserPage {
  items: AdminUserSummary[];
  nextCursor: string | null;
  pageSize: number;
}

export interface ProvisionAdminUserCommand {
  username: string;
  displayName: string;
  temporaryPassword: string;
  /** Optional compatibility assertion; the server always applies the installation setting. */
  temporaryPasswordHours?: number;
  /** The complete initial role set; an empty set intentionally creates a no-workspace user. */
  roleIds: string[];
  note?: string;
}

export interface ProvisionedAdminUser {
  userId: string;
  username: string;
  displayName: string;
  roleIds: string[];
  temporaryPasswordExpiresAt: string;
}

export interface UpdateAdminUserCommand {
  expectedRevision: number;
  username: string;
  displayName: string;
  active: boolean;
  note?: string;
}

export interface UpdatedAdminUser extends AdminUserSummary {
  /** Populated on reactivation so the caller can explicitly confirm restored access. */
  restoredRoles: AdminRoleSummary[];
  sessionsRevoked: number;
  freshLoginRequired: boolean;
}

export interface AdminSessionSummary {
  id: string;
  startedAt: string;
  lastActivityAt: string;
  expiresAt: string;
  deviceLabel: string;
  current: boolean;
  owner: boolean;
}

export interface AdminSessionList {
  userId: string;
  items: AdminSessionSummary[];
}

export interface RevokeAdminSessionCommand {
  /** Required only when the selected session belongs to the installation owner. */
  confirmOwner?: boolean;
}

export interface RevokedAdminSession {
  sessionId: string;
  revoked: true;
  alreadyRevoked: boolean;
  currentSessionRevoked: boolean;
}

export interface ResetAdminCredentialCommand {
  expectedRevision: number;
  temporaryPassword: string;
  /** Optional compatibility assertion; the server always applies the installation setting. */
  temporaryPasswordHours?: number;
  note?: string;
}

export interface ResetAdminCredentialResult {
  userId: string;
  revision: number;
  active: boolean;
  temporaryPasswordExpiresAt: string;
  sessionsRevoked: number;
}

export interface PurgeAdminOfflineRecoveryCommand {
  /** A bounded operational reason; report content must never be supplied. */
  reason: string;
}

export interface PurgedAdminOfflineRecovery {
  userId: string;
  purgedEnvelopeCount: number;
  revokedGrantCount: number;
  /** Device linking is not available, so containment is user-wide. */
  appliesToAllBrowsers: true;
}

export interface AdminCapabilityDefinition {
  key: string;
  description: string;
  administrative: boolean;
  systemOnly: boolean;
}

export interface AdminRole extends AdminRoleSummary {
  description: string | null;
  version: number;
  assigneeCount: number;
  capabilities: AdminCapabilityDefinition[];
}

export interface AdminRoleList {
  items: AdminRole[];
}

export interface AdminCapabilityOption extends AdminCapabilityDefinition {
  prerequisites: string[];
  /** Whether the current actor may add or remove this capability. */
  mutable: boolean;
}

export interface AdminCapabilityCatalog {
  items: AdminCapabilityOption[];
}

export interface SaveAdminRoleCommand {
  displayName: string;
  description: string | null;
  capabilityKeys: string[];
  note?: string | null;
  /** Required when replacing an existing role's active immutable version. */
  expectedVersion?: number;
}

export interface ChangeAdminRoleStateCommand {
  expectedVersion: number;
  note?: string | null;
}

export interface AdminRoleHistory {
  roleId: string;
  versions: Array<{
    id: string;
    version: number;
    displayName: string;
    description: string | null;
    createdAt: string;
    createdBy: string | null;
    note: string | null;
    capabilityKeys: string[];
  }>;
  assignments: Array<{
    id: string;
    userId: string;
    assignedAt: string;
    assignedBy: string | null;
    endedAt: string | null;
    endedBy: string | null;
    note: string | null;
  }>;
  events: Array<{
    id: string;
    action: "role.version_activate" | "role.deactivate" | "role.reactivate";
    occurredAt: string;
    note: string | null;
    details: {
      roleId: string;
      version?: number;
      priorVersionId?: string | null;
      endedAssignmentCount?: number;
      endedAt?: string;
    };
  }>;
}

/** A credential- and personnel-free package of immutable custom-role definitions. */
export interface PortableCustomRolePackage {
  schema: "open-triage.custom-roles";
  schemaVersion: "1.0.0";
  roles: Array<{
    /** Stable role identity, preserved between installations. */
    id: string;
    currentVersionId: string;
    versions: Array<{
      /** Stable immutable-version identity, preserved between installations. */
      id: string;
      version: number;
      displayName: string;
      description: string | null;
      capabilityKeys: string[];
    }>;
  }>;
}

export interface PortableRoleImportPreview {
  schemaVersion: PortableCustomRolePackage["schemaVersion"];
  roleCount: number;
  createdRoleCount: number;
  updatedRoleCount: number;
  unchangedRoleCount: number;
  affectedAssigneeCount: number;
  capabilityChanges: Array<{
    roleId: string;
    added: string[];
    removed: string[];
    affectedAssigneeCount: number;
  }>;
}

export interface PortableRoleImportResult extends PortableRoleImportPreview {
  importedAt: string;
}

export interface AdminRoleSummaryList {
  items: AdminAssignableRoleSummary[];
}

export interface ReplaceAdminUserRolesCommand {
  expectedRevision: number;
  /** The complete desired role set. An empty set removes every retained role. */
  roleIds: string[];
  note?: string;
}

export interface UpdatedAdminUserRoles extends AdminUserSummary {
  addedRoles: AdminRoleSummary[];
  removedRoles: AdminRoleSummary[];
}

export interface ReauthenticateCommand {
  currentPassword: string;
}

export interface ReauthenticationResult {
  reauthenticatedUntil: string;
}

export interface CatalogDraftElement {
  elementId: string;
  /** Agency-editable clinical label; the stable element identity remains elementId. */
  label: string;
  identityId: string;
  baseDatatype: string;
  storageSemantics: {
    sourceDatatype: string;
    groupPath: string[];
    analyticalLocation: "wide" | "repeatable" | "unmapped";
    sqlType: string;
  };
  /** Null is optional; otherwise controls whether a missing value blocks signing or produces an acknowledgement warning. */
  requirednessSeverity: "warning" | "error" | null;
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
  classification: "defined" | "suggested" | "agency" | "inline";
  elementIds: string[];
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
  displayName?: string;
  sourceReleaseId: string;
  revision: number;
  definitionSha256: string;
  definition: CatalogDraftDefinition;
  updatedAt: string;
}

export interface CatalogDefinitionView {
  id: string;
  displayName: string;
  version: string;
  status: "active";
  definition: CatalogDraftDefinition;
}

export interface CatalogValidationResult {
  valid: boolean;
  findings: string[];
  definitionSha256: string;
  projectionsVerified: boolean;
}

export interface PublishedCatalog {
  id: string;
  displayName: string;
  status: "published";
  version: string;
  definitionSha256: string;
  publishedAt: string;
  projectionsVerified: true;
}

export interface ValidationDraft {
  id: string;
  catalogReleaseId: string;
  revision: number;
  displayName: string;
  rule: import("./validation-rules.js").ValidationRuleSource;
  updatedAt: string;
}

export interface ValidationDraftResult {
  valid: boolean;
  diagnostics: import("./validation-rules.js").ValidationDiagnostic[];
  explanation?: string;
  compiledBundle?: import("./validation-rules.js").CompiledValidationBundle;
  compiledSha256?: string;
}

export interface PublishedValidationVersion {
  id: string;
  organizationId: string;
  catalogReleaseId: string;
  version: number;
  displayName: string;
  status: "published";
  ruleId: string;
  compiledSha256: string;
  publishedAt: string;
}

export interface ValidationActivation {
  organizationId: string;
  validationVersionId: string;
  catalogReleaseId: string;
  formVersionId: string;
  activatedAt: string;
  previousValidationVersionId: string | null;
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

/** Runtime projection of the immutable form and catalog versions pinned to a report. */
export interface ClinicalFormConfiguration {
  definition: FormDraftDefinition;
  catalogFields: Record<string, {
    agencyRequired: boolean;
    requirednessSeverity?: "warning" | "error" | null;
    minOccurs: number;
    maxOccurs: number | null;
    nillable: boolean;
    supportsNotValues: boolean;
    supportsPertinentNegatives: boolean;
    codeChoices?: Array<{
      code: string;
      codeSystem: string;
      label: string;
      terminologyVersion?: string;
    }>;
  }>;
  /** Immutable live-validation bundle pinned with the report. */
  validation?: {
    versionId: string;
    bundle: import("./validation-rules.js").CompiledValidationBundle;
  };
}

export interface FormCloneDiagnostic {
  code: "missing-reference" | "disabled-reference" | "incompatible-reference";
  path: string;
  message: string;
}

export interface StationaryFormDraft {
  id: string;
  displayName?: string;
  formId: string;
  catalogReleaseId: string;
  clonedFromId: string;
  revision: number;
  definitionSha256: string;
  definition: FormDraftDefinition;
  /** Published catalog configuration used by the detached authoring preview. */
  catalogFields?: ClinicalFormConfiguration["catalogFields"];
  diagnostics: FormCloneDiagnostic[];
  updatedAt: string;
}

export interface PublishedStationaryForm {
  id: string;
  displayName: string;
  formId: string;
  catalogReleaseId: string;
  version: number;
  status: "published";
  definitionSha256: string;
  publishedAt: string;
  structuralSummary: { sections: number; fields: number; rules: number; locales: number };
}

export interface StationaryFormActivation {
  organizationId: string;
  formVersionId: string;
  formId: string;
  catalogReleaseId: string;
  activatedAt: string;
  previousFormVersionId: string | null;
  previousCatalogReleaseId: string | null;
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
  /** Immutable server deadline for generated synthetic calls. */
  expiresAt?: string;
  status: AssignmentStatus;
}

export interface AssignedCallsResponse {
  assignedCalls: AssignedCall[];
  canceledAssignmentIds: string[];
  refreshedAt: string;
}

export interface ClinicalDemoUnit {
  id: string;
  callSign: string;
  name: string;
}

export interface SyntheticCallGenerationContext {
  eligibleUnits: ClinicalDemoUnit[];
  hasUnopenedCall: boolean;
}

export interface GenerateSyntheticCallCommand {
  unitId: string;
}

export interface GenerateSyntheticCallResponse {
  assignment: AssignedCall;
  reused: boolean;
}

export interface OpenAssignmentResponse {
  assignmentId: string;
  report: {
    id: string;
    documentingUserId: string;
    formVersionId: string;
    catalogReleaseId: string;
    validationVersionId?: string;
    /** Immutable rendering and validation configuration loaded from the report's pinned versions. */
    clinicalForm?: ClinicalFormConfiguration;
    revision: number;
    status: "draft";
    /** Server-qualified boundary for Clinical Demo mutations; never inferred by the browser. */
    demoMutable?: boolean;
    /** Immutable server deadline for a generated synthetic report. */
    expiresAt?: string;
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
  demoMutable?: boolean;
  expiresAt?: string;
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
