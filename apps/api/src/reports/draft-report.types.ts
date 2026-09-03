export type PatientIdentityState = "known" | "unknown" | "temporary" | "unavailable";

export interface CreateDraftReportCommand {
  commandId: string;
  reportId: string;
  incidentId: string;
  patientId: string;
  organizationId: string;
  documentingUserId: string;
  formId: string;
  patientIdentityState: PatientIdentityState;
}

export type DraftValue =
  | { kind: "text" | "uri"; value: string }
  | { kind: "integer" | "numeric"; value: string | number; lexical?: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "date"; value: string; precision?: string }
  | { kind: "datetime" | "time"; value: string; utcOffsetMinutes?: number; precision?: string }
  | { kind: "duration"; value: string; lexical?: string }
  | { kind: "binary"; value: string }
  | { kind: "coded"; code: string; codeSystem?: string; display?: string; terminologyVersion?: string }
  | { kind: "null" | "pertinent-negative"; absenceCode: string; display?: string }
  | { kind: "absent"; absenceCode?: string; display?: string };

export interface DraftGroupMutation {
  id: string;
  groupId: string;
  customGroupDefinitionId?: string;
  parentGroupInstanceId?: string | null;
  ordinal: number;
  correlationId?: string | null;
  documentedTime?: string | null;
  documentedUtcOffsetMinutes?: number | null;
  tombstone?: boolean;
}

export interface DraftOccurrenceMutation {
  id: string;
  elementId: string;
  groupInstanceId?: string | null;
  formFieldId?: string | null;
  ordinal?: number;
  correlationId?: string | null;
  documentedTime?: string | null;
  documentedUtcOffsetMinutes?: number | null;
  documentedPrecision?: string | null;
  provenanceKind?: string;
  provenanceDetail?: Record<string, unknown> | null;
  sourceAttributes?: Record<string, unknown> | null;
  tombstone?: boolean;
  value?: DraftValue;
}

export interface SaveDraftReportCommand {
  commandId: string;
  expectedRevision: number;
  authorId: string;
  deviceId?: string;
  clientTime?: string;
  groups?: DraftGroupMutation[];
  occurrences?: DraftOccurrenceMutation[];
}

export interface DraftReportResult {
  id: string;
  status: "draft";
  revision: number;
  organizationId: string;
  incidentId: string;
  patientId: string;
  agencyDemographicVersionId: string;
  formVersionId: string;
  catalogReleaseId: string;
  documentingUserId: string;
}

export interface PostSignatureDraftResult {
  id: string;
  status: "signed";
  revision: number;
  signedRevision: number;
  signedSnapshotId: string;
  canonicalSha256: string;
  retainedAuditNoteCount: number;
}

export type SaveDraftReportResult = DraftReportResult | PostSignatureDraftResult;
