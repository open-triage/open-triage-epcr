import type { CreateReportPhotoNoteCommand, UpdateReportPhotoCaptionCommand } from "@open-triage/contracts";

export const REPORT_PHOTO_CAPTION_MAX_CHARACTERS = 1_000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OFFSET_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const SHA256 = /^[0-9a-f]{64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const UNSAFE_CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\p{Cf}]/u;

export class ReportPhotoValidationError extends Error {
  constructor(readonly findings: readonly string[]) {
    super(`Report photo command failed: ${findings.join("; ")}`);
    this.name = "ReportPhotoValidationError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uuid(value: unknown, path: string, findings: string[]): void {
  if (typeof value !== "string" || !UUID_V4.test(value)) findings.push(`${path} must be a UUIDv4`);
}

function commandBase(value: unknown): { candidate: Record<string, unknown>; findings: string[] } {
  if (!record(value)) throw new ReportPhotoValidationError(["request body must be an object"]);
  const findings: string[] = [];
  uuid(value.commandId, "commandId", findings);
  if (!Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 0) {
    findings.push("expectedRevision must be a non-negative safe integer");
  }
  return { candidate: value, findings };
}

export function normalizePhotoCaption(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new ReportPhotoValidationError(["caption must be text or null"]);
  const caption = value.normalize("NFC").trim();
  if (!caption) return null;
  const findings: string[] = [];
  if ([...caption].length > REPORT_PHOTO_CAPTION_MAX_CHARACTERS) findings.push("caption must be at most 1,000 characters");
  if (UNSAFE_CONTROL_CHARACTER.test(caption)) findings.push("caption contains an unsafe control character");
  if (findings.length) throw new ReportPhotoValidationError(findings);
  return caption;
}

export function validateCreateReportPhotoNoteCommand(value: unknown): CreateReportPhotoNoteCommand {
  const { candidate, findings } = commandBase(value);
  uuid(candidate.noteId, "noteId", findings);
  if (typeof candidate.capturedAt !== "string" || !OFFSET_DATE_TIME.test(candidate.capturedAt) || !Number.isFinite(Date.parse(candidate.capturedAt))) {
    findings.push("capturedAt must be an offset-aware ISO date-time");
  }
  if (!Number.isInteger(candidate.capturedUtcOffsetMinutes) || Number(candidate.capturedUtcOffsetMinutes) < -840 ||
      Number(candidate.capturedUtcOffsetMinutes) > 840) findings.push("capturedUtcOffsetMinutes must be an integer between -840 and 840");
  if (candidate.contentType !== "image/jpeg") findings.push("contentType must be image/jpeg");
  if (typeof candidate.canonicalBase64 !== "string" || !candidate.canonicalBase64 || !BASE64.test(candidate.canonicalBase64)) {
    findings.push("canonicalBase64 must be canonical base64 image bytes");
  }
  if (typeof candidate.sha256 !== "string" || !SHA256.test(candidate.sha256)) findings.push("sha256 must be a lowercase SHA-256 digest");
  for (const dimension of ["width", "height"] as const) {
    if (!Number.isInteger(candidate[dimension]) || Number(candidate[dimension]) < 1 || Number(candidate[dimension]) > 2560) {
      findings.push(`${dimension} must be an integer between 1 and 2560`);
    }
  }
  let caption: string | null = null;
  try { caption = normalizePhotoCaption(candidate.caption); }
  catch (error) { if (error instanceof ReportPhotoValidationError) findings.push(...error.findings); else throw error; }
  if (findings.length) throw new ReportPhotoValidationError(findings);
  return { ...candidate, caption } as unknown as CreateReportPhotoNoteCommand;
}

export function validateUpdateReportPhotoCaptionCommand(value: unknown): UpdateReportPhotoCaptionCommand {
  const { candidate, findings } = commandBase(value);
  let caption: string | null = null;
  try { caption = normalizePhotoCaption(candidate.caption); }
  catch (error) { if (error instanceof ReportPhotoValidationError) findings.push(...error.findings); else throw error; }
  if (findings.length) throw new ReportPhotoValidationError(findings);
  return { ...candidate, caption } as unknown as UpdateReportPhotoCaptionCommand;
}

export function validateDeleteReportPhotoNoteCommand(value: unknown): { commandId: string; expectedRevision: number } {
  const { candidate, findings } = commandBase(value);
  if (findings.length) throw new ReportPhotoValidationError(findings);
  return candidate as { commandId: string; expectedRevision: number };
}

/** Reads JPEG framing without decoding pixels and rejects metadata-bearing segments. */
export function inspectCanonicalJpeg(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
    throw new ReportPhotoValidationError(["canonical image is not a complete JPEG"]);
  }
  let offset = 2;
  let dimensions: { width: number; height: number } | null = null;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++]!;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) throw new ReportPhotoValidationError(["canonical JPEG has invalid framing"]);
    if (marker === 0xe1 || (marker >= 0xe3 && marker <= 0xed) || marker === 0xef || marker === 0xfe) {
      throw new ReportPhotoValidationError(["canonical JPEG contains EXIF, XMP, IPTC, or comment metadata"]);
    }
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 7) throw new ReportPhotoValidationError(["canonical JPEG has an invalid frame header"]);
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      if (!width || !height || width > 2560 || height > 2560) {
        throw new ReportPhotoValidationError(["canonical JPEG longest edge must be at most 2560 pixels"]);
      }
      dimensions = { width, height };
    }
    offset += length;
  }
  if (dimensions) return dimensions;
  throw new ReportPhotoValidationError(["canonical JPEG dimensions could not be verified"]);
}
