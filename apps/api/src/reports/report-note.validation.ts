import type {
  CreateReportTextNoteCommand,
  DeleteReportTextNoteCommand,
  UpdateReportTextNoteCommand,
} from "@open-triage/contracts";

export const REPORT_TEXT_NOTE_MAX_CHARACTERS = 10_000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OFFSET_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const UNSAFE_CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\p{Cf}]/u;

export class ReportNoteValidationError extends Error {
  constructor(readonly findings: readonly string[]) {
    super(`Report note command failed: ${findings.join("; ")}`);
    this.name = "ReportNoteValidationError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uuid(value: unknown, path: string, findings: string[]): void {
  if (typeof value !== "string" || !UUID_V4.test(value)) findings.push(`${path} must be a UUIDv4`);
}

function expectedRevision(value: unknown, findings: string[]): void {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    findings.push("expectedRevision must be a non-negative safe integer");
  }
}

export function normalizeReportNoteContent(value: unknown): string {
  if (typeof value !== "string") throw new ReportNoteValidationError(["content must be text"]);
  const content = value.normalize("NFC").trim();
  const findings: string[] = [];
  if (!content) findings.push("content must contain non-whitespace text");
  if ([...content].length > REPORT_TEXT_NOTE_MAX_CHARACTERS) {
    findings.push("content must be at most 10,000 characters");
  }
  if (UNSAFE_CONTROL_CHARACTER.test(content)) findings.push("content contains an unsafe control character");
  if (findings.length) throw new ReportNoteValidationError(findings);
  return content;
}

function commandBase(value: unknown): { candidate: Record<string, unknown>; findings: string[] } {
  if (!record(value)) throw new ReportNoteValidationError(["request body must be an object"]);
  const findings: string[] = [];
  uuid(value.commandId, "commandId", findings);
  expectedRevision(value.expectedRevision, findings);
  return { candidate: value, findings };
}

export function validateCreateReportTextNoteCommand(value: unknown): CreateReportTextNoteCommand {
  const { candidate, findings } = commandBase(value);
  uuid(candidate.noteId, "noteId", findings);
  if (typeof candidate.capturedAt !== "string" || !OFFSET_DATE_TIME.test(candidate.capturedAt) || !Number.isFinite(Date.parse(candidate.capturedAt))) {
    findings.push("capturedAt must be an offset-aware ISO date-time");
  }
  if (!Number.isInteger(candidate.capturedUtcOffsetMinutes) || Number(candidate.capturedUtcOffsetMinutes) < -840 ||
      Number(candidate.capturedUtcOffsetMinutes) > 840) {
    findings.push("capturedUtcOffsetMinutes must be an integer between -840 and 840");
  }
  let content = "";
  try { content = normalizeReportNoteContent(candidate.content); }
  catch (error) {
    if (error instanceof ReportNoteValidationError) findings.push(...error.findings);
    else throw error;
  }
  if (findings.length) throw new ReportNoteValidationError(findings);
  return { ...candidate, content } as unknown as CreateReportTextNoteCommand;
}

export function validateUpdateReportTextNoteCommand(value: unknown): UpdateReportTextNoteCommand {
  const { candidate, findings } = commandBase(value);
  let content = "";
  try { content = normalizeReportNoteContent(candidate.content); }
  catch (error) {
    if (error instanceof ReportNoteValidationError) findings.push(...error.findings);
    else throw error;
  }
  if (findings.length) throw new ReportNoteValidationError(findings);
  return { ...candidate, content } as unknown as UpdateReportTextNoteCommand;
}

export function validateDeleteReportTextNoteCommand(value: unknown): DeleteReportTextNoteCommand {
  const { candidate, findings } = commandBase(value);
  if (findings.length) throw new ReportNoteValidationError(findings);
  return candidate as unknown as DeleteReportTextNoteCommand;
}
