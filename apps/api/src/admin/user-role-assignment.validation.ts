import { BadRequestException } from "@nestjs/common";
import type { ReplaceAdminUserRolesCommand } from "@open-triage/contracts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateReplaceAdminUserRoles(input: unknown): ReplaceAdminUserRolesCommand {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BadRequestException("A complete desired role set is required");
  }
  const value = input as Record<string, unknown>;
  const allowed = new Set(["expectedRevision", "roleIds", "note"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new BadRequestException("Only a complete desired role set may be submitted");
  }
  if (!Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 1) {
    throw new BadRequestException("expectedRevision must be a positive integer");
  }
  if (!Array.isArray(value.roleIds) || value.roleIds.some((id) => typeof id !== "string" || !UUID.test(id))) {
    throw new BadRequestException("roleIds must be a complete list of role UUIDs");
  }
  const roleIds = [...new Set(value.roleIds as string[])];
  if (roleIds.length !== value.roleIds.length) throw new BadRequestException("roleIds must not contain duplicates");
  const note = typeof value.note === "string" ? value.note.trim().normalize("NFC") : undefined;
  if (note !== undefined && (note.length > 1000 || /[\p{Cc}\p{Cf}]/u.test(note))) {
    throw new BadRequestException("Note must contain at most 1000 visible characters");
  }
  return { expectedRevision: Number(value.expectedRevision), roleIds, ...(note ? { note } : {}) };
}
