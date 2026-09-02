import type { SignReportCommand } from "./sign-report.types.js";

export class SignReportValidationError extends Error {
  constructor(readonly findings: readonly string[]) {
    super(`Sign report command failed: ${findings.join("; ")}`);
    this.name = "SignReportValidationError";
  }
}

const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, path: string, findings: string[]): void {
  if (value !== undefined && (typeof value !== "string" || !value.trim())) {
    findings.push(`${path} must be a non-empty string`);
  }
}

export function validateSignReportCommand(value: unknown): SignReportCommand {
  if (!isRecord(value)) throw new SignReportValidationError(["request body must be an object"]);
  const findings: string[] = [];
  for (const key of ["commandId", "signerId"] as const) {
    if (typeof value[key] !== "string" || !uuidV4Pattern.test(value[key])) findings.push(`${key} must be a UUIDv4`);
  }
  if (!Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0) {
    findings.push("expectedRevision must be a non-negative safe integer");
  }
  if (!isRecord(value.attestation) || Object.keys(value.attestation).length === 0) {
    findings.push("attestation must be a non-empty object");
  }
  if (value.warningAcknowledgements !== undefined && !isRecord(value.warningAcknowledgements)) {
    findings.push("warningAcknowledgements must be an object");
  }
  optionalString(value.actorPersona, "actorPersona", findings);
  optionalString(value.sessionId, "sessionId", findings);
  optionalString(value.deviceId, "deviceId", findings);
  if (value.clientTime !== undefined &&
      (typeof value.clientTime !== "string" || !Number.isFinite(Date.parse(value.clientTime)))) {
    findings.push("clientTime must be an ISO date-time");
  }
  if (findings.length) throw new SignReportValidationError(findings);
  return value as unknown as SignReportCommand;
}
