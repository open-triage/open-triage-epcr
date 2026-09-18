import { createHash } from "node:crypto";
import type {
  CreateDraftReportCommand,
  DraftOccurrenceMutation,
  DraftValue,
  SaveDraftReportCommand
} from "./draft-report.types.js";

export class DraftReportValidationError extends Error {
  constructor(readonly findings: readonly string[]) {
    super(`Draft report command failed: ${findings.join("; ")}`);
    this.name = "DraftReportValidationError";
  }
}

const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?$/;
const durationPattern = /^-?P(?=\d|T\d)(?:\d+(?:\.\d+)?Y)?(?:\d+(?:\.\d+)?M)?(?:\d+(?:\.\d+)?W)?(?:\d+(?:\.\d+)?D)?(?:T(?=\d)(?:\d+(?:\.\d+)?H)?(?:\d+(?:\.\d+)?M)?(?:\d+(?:\.\d+)?S)?)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function commandSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function requireUuid(value: unknown, path: string, findings: string[]): void {
  if (typeof value !== "string" || !uuidV4Pattern.test(value)) findings.push(`${path} must be a UUIDv4`);
}

function optionalString(value: unknown, path: string, findings: string[]): void {
  if (value !== undefined && value !== null && (typeof value !== "string" || !value.length)) {
    findings.push(`${path} must be a non-empty string or null`);
  }
}

function optionalOffset(value: unknown, path: string, findings: string[]): void {
  if (value !== undefined && value !== null &&
      (!Number.isInteger(value) || (value as number) < -840 || (value as number) > 840)) {
    findings.push(`${path} must be an integer between -840 and 840`);
  }
}

function validTimestamp(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

export function validateDraftValue(value: unknown, path: string, findings: string[]): value is DraftValue {
  if (!isRecord(value) || typeof value.kind !== "string") {
    findings.push(`${path} must be a typed value`);
    return false;
  }
  for (const key of ["notValue", "pertinentNegative"] as const) {
    if (value[key] === undefined) continue;
    const metadata = value[key];
    if (!isRecord(metadata)) findings.push(`${path}.${key} must be an object`);
    else {
      if (typeof metadata.code !== "string" || !metadata.code.length) findings.push(`${path}.${key}.code is required`);
      optionalString(metadata.display, `${path}.${key}.display`, findings);
    }
  }
  switch (value.kind) {
    case "text":
    case "uri":
      if (typeof value.value !== "string") findings.push(`${path}.value must be a string`);
      break;
    case "integer":
      if (!((typeof value.value === "number" && Number.isSafeInteger(value.value)) ||
          (typeof value.value === "string" && /^-?\d+$/.test(value.value)))) {
        findings.push(`${path}.value must be an integer`);
      }
      optionalString(value.lexical, `${path}.lexical`, findings);
      break;
    case "numeric":
      if (!((typeof value.value === "number" && Number.isFinite(value.value)) ||
          (typeof value.value === "string" && /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.value)))) {
        findings.push(`${path}.value must be a finite decimal`);
      }
      optionalString(value.lexical, `${path}.lexical`, findings);
      break;
    case "boolean":
      if (typeof value.value !== "boolean") findings.push(`${path}.value must be a boolean`);
      break;
    case "date":
      if (typeof value.value !== "string" || !datePattern.test(value.value) ||
          Number.isNaN(Date.parse(`${value.value}T00:00:00Z`))) findings.push(`${path}.value must be an ISO date`);
      optionalString(value.precision, `${path}.precision`, findings);
      break;
    case "datetime":
      if (!validTimestamp(value.value)) findings.push(`${path}.value must be an ISO date-time`);
      optionalOffset(value.utcOffsetMinutes, `${path}.utcOffsetMinutes`, findings);
      optionalString(value.precision, `${path}.precision`, findings);
      break;
    case "time":
      if (typeof value.value !== "string" || !timePattern.test(value.value)) findings.push(`${path}.value must be an ISO time`);
      optionalOffset(value.utcOffsetMinutes, `${path}.utcOffsetMinutes`, findings);
      optionalString(value.precision, `${path}.precision`, findings);
      break;
    case "duration":
      if (typeof value.value !== "string" || !durationPattern.test(value.value)) findings.push(`${path}.value must be an ISO duration`);
      optionalString(value.lexical, `${path}.lexical`, findings);
      break;
    case "binary":
      if (typeof value.value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.value)) {
        findings.push(`${path}.value must be base64`);
      }
      break;
    case "coded":
      if (typeof value.code !== "string" || !value.code.length) findings.push(`${path}.code is required`);
      optionalString(value.codeSystem, `${path}.codeSystem`, findings);
      optionalString(value.display, `${path}.display`, findings);
      optionalString(value.terminologyVersion, `${path}.terminologyVersion`, findings);
      break;
    case "null":
    case "pertinent-negative":
      if (typeof value.absenceCode !== "string" || !value.absenceCode.length) findings.push(`${path}.absenceCode is required`);
      optionalString(value.display, `${path}.display`, findings);
      break;
    case "absent":
      optionalString(value.absenceCode, `${path}.absenceCode`, findings);
      optionalString(value.display, `${path}.display`, findings);
      if (value.display !== undefined && value.absenceCode === undefined) findings.push(`${path}.display requires absenceCode`);
      break;
    default:
      findings.push(`${path}.kind is not supported`);
  }
  return true;
}

export function validateCreateDraftReportCommand(value: unknown): CreateDraftReportCommand {
  if (!isRecord(value)) throw new DraftReportValidationError(["request body must be an object"]);
  const findings: string[] = [];
  for (const key of ["commandId", "reportId", "incidentId", "patientId", "organizationId", "documentingUserId", "formId"] as const) {
    requireUuid(value[key], key, findings);
  }
  if (!["known", "unknown", "temporary", "unavailable"].includes(String(value.patientIdentityState))) {
    findings.push("patientIdentityState is invalid");
  }
  if ("patientPseudonymousKey" in value) findings.push("patientPseudonymousKey is server-derived and must be omitted");
  if (findings.length) throw new DraftReportValidationError(findings);
  return value as unknown as CreateDraftReportCommand;
}

function validateOccurrence(value: unknown, path: string, findings: string[]): value is DraftOccurrenceMutation {
  if (!isRecord(value)) {
    findings.push(`${path} must be an object`);
    return false;
  }
  requireUuid(value.id, `${path}.id`, findings);
  if (typeof value.elementId !== "string" || !value.elementId.length) findings.push(`${path}.elementId is required`);
  if (value.groupInstanceId !== undefined && value.groupInstanceId !== null) requireUuid(value.groupInstanceId, `${path}.groupInstanceId`, findings);
  if (value.formFieldId !== undefined && value.formFieldId !== null) requireUuid(value.formFieldId, `${path}.formFieldId`, findings);
  if (value.ordinal !== undefined && (!Number.isInteger(value.ordinal) || (value.ordinal as number) < 0)) findings.push(`${path}.ordinal must be a non-negative integer`);
  optionalString(value.correlationId, `${path}.correlationId`, findings);
  if (value.documentedTime !== undefined && value.documentedTime !== null && !validTimestamp(value.documentedTime)) findings.push(`${path}.documentedTime must be an ISO date-time`);
  optionalOffset(value.documentedUtcOffsetMinutes, `${path}.documentedUtcOffsetMinutes`, findings);
  optionalString(value.documentedPrecision, `${path}.documentedPrecision`, findings);
  optionalString(value.provenanceKind, `${path}.provenanceKind`, findings);
  if (value.provenanceDetail !== undefined && value.provenanceDetail !== null && !isRecord(value.provenanceDetail)) findings.push(`${path}.provenanceDetail must be an object or null`);
  if (value.sourceAttributes !== undefined && value.sourceAttributes !== null && (!isRecord(value.sourceAttributes) || Object.keys(value.sourceAttributes).length === 0)) findings.push(`${path}.sourceAttributes must be a non-empty object or null`);
  if (value.tombstone !== undefined && typeof value.tombstone !== "boolean") findings.push(`${path}.tombstone must be a boolean`);
  if (value.tombstone) {
    if (value.value !== undefined) findings.push(`${path}.value must be omitted for a tombstone`);
  } else if (value.value === undefined) findings.push(`${path}.value is required`);
  else validateDraftValue(value.value, `${path}.value`, findings);
  return true;
}

export function validateSaveDraftReportCommand(value: unknown): SaveDraftReportCommand {
  if (!isRecord(value)) throw new DraftReportValidationError(["request body must be an object"]);
  const findings: string[] = [];
  requireUuid(value.commandId, "commandId", findings);
  requireUuid(value.authorId, "authorId", findings);
  if (!Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0) {
    findings.push("expectedRevision must be a non-negative safe integer");
  }
  optionalString(value.deviceId, "deviceId", findings);
  if (value.clientTime !== undefined && !validTimestamp(value.clientTime)) findings.push("clientTime must be an ISO date-time");
  if (value.demoAction !== undefined && !["populate", "clear"].includes(String(value.demoAction))) {
    findings.push("demoAction must be populate or clear");
  }
  if (value.groups !== undefined && !Array.isArray(value.groups)) findings.push("groups must be an array");
  if (value.occurrences !== undefined && !Array.isArray(value.occurrences)) findings.push("occurrences must be an array");
  const groups = Array.isArray(value.groups) ? value.groups : [];
  const occurrences = Array.isArray(value.occurrences) ? value.occurrences : [];
  if (groups.length + occurrences.length === 0) findings.push("at least one group or occurrence mutation is required");
  const identities = new Set<string>();
  groups.forEach((group, index) => {
    const path = `groups[${index}]`;
    if (!isRecord(group)) {
      findings.push(`${path} must be an object`);
      return;
    }
    requireUuid(group.id, `${path}.id`, findings);
    if (typeof group.id === "string" && identities.has(group.id)) findings.push(`${path}.id is duplicated`);
    else if (typeof group.id === "string") identities.add(group.id);
    if (typeof group.groupId !== "string" || !group.groupId.length) findings.push(`${path}.groupId is required`);
    if (group.customGroupDefinitionId !== undefined) requireUuid(group.customGroupDefinitionId, `${path}.customGroupDefinitionId`, findings);
    if (group.parentGroupInstanceId !== undefined && group.parentGroupInstanceId !== null) requireUuid(group.parentGroupInstanceId, `${path}.parentGroupInstanceId`, findings);
    if (!Number.isInteger(group.ordinal) || (group.ordinal as number) < 0) findings.push(`${path}.ordinal must be a non-negative integer`);
    optionalString(group.correlationId, `${path}.correlationId`, findings);
    if (group.documentedTime !== undefined && group.documentedTime !== null && !validTimestamp(group.documentedTime)) findings.push(`${path}.documentedTime must be an ISO date-time`);
    optionalOffset(group.documentedUtcOffsetMinutes, `${path}.documentedUtcOffsetMinutes`, findings);
    if (group.tombstone !== undefined && typeof group.tombstone !== "boolean") findings.push(`${path}.tombstone must be a boolean`);
  });
  occurrences.forEach((occurrence, index) => {
    validateOccurrence(occurrence, `occurrences[${index}]`, findings);
    if (isRecord(occurrence) && typeof occurrence.id === "string" && identities.has(occurrence.id)) findings.push(`occurrences[${index}].id is duplicated`);
    else if (isRecord(occurrence) && typeof occurrence.id === "string") identities.add(occurrence.id);
  });
  if (findings.length) throw new DraftReportValidationError(findings);
  return value as unknown as SaveDraftReportCommand;
}
