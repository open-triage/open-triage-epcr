import type { CreateClinicianSessionCommand } from "@open-triage/contracts";
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
