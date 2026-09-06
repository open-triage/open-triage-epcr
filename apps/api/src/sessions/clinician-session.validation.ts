import type { ChangePasswordCommand, CreateClinicianSessionCommand } from "@open-triage/contracts";
import { BadRequestException } from "@nestjs/common";

export function validateCreateClinicianSession(input: unknown): CreateClinicianSessionCommand {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BadRequestException("A username and password are required");
  }

  const { username, password } = input as Record<string, unknown>;
  if (typeof username !== "string" || !username.trim() || typeof password !== "string" || !password) {
    throw new BadRequestException("A username and password are required");
  }

  return { username: username.trim(), password };
}

export function validateChangePassword(input: unknown): ChangePasswordCommand {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BadRequestException("Current password, new password, and CSRF token are required");
  }
  const { currentPassword, newPassword, csrfToken } = input as Record<string, unknown>;
  if (typeof currentPassword !== "string" || typeof newPassword !== "string" || typeof csrfToken !== "string" ||
      !currentPassword || !newPassword || !csrfToken) {
    throw new BadRequestException("Current password, new password, and CSRF token are required");
  }
  if (newPassword.length < 12 || newPassword.length > 1024) {
    throw new BadRequestException("Passwords must contain between 12 and 1024 characters");
  }
  return { currentPassword, newPassword, csrfToken };
}
