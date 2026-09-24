import type { CreateReportAudioNoteCommand, ReportAudioSourceContentType, UpdateReportAudioCaptionCommand } from "@open-triage/contracts";

export const REPORT_AUDIO_CAPTION_MAX_CHARACTERS = 1_000;
export const REPORT_AUDIO_MAX_SOURCE_BYTES = 32 * 1024 * 1024;
export const REPORT_AUDIO_MAX_DURATION_MILLISECONDS = 300_000;
export const REPORT_AUDIO_SOURCE_TYPES = ["audio/webm", "audio/ogg", "audio/mp4"] as const;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OFFSET_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const UNSAFE_CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\p{Cf}]/u;

export class ReportAudioValidationError extends Error {
  constructor(readonly findings: readonly string[]) {
    super(`Report audio command failed: ${findings.join("; ")}`);
    this.name = "ReportAudioValidationError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uuid(value: unknown, path: string, findings: string[]): void {
  if (typeof value !== "string" || !UUID_V4.test(value)) findings.push(`${path} must be a UUIDv4`);
}

function commandBase(value: unknown): { candidate: Record<string, unknown>; findings: string[] } {
  if (!record(value)) throw new ReportAudioValidationError(["request body must be an object"]);
  const findings: string[] = [];
  uuid(value.commandId, "commandId", findings);
  if (!Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 0) {
    findings.push("expectedRevision must be a non-negative safe integer");
  }
  return { candidate: value, findings };
}

export function normalizeAudioCaption(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new ReportAudioValidationError(["caption must be text or null"]);
  const caption = value.normalize("NFC").trim();
  if (!caption) return null;
  const findings: string[] = [];
  if ([...caption].length > REPORT_AUDIO_CAPTION_MAX_CHARACTERS) findings.push("caption must be at most 1,000 characters");
  if (UNSAFE_CONTROL_CHARACTER.test(caption)) findings.push("caption contains an unsafe control character");
  if (findings.length) throw new ReportAudioValidationError(findings);
  return caption;
}

export function validateCreateReportAudioNoteCommand(value: unknown): CreateReportAudioNoteCommand {
  const { candidate, findings } = commandBase(value);
  uuid(candidate.noteId, "noteId", findings);
  if (typeof candidate.capturedAt !== "string" || !OFFSET_DATE_TIME.test(candidate.capturedAt) || !Number.isFinite(Date.parse(candidate.capturedAt))) {
    findings.push("capturedAt must be an offset-aware ISO date-time");
  }
  if (!Number.isInteger(candidate.capturedUtcOffsetMinutes) || Number(candidate.capturedUtcOffsetMinutes) < -840 ||
      Number(candidate.capturedUtcOffsetMinutes) > 840) findings.push("capturedUtcOffsetMinutes must be an integer between -840 and 840");
  if (!REPORT_AUDIO_SOURCE_TYPES.includes(candidate.sourceContentType as ReportAudioSourceContentType)) {
    findings.push("sourceContentType must be audio/webm, audio/ogg, or audio/mp4");
  }
  if (typeof candidate.sourceBase64 !== "string" || !candidate.sourceBase64 || !BASE64.test(candidate.sourceBase64)) {
    findings.push("sourceBase64 must be canonical base64 audio bytes");
  } else if (Buffer.byteLength(candidate.sourceBase64, "base64") > REPORT_AUDIO_MAX_SOURCE_BYTES) {
    findings.push("source recording is too large");
  }
  let caption: string | null = null;
  try { caption = normalizeAudioCaption(candidate.caption); }
  catch (error) { if (error instanceof ReportAudioValidationError) findings.push(...error.findings); else throw error; }
  if (findings.length) throw new ReportAudioValidationError(findings);
  return { ...candidate, caption } as unknown as CreateReportAudioNoteCommand;
}

export function validateUpdateReportAudioCaptionCommand(value: unknown): UpdateReportAudioCaptionCommand {
  const { candidate, findings } = commandBase(value);
  let caption: string | null = null;
  try { caption = normalizeAudioCaption(candidate.caption); }
  catch (error) { if (error instanceof ReportAudioValidationError) findings.push(...error.findings); else throw error; }
  if (findings.length) throw new ReportAudioValidationError(findings);
  return { ...candidate, caption } as unknown as UpdateReportAudioCaptionCommand;
}

export function validateDeleteReportAudioNoteCommand(value: unknown): { commandId: string; expectedRevision: number } {
  const { candidate, findings } = commandBase(value);
  if (findings.length) throw new ReportAudioValidationError(findings);
  return candidate as { commandId: string; expectedRevision: number };
}
