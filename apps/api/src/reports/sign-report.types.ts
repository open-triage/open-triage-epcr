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

export interface QualityFinding {
  sourceOccurrenceId: string;
  elementId: string;
  code: string;
  severity: "warning";
  message: string;
  observedNumeric: number;
  sourceUnitCode: string;
  expectedMinInclusive: number;
  expectedMaxInclusive: number;
  ruleVersion: string;
}

export interface DerivedValue {
  sourceOccurrenceId: string;
  elementId: string;
  sourceNumeric: number;
  sourceUnitCode: string;
  derivedNumeric: number;
  derivedUnitCode: string;
  ruleId: string;
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
  qualityRuleVersion: string;
  normalizationRuleVersion: string;
  qualityFindings: QualityFinding[];
  derivedValues: DerivedValue[];
}
