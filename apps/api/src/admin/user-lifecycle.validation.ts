import { BadRequestException } from "@nestjs/common";
import type { UpdateAdminUserCommand } from "@open-triage/contracts";

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,127}$/;

export function validateUpdateAdminUser(input: unknown): UpdateAdminUserCommand {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BadRequestException("User lifecycle details are required");
  }
  const value = input as Record<string, unknown>;
  const allowed = new Set(["expectedRevision", "username", "displayName", "active", "note"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new BadRequestException("Unexpected user lifecycle field");
  const username = typeof value.username === "string" ? value.username.trim().toLowerCase() : "";
  const displayName = typeof value.displayName === "string" ? value.displayName.trim().normalize("NFC") : "";
  const note = typeof value.note === "string" ? value.note.trim().normalize("NFC") : undefined;
  if (!USERNAME.test(username)) throw new BadRequestException("Username must use 3-128 lowercase letters, digits, dots, underscores, or hyphens");
  if (!displayName || displayName.length > 200 || /[\p{Cc}\p{Cf}]/u.test(displayName)) {
    throw new BadRequestException("Display name must contain 1-200 visible characters");
  }
  if (!Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 1) {
    throw new BadRequestException("expectedRevision must be a positive integer");
  }
  if (typeof value.active !== "boolean") throw new BadRequestException("active must be true or false");
  if (note !== undefined && (note.length > 1000 || /[\p{Cc}\p{Cf}]/u.test(note))) {
    throw new BadRequestException("Note must contain at most 1000 visible characters");
  }
  return { expectedRevision: Number(value.expectedRevision), username, displayName,
    active: value.active, ...(note ? { note } : {}) };
}
