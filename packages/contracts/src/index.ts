export { SUPPORTED_UI_LANGUAGES, isSupportedUiLanguage } from "./ui-languages.generated.js";

export interface HealthResponse {
  status: "ok";
  service: "open-triage-api";
}

export {
  VALIDATION_COMPILED_SCHEMA_VERSION,
  VALIDATION_LANGUAGE_VERSION,
  compileValidationRule,
  compiledValidationBundleSha256,
  evaluateValidationBundle,
  evaluateValidationBundleSafely,
  explainValidationRule,
  formatOccurrenceSource,
  formatRequiredElementSource,
  formatValidationSource,
  isNemsisDemographicElementId,
  minimumRuleCoversRequirement,
  repairNemsisImportedMessage,
  reviewPriorityOfRule,
  validationRuleText,
  type CompiledValidationBundle,
  type CompiledValidationExpression,
  type CompiledValidationRule,
  type ValidationCatalog,
  type ValidationCatalogCode,
  type ValidationCatalogElement,
  type ValidationCatalogGroup,
  type ValidationDiagnostic,
  type ValidationEvaluationContext,
  type ValidationExecutionTarget,
  type ValidationFinding,
  type ValidationEvaluationResult,
  type ValidationRuntimeFailure,
  type ValidationRuleSource,
  type ValidationRuleProvenance,
  type ValidationRuleSourceKind,
  type ValidationSeverity,
  type ValidationReviewPriority,
  ValidationCompatibilityError,
  ValidationResourceLimitError,
} from "./validation-rules.js";
export {
  NEMSIS_351_EMS_BUILD,
  NEMSIS_351_EMS_RELEASE,
  NemsisSchematronCompatibilityError,
  compareNemsisFixtureParity,
  importNemsisEmsSchematron,
  nemsisTargetCandidates,
  type ImportedNemsisRule,
  type ImportedNemsisRuleset,
  type NemsisAssertionSource,
  type NemsisCompatibilityProblem,
  type NemsisCompatibilityReport,
  type NemsisControlAccounting,
  type NemsisFixtureOutcome,
  type NemsisFixtureParityMismatch,
  type NemsisNormalizationTable,
  type NemsisRuleNormalization,
  type NemsisRuleProvenance,
} from "./nemsis-schematron-import.js";
export {
  NEMSIS_351_EMS_NORMALIZATIONS,
  NEMSIS_351_EMS_MESSAGE_REPAIRS,
  NEMSIS_351_EMS_LEGACY_CONTEXT_GUARDS,
  NEMSIS_351_EMS_SOURCE_SHA256,
} from "./nemsis-3.5.1-ems.generated.js";

export type FeedbackSubmissionType = "bug" | "feature";

export type FeedbackDiagnosticMode = "mobile" | "stationary" | "admin" | "review";
export type FeedbackDiagnosticScreen = "calls" | "encounter" | "admin" | "review";
export type FeedbackBrowserFamily = "chromium" | "firefox" | "safari" | "other";
export type FeedbackStructuralKind =
  | "main" | "header" | "footer" | "nav" | "section" | "article" | "aside"
  | "form" | "fieldset" | "table" | "list" | "button" | "dialog" | "alert" | "status";
export type FeedbackInteractionName =
  | "feedback.opened" | "feedback.cancelled" | "feedback.type.bug.selected"
  | "feedback.type.feature.selected" | "feedback.submit.attempted"
  | "session.refresh.requested" | "session.logout.requested"
  | "presentation.mobile.selected" | "presentation.stationary.selected" | "presentation.admin.selected"
  | "presentation.review.selected"
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

export interface ReviewQueueItem {
  id: string;
  reportId: string;
  criterionId: string;
  priority: "high" | "medium" | "low";
  status: "new" | "in-review" | "awaiting-clinician" | "completed";
  outcome: { optionId: string; revision: number; label: string; meaning: string } | null;
  assigneeId: string | null;
  version: number;
  recoveryReason?: string | null;
  firstMatchedAt: string;
  reportingDate: string;
  signedAt: string;
  findings: import("./validation-rules.js").ValidationFinding[];
}

export interface ReviewAssignmentEvent {
  commandId: string;
  actorId: string | null;
  assigneeId: string | null;
  previousAssigneeId?: string | null;
  action?: "claimed" | "assigned" | "routed" | "recovered";
  reason?: string | null;
  itemVersion: number;
  assignedAt: string;
}

export interface ReviewCriterionRoute {
  criterionId: string;
  name: string;
  route: "unassigned" | "author" | "named";
  namedUserId: string | null;
  version: number;
  recoveryReason: string | null;
}

export interface ReviewEligibleReviewer {
  id: string;
  displayName: string;
}

export interface ConfigureReviewRouteCommand {
  commandId: string;
  expectedVersion: number;
  route: "unassigned" | "author" | "named";
  namedUserId: string | null;
}

export interface AssignReviewItemCommand {
  commandId: string;
  expectedVersion: number;
  dataset: "real" | "synthetic";
  assigneeId: string | null;
}

export interface ReviewItemDetail extends ReviewQueueItem {
  assignmentHistory: ReviewAssignmentEvent[];
  progressHistory: Array<{ commandId: string; actorId: string; itemVersion: number;
    status: ReviewQueueItem["status"]; outcome: ReviewQueueItem["outcome"]; recordedAt: string }>;
}

export interface ClaimReviewItemCommand {
  commandId: string;
  expectedVersion: number;
  dataset: "real" | "synthetic";
}

export interface ReviewProgressCommand extends ClaimReviewItemCommand {
  status: "in-review" | "awaiting-clinician" | "completed";
  outcomeOptionId?: string;
}

export interface ReviewOutcomeOption {
  id: string; revision: number; label: string; meaning: string; active: boolean;
}

export interface ReviewOutcomeCommand {
  commandId: string;
  optionId?: string;
  expectedRevision?: number;
  label: string;
  meaning: string;
  active: boolean;
}

export interface ReviewQueueResponse {
  dataset: "real" | "synthetic";
  page: number;
  pageSize: number;
  total: number;
  asOf: string;
  items: ReviewQueueItem[];
}

export interface ReviewSignedReportSummary {
  id: string;
  reportingDate: string;
  signedAt: string;
  documentingClinician?: string;
}

export interface ReviewSignedReportsResponse {
  dataset: "real" | "synthetic";
  scope: "own" | "all";
  identifying: boolean;
  administrator: boolean;
  page: number;
  pageSize: number;
  total: number;
  asOf: string;
  reports: ReviewSignedReportSummary[];
}

export interface ReviewReportValue {
  id: string;
  elementId: string;
  label: string;
  groupInstanceId: string | null;
  ordinal: number;
  valueKind: string;
  value: string | number | boolean | null;
  codeDisplay?: string | null;
  absenceDisplay?: string | null;
}

export interface ReviewReportGroup {
  id: string;
  parentGroupInstanceId: string | null;
  groupId: string;
  label: string;
  ordinal: number;
}

export interface ReviewSignedReport {
  id: string;
  reportingDate: string;
  signedAt: string;
  amendmentSequence: number;
  identifying: boolean;
  groups: ReviewReportGroup[];
  values: ReviewReportValue[];
  notes: ReportNote[];
  reviewItems?: Array<{ id: string; criterionId: string; status: ReviewQueueItem["status"];
    outcome: ReviewQueueItem["outcome"] }>;
}

export interface ReviewVolumeDefinition {
  measure: "signed-report-count";
  grouping: "day";
  filters: {
    from: string;
    to: string;
    dataset: "real" | "synthetic";
  };
}

export interface ReviewVolumeResult {
  definition: ReviewVolumeDefinition;
  population: {
    unit: "patient-report";
    scope: "own" | "all";
    organizationId: string;
    signedOnly: true;
  };
  freshness: {
    observedAt: string;
    targetSeconds: 300;
    status: "current" | "stale";
    oldestBacklogSeconds: number | null;
    replicaLagSeconds: number | null;
  };
  total: number | null;
  points: Array<{ date: string; count: number }>;
}

export interface ReviewAnalysisField {
  id: string;
  label: string;
  kind: "categorical" | "numeric";
  unit: string | null;
  repeating?: boolean;
  operations: Array<"distribution" | "mean" | "median" | "minimum" | "maximum">;
  source?: "custom" | "operational-time";
  /** Canonical signed ePCR timestamps. Duration is computed in elapsed minutes. */
  interval?: { start: string; end: string; eligibility: "signed-patient-reports" };
  unsupportedReason?: string;
}

export interface ReviewAnalysisDefinition {
  fieldId: string;
  operation: "distribution" | "mean" | "median" | "minimum" | "maximum";
  groupBy?: string;
  /** Required for repeated numeric fields. */
  reducer?: "first" | "last" | "minimum" | "maximum";
  /** Unit code for repeated medication dosage; no cross-unit arithmetic. */
  unit?: string;
  filters: {
    from: string;
    to: string;
    dataset: "real" | "synthetic";
    field?: { id: string; value: string };
  };
}

export interface ReviewAnalysisResult {
  definition: ReviewAnalysisDefinition;
  field: ReviewAnalysisField;
  population: ReviewVolumeResult["population"];
  freshness: ReviewVolumeResult["freshness"];
  /** Effective occurrence values and identity retained for an eventual underlying-record export. */
  sources?: Array<{ reportId: string; group: string | null; value: string[] | number | null;
    unit: string | null; occurrenceIds: string[]; groupInstanceIds: string[];
    selectedOccurrenceId?: string; orderMode?: "clinical-time" | "occurrence-order";
    sourceValues: Array<{ occurrenceId: string; groupId: string | null; groupInstanceId: string | null;
      parentGroupInstanceId: string | null; value: string | number | null;
      unit: string | null; clinicalTime: string | null; documentedTime: string | null;
      absenceKind: string | null; absenceCode: string | null;
      normalizationRuleId: string | null; qualityFlags: string[];
      elementIdentityId?: string; customDefinitionId?: string;
      catalogReleaseId?: string; effectiveAmendmentSequence?: number;
      groupPath?: string[]; instancePath?: string[];
      groupOrdinal?: number | null; elementOrdinal?: number | null;
      correlationId?: string | null; groupCorrelationId?: string | null }> }>;
  groups: Array<{
    group: string | null;
    denominator: number;
    missing: number;
    absent: number;
    /** Present for operational time: both endpoints exist but end precedes start. */
    invalid?: number;
    values: Array<{ value: string | null; count: number; percentage: number }>;
    summary: number | null;
  }>;
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
  localRecordId?: string;
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

export const DEFAULT_REPORT_MEDIA_ALLOWANCE_BYTES = 50 * 1024 * 1024;
export const DEFAULT_IMAGE_MEDIA_LIMIT_BYTES = 10 * 1024 * 1024;
export const MIN_REPORT_MEDIA_ALLOWANCE_BYTES = 1024 * 1024;
export const MAX_REPORT_MEDIA_ALLOWANCE_BYTES = 2 * 1024 * 1024 * 1024;

export interface AgencyAppearance {
  brandText: string;
  helperText: string;
  logoPngDataUrl: string | null;
  accentColor: string;
  accentDarkColor: string;
  browserThemeColor: string;
  pwaBackgroundColor: string;
  pwaName: string;
  pwaShortName: string;
}

export const DEFAULT_AGENCY_APPEARANCE: Readonly<AgencyAppearance> = Object.freeze({
  brandText: "OpenTriage ePCR",
  helperText: "Demo credentials: username **demo**, password **opentriagedemo**",
  logoPngDataUrl: null,
  accentColor: "#00783a",
  accentDarkColor: "#006b34",
  browserThemeColor: "#00783a",
  pwaBackgroundColor: "#dfe5df",
  pwaName: "OpenTriage",
  pwaShortName: "OpenTriage",
});

export interface AgencyDemographics {
  versionId: string;
  version: number;
  catalogReleaseId: string;
  agencyUniqueStateId: string;
  agencyNumber: string;
  stateCode: string;
  stateDisplay: string | null;
  stateCodeSystem: string | null;
  stateTerminologyVersion: string | null;
  effectiveFrom: string;
}

/** Policy identity captured by clients and pinned onto each new report. */
export interface ReportMediaPolicy {
  reportMediaAllowanceBytes: number;
  imageMediaLimitBytes: number;
  settingsRevision: number;
}

export interface AgencyMediaSettings {
  organizationId: string;
  language: string;
  regionalFormat: "en-US" | "sv-SE" | null;
  timeZone: string | null;
  reportMediaAllowanceBytes: number;
  imageMediaLimitBytes: number;
  appearance: AgencyAppearance;
  demographics: AgencyDemographics;
  revision: number;
  defaultReportMediaAllowanceBytes: number;
  defaultImageMediaLimitBytes: number;
  /** True when Postgres, WAL, replica, backup, and restore growth needs review. */
  storageGrowthWarning: boolean;
  updatedAt: string;
}

export interface UpdateAgencyMediaSettingsCommand {
  expectedRevision: number;
  language: string;
  regionalFormat?: "en-US" | "sv-SE" | null;
  timeZone?: string | null;
  reportMediaAllowanceBytes: number;
  imageMediaLimitBytes: number;
  appearance: AgencyAppearance;
  demographics: Pick<AgencyDemographics,
    "agencyUniqueStateId" | "agencyNumber" | "stateCode" | "stateDisplay" |
    "stateCodeSystem" | "stateTerminologyVersion">;
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

export type AdminPanelKey = "dashboard" | "users" | "roles" | "catalog" | "forms" | "validation" | "settings";

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
  /** English source description; optional for legacy catalogs. */
  description?: string;
  /** Translation and English source values recorded at review time. */
  localization?: { schemaVersion: 1; sv?: {
    label?: string; description?: string;
    reviewedSource?: { label?: string; description?: string };
  } };
  specialChoices?: Array<{ kind: "not-value" | "pertinent-negative"; code: string; label: string;
    localization?: { schemaVersion: 1; sv?: { label?: string; reviewedSource?: { label: string } } } }>;
  identityId: string;
  baseDatatype: string;
  storageSemantics: {
    sourceDatatype: string;
    groupPath: string[];
    analyticalLocation: "wide" | "repeatable" | "unmapped";
    sqlType: string;
  };
  /** @deprecated Read-only legacy projection. Requiredness is authored as a Validation rule. */
  requirednessSeverity: "warning" | "error" | null;
  constraints: {
    /** Read-only intrinsic catalog structure. Documented occurrence policy is authored in Validation. */
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
  /** Existing NEMSIS code used when a local extension value is transmitted. */
  nemsisCode?: string;
  localization?: { schemaVersion: 1; sv?: { label?: string; reviewedSource?: { label: string } } };
}

export interface CatalogDraftCodeList {
  listId: string;
  name: string;
  classification: "defined" | "suggested" | "agency" | "inline";
  elementIds: string[];
  localization?: { schemaVersion: 1; sv?: { name?: string; reviewedSource?: { name: string } } };
  values: CatalogDraftCodeValue[];
  /** Inert legacy metadata, retained for lossless compatibility; not an authoring setting. */
  defaultValue?: { code: string; codeSystem: string } | null;
}

export interface CatalogDraftDefinition {
  schemaVersion: 1;
  sourceReleaseId: string;
  /** Elements retained for NEMSIS export but hidden from a regional authoring profile. */
  hiddenElementIds?: string[];
  elements: CatalogDraftElement[];
  codeLists: CatalogDraftCodeList[];
  customElements?: CatalogDraftCustomElement[];
  customGroups?: CatalogDraftCustomGroup[];
}

/** A flat grouping identity shared by related custom element definitions. */
export interface CatalogDraftCustomGroup {
  id: string;
  namespace: string;
  slug: string;
  title: string;
  recurrence: "single" | "multiple";
  correlatesTo?: string;
  localization?: { schemaVersion: 1; sv?: { label: string; reviewedSource: { label: string } } };
}

/** A scalar extension owned by one organization. A target binds values to a stable group instance. */
export interface CatalogDraftCustomTextElement {
  id: string;
  namespace: string;
  slug: string;
  title: string;
  definition: string;
  datatype: "string" | "number" | "dateTime" | "boolean" | "binary" | "other";
  recurrence: "single" | "multiple";
  /** Repeated group in the pinned NEMSIS catalog; omission places the field at report root. */
  correlatesTo?: string;
  /** eCustomConfiguration.09 grouping identity; independent of visual form sections. */
  groupDefinitionId?: string;
  usage: "Mandatory" | "Required" | "Recommended" | "Optional";
  constraints: { minLength?: number; maxLength?: number; pattern?: string; minimum?: number; maximum?: number };
  identifying: boolean | null;
  /** Retired in this catalog version; historical pinned forms remain readable. */
  retired?: boolean;
  localization?: CatalogDraftElement["localization"];
}

/** Local codes are identified by their own system and code; NEMSIS mappings are annotations. */
export interface CatalogDraftCustomCodedElement extends Omit<CatalogDraftCustomTextElement, "datatype" | "constraints"> {
  datatype: "coded";
  codeSystem: string;
  choices: Array<{ code: string; label: string; localization?: CatalogDraftCodeValue["localization"];
    nemsisCode?: string }>;
  nemsisElement?: string;
  permittedNotValues: string[];
  permittedPertinentNegatives: string[];
}

export type CatalogDraftCustomElement = CatalogDraftCustomTextElement | CatalogDraftCustomCodedElement;

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
  status: "active" | "published";
  definition: CatalogDraftDefinition;
}

export interface AuthoringVersionOption {
  id: string;
  displayName: string;
  version: string | number;
  status: "published" | "active";
  catalogReleaseId?: string;
}

export interface CatalogValidationResult {
  valid: boolean;
  findings: string[];
  warnings?: string[];
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
  clonedFromId: string | null;
  revision: number;
  displayName: string;
  rules: import("./validation-rules.js").ValidationRuleSource[];
  /** Catalog-upgrade diagnostics are populated when cloning a published version. */
  diagnostics?: import("./validation-rules.js").ValidationDiagnostic[];
  updatedAt: string;
}

export interface ValidationDraftResult {
  valid: boolean;
  diagnostics: import("./validation-rules.js").ValidationDiagnostic[];
  explanation?: string;
  compiledBundle?: import("./validation-rules.js").CompiledValidationBundle;
  compiledSha256?: string;
}

export interface ValidationRuleLibraryItem {
  rule: import("./validation-rules.js").ValidationRuleSource;
  source: import("./validation-rules.js").ValidationRuleSourceKind;
  validity: "valid" | "invalid";
  diagnostics: import("./validation-rules.js").ValidationDiagnostic[];
}

export interface ValidationRulePage {
  items: ValidationRuleLibraryItem[];
  nextCursor: string | null;
  total: number;
}

export interface PublishedValidationVersion {
  id: string;
  organizationId: string;
  catalogReleaseId: string;
  version: number;
  displayName: string;
  status: "published";
  ruleIds: string[];
  sourceSha256: string;
  compiledSha256: string;
  publishedAt: string;
}

export interface ValidationRuleChanges {
  additions: Array<{ ruleId: string; name: string }>;
  modifications: Array<{ ruleId: string; fields: string[] }>;
  disablements: Array<{ ruleId: string }>;
  executionTargetChanges: Array<{ ruleId: string; before: import("./validation-rules.js").ValidationExecutionTarget[];
    after: import("./validation-rules.js").ValidationExecutionTarget[] }>;
}

export interface ValidationHistoryEvent {
  id: string;
  actorId: string;
  action: "validation.publish" | "validation.activate";
  sourceVersionId: string | null;
  destinationVersionId: string;
  catalogReleaseId: string;
  changeNote: string;
  ruleChanges: ValidationRuleChanges;
  sourceSha256: string | null;
  compiledSha256: string;
  occurredAt: string;
}

export interface ValidationActivation {
  organizationId: string;
  validationVersionId: string;
  catalogReleaseId: string;
  formVersionId: string;
  formDefinitionSha256: string;
  catalogArtifactSha256: string;
  validationCompiledSha256: string;
  activatedAt: string;
  previousFormVersionId: string | null;
  previousCatalogReleaseId: string | null;
  previousValidationVersionId: string | null;
}

export interface ValidationReviewFailure {
  validationVersionId: string;
  ruleId: string;
  executionTarget: "review";
  code: "integrity" | "compatibility" | "resource-limit" | "runtime";
  message: string;
}

/** Immutable result of evaluating one current report with one selected published version. */
export interface ValidationReviewEvaluation {
  id: string;
  reportId: string;
  reportRevision: number;
  validationVersionId: string;
  validationCompiledSha256: string;
  evaluatedBy: string;
  outcome: "passed" | "findings" | "failed";
  findings: import("./validation-rules.js").ValidationFinding[];
  failures: ValidationReviewFailure[];
  evaluatedAt: string;
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
  /** Ordered choices enabled for this field. Omission preserves a legacy published form's catalog behavior. */
  choicePolicy?: Array<{ kind: "code"; code: string; codeSystem: string } | { kind: "not-value"; code: string }>;
  rules?: FormDraftRule[];
}

export interface FormDraftDefinition {
  schemaVersion: 1;
  sections: Array<{ key: string; name?: string; fields: FormDraftField[] }>;
}

/** Runtime projection of the immutable form and catalog versions pinned to a report. */
export interface ClinicalFormConfiguration {
  customFields?: Record<string, CatalogDraftCustomElement>;
  customGroups?: Record<string, CatalogDraftCustomGroup>;
  /** Group wording from the same immutable catalog as the fields. */
  catalogGroups?: Record<string, { name: string; localization?: {
    schemaVersion: 1; sv?: { name: string; reviewedSource?: { name: string } };
  } }>;
  definition: FormDraftDefinition;
  catalogFields: Record<string, {
    /** Effective unified order for enabled codes and NOT values on a field. */
    choiceOrder?: NonNullable<FormDraftField["choicePolicy"]>;
    name?: string;
    description?: string;
    localization?: CatalogDraftElement["localization"];
    agencyRequired: boolean;
    /** Source NEMSIS usage from the pinned catalog release. */
    usage?: string;
    requirednessSeverity?: "warning" | "error" | null;
    minOccurs: number;
    maxOccurs: number | null;
    nillable: boolean;
    supportsNotValues: boolean;
    supportsPertinentNegatives: boolean;
    exceptionalChoices?: Array<{ key: string; localization?: CatalogDraftCodeValue["localization"] }>;
    codeChoices?: Array<{
      code: string;
      codeSystem: string;
      label: string;
      nemsisCode?: string;
      sourceLabel?: string;
      localization?: CatalogDraftCodeValue["localization"];
      terminologyVersion?: string;
    }>;
  }>;
  /** Immutable live-validation bundle pinned with the report. */
  validation?: {
    versionId: string;
    compiledSha256: string;
    bundle: import("./validation-rules.js").CompiledValidationBundle;
  };
}

export interface FormCloneDiagnostic {
  code: "missing-reference" | "disabled-reference" | "incompatible-reference" | "retired-reference";
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
  customFields?: ClinicalFormConfiguration["customFields"];
  customGroups?: ClinicalFormConfiguration["customGroups"];
  catalogGroups?: ClinicalFormConfiguration["catalogGroups"];
  diagnostics: FormCloneDiagnostic[];
  /** Codes newly available in the target catalog, by stable form field key. They start disabled in choicePolicy. */
  adoption?: { sourceCatalogReleaseId: string; newChoicesByField: Record<string, NonNullable<FormDraftField["choicePolicy"]>> };
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
  structuralSummary: { sections: number; fields: number; rules: number };
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
  customElementDefinitionId?: string;
  customGroupDefinitionId?: string;
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
  /** Present on live API responses; optional only for pre-feature cached/static fixtures. */
  mediaPolicy?: ReportMediaPolicy;
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
    /** Immutable report-pinned source integrity metadata; absent on older report records. */
    formDefinitionSha256?: string;
    catalogArtifactSha256?: string;
    validationCompiledSha256?: string;
    /** Present on live API responses; optional only while restoring pre-feature offline records. */
    mediaPolicy?: ReportMediaPolicy;
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
    /** App-native notes are intentionally outside the NEMSIS encounter document. */
    notes?: ReadonlyArray<ReportNote>;
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
  notes?: ReadonlyArray<ReportNote>;
  /** Current agency policy used for captures begun after this snapshot. */
  mediaPolicy?: ReportMediaPolicy;
  dispatchConflicts: ReadonlyArray<DispatchConflict>;
  dispatchCancellation: DispatchCancellation | null;
}

export type ReportNotePersistenceState = "saved-on-device" | "uploading" | "processing" | "ready" | "failed";

export type ReportNote = ReportTextNote | ReportPhotoNote | ReportAudioNote;

export interface ReportTextNote {
  id: string;
  reportId: string;
  type: "text";
  content: string;
  capturedAt: string;
  capturedUtcOffsetMinutes: number;
  author: { id: string; displayName: string };
  serverReceivedAt: string;
  updatedAt: string;
  persistenceState: ReportNotePersistenceState;
}

export interface ReportPhotoNote {
  id: string;
  reportId: string;
  type: "photo";
  caption: string | null;
  capturedAt: string;
  capturedUtcOffsetMinutes: number;
  author: { id: string; displayName: string };
  serverReceivedAt: string;
  updatedAt: string;
  persistenceState: ReportNotePersistenceState;
  contentType: "image/jpeg";
  byteSize: number;
  sha256: string;
  width: number;
  height: number;
}

export interface ReportAudioNote {
  id: string;
  reportId: string;
  type: "audio";
  caption: string | null;
  capturedAt: string;
  capturedUtcOffsetMinutes: number;
  author: { id: string; displayName: string };
  serverReceivedAt: string;
  updatedAt: string;
  persistenceState: ReportNotePersistenceState;
  contentType: "audio/mp4";
  byteSize: number;
  sha256: string;
  durationMilliseconds: number;
}

export interface CreateReportTextNoteCommand {
  commandId: string;
  expectedRevision: number;
  noteId: string;
  capturedAt: string;
  capturedUtcOffsetMinutes: number;
  content: string;
}

export interface UpdateReportTextNoteCommand {
  commandId: string;
  expectedRevision: number;
  content: string;
}

export interface ReportTextNoteMutationResponse {
  reportId: string;
  revision: number;
  note: ReportTextNote;
}

export interface DeleteReportTextNoteCommand {
  commandId: string;
  expectedRevision: number;
}

export interface DeleteReportTextNoteResponse {
  reportId: string;
  noteId: string;
  revision: number;
  deleted: true;
}

export interface CreateReportPhotoNoteCommand {
  commandId: string;
  expectedRevision: number;
  noteId: string;
  capturedAt: string;
  capturedUtcOffsetMinutes: number;
  caption?: string | null;
  contentType: "image/jpeg";
  canonicalBase64: string;
  sha256: string;
  width: number;
  height: number;
  /** Agency policy observed when the capture was staged. */
  settingsRevision: number;
  effectiveAllowanceBytes: number;
  effectiveImageLimitBytes: number;
}

export interface UpdateReportPhotoCaptionCommand {
  commandId: string;
  expectedRevision: number;
  caption?: string | null;
}

export interface ReportPhotoNoteMutationResponse {
  reportId: string;
  revision: number;
  note: ReportPhotoNote;
}

export type DeleteReportPhotoNoteResponse = DeleteReportTextNoteResponse;

export type ReportAudioSourceContentType = "audio/webm" | "audio/ogg" | "audio/mp4";

export interface CreateReportAudioNoteCommand {
  commandId: string;
  expectedRevision: number;
  noteId: string;
  capturedAt: string;
  capturedUtcOffsetMinutes: number;
  caption?: string | null;
  sourceContentType: ReportAudioSourceContentType;
  sourceBase64: string;
  /** Agency policy observed when the recording was staged. */
  settingsRevision: number;
  effectiveAllowanceBytes: number;
}

export interface UpdateReportAudioCaptionCommand {
  commandId: string;
  expectedRevision: number;
  caption?: string | null;
}

export interface ReportAudioNoteMutationResponse {
  reportId: string;
  revision: number;
  note: ReportAudioNote;
}

export type DeleteReportAudioNoteResponse = DeleteReportTextNoteResponse;

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
  /** NEMSIS Not Value metadata is independent of the ordinary payload. */
  readonly notValue?: { readonly code: string; readonly display?: string; readonly [extension: string]: unknown };
  /** NEMSIS Pertinent Negative metadata may accompany an ordinary payload. */
  readonly pertinentNegative?: { readonly code: string; readonly display?: string; readonly [extension: string]: unknown };
  readonly [extension: string]: unknown;
};

/** Explicitly records that collection was attempted but no value is present. */
export type AbsentEncounterValue = EncounterValueBase & { readonly kind: "absent" };

/** A genuine null value, optionally carrying the NEMSIS NV code that explains it. */
export type NullEncounterValue = EncounterValueBase & {
  readonly kind: "null";
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

/** Independent facets exposed to validation rules without interpreting metadata as a value kind. */
export interface EncounterValueFacets {
  readonly hasValue: boolean;
  readonly hasNotValue: boolean;
  readonly hasPertinentNegative: boolean;
  readonly empty: boolean;
}

export function encounterValueFacets(value: EncounterValue): EncounterValueFacets {
  const hasValue = value.kind === "coded" || value.kind === "scalar";
  const hasNotValue = value.notValue !== undefined || value.kind === "null";
  const hasPertinentNegative = value.pertinentNegative !== undefined || value.kind === "pertinent-negative";
  return { hasValue, hasNotValue, hasPertinentNegative,
    empty: !hasValue && !hasNotValue && !hasPertinentNegative };
}

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
