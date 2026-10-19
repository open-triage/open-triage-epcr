export const auditCategories = ["patient", "authentication", "authorization", "configuration", "clinical",
  "media", "recovery", "review", "synthetic", "installations", "feedback", "audit", "analytics"] as const;
export type AuditCategory = typeof auditCategories[number];
export const patientAuditCategories: readonly AuditCategory[] = ["patient", "clinical", "media", "recovery", "review", "synthetic", "audit", "analytics"];
// An empty selection means every category the viewer is permitted to read.
// category remains accepted for older single-category clients.
export type AuditQuery = { categories?: AuditCategory[]; category?: AuditCategory; from: string; to: string; actorId?: string;
  // uuid searches all metadata references; targetId retains the older, narrower filter.
  uuid?: string; targetId?: string; cursor?: string };
export type AuditTargetKind = "user" | "role" | "roleVersion" | "rolePackage" | "capability" | "organization"
  | "ownershipTransfer" | "form" | "catalog" | "validation" | "demographics" | "report" | "reviewItem"
  | "analysis" | "criterion" | "call" | "installation" | "unit" | "feedback" | "analytics" | "record"
  | "photo" | "audio" | "note" | "patient" | "auditEvent";
export type AuditTarget = { kind: AuditTargetKind; label: string | null; version?: number | null; occurredAt?: string };
export type AuditOrganization = { id: string; name: string | null };
export type AuditEntry = {
  recovery?: {reportId:string; itemId:string; dataset:"real"|"synthetic"; amendmentSequence:number};
  // Permanent UUID; source tables may retain separate internal numeric keys.
  id: string; category: AuditCategory; source: string; occurredAt: string; actorId: string | null; action: string;
  actorUsername: string | null; actorDisplayName: string | null;
  outcome: string | null; targetId: string | null; patientId: string | null;
  target?: AuditTarget | null;
  accessOrganizationId: string | null; careProcess: string | null;
  accessOrganizationName?: string | null;
  resourceId?: string | null;
  resource?: AuditTarget | null;
  inspection?: { kind: "list" | "clinical-values" | "payload"; category: AuditCategory | "combined";
    categories?: AuditCategory[] | null; uuidFilter?: string | null } | null;
  analytics?: { dataset: string; from: string | null; through: string | null; reportCount: number | null;
    reportScope: string; identifying: boolean; organizationIds: string[]; organizations?: AuditOrganization[] } | null;
};
export type AuditPage = { entries: AuditEntry[]; nextCursor: string | null; categories: AuditCategory[];
  pageNumber: number; totalPages: number; totalEntries: number };
export type AuditUser = { id: string; displayName: string };
export type AuditUserPage = { users: AuditUser[]; nextCursor: string | null };
export const clinicalValueSources = ["clinical_audit.event", "clinical.report_change",
  "clinical_audit.draft_reconciliation", "clinical_audit.post_signature_audit_note"] as const;
export type ClinicalAuditValues = { values: Record<string, unknown> };
export const auditDumpSources = ["clinical_audit.analytics_access_event", "feedback.submission", "feedback.review_event"] as const;
export type AuditDump = { kind: "analytics" | "feedback"; payload: Record<string, unknown>; requestCaptured?: boolean };
