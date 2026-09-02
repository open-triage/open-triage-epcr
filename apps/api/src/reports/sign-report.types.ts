export interface SignReportCommand {
  commandId: string;
  expectedRevision: number;
  signerId: string;
  attestation: Record<string, unknown>;
  warningAcknowledgements?: Record<string, unknown>;
  actorPersona?: string;
  sessionId?: string;
  deviceId?: string;
  clientTime?: string;
}

export interface SigningFinding {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
  ruleVersion: string;
}

export interface SignedReportResult {
  id: string;
  status: "signed";
  signedRevision: number;
  signedSnapshotId: string;
  canonicalSha256: string;
  signerId: string;
  signedAt: string;
  formVersionId: string;
  catalogReleaseId: string;
  reportingDate: string;
  reportingDateSource: "service-date" | "earliest-clinical-time" | "earliest-server-time" | "signing-time";
}
