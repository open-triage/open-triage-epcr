import { UnprocessableEntityException } from "@nestjs/common";
import {
  MAX_REPORT_MEDIA_ALLOWANCE_BYTES,
  MIN_REPORT_MEDIA_ALLOWANCE_BYTES,
  type UpdateAgencyMediaSettingsCommand,
} from "@open-triage/contracts";

const MEBIBYTE = 1024 * 1024;

export function validateUpdateAgencyMediaSettings(input: unknown): UpdateAgencyMediaSettingsCommand {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new UnprocessableEntityException("Agency Settings must be an object");
  }
  const body = input as Record<string, unknown>;
  const allowedKeys = new Set(["expectedRevision", "reportMediaAllowanceBytes"]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    throw new UnprocessableEntityException("Agency Settings contains an unsupported property");
  }
  if (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 1) {
    throw new UnprocessableEntityException("expectedRevision must be a positive integer");
  }
  const allowance = Number(body.reportMediaAllowanceBytes);
  if (!Number.isSafeInteger(body.reportMediaAllowanceBytes) ||
      allowance < MIN_REPORT_MEDIA_ALLOWANCE_BYTES || allowance > MAX_REPORT_MEDIA_ALLOWANCE_BYTES ||
      allowance % MEBIBYTE !== 0) {
    throw new UnprocessableEntityException(
      "reportMediaAllowanceBytes must be a whole MiB between 1 MiB and 2 GiB"
    );
  }
  return { expectedRevision: Number(body.expectedRevision), reportMediaAllowanceBytes: allowance };
}
