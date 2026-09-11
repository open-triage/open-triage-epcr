import { BadRequestException } from "@nestjs/common";
import type { CancelOwnershipTransferCommand, InitiateOwnershipTransferCommand } from "@open-triage/contracts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL = /[\p{Cc}\p{Cf}]/u;

function note(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new BadRequestException("Note must be text");
  const normalized = value.trim().normalize("NFC");
  if (normalized.length > 1000 || CONTROL.test(normalized)) {
    throw new BadRequestException("Note must contain at most 1000 visible characters");
  }
  return normalized || undefined;
}

export function validateInitiateOwnershipTransfer(input: unknown): InitiateOwnershipTransferCommand {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BadRequestException("An ownership nominee is required");
  }
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== "nomineeUserId" && key !== "note") ||
      typeof value.nomineeUserId !== "string" || !UUID.test(value.nomineeUserId)) {
    throw new BadRequestException("nomineeUserId must be a UUID");
  }
  const transferNote = note(value.note);
  return { nomineeUserId: value.nomineeUserId, ...(transferNote ? { note: transferNote } : {}) };
}

export function validateCancelOwnershipTransfer(input: unknown): CancelOwnershipTransferCommand {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new BadRequestException("Cancellation details must be an object");
  }
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== "note")) {
    throw new BadRequestException("Unexpected ownership cancellation field");
  }
  const transferNote = note(value.note);
  return transferNote ? { note: transferNote } : {};
}
