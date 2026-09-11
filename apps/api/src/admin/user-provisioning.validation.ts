import { BadRequestException } from "@nestjs/common";
import type { ProvisionAdminUserCommand } from "@open-triage/contracts";
import { validatePassword } from "../identity/password.js";

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTER = /\p{Cc}/u;

export function validateProvisionAdminUser(input: unknown): ProvisionAdminUserCommand {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BadRequestException("User provisioning details are required");
  }
  const value = input as Record<string, unknown>;
  if ("organizationId" in value) {
    throw new BadRequestException("organizationId is derived from the authenticated session");
  }
  const username = typeof value.username === "string" ? value.username.trim().toLowerCase() : "";
  if (!USERNAME.test(username)) {
    throw new BadRequestException("Username must be 3-128 lowercase ASCII letters, numbers, dots, underscores, or hyphens");
  }
  const displayName = typeof value.displayName === "string" ? value.displayName.trim().normalize("NFC") : "";
  if (!displayName || displayName.length > 200 || CONTROL_CHARACTER.test(displayName)) {
    throw new BadRequestException("Display name must be 1-200 characters without control characters");
  }
  if (typeof value.temporaryPassword !== "string") {
    throw new BadRequestException("A temporary password is required");
  }
  try {
    validatePassword(value.temporaryPassword);
  } catch (error) {
    throw new BadRequestException(error instanceof Error ? error.message : "The temporary password is invalid");
  }
  const temporaryPasswordHours = value.temporaryPasswordHours === undefined ? 72 : value.temporaryPasswordHours;
  if (typeof temporaryPasswordHours !== "number" || !Number.isInteger(temporaryPasswordHours) ||
      temporaryPasswordHours < 1 || temporaryPasswordHours > 168) {
    throw new BadRequestException("Temporary password duration must be a whole number from 1 to 168 hours");
  }
  if (!Array.isArray(value.roleIds) || value.roleIds.some((roleId) => typeof roleId !== "string" || !UUID.test(roleId))) {
    throw new BadRequestException("roleIds must be a complete array of role UUIDs");
  }
  const roleIds = [...new Set(value.roleIds as string[])];
  if (roleIds.length !== value.roleIds.length) throw new BadRequestException("roleIds must not contain duplicates");
  const note = value.note === undefined || value.note === null ? undefined
    : typeof value.note === "string" ? value.note.trim().normalize("NFC") : null;
  if (note === null || (note !== undefined && (note.length > 1000 || CONTROL_CHARACTER.test(note)))) {
    throw new BadRequestException("Note must be at most 1000 characters without control characters");
  }
  if (note?.includes(value.temporaryPassword)) {
    throw new BadRequestException("Note must not contain the temporary password");
  }
  return { username, displayName, temporaryPassword: value.temporaryPassword,
    temporaryPasswordHours, roleIds, ...(note ? { note } : {}) };
}
