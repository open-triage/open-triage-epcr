import { BadRequestException } from "@nestjs/common";
import type { ResetAdminCredentialCommand, RevokeAdminSessionCommand } from "@open-triage/contracts";
import { validatePassword } from "../identity/password.js";

const CONTROL_CHARACTER = /[\p{Cc}\p{Cf}]/u;

export function validateRevokeAdminSession(input: unknown): RevokeAdminSessionCommand {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new BadRequestException("Session revocation details must be an object");
  }
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== "confirmOwner") ||
      (value.confirmOwner !== undefined && typeof value.confirmOwner !== "boolean")) {
    throw new BadRequestException("Only an owner-session confirmation may be supplied");
  }
  return value.confirmOwner === true ? { confirmOwner: true } : {};
}

export function validateResetAdminCredential(input: unknown): ResetAdminCredentialCommand {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BadRequestException("Credential reset details are required");
  }
  const value = input as Record<string, unknown>;
  const allowed = new Set(["expectedRevision", "temporaryPassword", "temporaryPasswordHours", "note"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new BadRequestException("Unexpected credential reset field");
  }
  if (!Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 1) {
    throw new BadRequestException("expectedRevision must be a positive integer");
  }
  if (typeof value.temporaryPassword !== "string") throw new BadRequestException("A temporary password is required");
  try {
    validatePassword(value.temporaryPassword);
  } catch (error) {
    throw new BadRequestException(error instanceof Error ? error.message : "The temporary password is invalid");
  }
  const hours = value.temporaryPasswordHours ?? 72;
  if (typeof hours !== "number" || !Number.isInteger(hours) || hours < 1 || hours > 168) {
    throw new BadRequestException("Temporary password duration must be a whole number from 1 to 168 hours");
  }
  const note = value.note === undefined || value.note === null ? undefined
    : typeof value.note === "string" ? value.note.trim().normalize("NFC") : null;
  if (note === null || (note !== undefined && (note.length > 1000 || CONTROL_CHARACTER.test(note)))) {
    throw new BadRequestException("Note must contain at most 1000 visible characters");
  }
  if (note?.includes(value.temporaryPassword)) {
    throw new BadRequestException("Note must not contain the temporary password");
  }
  return { expectedRevision: Number(value.expectedRevision), temporaryPassword: value.temporaryPassword,
    temporaryPasswordHours: hours, ...(note ? { note } : {}) };
}
