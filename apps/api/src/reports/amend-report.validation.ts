import type { AmendReportCommand } from "./amend-report.types.js";
import { validateDraftValue } from "./draft-report.validation.js";

export class AmendReportValidationError extends Error {
  constructor(readonly findings: readonly string[]) {
    super(`Amend report command failed: ${findings.join("; ")}`);
    this.name = "AmendReportValidationError";
  }
}

const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireUuid(value: unknown, path: string, findings: string[]): void {
  if (typeof value !== "string" || !uuidV4Pattern.test(value)) findings.push(`${path} must be a UUIDv4`);
}

function optionalString(value: unknown, path: string, findings: string[]): void {
  if (value !== undefined && (typeof value !== "string" || !value.trim())) {
    findings.push(`${path} must be a non-empty string`);
  }
}

export function validateAmendReportCommand(value: unknown): AmendReportCommand {
  if (!isRecord(value)) throw new AmendReportValidationError(["request body must be an object"]);
  const findings: string[] = [];
  requireUuid(value.commandId, "commandId", findings);
  requireUuid(value.authorId, "authorId", findings);
  if (!Number.isSafeInteger(value.expectedSequence) || (value.expectedSequence as number) < 1) {
    findings.push("expectedSequence must be a positive safe integer");
  }
  if (typeof value.reason !== "string" || !value.reason.trim()) findings.push("reason is required");
  if (!isRecord(value.attestation) || Object.keys(value.attestation).length === 0) {
    findings.push("attestation must be a non-empty object");
  }
  optionalString(value.actorPersona, "actorPersona", findings);
  optionalString(value.sessionId, "sessionId", findings);
  optionalString(value.deviceId, "deviceId", findings);
  if (value.clientTime !== undefined &&
      (typeof value.clientTime !== "string" || !Number.isFinite(Date.parse(value.clientTime)))) {
    findings.push("clientTime must be an ISO date-time");
  }
  if (!Array.isArray(value.changes) || value.changes.length === 0) {
    findings.push("changes must be a non-empty array");
  }
  const changes = Array.isArray(value.changes) ? value.changes : [];
  const targets = new Set<string>();
  changes.forEach((change, index) => {
    const path = `changes[${index}]`;
    if (!isRecord(change) || !["add", "replace", "remove"].includes(String(change.action))) {
      findings.push(`${path}.action must be add, replace, or remove`);
      return;
    }
    if (change.action === "add") {
      if (!isRecord(change.occurrence)) {
        findings.push(`${path}.occurrence is required for add`);
        return;
      }
      const occurrence = change.occurrence;
      requireUuid(occurrence.id, `${path}.occurrence.id`, findings);
      if (typeof occurrence.elementId !== "string" || !occurrence.elementId) findings.push(`${path}.occurrence.elementId is required`);
      if (occurrence.groupInstanceId !== undefined && occurrence.groupInstanceId !== null) requireUuid(occurrence.groupInstanceId, `${path}.occurrence.groupInstanceId`, findings);
      if (occurrence.formFieldId !== undefined && occurrence.formFieldId !== null) requireUuid(occurrence.formFieldId, `${path}.occurrence.formFieldId`, findings);
      if (occurrence.ordinal !== undefined && (!Number.isInteger(occurrence.ordinal) || (occurrence.ordinal as number) < 0)) findings.push(`${path}.occurrence.ordinal must be a non-negative integer`);
      if (occurrence.value === undefined) findings.push(`${path}.occurrence.value is required`);
      else validateDraftValue(occurrence.value, `${path}.occurrence.value`, findings);
      if (occurrence.tombstone !== undefined) findings.push(`${path}.occurrence.tombstone is not allowed`);
      if (typeof occurrence.id === "string" && targets.has(occurrence.id)) findings.push(`${path}.occurrence.id is duplicated`);
      else if (typeof occurrence.id === "string") targets.add(occurrence.id);
      return;
    }
    requireUuid(change.targetElementOccurrenceId, `${path}.targetElementOccurrenceId`, findings);
    if (typeof change.targetElementOccurrenceId === "string" && targets.has(change.targetElementOccurrenceId)) {
      findings.push(`${path}.targetElementOccurrenceId is changed more than once`);
    } else if (typeof change.targetElementOccurrenceId === "string") targets.add(change.targetElementOccurrenceId);
    if (change.action === "replace") {
      if (change.value === undefined) findings.push(`${path}.value is required for replace`);
      else validateDraftValue(change.value, `${path}.value`, findings);
    }
  });
  if (findings.length) throw new AmendReportValidationError(findings);
  return { ...(value as unknown as AmendReportCommand), reason: (value.reason as string).trim() };
}
